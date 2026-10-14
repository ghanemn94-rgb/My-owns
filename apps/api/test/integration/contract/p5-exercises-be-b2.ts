// P5 contract exercises of BE-B2 (p5-work-split §A.3 and §2 rule 14; T-DG5-BE-B2): the three slice A operations it
// routes (source coverage report and run, revision proposals), each with a success and every declared refusal it can
// reach, through the validating client. Every value is synthetic; a coverage run tests configuration and approves
// nothing.
//
// Declared but not reachable here: runSourceCoverageCheck 422 (the ADR-0039 §13 table has no refusal for a run: a
// failing coverage is recorded as a `fail` run, and the publish refusal config_version.source_incomplete belongs to
// publishConfigVersion, BE-B3); 429 (the rate limiter's own suite).
import { configCheckRun, revisionProposalPage, sourceCoverageReport } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_B2: Readonly<Record<string, z.ZodType>> = {
  getSourceCoverage: sourceCoverageReport,
  runSourceCoverageCheck: configCheckRun,
  listRevisionProposals: revisionProposalPage,
};

const COVERAGE = "/api/v1/admin/source-coverage";
const RUNS = `${COVERAGE}/runs`;
const PROPOSALS = "/api/v1/admin/revision-proposals";
const V = "/api/v1/admin/methodology-versions";

export async function exerciseP5BeB2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const base = await seedStudioBase(api, "methodology");
  const created = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  const draftId = (created.body as { id: string }).id;

  // getSourceCoverage: 200 (default: newest published `playbook`; and a named draft); 400; 403; 404.
  const report = await mirrored("GET", COVERAGE, { session: auditor });
  expect(report.status).toBe(200);
  expect((report.body as { sets: unknown[] }).sets).toHaveLength(10);
  expect((await mirrored("GET", `${COVERAGE}?versionId=${draftId}`, { session: admin })).status).toBe(200);
  expect((await mirrored("GET", `${COVERAGE}?versionId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", COVERAGE, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${COVERAGE}?versionId=${missing}`, { session: admin })).status).toBe(404);

  // runSourceCoverageCheck: 201; 400 (body); 403 (AUD reads but never writes); 404; 409 (a published version).
  const run = await mirrored("POST", RUNS, { session: admin, body: { versionId: draftId } });
  expect(run.status).toBe(201);
  expect((run.body as { checkKind: string }).checkKind).toBe("source_coverage");
  expect((await mirrored("POST", RUNS, { session: admin, body: { versionId: "x" } })).status).toBe(400);
  expect((await mirrored("POST", RUNS, { session: auditor, body: { versionId: draftId } })).status).toBe(403);
  expect((await mirrored("POST", RUNS, { session: admin, body: { versionId: missing } })).status).toBe(404);
  const published = await mirrored("POST", RUNS, { session: admin, body: { versionId: base.id } });
  expect([published.status, (published.body as { code?: string }).code]).toEqual([409, "config_version.not_editable"]);

  // listRevisionProposals: 200 (filters); 400; 403.
  expect((await mirrored("GET", PROPOSALS, { session: auditor })).status).toBe(200);
  expect(
    (await mirrored("GET", `${PROPOSALS}?subjectType=benefit_formula_version&subjectId=${missing}`, { session: admin }))
      .status,
  ).toBe(200);
  expect((await mirrored("GET", `${PROPOSALS}?subjectType=nope`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", PROPOSALS, { session: nobody })).status).toBe(403);
}
