// Problem translations of slices H, I, C, A, J and K (T-DG4-FE-R1; S-6, S-11). The problem `code` is the i18n key
// (ADR-0007), translated at render time in English and Arabic:
//  - every refusal code of the slice ADRs' tables (ADR-0025 to ADR-0028: slices I, C and A; ADR-0035, ADR-0036: slice H;
//    ADR-0037: slice J; ADR-0038: slice K), read from the ADR files themselves, so a new row cannot go untranslated;
//  - the ARCH-R1/R2 code-table codes of those slices, named by the assignment (approval.resubmit_through_record,
//    gate.exception_revoked, gate.modular_links_missing, the gate.modular_waiver_* codes) and the 422 error items;
//  - a problem message is rendered without parameters, so no text keeps a server placeholder such as {date}; the only
//    texts with a placeholder are the two codes that carry `params` (ADR-0038 Q1: `gate.modular_waiver_revoked` and
//    `gate.modular_waiver_expired`, `{{date}}`), rendered here with their `params` and, without them, as before.
// T-DG4-FE-R3 (ARCH-R3 §6 FE-R3 item 4, §7): the ADR scan reads BOTH table formats, the original `| 4xx | \`code\` |`
// rows and the amendment rows `| \`code\` (at …) | 4xx | …` (every ARCH-R1/R2/R3 amendment table). The original scan
// missed the amendment format, e.g. ADR-0037 row `dashboard.value_class_not_applicable` (requirements row 186); a test
// below proves the new scan finds it and that the old one did not.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { formatBusinessDate } from "../lib/format.ts";
import { problemText } from "../lib/problem.ts";
import { createI18n } from "./index.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const SLICE_ADRS = ["0025", "0026", "0027", "0028", "0035", "0036", "0037", "0038"];

/** The original refusal rows: `| 4xx | \`code\` | …`. */
const CLASSIC_ROW = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`/;
/**
 * The amendment refusal rows: `| \`code\` | 4xx | …` or `| \`code\` (at \`/pointer\`) | 422 | …`, also `| 400 field |`.
 * The second column must be a 4xx status, so the many other tables that begin with a code (entities, columns, keys,
 * message keys, audit actions) are not read as refusals.
 */
const AMENDMENT_ROW = /^\|\s*`([a-z_][a-z0-9_.]*)`[^|]*\|\s*4\d\d\b/;

/** The refusal codes of one ADR text; `formats` selects which row formats are read (both by default). */
function refusalCodes(text: string, formats: readonly ("classic" | "amendment")[] = ["classic", "amendment"]) {
  const codes = new Set<string>();
  for (const line of text.split("\n")) {
    const m =
      (formats.includes("classic") ? CLASSIC_ROW.exec(line) : null) ??
      (formats.includes("amendment") ? AMENDMENT_ROW.exec(line) : null);
    if (m) codes.add(m[1]!);
  }
  return codes;
}

function adrText(n: string): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) throw new Error(`ADR-${n} not found`);
  return readFileSync(join(dir, file), "utf8");
}

/** The refusal rows of the slice ADRs' tables, in both formats. */
function adrCodes(formats?: readonly ("classic" | "amendment")[]): string[] {
  const codes = new Set<string>();
  for (const n of SLICE_ADRS) for (const c of refusalCodes(adrText(n), formats)) codes.add(c);
  return [...codes].sort();
}

/** The untranslated codes among `codes` (the guard's own check). */
const untranslated = (t: TFunction, codes: readonly string[]) => codes.filter((c) => !t(key(c), { defaultValue: "" }));

/** The codes whose problem carries `params` (ADR-0038 Q1), with a sample business date. */
const PARAM_CODES: Record<string, { date: string }> = {
  "gate.modular_waiver_revoked": { date: "2026-10-08" },
  "gate.modular_waiver_expired": { date: "2026-09-30" },
};

/** ARCH-R1 §E item 11 and ARCH-R2 code-table codes of slices H, I, C, A, J and K (problem kinds). */
const CODE_TABLE = [
  "approval.resubmit_through_record",
  "gate.exception_revoked",
  "gate.modular_links_missing",
  "gate.modular_waiver_revoked",
  "gate.modular_waiver_expired",
  "baseline_missing",
  "outcome_link_missing",
  "inherited_record.record_not_found",
  "trace_link.record_not_found",
  "validation.duplicate_scope_item",
  "validation.proposed_change",
  "validation.proposed_change_size",
  "validation.ratio_range",
  "validation.basis_needs_share",
  "validation.root_pair",
  "validation.share_range",
  "validation.decimal_measure_scale",
  "approval.subject_unknown",
  "approval.not_requester",
  "work_item.system_managed",
];

const key = (code: string) => `problems.${code.replace(/\./g, "__")}`;

describe.each(["en", "ar"] as const)("slice H, I, C, A, J, K problem keys (%s)", (locale) => {
  const { t } = createI18n(locale);

  it("the slice ADR tables are read (the scan is not empty)", () => {
    const codes = adrCodes();
    expect(codes.length).toBeGreaterThan(100);
    expect(codes).toContain("gate.modular_links_missing");
    expect(codes).toContain("change_request.subject_moved");
  });

  it("the amendment tables are read too: row 186 (dashboard.value_class_not_applicable) is found, and the old scan missed it", () => {
    const adr37 = adrText("0037");
    expect(refusalCodes(adr37, ["classic"]).has("dashboard.value_class_not_applicable")).toBe(false);
    expect(refusalCodes(adr37, ["amendment"]).has("dashboard.value_class_not_applicable")).toBe(true);
    expect(adrCodes()).toContain("dashboard.value_class_not_applicable");
    // The amendment scan adds codes the classic scan never saw (ARCH-R1/R2/R3 amendment tables).
    const classic = new Set(adrCodes(["classic"]));
    expect(adrCodes(["amendment"]).filter((c) => !classic.has(c)).length).toBeGreaterThan(0);
  });

  it("the guard would have caught row 186: an untranslated amendment code is reported", () => {
    // A catalogue without the row-186 key: the check reports exactly that code (the same check as below).
    const without: TFunction = ((k: string, o?: object) =>
      k === key("dashboard.value_class_not_applicable") ? "" : t(k, (o ?? {}) as Record<string, unknown>)) as TFunction;
    expect(untranslated(without, adrCodes())).toEqual(["dashboard.value_class_not_applicable"]);
    // The old classic-only scan could not report it.
    expect(untranslated(without, adrCodes(["classic"]))).toEqual([]);
  });

  it("the amendment format is matched exactly (status in the second column), other code-first tables are not", () => {
    const sample = [
      "| `x.code_one` (at `/valueClass`) | 422 | **new** (K1) | Text. |",
      "| `x.code_two` | 409 | accepted | Text. |",
      "| `validation.x_field` | 400 field | accepted | Text. |",
      "| 422 | `x.code_three` | Text. |",
      "| `x.entity` | `id`, `name` | Mutable. |",
      "| `x.audit` | audit action | accepted | Label. |",
      "| `x.message` | `forum` = `forum.name_en` | add `forumAr` |",
    ].join("\n");
    expect([...refusalCodes(sample)].sort()).toEqual(["validation.x_field", "x.code_one", "x.code_three", "x.code_two"]);
  });

  it("every refusal code of the slice ADRs is translated (both table formats)", () => {
    expect(untranslated(t, adrCodes())).toEqual([]);
  });

  it("every code-table code of these slices is translated, with no server placeholder left", () => {
    for (const c of [...CODE_TABLE, ...adrCodes()]) {
      const text = t(key(c), { defaultValue: "" });
      expect(text, c).not.toBe("");
      if (locale === "ar") expect(text, c).toMatch(/[؀-ۿ]/);
      // Exactly the two `params` codes keep a placeholder: `{{date}}` in its i18next form with the business-date
      // formatter. Every other text has none.
      if (c in PARAM_CODES) expect(text.match(/\{\{[^}]*\}\}/g), c).toEqual(["{{date, businessDate}}"]);
      else expect(text, c).not.toMatch(/[{}]/);
      // As the screens render it: with the problem's params where it has them, without otherwise: never a brace.
      const rendered = problemText(t, c, PARAM_CODES[c] ?? null);
      expect(rendered, c).not.toBe("");
      expect(rendered, c).not.toMatch(/[{}]/);
    }
    expect(Object.keys(PARAM_CODES).every((c) => adrCodes().includes(c) || CODE_TABLE.includes(c))).toBe(true);
  });

  it("the two `params` codes render their date localized, and without `params` the text shown before (ADR-0038 Q1)", () => {
    for (const [c, params] of Object.entries(PARAM_CODES)) {
      const date = formatBusinessDate(params.date, locale)!;
      const dated = problemText(t, c, params);
      expect(dated, c).toContain(date);
      expect(dated, c).not.toContain(params.date);
      expect(dated, c).toContain("G3");
      const undated = problemText(t, c, null);
      expect(undated, c).toBe(t(`${key(c)}_noParams`));
      expect(undated, c).not.toContain(date);
      expect(problemText(t, c, {}), c).toBe(undated);
      expect(problemText(t, c, { date: "" }), c).toBe(undated);
    }
    // Arabic and English show different localized dates for the same business date (the formatter uses the text's
    // own language, not a fixed one).
    const other = createI18n(locale === "en" ? "ar" : "en");
    expect(problemText(other.t, "gate.modular_waiver_revoked", { date: "2026-10-08" })).toContain(
      formatBusinessDate("2026-10-08", locale === "en" ? "ar" : "en")!,
    );
  });

  it("a problem without placeholders renders the same text with or without params", () => {
    expect(problemText(t, "gate.modular_links_missing", { date: "2026-10-08" })).toBe(
      t(key("gate.modular_links_missing")),
    );
    expect(problemText(t, "gate.modular_links_missing")).toBe(t(key("gate.modular_links_missing")));
  });

  it("the Modular-entry codes say what to do (links, waiver, G3)", () => {
    expect(t(key("gate.modular_links_missing"))).toMatch(locale === "en" ? /waiver/ : /إعفاء/);
    expect(t(key("gate.modular_waiver_revoked"))).toContain("G3");
    expect(t(key("gate.modular_waiver_expired"))).toContain("G3");
    expect(t(key("gate.modular_waiver_revoked"))).not.toBe(t(key("gate.modular_waiver_expired")));
  });
});
