// Administration > Data export: the service of the five migration-export operations (P7 slice C; ADR-0064 §7, §9;
// REQ-S19-014, REQ-S19-016; p7-work-split §C.1, §C.5; T-DG7-BE-C).
//
// Authorization: `migration.export` (configure; ADM_TECH only, 0135) held at ORGANIZATION scope in some organization
// (installation-wide administration, the storage-settings rule). Every other role, AUD included, gets 403. The create
// re-checks it on grants reloaded inside its own transaction (commit-time authorization, F-DG2-440).
//
// The request (createMigrationExport), in ONE transaction:
//   1. the transaction lock of class migrationExport (ADVISORY_LOCK_CLASSES, the registry's one class-wide key "migration-export"),
//      so two requests never both pass step 2;
//   2. 422 migration.export_in_progress while any export is queued or running;
//   3. the migration_export row (queued, requested_via api, created_by the caller);
//   4. the audit event migration_export.requested (with the reason) and the internal outbox event
//      migration_export.requested (idempotency key `migration_export.requested:<id>`), which the relay delivers to the
//      worker job transfer.export after COMMIT (no remote I/O in the transaction).
// The same Idempotency-Key with the same body answers 200 with the export's current state.
//
// What leaves through the API: the export row (status, counts, checksums, marker, level) and the two manifests of a
// succeeded export (no row data, no bytes; the attachment manifest lists object names and parent ids for ADM_TECH,
// D-245 O3). The package itself stays in IT-controlled storage. An export approves nothing (no G1-G6, Finance or IT
// approval) and nothing here reads or writes DG0-DG7.
import { readFile } from "node:fs/promises";
import {
  ATTACHMENT_MANIFEST_FILE,
  confinedPath,
  MANIFEST_FILE,
  migrationExportKey,
  transferSha256,
  sql,
  type DbOrTx,
  type MigrationExportTable,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { reason as reasonRule } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, authorize, organizationsWith, refreshPrincipal, type Principal } from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { enqueueOutboxEvent } from "../../jobs/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, isoOrNull, problems } from "../../platform/index.ts";

export const MIGRATION_EXPORT: Permission = "migration.export";
export const MIGRATION_EXPORT_REQUESTED_EVENT = "migration_export.requested";
/** The registry's one class-wide key of migrationExport (ADR-0016 §6). */
export const MIGRATION_EXPORT_LOCK_KEY = "migration-export";

// ------------------------------------------------------------------------------------------------ exact texts (C.5)
export const MIGRATION_EXPORT_TEXTS = {
  inProgress: "A migration export is already queued or running. Wait for it to finish.",
  notReady: "This export has not finished yet.",
  failed: "This export failed. Its manifests are not available.",
} as const;

export const migrationExportRefusals = {
  inProgress: () => problems.businessRule("migration.export_in_progress", MIGRATION_EXPORT_TEXTS.inProgress),
  notReady: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "migration.export_not_ready",
      title: "Conflict",
      detail: MIGRATION_EXPORT_TEXTS.notReady,
    }),
  failed: () => problems.businessRule("migration.export_failed", MIGRATION_EXPORT_TEXTS.failed),
} as const;

// ------------------------------------------------------------------------------------------------ contract mirror
// docs/api/openapi.yaml MigrationExport / MigrationExportPage. Every body is parsed through it before it is sent.
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const timestamp = z.iso.datetime({ offset: true });

export const migrationExportView = z.strictObject({
  id: z.uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  requestedVia: z.enum(["api", "cli"]),
  schemaVersion: z.literal("mth-migration/1"),
  sourceEnvironment: z.enum(["production", "demo", "unmarked"]).nullable(),
  migrationLevel: z
    .string()
    .regex(/^[0-9]{4}_[a-z0-9_]+$/)
    .nullable(),
  tableCount: z.number().int().min(0).nullable(),
  rowCount: count.nullable(),
  attachmentCount: z.number().int().min(0).nullable(),
  attachmentBytes: count.nullable(),
  manifestSha256: sha.nullable(),
  attachmentManifestSha256: sha.nullable(),
  demoChecksum: sha.nullable(),
  failureReason: z.string().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  createdAt: timestamp,
  createdBy: z.uuid().nullable(),
  version: z.number().int().min(1),
});
export type MigrationExportView = z.infer<typeof migrationExportView>;
export const migrationExportPage = z.strictObject({
  items: z.array(migrationExportView),
  nextCursor: z.string().nullable(),
});

export const migrationExportCreate = z.strictObject({ reason: reasonRule });

type ExportRow = Selectable<MigrationExportTable>;

const text = (v: string | number | bigint | null): string | null => (v === null ? null : String(v));

export function presentExport(r: ExportRow): MigrationExportView {
  return migrationExportView.parse({
    id: r.id,
    status: r.status,
    requestedVia: r.requested_via,
    schemaVersion: r.schema_version,
    sourceEnvironment: r.source_environment,
    migrationLevel: r.migration_level,
    tableCount: r.table_count,
    rowCount: text(r.row_count),
    attachmentCount: r.attachment_count,
    attachmentBytes: text(r.attachment_bytes),
    manifestSha256: r.manifest_sha256,
    attachmentManifestSha256: r.attachment_manifest_sha256,
    demoChecksum: r.demo_checksum,
    failureReason: r.failure_reason,
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    version: r.version,
  });
}

// ------------------------------------------------------------------------------------------------ authorization

/**
 * The organization in which the principal holds migration.export at ORGANIZATION scope, or 403. A grant at a narrower
 * scope never admits an installation-wide export.
 */
export async function requireExportRight(db: DbOrTx, principal: Principal): Promise<string> {
  for (const organizationId of organizationsWith(principal, MIGRATION_EXPORT))
    if ((await authorize(db, principal, MIGRATION_EXPORT, { type: "organization", id: organizationId })).allowed)
      return organizationId;
  throw problems.forbidden();
}

// ------------------------------------------------------------------------------------------------ reads

export async function findExport(db: DbOrTx, id: string): Promise<ExportRow | undefined> {
  return db.selectFrom("migration_export").selectAll().where("id", "=", id).executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ the request

/** createMigrationExport's transaction (steps 1-4 above). Returns the queued row. */
export async function requestExport(tx: Tx, request: FastifyRequest, reason: string): Promise<ExportRow> {
  const principal = await refreshPrincipal(tx, request);
  const organizationId = await requireExportRight(tx, principal);
  const userId = principal.userId;
  if (userId === null) throw problems.forbidden();
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.migrationExport}::int, hashtext(${MIGRATION_EXPORT_LOCK_KEY}))`.execute(
    tx,
  );
  const active = await tx
    .selectFrom("migration_export")
    .select("id")
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  if (active !== undefined) throw migrationExportRefusals.inProgress();
  const id = uuidv7();
  await tx
    .insertInto("migration_export")
    .values({ id, requested_via: "api", created_by: userId, updated_by: userId })
    .execute();
  await record(tx, auditContextOf(request), {
    action: "migration_export.requested",
    recordType: "migration_export",
    recordId: id,
    organizationId,
    newVersion: 1,
    reason,
    changes: { status: { from: null, to: "queued" }, requested_via: { from: null, to: "api" } },
  });
  await enqueueOutboxEvent(tx, {
    organizationId,
    aggregateType: "migration_export",
    aggregateId: id,
    eventType: MIGRATION_EXPORT_REQUESTED_EVENT,
    schemaVersion: 1,
    payload: { migrationExportId: id },
    idempotencyKey: `${MIGRATION_EXPORT_REQUESTED_EVENT}:${id}`,
  });
  return (await findExport(tx, id))!;
}

// ------------------------------------------------------------------------------------------------ the manifests

/** Reads one file of a stored package (the filesystem layout of the evidence store: `<root>/<key>`). */
export interface PackageReader {
  read(key: string): Promise<Uint8Array | null>;
}

export function filesystemPackageReader(root: () => string): PackageReader {
  return {
    async read(key) {
      try {
        return new Uint8Array(await readFile(confinedPath(root(), key)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
  };
}

export type ManifestKind = "manifest" | "attachments";

/** The stored bytes of one manifest of a succeeded export, checked against the SHA-256 the row recorded. */
export async function readManifest(
  reader: PackageReader,
  row: ExportRow,
  kind: ManifestKind,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (row.status === "failed") throw migrationExportRefusals.failed();
  if (row.status !== "succeeded") throw migrationExportRefusals.notReady();
  const file = kind === "manifest" ? MANIFEST_FILE : ATTACHMENT_MANIFEST_FILE;
  const expected = kind === "manifest" ? row.manifest_sha256 : row.attachment_manifest_sha256;
  const bytes = await reader.read(migrationExportKey(row.id, file));
  // A succeeded export whose stored manifest is gone or altered is an integrity failure of the store, never served.
  if (bytes === null) throw new Error(`migration export ${row.id}: ${file} is missing from the store`);
  const actual = transferSha256(bytes);
  if (actual !== expected) throw new Error(`migration export ${row.id}: ${file} does not match its recorded SHA-256`);
  return { bytes, sha256: actual };
}
