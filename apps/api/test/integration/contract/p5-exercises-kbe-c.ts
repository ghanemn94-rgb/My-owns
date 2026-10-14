// P5 contract exercises of KBE-C (p5-work-split §F.1 and §2 rule 14; T-DG5-KBE-C): the eleven slice F operations it
// routes (report definitions, live reports, generate, list/get snapshots, their sources, versions and evidence, issue,
// discard, reissue), each with a success and every declared refusal it can reach, through the validating client.
// Every value is synthetic; issuing a report approves nothing, and nothing touches the engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite); 403 on the
// reads (every caller who can see a transformation holds transformation.read, so a caller who cannot gets 404).
import {
  liveReport,
  reportDefinitionList,
  reportSnapshot,
  reportSnapshotEvidencePage,
  reportSnapshotPage,
  reportSnapshotSourcePage,
  reportSnapshotVersionList,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_KBE_C: Readonly<Record<string, z.ZodType>> = {
  listReportDefinitions: reportDefinitionList,
  getLiveReport: liveReport,
  generateReportSnapshot: reportSnapshot,
  listReportSnapshots: reportSnapshotPage,
  getReportSnapshot: reportSnapshot,
  listReportSnapshotSources: reportSnapshotSourcePage,
  listReportSnapshotVersions: reportSnapshotVersionList,
  listReportSnapshotEvidence: reportSnapshotEvidencePage,
  issueReportSnapshot: reportSnapshot,
  discardReportSnapshot: reportSnapshot,
  reissueReportSnapshot: reportSnapshot,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5KbeCOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;
  const auditor = p.auditor.session;
  const wl = p.contributor.session;
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const S = `${T}/report-snapshots`;

  // listReportDefinitions: 200; 400 (an unknown query member).
  const defs = await mirrored("GET", "/api/v1/report-definitions", { session: auditor });
  expect(defs.status).toBe(200);
  expect((defs.body as Body).items).toHaveLength(12);
  expect((await mirrored("GET", "/api/v1/report-definitions?x=1", { session: auditor })).status).toBe(400);

  // getLiveReport: 200; 400; 404 (outside scope; an output without an assembler yet); 422.
  expect((await mirrored("GET", `${T}/reports/charter/live`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${T}/reports/charter/live?subjectId=nope`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${T}/reports/charter/live`, { session: nobody })).status).toBe(404);
  expect(
    code(await mirrored("GET", `${T}/reports/charter/live?reportingPeriodId=${missing}`, { session: auditor })),
  ).toEqual([422, "report.period_not_allowed"]);
  expect(
    code(
      await mirrored("GET", `${T}/reports/registers/live?parameters=${encodeURIComponent('{"register":"x"}')}`, {
        session: auditor,
      }),
    ),
  ).toEqual([422, "report.parameters_invalid"]);

  // generateReportSnapshot: 201; 400; 403 (AUD); 404 (outside scope); 422.
  const G = (c: string) => `${T}/reports/${c}/generate`;
  expect((await mirrored("POST", G("charter"), { session: lead, body: { extra: 1 } })).status).toBe(400);
  expect((await mirrored("POST", G("charter"), { session: auditor, body: {} })).status).toBe(403);
  expect((await mirrored("POST", G("charter"), { session: nobody, body: {} })).status).toBe(404);
  expect(code(await mirrored("POST", G("charter"), { session: lead, body: { subjectId: missing } }))).toEqual([
    422,
    "report.subject_invalid",
  ]);
  expect(code(await mirrored("POST", G("executive_dashboard"), { session: lead, body: {} }))).toEqual([
    422,
    "report.period_required",
  ]);
  const gen = await mirrored("POST", G("registers"), { session: wl, body: { parameters: { register: "raid" } } });
  expect(gen.status).toBe(201);
  const s1 = gen.body as Body;
  const charter = await mirrored("POST", G("charter"), { session: lead, body: {} });
  expect(charter.status).toBe(201);
  const s2 = charter.body as Body;

  // listReportSnapshots: 200; 400; 404.
  expect((await mirrored("GET", `${S}?definitionCode=registers&status=generated`, { session: auditor })).status).toBe(
    200,
  );
  expect((await mirrored("GET", `${S}?status=open`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", S, { session: nobody })).status).toBe(404);

  // getReportSnapshot and its three child reads: 200; 400; 404.
  for (const suffix of ["", "/sources", "/versions", "/evidence"]) {
    expect((await mirrored("GET", `${S}/${s1.id}${suffix}`, { session: auditor })).status).toBe(200);
    expect((await mirrored("GET", `${S}/not-a-uuid${suffix}`, { session: auditor })).status).toBe(400);
    expect((await mirrored("GET", `${S}/${missing}${suffix}`, { session: auditor })).status).toBe(404);
    expect((await mirrored("GET", `${S}/${s1.id}${suffix}`, { session: nobody })).status).toBe(404);
  }

  // issueReportSnapshot: 400; 403 (WL, AUD); 404; 428; 409; 200; 422 (already issued).
  const I = (id: string) => `${S}/${id}/issue`;
  expect((await mirrored("POST", I(s1.id), { session: lead, headers: ifm(1), body: { note: "" } })).status).toBe(400);
  expect((await mirrored("POST", I(s1.id), { session: wl, headers: ifm(1), body: {} })).status).toBe(403);
  expect((await mirrored("POST", I(s1.id), { session: auditor, headers: ifm(1), body: {} })).status).toBe(403);
  expect((await mirrored("POST", I(missing), { session: lead, headers: ifm(1), body: {} })).status).toBe(404);
  expect(code(await mirrored("POST", I(s1.id), { session: lead, body: {} }))).toEqual([428, "precondition_required"]);
  expect(code(await mirrored("POST", I(s1.id), { session: lead, headers: ifm(9), body: {} }))).toEqual([
    409,
    "version_conflict",
  ]);
  const issued = await mirrored("POST", I(s1.id), {
    session: lead,
    headers: ifm(1),
    body: { note: "Synthetic issue" },
  });
  expect(issued.status).toBe(200);
  expect(code(await mirrored("POST", I(s1.id), { session: lead, headers: ifm(2), body: {} }))).toEqual([
    422,
    "report_snapshot.not_generated",
  ]);

  // discardReportSnapshot: 400; 403; 404; 428; 409; 422; 200.
  const D = (id: string) => `${S}/${id}/discard`;
  const reason = { reason: "Synthetic discard" };
  expect((await mirrored("POST", D(s2.id), { session: lead, headers: ifm(1), body: {} })).status).toBe(400);
  expect((await mirrored("POST", D(s2.id), { session: auditor, headers: ifm(1), body: reason })).status).toBe(403);
  expect((await mirrored("POST", D(missing), { session: lead, headers: ifm(1), body: reason })).status).toBe(404);
  expect((await mirrored("POST", D(s2.id), { session: lead, body: reason })).status).toBe(428);
  expect((await mirrored("POST", D(s2.id), { session: lead, headers: ifm(5), body: reason })).status).toBe(409);
  expect(code(await mirrored("POST", D(s1.id), { session: lead, headers: ifm(2), body: reason }))).toEqual([
    422,
    "report_snapshot.not_generated",
  ]);
  expect((await mirrored("POST", D(s2.id), { session: lead, headers: ifm(1), body: reason })).status).toBe(200);

  // reissueReportSnapshot: 400; 403; 404; 428; 409; 422; 201.
  const R = (id: string) => `${S}/${id}/reissue`;
  const why = { reason: "Synthetic reissue" };
  expect((await mirrored("POST", R(s1.id), { session: lead, headers: ifm(2), body: { reason: "x" } })).status).toBe(
    400,
  );
  expect((await mirrored("POST", R(s1.id), { session: auditor, headers: ifm(2), body: why })).status).toBe(403);
  expect((await mirrored("POST", R(missing), { session: lead, headers: ifm(2), body: why })).status).toBe(404);
  expect((await mirrored("POST", R(s1.id), { session: lead, body: why })).status).toBe(428);
  expect((await mirrored("POST", R(s1.id), { session: lead, headers: ifm(1), body: why })).status).toBe(409);
  expect(code(await mirrored("POST", R(s2.id), { session: lead, headers: ifm(2), body: why }))).toEqual([
    422,
    "report_snapshot.not_issued",
  ]);
  const re = await mirrored("POST", R(s1.id), { session: lead, headers: ifm(2), body: why });
  expect(re.status).toBe(201);
  expect((re.body as Body).reissueOfId).toBe(s1.id);
}
