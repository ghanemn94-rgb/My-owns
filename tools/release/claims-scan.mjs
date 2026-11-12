#!/usr/bin/env node
// Scan of documentation and UI strings for compliance and certification claims (ADR-0063 §3; REQ-S16-033 "a text scan
// of docs and UI strings finds no compliance or certification claim").
//
//   node tools/release/claims-scan.mjs [--root <dir>]... [--allowlist <file>] [--show-negated]
//
// Groups: D docs (what the archive's docs/ holds, root and package README.md files, licenses/README.md and the archive
// README.txt text) and U UI strings (i18n catalogues, provisional Arabic literals, index.html, string literals of the
// API, the migrations' seeded texts and the demo texts). With --root, every file under each root is scanned as group D
// (an unpacked archive's docs/, DO-J).
// Rules: K1 PMI (imported unchanged from packages/shared/src/text-scan/claims.ts; no fallback copy), K2 conformity word
// governing an object, K3 named framework with a claim or assertion word, K4 certification adjective on a product noun.
// A K2-K4 hit is negated (and allowed) when a negation token stands at most 6 words before its first word.
// Exit codes: 0 PASS, 1 FAIL (hits or a stale allow-list entry), 2 BLOCKED (cannot import the PMI rule, a bad
// allow-list, a usage error). Pattern-based: it cannot understand every phrasing (ADR-0063 §5 residual 1).
// Dependency-free; no network; never reads docs/delivery/** other than the register (D-138).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { globToRegExp } from "../gates/lib/candidate.mjs";
import {
  ASSERTION_WORDS,
  CERTIFIED_ADJECTIVES,
  CERTIFIED_ADJECTIVES_AR,
  CONFORMITY_WORDS,
  CONFORMITY_WORDS_AR,
  FRAMEWORKS,
  GOVERNING_AFTER,
  GOVERNING_AFTER_AR,
  GOVERNING_BEFORE,
  NEGATION_WINDOW,
  NEGATIONS,
  NON_CLAIM_OBJECTS,
  PRODUCT_NOUNS,
  PRODUCT_NOUNS_AR,
  inList,
  sentences,
  stringLiteralsSql,
  stringLiteralsTs,
  words,
} from "./lib/claims-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const DEFAULT_ALLOWLIST = join(HERE, "claims-allowlist.json");
const MAX_SENTENCE = 160;

/** Group D (docs) globs (ADR-0063 §3.1; ADR-0062 §2). */
export const GROUP_D = Object.freeze([
  "docs/handover/**",
  "docs/operations/**",
  "docs/api/**",
  "docs/architecture/**",
  "docs/delivery/requirements.csv",
  "README.md",
  "apps/*/README.md",
  "packages/*/README.md",
  "licenses/README.md",
]);
/** Group U (UI strings) globs; test files are excluded by TEST_FILE. */
export const GROUP_U = Object.freeze([
  "apps/web/src/i18n/**/*.json",
  "apps/web/src/i18n/**/provisional-ar*.ts",
  "apps/web/index.html",
  "apps/api/src/**/*.ts",
  "packages/db/migrations/*.sql",
  "packages/db/src/demo/**/*.ts",
]);
const TEST_FILE = /(^|\/)(test|tests|__tests__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
/** The virtual file of the archive README.txt text (ADR-0062 §2.2, exported by build-archive.mjs). */
export const ARCHIVE_README = "tools/release/build-archive.mjs#ARCHIVE_README_TEXT";

export class ClaimsBlocked extends Error {}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const D_RES = GROUP_D.map(globToRegExp);
const U_RES = GROUP_U.map(globToRegExp);
export const groupOf = (p) =>
  U_RES.some((r) => r.test(p)) && !TEST_FILE.test(p) ? "U" : D_RES.some((r) => r.test(p)) ? "D" : null;

let pmiRule;
/** Imports the DG5 PMI rule through Node 24 type stripping. Throws ClaimsBlocked when it cannot (never a fallback). */
export async function loadPmiRule() {
  if (pmiRule) return pmiRule;
  const file = join(REPO, "packages", "shared", "src", "text-scan", "claims.ts");
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.claimsOfficialPmi !== "function") throw new Error("claimsOfficialPmi is not exported");
    pmiRule = mod;
    return mod;
  } catch (e) {
    throw new ClaimsBlocked(
      `claims-scan: BLOCKED: cannot import packages/shared/src/text-scan/claims.ts (${e?.message ?? e})`,
    );
  }
}

const FRAMEWORK_RES = FRAMEWORKS.map(([name, src]) => [name, new RegExp(src, "gi")]);
const isConformity = (w) => CONFORMITY_WORDS.includes(w) || inList(w, CONFORMITY_WORDS_AR);
const isGovAfter = (w) =>
  GOVERNING_AFTER.includes(w) ||
  GOVERNING_AFTER_AR.includes(w) ||
  (w.startsWith("ل") && w.length > 3 && !AR_L_WORDS.includes(w));
/** Words that start with ل but are not the attached particle لـ. */
const AR_L_WORDS = ["لكن", "لكل", "ليس", "ليست", "لدى", "لذلك", "لهذا", "لهذه", "لأن"];
const isNegation = (w) => NEGATIONS.includes(w) || inList(w, NEGATIONS);

/**
 * Classifies one sentence (rules K2-K4; K1 is applied by `classify`). Returns [{ rule, first }] where `first` is the
 * index of the hit's first word.
 */
function k2to4(ws, text) {
  const out = [];
  const conformity = [];
  for (let i = 0; i < ws.length; i++) {
    if (!isConformity(ws[i].norm)) continue;
    conformity.push(i);
    const g = ws.slice(i + 1, i + 5).findIndex((w) => isGovAfter(w.norm));
    const before = i > 0 && GOVERNING_BEFORE.includes(ws[i - 1].norm);
    if (g >= 0 && !before && isNonClaimObject(ws, i + 1 + g)) continue;
    if (g >= 0 || before) out.push({ rule: "K2", first: before ? i - 1 : i });
  }
  const frameworkWords = [];
  for (const [, re] of FRAMEWORK_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const idx = ws.findIndex((w) => w.index + w.raw.length > m.index);
      if (idx >= 0) frameworkWords.push(idx);
    }
  }
  if (frameworkWords.length) {
    const claimWords = [];
    for (let i = 0; i < ws.length; i++) if (isConformity(ws[i].norm) || inList(ws[i].norm, ASSERTION_WORDS)) claimWords.push(i);
    if (claimWords.length) out.push({ rule: "K3", first: Math.min(...frameworkWords, ...claimWords) });
  }
  for (let i = 0; i + 1 < ws.length; i++) {
    if (CERTIFIED_ADJECTIVES.includes(ws[i].norm) && PRODUCT_NOUNS.includes(ws[i + 1].norm.replace(/s$/, "")))
      out.push({ rule: "K4", first: i });
    if (inList(ws[i].norm, PRODUCT_NOUNS_AR) && inList(ws[i + 1].norm, CERTIFIED_ADJECTIVES_AR))
      out.push({ rule: "K4", first: i });
  }
  return out;
}

/** The object governed by the word at `gi` (ADR-0063 §3.2) starts with one of NON_CLAIM_OBJECTS. */
function isNonClaimObject(ws, gi) {
  const w = ws[gi].norm;
  // An attached لـ (للعملية = لـ + العملية) carries the object's first word itself.
  const attached = !GOVERNING_AFTER.includes(w) && !GOVERNING_AFTER_AR.includes(w);
  const obj = attached
    ? [w.startsWith("لل") ? `ال${w.slice(2)}` : w.slice(1), ...ws.slice(gi + 1).map((x) => x.norm)]
    : ws.slice(gi + 1).map((x) => x.norm);
  return NON_CLAIM_OBJECTS.some((o) => o.every((t, k) => obj[k] === t));
}

function negated(ws, first) {
  for (let j = Math.max(0, first - NEGATION_WINDOW); j < first; j++) if (isNegation(ws[j].norm)) return true;
  return false;
}

/**
 * Classifies one sentence. Returns { hits: [rule], negated: [rule] }. K1 is `claimsOfficialPmi` unchanged (its own
 * negation rule); K2-K4 use the negation window.
 */
export function classify(sentence, pmi) {
  const hits = [];
  const neg = [];
  const k1 = k1Of(sentence, pmi);
  if (k1 === true) hits.push("K1");
  else if (k1 === "negated") neg.push("K1");
  const ws = words(sentence);
  for (const h of k2to4(ws, sentence)) {
    if (negated(ws, h.first)) neg.push(h.rule);
    else if (!hits.includes(h.rule)) hits.push(h.rule);
  }
  return { hits, negated: [...new Set(neg)] };
}

/**
 * K1 of the scan: `claimsOfficialPmi` unchanged, applied after one extra removal. A PMI phrase that is the object of a
 * negated "claim" verb ("must not claim official PMI status", "Nothing here claims official PMI ...") describes the
 * rule and is a disclaimer, so that phrase is removed first, exactly as the DG5 rule removes its own negated mentions.
 * Returns true (claim), "negated" (a claim only before the removal) or false. T-G5 proves that the verdict equals
 * `claimsOfficialPmi` on every sample of CLAIM_CORPUS.
 */
let claimVerbRe;
function k1Of(text, pmi) {
  if (text === null || text === undefined || !pmi.claimsOfficialPmi(text)) return false;
  claimVerbRe ??= new RegExp(
    String.raw`(?:\b(?:not|never)|\bnothing(?:\s+\S+){0,3}?)\s+(?:to\s+)?claims?\s+(?:to\s+be\s+)?(?:an?\s+)?` +
      pmi.PMI_CLAIM_PATTERN,
    "gi",
  );
  return pmi.claimsOfficialPmi(text.replace(claimVerbRe, " ")) ? true : "negated";
}

/** K1 verdict of the scan for a whole string value (T-G5 parity: one JSON string value is one unit). */
export async function k1Verdict(text) {
  return k1Of(text ?? null, await loadPmiRule()) === true;
}

/** Splits a Markdown/plain line into table cells (unescaped `|`), or returns the line. */
const cells = (line) => (line.includes("|") ? line.split(/(?<!\\)\|/) : [line]);

/** Minimal CSV parser: [{ cells: [string], line }] (quoted cells may span lines). */
function parseCsv(src) {
  const out = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const rec = { cells: [], line };
    let cell = "";
    for (;;) {
      if (src[i] === '"') {
        i++;
        while (i < src.length) {
          if (src[i] === '"' && src[i + 1] === '"') (cell += '"'), (i += 2);
          else if (src[i] === '"') {
            i++;
            break;
          } else {
            if (src[i] === "\n") line++;
            cell += src[i++];
          }
        }
      }
      while (i < src.length && src[i] !== "," && src[i] !== "\n") cell += src[i++];
      rec.cells.push(cell.replace(/\r$/, ""));
      cell = "";
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === "\n") (line++, i++);
      break;
    }
    out.push(rec);
  }
  return out;
}

/** Text units of a file: [{ text, line }] where each unit is split into sentences later (ADR-0063 §3.2). */
export function unitsOf(path, src) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(src).flatMap((r) => r.cells.map((c) => ({ text: c, line: r.line })));
  if (groupOf(path) === "U") {
    if (lower.endsWith(".json")) {
      const out = [];
      const lines = src.split("\n");
      const walk = (v) => {
        if (typeof v === "string") {
          const needle = JSON.stringify(v).slice(1, -1);
          const ln = lines.findIndex((l) => l.includes(needle));
          out.push({ text: v, line: ln + 1, whole: true });
        } else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(JSON.parse(src));
      return out;
    }
    if (lower.endsWith(".sql")) return stringLiteralsSql(src).map((s) => ({ text: s.value, line: s.line, whole: true }));
    if (/\.[cm]?tsx?$/.test(lower)) return stringLiteralsTs(src).map((s) => ({ text: s.value, line: s.line, whole: true }));
    if (lower.endsWith(".html"))
      return src.split("\n").map((l, k) => ({ text: l.replace(/<[^>]*>/g, " "), line: k + 1 }));
  }
  if (lower.endsWith(".md")) return markdownUnits(src);
  return src.split("\n").flatMap((l, k) => cells(l).map((c) => ({ text: c, line: k + 1 })));
}

/**
 * Markdown units: a paragraph's soft-wrapped lines are joined into one unit (a wrapped sentence is one sentence, so a
 * negation or a claim is not cut at the wrap); a heading, a list item, a quote line and a fenced code line start a new
 * unit; a table row yields one unit per cell. Each unit maps offsets back to source lines (`lines`).
 */
function markdownUnits(src) {
  const out = [];
  let cur = null;
  let fence = false;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  src.split("\n").forEach((raw, k) => {
    const l = raw.replace(/\r$/, "");
    const line = k + 1;
    if (/^\s*(```|~~~)/.test(l)) {
      flush();
      fence = !fence;
      return;
    }
    if (fence) return out.push({ text: l, line });
    if (l.trim() === "") return flush();
    if (/^\s*\|/.test(l)) {
      flush();
      for (const c of cells(l)) out.push({ text: c, line });
      return;
    }
    const starts = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(l);
    if (starts || !cur) {
      flush();
      cur = { text: l, line, lines: [{ offset: 0, line }] };
      return;
    }
    cur.lines.push({ offset: cur.text.length + 1, line });
    cur.text += `\n${l}`;
  });
  flush();
  return out;
}

const lineOf = (u, offset) => {
  if (!u.lines) return u.line;
  let ln = u.line;
  for (const m of u.lines) if (m.offset <= offset) ln = m.line;
  return ln;
};

/** Scans one text; returns { hits: [{ rule, line, sentence, sha }], negated: [...] }. */
export function scanText(path, src, pmi) {
  const hits = [];
  const neg = [];
  for (const u of unitsOf(path, src)) {
    // A string value is one unit; Markdown and plain lines split into sentences at newlines and table cells.
    const parts = u.lines
      ? sentences(u.text.replace(/\n/g, " "))
      : u.whole
        ? u.text.split("\n").flatMap((l) => sentences(l))
        : sentences(u.text);
    // K1 is evaluated on the whole value too, so the PMI rule sees exactly the text the product rule would.
    const k1Whole = u.whole && k1Of(u.text, pmi) === true;
    let k1Seen = false;
    for (const s of parts) {
      const c = classify(s.text, pmi);
      if (c.hits.includes("K1")) k1Seen = true;
      const ln = lineOf(u, s.offset);
      for (const rule of c.hits) hits.push({ rule, line: ln, sentence: s.text, sha: sha256(s.text) });
      for (const rule of c.negated) neg.push({ rule, line: ln, sentence: s.text });
    }
    if (k1Whole && !k1Seen) hits.push({ rule: "K1", line: u.line, sentence: u.text, sha: sha256(u.text) });
  }
  return { hits, negated: neg };
}

/** Loads and checks the allow-list (ADR-0063 §3.3). Throws ClaimsBlocked on a refused or malformed entry. */
export function loadAllowlist(file) {
  if (!file) return [];
  if (!existsSync(file)) throw new ClaimsBlocked(`claims-scan: BLOCKED: allow-list not found: ${file}`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ClaimsBlocked(`claims-scan: BLOCKED: cannot read allow-list ${file} (${e.message})`);
  }
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new ClaimsBlocked(`claims-scan: BLOCKED: allow-list ${file} has no entries array`);
  entries.forEach((e, n) => {
    for (const k of ["rule", "path", "lineSha256", "reason"])
      if (typeof e?.[k] !== "string" || e[k].trim() === "")
        throw new ClaimsBlocked(`claims-scan: BLOCKED: allow-list entry ${n} lacks "${k}"`);
    if (!/^[0-9a-f]{64}$/.test(e.lineSha256))
      throw new ClaimsBlocked(`claims-scan: BLOCKED: allow-list entry ${n} lineSha256 is not 64 hex`);
    if (/[*?[]/.test(e.path)) throw new ClaimsBlocked(`claims-scan: BLOCKED: allow-list entry ${n} path must be literal`);
    if (e.path.startsWith("docs/handover/") || groupOf(e.path) === "U" || U_RES.some((r) => r.test(e.path)))
      throw new ClaimsBlocked(`claims-scan: an allow-list entry cannot cover ${e.path}`);
  });
  return entries;
}

function listRepoFiles(repo) {
  const out = execFileSync("git", ["-C", repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    maxBuffer: 1 << 30,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return [...new Set(out)].filter((p) => groupOf(p) !== null && existsSync(join(repo, p))).sort();
}

/** A path for output: relative to the repository, else to the working directory, else absolute. */
function shownPath(repo, abs) {
  for (const base of [repo, process.cwd()]) {
    const rel = relative(base, abs);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return abs;
}

function walk(dir) {
  const st = lstatSync(dir);
  if (st.isFile()) return [dir];
  if (!st.isDirectory()) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((n) => walk(join(dir, n)));
}

/**
 * The module API (DO-J, slice I): scanClaims({ repo, roots, allowlist }) →
 * { ok, hits, negated, allowed, files, counts: { D, U }, stale }.
 * `roots` scans every file under the given directories as group D instead of the repository groups.
 */
export async function scanClaims({ repo = REPO, roots, allowlist = DEFAULT_ALLOWLIST } = {}) {
  const pmi = await loadPmiRule();
  const entries = loadAllowlist(allowlist);
  const used = new Set();
  const scannedEntries = new Set();
  const targets = []; // { path, group, read }
  if (roots && roots.length) {
    for (const r of roots) {
      const abs = resolve(r);
      if (!existsSync(abs)) throw new ClaimsBlocked(`claims-scan: BLOCKED: root not found: ${r}`);
      for (const f of walk(abs)) {
        targets.push({ path: shownPath(repo, f), group: "D", read: () => readFileSync(f) });
      }
    }
  } else {
    for (const p of listRepoFiles(repo)) targets.push({ path: p, group: groupOf(p), read: () => readFileSync(join(repo, p)) });
    try {
      const mod = await import(pathToFileURL(join(repo, "tools", "release", "build-archive.mjs")).href);
      if (typeof mod.ARCHIVE_README_TEXT === "string")
        targets.push({ path: ARCHIVE_README, group: "D", read: () => Buffer.from(mod.ARCHIVE_README_TEXT) });
    } catch {
      /* a fixture repository without the archive tool */
    }
  }
  const hits = [];
  const negatedOut = [];
  const counts = { D: 0, U: 0 };
  let allowed = 0;
  for (const t of targets) {
    const buf = t.read();
    if (buf.subarray(0, 8192).includes(0)) continue; // binary: no prose
    counts[t.group]++;
    let res;
    try {
      res = scanText(t.path, buf.toString("utf8"), pmi);
    } catch (e) {
      throw new ClaimsBlocked(`claims-scan: BLOCKED: cannot parse ${t.path} (${e.message})`);
    }
    for (const n of res.negated) negatedOut.push({ path: t.path, ...n });
    entries.forEach((e, n) => {
      if (pathMatches(e, t.path)) scannedEntries.add(n);
    });
    for (const h of res.hits) {
      const k = entries.findIndex((e) => e.rule === h.rule && pathMatches(e, t.path) && e.lineSha256 === h.sha);
      if (k >= 0) {
        used.add(k);
        allowed++;
      } else hits.push({ path: t.path, ...h });
    }
  }
  // A stale entry fails (ADR-0063 §3.3). Over the repository every entry is in scope; with --root (an unpacked
  // archive's docs/, DO-J) only an entry whose file was scanned can be stale.
  const stale = entries
    .map((e, n) => ({ n, path: e.path }))
    .filter(({ n }) => !used.has(n) && (!(roots && roots.length) || scannedEntries.has(n)));
  const files = counts.D + counts.U;
  return { ok: hits.length === 0 && stale.length === 0, hits, negated: negatedOut, allowed, files, counts, stale };
}

/**
 * An entry's repository path matches a scanned path exactly, or as its suffix under a --root (an archive keeps the
 * repository-relative paths below its role directory, ADR-0062 §2).
 */
const pathMatches = (e, p) => p === e.path || p.endsWith(`/${e.path}`);

const clip = (s) => (s.length > MAX_SENTENCE ? `${s.slice(0, MAX_SENTENCE - 1)}…` : s);

/** Formats a result as the exact messages of p7-work-split §G.3. */
export function report(r, { showNegated = false } = {}) {
  const lines = r.hits.map((h) => `${h.rule} ${h.path}:${h.line}: ${clip(h.sentence)}`);
  for (const s of r.stale) lines.push(`claims-scan: stale allow-list entry ${s.n} (${s.path})`);
  if (showNegated) for (const h of r.negated) lines.push(`negated ${h.rule} ${h.path}:${h.line}: ${clip(h.sentence)}`);
  lines.push(
    r.ok
      ? `claims-scan: PASS (${r.files} files; D ${r.counts.D}, U ${r.counts.U}; negated ${r.negated.length}; allowed ${r.allowed})`
      : `claims-scan: FAIL (${r.hits.length + r.stale.length} hits)`,
  );
  return lines.join("\n");
}

async function main(argv) {
  const roots = [];
  let allowlist = DEFAULT_ALLOWLIST;
  let showNegated = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) roots.push(argv[++i]);
    else if (a === "--allowlist" && argv[i + 1]) allowlist = resolve(argv[++i]);
    else if (a === "--show-negated") showNegated = true;
    else {
      console.log(`claims-scan: BLOCKED: usage: claims-scan.mjs [--root <dir>]... [--allowlist <file>] [--show-negated] (got ${a})`);
      return 2;
    }
  }
  try {
    const r = await scanClaims({ roots, allowlist });
    console.log(report(r, { showNegated }));
    return r.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof ClaimsBlocked) {
      console.log(e.message);
      return 2;
    }
    console.log(`claims-scan: BLOCKED: ${e?.stack ?? e}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
