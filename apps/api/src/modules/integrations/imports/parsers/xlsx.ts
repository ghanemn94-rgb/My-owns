// The XLSX import parser (ADR-0056 §3; p6-work-split §B/A.3; T-DG6-BE-M). No dependency: the ZIP container is read
// with `node:zlib` (raw inflate, CRC-32) and the SpreadsheetML subset with a small tokenizer.
//
// Container limits, checked on the central directory BEFORE anything is unpacked, and again on what is unpacked
// (a lying header is caught by the inflate output cap and the CRC): at most 100 entries; each at most 20 MiB
// unpacked; together at most 50 MiB; each entry's ratio at most 100:1; no `xl/vbaProject.bin`, no `xl/externalLinks/*`,
// no macro-enabled content type, no external worksheet, no encrypted entry, no ZIP64, no DTD. Any of them is
// `import.xlsx_unsafe`. Something that is not an XLSX workbook at all (no ZIP signature, no `[Content_Types].xml`, no
// workbook or worksheet part) is `import.unsupported_media_type`.
//
// Cells (first worksheet only): shared and inline strings are text; a numeric cell's stored `<v>` text is taken
// VERBATIM (e.g. "12.5"), never parsed into a JavaScript number; a cell with a formula (`<f>`) is reported in
// `formulaIndexes` with a null value, never its cached result (D-195 Q11); a boolean cell is "true" or "false". Dates
// must be text cells in the template's format: a date serial stays its digits and the target reports it as
// `import.row.date_invalid`.
import { crc32, inflateRawSync } from "node:zlib";
import { IMPORT_LIMITS, importRefusals, type ParsedSheet, type ParsedSheetRow } from "../validate.ts";

// ------------------------------------------------------------------------------------------------ ZIP

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** True when the bytes start with a ZIP local-file signature (the content check of the XLSX media type). */
export function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const notXlsx = importRefusals.unsupportedMediaType;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw notXlsx();
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64 markers: never needed by a workbook inside the limits.
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw importRefusals.xlsxUnsafe();
  if (total > IMPORT_LIMITS.zipEntries) throw importRefusals.xlsxUnsafe();
  if (cdOffset + cdSize > eocd) throw notXlsx();
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw notXlsx();
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The container rules of ADR-0056 §3, on the declared sizes and names. */
function checkContainer(entries: readonly ZipEntry[]): void {
  const names = new Set<string>();
  let totalSize = 0;
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    if (names.has(lower)) throw importRefusals.xlsxUnsafe();
    names.add(lower);
    if (lower === "xl/vbaproject.bin" || lower.startsWith("xl/externallinks/")) throw importRefusals.xlsxUnsafe();
    if ((e.flags & 0x1) !== 0) throw importRefusals.xlsxUnsafe(); // encrypted
    if (e.method !== 0 && e.method !== 8) throw importRefusals.xlsxUnsafe();
    if (e.size > IMPORT_LIMITS.zipEntryBytes) throw importRefusals.xlsxUnsafe();
    if (e.size > IMPORT_LIMITS.zipRatio * Math.max(e.compressedSize, 1)) throw importRefusals.xlsxUnsafe();
    totalSize += e.size;
    if (totalSize > IMPORT_LIMITS.zipTotalBytes) throw importRefusals.xlsxUnsafe();
  }
}

function unpack(buf: Buffer, e: ZipEntry): string {
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL) throw importRefusals.unsupportedMediaType();
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + e.compressedSize;
  if (end > buf.length) throw importRefusals.unsupportedMediaType();
  const data = buf.subarray(start, end);
  let out: Buffer;
  if (e.method === 0) {
    out = data;
  } else {
    try {
      // The output cap is the declared size: an entry that unpacks larger than it declared is refused, not unpacked.
      out = inflateRawSync(data, { maxOutputLength: Math.max(e.size, 1) });
    } catch {
      throw importRefusals.xlsxUnsafe();
    }
  }
  if (out.length !== e.size || crc32(out) >>> 0 !== e.crc >>> 0) throw importRefusals.xlsxUnsafe();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(out);
  } catch {
    throw importRefusals.unsupportedMediaType();
  }
}

// ------------------------------------------------------------------------------------------------ XML

interface XmlHandlers {
  open(name: string, attrs: ReadonlyMap<string, string>, selfClosing: boolean): void;
  close(name: string): void;
  text(value: string): void;
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!([^>]*)>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/gy;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const localName = (qname: string): string => qname.slice(qname.indexOf(":") + 1);

/** XML character references and the five predefined entities; anything else stays as written. */
export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, ref: string) => {
    switch (ref) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const code = ref.startsWith("#x") ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** SpreadsheetML's `_xHHHH_` escape of a character in a string (e.g. `_x000D_` for a carriage return). */
const decodeOoxmlEscapes = (s: string): string =>
  s.replace(/_x([0-9A-Fa-f]{4})_/g, (_w, hex: string) => String.fromCharCode(parseInt(hex, 16)));

function walkXml(xml: string, h: XmlHandlers): void {
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < xml.length) {
    const m = TOKEN.exec(xml);
    if (!m) throw importRefusals.unsupportedMediaType(); // not well-formed at this position
    if (m[1] !== undefined) h.text(m[1]);
    else if (m[2] !== undefined) {
      // <!DOCTYPE ...> or another declaration: a workbook part never has one (no entity expansion, ever).
      throw importRefusals.xlsxUnsafe();
    } else if (m[3] !== undefined) h.close(localName(m[3]));
    else if (m[4] !== undefined) {
      const attrs = new Map<string, string>();
      for (const a of (m[5] ?? "").matchAll(ATTR)) attrs.set(localName(a[1]!), decodeXmlText(a[2] ?? a[3] ?? ""));
      h.open(localName(m[4]), attrs, m[6] === "/");
      if (m[6] === "/") h.close(localName(m[4]));
    } else if (m[7] !== undefined) h.text(decodeXmlText(m[7]));
  }
}

/** The text of every `<t>` of `<si>`/`<is>` content, excluding phonetic runs (`<rPh>`). */
function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  let inSi = false;
  let inT = false;
  let phonetic = 0;
  let current = "";
  walkXml(xml, {
    open(name) {
      if (name === "si") {
        inSi = true;
        current = "";
      } else if (name === "rPh") phonetic += 1;
      else if (name === "t" && inSi && phonetic === 0) inT = true;
    },
    close(name) {
      if (name === "si") {
        out.push(decodeOoxmlEscapes(current));
        inSi = false;
      } else if (name === "rPh") phonetic -= 1;
      else if (name === "t") inT = false;
    },
    text(value) {
      if (inT) current += value;
    },
  });
  return out;
}

/** "B" -> 1 (0-based column index of a cell reference's letters); null when the reference has none. */
function columnIndex(ref: string | undefined): number | null {
  const m = /^([A-Z]{1,3})[0-9]*$/.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

interface SheetRow {
  values: (string | null)[];
  formulas: number[];
}

/** The first worksheet's rows by row number (1-based), as text. */
function sheetRows(xml: string, strings: readonly string[]): Map<number, SheetRow> {
  const rows = new Map<number, SheetRow>();
  let rowNo = 0;
  let row: { cells: Map<number, string | null>; formulas: number[] } | null = null;
  let col = -1;
  let cell: { type: string; formula: boolean; v: string | null; inline: string | null } | null = null;
  let target: "v" | "t" | null = null;
  let inIs = false;
  let phonetic = 0;
  walkXml(xml, {
    open(name, attrs) {
      if (name === "row") {
        const ref = attrs.get("r");
        const r = ref === undefined ? rowNo + 1 : Number.parseInt(ref, 10);
        if (!Number.isInteger(r) || r < 1 || r <= rowNo) throw importRefusals.unsupportedMediaType();
        rowNo = r;
        row = { cells: new Map(), formulas: [] };
        col = -1;
      } else if (name === "c" && row) {
        const fromRef = columnIndex(attrs.get("r"));
        col = fromRef ?? col + 1;
        if (col >= 16_384) throw importRefusals.xlsxUnsafe();
        cell = { type: attrs.get("t") ?? "n", formula: false, v: null, inline: null };
      } else if (cell) {
        if (name === "f") cell.formula = true;
        else if (name === "v") {
          target = "v";
          cell.v = "";
        } else if (name === "is") {
          inIs = true;
          cell.inline = "";
        } else if (name === "rPh") phonetic += 1;
        else if (name === "t" && inIs && phonetic === 0) target = "t";
      }
    },
    close(name) {
      if (name === "v" || name === "t") target = null;
      else if (name === "is") inIs = false;
      else if (name === "rPh") phonetic -= 1;
      else if (name === "c" && row && cell) {
        let value: string | null;
        if (cell.formula) {
          value = null;
          row.formulas.push(col);
        } else if (cell.type === "s") {
          const idx = cell.v === null ? NaN : Number.parseInt(cell.v, 10);
          if (!Number.isInteger(idx) || idx < 0 || idx >= strings.length || !/^[0-9]+$/.test(cell.v ?? ""))
            throw importRefusals.unsupportedMediaType();
          value = strings.at(idx)!;
        } else if (cell.type === "inlineStr") value = decodeOoxmlEscapes(cell.inline ?? "");
        else if (cell.type === "b") value = cell.v === "1" ? "true" : cell.v === "0" ? "false" : cell.v;
        else value = cell.v; // n, str, e, d: the stored text verbatim
        row.cells.set(col, value === "" ? null : value);
        cell = null;
      } else if (name === "row" && row) {
        const width = row.cells.size === 0 ? 0 : Math.max(...row.cells.keys()) + 1;
        rows.set(rowNo, {
          values: Array.from({ length: width }, (_, i) => row!.cells.get(i) ?? null),
          formulas: row.formulas,
        });
        row = null;
      }
    },
    text(value) {
      if (!cell) return;
      if (target === "v") cell.v = (cell.v ?? "") + value;
      else if (target === "t") cell.inline = (cell.inline ?? "") + value;
    },
  });
  return rows;
}

// ------------------------------------------------------------------------------------------------ workbook

function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function relationships(xml: string): Relationship[] {
  const out: Relationship[] = [];
  walkXml(xml, {
    open(name, a) {
      if (name === "Relationship")
        out.push({
          id: a.get("Id") ?? "",
          type: a.get("Type") ?? "",
          target: a.get("Target") ?? "",
          external: a.get("TargetMode") === "External",
        });
    },
    close() {},
    text() {},
  });
  return out;
}

/**
 * Parses XLSX bytes: the first worksheet's header (row 1) and data rows. Throws the ADR-0056 §9 problem of the first
 * whole-file refusal. The 10 MiB size limit is the caller's (`parseImportFile`), checked before any parsing.
 */
export function parseXlsx(bytes: Uint8Array): ParsedSheet {
  if (!hasZipSignature(bytes)) throw importRefusals.unsupportedMediaType();
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readCentralDirectory(buf);
  checkContainer(entries);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const part = (name: string): string | null => {
    const e = byName.get(name);
    return e ? unpack(buf, e) : null;
  };

  const contentTypes = part("[Content_Types].xml");
  if (contentTypes === null) throw importRefusals.unsupportedMediaType();
  if (/macroEnabled/i.test(contentTypes)) throw importRefusals.xlsxUnsafe();

  const rootRels = part("_rels/.rels");
  const officeDoc = rootRels
    ? relationships(rootRels).find((r) => r.type.endsWith("/officeDocument"))?.target
    : undefined;
  const workbookPath = officeDoc ? resolvePart("", officeDoc) : "xl/workbook.xml";
  const workbook = part(workbookPath);
  if (workbook === null) throw importRefusals.unsupportedMediaType();

  let firstSheetRel: string | null = null;
  walkXml(workbook, {
    open(name, a) {
      if (name === "sheet" && firstSheetRel === null) firstSheetRel = a.get("id") ?? null;
    },
    close() {},
    text() {},
  });
  const relsPath = resolvePart(workbookPath, `_rels/${workbookPath.split("/").pop()}.rels`);
  const wbRelsXml = part(relsPath);
  if (firstSheetRel === null || wbRelsXml === null) throw importRefusals.unsupportedMediaType();
  const wbRels = relationships(wbRelsXml);
  if (wbRels.some((r) => r.external || r.type.endsWith("/externalLink"))) throw importRefusals.xlsxUnsafe();
  const sheetRel = wbRels.find((r) => r.id === firstSheetRel);
  if (!sheetRel) throw importRefusals.unsupportedMediaType();
  const sheetXml = part(resolvePart(workbookPath, sheetRel.target));
  if (sheetXml === null) throw importRefusals.unsupportedMediaType();
  const ssRel = wbRels.find((r) => r.type.endsWith("/sharedStrings"));
  const ssXml = ssRel ? part(resolvePart(workbookPath, ssRel.target)) : null;
  const strings = ssXml === null ? [] : sharedStrings(ssXml);

  const rows = sheetRows(sheetXml, strings);
  const headerRow = rows.get(1);
  const data: ParsedSheetRow[] = [];
  for (const [rowNumber, r] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber === 1) continue;
    if (r.formulas.length === 0 && r.values.every((v) => v === null)) continue;
    if (data.length + 1 > IMPORT_LIMITS.dataRows || rowNumber > IMPORT_LIMITS.rowNumber)
      throw importRefusals.tooManyRows();
    data.push({ rowNumber, values: r.values, formulaIndexes: r.formulas });
  }
  return {
    header: headerRow ? headerRow.values : [],
    headerFormulaIndexes: headerRow ? headerRow.formulas : [],
    rows: data,
  };
}
