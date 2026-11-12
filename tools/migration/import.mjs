#!/usr/bin/env node
// tools/migration/import.mjs (P7 slice C; ADR-0064 §6; p7-work-split §C.2, §C.5, §2 rule 4; T-DG7-BE-D): the import in
// the ADR's order, over a package directory:
//   1. the attachment copy-in (`transfer-attachments copy-in --from <dir>`, T-DG7-BE-E) when the package lists
//      attachments; when that CLI is not installed yet and the package has attachments: exit 3 BLOCKED;
//   2. `mth-db import-migration --from <dir> --operator <name> [--manifest-sha256 <hex>]` (package checks, target checks,
//      the load), whose exit code and lines are passed through as p7-work-split §C.5 defines them: 0 imported, 1 failed,
//      2 refused (package or target), 3 refused (target not empty) or BLOCKED (no installed workspace), 4 mismatch.
// It runs the source CLIs under the `@mth/source` condition when the workspace has them (the export.mjs precedent),
// else the built ones, with the caller's environment (DATABASE_OWNER_URL, EVIDENCE_STORAGE_PATH).
// NOTE (handback T-DG7-BE-D Q1): mth-db import-migration does not load yet; it refuses a migrated target as not empty.
// It writes nothing itself and never reads or writes a delivery record; an import approves nothing.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    options: { from: { type: "string" }, operator: { type: "string" }, "manifest-sha256": { type: "string" } },
    strict: true,
  }));
} catch {
  values = {};
}
if (values.from === undefined || values.operator === undefined) {
  console.error(
    "BLOCKED: usage: node tools/migration/import.mjs --from <dir> --operator <name> [--manifest-sha256 <hex>]",
  );
  process.exit(2);
}

const db = cli("packages/db/src/cli.ts", "packages/db/dist/cli.js");
if (db === null) {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

// 1. Attachments in (only when the package lists any).
let count = 0;
try {
  count = JSON.parse(readFileSync(join(values.from, "manifest.json"), "utf8")).attachmentManifest?.count ?? 0;
} catch {
  count = 0; // mth-db import-migration reports the unreadable manifest with its C.5 line below.
}
if (count > 0) {
  const attachments = cli("apps/api/src/cli/transfer-attachments.ts", "apps/api/dist/cli/transfer-attachments.js");
  if (attachments === null) {
    console.error("BLOCKED: the attachment copy (transfer-attachments, T-DG7-BE-E) is not installed");
    process.exit(3);
  }
  const copy = spawnSync(process.execPath, [...attachments, "copy-in", "--from", values.from], { stdio: "inherit" });
  if (copy.status !== 0) {
    console.error(`import-migration: refused: the attachment copy-in exited ${copy.status ?? copy.signal}`);
    process.exit(2);
  }
}

// 2. The database import.
const extra = values["manifest-sha256"] === undefined ? [] : ["--manifest-sha256", values["manifest-sha256"]];
const run = spawnSync(
  process.execPath,
  [...db, "import-migration", "--from", values.from, "--operator", values.operator, ...extra],
  { stdio: "inherit" },
);
if (run.error !== undefined || run.status === null) {
  console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
  process.exit(3);
}
process.exit(run.status === 64 ? 2 : run.status);
