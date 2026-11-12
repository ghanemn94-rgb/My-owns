// T-A7 (ADR-0062 §7, §9; REQ-S19-003 "the SBOM lists every runtime dependency with licence"):
// a shipped fixture package without a licence id fails --check; every runtime and bundled row of the real inventory
// has a licence.
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_LICENCES, fixtureWorkspace, REPO, sbom } from "./helpers.mjs";

const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("T-A7 a shipped (runtime) fixture package without a licence id fails --check", () => {
  const root = fixtureWorkspace({ ...DEFAULT_LICENCES, "unlicensed-lib@1.0.0": undefined });
  cleanup.push(root);
  const gen = sbom(["--root", root]);
  assert.equal(gen.code, 1, "generation reports the shipped package without a licence id");
  const r = sbom(["--check", "--root", root]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^OK: .*shipped-without-licence-id=1 /m, "the files are current; the licence is what fails");
  assert.match(r.stderr, /^shipped packages without a licence id: unlicensed-lib@1\.0\.0$/m);
  const row = readFileSync(join(root, "licenses", "inventory.csv"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("unlicensed-lib,"));
  assert.match(row, /^unlicensed-lib,1\.0\.0,NOASSERTION,runtime,/);
});

test("T-A7 a development-only package without a licence id does not fail the shipped-licence rule", () => {
  const root = fixtureWorkspace({ ...DEFAULT_LICENCES, "dev-lib@2.0.0": undefined });
  cleanup.push(root);
  sbom(["--root", root]);
  const r = sbom(["--check", "--root", root]);
  assert.match(r.stdout, /shipped-without-licence-id=0 /);
  assert.doesNotMatch(r.stderr, /shipped packages without a licence id/);
});

test("T-A7 every runtime and bundled row of the real inventory has a licence; the real --check passes", () => {
  const [head, ...rows] = readFileSync(join(REPO, "licenses", "inventory.csv"), "utf8")
    .trim()
    .split("\n");
  const cols = head.split(",");
  const [iName, iVersion, iLicence, iScope] = ["name", "version", "license", "scope"].map((c) => cols.indexOf(c));
  const shipped = rows.map((l) => l.split(",")).filter((c) => c[iScope] === "runtime" || c[iScope] === "bundled");
  assert.ok(shipped.length > 100, `${shipped.length} shipped rows`);
  for (const c of shipped) assert.ok(c[iLicence] && c[iLicence] !== "NOASSERTION", `${c[iName]}@${c[iVersion]}`);
  const r = sbom(["--check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK: .*shipped-without-licence-id=0 .*direct-dependency-problems=0 /m);
});
