// Problem translations of slices H, I, C, A, J and K (T-DG4-FE-R1; S-6, S-11). The problem `code` is the i18n key
// (ADR-0007), translated at render time in English and Arabic:
//  - every refusal code of the slice ADRs' tables (ADR-0025 to ADR-0028: slices I, C and A; ADR-0035, ADR-0036: slice H;
//    ADR-0037: slice J; ADR-0038: slice K), read from the ADR files themselves, so a new row cannot go untranslated;
//  - the ARCH-R1/R2 code-table codes of those slices, named by the assignment (approval.resubmit_through_record,
//    gate.exception_revoked, gate.modular_links_missing, the gate.modular_waiver_* codes) and the 422 error items;
//  - a problem message is rendered without parameters, so no text keeps a server placeholder such as {date}.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createI18n } from "./index.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const SLICE_ADRS = ["0025", "0026", "0027", "0028", "0035", "0036", "0037", "0038"];

/** The `| 4xx | \`code\` …` rows of the slice ADRs' refusal tables. */
function adrCodes(): string[] {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const codes = new Set<string>();
  for (const n of SLICE_ADRS) {
    const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`));
    if (!file) throw new Error(`ADR-${n} not found`);
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const m = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`/.exec(line);
      if (m) codes.add(m[1]!);
    }
  }
  return [...codes].sort();
}

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

  it("every refusal code of the slice ADRs is translated", () => {
    expect(adrCodes().filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
  });

  it("every code-table code of these slices is translated, with no server placeholder left", () => {
    for (const c of [...CODE_TABLE, ...adrCodes()]) {
      const text = t(key(c), { defaultValue: "" });
      expect(text, c).not.toBe("");
      expect(text, c).not.toMatch(/[{}]/);
      if (locale === "ar") expect(text, c).toMatch(/[؀-ۿ]/);
    }
  });

  it("the Modular-entry codes say what to do (links, waiver, G3)", () => {
    expect(t(key("gate.modular_links_missing"))).toMatch(locale === "en" ? /waiver/ : /إعفاء/);
    expect(t(key("gate.modular_waiver_revoked"))).toContain("G3");
    expect(t(key("gate.modular_waiver_expired"))).toContain("G3");
    expect(t(key("gate.modular_waiver_revoked"))).not.toBe(t(key("gate.modular_waiver_expired")));
  });
});
