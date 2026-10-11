// code-security-reviewer DG4 round-2 probe C (T-DG4-REV-SEC-R2): F-DG4-103 re-verification. decideGate, submitGate and
// updateGate must re-check authorization at COMMIT time: a change made after the request was authenticated and before
// its transaction runs must refuse the write. The window is made deterministic with the implementers' afterIdentity
// helper (used read-only; it holds the caller's session row so the request stops after its grants were loaded).
// Cases beyond the repair's own gate-commit-time.test.ts:
//   C1 decideGate BY A DELEGATE for the Sponsor: control 201 (decidedOnBehalfOf = SP); then the delegation is revoked in
//      the window -> 403 gate.not_approver, no decision, one authorization.denied.
//   C2 decideGate by a delegate when the DELEGATOR's SP role is revoked in the window -> 403, no decision.
//   C3 decideGate: the Sponsor's user is DISABLED in the window -> 401, no decision, no audit row.
//   C4 submitGate: the TL role revoked while the read remains (an AUD grant) -> 403 naming gate.submit, nothing written.
//   C5 updateGate: the TO role revoked while the read remains (an AUD grant) -> 403 naming gate.configure, unchanged.
//   C6 outsider (TO of org B) on all three: 404 at request start (the request-start check is unchanged). rev2: the 404
//      carries the read gate's denial, so denials.ts writes exactly one authorization.denied naming transformation.read
//      (platform design since DG2; rev1 wrongly expected no row).
// NOT product code; disposable clone only (apps/api/test/integration/zz-sec-dg4/). All data is synthetic; a demo
// gate decision approves nothing real and never relates to DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, grant, seedWorld, startApi, type Res, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity } from "../calendar/session-lock.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { coverGate, g5Approval, pendingGate, plusDays, seedGateWorld, stageGates, todayOf, type GateWorld } from "../contract/p4-exercises-be-k.ts";

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
const nothing = async () => {};
const audit = async (res: Res) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => [e.action, e.actor_user_id, e.reason]);
const count = async (table: "gate_decision" | "gate_submission", g: GateWorld) =>
  (await api.db.selectFrom(table).select("id").where("transformation_id", "=", g.b.transformationId).execute()).length;
const gateRow = (g: GateWorld, code: string) =>
  api.db.selectFrom("gate_instance").select(["version", "approver_role_code", "status"]).where("transformation_id", "=", g.b.transformationId).where("gate_code", "=", code).executeTakeFirstOrThrow();
const log = (label: string, res: Res, rows: unknown) => console.log(`[probe-C] ${label} -> ${res.status} ${(res.body as Body)?.code ?? ""} ${(res.body as Body)?.decidedOnBehalfOf ? "onBehalfOf=" + (res.body as Body).decidedOnBehalfOf : ""}; audit ${JSON.stringify(rows)}`);
const revokeRole = (userId: string, role: string) =>
  api.owner.query(`update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic probe C' where user_id = $2 and revoked_at is null and role_id = (select id from role where code = $3)`, [w.grantor.id, userId, role]);

async function pendingG5() {
  const g = await seedGateWorld(api, w);
  await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
  return { g, no: await pendingGate(api, g, "G5") };
}
async function delegateFor(g: GateWorld) {
  const d = await extraUser(api, w, g.b, "BO");
  const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const del = await send("POST", "/api/v1/delegations", {
    session: g.sp.session,
    body: { delegateUserId: d.id, recordTypes: ["gate"], reasonCode: "absence", absenceNote: "Synthetic leave", effectiveFrom: hours(-1), effectiveTo: hours(24) },
  });
  expect(del.status, JSON.stringify(del.body)).toBe(201);
  return { d, delegationId: (del.body as Body).id as string };
}
const decideAs = (g: GateWorld, no: number, session: unknown, onBehalfOf?: string, contract = false) =>
  send("POST", `${g.gates}/G5/decision`, { session: session as never, body: { ...g5Approval(g, no), ...(onBehalfOf ? { onBehalfOfUserId: onBehalfOf } : {}) }, contract });

describe("SEC-DG4-R2 probe C: gate operations re-check authorization at commit time", () => {
  it("C1 decideGate by a delegate: control 201; delegation revoked in the window -> 403, nothing decided", async () => {
    const a = await pendingG5();
    const da = await delegateFor(a.g);
    const ok = await afterIdentity(api, da.d.id, () => decideAs(a.g, a.no, da.d.session, a.g.sp.id), nothing);
    log("C1 control (delegate for SP)", ok, await audit(ok));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const b2 = await pendingG5();
    const db2 = await delegateFor(b2.g);
    const res = await afterIdentity(api, db2.d.id, () => decideAs(b2.g, b2.no, db2.d.session, b2.g.sp.id), async () => {
      await api.owner.query(`update delegation set status = 'revoked', version = version + 1, updated_at = now() where id = $1`, [db2.delegationId]);
    });
    const rows = await audit(res);
    log("C1 delegation revoked in window", res, rows);
    expect(res.status).toBe(403);
    expect(await count("gate_decision", b2.g)).toBe(0);
    expect(rows.map((r) => r[0])).toEqual(["authorization.denied"]);
  });

  it("C2 decideGate by a delegate: the delegator's SP role revoked in the window -> 403", async () => {
    const { g, no } = await pendingG5();
    const { d } = await delegateFor(g);
    const res = await afterIdentity(api, d.id, () => decideAs(g, no, d.session, g.sp.id), async () => { await revokeRole(g.sp.id, "SP"); });
    const rows = await audit(res);
    log("C2 delegator SP role revoked in window", res, rows);
    expect(res.status).toBe(403);
    expect(await count("gate_decision", g)).toBe(0);
    expect(rows.map((r) => r[0])).toEqual(["authorization.denied"]);
  });

  it("C3 decideGate: the Sponsor's user disabled in the window -> 401, nothing decided, no audit row", async () => {
    const { g, no } = await pendingG5();
    const res = await afterIdentity(api, g.sp.id, () => decideAs(g, no, g.sp.session), async () => {
      await api.owner.query(`update app_user set status = 'disabled' where id = $1`, [g.sp.id]);
    });
    const rows = await audit(res);
    log("C3 user disabled in window", res, rows);
    expect(res.status).toBe(401);
    expect(await count("gate_decision", g)).toBe(0);
    expect(rows).toEqual([]);
  });

  it("C4 submitGate: TL role revoked, read remains (AUD) -> 403 naming gate.submit; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    await coverGate(send, g, "G1", plusDays(await todayOf(api, g), 30));
    await grant(api.db, w.grantor.id, g.b.users.tl.id, "AUD", { type: "transformation", id: g.b.transformationId }, w.orgA.id);
    const before = await gateRow(g, "G1");
    const res = await afterIdentity(api, g.b.users.tl.id, () => send("POST", `${g.gates}/G1/submissions`, { session: g.b.s.tl, headers: ifm(before.version), body: { submissionNote: "Synthetic" }, contract: false }), async () => { await revokeRole(g.b.users.tl.id, "TL"); });
    const rows = await audit(res);
    log("C4 submitGate TL revoked, AUD remains", res, rows);
    expect(res.status).toBe(403);
    expect(await count("gate_submission", g)).toBe(0);
    expect(await gateRow(g, "G1")).toEqual(before);
    expect(rows.length).toBe(1);
    expect(String(rows[0]![2])).toMatch(/requires gate\.submit$/);
  });

  it("C5 updateGate: TO role revoked, read remains (AUD) -> 403 naming gate.configure; unchanged", async () => {
    const g = await seedGateWorld(api, w);
    await grant(api.db, w.grantor.id, g.s.to.id, "AUD", { type: "transformation", id: g.b.transformationId }, w.orgA.id);
    const before = await gateRow(g, "G5");
    const res = await afterIdentity(api, g.s.to.id, () => send("PATCH", `${g.gates}/G5`, { session: g.s.to.session, headers: ifm(before.version), body: { approverRoleCode: "BO" }, contract: false }), async () => { await revokeRole(g.s.to.id, "TO"); });
    const rows = await audit(res);
    log("C5 updateGate TO revoked, AUD remains", res, rows);
    expect(res.status).toBe(403);
    expect(await gateRow(g, "G5")).toEqual(before);
    expect(rows.length).toBe(1);
    expect(String(rows[0]![2])).toMatch(/requires gate\.configure$/);
  });

  it("C6 outsider (TO of org B): 404 on all three at request start, one denial each naming transformation.read", async () => {
    const { g, no } = await pendingG5();
    const outsider = await (async () => {
      const { createUser, signIn } = await import("../../support/harness.ts");
      const u = await createUser(api.db, w.orgB.id);
      await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgB.id }, w.orgB.id);
      return signIn(api.app, u.subject);
    })();
    const v1 = (await gateRow(g, "G1")).version;
    const v5 = (await gateRow(g, "G5")).version;
    const r = [
      await decideAs(g, no, outsider),
      await send("POST", `${g.gates}/G1/submissions`, { session: outsider, headers: ifm(v1), body: { submissionNote: "x" }, contract: false }),
      await send("PATCH", `${g.gates}/G5`, { session: outsider, headers: ifm(v5), body: { approverRoleCode: "BO" }, contract: false }),
    ];
    const rows = await Promise.all(r.map(audit));
    console.log(`[probe-C] C6 outsider -> ${r.map((x) => `${x.status} ${(x.body as Body).code}`).join(" / ")}; audit ${JSON.stringify(rows)}`);
    expect(r.map((x) => x.status)).toEqual([404, 404, 404]);
    expect(rows.map((x) => [x.length, x[0]![0], String(x[0]![2]).endsWith("requires transformation.read")])).toEqual([[1, "authorization.denied", true], [1, "authorization.denied", true], [1, "authorization.denied", true]]);
  });
});
