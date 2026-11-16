#!/usr/bin/env node
// tools/migration/export.mjs (P7 slice C; ADR-0064 §7; p7-work-split §C.1, §2 rule 4; T-DG7-BE-C): a thin wrapper over
// `mth-db export-migration --out <dir> --operator <name>`. It runs the source CLI under the `@mth/source` condition
// when the workspace has it (a checkout's dist/ may be older than its sources), else the built CLI
// (packages/db/dist/cli.js), with the caller's environment (DATABASE_OWNER_URL, EVIDENCE_STORAGE_PATH). Exit codes: 0 PASS (package written), 1 FAIL (`export-migration: failed: <reason>`),
// 2 BLOCKED (usage or an unusable --out), 3 BLOCKED (no installed workspace: neither CLI can be found or started).
// It writes nothing itself and never reads or writes a delivery record; an export approves nothing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const built = `${root}packages/db/dist/cli.js`;
const source = `${root}packages/db/src/cli.ts`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.error("BLOCKED: usage: node tools/migration/export.mjs --out <dir> --operator <name>");
  process.exit(2);
}

let argv;
if (existsSync(source)) argv = ["--conditions=@mth/source", source];
else if (existsSync(built)) argv = [built];
else {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

const run = spawnSync(process.execPath, [...argv, "export-migration", ...args], { stdio: "inherit" });
if (run.error !== undefined || run.status === null) {
  console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
  process.exit(3);
}
// mth-db's own usage exit (64) is a usage error here.
process.exit(run.status === 0 ? 0 : run.status === 2 || run.status === 64 ? 2 : 1);
