// Self-test of deploy/scripts/check-ci-needs.mjs (REQ-DLV-025, REQ-DLV-042; F-DG1-107, F-DG1-104).
// Each case mutates the staged workflow deploy/ci/ci.yml (or the installed .github/workflows/ci.yml when the staged
// copy is absent) in memory, writes it to a temp dir and runs the checker on it. N4/N5 are the exact round-1 bypasses
// of F-DG1-107 (check-ci-needs-negative.log), which the old checker reported as OK.
//
//   node --test deploy/scripts/tests/check-ci-needs.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const YAML = createRequire(join(root, "apps", "api", "package.json"))("yaml");
const checker = join(root, "deploy", "scripts", "check-ci-needs.mjs");
const base = existsSync(join(root, "deploy/ci/ci.yml")) ? "deploy/ci/ci.yml" : ".github/workflows/ci.yml";
const baseText = readFileSync(join(root, base), "utf8");
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "check-ci-needs-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
function run(mutate) {
  const wf = YAML.parse(baseText);
  if (mutate) mutate(wf);
  const file = join(dir, `wf-${++n}.yml`);
  writeFileSync(file, YAML.stringify(wf));
  const r = spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const fails = (name, mutate, expect) =>
  test(`NEGATIVE ${name}`, () => {
    const r = run(mutate);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}:\n${r.out}`);
    assert.match(r.out, expect);
    console.log(`  ${name}: exit ${r.status}: ${r.out.trim().split("\n")[0]}`);
  });
const passes = (name, mutate) =>
  test(`POSITIVE ${name}`, () => {
    const r = run(mutate);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}:\n${r.out}`);
    console.log(`  ${name}: exit 0`);
  });
const step = (wf, job, re) => wf.jobs[job].steps.find((s) => re.test(String(s.run ?? "")));

passes(`P0 ${base} as committed`, null);
passes("P1 images: if: success() && github.event_name == 'push' (implicit-success semantics kept)", (wf) => {
  wf.jobs.images.if = "${{ success() && github.event_name == 'push' }}";
});
passes("P2 integration: if: github.event_name != 'schedule' (no status function)", (wf) => {
  wf.jobs.integration.if = "github.event_name != 'schedule'";
});
passes("P3 step-level if: always() inside a gated product job (upload-artifact)", null);

// --- REQ-DLV-025 structure (round-1 N1-N3, already caught before; kept as regression)
fails(
  "N1 verify: needs removed",
  (wf) => delete wf.jobs.verify.needs,
  /job "verify" does not depend on delivery-gates/,
);
fails(
  "N2 rogue job without needs",
  (wf) => (wf.jobs.rogue = { "runs-on": "ubuntu-24.04", steps: [{ run: "echo hi" }] }),
  /job "rogue" does not depend/,
);
fails("N3 unknown need", (wf) => (wf.jobs.images.needs = ["integration", "nope"]), /needs unknown job "nope"/);

// --- F-DG1-107: status functions on product jobs
fails("N4 verify: if: always()", (wf) => (wf.jobs.verify.if = "always()"), /job "verify".*status function/);
fails(
  "N5 images: if: ${{ !cancelled() }}",
  (wf) => (wf.jobs.images.if = "${{ !cancelled() }}"),
  /job "images".*status function/,
);
fails("N6 integration: if: failure()", (wf) => (wf.jobs.integration.if = "failure()"), /job "integration".*status/);
fails(
  "N7 e2e: if: ${{ always() && github.ref == 'refs/heads/main' }}",
  (wf) => (wf.jobs.e2e.if = "${{ always() && github.ref == 'refs/heads/main' }}"),
  /job "e2e".*status function/,
);
fails("N8 verify: if: Always ( ) (case/whitespace)", (wf) => (wf.jobs.verify.if = "Always ( )"), /status function/);
fails(
  "N9 integration: if: success() || failure()",
  (wf) => (wf.jobs.integration.if = "success() || failure()"),
  /status function/,
);

// --- F-DG1-107: the gate itself must not be able to "succeed" after failing
fails(
  "N10 delivery-gates: continue-on-error: true",
  (wf) => (wf.jobs["delivery-gates"]["continue-on-error"] = true),
  /continue-on-error/,
);
fails(
  "N11 validate step: continue-on-error: true",
  (wf) => (step(wf, "delivery-gates", /validate\.mjs/)["continue-on-error"] = true),
  /validate step must not set continue-on-error/,
);
fails(
  "N12 validate step: `|| true`",
  (wf) => (step(wf, "delivery-gates", /validate\.mjs/).run = "node tools/gates/validate.mjs --pipeline || true"),
  /validate step must be exactly/,
);
fails(
  "N13 validate step: if: false",
  (wf) => (step(wf, "delivery-gates", /validate\.mjs/).if = "false"),
  /validate step must not have an if:/,
);

// --- F-DG1-104 / REQ-DLV-042: installs only through the sandboxed installer
fails(
  "N14 verify: plain pnpm install --frozen-lockfile instead of ci-install-deps.sh",
  (wf) => (step(wf, "verify", /ci-install-deps\.sh/).run = "pnpm install --frozen-lockfile"),
  /verify: dependency install outside deploy\/scripts\/ci-install-deps\.sh/,
);
fails(
  "N15 integration: ci-install-deps.sh step removed (pnpm used without any install)",
  (wf) => (wf.jobs.integration.steps = wf.jobs.integration.steps.filter((s) => !/ci-install-deps/.test(s.run ?? ""))),
  /integration: runs pnpm before the sandboxed install/,
);
fails(
  "N16 images: extra `npm ci` step",
  (wf) => wf.jobs.images.steps.splice(1, 0, { run: "npm ci" }),
  /images: dependency install outside/,
);
fails(
  "N17 e2e: corepack enable && pnpm install",
  (wf) => wf.jobs.e2e.steps.splice(1, 0, { run: "corepack enable\npnpm install" }),
  /e2e: dependency install outside/,
);
fails(
  "N18 verify: fallback `ci-install-deps.sh || pnpm install`",
  (wf) => (step(wf, "verify", /ci-install-deps\.sh/).run = "deploy/scripts/ci-install-deps.sh || pnpm install"),
  /verify: dependency install outside/,
);
