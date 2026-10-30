// Catalogue completeness of every problem code (T-DG6-FE-F; ADR-0061 §7.3; REQ-S15-007 "a test finds no missing ar or
// en key"). The problem `code` is the i18n key (ADR-0007), translated at render time in the web; the API's English
// `detail` is never the user-facing message. This test collects every code the API can emit and requires a text for it
// in both languages:
//  - from the API source (`apps/api/src/modules/**`, tests excluded): `problems.businessRule("…"`,
//    `problems.duplicate("…"` and `problems.badRequest("…"` (a field-error code), every `code: "…"` inside a
//    `new HttpProblem({ … })` construction (the problem code and its `errors` item codes), and every `code: "…"` of the
//    database-error mappings in `platform/db-errors.ts`;
//  - from the refusal tables of every P6 ADR (ADR-0051 to ADR-0059 and ADR-0061), in both row formats: the classic
//    `| 4xx | \`code\` | …` (also `job error`) and the amendment `| \`code\` … | 4xx | …`.
// A code is translated when `problems.<key>` exists, or, for the DG3 page namespaces that translate their own codes
// (`codeText` of pages/prioritization/p3ui.tsx and its peers), `<namespace>.problem.<key>` / `<namespace>.problems.<key>`
// (the key is the code with "." as "__", lib/problem.ts `problemKey`). For each code: an en and an ar text, the Arabic
// text contains Arabic letters and differs from the English, and the text the generic renderer shows (`problemText`)
// keeps no raw placeholder.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { problemText } from "../lib/problem.ts";
import { catalogues, createI18n } from "./index.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const ROOT = repoRoot();
const CODE = String.raw`[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*`;
/** Codes that are not problems of their own: the shared generic codes keep their generic texts (lib/problem.ts). */
const GENERIC = new Set([
  "validation",
  "unauthenticated",
  "forbidden",
  "csrf",
  "not_found",
  "version_conflict",
  "invalid_transition",
  "precondition_required",
  "request_timeout",
  "rate_limited",
  "unavailable",
  "internal",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.includes("testkit")) out.push(p);
  }
  return out.sort();
}

/** code -> the first source file that emits it. */
export function apiProblemCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  const add = (code: string, file: string) => {
    if (!codes.has(code)) codes.set(code, relative(ROOT, file));
  };
  const helper = new RegExp(String.raw`problems\.(?:businessRule|duplicate|badRequest)\(\s*["'](${CODE})["']`, "g");
  const codeField = new RegExp(String.raw`\bcode:\s*["'](${CODE})["']`, "g");
  for (const file of sourceFiles(join(ROOT, "apps", "api", "src", "modules"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(helper)) add(m[1]!, file);
    for (const m of text.matchAll(/new HttpProblem\(\s*\{/g)) {
      const window = text.slice(m.index, m.index + 800);
      const end = window.indexOf("})");
      for (const c of (end > 0 ? window.slice(0, end) : window).matchAll(codeField)) add(c[1]!, file);
    }
    if (file.endsWith(join("platform", "db-errors.ts"))) for (const m of text.matchAll(codeField)) add(m[1]!, file);
  }
  return codes;
}

const P6_ADRS = ["0051", "0052", "0053", "0054", "0055", "0056", "0057", "0058", "0059", "0061"];
const CLASSIC_ROW = new RegExp(String.raw`^\s*\|\s*(?:4\d\d|job error)\s*\|\s*\x60(${CODE})\x60`);
const AMENDMENT_ROW = new RegExp(String.raw`^\s*\|\s*\x60(${CODE})\x60[^|]*\|\s*4\d\d\b`);

function adrText(n: string): string {
  const dir = join(ROOT, "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) throw new Error(`ADR-${n} not found`);
  return readFileSync(join(dir, file), "utf8");
}

/** code -> "ADR-nnnn" of every refusal row of the P6 ADRs. */
export function p6AdrCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const n of P6_ADRS)
    for (const line of adrText(n).split("\n")) {
      const m = CLASSIC_ROW.exec(line) ?? AMENDMENT_ROW.exec(line);
      if (m && !codes.has(m[1]!)) codes.set(m[1]!, `ADR-${n}`);
    }
  return codes;
}

type Catalogue = Record<string, unknown>;
const flatKey = (code: string) => code.replace(/\./g, "__");

/** The text of a code in one locale: `problems.<key>` first, else a page namespace's `problem`/`problems` block. */
function textOf(locale: "en" | "ar", code: string): { path: string; text: string } | null {
  const cat = catalogues[locale] as unknown as Record<string, Catalogue>;
  const key = flatKey(code);
  const shared = cat["problems"]?.[key];
  if (typeof shared === "string") return { path: `problems.${key}`, text: shared };
  for (const [ns, block] of Object.entries(cat)) {
    if (ns === "problems") continue;
    for (const sub of ["problem", "problems"]) {
      const v = (block[sub] as Catalogue | undefined)?.[key];
      if (typeof v === "string") return { path: `${ns}.${sub}.${key}`, text: v };
    }
  }
  return null;
}

const ARABIC = /[؀-ۿ]/;

describe("problem catalogue completeness (ADR-0061 §7.3)", () => {
  const api = apiProblemCodes();
  const adr = p6AdrCodes();
  const all = new Map<string, string>([...adr, ...api]);
  for (const g of GENERIC) all.delete(g);

  it("reads the API source and the P6 ADR tables (neither scan is empty)", () => {
    expect(api.size).toBeGreaterThan(400);
    expect(adr.size).toBeGreaterThan(60);
    // Known codes of each source kind are found: a helper, an HttpProblem body, an errors item, a db-errors mapping,
    // a classic ADR row and an amendment ADR row.
    expect(api.has("prioritization.weights_total")).toBe(true);
    expect(api.has("branding.contrast_insufficient")).toBe(true);
    expect(api.has("branding.contrast_pair_below_threshold")).toBe(true);
    expect(api.has("finance.validator_is_author")).toBe(true);
    expect(adr.get("branding.contrast_insufficient")).toBe("ADR-0061");
    expect(adr.get("assistant.disabled")).toBe("ADR-0059");
    expect([...adr.values()]).toContain("ADR-0055");
  });

  it("has an en and an ar text for every code, the Arabic in Arabic and different from the English", () => {
    const missing: string[] = [];
    const notArabic: string[] = [];
    for (const [code, origin] of [...all].sort(([a], [b]) => a.localeCompare(b))) {
      const en = textOf("en", code);
      const ar = textOf("ar", code);
      if (!en || !ar || en.text.trim() === "" || ar.text.trim() === "") {
        missing.push(`${code} (${origin}): en ${en ? "ok" : "missing"}, ar ${ar ? "ok" : "missing"}`);
        continue;
      }
      if (!ARABIC.test(ar.text) || ar.text === en.text) notArabic.push(`${code}: ${ar.path}`);
    }
    expect(missing).toEqual([]);
    expect(notArabic).toEqual([]);
  });

  it("renders every problems.* text without a raw placeholder, in en and in ar", () => {
    for (const locale of ["en", "ar"] as const) {
      const t = createI18n(locale).t;
      const raw: string[] = [];
      for (const code of all.keys()) {
        if (!textOf(locale, code)?.path.startsWith("problems.")) continue; // page namespaces render with their values
        const shown = problemText(t, code);
        if (shown === "" || /\{\{|\}\}/.test(shown)) raw.push(code);
      }
      expect(raw, locale).toEqual([]);
    }
  });

  it("translates BE-W's contrast codes exactly as ADR-0061 §6 (en, and the provisional ar)", () => {
    const en = createI18n("en").t;
    const ar = createI18n("ar").t;
    expect(problemText(en, "branding.contrast_insufficient")).toBe(
      "These colours do not meet the contrast rules: at least one text or control combination is below 4.5:1 (3:1 for large text and controls). Nothing was published.",
    );
    expect(problemText(ar, "branding.contrast_insufficient")).toBe(
      "لا تستوفي هذه الألوان قواعد التباين: تركيبة واحدة على الأقل من النص أو عناصر التحكم أقل من 4.5:1 (3:1 للنص الكبير وعناصر التحكم). لم يُنشر شيء.",
    );
    expect(problemText(en, "branding.contrast_pair_below_threshold")).toBe(
      "This colour combination is below its contrast threshold.",
    );
    expect(problemText(ar, "branding.contrast_pair_below_threshold")).toBe(
      "تركيبة الألوان هذه أقل من حد التباين المطلوب لها.",
    );
  });

  it("would fail on an untranslated code (the guard is not vacuous)", () => {
    expect(textOf("en", "made_up.code_without_text")).toBeNull();
    expect(textOf("ar", "made_up.code_without_text")).toBeNull();
  });
});
