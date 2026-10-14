// P5 contract exercises of BE-G (p5-plan §5.1, p5-work-split §C.3 and §2 rule 14; T-DG5-BE-G): the one operation it
// routes (the methodology coverage view), with its success and every declared refusal it can reach, through the
// validating client. Read-only; every value is synthetic.
//
// Declared but not reachable here: 401 (the harness's unauthenticated suite covers it for every operation) and 429 (the
// rate limiter's own suite).
import { expect } from "vitest";
import type { z } from "zod";
import { methodologyCoverage } from "../../../src/modules/procedures/coverage.ts";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { seedStudioBase } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_G: Readonly<Record<string, z.ZodType>> = {
  getMethodologyCoverage: methodologyCoverage,
};

const COVERAGE = "/api/v1/admin/coverage";

export async function exerciseP5BeGOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const methodology = await seedStudioBase(api, "methodology");
  const scoring = await seedStudioBase(api, "scoring_defaults");

  // getMethodologyCoverage: 200 (default and a named methodology version); 400; 403; 404 (unknown, and a version of
  // another configuration kind).
  const view = await mirrored("GET", COVERAGE, { session: auditor });
  expect(view.status).toBe(200);
  const body = view.body as { totals: { total: number }; elements: unknown[] };
  expect(body.totals.total).toBe(body.elements.length);
  expect((await mirrored("GET", `${COVERAGE}?versionId=${methodology.id}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${COVERAGE}?versionId=x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", COVERAGE, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${COVERAGE}?versionId=${crypto.randomUUID()}`, { session: auditor })).status).toBe(
    404,
  );
  expect((await mirrored("GET", `${COVERAGE}?versionId=${scoring.id}`, { session: auditor })).status).toBe(404);
}
