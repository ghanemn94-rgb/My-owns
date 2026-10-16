// P5 contract exercises of KBE-G2 (p5-work-split §H.4 and §2 rule 14; T-DG5-KBE-G2): the seven health-check
// assessment operations, each with a success and every declared refusal it can reach, through the validating client
// (`ctx.mirrored`). Every value is SYNTHETIC; a health-check score is an assessment, not a business approval, and
// nothing here touches the engineering gates DG0-DG7.
import { healthCheck, healthCheckPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_KBE_G2: Readonly<Record<string, z.ZodType>> = {
  listHealthChecks: healthCheckPage,
  createHealthCheck: healthCheck,
  getHealthCheck: healthCheck,
  updateHealthCheck: healthCheck,
  putHealthCheckAnswer: healthCheck,
  putHealthCheckActions: healthCheck,
  submitHealthCheck: healthCheck,
};

const MISSING = "01920000-0000-7000-8000-00000000beef";
const q = (n: number) => `q${String(n).padStart(2, "0")}`;

export async function exerciseP5KbeG2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const p = await setupP2World(api, w);
  const outsider = await signIn(api.app, w.officeB.subject);
  const tl = p.lead.session;
  const aud = p.auditor.session;
  const list = `/api/v1/transformations/${p.transformationId}/health-checks`;

  // listHealthChecks: 200 (AUD reads), 400, 401, 404 (outsider).
  const empty = await mirrored("GET", list, { session: aud });
  expect([empty.status, empty.body.items, empty.body.nextCursor]).toEqual([200, [], null]);
  expect((await mirrored("GET", `${list}?limit=0`, { session: tl })).status).toBe(400);
  expect((await mirrored("GET", list)).status).toBe(401);
  expect((await mirrored("GET", list, { session: outsider })).status).toBe(404);

  // createHealthCheck: 400, 401, 403 (AUD, WL), 404 (outsider), 422 (owner), 201, then 409 draft_exists.
  const body = { assessmentDate: "2026-10-16" };
  expect((await mirrored("POST", list, { session: tl, body: { assessmentDate: "2026-02-30" } })).status).toBe(400);
  expect((await mirrored("POST", list, { body })).status).toBe(401);
  expect((await mirrored("POST", list, { session: aud, body })).status).toBe(403);
  expect((await mirrored("POST", list, { session: p.contributor.session, body })).status).toBe(403);
  expect((await mirrored("POST", list, { session: outsider, body })).status).toBe(404);
  const badOwner = await mirrored("POST", list, { session: tl, body: { ...body, ownerUserId: MISSING } });
  expect([badOwner.status, badOwner.body.code]).toEqual([422, "validation.user_invalid"]);
  const created = await mirrored("POST", list, { session: tl, body });
  expect([created.status, created.body.status, created.body.version, created.body.schemeVersionNo]).toEqual([
    201,
    "draft",
    1,
    1,
  ]);
  const dup = await mirrored("POST", list, { session: tl, body });
  expect([dup.status, dup.body.code]).toEqual([409, "health_check.draft_exists"]);
  const A = `${list}/${created.body.id}`;
  let v = created.body.version as number;

  // getHealthCheck: 200, 400, 401, 404.
  const got = await mirrored("GET", A, { session: aud });
  expect([got.status, got.body.score, got.body.band]).toEqual([200, null, null]);
  expect((await mirrored("GET", `${list}/not-a-uuid`, { session: tl })).status).toBe(400);
  expect((await mirrored("GET", A)).status).toBe(401);
  expect((await mirrored("GET", `${list}/${MISSING}`, { session: tl })).status).toBe(404);

  // updateHealthCheck: 428, 400, 401, 403, 404, 409, 422, 200.
  const patch = { assessmentDate: "2026-10-17" };
  expect((await mirrored("PATCH", A, { session: tl, body: patch })).status).toBe(428);
  expect((await mirrored("PATCH", A, { session: tl, headers: ifm(v), body: {} })).status).toBe(400);
  expect((await mirrored("PATCH", A, { headers: ifm(v), body: patch })).status).toBe(401);
  expect((await mirrored("PATCH", A, { session: aud, headers: ifm(v), body: patch })).status).toBe(403);
  expect((await mirrored("PATCH", A, { session: outsider, headers: ifm(v), body: patch })).status).toBe(404);
  expect((await mirrored("PATCH", A, { session: tl, headers: ifm(v + 3), body: patch })).status).toBe(409);
  const badUpd = await mirrored("PATCH", A, { session: tl, headers: ifm(v), body: { ownerUserId: MISSING } });
  expect([badUpd.status, badUpd.body.code]).toEqual([422, "validation.user_invalid"]);
  const upd = await mirrored("PATCH", A, { session: p.office.session, headers: ifm(v), body: patch });
  expect([upd.status, upd.body.assessmentDate]).toEqual([200, "2026-10-17"]);
  v = upd.body.version as number;

  // putHealthCheckAnswer: 428, 400, 401, 403, 404, 409, 422 (response, evidence), 200 x25.
  const yes = { response: "yes" };
  const ans = (n: number) => `${A}/answers/${q(n)}`;
  expect((await mirrored("PUT", ans(1), { session: tl, body: yes })).status).toBe(428);
  expect((await mirrored("PUT", `${A}/answers/q26`, { session: tl, headers: ifm(v), body: yes })).status).toBe(400);
  expect((await mirrored("PUT", ans(1), { session: tl, headers: ifm(v), body: { response: "maybe" } })).status).toBe(
    400,
  );
  expect((await mirrored("PUT", ans(1), { headers: ifm(v), body: yes })).status).toBe(401);
  expect((await mirrored("PUT", ans(1), { session: aud, headers: ifm(v), body: yes })).status).toBe(403);
  expect((await mirrored("PUT", ans(1), { session: outsider, headers: ifm(v), body: yes })).status).toBe(404);
  expect((await mirrored("PUT", ans(1), { session: tl, headers: ifm(v + 4), body: yes })).status).toBe(409);
  const na = await mirrored("PUT", ans(1), { session: tl, headers: ifm(v), body: { response: "na" } });
  expect([na.status, na.body.code]).toEqual([422, "health_check.response_not_allowed"]);
  const badEv = await mirrored("PUT", ans(1), { session: tl, headers: ifm(v), body: { ...yes, evidenceId: MISSING } });
  expect([badEv.status, badEv.body.code]).toEqual([422, "validation.reference"]);
  for (let n = 1; n <= 25; n += 1) {
    const r = await mirrored("PUT", ans(n), {
      session: tl,
      headers: ifm(v),
      body: n <= 17 ? yes : { response: "no", actionNote: "Synthetic follow-up" },
    });
    expect(r.status).toBe(200);
    v = r.body.version as number;
  }

  // submitHealthCheck without actions: 422 actions_required (also 428, 401, 403, 404, 409).
  const S = `${A}/submit`;
  expect((await mirrored("POST", S, { session: tl })).status).toBe(428);
  expect((await mirrored("POST", S, { headers: ifm(v) })).status).toBe(401);
  expect((await mirrored("POST", S, { session: aud, headers: ifm(v) })).status).toBe(403);
  expect((await mirrored("POST", S, { session: outsider, headers: ifm(v) })).status).toBe(404);
  expect((await mirrored("POST", S, { session: tl, headers: ifm(v + 1) })).status).toBe(409);
  const noActions = await mirrored("POST", S, { session: tl, headers: ifm(v) });
  expect([noActions.status, noActions.body.code]).toEqual([422, "health_check.actions_required"]);

  // putHealthCheckActions: 428, 400, 401, 403, 404, 409, 422 (improvement item), 200.
  const ACT = `${A}/actions`;
  const actions = {
    actions: [1, 2, 3].map((rank) => ({ rank, actionText: `Synthetic action ${rank}`, dueDate: "2026-11-30" })),
  };
  expect((await mirrored("PUT", ACT, { session: tl, body: actions })).status).toBe(428);
  expect((await mirrored("PUT", ACT, { session: tl, headers: ifm(v), body: { actions: [] } })).status).toBe(400);
  expect((await mirrored("PUT", ACT, { headers: ifm(v), body: actions })).status).toBe(401);
  expect((await mirrored("PUT", ACT, { session: aud, headers: ifm(v), body: actions })).status).toBe(403);
  expect((await mirrored("PUT", ACT, { session: outsider, headers: ifm(v), body: actions })).status).toBe(404);
  expect((await mirrored("PUT", ACT, { session: tl, headers: ifm(v + 2), body: actions })).status).toBe(409);
  const badItem = await mirrored("PUT", ACT, {
    session: tl,
    headers: ifm(v),
    body: { actions: [{ rank: 1, actionText: "Synthetic", improvementItemId: MISSING }] },
  });
  expect([badItem.status, badItem.body.code]).toEqual([422, "validation.reference"]);
  const set = await mirrored("PUT", ACT, { session: tl, headers: ifm(v), body: actions });
  expect([set.status, set.body.actions.length]).toEqual([200, 3]);
  v = set.body.version as number;

  // submitHealthCheck: 200 (17 Yes: score 17, band 16-20), then 422 not_draft on every write.
  const done = await mirrored("POST", S, { session: tl, headers: ifm(v) });
  expect([done.status, done.body.status, done.body.score, done.body.band.rangeLabel]).toEqual([
    200,
    "submitted",
    "17",
    "16-20",
  ]);
  v = done.body.version as number;
  const again = await mirrored("POST", S, { session: tl, headers: ifm(v) });
  expect([again.status, again.body.code]).toEqual([422, "health_check.not_draft"]);
  expect((await mirrored("PUT", ans(1), { session: tl, headers: ifm(v), body: yes })).body.code).toBe(
    "health_check.not_draft",
  );
  expect((await mirrored("PUT", ACT, { session: tl, headers: ifm(v), body: actions })).body.code).toBe(
    "health_check.not_draft",
  );
  expect((await mirrored("PATCH", A, { session: tl, headers: ifm(v), body: patch })).body.code).toBe(
    "health_check.not_draft",
  );

  // A reassessment names the submitted one; the list shows both in sequence.
  const second = await mirrored("POST", list, { session: tl, body });
  expect([second.status, second.body.sequenceNo, second.body.previousAssessmentId]).toEqual([201, 2, created.body.id]);
  const page = await mirrored("GET", `${list}?limit=1`, { session: aud });
  expect([page.status, page.body.items.length, typeof page.body.nextCursor]).toEqual([200, 1, "string"]);
  const rest = await mirrored("GET", `${list}?limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`, {
    session: aud,
  });
  expect(rest.body.items.map((x: { sequenceNo: number }) => x.sequenceNo)).toEqual([2]);
}
