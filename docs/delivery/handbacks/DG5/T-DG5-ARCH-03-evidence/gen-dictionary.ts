// T-DG5-ARCH-03: generates the "P5 tables, slices D and E" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG5-ARCH-02 generator with the slice D/E table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/gen-dictionary.ts > <out.md>
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
const M4 = "0074_p5_automation_engine.sql";
const M5 = "0075_p5_starters_routes_policies.sql";
const T: Record<string, Meta> = {
  automation_trigger: { migration: M4, module: "automation", purpose: "The triggers a rule can use (M0221): outbox event types, job schedules and (starters only) in-request evaluation, with the payload fields conditions may test and the initiating-user field (ADR-0043 §2).", writers: "migrations only", lifecycle: "seeded catalogue (22 rows in 0074, 9 in 0075)" },
  automation_action_type: { migration: M4, module: "automation", purpose: "The action registry's catalogue (ADR-0043 §2): automatic actions with their required permission, and the six human-only decisions listed only to be refused (REQ-S12-026, M0242).", writers: "migrations only", lifecycle: "seeded catalogue (11 rows)" },
  automation_rule: { migration: M4, module: "automation", purpose: "A rule's identity (REQ-S12-001): code, origin (starter | admin), scope, owner, enabled state, whether it may be disabled (D-142 Q3) and its effective version.", writers: "`automation.configure`; starters by migration (0075)", lifecycle: "disabled ⇄ enabled (guarantee starters always enabled); versioned" },
  automation_rule_version: { migration: M4, module: "automation", purpose: "One version of a rule: triggers, conditions, actions, identity, service permissions, parameters, content hash, review and publication (REQ-S12-001, REQ-S12-002; ADR-0043 §1, §4).", writers: "`automation.configure` (content, submit, publish, discard), `automation.review` (review); starter v1 by migration", lifecycle: "draft → in_review → approved → published → superseded; discarded; content frozen outside draft; versioned" },
  automation_dry_run: { migration: M4, module: "automation", purpose: "A dry run of a draft against a sample event: conditions, planned actions, findings; writes nothing else (REQ-S12-002; ADR-0043 §4).", writers: "`automation.configure`", lifecycle: "append-only" },
  automation_execution: { migration: M4, module: "automation", purpose: "One evaluation of one rule version for one trigger occurrence: identity, outcome, attempt, error (REQ-S12-001, REQ-S12-021; ADR-0043 §5).", writers: "the worker (service identity); retry by `automation.repair`", lifecycle: "running → succeeded | skipped | failed; failed → running (retry); versioned" },
  automation_action_result: { migration: M4, module: "automation", purpose: "The outcome of one action of one execution attempt with its idempotency key and produced record (REQ-S12-021; ADR-0043 §5).", writers: "the worker", lifecycle: "append-only" },
  job_run: { migration: M4, module: "jobs", purpose: "One finished attempt of a scheduled job (REQ-S12-022 'store scheduled runs and execution outcomes'; ADR-0043 §6).", writers: "the worker", lifecycle: "append-only operational log (no audit event)" },
  operational_failure: { migration: M4, module: "automation", purpose: "The failure queue: failed rule executions and jobs with the original idempotency key and job data, retries and dismissal (REQ-S12-002, REQ-S12-020, REQ-S12-022; M0239; ADR-0043 §5).", writers: "the worker (capture, retry outcome); `automation.repair` / `job.repair` (retry, dismiss)", lifecycle: "open → retrying → resolved | open; open → dismissed; versioned" },
  approval_route_step: { migration: M5, module: "workflows", purpose: "One step of a sequential or parallel approval route of a canonical approval, per round (REQ-S10-015; ADR-0044 §4).", writers: "the route instantiation of `approval.request`; `approval.decide` (step decisions)", lifecycle: "waiting → active → approved | rejected | changes_requested; cancelled; versioned" },
  gate_condition_closure: { migration: M5, module: "workflows", purpose: "The closure of one condition of a conditional approval by its owner (REQ-S04-011; ADR-0044 §3).", writers: "`gate_condition.close` (the condition owner)", lifecycle: "append-only; one per condition" },
  gate_condition_escalation: { migration: M5, module: "workflows", purpose: "The single escalation of an overdue open condition to the approver (REQ-S04-011; ADR-0044 §3).", writers: "the worker (gate.condition_escalation_scan)", lifecycle: "append-only; one per condition" },
  notification_policy: { migration: M5, module: "tasks", purpose: "An organization's notification policy: working-day timing, default quiet hours and digest, urgent delivery (REQ-S12-025; ADR-0044 §5).", writers: "`notification_policy.configure`", lifecycle: "one per organization; versioned" },
  notification_preference: { migration: M5, module: "tasks", purpose: "A user's quiet hours, time zone and digest preference (REQ-S12-025; ADR-0044 §5).", writers: "`notification.preferences` (own row only)", lifecycle: "one per user; versioned" },
  notification_digest: { migration: M5, module: "tasks", purpose: "One digest per user and 15-minute window delivering the held non-urgent notifications (REQ-S12-025; ADR-0044 §5).", writers: "the worker (notification.digest)", lifecycle: "append-only" },
  meeting_cutoff_pack: { migration: M5, module: "governance", purpose: "The draft agenda and pack generated once at a meeting's cut-off from current open asks, reviewed by the chair or secretary before its items can be published (REQ-S12-015; ADR-0044 §6).", writers: "the worker (generation); the chair (`meeting.chair`) or secretary (`meeting.prepare`) (review)", lifecycle: "draft → reviewed; content fixed; versioned" },
  dependency_slip: { migration: M5, module: "portfolio", purpose: "One critical dependency slip with its affected initiatives, owners and forecast finishes before and after (REQ-S12-012; ADR-0044 §7).", writers: "the API, inside the milestone change that causes it", lifecycle: "append-only; one per (dependency, slip key)" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p5de OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p5de";
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
