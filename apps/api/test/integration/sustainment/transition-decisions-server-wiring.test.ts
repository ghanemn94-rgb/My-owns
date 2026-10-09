// BE-J production wiring (T-DG4-BE-R1; D-107 "still owed": a test that builds the real server through the harness
// without wiring anything by hand and proves submitTransitionDecision works). This file is on its own so that no other
// test's wiring can leak into it: Vitest isolates the module graph of every test file, and nothing here calls
// `wireTransitionDecisionApprovals`, `wireApprovals`, `seedClosureWorld` or `closeTransformationGoverned` (the helpers
// that wire the port by hand). The world is built from the same non-wiring fixtures `seedClosureWorld` uses.
//
// Proof that the composition root does the wiring: the sustainment module is wrapped (vi.mock with the real module
// behind it) only to COUNT calls to `wireTransitionDecisionApprovals`. Before the harness builds the server the count is
// 0; after `startApi()` (the real `buildServer` of src/server.ts) it is 1; the submit then answers 200 `submitted` and
// the canonical approval of type benefit_transition_decision exists, pending, for the decision. Unwired, the submit
// fails closed with 500 (transition-decisions.ts header), so a 2xx here is only possible through server.ts's wiring.
// All data is SYNTHETIC; nothing is approved, nobody decides anything, and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as TransitionDecisions from "../../../src/modules/sustainment/transition-decisions.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { seedSustainmentWorld } from "../contract/p4-exercises-be-i.ts";
import {
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  setTransformationStatus,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

const wiring = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../../src/modules/sustainment/transition-decisions.ts", async (importOriginal) => {
  const real = await importOriginal<typeof TransitionDecisions>();
  return {
    ...real,
    wireTransitionDecisionApprovals: (...args: Parameters<typeof real.wireTransitionDecisionApprovals>) => {
      wiring.calls += 1;
      return real.wireTransitionDecisionApprovals(...args);
    },
  };
});

let api: TestApi;
let w: World;
let c: ClosureWorld;
let callsBeforeServer = -1;
beforeAll(async () => {
  callsBeforeServer = wiring.calls;
  api = await startApi();
  w = await seedWorld(api.db);
  // seedClosureWorld without its wireApprovals() line: the sustainment world, an SP user mapped as the SP party (the
  // transition-decision approver), and the transformation made active.
  const s = await seedSustainmentWorld(api, w);
  const { b } = s;
  const sp = await extraUser(api, w, b, "SP");
  const mapped = await call(api.app, "POST", `${b.base}/role-mappings`, {
    session: b.s.tl,
    body: { partyCode: "SP", targetKind: "user", userId: sp.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  await setTransformationStatus(api.db, b, "active");
  c = {
    s,
    b,
    sp: { id: sp.id, session: sp.session },
    status: (initiativeId) => `/api/v1/initiatives/${initiativeId}`,
    transitions: `${b.base}/transition-decisions`,
  };
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("D-107: submitTransitionDecision through the real server's wiring", () => {
  it("the harness's buildServer wires the port exactly once; nothing in this file wires it", () => {
    expect(callsBeforeServer).toBe(0);
    expect(wiring.calls).toBe(1);
  });

  it("a BO submits a draft decision: 200 submitted, and one pending benefit_transition_decision approval", async () => {
    const ini = await launchedInitiative(api.db, c.b);
    const ben = await pendingBenefit(api, c, ini);
    const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
    const td = await draftDecision(send, c, ben.id);
    const sub = await call(api.app, "POST", `${c.transitions}/${td.id}/submit`, {
      session: c.b.s.bo,
      headers: ifm(td.version),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.status).toBe("submitted");
    const approvals = await api.db
      .selectFrom("approval")
      .select(["approval_type", "status", "subject_id"])
      .where("subject_id", "=", td.id)
      .execute();
    expect(approvals).toEqual([{ approval_type: "benefit_transition_decision", status: "pending", subject_id: td.id }]);
    expect(wiring.calls).toBe(1);
  });
});
