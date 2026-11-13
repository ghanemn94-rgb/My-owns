#!/usr/bin/env node
// tools/migration/reconcile.mjs (P7 slice C; ADR-0064 §6 with Amendment 1 §A1.8, §A1.9 and Amendment 2 §A2.6;
// p7-work-split §C.2, §C.5, §C.12, §C.13, §2 rule 4; T-DG7-BE-D, T-DG7-BE-R2): a thin wrapper over
// `mth-db reconcile-migration --operator <name> [--attachments-report <file>] [--after-use --from <dir> --allow <file>]
// [--report <file>]` (the re-check of the recorded import).
//   --from <dir>          the package directory. When its manifest lists attachments, `transfer-attachments verify
//                         --from <dir> --out <tmp>` runs first and its report is passed as --attachments-report (A1.8:
//                         a recheck never counts 0 checked attachments for a package that has some). With --after-use,
//                         --from is also passed to mth-db, which re-checks the package (§6 step 1).
//   --after-use --allow   mode 2 (run_kind recheck_after_use) with the allowance mth-recheck-allowance/2.
//   --keep-reports <dir>  keeps the verify report there (attachments-verify.json); otherwise it is deleted, on success
//                         and on failure.
// Exit codes passed through: 0 matched, 4 mismatch, 2 refused or BLOCKED (usage, no import recorded), 3 BLOCKED (no
// installed workspace), 1 any other failure. It never reads or writes a delivery record; a recheck approves nothing.
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
      operator: { type: "string" },
      from: { type: "string" },
      "after-use": { type: "boolean" },
      allow: { type: "string" },
      report: { type: "string" },
      "keep-reports": { type: "string" },
    },
    strict: true,
  }));
} catch {
  values = {};
}
if (values.operator === undefined) {
  console.error(
    "BLOCKED: usage: node tools/migration/reconcile.mjs --operator <name> [--from <dir>] " +
      "[--after-use --allow <file>] [--report <file>] [--keep-reports <dir>]",
  );
  process.exit(2);
}

const db = cli("packages/db/src/cli.ts", "packages/db/dist/cli.js");
if (db === null) {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

let count = 0;
if (values.from !== undefined) {
  try {
    count = JSON.parse(readFileSync(join(values.from, "manifest.json"), "utf8")).attachmentManifest?.count ?? 0;
  } catch {
    count = 0; // mth-db reports an unreadable package (mode 2) or a missing report (A1.8) itself.
  }
}

const scratch = mkdtempSync(join(tmpdir(), "mth-reconcile-"));
let status = 1;
try {
  status = reconcileWith(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(status);

function reconcileWith(dir) {
  const extra = [];
  if (count > 0) {
    const attachments = cli("apps/api/src/cli/transfer-attachments.ts", "apps/api/dist/cli/transfer-attachments.js");
    if (attachments === null) {
      console.error("BLOCKED: the attachment verify (transfer-attachments, T-DG7-BE-E) is not installed");
      return 3;
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
      console.error(
        `reconcile-migration: refused: transfer-attachments verify exited ${verify.status ?? verify.signal}`,
      );
      return 2;
    }
    extra.push("--attachments-report", report);
  }
  if (values["after-use"] === true) {
    extra.push("--after-use");
    if (values.from !== undefined) extra.push("--from", values.from);
    if (values.allow !== undefined) extra.push("--allow", values.allow);
  }
  if (values.report !== undefined) extra.push("--report", values.report);
  const run = spawnSync(process.execPath, [...db, "reconcile-migration", "--operator", values.operator, ...extra], {
    stdio: "inherit",
  });
  if (run.error !== undefined || run.status === null) {
    console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
    return 3;
  }
  return [0, 2, 4].includes(run.status) ? run.status : run.status === 64 ? 2 : 1;
}
