// The four separate statuses and the status models (T-DG4-BE-J; ADR-0034 §1, §2, §9, §12; REQ-S03-003, REQ-PB-009,
// REQ-S11-006, REQ-PB-069). Proves, against the run's disposable PostgreSQL:
//  - REQ-S03-003 A11: setting delivery to Complete (completeInitiativeDelivery, WL) leaves adoption, validated value and
//    closure unchanged (row and status model), stamps who and when, one audit event; only `launched` can complete
//    (422 initiative.delivery_not_launched, exact text); AUD/BO/TO 403, ADM-only and an outsider 404; If-Match 428/409;
//    commit-time authorization; S-1 free text on the note;
//  - setInitiativeAdoptionStatus (BO): the owner's assessment with note and stamps, delivery untouched; `not_assessed`
//    or an unknown value is 422 initiative.adoption_status_invalid at /adoptionStatus (exact text); WL/AUD 403;
//  - REQ-PB-009 A11: an initiative with delivery Complete and no validated benefit is labelled
//    "Delivered — value validation pending"; with a Finance-validated benefit "Delivered — value validated";
//  - REQ-S11-006 A11: with all initiatives complete and value pending the transformation label is
//    "Delivery complete - value validation pending"; no label ever says "successful";
//  - REQ-PB-069 A11 (with KBE-F's consumer): an initiative whose adoption indicator is below trajectory shows adoption
//    `at_risk` with adoptionSource "indicator", whatever the owner set; once the intervention is done, the owner's
//    status shows again with source "owner".
// All data is SYNTHETIC; the Finance validation of the fixture is a synthetic decision of test data, and nothing here
// is a real business approval or touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleIndicatorEvaluated } from "../../../../worker/src/handlers/adoption.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser } from "../benefits/fixtures.ts";
import {
  deliveredInitiative,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  validatedBenefit,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

let api: TestApi;
let w: World;
let c: ClosureWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const initiativeRow = (id: string) =>
  api.db.selectFrom("initiative").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const closuresOf = (id: string) =>
  api.db.selectFrom("closure_record").select("id").where("initiative_id", "=", id).execute();
const model = async (id: string) =>
  (await send("GET", `${c.status(id)}/status-model`, { session: c.b.s.auditor })).body;

describe("completeInitiativeDelivery (ADR-0034 §1; REQ-S03-003)", () => {
  it("delivery Complete leaves adoption, validated value and closure unchanged; stamped and audited", async () => {
    const id = await launchedInitiative(api.db, c.b);
    await pendingBenefit(api, c, id);
    const before = await model(id);
    expect([before.delivery, before.adoption, before.value, before.closure, before.label]).toEqual([
      "launched",
      "not_assessed",
      "validation_pending",
      "open",
      "In delivery",
    ]);
    const r = await send("POST", `${c.status(id)}/complete-delivery`, {
      session: c.s.wl.session,
      headers: ifm(1),
      body: { note: "Synthetic: all deliverables accepted" },
    });
    expect([r.status, r.headers.etag]).toEqual([200, '"2"']);
    expect([r.body.delivery, r.body.adoption, r.body.adoptionSource, r.body.value, r.body.closure]).toEqual([
      "completed",
      "not_assessed",
      "owner",
      "validation_pending",
      "open",
    ]);
    expect([r.body.deliveryCompletedBy, typeof r.body.deliveryCompletedAt]).toEqual([c.s.wl.id, "string"]);
    const row = await initiativeRow(id);
    expect([row.status, row.adoption_status, row.adoption_status_set_at, row.version]).toEqual([
      "completed",
      "not_assessed",
      null,
      2,
    ]);
    expect(await closuresOf(id)).toEqual([]);
    const audit = await auditOf(api.db, id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["initiative.create", null, 1],
      ["initiative.complete_delivery", 1, 2],
    ]);
    expect(audit[1]!.reason).toBe("Synthetic: all deliverables accepted");
  });

  it("only a launched initiative completes (422 initiative.delivery_not_launched, exact text); TL may too", async () => {
    const id = await launchedInitiative(api.db, c.b);
    const ok = await send("POST", `${c.status(id)}/complete-delivery`, {
      session: c.b.s.tl,
      headers: ifm(1),
      body: {},
    });
    expect(ok.status).toBe(200);
    const again = await send("POST", `${c.status(id)}/complete-delivery`, {
      session: c.b.s.tl,
      headers: ifm(2),
      body: {},
    });
    expect([again.status, again.body.type, again.body.code, again.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "initiative.delivery_not_launched",
      "Only a launched initiative can be marked delivery complete.",
    ]);
    expect((await initiativeRow(id)).version).toBe(2);
  });

  it("AUD, BO and TO 403; ADM-only and an outsider 404; If-Match 428/409; S-1 note; nothing written", async () => {
    const id = await launchedInitiative(api.db, c.b);
    const P = `${c.status(id)}/complete-delivery`;
    for (const session of [c.b.s.auditor, c.b.s.bo, c.s.to.session])
      expect((await send("POST", P, { session, headers: ifm(1), body: {} })).status).toBe(403);
    for (const session of [c.b.s.admin, c.b.s.outsider]) {
      expect((await send("POST", P, { session, headers: ifm(1), body: {} })).status).toBe(404);
      expect((await send("GET", `${c.status(id)}/status-model`, { session })).status).toBe(404);
    }
    expect((await send("GET", `/api/v1/initiatives/${randomUUID()}/status-model`, { session: c.b.s.tl })).status).toBe(
      404,
    );
    expect((await send("POST", P, { session: c.s.wl.session, body: {} })).status).toBe(428);
    const stale = await send("POST", P, { session: c.s.wl.session, headers: ifm(7), body: {} });
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const blank = await send("POST", P, { session: c.s.wl.session, headers: ifm(1), body: { note: "   " } });
    expect([blank.status, blank.body.errors[0].pointer]).toEqual([400, "/note"]);
    const extra = await send("POST", P, { session: c.s.wl.session, headers: ifm(1), body: { status: "completed" } });
    expect(extra.status).toBe(400);
    const row = await initiativeRow(id);
    expect([row.status, row.version]).toEqual(["launched", 1]);
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual(["initiative.create"]);
  });

  it("S-4: a WL revoked after the identity hook gets 403 at commit time and nothing is written", async () => {
    const wl2 = await extraUser(api, w, c.b, "WL");
    const id = await launchedInitiative(api.db, c.b);
    const res = await afterIdentity(
      api,
      wl2.id,
      () =>
        call(api.app, "POST", `${c.status(id)}/complete-delivery`, {
          session: wl2.session,
          headers: ifm(1),
          body: {},
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, wl2.id),
    );
    expect(res.status).toBe(403);
    expect((await initiativeRow(id)).status).toBe("launched");
  });
});

describe("setInitiativeAdoptionStatus (ADR-0034 §1; REQ-S03-003)", () => {
  it("BO sets on_track / at_risk / adopted with a note; stamped, audited; delivery untouched", async () => {
    const id = await launchedInitiative(api.db, c.b);
    const r = await send("POST", `${c.status(id)}/adoption-status`, {
      session: c.b.s.bo,
      headers: ifm(1),
      body: { adoptionStatus: "at_risk", note: "Synthetic: low usage in the pilot region" },
    });
    expect([r.status, r.body.adoption, r.body.adoptionSource, r.body.delivery, r.body.label]).toEqual([
      200,
      "at_risk",
      "owner",
      "launched",
      "In delivery",
    ]);
    const row = await initiativeRow(id);
    expect([row.adoption_status, row.adoption_status_note, row.adoption_status_set_by, row.status]).toEqual([
      "at_risk",
      "Synthetic: low usage in the pilot region",
      c.b.users.bo.id,
      "launched",
    ]);
    const second = await send("POST", `${c.status(id)}/adoption-status`, {
      session: c.b.s.bo,
      headers: ifm(2),
      body: { adoptionStatus: "adopted" },
    });
    expect([second.status, second.body.adoption]).toEqual([200, "adopted"]);
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual([
      "initiative.create",
      "initiative.set_adoption_status",
      "initiative.set_adoption_status",
    ]);
  });

  it("not_assessed or an unknown value: 422 initiative.adoption_status_invalid at /adoptionStatus; WL/AUD 403", async () => {
    const id = await launchedInitiative(api.db, c.b);
    const P = `${c.status(id)}/adoption-status`;
    for (const adoptionStatus of ["not_assessed", "hostile"]) {
      const r = await send("POST", P, { session: c.b.s.bo, headers: ifm(1), body: { adoptionStatus } });
      expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
        422,
        "initiative.adoption_status_invalid",
        "Adoption status must be On track, At risk or Adopted.",
        "/adoptionStatus",
      ]);
    }
    expect((await send("POST", P, { session: c.b.s.bo, headers: ifm(1), body: {} })).status).toBe(400);
    for (const session of [c.s.wl.session, c.b.s.auditor, c.b.s.tl])
      expect((await send("POST", P, { session, headers: ifm(1), body: { adoptionStatus: "on_track" } })).status).toBe(
        403,
      );
    expect(
      (await send("POST", P, { session: c.b.s.admin, headers: ifm(1), body: { adoptionStatus: "on_track" } })).status,
    ).toBe(404);
    expect((await send("POST", P, { session: c.b.s.bo, body: { adoptionStatus: "on_track" } })).status).toBe(428);
    expect((await initiativeRow(id)).adoption_status).toBe("not_assessed");
  });
});

describe("labels (ADR-0034 §2; REQ-PB-009, REQ-S11-006)", () => {
  it("REQ-PB-009: delivery Complete without a validated benefit is 'Delivered — value validation pending'", async () => {
    const none = await deliveredInitiative(api, c);
    expect([(await model(none)).value, (await model(none)).label]).toEqual([
      "no_benefit",
      "Delivered — value validation pending",
    ]);
    const pending = await deliveredInitiative(api, c);
    await pendingBenefit(api, c, pending);
    expect([(await model(pending)).value, (await model(pending)).label]).toEqual([
      "validation_pending",
      "Delivered — value validation pending",
    ]);
    const validated = await deliveredInitiative(api, c);
    await validatedBenefit(api, c, validated);
    expect([(await model(validated)).value, (await model(validated)).label]).toEqual([
      "validated",
      "Delivered — value validated",
    ]);
  }, 60_000);

  it("REQ-S11-006: all initiatives complete with value pending is 'Delivery complete - value validation pending'", async () => {
    const x = await seedClosureWorld(api, w);
    const T = `${x.b.base}/status-model`;
    const empty = await send("GET", T, { session: x.b.s.auditor });
    expect(empty.body).toEqual({
      transformationId: x.b.transformationId,
      deliveryState: "in_delivery",
      valueState: "no_benefit",
      bauState: "no_performance_area",
      closureState: "open",
      label: "In delivery",
      initiatives: { total: 0, completed: 0 },
      performanceAreas: { total: 0, bau: 0 },
    });
    const one = await deliveredInitiative(api, x);
    const two = await launchedInitiative(api.db, x.b);
    await pendingBenefit(api, x, one);
    const mid = await send("GET", T, { session: x.b.s.auditor });
    expect([mid.body.deliveryState, mid.body.label, mid.body.initiatives]).toEqual([
      "in_delivery",
      "In delivery",
      { total: 2, completed: 1 },
    ]);
    const done = await send("POST", `${x.status(two)}/complete-delivery`, {
      session: x.s.wl.session,
      headers: ifm(1),
      body: {},
    });
    expect(done.status).toBe(200);
    const all = await send("GET", T, { session: x.b.s.auditor });
    expect([
      all.body.deliveryState,
      all.body.valueState,
      all.body.bauState,
      all.body.closureState,
      all.body.label,
    ]).toEqual([
      "delivery_complete",
      "validation_pending",
      "no_performance_area",
      "open",
      "Delivery complete - value validation pending",
    ]);
    expect(JSON.stringify(all.body).toLowerCase()).not.toContain("success");
    for (const session of [x.b.s.admin, x.b.s.outsider]) expect((await send("GET", T, { session })).status).toBe(404);
  });
});

describe("adoption at risk from the indicator (ADR-0034 §2, ADR-0033 §1; REQ-PB-069)", () => {
  /** An adoption metric link targeting `initiativeId` and a red, adverse evaluation scoped to it, consumed by KBE-F. */
  async function belowTrajectory(initiativeId: string): Promise<string> {
    const b = c.b;
    const userId = b.users.bo.id;
    const kpiId = randomUUID();
    const versionId = randomUUID();
    const periodId = randomUUID();
    const linkId = randomUUID();
    const runId = randomUUID();
    const evaluationId = randomUUID();
    const outboxId = randomUUID();
    const month = String(1 + Math.floor(Math.random() * 9)).padStart(2, "0");
    const year = 2000 + Math.floor(Math.random() * 20);
    const actor = {
      actorType: "user" as const,
      actorUserId: userId,
      requestId: `fixture-${kpiId}`,
      source: "api" as const,
    };
    const payload = {
      evaluationId,
      transformationId: b.transformationId,
      kpiDefinitionId: kpiId,
      scopeKind: "initiative",
      scopeId: initiativeId,
      reportingPeriodId: periodId,
      calculatedRag: "red",
      deviation: "adverse",
      previousCalculatedRag: null,
    };
    await api.db.transaction().execute(async (tx) => {
      const audit = (recordType: string, recordId: string, action: string, withT = true) =>
        insertAuditEvent(tx, actor, {
          action,
          recordType,
          recordId,
          organizationId: b.organizationId,
          ...(withT ? { transformationId: b.transformationId } : {}),
          newVersion: 1,
        });
      await tx
        .insertInto("kpi_definition")
        .values({
          id: kpiId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          name: `Synthetic usage rate ${kpiId.slice(0, 8)}`,
          unit_kind: "percentage",
          polarity: "higher_is_better",
          is_leading: true,
          status: "active",
          owner_user_id: userId,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await audit("kpi_definition", kpiId, "kpi_definition.create");
      await tx
        .insertInto("kpi_version")
        .values({
          id: versionId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          kpi_definition_id: kpiId,
          version_no: 1,
          measure_type: "higher_is_better",
          value_nature: "ratio",
          unit_kind: "percentage",
          frequency: "monthly",
          aggregation_rule: "weighted_ratio",
          submission_route: "direct_accept",
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await audit("kpi_version", versionId, "kpi_version.create");
      await tx
        .insertInto("reporting_period")
        .values({
          id: periodId,
          organization_id: b.organizationId,
          frequency: "monthly",
          period_label: `${year}-${month}-${kpiId.slice(0, 4)}`,
          period_start: `${year}-${month}-01`,
          period_end: `${year}-${month}-28`,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await audit("reporting_period", periodId, "reporting_period.create", false);
      await tx
        .insertInto("adoption_metric_link")
        .values({
          id: linkId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          template_key: "usage_activation_rate",
          kpi_definition_id: kpiId,
          target_kind: "initiative",
          initiative_id: initiativeId,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await audit("adoption_metric_link", linkId, "adoption_metric_link.create");
      await tx
        .insertInto("calculation_run")
        .values({
          id: runId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          trigger_kind: "actual_accepted",
          trigger_record_type: "kpi_actual",
          trigger_record_id: randomUUID(),
          trigger_slot: 1,
          idempotency_key: `test-run:${runId}`,
          status: "completed",
          evaluation_count: 1,
          formula_engine_version: "synthetic",
          kpi_rules_version: "mth-kpi/1.0.0",
          started_at: sql<Date>`now()`,
        })
        .execute();
      await tx
        .insertInto("kpi_evaluation")
        .values({
          id: evaluationId,
          organization_id: b.organizationId,
          transformation_id: b.transformationId,
          calculation_run_id: runId,
          kpi_definition_id: kpiId,
          kpi_version_id: versionId,
          scope_kind: "initiative",
          scope_id: initiativeId,
          reporting_period_id: periodId,
          period_label: "P1",
          value_basis: "period",
          value: "0.400000",
          value_status: "ok",
          value_reason: null,
          value_source: "entered",
          trend: "unknown",
          calculated_rag: "red",
          deviation: "adverse",
          threshold_source: "default",
          explanation_key: "kpi.rag.synthetic",
        })
        .execute();
      await tx
        .insertInto("outbox_event")
        .values({
          id: outboxId,
          organization_id: b.organizationId,
          aggregate_type: "kpi_evaluation",
          aggregate_id: evaluationId,
          event_type: "kpi.deviation_evaluated",
          schema_version: 1,
          idempotency_key: `kpi.deviation_evaluated:${evaluationId}`,
          payload: JSON.stringify(payload),
        })
        .execute();
    });
    const r = await handleIndicatorEvaluated(
      api.db,
      {
        outboxEventId: outboxId,
        eventType: "kpi.deviation_evaluated",
        schemaVersion: 1,
        idempotencyKey: `kpi.deviation_evaluated:${evaluationId}`,
        organizationId: b.organizationId,
        payload,
      },
      `test-${outboxId}`,
    );
    expect(r.outcome).toBe("evaluated");
    expect(r.interventions).toHaveLength(1);
    return (r.interventions[0] as { interventionId: string }).interventionId;
  }

  it("delivery Complete and adoption below trajectory: adoption at_risk with adoptionSource 'indicator'", async () => {
    const id = await deliveredInitiative(api, c);
    const set = await send("POST", `${c.status(id)}/adoption-status`, {
      session: c.b.s.bo,
      headers: ifm(2),
      body: { adoptionStatus: "adopted" },
    });
    expect([set.body.adoption, set.body.adoptionSource]).toEqual(["adopted", "owner"]);
    const interventionId = await belowTrajectory(id);
    const m = await model(id);
    expect([m.adoption, m.adoptionSource, m.delivery, m.label]).toEqual([
      "at_risk",
      "indicator",
      "completed",
      "Delivered — value validation pending",
    ]);
    // The indicator triggered exactly one intervention for this initiative (KBE-F's consumer, REQ-PB-069).
    const ivs = await api.db
      .selectFrom("adoption_intervention")
      .select("id")
      .where("scope_kind", "=", "initiative")
      .where("scope_id", "=", id)
      .execute();
    expect(ivs.map((x) => x.id)).toEqual([interventionId]);
    // The stored owner status is untouched: the indicator signal is derived, never written.
    expect((await initiativeRow(id)).adoption_status).toBe("adopted");
    // Once the corrective intervention is done the owner's assessment shows again.
    const iv = await api.db
      .selectFrom("adoption_intervention")
      .select(["version", "owner_user_id"])
      .where("id", "=", interventionId)
      .executeTakeFirstOrThrow();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("adoption_intervention")
        .set({
          status: "done",
          outcome_note: "Synthetic: refresher training delivered",
          completed_at: sql<Date>`now()`,
          completed_by: c.b.users.bo.id,
          version: sql<number>`version + 1`,
          updated_by: c.b.users.bo.id,
        })
        .where("id", "=", interventionId)
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: c.b.users.bo.id, requestId: `fixture-${interventionId}`, source: "api" },
        {
          action: "adoption_intervention.update",
          recordType: "adoption_intervention",
          recordId: interventionId,
          organizationId: c.b.organizationId,
          transformationId: c.b.transformationId,
          priorVersion: iv.version,
          newVersion: iv.version + 1,
        },
      );
    });
    const after = await model(id);
    expect([after.adoption, after.adoptionSource]).toEqual(["adopted", "owner"]);
  });
});
