#!/usr/bin/env node
// tools/migration/reconcile.mjs (P7 slice C; ADR-0064 §6; p7-work-split §C.2, §C.5, §2 rule 4; T-DG7-BE-D): a thin
// wrapper over `mth-db reconcile-migration --operator <name>` (the re-check of the recorded import). Exit codes passed
// through: 0 `reconcile-migration: matched`, 4 `reconcile-migration: mismatch: <n> tables, <m> attachments differ`,
// 2 BLOCKED (usage, or no import recorded), 3 BLOCKED (no installed workspace), 1 any other failure.
// It writes nothing itself and never reads or writes a delivery record; a reconciliation approves nothing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const built = `${root}packages/db/dist/cli.js`;
const source = `${root}packages/db/src/cli.ts`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.error("BLOCKED: usage: node tools/migration/reconcile.mjs --operator <name>");
  process.exit(2);
}

let argv;
if (existsSync(source)) argv = ["--conditions=@mth/source", source];
else if (existsSync(built)) argv = [built];
else {
  console.error("BLOCKED: no installed workspace: neither packages/db/dist/cli.js nor packages/db/src/cli.ts exists");
  process.exit(3);
}

const run = spawnSync(process.execPath, [...argv, "reconcile-migration", ...args], { stdio: "inherit" });
if (run.error !== undefined || run.status === null) {
  console.error(`BLOCKED: mth-db could not be started: ${run.error?.message ?? `signal ${run.signal}`}`);
  process.exit(3);
}
process.exit([0, 2, 4].includes(run.status) ? run.status : run.status === 64 ? 2 : 1);
