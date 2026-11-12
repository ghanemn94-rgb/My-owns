// T-A3 (ADR-0062 §3, §9): GNU tar 1.35 extracts the archive and `sha256sum -c SHA256SUMS` passes on the extracted
// tree; bsdtar likewise if installed, otherwise a SKIP reported as "bsdtar not installed" (never a pass).
// Plus the writer's unit rules: byte order, explicit directories, pax only when needed, 10240-byte record, refusals.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildArchive } from "../build-archive.mjs";
import { checkPath, DEFAULT_MTIME, gzipDeterministic, readTar, writeTar } from "../lib/tar.mjs";
import { DEMO_FIXTURE, fixtureRepo, tmp } from "./helpers.mjs";

const cleanup = [];
let built;
before(async () => {
  const repo = fixtureRepo({
    extra: ({ put }) => {
      put(`apps/web/src/${"deep/".repeat(30)}file.ts`, "export {};\n"); // > 155-byte prefix: pax header
      put("docs/handover/دليل.md", "# non-ASCII path (pax header)\n");
    },
  });
  const out = tmp("tar-out");
  cleanup.push(repo.dir, out);
  built = await buildArchive({ repo: repo.dir, commit: repo.commit, demoData: DEMO_FIXTURE, rehearsal: true, outDir: out });
});
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("T-A3 GNU tar extracts the archive and sha256sum -c SHA256SUMS passes", () => {
  const version = execFileSync("tar", ["--version"]).toString().split("\n")[0];
  assert.match(version, /GNU tar/);
  const dir = tmp("tar-gnu");
  cleanup.push(dir);
  execFileSync("tar", ["-xzf", built.archivePath, "-C", dir]);
  assert.deepEqual(readdirSync(dir), [built.name]);
  const r = spawnSync("sha256sum", ["-c", "--strict", "SHA256SUMS"], { cwd: join(dir, built.name) });
  assert.equal(r.status, 0, r.stdout.toString() + r.stderr.toString());
  assert.ok(r.stdout.toString().includes(`source/apps/web/src/${"deep/".repeat(30)}file.ts: OK`));
  assert.ok(r.stdout.toString().includes("docs/handover/دليل.md: OK"));
});

test("T-A3 bsdtar extracts the archive (SKIP when bsdtar is not installed)", (t) => {
  if (spawnSync("bsdtar", ["--version"]).error) {
    t.skip("bsdtar not installed");
    return;
  }
  const dir = tmp("tar-bsd");
  cleanup.push(dir);
  execFileSync("bsdtar", ["-xzf", built.archivePath, "-C", dir]);
  const r = spawnSync("sha256sum", ["-c", "--strict", "SHA256SUMS"], { cwd: join(dir, built.name) });
  assert.equal(r.status, 0);
});

test("writer: byte-order sort, explicit directories first, fixed metadata, 10240-byte record", () => {
  const tar = writeTar([
    { path: "a/z.txt", data: Buffer.from("z"), mode: 0o644 },
    { path: "a/B.txt", data: Buffer.from("b"), mode: 0o755 },
    { path: "a/é.txt", data: Buffer.from("e"), mode: 0o644 },
  ]);
  assert.equal(tar.length % 10240, 0);
  const entries = [...readTar(tar)];
  assert.deepEqual(
    entries.map((e) => e.path),
    ["a", "a/B.txt", "a/z.txt", "a/é.txt"],
  );
  for (const e of entries) {
    assert.equal(e.mtime, DEFAULT_MTIME);
    assert.equal(e.uid, 0);
    assert.equal(e.gid, 0);
    assert.equal(e.uname, "");
    assert.equal(e.gname, "");
  }
  assert.equal(entries[0].mode, 0o755);
  assert.equal(entries[1].mode, 0o755);
  assert.deepEqual(entries[3].paxKeys, ["path"]);
  assert.deepEqual(entries[1].paxKeys, []);
});

test("writer: a pax header only for long or non-ASCII paths, with exactly one path record", () => {
  const long = `${"x".repeat(120)}/${"y".repeat(99)}`;
  const longer = "z".repeat(160) + "/f";
  const entries = [...readTar(writeTar([long, longer].map((p) => ({ path: p, data: Buffer.alloc(0), mode: 0o644 }))))];
  const byPath = new Map(entries.map((e) => [e.path, e]));
  assert.deepEqual(byPath.get(long).paxKeys, []); // fits the ustar prefix/name split
  assert.deepEqual(byPath.get(longer).paxKeys, ["path"]);
});

test("writer refuses absolute, '..', control-character and empty-segment paths", () => {
  for (const p of ["/etc/passwd", "a/../b", "a/\u0001b", "a//b", ""]) assert.throws(() => checkPath(p), /refused path/);
  assert.throws(() => checkPath("a�b"), /refused path/);
  assert.throws(() => checkPath("ok", Buffer.from([0x6f, 0x6b, 0xff])), /refused path/);
});

test("gzip header: OS byte 255 and mtime 0", () => {
  const gz = gzipDeterministic(writeTar([{ path: "f", data: Buffer.from("x"), mode: 0o644 }]));
  assert.equal(gz[9], 255);
  assert.equal(gz.readUInt32LE(4), 0);
});
