// The CSV import parser (ADR-0056 §3; p6-work-split §B/A.3; T-DG6-BE-M). No dependency.
//
// - Encoding: UTF-8 only, decoded strictly (a byte sequence that is not UTF-8 is `import.csv_not_utf8`, never replaced
//   by U+FFFD); an optional byte-order mark is removed. Content that is not text at all (a NUL byte, or a ZIP
//   container sent as CSV) is `import.unsupported_media_type`.
// - Syntax: RFC 4180: comma separator; CRLF or LF line ends; a field in double quotes may hold commas, line breaks and
//   doubled quotes (""). A quote inside an unquoted field is kept as a character; a quoted field that is not closed,
//   or text after a closing quote, is `import.csv_malformed`.
// - Rows: row 1 is the header; a record whose cells are all empty is skipped (its row number is not reused); more than
//   5,000 data rows (or a data row beyond source row 100,000) is `import.too_many_rows`.
// - Cells are TEXT. Formula-like text (`=`, `+`, `-`, `@` first) is imported as text (D-195 Q11) and neutralised on any
//   later export (ADR-0046). Nothing is ever converted to a number here.
import { IMPORT_LIMITS, importRefusals, type ParsedSheet, type ParsedSheetRow } from "../validate.ts";
import { hasZipSignature } from "./xlsx.ts";

/** Decodes the bytes as strict UTF-8 without a BOM; refuses binary content (415) and non-UTF-8 text (422). */
export function decodeCsvText(bytes: Uint8Array): string {
  if (hasZipSignature(bytes) || bytes.includes(0)) throw importRefusals.unsupportedMediaType();
  try {
    // ignoreBOM: false removes one leading U+FEFF.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw importRefusals.csvNotUtf8();
  }
}

/**
 * Parses CSV bytes into the header and the data rows. Throws the ADR-0056 §9 problem of the first whole-file refusal.
 * The 10 MiB size limit is the caller's (`parseImportFile`), checked before any parsing.
 */
export function parseCsv(bytes: Uint8Array): ParsedSheet {
  const text = decodeCsvText(bytes);
  const records: { rowNumber: number; values: (string | null)[] }[] = [];
  let header: (string | null)[] | null = null;
  let record: (string | null)[] = [];
  let field = "";
  let quoted = false; // the current field started with a quote
  let inQuotes = false; // inside the quoted part of the current field
  let closed = false; // the current field's closing quote was seen
  let recordNo = 0;
  let dataRows = 0;

  const endField = () => {
    record.push(field === "" && !quoted ? null : field);
    field = "";
    quoted = false;
    closed = false;
  };
  const endRecord = () => {
    endField();
    recordNo += 1;
    const values = record;
    record = [];
    if (header === null) {
      header = values;
      return;
    }
    if (values.every((v) => v === null || v === "")) return;
    dataRows += 1;
    // A data row beyond source row 100,000 (blank records in between) cannot be stored either (import_row.row_number).
    if (dataRows > IMPORT_LIMITS.dataRows || recordNo > IMPORT_LIMITS.rowNumber) throw importRefusals.tooManyRows();
    records.push({ rowNumber: recordNo, values });
  };

  // Chunked scan: the text between two special characters is appended in one slice (a 10 MiB file is a few thousand
  // slices, not ten million single-character steps), so the parse stays fast under load.
  const n = text.length;
  const special = /[,\r\n"]/g;
  let i = 0;
  while (i < n) {
    if (inQuotes) {
      const q = text.indexOf('"', i);
      if (q < 0) throw importRefusals.csvMalformed();
      field += text.slice(i, q);
      if (text.charAt(q + 1) === '"') {
        field += '"';
        i = q + 2;
      } else {
        inQuotes = false;
        closed = true;
        i = q + 1;
      }
      continue;
    }
    special.lastIndex = i;
    const m = special.exec(text);
    const j = m ? m.index : n;
    if (j > i) {
      // RFC 4180: after a closing quote only a separator or a line end may follow.
      if (closed) throw importRefusals.csvMalformed();
      field += text.slice(i, j);
    }
    if (!m) break;
    const ch = text.charAt(j);
    if (ch === ",") {
      endField();
      i = j + 1;
    } else if (ch === "\n" || ch === "\r") {
      i = ch === "\r" && text.charAt(j + 1) === "\n" ? j + 2 : j + 1;
      endRecord();
    } else {
      if (closed) throw importRefusals.csvMalformed();
      if (field === "" && !quoted) {
        quoted = true;
        inQuotes = true;
      } else {
        field += '"'; // a quote inside an unquoted field is kept as a character
      }
      i = j + 1;
    }
  }
  if (inQuotes) throw importRefusals.csvMalformed();
  // The last record when the file does not end with a line break.
  if (field !== "" || quoted || record.length > 0) endRecord();

  const rows: ParsedSheetRow[] = records.map((r) => ({ rowNumber: r.rowNumber, values: r.values, formulaIndexes: [] }));
  return { header: header ?? [], headerFormulaIndexes: [], rows };
}
