// T-A5 (ADR-0062 §5.1; REQ-S19-002): the build from the archive inside a network namespace exits 0; the network
// probe failure is asserted; there is no .git; install, build, runtime assembly and asset scan all succeed.
// Needs: a filled pnpm store (MTH_PNPM_STORE, else `pnpm store path`), a network namespace (unshare or bwrap), and
// about 1 GiB of scratch. A missing store or namespace makes the test SKIP with a BLOCKED reason, never pass.
// The archive is built from MTH_RELEASE_REPO (default: this repository) at MTH_RELEASE_COMMIT (default: its HEAD),
// with the fixture demo-data as a rehearsal. Also covered without a store: the checksum refusal and the usage error.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildArchive } from "../build-archive.mjs";
import { DEMO_FIXTURE, fixtureRepo, HERE, REPO, tmp } from "./helpers.mjs";

const SCRIPT = join(HERE, "..", "build-from-archive.sh");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

function store() {
  if (process.env.MTH_PNPM_STORE) return process.env.MTH_PNPM_STORE;
  const r = spawnSync("pnpm", ["store", "path"]);
  return r.status === 0 ? r.stdout.toString().trim() : null;
}

test("checksum mismatch exits 1 before unpacking; usage error exits 2", async () => {
  const repo = fixtureRepo();
  const out = tmp("bfa-sum");
  const work = tmp("bfa-work");
  cleanup.push(repo.dir, out, work);
  const built = await buildArchive({ repo: repo.dir, commit: repo.commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: out });
  const r = spawnSync("bash", [SCRIPT, built.archivePath, "--sha256", "0".repeat(64), "--store", out, "--work", work]);
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /archive checksum [0-9a-f]{64} does not match 0{64}/);
  assert.equal(spawnSync("ls", ["-A", work]).stdout.toString(), "", "nothing unpacked");
  assert.equal(spawnSync("bash", [SCRIPT, built.archivePath]).status, 2);
});

test("T-A5 the build from the archive inside a network namespace exits 0", { timeout: 1_800_000 }, async (t) => {
  const s = store();
  if (!s || !existsSync(s)) return t.skip("BLOCKED: no pnpm store (set MTH_PNPM_STORE or install pnpm)");
  const ns =
    spawnSync("unshare", ["--user", "--map-root-user", "--net", "true"]).status === 0 ||
    spawnSync("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "true"]).status === 0;
  if (!ns) return t.skip("BLOCKED: no network namespace (unshare and bwrap unavailable)");
  const repo = process.env.MTH_RELEASE_REPO ?? REPO;
  const commit = process.env.MTH_RELEASE_COMMIT ?? execFileSync("git", ["-C", repo, "rev-parse", "HEAD"]).toString().trim();
  const out = tmp("bfa-out");
  const work = tmp("bfa-build");
  cleanup.push(out, work);
  const built = await buildArchive({ repo, commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: out });
  const r = spawnSync("bash", [SCRIPT, built.archivePath, "--sha256", built.archiveSha256, "--store", s, "--work", work], {
    maxBuffer: 1 << 26,
  });
  const stdout = r.stdout.toString();
  if (r.status === 3) return t.skip(`BLOCKED: ${stdout.trim().split("\n").at(-1)}`);
  assert.match(stdout, /^probe tcp 1\.1\.1\.1:443: (failed \(\w+\)|timeout)$/m);
  assert.match(stdout, /^probe dns registry\.npmjs\.org: failed \(\w+\)$/m);
  assert.match(stdout, /^step unpack +exit 0 .*\(no source\/\.git\)$/m);
  for (const step of ["install", "build", "assemble", "check-no-cdn", "scan-assets"])
    assert.match(stdout, new RegExp(`^step ${step} +exit 0 `, "m"), `${step}\n${stdout}`);
  assert.match(stdout, /^sha256 apps\/web\/dist\/index\.html [0-9a-f]{64}$/m);
  assert.equal(r.status, 0, stdout + r.stderr.toString());
  assert.match(stdout, /^build-from-archive: PASS$/m);
});
