#!/usr/bin/env node
// Container image digest pins (ADR-0011: base and service images pinned BY DIGEST). Source of truth:
// deploy/images.lock.json. Dependency-free.
//
//   node deploy/scripts/pin-images.mjs --check     OFFLINE. Exit 1 unless every lock entry has a sha256 digest AND
//                                                  every file in its `usedIn` references exactly ref:tag@digest.
//   node deploy/scripts/pin-images.mjs --resolve   NEEDS REGISTRY ACCESS (orchestrator/IT). Resolves each ref:tag to
//                                                  its multi-arch index digest with `docker buildx imagetools inspect`
//                                                  and records digest + verifiedAt in the lock.
//   node deploy/scripts/pin-images.mjs --apply     rewrites every `usedIn` file: ref:tag[@sha256:...] -> ref:tag@digest
//
// Typical: --resolve, --apply, review the diff, commit. A null digest is "not pinned"; --check never passes on it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lockPath = join(root, "deploy", "images.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const mode = process.argv[2];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
// Until the orchestrator installs the staged workflow (implementers cannot write .github/), read/write the staged copy.
const STAGED = { ".github/workflows/ci.yml": "deploy/ci/ci.yml" };
const resolveFile = (f) => (existsSync(join(root, f)) || !STAGED[f] ? f : STAGED[f]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// ref:tag optionally followed by @sha256:..., not preceded by a name character (so "postgres" never matches "xpostgres").
const pattern = (img) =>
  new RegExp(`(?<![\\w./-])${esc(img.ref)}:${esc(img.tag)}(@sha256:[0-9a-f]{64})?(?![\\w.-])`, "g");

if (mode === "--resolve") {
  for (const img of lock.images) {
    const out = execFileSync(
      "docker",
      ["buildx", "imagetools", "inspect", `${img.ref}:${img.tag}`, "--format", "{{json .Manifest}}"],
      {
        encoding: "utf8",
      },
    );
    const digest = JSON.parse(out).digest;
    if (!DIGEST.test(digest)) throw new Error(`unexpected digest for ${img.ref}:${img.tag}: ${digest}`);
    img.digest = digest;
    img.verifiedAt = new Date().toISOString();
    console.log(`resolved ${img.ref}:${img.tag} -> ${digest}`);
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
} else if (mode === "--apply") {
  for (const img of lock.images) {
    if (!img.digest) throw new Error(`${img.id}: no digest in the lock; run --resolve first`);
    for (const f0 of img.usedIn) {
      const f = resolveFile(f0);
      const p = join(root, f);
      const before = readFileSync(p, "utf8");
      const after = before.replace(pattern(img), `${img.ref}:${img.tag}@${img.digest}`);
      if (after !== before) writeFileSync(p, after);
      console.log(`${f}: ${img.ref}:${img.tag} pinned`);
    }
  }
} else if (mode === "--check") {
  const problems = [];
  for (const img of lock.images) {
    if (!img.digest || !DIGEST.test(img.digest)) {
      problems.push(`${img.id} (${img.ref}:${img.tag}): NOT PINNED (no digest in deploy/images.lock.json)`);
    }
    for (const f0 of img.usedIn) {
      const f = resolveFile(f0);
      if (!existsSync(join(root, f))) {
        problems.push(`${f0}: file not found`);
        continue;
      }
      const text = readFileSync(join(root, f), "utf8");
      const refs = [...text.matchAll(pattern(img))];
      if (refs.length === 0) problems.push(`${f}: no reference to ${img.ref}:${img.tag}`);
      for (const m of refs) {
        if (!m[1]) problems.push(`${f}: ${m[0]} has no digest`);
        else if (img.digest && m[1] !== `@${img.digest}`)
          problems.push(`${f}: ${m[0]} differs from the lock (${img.digest})`);
      }
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    console.error(
      `${problems.length} problem(s). Pin with: node deploy/scripts/pin-images.mjs --resolve && node deploy/scripts/pin-images.mjs --apply`,
    );
    process.exit(1);
  }
  console.log(`OK: ${lock.images.length} images pinned by digest and referenced consistently`);
} else {
  console.error("usage: node deploy/scripts/pin-images.mjs --check | --resolve | --apply");
  process.exit(64);
}
