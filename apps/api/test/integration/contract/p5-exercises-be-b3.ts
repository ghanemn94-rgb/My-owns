// P5 contract exercises of BE-B3 (p5-work-split §A.4 and §2 rule 14; T-DG5-BE-B3): the eight slice A operations it
// routes (submit, list, decide and withdraw configuration reviews; publish; rollback; list and update review policies),
// each with a success and every declared refusal it can reach, through the validating client. Every value is
// synthetic; a configuration review and a publish approve configuration only, never a business (G1-G6) decision.
//
// Declared but not reachable here: updateConfigReviewPolicy 404 (the path enum lists exactly the seven seeded policy
// rows); 429 (the rate limiter's own suite).
import {
  configReviewPolicy,
  configReviewPolicyList,
  configReviewRequest,
  configReviewRequestPage,
  configVersion,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createUser, grant, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_B3: Readonly<Record<string, z.ZodType>> = {
  submitConfigReview: configReviewRequest,
  listConfigReviews: configReviewRequestPage,
  decideConfigReview: configReviewRequest,
  withdrawConfigReview: configReviewRequest,
  publishConfigVersion: configVersion,
  rollbackConfigVersion: configVersion,
  listConfigReviewPolicies: configReviewPolicyList,
  updateConfigReviewPolicy: configReviewPolicy,
};

const V = "/api/v1/admin/methodology-versions";
const POLICIES = "/api/v1/admin/config-review-policies";
const COVERAGE_RUNS = "/api/v1/admin/source-coverage/runs";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeB3Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const toUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, toUser.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const office = await signIn(api.app, toUser.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

  // A previewed, checked draft of a fresh synthetic base (the BE-A/BE-B/BE-B2 routes).
  const base = await seedStudioBase(api, "methodology");
  const created = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  const draftId = (created.body as Body).id as string;
  const preview = async (id: string, version: number) =>
    expect(
      (await mirrored("POST", `${V}/${id}/preview`, { session: admin, headers: ifm(version), body: { samples: [] } }))
        .status,
    ).toBe(201);
  const checks = async (id: string, version: number) => {
    const compat = await mirrored("POST", `${V}/${id}/compatibility-checks`, { session: admin, headers: ifm(version) });
    expect(compat.status).toBe(201);
    expect((await mirrored("POST", COVERAGE_RUNS, { session: admin, body: { versionId: id } })).status).toBe(201);
  };
  await preview(draftId, 1);
  await checks(draftId, 2);
  // A second configuration with a draft still being edited (for preview_required).
  const other = await seedStudioBase(api, "methodology");
  const editing = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: other.id } });
  const editingId = (editing.body as Body).id as string;

  // submitConfigReview: 201; 400; 403; 404; 409 (stale); 422 preview_required; 428.
  const SUBMIT = `${V}/${draftId}/submit-review`;
  expect((await mirrored("POST", SUBMIT, { session: admin, body: {} })).status).toBe(428);
  expect((await mirrored("POST", SUBMIT, { session: admin, headers: ifm(2), body: { note: "" } })).status).toBe(400);
  expect((await mirrored("POST", SUBMIT, { session: admin, headers: ifm(1), body: {} })).status).toBe(409);
  expect((await mirrored("POST", SUBMIT, { session: auditor, headers: ifm(2), body: {} })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${missing}/submit-review`, { session: admin, headers: ifm(1), body: {} })).status,
  ).toBe(404);
  expect(
    code(await mirrored("POST", `${V}/${editingId}/submit-review`, { session: admin, headers: ifm(1), body: {} })),
  ).toEqual([422, "config_version.preview_required"]);
  const submitted = await mirrored("POST", SUBMIT, {
    session: admin,
    headers: ifm(2),
    body: { note: "Synthetic review request" },
  });
  expect(submitted.status).toBe(201);
  const reviewId = (submitted.body as Body).id as string;

  // listConfigReviews: 200; 400; 403; 404.
  const REVIEWS = `${V}/${draftId}/reviews`;
  const list = await mirrored("GET", REVIEWS, { session: auditor });
  expect(list.status).toBe(200);
  expect((list.body as Body).items.map((r: Body) => r.id)).toEqual([reviewId]);
  expect((await mirrored("GET", `${REVIEWS}?limit=0`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", REVIEWS, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${V}/${missing}/reviews`, { session: admin })).status).toBe(404);

  // decideConfigReview: 400 (note required for request_changes); 403 (ADM_METHOD lacks methodology.review); 404; 409;
  // 428; 200 approve; 422 (already decided).
  const DECIDE = `${REVIEWS}/${reviewId}/decision`;
  expect((await mirrored("POST", DECIDE, { session: office, body: { outcome: "approve" } })).status).toBe(428);
  expect(
    (await mirrored("POST", DECIDE, { session: office, headers: ifm(1), body: { outcome: "request_changes" } })).status,
  ).toBe(400);
  expect(
    (await mirrored("POST", DECIDE, { session: admin, headers: ifm(1), body: { outcome: "approve" } })).status,
  ).toBe(403);
  expect(
    (
      await mirrored("POST", `${REVIEWS}/${missing}/decision`, {
        session: office,
        headers: ifm(1),
        body: { outcome: "approve" },
      })
    ).status,
  ).toBe(404);
  expect(
    (await mirrored("POST", DECIDE, { session: office, headers: ifm(2), body: { outcome: "approve" } })).status,
  ).toBe(409);
  const decided = await mirrored("POST", DECIDE, { session: office, headers: ifm(1), body: { outcome: "approve" } });
  expect(decided.status).toBe(200);
  expect((decided.body as Body).status).toBe("approved");
  expect(
    code(await mirrored("POST", DECIDE, { session: office, headers: ifm(2), body: { outcome: "approve" } })),
  ).toEqual([422, "invalid_transition"]);

  // publishConfigVersion: 403; 404; 409 (stale); 428; 422 preview_required; 200; 409 not_editable afterwards.
  const PUBLISH = `${V}/${draftId}/publish`;
  const draftNow = ((await mirrored("GET", `${V}/${draftId}`, { session: admin })).body as Body).version as number;
  expect((await mirrored("POST", PUBLISH, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", PUBLISH, { session: auditor, headers: ifm(draftNow) })).status).toBe(403);
  expect((await mirrored("POST", `${V}/${missing}/publish`, { session: admin, headers: ifm(1) })).status).toBe(404);
  expect((await mirrored("POST", PUBLISH, { session: admin, headers: ifm(draftNow - 1) })).status).toBe(409);
  expect(code(await mirrored("POST", `${V}/${editingId}/publish`, { session: admin, headers: ifm(1) }))).toEqual([
    422,
    "config_version.preview_required",
  ]);
  const published = await mirrored("POST", PUBLISH, { session: admin, headers: ifm(draftNow) });
  expect(published.status).toBe(200);
  const publishedVersion = (published.body as Body).version as number;
  expect(code(await mirrored("POST", PUBLISH, { session: admin, headers: ifm(publishedVersion) }))).toEqual([
    409,
    "config_version.not_editable",
  ]);

  // rollbackConfigVersion: 400; 403; 404; 409 (stale); 428; 422 (the newest version); 201; 409 draft_exists.
  const ROLLBACK = `${V}/${base.id}/rollback`;
  const reason = { reason: "Synthetic rollback to the earlier version" };
  expect((await mirrored("POST", ROLLBACK, { session: admin, body: reason })).status).toBe(428);
  expect((await mirrored("POST", ROLLBACK, { session: admin, headers: ifm(1), body: { reason: "x" } })).status).toBe(
    400,
  );
  expect((await mirrored("POST", ROLLBACK, { session: auditor, headers: ifm(1), body: reason })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${missing}/rollback`, { session: admin, headers: ifm(1), body: reason })).status,
  ).toBe(404);
  expect((await mirrored("POST", ROLLBACK, { session: admin, headers: ifm(2), body: reason })).status).toBe(409);
  expect(
    code(
      await mirrored("POST", `${V}/${draftId}/rollback`, {
        session: admin,
        headers: ifm(publishedVersion),
        body: reason,
      }),
    ),
  ).toEqual([422, "config_version.rollback_target_invalid"]);
  const rolled = await mirrored("POST", ROLLBACK, { session: admin, headers: ifm(1), body: reason });
  expect(rolled.status).toBe(201);
  const rollbackId = (rolled.body as Body).id as string;
  expect(code(await mirrored("POST", ROLLBACK, { session: admin, headers: ifm(1), body: reason }))).toEqual([
    409,
    "config_version.draft_exists",
  ]);

  // withdrawConfigReview: a pending review of the rollback draft; 403; 404; 409; 428; 200; 422 (no longer pending).
  await preview(rollbackId, 1);
  const pending = await mirrored("POST", `${V}/${rollbackId}/submit-review`, {
    session: admin,
    headers: ifm(2),
    body: {},
  });
  expect(pending.status).toBe(201);
  const WITHDRAW = `${V}/${rollbackId}/reviews/${(pending.body as Body).id}/withdraw`;
  expect((await mirrored("POST", WITHDRAW, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", WITHDRAW, { session: auditor, headers: ifm(1) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${rollbackId}/reviews/${missing}/withdraw`, { session: admin, headers: ifm(1) }))
      .status,
  ).toBe(404);
  expect((await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(2) })).status).toBe(409);
  const withdrawn = await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(1) });
  expect(withdrawn.status).toBe(200);
  expect((withdrawn.body as Body).status).toBe("withdrawn");
  expect(code(await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(2) }))).toEqual([
    422,
    "invalid_transition",
  ]);

  // listConfigReviewPolicies: 200; 403.
  const policies = await mirrored("GET", POLICIES, { session: auditor });
  expect(policies.status).toBe(200);
  expect((await mirrored("GET", POLICIES, { session: nobody })).status).toBe(403);

  // updateConfigReviewPolicy on `procedure`, unchanged values (writes nothing; no other suite's policy moves): 200;
  // 400 (empty; unknown kind); 403 (ADM_METHOD); 409; 422 (the auditor as reviewer); 428.
  const procedure = (policies.body as Body).items.find((p: Body) => p.configKind === "procedure");
  const PROC = `${POLICIES}/procedure`;
  const same = { reviewRequired: procedure.reviewRequired, reviewerRoleCode: procedure.reviewerRoleCode };
  expect((await mirrored("PATCH", PROC, { session: office, body: same })).status).toBe(428);
  expect((await mirrored("PATCH", PROC, { session: office, headers: ifm(procedure.version), body: {} })).status).toBe(
    400,
  );
  expect((await mirrored("PATCH", `${POLICIES}/nope`, { session: office, headers: ifm(1), body: same })).status).toBe(
    400,
  );
  expect((await mirrored("PATCH", PROC, { session: admin, headers: ifm(procedure.version), body: same })).status).toBe(
    403,
  );
  expect(
    (await mirrored("PATCH", PROC, { session: office, headers: ifm(procedure.version + 1), body: same })).status,
  ).toBe(409);
  expect(
    code(
      await mirrored("PATCH", PROC, {
        session: office,
        headers: ifm(procedure.version),
        body: { reviewerRoleCode: "AUD" },
      }),
    ),
  ).toEqual([422, "config_review.reviewer_not_allowed"]);
  const kept = await mirrored("PATCH", PROC, { session: office, headers: ifm(procedure.version), body: same });
  expect(kept.status).toBe(200);
  expect((kept.body as Body).version).toBe(procedure.version);
}
