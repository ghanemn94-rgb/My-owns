// The six-step benefits lifecycle and its enablers (T-DG4-KBE-D; ADR-0029 §2, §3, §11; REQ-PB-074, REQ-S08-002,
// REQ-PB-058 Plan outputs). Proves, against the run's disposable PostgreSQL:
//  - "a benefit cannot enter Measure without the Plan outputs; Sustain requires a BAU owner and control cadence", plus
//    the Enable output (enablers) before Measure and the recovery plan before Correct, with the exact §11 codes;
//  - one step at a time; the step history (four rows for identify→plan→enable→measure);
//  - the six B0121 steps verbatim with question and output, Arabic provisional;
//  - REQ-S08-002: completing the enabling deliverable leaves the validated value at zero (count 0) and marks the benefit
//    `enabled_not_yet_measured`; a delivered enabler is never realized value;
//  - every mutation: AUD 403, ADM-only 403, If-Match 428/409, one audit event, the write authorised again at commit.
// All data is SYNTHETIC; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  acceptDeliverable,
  benefitAt,
  cxBody,
  extraUser,
  financialBody,
  insertDeliverable,
  insertInitiative,
  planOutputs,
  seedBenefitWorld,
  type BenefitWorld,
} from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let B: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  B = `${b.base}/benefits`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const advance = (id: string, version: number, toStep: string, session = b.s.bo) =>
  call(api.app, "POST", `${B}/${id}/lifecycle`, { session, headers: ifm(version), body: { toStep } });
const create = async (body: Record<string, unknown>) => {
  const r = await call(api.app, "POST", B, { session: b.s.bo, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
};

describe("getBenefitLifecycle", () => {
  it("the six B0121 steps verbatim (en) with provisional ar, the preconditions per step, and the history", async () => {
    const c = await create(financialBody(b));
    const r = await call(api.app, "GET", `${B}/${c.id}/lifecycle`, { session: b.s.auditor });
    expect([r.status, r.headers.etag, r.body.currentStep]).toEqual([200, '"1"', "identify"]);
    expect(r.body.steps.map((s: { code: string }) => s.code)).toEqual([
      "identify",
      "plan",
      "enable",
      "measure",
      "correct",
      "sustain",
    ]);
    const plan = r.body.steps[1];
    expect([plan.questionEn, plan.outputEn, plan.arIsProvisional]).toEqual([
      "How will it be measured, when, and by whom?",
      "Baseline, formula, target, owner",
      true,
    ]);
    expect(r.body.steps[2].missing).toEqual(["baseline", "formula", "target"]);
    expect(r.body.steps[3].missing).toEqual(["baseline", "formula", "target", "enablers"]);
    expect(r.body.steps[5].missing).toEqual(["baseline", "formula", "target", "bau_owner", "control_cadence"]);
    expect(r.body.history).toEqual([
      expect.objectContaining({ fromStep: null, toStep: "identify", benefitVersion: 1, actorUserId: b.users.bo.id }),
    ]);
    expect((await call(api.app, "GET", `${B}/${c.id}/lifecycle`, { session: b.s.outsider })).status).toBe(404);
  });
});

describe("advanceBenefitLifecycle (REQ-PB-074)", () => {
  it("a benefit cannot enter Enable or Measure without the Plan outputs (422 benefit.plan_outputs_missing)", async () => {
    const c = await create(financialBody(b));
    const p = await advance(c.id, 1, "plan");
    expect([p.status, p.body.lifecycleStep]).toEqual([200, "plan"]);
    const e = await advance(c.id, 2, "enable");
    expect([e.status, e.body.code, e.body.detail]).toEqual([
      422,
      "benefit.plan_outputs_missing",
      "The Plan outputs are missing: baseline, formula, target. A benefit needs its baseline, formula, target and owner before Enable and Measure.",
    ]);
    // A non-financial benefit needs no formula: its agreed KPI is the measure.
    const cx = await create(cxBody(b, { baselineValue: "41", targetValue: "50" }));
    expect((await advance(cx.id, 1, "plan")).status).toBe(200);
    expect((await advance(cx.id, 2, "enable")).body.lifecycleStep).toBe("enable");
  });

  it("Measure needs the Enable output (at least one active enabler); one step at a time", async () => {
    const c = await create(financialBody(b, planOutputs(b)));
    expect((await advance(c.id, 1, "enable")).body.code).toBe("benefit.lifecycle_step");
    await advance(c.id, 1, "plan");
    await advance(c.id, 2, "enable");
    const m = await advance(c.id, 3, "measure");
    expect([m.status, m.body.code, m.body.detail]).toEqual([
      422,
      "benefit.enablers_missing",
      "The Enable output is missing: link at least one enabling initiative, deliverable or capability before Measure.",
    ]);
    const ini = await insertInitiative(api.db, b);
    expect(
      (await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.bo, body: { initiativeId: ini } })).status,
    ).toBe(201);
    const ok = await advance(c.id, 3, "measure");
    expect([ok.status, ok.body.lifecycleStep, ok.body.version]).toEqual([200, "measure", 4]);
    expect((await advance(c.id, 4, "identify")).body.detail).toBe(
      "A benefit moves Identify → Plan → Enable → Measure, between Measure and Correct, and from Measure to Sustain, one step at a time.",
    );
    // History: identify, plan, enable, measure (four rows), written by the database from the row itself.
    const h = await call(api.app, "GET", `${B}/${c.id}/lifecycle`, { session: b.s.auditor });
    expect(h.body.history.map((e: { toStep: string }) => e.toStep)).toEqual(["identify", "plan", "enable", "measure"]);
    expect((await auditOf(api.db, c.id)).map((a) => a.action)).toEqual([
      "benefit.create",
      "benefit.lifecycle_advanced",
      "benefit.lifecycle_advanced",
      "benefit.lifecycle_advanced",
    ]);
  });

  it("Correct needs a recovery plan; Sustain requires a BAU owner and a control cadence", async () => {
    const m = await benefitAt(api, b, "measure");
    const c = await advance(m.id, m.version, "correct");
    expect([c.status, c.body.code, c.body.detail]).toEqual([
      422,
      "benefit.recovery_plan_required",
      "The Correct step needs a recovery plan.",
    ]);
    const s = await advance(m.id, m.version, "sustain");
    expect([s.status, s.body.code, s.body.detail]).toEqual([
      422,
      "benefit.sustain_outputs_missing",
      "The Sustain step needs a BAU owner and a control cadence.",
    ]);
    const half = await call(api.app, "PATCH", `${B}/${m.id}`, {
      session: b.s.bo,
      headers: ifm(m.version),
      body: { bauOwnerUserId: b.users.bo2.id },
    });
    expect((await advance(m.id, half.body.version, "sustain")).body.code).toBe("benefit.sustain_outputs_missing");
    const full = await call(api.app, "PATCH", `${B}/${m.id}`, {
      session: b.s.bo,
      headers: ifm(half.body.version),
      body: { controlCadence: "quarterly", recoveryPlan: "Synthetic recovery plan." },
    });
    const corr = await advance(m.id, full.body.version, "correct");
    expect(corr.body.lifecycleStep).toBe("correct");
    const back = await advance(m.id, corr.body.version, "measure");
    const sus = await advance(m.id, back.body.version, "sustain");
    expect([sus.status, sus.body.lifecycleStep]).toEqual([200, "sustain"]);
    // Clearing a Sustain output afterwards is refused, and no step follows Sustain.
    const clear = await call(api.app, "PATCH", `${B}/${m.id}`, {
      session: b.s.bo,
      headers: ifm(sus.body.version),
      body: { controlCadence: null },
    });
    expect(clear.body.code).toBe("benefit.sustain_outputs_missing");
    expect((await advance(m.id, sus.body.version, "measure")).body.code).toBe("benefit.lifecycle_step");
  });

  it("only benefit.advance (BO): TL, AUD and ADM-only get 403; If-Match 428/409; 400 on an unknown step", async () => {
    const c = await create(financialBody(b));
    for (const session of [b.s.tl, b.s.auditor, b.s.admin])
      expect((await advance(c.id, 1, "plan", session)).status).toBe(403);
    const none = await call(api.app, "POST", `${B}/${c.id}/lifecycle`, { session: b.s.bo, body: { toStep: "plan" } });
    expect(none.status).toBe(428);
    expect((await advance(c.id, 5, "plan")).status).toBe(409);
    expect((await advance(c.id, 1, "done")).status).toBe(400);
  });

  it("commit-time: a grant revoked while the advance waited is 403; the step is unchanged", async () => {
    const c = await create(financialBody(b));
    const u = await extraUser(api, w, b, "BO");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${B}/${c.id}/lifecycle`, {
          session: u.session,
          headers: ifm(1),
          body: { toStep: "plan" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("benefit")
      .select(["lifecycle_step", "version"])
      .where("id", "=", c.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ lifecycle_step: "identify", version: 1 });
  });
});

describe("enablers (REQ-S08-002)", () => {
  it("completing the enabling deliverable leaves validated value at zero and marks 'enabled - not yet measured'", async () => {
    const c = await create(financialBody(b, { ...planOutputs(b), plannedValue: "5000000" }));
    const ini = await insertInitiative(api.db, b);
    const del = await insertDeliverable(api.db, b, ini);
    const e = await call(api.app, "POST", `${B}/${c.id}/enablers`, {
      session: b.s.bo,
      body: { initiativeId: ini, deliverableId: del, note: "Synthetic enabler" },
    });
    expect([e.status, e.body.delivered, e.body.status]).toEqual([201, false, "active"]);
    expect((await call(api.app, "GET", `${B}/${c.id}`, { session: b.s.auditor })).body.realizationState).toBe(
      "not_enabled",
    );
    await acceptDeliverable(api.db, b, del);
    const list = await call(api.app, "GET", `${B}/${c.id}/enablers`, { session: b.s.auditor });
    expect([list.status, list.body.items.map((x: { delivered: boolean }) => x.delivered)]).toEqual([200, [true]]);
    const page = await call(api.app, "GET", `${B}?limit=100`, { session: b.s.auditor });
    const row = (page.body.items as { id: string; realizationState: string; realized: Record<string, unknown> }[]).find(
      (r) => r.id === c.id,
    )!;
    expect(row.realizationState).toBe("enabled_not_yet_measured");
    expect([row.realized["validated"], row.realized["validatedCount"]]).toEqual([
      { status: "known", amount: "0.0000", currency: "SAR", reason: null },
      0,
    ]);
    // The benefit's own version did not move: a delivered enabler changes no value and no benefit field.
    expect((await call(api.app, "GET", `${B}/${c.id}`, { session: b.s.auditor })).body.version).toBe(1);
  });

  it("an initiative completed without a deliverable is a delivered enabler; the deliverable must belong to the initiative", async () => {
    const c = await create(financialBody(b));
    const done = await insertInitiative(api.db, b, { status: "completed" });
    const e = await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.tl, body: { initiativeId: done } });
    expect([e.status, e.body.delivered]).toEqual([201, true]);
    const other = await insertInitiative(api.db, b);
    const foreign = await insertDeliverable(api.db, b, other);
    const bad = await call(api.app, "POST", `${B}/${c.id}/enablers`, {
      session: b.s.tl,
      body: { initiativeId: done, deliverableId: foreign },
    });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "benefit_enabler.deliverable_initiative",
      "The deliverable must belong to the enabling initiative.",
    ]);
    const dup = await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.tl, body: { initiativeId: done } });
    expect([dup.status, dup.body.code]).toEqual([409, "benefit_enabler.exists"]);
    const unknownInitiative = await call(api.app, "POST", `${B}/${c.id}/enablers`, {
      session: b.s.tl,
      body: { initiativeId: crypto.randomUUID() },
    });
    expect([unknownInitiative.status, unknownInitiative.body.code]).toEqual([422, "validation.reference"]);
  });

  it("remove: a reason, If-Match, final; AUD and ADM-only get 403; one audit event per change", async () => {
    const c = await create(financialBody(b));
    const ini = await insertInitiative(api.db, b);
    const e = await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.bo, body: { initiativeId: ini } });
    const R = `${b.base}/benefit-enablers/${e.body.id}/remove`;
    for (const session of [b.s.auditor, b.s.admin]) {
      expect((await call(api.app, "POST", R, { session, headers: ifm(1), body: { reason: "Synthetic" } })).status).toBe(
        403,
      );
      expect(
        (await call(api.app, "POST", `${B}/${c.id}/enablers`, { session, body: { initiativeId: ini } })).status,
      ).toBe(403);
    }
    expect((await call(api.app, "POST", R, { session: b.s.bo, body: { reason: "Synthetic" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", R, { session: b.s.bo, headers: ifm(3), body: { reason: "Synthetic" } })).status,
    ).toBe(409);
    const r = await call(api.app, "POST", R, {
      session: b.s.bo,
      headers: ifm(1),
      body: { reason: "Synthetic removal" },
    });
    expect([r.status, r.body.status, r.body.removeReason, r.body.version]).toEqual([
      200,
      "removed",
      "Synthetic removal",
      2,
    ]);
    const again = await call(api.app, "POST", R, { session: b.s.bo, headers: ifm(2), body: { reason: "Again" } });
    expect([again.status, again.body.code]).toEqual([422, "benefit_enabler.removed"]);
    expect((await auditOf(api.db, e.body.id)).map((a) => a.action)).toEqual([
      "benefit_enabler.create",
      "benefit_enabler.remove",
    ]);
    // A removed link may be added again (a new link).
    expect(
      (await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.bo, body: { initiativeId: ini } })).status,
    ).toBe(201);
  });

  it("an archived benefit takes no enabler (422 benefit.archived)", async () => {
    const c = await create(financialBody(b));
    await call(api.app, "POST", `${B}/${c.id}/archive`, { session: b.s.bo, headers: ifm(1), body: { reason: "Gone" } });
    const ini = await insertInitiative(api.db, b);
    const r = await call(api.app, "POST", `${B}/${c.id}/enablers`, { session: b.s.bo, body: { initiativeId: ini } });
    expect([r.status, r.body.code]).toEqual([422, "benefit.archived"]);
  });
});
