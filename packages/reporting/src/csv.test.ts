// REQ-S13-005, REQ-S13-006, REQ-S13-008 (ADR-0046 §3, §4, §9): the CSV writer.
import { describe, expect, it } from "vitest";
import { csvCell, csvField, renderCsv } from "./csv.ts";
import { textCell, valueCell } from "./model.ts";
import { createLabels } from "./labels.ts";
import { money, options, sampleDocument } from "./test-fixtures.ts";

/** RFC 4180 parse (test helper): fields of every CRLF-terminated record. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  return out;
}

const decode = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);

describe("renderCsv", () => {
  const doc = sampleDocument(
    [
      { code: "RAID-014", description: '=HYPERLINK("http://x","y")', amount: "1200.50" },
      { code: "RAID-015", description: "Plain, with a comma", amount: "-200.25", provisional: true },
      { code: "RAID-016", description: null, amount: null },
    ],
    null,
  );

  it("is UTF-8 with a byte-order mark and CRLF line ends only (REQ-S13-005)", async () => {
    const r = await renderCsv(doc, options("csv"));
    expect([...r.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = decode(r.bytes);
    expect(body.startsWith("﻿")).toBe(true);
    expect(body.endsWith("\r\n")).toBe(true);
    expect(body.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(r.contentType).toBe("text/csv; charset=utf-8");
  });

  it("writes =HYPERLINK(...) as '=HYPERLINK(...), quoted per RFC 4180 (REQ-S13-006)", async () => {
    const body = decode((await renderCsv(doc, options("csv"))).bytes);
    expect(body).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    const rows = parseCsv(body.slice(1));
    const r14 = rows.find((r) => r[0] === "RAID-014")!;
    expect(r14[2]).toBe(`'=HYPERLINK("http://x","y")`);
  });

  it("decimals are canonical and unprefixed; Unknown is an empty field with status Unknown, never 0 (ADR-0046 §9)", async () => {
    const rows = parseCsv(decode((await renderCsv(doc, options("csv"))).bytes).slice(1));
    const header = rows.find((r) => r[0] === "Code")!;
    expect(header).toEqual(["Code", "Type", "Description", "Amount", "Amount — status"]);
    expect(rows.find((r) => r[0] === "RAID-014")!.slice(3)).toEqual(["1200.50", "Validated"]);
    expect(rows.find((r) => r[0] === "RAID-015")!.slice(3)).toEqual(["-200.25", "Provisional"]);
    const unknown = rows.find((r) => r[0] === "RAID-016")!;
    expect(unknown[2]).toBe("Unknown");
    expect(unknown.slice(3)).toEqual(["", "Unknown"]);
    // The Unknown total is empty with its status (no partial sum).
    expect(rows.find((r) => r[0] === "Total")!.slice(3)).toEqual(["", "Unknown"]);
  });

  it("the header block names the draft state and the legend explains the labels (REQ-S13-008)", async () => {
    const rows = parseCsv(decode((await renderCsv(doc, options("csv"))).bytes).slice(1));
    expect(rows).toContainEqual(["Issue", "Draft — not an issued report"]);
    expect(rows).toContainEqual(["Snapshot ID", "0190a000-0000-7000-8000-0000000000aa"]);
    expect(rows).toContainEqual(["As of", "2026-10-15 13:00 (Asia/Riyadh)"]);
    expect(rows.some((r) => r[0] === "Provisional" && r[1]!.includes("provisional"))).toBe(true);
  });

  it("an issued snapshot prints its issue version; Arabic labels and the Arabic draft text", async () => {
    const issued = {
      ...options("csv"),
      snapshot: { id: options("csv").snapshot.id, status: "issued" as const, issueVersion: 2 },
    };
    expect(decode((await renderCsv(doc, issued)).bytes)).toContain("Issued report, version 2");
    const ar = decode((await renderCsv(doc, options("csv", "ar"))).bytes);
    expect(ar).toContain("مسودة — ليس تقريراً صادراً");
    expect(ar).toContain("مؤقت");
    expect(ar).toContain("غير معروف");
  });

  it("an empty table prints No records; a user-authored frame value is neutralized too", async () => {
    const empty = sampleDocument([], null);
    empty.transformation = { ...empty.transformation, name: "@SUM(1)" };
    const rows = parseCsv(decode((await renderCsv(empty, options("csv"))).bytes).slice(1));
    expect(rows).toContainEqual(["No records"]);
    expect(rows.find((r) => r[0] === "Transformation")![1]).toBe("TR-001 — @SUM(1)");
    const lone = sampleDocument([], null);
    lone.subject = { ...lone.subject, code: null, label: "+cmd" };
    const r2 = parseCsv(decode((await renderCsv(lone, options("csv"))).bytes).slice(1));
    expect(r2.find((r) => r[0] === "Subject")![1]).toBe("'+cmd");
  });

  it("reports progress after each section and refuses an invalid document", async () => {
    const seen: [number, number][] = [];
    await renderCsv(doc, { ...options("csv"), onSection: (d, t) => void seen.push([d, t]) });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
    await expect(renderCsv({ ...doc, schemaVersion: 2 } as never, options("csv"))).rejects.toMatchObject({
      code: "export.render_failed",
    });
  });

  it("csvField quotes commas, quotes, CR and LF only", () => {
    expect(csvField("a")).toBe("a");
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField("a\rb")).toBe('"a\rb"');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
});

// F-DG5-101 (code-security DG5 round 1; reproduction docs/delivery/test-evidence/DG5/code-security/round-1/repro/
// zz-sec-r1-csv-long-decimal.test.ts): a decimal of more than 15 significant digits is a text cell (it does not fit a
// double), but it is still a system number, so CSV writes its canonical string unprefixed (ADR-0046 §4), exactly as for
// a shorter decimal. Injection-looking text keeps its apostrophe.
describe("renderCsv: long decimals are canonical and unprefixed; injection text stays neutralized (F-DG5-101)", () => {
  const doc = sampleDocument(
    [
      { code: "RAID-901", description: "control: 15 significant digits", amount: "-1234567890.12345" },
      { code: "RAID-902", description: "16 significant digits negative", amount: "-12345678901.23456" },
      { code: "RAID-903", description: "16 significant digits, 6 decimal places", amount: "-1234567890.123456" },
      { code: "RAID-904", description: "16 significant digits positive", amount: "12345678901.23456" },
      { code: "RAID-905", description: "short positive", amount: "42.5" },
      { code: "RAID-906", description: "-2+3+cmd|' /C calc'!A0", amount: "-7" },
      { code: "RAID-907", description: "24 significant digits negative", amount: "-123456789012345678.123456" },
    ],
    // The decimal.js total (-123456791481481422.87) does not fit a double either: written as its value (valueCell).
    "-123456791481481422.87",
  );

  it("the reviewer's reproduction: -12345678901.23456 and -1234567890.123456 are written without the apostrophe", async () => {
    const rows = parseCsv(decode((await renderCsv(doc, options("csv"))).bytes).slice(1));
    const amount = (code: string) => rows.find((r) => r[0] === code)![3];
    const got = { r902: amount("RAID-902"), r903: amount("RAID-903") };
    expect(got).toEqual({ r902: "-12345678901.23456", r903: "-1234567890.123456" });
  });

  it("positive/negative x long/short decimals, and a long negative total, are their canonical strings", async () => {
    const rows = parseCsv(decode((await renderCsv(doc, options("csv"))).bytes).slice(1));
    const amount = (code: string) => rows.find((r) => r[0] === code)!.slice(3);
    expect(amount("RAID-901")).toEqual(["-1234567890.12345", "Validated"]);
    expect(amount("RAID-904")).toEqual(["12345678901.23456", "Validated"]);
    expect(amount("RAID-905")).toEqual(["42.5", "Validated"]);
    expect(amount("RAID-906")).toEqual(["-7", "Validated"]);
    expect(amount("RAID-907")).toEqual(["-123456789012345678.123456", "Validated"]);
    expect(rows.find((r) => r[0] === "Total")!.slice(3)).toEqual(["-123456791481481422.87", "Validated"]);
    // No amount field (column 4) of any data or total row carries the apostrophe.
    for (const r of rows.filter((r) => /^(RAID-9|Total$)/.test(r[0] ?? ""))) expect(r[3], r[0]).not.toMatch(/^'/);
  });

  it("a real injection string in user text keeps its apostrophe (and the same text in Arabic)", async () => {
    for (const lang of ["en", "ar"] as const) {
      const rows = parseCsv(decode((await renderCsv(doc, options("csv", lang))).bytes).slice(1));
      expect(rows.find((r) => r[0] === "RAID-906")![2]).toBe("'-2+3+cmd|' /C calc'!A0");
    }
  });

  it("csvCell follows the cell's quotePrefix decision, the one XLSX uses (ADR-0046 §4: decided once)", () => {
    const labels = createLabels("en");
    const long = valueCell(money("-12345678901.23456"), labels);
    expect(long).toMatchObject({ kind: "text", quotePrefix: false });
    expect(csvCell(long)).toBe("-12345678901.23456");
    expect(csvCell(valueCell(money("-1234567890.12345"), labels))).toBe("-1234567890.12345");
    expect(csvCell(valueCell(money("12345678901.23456"), labels))).toBe("12345678901.23456");
    const injection = textCell('=HYPERLINK("http://x","y")');
    expect(injection).toMatchObject({ kind: "text", quotePrefix: true });
    expect(csvCell(injection)).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell(textCell("-12345678901.23456"))).toBe("'-12345678901.23456");
    expect(csvCell(textCell("plain"))).toBe("plain");
  });
});
