// Candidate identity: a deterministic SHA-256 over a manifest of (path, content hash) pairs.
// Review/gate/evidence metadata is always excluded so writing a review never invalidates its own candidate.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, readlinkSync } from "node:fs";
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

// The only candidate spec the gates accept (decision D-005). Narrowing it requires a reviewed change to this file.
export const APPROVED_SPEC = { include: ["**"], exclude: ["trading_agent/**"] };

export function specPolicyErrors(spec) {
  const errors = [];
  if (!spec || JSON.stringify(spec.include) !== JSON.stringify(APPROVED_SPEC.include)) errors.push(`include must be ${JSON.stringify(APPROVED_SPEC.include)}`);
  if (!spec || JSON.stringify(spec.exclude) !== JSON.stringify(APPROVED_SPEC.exclude)) errors.push(`exclude must be ${JSON.stringify(APPROVED_SPEC.exclude)} (D-005)`);
  return errors;
}

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

/** Symlinks are identified by their target string, so repointing a link changes the candidate. */
function symlinkHash(target) {
  return sha256(Buffer.from(`symlink:${target}`, "utf8"));
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

export function selectPaths(paths, spec) {
  const include = spec.include && spec.include.length ? spec.include : ["**"];
  const exclude = [...(spec.exclude || []), ...META_EXCLUDES];
  return paths.filter((p) => matchesAny(p, include) && !matchesAny(p, exclude)).sort();
}

/** Files from the working tree: tracked + untracked-not-ignored, content read from disk. */
export function manifestFromWorkingTree(repo, spec) {
  const staged = git(repo, ["ls-files", "-z", "--stage"]).toString("utf8").split("\0").filter(Boolean);
  const gitlinks = new Set();
  const indexMode = new Map();
  for (const line of staged) {
    const [meta, path] = line.split("\t");
    if (meta.startsWith("160000 ")) gitlinks.add(path);
    indexMode.set(path, meta.split(" ")[0]);
  }
  // Where git ignores the executable bit (core.fileMode=false, e.g. NTFS), tracked files take their mode from the
  // index so a clean checkout reproduces the committed candidate (F-DG0-116).
  let trustFsMode = true;
  try {
    trustFsMode = git(repo, ["config", "--bool", "core.fileMode"]).toString().trim() !== "false";
  } catch {
    /* unset: git's default is true */
  }
  const listed = git(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (const p of selectPaths([...new Set(listed)], spec)) {
    if (gitlinks.has(p)) throw new Error(`submodule/gitlink '${p}' is not supported in a candidate`);
    let st;
    try {
      st = lstatSync(join(repo, p));
    } catch {
      continue; // deleted in working tree but still in index
    }
    if (st.isSymbolicLink()) entries.push({ path: p, sha256: symlinkHash(readlinkSync(join(repo, p))), mode: "120000" });
    else if (st.isFile()) {
      const fsMode = st.mode & 0o111 ? "100755" : "100644";
      const mode = !trustFsMode && ["100644", "100755"].includes(indexMode.get(p)) ? indexMode.get(p) : fsMode;
      entries.push({ path: p, sha256: sha256(readFileSync(join(repo, p))), mode });
    }
    else if (st.isDirectory()) throw new Error(`'${p}' is a directory (nested repository?) and cannot be part of a candidate`);
  }
  return entries;
}

/** Files from a committed tree (historical verification). */
export function manifestFromRef(repo, ref, spec) {
  const out = git(repo, ["ls-tree", "-r", "-z", "--full-tree", ref]).toString("utf8").split("\0").filter(Boolean);
  const objects = new Map();
  for (const line of out) {
    const [meta, path] = line.split("\t");
    const [mode, type, oid] = meta.split(" ");
    objects.set(path, { mode, type, oid });
  }
  return selectPaths([...objects.keys()], spec).map((p) => {
    const o = objects.get(p);
    if (o.type !== "blob") throw new Error(`submodule/gitlink '${p}' is not supported in a candidate`);
    const content = git(repo, ["cat-file", "blob", o.oid]);
    if (!["100644", "100755", "120000"].includes(o.mode)) throw new Error(`'${p}' has unsupported git mode ${o.mode}`);
    return o.mode === "120000"
      ? { path: p, sha256: symlinkHash(content.toString("utf8")), mode: o.mode }
      : { path: p, sha256: sha256(content), mode: o.mode };
  });
}

// v2 (current): "<sha256>  <git mode>  <path>". v1 (historical DG0 rounds 1-2 only): "<sha256>  <path>".
// New freezes and every gate decision must use v2 (F-DG0-112/206); v1 exists solely to re-verify old manifests.
export const HASH_ALGORITHM = "mth-candidate-v2";

export function candidateId(entries, algorithm = HASH_ALGORITHM) {
  if (algorithm !== HASH_ALGORITHM && algorithm !== "mth-candidate-v1") throw new Error(`unknown candidate hash algorithm ${algorithm}`);
  const canonical = entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => {
      if (algorithm === "mth-candidate-v1") return `${e.sha256}  ${e.path}\n`;
      // The git mode (100644 / 100755 / 120000) is part of identity: exec-bit changes and file/symlink swaps count.
      if (!["100644", "100755", "120000"].includes(e.mode)) throw new Error(`manifest entry '${e.path}' lacks a valid mode`);
      return `${e.sha256}  ${e.mode}  ${e.path}\n`;
    })
    .join("");
  return "sha256:" + sha256(Buffer.from(canonical, "utf8"));
}

export function diffManifests(a, b) {
  const ma = new Map(a.map((e) => [e.path, `${e.sha256}:${e.mode}`]));
  const mb = new Map(b.map((e) => [e.path, `${e.sha256}:${e.mode}`]));
  const added = [...mb.keys()].filter((p) => !ma.has(p));
  const removed = [...ma.keys()].filter((p) => !mb.has(p));
  const changed = [...ma.keys()].filter((p) => mb.has(p) && ma.get(p) !== mb.get(p));
  return { added, removed, changed };
}
