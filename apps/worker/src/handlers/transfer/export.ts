// transfer.export (P7 slice C; ADR-0064 §7; REQ-S19-014, REQ-S19-016; T-DG7-BE-C): the consumer of the internal
// outbox event `migration_export.requested`. It writes the whole-installation migration package of one export exactly
// once, under the migrationExport advisory lock (730402, key "migration-export"), through the shared recorded run of
// @mth/db (`runRecordedExport`, packages/db/src/transfer/run.ts):
//   claim  queued -> running (or running -> running on a retry after a crash), audit migration_export.started; a
//          succeeded or failed export, or a missing row, is skipped, so a duplicate delivery changes nothing;
//   run    the package (`exportPackage`) outside any transaction, to the evidence store's filesystem root under
//          `transfer/migration-exports/<exportId>/` (the layout of the API's filesystem adapter), which IT copies to the
//          target; evidence bytes are read from the same root and verified against their rows;
//   finish running -> succeeded with counts and checksums (audit migration_export.succeeded) or -> failed with the
//          reason (audit migration_export.failed).
// Service identity job:transfer.export (0147) declares no permission code (ADR-0064 §7, D-245 O4): the job reads every
// exported table as the database role, like a backup; ADR-0053 scoping does not limit it, and nothing here pretends it
// does. An export approves nothing (no G1-G6, Finance or IT approval) and never reads or writes DG0-DG7.
import { join } from "node:path";
import { ENV_VARS } from "@mth/config";
import {
  directorySink,
  filesystemObjectSource,
  MIGRATION_EXPORT_PREFIX,
  runRecordedExport,
  type Db,
  type ObjectSource,
  type PackageSink,
  type RecordedExportOutcome,
} from "@mth/db";
import { migrationExportRequestedV1, outboxEnvelope } from "@mth/shared/schemas";
import { defineJob, jobActor } from "../../kit.ts";
import type { JobAttempt, JobHandler } from "../spec.ts";

export const TRANSFER_EXPORT_QUEUE = "transfer.export";

export interface TransferExportDeps {
  /** The package sink of one export (default: the evidence store root + the export's prefix). */
  readonly sink: (exportId: string) => PackageSink;
  /** Where the evidence bytes are read (default: the evidence store's filesystem root). */
  readonly objects: () => ObjectSource;
  readonly appVersion?: string;
}

/** The evidence store root of the worker's environment (the API's filesystem adapter layout). */
export function evidenceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env["EVIDENCE_STORAGE_PATH"] ?? ENV_VARS.EVIDENCE_STORAGE_PATH.default ?? "/var/lib/mth/evidence";
}

export function storeDeps(root: () => string = () => evidenceRoot()): TransferExportDeps {
  return {
    sink: (exportId) => directorySink(join(root(), MIGRATION_EXPORT_PREFIX, exportId)),
    objects: () => filesystemObjectSource(root()),
  };
}

/** Runs the export of one id as job `jobId`. */
export function runMigrationExport(
  db: Db,
  exportId: string,
  jobId: string,
  deps: TransferExportDeps,
  attempt?: JobAttempt,
): Promise<RecordedExportOutcome> {
  return runRecordedExport(db, exportId, {
    actor: jobActor(jobId),
    sink: deps.sink(exportId),
    objects: deps.objects(),
    attempt: (attempt?.retryCount ?? 0) + 1,
    ...(deps.appVersion !== undefined ? { appVersion: deps.appVersion } : {}),
  });
}

/** The handler: parses the outbox envelope and runs the export of its id. */
export function transferExportHandler(deps: TransferExportDeps = storeDeps()): JobHandler {
  return defineJob({
    queue: TRANSFER_EXPORT_QUEUE,
    handle: async (db, data, jobId, attempt) => {
      const envelope = outboxEnvelope.parse(data);
      const payload = migrationExportRequestedV1.parse(envelope.payload);
      return runMigrationExport(db, payload.migrationExportId, jobId, deps, attempt);
    },
  });
}
