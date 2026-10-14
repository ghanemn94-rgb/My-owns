// P5 contract exercises of KBE-A (p5-work-split §A.6 and §2 rule 14; T-DG5-KBE-A): the three slice A operations it
// routes (putScoringDefaultsDraft, getScoringDefaults, getTransformationScoringDefaults), each with a success and every
// declared refusal it can reach, through the validating client. The draft is of a fresh synthetic scoring_defaults key
// (studio-fixtures.ts), so nothing here publishes or changes the shared `scoring-defaults` configuration that new
// transformations of parallel suites are pinned to. Every value is synthetic; default weights approve nothing.
//
// Declared but not reachable here: putScoringDefaultsDraft 422 (every business refusal of a scoring_defaults draft
// write is a 400 shape error or the 409 of a version that is not being edited; the 100 % rule is 422 at publish,
// exercised by BE-B3's publishConfigVersion and by scoring-defaults.test.ts); 429 (the rate limiter's own suite).
import { scoringDefaults } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createTransformationRow, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase, type SeededElement } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_KBE_A: Readonly<Record<string, z.ZodType>> = {
  putScoringDefaultsDraft: scoringDefaults,
  getScoringDefaults: scoringDefaults,
  getTransformationScoringDefaults: scoringDefaults,
};

const V = "/api/v1/admin/methodology-versions";
const ADMIN_READ = "/api/v1/admin/scoring-defaults";
const SCORING_V1 = "01920005-0000-7000-8000-000000000001";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const NULL_LEVELS = [1, 2, 3, 4, 5].map((score) => ({ score, descriptorEn: null, descriptorAr: null }));
/** The B0076 source defaults as synthetic base rows of a fresh key. */
export const SOURCE_SCORING_ROWS: readonly SeededElement[] = [
  ["strategic_fit", "25.00"],
  ["financial_value", "25.00"],
  ["customer_impact", "20.00"],
  ["feasibility", "15.00"],
  ["time_to_value", "15.00"],
].flatMap(([code, weight], i) => [
  { elementType: "scoring_weight", stableKey: code!, ordinal: i + 1, attributes: { weightPercent: weight } },
  { elementType: "scoring_rubric", stableKey: code!, ordinal: i + 1, attributes: { levels: NULL_LEVELS } },
]);

export async function exerciseP5KbeAOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const office = await signIn(api.app, w.office.subject); // TO: methodology.read and transformation.read, no configure
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

  const base = await seedStudioBase(api, "scoring_defaults", SOURCE_SCORING_ROWS);
  const created = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  const draftId = (created.body as Body).id as string;
  const PUT = `${V}/${draftId}/scoring-defaults`;
  const body = {
    weights: [
      { criterionCode: "strategic_fit", weightPercent: "30" },
      { criterionCode: "financial_value", weightPercent: "20" },
      { criterionCode: "customer_impact", weightPercent: "20" },
      { criterionCode: "feasibility", weightPercent: "15" },
      { criterionCode: "time_to_value", weightPercent: "15" },
    ],
    rubrics: [
      {
        criterionCode: "feasibility",
        levels: NULL_LEVELS.map((l) => ({ ...l, descriptorEn: `Synthetic feasibility level ${l.score}` })),
      },
    ],
  };

  // putScoringDefaultsDraft: 428; 400 (weight format, duplicate criterion); 401; 403; 404; 409 stale; 409 not
  // editable (a published version); 200 with the ETag.
  expect((await mirrored("PUT", PUT, { session: admin, body })).status).toBe(428);
  const badWeight = await mirrored("PUT", PUT, {
    session: admin,
    headers: ifm(1),
    body: { ...body, weights: [{ criterionCode: "strategic_fit", weightPercent: "12.345" }, body.weights[1]] },
  });
  expect(badWeight.status).toBe(400);
  expect(JSON.stringify(badWeight.body)).toContain("validation.weight_percent");
  const duplicate = await mirrored("PUT", PUT, {
    session: admin,
    headers: ifm(1),
    body: { ...body, weights: [body.weights[0], body.weights[0]] },
  });
  expect(duplicate.status).toBe(400);
  expect((await mirrored("PUT", PUT, { session: null, headers: ifm(1), body })).status).toBe(401);
  expect((await mirrored("PUT", PUT, { session: office, headers: ifm(1), body })).status).toBe(403);
  expect(
    (await mirrored("PUT", `${V}/${missing}/scoring-defaults`, { session: admin, headers: ifm(1), body })).status,
  ).toBe(404);
  expect((await mirrored("PUT", PUT, { session: admin, headers: ifm(7), body })).status).toBe(409);
  expect(
    code(await mirrored("PUT", `${V}/${base.id}/scoring-defaults`, { session: admin, headers: ifm(1), body })),
  ).toEqual([409, "config_version.not_editable"]);
  const put = await mirrored("PUT", PUT, { session: admin, headers: ifm(1), body });
  expect(put.status).toBe(200);
  expect(put.headers.etag).toBe('"2"');
  expect((put.body as Body).weightTotal).toBe("100.00");

  // getScoringDefaults: 200 (newest published; a given draft); 400; 401; 403; 404 (unknown; another kind's version).
  const newest = await mirrored("GET", ADMIN_READ, { session: office });
  expect(newest.status).toBe(200);
  expect((newest.body as Body).isNewestPublished).toBe(true);
  const draft = await mirrored("GET", `${ADMIN_READ}?versionId=${draftId}`, { session: admin });
  expect(draft.status).toBe(200);
  expect((draft.body as Body).status).toBe("draft");
  expect((await mirrored("GET", `${ADMIN_READ}?versionId=nope`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", ADMIN_READ, { session: null })).status).toBe(401);
  expect((await mirrored("GET", ADMIN_READ, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${ADMIN_READ}?versionId=${missing}`, { session: admin })).status).toBe(404);
  const methodology = await seedStudioBase(api, "methodology");
  expect((await mirrored("GET", `${ADMIN_READ}?versionId=${methodology.id}`, { session: admin })).status).toBe(404);

  // getTransformationScoringDefaults: 200 (an unpinned transformation resolves to version 1); 400; 401; 404.
  const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const T = `/api/v1/transformations/${t}/scoring-defaults`;
  const read = await mirrored("GET", T, { session: office });
  expect(read.status).toBe(200);
  expect((read.body as Body).versionId).toBe(SCORING_V1);
  expect((await mirrored("GET", "/api/v1/transformations/nope/scoring-defaults", { session: office })).status).toBe(
    400,
  );
  expect((await mirrored("GET", T, { session: null })).status).toBe(401);
  expect((await mirrored("GET", T, { session: nobody })).status).toBe(404);
  expect(
    (await mirrored("GET", `/api/v1/transformations/${missing}/scoring-defaults`, { session: office })).status,
  ).toBe(404);
}
