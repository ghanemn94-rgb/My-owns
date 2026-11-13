#!/usr/bin/env node
// tools/migration/prepare-target.mjs (P7 slice C; ADR-0064 Amendment 1 §A1.2 item 7; p7-work-split §C.12, §C.13, §2
// rule 4; T-DG7-BE-R2): a thin wrapper over `mth-db migrate --reserve-audit-seq-for <dir>`, which migrates an EMPTY
// target database with its audit sequence started above the package's highest audit seq. The child's lines are passed
// through unchanged. Exit codes: 0 PASS (prepared), 1 FAIL (a migration failed), 2 BLOCKED (usage, or the child's
// refusal), 3 BLOCKED (no installed workspace, or mth-db could not be started).
// It runs as the caller's environment says (DATABASE_OWNER_URL), writes nothing itself and never reads or writes a
// delivery record. Preparing a target approves nothing (no G1-G6, Finance or IT approval).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

let values = {};
try {
  ({ values } = parseArgs({ args: process.argv.slice(2), options: { from: { type: "string" } }, strict: true }));
} catch {
  values = {};
}
if (values.from === undefined || values.from === "") {
  console.error("prepare-target: refused: --from <dir> is required");
  process.exit(2);
}

let argv;
if (existsSync(`${root}packages/db/src/cli.ts`)) argv = ["--conditions=@mth/source", `${root}packages/db/src/cli.ts`];
else if (existsSync(`${root}packages/db/dist/cli.js`)) argv = [`${root}packages/db/dist/cli.js`];
else {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

const run = spawnSync(process.execPath, [...argv, "migrate", "--reserve-audit-seq-for", values.from], {
  stdio: "inherit",
});
if (run.error !== undefined || run.status === null) {
  console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
  process.exit(3);
}
process.exit([0, 1, 2, 3].includes(run.status) ? run.status : run.status === 64 ? 2 : 1);
