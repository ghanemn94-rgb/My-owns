// T-A1, T-A2, T-A4 (ADR-0062 §2–§4, §9) and the A.3 refusals of build-archive.mjs.
//   T-A1  two builds of the same commit and demo-data input are byte-identical (.tar and .tar.gz); gzip OS 255, mtime 0
//   T-A2  --verify passes a fresh archive and fails each of the 7 tamper cases
//   T-A4  source/ hashes to `node tools/gates/candidate.mjs --stage DG7` for the same commit, on a disposable clone
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { ARCHIVE_README_TEXT, buildArchive, verifyArchive } from "../build-archive.mjs";
import { gzipDeterministic, readTar, writeTar } from "../lib/tar.mjs";
import { DEMO_FIXTURE, fixtureRepo, HERE, REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(HERE, "..", "build-archive.mjs");
const cleanup = [];
let repo;
let first;
let second;
before(async () => {
  repo = fixtureRepo();
  const a = tmp("ba-a");
  const b = tmp("ba-b");
  cleanup.push(repo.dir, a, b);
  first = await buildArchive({ repo: repo.dir, commit: repo.commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: a });
  second = await buildArchive({ repo: repo.dir, commit: repo.commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: b });
});
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sha = (p) => execFileSync("sha256sum", [p]).toString().slice(0, 64);

test("T-A1 two builds of the same inputs are byte-identical (.tar and .tar.gz)", () => {
  assert.equal(first.tarSha256, second.tarSha256);
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.ok(readFileSync(first.archivePath).equals(readFileSync(second.archivePath)));
  const gz = readFileSync(first.archivePath);
  assert.equal(gz[9], 255, "gzip OS byte");
  assert.equal(gz.readUInt32LE(4), 0, "gzip mtime");
  assert.equal(sha(first.archivePath), first.archiveSha256);
  assert.equal(readFileSync(`${first.archivePath}.sha256`, "utf8"), `${first.archiveSha256}  ${first.name}.tar.gz\n`);
});

test("layout, manifest and README: four role directories, copies, exclusions, no wall clock", () => {
  const entries = [...readTar(gunzipSync(readFileSync(first.archivePath)))];
  const files = new Map(entries.filter((e) => e.type === "file").map((e) => [e.path.slice(first.name.length + 1), e]));
  assert.match(first.name, /^mth-transformation-hub-9\.8\.7-[0-9a-f]{12}-REHEARSAL$/);
  for (const p of [
    "source/package.json",
    "source/scripts/run.sh",
    "infra/deploy/compose/compose.yaml",
    "infra/.env.example",
    "infra/licenses/inventory.csv",
    "infra/manifests/package.json",
    "infra/manifests/apps/web/package.json",
    "infra/manifests/pnpm-lock.yaml",
    "docs/handover/README.md",
    "docs/operations/guide.md",
    "docs/delivery/requirements.csv",
    "demo-data/manifest.json",
    "demo-data/README.txt",
    "ARCHIVE-MANIFEST.json",
    "SHA256SUMS",
    "README.txt",
  ])
    assert.ok(files.has(p), p);
  for (const p of [
    "source/docs/delivery/reviews/DG7/round-1/qa.json",
    "source/docs/delivery/findings.json",
    "source/trading_agent/notes.txt",
    "docs/other.md",
  ])
    assert.ok(!files.has(p), `${p} must not be archived`);
  assert.equal(files.get("source/scripts/run.sh").mode, 0o755);
  const m = JSON.parse(files.get("ARCHIVE-MANIFEST.json").data.toString("utf8"));
  assert.deepEqual(Object.keys(m), [
    "schemaVersion",
    "product",
    "version",
    "candidateId",
    "sourceCommit",
    "rehearsal",
    "mtime",
    "tool",
    "layout",
    "demoData",
    "copies",
  ]);
  assert.equal(m.rehearsal, true);
  assert.equal(m.sourceCommit, repo.commit);
  assert.equal(m.mtime, 946684800);
  assert.deepEqual(
    m.layout.map((l) => [l.dir, l.role]),
    [
      ["source", "app"],
      ["infra", "infra"],
      ["docs", "docs"],
      ["demo-data", "demo-data"],
    ],
  );
  assert.equal(m.demoData.synthetic, true);
  assert.match(m.demoData.inputSha256, /^[0-9a-f]{64}$/);
  assert.equal(m.demoData.demoChecksum, JSON.parse(readFileSync(join(DEMO_FIXTURE, "manifest.json"))).demoChecksum);
  const manifestText = files.get("ARCHIVE-MANIFEST.json").data.toString("utf8");
  assert.doesNotMatch(manifestText, /20\d\d-\d\d-\d\dT/, "no wall-clock time in the manifest");
  assert.equal(files.get("README.txt").data.toString("utf8"), ARCHIVE_README_TEXT.replace("<version>", m.version));
});

/** Rewrites an archive through a transform of its entries; returns the new path and its sha256. */
function tamper(transform, label) {
  const entries = [...readTar(gunzipSync(readFileSync(first.archivePath)))].filter((e) => e.type === "file");
  const top = first.name;
  let files = entries.map((e) => ({ path: e.path, data: Buffer.from(e.data), mode: e.mode }));
  files = transform(files, top);
  const dir = tmp(`tamper-${label}`);
  cleanup.push(dir);
  const p = join(dir, `${top}.tar.gz`);
  writeFileSync(p, gzipDeterministic(writeTar(files)));
  return { path: p, sha256: sha(p) };
}

/** Recomputes SHA256SUMS so a tamper is isolated to the check it targets. */
function resum(files, top) {
  const crypto = (b) => execFileSync("sha256sum", { input: b }).toString().slice(0, 64);
  const lines = files
    .filter((f) => f.path !== `${top}/SHA256SUMS`)
    .map((f) => `${crypto(f.data)}  ${f.path.slice(top.length + 1)}\n`)
    .sort((a, b) => Buffer.compare(Buffer.from(a.slice(66)), Buffer.from(b.slice(66))))
    .join("");
  return [...files.filter((f) => f.path !== `${top}/SHA256SUMS`), { path: `${top}/SHA256SUMS`, data: Buffer.from(lines), mode: 0o644 }];
}

const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);

test("T-A2 --verify passes a fresh archive (CLI exit 0, 7 checks)", () => {
  const r = runNode([TOOL, "--verify", first.archivePath, "--expect-sha256", first.archiveSha256, "--candidate", first.manifest.candidateId]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 8);
  assert.match(r.stdout, /^1 archive-checksum: ok$/m);
  assert.match(r.stdout, /^7 determinism-metadata: ok$/m);
  assert.match(r.stdout, /^archive-verify: PASS$/m);
});

test("T-A2 tamper: one changed byte in a source/ file fails sha256sums and candidate-id", async () => {
  const t = tamper(
    (files, top) =>
      files.map((f) =>
        f.path === `${top}/source/apps/web/src/index.ts` ? { ...f, data: Buffer.from(f.data.toString().replace("s", "S")) } : f,
      ),
    "byte",
  );
  const r = await verifyArchive(t.path, { expectSha256: t.sha256 });
  assert.equal(r.ok, false);
  assert.deepEqual(failed(r), ["sha256sums", "candidate-id"]);
});

test("T-A2 tamper: a removed file fails sha256sums", async () => {
  const t = tamper((files, top) => files.filter((f) => f.path !== `${top}/docs/operations/guide.md`), "removed");
  const r = await verifyArchive(t.path, { expectSha256: t.sha256 });
  assert.deepEqual(failed(r), ["sha256sums"]);
});

test("T-A2 tamper: an added top-level directory fails layout", async () => {
  const t = tamper((files, top) => resum([...files, { path: `${top}/evidence/x.json`, data: Buffer.from("{}"), mode: 0o644 }], top), "added");
  const r = await verifyArchive(t.path, { expectSha256: t.sha256 });
  assert.deepEqual(failed(r), ["layout"]);
  assert.match(r.checks.find((c) => c.id === "layout").detail, /unexpected top-level directory evidence\//);
});

test("T-A2 tamper: a missing role directory fails layout", async () => {
  const t = tamper((files, top) => resum(files.filter((f) => !f.path.startsWith(`${top}/demo-data/`)), top), "missing-role");
  const r = await verifyArchive(t.path, { expectSha256: t.sha256 });
  assert.deepEqual(failed(r), ["layout"]);
  assert.match(r.checks.find((c) => c.id === "layout").detail, /role demo-data missing/);
});

test("T-A2 tamper: a wrong --expect-sha256 fails archive-checksum (CLI exit 1)", () => {
  const wrong = first.archiveSha256.replace(/^./, (c) => (c === "0" ? "1" : "0"));
  const r = runNode([TOOL, "--verify", first.archivePath, "--expect-sha256", wrong]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^1 archive-checksum: FAIL /m);
  assert.match(r.stdout, /^archive-verify: FAIL \(1 checks\)$/m);
});

test("T-A2 tamper: a wrong --candidate fails candidate-id", async () => {
  const r = await verifyArchive(first.archivePath, { expectSha256: first.archiveSha256, candidate: `sha256:${"0".repeat(64)}` });
  assert.deepEqual(failed(r), ["candidate-id"]);
});

test("T-A2 tamper: an infra/ copy differing from source/ fails copies", async () => {
  const t = tamper(
    (files, top) =>
      resum(
        files.map((f) => (f.path === `${top}/infra/.env.example` ? { ...f, data: Buffer.from("DATABASE_URL=changed\n") } : f)),
        top,
      ),
    "copy",
  );
  const r = await verifyArchive(t.path, { expectSha256: t.sha256 });
  assert.deepEqual(failed(r), ["copies"]);
});

test("--verify is BLOCKED (exit 2) for a missing argument, an unreadable file or a non-gzip file", () => {
  assert.equal(runNode([TOOL, "--verify", first.archivePath]).code, 2);
  assert.equal(runNode([TOOL, "--verify", "/nonexistent.tar.gz", "--expect-sha256", "0".repeat(64)]).code, 2);
  const dir = tmp("notgz");
  cleanup.push(dir);
  writeFileSync(join(dir, "x.tar.gz"), "plain text");
  const r = runNode([TOOL, "--verify", join(dir, "x.tar.gz"), "--expect-sha256", "0".repeat(64)]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /BLOCKED/);
});

test("refusals: demo-data without manifest (2), fixture in a release build (1), wrong marker (1)", () => {
  const base = [TOOL, "--repo", repo.dir, "--commit", repo.commit, "--out", tmp("ba-refuse")];
  const empty = tmp("demo-empty");
  cleanup.push(empty, base.at(-1));
  let r = runNode([...base, "--demo-data", empty]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr.trim(), "build-archive: demo-data has no manifest.json");
  r = runNode([...base, "--demo-data", DEMO_FIXTURE]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "build-archive: the fixture demo-data cannot be used for a release build");
  const prod = tmp("demo-prod");
  cleanup.push(prod);
  cpSync(DEMO_FIXTURE, prod, { recursive: true });
  const m = JSON.parse(readFileSync(join(prod, "manifest.json")));
  delete m.fixture;
  m.sourceEnvironment = "production";
  writeFileSync(join(prod, "manifest.json"), JSON.stringify(m));
  r = runNode([...base, "--demo-data", prod]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "build-archive: demo-data is not a synthetic demo export (environment marker 'production')");
  m.sourceEnvironment = "demo";
  writeFileSync(join(prod, "manifest.json"), JSON.stringify(m));
  r = runNode([...base, "--demo-data", prod]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /mth-transformation-hub-9\.8\.7-[0-9a-f]{12}\.tar\.gz/);
  assert.doesNotMatch(r.stdout, /REHEARSAL/);
});

test("refusals: a wrong --candidate (1), a symlink in the commit (1)", () => {
  const out = tmp("ba-cand");
  cleanup.push(out);
  const expected = `sha256:${"a".repeat(64)}`;
  let r = runNode([TOOL, "--repo", repo.dir, "--commit", repo.commit, "--demo-data", DEMO_FIXTURE, "--rehearsal", "--candidate", expected, "--out", out]);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr.trim(),
    `build-archive: the files at ${repo.commit} hash to ${first.manifest.candidateId}, not the expected ${expected}`,
  );
  const linked = fixtureRepo({ extra: ({ dir }) => symlinkSync("package.json", join(dir, "link.json")) });
  cleanup.push(linked.dir);
  r = runNode([TOOL, "--repo", linked.dir, "--commit", linked.commit, "--demo-data", DEMO_FIXTURE, "--rehearsal", "--out", out]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), "build-archive: link.json: symlinks and submodules are not archived");
});

test("refusal: a path with a control character in the commit (1)", () => {
  const bad = fixtureRepo({ extra: ({ put }) => put("apps/web/src/bad\u0001name.ts", "x\n") });
  const out = tmp("ba-path");
  cleanup.push(bad.dir, out);
  const r = runNode([TOOL, "--repo", bad.dir, "--commit", bad.commit, "--demo-data", DEMO_FIXTURE, "--rehearsal", "--out", out]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), `build-archive: refused path ${JSON.stringify("apps/web/src/bad\u0001name.ts")}`);
});

test("T-A4 source/ hashes to `node tools/gates/candidate.mjs --stage DG7` on a disposable clone", async () => {
  const clone = tmp("ta4-clone");
  const out = tmp("ta4-out");
  cleanup.push(clone, out);
  const commit = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"]).toString().trim();
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", REPO, clone]);
  // Sparse working tree (the delivery records are gigabytes): only the gate tool and the stage spec are checked out;
  // `--ref <commit>` makes the tool hash the committed tree of the clone, the same input the archive reads.
  execFileSync("git", ["-C", clone, "sparse-checkout", "set", "--no-cone", "/tools/gates/", "/docs/delivery/stages.json"]);
  execFileSync("git", ["-C", clone, "checkout", "-q", commit], { stdio: "ignore" });
  const cli = JSON.parse(
    execFileSync(process.execPath, [join(clone, "tools", "gates", "candidate.mjs"), "--stage", "DG7", "--ref", commit]).toString(),
  );
  const built = await buildArchive({ repo: clone, commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: out });
  assert.equal(built.manifest.candidateId, cli.candidate_id);
  const v = await verifyArchive(built.archivePath, { expectSha256: built.archiveSha256, candidate: cli.candidate_id });
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
  assert.ok(!existsSync(join(out, "source")), "nothing is extracted to disk");
});
