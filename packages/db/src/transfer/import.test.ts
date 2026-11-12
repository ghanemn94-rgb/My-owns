// Unit tests of the import's package checks (ADR-0064 §6 step 1; p7-work-split §C.5; T-DG7-BE-D) on SYNTHETIC packages
// written to a temporary directory. The target checks run on PostgreSQL in
// packages/db/test/integration/transfer-roundtrip.test.ts (T-C10).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { transferSha256 } from "./export.ts";
import { checkPackage, ImportRefused } from "./import.ts";
import {
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  canonicalAttachmentManifest,
  canonicalManifest,
  MANIFEST_SCHEMA_VERSION,
} from "./manifest.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const EXPORT_ID = "01920000-0000-7000-8000-0000000000aa";
const LINE = '{"id":"01920000-0000-7000-8000-000000000001","code":"SYN"}\n';

/** A one-table SYNTHETIC package; returns its directory and the manifest's SHA-256. */
function writePackage(): { dir: string; manifestSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "mth-import-unit-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tables"));
  writeFileSync(join(dir, "tables/organization.ndjson"), LINE);
  const attachments = canonicalAttachmentManifest({
    schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION,
    exportId: EXPORT_ID,
    items: [],
  });
  writeFileSync(join(dir, "attachments.json"), attachments);
  const manifest = canonicalManifest({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportId: EXPORT_ID,
    sourceEnvironment: "unmarked",
    demoChecksum: null,
    migrationLevel: "0148_p7_retention_job",
    createdAt: "2026-11-12T00:00:00.000Z",
    appVersion: "0.1.0",
    tables: [
      {
        name: "organization",
        file: "tables/organization.ndjson",
        loadPhase: 1,
        rowCount: "1",
        fileSha256: transferSha256(LINE),
        contentDigest: transferSha256(LINE),
        columns: ["id", "code"],
        deferredColumns: [],
      },
    ],
    excludedTables: [],
    rewrittenColumns: [],
    attachmentManifest: { file: "attachments.json", sha256: transferSha256(attachments), count: 0, bytes: "0" },
    totals: { tables: 1, rows: "1" },
  });
  writeFileSync(join(dir, "manifest.json"), manifest);
  return { dir, manifestSha: transferSha256(manifest) };
}

async function refusal(p: Promise<unknown>): Promise<{ code: number; line: string }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ImportRefused) return { code: err.exitCode, line: err.message };
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("checkPackage (step 1)", () => {
  it("accepts an intact package, with and without --manifest-sha256", async () => {
    const { dir, manifestSha } = writePackage();
    expect((await checkPackage(dir)).manifestSha256).toBe(manifestSha);
    expect((await checkPackage(dir, manifestSha.toUpperCase())).manifest.tables).toHaveLength(1);
  });
  it("refuses another schema version (exit 2, C.5 line)", async () => {
    const { dir } = writePackage();
    writeFileSync(join(dir, "manifest.json"), '{"schemaVersion":"mth-migration/2"}\n');
    expect(await refusal(checkPackage(dir))).toEqual({
      code: 2,
      line: "import-migration: refused: unsupported manifest schema version 'mth-migration/2'",
    });
  });
  it("refuses a changed table file, attachment manifest or manifest (exit 2, naming the file)", async () => {
    const a = writePackage();
    writeFileSync(join(a.dir, "tables/organization.ndjson"), LINE.replace("SYN", "SYX"));
    expect(await refusal(checkPackage(a.dir))).toEqual({
      code: 2,
      line: "import-migration: refused: checksum mismatch for tables/organization.ndjson",
    });
    const b = writePackage();
    writeFileSync(join(b.dir, "attachments.json"), "{}\n");
    expect((await refusal(checkPackage(b.dir))).line).toBe(
      "import-migration: refused: checksum mismatch for attachments.json",
    );
    const c = writePackage();
    expect((await refusal(checkPackage(c.dir, "0".repeat(64)))).line).toBe(
      "import-migration: refused: checksum mismatch for manifest.json",
    );
    rmSync(join(c.dir, "tables/organization.ndjson"));
    expect((await refusal(checkPackage(c.dir))).line).toBe(
      "import-migration: refused: checksum mismatch for tables/organization.ndjson",
    );
  });
});
