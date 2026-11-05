// Catalogue completeness of every problem code (T-DG6-FE-F; ADR-0061 §7.3; REQ-S15-007 "a test finds no missing ar or
// en key"). The problem `code` is the i18n key (ADR-0007), translated at render time in the web; the API's English
// `detail` is never the user-facing message. This test collects every code the API can emit and requires a text for it
// in both languages:
//  - from the API source (`apps/api/src/modules/**`, tests excluded): `problems.businessRule("…"`,
//    `problems.duplicate("…"` and `problems.badRequest("…"` (a field-error code), every `code: "…"` inside a
//    `new HttpProblem({ … })` construction (the problem code and its `errors` item codes), and every `code: "…"` of the
//    database-error mappings in `platform/db-errors.ts`, and (T-DG6-FE-Z3, F-DG6-301) every `code: "…"` inside a
//    `problems.validation( … )` call (the field-error codes of a literal array), which must not fall back to the
//    generic "not valid" text;
//  - (T-DG6-FE-Z3, F-DG6-320) every `errorCode` an operational exception is raised with by the API
//    (`raiseOperationalException(`) and the worker (`raiseOperationalExceptionTwin(`): a literal, an exported code
//    constant, or a pinned derivation (DERIVED_ERROR_CODES); each must render through the exception page's own
//    `exceptionErrorText` as an en and an ar text, so "Last error" never shows the raw code;
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
import { fieldErrorMessage, problemText } from "../lib/problem.ts";
import { exceptionErrorText } from "../pages/admin/operations/OperationsPages.tsx";
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

/**
 * The argument text of the call whose opening parenthesis is at `open`, up to its matching closing parenthesis. String
 * and template literals are skipped, so a bracket inside a message does not end the call early.
 */
function callArgs(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced call at offset ${open}`);
}

/**
 * code -> "file:line" of every `code: "…"` inside a `problems.validation( … )` call of the API source (T-DG6-FE-Z3,
 * F-DG6-301): the field-error codes of a literal `problems.validation([ … ])` array. `fieldErrorMessage`
 * (lib/problem.ts) shows `problems.<key>` for them, so each needs its own text.
 */
export function apiFieldErrorCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  const codeField = new RegExp(String.raw`\bcode:\s*["'](${CODE})["']`, "g");
  for (const file of sourceFiles(join(ROOT, "apps", "api", "src", "modules"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bproblems\.validation\(/g)) {
      const args = callArgs(text, m.index + m[0].length - 1);
      const line = text.slice(0, m.index).split("\n").length;
      for (const c of args.matchAll(codeField))
        if (!codes.has(c[1]!)) codes.set(c[1]!, `${relative(ROOT, file)}:${line}`);
    }
  }
  return codes;
}

/** The API and worker source files (tests excluded), scanned for operational-exception raises and their constants. */
const EXCEPTION_SOURCE_ROOTS = [join("apps", "api", "src"), join("apps", "worker", "src")];

/** Every exported string constant and `as const` string-array constant, per source root ("NAME" -> its codes). */
function codeConstants(): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  const single = new RegExp(String.raw`export const ([A-Z][A-Z0-9_]*)\s*=\s*["'](${CODE})["']`, "g");
  const list = /export const ([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]*)\]\s*as const/g;
  const item = new RegExp(String.raw`["'](${CODE})["']`, "g");
  for (const root of EXCEPTION_SOURCE_ROOTS) {
    const consts = new Map<string, string[]>();
    for (const file of sourceFiles(join(ROOT, root))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(single)) consts.set(m[1]!, [m[2]!]);
      for (const m of text.matchAll(list))
        consts.set(
          m[1]!,
          [...m[2]!.matchAll(item)].map((x) => x[1]!),
        );
    }
    out.set(root, consts);
  }
  return out;
}

/**
 * The `errorCode` expressions of an exception raise that are neither a string literal nor a code constant, mapped to
 * the code constants they range over (each derivation is pinned below by a source check, so a change to it fails):
 *  - kit.ts `failureCodeOf(job.error)`: the service-identity codes, else retries exhausted;
 *  - integrations.ts `p.errorCode`: the `connector.run_failed` event's code, one of the API's CONNECTOR_ERROR_CODES
 *    (ADR-0055 §4; runs.ts writes the event);
 *  - notifications.ts `errorCode!`: the email adapter's send result, one of EMAIL_ERROR_CODES.
 */
const DERIVED_ERROR_CODES: Readonly<Record<string, readonly string[]>> = {
  "apps/worker/src/kit.ts|failureCodeOf(job.error)": [
    "RETRIES_EXHAUSTED_CODE",
    "SERVICE_IDENTITY_MISSING",
    "SERVICE_IDENTITY_OUT_OF_SCOPE",
  ],
  "apps/worker/src/handlers/integrations.ts|p.errorCode": ["CONNECTOR_ERROR_CODES"],
  "apps/worker/src/handlers/notifications.ts|errorCode!": ["EMAIL_ERROR_CODES"],
};

export interface ExceptionCodeScan {
  /** code -> "file:line" of the first raise that can store it as the exception's `last_error_code`. */
  readonly codes: Map<string, string>;
  /** Raises whose `errorCode` could not be resolved to codes (the test requires none). */
  readonly unresolved: string[];
  /** The number of raise calls found. */
  readonly raises: number;
}

/**
 * Every `errorCode` an operational exception is raised with (T-DG6-FE-Z3, F-DG6-320): each call of the API's
 * `raiseOperationalException(` and the worker's `raiseOperationalExceptionTwin(`, its `errorCode:` resolved from a
 * string literal, an exported code constant (`DATA_STALE_ERROR_CODE`), or a derivation of DERIVED_ERROR_CODES.
 */
export function exceptionErrorCodes(): ExceptionCodeScan {
  const constants = codeConstants();
  const resolveConst = (root: string, name: string): string[] | undefined =>
    constants.get(root)?.get(name) ?? EXCEPTION_SOURCE_ROOTS.map((r) => constants.get(r)?.get(name)).find(Boolean);
  const codes = new Map<string, string>();
  const unresolved: string[] = [];
  let raises = 0;
  const literal = new RegExp(String.raw`^["'](${CODE})["']$`);
  for (const root of EXCEPTION_SOURCE_ROOTS)
    for (const file of sourceFiles(join(ROOT, root))) {
      const text = readFileSync(file, "utf8");
      const rel = relative(ROOT, file).split("\\").join("/");
      for (const m of text.matchAll(/\braiseOperationalException(?:Twin)?\(/g)) {
        if (/function\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue; // the definition
        raises++;
        const where = `${rel}:${text.slice(0, m.index).split("\n").length}`;
        const args = callArgs(text, m.index + m[0].length - 1);
        const field = /\berrorCode:\s*([^,\n}]+?)\s*(?:,|\n|\})/.exec(args);
        if (!field) {
          unresolved.push(`${where}: no errorCode field`);
          continue;
        }
        const expr = field[1]!.trim();
        const lit = literal.exec(expr);
        const found = lit
          ? [lit[1]!]
          : /^[A-Z][A-Z0-9_]*$/.test(expr)
            ? resolveConst(root, expr)
            : DERIVED_ERROR_CODES[`${rel}|${expr}`]?.flatMap((name) => resolveConst(root, name) ?? [`<${name}?>`]);
        if (!found || found.length === 0 || found.some((c) => c.startsWith("<"))) {
          unresolved.push(`${where}: errorCode ${expr}`);
          continue;
        }
        for (const c of found) if (!codes.has(c)) codes.set(c, where);
      }
    }
  return { codes, unresolved, raises };
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
  const fields = apiFieldErrorCodes();
  const all = new Map<string, string>([...adr, ...api, ...fields]);
  for (const g of GENERIC) all.delete(g);
  const exceptions = exceptionErrorCodes();

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

  it("collects the field-error codes inside problems.validation([...]) (F-DG6-301)", () => {
    expect(fields.size).toBeGreaterThan(15);
    for (const code of ["validation.commit_on_behalf_of", "validation.credential_refs", "validation.unknown_version"])
      expect(fields.has(code), code).toBe(true);
  });

  it("shows each field-error code's own text, not the generic one, in en and in ar (F-DG6-301)", () => {
    for (const locale of ["en", "ar"] as const) {
      const t = createI18n(locale).t;
      const generic = t("problems.validation__invalid");
      const fallback: string[] = [];
      for (const code of fields.keys())
        if (code !== "validation.invalid" && (!textOf(locale, code) || fieldErrorMessage(t, code) === generic))
          fallback.push(code);
      expect(fallback, locale).toEqual([]);
    }
  });

  it("resolves the errorCode of every operational-exception raise of the API and the worker (F-DG6-320)", () => {
    expect(exceptions.unresolved).toEqual([]);
    expect(exceptions.raises).toBeGreaterThanOrEqual(5);
    // Each source kind: a literal (API heartbeat), a constant (worker stale data), and the derivations.
    expect(exceptions.codes.get("operations.heartbeat_missed")).toMatch(
      /^apps\/api\/src\/modules\/operations\/heartbeat\.ts:/,
    );
    expect(exceptions.codes.get("kpi.stale")).toMatch(/^apps\/worker\/src\/handlers\/operations\.ts:/);
    for (const code of [
      "automation.retries_exhausted",
      "service_identity.missing",
      "service_identity.out_of_scope",
      "connector.source_unavailable",
      "connector.stopped",
      "smtp.connection_failed",
      "smtp.unknown",
    ])
      expect(exceptions.codes.has(code), code).toBe(true);
  });

  it("pins the derivations of DERIVED_ERROR_CODES to their source", () => {
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
    expect(read("apps/worker/src/kit.ts")).toMatch(
      /function failureCodeOf\(err: unknown\): string \{\s*return isServiceIdentityError\(err\) \? err\.code : RETRIES_EXHAUSTED_CODE;/,
    );
    expect(read("apps/worker/src/service-scope.ts")).toMatch(
      /readonly code: typeof SERVICE_IDENTITY_OUT_OF_SCOPE \| typeof SERVICE_IDENTITY_MISSING;/,
    );
    expect(read("apps/api/src/modules/integrations/runs.ts")).toMatch(/CONNECTOR_ERROR_CODES/);
    expect(read("apps/worker/src/handlers/notifications.ts")).toMatch(
      /const errorCode = result\.ok \? null : result\.errorCode;/,
    );
    expect(read("apps/worker/src/channels/email.ts")).toMatch(/EmailErrorCode/);
  });

  it("shows a catalogue text as 'Last error' for every exception code, in en and in ar (F-DG6-320)", () => {
    const en = createI18n("en").t;
    const ar = createI18n("ar").t;
    const missing: string[] = [];
    for (const [code, origin] of [...exceptions.codes].sort(([a], [b]) => a.localeCompare(b))) {
      const enText = exceptionErrorText(en, code);
      const arText = exceptionErrorText(ar, code);
      if (enText === "" || arText === "" || /\{\{|\}\}|\{[a-z]+\}/i.test(enText + arText))
        missing.push(`${code} (${origin}): en ${enText ? "ok" : "missing"}, ar ${arText ? "ok" : "missing"}`);
      else if (!ARABIC.test(arText) || arText === enText) missing.push(`${code}: ar not Arabic`);
    }
    expect(missing).toEqual([]);
  });

  it("would fail on an untranslated code (the guard is not vacuous)", () => {
    expect(textOf("en", "made_up.code_without_text")).toBeNull();
    expect(textOf("ar", "made_up.code_without_text")).toBeNull();
  });
});
