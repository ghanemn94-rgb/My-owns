// The Modular G3 waiver of the missing-links precondition (T-DG4-BE-R3; D-110 option a; ADR-0021 amendment W1-W7,
// ADR-0038 amendment B1, B4; REQ-PB-005, REQ-S03-005). Proves, against the run's disposable PostgreSQL:
//  - W1: a Modular G3 waiver with no initiative is recorded (201, pending) through the DG3 route; G1, G2 and G3 with an
//    initiative still answer 422 dispensation.waiver_requires_end_to_end with the DG3 text;
//  - W2: G3's configured approver accepts it (200); the recorder (403) and a non-approver (403 gate.not_approver) cannot;
//  - B1: with criteria met and links missing, the G3 submission is 201 and its snapshot records `modularLinks` (missing
//    codes and the waiver used: the latest expiry, ties to the greatest id); the snapshot hash is in the audit event;
//    the missing-link report still lists both items; pending, rejected, revoked or (by the injected exception clock)
//    expired waivers → 422 gate.modular_links_missing;
//  - B1 at approval: the recorded waiver revoked → 422 gate.modular_waiver_revoked (revoke date); expired → 422
//    gate.modular_waiver_expired (expiry date); another waiver accepted later does not rescue the frozen submission;
//    rejecting stays allowed; with the waiver in force the approval is 201. Nothing is written by a refusal.
// When MTH_BE_R3_MODULAR_REFUSAL_TRANSCRIPT is set, the Modular refusals (G1, G2, G3 with an initiative) are recorded
// for the A/B byte comparison against the base commit's dispensations.ts and gates.ts (handback).
// Every waiver, exception and gate decision here is SYNTHETIC demo data by test persons and approves nothing real;
// nothing touches the engineering delivery gates DG0-DG7 (product G6 never implies DG7).
import { sql } from "@mth/db";
import { businessDateOf } from "@mth/shared/time";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setGateExceptionClock } from "../../../src/modules/workflows/gate-exceptions.ts";
import { auditOf, call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import { addBaseline, addOutcomeKpi, seedModularWorld, type ModularWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);
afterEach(() => setGateExceptionClock(null));

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const DAY = 86_400_000;
/** The business date n days from now in the worlds' timezone (asserted in readyWorld), the clock every check reads. */
const TZ = "Asia/Riyadh";
const inDays = (n: number) => businessDateOf(new Date(Date.now() + n * DAY), TZ);
const RATIONALE = "Synthetic demo decision: approves nothing real.";
const LINKS_DETAIL =
  "Modular entry: supply the missing baseline and outcome links, or record an authorized waiver, before submitting this gate.";
const NOT_E2E = "A waiver applies to the End-to-End launch sequencing; a Modular transformation is not held to it.";
const revokedDetail = (date: string) =>
  `The waiver of the missing baseline and outcome links was revoked on ${date}; supply them or record a new waiver, then resubmit G3.`;
const expiredDetail = (date: string) =>
  `The waiver of the missing baseline and outcome links expired on ${date}; supply them or record a new waiver, then resubmit G3.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { id: string; version: number } & Record<string, any>;

async function gateRow(mw: ModularWorld, gateCode: string) {
  return api.db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", mw.transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirstOrThrow();
}

async function g3State(mw: ModularWorld) {
  const submissions = await api.db
    .selectFrom("gate_submission")
    .select(["id", "status"])
    .where("transformation_id", "=", mw.transformationId)
    .orderBy("submission_no")
    .execute();
  const decisions = await api.db
    .selectFrom("gate_decision")
    .select("id")
    .where("transformation_id", "=", mw.transformationId)
    .execute();
  return { gate: await gateRow(mw, "G3"), submissions, decisions: decisions.length };
}

/** Covers every mandatory criterion of `gateCode` with an exception requested by the TL and accepted by the SP. */
async function coverCriteria(mw: ModularWorld, gateCode: string): Promise<void> {
  const keys = await api.db
    .selectFrom("gate_criterion_definition as c")
    .innerJoin("gate_definition as d", "d.id", "c.gate_definition_id")
    .select("c.key")
    .where("d.code", "=", gateCode)
    .where("c.mandatory", "=", true)
    .orderBy("c.ordinal")
    .execute();
  const E = `${mw.base}/gate-exceptions`;
  for (const { key } of keys) {
    const ex = await send("POST", E, {
      session: mw.s.tl,
      body: {
        gateCode,
        criterionKey: key,
        reason: "Synthetic: test fixture coverage of a criterion this test does not exercise.",
        scope: `Synthetic: ${key} only`,
        compensatingAction: "Synthetic: complete the criterion before the next gate.",
        compensatingOwnerUserId: mw.users.tl.id,
        expiresOn: inDays(60),
      },
    });
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const d = await send("POST", `${E}/${ex.body.id}/decision`, {
      session: mw.s.sp,
      headers: ifm(ex.body.version),
      body: { outcome: "accepted", note: "Synthetic demo decision." },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
}

const D = (mw: ModularWorld) => `${mw.base}/gate-dispensations`;

/** Records a Modular-links waiver (TL, gate.submit): kind waiver, G3, no initiative. */
async function recordWaiver(mw: ModularWorld, expiresOn = inDays(30), session: Session = mw.s.tl) {
  const res = await send("POST", D(mw), {
    session,
    body: {
      kind: "waiver",
      gateCode: "G3",
      reason: "Synthetic: the inherited baseline is being located; the design may go to G3 meanwhile.",
      expiresOn,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Body;
}

async function decideWaiver(mw: ModularWorld, d: Body, result: "accepted" | "rejected", session = mw.s.sp) {
  return send("POST", `${D(mw)}/${d.id}/decision`, {
    session,
    headers: ifm(d.version),
    body: { result, note: "Synthetic demo decision." },
  });
}

async function acceptedWaiver(mw: ModularWorld, expiresOn = inDays(30)) {
  const res = await decideWaiver(mw, await recordWaiver(mw, expiresOn), "accepted");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
}

async function revokeWaiver(mw: ModularWorld, d: Body) {
  const res = await send("POST", `${D(mw)}/${d.id}/revoke`, {
    session: mw.s.sp,
    headers: ifm(d.version),
    body: { reason: "Synthetic: the baseline will not be found in time." },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
}

async function submitG3(mw: ModularWorld) {
  return send("POST", `${mw.base}/gates/G3/submissions`, {
    session: mw.s.tl,
    headers: ifm((await gateRow(mw, "G3")).version),
    body: { submissionNote: "Synthetic submission" },
  });
}

async function decideG3(mw: ModularWorld, submissionNo: number, outcome: "approved" | "rejected") {
  return send("POST", `${mw.base}/gates/G3/decision`, {
    session: mw.s.sp,
    headers: ifm((await gateRow(mw, "G3")).version),
    body: { submissionNo, outcome, rationale: RATIONALE },
  });
}

/** A Modular world at Design whose G3 criteria are covered, with the links still missing. */
async function readyWorld(): Promise<ModularWorld> {
  const mw = await seedModularWorld(api, w);
  const t = await api.db
    .selectFrom("transformation")
    .select("timezone")
    .where("id", "=", mw.transformationId)
    .executeTakeFirstOrThrow();
  expect(t.timezone).toBe(TZ);
  await coverCriteria(mw, "G3");
  return mw;
}

async function blockingCodes(mw: ModularWorld): Promise<string[]> {
  const r = await send("GET", `${mw.base}/missing-links`, { session: mw.s.auditor });
  expect(r.status).toBe(200);
  return (r.body.items as { severity: string; code: string }[])
    .filter((i) => i.severity === "blocking")
    .map((i) => i.code);
}

// ------------------------------------------------------------------------------------------------ W1 (route)

describe("ADR-0021 W1: the one changed condition of createGateDispensation", () => {
  it("a Modular G3 waiver with no initiative: 201 pending, version 1, audited gate_dispensation.create", async () => {
    const mw = await seedModularWorld(api, w);
    const created = await recordWaiver(mw);
    expect(created).toMatchObject({
      kind: "waiver",
      gateCode: "G3",
      initiativeId: null,
      status: "pending",
      counts: false,
      version: 1,
    });
    const events = await auditOf(api.db, created.id);
    expect(events.map((e) => e.action)).toEqual(["gate_dispensation.create"]);
    // The later checks of the waiver branch still run, unchanged, for a Modular-links waiver.
    const incomplete = await send("POST", D(mw), { session: mw.s.tl, body: { kind: "waiver", gateCode: "G3" } });
    expect([incomplete.status, incomplete.body.code, incomplete.body.detail]).toEqual([
      422,
      "dispensation.waiver_incomplete",
      "A waiver needs a reason and an expiry date.",
    ]);
    const past = await send("POST", D(mw), {
      session: mw.s.tl,
      body: { kind: "waiver", gateCode: "G3", reason: "Synthetic", expiresOn: inDays(-1) },
    });
    expect([past.status, past.body.code, past.body.detail]).toEqual([
      422,
      "dispensation.expired",
      "The expiry date cannot be in the past.",
    ]);
    // AUD never records one (403); nothing written.
    const aud = await send("POST", D(mw), {
      session: mw.s.auditor,
      body: { kind: "waiver", gateCode: "G3", reason: "Synthetic", expiresOn: inDays(5) },
    });
    expect(aud.status).toBe(403);
    expect(
      (
        await api.db
          .selectFrom("gate_dispensation")
          .select("id")
          .where("transformation_id", "=", mw.transformationId)
          .execute()
      ).length,
    ).toBe(1);
  });

  it("every other Modular waiver keeps the DG3 refusal: G1, G2, and G3 with an initiative (recorded for A/B)", async () => {
    const t = responseTranscript(call, "MTH_BE_R3_MODULAR_REFUSAL_TRANSCRIPT");
    const mw = await seedModularWorld(api, w);
    const bodies = [
      { kind: "waiver", gateCode: "G1", reason: "Synthetic", expiresOn: inDays(30) },
      { kind: "waiver", gateCode: "G2", reason: "Synthetic", expiresOn: inDays(30) },
      { kind: "waiver", gateCode: "G3", reason: "Synthetic", expiresOn: inDays(30), initiativeId: uuidv7() },
      { kind: "waiver", gateCode: "G1" },
      { kind: "waiver", gateCode: "G2", initiativeId: uuidv7() },
    ];
    for (const body of bodies) {
      const res = await t.call(api.app, "POST", D(mw), { session: mw.s.tl, body });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "dispensation.waiver_requires_end_to_end",
        NOT_E2E,
      ]);
      expect(res.body.errors).toEqual([
        { pointer: "/kind", code: "dispensation.waiver_requires_end_to_end", message: NOT_E2E },
      ]);
    }
    await t.call(api.app, "GET", D(mw), { session: mw.s.auditor });
    t.flush();
    expect(
      await api.db
        .selectFrom("gate_dispensation")
        .select("id")
        .where("transformation_id", "=", mw.transformationId)
        .execute(),
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ W2 (decision)

describe("ADR-0021 W2: who decides a Modular-links waiver", () => {
  it("G3's approver (SP) accepts it (200); the recorder (403) and a non-approver (403 gate.not_approver) cannot", async () => {
    const mw = await seedModularWorld(api, w);
    const created = await recordWaiver(mw);
    const byRecorder = await decideWaiver(mw, created, "accepted", mw.s.tl);
    expect(byRecorder.status).toBe(403);
    const byBo = await decideWaiver(mw, created, "accepted", mw.s.bo);
    expect([byBo.status, byBo.body.code]).toEqual([403, "gate.not_approver"]);
    const byAud = await decideWaiver(mw, created, "accepted", mw.s.auditor);
    expect(byAud.status).toBe(403);
    const ok = await decideWaiver(mw, created, "accepted");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: "accepted", counts: true, version: 2, decidedBy: mw.users.sp.id });
    expect((await auditOf(api.db, created.id)).map((e) => e.action)).toEqual([
      "gate_dispensation.create",
      "gate_dispensation.decide",
    ]);
    // Never a gate approval: no gate decision, G3 still draft.
    const s = await g3State(mw);
    expect([s.gate.status, s.decisions, s.submissions.length]).toEqual(["draft", 0, 0]);
  });
});

// ------------------------------------------------------------------------------------------------ B1 (submission)

describe("ADR-0038 B1 at G3 submission", () => {
  it("criteria met, links missing, an accepted waiver in force → 201 with modularLinks in the snapshot; report unchanged", async () => {
    const mw = await readyWorld();
    const waiver = await acceptedWaiver(mw, inDays(30));
    const res = await submitG3(mw);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await api.db
      .selectFrom("gate_submission")
      .selectAll()
      .where("transformation_id", "=", mw.transformationId)
      .where("gate_code", "=", "G3")
      .executeTakeFirstOrThrow();
    const snapshot = row.snapshot as Body;
    expect(snapshot["modularLinks"]).toEqual({
      missing: ["baseline_missing", "outcome_link_missing"],
      waiver: {
        dispensationId: waiver.id,
        expiresOn: inDays(30),
        reason: "Synthetic: the inherited baseline is being located; the design may go to G3 meanwhile.",
        decidedBy: mw.users.sp.id,
      },
    });
    // The member is placed after `evidence` and before `note` in the built object (ADR-0038 B1); the stored snapshot is
    // canonical JSON in jsonb, so key order is not observable here. The hash covers the member.
    expect(res.body.snapshot).toEqual(snapshot);
    // The audit trail binds the waiver to the submission through the snapshot hash (ADR-0021 W4).
    const created = (await auditOf(api.db, row.id)).find((e) => e.action === "gate_submission.create")!;
    expect((created.changes as Body)["snapshotSha256"]).toEqual({ from: null, to: row.snapshot_sha256 });
    // The waiver supplies nothing: the missing-link report still lists both items.
    expect(await blockingCodes(mw)).toEqual(["baseline_missing", "outcome_link_missing"]);
  });

  it("only the outcome link missing: missing lists it alone", async () => {
    const mw = await readyWorld();
    await addBaseline(send, mw);
    await acceptedWaiver(mw);
    const res = await submitG3(mw);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((res.body.snapshot as Body)["modularLinks"].missing).toEqual(["outcome_link_missing"]);
  });

  it("links supplied: no modularLinks member even with a waiver in force (the snapshot is the DG3 one)", async () => {
    const mw = await readyWorld();
    await addBaseline(send, mw);
    await addOutcomeKpi(api.db, mw);
    await acceptedWaiver(mw);
    const res = await submitG3(mw);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body.snapshot as Body)).not.toContain("modularLinks");
  });

  it("which waiver: the latest expiry, ties broken by the greatest id", async () => {
    const mw = await readyWorld();
    await acceptedWaiver(mw, inDays(10));
    const later = await acceptedWaiver(mw, inDays(40));
    await acceptedWaiver(mw, inDays(20));
    const res = await submitG3(mw);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((res.body.snapshot as Body)["modularLinks"].waiver.dispensationId).toBe(later.id);

    const tie = await readyWorld();
    const first = await acceptedWaiver(tie, inDays(25));
    const second = await acceptedWaiver(tie, inDays(25));
    expect(second.id > first.id).toBe(true);
    const tied = await submitG3(tie);
    expect((tied.body.snapshot as Body)["modularLinks"].waiver.dispensationId).toBe(second.id);
  });

  it("pending, rejected, revoked or expired (injected exception clock) waivers → 422 gate.modular_links_missing; nothing written", async () => {
    const refusedWith = async (mw: ModularWorld) => {
      const before = await g3State(mw);
      const res = await submitG3(mw);
      expect([res.status, res.body.code, res.body.detail], JSON.stringify(res.body)).toEqual([
        422,
        "gate.modular_links_missing",
        LINKS_DETAIL,
      ]);
      expect(res.body.errors.map((e: { pointer: string }) => e.pointer)).toEqual(["/baseline", "/outcomes"]);
      expect(await g3State(mw)).toEqual(before);
    };
    const pending = await readyWorld();
    await recordWaiver(pending);
    await refusedWith(pending);

    const rejected = await readyWorld();
    expect((await decideWaiver(rejected, await recordWaiver(rejected), "rejected")).status).toBe(200);
    await refusedWith(rejected);

    const revoked = await readyWorld();
    await revokeWaiver(revoked, await acceptedWaiver(revoked));
    await refusedWith(revoked);

    // Inclusive expiry on BE-K2's clock: counts on its expiry date, refused the day after.
    const expiring = await readyWorld();
    await acceptedWaiver(expiring, inDays(3));
    setGateExceptionClock(() => new Date(Date.now() + 4 * DAY));
    await refusedWith(expiring);
    setGateExceptionClock(null);
    const onExpiry = await readyWorld();
    await acceptedWaiver(onExpiry, inDays(3));
    setGateExceptionClock(() => new Date(Date.now() + 3 * DAY));
    const res = await submitG3(onExpiry);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

// ------------------------------------------------------------------------------------------------ B1 (approval)

describe("ADR-0038 B1 at G3 approval", () => {
  it("the waiver in force: approval 201, G3 approved; the decision is the SP's", async () => {
    const mw = await readyWorld();
    await acceptedWaiver(mw);
    const s = await submitG3(mw);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const d = await decideG3(mw, s.body.submissionNo, "approved");
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await gateRow(mw, "G3")).status).toBe("approved");
  });

  it("revoked after submission → 422 gate.modular_waiver_revoked with the revoke date; a later waiver does not rescue it; reject stays allowed", async () => {
    const mw = await readyWorld();
    const waiver = await acceptedWaiver(mw);
    const s = await submitG3(mw);
    expect(s.status).toBe(201);
    await revokeWaiver(mw, waiver);
    const revokedOn = (
      await sql<{ d: string }>`SELECT p4_business_date(g.revoked_at, t.timezone)::text AS d
        FROM gate_dispensation g JOIN transformation t ON t.id = g.transformation_id
        WHERE g.id = ${waiver.id}::uuid`.execute(api.db)
    ).rows[0]!.d;
    // Another waiver accepted later: the recorded one decides (ADR-0038 B1).
    await acceptedWaiver(mw, inDays(50));
    const before = await g3State(mw);
    const refused = await decideG3(mw, s.body.submissionNo, "approved");
    expect(refused.body).toMatchObject({
      status: 422,
      type: "urn:mth:problem:validation",
      title: "Business rule violated",
      code: "gate.modular_waiver_revoked",
      detail: revokedDetail(revokedOn),
    });
    expect(refused.status).toBe(422);
    expect(await g3State(mw)).toEqual(before);
    const rejected = await decideG3(mw, s.body.submissionNo, "rejected");
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
  });

  it("expired by approval time (injected clock) → 422 gate.modular_waiver_expired with the expiry date; nothing written", async () => {
    const mw = await readyWorld();
    await acceptedWaiver(mw, inDays(5));
    const s = await submitG3(mw);
    expect(s.status).toBe(201);
    // On the expiry date it still counts; the day after it does not.
    setGateExceptionClock(() => new Date(Date.now() + 6 * DAY));
    const before = await g3State(mw);
    const refused = await decideG3(mw, s.body.submissionNo, "approved");
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "gate.modular_waiver_expired",
      expiredDetail(inDays(5)),
    ]);
    expect(await g3State(mw)).toEqual(before);
    setGateExceptionClock(() => new Date(Date.now() + 5 * DAY));
    const ok = await decideG3(mw, s.body.submissionNo, "approved");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("revoked and expired: the revoke is reported", async () => {
    const mw = await readyWorld();
    const waiver = await acceptedWaiver(mw, inDays(2));
    const s = await submitG3(mw);
    await revokeWaiver(mw, waiver);
    setGateExceptionClock(() => new Date(Date.now() + 10 * DAY));
    const refused = await decideG3(mw, s.body.submissionNo, "approved");
    expect([refused.status, refused.body.code]).toEqual([422, "gate.modular_waiver_revoked"]);
  });

  it("a Modular G3 submitted with its links (no modularLinks) is decided exactly as before", async () => {
    const mw = await readyWorld();
    await addBaseline(send, mw);
    await addOutcomeKpi(api.db, mw);
    const waiver = await acceptedWaiver(mw);
    const s = await submitG3(mw);
    expect(s.status).toBe(201);
    // A waiver revoked after a submission that did not rely on it changes nothing.
    await revokeWaiver(mw, waiver);
    const d = await decideG3(mw, s.body.submissionNo, "approved");
    expect(d.status, JSON.stringify(d.body)).toBe(201);
  });
});
