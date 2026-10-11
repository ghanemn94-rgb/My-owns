// qa-verifier DG4 round 1 (T-DG4-REV-QA-R1): independent probes of clauses that the register notes mark as covered
// only by an analyst inspection or by a single-owner fixture. This file lives OUTSIDE the frozen candidate
// (docs/delivery/test-evidence/DG4/qa/tests/round-1/integration/); it is copied into a disposable clone's
// tests/qa/integration/ only to run, and removed afterwards.
//
//  P1  REQ-S16-011, -014, -017, -018, -019, -020: "the ERD and migrations contain every entity listed ... with primary
//      keys, owner and status where applicable". For every listed entity: the table named in ERD section 2 is in the
//      ERD text, exists in the migrated scratch database (migrations 0001..0060), has exactly one primary key, and the
//      columns that carry ownership/scoping and status are listed. The expected owner/status column per entity is the
//      QA verifier's own reading of the table's purpose; "n/a" means not applicable to that entity, and is said so.
//  P2  REQ-S12-005: "a period opening creates one task per KPI owner". The worker's own test uses ONE owner; this probe
//      uses two owners (owner 1 owns two KPIs, owner 2 one KPI) plus a KPI in another organization. Each active KPI of
//      the organization gets exactly one kpi_update_due task, assigned to its owner; each owner gets one task per KPI
//      they own; nobody else gets one; a second run creates none.
//
// All data is SYNTHETIC. Nothing here decides a business approval or touches the engineering gates DG0-DG7.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDuePeriods } from "../../../apps/worker/src/handlers/kpi.ts";
import { seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../../../apps/worker/test/support.ts";
import { insertAuditEvent, sql, type Db } from "../../../packages/db/src/index.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
}, 60_000);
afterAll(async () => {
  await env.close();
});

const erd = readFileSync(fileURLToPath(new URL("../../../docs/architecture/erd.md", import.meta.url)), "utf8");

/** Entity -> [table, owner/scoping column or null (n/a), status column or null (n/a)]. */
type Spec = Record<string, [string, string | null, string | null]>;
const GROUPS: Record<string, Spec> = {
  "REQ-S16-011": {
    Organization: ["organization", null, "status"],
    BusinessUnit: ["business_unit", "organization_id", "status"],
    User: ["app_user", "organization_id", "status"],
    Group: ["access_group", "organization_id", "status"],
    Role: ["role", null, null],
    Permission: ["permission", null, null],
    ScopedAssignment: ["scoped_assignment", "user_id", null],
    Delegation: ["delegation", "delegator_user_id", "status"],
  },
  "REQ-S16-014": {
    KPIDefinition: ["kpi_definition", "owner_user_id", "status"],
    KPIVersion: ["kpi_version", null, "status"],
    KPIActual: ["kpi_actual", "submitted_by", "status"],
    TargetTrajectory: ["target_trajectory", null, "status"],
    CalculationRun: ["calculation_run", null, "status"],
    DataQualityFinding: ["data_quality_finding", null, "status"],
  },
  "REQ-S16-017": {
    BusinessCase: ["business_case", null, "status"],
    Scenario: ["benefit_scenario", null, null],
    Benefit: ["benefit", "owner_user_id", "status"],
    BenefitAllocation: ["benefit_allocation", null, null],
    // Run 1 of this probe expected `status`; the ERD slice-B register (§1f.3) names `validation_status` as this
    // immutable table's status column, and migration 0023 has it. The expectation was the QA verifier's error.
    BenefitFormulaVersion: ["benefit_formula_version", "created_by", "validation_status"],
    BenefitMeasurement: ["benefit_measurement", null, "status"],
    FinanceValidation: ["finance_validation", null, "status"],
  },
  "REQ-S16-018": {
    Risk: ["raid_entry", "owner_user_id", "status"],
    Assumption: ["raid_entry", "owner_user_id", "status"],
    Issue: ["raid_entry", "owner_user_id", "status"],
    Action: ["action_item", "owner_user_id", "status"],
    Decision: ["decision", "owner_user_id", "status"],
    ChangeRequest: ["change_request", null, "status"],
    Approval: ["approval", null, "status"],
  },
  "REQ-S16-019": {
    Forum: ["forum", null, "status"],
    Meeting: ["meeting", null, "status"],
    AgendaItem: ["agenda_item", null, "status"],
    Attendance: ["meeting_attendance", "user_id", null],
    Minutes: ["meeting_minutes", null, "status"],
    MeetingActionLink: ["meeting_action_link", null, null],
  },
  "REQ-S16-020": {
    StakeholderGroup: ["stakeholder_group", null, "status"],
    AdoptionIntervention: ["adoption_intervention", "owner_user_id", "status"],
    TrainingRecord: ["training_record", null, "status"],
    AssessmentRecord: ["assessment_record", null, "status"],
    AdoptionMetricLink: ["adoption_metric_link", null, null],
  },
};

describe("P1 entity groups: ERD and migrations (REQ-S16-011/014/017/018/019/020)", () => {
  for (const [req, spec] of Object.entries(GROUPS)) {
    it(`${req}: every listed entity is in the ERD, has a table with one primary key, and its owner/status columns`, async () => {
      const report: Record<string, unknown> = {};
      for (const [entity, [table, owner, status]] of Object.entries(spec)) {
        const inErd = new RegExp("`" + table + "`").test(erd);
        const cols = (
          await sql<{ column_name: string }>`
            SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`.execute(env.db)
        ).rows.map((r) => r.column_name);
        const pk =
          cols.length === 0
            ? 0
            : (
                await sql<{ n: number }>`
                  SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = ${table}::regclass AND contype = 'p'`.execute(
                  env.db,
                )
              ).rows[0]!.n;
        const ownerish = cols.filter((c) => /owner|_by$|user_id|organization_id|transformation_id/.test(c));
        const statusish = cols.filter((c) => /status|state/.test(c));
        report[entity] = { table, inErd, pk, ownerish, statusish };
        expect(inErd, `${req} ${entity}: \`${table}\` is named in docs/architecture/erd.md`).toBe(true);
        expect(cols.length, `${req} ${entity}: table ${table} exists after migrations`).toBeGreaterThan(0);
        expect(pk, `${req} ${entity}: exactly one primary key on ${table}`).toBe(1);
        if (owner) expect(cols, `${req} ${entity}: owner/scoping column ${owner} on ${table}`).toContain(owner);
        if (status) expect(cols, `${req} ${entity}: status column ${status} on ${table}`).toContain(status);
      }
      console.log(`QA-P1 ${req} ${JSON.stringify(report)}`);
    });
  }
});

// ------------------------------------------------------------------------------------------------ P2 REQ-S12-005

const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `qa-${randomUUID()}`, source: "api" }) as const;

async function addUser(db: Db, organizationId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto("app_user")
    .values({ id, organization_id: organizationId, display_name: name, created_by: null, updated_by: null })
    .execute();
  return id;
}

/** One active direct-accept KPI owned by `owner`, written as the API would, with its audit events. */
async function addKpi(db: Db, organizationId: string, transformationId: string, owner: string, name: string) {
  const kpiId = randomUUID();
  const versionId = randomUUID();
  await db.transaction().execute(async (tx) => {
    const audit = (recordType: string, recordId: string, action: string, newVersion: number) =>
      insertAuditEvent(tx, actor(owner), {
        action,
        recordType,
        recordId,
        organizationId,
        transformationId,
        priorVersion: newVersion > 1 ? newVersion - 1 : null,
        newVersion,
      });
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name,
        unit_kind: "count",
        unit_label: "lines",
        polarity: "higher_is_better",
        frequency: "monthly",
        status: "active",
        owner_user_id: owner,
        created_by: owner,
        updated_by: owner,
      })
      .execute();
    await audit("kpi_definition", kpiId, "kpi_definition.create", 1);
    await tx
      .insertInto("kpi_version")
      .values({
        id: versionId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_definition_id: kpiId,
        version_no: 1,
        measure_type: "higher_is_better",
        value_nature: "flow",
        unit_kind: "count",
        unit_label: "lines",
        frequency: "monthly",
        aggregation_rule: "sum",
        submission_route: "direct_accept",
        created_by: owner,
        updated_by: owner,
      })
      .execute();
    await audit("kpi_version", versionId, "kpi_version.create", 1);
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: owner, version: 2 })
      .where("id", "=", versionId)
      .execute();
    await audit("kpi_version", versionId, "kpi_version.activate", 2);
  });
  return kpiId;
}

async function addScheduledPeriod(db: Db, organizationId: string, by: string): Promise<string> {
  const id = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("reporting_period")
      .values({
        id,
        organization_id: organizationId,
        frequency: "monthly",
        period_label: "2026-02",
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: id,
      organizationId,
      newVersion: 1,
    });
  });
  return id;
}

describe("P2 period opening with two KPI owners (REQ-S12-005)", () => {
  it("each KPI owner gets exactly one task per KPI they own; nobody else gets one; a re-run creates none", async () => {
    const a = await seedTransformationWithOutbox(env.db);
    const orgA = (
      await env.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", a.transformationId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    const owner1 = a.userId;
    const owner2 = await addUser(env.db, orgA, "Synthetic QA KPI owner 2");
    const bystander = await addUser(env.db, orgA, "Synthetic QA bystander");
    const k1 = await addKpi(env.db, orgA, a.transformationId, owner1, "Synthetic QA KPI 1 (owner 1)");
    const k2 = await addKpi(env.db, orgA, a.transformationId, owner1, "Synthetic QA KPI 2 (owner 1)");
    const k3 = await addKpi(env.db, orgA, a.transformationId, owner2, "Synthetic QA KPI 3 (owner 2)");
    await addScheduledPeriod(env.db, orgA, owner1);
    // Another organization with its own KPI and due period: must get nothing from org A's run.
    const b = await seedTransformationWithOutbox(env.db);
    const orgB = (
      await env.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    const kB = await addKpi(env.db, orgB, b.transformationId, b.userId, "Synthetic QA KPI org B");
    await addScheduledPeriod(env.db, orgB, b.userId);

    const first = await openDuePeriods(env.db, { organizationId: orgA }, "qa-r1-period-open-1");
    const tasks = await env.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "subject_id", "status"])
      .where("kind", "=", "kpi_update_due")
      .where("subject_id", "in", [k1, k2, k3, kB])
      .execute();
    console.log(`QA-P2 first=${JSON.stringify(first)} tasks=${JSON.stringify(tasks)}`);
    expect(first).toEqual({ opened: 1, tasks: 3 });
    const pairs = tasks.map((t) => `${t.subject_id}:${t.assignee_user_id}`).sort();
    expect(pairs).toEqual([`${k1}:${owner1}`, `${k2}:${owner1}`, `${k3}:${owner2}`].sort());
    expect(tasks.every((t) => t.status === "open")).toBe(true);
    expect(tasks.some((t) => t.assignee_user_id === bystander)).toBe(false);
    expect(tasks.some((t) => t.subject_id === kB)).toBe(false);
    // Owner 2 has exactly one task (one KPI); owner 1 one per KPI owned (two).
    expect(tasks.filter((t) => t.assignee_user_id === owner2)).toHaveLength(1);
    expect(tasks.filter((t) => t.assignee_user_id === owner1)).toHaveLength(2);
    // A re-run (retry or next day) creates nothing.
    expect(await openDuePeriods(env.db, { organizationId: orgA }, "qa-r1-period-open-2")).toEqual({
      opened: 0,
      tasks: 0,
    });
    const again = await env.db
      .selectFrom("work_item")
      .select("id")
      .where("kind", "=", "kpi_update_due")
      .where("subject_id", "in", [k1, k2, k3])
      .execute();
    expect(again).toHaveLength(3);
  });
});
