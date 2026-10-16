// P5 contract exercises of BE-P2 (p5-work-split §H.2 and §2 rule 14; T-DG5-BE-P2): the three Day-90 leadership test
// operations, each with a success and every declared refusal it can reach, through the validating client
// (`ctx.mirrored`). Every value is SYNTHETIC; a Day-90 answer is not a business approval and touches nothing of DG0-DG7.
import { expect } from "vitest";
import type { z } from "zod";
import { dayNinetyTest } from "../../../src/modules/launch/day-ninety.ts";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_BE_P2: Readonly<Record<string, z.ZodType>> = {
  getDayNinetyTest: dayNinetyTest,
  putDayNinetyResponse: dayNinetyTest,
  completeDayNinetyTest: dayNinetyTest,
};

export async function exerciseP5BeP2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const p = await setupP2World(api, w);
  const outsider = await signIn(api.app, w.officeB.subject);
  const tl = p.lead.session;
  const test = `/api/v1/transformations/${p.transformationId}/day-90-test`;
  const resp = (q: string) => `${test}/responses/${q}`;
  const complete = `${test}/complete`;

  // getDayNinetyTest before the plan: 404; 400 malformed id; 401.
  expect((await mirrored("GET", test, { session: tl })).status).toBe(404);
  expect((await mirrored("GET", "/api/v1/transformations/not-a-uuid/day-90-test", { session: tl })).status).toBe(400);
  expect((await mirrored("GET", test)).status).toBe(401);
  const plan = await mirrored("POST", `/api/v1/transformations/${p.transformationId}/launch-plan`, {
    session: tl,
    body: { startDate: "2026-10-01" },
  });
  expect(plan.status).toBe(201);

  // getDayNinetyTest: 200 (AUD reads), 404 outsider.
  const read = await mirrored("GET", test, { session: p.auditor.session });
  expect([read.status, read.body.questions.length, read.body.completion]).toEqual([
    200,
    6,
    { answered: 0, total: 6, complete: false },
  ]);
  expect((await mirrored("GET", test, { session: outsider })).status).toBe(404);
  let v = read.body.version as number;

  // putDayNinetyResponse: 428, 400, 401, 403 (AUD), 404 (outsider), 409, 422 (evidence), 200 x5.
  const yes = { answer: "yes" };
  expect((await mirrored("PUT", resp("q1"), { session: tl, body: yes })).status).toBe(428);
  expect((await mirrored("PUT", resp("q1"), { session: tl, headers: ifm(v), body: { answer: "x" } })).status).toBe(400);
  expect((await mirrored("PUT", resp("q9"), { session: tl, headers: ifm(v), body: yes })).status).toBe(400);
  expect((await mirrored("PUT", resp("q1"), { headers: ifm(v), body: yes })).status).toBe(401);
  expect((await mirrored("PUT", resp("q1"), { session: p.auditor.session, headers: ifm(v), body: yes })).status).toBe(
    403,
  );
  expect((await mirrored("PUT", resp("q1"), { session: outsider, headers: ifm(v), body: yes })).status).toBe(404);
  expect((await mirrored("PUT", resp("q1"), { session: tl, headers: ifm(v + 5), body: yes })).status).toBe(409);
  const badEvidence = await mirrored("PUT", resp("q1"), {
    session: tl,
    headers: ifm(v),
    body: { answer: "yes", evidenceId: "01920000-0000-7000-8000-00000000beef" },
  });
  expect([badEvidence.status, badEvidence.body.code]).toEqual([422, "validation.reference"]);
  for (const q of ["q1", "q2", "q3", "q4", "q5"]) {
    const r = await mirrored("PUT", resp(q), { session: p.sponsor.session, headers: ifm(v), body: yes });
    expect(r.status).toBe(200);
    v = r.body.version as number;
  }

  // completeDayNinetyTest: 428, 401, 403 (AUD), 404 (outsider), 409, 422 incomplete, then 200 and 422 completed.
  expect((await mirrored("POST", complete, { session: tl })).status).toBe(428);
  expect((await mirrored("POST", complete, { headers: ifm(v) })).status).toBe(401);
  expect((await mirrored("POST", complete, { session: p.auditor.session, headers: ifm(v) })).status).toBe(403);
  expect((await mirrored("POST", complete, { session: outsider, headers: ifm(v) })).status).toBe(404);
  expect((await mirrored("POST", complete, { session: tl, headers: ifm(v + 2) })).status).toBe(409);
  const incomplete = await mirrored("POST", complete, { session: tl, headers: ifm(v) });
  expect([incomplete.status, incomplete.body.code]).toEqual([422, "day_ninety_test.incomplete"]);
  const sixth = await mirrored("PUT", resp("q6"), { session: tl, headers: ifm(v), body: { answer: "no" } });
  expect([sixth.status, sixth.body.completion.complete]).toEqual([200, true]);
  v = sixth.body.version as number;
  const done = await mirrored("POST", complete, { session: tl, headers: ifm(v) });
  expect([done.status, done.body.status]).toEqual([200, "completed"]);
  const late = await mirrored("PUT", resp("q6"), { session: tl, headers: ifm(done.body.version), body: yes });
  expect([late.status, late.body.code]).toEqual([422, "day_ninety_test.completed"]);
  const again = await mirrored("POST", complete, { session: tl, headers: ifm(done.body.version) });
  expect([again.status, again.body.code]).toEqual([422, "day_ninety_test.completed"]);
}
