// F-DG4-103 (T-DG4-BE-R5; D-117): the product gate operations P4 extends re-check authorization at COMMIT time, with
// the DG3 lesson-4 pattern (refreshPrincipal on reloaded grants, then commitTimeDenial), against a real PostgreSQL:
//  - decideGate: an approver whose grant is revoked after the request was authenticated, and before the decision
//    transaction commits, gets 403 and no decision is recorded (revoking every grant: 403 `forbidden`; revoking only the
//    approver role while the read remains: 403 `gate.not_approver`); exactly one `authorization.denied` is written; a
//    session that ended meanwhile gives 401;
//  - submitGate and updateGate: the same revocation gives 403, nothing written, exactly one `authorization.denied`;
//  - controls: the same request with nothing revoked in the window still succeeds (201 / 200), so each refusal is
//    caused by the revocation.
// The window is made deterministic by the BE18A technique (calendar/session-lock.ts): the request stops in the
// identity hook after its grants were loaded, the grant is revoked, and the request then runs.
// All data is SYNTHETIC. Every gate decision here is a demo business decision by a test person that approves nothing
// real, and nothing touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  grant,
  seedWorld,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, endSessions, revokeAll } from "../calendar/session-lock.ts";
import {
  coverGate,
  g5Approval,
  pendingGate,
  plusDays,
  requesterApprover,
  seedGateWorld,
  stageGates,
  todayOf,
  type GateWorld,
} from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const COMMIT_TIME_DETAIL = "Your access to this record changed while the request was in progress.";
const nothing = async () => {};

const gateRow = (g: GateWorld, code: string) =>
  api.db
    .selectFrom("gate_instance")
    .select(["version", "approver_role_code", "status"])
    .where("transformation_id", "=", g.b.transformationId)
    .where("gate_code", "=", code)
    .executeTakeFirstOrThrow();
const countOf = async (table: "gate_decision" | "gate_submission" | "decision", g: GateWorld) =>
  (await api.db.selectFrom(table).select("id").where("transformation_id", "=", g.b.transformationId).execute()).length;
/** The audit rows of one request: the failed mutation writes exactly one `authorization.denied`, nothing else. */
const deniedOf = async (res: Res) => {
  const rows = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
  return rows.map((e) => [e.action, e.actor_user_id, e.reason]);
};
const revokeRole = (userId: string, roleCode: string) =>
  api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic commit-time test'
      where user_id = $2 and revoked_at is null and role_id = (select id from role where code = $3)`,
    [w.grantor.id, userId, roleCode],
  );

/** A G5 pending submission by the TL, G1-G4 staged approved (the g5-g6.test precedent); the SP is the approver. */
async function pendingG5() {
  const g = await seedGateWorld(api, w);
  await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
  return { g, no: await pendingGate(api, g, "G5") };
}

describe("decideGate re-checks authorization at commit time (F-DG4-103)", () => {
  it("control: with nothing revoked in the window, the Sponsor's G5 decision is 201", async () => {
    const { g, no } = await pendingG5();
    const res = await afterIdentity(
      api,
      g.sp.id,
      () => send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) }),
      nothing,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await countOf("gate_decision", g)).toBe(1);
  });

  it("every grant of the Sponsor revoked after authentication: 403, no decision, one authorization.denied", async () => {
    const { g, no } = await pendingG5();
    const res = await afterIdentity(
      api,
      g.sp.id,
      () => send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no), contract: false }),
      () => revokeAll(api, w.grantor.id, g.sp.id),
    );
    expect([res.status, (res.body as Body).code, (res.body as Body).detail]).toEqual([
      403,
      "forbidden",
      COMMIT_TIME_DETAIL,
    ]);
    expect(await countOf("gate_decision", g)).toBe(0);
    expect(await countOf("decision", g)).toBe(0);
    expect((await gateRow(g, "G5")).status).not.toBe("approved");
    expect(await deniedOf(res)).toEqual([
      [
        "authorization.denied",
        g.sp.id,
        "POST /api/v1/transformations/:transformationId/gates/:gateCode/decision requires transformation.read",
      ],
    ]);
  });

  it("only the approver role revoked (the read remains): 403 gate.not_approver, no decision, one authorization.denied", async () => {
    const { g, no } = await pendingG5();
    const both = await requesterApprover(api, w, g); // holds TL and SP on the transformation; did not submit
    const res = await afterIdentity(
      api,
      both.id,
      () => send("POST", `${g.gates}/G5/decision`, { session: both.session, body: g5Approval(g, no) }),
      async () => {
        await revokeRole(both.id, "SP");
      },
    );
    expect([res.status, (res.body as Body).code]).toEqual([403, "gate.not_approver"]);
    expect(await countOf("gate_decision", g)).toBe(0);
    expect(await deniedOf(res)).toEqual([
      [
        "authorization.denied",
        both.id,
        "POST /api/v1/transformations/:transformationId/gates/:gateCode/decision requires gate.decide",
      ],
    ]);
  });

  it("the Sponsor's session ended after authentication: 401, no decision, no audit row", async () => {
    const { g, no } = await pendingG5();
    const res = await afterIdentity(
      api,
      g.sp.id,
      () => send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no), contract: false }),
      (locker) => endSessions(locker, g.sp.id),
    );
    expect(res.status).toBe(401);
    expect(await countOf("gate_decision", g)).toBe(0);
    expect(await deniedOf(res)).toEqual([]);
  });
});

describe("submitGate re-checks authorization at commit time (F-DG4-103)", () => {
  /** A gate world whose G1 mandatory criteria are covered by accepted exceptions, so a TL submission is 201. */
  async function readyG1() {
    const g = await seedGateWorld(api, w);
    await coverGate(send, g, "G1", plusDays(await todayOf(api, g), 30));
    return g;
  }
  const submitG1 = async (g: GateWorld, contract = true) => {
    const v = (await gateRow(g, "G1")).version;
    return send("POST", `${g.gates}/G1/submissions`, {
      session: g.b.s.tl,
      headers: ifm(v),
      body: { submissionNote: "Synthetic submission" },
      contract,
    });
  };

  it("control: with nothing revoked in the window, the TL's G1 submission is 201", async () => {
    const g = await readyG1();
    const res = await afterIdentity(api, g.b.users.tl.id, () => submitG1(g), nothing);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await countOf("gate_submission", g)).toBe(1);
  });

  it("the TL's grants revoked after authentication: 403, no submission, gate unchanged, one authorization.denied", async () => {
    const g = await readyG1();
    const before = await gateRow(g, "G1");
    const res = await afterIdentity(
      api,
      g.b.users.tl.id,
      () => submitG1(g, false),
      () => revokeAll(api, w.grantor.id, g.b.users.tl.id),
    );
    expect([res.status, (res.body as Body).code, (res.body as Body).detail]).toEqual([
      403,
      "forbidden",
      COMMIT_TIME_DETAIL,
    ]);
    expect(await countOf("gate_submission", g)).toBe(0);
    expect(await gateRow(g, "G1")).toEqual(before);
    expect(await deniedOf(res)).toEqual([
      [
        "authorization.denied",
        g.b.users.tl.id,
        "POST /api/v1/transformations/:transformationId/gates/:gateCode/submissions requires transformation.read",
      ],
    ]);
  });
});

describe("updateGate re-checks authorization at commit time (F-DG4-103)", () => {
  const configure = (g: GateWorld, version: number, contract = true) =>
    send("PATCH", `${g.gates}/G5`, {
      session: g.s.to.session,
      headers: ifm(version),
      body: { approverRoleCode: "BO" },
      contract,
    });

  it("control: with nothing revoked in the window, the TO configures the G5 approver (200)", async () => {
    const g = await seedGateWorld(api, w);
    const v = (await gateRow(g, "G5")).version;
    const res = await afterIdentity(api, g.s.to.id, () => configure(g, v), nothing);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await gateRow(g, "G5")).approver_role_code).toBe("BO");
  });

  it("the TO's grants revoked after authentication: 403, approver unchanged, one authorization.denied", async () => {
    const g = await seedGateWorld(api, w);
    const before = await gateRow(g, "G5");
    const res = await afterIdentity(
      api,
      g.s.to.id,
      () => configure(g, before.version, false),
      () => revokeAll(api, w.grantor.id, g.s.to.id),
    );
    expect([res.status, (res.body as Body).code, (res.body as Body).detail]).toEqual([
      403,
      "forbidden",
      COMMIT_TIME_DETAIL,
    ]);
    expect(await gateRow(g, "G5")).toEqual(before);
    expect(await deniedOf(res)).toEqual([
      [
        "authorization.denied",
        g.s.to.id,
        "PATCH /api/v1/transformations/:transformationId/gates/:gateCode requires transformation.read",
      ],
    ]);
  });

  it("only the configure right revoked (the read remains through another role): 403, one authorization.denied naming gate.configure", async () => {
    const g = await seedGateWorld(api, w);
    const before = await gateRow(g, "G5");
    // The TO also holds the read-only AUD role on the transformation; only TO (gate.configure) is revoked.
    await grant(
      api.db,
      w.grantor.id,
      g.s.to.id,
      "AUD",
      { type: "transformation", id: g.b.transformationId },
      w.orgA.id,
    );
    const res = await afterIdentity(
      api,
      g.s.to.id,
      () => configure(g, before.version, false),
      async () => {
        await revokeRole(g.s.to.id, "TO");
      },
    );
    expect([res.status, (res.body as Body).code]).toEqual([403, "forbidden"]);
    expect(await gateRow(g, "G5")).toEqual(before);
    expect(await deniedOf(res)).toEqual([
      [
        "authorization.denied",
        g.s.to.id,
        "PATCH /api/v1/transformations/:transformationId/gates/:gateCode requires gate.configure",
      ],
    ]);
  });
});
