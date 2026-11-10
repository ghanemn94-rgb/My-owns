// qa-verifier A17 file and signature builders (DG6, T-DG6-QA-A), free of any test-runner import so that both the
// Vitest suites (tests/qa/integration) and the Playwright specs (e2e/) use the same synthetic fixture.
//
// Independence: the CSV and XLSX files are built HERE (never with the product's column constant or XLSX writer). The
// XLSX is a minimal Office Open XML workbook (stored ZIP entries, inline-string and numeric cells) written with
// node:zlib's CRC-32 only. The webhook signature follows the scheme documented in docs/api/openapi.yaml
// `receiveWebhook`: X-MTH-Webhook-Signature: v1=<hex HMAC-SHA256 of '<timestamp>.<deliveryId>.<raw body>'>.
// Every value is SYNTHETIC; nothing here approves anything (G1-G6) or touches the engineering gates DG0-DG7.
import { createHash, createHmac } from "node:crypto";
import { crc32 } from "node:zlib";

export const CSV = "text/csv";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** Canonical decimal text (no float): "1000.000000" -> "1000", "-3.250" -> "-3.25", "0.000001" stays. */
export function decimalCanon(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(v.trim());
  if (!m) return `NOT-A-DECIMAL(${v})`;
  const int = m[2]!.replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const sign = m[1] === "-" && !(int === "0" && frac === "") ? "-" : "";
  return frac ? `${sign}${int}.${frac}` : `${sign}${int}`;
}

export type Row = Partial<Record<string, string>>;

const csvCell = (t: string): string => (/[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
/** RFC 4180 CSV, UTF-8, CRLF, one header row. */
export function csvFile(header: readonly string[], rows: readonly Row[]): Buffer {
  return Buffer.from(
    [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h] ?? "")).join(","))].join("\r\n") + "\r\n",
    "utf8",
  );
}

// ------------------------------------------------------------------ a minimal XLSX (independent writer)

const xmlEsc = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colRef = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A stored (uncompressed) ZIP archive of `entries`. */
function zip(entries: ReadonlyArray<[string, Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * One-sheet XLSX. Every cell is an inline string, except the cells of `numericColumns` whose text is a plain decimal:
 * those are numeric cells whose stored `<v>` is that text (ADR-0056 §3: taken verbatim as a decimal string).
 */
export function xlsxFile(
  header: readonly string[],
  rows: readonly Row[],
  numericColumns: readonly string[] = [],
): Buffer {
  const line = (cells: ReadonlyArray<string>, r: number, numeric: (c: number) => boolean): string =>
    `<row r="${r}">` +
    cells
      .map((v, c) => {
        if (v === "") return "";
        const ref = `${colRef(c)}${r}`;
        return numeric(c) && /^-?[0-9]+(\.[0-9]+)?$/.test(v)
          ? `<c r="${ref}"><v>${v}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      })
      .join("") +
    `</row>`;
  const numericIdx = new Set(numericColumns.map((c) => header.indexOf(c)));
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    line(header, 1, () => false) +
    rows
      .map((row, i) =>
        line(
          header.map((h) => row[h] ?? ""),
          i + 2,
          (c) => numericIdx.has(c),
        ),
      )
      .join("") +
    `</sheetData></worksheet>`;
  const b = (s: string) => Buffer.from(s, "utf8");
  return zip([
    [
      "[Content_Types].xml",
      b(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    ],
    [
      "_rels/.rels",
      b(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    ],
    [
      "xl/workbook.xml",
      b(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    ],
    [
      "xl/_rels/workbook.xml.rels",
      b(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    ],
    ["xl/worksheets/sheet1.xml", b(sheet)],
  ]);
}

// ------------------------------------------------------------------ the A17 8/1/1 fixture

export interface FixtureKpis {
  readonly direct: string; // a direct-accept KPI
  readonly review: string; // a review-route KPI
}

/**
 * A17 "a file with 8 valid rows, 1 invalid row and 1 duplicate": data rows 2-9 valid (8 distinct KPI/scope/period
 * slots), row 10 invalid (`12,5` is not a decimal: comma separator), row 11 a duplicate of row 3 (same KPI, scope and
 * period). `periods` are 5 open period labels; the invalid row uses the 5th so its only defect is the value.
 */
export function a17Rows(kpis: FixtureKpis, transformationId: string, periods: readonly string[], tag: string): Row[] {
  const [p1, p2, p3, p4, p5] = periods as [string, string, string, string, string];
  const r = (kpi: string, period: string, n: number, value: string): Row => ({
    source_record_id: `${tag}-${String(n).padStart(2, "0")}`,
    kpi_id: kpi,
    scope_kind: "transformation",
    scope_id: transformationId,
    period_label: period,
    value,
    data_as_of: "2041-01-31",
  });
  return [
    r(kpis.direct, p1, 1, "120.5"),
    r(kpis.direct, p2, 2, "121"),
    r(kpis.direct, p3, 3, "0.000001"),
    r(kpis.direct, p4, 4, "-3.25"),
    r(kpis.review, p1, 5, "1000"),
    r(kpis.review, p2, 6, "1000.000000"),
    r(kpis.review, p3, 7, "42.5"),
    r(kpis.review, p4, 8, "999999999999999999.999999"),
    r(kpis.direct, p5, 9, "12,5"), // row 10: invalid
    r(kpis.direct, p2, 10, "7"), // row 11: duplicate of row 3
  ];
}

/** The expected committed value per source row number (2-9) as canonical decimal text. */
export const A17_VALID_VALUES: Readonly<Record<number, string>> = Object.freeze({
  2: "120.5",
  3: "121",
  4: "0.000001",
  5: "-3.25",
  6: "1000",
  7: "1000",
  8: "42.5",
  9: "999999999999999999.999999",
});

// ------------------------------------------------------------------ webhooks

export function signWebhook(secret: string, timestamp: string, deliveryId: string, raw: Buffer): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${deliveryId}.`).update(raw).digest("hex");
}

/**
 * The fixture rows as webhook items, keyed by the `kpi_actual.v1` template columns (the body names the template in
 * `templateVersion`; every value a JSON string). Note: ADR-0056 §7's example uses camelCase keys (`sourceRecordId`,
 * `kpiId`, ...), which the server refuses without a field mapping (400 webhook.payload_invalid, /items
 * import.header_mismatch); the contract (OpenAPI WebhookDelivery) names no item keys. Reported in the handback.
 */
export function webhookItems(rows: readonly Row[]): Record<string, string>[] {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).filter((e): e is [string, string] => e[1] !== undefined)),
  );
}
