#!/usr/bin/env node
// Repository, history and handover-text secret scan (ADR-0063 §1; REQ-S16-031 "the secret scan finds no secrets in the
// repository; the environment template contains placeholders only"; REQ-S21-003 "the handover text").
//
//   node tools/release/secret-scan.mjs [--scope payload|history] [--allowlist <file>]
//   node tools/release/secret-scan.mjs --path <dir-or-file> [--path ...] [--allowlist <file>]
//   node tools/release/secret-scan.mjs --scope envelope --list <manifest> [--allowlist <file>]
//
// Scopes: payload (default; the candidate manifest of the working tree, exactly the archive's source/), history (every
// blob reachable from HEAD, each once, through `git cat-file --batch`), --path (given files, recursively), envelope
// (the files the envelope manifest lists; the only scope that reads docs/delivery/** records, never by walking, D-138).
// Rules: S1 key-shape (tools/release/lib/patterns.mjs, frozen), S2 credential-url, S3 secret-assignment (entropy),
// S4 canary-misplaced, S5 env-template, S6 secret-file.
// Exit codes: 0 PASS, 1 FAIL (hits or a stale allow-list entry), 2 BLOCKED (no git repository for history, an
// unreadable list, a refused allow-list entry, a usage error). A matched value is never printed whole (`mask`).
// Pattern-based: it finds the listed shapes, not every secret (ADR-0063 §5 residual 1). Dependency-free; no network.
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_SPEC, globToRegExp, manifestFromWorkingTree } from "../gates/lib/candidate.mjs";
import { keyShapeRegExps, mask } from "./lib/patterns.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const DEFAULT_ALLOWLIST = join(HERE, "secret-allowlist.json");
export const MAX_BYTES = 20 * 1024 * 1024;
const BINARY_PROBE = 8192;
export const SCOPES = Object.freeze(["payload", "history", "path", "envelope"]);

export class SecretScanBlocked extends Error {}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------------------------------------------------- rules --

/** S2: `<scheme>://<user>:<password>@`. */
const CRED_URL = /\b([a-z][a-z0-9+.-]{1,20}):\/\/([^\s:/@'"`<>]+):([^\s@'"`/]*)@/gi;
/** S2/S3 placeholders: `%s`, `${…}`, `$NAME`, `<…>`, `***`, `[REDACTED]`, `…`, `...`, `{{…}}`. */
const PLACEHOLDER =
  /^(?:%[sd]|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|<[^>]*>|\*{3,}|\[REDACTED\]|…|\.\.\.|\{\{[^}]*\}\})$|^\$\{|^<.*>$/i;
/** S3: a key name containing a secret word, a separator, then a value. */
const SECRET_KEY =
  "[A-Za-z0-9_.-]*(?:secret(?!ar)|password|passwd|pwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key)[A-Za-z0-9_.-]*";
const ASSIGNMENT = new RegExp(
  String.raw`(["']?)(${SECRET_KEY})\1\s*(?:=(?![=>])|:(?!:))\s*(?:"([^"\n]*)"|'([^'\n]*)'|` +
    "`([^`\\n]*)`" +
    String.raw`|([^\s'"` + "`" + String.raw`,;)}\]]+))`,
  "gi",
);
/** The prefix of this scanner's own mask, `[<rule>:` (lib/patterns.mjs `mask`), e.g. `[S2:x…]` or `[S4-documented:…`. */
const OWN_MASK = /^\[S\d(?:-documented)?:/;
const CANARY = /mth-canary-[A-Za-z0-9_-]+/g;
const ENV_LINE = /^[A-Z][A-Z0-9_]*=$/;

/**
 * Self-declared non-secrets (S3 only): a value that contains one of these markers states that it is a test value
 * (`synthetic-token-…`, AWS's documented `…EXAMPLEKEY`, `ci-only-not-a-secret`, `not-used-…`). S1 and S2 do not honour it.
 */
const SYNTHETIC_MARKER = /synthetic|example|not-a-secret|not-used|dummy|placeholder/i;
/** Code files: an S3 value counts only as a quoted literal (an unquoted value is an expression, not a secret). */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  const n = [...s].length;
  for (const c of counts.values()) h -= (c / n) * Math.log2(c / n);
  return h;
}

/** True when an S3 value is a placeholder or a known non-secret shape (ADR-0063 §1.2). */
export function isNonSecretValue(key, value) {
  const v = value.trim();
  if (v.length < 16) return true;
  if (/\s/.test(v)) return true; // prose (an i18n message, a sentence), not a credential
  if (/\$\{|\$[A-Za-z_]/.test(v)) return true; // a shell or template expansion
  if (/^[[{]/.test(v)) return true; // a YAML/JSON flow collection (a list of secret NAMES)
  if (v.startsWith("mth-canary-")) return true; // a canary: S4's business
  if (SYNTHETIC_MARKER.test(v)) return true; // a value that declares itself synthetic
  if (PLACEHOLDER.test(v)) return true;
  if (/^process\.env\b|^import\.meta\.env\b|^env\./.test(v)) return true;
  if (/^\/run\/secrets\//.test(v) || /_FILE$|File$/i.test(key)) return true;
  if (/^[0-9a-f]{64}$/i.test(v) || /^sha256:[0-9a-f]+$/i.test(v) || /^sha512-[A-Za-z0-9+/=]+$/.test(v)) return true;
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return true; // a key NAME
  if (/^[a-z0-9_.]+$/.test(v)) return true; // an i18n key
  // a namespaced lower-case identifier, module id or repository path (`mth.automation.x.v1`, `virtual:x.css`, `a/b.ts`)
  if (/^(?:\\0)?[a-z][a-z0-9_-]*(?:[.:/][a-z0-9][a-z0-9_-]*)+$/.test(v)) return true;
  if (/[(){}]|=>|\$\{/.test(v)) return true; // code, not a literal
  if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+[\])]*;?$/.test(v)) return true; // a member expression (code)
  if (/\\[nrt"]/.test(v)) return true; // an escaped multi-line fragment (code quoted inside JSON), not one value
  if (/^(?:https?:)?\/\/|^\.{0,2}\/[\w./-]+$/.test(v) && !/:[^/@]+@/.test(v)) return true; // a URL or a path
  return entropy(v) < 3.5;
}

/** The test and CI paths where an `mth-canary-` value is documented (S4). */
const CANARY_PATHS = [
  "**/*.test.*",
  "**/*.vitest.mjs",
  "**/test/**",
  "**/tests/**",
  "tests/**",
  "e2e/**",
  "deploy/ci/**",
  ".github/workflows/**",
  "deploy/scripts/log-scan.mjs",
  "docs/architecture/**",
].map(globToRegExp);
export const isCanaryPath = (p) => CANARY_PATHS.some((r) => r.test(p));

/** S6: secret-file names. */
export function isSecretFile(p) {
  const name = basename(p);
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(name)) return true;
  return /^id_(rsa|ed25519)/.test(name) || name === "credentials.json";
}

/**
 * Scans one file's content. Returns [{ rule, line, value, context }]: `value` is the matched value (used for its hash
 * and masked in `context`; never printed). Canaries in test and CI paths are returned with rule "S4-documented".
 */
export function scanContent(path, buf) {
  const hits = [];
  const binary = buf.subarray(0, BINARY_PROBE).includes(0);
  const text = buf.toString(binary ? "latin1" : "utf8");
  const lines = text.split("\n");
  const isEnvTemplate = basename(path) === ".env.example";
  lines.forEach((raw, k) => {
    const line = raw.replace(/\r$/, "");
    const lineHits = [];
    for (const [, re] of keyShapeRegExps())
      for (const m of line.matchAll(re)) lineHits.push({ rule: "S1", value: m[0], index: m.index });
    if (!binary) {
      for (const m of line.matchAll(CRED_URL)) {
        const pw = m[3];
        if (pw === "" || PLACEHOLDER.test(pw) || /^\$|^%|^\*+$|^<|^\{\{|^mth-canary-/.test(pw)) continue;
        // The scanner's own masked output (`[S2:x…]`, lib/patterns.mjs mask) quoted in a committed scan log or run
        // transcript is not a credential: without this, every logged FAIL becomes a permanent history hit (T-DG7-DO-J2).
        if (OWN_MASK.test(pw)) continue;
        lineHits.push({ rule: "S2", value: pw, index: m.index + m[0].length - 1 - pw.length });
      }
      for (const m of line.matchAll(ASSIGNMENT)) {
        if (m[6] !== undefined && CODE_FILE.test(path)) continue;
        const value = m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
        if (isNonSecretValue(m[2], value)) continue;
        if (lineHits.some((h) => h.value.includes(value) || value.includes(h.value))) continue;
        lineHits.push({ rule: "S3", value, index: m.index + m[0].lastIndexOf(value) });
      }
      for (const m of line.matchAll(CANARY))
        lineHits.push({ rule: isCanaryPath(path) ? "S4-documented" : "S4", value: m[0], index: m.index });
      if (isEnvTemplate && line.trim() !== "" && !line.trimStart().startsWith("#") && !ENV_LINE.test(line))
        lineHits.push({ rule: "S5", value: line, index: 0 });
    }
    if (lineHits.length === 0) return;
    let context = line;
    for (const h of [...lineHits].sort((a, b) => b.value.length - a.value.length))
      context = context.split(h.value).join(mask(h.rule, h.value));
    context = context.trim();
    if (context.length > 200) context = `${context.slice(0, 199)}…`;
    for (const h of lineHits) hits.push({ rule: h.rule, line: k + 1, value: h.value, context });
  });
  if (isSecretFile(path)) hits.push({ rule: "S6", line: 0, value: path, context: `[S6:secret-file]` });
  return hits;
}

// ------------------------------------------------------------------------------------------------------ allow-list --

/** Paths an allow-list entry can never cover (ADR-0063 §1.3). */
const PROTECTED_PROBES = [
  ".env.example",
  "deploy/compose/compose.yaml",
  "deploy/compose/x/y.yaml",
  "deploy/docker/Dockerfile",
  "deploy/docker/x/y",
  "deploy/keycloak/realm.json",
  "deploy/keycloak/x/y.json",
  "docs/handover/x.md",
  "docs/handover/x/y.md",
  "apps/api/src/x.ts",
  "apps/web/src/x/y.tsx",
  "apps/worker/src/x.mjs",
  "packages/config/src/x.ts",
  "packages/db/src/x/y.ts",
];
const isTestPath = (p) => /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test|tests|__tests__)\//.test(p);
export function isProtectedPath(p) {
  if (p === ".env.example" || /^deploy\/(compose|docker|keycloak)\//.test(p) || p.startsWith("docs/handover/")) return true;
  return /^(apps|packages)\/[^/]+\/src\//.test(p) && !isTestPath(p);
}
/** True when the glob can match a protected path. */
export function globCoversProtected(glob) {
  if (!/[*?]/.test(glob)) return isProtectedPath(glob);
  const re = globToRegExp(glob);
  return PROTECTED_PROBES.some((p) => re.test(p)) || isProtectedPath(glob.replace(/\*\*?/g, "x").replace(/\?/g, "x"));
}

/**
 * Loads the allow-list (ADR-0063 §1.3). Each entry: { rule, path (glob), valueSha256, reason, scopes? }. `scopes`
 * (default ["payload", "history"]) names the scopes the entry belongs to; evidence quotes that exist only in delivery
 * records are ["history", "envelope"]. Throws SecretScanBlocked on a refused or malformed entry.
 */
export function loadAllowlist(file) {
  if (!file) return [];
  if (!existsSync(file)) throw new SecretScanBlocked(`secret-scan: BLOCKED: allow-list not found: ${file}`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new SecretScanBlocked(`secret-scan: BLOCKED: cannot read allow-list ${file} (${e.message})`);
  }
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new SecretScanBlocked(`secret-scan: BLOCKED: allow-list ${file} has no entries array`);
  return entries.map((e, n) => {
    for (const k of ["rule", "path", "valueSha256", "reason"])
      if (typeof e?.[k] !== "string" || e[k].trim() === "")
        throw new SecretScanBlocked(`secret-scan: BLOCKED: allow-list entry ${n} lacks "${k}"`);
    if (!/^[0-9a-f]{64}$/.test(e.valueSha256))
      throw new SecretScanBlocked(`secret-scan: BLOCKED: allow-list entry ${n} valueSha256 is not 64 hex`);
    const scopes = e.scopes ?? ["payload", "history"];
    if (!Array.isArray(scopes) || scopes.some((s) => !SCOPES.includes(s)))
      throw new SecretScanBlocked(`secret-scan: BLOCKED: allow-list entry ${n} has invalid scopes`);
    if (globCoversProtected(e.path)) throw new SecretScanBlocked(`secret-scan: an allow-list entry cannot cover ${e.path}`);
    return { ...e, scopes, re: globToRegExp(e.path) };
  });
}

// ------------------------------------------------------------------------------------------------------- targets --

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

function walk(abs) {
  const st = lstatSync(abs);
  if (st.isFile()) return [abs];
  if (!st.isDirectory()) return [];
  return readdirSync(abs)
    .sort()
    .flatMap((n) => walk(join(abs, n)));
}

/** A path for output: relative to the repository, else to the working directory, else absolute. */
const shown = (repo, abs) => {
  for (const base of [repo, process.cwd()]) {
    const rel = relative(base, abs);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return abs;
};

/** Reads the envelope list: JSON (array of paths, or { files: [path | { path }] }) or one path per line. */
export function readList(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new SecretScanBlocked(`secret-scan: BLOCKED: cannot read list ${file} (${e.code ?? e.message})`);
  }
  let items;
  try {
    const j = JSON.parse(text);
    items = Array.isArray(j) ? j : j.files;
  } catch {
    items = text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  }
  if (!Array.isArray(items)) throw new SecretScanBlocked(`secret-scan: BLOCKED: list ${file} names no files`);
  return items.map((x) => (typeof x === "string" ? x : x?.path)).filter((x) => typeof x === "string");
}

/** Streams every blob reachable from HEAD (each object once), calling onBlob(path, buf). */
async function eachHistoryBlob(repo, onBlob) {
  try {
    git(repo, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    throw new SecretScanBlocked(`secret-scan: BLOCKED: --scope history needs a git repository with a HEAD (${repo})`);
  }
  const listed = git(repo, ["rev-list", "--objects", "--filter=object:type=blob", "HEAD"]).toString("utf8").split("\n");
  const objects = [];
  const seen = new Set();
  for (const l of listed) {
    const sp = l.indexOf(" ");
    if (sp < 0) continue; // a commit or an object without a path
    const oid = l.slice(0, sp);
    const path = l.slice(sp + 1);
    if (seen.has(oid) || path.startsWith("trading_agent/")) continue;
    seen.add(oid);
    objects.push({ oid, path });
  }
  const sizes = new Map();
  const check = execFileSync("git", ["-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: objects.map((o) => o.oid).join("\n") + "\n",
    maxBuffer: 1 << 28,
  })
    .toString("utf8")
    .split("\n");
  for (const l of check) {
    const [oid, type, size] = l.split(" ");
    if (type === "blob") sizes.set(oid, Number(size));
  }
  const wanted = objects.filter((o) => sizes.has(o.oid));
  const big = wanted.filter((o) => sizes.get(o.oid) > MAX_BYTES);
  const small = wanted.filter((o) => sizes.get(o.oid) <= MAX_BYTES);
  for (const o of big) onBlob(o.path, null, o.oid);
  await new Promise((resolveP, reject) => {
    const child = spawn("git", ["-C", repo, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = Buffer.alloc(0);
    let k = 0;
    child.stdout.on("data", (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        const nl = buf.indexOf(10);
        if (nl < 0) return;
        const header = buf.subarray(0, nl).toString("utf8").split(" ");
        const size = Number(header[2]);
        if (buf.length < nl + 1 + size + 1) return;
        const content = buf.subarray(nl + 1, nl + 1 + size);
        onBlob(small[k].path, Buffer.from(content), header[0]);
        k++;
        buf = buf.subarray(nl + 1 + size + 1);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolveP() : reject(new Error(`git cat-file exited ${code}`))));
    child.stdin.end(small.map((o) => o.oid).join("\n") + "\n");
  });
  return wanted.length;
}

// ---------------------------------------------------------------------------------------------------------- scan --

/**
 * The module API (DO-J at sealing; slice I for the release notes):
 * scanSecrets({ scope, repo, paths, list, allowlist }) → Promise<{ ok, hits, allowed, canaries, files, skipped, stale }>.
 * `hits` are [{ rule, path, line, masked, valueSha256 }] (no value is returned). Throws SecretScanBlocked (exit 2).
 */
export async function scanSecrets({ scope = "payload", repo = REPO, paths = [], list, allowlist = DEFAULT_ALLOWLIST } = {}) {
  if (paths.length && scope === "payload") scope = "path";
  if (!SCOPES.includes(scope)) throw new SecretScanBlocked(`secret-scan: BLOCKED: unknown scope ${scope}`);
  if (scope === "path" && paths.length === 0) throw new SecretScanBlocked("secret-scan: BLOCKED: --path needs a file or directory");
  if (scope === "envelope" && !list) throw new SecretScanBlocked("secret-scan: BLOCKED: --scope envelope needs --list <file>");
  const entries = loadAllowlist(allowlist);
  const used = new Set();
  const scannedPaths = [];
  const hits = [];
  const skipped = [];
  let allowed = 0;
  let canaries = 0;
  let files = 0;
  const onBlob = (path, buf, id) => {
    files++;
    scannedPaths.push(path);
    if (buf === null) {
      skipped.push({ path, reason: "skipped-size", sha: id });
      return;
    }
    for (const h of scanContent(path, buf)) {
      if (h.rule === "S4-documented") {
        canaries++;
        continue;
      }
      const valueSha256 = sha256(Buffer.from(h.value, "utf8"));
      const match = entries
        .map((e, n) => ({ e, n }))
        .filter(
          ({ e }) =>
            e.scopes.includes(scope) && e.rule === h.rule && e.valueSha256 === valueSha256 && (scope === "history" || e.re.test(path)),
        );
      if (match.length) {
        match.forEach(({ n }) => used.add(n));
        allowed++;
        continue;
      }
      hits.push({ rule: h.rule, path, line: h.line, masked: h.context, valueSha256 });
    }
  };
  const readFile = (abs, path) => {
    const st = statSync(abs);
    if (st.size > MAX_BYTES) {
      files++;
      scannedPaths.push(path);
      skipped.push({ path, reason: "skipped-size", sha: sha256(readFileSync(abs)) });
      return;
    }
    onBlob(path, readFileSync(abs), null);
  };
  if (scope === "payload") {
    let manifest;
    try {
      manifest = manifestFromWorkingTree(repo, APPROVED_SPEC);
    } catch (e) {
      throw new SecretScanBlocked(`secret-scan: BLOCKED: no candidate manifest for ${repo} (${e.message.split("\n")[0]})`);
    }
    for (const { path, mode } of manifest) {
      if (mode === "120000") continue; // a symlink: its target is scanned where it lives
      readFile(join(repo, path), path);
    }
  } else if (scope === "history") {
    await eachHistoryBlob(repo, onBlob);
  } else if (scope === "path") {
    for (const p of paths) {
      const abs = resolve(p);
      if (!existsSync(abs)) throw new SecretScanBlocked(`secret-scan: BLOCKED: not found: ${p}`);
      for (const f of walk(abs)) readFile(f, shown(repo, f));
    }
  } else {
    for (const p of readList(list)) {
      const abs = isAbsolute(p) ? p : join(repo, p);
      if (!existsSync(abs) || !lstatSync(abs).isFile())
        throw new SecretScanBlocked(`secret-scan: BLOCKED: listed file not found: ${p}`);
      readFile(abs, shown(repo, abs));
    }
  }
  // Stale entries (ADR-0063 §1.3). payload and history cover the whole repository, so an entry of that scope that
  // matched nothing is stale. path and envelope scan a subset: there an entry is stale only when its path is a literal
  // file path that was scanned (a glob entry may cover files the subset does not hold).
  const stale = [];
  const scannedSet = new Set(scannedPaths);
  entries.forEach((e, n) => {
    if (!e.scopes.includes(scope) || used.has(n)) return;
    const whole = scope === "payload" || scope === "history";
    if (whole || (!/[*?]/.test(e.path) && scannedSet.has(e.path))) stale.push({ n, path: e.path });
  });
  return { ok: hits.length === 0 && stale.length === 0, scope, hits, allowed, canaries, files, skipped, stale };
}

/** Formats a result as the exact messages of p7-work-split §G.3. */
export function report(r) {
  const out = r.hits.map((h) => `${h.rule} ${h.path}:${h.line}: ${h.masked} (value sha256 ${h.valueSha256.slice(0, 12)})`);
  for (const s of r.skipped) out.push(`secret-scan: ${s.reason} ${s.path} (sha256 ${String(s.sha).slice(0, 12)})`);
  for (const s of r.stale) out.push(`secret-scan: stale allow-list entry ${s.n} (${s.path})`);
  out.push(
    r.ok
      ? `secret-scan: PASS (${r.scope}; ${r.files} files; allowed ${r.allowed}; canary (documented) ${r.canaries})`
      : `secret-scan: FAIL (${r.hits.length + r.stale.length} hits)`,
  );
  return out.join("\n");
}

async function main(argv) {
  let scope;
  const paths = [];
  let list;
  let allowlist = DEFAULT_ALLOWLIST;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--scope" && v) (scope = v), i++;
    else if (a === "--path" && v) paths.push(v), i++;
    else if (a === "--list" && v) (list = v), i++;
    else if (a === "--allowlist" && v) (allowlist = resolve(v)), i++;
    else {
      console.log(
        `secret-scan: BLOCKED: usage: secret-scan.mjs [--scope payload|history|envelope --list <file>] [--path <p>]... [--allowlist <file>] (got ${a})`,
      );
      return 2;
    }
  }
  if (paths.length && scope && scope !== "path") {
    console.log("secret-scan: BLOCKED: --path cannot be combined with --scope");
    return 2;
  }
  try {
    const r = await scanSecrets({ scope: paths.length ? "path" : (scope ?? "payload"), paths, list, allowlist });
    console.log(report(r));
    return r.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof SecretScanBlocked) {
      console.log(e.message);
      return 2;
    }
    console.log(`secret-scan: BLOCKED: ${e?.message ?? e}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
