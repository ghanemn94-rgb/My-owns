// T-DG4-ARCH-07: generates the "P4 tables, slice H" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG4-ARCH-06 generator with the slice H table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/gen-dictionary.ts > <out.md>
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
const M1 = "0051_p4_phases_gates_g5_g6_exceptions.sql";
const M2 = "0052_p4_change_control.sql";
const T: Record<string, Meta> = {
  phase_definition: { migration: M1, module: "workflows", purpose: "The six phases with name, title, purpose and key outputs (B0021, verbatim) and the phase objective (B0027, B0046, B0054, B0068, B0091, B0119), provisional Arabic (REQ-PB-014; ADR-0035 §1).", writers: "none (seed, read-only)", lifecycle: "seed" },
  phase_step_definition: { migration: M1, module: "workflows", purpose: "The guided procedure of each phase: one verbatim M0118-M0123 procedure clause per step, required evidence, default owner and reviewer roles and the completion rule (architect interpretation) (REQ-S04-001; ADR-0035 §1).", writers: "none (seed, read-only)", lifecycle: "seed" },
  phase_step: { migration: M1, module: "workflows", purpose: "One transformation's progress on one phase step: named owner, status, frozen completion check, separate reviewer (REQ-S04-001; ADR-0035 §1). No row = not started, owner Unknown.", writers: "`phase_step.manage` (TL, TO); `phase_step.progress` (the owner); `phase_step.review` (SP, BO, FIN, TO; not the owner); the `gate.decided` consumer (actor service) enables the next phase's steps", lifecycle: "not_started → in_progress → in_review → complete (final) | returned; returned → in_progress | in_review" },
  phase_step_evidence: { migration: M1, module: "workflows", purpose: "Evidence linked to a phase step; verified evidence meets the evidence_linked completion rule (REQ-S04-001; ADR-0035 §1).", writers: "`phase_step.progress` (the step owner)", lifecycle: "active → removed (final); frozen once the step is complete" },
  gate_criterion_review: { migration: M1, module: "workflows", purpose: "A per-criterion review of a pending gate submission: reviewer, finding, open condition, risk, recommendation (the criterion decision) and rationale; with the criterion, required evidence and completeness, the nine M0124 fields (REQ-S04-009, REQ-S04-010; ADR-0035 §3).", writers: "`gate.review` (SP, BO, FIN, TO; not the submitter)", lifecycle: "append-only; review_no 1, 2, … per submission and criterion" },
  gate_exception: { migration: M1, module: "workflows", purpose: "A specifically authorized exception (waiver) for one mandatory criterion of one gate instance: reason, scope, approver, expiry and compensating action (REQ-S04-012, REQ-S04-013; ADR-0035 §4). Covers its criterion while accepted and the business date is on or before expires_on.", writers: "`gate_exception.request` (TL); `gate_exception.decide` (SP, BO; the gate's configured approver, not the requester); the `gate.exception_expiry_scan` job sets expiry_notified_at once", lifecycle: "pending → accepted | rejected | withdrawn; accepted → revoked (final)" },
  gate_decision_scale_scope: { migration: M1, module: "workflows", purpose: "The approved scale scope of a G5 approval: one initiative in one business unit per row, so a scope is never unrestricted (REQ-S04-007, REQ-S12-010, M0124; ADR-0035 §5).", writers: "the G5 decision (`gate.decide`, the configured approver)", lifecycle: "append-only" },
  gate_decision_condition: { migration: M1, module: "workflows", purpose: "A condition of a G5 approval with owner and deadline (M0124; ADR-0035 §5).", writers: "the G5 decision (`gate.decide`)", lifecycle: "append-only" },
  scale_transition: { migration: M1, module: "workflows", purpose: "Scaling one initiative into one business unit, only inside the scope of an approved G5 decision (REQ-S03-004, REQ-S04-007; ADR-0035 §5).", writers: "`scale.transition` (TL)", lifecycle: "append-only; once per initiative and business unit" },
  risk_disposition: { migration: M1, module: "workflows", purpose: "A proposed disposition of an open RAID risk (accept, transfer, carry into BAU) with rationale and residual owner; approved through the canonical approval of type risk_disposition, it counts for G5 Risk closure (REQ-PB-020, REQ-S04-007; ADR-0035 §6).", writers: "`risk_disposition.propose` (TL, BO, WL); decided with `approval.decide` (SP, BO, FIN)", lifecycle: "append-only; status = its approval's status" },
  change_control_policy: { migration: M2, module: "workflows", purpose: "The materiality thresholds of one transformation; NULL = every change of that kind is material; no threshold is seeded (REQ-S09-010; ADR-0036 §3).", writers: "`change_control.configure` (TL, TO)", lifecycle: "one row per transformation; versioned" },
  change_request: { migration: M2, module: "workflows", purpose: "A change request to an approved record (scope, baseline, target, TOM, cost, benefit logic, KPI definition, schedule or budget rebaseline) with reason, proposed change, materiality, route and frozen impact assessment; decided through the canonical approval (REQ-S04-014, REQ-S07-015, REQ-S09-010; REQ-S16-018 ChangeRequest; ADR-0036 §1).", writers: "`change_request.raise` (TL, BO, WL, FIN, TO, KDS; the requester); the `change_request` approval subject provider (outcomes); the material-change hook (origin automatic)", lifecycle: "draft → submitted | withdrawn; submitted → approved | rejected | changes_requested | withdrawn; changes_requested → submitted | withdrawn (approved, rejected, withdrawn final)" },
  impact_assessment: { migration: M2, module: "workflows", purpose: "The impact assessment frozen for one submitted change-request version, with the SHA-256 of its items (REQ-S04-014, REQ-S07-015; ADR-0036 §5).", writers: "`submitChangeRequest`", lifecycle: "append-only; one per request version" },
  impact_assessment_item: { migration: M2, module: "workflows", purpose: "One affected record of an impact assessment: outcome, KPI, benefit, gate (naming the preserved submission and decision), report (T10 area), formula, initiative, milestone, business case or budget line (ADR-0036 §5).", writers: "`submitChangeRequest`", lifecycle: "append-only" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_h OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_h";
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
