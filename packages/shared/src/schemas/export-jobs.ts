// P5 slice F (T-DG5-FE-E, promoted from apps/api/src/modules/reporting/exports/jobs.ts of T-DG5-BE-M; D-155 d; ADR-0046
// §5, §8; REQ-S13-005): the export-job request and response mirrors of the OpenAPI schemas ExportLiveSelection,
// ExportCreate, ExportJob and ExportJobPage. The API validates and serializes with them, the contract exercise checks
// responses with them, and the web types its export screens with them. The OpenAPI file is the source of truth.
//
// An export approves nothing; product gates G1-G6 are business approvals inside the product, and nothing here touches
// the engineering gates DG0-DG7.
import { z } from "zod";
import { REPORT_FORMATS, reportDefinitionCode } from "./report.ts";

export const EXPORT_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export const EXPORT_STAGES = ["queued", "loading", "rendering", "storing", "done"] as const;
export type ExportStage = (typeof EXPORT_STAGES)[number];
/** The job error codes (`export_job.error_code`, ADR-0046 §8): set exactly when the job failed. */
export const EXPORT_ERROR_CODES = [
  "export.render_failed",
  "export.too_large",
  "export.source_unavailable",
  "export.retries_exhausted",
] as const;
export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];
export const EXPORT_LANGUAGES = ["en", "ar"] as const;
export type ExportLanguage = (typeof EXPORT_LANGUAGES)[number];

/** OpenAPI `ExportLiveSelection`. */
export const exportLiveSelection = z.strictObject({
  definitionCode: reportDefinitionCode,
  subjectId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type ExportLiveSelection = z.infer<typeof exportLiveSelection>;

/** OpenAPI `ExportCreate`: exactly one of `snapshotId` or `report`. */
export const exportCreate = z
  .strictObject({
    snapshotId: z.uuid().optional(),
    report: exportLiveSelection.optional(),
    format: z.enum(REPORT_FORMATS),
    language: z.enum(EXPORT_LANGUAGES),
  })
  .refine((b) => (b.snapshotId === undefined) !== (b.report === undefined), {
    message: "validation.export_source",
    path: ["snapshotId"],
  });
export type ExportCreate = z.infer<typeof exportCreate>;

const nullableTimestamp = z.iso.datetime({ offset: true }).nullable();

/** OpenAPI `ExportJob` (the success body of createExport, getExport and cancelExport). */
export const exportJob = z.strictObject({
  id: z.uuid(),
  transformationId: z.uuid(),
  snapshotId: z.uuid(),
  format: z.enum(REPORT_FORMATS),
  language: z.enum(EXPORT_LANGUAGES),
  status: z.enum(EXPORT_STATUSES),
  stage: z.enum(EXPORT_STAGES),
  percent: z.number().int().min(0).max(100),
  sectionsDone: z.number().int().min(0),
  sectionsTotal: z.number().int().min(0).nullable(),
  attemptCount: z.number().int().min(0),
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  fileSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  fileSizeBytes: z.number().int().min(1).nullable(),
  errorCode: z.enum(EXPORT_ERROR_CODES).nullable(),
  cancelledAt: nullableTimestamp,
  version: z.number().int().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ExportJob = z.infer<typeof exportJob>;

/** OpenAPI `ExportJobPage`. */
export const exportJobPage = z.strictObject({ items: z.array(exportJob), nextCursor: z.string().nullable() });
export type ExportJobPage = z.infer<typeof exportJobPage>;
