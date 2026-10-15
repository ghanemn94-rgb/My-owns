// P5 contract exercises of KBE-G (p5-work-split §H.3 and §2 rule 14; T-DG5-KBE-G): the three health-check reads, each
// with a success and every declared refusal it can reach, through the validating client (`ctx.mirrored`). The zod
// mirrors are `@mth/shared/calc`'s (packages/shared/src/health/contract.ts; schemas/health.ts is KBE-G2's file). The
// seeded v1 scheme is an implementation assumption (M0262); nothing here is a business approval or touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { healthCheckQuestionList, healthCheckScheme, healthCheckSchemeList } from "@mth/shared/calc";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_KBE_G: Readonly<Record<string, z.ZodType>> = {
  listHealthCheckQuestions: healthCheckQuestionList,
  listHealthCheckSchemes: healthCheckSchemeList,
  getHealthCheckScheme: healthCheckScheme,
};

/** The seeded scheme v1 (0086). */
const V1_ID = "01920005-0860-7000-8000-000000000001";

export async function exerciseP5KbeGOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const session = await signIn(api.app, w.nobody.subject); // any signed-in user, no grant needed

  // listHealthCheckQuestions: 200 (25 verbatim), 401.
  const questions = await mirrored("GET", "/api/v1/health-check-questions", { session });
  expect([questions.status, questions.body.items.length, questions.body.items[3].textEn]).toEqual([
    200,
    25,
    "Are 3-5 business outcomes measurable?",
  ]);
  expect((await mirrored("GET", "/api/v1/health-check-questions")).status).toBe(401);

  // listHealthCheckSchemes: 200 (v1 among the published schemes), 401.
  const list = await mirrored("GET", "/api/v1/admin/health-check-schemes", { session });
  expect(list.status).toBe(200);
  expect((list.body.items as { versionId: string }[]).some((s) => s.versionId === V1_ID)).toBe(true);
  expect((await mirrored("GET", "/api/v1/admin/health-check-schemes")).status).toBe(401);

  // getHealthCheckScheme: 200 (v1, implementationAssumption), 400 malformed id, 401, 404 unknown / other kind.
  const one = `/api/v1/admin/health-check-schemes/${V1_ID}`;
  const v1 = await mirrored("GET", one, { session });
  expect([v1.status, v1.body.implementationAssumption, v1.body.bands.length]).toEqual([200, true, 4]);
  expect((await mirrored("GET", "/api/v1/admin/health-check-schemes/not-a-uuid", { session })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `/api/v1/admin/health-check-schemes/${randomUUID()}`, { session })).status).toBe(404);
}
