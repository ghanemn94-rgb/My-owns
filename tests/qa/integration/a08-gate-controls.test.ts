// A08 "Gate controls" (master prompt §20): "Missing evidence blocks submission; unauthorized approval and stale-version
// approval are rejected by the API."
//
// Black-box acceptance suite (qa-verifier, T-DG4-QA-B) through the REAL API (Fastify inject; every request and response
// validated against docs/api/openapi.yaml by the harness) on the run's disposable PostgreSQL. Each `it` names the
// requirement rows (docs/delivery/requirements.csv) whose A08 text it proves.
//
// Synthetic transformations are created and taken to G5 and G6 with NATIVE operations only (tests/qa/support/
// gates-native.ts): POST /transformations, role assignments through the access API, every earlier gate covered by
// accepted exceptions, submitted by the Lead and approved by the Sponsor. Disclosed injections:
//  - the gate-exception clock (setGateExceptionClock, the product's own test seam) to move "today" past an expiry,
//    because the API cannot inject the server clock and the expiry date is immutable once requested;
//  - the worker's gate.submitted / gate.decided consumers are invoked with the outbox envelope exactly as the relay
//    delivers it (the A04/A13 suites run the full relay + pg-boss path).
// All data is SYNTHETIC. Every gate decision, exception decision and approval is a synthetic in-product business action
// by a test person; product gates G1-G6 never imply any engineering gate DG0-DG7 (and this suite asserts that a product
// G6 approval writes nothing under docs/delivery/).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setGateExceptionClock } from "../../../apps/api/src/modules/workflows/gate-exceptions.ts";
import { handleGateDecided, handleGateSubmitted } from "../../../apps/worker/src/handlers/gates.ts";
import { sql } from "../../../packages/db/src/index.ts";
import { call, createUser, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";
import {
  completePhaseSteps,
  coverWithException,
  decideGate,
  envelopeByKey,
  exceptionRequest,
  gateView,
  ifm,
  missingKeys,
  passGatesNatively,
  uncoveredKeys,
  plusDays,
  RATIONALE,
  seedNativeGateWorld,
  submitGate,
  type Body,
  type NativeGateWorld,
  type Person,
} from "../support/gates-native.ts";

let api: TestApi;
let w: World;
let today: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db);
  today = r.rows[0]!.d;
}, 60_000);
afterAll(() => api?.close());
afterEach(() => setGateExceptionClock(null));

const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call<Body>(api.app, method, url, opts);

// ------------------------------------------------------------------------------------------------ helpers

const instanceRow = (g: NativeGateWorld, code: string) =>
  api.db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", g.transformationId)
    .where("gate_code", "=", code)
    .executeTakeFirstOrThrow();
const decisionsOf = async (g: NativeGateWorld, code: string) =>
  (
    await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", g.transformationId)
      .where("gate_code", "=", code)
      .execute()
  ).length;
const submissionsOf = async (g: NativeGateWorld, code: string) =>
  (
    await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", g.transformationId)
      .where("gate_code", "=", code)
      .execute()
  ).length;
const auditActions = async (recordId: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select(["action", "new_version"])
      .where("record_id", "=", recordId)
      .orderBy("seq")
      .execute()
  ).map((e) => ({ action: e.action, newVersion: e.new_version }));
const exceptionsOf = async (g: NativeGateWorld) =>
  (await send("GET", `${g.base}/gate-exceptions`, { session: g.auditor.session })).body.items as Body[];

/** The criterion of the live gate view whose English label is `label`. */
async function criterionByLabel(g: NativeGateWorld, code: string, label: string): Promise<Body> {
  const c = ((await gateView(api, g, code)).criteria as Body[]).find((x) => x.labelEn === label);
  expect(c, `${code} has a criterion labelled '${label}'`).toBeTruthy();
  return c;
}

/** Covers every uncovered mandatory gap of `code` except the listed keys (the gate's approver accepts). */
async function coverAllBut(
  g: NativeGateWorld,
  code: string,
  keep: readonly string[],
  expiresOn = plusDays(today, 60),
  approver: Session = g.sp.session,
) {
  const covered: Body[] = [];
  for (const key of await uncoveredKeys(api, g, code))
    if (!keep.includes(key)) covered.push(await coverWithException(api, g, code, key, expiresOn, approver));
  return covered;
}

/** A person holding TL and SP on the transformation (submitter who would also be the configured approver). */
async function leadAndSponsor(g: NativeGateWorld): Promise<Person> {
  const admin = await signIn(api.app, w.admin.subject);
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["TL", "SP"]) {
    const r = await send("POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: u.id,
        roleCode: role,
        scope: { type: "transformation", id: g.transformationId },
        reason: "Synthetic QA: a submitter who also holds the approver role",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** Recursive listing + SHA-256 of every file under docs/delivery/ of this tree (REQ-S04-008). */
const DELIVERY = fileURLToPath(new URL("../../../docs/delivery/", import.meta.url));
function deliveryFingerprint(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out[relative(DELIVERY, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(DELIVERY);
  return out;
}

// ================================================================================================ G1: evidence, status

describe("A08 missing evidence blocks submission (REQ-PB-015, REQ-S20-008, REQ-S04-012)", () => {
  let g: NativeGateWorld;
  let missing: string[];
  let versionBeforeSubmit = 0;
  beforeAll(async () => {
    g = await seedNativeGateWorld(api, w, "A08 G1 evidence");
  }, 120_000);

  it("REQ-S04-012: the gate page lists the missing mandatory items; canSubmit is false", async () => {
    const view = await gateView(api, g, "G1");
    missing = (view.criteria as Body[]).filter((c) => c.mandatory && c.completeness !== "complete").map((c) => c.key);
    expect(missing.length).toBeGreaterThan(0);
    for (const c of view.criteria as Body[])
      if (missing.includes(c.key)) {
        expect(c.completeness).toBe("incomplete");
        expect(typeof c.labelEn).toBe("string");
        expect(typeof c.labelAr).toBe("string");
      }
    expect([view.gate.status, view.canSubmit]).toEqual(["draft", false]);
  });

  it("REQ-PB-015, REQ-S20-008: a submission with missing mandatory evidence is 422 and writes no submission", async () => {
    const res = await submitGate(api, g, "G1");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(String(res.headers["content-type"])).toContain("application/problem+json");
    expect(res.body.code).toBe("gate_criteria_incomplete");
    const pointers = (res.body.errors as Body[]).map((e) => e.pointer);
    for (const key of missing) expect(pointers).toContain(`/criteria/${key}`);
    expect(await submissionsOf(g, "G1")).toBe(0);
    expect((await instanceRow(g, "G1")).status).toBe("draft");
  });

  it("REQ-S04-012: with exactly one missing mandatory item the 422 lists exactly that item", async () => {
    const last = missing[missing.length - 1]!;
    await coverAllBut(g, "G1", [last]);
    expect(await uncoveredKeys(api, g, "G1")).toEqual([last]);
    // The gate page still lists the covered items as incomplete (the evidence is missing; an exception covers it).
    expect((await missingKeys(api, g, "G1")).sort()).toEqual([...missing].sort());
    expect((await gateView(api, g, "G1")).canSubmit).toBe(false);
    const res = await submitGate(api, g, "G1");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect((res.body.errors as Body[]).map((e) => e.pointer)).toEqual([`/criteria/${last}`]);
    expect(String(res.body.detail)).toContain(last);
    expect(await submissionsOf(g, "G1")).toBe(0);
  });

  it("REQ-S04-013: a waiver without an expiry or without a compensating action is refused; nothing is written", async () => {
    const last = (await uncoveredKeys(api, g, "G1"))[0]!;
    const before = (await exceptionsOf(g)).length;
    const full = exceptionRequest(g, "G1", last, plusDays(today, 30));
    for (const drop of ["expiresOn", "compensatingAction"] as const) {
      const body: Record<string, unknown> = { ...full };
      delete body[drop];
      const r = await send("POST", `${g.base}/gate-exceptions`, { session: g.tl.session, body });
      expect([drop, r.status]).toEqual([drop, 400]);
      expect(String(r.headers["content-type"])).toContain("application/problem+json");
    }
    expect((await exceptionsOf(g)).length).toBe(before);
  });

  it("REQ-S04-012: with a valid (accepted, unexpired) exception the submission succeeds and its snapshot records the exception", async () => {
    const last = (await uncoveredKeys(api, g, "G1"))[0]!;
    const ex = await coverWithException(api, g, "G1", last, plusDays(today, 30));
    expect([ex.status, ex.covering]).toEqual(["accepted", true]);
    expect((await gateView(api, g, "G1")).canSubmit).toBe(true);
    versionBeforeSubmit = (await instanceRow(g, "G1")).version;
    const res = await submitGate(api, g, "G1");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("pending");
    const entry = (res.body.snapshot.criteria as Body[]).find((c) => c.key === last);
    expect(entry.exception).toMatchObject({ id: ex.id, expiresOn: plusDays(today, 30) });
    const view = await send("GET", `${g.gates}/G1/submissions/${res.body.submissionNo}`, {
      session: g.auditor.session,
    });
    expect(view.status).toBe(200);
    expect(view.body.submission.snapshotSha256).toBe(res.body.snapshotSha256);
    expect(JSON.stringify(view.body.submission.snapshot)).toContain(ex.id);
  });

  it("REQ-PB-015: a submission with a stale gate version (If-Match) is refused with 409; nothing is written", async () => {
    const before = await submissionsOf(g, "G1");
    expect((await instanceRow(g, "G1")).version).toBeGreaterThan(versionBeforeSubmit);
    const res = await submitGate(api, g, "G1", g.tl.session, versionBeforeSubmit);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.type).toBe("urn:mth:problem:version-conflict");
    expect(await submissionsOf(g, "G1")).toBe(before);
  });

  it("REQ-S12-009: each required approver receives exactly one task referencing the snapshot; a redelivery adds none", async () => {
    const sub = (await gateView(api, g, "G1")).currentSubmission as Body;
    const env = await envelopeByKey(api, `gate.submitted:${sub.id}`);
    await handleGateSubmitted(api.db, env, "qa-a08-gate-submitted-1");
    await handleGateSubmitted(api.db, env, "qa-a08-gate-submitted-redelivery");
    const tasksOf = async (p: Person) =>
      (
        (
          await send("GET", `/api/v1/me/work-items?transformationId=${g.transformationId}&kind=gate_decision_due`, {
            session: p.session,
          })
        ).body.items as Body[]
      ).filter((i) => i.status === "open");
    for (const approver of [g.sp, g.sp2]) {
      const tasks = await tasksOf(approver);
      expect(tasks, `approver ${approver.id}`).toHaveLength(1);
      expect(tasks[0].assigneeUserId).toBe(approver.id);
      expect(JSON.stringify(tasks[0])).toContain(sub.snapshotSha256);
    }
    // People who are not approvers of G1 get none.
    for (const other of [g.bo, g.wl]) expect(await tasksOf(other)).toHaveLength(0);
  });
});

describe("A08 unauthorized and stale approval are rejected (REQ-PB-015, REQ-S20-008, REQ-S04-009/010, REQ-S10-014)", () => {
  let g: NativeGateWorld;
  let gateId: string;
  const transitions: { to: string; version: number }[] = [];
  /** Asserts the gate's status, and that the transition wrote an audit event on the gate instance at its new version. */
  async function expectTransition(status: string) {
    const inst = await instanceRow(g, "G1");
    expect(inst.status).toBe(status);
    const prior = transitions[transitions.length - 1];
    if (prior) expect(inst.version).toBeGreaterThan(prior.version);
    const events = await auditActions(gateId);
    expect(
      events.some((e) => e.newVersion === inst.version),
      `audit event at version ${inst.version}: ${JSON.stringify(events)}`,
    ).toBe(true);
    transitions.push({ to: status, version: inst.version });
  }
  const pendingNo = async () => (await gateView(api, g, "G1")).gate.latestSubmissionNo as number;

  beforeAll(async () => {
    g = await seedNativeGateWorld(api, w, "A08 G1 status");
    gateId = (await instanceRow(g, "G1")).id;
    await coverAllBut(g, "G1", []);
  }, 120_000);

  it("REQ-S04-010: the seven statuses exist in the database; a direct Draft -> Approved is refused", async () => {
    const allowed = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      WHERE c.conrelid = 'gate_instance'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%under_review%'`.execute(
      api.db,
    );
    expect(allowed.rows.length).toBeGreaterThan(0);
    for (const s of ["draft", "submitted", "under_review", "changes_requested", "approved", "rejected", "deferred"])
      expect(allowed.rows[0]!.def).toContain(`'${s}'`);
    await expectTransition("draft");
    const direct = await decideGate(api, g, "G1", g.sp.session, {
      submissionNo: 1,
      outcome: "approved",
      rationale: RATIONALE,
      agreements: { problem: true, baseline: true, materialValuePools: true },
    });
    expect([409, 422]).toContain(direct.status);
    expect(String(direct.headers["content-type"])).toContain("application/problem+json");
    expect((await instanceRow(g, "G1")).status).toBe("draft");
    expect(await decisionsOf(g, "G1")).toBe(0);
  });

  it("REQ-S04-010: submit moves Draft -> Submitted with an audit event", async () => {
    const res = await submitGate(api, g, "G1");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectTransition("submitted");
  });

  it("REQ-PB-015, REQ-S20-008: approval by a non-approver is 403 (BO, WL, TL) and AUD is 403; nothing is written", async () => {
    const no = await pendingNo();
    for (const who of [g.bo, g.wl, g.tl, g.auditor]) {
      const r = await decideGate(api, g, "G1", who.session, {
        submissionNo: no,
        outcome: "approved",
        rationale: RATIONALE,
      });
      expect([who.id, r.status]).toEqual([who.id, 403]);
    }
    const bo = await decideGate(api, g, "G1", g.bo.session, {
      submissionNo: no,
      outcome: "approved",
      rationale: RATIONALE,
    });
    expect(bo.body.code).toBe("gate.not_approver");
    // An outsider (another organization) cannot even see the gate.
    const out = await decideGate(api, g, "G1", g.outsider.session, {
      submissionNo: no,
      outcome: "approved",
      rationale: RATIONALE,
    });
    expect(out.status).toBe(404);
    expect(await decisionsOf(g, "G1")).toBe(0);
    expect((await instanceRow(g, "G1")).status).toBe("submitted");
  });

  it("REQ-S04-009: a criterion review persists all nine fields; the first review moves the gate to Under Review", async () => {
    const no = await pendingNo();
    const crit = `${g.gates}/G1/submissions/${no}/criteria`;
    const before = await send("GET", crit, { session: g.auditor.session });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const key = before.body.items[0].criterionKey as string;
    const risk = await send("POST", `${g.base}/raid`, {
      session: g.tl.session,
      body: {
        type: "risk",
        description: "Synthetic QA: vendor diagnostic delay",
        impact: "medium",
        probability: "medium",
        ownerUserId: g.wl.id,
        dueDate: "2026-12-15",
        mitigation: "Synthetic QA: second supplier",
      },
    });
    expect(risk.status, JSON.stringify(risk.body)).toBe(201);
    // A review without a rationale is refused.
    const noRationale = await send("POST", `${crit}/${key}/reviews`, {
      session: g.bo.session,
      headers: ifm((await instanceRow(g, "G1")).version),
      body: { finding: "Synthetic QA finding", recommendation: "meets" },
    });
    expect(noRationale.status).toBe(400);
    const r = await send("POST", `${crit}/${key}/reviews`, {
      session: g.bo.session,
      headers: ifm((await instanceRow(g, "G1")).version),
      body: {
        finding: "Synthetic QA: baseline uses Q2 data only.",
        recommendation: "meets_with_conditions",
        openCondition: "Synthetic QA: add Q3 data before G2.",
        riskNote: "Synthetic QA: vendor delay risk.",
        raidEntryId: risk.body.id,
        rationale: "Synthetic QA: sufficient for the diagnostic with a condition.",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = await send("GET", crit, { session: g.auditor.session });
    const row = (after.body.items as Body[]).find((i) => i.criterionKey === key);
    // The nine M0124 fields: criterion, required evidence, completeness, reviewer, finding, open condition, risk,
    // decision, rationale.
    expect(row.criterionLabelEn.length).toBeGreaterThan(0);
    expect(row.criterionLabelAr.length).toBeGreaterThan(0);
    expect(row.requiredEvidenceEn.length).toBeGreaterThan(0);
    expect(row.requiredEvidenceAr.length).toBeGreaterThan(0);
    expect(["complete", "incomplete"]).toContain(row.completeness);
    expect(row).toMatchObject({
      reviewerUserId: g.bo.id,
      finding: "Synthetic QA: baseline uses Q2 data only.",
      openCondition: "Synthetic QA: add Q3 data before G2.",
      risk: { note: "Synthetic QA: vendor delay risk.", raidEntryId: risk.body.id },
      decision: "meets_with_conditions",
      rationale: "Synthetic QA: sufficient for the diagnostic with a condition.",
    });
    // Persisted: the stored review row carries the same values (read straight from the database).
    const stored = await api.db
      .selectFrom("gate_criterion_review")
      .selectAll()
      .where("id", "=", r.body.id)
      .executeTakeFirstOrThrow();
    expect([
      stored.finding,
      stored.open_condition,
      stored.risk_note,
      stored.raid_entry_id,
      stored.recommendation,
    ]).toEqual([
      "Synthetic QA: baseline uses Q2 data only.",
      "Synthetic QA: add Q3 data before G2.",
      "Synthetic QA: vendor delay risk.",
      risk.body.id,
      "meets_with_conditions",
    ]);
    expect(after.body.gateStatus).toBe("under_review");
    await expectTransition("under_review");
  });

  it("REQ-S04-009, REQ-S10-014: a gate decision without rationale is refused (missing 400, blank 4xx); nothing is written", async () => {
    const no = await pendingNo();
    const missing = await decideGate(api, g, "G1", g.sp.session, { submissionNo: no, outcome: "changes_requested" });
    expect(missing.status).toBe(400);
    const blank = await call<Body>(api.app, "POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: { submissionNo: no, outcome: "changes_requested", rationale: "    " },
    });
    expect([400, 422]).toContain(blank.status);
    expect(await decisionsOf(g, "G1")).toBe(0);
    expect((await instanceRow(g, "G1")).status).toBe("under_review");
  });

  it("REQ-S04-010: Under Review -> Changes Requested -> (resubmit) Submitted -> Deferred -> Submitted -> Rejected -> Submitted -> Approved, each with an audit event", async () => {
    const decide = async (outcome: string, extra: Record<string, unknown> = {}) => {
      const r = await decideGate(api, g, "G1", g.sp.session, {
        submissionNo: await pendingNo(),
        outcome,
        rationale: `Synthetic QA ${outcome}`,
        ...extra,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.outcome).toBe(outcome);
      return r.body;
    };
    const resubmit = async () => {
      const r = await submitGate(api, g, "G1");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    };
    await decide("changes_requested");
    await expectTransition("changes_requested");
    await resubmit();
    await expectTransition("submitted");
    await decide("deferred");
    await expectTransition("deferred");
    await resubmit();
    await expectTransition("submitted");
    await decide("rejected");
    await expectTransition("rejected");
    await resubmit();
    await expectTransition("submitted");
    const approved = await decide("approved", {
      agreements: { problem: true, baseline: true, materialValuePools: true },
    });
    await expectTransition("approved");
    expect(approved.decidedBy).toBe(g.sp.id);
    expect(transitions.map((t) => t.to)).toEqual([
      "draft",
      "submitted",
      "under_review",
      "changes_requested",
      "submitted",
      "deferred",
      "submitted",
      "rejected",
      "submitted",
      "approved",
    ]);
    // Every status of the seven was reached.
    expect(new Set(transitions.map((t) => t.to)).size).toBe(7);
  });

  it("REQ-PB-015, REQ-S10-014: approving a stale (superseded) submission number is 409; the stored decision carries the submission it decided", async () => {
    // G2 of the same transformation: submission 1, then a resubmission supersedes it.
    await coverAllBut(g, "G2", []);
    const s1 = await submitGate(api, g, "G2");
    expect(s1.status, JSON.stringify(s1.body)).toBe(201);
    const s2 = await submitGate(api, g, "G2");
    expect(s2.status, JSON.stringify(s2.body)).toBe(201);
    expect(s2.body.submissionNo).toBe(s1.body.submissionNo + 1);
    const stale = await decideGate(api, g, "G2", g.sp.session, {
      submissionNo: s1.body.submissionNo,
      outcome: "approved",
      rationale: RATIONALE,
    });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body.type).toBe("urn:mth:problem:version-conflict");
    expect(stale.body.code).toBe("gate.submission_superseded");
    expect(await decisionsOf(g, "G2")).toBe(0);
    const ok = await decideGate(api, g, "G2", g.sp.session, {
      submissionNo: s2.body.submissionNo,
      outcome: "approved",
      rationale: RATIONALE,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const view = await send("GET", `${g.gates}/G2/submissions/${s2.body.submissionNo}`, { session: g.auditor.session });
    expect(view.body.decision).toMatchObject({
      submissionNo: s2.body.submissionNo,
      rationale: RATIONALE,
      decidedBy: g.sp.id,
      outcome: "approved",
    });
  });

  it("the submitter who also holds the approver role cannot decide their own submission (403)", async () => {
    const both = await leadAndSponsor(g);
    await coverAllBut(g, "G3", []);
    const sub = await submitGate(api, g, "G3", both.session);
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const own = await decideGate(api, g, "G3", both.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: RATIONALE,
    });
    expect([own.status, own.body.code]).toEqual([403, "gate.submitter_cannot_decide"]);
    expect(await decisionsOf(g, "G3")).toBe(0);
  });
});

describe("A08 snapshot and task independence (REQ-S04-002)", () => {
  it("completing every Diagnose phase task leaves G1 Draft with no submission", async () => {
    const g = await seedNativeGateWorld(api, w, "A08 phase steps");
    const before = await instanceRow(g, "G1");
    const keys = await completePhaseSteps(api, { base: g.base, tl: g.tl, to: g.to, reader: g.auditor.session });
    expect(keys.length).toBeGreaterThan(0);
    const after = await send("GET", `${g.base}/phases`, { session: g.auditor.session });
    expect((after.body.phases[0].steps as Body[]).every((s) => s.status === "complete")).toBe(true);
    const inst = await instanceRow(g, "G1");
    expect([inst.status, inst.version]).toEqual(["draft", before.version]);
    expect(await submissionsOf(g, "G1")).toBe(0);
    expect((await gateView(api, g, "G1")).gate.status).toBe("draft");
  });

  it("editing a record after submission does not change the snapshot shown to approvers", async () => {
    const g = await seedNativeGateWorld(api, w, "A08 snapshot");
    await coverAllBut(g, "G1", []);
    const t0 = await send("GET", g.base, { session: g.tl.session });
    const sub = await submitGate(api, g, "G1");
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const url = `${g.gates}/G1/submissions/${sub.body.submissionNo}`;
    const first = await send("GET", url, { session: g.sp.session });
    expect(first.status).toBe(200);
    const snapshot = JSON.stringify(first.body.submission.snapshot);
    expect(first.body.submission.snapshot.transformation).toMatchObject({
      name: t0.body.name,
      version: t0.body.version,
    });
    // Edit the transformation after submission (its name and version are part of the snapshot).
    const patched = await send("PATCH", g.base, {
      session: g.tl.session,
      headers: ifm(t0.body.version),
      body: { name: "Synthetic QA renamed after the G1 submission" },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.version).toBeGreaterThan(t0.body.version);
    // New verified evidence and a new exception after submission are not added to the frozen snapshot either.
    const ev = await send("POST", `${g.base}/evidence`, {
      session: g.tl.session,
      body: { kind: "note", title: "Synthetic QA late evidence", noteBody: "Synthetic", ownerUserId: g.tl.id },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const later = await send("POST", `${g.base}/gate-exceptions`, {
      session: g.tl.session,
      body: exceptionRequest(g, "G2", (await missingKeys(api, g, "G2"))[0]!, plusDays(today, 30)),
    });
    expect(later.status, JSON.stringify(later.body)).toBe(201);
    const again = await send("GET", url, { session: g.sp.session });
    expect(again.body.submission.snapshotSha256).toBe(first.body.submission.snapshotSha256);
    expect(JSON.stringify(again.body.submission.snapshot)).toBe(snapshot);
    expect(again.body.submission.snapshot.transformation).toMatchObject({
      name: t0.body.name,
      version: t0.body.version,
    });
    expect(snapshot).not.toContain("renamed after the G1 submission");
    expect(snapshot).not.toContain(ev.body.id);
    expect(snapshot).not.toContain(later.body.id);
    // The live record did change (so the equality above is not vacuous).
    expect((await send("GET", g.base, { session: g.sp.session })).body.name).toBe(
      "Synthetic QA renamed after the G1 submission",
    );
  });
});

describe("A08 waiver expiry (REQ-S04-013)", () => {
  it("after expiry the covered evidence item is reported missing again and blocks submission", async () => {
    const g = await seedNativeGateWorld(api, w, "A08 expiry");
    const covered = await coverAllBut(g, "G1", [], today);
    expect(covered.length).toBeGreaterThan(0);
    expect(await uncoveredKeys(api, g, "G1")).toEqual([]);
    expect((await gateView(api, g, "G1")).canSubmit).toBe(true);
    // Two days later (exception clock injected): the exceptions expired.
    setGateExceptionClock(() => new Date(Date.now() + 2 * 86_400_000));
    const keys = covered.map((c) => c.criterionKey as string).sort();
    expect((await uncoveredKeys(api, g, "G1")).sort()).toEqual(keys);
    expect((await gateView(api, g, "G1")).canSubmit).toBe(false);
    const e = await send("GET", `${g.base}/gate-exceptions/${covered[0].id}`, { session: g.auditor.session });
    expect([e.body.status, e.body.covering]).toEqual(["accepted", false]);
    const res = await submitGate(api, g, "G1");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect((res.body.errors as Body[]).map((x) => x.pointer).sort()).toEqual(keys.map((k) => `/criteria/${k}`));
    expect(await submissionsOf(g, "G1")).toBe(0);
  });
});

// ================================================================================================ G5 and G6 (native)

describe("A08 G5 Scale and G6 Sustain on a transformation taken there natively (REQ-PB-020, REQ-S04-007, REQ-S03-004, REQ-PB-021, REQ-S04-008)", () => {
  let g: NativeGateWorld;
  let initiativeId: string;
  let riskId: string;
  let riskKey: string;
  beforeAll(async () => {
    g = await seedNativeGateWorld(api, w, "A08 G5 G6");
    await passGatesNatively(api, g, ["G1", "G2", "G3", "G4"], plusDays(today, 90));
    const ini = await send("POST", "/api/v1/initiatives", {
      session: g.tl.session,
      body: { transformationId: g.transformationId, name: "Synthetic QA scale pilot" },
    });
    expect(ini.status, JSON.stringify(ini.body)).toBe(201);
    initiativeId = ini.body.id;
  }, 240_000);

  it("the transformation reached the Transform phase through four native gate approvals", async () => {
    const t = await send("GET", g.base, { session: g.auditor.session });
    expect(t.body.currentPhase).toBe("transform");
    for (const code of ["G1", "G2", "G3", "G4"]) expect((await instanceRow(g, code)).status).toBe("approved");
    expect((await instanceRow(g, "G5")).status).toBe("draft");
  });

  it("REQ-S03-004: a scale transition before G5 approval is 422 invalid-transition naming G5", async () => {
    const r = await send("POST", `${g.base}/scale-transitions`, {
      session: g.tl.session,
      body: { initiativeId, businessUnitId: w.a1 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.type).toBe("urn:mth:problem:invalid-transition");
    expect(r.body.code).toBe("gate.g5_not_approved");
    expect(String(r.body.detail)).toContain("G5");
  });

  it("REQ-PB-020, REQ-S04-007: G5 with an open High-impact risk and no disposition is refused, listing 'Risk closure'", async () => {
    const risk = await send("POST", `${g.base}/raid`, {
      session: g.tl.session,
      body: {
        type: "risk",
        description: "Synthetic QA: vendor delay on the scaled platform",
        impact: "high",
        probability: "medium",
        ownerUserId: g.wl.id,
        dueDate: "2026-12-15",
        mitigation: "Synthetic QA: qualify a second supplier",
      },
    });
    expect(risk.status, JSON.stringify(risk.body)).toBe(201);
    riskId = risk.body.id;
    riskKey = (await criterionByLabel(g, "G5", "Risk closure")).key;
    expect((await criterionByLabel(g, "G5", "Risk closure")).completeness).toBe("incomplete");
    // Configure G5's approver to BO (T11 'Go-live / scale') before anything is submitted.
    const configured = await send("PATCH", `${g.gates}/G5`, {
      session: g.to.session,
      headers: ifm((await instanceRow(g, "G5")).version),
      body: { approverRoleCode: "BO" },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    expect(configured.body.gate.approverRoleCode).toBe("BO");
    // Everything else covered (exceptions are accepted by the gate's configured approver, now BO): Risk closure is the
    // only gap.
    await coverAllBut(g, "G5", [riskKey], plusDays(today, 60), g.bo.session);
    expect(await uncoveredKeys(api, g, "G5")).toEqual([riskKey]);
    const before = await submissionsOf(g, "G5");
    const res = await submitGate(api, g, "G5");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("gate_criteria_incomplete");
    expect(String(res.body.detail)).toContain("Risk closure");
    const errs = res.body.errors as Body[];
    expect(errs.map((e) => e.pointer)).toEqual([`/criteria/${riskKey}`]);
    expect(String(errs[0].message)).toContain("Risk closure");
    expect(String(errs[0].message)).toContain(risk.body.code);
    expect(await submissionsOf(g, "G5")).toBe(before);
  });

  it("REQ-S04-007: an approved disposition resolves the risk and G5 can be submitted", async () => {
    const d = await send("POST", `${g.base}/risk-dispositions`, {
      session: g.wl.session,
      body: {
        raidEntryId: riskId,
        disposition: "accept",
        rationale: "Synthetic QA: residual risk accepted for the scale wave.",
        residualOwnerUserId: g.bo.id,
      },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    // A proposed (undecided) disposition does not resolve it.
    expect((await criterionByLabel(g, "G5", "Risk closure")).completeness).toBe("incomplete");
    const a = await send("GET", `/api/v1/approvals/${d.body.approvalId}`, { session: g.auditor.session });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    // The disposition is decided by the person the T11 routing assigned (a synthetic in-product approval).
    const assignee = [g.sp, g.bo, g.tl].find((p) => p.id === a.body.assignee.userId);
    expect(assignee, JSON.stringify(a.body.assignee)).toBeTruthy();
    const approved = await send("POST", `/api/v1/approvals/${d.body.approvalId}/decisions`, {
      session: assignee!.session,
      headers: ifm(a.body.version),
      body: { outcome: "approve", rationale: RATIONALE, subjectVersion: a.body.subjectVersion },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await criterionByLabel(g, "G5", "Risk closure")).completeness).toBe("complete");
    const res = await submitGate(api, g, "G5");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.approverRoleCode).toBe("BO");
  });

  it("REQ-PB-020, REQ-PB-015: with G5 configured to BO an SP approval is 403; a stale submission number is 409; a BO approval succeeds and records the scale scope", async () => {
    const no = (await gateView(api, g, "G5")).gate.latestSubmissionNo as number;
    const approval = (submissionNo: number, extra: Record<string, unknown> = {}) => ({
      submissionNo,
      outcome: "approved",
      rationale: "Synthetic QA: pilot results justify scaling to BU a1 only.",
      scaleScope: {
        items: [{ initiativeId, businessUnitId: w.a1, note: "Synthetic QA pilot BU" }],
        conditions: [{ text: "Synthetic QA: weekly churn review", ownerUserId: g.bo.id, dueDate: "2026-12-31" }],
      },
      ...extra,
    });
    const bySp = await decideGate(api, g, "G5", g.sp.session, approval(no));
    expect([bySp.status, bySp.body.code]).toEqual([403, "gate.not_approver"]);
    expect(await decisionsOf(g, "G5")).toBe(0);
    const stale = await decideGate(api, g, "G5", g.bo.session, approval(no + 1));
    expect([stale.status, stale.body.code]).toEqual([409, "gate.submission_superseded"]);
    expect(await decisionsOf(g, "G5")).toBe(0);
    const byBo = await decideGate(api, g, "G5", g.bo.session, approval(no));
    expect(byBo.status, JSON.stringify(byBo.body)).toBe(201);
    expect([byBo.body.outcome, byBo.body.approverRoleCode, byBo.body.decidedBy]).toEqual(["approved", "BO", g.bo.id]);
    const scope = await send("GET", `${g.base}/scale-scope`, { session: g.auditor.session });
    expect(scope.body.approved).toBe(true);
    expect(scope.body.gateDecisionId).toBe(byBo.body.id);
    expect(scope.body.items.map((i: Body) => [i.initiativeId, i.businessUnitId])).toEqual([[initiativeId, w.a1]]);
  });

  it("REQ-S04-007, REQ-S03-004: after approval scaling inside the scope succeeds; scaling outside it is blocked", async () => {
    const outside = await send("POST", `${g.base}/scale-transitions`, {
      session: g.tl.session,
      body: { initiativeId, businessUnitId: w.a2 },
    });
    expect([outside.status, outside.body.code]).toEqual([422, "scale.outside_approved_scope"]);
    const inside = await send("POST", `${g.base}/scale-transitions`, {
      session: g.tl.session,
      body: { initiativeId, businessUnitId: w.a1, note: "Synthetic QA scale wave 1" },
    });
    expect(inside.status, JSON.stringify(inside.body)).toBe(201);
    expect([inside.body.initiativeId, inside.body.businessUnitId]).toEqual([initiativeId, w.a1]);
    const list = await send("GET", `${g.base}/scale-transitions`, { session: g.auditor.session });
    expect((list.body.items as Body[]).map((i) => i.businessUnitId)).toEqual([w.a1]);
  });

  it("REQ-PB-021, REQ-S04-008: G6 without an accepted BAU handover is refused, listing 'Ownership transfer'", async () => {
    const t = await send("GET", g.base, { session: g.auditor.session });
    expect(t.body.currentPhase).toBe("realize");
    const own = await criterionByLabel(g, "G6", "Ownership transfer");
    expect([own.mandatory, own.completeness]).toEqual([true, "incomplete"]);
    await coverAllBut(g, "G6", [own.key]);
    expect(await uncoveredKeys(api, g, "G6")).toEqual([own.key]);
    const res = await submitGate(api, g, "G6");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect(String(res.body.detail)).toContain("Ownership transfer");
    expect((res.body.errors as Body[]).map((e) => e.pointer)).toEqual([`/criteria/${own.key}`]);
    expect(String((res.body.errors as Body[])[0].message)).toContain("Ownership transfer");
    expect(await submissionsOf(g, "G6")).toBe(0);
  });

  it("REQ-S04-008: a product G6 approval (API and its worker consumer) changes nothing under docs/delivery/", async () => {
    const own = await criterionByLabel(g, "G6", "Ownership transfer");
    await coverWithException(api, g, "G6", own.key, plusDays(today, 30));
    const sub = await submitGate(api, g, "G6");
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const before = deliveryFingerprint();
    expect(Object.keys(before).length).toBeGreaterThan(0);
    const d = await decideGate(api, g, "G6", g.sp.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: "Synthetic QA G6 approval (a product business approval; never DG7).",
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await instanceRow(g, "G6")).status).toBe("approved");
    const decidedEvents = await api.db
      .selectFrom("outbox_event")
      .select("idempotency_key")
      .where("event_type", "=", "gate.decided")
      .where("aggregate_id", "=", (await instanceRow(g, "G6")).id)
      .execute();
    expect(decidedEvents.length).toBe(1);
    await handleGateDecided(api.db, await envelopeByKey(api, decidedEvents[0]!.idempotency_key), "qa-a08-g6-decided");
    expect(deliveryFingerprint()).toEqual(before);
  });
});

// ================================================================================================ approvals (T11)

describe("A08 approvals: rationale, request version, separation of duties, stale version, outcomes (REQ-S10-014/016/017/018)", () => {
  let g: NativeGateWorld;
  let rights: Record<string, string>;
  const REQ = () => `${g.base}/approvals`;
  /** A design decision through the API (TL), version 1. */
  const newDecision = async () => {
    const r = await send("POST", "/api/v1/decisions", {
      session: g.tl.session,
      body: { transformationId: g.transformationId, title: "Synthetic QA decision to approve" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; version: number };
  };
  const editDecision = async (id: string, version: number) => {
    const r = await send("PATCH", `/api/v1/decisions/${id}`, {
      session: g.tl.session,
      headers: ifm(version),
      body: { title: `Synthetic QA decision, edit ${version + 1}` },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.version as number;
  };
  const request = async (decisionId: string, right: string, subjectVersion = 1, session: Session = g.tl.session) => {
    const r = await send("POST", REQ(), {
      session,
      body: {
        approvalType: "decision_request",
        subjectId: decisionId,
        subjectVersion,
        decisionRightId: rights[right],
        title: "Synthetic QA business approval",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const decide = (id: string, session: Session, version: number, body: Record<string, unknown>) =>
    send("POST", `/api/v1/approvals/${id}/decisions`, { session, headers: ifm(version), body });

  beforeAll(async () => {
    g = await seedNativeGateWorld(api, w, "A08 approvals");
    // The organization's default business calendar (ADM_TECH, through the API); BO and SP are mapped by the world.
    const admin = await signIn(api.app, w.admin.subject);
    const cals = await send("GET", `/api/v1/organizations/${w.orgA.id}/calendars`, { session: admin });
    if (!(cals.body.items as Body[]).some((c) => c.isDefault && c.status === "active")) {
      const cal = await send("POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
        session: admin,
        body: { code: "QAA08CAL", nameEn: "Synthetic QA calendar", nameAr: "تقويم اختبار اصطناعي", isDefault: true },
      });
      expect(cal.status, JSON.stringify(cal.body)).toBe(201);
    }
    const list = await send("GET", `${g.base}/decision-rights`, { session: g.auditor.session });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    rights = Object.fromEntries(
      (list.body.items as Body[]).filter((r) => r.templateKey).map((r) => [r.templateKey, r.id]),
    );
    expect(Object.keys(rights)).toEqual(
      expect.arrayContaining(["business_scope_change", "target_state_design", "go_live_scale", "funding_reallocation"]),
    );
  }, 120_000);

  it("REQ-S10-014: a decision without rationale is refused (missing 400, blank 422 approval.rationale_required); the stored record includes the request version", async () => {
    const d = await newDecision();
    const v2 = await editDecision(d.id, 1);
    const a = await request(d.id, "target_state_design", v2);
    expect([a.subjectVersion, a.assignee.userId, a.status]).toEqual([2, g.bo.id, "pending"]);
    const missing = await decide(a.id, g.bo.session, a.version, { outcome: "approve", subjectVersion: 2 });
    expect(missing.status).toBe(400);
    const blank = await decide(a.id, g.bo.session, a.version, {
      outcome: "approve",
      rationale: "  ",
      subjectVersion: 2,
    });
    expect([blank.status, blank.body.code]).toEqual([422, "approval.rationale_required"]);
    const ok = await decide(a.id, g.bo.session, a.version, {
      outcome: "approve",
      rationale: "Synthetic QA: the evidence supports it.",
      comments: "Synthetic QA comment",
      subjectVersion: 2,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stored = await send("GET", `/api/v1/approvals/${a.id}`, { session: g.auditor.session });
    expect(stored.body).toMatchObject({ status: "approved", subjectVersion: 2, decidedBy: g.bo.id });
    expect(stored.body.decidedAt).not.toBeNull();
    expect(stored.body.decisions).toHaveLength(1);
    expect(stored.body.decisions[0]).toMatchObject({
      outcome: "approve",
      rationale: "Synthetic QA: the evidence supports it.",
      comments: "Synthetic QA comment",
      subjectVersion: 2,
      decidedBy: g.bo.id,
    });
    // The assignee and due date are part of the stored approval (REQ-S10-014's other fields).
    expect(stored.body.assignee.userId).toBe(g.bo.id);
    expect("dueDate" in stored.body).toBe(true);
    const row = await api.db
      .selectFrom("approval_decision")
      .select(["subject_version", "rationale"])
      .where("approval_id", "=", a.id)
      .executeTakeFirstOrThrow();
    expect([row.subject_version, row.rationale]).toEqual([2, "Synthetic QA: the evidence supports it."]);
  });

  it("REQ-S10-016: the requester approving their own scope change is 403 under the default policy; it stays pending", async () => {
    const d = await newDecision();
    // Business scope change is approved by the Sponsor; the Sponsor requests it and then tries to approve it.
    const a = await request(d.id, "business_scope_change", 1, g.sp.session);
    expect([a.assignee.userId, a.requestedBy]).toEqual([g.sp.id, g.sp.id]);
    const own = await decide(a.id, g.sp.session, a.version, {
      outcome: "approve",
      rationale: "Synthetic QA: my own change",
      subjectVersion: 1,
    });
    expect([own.status, own.body.code]).toEqual([403, "approval.sod_requester"]);
    const after = await send("GET", `/api/v1/approvals/${a.id}`, { session: g.auditor.session });
    expect([after.body.status, after.body.decisions]).toEqual(["pending", []]);
  });

  it("REQ-S10-017: approving version 3 after the record moved to version 4 is 409; no decision is stored", async () => {
    const d = await newDecision();
    let v = await editDecision(d.id, 1);
    v = await editDecision(d.id, v);
    expect(v).toBe(3);
    const a = await request(d.id, "target_state_design", 3);
    expect(await editDecision(d.id, 3)).toBe(4);
    const res = await decide(a.id, g.bo.session, a.version, {
      outcome: "approve",
      rationale: "Synthetic QA",
      subjectVersion: 3,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject({
      type: "urn:mth:problem:version-conflict",
      code: "approval.stale_version",
      currentVersion: 4,
      requestedVersion: 3,
    });
    const after = await send("GET", `/api/v1/approvals/${a.id}`, { session: g.auditor.session });
    expect([after.body.status, after.body.decisions]).toEqual(["pending", []]);
  });

  it("REQ-S10-018: 'request changes' returns the item to the requester without closing it", async () => {
    const d = await newDecision();
    const a = await request(d.id, "target_state_design");
    const res = await decide(a.id, g.bo.session, a.version, {
      outcome: "request_changes",
      rationale: "Synthetic QA: add the cost view.",
      subjectVersion: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.status, res.body.decidedAt]).toEqual(["changes_requested", null]);
    const back = await send("GET", "/api/v1/me/work-items?kind=approval_changes_requested&status=open", {
      session: g.tl.session,
    });
    expect((back.body.items as Body[]).filter((i) => i.subjectId === a.id)).toHaveLength(1);
    // Not closed: the record is not final (it can be resubmitted by the requester with a newer version).
    expect(["approved", "rejected", "withdrawn"]).not.toContain(res.body.status);
    const v2 = await editDecision(d.id, 1);
    const re = await send("POST", `/api/v1/approvals/${a.id}/resubmit`, {
      session: g.tl.session,
      headers: ifm(res.body.version),
      body: { subjectVersion: v2 },
    });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect([re.body.status, re.body.subjectVersion]).toEqual(["pending", v2]);
  });

  it("REQ-S10-018: 'defer' requires a new date; with one the item is deferred to it and stays undecided", async () => {
    const d = await newDecision();
    const a = await request(d.id, "target_state_design");
    const noDate = await decide(a.id, g.bo.session, a.version, {
      outcome: "defer",
      rationale: "Synthetic QA: wait for the vendor",
      subjectVersion: 1,
    });
    expect([noDate.status, noDate.body.code]).toEqual([422, "approval.defer_date_required"]);
    const ok = await decide(a.id, g.bo.session, a.version, {
      outcome: "defer",
      rationale: "Synthetic QA: wait for the vendor",
      subjectVersion: 1,
      deferUntil: "2099-03-02",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([ok.body.status, ok.body.dueDate, ok.body.decidedAt]).toEqual(["deferred", "2099-03-02", null]);
  });
});
