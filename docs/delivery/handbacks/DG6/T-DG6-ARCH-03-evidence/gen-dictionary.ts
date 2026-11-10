// T-DG6-ARCH-03: generates (1) the "P6 tables, slices B and A" section of docs/architecture/data-dictionary.md and (2) the
// Kysely interfaces and SCHEMA_COLUMNS entries of packages/db/src/schema.ts from the catalogue of a freshly migrated
// DISPOSABLE database, so both match the migrations exactly (the T-DG6-ARCH-02 generator with the slice B/A table list
// and a type emitter).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/gen-dictionary.ts <dict.md> <types.ts>
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
const B = "0104_p6_connectors_runs_outbound_writes.sql";
const A = "0105_p6_imports_lineage_webhooks.sql";
const X = "0106_p6_deliverable_external_change.sql";
const T: Record<string, Meta> = {
  connector: { migration: B, module: "integrations", purpose: "One connector of an organization: adapter kind (test_adapter, webhook, http_pull), target kind (kpi_actual, none), status and its current configuration version (REQ-S17-001, M0334; ADR-0055 §1).", writers: "`connector.configure` (ADM_TECH) through createConnector, putConnector, enableConnector, disableConnector; creation also writes configuration version 1 and the connector's service identity (ADR-0053 §1) in the same transaction", lifecycle: "created disabled at configuration version 1; disabled <-> enabled; code, adapter kind and target kind fixed; versioned and audited" },
  connector_config_version: { migration: B, module: "integrations", purpose: "One immutable configuration version of a connector: source system id, credential REFERENCES, field mappings, target transformation, cadence, retry bound, commit mode, outbound actions, reconciliation rule, adapter settings (ADR-0055 §1).", writers: "`connector.configure` (ADM_TECH) through createConnector, putConnector and putConnectorMappings (each change is a new version)", lifecycle: "append-only; numbered 1, 2, 3 … per connector without gaps" },
  connector_change: { migration: B, module: "integrations", purpose: "Append-only history of every version of a connector (status, current configuration, names).", writers: "the SECURITY DEFINER trigger `connector_history` only", lifecycle: "append-only; one row per connector version" },
  integration_run: { migration: B, module: "integrations", purpose: "IntegrationRun (REQ-S16-022): one run of a connector with its trigger, attempt, counts (read, staged, committed, rejected, duplicates, errors), error code and redacted message, and reconciliation (REQ-S17-001; ADR-0055 §2).", writers: "the worker connector-run handler (actor service, as the connector's service identity; lock 730310); runConnector, retryIntegrationRun, testConnector and the webhook receipt create it queued", lifecycle: "queued -> running | cancelled; running -> succeeded | failed; finished rows never change; one active run per connector; at most one retry per failed run; versioned and audited" },
  integration_run_event: { migration: B, module: "integrations", purpose: "Append-only status history of an integration run.", writers: "the SECURITY DEFINER trigger `integration_run_history` only", lifecycle: "append-only; one row per integration_run version" },
  outbound_write: { migration: B, module: "integrations", purpose: "One guarded downstream write (REQ-S17-006, M0335): a connector-defined action on a deliverable with an idempotency key, marked confirmed only with the reference of a confirmed response (ADR-0055 §5).", writers: "`outbound_write.execute` (TD) through executeOutboundWrite and confirmOutboundWrite; the dispatch result by the same request after the transaction (lock 730313)", lifecycle: "requested -> pending_confirmation | confirmed | failed; pending_confirmation -> confirmed | failed; confirmed and failed final; one per (connector, idempotency key); versioned and audited" },
  outbound_write_event: { migration: B, module: "integrations", purpose: "Append-only status history of an outbound write.", writers: "the SECURITY DEFINER trigger `outbound_write_history` only", lifecycle: "append-only; one row per outbound_write version" },
  webhook_endpoint: { migration: A, module: "integrations", purpose: "One signed webhook endpoint of a webhook connector: the endpoint key, the signing secret REFERENCE (and the previous one during a rotation), the timestamp tolerance (REQ-S17-003; ADR-0056 §7).", writers: "`webhook.configure` (ADM_TECH) through createWebhookEndpoint, rotateWebhookSecret, disableWebhookEndpoint", lifecycle: "active -> disabled (final); a rotation keeps the old reference for at most 7 days; versioned and audited" },
  webhook_endpoint_change: { migration: A, module: "integrations", purpose: "Append-only history of every version of a webhook endpoint.", writers: "the SECURITY DEFINER trigger `webhook_endpoint_history` only", lifecycle: "append-only; one row per webhook_endpoint version" },
  webhook_receipt: { migration: A, module: "integrations", purpose: "One ACCEPTED webhook delivery (signature valid, inside the window): the replay and idempotency backstop (ADR-0056 §7). Rejected requests are not stored.", writers: "receiveWebhook (no session; signature-authenticated; lock 730312), in the transaction that creates its staged batch", lifecycle: "append-only; one per (endpoint, delivery id)" },
  import_batch: { migration: A, module: "integrations (imports)", purpose: "One staged import into one transformation and target kind, pinned to the transformation's form schema version (REQ-S17-002; ADR-0056 §2).", writers: "`import.create` (KDS) through createImport; the webhook receipt and the connector run (service); commit and cancel: `import.commit` (KDS) through commitImport and cancelImport, or the auto commit on behalf of the configured user (lock 730311)", lifecycle: "staging -> staged | failed; staged -> committed | cancelled; final states never change; versioned and audited" },
  import_batch_event: { migration: A, module: "integrations (imports)", purpose: "Append-only status and count history of an import batch.", writers: "the SECURITY DEFINER trigger `import_batch_history` only", lifecycle: "append-only; one row per import_batch version" },
  import_row: { migration: A, module: "integrations (imports)", purpose: "One staged source row: raw cells as text, normalized values, duplicate key, validation status and row-level reason codes (REQ-S17-002; ADR-0056 §3–§5).", writers: "the staging step of createImport, the webhook receipt and the connector run; the commit moves commit_status (column-level UPDATE)", lifecycle: "inserted while the batch is staging; then only commit_status pending -> committed | not_committed; never deleted; covered by the batch's audit events" },
  import_row_commit: { migration: A, module: "integrations (imports)", purpose: "Lineage: a committed row -> the KPI actual (and value number) it created through the DG4 submission path (REQ-S17-002; ADR-0056 §6).", writers: "commitImport through the `ImportTargetRegistry` target (KBE-A), in the commit transaction", lifecycle: "append-only; one per committed row" },
  deliverable_external_change: { migration: X, module: "portfolio", purpose: "The external-change flag of a deliverable and its separate confirmation state with provenance (REQ-S01-005, M0080; ADR-0055 §6).", writers: "flag and withdraw: `external_change.flag` (TL, BO, WL, TO); confirm with reviewed evidence: `external_change.confirm` (BO, TD); confirm with a connector result: the confirmOutboundWrite path as the connector's service identity (lock 730314)", lifecycle: "unconfirmed -> confirmed (final); one per deliverable; versioned and audited" },
  deliverable_external_change_event: { migration: X, module: "portfolio", purpose: "Append-only history of the flag and its confirmation.", writers: "the SECURITY DEFINER trigger `deliverable_external_change_history` only", lifecycle: "append-only; one row per deliverable_external_change version" },
};
const ORDER = Object.keys(T);
const pascal = (s: string) => s.split("_").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
function tsType(type: string, nn: boolean, def: string | null): string {
  let base: string;
  if (type === "timestamp with time zone") return !nn ? "NullableTimestamp" : def ? "TimestampDefault" : "Timestamp";
  if (type === "jsonb") return !nn ? "NullableJson" : def ? "JsonDefault" : "Json";
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
  await c0.query(`CREATE DATABASE dict_p6ba OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p6ba";
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
