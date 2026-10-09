// T-DG4-ARCH-01: generates the "P4 tables, slices I and C" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly.
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/gen-dictionary.ts > <out.md>
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
const T: Record<string, Meta> = {
  business_calendar: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "organization", purpose: "Working-day calendar of an organization (REQ-S10-006, M0196; ADR-0025 §1). One active default per organization; default Asia/Riyadh, workweek Sunday-Thursday (ISO 7,1,2,3,4). No holiday is seeded.", writers: "system (`p4_ensure_default_calendar`); `calendar.configure` (ADM_TECH)", lifecycle: "active → archived (the default calendar cannot be archived)" },
  business_calendar_holiday: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "organization", purpose: "An administered non-working date range (inclusive, at most 31 days) of a calendar (REQ-S10-006; ADR-0025 §1).", writers: "`calendar.configure` (ADM_TECH)", lifecycle: "active → removed (never deleted)" },
  job_schedule: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "jobs (worker registers it with pg-boss)", purpose: "A recurring job of the scheduled-job kit: queue, five-field cron and timezone (REQ-S16-005; ADR-0025 §3). Platform-wide. Seeded: approval.escalation_scan, delegation.expiry_sweep, kpi.reporting_period_open.", writers: "migrations insert; `job.configure` (ADM_TECH) updates enabled/cron/timezone", lifecycle: "enabled ⇄ disabled" },
  work_item_kind: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "tasks", purpose: "Catalogue of My Work item kinds; later slices insert their own kinds by migration (ADR-0025 §4).", writers: "migrations only", lifecycle: "seed (read-only)" },
  work_item: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "tasks", purpose: "One owned task in My Work with an i18n message and a relative deep link (REQ-S12-005, REQ-S03-008; ADR-0025 §4). The dedupe key makes a duplicate creation impossible (REQ-S16-005).", writers: "`tasks/service.ts` `createWorkItemOnce` (domain services, job handlers); the assignee completes", lifecycle: "open → done | cancelled (final)" },
  inbox_notification: { migration: "0028_p4_calendar_jobs_work_items.sql", module: "tasks", purpose: "In-app reminder with a direct link (REQ-S12-005; ADR-0025 §4). No email or messaging channel in P4.", writers: "`createWorkItemOnce`; the recipient marks it read", lifecycle: "unread → read (once)" },
  access_group: { migration: "0029_p4_groups_role_mapping_delegation.sql", module: "access", purpose: "A governed group (REQ-S16-011 Group, REQ-S10-008), e.g. SteerCo. A routing target; it grants no permission (ADR-0026 §1).", writers: "`group.manage` (TO)", lifecycle: "active → archived" },
  access_group_member: { migration: "0029_p4_groups_role_mapping_delegation.sql", module: "access", purpose: "Membership of a governed group with an effective window; removal is recorded (ADR-0026 §1).", writers: "`group.manage` (TO)", lifecycle: "current → removed (final)" },
  governance_party: { migration: "0029_p4_groups_role_mapping_delegation.sql", module: "access", purpose: "The 18 parties named by T11 (B0099) and T12 (B0101); label_en is the source wording, label_ar provisional (ADR-0026 §2).", writers: "migrations only", lifecycle: "seed (read-only)" },
  role_mapping: { migration: "0029_p4_groups_role_mapping_delegation.sql", module: "access", purpose: "Who a governance party is in one transformation: one named person or one governed group; no fallback when unmapped (REQ-S10-008; ADR-0026 §2).", writers: "`role_mapping.assign` (TL, TO)", lifecycle: "active → ended (final)" },
  decision_right_template: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "The four T11 rows of B0099, VERBATIM (REQ-PB-065; ADR-0026 §5).", writers: "migrations only", lifecycle: "seed (read-only)" },
  governance_matrix: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "Approval header of a transformation's T11 (decision_rights) or T12 (raci) matrix; row edits bump its version; SP approves a version (REQ-S10-007; ADR-0026 §7).", writers: "system (instantiation); `decision_right.configure` / `raci.edit`; the approval engine", lifecycle: "draft → in_approval → approved | draft" },
  transformation_decision_right: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "One T11 row of a transformation: the seeded copy (template_key) or an added row; parties, SLA type and escalation chain (REQ-PB-065, REQ-PB-066; ADR-0026 §5).", writers: "system (instantiation); `decision_right.configure` (TO, TL)", lifecycle: "active → retired" },
  raci_template_deliverable: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "The six T12 deliverables of B0101, VERBATIM (REQ-PB-067).", writers: "migrations only", lifecycle: "seed (read-only)" },
  raci_template_cell: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "The 36 T12 cells of B0101 (A, R, C, I, A/R), VERBATIM (REQ-PB-067).", writers: "migrations only", lifecycle: "seed (read-only)" },
  transformation_raci_deliverable: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "A T12 deliverable of one transformation, copied from the template or added; an accountability exception documents the governance rule that permits zero or several A (REQ-S10-007, REQ-S10-009; ADR-0026 §7).", writers: "system (instantiation); `raci.edit` (TO, TL)", lifecycle: "active → retired" },
  transformation_raci_assignment: { migration: "0030_p4_decision_rights_raci.sql", module: "governance", purpose: "One RACI cell (deliverable × party): A, R, C, I, A/R or NULL; exactly one A or A/R per active deliverable at COMMIT unless excepted (REQ-PB-067, REQ-S10-009).", writers: "system (instantiation); `raci.edit` (TO, TL)", lifecycle: "value changes; never deleted" },
  approval_type: { migration: "0031_p4_approvals_permissions.sql", module: "workflows", purpose: "What can be approved through the P4 engine, its subject table and default SoD policy (ADR-0026 §4).", writers: "migrations only", lifecycle: "seed (read-only)" },
  approval: { migration: "0031_p4_approvals_permissions.sql", module: "workflows", purpose: "The canonical P4 business-approval record: assignee, request version, due date (or Unknown with a reason), status, escalation, decision (REQ-S10-014, -016, -017, -018, -019; D-089 Q10; ADR-0026 §4).", writers: "`approval.request` (requester); `approval.decide` (assignee); the escalation job (escalation fields only)", lifecycle: "pending → approved | rejected | changes_requested | deferred | withdrawn; changes_requested → pending (resubmission); final: approved, rejected, withdrawn" },
  approval_decision: { migration: "0031_p4_approvals_permissions.sql", module: "workflows", purpose: "Every outcome a person records on an approval, with rationale, comments, request version and decision instant (REQ-S10-014, REQ-S10-018).", writers: "`approval.decide` (assignee, group member, escalation target or their delegate)", lifecycle: "append-only" },
  approval_escalation: { migration: "0031_p4_approvals_permissions.sql", module: "workflows", purpose: "What the overdue timer did: one row per approval, round and due date; target or routing error (REQ-S10-019; ADR-0026 §6).", writers: "the `approval.escalation_scan` job (service actor)", lifecycle: "append-only" },
};
const ORDER = Object.keys(T);

async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict";
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
