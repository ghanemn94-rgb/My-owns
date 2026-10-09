// Per-criterion gate review and Under Review (T-DG4-BE-K2; ADR-0035 §3, §8, §11; REQ-S04-009, REQ-S04-010) against a
// real PostgreSQL:
//  - each criterion row of a submission returns all nine M0124 fields (criterion, required evidence, completeness,
//    reviewer, finding, open condition, risk, decision, rationale); an unreviewed row shows the six review fields as
//    null ("not reviewed"), never "meets";
//  - the first criterion review moves the gate from Submitted to Under Review with one audit event; later reviews keep
//    it there; the approver then decides from Under Review (DG2 decision; rationale required: 400 without it);
//  - a direct Draft -> Approved is refused (DG2 409 gate.submission_superseded) and each transition (submit, review
//    opened, decide) writes one audit event on the gate instance;
//  - the submitter cannot review (403), only a pending submission is reviewed (422), meets_with_conditions needs an
//    open condition (422), a risk link must be in the transformation (422); AUD 403; If-Match 428/409.
// The G1 submissions are real API submissions whose missing criteria are covered by accepted exceptions (synthetic).
// Every decision is a demo in-product business decision by a test person that approves nothing real; nothing touches
// the engineering delivery gates DG0-DG7.
import { sql } from "@mth/db";
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
import {
  coverGate,
  highRisk,
  plusDays,
  seedGateWorld,
  submitThroughApi,
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
const RATIONALE = "Synthetic demo decision; approves nothing real.";

const instanceOf = (g: GateWorld, code = "G1") =>
  api.db
    .selectFrom("gate_instance")
    .select(["id", "status", "version"])
    .where("transformation_id", "=", g.b.transformationId)
    .where("gate_code", "=", code)
    .executeTakeFirstOrThrow();

/** A gate world with a real, pending G1 submission (its missing criteria covered by accepted exceptions). */
async function submittedG1() {
  const g = await seedGateWorld(api, w);
  const covered = await coverGate(send, g, "G1", plusDays(await todayOf(api, g), 30));
  const sub = await submitThroughApi(api, send, g, "G1");
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const no = (sub.body as Body).submissionNo as number;
  return { g, covered, no, crit: `${g.gates}/G1/submissions/${no}/criteria` };
}

const reviewBody = (extra: Record<string, unknown> = {}) => ({
  finding: "Synthetic: the diagnostic is partial; an exception covers it.",
  recommendation: "meets",
  rationale: "Synthetic: adequate for the case for change.",
  ...extra,
});

describe("the criteria review table (REQ-S04-009)", () => {
  it("each criterion row returns all nine fields; unreviewed rows show the six review fields as 'not reviewed' (null)", async () => {
    const { g, crit } = await submittedG1();
    const before = await send("GET", crit, { session: g.b.s.auditor });
    expect(before.status).toBe(200);
    expect((before.body as Body).items).toHaveLength(6);
    for (const row of (before.body as Body).items) {
      expect(row.criterionLabelEn.length > 0 && row.requiredEvidenceEn.length > 0).toBe(true);
      expect(row.criterionLabelAr.length > 0 && row.requiredEvidenceAr.length > 0).toBe(true);
      expect(["complete", "incomplete"]).toContain(row.completeness);
      expect([row.reviewerUserId, row.finding, row.openCondition, row.risk, row.decision, row.rationale]).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      expect(row.reviewCount).toBe(0);
    }
    const key = (before.body as Body).items[0].criterionKey as string;
    const risk = await highRisk(send, g);
    const r = await send("POST", `${crit}/${key}/reviews`, {
      session: g.b.s.bo,
      headers: ifm((await instanceOf(g)).version),
      body: reviewBody({
        recommendation: "meets_with_conditions",
        openCondition: "Synthetic: vendor diagnostic before G2.",
        riskNote: "Synthetic: vendor delay risk.",
        raidEntryId: risk.id,
      }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = await send("GET", crit, { session: g.b.s.auditor });
    const row = (after.body as Body).items.find((x: Body) => x.criterionKey === key);
    // The nine fields, all present (9 of 9 non-null; GR05).
    const nine = [
      row.criterionLabelEn,
      row.requiredEvidenceEn,
      row.completeness,
      row.reviewerUserId,
      row.finding,
      row.openCondition,
      row.risk,
      row.decision,
      row.rationale,
    ];
    expect(nine.every((v) => v !== null && v !== undefined)).toBe(true);
    expect([row.reviewerUserId, row.decision, row.risk, row.reviewCount]).toEqual([
      g.b.users.bo.id,
      "meets_with_conditions",
      { note: "Synthetic: vendor delay risk.", raidEntryId: risk.id },
      1,
    ]);
    expect((after.body as Body).gateStatus).toBe("under_review");
    // The persisted row carries the same values.
    const stored = await api.db
      .selectFrom("gate_criterion_review")
      .selectAll()
      .where("id", "=", (r.body as Body).id)
      .executeTakeFirstOrThrow();
    expect([stored.finding, stored.open_condition, stored.risk_note, stored.recommendation, stored.rationale]).toEqual([
      row.finding,
      row.openCondition,
      row.risk.note,
      row.decision,
      row.rationale,
    ]);
  });

  it("the latest review is shown; the review list is oldest first; a criterion outside the submission is 404", async () => {
    const { g, crit } = await submittedG1();
    const key = "g1.diagnostic";
    for (const recommendation of ["does_not_meet", "meets"]) {
      const r = await send("POST", `${crit}/${key}/reviews`, {
        session: g.s.to.session,
        headers: ifm((await instanceOf(g)).version),
        body: reviewBody({ recommendation }),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const list = await send("GET", `${crit}/${key}/reviews`, { session: g.b.s.auditor });
    expect((list.body as Body).items.map((x: Body) => [x.reviewNo, x.recommendation])).toEqual([
      [1, "does_not_meet"],
      [2, "meets"],
    ]);
    const table = await send("GET", crit, { session: g.b.s.auditor });
    const row = (table.body as Body).items.find((x: Body) => x.criterionKey === key);
    expect([row.decision, row.reviewCount]).toEqual(["meets", 2]);
    expect((await send("GET", `${crit}/g2.north_star/reviews`, { session: g.b.s.auditor })).status).toBe(404);
    expect((await send("GET", `${g.gates}/G1/submissions/99/criteria`, { session: g.b.s.auditor })).status).toBe(404);
  });
});

describe("Under Review and the enforced transitions (REQ-S04-010)", () => {
  it("the first review moves Submitted -> Under Review (one audit event); the approver decides from Under Review", async () => {
    const { g, crit, no } = await submittedG1();
    const inst = await instanceOf(g);
    expect(inst.status).toBe("submitted");
    const first = await send("POST", `${crit}/g1.baseline/reviews`, {
      session: g.b.s.bo,
      headers: ifm(inst.version),
      body: reviewBody(),
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((first.body as Body).reviewNo).toBe(1);
    const opened = await instanceOf(g);
    expect([opened.status, opened.version]).toEqual(["under_review", inst.version + 1]);
    // The stale ETag is now refused (409); the current one is accepted and leaves the status (and version) as is.
    const stale = await send("POST", `${crit}/g1.baseline/reviews`, {
      session: g.b.s.bo,
      headers: ifm(inst.version),
      body: reviewBody(),
    });
    expect([stale.status, (stale.body as Body).currentVersion]).toEqual([409, opened.version]);
    const second = await send("POST", `${crit}/g1.root_causes/reviews`, {
      session: g.b.s.fin,
      headers: ifm(opened.version),
      body: reviewBody(),
    });
    expect(second.status).toBe(201);
    expect(await instanceOf(g)).toEqual(opened);
    // A decision without rationale is rejected by the API (DG2 400), from Under Review too.
    const noRationale = await send("POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: {
        submissionNo: no,
        outcome: "approved",
        agreements: { problem: true, baseline: true, materialValuePools: true },
      },
    });
    expect(noRationale.status).toBe(400);
    const decided = await send("POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: {
        submissionNo: no,
        outcome: "approved",
        rationale: RATIONALE,
        agreements: { problem: true, baseline: true, materialValuePools: true },
      },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    expect((await instanceOf(g)).status).toBe("approved");
    // Each transition wrote exactly one gate-instance audit event: submit, review opened, decide.
    const actions = (await auditOf(api.db, inst.id))
      .map((e) => e.action)
      .filter((a) => a.startsWith("gate_instance.") && a !== "gate_instance.create");
    expect(actions).toEqual(["gate_instance.submit", "gate_instance.review_open", "gate_instance.decide"]);
    const reviewAudit = (await auditOf(api.db, (first.body as Body).id)).map((e) => e.action);
    expect(reviewAudit).toEqual(["gate_criterion_review.create"]);
    // After the decision nothing more can be reviewed (422).
    const closed = await send("POST", `${crit}/g1.baseline/reviews`, {
      session: g.b.s.bo,
      headers: ifm((await instanceOf(g)).version),
      body: reviewBody(),
    });
    expect([closed.status, (closed.body as Body).code, (closed.body as Body).detail]).toEqual([
      422,
      "gate.review_not_open",
      "Only a submitted or under-review gate submission can be reviewed.",
    ]);
  });

  it("a direct Draft -> Approved is refused (409, nothing written); all seven statuses exist", async () => {
    const g = await seedGateWorld(api, w);
    const inst = await instanceOf(g);
    expect(inst.status).toBe("draft");
    const r = await send("POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: {
        submissionNo: 1,
        outcome: "approved",
        rationale: RATIONALE,
        agreements: { problem: true, baseline: true, materialValuePools: true },
      },
    });
    expect([r.status, (r.body as Body).code, (r.body as Body).detail]).toEqual([
      409,
      "gate.submission_superseded",
      "There is no pending submission to decide.",
    ]);
    expect(await instanceOf(g)).toEqual(inst);
    const allowed = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'gate_instance_status_check'`.execute(
      api.db,
    );
    const clause = allowed.rows[0]!.def;
    for (const s of ["draft", "submitted", "under_review", "changes_requested", "approved", "rejected", "deferred"])
      expect(clause).toContain(`'${s}'`);
  });

  it("refusals: submitter 403, condition 422, foreign risk 422, AUD 403, If-Match 428; nothing written", async () => {
    const { g, crit } = await submittedG1();
    const other = await seedGateWorld(api, w);
    const foreignRisk = await highRisk(send, other);
    const v = (await instanceOf(g)).version;
    const url = `${crit}/g1.value_pools/reviews`;
    const bySubmitter = await send("POST", url, { session: g.b.s.tl, headers: ifm(v), body: reviewBody() });
    // TL holds no gate.review: a plain 403. A reviewer-role holder who submitted is refused with the SoD code.
    expect(bySubmitter.status).toBe(403);
    const condition = await send("POST", url, {
      session: g.b.s.bo,
      headers: ifm(v),
      body: reviewBody({ recommendation: "meets_with_conditions" }),
    });
    expect([condition.status, (condition.body as Body).code, (condition.body as Body).errors[0].pointer]).toEqual([
      422,
      "gate.review_condition_required",
      "/openCondition",
    ]);
    const foreign = await send("POST", url, {
      session: g.b.s.bo,
      headers: ifm(v),
      body: reviewBody({ raidEntryId: foreignRisk.id }),
    });
    expect([foreign.status, (foreign.body as Body).errors[0].pointer]).toEqual([422, "/raidEntryId"]);
    const aud = await send("POST", url, { session: g.b.s.auditor, headers: ifm(v), body: reviewBody() });
    expect(aud.status).toBe(403);
    const adm = await send("POST", url, { session: g.b.s.admin, headers: ifm(v), body: reviewBody() });
    expect([403, 404]).toContain(adm.status);
    const noIfMatch = await send("POST", url, { session: g.b.s.bo, body: reviewBody() });
    expect(noIfMatch.status).toBe(428);
    const blank = await send("POST", url, { session: g.b.s.bo, headers: ifm(v), body: reviewBody({ finding: "  " }) });
    expect(blank.status).toBe(400);
    const nul = await send("POST", url, {
      session: g.b.s.bo,
      headers: ifm(v),
      body: reviewBody({ rationale: "Synthetic\u0000text" }),
    });
    expect(nul.status).toBe(400);
    expect(
      await api.db
        .selectFrom("gate_criterion_review")
        .select("id")
        .where("transformation_id", "=", g.b.transformationId)
        .execute(),
    ).toHaveLength(0);
    expect((await instanceOf(g)).status).toBe("submitted");
  });

  it("the submitter holding a reviewer role is refused with 403 gate.reviewer_is_submitter (SoD)", async () => {
    const g = await seedGateWorld(api, w);
    // A person holding TL (gate.submit) and BO (gate.review) submits (with covering exceptions), then tries to review.
    const u = await createUser(api.db, w.orgA.id);
    for (const role of ["TL", "BO"])
      await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: g.b.transformationId }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    await coverGate(send, g, "G1", plusDays(await todayOf(api, g), 30));
    const v = (await instanceOf(g)).version;
    const sub = await send("POST", `${g.gates}/G1/submissions`, {
      session,
      headers: ifm(v),
      body: { submissionNote: "Synthetic" },
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const r = await send(
      "POST",
      `${g.gates}/G1/submissions/${(sub.body as Body).submissionNo}/criteria/g1.baseline/reviews`,
      { session, headers: ifm((await instanceOf(g)).version), body: reviewBody() },
    );
    expect([r.status, (r.body as Body).code, (r.body as Body).detail]).toEqual([
      403,
      "gate.reviewer_is_submitter",
      "The submitter cannot review their own gate submission.",
    ]);
  });
});
