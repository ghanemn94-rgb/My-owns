#!/usr/bin/env node
// The rate-limit budgets a load stack runs with (T-DG6-DO-Y2; D-207; BE-Y4 handback item 1).
//
//   eval "$(node deploy/load/rate-limits.mjs)"      # before starting the API and the worker of a load stack
//
// A load run must measure the product, not the limiter. The P6 rate-limit classes (ADR-0052 §4) have production
// budgets far below what a load driver sends from one session: export-proof.mjs part A starts 16 exports from one user
// within a minute, and the `export` class allows 10 per minute per session by default. With the product default, starts
// 11-16 get 429, and the result says nothing about the export start itself (F-DG6-141, F-DG6-147).
//
// So, for a load stack only, each of the five P6 class budgets is raised to LOAD_RATE_LIMIT_PER_MINUTE unless the
// operator set it explicitly (an explicit value always wins, so a run can measure the limiter on purpose). The variable
// names are the API's own (`RATE_LIMIT_CLASS_VARIABLES` in packages/config/src/load.ts); a unit test pins the two lists
// together (deploy/scripts/tests/load-rate-limits.vitest.mjs).
//
// Not raised: the global `RATE_LIMIT_PER_MINUTE` (300) and `AUTH_RATE_LIMIT_PER_MINUTE` (20). They are not P6 classes,
// every measured load run (DO-F, DO-G, DO-H, QA round 1) ran with them at the product default and received no 429, and
// keeping them keeps today's figures comparable with those runs. The load drivers count any 429 as a failure, never as
// a success (workload.mjs "error"; export-proof.mjs a failed start), so a limiter that decides a result is visible.
//
// Never use this for a production or demo stack: it disables the abuse protection of those classes. The stdout of the
// CLI is shell `export` lines only (for eval); the note about which values were kept goes to stderr. No secret is read
// or printed. Synthetic load runs only; nothing here approves anything.
import { pathToFileURL } from "node:url";

/** The budget each P6 class gets on a load stack: high enough that no load driver reaches it (config maximum 1e6). */
export const LOAD_RATE_LIMIT_PER_MINUTE = 100000;

/** The P6 class budget variables, in the order of `RATE_LIMIT_CLASS_VARIABLES` (packages/config/src/load.ts). */
export const LOAD_RATE_LIMIT_VARIABLES = Object.freeze([
  "UPLOAD_RATE_LIMIT_PER_MINUTE",
  "SEARCH_RATE_LIMIT_PER_MINUTE",
  "ASSISTANT_RATE_LIMIT_PER_MINUTE",
  "WEBHOOK_RATE_LIMIT_PER_MINUTE",
  "EXPORT_RATE_LIMIT_PER_MINUTE",
]);

const isSet = (env, name) => {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  return (direct !== undefined && direct !== "") || (file !== undefined && file !== "");
};

/**
 * The variables to set for a load stack: each P6 class budget that the environment does not already set (directly or
 * through `<NAME>_FILE`, as the API's configuration reads it), mapped to LOAD_RATE_LIMIT_PER_MINUTE. `kept` lists the
 * explicit ones left as they are.
 */
export function loadRateLimitEnv(env = process.env) {
  const set = {};
  const kept = [];
  for (const name of LOAD_RATE_LIMIT_VARIABLES) {
    if (isSet(env, name)) kept.push(name);
    else set[name] = String(LOAD_RATE_LIMIT_PER_MINUTE);
  }
  return { set, kept };
}

/** Shell `export` lines for `eval` (names and values are fixed ASCII; nothing from the environment is echoed). */
export function shellExports(set) {
  return Object.entries(set)
    .map(([name, value]) => `export ${name}=${value}`)
    .join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { set, kept } = loadRateLimitEnv();
  if (Object.keys(set).length > 0) process.stdout.write(`${shellExports(set)}\n`);
  process.stderr.write(
    `mth-load rate limits: ${Object.keys(set).length} P6 class budget(s) set to ${LOAD_RATE_LIMIT_PER_MINUTE}/min` +
      (kept.length > 0 ? `; kept as set: ${kept.join(", ")}` : "") +
      " (load stacks only; global and auth limits unchanged)\n",
  );
}
