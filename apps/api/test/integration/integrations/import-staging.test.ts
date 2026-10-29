// The import staging engine against the run's disposable PostgreSQL (ADR-0056 §2-§5; REQ-S17-002, REQ-S17-003;
// p6-work-split §B/A.3; T-DG6-BE-M). BE-M has no route (BE-M2 routes createImport), so the engine is driven here
// directly, with a test target defined in this file only:
//  1. a CSV with 8 valid rows, 1 invalid row and 1 duplicate of row 2 stages in ONE transaction: the batch is staged
//     (version 2) with counts 10 = 8 + 1 + 1, the rows keep their cells as text and their reasons, the duplicate
//     points at row 2, two audit events (created, staged) and two history rows; counts are NULL while staging;
//  2. a row whose key the target already holds is duplicate_committed with the target's params;
//  3. an XLSX formula cell is a row reason, never its cached value; a numeric cell is its stored text;
//  4. refusals write nothing: an unknown template, a header mismatch, a caller re-check that fails inside the
//     transaction, a form schema pin that changed after validation (409);
//  5. the stored raw cells are JSON strings or null (never numbers); the reasons satisfy the 0105 CHECK.
// Every value is SYNTHETIC. Staging commits nothing and approves nothing; nothing here touches DG0-DG7.
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { sql } from "@mth/db";
import { canonicalDecimal, DECIMAL_PATTERN } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseImportFile,
  prepareImport,
  stageImport,
  uploadSource,
  type StageImportOptions,
} from "../../../src/modules/integrations/imports/staging.ts";
import {
  createImportTargetRegistry,
  XLSX_MEDIA_TYPE,
  type ImportTarget,
  type ImportTargetRegistry,
} from "../../../src/modules/integrations/imports/targets.ts";
import { tableFromJsonItems } from "../../../src/modules/integrations/imports/validate.ts";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import {
  auditOf,
  createBu,
  createTransformationRow,
  seedWorld,
  startApi,
  uniq,
  type TestApi,
  type World,
} from "../../support/harness.ts";

const TEMPLATE = "kpi_actual.v99";
let api: TestApi;
let w: World;
let transformation: string;
let registry: ImportTargetRegistry;
/** Keys the test target "already holds" (its own uniqueness), with the duplicate_committed params. */
const committedKeys = new Map<string, Record<string, string>>();
/** What the target saw of the batch while staging (counts must be Unknown). */
const seenWhileStaging: Array<Record<string, unknown>> = [];

/** The test target (this file only): kpi_id and period_label required; value a decimal string; key kpi + period. */
const testTarget: ImportTarget = {
  kind: "kpi_actual",
  templateVersion: TEMPLATE,
  titleEn: "Synthetic test target",
  titleAr: "هدف اختبار اصطناعي",
  columns: [
    {
      key: "source_record_id",
      labelEn: "Source record id",
      labelAr: "معرف السجل المصدر",
      required: false,
      kind: "text",
      example: "row-1",
    },
    { key: "kpi_id", labelEn: "KPI id", labelAr: "معرف المؤشر", required: true, kind: "text", example: "KPI-1" },
    { key: "period_label", labelEn: "Period", labelAr: "الفترة", required: true, kind: "text", example: "2026-Q1" },
    { key: "value", labelEn: "Value", labelAr: "القيمة", required: true, kind: "decimal", example: "12.5" },
    { key: "comment", labelEn: "Comment", labelAr: "تعليق", required: false, kind: "text", example: null },
  ],
  async validateRow(ctx, row) {
    // A read-only query, as a real target makes (ADR-0056 §1 "pure + read-only queries").
    await ctx.db
      .selectFrom("transformation")
      .select("id")
      .where("id", "=", ctx.transformationId)
      .executeTakeFirstOrThrow();
    const c = row.cells;
    const reasons = [];
    for (const field of ["kpi_id", "period_label", "value"])
      if (c[field] === null || c[field] === undefined)
        reasons.push({ code: "import.row.required_missing", field, params: { field } });
    const value = c["value"];
    if (value !== null && value !== undefined && !DECIMAL_PATTERN.test(value))
      reasons.push({ code: "import.row.value_not_decimal", field: "value", params: { field: "value", value } });
    const key = c["kpi_id"] && c["period_label"] ? `kpi_actual:${c["kpi_id"]}:${c["period_label"]}` : null;
    if (reasons.length > 0 || key === null || value === null || value === undefined)
      return { valid: false, reasons, duplicateKey: key };
    return {
      valid: true,
      normalized: { kpi_id: c["kpi_id"]!, period_label: c["period_label"]!, value: canonicalDecimal(value) },
      duplicateKey: key,
    };
  },
  async existingKeys(ctx, keys) {
    const batch = await ctx.db
      .selectFrom("import_batch")
      .select(["status", "rows_total", "rows_valid", "rows_invalid", "rows_duplicate", "version"])
      .where("transformation_id", "=", ctx.transformationId)
      .where("status", "=", "staging")
      .execute();
    seenWhileStaging.push(...batch);
    return new Map(keys.filter((k) => committedKeys.has(k)).map((k) => [k, committedKeys.get(k)!]));
  },
  commitRow: () => Promise.reject(new Error("BE-M2 commits; staging never calls commitRow")),
  requiredPermissions: ["kpi_actual.submit"],
};

const enc = (s: string) => new TextEncoder().encode(s);

/** The A17 shape (ADR-0056 §6): 10 data rows, 8 valid, row 7 `12,5` not decimal, row 11 a duplicate of row 2. */
function a17Csv(prefix: string): string {
  const lines = ["source_record_id,kpi_id,period_label,value,comment"];
  for (let n = 2; n <= 11; n += 1) {
    if (n === 7) lines.push(`src-${n},${prefix}-K${n},2026-Q1,"12,5",comma decimal`);
    else if (n === 11) lines.push(`src-${n},${prefix}-K2,2026-Q1,99,same KPI and period as row 2`);
    else lines.push(`src-${n},${prefix}-K${n},2026-Q1,${n}.50,=formula-like text stays text`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function options(over: Partial<StageImportOptions> = {}, bytes = enc("x"), name = "actuals.csv"): StageImportOptions {
  return {
    source: uploadSource(name, "text/csv", bytes),
    createdBy: w.office.id,
    audit: { actorUserId: w.office.id, actorType: "user", requestId: uniq("req-be-m-") },
    ...over,
  };
}

async function stageCsv(text: string, over: Partial<StageImportOptions> = {}) {
  const bytes = enc(text);
  const sheet = parseImportFile(bytes, "text/csv");
  const prepared = await prepareImport(
    api.db,
    { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: w.office.id, sheet },
    registry,
  );
  return stageImport(api.db, prepared, options(over, bytes));
}

async function rowsOf(batchId: string) {
  return api.db
    .selectFrom("import_row")
    .selectAll()
    .where("import_batch_id", "=", batchId)
    .orderBy("row_number")
    .execute();
}

async function batchesWithHash(sha: string) {
  return api.db.selectFrom("import_batch").select("id").where("content_sha256", "=", sha).execute();
}

function problemOf(err: unknown): { status: number; code: string } {
  if (err instanceof HttpProblem) return { status: err.status, code: err.code };
  throw err;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const bu = await createBu(api.db, w.orgA.id);
  transformation = await createTransformationRow(api.db, w.orgA.id, bu, w.grantor.id);
  registry = createImportTargetRegistry();
  registry.register(testTarget);
});

afterAll(async () => {
  await api?.close();
});

describe("stageImport: the A17 shape (8 valid, 1 invalid, 1 duplicate)", () => {
  it("stages in one transaction: counts 10 = 8 + 1 + 1, version 2, rows with reasons, two audit events", async () => {
    seenWhileStaging.length = 0;
    const text = a17Csv(uniq("a17"));
    const batch = await stageCsv(text);
    expect(batch).toMatchObject({
      status: "staged",
      version: 2,
      transformation_id: transformation,
      organization_id: w.orgA.id,
      target_kind: "kpi_actual",
      template_version: TEMPLATE,
      source_kind: "csv_upload",
      file_name: "actuals.csv",
      media_type: "text/csv",
      byte_size: enc(text).byteLength,
      content_sha256: createHash("sha256").update(text).digest("hex"),
      rows_total: 10,
      rows_valid: 8,
      rows_invalid: 1,
      rows_duplicate: 1,
      rows_committed: null,
      commit_mode: "manual",
      created_by: w.office.id,
    });
    // The pinned form schema version of the transformation (ADR-0039 §3).
    const pinned = await sql<{ v: string }>`SELECT p5_form_schema_version_for(${transformation}::uuid) AS v`.execute(
      api.db,
    );
    expect(batch.form_schema_version_id).toBe(pinned.rows[0]!.v);

    // Counts were NULL (Unknown) while the batch was staging.
    expect(seenWhileStaging).toEqual([
      { status: "staging", rows_total: null, rows_valid: null, rows_invalid: null, rows_duplicate: null, version: 1 },
    ]);

    const rows = await rowsOf(batch.id);
    expect(rows.map((r) => [r.row_number, r.validation_status])).toEqual([
      [2, "valid"],
      [3, "valid"],
      [4, "valid"],
      [5, "valid"],
      [6, "valid"],
      [7, "invalid"],
      [8, "valid"],
      [9, "valid"],
      [10, "valid"],
      [11, "duplicate_in_batch"],
    ]);
    const invalid = rows.find((r) => r.row_number === 7)!;
    expect(invalid.reasons).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "12,5" } },
    ]);
    expect(invalid.normalized).toBeNull();
    const dup = rows.find((r) => r.row_number === 11)!;
    expect(dup.duplicate_of_row_id).toBe(rows.find((r) => r.row_number === 2)!.id);
    expect(dup.reasons).toEqual([{ code: "import.row.duplicate_in_batch", field: null, params: { firstRow: 2 } }]);
    const first = rows.find((r) => r.row_number === 2)!;
    expect(first.source_record_id).toBe("src-2");
    expect(first.raw).toMatchObject({ value: "2.50", comment: "=formula-like text stays text" });
    expect(first.normalized).toMatchObject({ value: "2.5" });
    expect(first.reasons).toEqual([]);
    for (const r of rows) expect(r.commit_status).toBe("pending");

    const events = await auditOf(api.db, batch.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version, e.actor_user_id])).toEqual([
      ["import_batch.created", null, 1, w.office.id],
      ["import_batch.staged", 1, 2, w.office.id],
    ]);
    expect(new Set(events.map((e) => e.request_id)).size).toBe(1);
    const history = await api.db
      .selectFrom("import_batch_event")
      .select(["record_version", "status", "rows_total"])
      .where("import_batch_id", "=", batch.id)
      .orderBy("record_version")
      .execute();
    expect(history).toEqual([
      { record_version: 1, status: "staging", rows_total: null },
      { record_version: 2, status: "staged", rows_total: 10 },
    ]);
  });

  it("stores every raw cell as a JSON string or null, never a number", async () => {
    const batch = await stageCsv(a17Csv(uniq("types")));
    const types = await sql<{ t: string }>`
      SELECT DISTINCT jsonb_typeof(e.value) AS t FROM import_row r, jsonb_each(r.raw) e WHERE r.import_batch_id = ${batch.id}::uuid
    `.execute(api.db);
    expect(types.rows.map((r) => r.t)).toContain("string");
    expect(types.rows.every((r) => r.t === "string" || r.t === "null")).toBe(true);
  });
});

describe("stageImport: duplicates against committed data (ADR-0056 §5)", () => {
  it("marks a row whose key the target already holds duplicate_committed, with the target's params", async () => {
    const p = uniq("dc");
    committedKeys.set(`kpi_actual:${p}-K3:2026-Q1`, { status: "accepted" });
    const batch = await stageCsv(a17Csv(p));
    expect(batch).toMatchObject({ rows_total: 10, rows_valid: 7, rows_invalid: 1, rows_duplicate: 2 });
    const row3 = (await rowsOf(batch.id)).find((r) => r.row_number === 3)!;
    expect(row3).toMatchObject({
      validation_status: "duplicate_committed",
      normalized: null,
      duplicate_of_row_id: null,
    });
    expect(row3.reasons).toEqual([
      { code: "import.row.duplicate_committed", field: null, params: { status: "accepted" } },
    ]);
  });
});

describe("stageImport: XLSX cells (ADR-0056 §3)", () => {
  it("stages a formula cell as import.row.formula_cell (never its cached value) and a numeric cell as its text", async () => {
    const p = uniq("x");
    const bytes = tinyXlsx([
      ["source_record_id", "kpi_id", "period_label", "value"],
      ["x-2", `${p}-K1`, "2026-Q1", { n: "12.5" }],
      ["x-3", `${p}-K2`, "2026-Q1", { f: "10/4", v: "2.5" }],
    ]);
    const sheet = parseImportFile(bytes, XLSX_MEDIA_TYPE);
    const prepared = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: w.office.id, sheet },
      registry,
    );
    const batch = await stageImport(api.db, prepared, {
      ...options({}, bytes, "actuals.xlsx"),
      source: uploadSource("actuals.xlsx", XLSX_MEDIA_TYPE, bytes),
    });
    expect(batch).toMatchObject({
      source_kind: "xlsx_upload",
      media_type: XLSX_MEDIA_TYPE,
      rows_valid: 1,
      rows_invalid: 1,
    });
    const rows = await rowsOf(batch.id);
    expect(rows[0]).toMatchObject({
      validation_status: "valid",
      raw: { value: "12.5" },
      normalized: { value: "12.5" },
    });
    expect(rows[1]!.validation_status).toBe("invalid");
    expect(rows[1]!.raw).toMatchObject({ value: null });
    expect(rows[1]!.reasons).toEqual([{ code: "import.row.formula_cell", field: "value", params: { field: "value" } }]);
    expect(JSON.stringify(rows[1]!.raw)).not.toContain("2.5");
  });
});

describe("stageImport: rows already keyed by column (webhook items, connector rows)", () => {
  it("checks the keys against the template like a file header, and stages the rows", async () => {
    const p = uniq("tbl");
    const table = {
      header: ["source_record_id", "kpi_id", "period_label", "value"],
      rows: [
        {
          rowNumber: 2,
          cells: { source_record_id: "i-1", kpi_id: `${p}-K1`, period_label: "2026-Q2", value: "4" },
          formulaColumns: [],
        },
        {
          rowNumber: 3,
          cells: { source_record_id: "i-2", kpi_id: `${p}-K1`, period_label: "2026-Q2", value: "5" },
          formulaColumns: [],
        },
      ],
    };
    const prepared = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: null, table },
      registry,
    );
    const batch = await stageImport(api.db, prepared, options({}, enc(p)));
    expect(batch).toMatchObject({ rows_total: 2, rows_valid: 1, rows_duplicate: 1 });
    const unknownKey = {
      header: ["kpi_id", "period_label", "value"],
      rows: [
        { rowNumber: 2, cells: { kpi_id: "k", period_label: "p", value: "1", colour: "red" }, formulaColumns: [] },
      ],
    };
    const res = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: null, table: unknownKey },
      registry,
    ).catch(problemOf);
    expect(res).toEqual({ status: 422, code: "import.header_mismatch" });
  });
});

describe("stageImport: webhook items with a JSON number (ADR-0056 §7)", () => {
  it("stages the number as the row reason import.row.value_not_decimal, keeping its text for display", async () => {
    const p = uniq("json");
    const table = tableFromJsonItems([
      { source_record_id: "j-1", kpi_id: `${p}-K1`, period_label: "2026-Q3", value: "7.25" },
      { source_record_id: "j-2", kpi_id: `${p}-K2`, period_label: "2026-Q3", value: 7.25 },
    ]);
    const prepared = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: null, table },
      registry,
    );
    const batch = await stageImport(api.db, prepared, options({}, enc(p)));
    expect(batch).toMatchObject({ rows_total: 2, rows_valid: 1, rows_invalid: 1 });
    const rows = await rowsOf(batch.id);
    expect(rows[1]).toMatchObject({ validation_status: "invalid", raw: { value: "7.25" } });
    expect(rows[1]!.reasons).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "7.25" } },
    ]);
  });
});

describe("stageImport: refusals write nothing", () => {
  it("refuses an unknown template (422 import.template_unknown) and a header mismatch (422)", async () => {
    const sheet = parseImportFile(enc("source_record_id,kpi_id,period_label,value\n"), "text/csv");
    const unknown = await prepareImport(
      api.db,
      { templateVersion: "kpi_actual.v7", transformationId: transformation, actorUserId: null, sheet },
      registry,
    ).catch(problemOf);
    expect(unknown).toEqual({ status: 422, code: "import.template_unknown" });
    const bad = parseImportFile(enc("kpi_id,period_label,value,colour\n"), "text/csv");
    const mismatch = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: transformation, actorUserId: null, sheet: bad },
      registry,
    ).catch(problemOf);
    expect(mismatch).toEqual({ status: 422, code: "import.header_mismatch" });
  });

  it("refuses an unknown transformation with 404", async () => {
    const sheet = parseImportFile(enc("kpi_id,period_label,value\n"), "text/csv");
    const res = await prepareImport(
      api.db,
      { templateVersion: TEMPLATE, transformationId: "01900000-0000-7000-8000-00000000dead", actorUserId: null, sheet },
      registry,
    ).catch(problemOf);
    expect(res).toMatchObject({ status: 404 });
  });

  it("rolls everything back when the caller's commit-time re-check refuses inside the transaction", async () => {
    const text = a17Csv(uniq("recheck"));
    const sha = createHash("sha256").update(text).digest("hex");
    const res = await stageCsv(text, {
      recheck: async () => {
        throw new HttpProblem({
          status: 403,
          type: "urn:mth:problem:forbidden",
          code: "forbidden",
          title: "Forbidden",
        });
      },
    }).catch(problemOf);
    expect(res).toEqual({ status: 403, code: "forbidden" });
    expect(await batchesWithHash(sha)).toEqual([]);
  });

  it("refuses with 409 import.form_schema_changed when the pinned schema moved after validation", async () => {
    const text = a17Csv(uniq("pin"));
    const bytes = enc(text);
    const prepared = await prepareImport(
      api.db,
      {
        templateVersion: TEMPLATE,
        transformationId: transformation,
        actorUserId: w.office.id,
        sheet: parseImportFile(bytes, "text/csv"),
      },
      registry,
    );
    const moved = {
      ...prepared,
      context: { ...prepared.context, formSchemaVersionId: "01900000-0000-7000-8000-0000000000ff" },
    };
    const res = await stageImport(api.db, moved, options({}, bytes)).catch(problemOf);
    expect(res).toEqual({ status: 409, code: "import.form_schema_changed" });
    expect(await batchesWithHash(createHash("sha256").update(text).digest("hex"))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ a tiny XLSX writer

type Cell = string | { n: string } | { f: string; v: string };

function tinyXlsx(rows: readonly (readonly Cell[])[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheet = rows
    .map((cells, r) => {
      const cs = cells
        .map((c, i) => {
          const ref = `${String.fromCharCode(65 + i)}${r + 1}`;
          if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`;
          if ("f" in c) return `<c r="${ref}"><f>${esc(c.f)}</f><v>${c.v}</v></c>`;
          return `<c r="${ref}"><v>${c.n}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  const parts: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    ],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [n, text] of parts) {
    const raw = Buffer.from(text, "utf8");
    const body = deflateRawSync(raw);
    const name = Buffer.from(n, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw) >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw) >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}
