// The two product-text scans (ADR-0049 §7; REQ-PB-001, REQ-S21-001; p5-work-split §I.4; T-DG5-BE-R2): the corpus
// collectors and the scanner. The tests are apps/api/test/integration/text-scan/*.test.ts (the integration project,
// which also runs the SQL/TypeScript agreement on a real PostgreSQL).
//
// Scope (ADR-0049 §7 "scoped to product text"): every string of apps/web/src/i18n/{en,ar}/*.json; every English
// string literal of the API source (a superset of every problem `detail`) and every Arabic problem text; the literal
// strings of the report and export templates (packages/reporting, the API's reporting module, the worker's export
// runner, the report label tables) and the rendered text of one sample export per format in en and ar. Engineering
// records under docs/delivery/** and code COMMENTS are not product text, so only string literals are read from code
// (with the TypeScript scanner, so a comment is never mistaken for a string). Test files are not product text either.
//
// Every text is tested as it is and, in addition, as a copy whose Unicode whitespace is made ASCII and whose
// compatibility forms (e.g. Arabic presentation forms in a PDF's glyph text) are NFKC-normalized: the TypeScript
// mirrors follow the C ctype of the pinned clusters (packages/shared/src/text-scan/ascii-classes.ts), and the copy
// keeps the scan strict for a database created with a Unicode ctype.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { claimsOfficialPmi, mentionsEngineeringGate } from "@mth/shared";
import ts from "typescript";

/** The repository root (this file is apps/api/test/text-scan/scan.ts). */
export const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

export interface ProductText {
  /** Where the text comes from: a repository path plus a key, line or part. */
  readonly where: string;
  readonly text: string;
}

export interface Violation extends ProductText {
  readonly rule: "official_pmi_claim" | "engineering_gate";
}

const variants = (text: string): string[] => {
  const ascii = text.replace(/\p{White_Space}/gu, " ").normalize("NFKC");
  return ascii === text ? [text] : [text, ascii];
};

/** Both rules over every text; a violation when either the text or its normalized copy matches. */
export function scan(texts: readonly ProductText[]): Violation[] {
  const out: Violation[] = [];
  for (const t of texts) {
    const v = variants(t.text);
    if (v.some(claimsOfficialPmi)) out.push({ ...t, rule: "official_pmi_claim" });
    if (v.some(mentionsEngineeringGate)) out.push({ ...t, rule: "engineering_gate" });
  }
  return out;
}

const rel = (path: string) => relative(REPO, path).split("\\").join("/");

// ------------------------------------------------------------------------------------------------ (a) UI strings
/** The web catalogue directory of one language. */
export const i18nDir = (lang: "en" | "ar") => join(REPO, "apps/web/src/i18n", lang);

/** Every string value of a JSON document, with its dotted key path. */
export function jsonStrings(where: string, value: unknown, path = ""): ProductText[] {
  if (typeof value === "string") return [{ where: `${where}#${path}`, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => jsonStrings(where, v, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => jsonStrings(where, v, path === "" ? k : `${path}.${k}`));
  }
  return [];
}

/** Every string of apps/web/src/i18n/<lang>/*.json (the file list is read, so a new catalogue file is scanned too). */
export function i18nStrings(lang: "en" | "ar", only?: (file: string) => boolean): ProductText[] {
  const dir = i18nDir(lang);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && (only === undefined || only(f)))
    .sort()
    .flatMap((f) => jsonStrings(rel(join(dir, f)), JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

// ------------------------------------------------------------------------------------------- code string literals
const isTestFile = (path: string) =>
  /\.test\.tsx?$/.test(path) || /\.testkit\.ts$/.test(path) || /(^|\/)test-fixtures\.ts$/.test(path);

/** The non-test TypeScript files under `dir` (relative to the repository), recursively, in name order. */
export function sourceFiles(dir: string, keep: (path: string) => boolean = () => true): string[] {
  const root = join(REPO, dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !isTestFile(rel(p)) && keep(rel(p))) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Every string literal of a TypeScript file: string literals, no-substitution templates and the literal parts of
 * templates (head, middle, tail). Comments are trivia to the scanner and never returned.
 */
export function stringLiterals(file: string): ProductText[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: ProductText[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ where: `${rel(file)}:${line + 1}`, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The string literals of every non-test source file under the directories. */
export function literalsUnder(dirs: readonly string[], keep?: (path: string) => boolean): ProductText[] {
  return dirs.flatMap((d) => sourceFiles(d, keep).flatMap(stringLiterals));
}

// ------------------------------------------------------------------------------------------ rendered export texts
/**
 * Findings on EXISTING product texts that this task may not change (the texts are fixed elsewhere), reported in the
 * BE-R2 handback with each string for the orchestrator's decision. Matched by file and exact text (not by line), so
 * any other violation, or the same text in another file, fails the scan. This list may only shrink.
 */
export const REPORTED_EXISTING_FINDINGS: readonly { file: string; text: string; rule: Violation["rule"] }[] = [
  // ADR-0049 §11 exact refusal texts (branding.prohibited_claim, methodology_reader.prohibited_text): the claim rule's
  // negation must directly precede the claim phrase, and here "claim" stands between "not" and "official PMI".
  {
    file: "apps/api/src/modules/admin/branding.ts",
    text: "Branding text must not claim official PMI status or certification.",
    rule: "official_pmi_claim",
  },
  {
    file: "apps/api/src/modules/platform/db-errors.ts",
    text: "Branding text must not claim official PMI status or certification.",
    rule: "official_pmi_claim",
  },
  {
    file: "apps/api/src/modules/methodology/element-profiles.ts",
    text: "Reader text must not claim official PMI status or certification, or name an engineering delivery gate.",
    rule: "official_pmi_claim",
  },
  {
    file: "apps/api/src/modules/platform/db-errors.ts",
    text: "Reader text must not claim official PMI status or certification, or name an engineering delivery gate.",
    rule: "official_pmi_claim",
  },
  // DG2 (T-DG2-BE, 43942b6): the `note` of every gate-submission snapshot names the engineering delivery gates.
  {
    file: "apps/api/src/modules/workflows/gates.ts",
    text: "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7.",
    rule: "engineering_gate",
  },
];

/** The violations that are not a reported existing finding. */
export function unreported(violations: readonly Violation[]): Violation[] {
  return violations.filter(
    (v) =>
      !REPORTED_EXISTING_FINDINGS.some(
        (r) => v.where.startsWith(`${r.file}:`) && v.text === r.text && v.rule === r.rule,
      ),
  );
}
