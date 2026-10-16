// Text scan (b) (ADR-0049 §7; T-DG5-BE-R2, p5-work-split §I.4): every English and Arabic problem text of the API.
// English: every string literal of the API source (apps/api/src, test files excluded), a superset of every problem
// `detail`, every db-errors mapping text and every refusal table; Arabic (and the English UI wording): the web's
// problem catalogue apps/web/src/i18n/{en,ar}/problems.json, which translates every problem `code`.
// The scan fails on any claim and on any DG0-DG7 match, except the reported existing findings (scan.ts), each of which
// is listed with its string in the BE-R2 handback for the orchestrator.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  i18nStrings,
  literalsUnder,
  REPORTED_EXISTING_FINDINGS,
  scan,
  stringLiterals,
  unreported,
} from "../../text-scan/scan.ts";

describe("API problem texts (en)", () => {
  const literals = literalsUnder(["apps/api/src"]);

  it("reads the literals of the whole API source, including the slice I refusal texts", () => {
    expect(literals.length).toBeGreaterThan(20_000);
    const texts = new Set(literals.map((l) => l.text));
    expect(texts).toContain("Enter a search term of 2 to 200 characters.");
    expect(texts).toContain("No logo is configured; the provisional text wordmark is shown.");
  });

  it("REQ-PB-001 and REQ-S21-001: no literal claims official PMI status or names DG0-DG7 (but the reported ones)", () => {
    expect(unreported(scan(literals))).toEqual([]);
  });

  it("every reported existing finding is still a real match of the rule (the list cannot hide a passing text)", () => {
    const found = scan(literals);
    for (const r of REPORTED_EXISTING_FINDINGS) {
      expect(
        found.some((v) => v.where.startsWith(`${r.file}:`) && v.text === r.text && v.rule === r.rule),
        `${r.file}: ${r.text}`,
      ).toBe(true);
    }
  });

  it("comments are not product text: a comment naming a gate is not read as a literal, a string is", () => {
    const dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "be-r2-scan-"));
    const file = join(dir, "sample.ts");
    writeFileSync(
      file,
      '// Delivered at DG4.\n/* DG7 */\nexport const a = "Released at DG5";\nexport const b = `x ${a} DG6`;\n',
    );
    expect(stringLiterals(file).map((l) => l.text)).toEqual(["Released at DG5", "x ", " DG6"]);
    expect(scan(stringLiterals(file)).map((v) => v.text)).toEqual(["Released at DG5", " DG6"]);
  });
});

describe.each(["en", "ar"] as const)("the problem catalogue (%s)", (lang) => {
  const problems = i18nStrings(lang, (f) => f === "problems.json");

  it("has the translations, and none claims official PMI status or names DG0-DG7", () => {
    expect(problems.length).toBeGreaterThan(300);
    expect(unreported(scan(problems))).toEqual([]);
  });
});
