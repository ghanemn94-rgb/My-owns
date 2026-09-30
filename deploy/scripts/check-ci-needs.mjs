#!/usr/bin/env node
// Static check of the product CI workflow (REQ-DLV-025, ADR-0013):
//   - the first job is `delivery-gates` and it runs `node tools/gates/validate.mjs --pipeline`;
//   - every other job depends on `delivery-gates`, directly or transitively through `needs:` (so a failed or
//     unapproved gate skips every product build, test, image and push job);
//   - `needs:` references exist and form no cycle;
//   - every `uses:` action is pinned to a full 40-hex commit SHA.
//
//   node deploy/scripts/check-ci-needs.mjs [workflow]      default: .github/workflows/ci.yml, else deploy/ci/ci.yml
// Uses the `yaml` package already in the lockfile (resolved from apps/api); needs an installed workspace.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const YAML = createRequire(join(root, "apps", "api", "package.json"))("yaml");
const file =
  process.argv[2] ??
  (existsSync(join(root, ".github/workflows/ci.yml")) ? ".github/workflows/ci.yml" : "deploy/ci/ci.yml");
const wf = YAML.parse(readFileSync(join(root, file), "utf8"));
const jobs = wf.jobs ?? {};
const names = Object.keys(jobs);
const problems = [];
const GATE = "delivery-gates";

if (names[0] !== GATE) problems.push(`first job is "${names[0]}", expected "${GATE}"`);
const gateRuns = (jobs[GATE]?.steps ?? []).map((s) => s.run ?? "").join("\n");
if (!/node tools\/gates\/validate\.mjs --pipeline/.test(gateRuns))
  problems.push(`${GATE} does not run validate.mjs --pipeline`);
if (jobs[GATE]?.needs) problems.push(`${GATE} must not depend on other jobs`);

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

for (const j of names) {
  for (const s of jobs[j].steps ?? []) {
    if (s.uses && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(s.uses))
      problems.push(`${j}: action not pinned to a commit SHA: ${s.uses}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  process.exit(1);
}
console.log(
  `OK: ${file}: ${names.length} jobs; first job ${GATE} runs validate.mjs --pipeline; every other job depends on it`,
);
for (const c of chains) console.log(`  ${c}`);
