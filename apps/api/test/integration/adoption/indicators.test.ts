// Adoption indicators (T-DG4-KBE-F; p4-work-split §F+G FG.3; ADR-0033 §2-§4, §6, §9, §10, §12). Proves, against the
// run's disposable PostgreSQL:
//  - REQ-PB-071 A11 "all seven indicators are available by name": the seven B0109-B0115 names verbatim, indicator 4 with
//    two measures (training completion, observed proficiency), Arabic flagged provisional, for any signed-in user;
//  - metric links (REQ-S16-020 AdoptionMetricLink): createKpi creates the KPI from the template (is_leading, unit,
//    polarity, owner) in the same transaction; every ADR-0033 §10 link refusal with its exact text; If-Match 428/409 on
//    the removal; one audit event per written row; AUD 403; ADM-only and outsiders 404; commit-time authorisation;
//  - REQ-PB-072 A11: 100% training completion with no proficiency observations → observed_proficiency
//    valueStatus "unknown", value null (never 0, never derived from training);
//  - REQ-S11-002 A11 (count half): a proficiency observation submitted via a published proficiency form links to its
//    stakeholder group and counts in the group's measure; a withdrawn one does not; a transformation target sums the
//    groups' numerators and denominators;
//  - REQ-PB-069 / REQ-PB-071 A11 "an actual below trajectory creates a corrective intervention": an accepted adoption
//    actual below its approved trajectory (red, adverse, through the real accept and recalculation pipeline) creates
//    exactly one corrective intervention through the worker consumer, with one adoption.check_failed; a redelivered
//    event and a second event for the same KPI, scope and period create none; a green evaluation creates none;
//  - D-102 item 2 parity: the worker twin of createBelowTrajectoryIntervention writes the same rows as BE-H's API
//    service for the same input.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import type { AdoptionMeasureValue } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBelowTrajectoryIntervention as workerCreateBelowTrajectoryIntervention,
  handleIndicatorEvaluated,
} from "../../../../worker/src/handlers/adoption.ts";
import { createBelowTrajectoryIntervention as apiCreateBelowTrajectoryIntervention } from "../../../src/modules/adoption/interventions.ts";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  approvedTrajectory,
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  submitActual,
} from "../kpi-p4/kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
let admin: Session;
let LINKS: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
  LINKS = `${b.base}/adoption-metric-links`;
}, 120_000);
afterAll(async () => {
  await api.close();
});

async function group(base: string, session: Session, ownerUserId: string, name: string): Promise<string> {
  const g = await call(api.app, "POST", `${base}/stakeholder-groups`, {
    session,
    body: {
      name,
      impact: "H",
      currentStance: "neutral",
      requiredBehavior: "Synthetic: use the new journey",
      interventionTypes: ["training"],
      ownerUserId,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  return g.body.id;
}

// ------------------------------------------------------------------------------------------------ templates

const SEVEN = [
  "Usage / activation rate",
  "Compliance with new process",
  "Cycle-time shift",
  "Training completion + observed proficiency",
  "Decision turnaround time",
  "Percentage of transactions handled through the new journey",
  "Exception / workaround rate",
];

describe("listAdoptionIndicatorTemplates (REQ-PB-071 A11: all seven indicators are available by name)", () => {
  it("returns the seven B0109-B0115 indicators verbatim, indicator 4 with two measures, to any signed-in user", async () => {
    for (const session of [b.s.tl, b.s.auditor, admin, b.s.outsider]) {
      const res = await call(api.app, "GET", "/api/v1/adoption-indicator-templates", { session });
      expect(res.status).toBe(200);
      const items = res.body.items as { sourceIndicatorEn: string; measureEn: string; indicatorOrdinal: number }[];
      expect([...new Set(items.map((t) => t.sourceIndicatorEn))]).toEqual(SEVEN);
      expect(items.filter((t) => t.indicatorOrdinal === 4).map((t) => t.measureEn)).toEqual([
        "Training completion",
        "Observed proficiency",
      ]);
      expect(items.every((t) => (t as unknown as { arProvisional: boolean }).arProvisional)).toBe(true);
    }
    expect(res4(await call(api.app, "GET", "/api/v1/adoption-indicator-templates"))).toBe(401);
  });
});
const res4 = (r: { status: number }) => r.status;

// ------------------------------------------------------------------------------------------------ metric links

describe("adoption metric links (REQ-S16-020 AdoptionMetricLink; ADR-0033 §3, §9, §10)", () => {
  let groupId: string;
  beforeAll(async () => {
    groupId = await group(b.base, b.s.tl, b.users.bo.id, "Synthetic retail agents");
  });

  it("createKpi creates the KPI from the template in the same transaction (is_leading, unit, polarity, owner)", async () => {
    const res = await call(api.app, "POST", LINKS, {
      session: b.s.tl,
      body: {
        templateKey: "usage_activation_rate",
        targetKind: "stakeholder_group",
        targetId: groupId,
        createKpi: true,
        kpiOwnerUserId: b.users.bo.id,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    expect(res.body).toMatchObject({
      templateKey: "usage_activation_rate",
      targetKind: "stakeholder_group",
      targetId: groupId,
      status: "active",
      version: 1,
      createdBy: b.users.tl.id,
    });
    const kpi = await api.db
      .selectFrom("kpi_definition")
      .selectAll()
      .where("id", "=", res.body.kpiDefinitionId)
      .executeTakeFirstOrThrow();
    expect(kpi).toMatchObject({
      transformation_id: b.transformationId,
      name: "Usage / activation rate",
      is_leading: true,
      unit_kind: "percentage",
      polarity: "higher_is_better",
      owner_user_id: b.users.bo.id,
      status: "draft",
    });
    const linkAudit = await auditOf(api.db, res.body.id);
    const kpiAudit = await auditOf(api.db, kpi.id);
    expect(linkAudit.map((a) => [a.action, a.actor_user_id])).toEqual([["adoption_metric_link.create", b.users.tl.id]]);
    expect(kpiAudit.map((a) => a.action)).toEqual(["kpi_definition.create"]);
    expect(kpiAudit[0]!.request_id).toBe(linkAudit[0]!.request_id);
  });

  it("each §10 refusal with its exact text, before any write", async () => {
    const post = (body: object, session: Session = b.s.tl) => call(api.app, "POST", LINKS, { session, body });
    const expectRule = (
      r: { status: number; body: { code?: string; detail?: string; errors?: { pointer: string }[] } },
      status: number,
      code: string,
      detail: string,
      pointer?: string,
    ) => {
      expect([r.status, r.body.code, r.body.detail]).toEqual([status, code, detail]);
      if (pointer !== undefined) expect(r.body.errors?.[0]?.pointer).toBe(pointer);
    };
    expectRule(
      await post({ templateKey: "process_compliance_rate", targetKind: "transformation" }),
      422,
      "adoption_metric_link.kpi_required",
      "This indicator is measured by a KPI: name a KPI or create one from the template.",
      "/kpiDefinitionId",
    );
    expectRule(
      await post({
        templateKey: "training_completion",
        targetKind: "transformation",
        kpiDefinitionId: b.kpiDefinitionId,
      }),
      422,
      "adoption_metric_link.kpi_not_applicable",
      "This measure is computed from training or assessment records and takes no KPI.",
      "/kpiDefinitionId",
    );
    const kpiUnit = await api.db
      .selectFrom("kpi_definition")
      .select(["unit_kind", "polarity"])
      .where("id", "=", b.kpiDefinitionId)
      .executeTakeFirstOrThrow();
    expect(kpiUnit.unit_kind === "percentage" && kpiUnit.polarity === "higher_is_better").toBe(false);
    expectRule(
      await post({
        templateKey: "usage_activation_rate",
        targetKind: "transformation",
        kpiDefinitionId: b.kpiDefinitionId,
      }),
      422,
      "adoption_metric_link.kpi_mismatch",
      "The KPI's unit and polarity must match the indicator template.",
      "/kpiDefinitionId",
    );
    expectRule(
      await post({
        templateKey: "usage_activation_rate",
        targetKind: "stakeholder_group",
        targetId: groupId,
        createKpi: true,
        kpiOwnerUserId: b.users.bo.id,
      }),
      409,
      "adoption_metric_link.exists",
      "This indicator is already attached to this target.",
    );
    // A target of another transformation: no disclosure, a reference error.
    const foreign = await group(other.base, other.s.tl, other.users.bo.id, "Synthetic foreign group");
    const r = await post({ templateKey: "training_completion", targetKind: "stakeholder_group", targetId: foreign });
    expect([r.status, r.body.code, r.body.errors[0].pointer]).toEqual([422, "validation.reference", "/targetId"]);
    const missing = await post({ templateKey: "training_completion", targetKind: "stakeholder_group" });
    expect([missing.status, missing.body.errors[0].pointer]).toEqual([400, "/targetId"]);
    const unknownTemplate = await post({ templateKey: "happiness_index", targetKind: "transformation" });
    expect([unknownTemplate.status, unknownTemplate.body.errors[0].pointer]).toEqual([422, "/templateKey"]);
    // The KPI name of a template is taken by the first createKpi: slice A's 409, unchanged.
    const taken = await post({
      templateKey: "usage_activation_rate",
      targetKind: "transformation",
      createKpi: true,
      kpiOwnerUserId: b.users.bo.id,
    });
    expect([taken.status, taken.body.code]).toEqual([409, "duplicate.name"]);
    // An archived group takes no new link.
    const archivedId = await group(b.base, b.s.tl, b.users.bo.id, "Synthetic archived group");
    const archived = await call(api.app, "POST", `${b.base}/stakeholder-groups/${archivedId}/archive`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic: merged into another group" },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expectRule(
      await post({ templateKey: "training_completion", targetKind: "stakeholder_group", targetId: archivedId }),
      422,
      "stakeholder_group.archived",
      "This stakeholder group is archived and can no longer be changed.",
    );
    const links = await api.db
      .selectFrom("adoption_metric_link")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .execute();
    expect(links).toHaveLength(1);
  });

  it("AUD is read-only (403 on writes), ADM-only and outsiders get 404, reads succeed in scope", async () => {
    const body = { templateKey: "training_completion", targetKind: "transformation" };
    expect((await call(api.app, "POST", LINKS, { session: b.s.auditor, body })).status).toBe(403);
    expect((await call(api.app, "POST", LINKS, { session: admin, body })).status).toBe(404);
    expect((await call(api.app, "POST", LINKS, { session: b.s.outsider, body })).status).toBe(404);
    expect((await call(api.app, "GET", LINKS, { session: b.s.auditor })).status).toBe(200);
    expect((await call(api.app, "GET", LINKS, { session: admin })).status).toBe(404);
    expect((await call(api.app, "GET", LINKS, { session: b.s.outsider })).status).toBe(404);
    expect(
      (await call(api.app, "GET", `${b.base}/adoption-indicators?targetKind=transformation`, { session: admin }))
        .status,
    ).toBe(404);
  });

  it("re-checks authorisation at commit time: a grant revoked meanwhile is 403 and writes nothing", async () => {
    const u = await extraUser(api, w, b, "WL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", LINKS, {
          session: u.session,
          body: { templateKey: "observed_proficiency", targetKind: "transformation" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const n = await api.db
      .selectFrom("adoption_metric_link")
      .select("id")
      .where("transformation_id", "=", b.transformationId)
      .where("template_key", "=", "observed_proficiency")
      .execute();
    expect(n).toHaveLength(0);
  });

  it("removal needs If-Match (428/409), is audited, final (422), and a new link may then be attached", async () => {
    const created = await call(api.app, "POST", LINKS, {
      session: b.s.bo,
      body: { templateKey: "training_completion", targetKind: "transformation" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ kpiDefinitionId: null, targetId: b.transformationId });
    const REMOVE = `${LINKS}/${created.body.id}/remove`;
    expect((await call(api.app, "POST", REMOVE, { session: b.s.tl })).status).toBe(428);
    expect((await call(api.app, "POST", REMOVE, { session: b.s.tl, headers: ifm(7) })).status).toBe(409);
    expect((await call(api.app, "POST", REMOVE, { session: b.s.auditor, headers: ifm(1) })).status).toBe(403);
    const removed = await call(api.app, "POST", REMOVE, { session: b.s.tl, headers: ifm(1) });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ status: "removed", version: 2, removedBy: b.users.tl.id });
    expect(removed.headers.etag).toBe('"2"');
    const again = await call(api.app, "POST", REMOVE, { session: b.s.tl, headers: ifm(2) });
    expect([again.status, again.body.detail]).toEqual([422, "This metric link is already removed."]);
    expect((await auditOf(api.db, created.body.id)).map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["adoption_metric_link.create", null, 1],
      ["adoption_metric_link.remove", 1, 2],
    ]);
    const reattached = await call(api.app, "POST", LINKS, {
      session: b.s.tl,
      body: { templateKey: "training_completion", targetKind: "transformation", targetId: b.transformationId },
    });
    expect(reattached.status).toBe(201);
    const list = await call(api.app, "GET", `${LINKS}?targetKind=transformation&targetId=${b.transformationId}`, {
      session: b.s.auditor,
    });
    expect(list.body.items.map((l: { status: string }) => l.status).sort()).toEqual(["active", "removed"]);
    const unknown = await call(api.app, "POST", `${LINKS}/${uuidv7()}/remove`, { session: b.s.tl, headers: ifm(1) });
    expect(unknown.status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ record-fed measures

/** Inserts or updates a row with its audit event in one transaction (the p2 deferred audit guard), as BE-H2's API would. */
async function writeRow(
  db: Db,
  actorUserId: string,
  table: string,
  values: Record<string, unknown>,
  ids: { organizationId: string; transformationId: string },
  update?: { id: string; set: Record<string, unknown>; priorVersion: number },
): Promise<string> {
  return db.transaction().execute(async (tx) => {
    const actor = { actorType: "user", actorUserId, requestId: `test-${uuidv7()}`, source: "api" } as const;
    if (update) {
      await sql`UPDATE ${sql.table(table)} SET ${sql.join(
        [
          ...Object.entries(update.set).map(([k, v]) => sql`${sql.ref(k)} = ${v}`),
          sql`version = version + 1`,
          sql`updated_at = now()`,
        ],
        sql`, `,
      )} WHERE id = ${update.id}::uuid`.execute(tx);
      await insertAuditEvent(tx, actor, {
        action: `${table}.update`,
        recordType: table,
        recordId: update.id,
        organizationId: ids.organizationId,
        transformationId: ids.transformationId,
        priorVersion: update.priorVersion,
        newVersion: update.priorVersion + 1,
      });
      return update.id;
    }
    const id = uuidv7();
    const row = { id, organization_id: ids.organizationId, transformation_id: ids.transformationId, ...values };
    const cols = Object.keys(row);
    await sql`INSERT INTO ${sql.table(table)} (${sql.join(cols.map((c) => sql.ref(c)))}) VALUES (${sql.join(
      cols.map((c) => sql`${(row as Record<string, unknown>)[c]}`),
    )})`.execute(tx);
    const versioned = table !== "assessment_form_version";
    await insertAuditEvent(tx, actor, {
      action: `${table}.create`,
      recordType: table,
      recordId: id,
      organizationId: ids.organizationId,
      transformationId: ids.transformationId,
      newVersion: versioned ? 1 : null,
    });
    return id;
  });
}

const PROF_SCHEMA = {
  questions: [
    {
      key: "uses_new_journey",
      type: "yes_no",
      label_en: "Handles the case end to end in the new journey",
      label_ar: "ينجز الحالة بالكامل عبر الرحلة الجديدة",
      required: true,
      proficiency: true,
    },
  ],
};

describe("getAdoptionIndicators: training completion and observed proficiency (REQ-PB-072, REQ-S11-002; ADR-0033 §6)", () => {
  let g1: string;
  let g2: string;
  let period: { id: string; start: string; end: string };
  let form: { f: string; v: string };
  const ids = () => ({ organizationId: b.organizationId, transformationId: b.transformationId });
  const report = async (q: string, session: Session = b.s.auditor) => {
    const r = await call(api.app, "GET", `${b.base}/adoption-indicators?${q}&reportingPeriodId=${period.id}`, {
      session,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return Object.fromEntries((r.body.measures as { templateKey: string }[]).map((m) => [m.templateKey, m])) as Record<
      string,
      AdoptionMeasureValue
    >;
  };
  async function training(groupId: string, completedOn: string | null, label: string): Promise<void> {
    const id = await writeRow(
      api.db,
      b.users.bo.id,
      "training_record",
      {
        stakeholder_group_id: groupId,
        participant_label: label,
        training_title: "Synthetic new-journey basics",
        created_by: b.users.bo.id,
        updated_by: b.users.bo.id,
      },
      ids(),
    );
    if (completedOn !== null)
      await writeRow(api.db, b.users.bo.id, "training_record", {}, ids(), {
        id,
        set: { status: "completed", completed_on: completedOn, recorded_by: b.users.bo.id },
        priorVersion: 1,
      });
  }
  async function observation(
    groupId: string,
    subject: string,
    proficient: boolean,
    observedOn: string,
  ): Promise<string> {
    return writeRow(
      api.db,
      b.users.bo.id,
      "assessment_record",
      {
        form_id: form.f,
        form_version_id: form.v,
        stakeholder_group_id: groupId,
        kind: "proficiency_observation",
        respondent_user_id: b.users.bo.id,
        subject_label: subject,
        observed_on: observedOn,
        answers: JSON.stringify({ uses_new_journey: proficient }),
        proficiency_result: proficient ? "proficient" : "not_yet_proficient",
        created_by: b.users.bo.id,
        updated_by: b.users.bo.id,
      },
      ids(),
    );
  }

  beforeAll(async () => {
    g1 = await group(b.base, b.s.tl, b.users.bo.id, "Synthetic branch tellers");
    g2 = await group(b.base, b.s.tl, b.users.bo.id, "Synthetic call-centre agents");
    period = await monthlyPeriod(api, w);
    // A published proficiency-assessment form (BE-H2's publish path, written here with its audit events).
    const f = await writeRow(
      api.db,
      b.users.bo.id,
      "assessment_form",
      {
        kind: "proficiency_assessment",
        name: "Synthetic proficiency check",
        created_by: b.users.bo.id,
        updated_by: b.users.bo.id,
      },
      ids(),
    );
    const v = await writeRow(
      api.db,
      b.users.bo.id,
      "assessment_form_version",
      {
        form_id: f,
        version_no: 1,
        schema: JSON.stringify(PROF_SCHEMA),
        created_by: b.users.bo.id,
      },
      ids(),
    );
    await writeRow(api.db, b.users.bo.id, "assessment_form", {}, ids(), {
      id: f,
      set: { current_version_no: 1 },
      priorVersion: 1,
    });
    await writeRow(api.db, b.users.bo.id, "assessment_form", {}, ids(), {
      id: f,
      set: {
        status: "published",
        published_version_no: 1,
        published_at: new Date().toISOString(),
        published_by: b.users.bo.id,
      },
      priorVersion: 2,
    });
    form = { f, v };
  }, 60_000);

  it("REQ-PB-072 A11: 100% training completion with no proficiency observations → proficiency Unknown, value null, not adopted", async () => {
    const mid = `${period.start.slice(0, 8)}15`;
    await training(g1, mid, "Synthetic teller 1");
    await training(g1, mid, "Synthetic teller 2");
    const m = await report(`targetKind=stakeholder_group&targetId=${g1}`);
    expect(m["training_completion"]).toEqual({
      templateKey: "training_completion",
      metricLinkId: null,
      kpiDefinitionId: null,
      value: "1.000000",
      valueStatus: "ok",
      valueReason: null,
      calculatedRag: null,
      trajectoryValue: null,
      numerator: 2,
      denominator: 2,
    });
    expect(m["observed_proficiency"]).toEqual({
      templateKey: "observed_proficiency",
      metricLinkId: null,
      kpiDefinitionId: null,
      value: null,
      valueStatus: "unknown",
      valueReason: "adoption.no_proficiency_observations",
      calculatedRag: null,
      trajectoryValue: null,
      numerator: 0,
      denominator: 0,
    });
    // A group without any training record: completion is Unknown too, never 0.
    const empty = await report(`targetKind=stakeholder_group&targetId=${g2}`);
    expect(empty["training_completion"]).toMatchObject({
      value: null,
      valueStatus: "unknown",
      valueReason: "adoption.no_training_records",
    });
  });

  it("REQ-S11-002 A11: an observation submitted via the form links to the group and counts in the proficiency measure", async () => {
    const mid = `${period.start.slice(0, 8)}10`;
    const late = `${period.start.slice(0, 8)}20`;
    const first = await observation(g1, "Synthetic teller 1", false, mid);
    await observation(g1, "Synthetic teller 1", true, late); // the latest observation of teller 1 decides
    await observation(g1, "synthetic TELLER 2 ", false, mid); // same subject as "Synthetic teller 2" (case-folded)
    const withdrawn = await observation(g1, "Synthetic teller 3", true, mid);
    await writeRow(api.db, b.users.bo.id, "assessment_record", {}, ids(), {
      id: withdrawn,
      set: {
        status: "withdrawn",
        withdrawn_at: new Date().toISOString(),
        withdrawn_by: b.users.bo.id,
        withdraw_reason: "Synthetic: wrong person",
      },
      priorVersion: 1,
    });
    const linked = await api.db
      .selectFrom("assessment_record")
      .select("stakeholder_group_id")
      .where("id", "=", first)
      .executeTakeFirstOrThrow();
    expect(linked.stakeholder_group_id).toBe(g1);
    const m = await report(`targetKind=stakeholder_group&targetId=${g1}`);
    expect(m["observed_proficiency"]).toMatchObject({
      value: "0.500000",
      valueStatus: "ok",
      numerator: 1,
      denominator: 2,
    });
    // Training completion is unchanged by observations (two separate measures).
    expect(m["training_completion"]).toMatchObject({ value: "1.000000", numerator: 2, denominator: 2 });
  });

  it("a transformation target sums numerators and denominators over the active groups (weighted ratio), never averages", async () => {
    const mid = `${period.start.slice(0, 8)}12`;
    await training(g2, null, "Synthetic agent 1");
    await training(g2, null, "Synthetic agent 2");
    // g1 2/2, g2 0/2 → 2/4 = 0.5 (the unweighted mean would also be 0.5; add a third g2 record to separate them).
    await training(g2, mid, "Synthetic agent 3");
    const m = await report("targetKind=transformation");
    expect(m["training_completion"]).toMatchObject({ value: "0.600000", numerator: 3, denominator: 5 });
    expect(m["observed_proficiency"]).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("an unknown period is 404, a group target without targetId is 400, the AUD user reads", async () => {
    const r = await call(
      api.app,
      "GET",
      `${b.base}/adoption-indicators?targetKind=transformation&reportingPeriodId=${uuidv7()}`,
      {
        session: b.s.tl,
      },
    );
    expect(r.status).toBe(404);
    const missing = await call(api.app, "GET", `${b.base}/adoption-indicators?targetKind=stakeholder_group`, {
      session: b.s.tl,
    });
    expect(missing.status).toBe(400);
    const foreign = await call(
      api.app,
      "GET",
      `${b.base}/adoption-indicators?targetKind=stakeholder_group&targetId=${uuidv7()}`,
      {
        session: b.s.tl,
      },
    );
    expect(foreign.status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ below trajectory

describe("below trajectory → exactly one corrective intervention (REQ-PB-069, REQ-PB-071 A11; ADR-0033 §4)", () => {
  let k: KpiWorld;
  let kw: World;
  let kpi: { id: string; name: string };
  let green: { id: string; name: string };
  let groupId: string;
  let linkId: string;
  let p1: { id: string; start: string; end: string };

  async function deviationEnvelope(evaluationId: string) {
    const r = await api.db
      .selectFrom("outbox_event")
      .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
      .where("event_type", "=", "kpi.deviation_evaluated")
      .where("aggregate_id", "=", evaluationId)
      .executeTakeFirstOrThrow();
    return {
      outboxEventId: r.id,
      eventType: r.event_type,
      schemaVersion: r.schema_version,
      idempotencyKey: r.idempotency_key,
      organizationId: r.organization_id,
      payload: r.payload as Record<string, unknown>,
    };
  }
  const evaluationOf = (kpiId: string) =>
    api.db
      .selectFrom("kpi_evaluation")
      .select(["id", "calculated_rag", "deviation", "expected_value", "value"])
      .where("kpi_definition_id", "=", kpiId)
      .where("reporting_period_id", "=", p1.id)
      .where("value_basis", "=", "period")
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    kw = await seedWorld(api.db);
    k = await seedKpiWorld(api, kw);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    p1 = await monthlyPeriod(api, kw);
    const pct = { unitKind: "percentage", unitLabel: null, polarity: "higher_is_better" };
    kpi = await ownedKpi(api, k, DIRECT_FLOW, pct as never);
    green = await ownedKpi(api, k, DIRECT_FLOW, pct as never);
    for (const id of [kpi.id, green.id])
      await approvedTrajectory(api, k, id, [{ pointDate: p1.end, expectedValue: "0.8" }]);
    groupId = await group(k.base, k.s.tl, k.users.bo.id, "Synthetic app users");
    const link = await call(api.app, "POST", `${k.base}/adoption-metric-links`, {
      session: k.s.tl,
      body: {
        templateKey: "usage_activation_rate",
        targetKind: "stakeholder_group",
        targetId: groupId,
        kpiDefinitionId: kpi.id,
      },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    linkId = link.body.id;
    const greenLink = await call(api.app, "POST", `${k.base}/adoption-metric-links`, {
      session: k.s.tl,
      body: { templateKey: "new_journey_share", targetKind: "transformation", kpiDefinitionId: green.id },
    });
    expect(greenLink.status, JSON.stringify(greenLink.body)).toBe(201);
    for (const [id, value] of [
      [kpi.id, "0.4"],
      [green.id, "0.9"],
    ] as const) {
      const res = await submitActual(api, k, id, { reportingPeriodId: p1.id, value });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [run] = await runRecalculation(api, res.body.actual.id);
      expect(run).toMatchObject({ outcome: "done" });
    }
  }, 180_000);

  it("an accepted adoption actual below trajectory (red, adverse) creates exactly one intervention; a redelivery creates none", async () => {
    const e = await evaluationOf(kpi.id);
    expect([e.calculated_rag, e.deviation]).toEqual(["red", "adverse"]);
    const envelope = await deviationEnvelope(e.id);
    const first = await handleIndicatorEvaluated(api.db, envelope, "test-job-1");
    expect(first.outcome).toBe("evaluated");
    expect(first.interventions).toHaveLength(1);
    expect(first.interventions[0]).toMatchObject({ outcome: "created", metricLinkId: linkId });
    // Redelivered event: the processed_message ledger makes it a no-op.
    expect(await handleIndicatorEvaluated(api.db, envelope, "test-job-2")).toEqual({
      outcome: "duplicate",
      interventions: [],
    });
    // A second evaluation event for the same KPI, scope and period (another run, another idempotency key): none.
    const second = await handleIndicatorEvaluated(
      api.db,
      { ...envelope, idempotencyKey: `${envelope.idempotencyKey}:rerun` },
      "test-job-3",
    );
    expect(second.interventions.map((i) => i.outcome)).toEqual(["existing"]);
    const rows = await api.db
      .selectFrom("adoption_intervention")
      .selectAll()
      .where("metric_link_id", "=", linkId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: "below_trajectory",
      intervention_type: "corrective",
      created_source: "worker",
      created_by: null,
      title: kpi.name,
      stakeholder_group_id: groupId,
      owner_user_id: k.users.bo.id,
      kpi_evaluation_id: e.id,
      reporting_period_id: p1.id,
      status: "planned",
    });
    const checks = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key", "payload"])
      .where("aggregate_id", "=", rows[0]!.id)
      .execute();
    expect(checks.map((c) => [c.event_type, c.idempotency_key])).toEqual([
      ["adoption.check_failed", `adoption.check_failed:${rows[0]!.id}`],
    ]);
    expect(checks[0]!.payload).toMatchObject({
      checkId: rows[0]!.id,
      checkRecordType: "adoption_intervention",
      subjectLabel: kpi.name,
    });
    const audit = await auditOf(api.db, rows[0]!.id);
    expect(audit.map((a) => [a.action, a.actor_type, a.actor_user_id])).toEqual([
      ["adoption_intervention.create", "service", null],
    ]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id"])
      .where("subject_type", "=", "adoption_intervention")
      .where("subject_id", "=", rows[0]!.id)
      .execute();
    expect(items).toEqual([{ kind: "adoption_intervention_due", assignee_user_id: k.users.bo.id }]);
  });

  it("a green evaluation creates none", async () => {
    const e = await evaluationOf(green.id);
    expect(e.calculated_rag).toBe("green");
    const r = await handleIndicatorEvaluated(api.db, await deviationEnvelope(e.id), "test-job-green");
    expect(r).toEqual({ outcome: "not_below_trajectory", interventions: [] });
    const rows = await api.db
      .selectFrom("adoption_intervention")
      .select("id")
      .where("transformation_id", "=", k.transformationId)
      .where("origin", "=", "below_trajectory")
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("the indicator report shows the KPI-fed measure with slice A's value, RAG and expected-to-date value", async () => {
    const r = await call(
      api.app,
      "GET",
      `${k.base}/adoption-indicators?targetKind=stakeholder_group&targetId=${groupId}&reportingPeriodId=${p1.id}`,
      { session: k.s.auditor },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.measures[0]).toEqual({
      templateKey: "usage_activation_rate",
      metricLinkId: linkId,
      kpiDefinitionId: kpi.id,
      value: "0.4",
      valueStatus: "ok",
      valueReason: null,
      calculatedRag: "red",
      trajectoryValue: "0.8",
      numerator: null,
      denominator: null,
    });
  });

  it("D-102 parity: the worker twin writes the same rows as BE-H's API service for the same input", async () => {
    const e = await evaluationOf(kpi.id);
    const envelope = await deviationEnvelope(e.id);
    const ev = await api.db
      .selectFrom("outbox_event")
      .select("created_at")
      .where("id", "=", envelope.outboxEventId)
      .executeTakeFirstOrThrow();
    const evaluatedAt = (
      await api.db.selectFrom("kpi_evaluation").select("evaluated_at").where("id", "=", e.id).executeTakeFirstOrThrow()
    ).evaluated_at;
    // Two further links of the same KPI on two new groups with the same owner: one through each path.
    const linkFor = async (name: string) => {
      const g = await group(k.base, k.s.tl, k.users.bo.id, name);
      const l = await call(api.app, "POST", `${k.base}/adoption-metric-links`, {
        session: k.s.tl,
        body: {
          templateKey: "process_compliance_rate",
          targetKind: "stakeholder_group",
          targetId: g,
          kpiDefinitionId: kpi.id,
        },
      });
      expect(l.status, JSON.stringify(l.body)).toBe(201);
      return { link: l.body.id as string, group: g };
    };
    const a = await linkFor("Synthetic parity group A");
    const w2 = await linkFor("Synthetic parity group B");
    const service = { actorType: "service", actorUserId: null, requestId: "job:parity", source: "worker" } as const;
    const input = (metricLinkId: string) => ({
      actor: service,
      metricLinkId,
      kpiEvaluationId: e.id,
      reportingPeriodId: p1.id,
      scopeKind: "transformation" as const,
      scopeId: k.transformationId,
      eventCreatedAt: ev.created_at,
      failedAt: evaluatedAt,
    });
    const viaApi = await api.db.transaction().execute((tx) => apiCreateBelowTrajectoryIntervention(tx, input(a.link)));
    const viaWorker = await api.db
      .transaction()
      .execute((tx) => workerCreateBelowTrajectoryIntervention(tx, input(w2.link)));
    expect([viaApi.outcome, viaWorker.outcome]).toEqual(["created", "created"]);
    const ia = (viaApi as { interventionId: string }).interventionId;
    const iw = (viaWorker as { interventionId: string }).interventionId;
    const subst = (v: unknown, map: Record<string, string>): unknown =>
      JSON.parse(Object.entries(map).reduce((s, [from, to]) => s.split(from).join(to), JSON.stringify(v)));
    const snapshot = async (iid: string, l: { link: string; group: string }) => {
      const iv = await api.db
        .selectFrom("adoption_intervention")
        .selectAll()
        .where("id", "=", iid)
        .executeTakeFirstOrThrow();
      const { id: _i, code: _c, created_at: _ca, updated_at: _ua, ...ivRest } = iv;
      const wi = await api.db.selectFrom("work_item").selectAll().where("subject_id", "=", iid).execute();
      const wiRest = wi.map(({ id: _x, created_at: _y, updated_at: _z, message_params: _m, ...r }) => r);
      const audit = await api.db.selectFrom("audit_event").selectAll().where("record_id", "=", iid).execute();
      const auditRest = audit.map((r) => ({
        action: r.action,
        actor_type: r.actor_type,
        actor_user_id: r.actor_user_id,
        source: r.source,
        new_version: r.new_version,
        changes: r.changes,
      }));
      const ob = await api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", iid).execute();
      const obRest = ob.map((r) => ({
        event_type: r.event_type,
        aggregate_type: r.aggregate_type,
        schema_version: r.schema_version,
        idempotency_key: r.idempotency_key,
        payload: r.payload,
      }));
      return subst(
        { ivRest, wiRest, auditRest, obRest },
        { [iid]: "<intervention>", [l.link]: "<link>", [l.group]: "<group>", [iv.code]: "<code>" },
      );
    };
    expect(await snapshot(iw, w2)).toEqual(await snapshot(ia, a));
    // The same trigger again through the other path: existing, nothing written.
    expect(
      (await api.db.transaction().execute((tx) => workerCreateBelowTrajectoryIntervention(tx, input(a.link)))).outcome,
    ).toBe("existing");
    expect(
      (await api.db.transaction().execute((tx) => apiCreateBelowTrajectoryIntervention(tx, input(w2.link)))).outcome,
    ).toBe("existing");
  });
});
