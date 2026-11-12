// Self-test of deploy/scripts/check-virtual-store.mjs, the shipped-set layout check of assemble-runtime.sh
// (T-DG7-DO-A2, D-246 P-1 and P-2).
//   node --test deploy/scripts/tests/check-virtual-store.test.mjs
// P-1 regression: the earlier inline expression `d.replace(/_.*$/, "")` turned `string_decoder@1.1.1` into `string`
// and refused a correct runtime tree. Only pnpm's peer suffix after the version may be stripped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkVirtualStore, parseVirtualStoreDir } from "../check-virtual-store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(root, "deploy", "scripts", "check-virtual-store.mjs");
const assemble = join(root, "deploy", "scripts", "assemble-runtime.sh");
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "check-virtual-store-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const CSV = [
  "name,version,license,scope,direct_dependency_of,integrity,procurement,procurement_reason",
  "string_decoder,1.1.1,MIT,runtime,,sha512-x,not_required,",
  "react-dom,19.1.0,MIT,bundled,apps/web,sha512-x,not_required,",
  "@scope/under_score,2.0.0,MIT,runtime,,sha512-x,not_required,",
  "@fastify/ajv-compiler,4.0.2,MIT,runtime,,sha512-x,not_required,",
  "typescript,5.9.3,Apache-2.0,development,,sha512-x,not_required,",
  "",
].join("\n");

test("P-1: names containing `_` are kept; only the peer suffix after the version is stripped", () => {
  const cases = [
    ["string_decoder@1.1.1", "string_decoder", "1.1.1"],
    ["react-dom@19.1.0_react@19.1.0", "react-dom", "19.1.0"],
    ["string_decoder@1.1.1_safe-buffer@5.1.2", "string_decoder", "1.1.1"],
    ["@fastify+ajv-compiler@4.0.2", "@fastify/ajv-compiler", "4.0.2"],
    ["@scope+under_score@2.0.0_typescript@5.9.3", "@scope/under_score", "2.0.0"],
    ["pkg@1.0.0-rc.1+build.5", "pkg", "1.0.0-rc.1+build.5"],
  ];
  for (const [d, name, version] of cases) assert.deepEqual(parseVirtualStoreDir(d), { name, version }, d);
  for (const d of ["no-version", "@scope+only", "", "a@"]) assert.equal(parseVirtualStoreDir(d), null, d);
});

function store(name, dirs) {
  const s = join(dir, name, "node_modules", ".pnpm");
  mkdirSync(join(s, "node_modules"), { recursive: true });
  writeFileSync(join(s, "lock.yaml"), "lockfileVersion: '9.0'\n");
  for (const d of dirs) mkdirSync(join(s, d, "node_modules"), { recursive: true });
  return s;
}

test("a runtime store with string_decoder and a peer-suffixed react-dom passes (module and CLI)", () => {
  const s = store("ok", [
    "string_decoder@1.1.1",
    "react-dom@19.1.0_react@19.1.0",
    "@scope+under_score@2.0.0",
    "@fastify+ajv-compiler@4.0.2",
  ]);
  assert.deepEqual(checkVirtualStore(s, CSV), { packages: 4, shipped: 4, extra: [] });
  writeFileSync(join(dir, "inventory.csv"), CSV);
  const r = spawnSync(process.execPath, [script, s, join(dir, "inventory.csv")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "virtual store: 4 package directories, all in the shipped set (4 runtime+bundled)\n");
});

test("development, unknown-version and unparseable directories fail with exit 1 and are named", () => {
  const s = store("bad", ["string_decoder@1.1.1", "typescript@5.9.3", "string_decoder@1.3.0", "weird"]);
  assert.deepEqual(checkVirtualStore(s, CSV).extra, ["string_decoder@1.3.0", "typescript@5.9.3", "weird"]);
  writeFileSync(join(dir, "inventory.csv"), CSV);
  const r = spawnSync(process.execPath, [script, s, join(dir, "inventory.csv")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "not in the shipped set: string_decoder@1.3.0, typescript@5.9.3, weird\n");
});

test("usage error and unreadable input exit 2 (BLOCKED), never 0", () => {
  assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 2);
  const r = spawnSync(process.execPath, [script, join(dir, "missing"), join(dir, "missing.csv")], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^check-virtual-store: BLOCKED: ENOENT/);
});

test("assemble-runtime.sh uses this check and strips the pnpm metadata (P-1, P-2)", () => {
  const sh = readFileSync(assemble, "utf8");
  assert.ok(!sh.includes("replace(/_.*$/"), "the P-1 expression must not come back");
  assert.match(
    sh,
    /node "\$HERE\/check-virtual-store\.mjs" "\$OUT\/node_modules\/\.pnpm" "\$WS\/licenses\/inventory\.csv"/,
  );
  assert.match(
    sh,
    /rm -f "\$OUT\/node_modules\/\.modules\.yaml" "\$OUT\/node_modules\/\.pnpm-workspace-state-v1\.json"/,
  );
  assert.match(sh, /find "\$OUT" -type d -name \.bin -path '\*\/node_modules\/\.bin' -prune -exec rm -rf \{\} \+/);
  // the strip runs before the layout verification that asserts it
  assert.ok(sh.indexOf('rm -f "$OUT/node_modules/.modules.yaml"') < sh.indexOf("# 4) layout verification"));
});
