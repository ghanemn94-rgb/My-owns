// The governed closure (T-DG4-BE-J; ADR-0034 §7, §9, §10, §12; REQ-PB-009, REQ-S03-003, REQ-S11-007; D-089 Q4).
// Proves, against the run's disposable PostgreSQL:
//  - closeInitiative, checks in ADR-0034 §7 order with exact texts: not delivery-complete -> 422 invalid-transition
//    closure.delivery_not_complete; REQ-PB-009 A11: delivery Complete and no validated benefit -> 422 invalid-transition
//    closure.value_validation_pending (no benefit, or a pending one); a validated benefit without a BAU owner -> 422
//    closure.sustainment_owner_missing; then the closure record (basis, snapshot), audited, status model "Closed";
//    a second close -> 409 closure.already_closed; a transition-covered benefit closes with basis transition_decision;
//    concurrent closes -> one 201, one 409 (lock 730244 and the unique index); AUD/WL/BO 403, ADM-only and an outsider
//    404; a note under 3 characters is 400 at /note;
//  - closeTransformation, in order: archived -> 422 transformation.archived; not active/on_hold -> 422
//    closure.transformation_not_open; G6 not approved -> 422 closure.g6_not_approved; REQ-S03-003 A11: value pending ->
//    422 closure.value_validation_pending, and the close succeeds once an approved transition decision covers the
//    pending benefit (with G6 approved and the areas in BAU); an area not in BAU -> 422 closure.bau_not_accepted; the
//    success writes the record, status `closed` (version + 1, audited) and never `archived_at`, so slice G writes still
//    work after closure; a second close -> 409; AUD/WL/BO 403, ADM-only and an outsider 404.
// All data is SYNTHETIC: the approved G6 is the synthetic fixture approveG6Synthetic (it approves nothing), the
// transition-decision approval is a synthetic decision of test data, and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { areaInBau, createArea } from "../contract/p4-exercises-be-i.ts";
import {
  approveG6Synthetic,
  decideDecision,
  deliveredInitiative,
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  setTransformationStatus,
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

const INVALID_TRANSITION = "urn:mth:problem:invalid-transition";
const INITIATIVE_PENDING =
  "Delivered — value validation pending: an initiative closes only when each of its benefits is validated by Finance " +
  "or covered by an approved transition decision.";
const TRANSFORMATION_PENDING =
  "Validated value is pending: a transformation closes only when each of its benefits is validated by Finance or " +
  "covered by an approved transition decision.";
const closeI = (id: string, session = c.b.s.tl, body: Record<string, unknown> = {}) =>
  send("POST", `/api/v1/initiatives/${id}/close`, { session, body });
const recordsOf = (initiativeId: string) =>
  api.db.selectFrom("closure_record").selectAll().where("initiative_id", "=", initiativeId).execute();

describe("closeInitiative (ADR-0034 §7; REQ-PB-009)", () => {
  it("not delivery-complete: 422 invalid-transition closure.delivery_not_complete", async () => {
    const id = await launchedInitiative(api.db, c.b);
    const r = await closeI(id);
    expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.delivery_not_complete",
      "Initiative delivery is not complete.",
    ]);
    expect(await recordsOf(id)).toEqual([]);
  });

  it("REQ-PB-009: delivery Complete and no validated benefit cannot be closed (422 invalid-transition)", async () => {
    const none = await deliveredInitiative(api, c);
    const pending = await deliveredInitiative(api, c);
    await pendingBenefit(api, c, pending);
    for (const id of [none, pending]) {
      const r = await closeI(id);
      expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
        422,
        INVALID_TRANSITION,
        "closure.value_validation_pending",
        INITIATIVE_PENDING,
      ]);
      expect(await recordsOf(id)).toEqual([]);
      const sm = await send("GET", `/api/v1/initiatives/${id}/status-model`, { session: c.b.s.auditor });
      expect([sm.body.closure, sm.body.label]).toEqual(["open", "Delivered — value validation pending"]);
    }
  });

  it("a validated benefit needs a BAU owner; then closed (basis validated_value, snapshot), audited; 409 again", async () => {
    const id = await deliveredInitiative(api, c);
    const ben = await validatedBenefit(api, c, id, false);
    const noOwner = await closeI(id);
    expect([noOwner.status, noOwner.body.type, noOwner.body.code, noOwner.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.sustainment_owner_missing",
      "Each validated benefit needs a BAU owner before closure.",
    ]);
    const cur = await send("GET", `${c.b.base}/benefits/${ben.id}`, { session: c.b.s.bo });
    expect(
      (
        await send("PATCH", `${c.b.base}/benefits/${ben.id}`, {
          session: c.b.s.bo,
          headers: ifm(cur.body.version),
          body: { bauOwnerUserId: c.b.users.bo.id },
        })
      ).status,
    ).toBe(200);
    const tooShort = await closeI(id, c.b.s.tl, { note: "ok" });
    expect([tooShort.status, tooShort.body.errors[0].pointer]).toEqual([400, "/note"]);
    const r = await closeI(id, c.b.s.tl, { note: "Synthetic: value validated by Finance" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.subjectKind, r.body.initiativeId, r.body.basis, r.body.closedBy, r.body.closureNote]).toEqual([
      "initiative",
      id,
      "validated_value",
      c.b.users.tl.id,
      "Synthetic: value validated by Finance",
    ]);
    const measurement = await api.db
      .selectFrom("benefit_measurement")
      .select("id")
      .where("benefit_id", "=", ben.id)
      .where("status", "=", "validated")
      .executeTakeFirstOrThrow();
    expect(r.body.snapshot.benefits).toEqual([
      {
        benefitId: ben.id,
        code: ben.code,
        state: "validated",
        validatedMeasurementIds: [measurement.id],
        transitionDecisionId: null,
        sustainmentOwnerUserId: c.b.users.bo.id,
      },
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.actor_user_id])).toEqual([
      ["initiative.close", c.b.users.tl.id],
    ]);
    const sm = await send("GET", `/api/v1/initiatives/${id}/status-model`, { session: c.b.s.auditor });
    expect([sm.body.delivery, sm.body.value, sm.body.closure, sm.body.closureRecordId, sm.body.label]).toEqual([
      "completed",
      "validated",
      "closed",
      r.body.id,
      "Closed",
    ]);
    const again = await closeI(id);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      409,
      "closure.already_closed",
      "This initiative is already closed.",
    ]);
    expect(await recordsOf(id)).toHaveLength(1);
  }, 60_000);

  it("a benefit covered by an approved transition decision closes with basis transition_decision", async () => {
    const id = await deliveredInitiative(api, c);
    const ben = await pendingBenefit(api, c, id);
    const td = await draftDecision(send, c, ben.id);
    await decideDecision(send, c, td);
    const r = await closeI(id);
    expect([r.status, r.body.basis, r.body.snapshot.benefits[0].transitionDecisionId]).toEqual([
      201,
      "transition_decision",
      td.id,
    ]);
    expect(r.body.snapshot.benefits[0].sustainmentOwnerUserId).toBe(c.b.users.bo2.id);
  });

  it("concurrent closes: exactly one closure record (one 201, one 409)", async () => {
    const id = await deliveredInitiative(api, c);
    const ben = await pendingBenefit(api, c, id);
    await decideDecision(send, c, await draftDecision(send, c, ben.id));
    const results = await Promise.all([closeI(id), closeI(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await recordsOf(id)).toHaveLength(1);
  });

  it("S-4: a TL revoked after the identity hook gets 403 at commit time (initiative and transformation); nothing written", async () => {
    const id = await deliveredInitiative(api, c);
    const ben = await pendingBenefit(api, c, id);
    await decideDecision(send, c, await draftDecision(send, c, ben.id));
    const tl2 = await extraUser(api, w, c.b, "TL");
    const res = await afterIdentity(
      api,
      tl2.id,
      () =>
        call(api.app, "POST", `/api/v1/initiatives/${id}/close`, { session: tl2.session, body: {}, contract: false }),
      () => revokeAll(api, w.grantor.id, tl2.id),
    );
    expect(res.status).toBe(403);
    expect(await recordsOf(id)).toEqual([]);
    const tl3 = await extraUser(api, w, c.b, "TL");
    const t = await afterIdentity(
      api,
      tl3.id,
      () => call(api.app, "POST", `${c.b.base}/close`, { session: tl3.session, body: {}, contract: false }),
      () => revokeAll(api, w.grantor.id, tl3.id),
    );
    expect(t.status).toBe(403);
    const row = await api.db
      .selectFrom("transformation")
      .select("status")
      .where("id", "=", c.b.transformationId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("active");
  });

  it("AUD, WL and BO 403; ADM-only and an outsider 404; nothing written", async () => {
    const id = await deliveredInitiative(api, c);
    for (const session of [c.b.s.auditor, c.s.wl.session, c.b.s.bo])
      expect((await closeI(id, session)).status).toBe(403);
    for (const session of [c.b.s.admin, c.b.s.outsider]) expect((await closeI(id, session)).status).toBe(404);
    expect(await recordsOf(id)).toEqual([]);
  });
});

describe("closeTransformation (ADR-0034 §7; REQ-S03-003; D-089 Q4)", () => {
  it("in order: not open, G6 not approved, value pending, BAU pending; then closed (status closed, never archived)", async () => {
    const x = await seedClosureWorld(api, w);
    const T = `${x.b.base}/close`;
    const close = (session = x.b.s.tl, body: Record<string, unknown> = {}) => send("POST", T, { session, body });
    const transformation = () =>
      api.db.selectFrom("transformation").selectAll().where("id", "=", x.b.transformationId).executeTakeFirstOrThrow();
    const ini = await deliveredInitiative(api, x);
    const ben = await pendingBenefit(api, x, ini);

    await setTransformationStatus(api.db, x.b, "draft");
    const notOpen = await close();
    expect([notOpen.status, notOpen.body.type, notOpen.body.code, notOpen.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.transformation_not_open",
      "Only an active or on-hold transformation can be closed.",
    ]);
    await setTransformationStatus(api.db, x.b, "on_hold");

    const noG6 = await close();
    expect([noG6.status, noG6.body.type, noG6.body.code, noG6.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.g6_not_approved",
      "Closure requires the G6 (Sustain) business approval.",
    ]);
    const g6 = await approveG6Synthetic(api, x.b);

    // REQ-S03-003: G6 approval alone closes nothing; validated value is pending.
    const pending = await close();
    expect([pending.status, pending.body.type, pending.body.code, pending.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.value_validation_pending",
      TRANSFORMATION_PENDING,
    ]);
    const sm = await send("GET", `${x.b.base}/status-model`, { session: x.b.s.auditor });
    expect([sm.body.label, sm.body.closureState]).toEqual(["Delivery complete - value validation pending", "open"]);

    // An approved transition decision covers the pending benefit.
    const td = await draftDecision(send, x, ben.id);
    await decideDecision(send, x, td);

    // An area still establishing: BAU is not accepted.
    const establishing = await createArea(send, x.s);
    const bau = await close();
    expect([bau.status, bau.body.type, bau.body.code, bau.body.detail]).toEqual([
      422,
      INVALID_TRANSITION,
      "closure.bau_not_accepted",
      "Every performance area of this transformation needs an accepted BAU handover before closure.",
    ]);
    const { area, handover } = await areaInBau(api, x.s, send);
    const retired = await send("POST", `${x.s.areas}/${establishing.id}/retire`, {
      session: x.s.to.session,
      headers: ifm(1),
      body: { reason: "Synthetic: merged into the BAU area" },
    });
    expect(retired.status).toBe(200);
    const ready = await send("GET", `${x.b.base}/status-model`, { session: x.b.s.auditor });
    expect([ready.body.valueState, ready.body.bauState, ready.body.label]).toEqual([
      "validated_with_transition",
      "bau_accepted",
      "Value validated - BAU accepted",
    ]);

    for (const session of [x.b.s.auditor, x.s.wl.session, x.b.s.bo]) expect((await close(session)).status).toBe(403);
    for (const session of [x.b.s.admin, x.b.s.outsider]) expect((await close(session)).status).toBe(404);

    const before = await transformation();
    const ok = await close(x.b.s.tl, { note: "Synthetic: value covered and BAU accepted" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect([ok.body.subjectKind, ok.body.initiativeId, ok.body.basis]).toEqual([
      "transformation",
      null,
      "transition_decision",
    ]);
    expect(ok.body.snapshot.g6.gateInstanceId).toBe(g6);
    expect(ok.body.snapshot.acceptedHandoverIds).toEqual([handover.id]);
    const after = await transformation();
    expect([after.status, after.archived_at, after.version]).toEqual(["closed", null, before.version + 1]);
    const tAudit = await auditOf(api.db, x.b.transformationId);
    expect(tAudit.slice(-1).map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["transformation.closed", before.version, before.version + 1],
    ]);
    expect((await auditOf(api.db, ok.body.id)).map((a) => a.action)).toEqual(["transformation.close"]);
    const closedModel = await send("GET", `${x.b.base}/status-model`, { session: x.b.s.auditor });
    expect([closedModel.body.closureState, closedModel.body.label]).toEqual(["closed", "Closed"]);
    const list = await send("GET", `${x.b.base}/closure-records`, { session: x.b.s.auditor });
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([ok.body.id]);

    // Closed, not archived: slice G writes continue after closure (ADR-0034 Context 3).
    const ci = await send("POST", `${x.b.base}/improvement-items`, {
      session: x.s.to.session,
      body: {
        title: "Synthetic: automate the reconciliation",
        performanceAreaId: area.id,
        sourceKind: "manual",
        priority: "M",
      },
    });
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    const again = await close();
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      409,
      "closure.already_closed",
      "This transformation is already closed.",
    ]);
  }, 120_000);

  it("an archived transformation: 422 transformation.archived (the DG1 code and text)", async () => {
    const x = await seedClosureWorld(api, w);
    const t = await api.db
      .selectFrom("transformation")
      .select("version")
      .where("id", "=", x.b.transformationId)
      .executeTakeFirstOrThrow();
    const office = await signIn(api.app, w.office.subject);
    const archived = await send("POST", `${x.b.base}/archive`, {
      session: office,
      headers: ifm(t.version),
      body: { reason: "Synthetic archive" },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const r = await send("POST", `${x.b.base}/close`, { session: x.b.s.tl, body: {} });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "transformation.archived",
      "Archived transformations are read-only.",
    ]);
  });
});
