// Unit tests of the upload allow-list (T-DG6-BE-D; ADR-0052 §1; REQ-S13-011 "Uploads are type- and size-checked").
// One case per row of the §1 table, plus an .exe, a renamed .exe, HTML, a ZIP that is not OOXML and a macro-enabled
// OOXML, the streaming inspector (chunk boundaries, the ZIP tail) and the refusal bodies. No database. All bytes are
// SYNTHETIC fixtures built here; the ZIPs are written by a minimal stored-entry ZIP writer below (no dependency).
import { describe, expect, it } from "vitest";
import {
  ContentInspector,
  DEFAULT_UPLOAD_POLICY,
  MAX_ZIP_ENTRIES,
  extensionsOf,
  UPLOAD_MEDIA_TYPES,
  UPLOAD_TYPES,
  classifyZip,
  decideUpload,
  detectContent,
  extensionOf,
  hasSvgRoot,
  inspectedBody,
  matchesRasterMagic,
  typeOfExtension,
  zipEntryNames,
  type Detection,
} from "./content-policy.ts";
import { HttpProblem } from "../platform/index.ts";
import type { UploadType } from "@mth/shared/schemas";

/** A ZIP with stored (uncompressed) entries: local headers, data, central directory, end record. */
function zipOf(entries: readonly (readonly [string, string])[], opts: { comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cd, end, comment]);
}

const CT: readonly [string, string] = ["[Content_Types].xml", "<Types/>"];
const FIXTURES = {
  pdf: Buffer.from("%PDF-1.7\n% synthetic\n%%EOF\n", "latin1"),
  docx: zipOf([CT, ["_rels/.rels", "<r/>"], ["word/document.xml", "<w:document/>"]]),
  xlsx: zipOf([CT, ["xl/workbook.xml", "<workbook/>"], ["xl/worksheets/sheet1.xml", "<ws/>"]]),
  pptx: zipOf([CT, ["ppt/presentation.xml", "<p:presentation/>"]]),
  csv: Buffer.from("﻿id,name,value\n1,Synthetic,12.50\n2,مثال,3\n", "utf8"),
  txt: Buffer.from("Synthetic note\nسطر ثان\n", "utf8"),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR synthetic")]),
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF synthetic")]),
  gif: Buffer.from("GIF89a synthetic", "latin1"),
  svg: Buffer.from(
    '<?xml version="1.0"?>\n<!-- synthetic -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    "utf8",
  ),
} as const;
const FILE_NAMES: Record<UploadType, string> = {
  pdf: "report.pdf",
  docx: "Charter.DOCX",
  xlsx: "model.xlsx",
  pptx: "deck.pptx",
  csv: "extract.csv",
  txt: "notes.txt",
  png: "chart.png",
  jpeg: "photo.JPG",
  gif: "anim.gif",
  svg: "diagram.svg",
};
const EXE = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"), Buffer.alloc(64, 0)]);
const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.domain)</script></svg>',
  "utf8",
);

// Maps, not computed members (the module-interface check of architecture.testkit.ts, D-055).
const fixture = (t: UploadType): Buffer => new Map<string, Buffer>(Object.entries(FIXTURES)).get(t)!;
const fileName = (t: UploadType): string => new Map(Object.entries(FILE_NAMES)).get(t)!;

const decide = (name: string, bytes: Buffer, policy = DEFAULT_UPLOAD_POLICY) =>
  decideUpload(name, detectContent(bytes), bytes.length, policy);
function refusal(fn: () => unknown): { status: number; code: string; params: unknown; detail: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpProblem);
    const p = err as HttpProblem;
    return { status: p.status, code: p.code, params: p.params, detail: p.detail };
  }
  throw new Error("expected a refusal");
}

describe("ADR-0052 §1 table: each row is detected by its bytes and accepted with its extension", () => {
  it.each(UPLOAD_TYPES.map((t) => [t]))("%s", (type) => {
    expect(decide(fileName(type), fixture(type))).toBe(type);
    // Every extension of the row is accepted, case-insensitively.
    for (const ext of extensionsOf(type)) expect(decide(`x${ext.toUpperCase()}`, fixture(type))).toBe(type);
  });

  it("the canonical media types equal p6_upload_media_type (0099)", () => {
    expect(UPLOAD_MEDIA_TYPES).toEqual({
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      csv: "text/csv",
      txt: "text/plain",
      png: "image/png",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
    });
  });

  it("csv and txt share the text rule: either extension accepts strict UTF-8 text", () => {
    expect(decide("a.txt", FIXTURES.csv)).toBe("txt");
    expect(decide("a.csv", FIXTURES.txt)).toBe("csv");
    expect(decide("empty.txt", Buffer.alloc(0))).toBe("txt");
  });

  it("a GIF87a is a gif", () => expect(decide("a.gif", Buffer.from("GIF87a....", "latin1"))).toBe("gif"));
});

describe("refusals (ADR-0052 §1 codes, English texts and params)", () => {
  const all = UPLOAD_TYPES.join(", ");

  it("an .exe is 422 evidence.type_not_allowed with the allowed types", () => {
    expect(refusal(() => decide("setup.exe", EXE))).toEqual({
      status: 422,
      code: "evidence.type_not_allowed",
      params: { allowedTypes: all },
      detail: `This file type is not allowed. Allowed types: ${all}.`,
    });
  });

  it("an .exe renamed .pdf is 422 evidence.type_mismatch (its bytes do not start %PDF-)", () => {
    expect(refusal(() => decide("invoice.pdf", EXE))).toEqual({
      status: 422,
      code: "evidence.type_mismatch",
      params: { extension: ".pdf" },
      detail: "The file's content does not match its extension .pdf.",
    });
    expect(refusal(() => decide("photo.png", EXE)).code).toBe("evidence.type_mismatch");
  });

  it("HTML is not an allowed type; HTML named .svg is a mismatch (its root is not <svg)", () => {
    const html = Buffer.from("<!doctype html><html><script>alert(1)</script></html>", "utf8");
    expect(refusal(() => decide("page.html", html)).code).toBe("evidence.type_not_allowed");
    expect(refusal(() => decide("page.htm", html)).code).toBe("evidence.type_not_allowed");
    expect(refusal(() => decide("page.svg", html)).code).toBe("evidence.type_mismatch");
  });

  it("a ZIP that is not OOXML is refused, by extension (.zip) and by content (renamed .docx)", () => {
    const zip = zipOf([
      ["readme.txt", "synthetic"],
      ["data/a.csv", "1,2"],
    ]);
    expect(detectContent(zip)).toEqual({ kind: "unknown", macro: false });
    expect(refusal(() => decide("archive.zip", zip)).code).toBe("evidence.type_not_allowed");
    expect(refusal(() => decide("archive.docx", zip)).code).toBe("evidence.type_mismatch");
  });

  it("a macro-enabled OOXML (vbaProject.bin) is 422 evidence.type_not_allowed, whatever its extension", () => {
    const xlsm = zipOf([CT, ["xl/workbook.xml", "<workbook/>"], ["xl/vbaProject.bin", "synthetic"]]);
    const docm = zipOf([CT, ["word/document.xml", "<w/>"], ["word/vbaProject.bin", "synthetic"]]);
    expect(detectContent(xlsm)).toEqual({ kind: "unknown", macro: true });
    expect(refusal(() => decide("model.xlsx", xlsm)).code).toBe("evidence.type_not_allowed");
    expect(refusal(() => decide("model.xlsm", xlsm)).code).toBe("evidence.type_not_allowed");
    expect(refusal(() => decide("charter.docx", docm)).code).toBe("evidence.type_not_allowed");
  });

  it("a type renamed to another allowed type is a mismatch (png named .gif, docx named .xlsx, pdf named .txt)", () => {
    expect(refusal(() => decide("a.gif", FIXTURES.png)).code).toBe("evidence.type_mismatch");
    expect(refusal(() => decide("a.xlsx", FIXTURES.docx)).code).toBe("evidence.type_mismatch");
    expect(refusal(() => decide("a.txt", FIXTURES.pdf)).code).toBe("evidence.type_mismatch");
    expect(refusal(() => decide("a.csv", FIXTURES.png)).code).toBe("evidence.type_mismatch");
  });

  it("text must be strict UTF-8 without NUL: invalid bytes, CESU-8 surrogates, a NUL or a cut sequence refuse", () => {
    for (const bad of [
      Buffer.from([0x61, 0xff, 0x62]),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from("a,b\n\u0000\n", "utf8"),
      Buffer.from([0x61, 0xd8]),
    ])
      expect(refusal(() => decide("x.csv", bad)).code).toBe("evidence.type_mismatch");
    expect(refusal(() => decide("x.svg", Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0x3e]))).code).toBe(
      "evidence.type_mismatch",
    );
  });

  it("no extension, a bare dot or an unknown extension is not allowed", () => {
    for (const name of ["README", "report.", ".pdf", "a.pdf.exe", "a.bin"])
      expect(refusal(() => decide(name, FIXTURES.pdf)).code, name).toBe("evidence.type_not_allowed");
  });

  it("a narrowed policy refuses a type the default allows, and names only its own types", () => {
    const narrowed = { ...DEFAULT_UPLOAD_POLICY, allowedTypes: ["pdf", "csv"] as const, maxBytes: 100 };
    expect(decide("a.png", FIXTURES.png)).toBe("png");
    expect(refusal(() => decide("a.png", FIXTURES.png, narrowed))).toMatchObject({
      status: 422,
      code: "evidence.type_not_allowed",
      params: { allowedTypes: "pdf, csv" },
    });
    expect(decide("a.pdf", FIXTURES.pdf, narrowed)).toBe("pdf");
  });

  it("a size above the policy limit is 413 evidence.too_large with maxBytes (re-checked at commit)", () => {
    const narrowed = { ...DEFAULT_UPLOAD_POLICY, maxBytes: 10 };
    expect(refusal(() => decide("a.pdf", FIXTURES.pdf, narrowed))).toEqual({
      status: 413,
      code: "evidence.too_large",
      params: { maxBytes: "10" },
      detail: "Evidence content is limited to 10 bytes per revision.",
    });
  });
});

describe("SVG root element (BOM, whitespace, XML declaration, comments)", () => {
  it.each([
    ["<svg/>", true],
    ['﻿  \n<?xml version="1.0" encoding="UTF-8"?><!-- a --><!-- b -->\n<svg xmlns="x">', true],
    ["<svg>", true],
    ["<svgx>", false],
    ["<html><svg/></html>", false],
    ["<!DOCTYPE svg><svg/>", false],
    ["<!-- never closed <svg/>", false],
    ["text <svg/>", false],
  ])("%j → %s", (head, expected) => expect(hasSvgRoot(head)).toBe(expected));

  it("an SVG with <script> and an onload handler is still an allowed svg upload (preview refuses it, §2)", () => {
    expect(decide("diagram.svg", SVG_WITH_SCRIPT)).toBe("svg");
  });
});

describe("the ZIP central directory reader (no decompression; at most 10,000 entries)", () => {
  it("reads entry names through an archive comment", () => {
    const zip = zipOf([CT, ["word/document.xml", "<w/>"]], { comment: "synthetic comment" });
    expect(zipEntryNames(zip, 0)).toEqual(["[Content_Types].xml", "word/document.xml"]);
    expect(detectContent(zip).kind).toBe("docx");
  });

  it("more than MAX_ZIP_ENTRIES entries is not read (unknown)", () => {
    const many: (readonly [string, string])[] = [CT, ["word/document.xml", ""]];
    for (let i = 0; many.length <= MAX_ZIP_ENTRIES; i++) many.push([`f/${i}`, ""]);
    expect(many.length).toBe(MAX_ZIP_ENTRIES + 1);
    expect(zipEntryNames(zipOf(many), 0)).toBeNull();
    expect(zipEntryNames(zipOf(many.slice(0, MAX_ZIP_ENTRIES)), 0)).toHaveLength(MAX_ZIP_ENTRIES);
  });

  it("truncated, without an end record, with a corrupt entry, or ambiguous: unknown", () => {
    const zip = FIXTURES.docx;
    expect(zipEntryNames(zip.subarray(0, zip.length - 1), 0)).toBeNull();
    expect(zipEntryNames(Buffer.from("PK\x03\x04 synthetic", "latin1"), 0)).toBeNull();
    const corrupt = Buffer.from(zip);
    corrupt.writeUInt32LE(0xdeadbeef, corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(zipEntryNames(corrupt, 0)).toBeNull();
    expect(classifyZip([CT[0], "word/document.xml", "xl/workbook.xml"])).toEqual({ kind: "unknown", macro: false });
    expect(classifyZip(["word/document.xml"])).toEqual({ kind: "unknown", macro: false });
  });

  it("a ZIP64 end record is not read", () => {
    const zip = Buffer.from(FIXTURES.xlsx);
    zip.writeUInt32LE(0xffffffff, zip.length - 22 + 16);
    expect(zipEntryNames(zip, 0)).toBeNull();
  });
});

describe("the streaming inspector sees the same bytes as the store, in any chunking", () => {
  const chunked = (bytes: Buffer, size: number) => {
    const parts: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += size) parts.push(bytes.subarray(i, i + size));
    return parts;
  };
  const viaChunks = (bytes: Buffer, size: number): Detection => {
    const inspector = new ContentInspector();
    for (const p of chunked(bytes, size)) inspector.push(p);
    return inspector.finish();
  };

  it.each(UPLOAD_TYPES.map((t) => [t]))("%s split into 1-, 3- and 7-byte chunks detects the same", (type) => {
    for (const size of [1, 3, 7]) expect(viaChunks(fixture(type), size)).toEqual(detectContent(fixture(type)));
  });

  it("a multi-byte character split across chunks is still valid UTF-8", () => {
    expect(viaChunks(Buffer.from("مثال اصطناعي", "utf8"), 1)).toEqual({ kind: "text", macro: false });
  });

  it("a large OOXML: the central directory is read from the retained tail of a multi-MiB stream", () => {
    const big = zipOf([CT, ["xl/media/blob.bin", "x".repeat(6 * 1024 * 1024)], ["xl/workbook.xml", "<w/>"]]);
    expect(viaChunks(big, 64 * 1024)).toEqual({ kind: "xlsx", macro: false });
  });

  it("inspectedBody re-yields every chunk unchanged while the inspector reads it", async () => {
    const inspector = new ContentInspector();
    const parts = chunked(FIXTURES.png, 3);
    const out: Uint8Array[] = [];
    for await (const c of inspectedBody(
      (async function* () {
        yield* parts;
      })(),
      inspector,
    ) as AsyncIterable<Uint8Array>)
      out.push(c);
    expect(Buffer.concat(out).equals(FIXTURES.png)).toBe(true);
    expect(inspector.finish().kind).toBe("png");
  });
});

describe("helpers", () => {
  it("extensions and the raster magic re-check", () => {
    expect(extensionOf("a.b.PDF")).toBe(".pdf");
    expect(extensionOf("noext")).toBe("");
    expect(typeOfExtension("x.jpeg")).toBe("jpeg");
    expect(typeOfExtension("x.exe")).toBeNull();
    expect(matchesRasterMagic("png", FIXTURES.png)).toBe(true);
    expect(matchesRasterMagic("png", FIXTURES.jpeg)).toBe(false);
    expect(matchesRasterMagic("jpeg", FIXTURES.jpeg)).toBe(true);
    expect(matchesRasterMagic("gif", FIXTURES.gif)).toBe(true);
    expect(matchesRasterMagic("gif", FIXTURES.svg)).toBe(false);
  });
});
