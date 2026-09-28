// RFC 4180 CSV parser (no dependencies). Returns { header, rows } where rows are objects keyed by header.

export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      if (field.length > 0) throw new Error(`CSV: stray quote inside unquoted field near record ${records.length + 1}`);
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (!(record.length === 1 && record[0] === "")) records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (inQuotes) throw new Error("CSV: unterminated quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r, idx) => {
    if (r.length !== header.length) {
      throw new Error(`CSV: record ${idx + 2} has ${r.length} fields, header has ${header.length}`);
    }
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
  return { header, rows };
}
