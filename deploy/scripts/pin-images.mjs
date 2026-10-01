#!/usr/bin/env node
// Container image digest pins (ADR-0011: base and service images pinned BY DIGEST). Source of truth:
// deploy/images.lock.json. Dependency-free.
//
//   node deploy/scripts/pin-images.mjs --check     OFFLINE. Exit 0 ONLY if every lock entry has a sha256 digest, every
//                                                  file in its `usedIn` references exactly ref:tag@digest, and no
//                                                  scanned file references an image that is not in the lock. A null
//                                                  digest is NOT PINNED; with `blockedReason` set it is reported as
//                                                  BLOCKED (with the reason) — either way --check exits 1, never 0.
//   node deploy/scripts/pin-images.mjs --resolve [id...]
//                                                  NEEDS REGISTRY ACCESS (orchestrator/IT step, D-049; agent sandboxes
//                                                  have no network). Resolves each ref:tag (or only the given ids) to its
//                                                  multi-arch index digest with `docker buildx imagetools inspect` and
//                                                  records digest + verifiedAt. An image whose registry cannot be reached
//                                                  is NOT fabricated: its digest stays null and `blockedReason` records
//                                                  the real error and time (an existing digest is kept, never nulled).
//                                                  The lock is written even when some images fail; exit 1 if any failed.
//   node deploy/scripts/pin-images.mjs --apply     rewrites every `usedIn` file: ref:tag[@sha256:...] -> ref:tag@digest
//                                                  for every image WITH a digest; images without one are listed as
//                                                  NOT APPLIED (and --check keeps failing on them).
//
// Typical (orchestrator/IT): --resolve, --apply, review the diff (only image reference lines change), commit.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lockPath = join(root, "deploy", "images.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const [mode, ...args] = process.argv.slice(2);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SCOPES = new Set(["production", "test-ci"]);
// The workflow lives at .github/workflows/ci.yml; implementers stage it at deploy/ci/ci.yml (they cannot write
// .github/). Every EXISTING copy is checked and rewritten, so the staged and installed copies cannot drift apart.
const STAGED = { ".github/workflows/ci.yml": "deploy/ci/ci.yml" };
const copiesOf = (f) => [f, STAGED[f]].filter((x) => x && existsSync(join(root, x)));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// ref:tag optionally followed by @sha256:..., not preceded by a name character (so "postgres" never matches "xpostgres",
// and "<mirror>/node:24..." in a comment never matches "node:24...").
const pattern = (img) =>
  new RegExp(`(?<![\\w./-])${esc(img.ref)}:${esc(img.tag)}(@sha256:[0-9a-f]{64})?(?![\\w.-])`, "g");

// Files scanned for image references that are NOT in the lock (completeness of `usedIn`).
const scanFiles = () => {
  const out = new Set();
  for (const d of ["deploy/docker", "deploy/compose"]) {
    for (const f of readdirSync(join(root, d))) {
      if (/^Dockerfile|\.ya?ml$/.test(f)) out.add(`${d}/${f}`);
    }
  }
  for (const f of copiesOf(".github/workflows/ci.yml")) out.add(f);
  return [...out];
};
// Image references in a file: `FROM x`, `ARG <NAME>IMAGE=x`, `image: x`. Variables (`${...}`) are not third-party
// image references: FROM ${NODE_IMAGE} takes the ARG default (scanned itself); ${MTH_APP_IMAGE:-mth-app:local} is the
// application image built from this repository by deploy/scripts/build-image.sh.
const imageRefs = (text) => {
  const refs = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (/^\s*#/.test(line)) continue;
    const m =
      line.match(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/i) ??
      line.match(/^\s*ARG\s+\w*IMAGE\w*=(\S+)/) ??
      line.match(/^\s*(?:-\s+)?image:\s*["']?([^\s"'#]+)/);
    if (m && !m[1].startsWith("${")) refs.push({ line: i + 1, ref: m[1] });
  }
  return refs;
};
const keyOf = (r) => r.replace(/@sha256:[0-9a-f]{64}$/, "");

function structureProblems() {
  const p = [];
  const ids = new Set();
  if (!Array.isArray(lock.images) || lock.images.length === 0) return ["deploy/images.lock.json: no images[]"];
  for (const img of lock.images) {
    const who = img.id ?? JSON.stringify(img.ref);
    if (!img.id || ids.has(img.id)) p.push(`${who}: missing or duplicate id`);
    ids.add(img.id);
    if (!img.ref || !img.tag) p.push(`${who}: ref and tag are required`);
    if (!SCOPES.has(img.scope)) p.push(`${who}: scope must be one of ${[...SCOPES].join(", ")}`);
    if (!Array.isArray(img.usedIn) || img.usedIn.length === 0) p.push(`${who}: usedIn must list at least one file`);
    if (img.digest !== null && !DIGEST.test(String(img.digest)))
      p.push(`${who}: digest must be null or sha256:<64 hex>, got ${JSON.stringify(img.digest)}`);
    if (img.digest && !img.verifiedAt) p.push(`${who}: a digest needs verifiedAt (when --resolve recorded it)`);
    if (!img.digest && img.verifiedAt) p.push(`${who}: verifiedAt without a digest`);
    if (!("blockedReason" in img)) p.push(`${who}: blockedReason field missing (null when not blocked)`);
    if (img.blockedReason !== null && img.blockedReason !== undefined) {
      if (typeof img.blockedReason !== "string" || img.blockedReason.trim() === "")
        p.push(`${who}: blockedReason must be a non-empty string or null`);
      if (img.digest) p.push(`${who}: blockedReason is set but a digest is pinned (contradictory)`);
    }
  }
  return p;
}

if (mode === "--resolve") {
  const only = new Set(args);
  for (const id of only) if (!lock.images.some((i) => i.id === id)) throw new Error(`unknown image id ${id}`);
  let failed = 0;
  for (const img of lock.images) {
    if (only.size && !only.has(img.id)) continue;
    const name = `${img.ref}:${img.tag}`;
    try {
      const out = execFileSync("docker", ["buildx", "imagetools", "inspect", name, "--format", "{{json .Manifest}}"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const digest = JSON.parse(out).digest;
      if (!DIGEST.test(digest)) throw new Error(`unexpected digest ${JSON.stringify(digest)}`);
      img.digest = digest;
      img.verifiedAt = new Date().toISOString();
      img.blockedReason = null;
      console.log(`resolved ${name} -> ${digest}`);
    } catch (e) {
      failed++;
      const why = `${e.stderr ?? ""}${e.message ?? e}`.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "unknown";
      if (img.digest) {
        console.error(`FAILED ${name}: ${why} (existing pin ${img.digest} KEPT; not re-verified)`);
      } else {
        img.blockedReason = `BLOCKED: --resolve at ${new Date().toISOString()} could not reach the registry: ${why}`;
        console.error(`BLOCKED ${name}: ${why} (digest stays null; recorded as blockedReason)`);
      }
    }
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  if (failed) {
    console.error(`${failed} image(s) not resolved; deploy/images.lock.json written with the rest. --check will fail.`);
    process.exit(1);
  }
} else if (mode === "--apply") {
  const s = structureProblems();
  if (s.length) {
    for (const p of s) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
  for (const img of lock.images) {
    if (!img.digest) {
      console.error(
        `NOT APPLIED ${img.id} (${img.ref}:${img.tag}): no digest${img.blockedReason ? ` — ${img.blockedReason}` : ""}`,
      );
      continue;
    }
    for (const f of img.usedIn.flatMap(copiesOf)) {
      const p = join(root, f);
      const before = readFileSync(p, "utf8");
      const after = before.replace(pattern(img), `${img.ref}:${img.tag}@${img.digest}`);
      if (after !== before) writeFileSync(p, after);
      console.log(`${f}: ${img.ref}:${img.tag} pinned`);
    }
  }
} else if (mode === "--check") {
  const problems = structureProblems();
  const status = [];
  for (const img of lock.images ?? []) {
    const name = `${img.ref}:${img.tag}`;
    if (img.digest && DIGEST.test(img.digest)) status.push(`PINNED     ${img.id} (${img.scope}) ${name}@${img.digest}`);
    else if (img.blockedReason) {
      status.push(`BLOCKED    ${img.id} (${img.scope}) ${name}: ${img.blockedReason}`);
      problems.push(`${img.id} (${name}): BLOCKED, not pinned — ${img.blockedReason}`);
    } else {
      status.push(`NOT PINNED ${img.id} (${img.scope}) ${name}`);
      problems.push(`${img.id} (${name}): NOT PINNED (no digest in deploy/images.lock.json)`);
    }
    for (const f0 of img.usedIn ?? []) {
      const files = copiesOf(f0);
      if (files.length === 0) {
        problems.push(`${f0}: file not found`);
        continue;
      }
      for (const f of files) {
        const refs = [...readFileSync(join(root, f), "utf8").matchAll(pattern(img))];
        if (refs.length === 0) problems.push(`${f}: no reference to ${name} (stale usedIn)`);
        for (const m of refs) {
          if (!m[1]) problems.push(`${f}: ${m[0]} has no digest`);
          else if (img.digest && m[1] !== `@${img.digest}`)
            problems.push(`${f}: ${m[0]} differs from the lock (${img.digest})`);
          else if (!img.digest) problems.push(`${f}: ${m[0]} carries a digest the lock does not record`);
        }
      }
    }
  }
  // Completeness: every third-party image referenced in the scanned files is in the lock, with that file in usedIn.
  for (const f of scanFiles()) {
    for (const r of imageRefs(readFileSync(join(root, f), "utf8"))) {
      const img = (lock.images ?? []).find((i) => `${i.ref}:${i.tag}` === keyOf(r.ref));
      const canonical = Object.entries(STAGED).find(([, staged]) => staged === f)?.[0] ?? f;
      if (!img) problems.push(`${f}:${r.line}: image ${r.ref} is not in deploy/images.lock.json`);
      else if (!img.usedIn.includes(canonical))
        problems.push(`${f}:${r.line}: ${r.ref} used but not in ${img.id}.usedIn`);
    }
  }
  for (const s of status) console.log(s);
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    console.error(
      `${problems.length} problem(s). Pin with (registry access; orchestrator/IT): ` +
        "node deploy/scripts/pin-images.mjs --resolve && node deploy/scripts/pin-images.mjs --apply",
    );
    process.exit(1);
  }
  console.log(`OK: ${lock.images.length} images pinned by digest and referenced consistently`);
} else {
  console.error("usage: node deploy/scripts/pin-images.mjs --check | --resolve [id...] | --apply");
  process.exit(64);
}
