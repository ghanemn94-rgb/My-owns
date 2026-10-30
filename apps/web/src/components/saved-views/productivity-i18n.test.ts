// T-DG6-FE-D (p6-work-split §2 rules 6, 12, 17; §H/G "rule 17's slice ADR tables are ADR-0057 §10 … and §9"):
//  - every refusal code of the ADR-0057 §10 table is translated in en (the ADR's English, exactly, read from the ADR
//    file so a change there fails here) and in ar (a different, Arabic text);
//  - the §10 client notice and the §9 stale text are the ADR's English exactly;
//  - the `productivity` namespace has the same keys in en and ar, every Arabic text of it and of the slice H problem
//    block is labelled provisional (provisional-ar.ts), and no text names an engineering delivery gate (DG0-DG7).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { problemText } from "../../lib/problem.ts";
import { PRODUCTIVITY_PROVISIONAL_ARABIC } from "./provisional-ar.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
const ADR = (() => {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith("ADR-0057-"));
  if (!file) throw new Error("ADR-0057 not found");
  return readFileSync(join(dir, file), "utf8");
})();

/** `| \`code\` | 4xx/5xx | "English" … |` rows of §10. */
const ROWS = ADR.split("\n")
  .map((l) => /^\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*([45]\d\d)\s*\|\s*"(.*?)"/.exec(l))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ code: m[1]!, status: Number(m[2]), en: m[3]! }));

const flat = (obj: unknown, prefix = ""): [string, string][] =>
  Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`),
  );

describe("slice H texts (ADR-0057 §9, §10)", () => {
  it("reads the 8 refusal rows of §10", () => {
    expect(ROWS.map((r) => r.code)).toEqual([
      "search.query_too_short",
      "saved_view.unknown_key",
      "saved_view.name_taken",
      "saved_view.not_owner",
      "saved_view.deleted",
      "saved_view.default_conflict",
      "form_record.compare_versions_invalid",
      "search.index_unavailable",
    ]);
  });

  it("translates every §10 code: the ADR's English exactly; Arabic different", () => {
    const en = createI18n("en").t;
    const ar = createI18n("ar").t;
    for (const row of ROWS) {
      const params = row.code === "saved_view.unknown_key" ? { key: "retiredColumn" } : null;
      const english = row.en.replace("{key}", "retiredColumn");
      expect(problemText(en, row.code, params), row.code).toBe(english);
      const arabic = problemText(ar, row.code, params);
      expect(arabic, row.code).not.toBe("");
      expect(arabic, row.code).not.toBe(english);
      expect(/[؀-ۿ]/.test(arabic), row.code).toBe(true);
    }
    // Without its parameter the unknown-key text keeps no placeholder.
    expect(problemText(en, "saved_view.unknown_key", null)).not.toMatch(/[{}]/);
  });

  it("uses the §10 client notice and the §9 stale text verbatim", () => {
    const en = createI18n("en").t;
    expect(ADR).toContain(`"${en("productivity.views.ignoredNotice")}"`);
    const stale = en("productivity.search.stale", { time: "{time}" });
    expect(ADR).toContain(`"${stale}"`);
  });

  it("has the same keys in en and ar; the Arabic is labelled provisional; no DG0-DG7 wording", () => {
    const en = flat(catalogues.en.productivity);
    const ar = flat(catalogues.ar.productivity);
    expect(ar.map(([k]) => k).sort()).toEqual(en.map(([k]) => k).sort());
    for (const [k, v] of ar) {
      expect(v, k).not.toBe("");
      expect(
        PRODUCTIVITY_PROVISIONAL_ARABIC.some((p) => `productivity.${k}`.startsWith(p)),
        k,
      ).toBe(true);
    }
    for (const row of ROWS)
      expect(PRODUCTIVITY_PROVISIONAL_ARABIC).toContain(`problems.${row.code.replace(/\./g, "__")}`);
    for (const [k, v] of [...en, ...ar]) expect(v, k).not.toMatch(/\bDG[0-7]\b/);
  });
});
