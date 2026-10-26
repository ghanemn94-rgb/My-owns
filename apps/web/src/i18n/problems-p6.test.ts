// Problem translations of P6 slices E, F, J and C (T-DG6-FE-A; p6-work-split §E/F.12, §J/C.13, §2 rules 6 and 17). The
// problem `code` is the i18n key (ADR-0007), translated at render time in English and Arabic:
//  - every refusal code of the slice ADRs' tables (ADR-0051 §2, ADR-0052 §1, ADR-0053 §2, ADR-0054 §4), read from the
//    ADR files themselves (indented rows and the "job error" rows included), so a new row cannot go untranslated, plus
//    the two codes the ADRs state in prose (ADR-0051 §3 `deep_link.forbidden`, §4 `evidence.parent_forbidden`) and
//    ADR-0052 §2 `evidence.preview_unavailable`;
//  - the English text is exactly the ADR's English text (rule 17). Three ADR-0052 §1 texts carry a value
//    ({allowedTypes}, {extension}, {maxBytes}) that the contract does not send as problem `params` at this revision, so
//    the problem renders the ADR sentence without that clause (never a raw placeholder), and the `<key>_detail` text is
//    the ADR sentence with the value, for a screen that knows it (the upload policy, the chosen file);
//  - the Arabic text is Arabic and differs from the English. ADR-0053 §2 and ADR-0054 §4 give the Arabic: it is used
//    exactly. The Arabic of ADR-0051, ADR-0052 and of `access.includesRestrictedRecords` / `inbox.restricted` is
//    PROVISIONAL (the ADRs label it so; D-196 item 5) and awaits a Mobily language review.
// Shared codes in the tables (`invalid_transition`, `not_found`, `forbidden`) keep their existing generic texts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { problemText } from "../lib/problem.ts";
import { renderMessage } from "../pages/my-work/messages.ts";
import { catalogues, createI18n } from "./index.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const P6_SLICE_ADRS = ["0051", "0052", "0053", "0054"];
/** `| 4xx | \`code\` | "English" |` or `| job error | \`code\` | "English" | "Arabic" |`, optionally indented. */
const ROW = /^\s*\|\s*(?:4\d\d|job error)\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*(.*?)\s*\|(?:\s*(.*?)\s*\|)?\s*$/;
const SHARED = new Set(["invalid_transition", "not_found", "forbidden"]);

function adrText(n: string): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) throw new Error(`ADR-${n} not found`);
  return readFileSync(join(dir, file), "utf8");
}

const unquote = (s: string | undefined) => {
  const m = /^"(.*)"(?:\s*\(.*\))?$/.exec(s ?? "");
  return m ? m[1]! : null;
};

/** code -> { en, ar } of every refusal row of the slice ADRs (ar null when the ADR gives none). */
function adrRefusals(): Map<string, { en: string | null; ar: string | null }> {
  const out = new Map<string, { en: string | null; ar: string | null }>();
  for (const n of P6_SLICE_ADRS)
    for (const line of adrText(n).split("\n")) {
      const m = ROW.exec(line);
      if (m) out.set(m[1]!, { en: unquote(m[2]), ar: unquote(m[3]) });
    }
  return out;
}

const flatKey = (code: string) => code.replace(/\./g, "__");
const problems = (locale: "en" | "ar") => catalogues[locale].problems as unknown as Record<string, string>;
/** "{x}" -> "{{x}}" (the ADR placeholder in its i18next form). */
const i18nextForm = (s: string) => s.replace(/\{(\w+)\}/g, "{{$1}}");
/** The ADR sentence without its value clause: "… allowed. Allowed types: {x}." -> "… allowed."; "… extension {x}." -> "… extension.". */
const withoutValue = (s: string) => s.replace(/ Allowed types: \{\w+\}\./, "").replace(/ \{\w+\}\./, ".");

describe("P6 slice E, F, J and C problem keys", () => {
  const refusals = adrRefusals();

  it("reads the slice ADR tables (the scan is not empty and finds the indented and job-error rows)", () => {
    for (const code of [
      "sensitive_grant.not_self",
      "evidence.type_not_allowed",
      "evidence.too_large",
      "operations.exception_not_open",
      "service_identity.out_of_scope",
      "storage.test_required",
      "admin.reason_required",
    ])
      expect(refusals.has(code), code).toBe(true);
    // ADR-0051 §2: 7 rows, ADR-0052 §1: 3, ADR-0053 §2: 7, ADR-0054 §4: 9.
    expect(refusals.size).toBeGreaterThanOrEqual(26);
  });

  it("translates every refusal code in en (the ADR's English text) and in ar", () => {
    const en = problems("en");
    const ar = problems("ar");
    const missing: string[] = [];
    for (const [code, text] of refusals) {
      const k = flatKey(code);
      if (!en[k] || !ar[k]) {
        missing.push(code);
        continue;
      }
      expect(ar[k], code).not.toBe(en[k]);
      expect(ar[k], code).toMatch(/[؀-ۿ]/);
      for (const v of [en[k], ar[k]]) expect(v, code).not.toMatch(/[{}]/);
      if (SHARED.has(code) || code === "evidence.too_large") continue;
      expect(text.en, code).not.toBeNull();
      if (/\{\w+\}/.test(text.en!)) {
        expect(en[k], code).toBe(withoutValue(text.en!));
        expect(en[`${k}_detail`], code).toBe(i18nextForm(text.en!));
        expect(ar[`${k}_detail`], code).toMatch(/[؀-ۿ]/);
      } else expect(en[k], code).toBe(text.en);
      if (text.ar !== null) expect(ar[k], code).toBe(text.ar);
    }
    expect(missing).toEqual([]);
  });

  it("the prose codes of ADR-0051 §3, §4 and ADR-0052 §2 are translated with the ADR's English", () => {
    const adr51 = adrText("0051");
    const adr52 = adrText("0052");
    expect(adr51).toContain('"You do not have access to this item."');
    expect(adr51).toContain('"You do not have access to the record this evidence belongs to."');
    expect(adr52).toContain('"No preview is available for this file. Download it instead."');
    expect(problems("en")["deep_link__forbidden"]).toBe("You do not have access to this item.");
    expect(problems("ar")["deep_link__forbidden"]).toBe("ليست لديك صلاحية الوصول إلى هذا العنصر.");
    expect(problems("en")["evidence__parent_forbidden"]).toBe(
      "You do not have access to the record this evidence belongs to.",
    );
    expect(problems("en")["evidence__preview_unavailable"]).toBe(
      "No preview is available for this file. Download it instead.",
    );
  });

  it("evidence.too_large no longer names a fixed 25 MB (a narrowed upload policy makes it untrue; F-DG4-160)", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(problems(locale)["evidence__too_large"]).not.toMatch(/25/);
      expect(problems(locale)["evidence__too_large_detail"]).toContain("{{maxBytes}}");
    }
    expect(problems("en")["evidence__too_large_detail"]).toBe(
      "Evidence content is limited to {{maxBytes}} bytes per revision.",
    );
  });

  it.each(["en", "ar"] as const)("renders every P6 code through problemText without a placeholder (%s)", (locale) => {
    const { t } = createI18n(locale);
    for (const code of [...refusals.keys(), "deep_link.forbidden", "evidence.parent_forbidden"]) {
      const text = problemText(t, code);
      expect(text, code).toBe(problems(locale)[flatKey(code)]);
      expect(text, code).not.toMatch(/[{}]/);
    }
    // A `_detail` text is filled by the screen that knows the value.
    expect(t("problems.evidence__type_not_allowed_detail", { allowedTypes: "pdf, png" })).toContain("pdf, png");
  });

  it.each(["en", "ar"] as const)("the restricted texts of ADR-0051 §2 and §3 (%s)", (locale) => {
    const { t } = createI18n(locale);
    expect(t("access.includesRestrictedRecords")).toBe(
      locale === "en" ? "Includes restricted records" : "يشمل سجلات مقيدة",
    );
    // A redacted inbox item: messageKey `inbox.restricted`, messageParams {} (rendered by the inbox's renderer).
    expect(renderMessage(t, locale, "inbox.restricted", {})).toBe(
      locale === "en" ? "You no longer have access to this item." : "لم تعد لديك صلاحية الوصول إلى هذا العنصر.",
    );
  });

  it("no P6 problem text names an engineering delivery gate (DG0–DG7) or calls an adapter live", () => {
    for (const locale of ["en", "ar"] as const)
      for (const [code] of refusals) {
        expect(problems(locale)[flatKey(code)], code).not.toMatch(/\bDG[0-7]\b/);
        expect(problems(locale)[flatKey(code)], code).not.toMatch(/\blive\b/i);
      }
  });
});
