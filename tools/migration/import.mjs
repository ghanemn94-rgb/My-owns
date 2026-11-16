#!/usr/bin/env node
// tools/migration/import.mjs (P7 slice C; ADR-0064 §6 with Amendment 1 §A1.4, §A1.8; p7-work-split §C.2, §C.5,
// §C.12, §C.13, §2 rule 4; T-DG7-BE-D, T-DG7-BE-R2): the import in the ADR's order, over a package directory:
//   1. the package's attachment count is read from manifest.json (mth-db import-migration re-checks the whole package
//      itself, step 1, before it touches the target);
//   2. when the package lists attachments: `transfer-attachments copy-in --from <dir>` (T-DG7-BE-E), then
//      `transfer-attachments verify --from <dir> --out <tmp>` (A1.8); when that CLI is not installed: exit 3 BLOCKED;
//   3. `mth-db import-migration --from <dir> --operator <name> [--manifest-sha256 <hex>] [--attachments-report <tmp>]
//      [--report <file>]`, whose exit code and lines are passed through (C.5): 0 imported, 1 failed, 2 refused,
//      3 refused (not empty) or BLOCKED, 4 mismatch.
// The verify report is a temporary file, deleted on success and on failure, unless `--keep-reports <dir>` is given:
// then it is copied there as attachments-verify.json first.
// It runs the source CLIs under the `@mth/source` condition when the workspace has them (the export.mjs precedent),
// else the built ones, with the caller's environment (DATABASE_OWNER_URL, EVIDENCE_STORAGE_PATH). It never reads or
// writes a delivery record; an import approves nothing.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function cli(sourcePath, builtPath) {
  if (existsSync(`${root}${sourcePath}`)) return ["--conditions=@mth/source", `${root}${sourcePath}`];
  if (existsSync(`${root}${builtPath}`)) return [`${root}${builtPath}`];
  return null;
}

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      from: { type: "string" },
      operator: { type: "string" },
      "manifest-sha256": { type: "string" },
      report: { type: "string" },
      "keep-reports": { type: "string" },
    },
    strict: true,
  }));
} catch {
  values = {};
}
if (values.from === undefined || values.operator === undefined) {
  console.error(
    "BLOCKED: usage: node tools/migration/import.mjs --from <dir> --operator <name> [--manifest-sha256 <hex>] " +
      "[--report <file>] [--keep-reports <dir>]",
  );
  process.exit(2);
}

const db = cli("packages/db/src/cli.ts", "packages/db/dist/cli.js");
if (db === null) {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

// 1. The attachment count.
let count = 0;
try {
  count = JSON.parse(readFileSync(join(values.from, "manifest.json"), "utf8")).attachmentManifest?.count ?? 0;
} catch {
  count = 0; // mth-db import-migration reports the unreadable manifest with its C.5 line below.
}

const scratch = mkdtempSync(join(tmpdir(), "mth-import-"));
let status = 1;
try {
  status = importWith(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(status);

function importWith(dir) {
  const extra = [];
  // 2. Attachments in, then verified (only when the package lists any).
  if (count > 0) {
    const attachments = cli("apps/api/src/cli/transfer-attachments.ts", "apps/api/dist/cli/transfer-attachments.js");
    if (attachments === null) {
      console.error("BLOCKED: the attachment copy (transfer-attachments, T-DG7-BE-E) is not installed");
      return 3;
    }
    const copy = spawnSync(process.execPath, [...attachments, "copy-in", "--from", values.from], { stdio: "inherit" });
    if (copy.status !== 0) {
      console.error(`import-migration: refused: the attachment copy-in exited ${copy.status ?? copy.signal}`);
      return 2;
    }
    const report = join(dir, "attachments-verify.json");
    const verify = spawnSync(process.execPath, [...attachments, "verify", "--from", values.from, "--out", report], {
      stdio: "inherit",
    });
    if (values["keep-reports"] !== undefined && existsSync(report)) {
      mkdirSync(values["keep-reports"], { recursive: true });
      copyFileSync(report, join(values["keep-reports"], "attachments-verify.json"));
    }
    if (!existsSync(report)) {
      console.error(`import-migration: refused: transfer-attachments verify exited ${verify.status ?? verify.signal}`);
      return 2;
    }
    extra.push("--attachments-report", report);
  }
  // 3. The database import.
  if (values["manifest-sha256"] !== undefined) extra.push("--manifest-sha256", values["manifest-sha256"]);
  if (values.report !== undefined) extra.push("--report", values.report);
  const run = spawnSync(
    process.execPath,
    [...db, "import-migration", "--from", values.from, "--operator", values.operator, ...extra],
    { stdio: "inherit" },
  );
  if (run.error !== undefined || run.status === null) {
    console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
    return 3;
  }
  return run.status === 64 ? 2 : run.status;
}
