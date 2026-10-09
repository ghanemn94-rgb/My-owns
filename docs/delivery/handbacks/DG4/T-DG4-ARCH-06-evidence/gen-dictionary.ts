// T-DG4-ARCH-06: generates the "P4 tables, slices F and G" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG4-ARCH-05 generator with the slice F and G table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/gen-dictionary.ts > <out.md>
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
const M1 = "0047_p4_adoption.sql";
const M2 = "0048_p4_sustainment.sql";
const T: Record<string, Meta> = {
  adoption_indicator_template: { migration: M1, module: "adoption", purpose: "The seven leading adoption indicators of B0109-B0115, verbatim, one row per measure (indicator 4 has two: training completion and observed proficiency), with provisional Arabic and the platform's KPI-template reading (REQ-PB-071, REQ-PB-072; ADR-0033 §2).", writers: "none (seed, read-only)", lifecycle: "seed" },
  stakeholder_group: { migration: M1, module: "adoption", purpose: "One T13 row (B0107; REQ-PB-070) with the M0215 additions: influence and impact separately, stance, required behavior, intervention types, intervention plan, owner, adoption KPI (REQ-S11-001; REQ-S16-020 StakeholderGroup; ADR-0033 §1, §3).", writers: "`adoption.edit` (TL, BO, WL)", lifecycle: "active → archived (final)" },
  stakeholder_champion: { migration: M1, module: "adoption", purpose: "A named champion of a stakeholder group (M0215; B0116; ADR-0033 §7).", writers: "`adoption.edit` (TL, BO, WL)", lifecycle: "active → removed (final)" },
  adoption_metric_link: { migration: M1, module: "adoption", purpose: "An indicator measure attached to an outcome, initiative, stakeholder group or the transformation; a KPI-fed measure names its KPI (REQ-S16-020 AdoptionMetricLink; ADR-0033 §3).", writers: "`adoption.edit` (TL, BO, WL)", lifecycle: "active → removed (final)" },
  adoption_intervention: { migration: M1, module: "adoption", purpose: "An adoption intervention: planned by a person (comms, training, involvement, incentive) or created by the worker exactly once per indicator, scope and period below trajectory (REQ-PB-069, REQ-S11-001; REQ-S16-020 AdoptionIntervention; ADR-0033 §4).", writers: "`adoption.edit` (TL, BO, WL); the `adoption.indicator_evaluated` consumer (actor service)", lifecycle: "planned → in_progress → done; planned → done; planned | in_progress → cancelled (final)" },
  assessment_form: { migration: M1, module: "adoption", purpose: "A short native feedback or proficiency-assessment form (REQ-S11-002; ADR-0033 §5).", writers: "`assessment_form.manage` (BO, WL)", lifecycle: "draft → published → retired (final)" },
  assessment_form_version: { migration: M1, module: "adoption", purpose: "The validated, versioned question set of a form (validated form JSON; ADR-0014; ADR-0033 §5).", writers: "`assessment_form.manage` (BO, WL)", lifecycle: "append-only" },
  assessment_invitation: { migration: M1, module: "adoption", purpose: "An invited respondent of a published form, for a stakeholder group and optionally an observed person (REQ-S11-002 respond:invited users; ADR-0033 §5).", writers: "`assessment_form.manage` (BO, WL); the response marks it responded", lifecycle: "open → responded | cancelled (final)" },
  training_record: { migration: M1, module: "adoption", purpose: "One participant's training attendance; completion is attendance, never adoption (REQ-PB-072; REQ-S16-020 Training/AssessmentRecord, training half; ADR-0033 §6).", writers: "`proficiency.record` (BO, WL)", lifecycle: "enrolled → completed | no_show | withdrawn (final)" },
  assessment_record: { migration: M1, module: "adoption", purpose: "A submitted feedback response or proficiency observation, linked to its stakeholder group; observations count in the observed-proficiency measure until withdrawn (REQ-S11-002, REQ-PB-072; REQ-S16-020 Training/AssessmentRecord, assessment half; ADR-0033 §5, §6).", writers: "`assessment.respond` (the respondent); review `assessment.review` (BO)", lifecycle: "submitted → reviewed | withdrawn; reviewed → withdrawn (final)" },
  stakeholder_involvement: { migration: M1, module: "adoption", purpose: "An impacted group's involvement in a design workshop or a T04 design decision; corrections are withdrawal rows (REQ-PB-073; ADR-0033 §7).", writers: "`adoption.edit` (TL, BO, WL)", lifecycle: "append-only" },
  champion_constraint: { migration: M1, module: "adoption", purpose: "A constraint raised in person by an active champion on a T04 design decision, shown on that decision (REQ-PB-073; ADR-0033 §7).", writers: "`champion_constraint.raise` (BO, WL; the champion); address `decision.edit`; withdraw the champion", lifecycle: "open → addressed | withdrawn (final)" },
  performance_area: { migration: M2, module: "sustainment", purpose: "A performance area that continues after its origin transformation closes; BAU owner, KPI owner, review cadence and cycle (REQ-S03-002, REQ-S11-004, REQ-S11-009; ADR-0034 §4).", writers: "`performance_area.manage` (BO, TO); `performance_area.reopen` (BO, TL); handover acceptance; the review scan advances next_review_date", lifecycle: "establishing → bau → reopened → bau; any non-retired → retired (final)" },
  performance_area_cycle: { migration: M2, module: "sustainment", purpose: "The append-only cycle history of an area: each reopening's reason and the prior accepted handover and closure, as they were (REQ-S11-009; ADR-0034 §4).", writers: "`performance_area.manage` (cycle 1, with the area); `performance_area.reopen`", lifecycle: "append-only" },
  performance_area_link: { migration: M2, module: "sustainment", purpose: "A KPI or benefit an area carries on after closure (REQ-S03-002; ADR-0034 §4).", writers: "`performance_area.manage` (BO, TO)", lifecycle: "active → removed (final)" },
  control: { migration: M2, module: "sustainment", purpose: "A BAU control of a performance area and its check cadence (REQ-PB-083, REQ-S11-008; ADR-0034 §6).", writers: "`control.manage` (BO, TO); handover acceptance (owner); the check scan advances next_check_date", lifecycle: "active → retired (final)" },
  control_check: { migration: M2, module: "sustainment", purpose: "One periodic check of a control for one due date; a failed check emits control_check.failed (REQ-S11-008; ADR-0034 §6).", writers: "the `sustainment.control_check_scan` job (actor service); `control_check.record` (BO, TO)", lifecycle: "due → passed | failed | cancelled (final)" },
  bau_handover: { migration: M2, module: "sustainment", purpose: "The BAU handover of one area cycle with the M0217 content and receiving-owner acceptance (REQ-PB-083, REQ-S11-005; REQ-S16-021 BAUHandover; ADR-0034 §5).", writers: "`bau_handover.prepare` (WL, TL); accept / return `bau_handover.accept` (BO, the receiving owner only)", lifecycle: "draft → submitted → accepted (final) | returned; returned → submitted" },
  bau_handover_evidence: { migration: M2, module: "sustainment", purpose: "The evidence items of a handover (M0217 evidence; ADR-0034 §5).", writers: "`bau_handover.prepare` (WL, TL)", lifecycle: "append-only" },
  transition_decision: { migration: M2, module: "sustainment", purpose: "A documented transition decision for a long-realization benefit: residual owner and scheduled monitoring; decided through the canonical approval; writes no benefit value (REQ-S11-007; ADR-0034 §3).", writers: "`transition_decision.propose` (BO, FIN); the approval provider (approve, reject, changes requested); the review scan advances next_monitoring_date", lifecycle: "draft → submitted → approved | rejected; submitted → draft; draft | submitted → withdrawn (final)" },
  sustainment_review: { migration: M2, module: "sustainment", purpose: "One recurring review task: a performance-area review in BAU, or a benefit-monitoring review for a transition decision's residual owner; once per subject and due date (REQ-PB-083, REQ-S11-004, REQ-S11-007; ADR-0034 §5, §6).", writers: "handover acceptance (first review); the `sustainment.review_scan` job (actor service); `sustainment_review.complete` (the assignee)", lifecycle: "due → done | cancelled (final)" },
  lesson: { migration: M2, module: "sustainment", purpose: "A lesson; published lessons are searchable across the organization's transformations in the caller's scope (REQ-S11-008; REQ-S16-021 Lesson; ADR-0034 §8).", writers: "`lesson.edit` (BO, TO)", lifecycle: "draft → published → archived; draft → archived (final)" },
  improvement_item: { migration: M2, module: "sustainment", purpose: "A continuous-improvement backlog item with its source; persists after closure (REQ-PB-084, REQ-S11-008; REQ-S16-021 ImprovementItem; ADR-0034 §8).", writers: "`improvement.edit` (BO, TO)", lifecycle: "open ⇄ in_progress → done | rejected (final)" },
  closure_record: { migration: M2, module: "sustainment", purpose: "The governed closure of an initiative or a transformation with the basis checked (validated value and/or transition decisions; G6 for a transformation) (REQ-PB-009, REQ-S03-003; ADR-0034 §7).", writers: "`initiative.close`, `transformation.close` (TL)", lifecycle: "append-only; one per subject" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_fg OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_fg";
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
