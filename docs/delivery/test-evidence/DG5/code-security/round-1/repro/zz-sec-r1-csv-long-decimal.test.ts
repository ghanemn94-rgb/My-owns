// code-security-reviewer, DG5 round 1 (T-DG5-RG-SEC-R1). Disposable reproduction, copied into the review clone as
// packages/reporting/src/zz-sec-r1-csv-long-decimal.test.ts and removed afterwards; never part of the candidate.
//
// ADR-0046 §4 (csv.ts header): "a decimal is its canonical string, unprefixed". model.ts valueCell() writes a decimal
// with more than 15 significant digits as a TEXT cell (quotePrefix false, the "system number" comment), and csv.ts
// csvCell() re-neutralizes every text cell, so a NEGATIVE long decimal gets the formula-injection apostrophe in CSV.
// Expected (ADR-0046 §4): the canonical decimal string. The control (15 significant digits) shows the number path.
// Values respect DECIMAL_PATTERN (packages/shared/src/value.ts: up to 18 integer digits and 6 decimal places).
import { describe, expect, it } from "vitest";
import { renderCsv } from "./csv.ts";
import { options, sampleDocument } from "./test-fixtures.ts";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const amountOf = (csv: string, code: string) =>
  csv
    .split("\r\n")
    .find((l) => l.startsWith(`${code},`))!
    .split(",")[3];

describe("SEC-R1: CSV export of long decimals (ADR-0046 §4)", () => {
  const doc = sampleDocument(
    [
      { code: "RAID-901", description: "control: 15 significant digits", amount: "-1234567890.12345" },
      { code: "RAID-902", description: "16 significant digits negative", amount: "-12345678901.23456" },
      { code: "RAID-903", description: "16 significant digits with 6 decimal places (DECIMAL_PATTERN maximum)", amount: "-1234567890.123456" },
      { code: "RAID-904", description: "16 significant digits positive", amount: "12345678901.23456" },
    ],
    null,
  );

  it("control: a negative decimal of <= 15 significant digits is written unprefixed", async () => {
    const csv = decode((await renderCsv(doc, options("csv"))).bytes);
    expect(amountOf(csv, "RAID-901")).toBe("-1234567890.12345");
  });

  it("a positive long decimal is written as its canonical string", async () => {
    const csv = decode((await renderCsv(doc, options("csv"))).bytes);
    expect(amountOf(csv, "RAID-904")).toBe("12345678901.23456");
  });

  it("a negative decimal of > 15 significant digits is written as its canonical string (ADR-0046 §4)", async () => {
    const csv = decode((await renderCsv(doc, options("csv"))).bytes);
    const got = { r902: amountOf(csv, "RAID-902"), r903: amountOf(csv, "RAID-903") };
    console.log("SEC-R1 CSV amounts:", JSON.stringify(got));
    expect(got).toEqual({ r902: "-12345678901.23456", r903: "-1234567890.123456" });
  });
});
