// Problem and shell texts of P7 (T-DG7-FE-A; p7-plan §5.1 row FE-A, §5.3; p7-work-split §C.5, §D.2, §E.5, §I.1, §I.3).
// The problem `code` is the i18n key (ADR-0007; "." written "__"), translated at render time in English and Arabic:
//  - every row of every "Problem codes" / "Problem text" table of docs/architecture/p7-work-split.md is read from the
//    file itself, so a new row cannot go untranslated, and its English and Arabic are in problems.json exactly (the work
//    split writes a value as `{version}`, i18next as `{{version}}`);
//  - the Arabic is PROVISIONAL until a qualified reviewer checks it (D-243 Q7). The label is i18n/provisional-ar-p7.ts,
//    bound here to the catalogue and to the work split: an entry marked "work-split" must be the work split's own
//    Arabic (and English) text;
//  - no P7 shell or problem text names an engineering delivery gate, calls a status an approval, or claims a
//    certification or conformity (p7-work-split §2 rule 8, §I.7).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { problemText } from "../lib/problem.ts";
import { catalogues, createI18n } from "./index.ts";
import { P7_PROVISIONAL_ARABIC } from "./provisional-ar-p7.ts";

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

const WORK_SPLIT = readFileSync(join(repoRoot(), "docs", "architecture", "p7-work-split.md"), "utf8");
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** code -> { status, en, ar } of every row of the work split's problem tables (C.5, D.2, E.5, I.3). */
function workSplitProblems(): Map<string, { status: string | null; en: string; ar: string }> {
  const out = new Map<string, { status: string | null; en: string; ar: string }>();
  const lines = WORK_SPLIT.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\*\*Problem (codes|text)\*\*/.test(lines[i]!)) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    const header = cells(lines[j] ?? "");
    expect(header[0], `table header after line ${i + 1}`).toBe("Code");
    const hasStatus = header[1] === "Status";
    for (j += 2; j < lines.length && lines[j]!.startsWith("|"); j++) {
      const c = cells(lines[j]!);
      const code = /^`([a-z_][a-z0-9_.]*)`$/.exec(c[0] ?? "")?.[1];
      expect(code, `line ${j + 1}`).toBeTruthy();
      const [en, ar] = hasStatus ? [c[2]!, c[3]!] : [c[1]!, c[2]!];
      out.set(code!, { status: hasStatus ? c[1]! : null, en, ar });
    }
  }
  return out;
}

const flatKey = (code: string) => code.replace(/\./g, "__");
/** The work split writes a value as {name}; the catalogues as {{name}}. */
const i18nForm = (s: string) => s.replace(/(?<!\{)\{(\w+)\}(?!\})/g, "{{$1}}");
const problems = (locale: "en" | "ar") => catalogues[locale].problems as unknown as Record<string, string>;
const at = (locale: "en" | "ar", path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      catalogues[locale] as unknown,
    );

const ROWS = workSplitProblems();

describe("P7 problem texts (p7-work-split §C.5, §D.2, §E.5, §I.3)", () => {
  it("reads every problem table of the work split (3 + 13 + 5 + 1 codes)", () => {
    const prefixes = [...ROWS.keys()].map((c) => c.split(".")[0]);
    expect(prefixes.filter((p) => p === "migration")).toHaveLength(3);
    expect(prefixes.filter((p) => p === "config_bundle")).toHaveLength(13);
    expect(prefixes.filter((p) => p === "retention")).toHaveLength(5);
    expect(prefixes.filter((p) => p === "release")).toHaveLength(1);
    expect(ROWS.size).toBe(22);
    expect(ROWS.get("release.register_snapshot_unavailable")?.status).toBeNull();
  });

  it("has the work split's exact English and Arabic text for every code", () => {
    for (const [code, row] of ROWS) {
      const k = flatKey(code);
      expect(problems("en")[k], `en ${code}`).toBe(i18nForm(row.en));
      expect(problems("ar")[k], `ar ${code}`).toBe(i18nForm(row.ar));
      expect(problems("ar")[k], code).toMatch(/[؀-ۿ]/);
      expect(problems("ar")[k]).not.toBe(problems("en")[k]);
    }
  });

  it.each(["en", "ar"] as const)("%s: the generic renderer shows each code's text, never a raw code", (locale) => {
    const { t } = createI18n(locale);
    for (const code of ROWS.keys()) {
      // Without params (the value-free text where the work split's sentence has a value), then with them.
      const text = problemText(t, code);
      expect(text.length, code).toBeGreaterThan(0);
      expect(text, code).not.toContain(code);
      expect(text, code).not.toMatch(/[{}]/);
    }
    expect(problemText(t, "config_bundle.schema_version_unsupported", { version: "mth-config-bundle/2" })).toContain(
      '"mth-config-bundle/2"',
    );
  });

  it("the register-unavailable text says the register is not available, never that it is empty", () => {
    expect(problems("en")["release__register_snapshot_unavailable"]).toContain("not available");
    expect(problems("en")["release__register_snapshot_unavailable"]).not.toMatch(/\bempty\b|\b0\b|no requirements/i);
  });
});

describe("the provisional Arabic of the P7 shell (provisional-ar-p7.ts; D-243 Q7)", () => {
  const nav = (locale: "en" | "ar") => catalogues[locale].nav as unknown as Record<string, unknown>;

  it("lists every P7 problem code and every P7 nav text, each an Arabic text of the catalogue", () => {
    for (const code of ROWS.keys()) expect(P7_PROVISIONAL_ARABIC[`problems.${flatKey(code)}`], code).toBe("work-split");
    // Every text under nav.p7, and every P7 nav.sub / nav.contents.admin label, is listed.
    const p7 = nav("ar")["p7"] as Record<string, unknown>;
    const leaves: string[] = [];
    for (const [k, v] of Object.entries(p7))
      if (typeof v === "string") leaves.push(`nav.p7.${k}`);
      else for (const f of Object.keys(v as object)) leaves.push(`nav.p7.${k}.${f}`);
    for (const path of leaves) expect(P7_PROVISIONAL_ARABIC[path], path).toBeDefined();
    for (const path of Object.keys(P7_PROVISIONAL_ARABIC)) {
      const v = at("ar", path);
      expect(typeof v === "string" && /[؀-ۿ]/.test(v), path).toBe(true);
      expect(at("en", path), path).not.toBe(v);
    }
  });

  it('a text marked "work-split" is the work split\'s own English and Arabic text', () => {
    const plain = (s: string) => s.replace(/\{\{(\w+)\}\}/g, "{$1}");
    for (const [path, source] of Object.entries(P7_PROVISIONAL_ARABIC)) {
      if (source !== "work-split") continue;
      for (const locale of ["en", "ar"] as const) {
        const text = plain(at(locale, path) as string);
        // A whole table cell, or a whole " / "-separated part of one ("Keep / Archive"), never a substring.
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const cell = new RegExp(`(?:\\|\\s|\\s/\\s)${escaped}(?:\\s\\||\\s/\\s)`);
        expect(cell.test(WORK_SPLIT), `${locale} ${path}: ${text}`).toBe(true);
      }
    }
  });

  it("no P7 shell or problem text names a delivery gate, calls a state an approval, or claims conformity", () => {
    const p7Problems = [...ROWS.keys()].map((c) => `problems.${flatKey(c)}`);
    const paths = [...Object.keys(P7_PROVISIONAL_ARABIC), ...p7Problems];
    for (const locale of ["en", "ar"] as const)
      for (const path of paths) {
        const text = at(locale, path) as string;
        expect(text, path).not.toMatch(/\bDG[0-7]\b|\bG[1-6]\b/);
        expect(text, path).not.toMatch(/certif|complian|conform|is approved|approves|\blive\b/i);
      }
  });
});
