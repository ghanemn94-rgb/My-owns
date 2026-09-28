// Candidate identity: a deterministic SHA-256 over a manifest of (path, content hash) pairs.
// Review/gate/evidence metadata is always excluded so writing a review never invalidates its own candidate.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

// Delivery metadata: never part of any candidate (hard-coded so stage specs cannot re-include it).
export const META_EXCLUDES = [
  "docs/delivery/reviews/**",
  "docs/delivery/gates/**",
  "docs/delivery/test-evidence/**",
  "docs/delivery/runs/**",
  "docs/delivery/candidates/**",
  "docs/delivery/handbacks/**",
  "docs/delivery/assignments/**",
  "docs/delivery/findings.json",
  "docs/delivery/progress.md",
  "docs/delivery/stages.json",
];

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$+.()|{}[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function git(repo, args, opts = {}) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, ...opts });
}

export function selectPaths(paths, spec) {
  const include = spec.include && spec.include.length ? spec.include : ["**"];
  const exclude = [...(spec.exclude || []), ...META_EXCLUDES];
  return paths.filter((p) => matchesAny(p, include) && !matchesAny(p, exclude)).sort();
}

/** Files from the working tree: tracked + untracked-not-ignored, content read from disk. */
export function manifestFromWorkingTree(repo, spec) {
  const listed = git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .toString("utf8").split("\0").filter(Boolean);
  const unique = [...new Set(listed)];
  const entries = [];
  for (const p of selectPaths(unique, spec)) {
    let st;
    try {
      st = lstatSync(join(repo, p));
    } catch {
      continue; // deleted in working tree but still in index
    }
    if (!st.isFile()) continue;
    entries.push({ path: p, sha256: sha256(readFileSync(join(repo, p))) });
  }
  return entries;
}

/** Files from a committed tree (historical verification). */
export function manifestFromRef(repo, ref, spec) {
  const out = git(repo, ["ls-tree", "-r", "-z", "--full-tree", ref]).toString("utf8").split("\0").filter(Boolean);
  const blobs = new Map();
  for (const line of out) {
    const [meta, path] = line.split("\t");
    const [mode, type, oid] = meta.split(" ");
    if (type === "blob" && mode !== "120000") blobs.set(path, oid);
  }
  return selectPaths([...blobs.keys()], spec).map((p) => ({
    path: p,
    sha256: sha256(git(repo, ["cat-file", "blob", blobs.get(p)])),
  }));
}

export function candidateId(entries) {
  const canonical = entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.sha256}  ${e.path}\n`)
    .join("");
  return "sha256:" + sha256(Buffer.from(canonical, "utf8"));
}

export function diffManifests(a, b) {
  const ma = new Map(a.map((e) => [e.path, e.sha256]));
  const mb = new Map(b.map((e) => [e.path, e.sha256]));
  const added = [...mb.keys()].filter((p) => !ma.has(p));
  const removed = [...ma.keys()].filter((p) => !mb.has(p));
  const changed = [...ma.keys()].filter((p) => mb.has(p) && ma.get(p) !== mb.get(p));
  return { added, removed, changed };
}
