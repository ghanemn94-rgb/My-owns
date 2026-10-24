// qa-verifier DG5 clean re-gate round 2 (T-DG5-RG-QA-R2): independent regression probe of REQ-S13-006 ("a RAID
// description '=HYPERLINK(...)' exports as text; a system SUM total remains a formula") after the RG1 change to
// packages/reporting/src/csv.ts (F-DG5-101: a long negative system decimal no longer gets the apostrophe). Checks that
// the change did not weaken the user-text rule: every trigger character still neutralizes user text in CSV, a long
// system decimal (too long for a double) is written unprefixed and unchanged, a short one stays a number, a decimal
// value that is not a canonical decimal is refused by the report schema (so the unprefixed path cannot carry user text),
// and the CSV field quoting still applies to a neutralized text containing a comma or quote.
// Copied into the disposable clone's packages/reporting/src/ for the run only (unit-node project).
import { describe, expect, it } from "vitest";
import { reportValue } from "@mth/shared/schemas";
import { csvCell } from "./csv.ts";
import { textCell, valueCell } from "./model.ts";

// valueCell reads labels only for a non-decimal value without a value; none is used here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NO_LABELS = {} as any;
const dec = (value: string) => ({
  type: "decimal" as const,
  value,
  unitKind: "currency" as const,
  currency: "SAR",
  valueBasis: null,
  validation: "validated" as const,
  reason: null,
});

describe("QA RG2 REQ-S13-006 CSV neutralization after the F-DG5-101 change", () => {
  it.each(["=HYPERLINK(\"http://x.invalid\",\"x\")", "+1+1", "-1+cmd|' /C calc'!A0", "@SUM(A1)", "\tTAB", "\rCR"])(
    "user text %j is written with the apostrophe",
    (t) => {
      const field = csvCell(textCell(t));
      const unquoted = field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field;
      expect(unquoted).toBe(`'${t}`);
    },
  );
  it("ordinary user text is unchanged; a neutralized text with a comma and a quote is still CSV-quoted", () => {
    expect(csvCell(textCell("Roaming partner feed"))).toBe("Roaming partner feed");
    expect(csvCell(textCell('=A1,"x"'))).toBe(`"'=A1,""x"""`);
  });
  it("a long negative system decimal (beyond a double) is written unprefixed and unchanged; a short one is a number", () => {
    const long = "-123456789012345678.123456";
    const cell = valueCell(dec(long) as never, NO_LABELS);
    console.info(`QA-RG2-CSV long decimal cell: ${JSON.stringify(cell)} -> ${csvCell(cell)}`);
    expect(cell.kind).toBe("text");
    expect(csvCell(cell)).toBe(long);
    const short = valueCell(dec("-1500000.10") as never, NO_LABELS);
    expect(short.kind).toBe("number");
    expect(csvCell(short)).toBe("-1500000.10");
  });
  it("the report schema refuses a decimal value that is not a canonical decimal (no user text on the unprefixed path)", () => {
    for (const bad of ["=1+1", "-1+cmd", "1e5", " -1", "-1,000"]) {
      const r = reportValue.safeParse(dec(bad));
      console.info(`QA-RG2-CSV schema decimal ${JSON.stringify(bad)}: ${r.success ? "ACCEPTED" : "refused"}`);
      expect(r.success, bad).toBe(false);
    }
    expect(reportValue.safeParse(dec("-123456789012345678.123456")).success).toBe(true);
  });
});
