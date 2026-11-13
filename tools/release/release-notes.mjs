#!/usr/bin/env node
// Release notes generator (ADR-0071 §5; REQ-S02-005, REQ-S21-003). Node 24, no dependency, no network, no clock.
//
//   node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json \
//     --provisional apps/web/src/i18n --out docs/handover/release-notes.md [--write | --check] [--repo <dir>]
//
// Reads only named files (D-138): the register, the dependency list (absent → the Unknown line, never "none"), the
// provisional-Arabic label files (`provisional-ar*.ts` in each --provisional directory, plus the five component files of
// p7-plan §1.4), and, for the release identity of §5.2 item 1, `apps/api/package.json` and `docs/api/openapi.yaml`.
// The output is deterministic, so --check compares bytes. Exit 0 PASS, 1 FAIL (a refusal or drift), 2 BLOCKED.
// The register's statuses are engineering delivery states, not business approvals; nothing here grants an approval.
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { parseDependencies, parseRegister, RegisterError, STATUSES } from "../../apps/api/scripts/register-snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
export const MARKER = "completes-after-gate:";
/** The six D-243 Q19 rows that must carry the marker at the freeze (ADR-0071 §5.3; T-I13). */
export const Q19_ROWS = Object.freeze(["REQ-DLV-010", "REQ-DLV-021", "REQ-DLV-039", "REQ-DLV-041", "REQ-S20-023", "REQ-S20-028"]);
/** The provisional-Arabic files outside apps/web/src/i18n (p7-plan §1.4: "five provisional-ar.ts files"). */
export const PROVISIONAL_COMPONENT_FILES = Object.freeze([
  "apps/web/src/components/assistant/provisional-ar.ts",
  "apps/web/src/components/compare/provisional-ar.ts",
  "apps/web/src/components/saved-views/provisional-ar.ts",
  "apps/web/src/pages/integrations/provisional-ar.ts",
  "apps/web/src/pages/my-work/provisional-ar.ts",
]);

/** Headings and fixed texts (p7-work-split §I.3, §H.3; the Arabic is provisional, D-243 Q7). */
export const TEXT = Object.freeze({
  identity: ["Release identity", "هوية الإصدار"],
  counts: ["Requirements by status", "المتطلبات حسب الحالة"],
  unfinished: ["Unfinished items and release blockers", "البنود غير المكتملة وعوائق الإصدار"],
  later: ["Clauses that complete after the engineering gate", "بنود تكتمل بعد البوابة الهندسية"],
  deps: ["Remaining external configuration dependencies", "تبعيات الإعداد الخارجية المتبقية"],
  provisional: ["Provisional Arabic texts", "النصوص العربية المؤقتة"],
  none: ["None: every requirement of this release is implemented.", "لا يوجد: جميع متطلبات هذا الإصدار منفذة."],
  unknown: ["Unknown: this build did not include the list.", "غير معروف: لم يتضمن هذا البناء القائمة."],
  notApproval: ["These are engineering delivery states, not business approvals.", "هذه حالات تسليم هندسية، وليست موافقات أعمال."],
  provisionalMarker: ["Arabic text: provisional. It has not been checked by a qualified Arabic reviewer.", "النص العربي مؤقت. لم يراجعه مراجع عربي مؤهل."],
  status: { PLANNED: "مخطط", SPECIFIED: "محدد", IMPLEMENTED: "منفذ", BLOCKED: "محظور" },
});

const C = { id: 0, title: 2, finalGate: 15, status: 16, evidence: 17, notes: 18 };

const shown = (repo, abs) => {
  const rel = relative(repo, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel.split(sep).join("/");
};

/** Counts the entries of a provisional-Arabic label file: quoted keys of its record or quoted items of its array. */
export function countProvisional(text) {
  let n = 0;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    if (/^"[^"]+"\s*:/.test(line) || /^"[^"]+",?$/.test(line)) n++;
  }
  return n;
}

/** The provisional files: `provisional-ar*.ts` (not tests) directly in each directory, then the component files. */
export function provisionalFiles(repo, dirs) {
  const out = [];
  for (const d of dirs) {
    const abs = resolve(repo, d);
    if (!existsSync(abs)) continue;
    if (lstatSync(abs).isFile()) {
      out.push(abs);
      continue;
    }
    for (const name of readdirSync(abs).sort())
      if (/^provisional-ar.*\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(join(abs, name));
  }
  for (const p of PROVISIONAL_COMPONENT_FILES) {
    const abs = join(repo, p);
    if (existsSync(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** The release identity of §5.2 item 1 (null where a file is missing: shown as Unknown, never guessed). */
function identity(repo) {
  let api = null;
  let contract = null;
  try {
    api = JSON.parse(readFileSync(join(repo, "apps", "api", "package.json"), "utf8")).version ?? null;
  } catch {
    /* Unknown */
  }
  try {
    const y = readFileSync(join(repo, "docs", "api", "openapi.yaml"), "utf8");
    contract = /^info:\s*\n(?:[ \t]+.*\n)*?[ \t]+version:\s*['"]?([^'"\s]+)/m.exec(y)?.[1] ?? null;
  } catch {
    /* Unknown */
  }
  return { api, contract };
}

/** The clause after the marker in a row's notes (up to the end of that line). */
export const laterClauseOf = (notes) => {
  const k = notes.indexOf(MARKER);
  if (k < 0) return null;
  return notes.slice(k + MARKER.length).split("\n")[0].trim();
};

const quote = (text) =>
  String(text)
    .split("\n")
    .map((l) => (l === "" ? ">" : `> ${l}`))
    .join("\n");

/**
 * Builds the release notes. Returns { text, problems, unfinished, later } without writing anything.
 * @param {{ csvBytes: Buffer, csvPath: string, deps: object[] | null, provisional: { path: string, entries: number }[],
 *           identity: { api: string | null, contract: string | null } }} input
 */
export function buildReleaseNotes({ csvBytes, csvPath, deps, provisional, identity: id }) {
  const { rows } = parseRegister(csvBytes);
  const problems = [];
  for (const r of rows) {
    if (r[C.status] !== "IMPLEMENTED" && r[C.notes].trim() === "")
      problems.push(`release-notes: ${r[C.id]} is ${r[C.status]} but names no missing dependency in notes`);
    if (r[C.status] === "IMPLEMENTED" && r[C.evidence].trim() === "") problems.push(`release-notes: ${r[C.id]} is IMPLEMENTED without evidence`);
  }
  const unfinished = rows.filter((r) => r[C.status] !== "IMPLEMENTED");
  const later = rows.filter((r) => r[C.notes].includes(MARKER));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r[C.status] === s).length]));
  const sha = createHash("sha256").update(csvBytes).digest("hex");
  const unknown = (v) => (v === null ? "Unknown" : `\`${v}\``);
  const L = [];
  L.push("# Mobily Transformation Hub — release notes", "");
  L.push(
    "Generated by `tools/release/release-notes.mjs` from the requirement register. Do not edit by hand: `--check` compares these bytes with a fresh generation.",
    "",
  );
  L.push(`## ${TEXT.identity[0]}`, "");
  L.push(`- Application version (\`@mth/api\`): ${unknown(id.api)}`);
  L.push(`- API contract version: ${unknown(id.contract)}`);
  L.push(`- Requirement register: \`${csvPath}\`, SHA-256 \`${sha}\`, ${rows.length} rows`, "");
  L.push(`## ${TEXT.counts[0]}`, "");
  L.push("| Status | Rows |", "| --- | --- |");
  for (const s of STATUSES) L.push(`| ${s} | ${counts[s]} |`);
  L.push(`| Total | ${rows.length} |`, "", TEXT.notApproval[0], "");
  L.push(`## ${TEXT.unfinished[0]}`, "");
  if (unfinished.length === 0) L.push(TEXT.none[0], "");
  else {
    L.push(
      `${unfinished.length} register row(s) are not IMPLEMENTED. At the DG7 freeze every such row is a release blocker (ADR-0071 §6). Each entry gives the row's notes verbatim as its missing dependency.`,
      "",
    );
    for (const r of unfinished) {
      L.push(`### ${r[C.id]}: ${r[C.title].replace(/\s*\n\s*/g, " ")}`, "");
      L.push(`- Status: ${r[C.status]}; final gate: ${r[C.finalGate]}`, "- Missing dependency:", "", quote(r[C.notes]), "");
    }
  }
  L.push(`## ${TEXT.later[0]}`, "");
  if (later.length === 0) L.push(`No register row carries the \`${MARKER}\` marker.`, "");
  else {
    L.push(`Rows whose notes carry \`${MARKER}\` (D-243 Q19). The named clause completes only after the engineering gate DG7, at the release seal.`, "");
    for (const r of later) L.push(`- ${r[C.id]} (${r[C.status]}): ${laterClauseOf(r[C.notes])}`);
    L.push("");
  }
  L.push(`## ${TEXT.deps[0]}`, "");
  if (deps === null) L.push(TEXT.unknown[0], "");
  else if (deps.length === 0) L.push("The list names no external configuration dependency.", "");
  else {
    L.push("| Key | Dependency | Owner | Status |", "| --- | --- | --- | --- |");
    for (const d of deps) L.push(`| \`${d.key}\` | ${d.title.replace(/\|/g, "\\|")} | ${d.owner.replace(/\|/g, "\\|")} | ${d.status} |`);
    L.push("");
  }
  L.push(`## ${TEXT.provisional[0]}`, "");
  L.push(
    "Every Arabic user-interface text listed in these files is provisional until a qualified Arabic reviewer checks it; that review is an external dependency. An entry ending in `.` stands for every key under that prefix.",
    "",
  );
  L.push("| File | Entries |", "| --- | --- |");
  for (const p of provisional) L.push(`| \`${p.path}\` | ${p.entries} |`);
  const totalProvisional = provisional.reduce((a, p) => a + p.entries, 0);
  L.push(`| Total | ${totalProvisional} |`, "");
  // Arabic summary section (ADR-0072 §2, D-243 Q7): provisional, right to left.
  L.push('<div dir="rtl" lang="ar">', "");
  L.push("## ملخص ملاحظات الإصدار", "");
  L.push(TEXT.provisionalMarker[0], "", TEXT.provisionalMarker[1], "");
  L.push(`### ${TEXT.identity[1]}`, "");
  L.push(`- إصدار التطبيق: ${unknown(id.api)}`, `- إصدار عقد الواجهة البرمجية: ${unknown(id.contract)}`, `- سجل المتطلبات: ${rows.length} صفًا، SHA-256 \`${sha.slice(0, 12)}\``, "");
  L.push(`### ${TEXT.counts[1]}`, "");
  for (const s of STATUSES) L.push(`- ${TEXT.status[s]} (\`${s}\`): ${counts[s]}`);
  L.push("", TEXT.notApproval[1], "");
  L.push(`### ${TEXT.unfinished[1]}`, "");
  L.push(unfinished.length === 0 ? TEXT.none[1] : `عدد البنود غير المكتملة: ${unfinished.length}. القائمة الكاملة مع التبعية الناقصة لكل بند في القسم الإنجليزي أعلاه.`, "");
  L.push(`### ${TEXT.later[1]}`, "", `عدد البنود: ${later.length}.`, "");
  L.push(`### ${TEXT.deps[1]}`, "", deps === null ? TEXT.unknown[1] : `عدد التبعيات: ${deps.length}. التفاصيل في القسم الإنجليزي أعلاه.`, "");
  L.push(`### ${TEXT.provisional[1]}`, "", `عدد الإدخالات المؤقتة: ${totalProvisional}.`, "");
  L.push("</div>", "");
  return { text: L.join("\n"), problems, unfinished: unfinished.map((r) => r[C.id]), later: later.map((r) => r[C.id]) };
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv @param {{ print?: (l: string) => void }} [io]
 */
export function main(argv, { print = console.log } = {}) {
  const o = { provisional: [], mode: "write" };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--check") o.mode = "check";
    else if (a === "--write") o.mode = "write";
    else if (["--csv", "--deps", "--out", "--repo", "--provisional"].includes(a)) {
      const v = argv[k + 1];
      if (v === undefined || v.startsWith("--")) {
        print(`release-notes: BLOCKED: ${a} needs a value`);
        return 2;
      }
      if (a === "--provisional") o.provisional.push(v);
      else o[a.slice(2)] = v;
      k++;
    } else {
      print(`release-notes: BLOCKED: unknown argument ${a}`);
      return 2;
    }
  }
  const repo = resolve(o.repo ?? REPO);
  if (!o.csv || !o.out) {
    print("release-notes: BLOCKED: --csv and --out are required");
    return 2;
  }
  const csvAbs = resolve(repo, o.csv);
  if (!existsSync(csvAbs)) {
    print(`release-notes: BLOCKED: ${o.csv} not found`);
    return 2;
  }
  let deps = null;
  if (o.deps && existsSync(resolve(repo, o.deps))) {
    try {
      deps = parseDependencies(readFileSync(resolve(repo, o.deps), "utf8"), o.deps);
    } catch (e) {
      print(`release-notes: ${e instanceof RegisterError ? `${e.line}: ${e.reason}` : e.message}`);
      return 1;
    }
  }
  const provisional = provisionalFiles(repo, o.provisional.length ? o.provisional : ["apps/web/src/i18n"]).map((abs) => ({
    path: shown(repo, abs),
    entries: countProvisional(readFileSync(abs, "utf8")),
  }));
  let built;
  try {
    built = buildReleaseNotes({ csvBytes: readFileSync(csvAbs), csvPath: shown(repo, csvAbs), deps, provisional, identity: identity(repo) });
  } catch (e) {
    if (e instanceof RegisterError) {
      print(`release-notes: ${e.line}: ${e.reason}`);
      return 1;
    }
    throw e;
  }
  if (built.problems.length) {
    for (const p of built.problems) print(p);
    return 1;
  }
  const outAbs = resolve(repo, o.out);
  const outShown = shown(repo, outAbs);
  if (o.mode === "check") {
    const current = existsSync(outAbs) ? readFileSync(outAbs, "utf8") : null;
    if (current !== built.text) {
      print(`release-notes: ${outShown} is out of date (run with --write)`);
      return 1;
    }
    print(`release-notes: ${built.unfinished.length} unfinished item(s), ${built.later.length} later clause(s); ${outShown} is up to date`);
    return 0;
  }
  writeFileSync(outAbs, built.text);
  print(`release-notes: ${built.unfinished.length} unfinished item(s), ${built.later.length} later clause(s); wrote ${outShown}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
