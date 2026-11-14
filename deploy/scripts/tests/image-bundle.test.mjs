// T-B12 (p7-work-split §B.4; ADR-0069 §6 and Amendment 1 A1.2/A1.3; T-DG7-DO-E, T-DG7-DO-E2): deploy/scripts/image-bundle.sh's logic with a STUB `docker`
// on PATH that records every call and serves fixture outputs. It proves the manifest, checksum and refusal logic, not a
// real `docker load` (that is the orchestrator's host run, ADR-0069 §6-§7).
//   node --test deploy/scripts/tests/image-bundle.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "deploy/scripts/image-bundle.sh");
const LOCK = JSON.parse(readFileSync(join(REPO, "deploy/images.lock.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "mth-image-bundle-test-"));
after(() => rmSync(work, { recursive: true, force: true }));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fakeId = (name) => `sha256:${sha(`image ${name}`)}`;
// ADR-0069 A1.3: only the lock images that a Compose file runs are bundled; the others are listed in `excluded`.
const runByCompose = (i) => (i.usedIn ?? []).some((f) => f.startsWith("deploy/compose/"));
const lockNames = LOCK.images.filter(runByCompose).map((i) => `${i.ref}:${i.tag}@${i.digest}`);
const excludedLock = LOCK.images.filter((i) => !runByCompose(i));
const CONTAINERD = JSON.stringify([["driver-type", "io.containerd.snapshotter.v1"]]);
const APP = "mth-app:local";

// The stub: a Node script named `docker`. It appends its argv as one JSON line to $STUB_CALLS, and answers:
//   info                                 exit $STUB_INFO_EXIT (default 0); with --format, {{.Driver}} prints
//                                        $STUB_DRIVER and {{json .DriverStatus}} prints $STUB_DRIVER_STATUS
//   image inspect --format F <name>      "<id> <size>" or "<id>" from $STUB_IMAGES (JSON {name: id}); unknown -> exit 1
//   save -o <file> <names...>            writes deterministic bytes naming the images
//   load -i <file>                       prints "Loaded image: ..."
//   anything else                        exit 99 (so an unexpected call fails loudly)
function makeStub(dir) {
  mkdirSync(dir, { recursive: true });
  const stub = join(dir, "docker");
  writeFileSync(
    stub,
    `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_CALLS, JSON.stringify(a) + "\\n");
const images = JSON.parse(process.env.STUB_IMAGES || "{}");
if (a[0] === "info") {
  const code = Number(process.env.STUB_INFO_EXIT || "0");
  if (code === 0 && a[1] === "--format") console.log(a[2].includes("DriverStatus") ? process.env.STUB_DRIVER_STATUS : process.env.STUB_DRIVER);
  process.exit(code);
}
if (a[0] === "image" && a[1] === "inspect") {
  const name = a[a.length - 1]; const fmt = a[a.indexOf("--format") + 1];
  if (!(name in images)) { console.error("Error: No such image: " + name); process.exit(1); }
  console.log(fmt.includes("Size") ? images[name] + " 12345" : images[name]); process.exit(0);
}
if (a[0] === "save" && a[1] === "-o") { fs.writeFileSync(a[2], "stub image archive\\n" + a.slice(3).join("\\n") + "\\n"); process.exit(0); }
if (a[0] === "load" && a[1] === "-i") { console.log("Loaded image: (stub)"); process.exit(0); }
process.exit(99);
`,
  );
  chmodSync(stub, 0o755);
  return dir;
}

function run(args, { images, infoExit = "0", calls, driver = "overlayfs", driverStatus = CONTAINERD, lock }) {
  const stubDir = makeStub(join(work, "stub-bin"));
  writeFileSync(calls, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${stubDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      STUB_CALLS: calls,
      STUB_IMAGES: JSON.stringify(images),
      STUB_INFO_EXIT: infoExit,
      STUB_DRIVER: driver,
      STUB_DRIVER_STATUS: driverStatus,
      ...(lock ? { MTH_IMAGES_LOCK: lock } : {}),
      LANG: "C.UTF-8",
    },
  });
  const recorded = readFileSync(calls, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { ...r, recorded };
}
const allImages = () => Object.fromEntries([...lockNames, APP].map((n) => [n, fakeId(n)]));
const noPull = (recorded) =>
  assert.ok(
    recorded.every((c) => !["pull", "login", "push"].includes(c[0]) && !(c[0] === "image" && c[1] === "pull")),
    `a registry call was made: ${JSON.stringify(recorded)}`,
  );

describe("T-B12 image-bundle.sh with a stub docker", () => {
  const bundle = join(work, "bundle");
  let saveCalls = [];

  it("save lists every lock image that a Compose file runs plus the app image, with the tar SHA-256, and pulls nothing", () => {
    const calls = join(work, "calls-save.ndjson");
    const r = run(["save", "--out", bundle], { images: allImages(), calls });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    saveCalls = r.recorded;
    const m = JSON.parse(readFileSync(join(bundle, "images.json"), "utf8"));
    const tar = readFileSync(join(bundle, "images.tar"));
    assert.equal(m.schemaVersion, "mth-image-bundle/1");
    assert.equal(m.tar.sha256, sha(tar));
    assert.equal(m.tar.bytes, tar.length);
    assert.deepEqual(
      m.images.map((i) => i.name),
      [...lockNames, APP],
    );
    for (const i of m.images) {
      assert.equal(i.tarSha256, sha(tar), i.name);
      assert.equal(i.imageId, fakeId(i.name), i.name);
    }
    assert.deepEqual(
      m.images.map((i) => i.lockDigest),
      [...LOCK.images.filter(runByCompose).map((i) => i.digest), null],
    );
    const save = r.recorded.filter((c) => c[0] === "save");
    assert.equal(save.length, 1);
    assert.deepEqual(save[0].slice(3), [...lockNames, APP]);
    noPull(r.recorded);
  });

  it("save records the lock images no Compose file runs in `excluded` (A1.3), and never saves or inspects them", () => {
    const m = JSON.parse(readFileSync(join(bundle, "images.json"), "utf8"));
    assert.deepEqual(
      m.excluded,
      excludedLock.map((i) => ({
        lockId: i.id,
        reason: `not run by any Compose file (usedIn: ${i.usedIn.join(", ")})`,
      })),
    );
    // On the current lock: the CI-only Playwright image and node-runtime (its layers travel inside mth-app).
    assert.ok(m.excluded.some((e) => e.lockId === "playwright"));
    assert.ok(m.excluded.some((e) => e.lockId === "node-runtime"));
    assert.deepEqual(
      m.images.map((i) => i.lockId),
      ["postgres", "keycloak", null],
    );
    const excludedRefs = excludedLock.map((i) => i.ref);
    for (const c of saveCalls) {
      assert.ok(!c.some((arg) => excludedRefs.some((ref) => arg.startsWith(`${ref}:`))), JSON.stringify(c));
    }
  });

  it("save: an unpinned digest on a bundled image is BLOCKED (exit 2); one on an excluded image is not", () => {
    const fixture = (mutate) => {
      const l = JSON.parse(JSON.stringify(LOCK));
      mutate(l.images);
      const f = join(work, `lock-${Math.random().toString(16).slice(2)}.json`);
      writeFileSync(f, JSON.stringify(l));
      return f;
    };
    const bundledUnpinned = fixture((imgs) => (imgs.find((i) => i.id === "postgres").digest = null));
    const r = run(["save", "--out", join(work, "bundle-unpinned")], {
      images: allImages(),
      calls: join(work, "calls-unpinned.ndjson"),
      lock: bundledUnpinned,
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^image-bundle: BLOCKED: postgres has no pinned digest in images\.lock\.json$/m);
    assert.equal(r.recorded.length, 0, JSON.stringify(r.recorded));
    const excludedUnpinned = fixture((imgs) => (imgs.find((i) => i.id === "playwright").digest = null));
    const r2 = run(["save", "--out", join(work, "bundle-excl-unpinned")], {
      images: allImages(),
      calls: join(work, "calls-excl-unpinned.ndjson"),
      lock: excludedUnpinned,
    });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  });

  it("load and verify exit 3 on the classic image store with the B.5 line (A1.2): no docker load, no id check", () => {
    for (const cmd of ["load", "verify"]) {
      for (const [driver, driverStatus] of [
        [
          "overlay2",
          JSON.stringify([
            ["Backing Filesystem", "extfs"],
            ["Supports d_type", "true"],
          ]),
        ],
        ["overlayfs", "null"],
      ]) {
        const r = run([cmd, "--from", bundle], {
          images: allImages(),
          calls: join(work, `calls-classic-${cmd}.ndjson`),
          driver,
          driverStatus,
        });
        assert.equal(r.status, 3, `${cmd} ${driver}: ${r.stdout}${r.stderr}`);
        assert.match(
          r.stdout,
          /^image-bundle: BLOCKED: the classic image store cannot resolve digest references after load \(ADR-0069 A1\.2\); enable the containerd image store$/m,
        );
        assert.equal(r.recorded.filter((c) => c[0] !== "info").length, 0, JSON.stringify(r.recorded));
        noPull(r.recorded);
      }
    }
  });

  it("load and verify report the containerd store before any id check", () => {
    const r = run(["verify", "--from", bundle], { images: allImages(), calls: join(work, "calls-store-ok.ndjson") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /^image-bundle: image store: containerd \(storage driver 'overlayfs', driver-type io\.containerd\.snapshotter\.v1\)$/m,
    );
    const firstInspect = r.recorded.findIndex((c) => c[0] === "image");
    const storeCheck = r.recorded.findIndex((c) => c[0] === "info" && c[1] === "--format");
    assert.ok(storeCheck >= 0 && storeCheck < firstInspect, JSON.stringify(r.recorded));
  });

  it("verify passes on the saved bundle when every id matches", () => {
    const r = run(["verify", "--from", bundle], { images: allImages(), calls: join(work, "calls-verify-ok.ndjson") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: verify/);
    noPull(r.recorded);
  });

  it("load: a good bundle is loaded once and each id is checked", () => {
    const r = run(["load", "--from", bundle], { images: allImages(), calls: join(work, "calls-load-ok.ndjson") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.recorded.filter((c) => c[0] === "load").length, 1);
    assert.equal(r.recorded.filter((c) => c[0] === "image" && c[1] === "inspect").length, lockNames.length + 1);
    noPull(r.recorded);
  });

  it("load refuses a changed tar: exit 1 with the B.5 line, and docker load is never called", () => {
    const changed = join(work, "changed");
    mkdirSync(changed);
    writeFileSync(join(changed, "images.json"), readFileSync(join(bundle, "images.json")));
    const tar = Buffer.from(readFileSync(join(bundle, "images.tar")));
    tar[0] ^= 1; // same size, different bytes
    writeFileSync(join(changed, "images.tar"), tar);
    const r = run(["load", "--from", changed], { images: allImages(), calls: join(work, "calls-load-bad.ndjson") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^image-bundle: images\.tar does not match images\.json \(sha256\)$/m);
    assert.equal(r.recorded.length, 0, `docker was called: ${JSON.stringify(r.recorded)}`);
    appendFileSync(join(changed, "images.tar"), "x");
    const r2 = run(["load", "--from", changed], { images: allImages(), calls: join(work, "calls-load-bad2.ndjson") });
    assert.equal(r2.status, 1);
    assert.match(r2.stdout, /^image-bundle: images\.tar does not match images\.json \(bytes\)$/m);
    assert.equal(r2.recorded.length, 0);
  });

  it("verify refuses an id mismatch: exit 1 with the B.5 line naming the image", () => {
    const images = allImages();
    images[lockNames[1]] = fakeId("something else");
    const r = run(["verify", "--from", bundle], { images, calls: join(work, "calls-verify-bad.ndjson") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`image-bundle: ${lockNames[1]} does not match images.json (imageId)`), r.stdout);
    noPull(r.recorded);
  });

  it("load after the images were removed: a missing image fails the id check (exit 1), never pulled", () => {
    const images = allImages();
    delete images[APP];
    const r = run(["load", "--from", bundle], { images, calls: join(work, "calls-load-missing.ndjson") });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes(`image-bundle: ${APP} does not match images.json (present)`), r.stdout);
    noPull(r.recorded);
  });

  it("save: an image not present locally is BLOCKED (exit 2), and nothing is pulled or saved", () => {
    const images = allImages();
    delete images[lockNames[0]];
    const r = run(["save", "--out", join(work, "bundle-missing")], {
      images,
      calls: join(work, "calls-save-miss.ndjson"),
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /never pulls/);
    assert.equal(r.recorded.filter((c) => c[0] === "save").length, 0);
    noPull(r.recorded);
  });

  it("no Docker daemon: exit 3 with the B.5 BLOCKED line (save, and load after the tar check)", () => {
    for (const args of [
      ["save", "--out", join(work, "bundle-nodaemon")],
      ["load", "--from", bundle],
    ]) {
      const r = run(args, { images: allImages(), infoExit: "1", calls: join(work, "calls-nodaemon.ndjson") });
      assert.equal(r.status, 3, `${args[0]}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /^image-bundle: BLOCKED: docker daemon not reachable$/m);
      assert.equal(r.recorded.filter((c) => c[0] !== "info").length, 0);
    }
  });

  it("usage errors are BLOCKED (exit 2); no path of the script calls docker pull", () => {
    for (const args of [[], ["frobnicate"], ["save"], ["load"], ["verify", "--out", "x"]]) {
      const r = run(args, { images: {}, calls: join(work, "calls-usage.ndjson") });
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.match(r.stderr, /^image-bundle: BLOCKED: usage:/m);
    }
    const src = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(src, /docker (image )?pull|docker login|docker push/);
    noPull(saveCalls);
  });
});
