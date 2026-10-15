// REQ-S13-005, REQ-S13-006, REQ-S13-008 (ADR-0046 §3, §4, §9): the CSV writer.
import { describe, expect, it } from "vitest";
import { csvField, renderCsv } from "./csv.ts";
import { options, sampleDocument } from "./test-fixtures.ts";

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
