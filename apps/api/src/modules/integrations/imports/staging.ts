// The import staging engine (ADR-0056 §2-§5; REQ-S17-002, REQ-S17-003; p6-work-split §B/A.3; T-DG6-BE-M).
//
//   parse (parseImportFile: size, media type against the content, CSV or XLSX)        no transaction, no write
//   -> prepareImport: the header against the template, the engine's cell rules and   read-only queries, before the
//      the target's row rules (validateRow)                                          staging transaction
//   -> stageImportInTx: in ONE transaction, under the importCommit advisory lock (key: the batch id): the caller's
//      commit-time re-check, the batch (staging, version 1), the target's existing keys, duplicate classification,
//      every row, then the batch `staged` with its counts (version 2); one audit event per batch version.
//
// The file bytes are never stored: the batch keeps the file name, media type, size and SHA-256, and each row its cells
// as text (`import_row.raw`). Counts are NULL while staging (Unknown, never 0). No remote I/O happens in the transaction
// (p6-work-split §2 rule 4): a webhook's or a connector's source data is fetched and verified before it.
//
// No route here: BE-M2 routes uploads (createImport) through `parseImportFile`, `prepareImport` and `stageImport`;
// BE-N calls `stageImportInTx` inside its receipt transaction; BE-L2 stages a connector run's rows the same way.
import { createHash } from "node:crypto";
import { sql, type Db, type DbOrTx, type ImportBatchTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { record as audit, type AuditContext } from "../../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, problems } from "../../platform/index.ts";
import { candidateKeys, classifyDuplicates, countRows, type CheckedRow, type ClassifiedRow } from "./duplicates.ts";
import { parseCsv } from "./parsers/csv.ts";
import { parseXlsx } from "./parsers/xlsx.ts";
import {
  cellValue,
  importTargetRegistry,
  CSV_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  type ImportFileMediaType,
  type ImportTarget,
  type ImportTargetContext,
  type ImportTargetRegistry,
} from "./targets.ts";
import {
  IMPORT_LIMITS,
  checkCells,
  importRefusals,
  mergeVerdict,
  rawForStorage,
  toTable,
  type ParsedSheet,
  type ParsedTable,
} from "./validate.ts";

export type ImportBatchRow = Selectable<ImportBatchTable>;

// ------------------------------------------------------------------------------------------------ parse

/** The bare media type of a Content-Type header value ("text/csv; charset=utf-8" -> "text/csv"), lower case. */
export function bareMediaType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Parses an uploaded file (ADR-0056 §3): 413 `import.file_too_large` over 10 MiB; 415 `import.unsupported_media_type`
 * for any other declared media type, or content that does not match the declared one (CSV: text; XLSX: the ZIP
 * signature and `[Content_Types].xml`); then the parser's own refusals. `charset` other than UTF-8 on a CSV upload is
 * refused 415 as well: only UTF-8 CSV is supported.
 */
export function parseImportFile(bytes: Uint8Array, contentType: string | null | undefined): ParsedSheet {
  if (bytes.byteLength > IMPORT_LIMITS.fileBytes) throw importRefusals.fileTooLarge();
  const media = bareMediaType(contentType);
  if (media === CSV_MEDIA_TYPE) {
    const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "")?.[1]?.toLowerCase();
    if (charset !== undefined && charset !== "utf-8" && charset !== "utf8") throw importRefusals.unsupportedMediaType();
    return parseCsv(bytes);
  }
  if (media === XLSX_MEDIA_TYPE) return parseXlsx(bytes);
  throw importRefusals.unsupportedMediaType();
}

/** The upload source fields of a batch (`import_batch_source_shape`): name, media type, size and SHA-256. */
export function uploadSource(fileName: string, mediaType: ImportFileMediaType, bytes: Uint8Array): UploadSource {
  return {
    kind: mediaType === CSV_MEDIA_TYPE ? "csv_upload" : "xlsx_upload",
    fileName,
    mediaType,
    byteSize: bytes.byteLength,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

// ------------------------------------------------------------------------------------------------ prepare

export interface UploadSource {
  readonly kind: "csv_upload" | "xlsx_upload";
  readonly fileName: string;
  readonly mediaType: ImportFileMediaType;
  readonly byteSize: number;
  readonly contentSha256: string;
}
export interface WebhookSource {
  readonly kind: "webhook";
  readonly connectorId: string;
  readonly webhookReceiptId: string;
  readonly commitMode: "manual" | "auto";
  readonly onBehalfOfUserId: string | null;
}
export interface ConnectorSource {
  readonly kind: "connector";
  readonly connectorId: string;
  readonly integrationRunId: string;
  readonly commitMode: "manual" | "auto";
  readonly onBehalfOfUserId: string | null;
}
export type ImportSource = UploadSource | WebhookSource | ConnectorSource;

export interface PrepareImportInput {
  readonly templateVersion: string;
  readonly transformationId: string;
  /** The user the rows are checked for (the uploader; for a machine source the configured on-behalf-of user or null). */
  readonly actorUserId: string | null;
  /** A file's parsed sheet (the header is checked against the template here) ... */
  readonly sheet?: ParsedSheet;
  /** ... or rows already keyed by column (a webhook's items, a connector's mapped rows). */
  readonly table?: ParsedTable;
}

/** The result of `prepareImport`: everything the staging transaction writes, minus the target's existing keys. */
export interface PreparedImport {
  readonly target: ImportTarget;
  readonly context: ImportTargetContext;
  readonly header: readonly string[];
  readonly rows: readonly CheckedRow[];
}

/**
 * Validates the rows before the staging transaction (ADR-0056 §3 "parsing and validation run before the staging
 * transaction"): 422 `import.template_unknown` for an unregistered template; 404 for an unknown transformation;
 * 422 `import.header_mismatch` when the header does not fit the template; then each row through the engine's cell rules
 * and the target's `validateRow` (read-only). Rows that fail are kept with their reasons: they are isolated, never
 * dropped (M0334 "show row-level errors").
 */
export async function prepareImport(
  db: DbOrTx,
  input: PrepareImportInput,
  registry: ImportTargetRegistry = importTargetRegistry(),
): Promise<PreparedImport> {
  const target = registry.get(input.templateVersion);
  if (!target) throw importRefusals.templateUnknown(input.templateVersion);
  if ((input.sheet === undefined) === (input.table === undefined))
    throw new Error("prepareImport: pass exactly one of sheet or table");
  const tf = await db
    .selectFrom("transformation")
    .select(["id", "organization_id", sql<string>`p5_form_schema_version_for(id)`.as("form_schema_version_id")])
    .where("id", "=", input.transformationId)
    .executeTakeFirst();
  if (!tf) throw problems.notFound();
  const context: ImportTargetContext = {
    db,
    organizationId: tf.organization_id,
    transformationId: tf.id,
    formSchemaVersionId: tf.form_schema_version_id,
    templateVersion: target.templateVersion,
    actorUserId: input.actorUserId,
  };
  // Both inputs go through the same header check against the template (an unknown key is import.header_mismatch).
  const extension = target.extensionColumns ? await target.extensionColumns(context) : [];
  const table = toTable(input.sheet ?? sheetOfTable(input.table!), target, extension);
  if (table.rows.length > IMPORT_LIMITS.dataRows) throw importRefusals.tooManyRows();
  const rows: CheckedRow[] = [];
  for (const row of table.rows) {
    const check = checkCells(row);
    const verdict = await target.validateRow(context, { rowNumber: row.rowNumber, cells: check.cells });
    rows.push({
      rowNumber: row.rowNumber,
      sourceRecordId: check.sourceRecordId,
      raw: row.cells,
      verdict: mergeVerdict(check, verdict),
    });
  }
  return { target, context, header: table.header, rows };
}

/** A keyed table back to the positional shape, so its header is checked like a file's. */
function sheetOfTable(table: ParsedTable): ParsedSheet {
  const header = [...table.header];
  for (const r of table.rows)
    for (const key of [...Object.keys(r.cells), ...r.formulaColumns, ...(r.nonTextColumns ?? [])])
      if (!header.includes(key)) header.push(key);
  return {
    header,
    headerFormulaIndexes: [],
    rows: table.rows.map((r) => ({
      rowNumber: r.rowNumber,
      values: header.map((key) => cellValue(r.cells, key)),
      formulaIndexes: r.formulaColumns.map((key) => header.indexOf(key)),
      nonTextIndexes: (r.nonTextColumns ?? []).map((key) => header.indexOf(key)),
    })),
  };
}

// ------------------------------------------------------------------------------------------------ stage

export interface StageImportOptions {
  readonly source: ImportSource;
  /** The uploading user (uploads); null for a webhook or connector batch (`import_batch_source_shape`). */
  readonly createdBy: string | null;
  readonly audit: AuditContext;
  /**
   * The caller's commit-time authorization re-check (p6-work-split §2 rule 4), run inside the transaction after the
   * lock and before any write: for an upload, `import.create` in the batch's transformation through `ReadScope`.
   */
  readonly recheck?: (tx: Tx) => Promise<void>;
}

const formSchemaChanged = () =>
  new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.invalidTransition,
    code: "import.form_schema_changed",
    title: "Conflict",
    detail: "The form schema of this transformation changed while the file was checked. Upload the file again.",
  });

const ROW_CHUNK = 400;

/**
 * Stages a prepared import inside `tx` (ADR-0056 §2, §5). Returns the `staged` batch. The batch id is locked with the
 * importCommit advisory-lock class (ADVISORY_LOCK_CLASSES.importCommit). The target's existing keys are read inside the transaction, so a row is classified
 * `duplicate_committed` against the data as it is at staging; the DG4 unique key remains the backstop at commit.
 */
export async function stageImportInTx(
  tx: Tx,
  prepared: PreparedImport,
  options: StageImportOptions,
): Promise<ImportBatchRow> {
  const { context, target } = prepared;
  const id = uuidv7();
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.importCommit}::int4, hashtext(${id}::text))`.execute(
    tx,
  );
  if (options.recheck) await options.recheck(tx);
  const pinned = await sql<{
    v: string;
  }>`SELECT p5_form_schema_version_for(${context.transformationId}::uuid) AS v`.execute(tx);
  if (pinned.rows[0]?.v !== context.formSchemaVersionId) throw formSchemaChanged();

  const s = options.source;
  const machine = s.kind === "webhook" || s.kind === "connector";
  await tx
    .insertInto("import_batch")
    .values({
      id,
      organization_id: context.organizationId,
      transformation_id: context.transformationId,
      target_kind: target.kind,
      template_version: target.templateVersion,
      form_schema_version_id: context.formSchemaVersionId,
      source_kind: s.kind,
      connector_id: machine ? s.connectorId : null,
      integration_run_id: s.kind === "connector" ? s.integrationRunId : null,
      webhook_receipt_id: s.kind === "webhook" ? s.webhookReceiptId : null,
      file_name: machine ? null : s.fileName,
      media_type: machine ? (s.kind === "webhook" ? "application/json" : null) : s.mediaType,
      byte_size: machine ? null : s.byteSize,
      content_sha256: machine ? null : s.contentSha256,
      commit_mode: machine ? s.commitMode : "manual",
      on_behalf_of_user_id: machine ? s.onBehalfOfUserId : null,
      created_by: options.createdBy,
      updated_by: options.createdBy,
    })
    .execute();
  await audit(tx, options.audit, {
    action: "import_batch.created",
    recordType: "import_batch",
    recordId: id,
    organizationId: context.organizationId,
    transformationId: context.transformationId,
    newVersion: 1,
    changes: {
      template_version: { from: null, to: target.templateVersion },
      source_kind: { from: null, to: s.kind },
      file_name: { from: null, to: machine ? null : s.fileName },
      status: { from: null, to: "staging" },
    },
  });

  const keys = candidateKeys(prepared.rows);
  const committed = keys.length === 0 ? new Map() : await target.existingKeys({ ...context, db: tx }, keys);
  const classified = classifyDuplicates(prepared.rows, committed);
  await insertRows(tx, id, context, classified);
  const counts = countRows(classified);

  const staged = await tx
    .updateTable("import_batch")
    .set({
      status: "staged",
      rows_total: counts.total,
      rows_valid: counts.valid,
      rows_invalid: counts.invalid,
      rows_duplicate: counts.duplicate,
      version: 2,
      updated_at: sql<Date>`now()`,
      updated_by: options.createdBy,
    })
    .where("id", "=", id)
    .where("version", "=", 1)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, options.audit, {
    action: "import_batch.staged",
    recordType: "import_batch",
    recordId: id,
    organizationId: context.organizationId,
    transformationId: context.transformationId,
    priorVersion: 1,
    newVersion: 2,
    changes: {
      status: { from: "staging", to: "staged" },
      rows_total: { from: null, to: counts.total },
      rows_valid: { from: null, to: counts.valid },
      rows_invalid: { from: null, to: counts.invalid },
      rows_duplicate: { from: null, to: counts.duplicate },
    },
  });
  return staged;
}

async function insertRows(tx: Tx, batchId: string, context: ImportTargetContext, rows: readonly ClassifiedRow[]) {
  const idByRowNumber = new Map<number, string>();
  const values = rows.map((r) => {
    const rowId = uuidv7();
    idByRowNumber.set(r.rowNumber, rowId);
    return {
      id: rowId,
      organization_id: context.organizationId,
      transformation_id: context.transformationId,
      import_batch_id: batchId,
      row_number: r.rowNumber,
      source_record_id: r.sourceRecordId,
      raw: JSON.stringify(rawForStorage(r.raw)),
      normalized: r.normalized === null ? null : JSON.stringify(r.normalized),
      duplicate_key: r.duplicateKey,
      validation_status: r.validationStatus,
      duplicate_of_row_id: r.duplicateOfRowNumber === null ? null : idByRowNumber.get(r.duplicateOfRowNumber)!,
      reasons: JSON.stringify(r.reasons.map((x) => ({ code: x.code, field: x.field ?? null, params: x.params ?? {} }))),
    };
  });
  // Row-number order: an in-batch duplicate's first valid row is always inserted before it (trigger import_row_duplicate_of).
  for (let i = 0; i < values.length; i += ROW_CHUNK)
    await tx
      .insertInto("import_row")
      .values(values.slice(i, i + ROW_CHUNK))
      .execute();
}

/** `stageImportInTx` in its own transaction (uploads). */
export function stageImport(db: Db, prepared: PreparedImport, options: StageImportOptions): Promise<ImportBatchRow> {
  return db.transaction().execute((tx) => stageImportInTx(tx, prepared, options));
}
