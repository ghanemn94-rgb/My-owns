// The Finance validation queue and decisions (T-DG4-KBE-E; ADR-0030 §3, §4, §9, §11; ADR-0029 §8). Proves, against the
// run's disposable PostgreSQL:
//  - REQ-PB-013 "a Business Owner gets 403 on the Finance validation decision; a FIN user succeeds; the audit event
//    records the validator": BO, AUD and ADM-only callers get 403 on decideFinanceValidation (and on
//    decideBenefitBaseline), FIN succeeds, and both audit events name the deciding Finance user as the actor;
//  - REQ-S08-015 "a decision without the measurement-period item is 422; a non-Finance caller is 403": a decision
//    leaving out measurementPeriod answers 422 finance_validation.content_incomplete naming it;
//  - REQ-S08-016 "approval adds exactly the approved amount": 0 -> 240000.5000 on the validated series;
//  - REQ-S08-008: approval is refused while the basis is provisional (422 finance_validation.basis_provisional);
//  - REQ-S08-001: a rejected value stays visible as `rejected`; the submitter never validates (403 sod_submitter);
//  - the queue read (queued first, oldest first; status filter); If-Match 428/409; one transaction; the queue task done.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, grant, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { benefitAt, extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import {
  ALL_ACCEPTED,
  approve,
  decideBaseline,
  evidenceItem,
  measuredBenefit,
  queueItemOf,
  revenueFormula,
  runFinanceQueue,
  submittedValue,
  type Body,
} from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let FV: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  FV = `${b.base}/finance-validations`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

let month = 0;
const period = () => {
  month += 1;
  const y = 2032 + Math.floor((month - 1) / 12);
  const m = String(((month - 1) % 12) + 1).padStart(2, "0");
  const end = new Date(Date.UTC(y, Number(m), 0)).getUTCDate();
  return { periodStart: `${y}-${m}-01`, periodEnd: `${y}-${m}-${end}` };
};
const seriesOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return Object.fromEntries((r.body.series as Body[]).map((s) => [s.state, s]));
};
const decide = (id: string, version: number | null, body: object, session = b.s.fin) =>
  call<Body>(api.app, "POST", `${FV}/${id}/decision`, {
    session,
    ...(version === null ? {} : { headers: ifm(version) }),
    body,
  });

describe("REQ-PB-013: only Finance decides, and the audit names the validator", () => {
  it("BO, AUD and ADM-only get 403; FIN approves; two audit events by FIN; the task is done; validated +amount", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "250000", period());
    for (const s of [b.s.bo, b.s.auditor, b.s.admin, b.s.tl]) {
      const r = await decide(
        v.validationId,
        v.validationVersion,
        { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "1" },
        s,
      );
      expect(r.status).toBe(403);
    }
    const before = await seriesOf(ben.id);
    expect([before.validated.total.amount, before.submitted.total.amount]).toEqual(["0.0000", "250000.0000"]);
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "status", "kind"])
      .where("subject_id", "=", v.validationId)
      .execute();
    // No FIN party mapped and no named validator: the item is listed in the queue without a personal task.
    expect(tasks).toEqual([]);
    const ok = await approve(api, b, v, "240000.5");
    expect(ok).toMatchObject({
      status: "approved",
      approvedAmount: "240000.5000",
      decidedBy: b.users.fin.id,
      items: { measurementPeriod: { decision: "accepted" }, baseline: { decision: "accepted" } },
    });
    const fvAudit = await auditOf(api.db, v.validationId);
    expect(fvAudit.map((e) => [e.action, e.actor_type, e.actor_user_id])).toEqual([
      ["finance_validation.queued", "service", null],
      ["finance_validation.approved", "user", b.users.fin.id],
    ]);
    const mAudit = await auditOf(api.db, v.measurementId);
    expect(mAudit.at(-1)).toMatchObject({ action: "benefit_measurement.validated", actor_user_id: b.users.fin.id });
    // REQ-S08-016: approval adds exactly the approved amount; the measured series keeps what was measured.
    const after = await seriesOf(ben.id);
    expect([after.validated.total.amount, after.validated.count]).toEqual(["240000.5000", 1]);
    expect([after.submitted.count, after.measured.total.amount]).toEqual([0, "250000.0000"]);
    const m = await call<Body>(api.app, "GET", `${b.base}/benefit-measurements/${v.measurementId}`, {
      session: b.s.auditor,
    });
    expect(m.body).toMatchObject({
      status: "validated",
      validatedAmount: "240000.5000",
      financeValidationId: v.validationId,
      decidedBy: b.users.fin.id,
    });
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key"])
      .where("aggregate_id", "in", [v.validationId, v.measurementId])
      .orderBy("seq")
      .execute();
    expect(events.map((e) => e.event_type)).toEqual([
      "benefit.evidence_submitted",
      "benefit.value_validated",
      "benefit.variance_evaluated",
    ]);
    // Decided items are final.
    const twice = await decide(v.validationId, ok.version, {
      decision: "approved",
      items: ALL_ACCEPTED,
      approvedAmount: "1",
    });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "finance_validation.not_queued",
      "Only a queued item can be decided.",
    ]);
  });

  it("the queue task goes to the named Finance validator and is completed by the decision", async () => {
    const fin2 = await extraUser(api, w, b, "FIN");
    const ben = await measuredBenefit(api, b, { extra: { financeValidatorUserId: fin2.id } });
    const v = await submittedValue(api, b, ben.id, "10", period());
    const open = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "status", "kind", "dedupe_key"])
      .where("subject_id", "=", v.validationId)
      .execute();
    expect(open).toEqual([
      {
        assignee_user_id: fin2.id,
        status: "open",
        kind: "finance_validation_review",
        dedupe_key: `finance_validation:${v.validationId}:${fin2.id}`,
      },
    ]);
    const r = await decide(
      v.validationId,
      v.validationVersion,
      { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "10" },
      fin2.session,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const done = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", v.validationId)
      .execute();
    expect(done).toEqual([{ status: "done" }]);
  });
});

describe("REQ-S08-015: all six items, and the other §11 refusals", () => {
  it("a decision without the measurement-period item is 422 content_incomplete; nothing written", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "100", period());
    const { measurementPeriod: _omit, ...five } = ALL_ACCEPTED;
    const r = await decide(v.validationId, v.validationVersion, {
      decision: "approved",
      items: five,
      approvedAmount: "100",
    });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "finance_validation.content_incomplete",
      "A Finance decision covers all six items: baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions. Missing: measurement period.",
    ]);
    const two = await decide(v.validationId, v.validationVersion, {
      decision: "approved",
      items: { baseline: { decision: "accepted" } },
    });
    expect(two.body.detail).toMatch(
      /Missing: attribution\/counterfactual, calculation, evidence, measurement period, assumptions\.$/,
    );
    // A non-Finance caller is 403 whatever the body.
    expect(
      (await decide(v.validationId, v.validationVersion, { decision: "approved", items: five }, b.s.bo)).status,
    ).toBe(403);
    const row = await api.db
      .selectFrom("finance_validation")
      .select(["status", "version"])
      .where("id", "=", v.validationId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "queued", version: 1 });
  });

  it("items not accepted, approved amount shape, rejection note, If-Match 428/409, SoD", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "100", period());
    const oneRejected = { ...ALL_ACCEPTED, evidence: { decision: "rejected", note: "Synthetic: extract unsigned" } };
    const r1 = await decide(v.validationId, 1, { decision: "approved", items: oneRejected, approvedAmount: "100" });
    expect([r1.status, r1.body.code, r1.body.detail]).toEqual([
      422,
      "finance_validation.items_not_accepted",
      "An approval needs every item accepted. Reject the value instead, with a note.",
    ]);
    const r2 = await decide(v.validationId, 1, { decision: "approved", items: ALL_ACCEPTED });
    expect([r2.status, r2.body.code, r2.body.detail]).toEqual([
      422,
      "finance_validation.approved_amount_required",
      "Approving a financial value states the approved amount; a non-financial value has none.",
    ]);
    const r3 = await decide(v.validationId, 1, { decision: "rejected", items: oneRejected });
    const r4 = await decide(v.validationId, 1, { decision: "rejected", items: ALL_ACCEPTED, note: "Synthetic" });
    for (const r of [r3, r4])
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "finance_validation.rejection_note_required",
        "A rejection needs a note and at least one rejected item.",
      ]);
    expect((await decide(v.validationId, null, { decision: "rejected", items: oneRejected, note: "x" })).status).toBe(
      428,
    );
    expect((await decide(v.validationId, 7, { decision: "rejected", items: oneRejected, note: "x" })).status).toBe(409);
    // SoD: a person holding BO and FIN who submitted the value cannot decide it.
    const both = await extraUser(api, w, b, "BO");
    await grant(api.db, w.grantor.id, both.id, "FIN", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const ev = await evidenceItem(api, b);
    const mine = await call<Body>(api.app, "POST", `${b.base}/benefits/${ben.id}/measurements`, {
      session: both.session,
      body: { ...period(), amount: "7", evidenceIds: [ev], submit: true },
    });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    await runFinanceQueue(api, mine.body.id);
    const item = await queueItemOf(api, mine.body.id);
    const sod = await decide(
      item!.id,
      item!.version,
      { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "7" },
      both.session,
    );
    expect([sod.status, sod.body.code, sod.body.detail]).toEqual([
      403,
      "finance_validation.sod_submitter",
      "You submitted this value, so you cannot validate it.",
    ]);
  });

  it("a rejected value stays visible as rejected; the period can be measured again", async () => {
    const ben = await measuredBenefit(api, b);
    const p = period();
    const v = await submittedValue(api, b, ben.id, "300", p);
    const r = await decide(v.validationId, 1, {
      decision: "rejected",
      items: { ...ALL_ACCEPTED, attribution: { decision: "rejected", note: "Synthetic: no counterfactual" } },
      note: "Synthetic: attribution not shown",
    });
    expect([r.status, r.body.status, r.body.items.attribution]).toEqual([
      200,
      "rejected",
      { decision: "rejected", note: "Synthetic: no counterfactual" },
    ]);
    const s = await seriesOf(ben.id);
    expect([s.rejected.count, s.rejected.total.amount, s.validated.total.amount]).toEqual([1, "300.0000", "0.0000"]);
    expect((await auditOf(api.db, v.measurementId)).at(-1)).toMatchObject({
      action: "benefit_measurement.rejected",
      actor_user_id: b.users.fin.id,
    });
    const again = await submittedValue(api, b, ben.id, "290", p);
    expect(again.measurementId).not.toBe(v.measurementId);
  });

  it("REQ-S08-008: approval is refused while the basis is provisional; validating the baseline lifts it", async () => {
    const formula = await revenueFormula(api, b);
    const ben = await measuredBenefit(api, b, { baseline: false, formula });
    const v = await submittedValue(api, b, ben.id, "500", period());
    const r = await decide(v.validationId, 1, { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "500" });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "finance_validation.basis_provisional",
      "The comparison basis is not validated by Finance, so this value is provisional. Validate the benefit's baseline and its formula version first.",
    ]);
    expect((await seriesOf(ben.id)).submitted.lines[0].basis).toBe("provisional");
    await decideBaseline(api, b, ben.id, ben.version);
    const ok = await decide(v.validationId, 1, { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "500" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("commit-time: a FIN grant revoked while the decision waited is 403; still queued", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "100", period());
    const u = await extraUser(api, w, b, "FIN");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${FV}/${v.validationId}/decision`, {
          session: u.session,
          headers: ifm(1),
          body: { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "100" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("finance_validation")
      .select(["status", "version"])
      .where("id", "=", v.validationId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "queued", version: 1 });
  });
});

describe("the queue read", () => {
  it("queued first, oldest first; status filter; AUD reads; outsider 404; cursor pages", async () => {
    const ben = await measuredBenefit(api, b);
    const a = await submittedValue(api, b, ben.id, "1", period());
    const c = await submittedValue(api, b, ben.id, "2", period());
    await approve(api, b, a, "1");
    const all = await call<Body>(api.app, "GET", `${FV}?limit=100`, { session: b.s.auditor });
    expect(all.status).toBe(200);
    const ids = (all.body.items as Body[]).map((i) => i.id);
    const statuses = (all.body.items as Body[]).map((i) => i.status);
    expect(statuses.indexOf("approved")).toBeGreaterThan(statuses.lastIndexOf("queued"));
    expect(ids.indexOf(c.validationId)).toBeLessThan(ids.indexOf(a.validationId));
    const queued = await call<Body>(api.app, "GET", `${FV}?status=queued&limit=100`, { session: b.s.bo });
    expect((queued.body.items as Body[]).every((i) => i.status === "queued")).toBe(true);
    const page1 = await call<Body>(api.app, "GET", `${FV}?limit=1`, { session: b.s.auditor });
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await call<Body>(
      api.app,
      "GET",
      `${FV}?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      { session: b.s.auditor },
    );
    expect([page2.status, page2.body.items[0].id]).toEqual([200, ids[1]]);
    const one = await call<Body>(api.app, "GET", `${FV}/${c.validationId}`, { session: b.s.auditor });
    expect([one.status, one.headers.etag, one.body.content.measurementPeriod]).toEqual([
      200,
      '"1"',
      expect.any(Object),
    ]);
    expect((await call(api.app, "GET", `${FV}/${c.validationId}`, { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", FV, { session: b.s.outsider })).status).toBe(404);
  });
});

describe("decideBenefitBaseline (ADR-0029 §8; REQ-PB-013 baseline half)", () => {
  it("FIN validates; the owner, BO, AUD and ADM-only are refused; a rejection needs a note; no baseline 422", async () => {
    const ben = await benefitAt(
      api,
      b,
      "measure",
      financialBody(b, { baselineValue: "1000", targetValue: "2000", benefitFormulaId: b.benefitFormulaId }),
    );
    const url = `${b.base}/benefits/${ben.id}/baseline-validation`;
    for (const s of [b.s.bo, b.s.auditor, b.s.admin])
      expect(
        (await call(api.app, "POST", url, { session: s, headers: ifm(ben.version), body: { decision: "validated" } }))
          .status,
      ).toBe(403);
    const noNote = await call<Body>(api.app, "POST", url, {
      session: b.s.fin,
      headers: ifm(ben.version),
      body: { decision: "rejected" },
    });
    expect([noNote.status, noNote.body.code, noNote.body.detail]).toEqual([
      422,
      "benefit.baseline_note_required",
      "A baseline rejection needs a note.",
    ]);
    expect((await call(api.app, "POST", url, { session: b.s.fin, body: { decision: "validated" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", url, { session: b.s.fin, headers: ifm(99), body: { decision: "validated" } }))
        .status,
    ).toBe(409);
    const ok = await call<Body>(api.app, "POST", url, {
      session: b.s.fin,
      headers: ifm(ben.version),
      body: { decision: "validated" },
    });
    expect([ok.status, ok.body.baselineValidationStatus, ok.body.baselineValidatedBy]).toEqual([
      200,
      "validated",
      b.users.fin.id,
    ]);
    expect((await auditOf(api.db, ben.id)).at(-1)).toMatchObject({
      action: "benefit.baseline_validated",
      actor_user_id: b.users.fin.id,
    });
    // The benefit owner holding FIN cannot validate their own benefit's baseline.
    const ownerFin = await extraUser(api, w, b, "FIN");
    await grant(api.db, w.grantor.id, ownerFin.id, "BO", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const owned = await benefitAt(
      api,
      b,
      "identify",
      financialBody(b, { ownerUserId: ownerFin.id, baselineValue: "5" }),
    );
    const self = await call<Body>(api.app, "POST", `${b.base}/benefits/${owned.id}/baseline-validation`, {
      session: ownerFin.session,
      headers: ifm(owned.version),
      body: { decision: "validated" },
    });
    expect([self.status, self.body.code, self.body.detail]).toEqual([
      403,
      "benefit.baseline_validator_is_owner",
      "You own this benefit, so you cannot validate its baseline.",
    ]);
    const bare = await benefitAt(api, b, "identify", financialBody(b));
    const missing = await call<Body>(api.app, "POST", `${b.base}/benefits/${bare.id}/baseline-validation`, {
      session: b.s.fin,
      headers: ifm(bare.version),
      body: { decision: "validated" },
    });
    expect([missing.status, missing.body.code, missing.body.detail]).toEqual([
      422,
      "benefit.baseline_missing",
      "There is no baseline to validate.",
    ]);
  });
});
