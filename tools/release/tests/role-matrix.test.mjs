// T-H3 (ADR-0072 §4, §8; p7-work-split §H.4, DOC-C): the handover role matrix is generated from
// packages/shared/src/permissions.ts and cannot drift from it.
//   node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs \
//     tools/release/tests/automation-guide.test.mjs
// Fixture roots are created under $TMPDIR and removed; nothing is written to the repository.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  insertRows,
  loadModel,
  MIGRATIONS_DIR,
  OUTPUT_PATH,
  PERMISSIONS_PATH,
  render,
  TEXTS,
} from "../role-matrix.mjs";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "role-matrix.mjs");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A fixture root holding copies of permissions.ts, the migrations and the committed matrix. */
function fixtureRoot() {
  const dir = tmp("role-matrix");
  roots.push(dir);
  for (const p of [PERMISSIONS_PATH, OUTPUT_PATH]) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    cpSync(join(REPO, p), join(dir, p));
  }
  cpSync(join(REPO, MIGRATIONS_DIR), join(dir, MIGRATIONS_DIR), { recursive: true });
  return dir;
}

/** Adds a permission (catalogue entry, optional role grant) to the fixture's permissions.ts. */
function addPermission(dir, { code, grantTo }) {
  const file = join(dir, PERMISSIONS_PATH);
  let src = readFileSync(file, "utf8");
  const anchor = `  "organization.read": "read",\n`;
  assert.ok(src.includes(anchor), "fixture anchor in P1_PERMISSIONS");
  src = src.replace(anchor, `${anchor}  "${code}": "read",\n`);
  if (grantTo !== undefined) {
    const roleAnchor = `  ${grantTo}: {\n    kind:`;
    const at = src.indexOf(roleAnchor, src.indexOf("export const ROLES"));
    assert.ok(at !== -1, `role ${grantTo} in ROLES`);
    const perms = src.indexOf("permissions: [\n", at) + "permissions: [\n".length;
    src = `${src.slice(0, perms)}      "${code}",\n${src.slice(perms)}`;
  }
  writeFileSync(file, src);
}

const seedLabel = (dir, code) =>
  writeFileSync(
    join(dir, MIGRATIONS_DIR, "9999_fixture_permission.sql"),
    `-- fixture only\nINSERT INTO permission (code, category, description_en, description_ar) VALUES\n  ('${code}', 'read', 'Fixture permission', 'صلاحية تجريبية');\n`,
  );

describe("T-H3 role matrix", () => {
  it("--check exits 0 on the tree (docs/handover/role-matrix.md is current)", () => {
    const r = runNode([TOOL, "--check"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /PASS/);
  });

  it("--check exits 1 after a permission is added to a fixture copy, and 0 again after --write", () => {
    const dir = fixtureRoot();
    assert.equal(runNode([TOOL, "--root", dir, "--check"]).code, 0, "the copy starts current");
    addPermission(dir, { code: "zz_fixture.read", grantTo: "AUD" });
    seedLabel(dir, "zz_fixture.read");
    const r = runNode([TOOL, "--root", dir, "--check"]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^FAIL: .*differs/m);
    assert.equal(runNode([TOOL, "--root", dir, "--write"]).code, 0);
    assert.equal(runNode([TOOL, "--root", dir, "--check"]).code, 0);
    const md = readFileSync(join(dir, OUTPUT_PATH), "utf8");
    const row = md.split("\n").find((l) => l.startsWith("| `zz_fixture.read` |"));
    assert.ok(row !== undefined, "the new permission has a row");
    assert.match(row, /Fixture permission \| صلاحية تجريبية/);
    assert.equal((row.match(/✓/g) ?? []).length, 1, "granted to exactly one role (AUD)");
    // The real tree is untouched.
    assert.equal(runNode([TOOL, "--check"]).code, 0);
  });

  it("--check exits 1 when a role loses a permission in the fixture copy", () => {
    const dir = fixtureRoot();
    const file = join(dir, PERMISSIONS_PATH);
    const src = readFileSync(file, "utf8");
    const at = src.indexOf("  SP: {\n", src.indexOf("export const ROLES"));
    const grant = `      "gate.decide",\n`;
    const g = src.indexOf(grant, at);
    assert.ok(at !== -1 && g !== -1);
    writeFileSync(file, src.slice(0, g) + src.slice(g + grant.length));
    assert.equal(runNode([TOOL, "--root", dir, "--check"]).code, 1);
  });

  it("a permission without a seeded label is BLOCKED (exit 2), never rendered with a guessed label", () => {
    const dir = fixtureRoot();
    addPermission(dir, { code: "zz_unlabelled.read" });
    const r = runNode([TOOL, "--root", dir, "--check"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^BLOCKED: permission zz_unlabelled\.read has no seeded description/m);
  });

  it("a usage error and a missing permissions.ts are BLOCKED (exit 2)", () => {
    assert.equal(runNode([TOOL]).code, 2);
    assert.equal(runNode([TOOL, "--check", "--write"]).code, 2);
    const empty = tmp("role-matrix-empty");
    roots.push(empty);
    const r = runNode([TOOL, "--root", empty, "--check"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /BLOCKED: missing packages\/shared\/src\/permissions\.ts/);
  });

  it("the output is deterministic, has no timestamp and is sorted by code", async () => {
    const a = render(await loadModel(REPO));
    const b = render(await loadModel(REPO));
    assert.equal(a, b);
    assert.doesNotMatch(a, /\b20\d\d-\d\d-\d\d\b|\d\d:\d\d:\d\d/);
    const model = await loadModel(REPO);
    const roleCodes = model.roles.map((r) => r.code);
    assert.deepEqual(roleCodes, [...roleCodes].sort());
    const permCodes = model.permissions.map((p) => p.code);
    assert.deepEqual(permCodes, [...permCodes].sort());
  });

  it("covers the 14 roles and every permission of permissions.ts, with one ✓ per default grant", async () => {
    const shared = await import(new URL(`file://${join(REPO, PERMISSIONS_PATH)}`).href);
    const model = await loadModel(REPO);
    assert.equal(model.roles.length, 14);
    assert.deepEqual(model.roles.map((r) => r.code).sort(), Object.keys(shared.ROLES).sort());
    assert.deepEqual(model.permissions.map((p) => p.code).sort(), Object.keys(shared.PERMISSIONS).sort());
    const md = readFileSync(join(REPO, OUTPUT_PATH), "utf8");
    const header = md.split("\n").find((l) => l.startsWith("| Permission"));
    const cols = header
      .split("|")
      .slice(4, -1)
      .map((c) => c.trim().replace(/`/g, ""));
    let rows = 0;
    for (const line of md.split("\n")) {
      const m = /^\| `([a-z_]+\.[a-z_]+)` \|/.exec(line);
      if (m === null) continue;
      rows += 1;
      const cells = line.split("|").slice(4, -1).map((c) => c.trim());
      assert.equal(cells.length, 14, `${m[1]} has 14 role cells`);
      cols.forEach((role, k) =>
        assert.equal(cells[k] === "✓", shared.ROLES[role].permissions.includes(m[1]), `${role} × ${m[1]}`),
      );
    }
    assert.equal(rows, Object.keys(shared.PERMISSIONS).length);
  });

  it("names and descriptions are the seeded rows, in English and Arabic", async () => {
    const seed = readFileSync(join(REPO, MIGRATIONS_DIR, "0005_seed_roles_permissions.sql"), "utf8");
    const roles = insertRows(seed, "role");
    const sp = roles.find((r) => r.code === "SP");
    const md = readFileSync(join(REPO, OUTPUT_PATH), "utf8");
    assert.ok(md.includes(`| \`SP\` | ${sp.name_en} | ${sp.name_ar} |`));
    const perm = insertRows(seed, "permission").find((p) => p.code === "gate.decide");
    assert.ok(md.includes(`| \`gate.decide\` | ${perm.description_en} | ${perm.description_ar} |`));
  });

  it("carries the §H.3 header and provisional marker (EN and AR) and no claim wording", () => {
    const md = readFileSync(join(REPO, OUTPUT_PATH), "utf8");
    const lines = md.split("\n");
    assert.equal(lines[0].startsWith("# "), true);
    assert.equal(lines[2], TEXTS.provisionalEn, "EN marker directly under the first heading");
    assert.ok(lines[4].includes(TEXTS.provisionalAr), "AR marker next");
    assert.ok(md.includes(TEXTS.headerEn));
    assert.ok(md.includes(TEXTS.headerAr));
    assert.doesNotMatch(md, /certified|compliant|approved by Mobily|production-ready/i);
  });
});
