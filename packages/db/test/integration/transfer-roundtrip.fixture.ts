// The round-trip helpers of slice C (p7-work-split §C.2, §C.4; T-DG7-BE-D), shared with KBE-A's financial parity test
// (T-C17): a scratch source seeded with the SYNTHETIC demo dataset, its package written by the export's own encoder to a
// temporary directory, and a freshly migrated scratch target. Every value is synthetic; a demo package is labelled
// synthetic (sourceEnvironment demo). Nothing here approves anything (no G1-G6, Finance or IT approval) or touches
// DG0-DG7.
//
// The import itself (ADR-0064 §6 steps 5-7, 9) is NOT available: see packages/db/src/transfer/import.ts and the
// T-DG7-BE-D handback, open question Q1. `importInto` therefore reports the command's exit code and lines, and the
// round-trip assertions that need a loaded target wait for the architect's decision.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { seedDemo } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import {
  directorySink,
  exportPackage,
  filesystemObjectSource,
  runImportMigrationCommand,
  type ExportResult,
} from "../../src/transfer/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../helpers.ts";

/** The release both sides claim in these tests (the target check compares it with the manifest's appVersion). */
export const ROUNDTRIP_APP_VERSION = "0.1.0-roundtrip";

export interface RoundtripScratch {
  readonly ownerUrl: string;
  readonly db: Db;
}

/** Owns every scratch database, directory and pool it hands out; `close()` removes them all. */
export class RoundtripWorkspace {
  readonly #adminUrl: string;
  readonly #databases: string[] = [];
  readonly #dirs: string[] = [];
  readonly #handles: Db[] = [];

  constructor(adminUrl: string) {
    this.#adminUrl = adminUrl;
  }

  /** A freshly migrated scratch database (the import's target shape). */
  async migrated(prefix: string): Promise<RoundtripScratch> {
    const name = await createScratchDatabase(this.#adminUrl, prefix);
    this.#databases.push(name);
    const ownerUrl = roleUrl(this.#adminUrl, name, "mth_owner");
    await migrate(ownerUrl);
    const db = createDb(createPool(ownerUrl, { max: 3 }));
    this.#handles.push(db);
    return { ownerUrl, db };
  }

  /** A migrated scratch database seeded with the SYNTHETIC demo dataset (ADR-0050). */
  async demoSource(prefix: string): Promise<RoundtripScratch> {
    const s = await this.migrated(prefix);
    await seedDemo(s.ownerUrl, {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      devIssuerBinding: false,
    });
    return s;
  }

  tempDir(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    this.#dirs.push(d);
    return d;
  }

  /** A copy of a package directory (to tamper with one file). */
  copyPackage(dir: string): string {
    const copy = this.tempDir("mth-roundtrip-copy-");
    cpSync(dir, copy, { recursive: true });
    return copy;
  }

  /** Writes `db`'s package to a new directory with the export's own encoder. */
  async exportPackage(db: Db): Promise<{ dir: string; result: ExportResult }> {
    const dir = this.tempDir("mth-roundtrip-package-");
    const result = await exportPackage(db, directorySink(dir), {
      exportId: uuidv7(),
      objects: filesystemObjectSource(this.tempDir("mth-roundtrip-store-")),
      appVersion: ROUNDTRIP_APP_VERSION,
    });
    return { dir, result };
  }

  async close(): Promise<void> {
    for (const db of this.#handles) await db.destroy();
    for (const d of this.#dirs) rmSync(d, { recursive: true, force: true });
    for (const name of this.#databases.reverse()) await dropScratchDatabase(this.#adminUrl, name);
  }
}

/** Runs `mth-db import-migration`'s body; returns its exit code and the lines it printed. */
export async function importInto(
  target: Db,
  dir: string,
  opts: { readonly appVersion?: string; readonly manifestSha256?: string } = {},
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runImportMigrationCommand(
    target,
    {
      from: dir,
      operator: "Synthetic IT operator",
      manifestSha256: opts.manifestSha256,
      appVersion: opts.appVersion ?? ROUNDTRIP_APP_VERSION,
    },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  return { code, out, err };
}
