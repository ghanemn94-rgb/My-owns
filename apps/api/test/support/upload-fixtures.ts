// SYNTHETIC upload fixtures of T-DG6-BE-D (ADR-0052 §1): one byte sample per row of the allow-list table, an .exe, an
// SVG carrying script, and a minimal stored-entry ZIP writer for the OOXML cases (no dependency). Shared by the unit
// test evidence/content-policy.test.ts and the integration tests evidence/preview.test.ts and admin/upload-policy.test.ts.
import type { UploadType } from "@mth/shared/schemas";

/** A ZIP with stored (uncompressed) entries: local headers, data, central directory, end record. */
export function zipOf(entries: readonly (readonly [string, string])[], opts: { comment?: string } = {}): Buffer {
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

export const CT: readonly [string, string] = ["[Content_Types].xml", "<Types/>"];
export const FIXTURES = {
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
export const FILE_NAMES: Record<UploadType, string> = {
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
export const EXE = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"), Buffer.alloc(64, 0)]);
export const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.domain)</script></svg>',
  "utf8",
);
