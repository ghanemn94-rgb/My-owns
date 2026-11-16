// `mth-db export-migration --out <dir> --operator <name>` (ADR-0064 §7; p7-work-split §C.1, §C.5; T-DG7-BE-C): writes
// the same package as the worker job to a directory, recording a migration_export row with requested_via cli and an
// audit event per transition (actor system, source cli). Exit codes (p7-work-split §2 rule 4): 0 written; 1
// `export-migration: failed: <reason>`; 2 a usage error or an unusable --out (missing operator, non-empty directory).
// Evidence bytes are read from EVIDENCE_STORAGE_PATH (the filesystem store root). The package holds no session, token
// or secret value (ADR-0064 §3, §4). Nothing here approves anything, and nothing reads or writes DG0-DG7.
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Db } from "../pool.ts";
import { directorySink, ExportFailed, filesystemObjectSource } from "./export.ts";
import { requestCliExport, runRecordedExport } from "./run.ts";

export interface ExportCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ExportCliOptions {
  readonly out: string | undefined;
  readonly operator: string | undefined;
  readonly evidenceRoot: string;
}

const OPERATOR = /^[\p{L}\p{N} ._@-]{1,100}$/u;

/** Runs the command; returns its exit code. */
export async function runExportMigrationCommand(db: Db, opts: ExportCliOptions, io: ExportCliIo): Promise<number> {
  if (opts.out === undefined || opts.out === "" || opts.operator === undefined || !OPERATOR.test(opts.operator)) {
    io.err("BLOCKED: usage: mth-db export-migration --out <dir> --operator <name>");
    return 2;
  }
  const dir = resolve(opts.out);
  const existing = await readdir(dir).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? [] : null));
  if (existing === null || existing.length > 0) {
    io.err(`BLOCKED: export-migration: --out ${dir} must be an empty or new directory`);
    return 2;
  }
  let exportId: string;
  try {
    exportId = await requestCliExport(db, opts.operator);
  } catch (err) {
    io.err(`export-migration: failed: ${err instanceof ExportFailed ? err.message : String(err)}`);
    return 1;
  }
  const outcome = await runRecordedExport(db, exportId, {
    actor: { actorType: "system", actorUserId: null, source: "cli" },
    sink: directorySink(dir),
    objects: filesystemObjectSource(opts.evidenceRoot),
  });
  if (outcome.outcome === "succeeded") {
    const r = outcome.result;
    io.out(
      `export-migration: wrote export ${exportId} (${r.sourceEnvironment}, ${r.migrationLevel}): ${r.tableCount} tables, ` +
        `${r.rowCount} rows, ${r.attachmentCount} attachments to ${dir}; manifest sha256 ${r.manifestSha256}`,
    );
    return 0;
  }
  io.err(
    `export-migration: failed: ${outcome.outcome === "failed" ? outcome.reason : `the export ended ${outcome.status ?? "missing"}`}`,
  );
  return 1;
}
