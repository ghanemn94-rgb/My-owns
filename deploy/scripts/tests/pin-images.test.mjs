// Self-test of deploy/scripts/pin-images.mjs (ADR-0011; F-DG1-108/F-DG1-203; D-049). OFFLINE.
// Every case runs in a disposable copy of the files the script reads (lock, Dockerfile, Compose, both CI copies).
// The digests used here are TEST-ONLY placeholders (sha256:aaaa…, sha256:bbbb…) written to the temp copy only — they
// are never real image digests and never touch deploy/images.lock.json. `--resolve` runs against a STUB `docker`
// on PATH that answers for docker.io/mcr and fails like the denied quay.io proxy, so the BLOCKED path is exercised
// without network.
//
//   node --test deploy/scripts/tests/pin-images.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pin-images-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const FILES = [
  "deploy/images.lock.json",
  "deploy/scripts/pin-images.mjs",
  "deploy/docker",
  "deploy/compose",
  ".github/workflows/ci.yml",
  "deploy/ci/ci.yml",
];
const FAKE = (c) => `sha256:${c.repeat(64)}`; // TEST-ONLY placeholder digests
let n = 0;
function tree() {
  const t = join(scratch, `t${++n}`);
  for (const f of FILES) if (existsSync(join(root, f))) cpSync(join(root, f), join(t, f), { recursive: true });
  return t;
}
const lockOf = (t) => JSON.parse(readFileSync(join(t, "deploy/images.lock.json"), "utf8"));
const writeLock = (t, l) => writeFileSync(join(t, "deploy/images.lock.json"), `${JSON.stringify(l, null, 2)}\n`);
const pin = (t, args, env = {}) => {
  const r = spawnSync(process.execPath, [join(t, "deploy/scripts/pin-images.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const pinAll = (l, except = []) =>
  l.images.forEach((img, i) => {
    if (except.includes(img.id)) return;
    img.digest = FAKE("abcd"[i]);
    img.verifiedAt = "2026-10-01T00:00:00.000Z";
  });

test("C1 committed lock: --check exits 1 and reports every null digest as NOT PINNED (honest, never a pass)", () => {
  const r = pin(tree(), ["--check"]);
  assert.equal(r.status, 1, r.out);
  assert.equal((r.out.match(/^NOT PINNED /gm) ?? []).length, lockOf(root).images.filter((i) => !i.digest).length);
  assert.doesNotMatch(r.out, /^OK:/m);
});

test("C2 all digests recorded: --apply then --check exits 0; only image reference lines change", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  writeLock(t, l);
  const before = Object.fromEntries(
    ["deploy/docker/Dockerfile", "deploy/compose/compose.yaml", ".github/workflows/ci.yml", "deploy/ci/ci.yml"]
      .filter((f) => existsSync(join(t, f)))
      .map((f) => [f, readFileSync(join(t, f), "utf8").split("\n")]),
  );
  const a = pin(t, ["--apply"]);
  assert.equal(a.status, 0, a.out);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /^OK: 4 images pinned by digest/m);
  let changed = 0;
  for (const [f, lines] of Object.entries(before)) {
    const now = readFileSync(join(t, f), "utf8").split("\n");
    assert.equal(now.length, lines.length, f);
    lines.forEach((line, i) => {
      if (line === now[i]) return;
      changed++;
      assert.equal(now[i].replace(/@sha256:[0-9a-f]{64}/, ""), line, `${f}:${i + 1} changed beyond the digest`);
    });
  }
  // Dockerfile 1 + compose 2 + ci.yml 3 (+3 for the staged copy when present)
  assert.equal(
    changed,
    existsSync(join(t, "deploy/ci/ci.yml")) && existsSync(join(t, ".github/workflows/ci.yml")) ? 9 : 6,
  );
});

test("C3 keycloak BLOCKED (blockedReason, null digest), others pinned: --apply skips it, --check still exits 1", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l, ["keycloak"]);
  l.images.find((i) => i.id === "keycloak").blockedReason = "BLOCKED: quay.io denied by the environment egress policy";
  writeLock(t, l);
  const a = pin(t, ["--apply"]);
  assert.equal(a.status, 0, a.out);
  assert.match(a.out, /NOT APPLIED keycloak .*BLOCKED: quay\.io denied/);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1, c.out);
  assert.match(c.out, /^BLOCKED +keycloak \(test-ci\)/m);
  assert.equal((c.out.match(/^PINNED /gm) ?? []).length, 3);
  assert.match(c.out, /FAIL: keycloak .*BLOCKED, not pinned/);
  assert.match(c.out, /compose\.yaml: quay\.io\/keycloak\/keycloak:26\.4 has no digest/);
});

test("C4 structure: blockedReason together with a digest is contradictory", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  l.images[0].blockedReason = "BLOCKED: x";
  writeLock(t, l);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1);
  assert.match(c.out, /blockedReason is set but a digest is pinned/);
});

test("C5 structure: missing blockedReason field, bad scope, digest without verifiedAt, malformed digest", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  delete l.images[0].blockedReason;
  l.images[1].scope = "prod";
  l.images[2].verifiedAt = null;
  l.images[3].digest = "sha256:XYZ";
  writeLock(t, l);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1);
  assert.match(c.out, /blockedReason field missing/);
  assert.match(c.out, /scope must be one of/);
  assert.match(c.out, /a digest needs verifiedAt/);
  assert.match(c.out, /digest must be null or sha256/);
});

test("C6 completeness: an image referenced in Compose but absent from the lock fails", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  writeLock(t, l);
  pin(t, ["--apply"]);
  const f = join(t, "deploy/compose/compose.yaml");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n  rogue:\n    image: redis:7\n`);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1);
  assert.match(c.out, /compose\.yaml:\d+: image redis:7 is not in deploy\/images\.lock\.json/);
});

test("C7 completeness: a file using an image but missing from its usedIn fails", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  writeLock(t, l);
  pin(t, ["--apply"]);
  const pg = l.images.find((i) => i.id === "postgres");
  pg.usedIn = pg.usedIn.filter((f) => f !== "deploy/compose/compose.yaml");
  writeLock(t, l);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1);
  assert.match(c.out, /compose\.yaml:\d+: postgres:18@sha256:[0-9a-f]+ used but not in postgres\.usedIn/);
});

test("C8 a file digest that differs from the lock fails", () => {
  const t = tree();
  const l = lockOf(t);
  pinAll(l);
  writeLock(t, l);
  pin(t, ["--apply"]);
  l.images.find((i) => i.id === "postgres").digest = FAKE("e");
  writeLock(t, l);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1);
  assert.match(c.out, /postgres:18@sha256:b+ differs from the lock/);
});

test("C9 --resolve with a denied registry (stub docker): reachable images recorded, quay.io BLOCKED, exit 1", () => {
  const t = tree();
  const bin = join(scratch, `bin${n}`);
  mkdirSync(bin);
  // STUB docker: answers `buildx imagetools inspect <ref>` with a placeholder digest; fails for quay.io like the proxy.
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
case "$4" in
  quay.io/*) echo "ERROR: failed to do request: Head \\"https://quay.io/v2/...\\": Forbidden (CONNECT 403)" >&2; exit 1 ;;
  node:*) d=1 ;; postgres:*) d=2 ;; *) d=3 ;;
esac
printf '{"digest":"sha256:%064d"}\\n' "$d"
`,
  );
  chmodSync(join(bin, "docker"), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const r = pin(t, ["--resolve"], env);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /BLOCKED quay\.io\/keycloak\/keycloak:26\.4: .*CONNECT 403/);
  const l = lockOf(t);
  const kc = l.images.find((i) => i.id === "keycloak");
  assert.equal(kc.digest, null);
  assert.match(kc.blockedReason, /^BLOCKED: --resolve at .* could not reach the registry: .*CONNECT 403/);
  for (const id of ["node-runtime", "postgres", "playwright"]) {
    const img = l.images.find((i) => i.id === id);
    assert.match(img.digest, /^sha256:[0-9a-f]{64}$/, id);
    assert.ok(img.verifiedAt, id);
    assert.equal(img.blockedReason, null, id);
  }
  assert.equal(pin(t, ["--apply"]).status, 0);
  const c = pin(t, ["--check"]);
  assert.equal(c.status, 1, "a BLOCKED image must keep --check failing");
  assert.match(c.out, /^BLOCKED +keycloak/m);
  // A later failure never nulls an existing pin
  writeFileSync(join(bin, "docker"), "#!/bin/sh\necho 'network down' >&2; exit 1\n");
  const r2 = pin(t, ["--resolve", "postgres"], env);
  assert.equal(r2.status, 1);
  assert.match(r2.out, /existing pin sha256:0+2 KEPT/);
  assert.match(lockOf(t).images.find((i) => i.id === "postgres").digest, /^sha256:0+2$/);
});
