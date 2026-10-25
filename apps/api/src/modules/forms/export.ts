// Export of one native form's records (OpenAPI tag "forms"; ADR-0041 §5 "Export", §7, §9, §10; REQ-S05-001;
// p5-work-split §B.4; T-DG5-BE-E2):
//   GET /transformations/{t}/form-records/{recordType}/export?format=csv|json&lang=en|ar   exportFormRecords
// The rows are every record of the type in the transformation (T04/T16: of the right decision kind), oldest first,
// at most 5000 (else 422 form_export.too_large; large and formatted exports are the slice F report exports). The
// columns are the source columns stored in one typed column (`column` storage of form_source_field) and the extension
// fields of the transformation's pinned form_schema version (forms v1 when unpinned), labelled in the requested
// language (default: the caller's preferred language). Values are strings: decimals exactly as stored (numeric text,
// never a float), percentages as fractions, currency as "<code> <amount>", choice values as their labels in the
// language. A field without a value is Unknown: an empty value with the status `unknown`; a calculated field whose
// inputs are missing is Not computable (`not_computable`) - never 0.
//   - `format=json` (application/json): the FormRecordExport body (illustrativeLabel, columns, then rows with values and
//     statuses).
//   - `format=csv` (default; text/csv): RFC 4180, UTF-8 with a byte-order mark (Arabic opens in spreadsheet
//     applications), CRLF line ends; a status column follows each value column; text that a spreadsheet would read as a
//     formula (first character = + - @ TAB CR) is prefixed with an apostrophe (the ADR-0046 §4 rule; the API does not
//     load @mth/reporting's renderers, so the two-line rule is applied here), decimals are never prefixed.
//   - `format` and the Accept header must agree when both are sent (400 at /query/format); without `format`, an Accept
//     of application/json alone selects JSON.
//   - Demo database (F-DG5-124; D-178; ADR-0050 §2 (d); REQ-S18-001, REQ-PB-089; M0090, M0339): the environment is read
//     at generation time from the same source as GET /environment and the report pipeline (the deployment marker,
//     `@mth/db` readDeploymentEnvironment: synthetic exactly in a `demo` database; no marker = production, fail-safe).
//     On a demo database the CSV's first row, after the byte-order mark and before the header, is the illustrative
//     label in the export language, and the JSON body's `illustrativeLabel` is the same string; otherwise no label row
//     and `illustrativeLabel: null`. The strings are the reporting pipeline's `export.illustrative` (packages/reporting
//     labels.ts); the API does not load @mth/reporting's main entry (ADR-0046 §1), so they are repeated here and the
//     integration test form-export-illustrative.test.ts holds them equal.
// Authorization: `transformation.read` in scope (404 outside it; AUD reads). Read only: nothing is written.
import { readDeploymentEnvironment, sql, type Db, type FormRecordTypeRow } from "@mth/db";
import { evaluateCalculatedField, toCalculatedEntry } from "@mth/shared/calc";
import {
  FORM_EXPORT_MAX_ROWS,
  formRecordExportQuery,
  formRecordTypeCode,
  uuid,
  type FormRecordExport,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { createConfigResolver } from "../methodology/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import {
  calculatedSettingsOf,
  numericVariables,
  resolveForm,
  type ResolvedForm,
  type ResolvedFormField,
} from "./provider.ts";
import { assertWorking, loadRecordType, requireTransformationRead } from "./record-types.ts";

export const FORM_EXPORT = "/api/v1/transformations/:transformationId/form-records/:recordType/export";
const params = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode });
const resolver = createConfigResolver();

type Lang = "en" | "ar";
type Status = "unknown" | "not_computable";

/** ADR-0041 §10 refusal of the export (exact English text). */
export const exportTooLarge = () =>
  problems.businessRule(
    "form_export.too_large",
    "This export has more than 5000 rows. Narrow the filter or use a report export.",
  );

/** Fixed CSV labels in both languages (the Arabic ones are provisional translations, as every slice B Arabic text). */
interface CsvLabels {
  readonly recordId: string;
  readonly version: string;
  readonly status: string;
  readonly unknown: string;
  readonly not_computable: string;
}
const CSV_LABELS: Readonly<Record<Lang, CsvLabels>> = {
  en: {
    recordId: "Record ID",
    version: "Version",
    status: "status",
    unknown: "Unknown",
    not_computable: "Not computable",
  },
  ar: {
    recordId: "معرّف السجل",
    version: "الإصدار",
    status: "الحالة",
    unknown: "غير معروف",
    not_computable: "غير قابل للحساب",
  },
};

/**
 * The illustrative label of an export generated in a demo database (F-DG5-124; D-178): exactly the reporting pipeline's
 * `export.illustrative` strings (packages/reporting/src/labels.ts FRAME_LABELS), en and ar.
 */
export const FORM_EXPORT_ILLUSTRATIVE_LABELS: Readonly<Record<Lang, string>> = {
  en: "Illustrative example — synthetic",
  ar: "مثال توضيحي — اصطناعي",
};

const DECIMAL = /^-?\d+(\.\d+)?$/;
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** RFC 4180 quoting of one field. */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV cell: decimals as they are; any other text neutralized when a spreadsheet would read it as a formula. */
export function csvCell(text: string | null, decimal: boolean): string {
  if (text === null || text === "") return "";
  if (decimal && DECIMAL.test(text)) return text;
  return csvField(FORMULA_TRIGGERS.has(text.charAt(0)) ? `'${text}` : text);
}

/** The export column of a field: the source columns in one typed column of the type's table, and extension fields. */
interface Column {
  readonly field: ResolvedFormField;
  readonly sourceColumn: string | null;
}

function columnsOf(form: ResolvedForm, rt: FormRecordTypeRow): Column[] {
  const out: Column[] = [];
  for (const f of form.fields) {
    if (f.removed) continue;
    if (f.origin === "source") {
      if (f.storageKind !== "column" || f.storageRef === null) continue;
      const [table, column] = f.storageRef.split(".");
      if (table !== rt.table_name || column === undefined) continue;
      out.push({ field: f, sourceColumn: column });
    } else {
      out.push({ field: f, sourceColumn: null });
    }
  }
  return out;
}

const labelOf = (f: ResolvedFormField, lang: Lang) => (lang === "ar" ? f.labelAr : f.labelEn);

/** The text of a stored extension value (decimals stay strings; choice values become labels in the language). */
function extensionText(f: ResolvedFormField, v: unknown, lang: Lang): string | null {
  if (v === null || v === undefined) return null;
  const options = new Map<string, string>();
  if (f.fieldType === "choice") {
    const raw = new Map(Object.entries(f.attributes)).get("options");
    if (Array.isArray(raw))
      for (const o of raw as { value?: unknown; labelEn?: unknown; labelAr?: unknown }[])
        if (typeof o.value === "string")
          options.set(o.value, String((lang === "ar" ? o.labelAr : o.labelEn) ?? o.labelEn ?? o.value));
  }
  const one = (x: unknown): string =>
    typeof x === "string" ? (options.get(x) ?? x) : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x);
  if (Array.isArray(v)) return v.length === 0 ? null : v.map(one).join("; ");
  if (f.fieldType === "currency" && typeof v === "object") {
    const c = new Map(Object.entries(v as Record<string, unknown>));
    const amount = c.get("amount");
    return typeof amount === "string" ? `${String(c.get("currencyCode") ?? "")} ${amount}`.trim() : null;
  }
  return one(v);
}

/** The caller's language (app_user.preferred_locale), English when unknown. */
async function callerLanguage(db: Db, request: FastifyRequest): Promise<Lang> {
  const userId = principalOf(request).userId;
  if (userId === null || userId === undefined) return "en";
  const u = await db.selectFrom("app_user").select("preferred_locale").where("id", "=", userId).executeTakeFirst();
  return u?.preferred_locale.startsWith("ar") === true ? "ar" : "en";
}

/** The format from the query and the Accept header (ExportFormatQuery: they must agree when both are sent). */
function formatOf(request: FastifyRequest, format: "csv" | "json" | undefined): "csv" | "json" {
  const accept = String(request.headers.accept ?? "").toLowerCase();
  const types = accept
    .split(",")
    .map((t) => t.split(";")[0]!.trim())
    .filter((t) => t !== "");
  const any = types.length === 0 || types.some((t) => t === "*/*");
  const acceptsJson = any || types.some((t) => t === "application/json" || t === "application/*");
  const acceptsCsv = any || types.some((t) => t === "text/csv" || t === "text/*");
  if (format === undefined) return acceptsJson && !acceptsCsv ? "json" : "csv";
  if ((format === "json" && !acceptsJson) || (format === "csv" && !acceptsCsv))
    throw problems.badRequest("validation.format", "The format does not match the Accept header.", "/query/format");
  return format;
}

/** Builds the export body (also the source of the CSV). */
export async function buildFormExport(
  db: Db,
  transformationId: string,
  rt: FormRecordTypeRow & { table_name: string },
  lang: Lang,
): Promise<FormRecordExport> {
  const t = await db
    .selectFrom("transformation")
    .select("currency")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const pinned = await resolver.pinnedVersion(db, transformationId, "form_schema");
  const form = await resolveForm(db, pinned.versionId, rt);
  const columns = columnsOf(form, rt);
  // Procedure definitions are platform configuration (no transformation column): a transformation has no rows of them.
  const scoped = rt.table_name !== "procedure_definition";
  const kind =
    rt.discriminator_column !== null && rt.discriminator_value !== null
      ? sql` AND ${sql.ref(rt.discriminator_column)} = ${rt.discriminator_value}`
      : sql``;
  if (scoped) {
    const n = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(rt.table_name)}
       WHERE transformation_id = ${transformationId}::uuid${kind}`.execute(db);
    if (Number(n.rows[0]?.n ?? "0") > FORM_EXPORT_MAX_ROWS) throw exportTooLarge();
  }
  // Table and column names come from the read-only registry (0068 seed), never from input; each value is read as the
  // jsonb text of its column, so numerics keep their exact digits and dates stay YYYY-MM-DD.
  const sourceCols = columns.filter((c) => c.sourceColumn !== null).map((c) => c.sourceColumn!);
  const rows = scoped
    ? (
        await sql<{ id: string; v: string | null; cols: (string | null)[] }>`SELECT r.id::text AS id,
           to_jsonb(r.*) ->> 'version' AS v,
           ARRAY(SELECT to_jsonb(r.*) ->> c FROM unnest(${sourceCols}::text[]) WITH ORDINALITY AS u(c, i) ORDER BY i) AS cols
         FROM ${sql.table(rt.table_name)} r
         WHERE r.transformation_id = ${transformationId}::uuid${kind}
         ORDER BY r.id`.execute(db)
      ).rows
    : [];
  const stored = new Map<string, Record<string, unknown>>();
  if (rows.length > 0) {
    const values = await db
      .selectFrom("form_custom_value")
      .select(["record_id", "field_values"])
      .where("transformation_id", "=", transformationId)
      .where("record_type", "=", rt.code)
      .execute();
    for (const v of values) stored.set(v.record_id, (v.field_values ?? {}) as Record<string, unknown>);
  }
  // ADR-0050 §2 (d): the environment at generation time (the deployment marker; no marker reads as production).
  const synthetic = (await readDeploymentEnvironment(db)).synthetic;
  const vars = numericVariables(form, t.currency);
  const out: FormRecordExport["rows"] = [];
  for (const r of rows) {
    const custom = new Map(Object.entries(stored.get(r.id) ?? {}));
    const source = new Map(sourceCols.map((c, i) => [c, r.cols.at(i) ?? null]));
    const inputMap = new Map<string, unknown>(custom);
    for (const c of columns) if (c.sourceColumn !== null) inputMap.set(c.field.key, source.get(c.sourceColumn) ?? null);
    const inputs = Object.fromEntries(inputMap);
    const values = new Map<string, string | null>();
    const statuses = new Map<string, Status>();
    for (const c of columns) {
      const f = c.field;
      let text: string | null;
      if (c.sourceColumn !== null) text = source.get(c.sourceColumn) ?? null;
      else if (f.fieldType === "calculated") {
        const cs = calculatedSettingsOf(f);
        const e = cs === null ? null : toCalculatedEntry(evaluateCalculatedField(cs, vars, inputs));
        text = e !== null && e.status === "computed" ? e.value : null;
        if (text === null) statuses.set(f.key, "not_computable");
      } else text = extensionText(f, custom.get(f.key), lang);
      if (text === "") text = null;
      values.set(f.key, text);
      if (text === null && !statuses.has(f.key)) statuses.set(f.key, "unknown");
    }
    out.push({
      recordId: r.id,
      version: r.v === null ? 1 : Number(r.v),
      values: Object.fromEntries(values),
      statuses: Object.fromEntries(statuses),
    });
  }
  return {
    recordType: rt.code,
    formSchemaVersionId: pinned.versionId,
    language: lang,
    illustrativeLabel: !synthetic
      ? null
      : lang === "ar"
        ? FORM_EXPORT_ILLUSTRATIVE_LABELS.ar
        : FORM_EXPORT_ILLUSTRATIVE_LABELS.en,
    columns: columns.map((c) => ({
      key: c.field.key,
      label: labelOf(c.field, lang),
      fieldType: c.field.fieldType,
      extension: c.field.origin === "admin",
    })),
    rows: out,
  };
}

const DECIMAL_TYPES = new Set(["number", "percentage", "calculated"]);

/**
 * The CSV text of an export: BOM, the illustrative label row on a demo database (F-DG5-124), a header row, then one row
 * per record; a status column after each value.
 */
export function exportCsv(e: FormRecordExport): string {
  const L = e.language === "ar" ? CSV_LABELS.ar : CSV_LABELS.en;
  const statusText = (s: Status) => (s === "unknown" ? L.unknown : L.not_computable);
  const header = [L.recordId, L.version];
  for (const c of e.columns) header.push(c.label, `${c.label} (${L.status})`);
  const lines = e.illustrativeLabel === null ? [] : [csvCell(e.illustrativeLabel, false)];
  lines.push(header.map((h) => csvCell(h, false)).join(","));
  for (const r of e.rows) {
    const values = new Map(Object.entries(r.values));
    const statuses = new Map(Object.entries(r.statuses));
    const cells = [r.recordId, String(r.version)];
    for (const c of e.columns) {
      const s = statuses.get(c.key);
      cells.push(
        csvCell(values.get(c.key) ?? null, DECIMAL_TYPES.has(c.fieldType)),
        s === undefined ? "" : statusText(s),
      );
    }
    lines.push(cells.join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

async function sendExport(db: Db, request: FastifyRequest, reply: FastifyReply) {
  const p = parse(params, request.params, "params");
  const query = parseQuery(formRecordExportQuery, request.query);
  await requireTransformationRead(db, request, p.transformationId);
  const rt = await loadRecordType(db, p.recordType);
  assertWorking(rt);
  const format = formatOf(request, query.format);
  const lang = query.lang ?? (await callerLanguage(db, request));
  const body = await buildFormExport(db, p.transformationId, rt, lang);
  if (format === "json") return reply.code(200).send(body);
  return reply
    .code(200)
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${rt.code}-${lang}.csv"`)
    .send(exportCsv(body));
}

export function registerFormExportRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  app.get(FORM_EXPORT, { config: read }, async (request, reply) => sendExport(db, request, reply));
  return [`GET ${FORM_EXPORT}`];
}
