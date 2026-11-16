#!/usr/bin/env node
// Static checks of deploy/docker/Dockerfile and /.dockerignore that catch, without a Docker daemon, the three defects
// the orchestrator's host build hit (T-DG7-DO-E3; host-run.log step 03):
//
//   1. manifests  every workspace package.json (pnpm-workspace.yaml globs, git-tracked) and the root install inputs
//                 (package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .npmrc) are COPYed in the build stage BEFORE
//                 `pnpm install`, and none of them is excluded by .dockerignore. A missing one makes
//                 `pnpm install --frozen-lockfile` fail (packages/reporting/package.json was missing).
//   2. sources    no git-tracked file under apps/*/src or packages/*/src is excluded from the build context by
//                 .dockerignore (`**/*secret*` dropped secrets.ts, secret-refs.ts, secret-namespace.ts, ...).
//   3. corepack   every `corepack enable --install-directory DIR` runs after DIR is created (mkdir -p earlier in the
//                 same RUN, or an earlier WORKDIR of the stage). Corepack does not create it: ENOENT, lstat '/pnpm'.
//
// The .dockerignore matcher follows Docker's semantics (moby/patternmatcher, `MatchesOrParentMatches`): `*` and `?`
// never cross `/`, `**` spans any number of directories, a pattern matching a parent directory excludes the file,
// `!` re-includes, and the LAST matching pattern wins.
//
//   node deploy/scripts/check-dockerfile-context.mjs [--root DIR]
// Exit 0 PASS, 1 FAIL (each finding printed), 2 BLOCKED (missing input, usage), 3 BLOCKED (git unavailable).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------------------- .dockerignore
const ESCAPE = new Set([".", "+", "(", ")", "|", "{", "}", "$", "^"]);

/** Compile one .dockerignore pattern body (already cleaned) to a RegExp, as moby/patternmatcher does. */
export function compilePattern(pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") i++; // `**/` is treated as `**`
        re += i + 1 >= pattern.length ? ".*" : "(.*/)?";
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "\\") {
      i++;
      if (i < pattern.length) re += `\\${pattern[i]}`;
    } else if (ESCAPE.has(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch; // includes `[...]` character classes, which pass through as in Go's matcher
    }
  }
  return new RegExp(`${re}$`);
}

/** Clean a path pattern like Go's filepath.Clean (enough for .dockerignore lines) and drop a leading `/`. */
function cleanPattern(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/") || ".";
}

/** Parse .dockerignore text into ordered rules `{ text, exclusion, re }` (exclusion = a `!` re-include). */
export function parseDockerignore(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    let exclusion = false;
    if (line.startsWith("!")) {
      exclusion = true;
      line = line.slice(1).trim();
      if (line === "") continue;
    }
    const body = cleanPattern(line);
    rules.push({ text: raw.trim(), exclusion, re: compilePattern(body) });
  }
  return rules;
}

/** Is `file` (repository-relative, `/`-separated) left OUT of the build context? Returns the deciding rule or null. */
export function excludedBy(rules, file) {
  const parentDirs = file.split("/").slice(0, -1);
  let matched = false;
  let decidingRule = null;
  for (const rule of rules) {
    if (rule.exclusion !== matched) continue; // same short-circuit as MatchesOrParentMatches
    let hit = rule.re.test(file);
    for (let i = 0; !hit && i < parentDirs.length; i++) hit = rule.re.test(parentDirs.slice(0, i + 1).join("/"));
    if (hit) {
      matched = !rule.exclusion;
      decidingRule = rule;
    }
  }
  return matched ? decidingRule.text : null;
}

// ---------------------------------------------------------------------------------------------------- Dockerfile
/** Parse a Dockerfile into instructions `{ op, args, line }`, joining `\` continuations and dropping comments. */
export function parseDockerfile(text) {
  const out = [];
  let buf = "";
  let start = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (buf === "" && (t === "" || t.startsWith("#"))) return;
    if (buf !== "" && t.startsWith("#")) return; // comment lines inside a continuation are ignored by Docker
    if (buf === "") start = idx + 1;
    if (t.endsWith("\\")) {
      buf += `${t.slice(0, -1)} `;
      return;
    }
    buf += t;
    const m = /^(\S+)\s*(.*)$/s.exec(buf);
    out.push({ op: m[1].toUpperCase(), args: m[2], line: start });
    buf = "";
  });
  return out;
}

/** Split instructions into stages `{ name, instructions, env }` (`env` from the stage's ENV lines, `k=v` form). */
export function stagesOf(instructions) {
  const stages = [];
  for (const ins of instructions) {
    if (ins.op === "FROM") {
      const m = /\bAS\s+(\S+)\s*$/i.exec(ins.args);
      stages.push({ name: m ? m[1] : `#${stages.length}`, instructions: [], env: {} });
      continue;
    }
    const st = stages[stages.length - 1];
    if (!st) continue;
    st.instructions.push(ins);
    if (ins.op === "ENV")
      for (const m of ins.args.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S*)/g))
        st.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return stages;
}

function expand(word, env) {
  return word
    .replace(/^["']|["']$/g, "")
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => env[a ?? b] ?? "")
    .replace(/\/+$/, "");
}

/** COPY sources (without `--from`) of instructions, flags removed; the last word is the destination. */
function copySources(ins) {
  const words = ins.args.split(/\s+/).filter(Boolean);
  if (words.some((w) => w.startsWith("--from"))) return [];
  const plain = words.filter((w) => !w.startsWith("--"));
  return plain.slice(0, -1).map((w) => cleanPattern(w));
}

// ---------------------------------------------------------------------------------------------------- checks
/** Workspace globs from pnpm-workspace.yaml (`packages:` list; single-level `*` globs as this repository uses). */
export function workspaceGlobs(yamlText) {
  const globs = [];
  let inPackages = false;
  for (const raw of yamlText.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(raw)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s+["']?([^"'#\s]+)["']?/.exec(raw);
      if (m) globs.push(m[1]);
      else if (/^\S/.test(raw)) inPackages = false;
    }
  }
  return globs;
}

/** Required install inputs: root files plus each tracked `<glob>/package.json`. */
export function requiredManifests(
  globs,
  trackedFiles,
  rootFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"],
) {
  const req = rootFiles.filter((f) => trackedFiles.includes(f));
  for (const g of globs) {
    if (g.startsWith("!")) continue;
    const re = compilePattern(`${cleanPattern(g)}/package.json`);
    for (const f of trackedFiles) if (re.test(f) && !req.includes(f)) req.push(f);
  }
  return req;
}

/** Defect 1: every required manifest COPYed in the install stage before `pnpm install`, and inside the context. */
export function checkManifests({ dockerfile, dockerignore, required }) {
  const problems = [];
  const stages = stagesOf(parseDockerfile(dockerfile));
  const stage = stages.find((s) => s.instructions.some((i) => i.op === "RUN" && /\bpnpm\s+install\b/.test(i.args)));
  if (!stage) return ["no build stage runs `pnpm install`"];
  const before = [];
  for (const ins of stage.instructions) {
    if (ins.op === "RUN" && /\bpnpm\s+install\b/.test(ins.args)) break;
    if (ins.op === "COPY" || ins.op === "ADD") before.push(...copySources(ins));
  }
  const rules = parseDockerignore(dockerignore);
  for (const f of required) {
    const copied = before.some((src) => src === f || src === "." || f.startsWith(`${src}/`));
    if (!copied) problems.push(`${f}: not COPYed before \`pnpm install\` in stage ${stage.name}`);
    const rule = excludedBy(rules, f);
    if (rule) problems.push(`${f}: excluded from the build context by .dockerignore rule \`${rule}\``);
  }
  return problems;
}

/** Defect 2: tracked files under apps/*\/src and packages/*\/src that .dockerignore drops. */
export function checkSources({ dockerignore, trackedFiles }) {
  const rules = parseDockerignore(dockerignore);
  const src = /^(apps|packages)\/[^/]+\/src\//;
  const problems = [];
  for (const f of trackedFiles) {
    if (!src.test(f)) continue;
    const rule = excludedBy(rules, f);
    if (rule) problems.push(`${f}: tracked source excluded from the build context by .dockerignore rule \`${rule}\``);
  }
  return problems;
}

/** Defect 3: `corepack enable --install-directory DIR` without DIR created first. */
export function checkCorepack({ dockerfile }) {
  const problems = [];
  for (const stage of stagesOf(parseDockerfile(dockerfile))) {
    const made = new Set();
    for (const ins of stage.instructions) {
      if (ins.op === "WORKDIR") made.add(expand(ins.args.trim(), stage.env));
      if (ins.op !== "RUN") continue;
      // Shell commands of this RUN in order (split on ; && || and newlines), with the mount flags removed.
      const cmds = ins.args
        .replace(/--mount=\S+/g, "")
        .split(/;|&&|\|\||\n/)
        .map((c) => c.trim());
      for (const cmd of cmds) {
        const words = cmd.split(/\s+/).filter(Boolean);
        if (words[0] === "mkdir" && words.includes("-p"))
          for (const w of words.slice(1)) if (!w.startsWith("-")) made.add(expand(w, stage.env));
        const k = words.indexOf("--install-directory");
        if (words[0] === "corepack" && words[1] === "enable" && k > 0) {
          const dir = expand(words[k + 1] ?? "", stage.env);
          if (!made.has(dir))
            problems.push(
              `Dockerfile line ${ins.line} (stage ${stage.name}): corepack enable --install-directory ${dir} runs before ${dir} is created (add \`mkdir -p ${dir}\` first; corepack fails with ENOENT)`,
            );
        }
      }
    }
  }
  return problems;
}

/** All three checks over a repository root. */
export function checkRepository(root) {
  const read = (p) => readFileSync(join(root, p), "utf8");
  for (const p of ["deploy/docker/Dockerfile", ".dockerignore", "pnpm-workspace.yaml"])
    if (!existsSync(join(root, p))) return { blocked: 2, reason: `missing ${p}` };
  const git = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (git.status !== 0)
    return { blocked: 3, reason: `git ls-files failed: ${(git.stderr || git.error?.message || "").trim()}` };
  const trackedFiles = git.stdout.split("\0").filter(Boolean);
  const dockerfile = read("deploy/docker/Dockerfile");
  const dockerignore = read(".dockerignore");
  const required = requiredManifests(workspaceGlobs(read("pnpm-workspace.yaml")), trackedFiles);
  return {
    required,
    trackedSources: trackedFiles.filter((f) => /^(apps|packages)\/[^/]+\/src\//.test(f)).length,
    manifests: checkManifests({ dockerfile, dockerignore, required }),
    sources: checkSources({ dockerignore, trackedFiles }),
    corepack: checkCorepack({ dockerfile }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (args[0] === "--root" && args[1]) root = resolve(args[1]);
  else if (args.length) {
    console.error("usage: check-dockerfile-context.mjs [--root DIR]");
    console.error("BLOCKED: usage error");
    process.exit(2);
  }
  const r = checkRepository(root);
  if (r.blocked) {
    console.error(`BLOCKED: ${r.reason}`);
    process.exit(r.blocked);
  }
  const all = [...r.manifests, ...r.sources, ...r.corepack];
  for (const p of all) console.error(`FAIL: ${p}`);
  console.log(
    `check-dockerfile-context: ${r.required.length} install inputs (${r.required.join(", ")}); ${r.trackedSources} tracked source files; ${all.length} problem(s)`,
  );
  console.log(all.length ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(all.length ? 1 : 0);
}
