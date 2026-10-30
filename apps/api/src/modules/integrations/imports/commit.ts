// Import batches: the reads, the upload staging, the commit of the valid rows and the cancel (ADR-0056 §2, §5, §6, §9;
// REQ-S17-002, REQ-S17-003; p6-work-split §B/A.5; T-DG6-BE-M2).
//
// Authorization (0107; permissions matrix §26): `import.read` (KDS, BO, TO, AUD) for the batch, its rows and the
// templates; `import.create` (KDS) to upload; `import.commit` (KDS) to commit or cancel, and at commit also every
// `requiredPermissions` code of the target (`kpi_actual.submit`). Every read is scoped by the batch's transformation
// through `ReadScope` (ADR-0051 §1): a caller who cannot read the transformation gets 404 (existence never disclosed);
// one who can read it but lacks the import permission gets 403. AUD reads only and gets 403 on every mutation.
//
// The commit (ADR-0056 §6), in ONE transaction under the importCommit advisory lock (key: the batch id):
//   1. commit-time re-authorization of the committer (grants reloaded inside the transaction);
//   2. the batch row locked; `staged` else 409 `import.not_staged`; the If-Match version else 409; no valid row ->
//      422 `import.nothing_to_commit`;
//   3. re-validation of every `valid` row with the target's own rules, read-only, against the data as it is now (the row
//      rules and the target's committed keys): any row that fails -> 409 `import.revalidation_failed` with its row
//      numbers, and nothing is written (the user cancels and uploads again);
//   4. each valid row in row order through the target's `commitRow` (KPI actuals: the DG4 submission service; it never
//      accepts a value by itself), then its lineage row (`import_row_commit`) and the row `committed`; every other row
//      `not_committed`; the batch `committed` with its count and one audit event `import_batch.committed`.
// No remote I/O happens inside the transaction (p6-work-split §2 rule 4). Nothing here reads or writes DG0-DG7, and a
// commit approves nothing: DG4's review route still decides each submitted actual.
import { sql, type Db, type DbOrTx, type ImportRowTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import {
  auditContextOf,
  commitTimeDenial,
  denialOf,
  principalOf,
  readScopeFor,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  type Principal,
  type ResolvedTarget,
} from "../../access/index.ts";
import { record as audit, type AuditContext } from "../../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, problems } from "../../platform/index.ts";
import {
  bareMediaType,
  parseImportFile,
  prepareImport,
  stageImport,
  uploadSource,
  type ImportBatchRow,
} from "./staging.ts";
import {
  importTargetRegistry,
  type ImportCells,
  type ImportFileMediaType,
  type ImportTarget,
  type ImportTargetContext,
  type ImportTargetRegistry,
} from "./targets.ts";

export const IMPORT_READ: Permission = "import.read";
export const IMPORT_CREATE: Permission = "import.create";
export const IMPORT_COMMIT: Permission = "import.commit";

export type ImportRowRow = Selectable<ImportRowTable>;

// ------------------------------------------------------------------------------------------------ refusals

/** ADR-0056 §9 (English verbatim; codes are i18n keys under `problems.`). */
export const importBatchRefusals = {
  notStaged: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "import.not_staged",
      title: "Conflict",
      detail: "Only a staged import can be committed or cancelled.",
    }),
  nothingToCommit: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "import.nothing_to_commit",
      title: "Business rule violated",
      detail: "This import has no valid row to commit.",
    }),
  revalidationFailed: (rowNumbers: readonly number[]) => {
    const rows = rowNumbers.join(", ");
    return new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "import.revalidation_failed",
      title: "Conflict",
      detail: `Rows ${rows} are no longer valid. Cancel this import and upload the file again.`,
      params: { rows },
    });
  },
};

// ------------------------------------------------------------------------------------------------ authorization

/**
 * The read gate of a transformation's imports: 404 without `transformation.read` (never disclose existence), then the
 * `import.read` decision through the principal's ReadScope (403 when it does not admit the transformation).
 */
export async function requireImportRead(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
): Promise<ResolvedTarget> {
  const target = await requireTransformationRead(db, principal, transformationId);
  const scope = await readScopeFor(db, principal, IMPORT_READ);
  if (!scope.admits({ recordType: null, recordId: transformationId, target, partyUserIds: [] }))
    throw problems.forbidden().withDenial(denialOf(IMPORT_READ, target));
  return target;
}

/** The mutation gate: the read gate (404), then each permission in the transformation (403). */
export async function requireImportAction(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  permissions: readonly Permission[],
): Promise<ResolvedTarget> {
  const target = await requireTransformationRead(db, principal, transformationId);
  for (const p of permissions) await requireAction(db, principal, p, target);
  return target;
}

/** The permissions a commit needs: `import.commit` plus the target's own (ADR-0056 §6 step 1). */
export function commitPermissions(target: ImportTarget | undefined): Permission[] {
  return [IMPORT_COMMIT, ...(target?.requiredPermissions ?? [])];
}

// ------------------------------------------------------------------------------------------------ reads

/** One batch of the transformation; 404 when it does not exist there. */
export async function findBatch(db: DbOrTx, transformationId: string, batchId: string): Promise<ImportBatchRow> {
  const row = await db
    .selectFrom("import_batch")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", batchId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

export interface BatchListFilter {
  readonly status?: string;
  readonly sourceKind?: string;
  /** [created_at ISO, id] of the last item of the previous page. */
  readonly after: readonly [string, string] | null;
  readonly limit: number;
}

/**
 * The batches of a transformation, newest first (created_at desc, id desc). The rows are filtered in SQL by the
 * principal's ReadScope for `import.read` (ADR-0051 §1), on top of the route's read gate.
 */
export async function listBatches(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  f: BatchListFilter,
): Promise<ImportBatchRow[]> {
  const scope = await readScopeFor(db, principal, IMPORT_READ);
  let q = db
    .selectFrom("import_batch as b")
    .selectAll("b")
    .where("b.transformation_id", "=", transformationId)
    .where(({ ref }) =>
      scope.predicate({
        recordType: null,
        recordId: ref("b.id"),
        organizationId: ref("b.organization_id"),
        transformationId: ref("b.transformation_id"),
      }),
    );
  if (f.status !== undefined) q = q.where("b.status", "=", f.status);
  if (f.sourceKind !== undefined) q = q.where("b.source_kind", "=", f.sourceKind);
  if (f.after !== null) {
    const [at, id] = f.after;
    q = q.where(sql<boolean>`(b.created_at, b.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  return q
    .orderBy("b.created_at", "desc")
    .orderBy("b.id", "desc")
    .limit(f.limit + 1)
    .execute();
}

export interface RowListFilter {
  readonly validationStatus?: string;
  /** The row number of the last item of the previous page. */
  readonly afterRowNumber: number | null;
  readonly limit: number;
}

export type ImportRowWithLineage = ImportRowRow & {
  readonly l_target_record_type: string | null;
  readonly l_target_record_id: string | null;
  readonly l_target_value_no: number | null;
  readonly l_committed_at: Date | null;
  readonly duplicate_of_row_number: number | null;
};

/** The rows of a batch in source order, with their lineage and the row number of the row a duplicate points at. */
export async function listBatchRows(db: DbOrTx, batchId: string, f: RowListFilter): Promise<ImportRowWithLineage[]> {
  let q = db
    .selectFrom("import_row as r")
    .leftJoin("import_row_commit as l", "l.import_row_id", "r.id")
    .leftJoin("import_row as d", "d.id", "r.duplicate_of_row_id")
    .selectAll("r")
    .select([
      "l.target_record_type as l_target_record_type",
      "l.target_record_id as l_target_record_id",
      "l.target_value_no as l_target_value_no",
      "l.committed_at as l_committed_at",
      "d.row_number as duplicate_of_row_number",
    ])
    .where("r.import_batch_id", "=", batchId);
  if (f.validationStatus !== undefined) q = q.where("r.validation_status", "=", f.validationStatus);
  if (f.afterRowNumber !== null) q = q.where("r.row_number", ">", f.afterRowNumber);
  return (await q
    .orderBy("r.row_number")
    .limit(f.limit + 1)
    .execute()) as ImportRowWithLineage[];
}

// ------------------------------------------------------------------------------------------------ response shapes

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** The contract's `ImportBatch`. Counts stay null while staging (Unknown, never 0). */
export function toImportBatch(b: ImportBatchRow) {
  return {
    id: b.id,
    transformationId: b.transformation_id,
    targetKind: b.target_kind as "kpi_actual",
    templateVersion: b.template_version,
    formSchemaVersionId: b.form_schema_version_id,
    sourceKind: b.source_kind,
    connectorId: b.connector_id,
    integrationRunId: b.integration_run_id,
    webhookReceiptId: b.webhook_receipt_id,
    fileName: b.file_name,
    mediaType: b.media_type,
    byteSize: b.byte_size,
    contentSha256: b.content_sha256 === null ? null : b.content_sha256.trim(),
    status: b.status,
    rowsTotal: b.rows_total,
    rowsValid: b.rows_valid,
    rowsInvalid: b.rows_invalid,
    rowsDuplicate: b.rows_duplicate,
    rowsCommitted: b.rows_committed,
    failureCode: b.failure_code,
    commitMode: b.commit_mode,
    onBehalfOfUserId: b.on_behalf_of_user_id,
    committedAt: iso(b.committed_at),
    committedBy: b.committed_by,
    cancelledAt: iso(b.cancelled_at),
    cancelledBy: b.cancelled_by,
    cancelReason: b.cancel_reason,
    createdAt: b.created_at.toISOString(),
    createdBy: b.created_by,
    version: b.version,
  };
}

type StoredReason = { code: string; field?: string | null; params?: Record<string, string | number> };

/** The contract's `ImportRow`: raw cells as text, reason codes (rendered by the client in en or ar), lineage. */
export function toImportRow(r: ImportRowWithLineage) {
  const reasons = (r.reasons as StoredReason[]).map((x) => ({
    code: x.code,
    field: x.field ?? null,
    params: x.params ?? {},
  }));
  return {
    id: r.id,
    rowNumber: r.row_number,
    sourceRecordId: r.source_record_id,
    raw: r.raw as Record<string, string | null>,
    normalized: (r.normalized ?? null) as Record<string, string | null> | null,
    duplicateKey: r.duplicate_key,
    validationStatus: r.validation_status,
    duplicateOfRowNumber: r.duplicate_of_row_number,
    reasons,
    commitStatus: r.commit_status,
    lineage:
      r.l_target_record_id === null || r.l_committed_at === null
        ? null
        : {
            targetRecordType: r.l_target_record_type as "kpi_actual",
            targetRecordId: r.l_target_record_id,
            targetValueNo: r.l_target_value_no ?? 1,
            committedAt: r.l_committed_at.toISOString(),
          },
  };
}

// ------------------------------------------------------------------------------------------------ upload (createImport)

export interface UploadInput {
  readonly transformationId: string;
  readonly templateVersion: string;
  readonly fileName: string;
  readonly contentType: string | null | undefined;
  readonly bytes: Uint8Array;
}

/**
 * Stages an uploaded file (ADR-0056 §2-§5): the gates (404, 403 `import.create`), the parse with its limits (413, 415,
 * 422) and the row validation run BEFORE the staging transaction; the transaction re-checks `import.create` on the
 * reloaded grants after the batch lock, then writes the batch, its rows and its counts.
 */
export async function stageUpload(
  db: Db,
  request: FastifyRequest,
  input: UploadInput,
  registry: ImportTargetRegistry = importTargetRegistry(),
): Promise<ImportBatchRow> {
  const principal = principalOf(request);
  await requireImportAction(db, principal, input.transformationId, [IMPORT_CREATE]);
  const sheet = parseImportFile(input.bytes, input.contentType);
  const mediaType = bareMediaType(input.contentType) as ImportFileMediaType;
  const prepared = await prepareImport(
    db,
    {
      templateVersion: input.templateVersion,
      transformationId: input.transformationId,
      actorUserId: principal.userId,
      sheet,
    },
    registry,
  );
  return stageImport(db, prepared, {
    source: uploadSource(input.fileName, mediaType, input.bytes),
    createdBy: principal.userId,
    audit: auditContextOf(request),
    recheck: async (tx) => {
      const fresh = await refreshPrincipal(tx, request);
      try {
        await requireImportAction(tx, fresh, input.transformationId, [IMPORT_CREATE]);
      } catch (err) {
        throw commitTimeDenial(err);
      }
    },
  });
}

// ------------------------------------------------------------------------------------------------ commit

export interface CommitBatchOptions {
  readonly transformationId: string;
  readonly batchId: string;
  /** The If-Match version; null for an `auto` commit (webhooks, BE-N), which has no client version. */
  readonly expectedVersion: number | null;
  readonly note: string | null;
  /** The committing user (`committed_by`; for an auto commit, `on_behalf_of_user_id`). */
  readonly userId: string;
  readonly audit: AuditContext;
  /** Commit-time re-authorization inside the transaction, after the lock (the route: reloaded grants). */
  readonly recheck: (tx: Tx, permissions: readonly Permission[]) => Promise<void>;
  /** For an auto commit the batch's `committed_by` stays null (CHECK `import_batch_committed_shape`). */
  readonly committedBy: string | null;
}

/** Locks a batch for a state change: the importCommit advisory lock (key: the batch id), then the row. */
async function lockBatch(tx: Tx, transformationId: string, batchId: string): Promise<ImportBatchRow> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.importCommit}::int4, hashtext(${batchId}::text))`.execute(
    tx,
  );
  const row = await tx
    .selectFrom("import_batch")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", batchId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

function contextOf(tx: Tx, b: ImportBatchRow, userId: string, auditContext: AuditContext): ImportTargetContext {
  // The commit's audit context travels with the target context, so the target's own audit events (DG4) carry this
  // request's id (kpi/import-target.ts reads `audit` when present).
  return Object.assign(
    {
      db: tx,
      organizationId: b.organization_id,
      transformationId: b.transformation_id,
      formSchemaVersionId: b.form_schema_version_id,
      templateVersion: b.template_version,
      actorUserId: userId,
    } satisfies ImportTargetContext,
    { audit: auditContext },
  );
}

/**
 * Re-validates the valid rows against the data as it is now (ADR-0056 §6 step 2): the target's row rules for the
 * committing user, the same duplicate key as at staging, and no committed record with that key. Returns the row
 * numbers that are no longer valid.
 */
async function revalidate(
  target: ImportTarget,
  ctx: ImportTargetContext,
  rows: readonly ImportRowRow[],
): Promise<number[]> {
  const failed = new Set<number>();
  for (const r of rows) {
    const verdict = await target.validateRow(ctx, {
      rowNumber: r.row_number,
      cells: r.raw as ImportCells,
    });
    if (!verdict.valid || verdict.duplicateKey !== r.duplicate_key) failed.add(r.row_number);
  }
  const keys = rows.map((r) => r.duplicate_key).filter((k): k is string => k !== null);
  if (keys.length > 0) {
    const existing = await target.existingKeys(ctx, keys);
    for (const r of rows) if (r.duplicate_key !== null && existing.has(r.duplicate_key)) failed.add(r.row_number);
  }
  return [...failed].sort((a, b) => a - b);
}

/** The commit of ADR-0056 §6 inside `tx`. Returns the committed batch. */
export async function commitBatchInTx(
  tx: Tx,
  o: CommitBatchOptions,
  registry: ImportTargetRegistry = importTargetRegistry(),
): Promise<ImportBatchRow> {
  const locked = await lockBatch(tx, o.transformationId, o.batchId);
  const target = registry.get(locked.template_version);
  await o.recheck(tx, commitPermissions(target));
  if (locked.status !== "staged") throw importBatchRefusals.notStaged();
  if (o.expectedVersion !== null && locked.version !== o.expectedVersion)
    throw problems.versionConflict(locked.version);
  if (!target) throw new Error(`import commit: template ${locked.template_version} is not registered`);
  if ((locked.rows_valid ?? 0) === 0) throw importBatchRefusals.nothingToCommit();

  const valid = await tx
    .selectFrom("import_row")
    .selectAll()
    .where("import_batch_id", "=", locked.id)
    .where("validation_status", "=", "valid")
    .where("commit_status", "=", "pending")
    .orderBy("row_number")
    .execute();
  const ctx = contextOf(tx, locked, o.userId, o.audit);
  const failed = await revalidate(target, ctx, valid);
  if (failed.length > 0) throw importBatchRefusals.revalidationFailed(failed);

  for (const r of valid) {
    const res = await target.commitRow(tx, ctx, {
      importRowId: r.id,
      rowNumber: r.row_number,
      sourceRecordId: r.source_record_id,
      normalized: r.normalized as ImportCells,
    });
    await tx
      .insertInto("import_row_commit")
      .values({
        id: uuidv7(),
        organization_id: locked.organization_id,
        transformation_id: locked.transformation_id,
        import_batch_id: locked.id,
        import_row_id: r.id,
        target_record_type: res.recordType,
        target_record_id: res.recordId,
        target_value_no: res.valueNo,
        committed_at: sql<Date>`now()`,
      })
      .execute();
    await tx
      .updateTable("import_row")
      .set({ commit_status: "committed", updated_at: sql<Date>`now()` })
      .where("id", "=", r.id)
      .execute();
  }
  await tx
    .updateTable("import_row")
    .set({ commit_status: "not_committed", updated_at: sql<Date>`now()` })
    .where("import_batch_id", "=", locked.id)
    .where("commit_status", "=", "pending")
    .execute();
  const committed = await tx
    .updateTable("import_batch")
    .set({
      status: "committed",
      rows_committed: valid.length,
      committed_at: sql<Date>`now()`,
      committed_by: o.committedBy,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: o.committedBy,
    })
    .where("id", "=", locked.id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, o.audit, {
    action: "import_batch.committed",
    recordType: "import_batch",
    recordId: locked.id,
    organizationId: locked.organization_id,
    transformationId: locked.transformation_id,
    priorVersion: locked.version,
    newVersion: committed.version,
    changes: {
      status: { from: "staged", to: "committed" },
      rows_committed: { from: null, to: valid.length },
      rows_not_committed: { from: null, to: (locked.rows_total ?? 0) - valid.length },
      commit_mode: { from: null, to: locked.commit_mode },
      ...(o.note === null ? {} : { note: { from: null, to: o.note } }),
    },
  });
  return committed;
}

/** The route's commit: commit-time re-authorization of the session user on reloaded grants, one transaction. */
export function commitUpload(
  db: Db,
  request: FastifyRequest,
  transformationId: string,
  batchId: string,
  expectedVersion: number,
  note: string | null,
): Promise<ImportBatchRow> {
  const principal = principalOf(request);
  const userId = principal.userId;
  if (userId === null) throw problems.forbidden();
  return db.transaction().execute((tx) =>
    commitBatchInTx(tx, {
      transformationId,
      batchId,
      expectedVersion,
      note,
      userId,
      committedBy: userId,
      audit: auditContextOf(request),
      recheck: async (t, permissions) => {
        const fresh = await refreshPrincipal(t, request);
        try {
          await requireImportAction(t, fresh, transformationId, permissions);
        } catch (err) {
          throw commitTimeDenial(err);
        }
      },
    }),
  );
}

// ------------------------------------------------------------------------------------------------ cancel

/** `cancelImport` (ADR-0056 §6): `staged` -> `cancelled` with a reason; the rows are kept. */
export function cancelUpload(
  db: Db,
  request: FastifyRequest,
  transformationId: string,
  batchId: string,
  expectedVersion: number,
  reason: string,
): Promise<ImportBatchRow> {
  const userId = principalOf(request).userId;
  if (userId === null) throw problems.forbidden();
  return db.transaction().execute(async (tx) => {
    const locked = await lockBatch(tx, transformationId, batchId);
    const fresh = await refreshPrincipal(tx, request);
    try {
      await requireImportAction(tx, fresh, transformationId, [IMPORT_COMMIT]);
    } catch (err) {
      throw commitTimeDenial(err);
    }
    if (locked.status !== "staged") throw importBatchRefusals.notStaged();
    if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
    const cancelled = await tx
      .updateTable("import_batch")
      .set({
        status: "cancelled",
        cancelled_at: sql<Date>`now()`,
        cancelled_by: userId,
        cancel_reason: reason,
        version: locked.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: userId,
      })
      .where("id", "=", locked.id)
      .where("version", "=", locked.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, auditContextOf(request), {
      action: "import_batch.cancelled",
      recordType: "import_batch",
      recordId: locked.id,
      organizationId: locked.organization_id,
      transformationId: locked.transformation_id,
      priorVersion: locked.version,
      newVersion: cancelled.version,
      changes: { status: { from: "staged", to: "cancelled" }, cancel_reason: { from: null, to: reason } },
    });
    return cancelled;
  });
}
