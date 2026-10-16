// qa-verifier A15 support (T-DG5-QA-C): exports a report through the REAL API (POST /api/v1/exports), delivers the
// job's outbox event to the REAL worker export runner (apps/worker reports.export, with the production content label
// table, as the e2e stack runs no worker: D-162 d), downloads the file through GET /api/v1/exports/{id}/download and
// reads it back with the package's own test readers (PDF, XLSX, DOCX/PPTX). The acceptance suites assert on what a
// reader of the file sees: the text runs, the direction markers and the formula cells. All data is SYNTHETIC.
import { expect } from "vitest";
import { REPORT_CONTENT_LABELS } from "../../../packages/shared/src/reports/content-labels.ts";
import { FRAME_LABELS } from "../../../packages/reporting/src/labels.ts";
import { readOoxml, xmlTexts } from "../../../packages/reporting/src/ooxml-read.ts";
import { lines, plain, readPdf, type ReadPdf } from "../../../packages/reporting/src/pdf/read.ts";
import { FilesystemExportStore } from "../../../packages/reporting/src/storage.ts";
import { readXlsx, type ReadWorkbook } from "../../../packages/reporting/src/xlsx/read.ts";
import { runExport } from "../../../apps/worker/src/reports/export-runner.ts";
import { call, testEvidenceDir, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;
export type Format = "pdf" | "docx" | "xlsx" | "pptx" | "csv";
export type Lang = "en" | "ar";

export const CONTENT_TYPES: Record<Format, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
};

export const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** One delivery of the export job's `export_job.requested` outbox event to the worker's runner (first attempt). */
export async function runWorker(api: TestApi, exportJobId: string, retryCount = 0): Promise<Body> {
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${exportJobId}`)
    .executeTakeFirstOrThrow();
  const envelope = {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: row.payload,
  };
  // The production dependencies of reports.export (apps/worker handlers/reports.ts exportRunnerDeps): the content label
  // table of @mth/shared and a filesystem store; the store is the API's evidence path of this test run.
  return runExport(
    api.db,
    envelope,
    row.id,
    { retryCount, retryLimit: 5 },
    {
      store: new FilesystemExportStore(testEvidenceDir()),
      labels: REPORT_CONTENT_LABELS,
    },
  );
}

export interface Exported {
  readonly job: Body;
  readonly bytes: Uint8Array;
  readonly headers: Record<string, unknown>;
}

/** POST /exports (202) -> worker -> GET /exports/{id} (succeeded) -> download (200). */
export async function exportFile(api: TestApi, session: Session, body: Record<string, unknown>): Promise<Exported> {
  const created = ok(await call<Body>(api.app, "POST", "/api/v1/exports", { session, body }), 202, "createExport");
  expect(created.status).toBe("queued");
  const outcome = await runWorker(api, created.id);
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ outcome: "succeeded" });
  const job = ok(await call<Body>(api.app, "GET", `/api/v1/exports/${created.id}`, { session }), 200, "getExport");
  expect(job).toMatchObject({ status: "succeeded", stage: "done", percent: 100 });
  const res = await call<Body>(api.app, "GET", `/api/v1/exports/${created.id}/download`, { session });
  expect(res.status, `download ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  const bytes = new Uint8Array(res.raw.rawPayload);
  expect(bytes.byteLength).toBe(job.fileSizeBytes);
  return { job, bytes, headers: res.headers as Record<string, unknown> };
}

/** What a reader of the file sees: its text runs (each a separate piece) and its direction markers. */
export interface FileView {
  readonly format: Format;
  /** Every text piece (PDF: the drawn runs in logical order, and the visual lines; OOXML: a:t / w:t runs; XLSX: cells; CSV: fields). */
  readonly pieces: string[];
  /** All pieces joined by newlines (for substring checks). */
  readonly text: string;
  /** True when the file declares right-to-left layout (null: the format has no layout, CSV). */
  readonly rtl: boolean | null;
  readonly pdf?: ReadPdf;
  readonly xlsx?: ReadWorkbook;
  readonly xml?: string;
  readonly csvRows?: string[][];
}

/** RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
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
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function viewOf(format: Format, bytes: Uint8Array): Promise<FileView> {
  const mk = (pieces: string[], rtl: boolean | null, extra: Partial<FileView> = {}): FileView => ({
    format,
    pieces,
    text: pieces.join("\n"),
    rtl,
    ...extra,
  });
  if (format === "pdf") {
    const pdf = readPdf(bytes);
    const pieces = [
      ...pdf.shown.flatMap((s) => [s.text, s.logical, plain(s.logical)]),
      ...lines(pdf),
      ...rtlLines(pdf),
    ];
    return mk(pieces, pdfIsRtl(pdf), { pdf });
  }
  if (format === "xlsx") {
    const wb = await readXlsx(bytes);
    const pieces = [
      ...wb.sheets.map((s) => s.name),
      ...wb.sheets.flatMap((s) => s.rows.flatMap((r) => r.map((c) => c.text ?? c.value ?? ""))),
    ];
    return mk(pieces, wb.sheets.length > 0 && wb.sheets.every((s) => s.rtl), { xlsx: wb });
  }
  if (format === "docx") {
    const o = await readOoxml(bytes, /^word\/(document|footer\d*|header\d*)\.xml$/);
    const xml = [...o.parts.values()].join("\n");
    const body = o.parts.get("word/document.xml") ?? "";
    return mk(
      [...o.parts.values()].flatMap(xmlTexts),
      /<w:bidi\/>|<w:bidi w:val="(1|true)"\/>/.test(body) && /<w:rtl\/>|<w:rtl w:val="(1|true)"\/>/.test(body),
      { xml },
    );
  }
  if (format === "pptx") {
    const o = await readOoxml(bytes, /^ppt\/slides\/slide\d+\.xml$/);
    const xml = [...o.parts.values()].join("\n");
    return mk([...o.parts.values()].flatMap(xmlTexts), / rtl="1"/.test(xml), { xml });
  }
  const text = Buffer.from(bytes).toString("utf8");
  const rows = parseCsv(text.replace(/^﻿/, ""));
  return mk(rows.flat(), null, { csvRows: rows });
}

const ARABIC = /[\u0600-\u06FF\uFE70-\uFEFF]/;

/**
 * The visual lines of a PDF read right to left (the reading order of an Arabic line): the pieces at one baseline from
 * the right, each Arabic piece in its logical order, each left-to-right piece (identifiers, numbers) as drawn.
 */
export function rtlLines(pdf: ReadPdf): string[] {
  const rows = new Map<string, ReadPdf["shown"][number][]>();
  for (const s of pdf.shown) {
    const key = `${s.page}:${s.y.toFixed(1)}`;
    rows.set(key, [...(rows.get(key) ?? []), s]);
  }
  return [...rows.values()].map((r) =>
    [...r]
      .sort((a, b) => b.x - a.x)
      .map((s) => (ARABIC.test(s.text) ? s.logical : s.text))
      .join(""),
  );
}

/**
 * The direction a PDF is laid out in, read from what it draws on page 1: the footer puts the issue line ("Draft — not
 * an issued report" / "مسودة — ليس تقريراً صادراً", or the issued line) on the START side and "Page n of m" on the END
 * side (ADR-0046 §2-§3). RTL when the issue line lies to the right of the page number. Null when either is not drawn.
 */
export function pdfIsRtl(pdf: ReadPdf): boolean | null {
  const page1 = pdf.shown.filter((s) => s.page === 1);
  const xOf = (re: RegExp) => {
    const hits = page1.filter((s) => re.test(s.text) || re.test(plain(s.logical)));
    return hits.length === 0 ? null : hits;
  };
  const issue = xOf(/Draft|Issued report|مسودة|تقرير صادر/);
  const page = xOf(/Page|الصفحة/);
  if (issue === null || page === null) return null;
  // The footer line: the lowest baseline that carries the page label.
  const y = Math.min(...page.map((s) => s.y));
  const iss = issue.filter((s) => Math.abs(s.y - y) < 1);
  const pg = page.filter((s) => Math.abs(s.y - y) < 1);
  if (iss.length === 0 || pg.length === 0) return null;
  return Math.max(...iss.map((s) => s.x)) > Math.max(...pg.map((s) => s.x));
}

/** Whitespace-normalised containment (PDF and DOCX wrap long lines and split runs). */
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** Text without whitespace, Arabic diacritics and tatweel: what remains when runs are split anywhere. */
export const squash = (s: string) => plain(s).replace(/[\s\u0640]+/g, "");
export function contains(v: FileView, needle: string): boolean {
  if (v.text.includes(needle)) return true;
  const n = norm(plain(needle));
  if (norm(plain(v.text)).includes(n) || norm(plain(v.pieces.join(" "))).includes(n)) return true;
  return squash(v.text).includes(squash(needle));
}

/**
 * The English frame and content labels (FRAME_LABELS.en, REPORT_CONTENT_LABELS.en) that would betray an English
 * fallback in an Arabic file: labels with at least one word of 3+ Latin letters whose Arabic translation differs and
 * does not itself contain the English text (e.g. "بصمة SHA-256" keeps the identifier SHA-256). Placeholders dropped.
 * Maps the English text to its Arabic translation.
 */
export function englishLabels(): Map<string, string> {
  const en = { ...FRAME_LABELS.en, ...REPORT_CONTENT_LABELS.en } as Record<string, string>;
  const ar = { ...FRAME_LABELS.ar, ...REPORT_CONTENT_LABELS.ar } as Record<string, string>;
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== "string" || v.includes("{")) continue;
    const a = ar[k];
    if (!/[A-Za-z]{3,}/.test(v) || a === undefined || a === v || a.includes(v)) continue;
    out.set(v, a);
  }
  return out;
}

/**
 * Pieces of an Arabic file that are exactly an English label while the file nowhere prints that label's Arabic
 * translation: a heading, column or code label that fell back to English (D-157 a). A catalogue text printed in both
 * languages side by side (a bilingual data column, such as the gate pack's criterion label_en / label_ar) is data, not
 * a fallback, and is not reported.
 */
export function englishFallbacks(v: FileView): string[] {
  const labels = englishLabels();
  const all = squash(v.text);
  return [
    ...new Set(v.pieces.map((p) => p.trim()).filter((p) => labels.has(p) && !all.includes(squash(labels.get(p)!)))),
  ];
}
