// T-R18 (ADR-0064 A1.2 item 7, A1.8; p7-work-split §C.13; T-DG7-BE-R2): the migration wrappers, run from a throwaway
// copy of tools/migration/ whose root holds FAKE child CLIs (packages/db/src/cli.ts and
// apps/api/src/cli/transfer-attachments.ts) that record their arguments. No database is used and nothing approves
// anything (no G1-G6, Finance or IT approval); nothing reads or writes DG0-DG7.
//   node --test tools/migration/tests/wrappers.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const FAKE = `// SYNTHETIC fake CLI for the wrapper tests: records its argv, prints one line, exits with FAKE_EXIT.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.indexOf("--out");
if (args[0] === "verify" && out >= 0) writeFileSync(args[out + 1], "{}\\n");
const rep = args.indexOf("--attachments-report");
const seen = rep >= 0 ? existsSync(args[rep + 1]) : null;
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, reportExists: seen }) + "\\n");
console.log("fake: " + args[0]);
const scoped = process.env.FAKE_EXIT_FOR;
process.exit(scoped === undefined || scoped === "" || scoped === args[0] ? Number(process.env.FAKE_EXIT ?? "0") : 0);
`;

function workspace({ attachments }) {
  const root = mkdtempSync(join(tmpdir(), "mth-wrappers-"));
  temps.push(root);
  mkdirSync(join(root, "tools", "migration"), { recursive: true });
  for (const f of ["prepare-target.mjs", "import.mjs", "reconcile.mjs"])
    cpSync(join(here, f), join(root, "tools", "migration", f));
  mkdirSync(join(root, "packages", "db", "src"), { recursive: true });
  writeFileSync(join(root, "packages", "db", "src", "cli.ts"), FAKE);
  mkdirSync(join(root, "apps", "api", "src", "cli"), { recursive: true });
  writeFileSync(join(root, "apps", "api", "src", "cli", "transfer-attachments.ts"), FAKE);
  const pkg = join(root, "pkg");
  mkdirSync(pkg);
  writeFileSync(join(pkg, "manifest.json"), JSON.stringify({ attachmentManifest: { count: attachments } }));
  const log = join(root, "calls.ndjson");
  writeFileSync(log, "");
  const scratch = join(root, "tmp");
  mkdirSync(scratch);
  const run = (script, args, exit = "0", exitFor = "") =>
    spawnSync(process.execPath, [join(root, "tools", "migration", script), ...args], {
      encoding: "utf8",
      env: { ...process.env, FAKE_LOG: log, FAKE_EXIT: exit, FAKE_EXIT_FOR: exitFor, TMPDIR: scratch },
    });
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l));
  return { root, pkg, run, calls, scratch };
}

describe("T-R18: prepare-target.mjs", () => {
  it("requires --from (exit 2 with the C.13 line)", () => {
    const w = workspace({ attachments: 0 });
    const r = w.run("prepare-target.mjs", []);
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), "prepare-target: refused: --from <dir> is required");
    assert.deepEqual(w.calls(), []);
  });

  it("runs mth-db migrate --reserve-audit-seq-for <dir> and passes the child's exit code and lines through", () => {
    for (const exit of ["0", "1", "2"]) {
      const w = workspace({ attachments: 0 });
      const r = w.run("prepare-target.mjs", ["--from", w.pkg], exit);
      assert.equal(r.status, Number(exit));
      assert.equal(r.stdout.trim(), "fake: migrate");
      assert.deepEqual(w.calls()[0].args, ["migrate", "--reserve-audit-seq-for", w.pkg]);
    }
  });
});

describe("T-R18: import.mjs", () => {
  it("copy-in, then verify --out, then import-migration --attachments-report; no report left behind", () => {
    const w = workspace({ attachments: 2 });
    const r = w.run("import.mjs", ["--from", w.pkg, "--operator", "Synthetic operator"]);
    assert.equal(r.status, 0, r.stderr);
    const c = w.calls();
    assert.deepEqual(
      c.map((x) => x.args[0]),
      ["copy-in", "verify", "import-migration"],
    );
    assert.equal(c[2].reportExists, true);
    assert.deepEqual(readdirSync(w.scratch), []);
  });

  it("--keep-reports <dir> keeps the verify report; without it none is left, also after a failed import", () => {
    let w = workspace({ attachments: 1 });
    const keep = join(w.root, "kept");
    let r = w.run("import.mjs", ["--from", w.pkg, "--operator", "Synthetic operator", "--keep-reports", keep]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(keep, "attachments-verify.json")), true);
    w = workspace({ attachments: 1 });
    r = w.run("import.mjs", ["--from", w.pkg, "--operator", "Synthetic operator"], "4", "import-migration");
    assert.equal(r.status, 4);
    assert.deepEqual(readdirSync(w.scratch), []);
  });

  it("a package without attachments runs no copy-in or verify and passes no report", () => {
    const w = workspace({ attachments: 0 });
    const r = w.run("import.mjs", ["--from", w.pkg, "--operator", "Synthetic operator"]);
    assert.equal(r.status, 0);
    const c = w.calls();
    assert.deepEqual(c.map((x) => x.args[0]), ["import-migration"]);
    assert.equal(c[0].args.includes("--attachments-report"), false);
  });
});

describe("T-R18: reconcile.mjs --from", () => {
  it("runs verify exactly when the package lists attachments, and passes mode 2 flags through", () => {
    let w = workspace({ attachments: 3 });
    let r = w.run("reconcile.mjs", ["--operator", "Synthetic operator", "--from", w.pkg]);
    assert.equal(r.status, 0, r.stderr);
    let c = w.calls();
    assert.deepEqual(c.map((x) => x.args[0]), ["verify", "reconcile-migration"]);
    assert.equal(c[1].reportExists, true);
    assert.deepEqual(readdirSync(w.scratch), []);
    w = workspace({ attachments: 0 });
    const allow = join(w.root, "allow.json");
    r = w.run("reconcile.mjs", ["--operator", "Synthetic operator", "--from", w.pkg, "--after-use", "--allow", allow], "4");
    assert.equal(r.status, 4);
    c = w.calls();
    assert.deepEqual(c.map((x) => x.args[0]), ["reconcile-migration"]);
    assert.deepEqual(c[0].args, [
      "reconcile-migration",
      "--operator",
      "Synthetic operator",
      "--after-use",
      "--from",
      w.pkg,
      "--allow",
      allow,
    ]);
  });
});
