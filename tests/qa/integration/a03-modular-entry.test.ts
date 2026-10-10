// A03 "Modular entry" (qa-verifier, T-DG4-QA-C). Scenario (master prompt §20 A03): "Existing transformation enters at
// Design with inherited evidence; missing baseline/outcome links are flagged and cannot silently pass gates."
// Assertions are derived from the acceptance texts of REQ-PB-005, REQ-S03-005 and REQ-S20-003
// (docs/delivery/requirements.csv), D-110 / ADR-0021 amendment W1-W7 (the authorized Modular-links waiver) and
// docs/api/openapi.yaml:
//  - an inherited G2 approval is shown as 'inherited', never Approved, and creates no gate decision; a prior approval
//    cannot be fabricated as an inherited record;
//  - a transformation entering at Design with no baseline and no outcome link shows BOTH as missing (blocking);
//  - its G3 submission is refused with gate.modular_links_missing listing the missing links, until they are supplied,
//    or until an authorized (accepted, unexpired) waiver exists; a pending waiver does not count, and the waiver supplies
//    nothing (the links stay flagged);
//  - a revoked or expired waiver refuses the G3 approval; nothing is written by a refusal;
//  - an End-to-End G3 is unaffected by the Modular precondition.
// The expired case uses the API's injectable exception clock (setGateExceptionClock, a test seam of the gate-exception
// module; no row is edited). All data is SYNTHETIC. Every waiver, exception, inherited approval and gate decision is a
// synthetic in-product business action on test data; it approves nothing real and never touches DG0-DG7.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setGateExceptionClock } from "../../../apps/api/src/modules/workflows/gate-exceptions.ts";
import { call, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  coverWithException,
  gateView,
  missingKeys,
  passGatesNatively,
  seedNativeGateWorld,
  submitGate,
} from "../support/gates-native.ts";
import { expectCode, get200, ifMatch, seedWorld, type Body, type World } from "../support/p4.ts";
import {
  addBaseline,
  addEvidence,
  addInheritedApproval,
  addOutcomeKpi,
  businessToday,
  seedModularWorld,
  type ModularWorld,
} from "../support/a11.ts";

let api: TestApi;
let w: World;
let today: string;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const DAY = 86_400_000;
const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  today = await businessToday(api, w.orgA.id);
}, 120_000);
afterEach(() => setGateExceptionClock(null));
afterAll(async () => {
  setGateExceptionClock(null);
  await api.close();
}, 60_000);

const gateRow = (mw: ModularWorld, code: string) =>
  api.db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", mw.transformationId)
    .where("gate_code", "=", code)
    .executeTakeFirstOrThrow();
const counts = async (mw: ModularWorld) => ({
  submissions: (
    await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", mw.transformationId)
      .execute()
  ).length,
  decisions: (
    await api.db.selectFrom("gate_decision").select("id").where("transformation_id", "=", mw.transformationId).execute()
  ).length,
});
const blocking = async (mw: ModularWorld) => {
  const r = await get200(api, mw.s.auditor, `${mw.base}/missing-links`);
  return (r.items as Body[]).filter((i) => i.severity === "blocking").map((i) => i.code as string);
};

/** Every mandatory G3 criterion covered by an exception the Lead requests and the Sponsor accepts (synthetic). */
async function coverG3(mw: ModularWorld) {
  const v = await get200(api, mw.s.tl, `${mw.base}/gates/G3`);
  for (const c of v.criteria as Body[]) {
    if (!c.mandatory || c.completeness === "complete") continue;
    const ex = await send("POST", `${mw.base}/gate-exceptions`, {
      session: mw.s.tl,
      body: {
        gateCode: "G3",
        criterionKey: c.key,
        reason: "Synthetic QA: criterion not exercised by the A03 suite.",
        scope: `Synthetic QA: ${c.key} only`,
        compensatingAction: "Synthetic QA: complete before G4.",
        compensatingOwnerUserId: mw.users.tl.id,
        expiresOn: plus(60),
      },
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const d = await send("POST", `${mw.base}/gate-exceptions/${ex.body.id}/decision`, {
      session: mw.s.sp,
      headers: ifMatch(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic QA decision." },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
}
async function submitG3(mw: ModularWorld, session: Session = mw.s.tl) {
  return send("POST", `${mw.base}/gates/G3/submissions`, {
    session,
    headers: ifMatch((await gateRow(mw, "G3")).version),
    body: { submissionNote: "Synthetic QA G3 submission" },
  });
}
async function decideG3(mw: ModularWorld, submissionNo: number) {
  return send("POST", `${mw.base}/gates/G3/decision`, {
    session: mw.s.sp,
    headers: ifMatch((await gateRow(mw, "G3")).version),
    body: { submissionNo, outcome: "approved", rationale: "Synthetic QA decision; approves nothing real." },
  });
}
async function waiver(mw: ModularWorld, expiresOn: string, accept = true) {
  const r = await send("POST", `${mw.base}/gate-dispensations`, {
    session: mw.s.tl,
    body: {
      kind: "waiver",
      gateCode: "G3",
      reason: "Synthetic QA: the inherited baseline is being located; the design may go to G3 meanwhile.",
      expiresOn,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!accept) return r.body as Body;
  const d = await send("POST", `${mw.base}/gate-dispensations/${r.body.id}/decision`, {
    session: mw.s.sp,
    headers: ifMatch(r.body.version),
    body: { result: "accepted", note: "Synthetic QA authorization of a test waiver." },
  });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return d.body as Body;
}

// ================================================================================================ inherited evidence

describe("A03 REQ-S03-005: entering at Design with an inherited G2 approval", () => {
  let mw: ModularWorld;
  beforeAll(async () => {
    mw = await seedModularWorld(api, w);
    const ev = await addEvidence(send, mw, true);
    await addInheritedApproval(send, mw, ev, true, "G2");
  }, 120_000);

  it("REQ-S03-005: the transformation is Modular at Design", async () => {
    const r = await get200(api, mw.s.auditor, `${mw.base}/missing-links`);
    expect([r.mode, r.entryPhase]).toEqual(["modular", "design"]);
  });

  it("REQ-S03-005: G2 is labelled 'inherited', never Approved; no gate decision exists", async () => {
    const r = await get200(api, mw.s.auditor, `${mw.base}/missing-links`);
    const g2 = (r.gates as Body[]).find((x) => x.gateCode === "G2");
    expect(g2.label).toBe("inherited");
    expect(g2.status).not.toBe("approved");
    expect(g2.inheritedApproval).toMatchObject({
      status: "accepted",
      approvingBody: "Synthetic prior programme board",
    });
    expect((r.gates as Body[]).filter((x) => x.label === "approved")).toEqual([]);
    const view = await gateView(api, { gates: `${mw.base}/gates`, tl: { session: mw.s.auditor } } as never, "G2");
    expect(view.gate.status).not.toBe("approved");
    expect((await gateRow(mw, "G2")).status).not.toBe("approved");
    expect((await counts(mw)).decisions).toBe(0);
  });

  it("REQ-S03-005: the inherited approval is listed as a labelled inherited record; a prior approval cannot be fabricated", async () => {
    const list = await get200(api, mw.s.auditor, `${mw.base}/inherited-records`);
    const prior = (list.items as Body[]).filter((x) => x.kind === "prior_approval");
    expect(prior.map((x) => [x.gateCode, x.label])).toEqual([["G2", "inherited"]]);
    const fabricated = await send("POST", `${mw.base}/inherited-records`, {
      session: mw.s.tl,
      body: { kind: "prior_approval", sourceDescription: "Synthetic QA: claim a G3 approval" },
    });
    expectCode(fabricated, 422, "inherited_record.prior_approval_use_dispensation");
    // Inherited evidence is recorded with its provenance, labelled inherited.
    const ev = await addEvidence(send, mw, true);
    const rec = await send("POST", `${mw.base}/inherited-records`, {
      session: mw.s.tl,
      body: {
        kind: "evidence",
        evidenceId: ev,
        sourceDescription: "Synthetic QA: prior programme design pack",
        originalOwner: "Synthetic former PMO",
        originalDate: "2026-03-01",
      },
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect([rec.body.label, rec.body.kind, rec.body.originalOwner]).toEqual([
      "inherited",
      "evidence",
      "Synthetic former PMO",
    ]);
    expect((await counts(mw)).decisions).toBe(0);
  });
});

// ================================================================================================ missing links

describe("A03 REQ-PB-005, REQ-S03-005, REQ-S20-003: missing baseline and outcome links are flagged and block G3", () => {
  let mw: ModularWorld;
  beforeAll(async () => {
    mw = await seedModularWorld(api, w);
    await coverG3(mw);
  }, 120_000);

  it("REQ-PB-005: with no baseline and no outcome link both are flagged as blocking", async () => {
    expect(await blocking(mw)).toEqual(expect.arrayContaining(["baseline_missing", "outcome_link_missing"]));
  });

  it("REQ-PB-005: G3 submission is 422 gate.modular_links_missing listing both links; nothing is written", async () => {
    const before = { gate: await gateRow(mw, "G3"), ...(await counts(mw)) };
    const r = await submitG3(mw);
    expectCode(r, 422, "gate.modular_links_missing");
    expect((r.body.errors as Body[]).map((e) => e.code).sort()).toEqual(["baseline_missing", "outcome_link_missing"]);
    expect({ gate: await gateRow(mw, "G3"), ...(await counts(mw)) }).toEqual(before);
  });

  it("REQ-PB-005: with only the baseline supplied the refusal lists the outcome link alone", async () => {
    await addBaseline(send, mw);
    expect(await blocking(mw)).not.toContain("baseline_missing");
    const r = await submitG3(mw);
    expectCode(r, 422, "gate.modular_links_missing");
    expect((r.body.errors as Body[]).map((e) => e.code)).toEqual(["outcome_link_missing"]);
  });

  it("REQ-PB-005: once both links are supplied the G3 submission is accepted", async () => {
    await addOutcomeKpi(api.db, mw);
    expect(await blocking(mw)).not.toContain("outcome_link_missing");
    const r = await submitG3(mw);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await gateRow(mw, "G3")).status).toBe("submitted");
  });
});

// ================================================================================================ the waiver

describe("A03 D-110 / ADR-0021 W1-W7: an authorized waiver lets G3 through; a revoked or expired one refuses approval", () => {
  it("a pending waiver does not count; an accepted one lets G3 through while both links stay flagged", async () => {
    const mw = await seedModularWorld(api, w);
    await coverG3(mw);
    const pending = await waiver(mw, plus(30), false);
    expect(pending.status).toBe("pending");
    expectCode(await submitG3(mw), 422, "gate.modular_links_missing");
    // The recorder cannot authorize their own waiver.
    const self = await send("POST", `${mw.base}/gate-dispensations/${pending.id}/decision`, {
      session: mw.s.tl,
      headers: ifMatch(pending.version),
      body: { result: "accepted", note: "Synthetic QA self-approval attempt" },
    });
    expect(self.status).toBe(403);
    await waiver(mw, plus(30));
    const r = await submitG3(mw);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Not silent: the links remain flagged as missing.
    expect(await blocking(mw)).toEqual(expect.arrayContaining(["baseline_missing", "outcome_link_missing"]));
  });

  it("a waiver revoked after submission refuses the G3 approval (422 gate.modular_waiver_revoked); nothing is written", async () => {
    const mw = await seedModularWorld(api, w);
    await coverG3(mw);
    const wv = await waiver(mw, plus(30));
    const s = await submitG3(mw);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const rv = await send("POST", `${mw.base}/gate-dispensations/${wv.id}/revoke`, {
      session: mw.s.sp,
      headers: ifMatch(wv.version),
      body: { reason: "Synthetic QA: the baseline will not be found in time." },
    });
    expect(rv.status, JSON.stringify(rv.body)).toBe(200);
    const before = { gate: await gateRow(mw, "G3"), ...(await counts(mw)) };
    const d = await decideG3(mw, s.body.submissionNo);
    expectCode(d, 422, "gate.modular_waiver_revoked");
    expect({ gate: await gateRow(mw, "G3"), ...(await counts(mw)) }).toEqual(before);
    expect((await gateRow(mw, "G3")).status).not.toBe("approved");
  });

  it("a waiver expired by approval time refuses the G3 approval (422 gate.modular_waiver_expired); in force it is approved", async () => {
    const mw = await seedModularWorld(api, w);
    await coverG3(mw);
    await waiver(mw, plus(5));
    const s = await submitG3(mw);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    setGateExceptionClock(() => new Date(Date.now() + 7 * DAY));
    const before = { gate: await gateRow(mw, "G3"), ...(await counts(mw)) };
    const d = await decideG3(mw, s.body.submissionNo);
    expectCode(d, 422, "gate.modular_waiver_expired");
    expect({ gate: await gateRow(mw, "G3"), ...(await counts(mw)) }).toEqual(before);
    setGateExceptionClock(null);
    const ok = await decideG3(mw, s.body.submissionNo);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await gateRow(mw, "G3")).status).toBe("approved");
  });

  it("an expired waiver at submission time does not let G3 through", async () => {
    const mw = await seedModularWorld(api, w);
    await coverG3(mw);
    await waiver(mw, plus(2));
    setGateExceptionClock(() => new Date(Date.now() + 5 * DAY));
    expectCode(await submitG3(mw), 422, "gate.modular_links_missing");
  });
});

// ================================================================================================ End-to-End unaffected

describe("A03: an End-to-End G3 is unaffected by the Modular precondition", () => {
  it("End-to-End, G1-G2 approved, G3 criteria covered, no baseline and no outcome link: G3 submission is 201", async () => {
    const g = await seedNativeGateWorld(api, w, "A03 E2E");
    await passGatesNatively(api, g, ["G1", "G2"], plus(90));
    for (const key of await missingKeys(api, g, "G3")) await coverWithException(api, g, "G3", key, plus(90));
    const links = await get200(api, g.auditor.session, `${g.base}/missing-links`);
    expect(links.mode).toBe("end_to_end");
    const r = await submitGate(api, g, "G3");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.code).toBeUndefined();
  }, 240_000);
});
