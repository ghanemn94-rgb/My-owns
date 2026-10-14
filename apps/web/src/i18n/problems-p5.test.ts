// Problem translations of P5 slices A–C (T-DG5-FE-A; D-144 item 4; p5-work-split §2 rules 6 and 15). The problem
// `code` is the i18n key (ADR-0007), translated at render time in English and Arabic:
//  - every refusal code of the slice ADRs' tables (ADR-0039 §13, ADR-0040 §8, ADR-0041, ADR-0042), read from the ADR
//    files themselves (both row formats, as problems-slices-hijk.test.ts does), so a new row cannot go untranslated;
//  - the English text is exactly the ADR's English `detail` (rule 15), so the catalogue cannot drift from the contract;
//  - the Arabic text is Arabic, differs from the English, and keeps no server placeholder.
// BE-A named three codes that can occur now (config_version.draft_exists, .not_editable, .unknown_element); they are
// rendered through `problemText` as a screen shows them.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { problemText } from "../lib/problem.ts";
import { catalogues, createI18n } from "./index.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const P5_SLICE_ADRS = ["0039", "0040", "0041", "0042"];

/** `| 4xx | \`code\` | English detail |` (the slice A–C tables) and `| \`code\` | 4xx | … |` (amendment rows). */
const CLASSIC_ROW = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*(.*?)\s*\|\s*$/;
const AMENDMENT_ROW = /^\|\s*`([a-z_][a-z0-9_.]*)`[^|]*\|\s*4\d\d\b/;

function adrText(n: string): string {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
  if (!file) throw new Error(`ADR-${n} not found`);
  return readFileSync(join(dir, file), "utf8");
}

/** code -> English detail of every refusal row of the P5 slice A–C ADRs (amendment rows have no fixed detail column). */
function adrRefusals(): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const n of P5_SLICE_ADRS) {
    for (const line of adrText(n).split("\n")) {
      const classic = CLASSIC_ROW.exec(line);
      if (classic) {
        out.set(classic[1]!, classic[2]!);
        continue;
      }
      const amendment = AMENDMENT_ROW.exec(line);
      if (amendment && !out.has(amendment[1]!)) out.set(amendment[1]!, null);
    }
  }
  return out;
}

const flatKey = (code: string) => code.replace(/\./g, "__");
const problems = (locale: "en" | "ar") => catalogues[locale].problems as unknown as Record<string, string>;

describe("P5 slice A–C problem keys", () => {
  const refusals = adrRefusals();

  it("reads the slice ADR tables (the scan is not empty)", () => {
    expect(refusals.size).toBeGreaterThanOrEqual(73);
    for (const code of ["config_version.draft_exists", "methodology_migration.pin_moved", "procedure.launch_replayed"])
      expect(refusals.has(code), code).toBe(true);
    expect(refusals.has("form_record.conflict")).toBe(true);
  });

  it("translates every refusal code in en (the ADR's English detail, exactly) and in ar", () => {
    const en = problems("en");
    const ar = problems("ar");
    const missing: string[] = [];
    for (const [code, detail] of refusals) {
      const k = flatKey(code);
      if (!en[k] || !ar[k]) {
        missing.push(code);
        continue;
      }
      if (detail !== null) expect(en[k], code).toBe(detail);
      expect(ar[k], code).not.toBe(en[k]);
      expect(ar[k], code).toMatch(/[؀-ۿ]/);
      for (const text of [en[k], ar[k]]) expect(text, code).not.toMatch(/[{}]/);
    }
    expect(missing).toEqual([]);
  });

  it.each(["en", "ar"] as const)("renders the three codes that can occur now (%s)", (locale) => {
    const { t } = createI18n(locale);
    for (const code of [
      "config_version.draft_exists",
      "config_version.not_editable",
      "config_version.unknown_element",
    ]) {
      const text = problemText(t, code);
      expect(text, code).toBe(problems(locale)[flatKey(code)]);
      expect(text).not.toBe("");
    }
    expect(problemText(t, "config_version.draft_exists")).toBe(
      locale === "en"
        ? "A draft of this configuration already exists. Continue it or discard it first."
        : "توجد مسودة من هذه الإعدادات بالفعل. أكملها أو تجاهلها أولًا.",
    );
  });

  it("no P5 problem text names an engineering delivery gate (DG0–DG7)", () => {
    for (const locale of ["en", "ar"] as const)
      for (const [code] of refusals) expect(problems(locale)[flatKey(code)], code).not.toMatch(/\bDG[0-7]\b/);
  });
});
