// T-A6 (ADR-0062 §6; REQ-S19-003 "the service list matches the Compose file").
//   - the real list equals the Compose services (and the committed file is current);
//   - against Compose fixtures: an added service without a role, a changed image and a changed profile each fail --check;
//   - every optional external row has a restricted-network.md "Optional outbound destinations" row, and every required
//     row is named in its "Runtime" section.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, test } from "node:test";
import { EXTERNAL_DEPENDENCIES, generateServiceList, run, SERVICE_ROLES } from "../service-list.mjs";
import { FIXTURES, HERE, REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(HERE, "..", "service-list.mjs");
const YAML = createRequire(join(REPO, "apps", "api", "package.json"))("yaml");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A root with the Compose fixture and the real lock, inventory and SBOM, with its list generated. */
async function fixtureRoot() {
  const root = tmp("svc");
  cleanup.push(root);
  mkdirSync(join(root, "deploy"), { recursive: true });
  mkdirSync(join(root, "licenses"), { recursive: true });
  cpSync(join(FIXTURES, "compose"), join(root, "deploy", "compose"), { recursive: true });
  for (const p of ["deploy/images.lock.json", "licenses/inventory.csv", "licenses/sbom.cdx.json", "pnpm-lock.yaml"])
    cpSync(join(REPO, p), join(root, p));
  await run({ root });
  assert.equal(runNode([TOOL, "--check", "--root", root]).code, 0);
  return root;
}

const edit = (root, f) => {
  const p = join(root, "deploy", "compose", "compose.yaml");
  writeFileSync(p, f(readFileSync(p, "utf8")));
};

test("T-A6 the real service list equals the Compose services and is current (--check exit 0)", () => {
  const r = runNode([TOOL, "--check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const list = JSON.parse(readFileSync(join(REPO, "deploy", "service-list.json"), "utf8"));
  const tags = ["!reset", "!override"].flatMap((tag) => [
    { tag, collection: "seq", resolve: (v) => v },
    { tag, collection: "map", resolve: (v) => v },
  ]);
  const names = new Set();
  const base = new Map();
  for (const f of readdirSync(join(REPO, "deploy", "compose")).filter((x) => x.endsWith(".yaml"))) {
    const doc = YAML.parse(readFileSync(join(REPO, "deploy", "compose", f), "utf8"), { merge: true, customTags: tags });
    for (const [n, d] of Object.entries(doc.services ?? {})) {
      names.add(n);
      if (d.image !== undefined) base.set(n, d);
    }
  }
  assert.deepEqual(list.services.map((s) => s.name), [...names].sort());
  for (const s of list.services) {
    assert.equal(s.image, base.get(s.name).image, s.name);
    assert.deepEqual(s.profiles, base.get(s.name).profiles ?? [], s.name);
    assert.equal(s.role, SERVICE_ROLES[s.name]);
    assert.equal(s.requiredInProduction, s.profiles.length === 0);
  }
  assert.deepEqual(
    list.services.filter((s) => s.requiredInProduction).map((s) => s.name),
    ["api", "db", "migrate", "worker"],
  );
  const lock = JSON.parse(readFileSync(join(REPO, "deploy", "images.lock.json"), "utf8")).images;
  for (const s of list.services)
    if (s.imageLockId !== "mth-app") assert.ok(lock.some((i) => i.id === s.imageLockId), s.name);
  assert.deepEqual(list.dependencies.containerImages.map((i) => i.id), lock.map((i) => i.id));
});

test("T-A6 fixture: an added service without a role fails generation and --check", async () => {
  const root = await fixtureRoot();
  edit(root, (t) =>
    t.replace(
      "\nvolumes:",
      '  synthetic-unlisted:\n    image: postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722\n    profiles: ["synthetic"]\n\nvolumes:',
    ),
  );
  const r = runNode([TOOL, "--check", "--root", root]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "service-list: no role text for service 'synthetic-unlisted'");
  // With its one SERVICE_ROLES line the list regenerates, and the stale committed file still fails --check.
  const roles = { ...SERVICE_ROLES, "synthetic-unlisted": "Synthetic test role." };
  await assert.rejects(run({ root, check: true, roles }), /service-list: deploy\/service-list.json is out of date/);
  await run({ root, roles });
  assert.equal((await run({ root, check: true, roles })).startsWith("service-list: OK"), true);
});

test("T-A6 fixture: a changed image fails --check", async () => {
  const root = await fixtureRoot();
  edit(root, (t) =>
    t.replace(
      "quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b",
      "postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722",
    ),
  );
  const r = runNode([TOOL, "--check", "--root", root]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "service-list: deploy/service-list.json is out of date: run node tools/release/service-list.mjs");
});

test("T-A6 fixture: an image outside images.lock.json fails generation", async () => {
  const root = await fixtureRoot();
  edit(root, (t) => t.replace(/postgres:18@sha256:[0-9a-f]{64}/, "postgres:17"));
  const r = runNode([TOOL, "--check", "--root", root]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /image 'postgres:17' is not a deploy\/images\.lock\.json entry/);
});

test("T-A6 fixture: a changed profile fails --check", async () => {
  const root = await fixtureRoot();
  edit(root, (t) => t.replace('profiles: ["test-idp"]', 'profiles: ["test-idp", "extra"]'));
  const r = runNode([TOOL, "--check", "--root", root]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "service-list: deploy/service-list.json is out of date: run node tools/release/service-list.mjs");
});

test("T-A6 every optional external row has a restricted-network.md row; every required row is in Runtime", () => {
  const doc = readFileSync(join(REPO, "docs", "operations", "restricted-network.md"), "utf8");
  const runtime = doc.slice(doc.indexOf("## Runtime"), doc.indexOf("### Optional outbound destinations"));
  const optional = doc.slice(doc.indexOf("### Optional outbound destinations"), doc.indexOf("\n## ", doc.indexOf("### Optional")));
  const rows = optional.split("\n").filter((l) => l.startsWith("| **"));
  for (const e of EXTERNAL_DEPENDENCIES) {
    const key = e.name.replace(/ \(.*\)$/, "").replace(/s$/, "");
    if (e.required) assert.match(runtime, /corporate OIDC IdP/, e.name);
    else assert.ok(rows.some((r) => r.toLowerCase().includes(`**${key.toLowerCase()}`)), `${e.name}: no restricted-network.md row`);
  }
  assert.equal(rows.length, EXTERNAL_DEPENDENCIES.filter((e) => !e.required).length, "every documented optional row is listed");
  const list = generateServiceList();
  assert.deepEqual(list.external, EXTERNAL_DEPENDENCIES.map((e) => ({ ...e })));
});
