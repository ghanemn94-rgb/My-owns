#!/usr/bin/env node
// Scan of built assets and configuration (ADR-0062 §8; REQ-S19-019 first half): no public CDN, builder host,
// personal key, unlisted host, builder-hosted data service or personal e-mail address in what is shipped.
//
//   node tools/release/scan-assets.mjs --web <apps/web/dist> --runtime <assembled runtime dir> --config <repo root>
//                                      [--allowlist <file>] [--no-git-remote]
//
// Targets: T1 first-party built output (--web, and apps/api|worker/dist, packages/*/dist under --config);
//          T2 configuration (deploy/**, .env.example, root and workspace package.json under --config);
//          T3 third-party runtime packages (node_modules/** of --runtime).
// Exit codes: 0 PASS, 1 FAIL (hits or a stale allow-list entry), 2 BLOCKED (a target missing, a bad allow-list).
// Dependency-free; no network; never reads docs/delivery/** (D-138). A matched value is never printed whole
// (tools/release/lib/patterns.mjs `mask`). Pattern-based: absence of the listed classes, not proof of no runtime
// dependency on an unlisted service (that is the offline e2e run, ADR-0069).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keyShapeRegExps, mask } from "./lib/patterns.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWLIST = join(HERE, "asset-scan-allowlist.json");
const MAX_BYTES = 20 * 1024 * 1024;

/** R1 exact hosts: a superset of scripts/check-no-cdn.mjs BANNED (enforced by T-A10). */
export const R1_HOSTS = Object.freeze([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "esm.sh",
  "cdn.skypack.dev",
  "ajax.googleapis.com",
  "code.jquery.com",
  "stackpath.bootstrapcdn.com",
  "use.fontawesome.com",
  "kit.fontawesome.com",
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "plausible.io",
]);
/** R1 domain suffixes (`*.domain` and the domain itself). */
export const R1_SUFFIXES = Object.freeze([
  "cloudflareinsights.com",
  "sentry.io",
  "segment.io",
  "mixpanel.com",
  "hotjar.com",
  "intercom.io",
  "datadoghq.com",
  "googletagmanager.com",
  "google-analytics.com",
]);
/** R2 builder or workspace hosts. */
export const R2_SUFFIXES = Object.freeze([
  "claude.ai",
  "anthropic.com",
  "claude.com",
  "githubusercontent.com",
  "github.dev",
  "repl.co",
  "vercel.app",
  "netlify.app",
]);
const R2_HOST_SUBSTRINGS = ["codespaces", "ngrok"];
const R2_PATHS = ["/home/user/", "/root/", "/var/tmp/mth-run", "/tmp/claude"];
/** R5 builder-hosted databases and storage. */
export const R5_SUFFIXES = Object.freeze([
  "supabase.co",
  "firebaseio.com",
  "firebasestorage.app",
  "neon.tech",
  "planetscale.com",
  "mongodb.net",
  "s3.amazonaws.com",
  "blob.core.windows.net",
  "storage.googleapis.com",
]);
const R6_ALLOWED_DOMAINS = ["example.invalid", "example.com", "example.org", "example.net"];
const R6_ALLOWED_SUFFIXES = ["example", "invalid", "test"];

const RULES = {
  R1: "public-cdn",
  R2: "builder-host",
  R3: "personal-key",
  R4: "unlisted-host",
  R5: "hosted-data-service",
  R6: "personal-email",
};
/** Rules applied per target (ADR-0062 §8 table). */
export const APPLIES = Object.freeze({
  T1: ["R1", "R2", "R3", "R4", "R5", "R6"],
  T2: ["R1", "R2", "R3", "R4", "R5", "R6"],
  T3: ["R1", "R2", "R3"],
});
const NEVER_ALLOWED = new Set(["R1", "R3", "R5"]);

export class ScanError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const endsWithDomain = (host, d) => host === d || host.endsWith(`.${d}`);

/** Host classes for a hostname found in a URL. `urlContext` enables the wildcard R1 forms (cdn.*, fonts.*). */
export function classifyHost(host, { urlContext }) {
  const h = host.toLowerCase().replace(/\.$/, "");
  const rules = [];
  if (
    R1_HOSTS.includes(h) ||
    R1_SUFFIXES.some((d) => endsWithDomain(h, d)) ||
    (urlContext && (/^cdn\./.test(h) || /\.cdn\./.test(h) || /^fonts\./.test(h)))
  )
    rules.push("R1");
  if (R2_SUFFIXES.some((d) => endsWithDomain(h, d)) || R2_HOST_SUBSTRINGS.some((s) => h.includes(s))) rules.push("R2");
  if (R5_SUFFIXES.some((d) => endsWithDomain(h, d)) || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(h)) rules.push("R5");
  return rules;
}

const URL_RE =
  /(?:\bhttps?:\/\/|(?<![A-Za-z0-9:/])\/\/(?=[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/))([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?![A-Za-z0-9.\\-])(?::\d+)?/g;
const HOST_TOKEN_RE = /(?<![A-Za-z0-9.@-])((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
const SESSION_RE = /session_[A-Za-z0-9]{20,}/g;

function emailAllowed(domain) {
  const d = domain.toLowerCase();
  return R6_ALLOWED_DOMAINS.includes(d) || R6_ALLOWED_SUFFIXES.some((s) => d === s || d.endsWith(`.${s}`));
}

/** All raw hits of one line: [{ rule, value, host? }]. */
export function scanLine(line, { target, identifiers = [] }) {
  const applies = new Set(APPLIES[target]);
  const hits = [];
  const seen = new Set();
  const push = (rule, value, host) => {
    const k = `${rule}\0${value}`;
    const hk = host ? `${rule}\0host\0${host}` : null;
    if (!applies.has(rule) || seen.has(k) || (hk && seen.has(hk))) return;
    seen.add(k);
    if (hk) seen.add(hk);
    hits.push({ rule, value, host });
  };
  for (const m of line.matchAll(URL_RE)) {
    const host = m[1].toLowerCase();
    const classes = classifyHost(host, { urlContext: true });
    for (const r of classes) push(r, m[0], host);
    if (classes.length === 0) push("R4", m[0], host);
  }
  for (const m of line.matchAll(HOST_TOKEN_RE)) for (const r of classifyHost(m[1], { urlContext: false })) push(r, m[1], m[1].toLowerCase());
  if (applies.has("R5")) for (const m of line.matchAll(/\bs3[.-][a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9._-]+/g)) push("R5", m[0], "amazonaws.com");
  for (const p of R2_PATHS) {
    let i = line.indexOf(p);
    while (i !== -1) {
      push("R2", p, null);
      i = line.indexOf(p, i + 1);
    }
  }
  for (const m of line.matchAll(SESSION_RE)) push("R2", m[0], null);
  for (const id of identifiers) {
    const re = new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`, "gi");
    for (const m of line.matchAll(re)) push("R2", m[0], null);
  }
  for (const [, re] of keyShapeRegExps()) for (const m of line.matchAll(re)) push("R3", m[0], null);
  for (const m of line.matchAll(EMAIL_RE)) if (!emailAllowed(m[1])) push("R6", m[0], m[1].toLowerCase());
  return hits;
}

/** The repository slug and owner from `git remote get-url origin`, if any (R2). */
export function gitIdentifiers(root) {
  try {
    const url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return m ? [`${m[1]}/${m[2]}`, m[1]] : [];
  } catch {
    return [];
  }
}

/** Loads and validates the allow-list; refuses R1/R3/R5 entries for T1/T2 and T3 entries without file+sha256. */
export function loadAllowlist(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ScanError(`scan-assets: BLOCKED: cannot read allow-list ${path} (${e.message})`, 2);
  }
  const entries = Array.isArray(doc) ? doc : doc.entries;
  if (!Array.isArray(entries)) throw new ScanError("scan-assets: BLOCKED: the allow-list has no entries array", 2);
  entries.forEach((e, i) => {
    const n = i + 1;
    const bad = (why) => {
      throw new ScanError(`scan-assets: BLOCKED: allow-list entry ${n} refused: ${why}`, 2);
    };
    if (!RULES[e.rule]) bad(`unknown rule ${e.rule}`);
    if (!APPLIES[e.target]) bad(`unknown target ${e.target}`);
    if (!e.reason || String(e.reason).trim().length < 10) bad("no reason");
    if (NEVER_ALLOWED.has(e.rule) && (e.target === "T1" || e.target === "T2"))
      bad(`${e.rule} hits in ${e.target} can never be allow-listed`);
    if (e.target === "T3" && !(e.file && e.sha256 && e.package)) bad("a T3 entry needs package, file and sha256");
    if (!e.host && !(e.file && e.sha256)) bad("an entry needs host, or file and sha256");
  });
  return entries;
}

function hostMatches(pattern, host) {
  if (!host) return false;
  const p = pattern.toLowerCase();
  return p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p;
}

function walk(root, rel, out, skip = () => false) {
  let names;
  try {
    names = readdirSync(join(root, rel)).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const p = rel ? `${rel}/${name}` : name;
    if (skip(p)) continue;
    const st = lstatSync(join(root, p));
    if (st.isSymbolicLink()) continue; // pnpm links: the real directory is scanned under .pnpm
    if (st.isDirectory()) walk(root, p, out, skip);
    else if (st.isFile()) out.push(p);
  }
}

/** The files of each target as [{ target, abs, shown, pkg }]. Throws BLOCKED when a target directory is missing. */
export function collectTargets({ web, runtime, config }) {
  const files = [];
  const need = (dir, label) => {
    if (!dir || !existsSync(dir) || !lstatSync(dir).isDirectory())
      throw new ScanError(`scan-assets: BLOCKED: ${label} not found; run pnpm -r build first`, 2);
  };
  need(web, web ?? "--web");
  need(config, config ?? "--config");
  need(runtime, runtime ?? "--runtime");
  // Paths are shown relative to --config; a --web directory outside it is shown as web/<path>.
  const webAbs = resolve(web);
  const shownOf = (abs) => {
    const rel = relative(config, abs);
    if (!rel.startsWith("..")) return rel.split(sep).join("/");
    return `web/${relative(webAbs, abs).split(sep).join("/")}`;
  };
  const t1Dirs = [webAbs];
  for (const d of ["apps/api/dist", "apps/worker/dist"]) {
    need(join(config, d), d);
    t1Dirs.push(join(config, d));
  }
  for (const pkg of existsSync(join(config, "packages")) ? readdirSync(join(config, "packages")).sort() : [])
    if (existsSync(join(config, "packages", pkg, "dist"))) t1Dirs.push(join(config, "packages", pkg, "dist"));
  for (const dir of [...new Set(t1Dirs)]) {
    const list = [];
    walk(dir, "", list);
    for (const p of list) files.push({ target: "T1", abs: join(dir, p), shown: shownOf(join(dir, p)) });
  }
  const t2 = [];
  walk(join(config, "deploy"), "", t2);
  for (const p of t2) files.push({ target: "T2", abs: join(config, "deploy", p), shown: `deploy/${p}` });
  for (const p of [".env.example", "package.json"])
    if (existsSync(join(config, p))) files.push({ target: "T2", abs: join(config, p), shown: p });
  for (const group of ["apps", "packages"])
    for (const d of existsSync(join(config, group)) ? readdirSync(join(config, group)).sort() : [])
      if (existsSync(join(config, group, d, "package.json")))
        files.push({ target: "T2", abs: join(config, group, d, "package.json"), shown: `${group}/${d}/package.json` });
  const nm = join(runtime, "node_modules");
  need(nm, `${runtime}/node_modules`);
  const t3 = [];
  walk(nm, "", t3);
  for (const p of t3) files.push({ target: "T3", abs: join(nm, p), shown: `runtime/node_modules/${p}`, pkg: packageOf(nm, p) });
  return files;
}

const pkgCache = new Map();
/** name@version of the package that holds a node_modules file (nearest package.json with a name and version). */
function packageOf(nm, rel) {
  const parts = rel.split("/");
  for (let i = parts.length - 1; i > 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (pkgCache.has(join(nm, dir))) return pkgCache.get(join(nm, dir));
    const pj = join(nm, dir, "package.json");
    if (existsSync(pj)) {
      try {
        const j = JSON.parse(readFileSync(pj, "utf8"));
        if (j.name && j.version) {
          const id = `${j.name}@${j.version}`;
          pkgCache.set(join(nm, dir), id);
          return id;
        }
      } catch {
        /* keep walking up */
      }
    }
  }
  return "(unknown)";
}

function context(line, value, rule) {
  const i = line.indexOf(value);
  const before = line.slice(Math.max(0, i - 30), i);
  const after = line.slice(i + value.length, i + value.length + 30);
  let ctx = `${before}${mask(rule, value)}${after}`;
  for (const [cls, re] of keyShapeRegExps()) ctx = ctx.replace(re, (v) => mask(cls, v)); // never print a key whole
  return ctx.replace(/[\u0000-\u001f]/g, " ");
}

/** Runs the scan. Returns { code, lines }; never throws for hits. */
export function scanAssets({ web, runtime, config, allowlist = DEFAULT_ALLOWLIST, useGitRemote = true }) {
  const entries = loadAllowlist(allowlist);
  const used = new Array(entries.length).fill(false);
  const identifiers = useGitRemote ? gitIdentifiers(config) : [];
  const files = collectTargets({ web, runtime, config });
  const lines = [];
  const counts = { T1: 0, T2: 0, T3: 0 };
  let hits = 0;
  for (const f of files) {
    counts[f.target]++;
    if (f.shown.startsWith("docs/delivery/")) continue; // never read (D-138); unreachable with the target roots above
    const buf = readFileSync(f.abs);
    const fileSha = sha256(buf);
    if (buf.length > MAX_BYTES) {
      lines.push(`${f.target} skipped-size ${f.shown}: ${buf.length} bytes sha256 ${fileSha}`);
      continue;
    }
    const binary = buf.subarray(0, 8192).includes(0);
    const text = buf.toString(binary ? "latin1" : "utf8");
    const textLines = text.split("\n");
    for (let ln = 0; ln < textLines.length; ln++) {
      const line = textLines[ln];
      if (line.length === 0) continue;
      for (const h of scanLine(line, { target: f.target, identifiers })) {
        const idx = entries.findIndex(
          (e) =>
            e.rule === h.rule &&
            e.target === f.target &&
            (e.host ? hostMatches(e.host, h.host) : e.file === f.shown && e.sha256 === fileSha) &&
            (f.target !== "T3" || e.package === f.pkg),
        );
        if (idx !== -1) {
          used[idx] = true;
          continue;
        }
        hits++;
        const where = f.target === "T3" ? `${f.pkg} ${f.shown}` : f.shown;
        lines.push(`${f.target} ${h.rule} ${where}:${ln + 1}: ${context(line, h.value, h.rule)}`);
      }
    }
  }
  let stale = 0;
  used.forEach((u, i) => {
    if (!u) {
      stale++;
      lines.push(`scan-assets: stale allow-list entry ${i + 1}`);
    }
  });
  const total = counts.T1 + counts.T2 + counts.T3;
  if (hits === 0 && stale === 0) {
    lines.push(`scan-assets: PASS (${total} files; T1 ${counts.T1}, T2 ${counts.T2}, T3 ${counts.T3})`);
    return { code: 0, lines, counts };
  }
  if (hits > 0) lines.push(`scan-assets: FAIL (${hits} hits)`);
  return { code: 1, lines, counts, hits, stale };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  try {
    const r = scanAssets({
      web: opt("--web") && resolve(opt("--web")),
      runtime: opt("--runtime") && resolve(opt("--runtime")),
      config: opt("--config") && resolve(opt("--config")),
      allowlist: opt("--allowlist") ? resolve(opt("--allowlist")) : DEFAULT_ALLOWLIST,
      useGitRemote: !argv.includes("--no-git-remote"),
    });
    r.lines.forEach((l) => console.log(l));
    process.exit(r.code);
  } catch (e) {
    console.error(e instanceof ScanError ? e.message : `scan-assets: BLOCKED: ${e.message}`);
    process.exit(e instanceof ScanError ? e.exitCode : 2);
  }
}
