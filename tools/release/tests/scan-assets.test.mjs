// T-A10 and T-A11 (ADR-0062 §8; REQ-S19-019 first half).
//   T-A10 self-test: one planted hit per rule and applicable target, and none for a rule not applied to T3; clean
//         twins pass; masking; a stale entry fails; the loader refuses an R1/R3/R5 entry for T1/T2; R1 is a superset of
//         scripts/check-no-cdn.mjs BANNED.
//   T-A11 the real built SPA, runtime tree and configuration scan exits 0. Needs a built tree and an assembled runtime
//         tree (MTH_RELEASE_RUNTIME_DIR, written by deploy/scripts/assemble-runtime.sh, e.g. by build-from-archive.sh);
//         without one the test is SKIPPED with a BLOCKED reason and is never reported as a pass.
// Planted values are assembled at run time from fragments (p7-work-split §2 rule 6).
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { classifyHost, loadAllowlist, R1_HOSTS, scanAssets, scanLine } from "../scan-assets.mjs";
import { FIXTURES, HERE, REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(HERE, "..", "scan-assets.mjs");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

const j = (...parts) => parts.join("");
const PLANTED = {
  R1: j("https://", "cdn.", "jsdelivr", ".net/npm/x.js"),
  R2: j("https://", "preview-1.", "vercel", ".app/"),
  R3: j("AK", "IA", "QWERTYUIOPASDFGH"),
  R4: j("https://", "planted-host", ".net/api"),
  R5: j("https://", "planted-project.", "supabase", ".co/rest"),
  R6: j("someone", "@", "planted-mail", ".net"),
};
const R2_PATH = j("/ho", "me/user/", "project");
const R2_SESSION = j("session", "_", "A1b2C3d4E5f6G7h8I9j0K1");

/** A copy of the clean fixture with an allow-list; `plant` adds files. Returns the scan arguments. */
function tree({ plant, allow } = {}) {
  const dir = tmp("assets");
  cleanup.push(dir);
  cpSync(join(FIXTURES, "assets"), dir, { recursive: true });
  // dist/ and node_modules/ are git-ignored, so those clean twins are written here rather than committed.
  put(join(dir, "config", "apps", "api", "dist", "main.js"), 'export const contact = "ops@example.invalid";\n');
  put(join(dir, "config", "apps", "worker", "dist", "main.js"), "export const worker = true;\n");
  put(join(dir, "config", "packages", "shared", "dist", "index.js"), "export const shared = 1;\n");
  put(join(dir, "runtime", "node_modules", "clean-lib", "package.json"), '{ "name": "clean-lib", "version": "1.0.0", "license": "MIT" }\n');
  put(
    join(dir, "runtime", "node_modules", "clean-lib", "index.js"),
    "// docs: https://clean-lib.example.org/docs (R4 is not applied to third-party code)\nmodule.exports = 1;\n",
  );
  const allowlist = join(dir, "allowlist.json");
  writeFileSync(
    allowlist,
    JSON.stringify({
      entries: allow ?? [{ rule: "R4", target: "T1", host: "www.w3.org", reason: "SVG namespace identifier, never fetched." }],
    }),
  );
  if (plant) plant(dir);
  return { web: join(dir, "web"), runtime: join(dir, "runtime"), config: join(dir, "config"), allowlist, useGitRemote: false };
}

function put(p, text) {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
}

test("T-A10 the clean twins pass (exit 0) and the allow-list entry is used", () => {
  const r = scanAssets(tree());
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.match(r.lines.at(-1), /^scan-assets: PASS \(\d+ files; T1 \d+, T2 \d+, T3 \d+\)$/);
});

test("T-A10 one planted hit per rule and target is reported with its rule and target, masked", () => {
  const args = tree({
    plant: (dir) => {
      for (const [rule, value] of Object.entries(PLANTED)) {
        put(join(dir, "web", "assets", `planted-${rule}.js`), `const v = "${value}";\n`);
        put(join(dir, "config", "deploy", `planted-${rule}.conf`), `value = ${value}\n`);
        put(join(dir, "runtime", "node_modules", "planted-lib", `${rule}.js`), `module.exports = "${value}";\n`);
      }
      put(join(dir, "runtime", "node_modules", "planted-lib", "package.json"), '{ "name": "planted-lib", "version": "2.0.0" }\n');
      put(join(dir, "config", "apps", "api", "dist", "paths.js"), `const a = "${R2_PATH}"; const b = "${R2_SESSION}";\n`);
    },
  });
  const r = scanAssets(args);
  assert.equal(r.code, 1);
  const out = r.lines.join("\n");
  for (const rule of Object.keys(PLANTED)) {
    assert.match(out, new RegExp(`^T1 ${rule} web/assets/planted-${rule}\\.js:1: `, "m"), `T1 ${rule}`);
    assert.match(out, new RegExp(`^T2 ${rule} deploy/planted-${rule}\\.conf:1: `, "m"), `T2 ${rule}`);
  }
  for (const rule of ["R1", "R2", "R3"])
    assert.match(out, new RegExp(`^T3 ${rule} planted-lib@2\\.0\\.0 runtime/node_modules/planted-lib/${rule}\\.js:1: `, "m"), `T3 ${rule}`);
  for (const rule of ["R4", "R5", "R6"])
    assert.doesNotMatch(out, new RegExp(`^T3 ${rule} `, "m"), `${rule} is not applied to T3`);
  assert.match(out, /^T1 R2 apps\/api\/dist\/paths\.js:1: .*\[R2:\/hom…\]/m);
  assert.match(out, /^T1 R2 apps\/api\/dist\/paths\.js:1: .*\[R2:sess…\]/m);
  for (const value of [...Object.values(PLANTED), R2_SESSION]) assert.ok(!out.includes(value), "a planted value is never printed whole");
  assert.match(out, /\[R3:AKIA…\]/);
  assert.match(r.lines.at(-1), /^scan-assets: FAIL \(\d+ hits\)$/);
});

test("T-A10 the repository slug and owner are R2 identifiers", () => {
  const ids = [j("example", "-owner/", "example-repo"), j("example", "-owner")];
  const hits = scanLine(`see ${ids[0]} by ${ids[1]}`, { target: "T1", identifiers: ids });
  assert.deepEqual(hits.map((h) => h.rule), ["R2", "R2"]);
});

test("T-A10 a stale allow-list entry fails the scan", () => {
  const args = tree({
    allow: [
      { rule: "R4", target: "T1", host: "www.w3.org", reason: "SVG namespace identifier, never fetched." },
      { rule: "R4", target: "T2", host: "nothing.example.org", reason: "Matches nothing in the fixture: stale." },
    ],
  });
  const r = scanAssets(args);
  assert.equal(r.code, 1);
  assert.ok(r.lines.includes("scan-assets: stale allow-list entry 2"));
  const cli = runNode([TOOL, "--web", args.web, "--runtime", args.runtime, "--config", args.config, "--allowlist", args.allowlist, "--no-git-remote"]);
  assert.equal(cli.code, 1);
  assert.match(cli.stdout, /^scan-assets: stale allow-list entry 2$/m);
});

test("T-A10 the loader refuses R1/R3/R5 entries for T1/T2, T3 entries without file+sha256, and entries without reason", () => {
  for (const rule of ["R1", "R3", "R5"])
    for (const target of ["T1", "T2"]) {
      const args = tree({ allow: [{ rule, target, host: "x.example.org", reason: "should be refused by the loader" }] });
      assert.throws(() => loadAllowlist(args.allowlist), /can never be allow-listed/, `${rule} ${target}`);
      const cli = runNode([TOOL, "--web", args.web, "--runtime", args.runtime, "--config", args.config, "--allowlist", args.allowlist]);
      assert.equal(cli.code, 2);
    }
  let args = tree({ allow: [{ rule: "R2", target: "T3", host: "x.example.org", reason: "T3 needs package, file and sha256" }] });
  assert.throws(() => loadAllowlist(args.allowlist), /T3 entry needs package, file and sha256/);
  args = tree({ allow: [{ rule: "R4", target: "T1", host: "www.w3.org" }] });
  assert.throws(() => loadAllowlist(args.allowlist), /no reason/);
});

test("T-A10 a T3 hit is accepted only by an entry naming package, file and sha256", async () => {
  const { createHash } = await import("node:crypto");
  const body = `module.exports = "${R2_PATH}";\n`;
  const sha = createHash("sha256").update(body).digest("hex");
  const plant = (dir) => {
    put(join(dir, "runtime", "node_modules", "doc-lib", "package.json"), '{ "name": "doc-lib", "version": "3.1.0" }\n');
    put(join(dir, "runtime", "node_modules", "doc-lib", "index.js"), body);
  };
  const base = { rule: "R4", target: "T1", host: "www.w3.org", reason: "SVG namespace identifier, never fetched." };
  const entry = { rule: "R2", target: "T3", package: "doc-lib@3.1.0", file: "runtime/node_modules/doc-lib/index.js", sha256: sha, reason: "A home-directory example in the library's documentation string; never used as a path." };
  assert.equal(scanAssets(tree({ plant, allow: [base, entry] })).code, 0);
  assert.equal(scanAssets(tree({ plant, allow: [base, { ...entry, sha256: "0".repeat(64) }] })).code, 1);
});

test("T-A10 a missing target is BLOCKED (exit 2), never a pass", () => {
  const args = tree();
  rmSync(args.web, { recursive: true });
  const r = runNode([TOOL, "--web", args.web, "--runtime", args.runtime, "--config", args.config, "--allowlist", args.allowlist]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^scan-assets: BLOCKED: .* not found; run pnpm -r build first$/m);
});

test("T-A10 R1 is a superset of scripts/check-no-cdn.mjs BANNED", () => {
  const text = readFileSync(join(REPO, "scripts", "check-no-cdn.mjs"), "utf8");
  const block = text.slice(text.indexOf("const BANNED = ["), text.indexOf("];", text.indexOf("const BANNED = [")));
  const hosts = [...block.matchAll(/\/([^/\n]+)\/i/g)].map((m) => m[1].replace(/\\\./g, "."));
  assert.ok(hosts.length >= 14, `parsed ${hosts.length} BANNED hosts`);
  for (const h of hosts) {
    assert.ok(R1_HOSTS.includes(h), `${h} in R1_HOSTS`);
    assert.ok(classifyHost(h, { urlContext: false }).includes("R1"), `${h} classified R1 outside a URL too`);
  }
});

test("T-A11 the real built SPA, runtime tree and configuration scan exits 0", (t) => {
  // MTH_RELEASE_SOURCE_DIR: a built source tree (e.g. the unpacked archive's source/ after build-from-archive.sh).
  const source = process.env.MTH_RELEASE_SOURCE_DIR ?? REPO;
  const web = join(source, "apps", "web", "dist");
  const runtime = process.env.MTH_RELEASE_RUNTIME_DIR;
  if (!existsSync(join(web, "index.html"))) return t.skip("BLOCKED: apps/web/dist not found; run pnpm -r build first");
  if (!runtime || !existsSync(join(runtime, "node_modules")))
    return t.skip("BLOCKED: no assembled runtime tree; set MTH_RELEASE_RUNTIME_DIR (deploy/scripts/assemble-runtime.sh)");
  const r = runNode([TOOL, "--web", web, "--runtime", runtime, "--config", source]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^scan-assets: PASS \(\d+ files; T1 \d+, T2 \d+, T3 [1-9]\d*\)$/m);
});
