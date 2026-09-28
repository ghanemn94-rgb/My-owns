#!/usr/bin/env node
// PreToolUse hook: blocks Write/Edit/NotebookEdit calls outside a role's write scope.
// Usage (from per-role settings): node tools/agents/guard-write.mjs <role>
// Reads the hook payload (JSON) on stdin. Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
// Both the lexical target and its symlink-resolved real path must pass. Deny rules match case-insensitively
// (so case-insensitive filesystems cannot bypass them); allow rules match exactly.
import { readFileSync, existsSync, realpathSync } from "node:fs";
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

// The repository this guard belongs to: fixed at the guard's own location (tools/agents/ -> repo root), so a
// planted nested '.git' cannot move the root and un-protect paths (F-DG0-111).
export const GUARD_ROOT = resolve(here, "..", "..");

/** Root used to scope a path: the guard's repository, or (for other trees, e.g. reviewer scratch clones) null. */
export function repoRootOf(filePath, root = GUARD_ROOT) {
  const abs = resolve(filePath);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    /* keep lexical */
  }
  for (const r of new Set([root, realRoot])) {
    if (abs === r || abs.startsWith(r + sep)) return r;
  }
  return null;
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

function decideOne(scopes, cfg, roleName, filePath, root) {
  const repo = repoRootOf(filePath, root);
  if (!repo) return { allow: true, reason: "outside the guarded repository (scratch)" };
  const rel = relative(repo, resolve(filePath)).split(sep).join("/");
  if (rel.split("/").some((seg) => seg.toLowerCase() === ".git")) return { allow: false, reason: `${roleName} may not write '${rel}' (git metadata)` };
  const expand = (list) => list.flatMap((p) => (p.startsWith("@") ? scopes[p.slice(1)] || [] : [p]));
  if (matches(rel, expand(cfg.deny), "i")) return { allow: false, reason: `${roleName} may not write '${rel}' (protected path)` };
  if (!matches(rel, expand(cfg.allow))) return { allow: false, reason: `${roleName} may not write '${rel}' (outside role write scope)` };
  return { allow: true, reason: "within scope" };
}

export function decide(scopes, roleName, filePath, root = GUARD_ROOT) {
  const cfg = scopes.roles[roleName];
  if (!cfg) return { allow: false, reason: `unknown role '${roleName}' has no write scope` };
  const lexical = decideOne(scopes, cfg, roleName, filePath, root);
  if (!lexical.allow) return lexical;
  const real = canonicalPath(filePath);
  if (real !== resolve(filePath)) {
    const viaLink = decideOne(scopes, cfg, roleName, real, root);
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
