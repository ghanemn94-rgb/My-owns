// Playbook Studio review where configured, publish, rollback and review policies (ADR-0039 §5, §7, §9, §11, §13;
// REQ-S06-007, REQ-S06-009, REQ-S06-010, REQ-S02-001 (the publish gate), REQ-PB-093 (the 100 % rule), REQ-S12-018
// case 1; p5-work-split §A.4; T-DG5-BE-B3) against a real PostgreSQL:
//  - REQ-S06-007 literal: publish without the required review -> 422 config_version.review_required; editing a
//    published version -> 409 config_version.not_editable;
//  - REQ-S02-001: deleting T13 in a draft makes the coverage run fail, and publish -> 422 config_version.source_incomplete;
//  - the author or requester deciding its review -> 403 config_review.self_review;
//  - a kind with review_required = false publishes from preview in one call (two version steps, two audit events);
//  - REQ-S06-009 literal: rollback creates a new version (reason required); records created under the rolled-back
//    version stay retrievable and unchanged; the audit trail shows methodology_version.rollback_create and .publish;
//  - TO can switch review off, ADM_METHOD gets 403; the reviewer is never AUD or an administrator role;
//  - REQ-S06-010: the ADM_METHOD who publishes gets 403 on a funding decision; BO gets 403 on every Studio write of
//    this file;
//  - every mutation: AUD 403; If-Match 428/409; one audit event per row written; authorization re-checked at commit
//    time (403, nothing written); review tasks exactly once.
// Each test seeds its own synthetic base key (test/support/studio-fixtures.ts), so parallel suites never share a draft.
// The one policy this file changes is `health_check_scheme` (no other slice A suite publishes that kind), and it is
// restored after its test. All data is synthetic; a configuration review or publish approves nothing in the business
// and never touches the engineering gates DG0-DG7.
import { randomBytes } from "node:crypto";
import { createDb, insertAuditEvent } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let reviewer: Session;
let reviewerId: string;
let reviewer2Id: string;
let auditor: Session;
let bo: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewerId = r.id;
  reviewer = await signIn(api.app, r.subject);
  const r2 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r2.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewer2Id = r2.id;
  auditor = await signIn(api.app, w.auditor.subject);
  const boUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, boUser.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, boUser.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const POLICIES = "/api/v1/admin/config-review-policies";
const COVERAGE_RUNS = "/api/v1/admin/source-coverage/runs";
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;
const getVersion = (id: string) => call<Body>(api.app, "GET", `${V}/${id}`, { session: auditor });

async function freshDraft(kind: "methodology" | "scoring_defaults" = "methodology", baseId?: string) {
  const base = baseId ?? (await seedStudioBase(api, kind)).id;
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base } });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, baseId: base };
}
const preview = async (id: string) => {
  const res = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { samples: [] },
  });
  expect([res.status, res.body.result]).toEqual([201, "pass"]);
};
const compatibility = async (id: string) => {
  const res = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: admin,
    headers: ifm(await versionOf(id)),
  });
  expect(res.status).toBe(201);
  return res.body.result as string;
};
const coverage = async (id: string) => {
  const res = await call<Body>(api.app, "POST", COVERAGE_RUNS, { session: admin, body: { versionId: id } });
  expect(res.status).toBe(201);
  return res.body.result as string;
};
const submit = async (id: string, s = admin) =>
  call<Body>(api.app, "POST", `${V}/${id}/submit-review`, { session: s, headers: ifm(await versionOf(id)), body: {} });
const decide = (id: string, reviewId: string, version: number, body: Body, s = reviewer) =>
  call<Body>(api.app, "POST", `${V}/${id}/reviews/${reviewId}/decision`, { session: s, headers: ifm(version), body });
const publish = async (id: string, s = admin) =>
  call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: s, headers: ifm(await versionOf(id)) });

/** preview, compatibility, coverage (methodology), submit and the TO approval: the draft ends `approved`. */
async function toApproved(id: string, kind = "methodology"): Promise<string> {
  await preview(id);
  expect(await compatibility(id)).not.toBe("fail");
  if (kind === "methodology") expect(await coverage(id)).not.toBe("fail");
  const sub = await submit(id);
  expect(sub.status).toBe(201);
  const d = await decide(id, sub.body.id, 1, { outcome: "approve" });
  expect(d.status).toBe(200);
  return sub.body.id as string;
}

const reviewItems = (requestId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["assignee_user_id", "status", "dedupe_key", "kind"])
    .where("subject_type", "=", "config_review_request")
    .where("subject_id", "=", requestId)
    .execute();

/** A synthetic published base of a kind without element types (the owner role, as the migration would). */
async function seedBaseOfKind(kind: string): Promise<string> {
  const id = uuidv7();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_version")
        .values({
          id,
          key: `test-${kind.replace(/_/g, "-")}-${uniq("k").toLowerCase()}`,
          version_no: 1,
          status: "published",
          title_en: "Synthetic Studio base",
          title_ar: "أساس تجريبي",
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify({ schema: "mth.test/1", fixture: true }),
          content_sha256: randomBytes(32).toString("hex"),
          published_at: new Date(),
          config_kind: kind,
          origin: "seed",
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "methodology_version",
        recordId: id,
        organizationId: null,
        newVersion: 1,
      });
    });
  return id;
}

describe("submitConfigReview and decideConfigReview (ADR-0039 §5, §8)", () => {
  it("submit records the request, the proposal and one task per TO holder (never the requester); approve; tasks close", async () => {
    const d = await freshDraft();
    await preview(d.id);
    expect(await compatibility(d.id)).toBe("pass");
    const sub = await submit(d.id);
    expect(sub.status).toBe(201);
    expect(sub.headers["location"]).toBe(`${V}/${d.id}/reviews`);
    expect(sub.body).toMatchObject({
      versionId: d.id,
      status: "pending",
      reviewerRoleCode: "TO",
      requestedBy: adminId,
    });
    const v = (await getVersion(d.id)).body;
    expect(v).toMatchObject({
      draftStage: "review",
      pendingReviewId: sub.body.id,
      contentSha256: sub.body.contentSha256,
    });
    // The S12-018 proposal of this content (validation from the stored runs), linked from the request.
    const proposal = await api.db
      .selectFrom("revision_proposal")
      .selectAll()
      .where("id", "=", sub.body.revisionProposalId)
      .executeTakeFirstOrThrow();
    expect(proposal).toMatchObject({ subject_id: d.id, validation_result: "pass", reviewer_role_code: "TO" });
    const items = await reviewItems(sub.body.id);
    const mine = items.filter((i) => i.assignee_user_id === reviewerId);
    expect(mine).toEqual([
      {
        assignee_user_id: reviewerId,
        status: "open",
        kind: "config_review",
        dedupe_key: `config_review:${proposal.id}:${reviewerId}`,
      },
    ]);
    expect(items.some((i) => i.assignee_user_id === reviewer2Id)).toBe(true);
    expect(items.some((i) => i.assignee_user_id === adminId)).toBe(false);
    expect(items).toHaveLength(proposal.review_task_count);
    // One audit event per row written: the request; the version's step.
    expect(await actions(sub.body.id)).toEqual(["config_review_request.create"]);
    expect((await actions(d.id)).slice(-1)).toEqual(["methodology_version.submit_review"]);

    // A draft under review is no longer being edited.
    const patch = await call<Body>(api.app, "PATCH", `${V}/${d.id}`, {
      session: admin,
      headers: ifm(v.version),
      body: { titleEn: "late edit" },
    });
    expect(codeOf(patch)).toEqual([409, "config_version.not_editable"]);
    expect(codeOf(await submit(d.id))).toEqual([409, "config_version.not_editable"]);

    const ok = await decide(d.id, sub.body.id, 1, { outcome: "approve", note: "Synthetic approval of configuration" });
    expect(ok.status).toBe(200);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.body).toMatchObject({ status: "approved", decidedBy: reviewerId, version: 2 });
    expect((await getVersion(d.id)).body).toMatchObject({ draftStage: "approved", pendingReviewId: null });
    const after = await reviewItems(sub.body.id);
    expect(after.find((i) => i.assignee_user_id === reviewerId)?.status).toBe("done");
    expect(after.filter((i) => i.assignee_user_id !== reviewerId).every((i) => i.status === "cancelled")).toBe(true);
    expect(await actions(sub.body.id)).toEqual(["config_review_request.create", "config_review_request.decide"]);
    expect((await actions(d.id)).slice(-1)).toEqual(["methodology_version.review_approve"]);
    // Decided once: a second decision is refused.
    expect(codeOf(await decide(d.id, sub.body.id, 2, { outcome: "approve" }))).toEqual([422, "invalid_transition"]);
  });

  it("the author or the requester deciding the review -> 403 config_review.self_review; ADM_METHOD, AUD, BO -> 403", async () => {
    // A user who is both ADM_METHOD and TO authors and submits: deciding its own review is refused.
    const both = await methodologyAdmin(api.db, w);
    await grant(api.db, w.grantor.id, both.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const bothS = await signIn(api.app, both.subject);
    const base = await seedStudioBase(api, "methodology");
    const created = await call<Body>(api.app, "POST", V, { session: bothS, body: { basedOnVersionId: base.id } });
    expect(created.status).toBe(201);
    await preview(created.body.id);
    const sub = await submit(created.body.id, bothS);
    expect(sub.status).toBe(201);
    const self = await decide(created.body.id, sub.body.id, 1, { outcome: "approve" }, bothS);
    expect(codeOf(self)).toEqual([403, "config_review.self_review"]);
    expect(self.body.detail).toBe("You cannot review a configuration change you authored or requested.");
    // The requester (not the author) is refused too.
    const d = await freshDraft();
    await preview(d.id);
    const byBoth = await submit(d.id, bothS);
    expect(byBoth.status).toBe(201);
    expect(codeOf(await decide(d.id, byBoth.body.id, 1, { outcome: "approve" }, bothS))).toEqual([
      403,
      "config_review.self_review",
    ]);
    for (const s of [admin, auditor, bo])
      expect((await decide(d.id, byBoth.body.id, 1, { outcome: "approve" }, s)).status).toBe(403);
    // Nothing moved.
    expect((await getVersion(d.id)).body.draftStage).toBe("review");
    expect(await actions(byBoth.body.id)).toEqual(["config_review_request.create"]);
  });

  it("request changes needs a note, returns the draft to editing; resubmitting the same content tasks the reviewers once more", async () => {
    const d = await freshDraft();
    await preview(d.id);
    const first = await submit(d.id);
    const noNote = await decide(d.id, first.body.id, 1, { outcome: "request_changes" });
    expect([noNote.status, noNote.body.errors?.[0]?.pointer, noNote.body.errors?.[0]?.code]).toEqual([
      400,
      "/note",
      "validation.required",
    ]);
    const changes = await decide(d.id, first.body.id, 1, { outcome: "request_changes", note: "Synthetic: clarify" });
    expect(changes.body).toMatchObject({ status: "changes_requested", decisionNote: "Synthetic: clarify" });
    expect((await getVersion(d.id)).body.draftStage).toBe("editing");
    expect((await reviewItems(first.body.id)).every((i) => i.status !== "open")).toBe(true);
    // Same content again: the proposal is already recorded (exactly once), the new request gets round-2 tasks.
    await preview(d.id);
    const second = await submit(d.id);
    expect(second.status).toBe(201);
    expect(second.body.revisionProposalId).toBe(first.body.revisionProposalId);
    const items = await reviewItems(second.body.id);
    expect(items.find((i) => i.assignee_user_id === reviewerId)).toMatchObject({
      status: "open",
      dedupe_key: `config_review:${first.body.revisionProposalId}#2:${reviewerId}`,
    });
    const proposals = await api.db
      .selectFrom("revision_proposal")
      .select("id")
      .where("subject_id", "=", d.id)
      .execute();
    expect(proposals).toHaveLength(1);
  });

  it("withdraw returns the draft to editing and cancels the tasks; only a pending review is withdrawn", async () => {
    const d = await freshDraft();
    await preview(d.id);
    const sub = await submit(d.id);
    const W = `${V}/${d.id}/reviews/${sub.body.id}/withdraw`;
    expect((await call<Body>(api.app, "POST", W, { session: auditor, headers: ifm(1) })).status).toBe(403);
    expect((await call<Body>(api.app, "POST", W, { session: bo, headers: ifm(1) })).status).toBe(403);
    expect((await call<Body>(api.app, "POST", W, { session: admin })).status).toBe(428);
    expect((await call<Body>(api.app, "POST", W, { session: admin, headers: ifm(3) })).status).toBe(409);
    const res = await call<Body>(api.app, "POST", W, { session: admin, headers: ifm(1) });
    expect(res.body).toMatchObject({ status: "withdrawn", version: 2 });
    expect((await getVersion(d.id)).body.draftStage).toBe("editing");
    expect((await reviewItems(sub.body.id)).every((i) => i.status === "cancelled")).toBe(true);
    expect(await actions(sub.body.id)).toEqual(["config_review_request.create", "config_review_request.withdraw"]);
    expect((await actions(d.id)).slice(-1)).toEqual(["methodology_version.review_withdraw"]);
    expect(codeOf(await call<Body>(api.app, "POST", W, { session: admin, headers: ifm(2) }))).toEqual([
      422,
      "invalid_transition",
    ]);
  });
});

describe("publishConfigVersion (ADR-0039 §1, §5, §6, §13; REQ-S06-007, REQ-S02-001)", () => {
  it("publish without the required review -> 422 config_version.review_required; after approval it publishes, immutable", async () => {
    const d = await freshDraft();
    expect(codeOf(await publish(d.id))).toEqual([422, "config_version.preview_required"]);
    await preview(d.id);
    await compatibility(d.id);
    await coverage(d.id);
    const refused = await publish(d.id);
    expect(codeOf(refused)).toEqual([422, "config_version.review_required"]);
    expect(refused.body.detail).toBe("This change needs an approved review before it can be published.");
    const sub = await submit(d.id);
    expect(codeOf(await publish(d.id))).toEqual([422, "config_version.review_required"]); // pending, not approved
    expect((await decide(d.id, sub.body.id, 1, { outcome: "approve" })).status).toBe(200);
    for (const s of [auditor, bo, reviewer]) expect((await publish(d.id, s)).status).toBe(403);
    const before = await versionOf(d.id);
    expect((await call<Body>(api.app, "POST", `${V}/${d.id}/publish`, { session: admin })).status).toBe(428);
    expect(
      (await call<Body>(api.app, "POST", `${V}/${d.id}/publish`, { session: admin, headers: ifm(before - 1) })).status,
    ).toBe(409);
    const ok = await publish(d.id);
    expect(ok.status).toBe(200);
    expect(ok.headers["etag"]).toBe(`"${before + 1}"`);
    expect(ok.body).toMatchObject({
      status: "published",
      draftStage: null,
      publishedBy: adminId,
      isNewestPublished: true,
    });
    expect((await actions(d.id)).slice(-1)).toEqual(["methodology_version.publish"]);

    // REQ-S06-007: editing a published version returns 409 (every Studio write).
    const v = ok.body.version as number;
    const writes = [
      call<Body>(api.app, "PATCH", `${V}/${d.id}`, { session: admin, headers: ifm(v), body: { titleEn: "x" } }),
      call<Body>(api.app, "PUT", `${V}/${d.id}/elements/gate/G3`, {
        session: admin,
        headers: ifm(v),
        body: { attributes: { labelEn: "x" } },
      }),
      call<Body>(api.app, "POST", `${V}/${d.id}/discard`, { session: admin, headers: ifm(v) }),
      call<Body>(api.app, "POST", `${V}/${d.id}/submit-review`, { session: admin, headers: ifm(v), body: {} }),
      call<Body>(api.app, "POST", `${V}/${d.id}/publish`, { session: admin, headers: ifm(v) }),
    ];
    for (const res of await Promise.all(writes)) expect(codeOf(res)).toEqual([409, "config_version.not_editable"]);
    expect(await versionOf(d.id)).toBe(v);
  });

  it("deleting T13 in a draft: the coverage run fails and publish -> 422 config_version.source_incomplete", async () => {
    const d = await freshDraft();
    const removed = await call<Body>(api.app, "POST", `${V}/${d.id}/elements/template/T13/remove`, {
      session: admin,
      headers: ifm(1),
    });
    expect(removed.status).toBe(200);
    await preview(d.id);
    await compatibility(d.id);
    // Without a coverage run of this content: the checks are missing.
    const sub = await submit(d.id);
    expect((await decide(d.id, sub.body.id, 1, { outcome: "approve" })).status).toBe(200);
    expect(codeOf(await publish(d.id))).toEqual([422, "config_version.checks_required"]);
    expect(await coverage(d.id)).toBe("fail");
    const res = await publish(d.id);
    expect(codeOf(res)).toEqual([422, "config_version.source_incomplete"]);
    expect(res.body.detail).toBe(
      "The source-completeness check failed: an element set is incomplete. Publishing is blocked.",
    );
    expect((await getVersion(d.id)).body.status).toBe("draft");
  });

  it("the latest compatibility run failed -> 422 config_version.compatibility_failed", async () => {
    const d = await freshDraft();
    await toApproved(d.id);
    // A failing compatibility run recorded for the same content (as the owner: the provider's own fail paths are
    // refused earlier at the element write, BE-B's tests).
    const v = await api.db
      .selectFrom("methodology_version")
      .select("content_sha256")
      .where("id", "=", d.id)
      .executeTakeFirstOrThrow();
    const runId = uuidv7();
    await createDb(api.owner)
      .transaction()
      .execute(async (tx) => {
        await tx
          .insertInto("config_check_run")
          .values({
            id: runId,
            methodology_version_id: d.id,
            check_kind: "compatibility",
            content_sha256: v.content_sha256,
            result: "fail",
            report: JSON.stringify({ fixture: true }),
            run_by: adminId,
            created_by: adminId,
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "config_check_run",
          recordId: runId,
          organizationId: null,
        });
      });
    expect(codeOf(await publish(d.id))).toEqual([422, "config_version.compatibility_failed"]);
  });

  it("scoring defaults that total 95 % -> 422 config_version.weights_total (REQ-PB-093); 100 % publishes", async () => {
    const weights = [
      ["strategic_fit", "25"],
      ["financial_value", "25"],
      ["feasibility", "20"],
      ["customer_impact", "15"],
      ["time_to_value", "15"],
    ];
    const base = await seedStudioBase(
      api,
      "scoring_defaults",
      weights.map(([k, p]) => ({ elementType: "scoring_weight", stableKey: k!, attributes: { weightPercent: p } })),
    );
    const d = await freshDraft("scoring_defaults", base.id);
    // 95 %: one weight lowered by 5 (a decimal string, never a float).
    const put = await call<Body>(api.app, "PUT", `${V}/${d.id}/elements/scoring_weight/feasibility`, {
      session: admin,
      headers: ifm(1),
      body: { attributes: { weightPercent: "15.00" } },
    });
    expect(put.status).toBe(200);
    await toApproved(d.id, "scoring_defaults");
    const refused = await publish(d.id);
    expect(codeOf(refused)).toEqual([422, "config_version.weights_total"]);
    expect(refused.body.detail).toBe("Default weights must total exactly 100% over 2 to 6 criteria.");
    expect((await getVersion(d.id)).body.status).toBe("draft");
    // A new draft of the same base (100 %) publishes.
    const discard = await call<Body>(api.app, "POST", `${V}/${d.id}/discard`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
    });
    expect(discard.status).toBe(200);
    const ok = await freshDraft("scoring_defaults", base.id);
    await toApproved(ok.id, "scoring_defaults");
    expect((await publish(ok.id)).status).toBe(200);
  });
});

describe("a kind whose review is switched off (REQ-S06-007 'review where configured')", () => {
  it("TO switches review off (ADM_METHOD 403); publish from preview in one call: two version steps, two audit events", async () => {
    const list = await call<Body>(api.app, "GET", POLICIES, { session: auditor });
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: Body) => p.configKind)).toEqual([
      "methodology",
      "scoring_defaults",
      "form_schema",
      "procedure",
      "automation_rule_set",
      "health_check_scheme",
      "benefit_formula",
    ]);
    const health = list.body.items.find((p: Body) => p.configKind === "health_check_scheme");
    const P = `${POLICIES}/health_check_scheme`;
    expect(
      (
        await call<Body>(api.app, "PATCH", P, {
          session: admin,
          headers: ifm(health.version),
          body: { reviewRequired: false },
        })
      ).status,
    ).toBe(403);
    for (const s of [auditor, bo])
      expect(
        (
          await call<Body>(api.app, "PATCH", P, {
            session: s,
            headers: ifm(health.version),
            body: { reviewRequired: false },
          })
        ).status,
      ).toBe(403);
    const off = await call<Body>(api.app, "PATCH", P, {
      session: reviewer,
      headers: ifm(health.version),
      body: { reviewRequired: false },
    });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ reviewRequired: false, version: health.version + 1, updatedBy: reviewerId });
    try {
      const policyId = (
        await api.db
          .selectFrom("config_review_policy")
          .select("id")
          .where("config_kind", "=", "health_check_scheme")
          .executeTakeFirstOrThrow()
      ).id;
      expect((await actions(policyId)).slice(-1)).toEqual(["config_review_policy.update"]);
      const baseId = await seedBaseOfKind("health_check_scheme");
      const d = await freshDraft("methodology", baseId);
      await preview(d.id);
      expect(await compatibility(d.id)).toBe("pass");
      const before = await versionOf(d.id);
      const res = await publish(d.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "published", configKind: "health_check_scheme", version: before + 2 });
      expect((await actions(d.id)).slice(-2)).toEqual([
        "methodology_version.approve_without_review",
        "methodology_version.publish",
      ]);
    } finally {
      const now = await call<Body>(api.app, "GET", POLICIES, { session: auditor });
      const cur = now.body.items.find((p: Body) => p.configKind === "health_check_scheme");
      const back = await call<Body>(api.app, "PATCH", P, {
        session: reviewer,
        headers: ifm(cur.version),
        body: { reviewRequired: true },
      });
      expect(back.body.reviewRequired).toBe(true);
    }
  });

  it("the reviewer is never AUD or an administrator role, and must exist (422); an unchanged update writes nothing", async () => {
    const list = await call<Body>(api.app, "GET", POLICIES, { session: admin });
    const form = list.body.items.find((p: Body) => p.configKind === "form_schema");
    const P = `${POLICIES}/form_schema`;
    for (const role of ["AUD", "ADM_METHOD", "ADM_TECH", "ADM_ACCESS", "NO_SUCH_ROLE"]) {
      const res = await call<Body>(api.app, "PATCH", P, {
        session: reviewer,
        headers: ifm(form.version),
        body: { reviewerRoleCode: role },
      });
      expect(codeOf(res)).toEqual([422, "config_review.reviewer_not_allowed"]);
      expect(res.body.detail).toBe("The auditor or an administrator role cannot be the configured reviewer.");
    }
    expect(
      (await call<Body>(api.app, "PATCH", P, { session: reviewer, headers: ifm(form.version), body: {} })).status,
    ).toBe(400);
    expect(
      (await call<Body>(api.app, "PATCH", P, { session: reviewer, body: { reviewRequired: form.reviewRequired } }))
        .status,
    ).toBe(428);
    const same = await call<Body>(api.app, "PATCH", P, {
      session: reviewer,
      headers: ifm(form.version),
      body: { reviewRequired: form.reviewRequired, reviewerRoleCode: form.reviewerRoleCode },
    });
    expect([same.status, same.body.version]).toEqual([200, form.version]);
  });
});

describe("rollbackConfigVersion (ADR-0039 §7; REQ-S06-009)", () => {
  it("restores an earlier version as a new version; later records stay retrievable; the audit trail shows the rollback", async () => {
    const base = await seedStudioBase(api, "methodology", [
      { elementType: "gate", stableKey: "G3", attributes: { labelEn: "G3 synthetic v1 label" } },
    ]);
    // v2: G3 relabelled, published through the pipeline.
    const v2 = await freshDraft("methodology", base.id);
    const put = await call<Body>(api.app, "PUT", `${V}/${v2.id}/elements/gate/G3`, {
      session: admin,
      headers: ifm(1),
      body: { attributes: { labelEn: "G3 synthetic v2 label" } },
    });
    expect(put.status).toBe(200);
    await toApproved(v2.id);
    expect((await publish(v2.id)).status).toBe(200);
    // Records created while v2 is in force: a transformation and v2's own review history.
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const snapshot = async () => ({
      transformation: await api.db
        .selectFrom("transformation")
        .selectAll()
        .where("id", "=", t)
        .executeTakeFirstOrThrow(),
      v2: (await getVersion(v2.id)).body,
      v2Elements: (await call<Body>(api.app, "GET", `${V}/${v2.id}/elements?elementType=gate`, { session: auditor }))
        .body,
      v2Reviews: (await call<Body>(api.app, "GET", `${V}/${v2.id}/reviews`, { session: auditor })).body,
      v2Runs: (await call<Body>(api.app, "GET", `${V}/${v2.id}/check-runs`, { session: auditor })).body,
    });
    const before = await snapshot();

    const R = `${V}/${base.id}/rollback`;
    const reason = { reason: "Synthetic: restore the v1 gate label" };
    expect((await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(1), body: {} })).status).toBe(400);
    expect(
      (await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(1), body: { reason: "  " } })).status,
    ).toBe(400);
    for (const s of [auditor, bo, reviewer])
      expect((await call<Body>(api.app, "POST", R, { session: s, headers: ifm(1), body: reason })).status).toBe(403);
    expect((await call<Body>(api.app, "POST", R, { session: admin, body: reason })).status).toBe(428);
    expect((await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(9), body: reason })).status).toBe(409);
    const newest = await call<Body>(api.app, "POST", `${V}/${v2.id}/rollback`, {
      session: admin,
      headers: ifm(await versionOf(v2.id)),
      body: reason,
    });
    expect(codeOf(newest)).toEqual([422, "config_version.rollback_target_invalid"]);
    expect(newest.body.detail).toBe("Only an earlier published version of the same configuration can be restored.");

    const res = await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(1), body: reason });
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe(`${V}/${res.body.id}`);
    expect(res.body).toMatchObject({
      origin: "rollback",
      status: "draft",
      draftStage: "editing",
      versionNo: 3,
      rollbackOfVersionId: base.id,
      basedOnVersionId: v2.id,
      changeSummary: reason.reason,
      version: 1,
    });
    // The restored content is v1's: G3's v1 label.
    const g3 = await call<Body>(api.app, "GET", `${V}/${res.body.id}/elements?elementType=gate`, { session: auditor });
    expect(g3.body.items.find((e: Body) => e.stableKey === "G3").attributes.labelEn).toBe("G3 synthetic v1 label");
    expect((await actions(res.body.id))[0]).toBe("methodology_version.rollback_create");
    // A second open draft of the key is refused.
    expect(codeOf(await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(1), body: reason }))).toEqual([
      409,
      "config_version.draft_exists",
    ]);
    // The rollback follows the pipeline; once published, the trail shows the rollback and the publish.
    await toApproved(res.body.id);
    const pub = await publish(res.body.id);
    expect(pub.status).toBe(200);
    const trail = await auditOf(api.db, res.body.id);
    expect(trail.map((a) => a.action)).toContain("methodology_version.rollback_create");
    expect(trail.at(-1)?.action).toBe("methodology_version.publish");
    expect(JSON.stringify(trail.at(-1))).toContain(base.id);
    // Nothing was erased or edited: v2 and the records created under it are unchanged and retrievable.
    const after = await snapshot();
    expect({ ...after, v2: { ...after.v2, isNewestPublished: null } }).toEqual({
      ...before,
      v2: { ...before.v2, isNewestPublished: null },
    });
    expect(after.v2.isNewestPublished).toBe(false);
    expect((await getVersion(base.id)).body).toMatchObject({ status: "published", version: 1 });
    // A draft or a discarded version is not a rollback target.
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${V}/${res.body.id}/rollback`, {
          session: admin,
          headers: ifm(1),
          body: reason,
        }),
      ),
    ).toEqual([409, "version_conflict"]);
  });
});

describe("authorization (REQ-S06-010; ADR-0039 §9)", () => {
  it("the methodology admin who publishes a change gets 403 approving a funding reallocation", async () => {
    // A methodology admin who also reads the transformation (WL there): publishing configuration never grants a
    // business approval right. (A plain ADM_METHOD cannot read the transformation at all: 404, no disclosure.)
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const m = await methodologyAdmin(api.db, w);
    await grant(api.db, w.grantor.id, m.id, "WL", { type: "transformation", id: t }, w.orgA.id);
    const mS = await signIn(api.app, m.subject);
    // It publishes a configuration change (REQ-S06-010 "can publish") ...
    const base = await seedStudioBase(api, "methodology");
    const created = await call<Body>(api.app, "POST", V, { session: mS, body: { basedOnVersionId: base.id } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await preview(id);
    await compatibility(id);
    await coverage(id);
    const sub = await submit(id, mS);
    expect((await decide(id, sub.body.id, 1, { outcome: "approve" })).status).toBe(200);
    expect((await publish(id, mS)).status).toBe(200);
    // ... and is refused a funding decision (a business approval) on a real initiative of that transformation.
    const initiativeId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("initiative")
        .values({
          id: initiativeId,
          organization_id: w.orgA.id,
          transformation_id: t,
          code: "INI-01", // unique per transformation; this transformation is fresh
          name: "Synthetic funding initiative",
          created_by: w.office.id,
          updated_by: w.office.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: w.office.id, requestId: `fixture-${initiativeId}`, source: "api" },
        {
          action: "initiative.create",
          recordType: "initiative",
          recordId: initiativeId,
          organizationId: w.orgA.id,
          transformationId: t,
          newVersion: 1,
        },
      );
    });
    const fundingBody = {
      initiativeId,
      outcome: "approved",
      amount: "1000.00",
      currency: "SAR",
      rationale: "Synthetic reallocation",
    };
    const funding = await call<Body>(api.app, "POST", "/api/v1/funding-decisions", { session: mS, body: fundingBody });
    expect(funding.status).toBe(403);
    const hidden = await call<Body>(api.app, "POST", "/api/v1/funding-decisions", {
      session: admin,
      body: fundingBody,
    });
    expect(hidden.status).toBe(404);
    const rows = await api.db
      .selectFrom("funding_decision")
      .select("id")
      .where("initiative_id", "=", initiativeId)
      .execute();
    expect(rows).toEqual([]);
  });

  it("BO (a KPI owner) gets 403 on every Studio write of this file", async () => {
    const d = await freshDraft();
    await preview(d.id);
    const sub = await submit(d.id);
    for (const res of [
      await call<Body>(api.app, "POST", `${V}/${d.id}/submit-review`, { session: bo, headers: ifm(1), body: {} }),
      await decide(d.id, sub.body.id, 1, { outcome: "approve" }, bo),
      await call<Body>(api.app, "POST", `${V}/${d.id}/publish`, { session: bo, headers: ifm(1) }),
      await call<Body>(api.app, "POST", `${V}/${d.baseId}/rollback`, {
        session: bo,
        headers: ifm(1),
        body: { reason: "abc" },
      }),
      await call<Body>(api.app, "PATCH", `${POLICIES}/methodology`, {
        session: bo,
        headers: ifm(1),
        body: { reviewRequired: false },
      }),
    ])
      expect(res.status).toBe(403);
  });

  it("re-checks authorization at commit time: a grant revoked mid-request gives 403 and writes nothing", async () => {
    // submit
    const d = await freshDraft();
    await preview(d.id);
    const v = await versionOf(d.id);
    const late = async (role: "ADM_METHOD" | "TO", send: (s: Session) => Promise<{ status: number }>) => {
      const u = await createUser(api.db, w.orgA.id);
      await grant(api.db, w.grantor.id, u.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
      const s = await signIn(api.app, u.subject);
      const res = await afterIdentity(
        api,
        u.id,
        () => send(s) as never,
        () => revokeAll(api, w.grantor.id, u.id),
      );
      expect(res.status).toBe(403);
    };
    await late("ADM_METHOD", (s) =>
      call(api.app, "POST", `${V}/${d.id}/submit-review`, { session: s, headers: ifm(v), body: {} }),
    );
    expect(await versionOf(d.id)).toBe(v);
    const reqs = await api.db
      .selectFrom("config_review_request")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(reqs).toEqual([]);
    // decide
    const sub = await submit(d.id);
    await late("TO", (s) => decide(d.id, sub.body.id, 1, { outcome: "approve" }, s));
    expect(await actions(sub.body.id)).toEqual(["config_review_request.create"]);
    // publish
    expect((await decide(d.id, sub.body.id, 1, { outcome: "approve" })).status).toBe(200);
    await compatibility(d.id);
    await coverage(d.id);
    const pv = await versionOf(d.id);
    await late("ADM_METHOD", (s) => call(api.app, "POST", `${V}/${d.id}/publish`, { session: s, headers: ifm(pv) }));
    expect((await getVersion(d.id)).body.status).toBe("draft");
    // rollback
    expect((await publish(d.id)).status).toBe(200);
    await late("ADM_METHOD", (s) =>
      call(api.app, "POST", `${V}/${d.baseId}/rollback`, { session: s, headers: ifm(1), body: { reason: "late" } }),
    );
    const drafts = await api.db
      .selectFrom("methodology_version")
      .select("id")
      .where("rollback_of_version_id", "=", d.baseId)
      .execute();
    expect(drafts).toEqual([]);
    // review policy
    const list = await call<Body>(api.app, "GET", POLICIES, { session: admin });
    const proc = list.body.items.find((p: Body) => p.configKind === "automation_rule_set");
    await late("TO", (s) =>
      call(api.app, "PATCH", `${POLICIES}/automation_rule_set`, {
        session: s,
        headers: ifm(proc.version),
        body: { reviewRequired: !proc.reviewRequired },
      }),
    );
    const again = await call<Body>(api.app, "GET", POLICIES, { session: admin });
    expect(again.body.items.find((p: Body) => p.configKind === "automation_rule_set")).toEqual(proc);
  });
});
