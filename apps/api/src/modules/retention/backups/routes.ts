// Administration > Backups: the read-only status of the backup sets the backup job reported (P7 slice E; ADR-0066 §6;
// REQ-S19-012, "view:IT"; D-248 O2). Route file created as a stub by T-DG7-BE-A; filled by T-DG7-BE-G (p7-work-split
// §E.1):
//   GET /admin/backups   listBackupSets (backup.read; ADM_TECH, AUD), newest first.
// Backups and restores run outside the API (deploy/scripts/backup.sh, restore.sh; IT-run): no route starts one. Only
// the recorded status, checksums and counts leave; no content of a backup and no location of a credential.
import type { BackupSetRow } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import { iso, keysetPage, pageQueryFields, parseQuery, type ModuleDeps, type SortKey } from "../../platform/index.ts";
import { requireRetentionRight } from "../classes/service.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of the backup-status operation (docs/api/openapi.yaml, tag `retention`; ADR-0066 §6). */
export const BACKUP_ROUTE_GUARDS = {
  listBackupSets: { method: "GET", path: "/api/v1/admin/backups", permission: "backup.read" },
} as const satisfies Record<string, P7RouteGuard>;

// docs/api/openapi.yaml BackupSet / BackupSetPage.
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const timestamp = z.iso.datetime({ offset: true });
export const backupSetView = z.strictObject({
  id: z.uuid(),
  label: z.string(),
  status: z.enum(["succeeded", "failed"]),
  manifestSchemaVersion: z.literal("mth-backup/1"),
  startedAt: timestamp,
  finishedAt: timestamp,
  migrationLevel: z
    .string()
    .regex(/^[0-9]{4}_[a-z0-9_]+$/)
    .nullable(),
  serverMajor: z.number().int().min(16).nullable(),
  dumpFormat: z.literal("custom").nullable(),
  dumpBytes: count.nullable(),
  dumpSha256: sha.nullable(),
  evidenceBackend: z.enum(["filesystem", "s3"]).nullable(),
  evidenceObjectCount: z.number().int().min(0).nullable(),
  evidenceBytes: count.nullable(),
  attachmentManifestSha256: sha.nullable(),
  configBundleSha256: sha.nullable(),
  manifestSha256: sha.nullable(),
  failureReason: z.string().nullable(),
  operatorName: z.string(),
  recordedAt: timestamp,
});
export const backupSetPage = z.strictObject({ items: z.array(backupSetView), nextCursor: z.string().nullable() });

const text = (v: string | number | bigint | null): string | null => (v === null ? null : String(v));

export function presentBackupSet(r: BackupSetRow): z.infer<typeof backupSetView> {
  return backupSetView.parse({
    id: r.id,
    label: r.label,
    status: r.status,
    manifestSchemaVersion: r.manifest_schema_version,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    migrationLevel: r.migration_level,
    serverMajor: r.server_major,
    dumpFormat: r.dump_format,
    dumpBytes: text(r.dump_bytes),
    dumpSha256: r.dump_sha256,
    evidenceBackend: r.evidence_backend,
    evidenceObjectCount: r.evidence_object_count,
    evidenceBytes: text(r.evidence_bytes),
    attachmentManifestSha256: r.attachment_manifest_sha256,
    configBundleSha256: r.config_bundle_sha256,
    manifestSha256: r.manifest_sha256,
    failureReason: r.failure_reason,
    operatorName: r.operator_name,
    recordedAt: iso(r.recorded_at),
  });
}

const listQuery = z.strictObject({ ...pageQueryFields });
/** Newest first (the 0145 index backup_set_finished_idx), id as the tiebreak. */
const BACKUP_SORT: readonly SortKey[] = [
  { name: "finished_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerBackupRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  app.get(
    BACKUP_ROUTE_GUARDS.listBackupSets.path,
    { config: { access: { permission: "backup.read" as const } } },
    async (request) => {
      const query = parseQuery(listQuery, request.query);
      await requireRetentionRight(deps.db, principalOf(request), "backup.read");
      const page = await keysetPage(deps.db.selectFrom("backup_set").selectAll(), BACKUP_SORT, query, {
        list: "backup-sets",
      });
      return backupSetPage.parse({ items: page.items.map(presentBackupSet), nextCursor: page.nextCursor });
    },
  );
  return Object.values(BACKUP_ROUTE_GUARDS).map((g) => `${g.method} ${g.path}`);
}
