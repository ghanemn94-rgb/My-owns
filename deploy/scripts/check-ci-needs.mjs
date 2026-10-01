#!/usr/bin/env node
// Static check of the product CI workflow (REQ-DLV-025, ADR-0013):
//   - the first job is `delivery-gates` and it runs `node tools/gates/validate.mjs --pipeline`;
//   - every other job depends on `delivery-gates`, directly or transitively through `needs:` (so a failed or
//     unapproved gate skips every product build, test, image and push job);
//   - every product job is TRULY gated on delivery-gates SUCCESS (F-DG1-107): GitHub Actions runs a job only when all
//     its `needs` succeeded UNLESS its job-level `if:` uses a status-check function — always(), failure(), cancelled()
//     (incl. `!cancelled()`) replace the implicit success() and run the job after delivery-gates FAILED. Any such `if:`
//     on a product job is a violation (success() is allowed; it is the default). Also rejected, because each would let a
//     failed gate count as success: `continue-on-error` on the delivery-gates job or its validate step, an `if:` on that
//     step, and a validate command that is anything but exactly `node tools/gates/validate.mjs --pipeline`
//     (e.g. `... || true`);
//   - the gate's execution context cannot be altered (F-DG1-116): a workflow-level `defaults:` or `env:` block is
//     rejected (it reaches the validate step: `defaults.run.shell`/`working-directory`, `NODE_OPTIONS`, PATH...); the
//     delivery-gates job may only carry the keys in GATE_JOB_KEYS (no job `env:`, `defaults:`, `container:`,
//     `services:`, `if:`, `strategy:`...); its steps may only be pinned actions/checkout + actions/setup-node (keys
//     uses/with/name/id; their `with:` inputs allow-listed per action, F-DG1-120: checkout only fetch-depth and
//     persist-credentials, so no ref/repository/path override; setup-node only a literal node-version) and the
//     validate step; and EVERY step anywhere that runs validate.mjs may only carry the keys
//     name/id/run (no `env:` e.g. NODE_OPTIONS=--import=..., no `shell:` e.g. "true {0}", no `working-directory:`);
//   - dependency installs go ONLY through deploy/scripts/ci-install-deps.sh (tools/deps/install-sandbox.sh frozen;
//     REQ-DLV-042, F-DG1-104): any other install command (pnpm/npm/yarn install|i|ci|add, corepack) is a violation,
//     except provisioning pnpm itself with `npm install --global --ignore-scripts pnpm@...`; a job that runs pnpm must
//     run ci-install-deps.sh before its first pnpm command;
//   - `needs:` references exist and form no cycle;
//   - every `uses:` action is pinned to a full 40-hex commit SHA.
//
//   node deploy/scripts/check-ci-needs.mjs [workflow]      default: .github/workflows/ci.yml, else deploy/ci/ci.yml
// Negative and positive cases: node --test deploy/scripts/tests/check-ci-needs.test.mjs
// Uses the `yaml` package already in the lockfile (resolved from apps/api); needs an installed workspace.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const YAML = createRequire(join(root, "apps", "api", "package.json"))("yaml");
const file =
  process.argv[2] ??
  (existsSync(join(root, ".github/workflows/ci.yml")) ? ".github/workflows/ci.yml" : "deploy/ci/ci.yml");
const wf = YAML.parse(readFileSync(resolve(root, file), "utf8"));
const jobs = wf.jobs ?? {};
const names = Object.keys(jobs);
const problems = [];
const GATE = "delivery-gates";

if (names[0] !== GATE) problems.push(`first job is "${names[0]}", expected "${GATE}"`);
const VALIDATE = "node tools/gates/validate.mjs --pipeline";
const gateSteps = jobs[GATE]?.steps ?? [];
const validateSteps = gateSteps.filter((s) => /tools\/gates\/validate\.mjs/.test(String(s.run ?? "")));
if (!validateSteps.some((s) => String(s.run).trim() === VALIDATE))
  problems.push(`${GATE} does not run exactly "${VALIDATE}"`);
for (const s of validateSteps) {
  if (String(s.run).trim() !== VALIDATE)
    problems.push(`${GATE}: validate step must be exactly "${VALIDATE}", got: ${JSON.stringify(String(s.run).trim())}`);
  if (s.if !== undefined) problems.push(`${GATE}: validate step must not have an if: (${JSON.stringify(s.if)})`);
  if (s["continue-on-error"] !== undefined && s["continue-on-error"] !== false)
    problems.push(`${GATE}: validate step must not set continue-on-error`);
}
if (jobs[GATE]?.["continue-on-error"] !== undefined && jobs[GATE]["continue-on-error"] !== false)
  problems.push(`${GATE}: job must not set continue-on-error (a failed gate would count as success)`);
if (jobs[GATE]?.needs) problems.push(`${GATE} must not depend on other jobs`);

// F-DG1-116: nothing may change HOW the validate step executes. Allow-lists (fail-closed): any key not listed is a
// violation, so new GitHub Actions keys are rejected until reviewed here.
// - workflow-level `defaults:` (run.shell / run.working-directory) and `env:` (NODE_OPTIONS, PATH, ...) reach every
//   step, including the gate's validate step;
for (const k of ["defaults", "env"])
  if (wf[k] !== undefined)
    problems.push(
      `workflow-level ${k}: is not allowed (it reaches the ${GATE} validate step): ${JSON.stringify(wf[k])}`,
    );
// - the gate job: no job-level env/defaults/container/services/if/strategy/outputs...;
const GATE_JOB_KEYS = new Set(["name", "runs-on", "steps", "permissions", "timeout-minutes", "continue-on-error"]);
for (const k of Object.keys(jobs[GATE] ?? {}))
  if (!GATE_JOB_KEYS.has(k) && k !== "needs")
    problems.push(`${GATE}: job key "${k}" is not allowed (it could change how the validate step runs)`);
// - the gate job's steps: only checkout/setup-node actions and the validate step (no other run: step that could write
//   $GITHUB_ENV / $GITHUB_PATH or tamper with tools/gates before validate runs);
const GATE_ACTION = /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/;
const ACTION_STEP_KEYS = new Set(["uses", "with", "name", "id"]);
// F-DG1-120: allowed `with:` inputs per gate action, each with a value predicate (literals only, no expressions).
const GATE_WITH = {
  checkout: {
    "fetch-depth": (v) => Number.isInteger(v) && v >= 0,
    "persist-credentials": (v) => typeof v === "boolean",
  },
  "setup-node": { "node-version": (v) => /^\d+(\.\d+){0,2}$/.test(String(v)) },
};
const RUN_STEP_KEYS = new Set(["name", "id", "run", "if", "continue-on-error"]); // if / c-o-e reported separately below
for (const [i, s] of gateSteps.entries()) {
  const where = `${GATE} step ${i + 1}${s?.name ? ` (${JSON.stringify(s.name)})` : ""}`;
  if (s?.uses !== undefined) {
    if (!GATE_ACTION.test(String(s.uses)))
      problems.push(`${where}: only pinned actions/checkout and actions/setup-node are allowed, got ${s.uses}`);
    for (const k of Object.keys(s)) if (!ACTION_STEP_KEYS.has(k)) problems.push(`${where}: key "${k}" is not allowed`);
    // F-DG1-120: the action's `with:` inputs are allow-listed too (fail-closed), so the gate cannot validate a
    // different tree than the product jobs build: no checkout `ref`/`repository`/`path`/`token`/`ssh-key`/
    // `sparse-checkout`/`submodules`..., no setup-node `node-version-file`/`cache`/`registry-url`...
    const action = GATE_ACTION.exec(String(s.uses))?.[1];
    if (action && s.with !== undefined) {
      if (s.with === null || typeof s.with !== "object" || Array.isArray(s.with))
        problems.push(`${where}: with: must be a mapping, got ${JSON.stringify(s.with)}`);
      else
        for (const [k, v] of Object.entries(s.with)) {
          const ok = GATE_WITH[action][k];
          if (!ok)
            problems.push(
              `${where}: with.${k} is not allowed on ${action} in ${GATE} (allowed: ${Object.keys(GATE_WITH[action]).join(", ")}); it could make validate.mjs check a different tree or toolchain`,
            );
          else if (!ok(v)) problems.push(`${where}: with.${k} has a disallowed value ${JSON.stringify(v)}`);
        }
    }
  } else if (!/tools\/gates\/validate\.mjs/.test(String(s?.run ?? ""))) {
    problems.push(`${where}: only the validate step may run commands in ${GATE}: ${JSON.stringify(s?.run ?? s)}`);
  }
}
// - every step (any job) that runs validate.mjs: no env (NODE_OPTIONS=--import=...), shell ("true {0}"),
//   working-directory (a decoy tools/gates/validate.mjs), or any other key.
for (const j of names) {
  for (const [i, s] of (jobs[j].steps ?? []).entries()) {
    if (!/tools\/gates\/validate\.mjs/.test(String(s?.run ?? ""))) continue;
    for (const k of Object.keys(s))
      if (!RUN_STEP_KEYS.has(k))
        problems.push(
          `${j} step ${i + 1}: a validate.mjs step must not set ${k}: ${JSON.stringify(s[k])} (only name/id/run)`,
        );
  }
}

const needsOf = (j) => {
  const n = jobs[j]?.needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
};
for (const j of names) for (const n of needsOf(j)) if (!jobs[n]) problems.push(`${j} needs unknown job "${n}"`);

const reaches = (j, seen = new Set()) => {
  if (j === GATE) return true;
  if (seen.has(j)) {
    problems.push(`needs cycle through "${j}"`);
    return false;
  }
  seen.add(j);
  return needsOf(j).some((n) => jobs[n] && reaches(n, new Set(seen)));
};
const chains = [];
for (const j of names) {
  if (j === GATE) continue;
  if (!reaches(j)) problems.push(`job "${j}" does not depend on ${GATE}`);
  else chains.push(`${j} <- ${needsOf(j).join(", ")}`);
}

// F-DG1-107: a job-level status-check function overrides the implicit success() and runs the job after a needed job
// (ultimately delivery-gates) failed. Expression function names are case-insensitive; whitespace before "(" is allowed.
// Deliberately fail-closed: the function name anywhere in the expression (even inside a string literal) is rejected.
const STATUS_FN = /\b(always|failure|cancelled)\s*\(/i;
for (const j of names) {
  if (j === GATE) continue;
  const cond = jobs[j]?.if;
  if (cond !== undefined && STATUS_FN.test(String(cond)))
    problems.push(
      `job "${j}": job-level if: ${JSON.stringify(String(cond))} uses a status function, so it can run after ${GATE} failed`,
    );
}

for (const j of names) {
  for (const s of jobs[j].steps ?? []) {
    if (s.uses && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(s.uses))
      problems.push(`${j}: action not pinned to a commit SHA: ${s.uses}`);
  }
}

// F-DG1-104 / REQ-DLV-042: dependency installs only through the sandboxed installer.
// The sandboxed install must be the WHOLE command line (no `|| pnpm install` fallback, no chained commands).
const SANDBOXED_INSTALL = /^(\.\/)?deploy\/scripts\/ci-install-deps\.sh$/;
const PNPM_PROVISION = /^npm install --global --ignore-scripts "?(\$\(.*packageManager.*\)|pnpm@[\w.+-]+)"?$/;
const INSTALL_CMD =
  /(^|[\s;&|(])(pnpm\s+(install|i|add|ci)|npm\s+(install|i|ci|add)|yarn(\s+(install|add))?|corepack(\s|$)|npx\s|pnpm\s+dlx|bun\s+(install|add))(\s|$)/m;
const PNPM_USE = /(^|[\s;&|(])pnpm\s+(?!--version\b)\S/m;
for (const j of names) {
  let installed = false;
  for (const s of jobs[j].steps ?? []) {
    if (typeof s.run !== "string") continue;
    for (const line of s.run.split("\n").map((l) => l.trim())) {
      if (line === "" || line.startsWith("#")) continue;
      if (SANDBOXED_INSTALL.test(line)) {
        installed = true;
        continue;
      }
      if (/ci-install-deps\.sh/.test(line))
        problems.push(
          `${j}: the sandboxed install must be the whole command, exactly deploy/scripts/ci-install-deps.sh: ${line}`,
        );
      if (PNPM_PROVISION.test(line)) continue;
      if (INSTALL_CMD.test(line))
        problems.push(`${j}: dependency install outside deploy/scripts/ci-install-deps.sh (REQ-DLV-042): ${line}`);
      else if (PNPM_USE.test(line) && !installed)
        problems.push(`${j}: runs pnpm before the sandboxed install (deploy/scripts/ci-install-deps.sh): ${line}`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  process.exit(1);
}
console.log(
  `OK: ${file}: ${names.length} jobs; first job ${GATE} runs validate.mjs --pipeline; every other job depends on it ` +
    `with no status-function if:; installs only via ci-install-deps.sh`,
);
for (const c of chains) console.log(`  ${c}`);
