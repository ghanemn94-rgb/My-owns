// T-A8 (ADR-0062 §7; REQ-S16-009 "every direct dependency is pinned in a lockfile and listed in the licence inventory
// with its licence"): a range spec, a version not in the lockfile, and a NOASSERTION direct dependency each fail
// --check with their exact message; the real repository passes.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_LICENCES, editJson, fixtureWorkspace, sbom } from "./helpers.mjs";

const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Generates a current inventory first, so --check fails only on the direct-dependency rule under test. */
function checkAfter(licences, edit) {
  const root = fixtureWorkspace(licences);
  cleanup.push(root);
  sbom(["--root", root]);
  if (edit) edit(root);
  return sbom(["--check", "--root", root]);
}

test("T-A8 the clean fixture passes --check", () => {
  const r = checkAfter(DEFAULT_LICENCES);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test("T-A8 a range spec fails", () => {
  const r = checkAfter(DEFAULT_LICENCES, (root) =>
    editJson(join(root, "apps", "api", "package.json"), (p) => ({
      ...p,
      dependencies: { ...p.dependencies, "licensed-lib": "^1.0.0" },
    })),
  );
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /^generate-sbom: apps\/api\/package\.json: licensed-lib is not pinned to an exact version \(\^1\.0\.0\)$/m,
  );
});

test("T-A8 a version not in the lockfile fails", () => {
  const r = checkAfter(DEFAULT_LICENCES, (root) =>
    editJson(join(root, "package.json"), (p) => ({ ...p, devDependencies: { "dev-lib": "2.0.1" } })),
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^generate-sbom: package\.json: dev-lib@2\.0\.1 is not in pnpm-lock\.yaml$/m);
});

test("T-A8 a NOASSERTION direct dependency fails, development ones included", () => {
  const r = checkAfter({ ...DEFAULT_LICENCES, "dev-lib@2.0.0": undefined });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^generate-sbom: direct dependency dev-lib@2\.0\.0 has no licence in the inventory$/m);
});

test("T-A8 workspace: specs are skipped", () => {
  const r = checkAfter(DEFAULT_LICENCES, (root) =>
    editJson(join(root, "apps", "api", "package.json"), (p) => ({
      ...p,
      dependencies: { ...p.dependencies, "@fixture/other": "workspace:*" },
    })),
  );
  assert.equal(r.code, 0, r.stderr);
});

test("T-A8 the real repository passes the direct-dependency check", () => {
  const r = sbom(["--check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /direct-dependency-problems=0 /);
  assert.doesNotMatch(r.stderr, /generate-sbom: /);
});
