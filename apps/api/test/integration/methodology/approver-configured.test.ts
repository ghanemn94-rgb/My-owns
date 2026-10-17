// T-DG5-BE-C4 (D-164 b; BE-C3 handback §2.4; REQ-S06-004; ADR-0039 §3, ADR-0015 §2; migration 0094) against a real
// PostgreSQL: an explicit approver configuration is remembered in gate_instance.approver_configured.
//  - a role-only explicit SP configuration of G3, on a transformation pinned to a methodology version whose G3 default
//    is BO, routes the next G3 submission to SP and reports SP (gate read, submission, worker SQL twin);
//  - a never-configured G3 on the same kind of transformation follows BO;
//  - the configuration sets the flag in the same update and audit event (version step, If-Match, authorization);
//    a refused configuration (AUD 403, stale 409, missing If-Match 428) leaves it false;
//  - the 0094 backfill marks an instance with a 'gate_instance.configure' audit event and leaves the others false,
//    changing no other value (version, updated_at, updated_by stay; p5-plan R2).
// The Modular-entry world at Design is used because G3 is its first submittable gate. All data is synthetic; every
// gate decision, exception and waiver here is a demo BUSINESS decision by test persons in a test world and approves
// nothing real. Nothing here touches the engineering gates DG0-DG7.
import { readFileSync } from "node:fs";
import { businessDateOf } from "@mth/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveGateApproverOf } from "../../../../worker/src/handlers/gates.ts";
import { auditOf, call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedModularWorld, type ModularWorld } from "../contract/p4-exercises-be-m.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "./migration-fixtures.ts";

let api: TestApi;
let w: World;
let v2: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const key = freshKey("methodology");
  await seedPublishedVersion(api, "methodology", key, 1);
  v2 = await seedPublishedVersion(api, "methodology", key, 2, [
    { elementType: "gate", stableKey: "G3", attributes: { defaultApproverRoleCode: "BO" } },
  ]);
}, 120_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const TZ = "Asia/Riyadh";
const DAY = 86_400_000;
const inDays = (n: number) => businessDateOf(new Date(Date.now() + n * DAY), TZ);
const MIGRATION_0094 = new URL(
  "../../../../../packages/db/migrations/0094_p5_gate_approver_configured.sql",
  import.meta.url,
);

const gateRow = (mw: ModularWorld, gateCode: string) =>
  api.db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", mw.transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirstOrThrow();

/** A Modular world at Design pinned to the synthetic v2, whose G3 default approver is BO. */
async function pinnedWorld(): Promise<ModularWorld> {
  const mw = await seedModularWorld(api, w);
  await pinFixture(api, {
    organizationId: mw.organizationId,
    transformationId: mw.transformationId,
    kind: "methodology",
    versionId: v2,
    by: mw.users.tl.id,
  });
  return mw;
}

const configureG3 = async (mw: ModularWorld, body: Record<string, unknown>, session: Session = mw.s.to) =>
  send("PATCH", `${mw.base}/gates/G3`, { session, headers: ifm((await gateRow(mw, "G3")).version), body });

/** Covers G3's mandatory criteria with accepted exceptions, and its Modular links with an accepted waiver, each
 * decided by `decider` (the gate's effective approver), then submits G3. */
async function submitG3(mw: ModularWorld, decider: Session, covered: readonly string[] = []) {
  const keys = await api.db
    .selectFrom("gate_criterion_definition as c")
    .innerJoin("gate_definition as d", "d.id", "c.gate_definition_id")
    .select("c.key")
    .where("d.code", "=", "G3")
    .where("c.mandatory", "=", true)
    .orderBy("c.ordinal")
    .execute();
  for (const { key } of keys.filter((k) => !covered.includes(k.key))) {
    const ex = await send("POST", `${mw.base}/gate-exceptions`, {
      session: mw.s.tl,
      body: {
        gateCode: "G3",
        criterionKey: key,
        reason: "Synthetic: test fixture coverage of a criterion this test does not exercise.",
        scope: `Synthetic: ${key} only`,
        compensatingAction: "Synthetic: complete the criterion before the next gate.",
        compensatingOwnerUserId: mw.users.tl.id,
        expiresOn: inDays(60),
      },
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const d = await send("POST", `${mw.base}/gate-exceptions/${ex.body.id}/decision`, {
      session: decider,
      headers: ifm(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic demo decision; approves nothing real." },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
  const waiver = await send("POST", `${mw.base}/gate-dispensations`, {
    session: mw.s.tl,
    body: {
      kind: "waiver",
      gateCode: "G3",
      reason: "Synthetic: the inherited baseline is being located; the design may go to G3 meanwhile.",
      expiresOn: inDays(30),
    },
  });
  expect(waiver.status, JSON.stringify(waiver.body)).toBe(201);
  const accepted = await send("POST", `${mw.base}/gate-dispensations/${waiver.body.id}/decision`, {
    session: decider,
    headers: ifm(waiver.body.version),
    body: { result: "accepted", note: "Synthetic demo decision." },
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const sub = await send("POST", `${mw.base}/gates/G3/submissions`, {
    session: mw.s.tl,
    headers: ifm((await gateRow(mw, "G3")).version),
    body: { submissionNote: "Synthetic submission" },
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return sub.body;
}

const g3Read = async (mw: ModularWorld) => {
  const r = await send("GET", `${mw.base}/gates/G3`, { session: mw.s.tl });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const worker = async (mw: ModularWorld) => {
  const id = (await gateRow(mw, "G3")).id;
  const a = await api.db.transaction().execute((tx) => effectiveGateApproverOf(tx, id));
  return [a.roleCode, a.userId];
};

describe("D-164 (b): an explicit role-only configuration of the catalogue default is remembered", () => {
  it("SP configured role-only on a BO-default G3: reported SP, the next submission routes to SP, the worker agrees", async () => {
    const mw = await pinnedWorld();
    // Before: never configured, the pinned default (BO) is reported.
    const before = await g3Read(mw);
    expect([before.gate.approverRoleCode, before.gate.approverUserId]).toEqual(["BO", null]);
    expect((await gateRow(mw, "G3")).approver_configured).toBe(false);

    const prior = await gateRow(mw, "G3");
    const r = await configureG3(mw, { approverRoleCode: "SP" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.gate.approverRoleCode, r.body.gate.approverUserId]).toEqual(["SP", null]);
    expect(r.body.gate.version).toBe(prior.version + 1);
    expect(r.headers["etag"]).toBe(`"${prior.version + 1}"`);
    const stored = await gateRow(mw, "G3");
    expect([stored.approver_role_code, stored.approver_user_id, stored.approver_configured]).toEqual([
      "SP",
      null,
      true,
    ]);
    // The flag is set in the same audit event as the configuration.
    const events = (await auditOf(api.db, stored.id)).filter((e) => e.action === "gate_instance.configure");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ prior_version: prior.version, new_version: stored.version });
    expect((events[0] as Body).changes.approverConfigured).toEqual({ from: false, to: true });

    const after = await g3Read(mw);
    expect([after.gate.approverRoleCode, after.gate.approverUserId]).toEqual(["SP", null]);
    const list = await send("GET", `${mw.base}/gates`, { session: mw.s.tl });
    expect(list.body.items.find((v: Body) => v.gate.gateCode === "G3").gate.approverRoleCode).toBe("SP");
    expect(await worker(mw)).toEqual(["SP", null]);

    // The BO is no longer the approver: its decision on an exception is refused; the Sponsor decides.
    const ex = await send("POST", `${mw.base}/gate-exceptions`, {
      session: mw.s.tl,
      body: {
        gateCode: "G3",
        criterionKey: "g3.target_operating_model",
        reason: "Synthetic exception for the approver-configured test",
        scope: "Synthetic scope of the exception",
        compensatingAction: "Synthetic compensating action",
        compensatingOwnerUserId: mw.users.tl.id,
        expiresOn: inDays(60),
      },
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const byBo = await send("POST", `${mw.base}/gate-exceptions/${ex.body.id}/decision`, {
      session: mw.s.bo,
      headers: ifm(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic demo decision; approves nothing real." },
    });
    expect([byBo.status, byBo.body.code]).toEqual([403, "gate_exception.not_approver"]);
    const bySp = await send("POST", `${mw.base}/gate-exceptions/${ex.body.id}/decision`, {
      session: mw.s.sp,
      headers: ifm(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic demo decision; approves nothing real." },
    });
    expect(bySp.status, JSON.stringify(bySp.body)).toBe(200);

    const sub = await submitG3(mw, mw.s.sp, ["g3.target_operating_model"]);
    expect([sub.approverRoleCode, sub.approverUserId]).toEqual(["SP", null]);
    const decidedByBo = await send("POST", `${mw.base}/gates/G3/decision`, {
      session: mw.s.bo,
      headers: ifm((await gateRow(mw, "G3")).version),
      body: { submissionNo: sub.submissionNo, outcome: "approved", rationale: "Synthetic demo decision." },
    });
    expect(decidedByBo.status).toBe(403);
  }, 120_000);

  it("a never-configured G3 on the same pinned version follows BO (today's rule), for the submission too", async () => {
    const mw = await pinnedWorld();
    expect((await gateRow(mw, "G3")).approver_configured).toBe(false);
    expect((await g3Read(mw)).gate.approverRoleCode).toBe("BO");
    expect(await worker(mw)).toEqual(["BO", null]);
    const sub = await submitG3(mw, mw.s.bo);
    expect([sub.approverRoleCode, sub.approverUserId]).toEqual(["BO", null]);
    expect((await gateRow(mw, "G3")).approver_configured).toBe(false);
  }, 120_000);

  it("a refused configuration leaves the flag false: AUD 403, stale 409, missing If-Match 428", async () => {
    const mw = await pinnedWorld();
    const v = (await gateRow(mw, "G3")).version;
    const aud = await configureG3(mw, { approverRoleCode: "SP" }, mw.s.auditor);
    expect(aud.status).toBe(403);
    const stale = await send("PATCH", `${mw.base}/gates/G3`, {
      session: mw.s.to,
      headers: ifm(v + 5),
      body: { approverRoleCode: "SP" },
    });
    expect(stale.status).toBe(409);
    const missing = await send("PATCH", `${mw.base}/gates/G3`, { session: mw.s.to, body: { approverRoleCode: "SP" } });
    expect(missing.status).toBe(428);
    const row = await gateRow(mw, "G3");
    expect([row.version, row.approver_configured]).toEqual([v, false]);
    expect((await g3Read(mw)).gate.approverRoleCode).toBe("BO");
  }, 120_000);
});

describe("0094: the backfill marks every instance with a gate_instance.configure audit event", () => {
  it("re-applied to the pre-0094 table (in a rolled-back transaction): configured → true, others false, nothing else changes", async () => {
    const configured = await pinnedWorld();
    const r = await configureG3(configured, { approverRoleCode: "SP" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const never = await pinnedWorld();
    const ids = [(await gateRow(configured, "G3")).id, (await gateRow(never, "G3")).id];
    const snapshot = async (q: (text: string, values?: unknown[]) => Promise<{ rows: Body[] }>) =>
      (
        await q(
          `SELECT id, approver_role_code, approver_user_id, status, version, updated_at, updated_by
             FROM gate_instance WHERE id = ANY($1::uuid[]) ORDER BY id`,
          [ids],
        )
      ).rows;

    const client = await api.owner.connect();
    try {
      await client.query("BEGIN");
      const before = await snapshot((t, v) => client.query(t, v));
      // The pre-0094 table, then the migration file exactly as shipped.
      await client.query("ALTER TABLE gate_instance DROP COLUMN approver_configured");
      await client.query(readFileSync(MIGRATION_0094, "utf8"));
      const flags = (
        await client.query<{ id: string; approver_configured: boolean }>(
          "SELECT id, approver_configured FROM gate_instance WHERE id = ANY($1::uuid[])",
          [ids],
        )
      ).rows;
      expect(Object.fromEntries(flags.map((f) => [f.id, f.approver_configured]))).toEqual({
        [ids[0]!]: true,
        [ids[1]!]: false,
      });
      expect(await snapshot((t, v) => client.query(t, v))).toEqual(before);
      // The guards are back on after the backfill: an update without a version step is still refused.
      await client.query("SAVEPOINT guard");
      await expect(
        client.query("UPDATE gate_instance SET approver_configured = true WHERE id = $1", [ids[1]]),
      ).rejects.toThrow(/version must increase/);
      await client.query("ROLLBACK TO SAVEPOINT guard");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    // Rolled back: the live rows keep their values.
    expect((await gateRow(configured, "G3")).approver_configured).toBe(true);
    expect((await gateRow(never, "G3")).approver_configured).toBe(false);
  }, 120_000);
});
