// Valuation methods for non-financial benefits (T-DG4-KBE-D2; ADR-0029 §8, §9, §11; REQ-S08-010). Proves, against the
// run's disposable PostgreSQL:
//  - A10 "entering a SAR value on a CX benefit without an approved method is rejected": on the benefit itself
//    (no method, a proposed method, a rejected or retired method, a method in another currency) and on a scenario
//    value; once Finance approves the method, the SAR value is accepted;
//  - proposed -> approved | rejected by Finance (finance.validate; FIN only), never by the proposer (403); a rejection
//    needs a note; approved -> retired; a retired method stays valid for the benefits already referencing it;
//  - BO, TL, AUD and ADM-only get 403 on the decision; AUD, ADM-only and FIN on the proposal; If-Match 428/409; one
//    audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { cxBody, extraUser, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let M: string;
let B: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  M = `${b.base}/benefit-valuation-methods`;
  B = `${b.base}/benefits`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const methodBody = (extra: Record<string, unknown> = {}) => ({
  name: "Synthetic NPS point value",
  method: "Each NPS point is valued at the synthetic retention value per point.",
  appliesToType: "cx",
  kpiDefinitionId: b.kpiDefinitionId,
  unitValue: "125000",
  currency: "SAR",
  ...extra,
});
const propose = async (extra: Record<string, unknown> = {}, session = b.s.bo) => {
  const r = await call(api.app, "POST", M, { session, body: methodBody(extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; status: string };
};
const decide = (id: string, body: Record<string, unknown>, version = 1, session = b.s.fin) =>
  call(api.app, "POST", `${M}/${id}/decision`, { session, headers: ifm(version), body });
const notApproved = (code: string) => [
  422,
  "benefit.valuation_method_not_approved",
  `The valuation method ${code} is not approved by Finance, or is in another currency.`,
];

describe("controlled monetisation (REQ-S08-010)", () => {
  it("a SAR value on a CX benefit is rejected without an approved method, and accepted once Finance approves", async () => {
    // No method at all.
    const none = await call(api.app, "POST", B, { session: b.s.bo, body: cxBody(b, { plannedValue: "500000" }) });
    expect([none.status, none.body.code, none.body.detail]).toEqual([
      422,
      "benefit.valuation_method_required",
      "A non-financial benefit has no SAR value (n/a) unless an approved valuation method is selected.",
    ]);
    // A proposed (not yet approved) method.
    const m = await propose();
    expect(m.code).toMatch(/^VM-[0-9]{2,6}$/);
    expect(m.status).toBe("proposed");
    const proposed = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "500000", valuationMethodId: m.id }),
    });
    expect([proposed.status, proposed.body.code, proposed.body.detail]).toEqual(notApproved(m.code));
    // Finance approves; the same SAR value is now accepted and Value (SAR) is known.
    const approved = await decide(m.id, { decision: "approved", note: "Synthetic approval" });
    expect([approved.status, approved.body.status, approved.body.decidedBy, approved.headers.etag]).toEqual([
      200,
      "approved",
      b.users.fin.id,
      '"2"',
    ]);
    const ok = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "500000", valuationMethodId: m.id }),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const row = (
      (await call(api.app, "GET", `${B}?limit=100`, { session: b.s.auditor })).body.items as {
        id: string;
        valueSar: unknown;
      }[]
    ).find((x) => x.id === ok.body.id)!;
    expect(row.valueSar).toEqual({ status: "known", amount: "500000.0000", currency: "SAR", reason: null });
    // A scenario value with a SAR amount is accepted for the approved-method benefit too.
    const sc = await call(api.app, "POST", `${b.base}/benefit-scenarios`, {
      session: b.s.tl,
      body: { kind: "base", title: "Synthetic base" },
    });
    const sv = await call(api.app, "POST", `${b.base}/benefit-scenarios/${sc.body.id}/values`, {
      session: b.s.tl,
      body: { benefitId: ok.body.id, periodStart: "2026-01-01", periodEnd: "2026-12-31", amount: "400000" },
    });
    expect([sv.status, sv.body.amount]).toEqual([201, "400000.0000"]);
    expect((await auditOf(api.db, m.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["benefit_valuation_method.propose", 1],
      ["benefit_valuation_method.decide", 2],
    ]);
    // A method in another currency is not usable for a SAR benefit.
    const usd = await propose({ currency: "USD" });
    expect((await decide(usd.id, { decision: "approved" })).status).toBe(200);
    const mismatch = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "1", valuationMethodId: usd.id }),
    });
    expect([mismatch.status, mismatch.body.code]).toEqual(notApproved(usd.code).slice(0, 2));
  });

  it("reject needs a note; a rejected method cannot be decided again or referenced", async () => {
    const m = await propose();
    const noNote = await decide(m.id, { decision: "rejected" });
    expect([noNote.status, noNote.body.code, noNote.body.detail]).toEqual([
      422,
      "benefit_valuation_method.note_required",
      "A rejection needs a note.",
    ]);
    const rejected = await decide(m.id, { decision: "rejected", note: "No evidence for the unit value (synthetic)." });
    expect([rejected.status, rejected.body.status, rejected.body.decisionNote]).toEqual([
      200,
      "rejected",
      "No evidence for the unit value (synthetic).",
    ]);
    const again = await decide(m.id, { decision: "approved" }, 2);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "benefit_valuation_method.not_proposed",
      "Only a proposed valuation method can be decided.",
    ]);
    const ref = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "1", valuationMethodId: m.id }),
    });
    expect([ref.status, ref.body.code]).toEqual(notApproved(m.code).slice(0, 2));
  });

  it("retire: only an approved method; it stays valid for existing benefits, new references are refused", async () => {
    const m = await propose();
    const early = await decide(m.id, { decision: "retired" });
    expect([early.status, early.body.code, early.body.detail]).toEqual([
      422,
      "benefit_valuation_method.not_approved",
      "Only an approved valuation method can be retired.",
    ]);
    await decide(m.id, { decision: "approved" });
    const user = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "2000", valuationMethodId: m.id }),
    });
    expect(user.status).toBe(201);
    const retired = await decide(m.id, { decision: "retired", note: "Superseded (synthetic)" }, 2);
    expect([retired.status, retired.body.status, retired.body.decidedBy, retired.body.retiredAt === null]).toEqual([
      200,
      "retired",
      b.users.fin.id,
      false,
    ]);
    // Existing reference stays valid and readable; an unrelated edit of that benefit still saves.
    const edit = await call(api.app, "PATCH", `${B}/${user.body.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { title: "Synthetic retitled CX benefit" },
    });
    expect([edit.status, edit.body.valuationMethodId]).toEqual([200, m.id]);
    const fresh = await call(api.app, "POST", B, {
      session: b.s.bo,
      body: cxBody(b, { plannedValue: "1", valuationMethodId: m.id }),
    });
    expect([fresh.status, fresh.body.code]).toEqual(notApproved(m.code).slice(0, 2));
    expect((await auditOf(api.db, m.id)).map((a) => a.action)).toEqual([
      "benefit_valuation_method.propose",
      "benefit_valuation_method.decide",
      "benefit_valuation_method.retire",
    ]);
  });
});

describe("separation of duties and authorization (ADR-0029 §8, §9)", () => {
  it("the proposer cannot decide (403 decider_is_proposer) even when holding finance.validate", async () => {
    const both = await createUser(api.db, w.orgA.id);
    const scope = { type: "transformation" as const, id: b.transformationId };
    await grant(api.db, w.grantor.id, both.id, "BO", scope, w.orgA.id);
    await grant(api.db, w.grantor.id, both.id, "FIN", scope, w.orgA.id);
    const session = await signIn(api.app, both.subject);
    const m = await propose({}, session);
    const r = await decide(m.id, { decision: "approved" }, 1, session);
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      403,
      "benefit_valuation_method.decider_is_proposer",
      "The person who proposed this valuation method cannot decide it.",
    ]);
    expect((await decide(m.id, { decision: "approved" })).status).toBe(200);
  });

  it("decision: BO, TL, AUD, ADM-only 403; proposal: AUD, ADM-only, FIN 403; If-Match 428/409; 400; 404", async () => {
    const m = await propose();
    for (const session of [b.s.bo, b.s.tl, b.s.auditor, b.s.admin]) {
      const r = await decide(m.id, { decision: "approved" }, 1, session);
      expect([r.status, r.body.type]).toEqual([403, "urn:mth:problem:forbidden"]);
    }
    for (const session of [b.s.auditor, b.s.admin, b.s.fin])
      expect((await call(api.app, "POST", M, { session, body: methodBody() })).status).toBe(403);
    expect(
      (await call(api.app, "POST", `${M}/${m.id}/decision`, { session: b.s.fin, body: { decision: "approved" } }))
        .status,
    ).toBe(428);
    expect((await decide(m.id, { decision: "approved" }, 4)).status).toBe(409);
    expect((await decide(m.id, { decision: "proposed" })).status).toBe(400);
    expect((await call(api.app, "POST", M, { session: b.s.tl, body: methodBody({ unitValue: 125000 }) })).status).toBe(
      400,
    );
    expect((await decide("01920000-0000-7000-8000-0000000fffff", { decision: "approved" })).status).toBe(404);
    const other = await seedBenefitWorld(api, w);
    const foreignKpi = await call(api.app, "POST", M, {
      session: b.s.tl,
      body: methodBody({ kpiDefinitionId: other.kpiDefinitionId }),
    });
    expect([foreignKpi.status, foreignKpi.body.code]).toEqual([422, "validation.reference"]);
    const list = await call(api.app, "GET", `${M}?limit=100`, { session: b.s.auditor });
    expect(list.status).toBe(200);
    expect((list.body.items as { id: string }[]).map((x) => x.id)).toContain(m.id);
    expect((await call(api.app, "GET", M, { session: b.s.outsider })).status).toBe(404);
    // Nothing was decided by the refused callers.
    const row = await api.db
      .selectFrom("benefit_valuation_method")
      .select(["status", "version"])
      .where("id", "=", m.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "proposed", version: 1 });
  });

  it("commit-time: a FIN grant revoked while the decision waited is 403; nothing written", async () => {
    const m = await propose();
    const u = await extraUser(api, w, b, "FIN");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${M}/${m.id}/decision`, {
          session: u.session,
          headers: ifm(1),
          body: { decision: "approved" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("benefit_valuation_method")
      .select(["status", "version"])
      .where("id", "=", m.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "proposed", version: 1 });
  });
});
