#!/usr/bin/env node
// PreToolUse hook: blocks Write/Edit/NotebookEdit calls outside a role's write scope.
// Usage (from per-role settings): node tools/agents/guard-write.mjs <role>
// Reads the hook payload (JSON) on stdin. Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
// Both the lexical target and its symlink-resolved real path must pass. Deny rules match case-insensitively
// (so case-insensitive filesystems cannot bypass them); allow rules match exactly.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function globToRegExp(glob, flags = "") {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$", flags);
}

export function matches(path, patterns, flags = "") {
  return patterns.some((p) => globToRegExp(p, flags).test(path));
}

// The repository this guard protects. The runner exports MTH_GUARD_ROOT (the main repository) into the agent's
// process environment, which the agent's shell commands cannot change; the hook is always this repository's guard,
// wherever the agent's working directory is (F-DG0-134). Without it, the guard's own location decides (F-DG0-111).
export const GUARD_ROOT = process.env.MTH_GUARD_ROOT ? resolve(process.env.MTH_GUARD_ROOT) : resolve(here, "..", "..");

/**
 * The guarded roots: the repository plus every git worktree attached to it (agents may run in worktrees).
 * Fails closed (F-DG0-135): if the worktree list cannot be read, this throws and every write is blocked.
 */
export function guardedRoots(root = GUARD_ROOT) {
  const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  const roots = [resolve(root)];
  for (const line of out.split("\n")) if (line.startsWith("worktree ")) roots.push(resolve(line.slice(9)));
  if (roots.length < 2) throw new Error("git worktree list returned no worktrees");
  const all = new Set();
  for (const r of roots) {
    all.add(r);
    try {
      all.add(realpathSync(r));
    } catch {
      /* keep lexical */
    }
  }
  return [...all];
}

/** The home directory of the process running the hook (the agent's HOME), lexical and real. */
export function homeRoots() {
  const set = new Set([resolve(homedir())]);
  try {
    set.add(realpathSync(homedir()));
  } catch {
    /* keep lexical */
  }
  return [...set];
}

/** Scratch space: only the OS temporary directory (F-DG0-136). Home, /etc and other paths are never scratch. */
export function scratchRoots() {
  const set = new Set([resolve(tmpdir()), "/tmp"]);
  for (const r of [...set]) {
    try {
      set.add(realpathSync(r));
    } catch {
      /* keep lexical */
    }
  }
  return [...set];
}

/** The deepest guarded root containing the path (a worktree nested inside the repository wins), or null. */
export function repoRootOf(filePath, roots = guardedRoots()) {
  const abs = resolve(filePath);
  const list = Array.isArray(roots) ? roots : [roots];
  let best = null;
  for (const r of list) {
    if ((abs === r || abs.startsWith(r + sep)) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

/** Resolves symlinks on the deepest existing ancestor, then re-appends the not-yet-existing remainder. */
export function canonicalPath(filePath) {
  let cur = resolve(filePath);
  const rest = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  let real = cur;
  try {
    real = realpathSync(cur);
  } catch {
    /* keep lexical */
  }
  return rest.length ? join(real, ...rest) : real;
}

function decideOne(scopes, cfg, roleName, filePath, roots) {
  const repo = repoRootOf(filePath, roots);
  if (!repo) {
    // The user's home (Claude and git configuration) is never scratch, even when it lies inside the temp directory.
    if (repoRootOf(filePath, homeRoots())) return { allow: false, reason: `${roleName} may not write '${resolve(filePath)}' (inside the home directory)` };
    if (repoRootOf(filePath, scratchRoots())) return { allow: true, reason: "temporary directory (scratch)" };
    return { allow: false, reason: `${roleName} may not write '${resolve(filePath)}' (outside the guarded repository and outside the temporary directory)` };
  }
  const rel = relative(repo, resolve(filePath)).split(sep).join("/");
  if (rel.split("/").some((seg) => seg.toLowerCase() === ".git")) return { allow: false, reason: `${roleName} may not write '${rel}' (git metadata)` };
  const expand = (list) => list.flatMap((p) => (p.startsWith("@") ? scopes[p.slice(1)] || [] : [p]));
  if (matches(rel, expand(cfg.deny), "i")) return { allow: false, reason: `${roleName} may not write '${rel}' (protected path)` };
  if (!matches(rel, expand(cfg.allow))) return { allow: false, reason: `${roleName} may not write '${rel}' (outside role write scope)` };
  return { allow: true, reason: "within scope" };
}

export function decide(scopes, roleName, filePath, root = null) {
  // root: a repository path (its worktrees are guarded too) or an explicit list of roots; default: GUARD_ROOT.
  let roots;
  try {
    roots = Array.isArray(root) ? root : guardedRoots(root || GUARD_ROOT);
  } catch (e) {
    return { allow: false, reason: `cannot determine the guarded repository roots (${String(e.message).split("\n")[0]}); blocking to fail safe` };
  }
  const cfg = scopes.roles[roleName];
  if (!cfg) return { allow: false, reason: `unknown role '${roleName}' has no write scope` };
  const lexical = decideOne(scopes, cfg, roleName, filePath, roots);
  if (!lexical.allow) return lexical;
  const real = canonicalPath(filePath);
  if (real !== resolve(filePath)) {
    const viaLink = decideOne(scopes, cfg, roleName, real, roots);
    if (!viaLink.allow) return { allow: false, reason: `${viaLink.reason} (reached through a symlink)` };
  }
  return lexical;
}

function main() {
  const role = process.argv[2];
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.stderr.write("guard-write: unreadable hook payload; blocking to fail safe\n");
    process.exit(2);
  }
  const input = payload.tool_input || {};
  const target = input.file_path || input.notebook_path || input.path;
  if (!target) process.exit(0);
  const scopes = JSON.parse(readFileSync(join(here, "write-scopes.json"), "utf8"));
  const verdict = decide(scopes, role, target);
  if (!verdict.allow) {
    process.stderr.write(`BLOCKED by write guard: ${verdict.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
