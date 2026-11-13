#!/usr/bin/env node
// The handover guide content checks (ADR-0072 §8; p7-work-split §H, DOC-B; REQ-S19-011, REQ-S19-015; ADR-0069 T-B14).
//
//   node tools/release/check-handover.mjs [--root <dir>] [--protocol-audit <report.json>] [--only <check>[,<check>...]]
//
// Checks (each prints one result line; `--only` selects some):
//   index         T-H1  docs/handover/README.md links every file under docs/handover/ (a link ending in `/` covers a
//                       folder), every link resolves, the seven REQ-S19-015 items each map to an existing file or an
//                       archive path, and the security-controls.md line is present (D-247 O3).
//   deployment    T-H2, T-B14  the seven §3 anchors of deployment.md, each section non-empty and naming a source; the
//                       ADR-0069 B.5 texts; the redirect URI; the Compose service → role map naming every Compose
//                       service; the orchestration target; every key of .env.example; every anchor that
//                       deploy/scripts/drill/guide-keys.json cites (BLOCKED while that file does not exist: DO-D, W10).
//   summaries     T-H7  each IT and operator document has its Arabic summary page (§2.2): RTL wrapper, the §H.3
//                       provisional line in English and Arabic under the first heading, the summary header and the four
//                       sections; backup-restore.md and upgrades.md are summarized in operator-guide.ar-summary.md.
//                       An Arabic section inside an English handover file without the provisional line under its
//                       heading (§2.3) is printed as a warning; it does not change the result.
//   security-links T-H8 security-controls.md HR-01, HR-02, HR-04 and HR-06 link deployment.md#<existing anchor>, and
//                       HR-04 also links backup-restore.md (D-247 O5).
//   guides        T-H5  user and admin guides: equal en/ar file sets, equal `##` counts and anchor sets per pair, RTL
//                       wrapper and provisional line in each ar file (unless arabic-review.json lists it), every screen
//                       path named in a guide exists in apps/web/src/app/router.tsx or nav.ts. No guides yet: BLOCKED.
//   generated     T-H3, T-H4, T-H6 role-matrix.mjs --check, automation-jobs.mjs --check, and known-limitations.mjs
//                       --check with the given report (BLOCKED without --protocol-audit).
// Exit codes (p7-work-split §2 rule 4): 0 PASS (every selected check passed), 1 FAIL (any check failed),
// 2 BLOCKED (no check failed, but one could not run, or a usage error). A BLOCKED check is never reported as a pass.
// Dependency-free: Node built-ins only. Never reads docs/delivery/** except requirements.csv's existence (the register
// item) and environment.md through known-limitations.mjs (D-138). Grants or records no approval (G1-G6 or DG0-DG7).
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix as P, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as KL from "./known-limitations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, "..", "..");
export const HANDOVER = "docs/handover";
export const CHECKS = Object.freeze(["index", "deployment", "summaries", "security-links", "guides", "generated"]);

/** p7-work-split §H.3 and ADR-0069 B.5 (the Arabic is provisional, D-243 Q7). */
export const TEXTS = Object.freeze({
  provisionalEn: "Arabic text: provisional. It has not been checked by a qualified Arabic reviewer.",
  provisionalAr: "النص العربي مؤقت. لم يراجعه مراجع عربي مؤهل.",
  summaryHeaderAr: "تلخص هذه الصفحة الدليل الإنجليزي",
  acceptanceEn:
    "Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence, not that acceptance.",
  acceptanceAr: "قبول هذا التسليم قرار تتخذه تقنية المعلومات في موبايلي خارج المنصة. هذه الحزمة دليل هندسي وليست ذلك القبول.",
  haEn: "Compose is a reproducible install and test configuration, not evidence of high-availability readiness.",
  haAr: "إن Compose إعداد قابل للتكرار للتثبيت والاختبار، وليس دليلاً على الجاهزية للتوافر العالي.",
  subPathEn:
    "The hub is served from the root of its origin. Serving it under a sub-path (for example https://host/hub/) is not supported in this release.",
  subPathAr: "تُقدَّم المنصة من جذر نطاقها. تقديمها تحت مسار فرعي (مثل https://host/hub/) غير مدعوم في هذا الإصدار.",
  originEn:
    "After a move to another address, register the new sign-in redirect address with the identity provider: <origin>/api/v1/auth/callback.",
  originAr:
    "بعد النقل إلى عنوان آخر، سجّل عنوان إعادة التوجيه الجديد لتسجيل الدخول لدى مزوّد الهوية: <origin>/api/v1/auth/callback.",
  readinessEn:
    "Readiness needs the database, the migrations and the evidence storage. The worker status is shown but does not stop the service from being ready.",
  readinessAr:
    "تتطلب الجاهزية قاعدة البيانات والترحيلات وتخزين الأدلة. تُعرض حالة العامل الخلفي لكنها لا تمنع الخدمة من أن تكون جاهزة.",
  orchestrationEn:
    "Deployment configuration for Mobily's orchestration platform is to be written when IT names the target. This release ships no such configuration.",
  orchestrationAr:
    "تُكتب إعدادات النشر لمنصة التشغيل في موبايلي عندما تحدد تقنية المعلومات المنصة المستهدفة. لا يتضمن هذا الإصدار مثل هذه الإعدادات.",
  idpEn:
    "Sign-in has been tested only with a synthetic identity provider. Connecting the corporate identity provider is an external dependency.",
  idpAr: "اختُبر تسجيل الدخول باستخدام مزوّد هوية اصطناعي فقط. ربط مزوّد الهوية المؤسسي تبعية خارجية.",
  notVerifiedEn: "Not verified in this release. Mobily IT must supply and test it.",
});

/** ADR-0072 §3: the seven topics, in order. */
export const DEPLOYMENT_ANCHORS = Object.freeze([
  "domains-and-tls",
  "corporate-sso-mapping",
  "service-accounts",
  "secrets",
  "network-boundaries",
  "logging",
  "monitoring",
]);

/** REQ-S19-015's seven items (the register's spelling). */
export const ITEMS = Object.freeze([
  "Guides",
  "Role matrix",
  "Automation guide",
  "Test evidence",
  "Known limitations",
  "Release notes",
  "Coverage register",
]);

/** Archive paths an item may name instead of a repository file (ADR-0062 §2, ADR-0073). */
export const ARCHIVE_PATHS = Object.freeze(["evidence/"]);

/** Index targets written later in this release: missing → BLOCKED, never FAIL or PASS (ADR-0072 §9, H.1 Order). */
export const PENDING = Object.freeze(["release-notes.md", "guides/user/", "guides/admin/"]);

/** ADR-0072 §2.2: IT and operator documents with their own summary page. */
export const SUMMARY_DOCS = Object.freeze(["deployment", "operator-guide", "automation-operations", "known-limitations"]);
/** Documents summarized inside operator-guide.ar-summary.md (§2.2). */
export const OPERATOR_SUMMARIZED = Object.freeze(["backup-restore.md", "upgrades.md"]);
export const SUMMARY_SECTIONS = Object.freeze(["## الغرض", "## المتطلبات المسبقة", "## ترتيب الخطوات", "## التبعيات الخارجية"]);

export const RTL_OPEN = '<div dir="rtl" lang="ar">';
const ARABIC = /[؀-ۿ]/;
const posixPath = (p) => p.split(sep).join("/");

// ------------------------------------------------------------------------------------------------ result type --

class Result {
  constructor(name) {
    this.name = name;
    this.fails = [];
    this.blocks = [];
    this.warnings = [];
    this.notes = [];
  }
  fail(m) {
    this.fails.push(m);
  }
  block(m) {
    if (!this.blocks.includes(m)) this.blocks.push(m);
  }
  warn(m) {
    this.warnings.push(m);
  }
  note(m) {
    this.notes.push(m);
  }
  get status() {
    return this.fails.length ? "FAIL" : this.blocks.length ? "BLOCKED" : "PASS";
  }
}

// ------------------------------------------------------------------------------------------------- helpers --

const read = (root, p) => readFileSync(join(root, p), "utf8");
const isFile = (abs) => existsSync(abs) && lstatSync(abs).isFile();
const isDir = (abs) => existsSync(abs) && lstatSync(abs).isDirectory();

/** Every regular file under a directory, as paths relative to it (posix), sorted. */
export function filesUnder(abs) {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const a = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.push(r);
    }
  };
  if (isDir(abs)) walk(abs, "");
  return out.sort();
}

/** Markdown link targets `](target)`, without the `#fragment`, skipping external URLs and pure anchors. */
export function linkTargets(md) {
  const out = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const t = m[1];
    if (/^[a-z]+:/i.test(t) || t.startsWith("#")) continue;
    out.push(t);
  }
  return out;
}

/** The explicit anchors of a Markdown file: `{#id}` and HTML `id="…"`. */
export function anchorsOf(md) {
  const set = new Set();
  for (const m of md.matchAll(/\{#([A-Za-z0-9_-]+)\}/g)) set.add(m[1]);
  for (const m of md.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) set.add(m[1]);
  return set;
}

/** The body of the `##` section whose heading carries `{#anchor}` (up to the next `## ` heading), or null. */
export function sectionOf(md, anchor) {
  const lines = md.split("\n");
  const k = lines.findIndex((l) => /^##\s/.test(l) && l.includes(`{#${anchor}}`));
  if (k < 0) return null;
  const body = [];
  for (let j = k + 1; j < lines.length && !/^##\s/.test(lines[j]); j++) body.push(lines[j]);
  return body.join("\n");
}

/** Rows of the first Markdown table after a line that starts with `heading`: arrays of cells. */
export function tableAfter(md, heading) {
  const lines = md.split("\n");
  let k = lines.findIndex((l) => l.startsWith(heading));
  if (k < 0) return null;
  while (k < lines.length && !lines[k].startsWith("|")) k++;
  const rows = [];
  for (k += 2; k < lines.length && lines[k].startsWith("|"); k++)
    rows.push(
      lines[k]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
  return rows;
}

/** A section cites a source: a link, a backticked path or file name, or a backticked variable name. */
export const citesSource = (body) =>
  /\]\([^)]+\)/.test(body) || /`[^`\s]*[/.][^`\s]*`/.test(body) || /`[A-Z][A-Z0-9_]{2,}`/.test(body);

/** The provisional line pair directly under the first heading of `md` (the first two non-empty lines after it). */
export function hasMarkerUnderFirstHeading(md) {
  const lines = md.split("\n");
  const h = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (h < 0) return false;
  const next = lines.slice(h + 1).filter((l) => l.trim() !== "");
  return next[0]?.trim() === TEXTS.provisionalEn && next[1]?.trim() === TEXTS.provisionalAr;
}

const isRtlWrapped = (md) => md.startsWith(`${RTL_OPEN}\n`) && md.trimEnd().endsWith("</div>");

function readReview(root, r) {
  try {
    return KL.readReview(join(root, KL.REVIEW_PATH));
  } catch (e) {
    r.block(`arabic-review.json: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------- index --

export function checkIndex(root) {
  const r = new Result("index");
  const base = join(root, HANDOVER);
  const readmeAbs = join(base, "README.md");
  if (!isFile(readmeAbs)) {
    r.fail("docs/handover/README.md does not exist");
    return r;
  }
  const md = readFileSync(readmeAbs, "utf8");
  const targets = linkTargets(md);
  const covered = new Set();
  const coveredDirs = [];
  for (const t of targets) {
    const rel = P.normalize(t);
    const abs = join(base, rel);
    const pending = PENDING.includes(t);
    if (t.endsWith("/")) {
      if (isDir(abs)) coveredDirs.push(rel.endsWith("/") ? rel : `${rel}/`);
      else if (pending) r.block(`${t} does not exist yet (written later in this release)`);
      else r.fail(`the index links ${t}, which is not a folder`);
    } else if (isFile(abs)) covered.add(rel);
    else if (pending) r.block(`${t} does not exist yet (written later in this release)`);
    else r.fail(`the index links ${t}, which does not exist`);
  }
  for (const f of filesUnder(base))
    if (!covered.has(f) && !coveredDirs.some((d) => f.startsWith(d))) r.fail(`docs/handover/${f} is not in the index`);
  if (!/\]\(security-controls\.md\)/.test(md)) r.fail("the index has no security-controls.md line (D-247 O3)");

  const rows = tableAfter(md, "## The seven handover items");
  if (!rows) r.fail("the index has no '## The seven handover items' table");
  else
    for (const item of ITEMS) {
      const row = rows.find((c) => c[0] === item);
      if (!row) {
        r.fail(`item '${item}' is not mapped`);
        continue;
      }
      const where = row.slice(1).join(" | ");
      const links = linkTargets(where);
      const archive = [...where.matchAll(/`archive:([^`]+)`/g)].map((m) => m[1]);
      const badArchive = archive.filter((a) => !ARCHIVE_PATHS.includes(a));
      for (const a of badArchive) r.fail(`item '${item}' names an unknown archive path '${a}'`);
      const existing = links.filter((t) => existsSync(join(base, P.normalize(t))));
      const pending = links.filter((t) => PENDING.includes(t) && !existsSync(join(base, t)));
      if (existing.length === 0 && archive.length - badArchive.length === 0) {
        if (pending.length) r.block(`item '${item}' maps only to files not written yet (${pending.join(", ")})`);
        else r.fail(`item '${item}' maps to no existing file or archive path`);
      }
    }
  return r;
}

// ----------------------------------------------------------------------------------------------- deployment --

/** Compose service names of deploy/compose/compose.yaml (two-space keys under `services:`). */
export function composeServices(yaml) {
  const out = [];
  let inside = false;
  for (const line of yaml.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^\S/.test(line)) inside = false;
    const m = inside && /^ {2}([a-z0-9_-]+):\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Variable names of .env.example (`NAME=` lines). */
export const envKeys = (text) => [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

export function checkDeployment(root) {
  const r = new Result("deployment");
  const abs = join(root, HANDOVER, "deployment.md");
  if (!isFile(abs)) {
    r.fail("docs/handover/deployment.md does not exist");
    return r;
  }
  const md = readFileSync(abs, "utf8");
  const anchors = anchorsOf(md);
  for (const a of DEPLOYMENT_ANCHORS) {
    const body = sectionOf(md, a);
    if (body === null) r.fail(`no '##' section with the anchor {#${a}}`);
    else if (body.trim() === "") r.fail(`section #${a} is empty`);
    else if (!citesSource(body)) r.fail(`section #${a} names no source file or variable`);
  }
  for (const [k, t] of [
    ["HA statement", TEXTS.haEn],
    ["sub-path", TEXTS.subPathEn],
    ["origin change", TEXTS.originEn],
    ["readiness", TEXTS.readinessEn],
    ["orchestration target", TEXTS.orchestrationEn],
    ["corporate IdP", TEXTS.idpEn],
    ["not verified", TEXTS.notVerifiedEn],
    ["handover acceptance", TEXTS.acceptanceEn],
  ])
    if (!md.replace(/\s*\n\s*/g, " ").includes(t)) r.fail(`the ${k} text (B.5/H.3) is missing`);
  if (!md.includes("/api/v1/auth/callback")) r.fail("the redirect URI <origin>/api/v1/auth/callback is missing");
  if (!anchors.has("orchestration-target")) r.fail("no {#orchestration-target} section (external dependency)");

  const map = sectionOf(md, "compose-service-roles");
  const composeAbs = join(root, "deploy/compose/compose.yaml");
  if (map === null) r.fail("no {#compose-service-roles} section (the Compose service → role map)");
  else if (!isFile(composeAbs)) r.block("deploy/compose/compose.yaml not found");
  else
    for (const s of composeServices(readFileSync(composeAbs, "utf8")))
      if (!map.includes(`\`${s}\``)) r.fail(`the Compose service → role map does not name '${s}'`);

  const keysAbs = join(root, ".env.example");
  const keySection = sectionOf(md, "configuration-keys");
  if (!isFile(keysAbs)) r.block(".env.example not found");
  else if (keySection === null) r.fail("no {#configuration-keys} section");
  else
    for (const k of envKeys(readFileSync(keysAbs, "utf8"))) {
      const row = keySection.split("\n").find((l) => l.startsWith(`| \`${k}\` |`));
      if (!row) r.fail(`.env.example key ${k} is not in the configuration key index`);
      else {
        const a = /\]\(#([A-Za-z0-9_-]+)\)/.exec(row)?.[1];
        if (!a || !anchors.has(a)) r.fail(`the key index row of ${k} links no existing anchor`);
      }
    }

  const gkAbs = join(root, "deploy/scripts/drill/guide-keys.json");
  if (!isFile(gkAbs)) r.block("deploy/scripts/drill/guide-keys.json does not exist yet (DO-D, W10): its anchors are not checked");
  else {
    let gk;
    try {
      gk = JSON.parse(readFileSync(gkAbs, "utf8"));
    } catch {
      r.fail("guide-keys.json is not valid JSON");
    }
    if (gk !== undefined) {
      const cited = [];
      const collect = (v) => {
        if (typeof v === "string") cited.push(v);
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === "object") Object.values(v).forEach(collect);
      };
      collect(gk);
      const wanted = cited
        .filter((s) => /^[A-Za-z0-9_-]+$/.test(s) || /^(?:docs\/handover\/)?deployment\.md#/.test(s) || s.startsWith("#"))
        .map((s) => s.replace(/^.*#/, ""))
        .filter((s) => !/^[A-Z][A-Z0-9_]*$/.test(s));
      for (const a of new Set(wanted)) if (!anchors.has(a)) r.fail(`guide-keys.json cites the anchor '${a}', which deployment.md lacks`);
      r.note(`guide-keys.json: ${new Set(wanted).size} anchors checked`);
    }
  }
  return r;
}

// ------------------------------------------------------------------------------------------------ summaries --

export function checkSummaries(root) {
  const r = new Result("summaries");
  const review = readReview(root, r);
  const reviewed = new Set((review ?? []).map((e) => e.path));
  for (const doc of SUMMARY_DOCS) {
    const en = `${HANDOVER}/${doc}.md`;
    const ar = `${HANDOVER}/${doc}.ar-summary.md`;
    if (!isFile(join(root, en))) {
      r.fail(`${en} does not exist`);
      continue;
    }
    if (!isFile(join(root, ar))) {
      r.fail(`${ar} (its Arabic summary) does not exist`);
      continue;
    }
    const md = read(root, ar);
    if (!isRtlWrapped(md)) r.fail(`${ar} is not wrapped in ${RTL_OPEN} … </div>`);
    if (!reviewed.has(ar) && !hasMarkerUnderFirstHeading(md))
      r.fail(`${ar} lacks the provisional line (EN and AR) directly under its first heading`);
    if (!md.includes(TEXTS.summaryHeaderAr)) r.fail(`${ar} lacks the summary-page header (H.3)`);
    if (!md.includes(TEXTS.acceptanceAr)) r.fail(`${ar} lacks the handover acceptance text (H.3)`);
    for (const s of SUMMARY_SECTIONS) if (!md.split("\n").includes(s)) r.fail(`${ar} lacks the section '${s}'`);
    if (!md.includes(`(${doc}.md)`)) r.fail(`${ar} does not link ${doc}.md`);
    if (!read(root, en).includes(`(${doc}.ar-summary.md)`)) r.fail(`${en} does not link its Arabic summary`);
  }
  const op = `${HANDOVER}/operator-guide.ar-summary.md`;
  if (isFile(join(root, op))) {
    const md = read(root, op);
    for (const d of OPERATOR_SUMMARIZED)
      if (!isFile(join(root, HANDOVER, d))) r.fail(`${HANDOVER}/${d} does not exist`);
      else if (!md.includes(`(${d})`)) r.fail(`${op} does not summarize and link ${d}`);
  }
  const dep = `${HANDOVER}/deployment.ar-summary.md`;
  if (isFile(join(root, dep))) {
    const md = read(root, dep);
    for (const [k, t] of [
      ["HA statement", TEXTS.haAr],
      ["sub-path", TEXTS.subPathAr],
      ["origin change", TEXTS.originAr],
      ["readiness", TEXTS.readinessAr],
      ["orchestration target", TEXTS.orchestrationAr],
      ["corporate IdP", TEXTS.idpAr],
    ])
      if (!md.includes(t)) r.fail(`${dep} lacks the Arabic ${k} text (B.5/H.3, verbatim)`);
  }
  // §2.3: an Arabic section inside an English file (an RTL wrapper or a heading in Arabic or "Arabic summary").
  for (const f of filesUnder(join(root, HANDOVER)).filter((f) => f.endsWith(".md") && !f.endsWith(".ar-summary.md"))) {
    const path = `${HANDOVER}/${f}`;
    if (f.startsWith("guides/") || reviewed.has(path)) continue;
    const lines = read(root, path).split("\n");
    for (let k = 0; k < lines.length; k++) {
      const h = /^(#{2,6})\s+(.*)$/.exec(lines[k]);
      if (!h || !(/Arabic summary/i.test(h[2]) || /^[^A-Za-z]*[؀-ۿ]/.test(h[2]))) continue;
      const next = lines.slice(k + 1).filter((l) => l.trim() !== "");
      if (!(next[0]?.trim() === TEXTS.provisionalEn && next[1]?.trim() === TEXTS.provisionalAr))
        r.warn(`${path} l.${k + 1}: the Arabic section '${h[2]}' lacks the H.3 provisional line under its heading (§2.3)`);
    }
  }
  return r;
}

// ------------------------------------------------------------------------------------------ security links --

export function checkSecurityLinks(root) {
  const r = new Result("security-links");
  const abs = join(root, HANDOVER, "security-controls.md");
  const dep = join(root, HANDOVER, "deployment.md");
  if (!isFile(abs)) {
    r.fail("docs/handover/security-controls.md does not exist");
    return r;
  }
  const anchors = isFile(dep) ? anchorsOf(readFileSync(dep, "utf8")) : new Set();
  const lines = readFileSync(abs, "utf8").split("\n");
  for (const id of ["HR-01", "HR-02", "HR-04", "HR-06"]) {
    const row = lines.find((l) => l.startsWith(`| ${id} |`));
    if (!row) {
      r.fail(`${id}: no row`);
      continue;
    }
    const cells = row.trim().replace(/^\||\|$/g, "").split("|");
    const guide = cells[cells.length - 1];
    const deps = [...guide.matchAll(/\]\(deployment\.md#([A-Za-z0-9_-]+)\)/g)].map((m) => m[1]);
    if (deps.length === 0) r.fail(`${id}: the guide cell has no deployment.md#<anchor> link`);
    for (const a of deps) if (!anchors.has(a)) r.fail(`${id}: deployment.md#${a} does not exist`);
    if (id === "HR-04" && !/\]\(backup-restore\.md(?:#[^)]*)?\)/.test(guide)) r.fail("HR-04: no backup-restore.md link");
  }
  return r;
}

// --------------------------------------------------------------------------------------------------- guides --

/** Route patterns of the web app: `path: "…"` literals of router.tsx and nav.ts, without the leading slash. */
export function routePatterns(root) {
  const out = new Set();
  for (const f of ["apps/web/src/app/router.tsx", "apps/web/src/app/nav.ts"]) {
    if (!isFile(join(root, f))) continue;
    for (const m of read(root, f).matchAll(/\bpath:\s*"([^"]*)"/g)) out.add(m[1].replace(/^\//, ""));
  }
  return [...out];
}

/** Does a concrete or parameterised screen path match one route pattern? (`:x` matches any one segment.) */
export function matchesRoute(path, patterns) {
  const segs = path.replace(/^\//, "").replace(/[?#].*$/, "").replace(/\/$/, "").split("/");
  return patterns.some((p) => {
    const ps = p.replace(/\/$/, "").split("/");
    return ps.length === segs.length && ps.every((s, k) => s.startsWith(":") || s === segs[k] || /^[:<{]/.test(segs[k]));
  });
}

/** Screen paths a guide names: backticked paths that start with `/` and are not API, file or asset paths. */
export const screenPaths = (md) =>
  [...md.matchAll(/`(\/[A-Za-z0-9_:/<>{}.-]*)`/g)]
    .map((m) => m[1])
    .filter((p) => !p.startsWith("/api/") && !/^\/(?:run|var|etc|app|usr|tmp|home|opt)\b/.test(p) && !/\.[a-z]+$/.test(p));

export function checkGuides(root) {
  const r = new Result("guides");
  const base = join(root, HANDOVER, "guides");
  if (!isDir(base)) {
    r.block("no guides yet: docs/handover/guides/ does not exist (DOC-A, W10)");
    return r;
  }
  const review = readReview(root, r);
  const reviewed = new Set((review ?? []).map((e) => e.path));
  const patterns = routePatterns(root);
  if (patterns.length === 0) r.block("no route patterns found in apps/web/src/app/router.tsx");
  for (const kind of ["user", "admin"]) {
    const en = join(base, kind, "en");
    const ar = join(base, kind, "ar");
    if (!isDir(en) || !isDir(ar)) {
      r.block(`no guides yet: guides/${kind}/en or guides/${kind}/ar does not exist`);
      continue;
    }
    const enFiles = filesUnder(en).filter((f) => f.endsWith(".md"));
    const arFiles = filesUnder(ar).filter((f) => f.endsWith(".md"));
    if (enFiles.length === 0) r.block(`no guides yet: guides/${kind}/en has no Markdown file`);
    for (const f of enFiles) if (!arFiles.includes(f)) r.fail(`guides/${kind}/ar/${f} is missing (en has it)`);
    for (const f of arFiles) if (!enFiles.includes(f)) r.fail(`guides/${kind}/en/${f} is missing (ar has it)`);
    for (const f of enFiles.filter((x) => arFiles.includes(x))) {
      const e = readFileSync(join(en, f), "utf8");
      const a = readFileSync(join(ar, f), "utf8");
      const h2 = (md) => md.split("\n").filter((l) => /^##\s/.test(l)).length;
      if (h2(e) !== h2(a)) r.fail(`guides/${kind}/{en,ar}/${f}: ${h2(e)} vs ${h2(a)} '##' headings`);
      const ea = [...anchorsOf(e)].sort().join(",");
      const aa = [...anchorsOf(a)].sort().join(",");
      if (ea !== aa) r.fail(`guides/${kind}/{en,ar}/${f}: the anchor sets differ`);
      const arPath = `${HANDOVER}/guides/${kind}/ar/${f}`;
      if (!isRtlWrapped(a)) r.fail(`${arPath} is not wrapped in ${RTL_OPEN} … </div>`);
      if (!ARABIC.test(a)) r.fail(`${arPath} has no Arabic text`);
      if (!reviewed.has(arPath) && !hasMarkerUnderFirstHeading(a))
        r.fail(`${arPath} lacks the provisional line (EN and AR) directly under its first heading`);
      if (patterns.length)
        for (const p of new Set([...screenPaths(e), ...screenPaths(a)]))
          if (!matchesRoute(p, patterns)) r.fail(`guides/${kind}/*/${f} names the screen path ${p}, which no route has`);
    }
  }
  return r;
}

// ------------------------------------------------------------------------------------------------ generated --

function runTool(root, tool, args) {
  try {
    const out = execFileSync(process.execPath, [join(root, "tools/release", tool), ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, text: out.toString().trim() };
  } catch (e) {
    return { code: e.status ?? -1, text: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() };
  }
}

export function checkGenerated(root, protocolAudit) {
  const r = new Result("generated");
  for (const [tool, args] of [
    ["role-matrix.mjs", ["--root", root, "--check"]],
    ["automation-jobs.mjs", ["--root", root, "--check"]],
  ]) {
    if (!isFile(join(root, "tools/release", tool))) {
      r.block(`tools/release/${tool} not found`);
      continue;
    }
    const res = runTool(root, tool, args);
    const line = res.text.split("\n").pop();
    if (res.code === 0) r.note(`${tool}: ${line}`);
    else if (res.code === 1) r.fail(`${tool} --check exit 1: ${line}`);
    else r.block(`${tool} --check exit ${res.code}: ${line}`);
  }
  if (!protocolAudit) r.block("known-limitations: no --protocol-audit report given, so the generated sections are not checked");
  else {
    const msgs = [];
    const code = KL.main(["--root", root, "--protocol-audit", protocolAudit, "--check"], {
      out: (m) => msgs.push(m),
      err: (m) => msgs.push(m),
    });
    if (code === 0) r.note(msgs[0]);
    else if (code === 1) r.fail(msgs.join(" "));
    else r.block(msgs[0] ?? `known-limitations exit ${code}`);
  }
  return r;
}

// ------------------------------------------------------------------------------------------------------ main --

export function runChecks({ root = DEFAULT_ROOT, protocolAudit, only = CHECKS } = {}) {
  const fns = {
    index: () => checkIndex(root),
    deployment: () => checkDeployment(root),
    summaries: () => checkSummaries(root),
    "security-links": () => checkSecurityLinks(root),
    guides: () => checkGuides(root),
    generated: () => checkGenerated(root, protocolAudit),
  };
  return only.map((c) => fns[c]());
}

export function exitCodeOf(results) {
  if (results.some((x) => x.status === "FAIL")) return 1;
  if (results.some((x) => x.status === "BLOCKED")) return 2;
  return 0;
}

export function main(argv, { out = console.log, err = console.error } = {}) {
  const o = { only: [...CHECKS] };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const v = argv[k + 1];
    const need = () => {
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      k++;
      return v;
    };
    try {
      if (a === "--root") o.root = resolve(need());
      else if (a === "--protocol-audit") o.protocolAudit = resolve(need());
      else if (a === "--only") {
        o.only = need().split(",");
        const bad = o.only.filter((c) => !CHECKS.includes(c));
        if (bad.length) throw new Error(`unknown check ${bad.join(", ")} (known: ${CHECKS.join(", ")})`);
      } else throw new Error(`unknown argument ${a}`);
    } catch (e) {
      err(`check-handover: BLOCKED: ${e.message}`);
      err("usage: node tools/release/check-handover.mjs [--root <dir>] [--protocol-audit <report.json>] [--only <check>[,...]]");
      return 2;
    }
  }
  const root = o.root ?? DEFAULT_ROOT;
  const results = runChecks({ root, protocolAudit: o.protocolAudit, only: o.only });
  for (const x of results) {
    const head = `check-handover: ${x.name}: ${x.status}`;
    const lines = [...x.fails.map((m) => `  FAIL: ${m}`), ...x.blocks.map((m) => `  BLOCKED: ${m}`)];
    lines.push(...x.warnings.map((m) => `  warning: ${m}`), ...x.notes.map((m) => `  note: ${m}`));
    (x.status === "PASS" ? out : err)([head, ...lines].join("\n"));
  }
  const code = exitCodeOf(results);
  const shown = posixPath(relative(process.cwd(), root)) || ".";
  const summary = `check-handover: ${["PASS", "FAIL", "BLOCKED"][code]} (${results.map((x) => `${x.name} ${x.status}`).join(", ")}; root ${shown})`;
  (code === 0 ? out : err)(summary);
  return code;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
