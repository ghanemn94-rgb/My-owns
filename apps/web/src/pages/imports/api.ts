// Strategy and KPIs > Imports: the request paths, types, query keys and read hooks of the import operations
// (T-DG6-FE-C; p6-work-split §B/A.9; ADR-0056 §2-§6, §9; docs/api/openapi.yaml). Written from the contract; FE tasks keep
// their hooks here and never edit `api/**`.
//
// Counts are null while a batch is staging: "Unknown", never 0 (ADR-0056 §2 invariant 4). Cells are text and are shown
// as text; nothing here parses a value into a number (§B/A.13 item 4).
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";

const v1 = "/api/v1";
const seg = (s: string) => encodeURIComponent(s);

export type ImportBatchStatus = "staging" | "staged" | "committed" | "cancelled" | "failed";
export type ImportSourceKind = "csv_upload" | "xlsx_upload" | "webhook" | "connector";
export type ImportRowValidationStatus = "valid" | "invalid" | "duplicate_in_batch" | "duplicate_committed";

export const IMPORT_BATCH_STATUSES: readonly ImportBatchStatus[] = [
  "staging",
  "staged",
  "committed",
  "cancelled",
  "failed",
];
export const IMPORT_SOURCE_KINDS: readonly ImportSourceKind[] = ["csv_upload", "xlsx_upload", "webhook", "connector"];
export const IMPORT_ROW_STATUSES: readonly ImportRowValidationStatus[] = [
  "valid",
  "invalid",
  "duplicate_in_batch",
  "duplicate_committed",
];

export const CSV_MEDIA_TYPE = "text/csv";
export const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** The whole-file limit of ADR-0056 §3 (also a database CHECK); a larger file is refused by the server with 413. */
export const IMPORT_MAX_BYTES = 10_485_760;

export interface ImportBatch {
  readonly id: string;
  readonly transformationId: string;
  readonly targetKind: "kpi_actual";
  readonly templateVersion: string;
  readonly formSchemaVersionId: string;
  readonly sourceKind: ImportSourceKind;
  readonly connectorId: string | null;
  readonly integrationRunId: string | null;
  readonly webhookReceiptId: string | null;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly byteSize: number | null;
  readonly contentSha256: string | null;
  readonly status: ImportBatchStatus;
  readonly rowsTotal: number | null;
  readonly rowsValid: number | null;
  readonly rowsInvalid: number | null;
  readonly rowsDuplicate: number | null;
  readonly rowsCommitted: number | null;
  readonly failureCode: string | null;
  readonly commitMode: "manual" | "auto";
  readonly onBehalfOfUserId: string | null;
  readonly committedAt: string | null;
  readonly committedBy: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly version: number;
}

export interface ImportRowReason {
  readonly code: string;
  readonly field: string | null;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface ImportRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly sourceRecordId: string | null;
  readonly raw: Readonly<Record<string, string | null>>;
  readonly normalized: Readonly<Record<string, string | null>> | null;
  readonly duplicateKey: string | null;
  readonly validationStatus: ImportRowValidationStatus;
  readonly duplicateOfRowNumber: number | null;
  readonly reasons: readonly ImportRowReason[];
  readonly commitStatus: "pending" | "committed" | "not_committed";
  readonly lineage: {
    readonly targetRecordType: "kpi_actual";
    readonly targetRecordId: string;
    readonly targetValueNo: number;
    readonly committedAt: string;
  } | null;
}

export interface ImportTemplateColumn {
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly required: boolean;
  readonly kind: "text" | "uuid" | "decimal" | "date" | "boolean" | "enum";
  readonly example: string | null;
}

export interface ImportTemplate {
  readonly templateVersion: string;
  readonly targetKind: "kpi_actual";
  readonly titleEn: string;
  readonly titleAr: string;
  readonly mediaTypes: readonly string[];
  readonly columns: readonly ImportTemplateColumn[];
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

const importsBase = (tid: string) => `${v1}/transformations/${seg(tid)}/imports`;

export const importPaths = {
  imports: importsBase, // listImports, createImport (?template=; X-File-Name)
  import: (tid: string, importId: string) => `${importsBase(tid)}/${seg(importId)}`, // getImport
  rows: (tid: string, importId: string) => `${importsBase(tid)}/${seg(importId)}/rows`, // listImportRows
  commit: (tid: string, importId: string) => `${importsBase(tid)}/${seg(importId)}/commit`, // commitImport
  cancel: (tid: string, importId: string) => `${importsBase(tid)}/${seg(importId)}/cancel`, // cancelImport
  templates: `${v1}/import-templates`, // listImportTemplates
  /** downloadImportTemplate: a same-origin GET opened as a download (the session cookie authorizes it). */
  templateDownload: (templateVersion: string, format: "csv" | "xlsx", transformationId: string) =>
    buildUrl(`${v1}/import-templates/${seg(templateVersion)}/download`, { format, transformationId }),
};

export const IMPORT_OPERATIONS: readonly (readonly [string, "GET" | "POST", string])[] = [
  ["listImports", "GET", "/api/v1/transformations/{transformationId}/imports"],
  ["createImport", "POST", "/api/v1/transformations/{transformationId}/imports"],
  ["getImport", "GET", "/api/v1/transformations/{transformationId}/imports/{importId}"],
  ["listImportRows", "GET", "/api/v1/transformations/{transformationId}/imports/{importId}/rows"],
  ["commitImport", "POST", "/api/v1/transformations/{transformationId}/imports/{importId}/commit"],
  ["cancelImport", "POST", "/api/v1/transformations/{transformationId}/imports/{importId}/cancel"],
  ["listImportTemplates", "GET", "/api/v1/import-templates"],
  ["downloadImportTemplate", "GET", "/api/v1/import-templates/{templateVersion}/download"],
];

export const importKeys = {
  all: ["p6", "imports"] as const,
  list: (tid: string, query: Record<string, string>) => ["p6", "imports", tid, "list", query] as const,
  batch: (tid: string, importId: string) => ["p6", "imports", tid, "batch", importId] as const,
  rows: (tid: string, importId: string, query: Record<string, string>) =>
    ["p6", "imports", tid, "batch", importId, "rows", query] as const,
  templates: ["p6", "imports", "templates"] as const,
};

export function useImportsRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: importKeys.all });
}

export function useImports(tid: string | undefined, query: Record<string, string>, cursor: string | null) {
  return useQuery({
    queryKey: [...importKeys.list(tid ?? "", query), cursor ?? ""],
    queryFn: () =>
      api.get<Page<ImportBatch>>(importPaths.imports(tid ?? ""), { ...query, ...(cursor ? { cursor } : {}) }),
    enabled: Boolean(tid),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useImport(tid: string | undefined, importId: string | undefined) {
  return useQuery({
    queryKey: importKeys.batch(tid ?? "", importId ?? ""),
    queryFn: () => api.get<ImportBatch>(importPaths.import(tid ?? "", importId ?? "")),
    enabled: Boolean(tid && importId),
    retry: shouldRetry,
    // A batch that is still staging has Unknown counts: look again shortly (bounded by the page being open).
    refetchInterval: (q) => (q.state.data?.status === "staging" ? 2000 : false),
  });
}
export function useImportRows(
  tid: string | undefined,
  importId: string | undefined,
  query: Record<string, string>,
  cursor: string | null,
) {
  return useQuery({
    queryKey: [...importKeys.rows(tid ?? "", importId ?? "", query), cursor ?? ""],
    queryFn: () =>
      api.get<Page<ImportRow>>(importPaths.rows(tid ?? "", importId ?? ""), {
        ...query,
        ...(cursor ? { cursor } : {}),
      }),
    enabled: Boolean(tid && importId),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useImportTemplates() {
  return useQuery({
    queryKey: importKeys.templates,
    queryFn: () => api.get<{ items: ImportTemplate[] }>(importPaths.templates),
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
}
