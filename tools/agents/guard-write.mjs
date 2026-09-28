#!/usr/bin/env node
// PreToolUse hook: blocks Write/Edit/NotebookEdit calls outside a role's write scope.
// Usage (from agent frontmatter): node tools/agents/guard-write.mjs <role>
// Reads the hook payload (JSON) on stdin. Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const role = process.argv[2];

function globToRegExp(glob) {
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
  return new RegExp("^" + re + "$");
}

export function matches(path, patterns) {
  return patterns.some((p) => globToRegExp(p).test(path));
}

export function repoRootOf(filePath) {
  let dir = dirname(resolve(filePath));
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function decide(scopes, roleName, filePath) {
  const cfg = scopes.roles[roleName];
  if (!cfg) return { allow: false, reason: `unknown role '${roleName}' has no write scope` };
  const root = repoRootOf(filePath);
  if (!root) return { allow: true, reason: "outside any git work tree (scratch)" };
  const rel = relative(root, resolve(filePath)).split(sep).join("/");
  const expand = (list) =>
    list.flatMap((p) => (p.startsWith("@") ? scopes[p.slice(1)] || [] : [p]));
  if (matches(rel, expand(cfg.deny))) {
    return { allow: false, reason: `${roleName} may not write '${rel}' (protected path)` };
  }
  if (!matches(rel, expand(cfg.allow))) {
    return { allow: false, reason: `${roleName} may not write '${rel}' (outside role write scope)` };
  }
  return { allow: true, reason: "within scope" };
}

function main() {
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
