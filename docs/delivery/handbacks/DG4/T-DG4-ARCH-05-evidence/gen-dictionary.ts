// T-DG4-ARCH-05: generates the "P4 tables, slice D" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG4-ARCH-04 generator with the slice D table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/gen-dictionary.ts > <out.md>
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
const M1 = "0044_p4_forums_meetings.sql";
const M2 = "0045_p4_t16_escalation.sql";
const T: Record<string, Meta> = {
  forum_template: { migration: M1, module: "governance", purpose: "The five operating-system layers of B0093, verbatim (Layer, Cadence, Purpose, Participants, Outputs), with provisional Arabic and the platform's structured reading (chair party, participant parties, output kinds, publication rule, default recurrence) (REQ-PB-060; ADR-0032 §1).", writers: "none (seed, read-only)", lifecycle: "seed" },
  forum: { migration: M1, module: "governance", purpose: "A governance forum of a transformation (REQ-S16-019 Forum): the five layers copied at instantiation, plus forums a team adds; participants, quorum, cut-off and agenda rules are configuration (REQ-S10-005; ADR-0032 §1.1).", writers: "`forum.configure` (TO); `p4_instantiate_forums` (instantiation and backfill)", lifecycle: "active → archived (final)" },
  forum_participant: { migration: M1, module: "governance", purpose: "A named participant of a forum, a person or a governed group, and whether it counts for quorum (REQ-S10-005; ADR-0032 §1.2). Grants no permission.", writers: "`forum.configure` (TO)", lifecycle: "active → removed (final)" },
  meeting_series: { migration: M1, module: "governance", purpose: "The recurrence of a forum's meetings; rule_version steps by 1 on every recurrence change; a change regenerates future meetings only (REQ-PB-060, REQ-S10-005; ADR-0032 §2).", writers: "`forum.configure` (TO); the generation job advances generated_through only", lifecycle: "active → ended (final)" },
  meeting: { migration: M1, module: "governance", purpose: "One forum meeting (REQ-S16-019 Meeting): generated from a series by the worker (no human author) or created ad hoc (ADR-0032 §3.1).", writers: "the generation job; `meeting.prepare` (TL, TO, SEC); `meeting.chair` (agenda publication); minutes publication", lifecycle: "scheduled → agenda_published → in_session → held → minutes_published; scheduled → in_session; scheduled | agenda_published → cancelled (final)" },
  agenda_item: { migration: M1, module: "governance", purpose: "One agenda item (REQ-S16-019 AgendaItem); an executive ask links its T16 decision or carries a draft brief, never both; publication needs the elements of B0102 and REQ-S10-012; quorum is enforced on a decided outcome (REQ-PB-068, REQ-S10-011; ADR-0032 §3.2, §3.3).", writers: "`meeting.prepare` (TL, TO, SEC); publish `meeting.chair`; outcome decided `executive_decision.decide`", lifecycle: "draft → published → closed; draft | published → withdrawn (final)" },
  meeting_attendance: { migration: M1, module: "governance", purpose: "One person's attendance at one meeting (REQ-S16-019 Attendance); the quorum count is the present rows that count for quorum (REQ-S10-011; ADR-0032 §3.3).", writers: "`meeting.prepare` (TL, TO, SEC)", lifecycle: "mutable until the meeting's minutes are published" },
  meeting_output: { migration: M1, module: "governance", purpose: "One output of a meeting as defined for its layer (B0093 Outputs), linked to the canonical record it is about (REQ-PB-061; ADR-0032 §4).", writers: "`meeting.prepare` (TL, TO, SEC)", lifecycle: "append-only" },
  meeting_action_link: { migration: M1, module: "governance", purpose: "An action assigned or reviewed in a meeting (REQ-S16-019 MeetingActionLink); the action itself is the canonical action_item (ADR-0032 §5.4).", writers: "`meeting.prepare` (TL, TO, SEC)", lifecycle: "append-only" },
  meeting_minutes: { migration: M1, module: "governance", purpose: "The minutes of one meeting (REQ-S16-019 Minutes); immutable once published; publication needs a held meeting and the forum's required outputs (REQ-S10-011, REQ-PB-061; ADR-0032 §5).", writers: "`meeting.prepare` (draft); `meeting.chair` (approve, publish, return to draft)", lifecycle: "draft → approved → published (final); approved → draft" },
  governance_escalation_rule: { migration: M2, module: "governance", purpose: "The decision-SLA and blocker-red escalation rules per transformation (M0231, M0233; ADR-0032 §8.1). Without a row the code defaults apply.", writers: "`escalation_rule.configure` (TL, TO)", lifecycle: "mutable, versioned; kind immutable" },
  decision_escalation: { migration: M2, module: "governance", purpose: "One escalation of an executive ask whose SLA expired, with its target or routing error and the delay impact; once per (ask, SLA due date); never a decision (REQ-S12-011; ADR-0032 §7).", writers: "the `governance.decision_sla_scan` job (actor service)", lifecycle: "append-only" },
  blocker_status: { migration: M2, module: "governance", purpose: "A blocker's RAG in one review cycle (one meeting): the RAG history by cycle of REQ-PB-082 (ADR-0032 §8.2).", writers: "`meeting.prepare` (TL, TO, SEC)", lifecycle: "append-only" },
  executive_decision_log: { migration: M2, module: "governance", purpose: "View: the T16 Executive Decision Log (B0130) over the canonical decision rows of kind executive, with the nine T16 columns (REQ-PB-081; ADR-0032 §6). No copy.", writers: "none (view)", lifecycle: "derived" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_d OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_d";
  u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir: migrationsDir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const out: string[] = [];
  for (const t of ORDER) {
    const m = T[t]!;
    const priv = await c.query(
      `SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
       WHERE grantee = 'mth_app' AND table_schema = 'public' AND table_name = $1`, [t]);
    out.push(`## ${t}`, "");
    out.push(`- **Purpose:** ${m.purpose}`);
    out.push(`- **Migration:** \`${m.migration}\`. **API module:** \`${m.module}\`. **Who writes:** ${m.writers}. **Lifecycle:** ${m.lifecycle}.`);
    out.push(`- **\`mth_app\` privileges:** ${priv.rows[0].p ?? "none"}.`, "");
    const cols = await c.query(
      `SELECT a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
    const cons = await c.query(
      `SELECT conname, contype, conkey, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`, [t]);
    const colCons = new Map<number, string[]>();
    const tableCons: string[] = [];
    const kind: Record<string, string> = { c: "CHECK", u: "UNIQUE", f: "FK", p: "PK", x: "EXCLUDE" };
    for (const k of cons.rows) {
      if (k.contype === "t") continue; // constraint triggers are listed under Triggers
      k.def = k.def.replaceAll("::text", "");
      const single = k.conkey && k.conkey.length === 1;
      let text: string | null = null;
      if (single && k.contype === "p") text = "PK";
      else if (single && k.contype === "f") {
        const m2 = /REFERENCES (\w+)\((\w+)\)/.exec(k.def);
        text = m2 ? `FK → ${m2[1]}(${m2[2]})` : null;
      } else if (single && k.contype === "c" && k.conname.endsWith("_check")) text = `\`${k.def}\``;
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
  console.log(out.join("\n"));
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
