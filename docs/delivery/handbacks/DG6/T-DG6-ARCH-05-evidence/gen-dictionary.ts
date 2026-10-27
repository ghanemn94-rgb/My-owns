// T-DG6-ARCH-05: generates (1) the "P6 tables, slice D" section of docs/architecture/data-dictionary.md and (2) the
// Kysely interfaces and SCHEMA_COLUMNS entries of packages/db/src/schema.ts from the catalogue of a freshly migrated
// DISPOSABLE database, so both match the migrations exactly (the T-DG6-ARCH-04 generator with the slice D table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/gen-dictionary.ts <dict.md> <types.ts>
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;

interface Meta {
  migration: string;
  purpose: string;
  module: string;
  writers: string;
  lifecycle: string;
}
const D = "0111_p6_assistant.sql";
const T: Record<string, Meta> = {
  assistant_setting: { migration: D, module: "assistant", purpose: "At most one row: whether the optional assistant is on, its provider (http_endpoint | test_adapter), the IT-provided endpoint, API style and model, the credential as a SecretRef (never a value), the company authorization reference, the limits, and who turned it on and when (REQ-S17-009; ADR-0059 §3). No row = disabled.", writers: "ADM_TECH holding `assistant.configure`, through putAssistantSetting, enableAssistant, disableAssistant (lock 730323)", lifecycle: "created disabled; disabled <-> enabled; while enabled the provider, endpoint, API style, model, credential and authorization reference are fixed; versioned and audited" },
  assistant_setting_change: { migration: D, module: "assistant", purpose: "Append-only history of every version of the assistant setting (the audited enable and disable trail with their reasons).", writers: "the SECURITY DEFINER trigger `assistant_setting_history` only", lifecycle: "append-only; one row per assistant_setting version" },
  assistant_conversation: { migration: D, module: "assistant", purpose: "A user's own assistant conversation, optionally focused on one transformation: title, message count (at most 100), whether a reply is awaited (REQ-S17-007; ADR-0059 §5).", writers: "its owner, holding `assistant.use` (every role except AUD), through createAssistantConversation and postAssistantMessage", lifecycle: "every update appends exactly one message and flips awaiting_reply; owner, transformation and title fixed; versioned and audited (the audit event of each update covers the message appended with it)" },
  assistant_message: { migration: D, module: "assistant", purpose: "One message of a conversation: the user's prompt as typed, or the assistant's reply (answer with content and at least one citation; refusal with its code; no_sources; unavailable with an error code; interrupted). Citations are record ids and versions or playbook block references; retrieved record text is never stored (REQ-S17-007, REQ-S17-008, REQ-S17-011; ADR-0059 §5, §8).", writers: "postAssistantMessage only, in the transaction of the conversation update that counts it (the owner is the row's created_by)", lifecycle: "append-only" },
  assistant_suggestion: { migration: D, module: "assistant", purpose: "A labelled suggestion on an answer: a charter or T16 decision-brief draft (text fields only) or advice (a recovery action, missing evidence), with its citations (REQ-S17-007, REQ-S17-008; ADR-0059 §6).", writers: "postAssistantMessage (created proposed with the answer); the owner through takeAssistantSuggestionToDraft (proposed -> taken_to_draft)", lifecycle: "proposed -> taken_to_draft (final; draft kinds only); content never changes; versioned and audited" },
};
const ORDER = Object.keys(T);
const pascal = (s: string) => s.split("_").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
function tsType(type: string, nn: boolean, def: string | null): string {
  let base: string;
  if (type === "timestamp with time zone") return !nn ? "NullableTimestamp" : def ? "TimestampDefault" : "Timestamp";
  if (type === "jsonb") return !nn ? "NullableJson" : def ? "JsonDefault" : "Json";
  if (type === "tsvector") return "GeneratedTsvector";
  if (type === "text[]") base = "string[]";
  else if (type === "integer" || type === "smallint") base = "number";
  else if (type === "boolean") base = "boolean";
  else base = "string"; // uuid, text, character(n), numeric, bigint, date
  if (!nn) return `${base} | null`;
  return def ? `Generated<${base}>` : base;
}
async function main(): Promise<void> {
  const [dictOut, typesOut] = process.argv.slice(2);
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p6d OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p6d";
  u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir: migrationsDir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const out: string[] = [];
  const ifaces: string[] = [];
  const catalogue: string[] = [];
  for (const t of ORDER) {
    const m = T[t]!;
    const priv = await c.query(
      `SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
       WHERE grantee = 'mth_app' AND table_schema = 'public' AND table_name = $1`, [t]);
    const colPriv = await c.query(
      `SELECT string_agg(column_name, ', ' ORDER BY column_name) AS p FROM information_schema.column_privileges
       WHERE grantee = 'mth_app' AND table_schema = 'public' AND table_name = $1 AND privilege_type = 'UPDATE'
         AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.grantee = 'mth_app' AND g.table_name = $1 AND g.privilege_type = 'UPDATE')`, [t]);
    out.push(`### ${t}`, "");
    out.push(`- **Purpose:** ${m.purpose}`);
    out.push(`- **Migration:** \`${m.migration}\`. **API module:** \`${m.module}\`. **Who writes:** ${m.writers}. **Lifecycle:** ${m.lifecycle}.`);
    out.push(`- **\`mth_app\` privileges:** ${priv.rows[0].p ?? "none"}${colPriv.rows[0].p ? `; UPDATE on (${colPriv.rows[0].p}) only` : ""}.`, "");
    const cols = await c.query(
      `SELECT a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
    ifaces.push(`export interface ${pascal(t)}Table {`);
    for (const col of cols.rows) ifaces.push(`  ${col.name}: ${tsType(col.type.replace(/\(.*\)/, "").replace("character", "character"), col.nn, col.def)};`);
    ifaces.push("}", "");
    catalogue.push(`  ${t}: [`, ...cols.rows.map((col: any) => `    "${col.name}",`), "  ],");
    const cons = await c.query(
      `SELECT conname, contype, conkey, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`, [t]);
    const colCons = new Map<number, string[]>();
    const tableCons: string[] = [];
    const kind: Record<string, string> = { c: "CHECK", u: "UNIQUE", f: "FK", p: "PK", x: "EXCLUDE" };
    for (const k of cons.rows) {
      if (k.contype === "t") continue;
      k.def = k.def.replaceAll("::text", "");
      const single = k.conkey && k.conkey.length === 1;
      let text: string | null = null;
      if (single && k.contype === "p") text = "PK";
      else if (single && k.contype === "f") {
        const m2 = /REFERENCES (\w+)\((\w+)\)/.exec(k.def);
        text = m2 ? `FK → ${m2[1]}(${m2[2]})` : null;
      } else if (single && k.contype === "c" && k.conname.endsWith("_check")) text = `\`${k.def.replaceAll("|", "\\|")}\``;
      if (text) {
        const arr = colCons.get(k.conkey[0]) ?? [];
        arr.push(text);
        colCons.set(k.conkey[0], arr);
      } else tableCons.push(`- \`${k.conname}\` (${kind[k.contype] ?? k.contype}): \`${k.def}\``);
    }
    out.push("| Column | Type | Null | Default | Column constraints |", "|---|---|---|---|---|");
    for (const col of cols.rows)
      out.push(`| ${col.name} | ${col.type} | ${col.nn ? "NOT NULL" : "NULL"} | ${col.def ? `\`${String(col.def).replaceAll("::text", "")}\`` : ""} | ${(colCons.get(col.attnum) ?? []).join("; ")} |`);
    out.push("");
    if (tableCons.length) out.push("**Table constraints:**", "", ...tableCons, "");
    const idx = await c.query(
      `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS def FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = $1::regclass AND NOT x.indisprimary
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid) ORDER BY 1`, [t]);
    if (idx.rowCount) {
      out.push("**Indexes:**", "");
      for (const r of idx.rows) {
        const uniq = /CREATE UNIQUE INDEX/.test(r.def) ? "UNIQUE " : "";
        out.push(`- \`${r.name}\`: \`${uniq}${r.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING btree /, "").replaceAll("::text", "")}\``);
      }
      out.push("");
    }
    const trg = await c.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`, [t]);
    if (trg.rowCount) {
      out.push("**Triggers:**", "");
      for (const r of trg.rows) {
        const d = r.def
          .replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, (_m: string, ct: string | undefined) => (ct ? "CONSTRAINT " : ""))
          .replace(/ ON public\.\S+/, "")
          .replace(/ EXECUTE FUNCTION (\S+)$/, " → `$1`");
        out.push(`- \`${r.tgname}\`: ${d}`);
      }
      out.push("");
    }
  }
  ifaces.push("export interface Database {", ...ORDER.map((t) => `  ${t}: ${pascal(t)}Table;`), "}", "");
  ifaces.push(...ORDER.map((t) => `export type ${pascal(t)}Row = Selectable<${pascal(t)}Table>;`));
  writeFileSync(dictOut!, out.join("\n") + "\n");
  writeFileSync(typesOut!, ifaces.join("\n") + "\n// ---- SCHEMA_COLUMNS entries\n" + catalogue.join("\n") + "\n");
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
