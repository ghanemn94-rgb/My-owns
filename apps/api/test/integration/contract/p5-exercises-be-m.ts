// P5 contract exercises of BE-M (p5-work-split §F.5 and §2 rule 14; T-DG5-BE-M): the five export-job operations
// (list, create, get, download, cancel), each with a success and every declared refusal it can reach, through the
// validating client. The worker's export runner renders the job in-process (apps/worker reports.export), so the
// download's success is a real file. Every value is synthetic; an export approves nothing, and nothing touches the
// engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite); 403 on
// listExports (any signed-in user may list their own jobs; the list is filtered, never refused).
import { expect } from "vitest";
import type { z } from "zod";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { RenderError } from "../../../../../packages/reporting/src/model.ts";
import { runExport, type ExportRunnerDeps } from "../../../../worker/src/reports/export-runner.ts";
import { exportJob, exportJobPage } from "../../../src/modules/reporting/exports/jobs.ts";
import { testEvidenceDir, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_BE_M: Readonly<Record<string, z.ZodType>> = {
  listExports: exportJobPage,
  createExport: exportJob,
  getExport: exportJob,
  cancelExport: exportJob,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeMOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;
  const auditor = p.auditor.session;
  const sponsor = p.sponsor.session;
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const E = "/api/v1/exports";

  const generated = await mirrored("POST", `${T}/reports/registers/generate`, {
    session: lead,
    body: { parameters: { register: "raid" } },
  });
  expect(generated.status).toBe(201);
  const snapshotId = generated.body.id as string;
  const discarded = await mirrored("POST", `${T}/reports/registers/generate`, {
    session: lead,
    body: { parameters: { register: "raid", filters: { type: "issue" } } },
  });
  expect(
    (
      await mirrored("POST", `${T}/report-snapshots/${discarded.body.id}/discard`, {
        session: lead,
        headers: ifm(1),
        body: { reason: "Synthetic contract discard" },
      })
    ).status,
  ).toBe(200);

  const work = async (exportJobId: string, retryCount = 0, deps: Partial<ExportRunnerDeps> = {}) => {
    const row = await api.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("idempotency_key", "=", `export_job.requested:${exportJobId}`)
      .executeTakeFirstOrThrow();
    const envelope = {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    };
    return runExport(
      api.db,
      envelope,
      row.id,
      { retryCount, retryLimit: 5 },
      {
        store: new FilesystemExportStore(testEvidenceDir()),
        ...deps,
      },
    );
  };

  // createExport: 400; 403 (AUD); 404; 422 (format, discarded); 202; 200 (same key); 422 (key reused).
  const body = { snapshotId, format: "csv", language: "en" };
  const key = { "idempotency-key": `contract-${crypto.randomUUID()}` };
  expect((await mirrored("POST", E, { session: lead, body: { ...body, extra: 1 } })).status).toBe(400);
  expect((await mirrored("POST", E, { session: auditor, body })).status).toBe(403);
  expect((await mirrored("POST", E, { session: lead, body: { ...body, snapshotId: missing } })).status).toBe(404);
  expect(code(await mirrored("POST", E, { session: lead, body: { ...body, snapshotId: discarded.body.id } }))).toEqual([
    422,
    "export.snapshot_discarded",
  ]);
  const created = await mirrored("POST", E, { session: lead, body, headers: key });
  expect(created.status).toBe(202);
  const id = created.body.id as string;
  expect((await mirrored("POST", E, { session: lead, body, headers: key })).status).toBe(200);
  expect(code(await mirrored("POST", E, { session: lead, body: { ...body, language: "ar" }, headers: key }))).toEqual([
    422,
    "idempotency.key_reused",
  ]);
  const defs = (await mirrored("GET", "/api/v1/report-definitions", { session: lead })).body.items as Body[];
  const narrow = defs.find((d) => d.formats.length < 5 && d.subjectType === "transformation");
  if (narrow !== undefined) {
    const other = ["pdf", "docx", "xlsx", "pptx", "csv"].find((f) => !narrow.formats.includes(f))!;
    const s = await mirrored("POST", `${T}/reports/${narrow.code}/generate`, { session: lead, body: {} });
    if (s.status === 201)
      expect(
        code(await mirrored("POST", E, { session: lead, body: { ...body, snapshotId: s.body.id, format: other } })),
      ).toEqual([422, "export.format_not_offered"]);
  }

  // getExport: 200; 400; 404 (unknown; another user's).
  expect((await mirrored("GET", `${E}/${id}`, { session: lead })).status).toBe(200);
  expect((await mirrored("GET", `${E}/not-a-uuid`, { session: lead })).status).toBe(400);
  expect((await mirrored("GET", `${E}/${missing}`, { session: lead })).status).toBe(404);
  expect((await mirrored("GET", `${E}/${id}`, { session: sponsor })).status).toBe(404);

  // downloadExport before success: 409 export.not_ready; 400; 404.
  expect(code(await mirrored("GET", `${E}/${id}/download`, { session: lead }))).toEqual([409, "export.not_ready"]);
  expect((await mirrored("GET", `${E}/not-a-uuid/download`, { session: lead })).status).toBe(400);
  expect((await mirrored("GET", `${E}/${id}/download`, { session: nobody })).status).toBe(404);

  // The worker renders it; downloadExport: 200 (text/csv).
  expect((await work(id)).outcome).toBe("succeeded");
  const file = await mirrored("GET", `${E}/${id}/download`, { session: lead });
  expect([file.status, file.headers["content-type"]]).toEqual([200, "text/csv; charset=utf-8"]);

  // A failed job's download: 422 export.failed (a renderer's own validation error fails the job render_failed).
  const pdf = await mirrored("POST", E, { session: lead, body: { ...body, format: "pdf" } });
  expect(pdf.status).toBe(202);
  const invalid = () => {
    throw new RenderError("synthetic renderer validation error");
  };
  expect((await work(pdf.body.id, 0, { afterSection: invalid })).outcome).toBe("failed");
  expect(code(await mirrored("GET", `${E}/${pdf.body.id}/download`, { session: lead }))).toEqual([
    422,
    "export.failed",
  ]);

  // listExports: 200; 400.
  expect((await mirrored("GET", `${E}?status=succeeded&limit=5`, { session: lead })).status).toBe(200);
  expect((await mirrored("GET", `${E}?status=done`, { session: lead })).status).toBe(400);

  // cancelExport: 400; 403 (AUD); 404; 428; 409; 200; 422 (finished).
  const queued = await mirrored("POST", E, { session: lead, body: { ...body, language: "ar" } });
  expect(queued.status).toBe(202);
  const C = `${E}/${queued.body.id}/cancel`;
  expect((await mirrored("POST", `${E}/not-a-uuid/cancel`, { session: lead, headers: ifm(1) })).status).toBe(400);
  expect((await mirrored("POST", C, { session: auditor, headers: ifm(1) })).status).toBe(403);
  expect((await mirrored("POST", `${E}/${missing}/cancel`, { session: lead, headers: ifm(1) })).status).toBe(404);
  expect(code(await mirrored("POST", C, { session: lead }))).toEqual([428, "precondition_required"]);
  expect(code(await mirrored("POST", C, { session: lead, headers: ifm(7) }))).toEqual([409, "version_conflict"]);
  const cancelled = await mirrored("POST", C, { session: lead, headers: ifm(1) });
  expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
  expect(code(await mirrored("POST", C, { session: lead, headers: ifm(2) }))).toEqual([422, "export.not_cancellable"]);
}
