// T-DG6-BE-Z12B (F-DG6-480; D-218, D-222; ADR-0051 §2; REQ-S10-002 "a sensitive benefit is hidden from a workstream
// member without the grant"): the reference-inventory rows BE-Z12 repaired by code but no test seeded (PENDING), and the
// automation-condition row D-222 decides, each seeded here against the run's disposable PostgreSQL through the API (and,
// where only a worker writes the row, a direct insert with its audit event, marked as synthetic setup):
//   - approval.subject_id: a benefit_transition_decision approval decided by the SP before the benefit is marked;
//   - sustainment_review.transition_decision_id: a monitoring review of that approved decision;
//   - procedure_instance.subject_record_id and procedure_instance.input_values: a scope_target_change instance the
//     benefit's owner launches about the benefit, whose `reason` input names it;
//   - automation_rule_version.conditions: an admin rule whose conditions compare `benefitId` to the benefit's id.
// Readers not admitted (no grant, not a named party) get no id of the benefit or of its decision anywhere in these
// responses: the reference is null (or the condition literal is the neutral marker) with `includesRestrictedRecords:
// true`. Admitted readers (the TO, who holds sensitive_record.grant; the owner BO) still see the ids. A re-save of the
// rule version that sends the marker back keeps the stored literal unchanged; after an explicit grant the author sees it.
// Every value is SYNTHETIC. Marking a record sensitive or granting access is an access decision, never a business
// approval: the demo Sponsor decision below approves nothing real (G1-G6), and nothing here touches DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { AUTOMATION_RESTRICTED_LITERAL } from "@mth/shared/schemas";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  decideDecision,
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
/** The sensitive benefit and what names it; a plain benefit for the controls. */
const S = { benefitId: "", decisionId: "", approvalId: "", reviewId: "", instanceId: "", ruleId: "" };
const P = { benefitId: "" };
let admin: { id: string; session: Session };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
/** The hidden ids a response must not name (the benefit and its transition decision). */
const leaks = (body: unknown) => [S.benefitId, S.decisionId].filter((id) => JSON.stringify(body).includes(id));
const R = "/api/v1/admin/automation-rules";

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  S.benefitId = (await pendingBenefit(api, c, ini)).id;
  P.benefitId = (await pendingBenefit(api, c, ini)).id;

  // approval.subject_id: the transition decision of the benefit, submitted by BO and decided by the SP (demo data).
  const decision = await draftDecision(send, c, S.benefitId);
  S.decisionId = decision.id;
  S.approvalId = await decideDecision(send, c, decision);

  // sustainment_review.transition_decision_id: the monitoring review the worker opens for an approved decision
  // (transition-decisions.ts openMonitoringReviews), inserted as that job does, with its audit event (synthetic setup).
  S.reviewId = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("sustainment_review")
      .values({
        id: S.reviewId,
        organization_id: c.b.organizationId,
        transformation_id: c.b.transformationId,
        subject_kind: "transition_decision",
        transition_decision_id: S.decisionId,
        due_date: "2030-01-15",
        assignee_user_id: c.b.users.bo2.id,
        created_source: "worker",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "service", actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" },
      {
        action: "sustainment_review.create",
        recordType: "sustainment_review",
        recordId: S.reviewId,
        organizationId: c.b.organizationId,
        transformationId: c.b.transformationId,
        newVersion: 1,
        changes: { transition_decision_id: { from: null, to: S.decisionId } },
      },
    );
  });

  // procedure_instance.subject_record_id / input_values: BO (the owner) raises a scope/target change about the benefit.
  const launched = ok(
    await send("POST", "/api/v1/procedure-instances", {
      session: c.b.s.bo,
      body: {
        procedureCode: "scope_target_change",
        transformationId: c.b.transformationId,
        subjectRecordType: "benefit",
        subjectRecordId: S.benefitId,
        inputValues: { reason: S.benefitId },
      },
    }),
    201,
  );
  S.instanceId = launched.id;

  // automation_rule_version.conditions: a methodology admin's rule on the variance trigger naming the benefit.
  const u = await createUser(api.db, c.b.organizationId);
  await grant(
    api.db,
    w.grantor.id,
    u.id,
    "ADM_METHOD",
    { type: "organization", id: c.b.organizationId },
    c.b.organizationId,
  );
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
  const rule = ok(
    await send("POST", R, {
      session: admin.session,
      body: {
        code: `test.z12b.${randomUUID().slice(0, 8)}`,
        nameEn: "Synthetic variance follow-up",
        nameAr: "متابعة انحراف تجريبية",
        scopeLevel: "organization",
        organizationId: c.b.organizationId,
        ownerUserId: admin.id,
        content: {
          triggerCodes: ["benefit.variance_evaluated"],
          conditions: [
            { field: "benefitId", op: "eq", value: S.benefitId },
            { field: "benefitId", op: "in", value: [P.benefitId, S.benefitId] },
            { field: "severity", op: "eq", value: "high" },
          ],
          actions: [
            { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } },
          ],
          runAs: "service",
        },
      },
    }),
    201,
  );
  S.ruleId = rule.id;

  // The TO marks the benefit sensitive (an access decision, not an approval).
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${S.benefitId}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z12B)" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

describe("T-DG6-BE-Z12B: the PENDING inventory rows, seeded (F-DG6-480; D-218)", () => {
  it("control: TL, AUD and SP get 404 on the benefit and its decision; the TO and BO read both", async () => {
    for (const s of [c.b.s.tl, c.b.s.auditor, c.sp.session]) {
      expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s })).status).toBe(404);
      expect((await send("GET", `${c.transitions}/${S.decisionId}`, { session: s })).status).toBe(404);
    }
    for (const s of [c.s.to.session, c.b.s.bo]) {
      ok(await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s }));
      ok(await send("GET", `${c.transitions}/${S.decisionId}`, { session: s }));
    }
  });

  it("approval.subject_id: the SP's approval of the restricted decision names no subject id (marked)", async () => {
    const one = ok(await send("GET", `/api/v1/approvals/${S.approvalId}`, { session: c.sp.session }));
    expect({ type: one.approvalType, subjectId: one.subjectId, marker: one.includesRestrictedRecords }).toEqual({
      type: "benefit_transition_decision",
      subjectId: null,
      marker: true,
    });
    expect(leaks(one), "getApproval").toEqual([]);
    const mine = ok(await send("GET", "/api/v1/approvals?limit=100&status=approved", { session: c.sp.session }));
    const listed = mine.items.find((a: Body) => a.id === S.approvalId);
    expect(listed, "the approval stays listed").toBeDefined();
    expect({ subjectId: listed.subjectId, marker: listed.includesRestrictedRecords }).toEqual({
      subjectId: null,
      marker: true,
    });
    expect(leaks(mine), "listMyApprovals").toEqual([]);
    const records = ok(await send("GET", `${c.b.base}/approval-decisions?limit=100`, { session: c.b.s.auditor }));
    expect(leaks(records), "listApprovalDecisionRecords (AUD)").toEqual([]);
    // Positive: the admitted TO sees the subject.
    const to = ok(await send("GET", `${c.b.base}/approval-decisions?limit=100`, { session: c.s.to.session }));
    expect(JSON.stringify(to)).toContain(S.decisionId);
  });

  it("sustainment_review.transition_decision_id: TL and AUD see the review without the decision id (marked)", async () => {
    for (const [who, s] of [
      ["TL", c.b.s.tl],
      ["AUD", c.b.s.auditor],
    ] as const) {
      const list = ok(await send("GET", `${c.b.base}/sustainment-reviews?limit=100`, { session: s }));
      const review = list.items.find((r: Body) => r.id === S.reviewId);
      expect(review, `${who}: the review stays listed`).toBeDefined();
      expect({
        kind: review.subjectKind,
        decision: review.transitionDecisionId,
        marker: review.includesRestrictedRecords,
      }).toEqual({ kind: "transition_decision", decision: null, marker: true });
      expect(leaks(list), `${who}: listSustainmentReviews`).toEqual([]);
    }
    const to = ok(await send("GET", `${c.b.base}/sustainment-reviews?limit=100`, { session: c.s.to.session }));
    expect(to.items.find((r: Body) => r.id === S.reviewId).transitionDecisionId).toBe(S.decisionId);
  });

  it("procedure_instance.subject_record_id and input_values: TL sees the instance without the benefit id (marked)", async () => {
    const I = `/api/v1/procedure-instances/${S.instanceId}`;
    const one = ok(await send("GET", I, { session: c.b.s.tl }));
    expect({
      type: one.subjectRecordType,
      subject: one.subjectRecordId,
      reason: one.inputValues.reason,
      marker: one.includesRestrictedRecords,
    }).toEqual({ type: "benefit", subject: null, reason: null, marker: true });
    expect(leaks(one), "getProcedureInstance").toEqual([]);
    const list = ok(
      await send("GET", `/api/v1/procedure-instances?transformationId=${c.b.transformationId}&limit=100`, {
        session: c.b.s.tl,
      }),
    );
    expect(
      list.items.some((x: Body) => x.id === S.instanceId),
      "the instance stays listed",
    ).toBe(true);
    expect(leaks(list), "listProcedureInstances").toEqual([]);
    // Positive: the owner who launched it sees the subject and the input.
    const bo = ok(await send("GET", I, { session: c.b.s.bo }));
    expect({ subject: bo.subjectRecordId, reason: bo.inputValues.reason }).toEqual({
      subject: S.benefitId,
      reason: S.benefitId,
    });
  });
});

describe("T-DG6-BE-Z12B: automation_rule_version.conditions (D-222)", () => {
  const V = () => `${R}/${S.ruleId}/versions`;
  const storedConditions = async () =>
    (await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions", "content_sha256", "version"])
      .where("automation_rule_id", "=", S.ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()) as { conditions: Body; content_sha256: string; version: number };

  it("the author, not admitted, sees the marker in place of each hidden literal, the label in the summary, marked", async () => {
    const one = ok(await send("GET", `${V()}/1`, { session: admin.session }));
    expect(one.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: AUTOMATION_RESTRICTED_LITERAL },
      { field: "benefitId", op: "in", value: [P.benefitId, AUTOMATION_RESTRICTED_LITERAL] },
      { field: "severity", op: "eq", value: "high" },
    ]);
    expect(one.includesRestrictedRecords).toBe(true);
    expect(one.summary.en).toContain("a restricted record");
    expect(one.summary.ar).toContain("سجل مقيد");
    expect(leaks(one), "getAutomationRuleVersion").toEqual([]);
    const list = ok(await send("GET", V(), { session: admin.session }));
    expect(list.items[0].includesRestrictedRecords).toBe(true);
    expect(leaks(list), "listAutomationRuleVersions").toEqual([]);
    const rule = ok(await send("GET", `${R}/${S.ruleId}`, { session: admin.session }));
    expect(leaks(rule), "getAutomationRule").toEqual([]);
    // The stored conditions and the content hash are unchanged.
    const stored = await storedConditions();
    expect(stored.conditions[0].value).toBe(S.benefitId);
    expect(one.contentSha256).toBe(stored.content_sha256);
  });

  it("a re-save that sends the marker back keeps each hidden literal; an unrelated edit still applies", async () => {
    const before = await storedConditions();
    const shown = ok(await send("GET", `${V()}/1`, { session: admin.session }));
    const content = {
      ...shown.content,
      conditions: shown.content.conditions.map((x: Body) => (x.field === "severity" ? { ...x, value: "critical" } : x)),
    };
    const saved = ok(
      await send("PATCH", `${V()}/1`, {
        session: admin.session,
        headers: ifm(shown.version),
        body: { content, changeSummary: "Synthetic re-save of a restricted condition" },
      }),
    );
    expect(saved.includesRestrictedRecords).toBe(true);
    expect(leaks(saved), "updateAutomationRuleVersion response").toEqual([]);
    const after = await storedConditions();
    expect(after.version).toBe(before.version + 1);
    expect(after.conditions).toEqual([
      { field: "benefitId", op: "eq", value: S.benefitId },
      { field: "benefitId", op: "in", value: [P.benefitId, S.benefitId] },
      { field: "severity", op: "eq", value: "critical" },
    ]);
    // The marker where no hidden literal stood is an ordinary literal (names nothing).
    const extra = ok(
      await send("PATCH", `${V()}/1`, {
        session: admin.session,
        headers: ifm(saved.version),
        body: {
          content: {
            ...content,
            conditions: [...content.conditions, { field: "severity", op: "neq", value: AUTOMATION_RESTRICTED_LITERAL }],
          },
        },
      }),
    );
    const last = await storedConditions();
    expect(last.conditions.at(-1)).toEqual({ field: "severity", op: "neq", value: AUTOMATION_RESTRICTED_LITERAL });
    expect(last.conditions[0].value).toBe(S.benefitId);
    expect(extra.version).toBe(saved.version + 1);
  });

  it("positive: with an explicit grant the author sees the literals again (next request)", async () => {
    ok(
      await send("POST", "/api/v1/admin/sensitive-grants", {
        session: c.s.to.session,
        body: {
          transformationId: c.b.transformationId,
          recordType: "benefit",
          recordId: S.benefitId,
          granteeUserId: admin.id,
          reason: "Synthetic need to know (rule author)",
        },
      }),
      201,
    );
    const one = ok(await send("GET", `${V()}/1`, { session: admin.session }));
    expect(one.content.conditions[0]).toEqual({ field: "benefitId", op: "eq", value: S.benefitId });
    expect(one.includesRestrictedRecords).toBeUndefined();
  });
});
