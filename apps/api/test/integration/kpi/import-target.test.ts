// The KPI actual import target `kpi_actual.v1` against the run's disposable PostgreSQL (ADR-0056 §4-§6, §9;
// REQ-S17-002, REQ-S17-003; p6-work-split §B/A.4; T-DG6-KBE-A):
//  1. the A17 8/1/1 fixture, as CSV and as XLSX: 10 data rows stage as 8 valid, 1 invalid (`12,5`:
//     import.row.value_not_decimal) and 1 duplicate of row 2 (import.row.duplicate_in_batch); the commit creates 8 KPI
//     actuals through the DG4 submission service (direct-accept KPI -> accepted, review KPI -> submitted and waiting for
//     its reviewer: never accepted by the import), 8 lineage rows, and the 2 others stay visible with their reasons;
//  2. every row reason of ADR-0056 §5 the KPI rules produce, with its params;
//  3. import.row.duplicate_committed against a form-entered actual (with the existing slot's status);
//  4. a KPI that requires evidence -> import.row.evidence_required; a non-updater -> import.row.not_kpi_updater;
//  5. validateRow and existingKeys are read-only (they run inside a READ ONLY transaction);
//  6. recalculation: exactly one kpi.actual_accepted per accepted imported value and none for a submitted one; the
//     worker turns each into exactly one calculation run (the DG4 unit; see the handback on "once per affected KPI");
//  7. a commit after the slot was filled elsewhere is refused by DG4 and writes nothing;
//  8. the "Imported from {source} row {n}" lineage read (kpi/actuals.ts importLineageOf).
//
// The commit loop below is a TEST DRIVER of ADR-0056 §6 step 3 (BE-M2 owns the real one, integrations/imports/commit.ts):
// one transaction, each valid row in row order through `commitRow`, its lineage row, the row `committed`, every other
// row `not_committed`, the batch `committed` with one audit event. All data is synthetic; nothing here grants a business
// approval or touches the engineering gates DG0-DG7.
import { crc32, deflateRawSync } from "node:zlib";
import { csvField } from "@mth/reporting";
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import {
  parseImportFile,
  prepareImport,
  stageImport,
  uploadSource,
  type ImportBatchRow,
} from "../../../src/modules/integrations/imports/staging.ts";
import {
  createImportTargetRegistry,
  importTargetRegistry,
  CSV_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  type ImportFileMediaType,
  type ImportTarget,
  type ImportTargetContext,
  type ImportTargetRegistry,
} from "../../../src/modules/integrations/imports/targets.ts";
import { importLineageOf } from "../../../src/modules/kpi/actuals.ts";
import {
  createKpiActualImportTarget,
  KPI_ACTUAL_IMPORT_COLUMNS,
  KPI_ACTUAL_TEMPLATE_VERSION,
} from "../../../src/modules/kpi/import-target.ts";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { createKpi } from "../kpi-p4/kbe-b-fixtures.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  outboxOf,
  ownedKpi,
  REVIEW_FLOW,
  runRecalculation,
  submitActual,
} from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let registry: ImportTargetRegistry;
let target: ImportTarget;
let direct: { id: string; versionId: string; name: string };
let review: { id: string; versionId: string; name: string };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  direct = await ownedKpi(api, k, DIRECT_FLOW);
  review = await ownedKpi(api, k, REVIEW_FLOW);
  // The target the composition root registers (server.ts), through the port's own type: the compiler checks the
  // structural implementation here as well.
  target = createKpiActualImportTarget();
  registry = createImportTargetRegistry();
  registry.register(target);
}, 120_000);
afterAll(() => api.close());

// ------------------------------------------------------------------------------------------------ file builders

const HEADER = KPI_ACTUAL_IMPORT_COLUMNS.map((c) => c.key);
type Row = Partial<Record<(typeof HEADER)[number], string>>;

/** CSV with the P5 CSV writer's RFC 4180 quoting (`csvField`, ADR-0046 §3); CRLF line ends, header on row 1. */
function csvOf(rows: readonly Row[]): Uint8Array {
  const lines = [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvField(r[h] ?? "")).join(","))];
  return new TextEncoder().encode(lines.join("\r\n") + "\r\n");
}

/**
 * A minimal first-sheet XLSX (OOXML parts zipped with node:zlib; no dependency). Decimal cells whose text is a plain
 * decimal are NUMERIC cells (`<v>12.5</v>`): the engine takes their stored text verbatim, never a binary double.
 * The P5 report writer (renderXlsx) writes a report frame with an "About" sheet first, not a header-on-row-1 table,
 * so it cannot write an import file; BE-M2's template builder is the product path (handback).
 */
function xlsxOf(rows: readonly Row[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const col = (i: number) => String.fromCharCode(65 + i);
  const numeric = new Set(["value", "numerator", "denominator"]);
  const cellXml = (key: string, text: string, ref: string) =>
    numeric.has(key) && /^-?[0-9]+(\.[0-9]+)?$/.test(text)
      ? `<c r="${ref}"><v>${text}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`;
  const all = [Object.fromEntries(HEADER.map((h) => [h, h])) as Row, ...rows];
  const sheet = all
    .map((r, ri) => {
      const cells = HEADER.map((h, ci) => (r[h] ? cellXml(ri === 0 ? "" : h, r[h], `${col(ci)}${ri + 1}`) : "")).join(
        "",
      );
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const parts: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="KPI actuals" sheetId="1" r:id="rId1"/></sheets></workbook>`,
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

// ------------------------------------------------------------------------------------------------ stage and commit

const row = (kpiId: string, periodLabel: string, extra: Row = {}): Row => ({
  kpi_id: kpiId,
  scope_kind: "transformation",
  scope_id: k.transformationId,
  period_label: periodLabel,
  data_as_of: "2041-01-31",
  ...extra,
});

async function stage(
  bytes: Uint8Array,
  mediaType: ImportFileMediaType,
  fileName: string,
  actorUserId: string = k.users.kds.id,
): Promise<ImportBatchRow> {
  const sheet = parseImportFile(bytes, mediaType);
  const prepared = await prepareImport(
    api.db,
    { templateVersion: KPI_ACTUAL_TEMPLATE_VERSION, transformationId: k.transformationId, actorUserId, sheet },
    registry,
  );
  return stageImport(api.db, prepared, {
    source: uploadSource(fileName, mediaType, bytes),
    createdBy: actorUserId,
    audit: { actorUserId, actorType: "user", requestId: `test-stage-${fileName}` },
  });
}

const rowsOf = (batchId: string) =>
  api.db.selectFrom("import_row").selectAll().where("import_batch_id", "=", batchId).orderBy("row_number").execute();

/** TEST DRIVER of ADR-0056 §6 step 3 (BE-M2 owns the real commit). Returns the target results by row number. */
async function commit(batch: ImportBatchRow, committer: string = k.users.kds.id) {
  const requestId = `test-commit-${batch.id}`;
  return api.db.transaction().execute(async (tx) => {
    const rows = await tx
      .selectFrom("import_row")
      .selectAll()
      .where("import_batch_id", "=", batch.id)
      .orderBy("row_number")
      .execute();
    const ctx: ImportTargetContext = {
      db: tx,
      organizationId: batch.organization_id,
      transformationId: batch.transformation_id,
      formSchemaVersionId: batch.form_schema_version_id,
      templateVersion: batch.template_version,
      actorUserId: committer,
    };
    const results = new Map<number, { recordId: string; valueNo: number }>();
    for (const r of rows) {
      if (r.validation_status !== "valid") continue;
      const res = await target.commitRow(tx, ctx, {
        importRowId: r.id,
        rowNumber: r.row_number,
        sourceRecordId: r.source_record_id,
        normalized: r.normalized as Record<string, string | null>,
      });
      await tx
        .insertInto("import_row_commit")
        .values({
          id: crypto.randomUUID(),
          organization_id: batch.organization_id,
          transformation_id: batch.transformation_id,
          import_batch_id: batch.id,
          import_row_id: r.id,
          target_record_type: res.recordType,
          target_record_id: res.recordId,
          target_value_no: res.valueNo,
          committed_at: sql<Date>`now()`,
        })
        .execute();
      await tx.updateTable("import_row").set({ commit_status: "committed" }).where("id", "=", r.id).execute();
      results.set(r.row_number, res);
    }
    await tx
      .updateTable("import_row")
      .set({ commit_status: "not_committed" })
      .where("import_batch_id", "=", batch.id)
      .where("commit_status", "=", "pending")
      .execute();
    await tx
      .updateTable("import_batch")
      .set({
        status: "committed",
        rows_committed: results.size,
        committed_at: sql<Date>`now()`,
        committed_by: committer,
        version: batch.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: committer,
      })
      .where("id", "=", batch.id)
      .execute();
    await record(
      tx,
      { actorUserId: committer, actorType: "user", requestId },
      {
        action: "import_batch.committed",
        recordType: "import_batch",
        recordId: batch.id,
        organizationId: batch.organization_id,
        transformationId: batch.transformation_id,
        priorVersion: batch.version,
        newVersion: batch.version + 1,
        changes: { status: { from: "staged", to: "committed" }, rows_committed: { from: null, to: results.size } },
      },
    );
    return results;
  });
}

/** A fixture row as engine cells (every cell text or null). */
const cellsOf = (r: Row): Record<string, string | null> =>
  Object.fromEntries(Object.entries(r).map(([key, v]) => [key, v ?? null]));

const reasonsOf = (r: { reasons: unknown }) =>
  r.reasons as Array<{ code: string; field: string | null; params: object }>;

// ------------------------------------------------------------------------------------------------ the 8/1/1 fixture

/**
 * The A17 fixture (ADR-0056 §6): rows 2-9 are 8 valid slots (the direct-accept KPI and the review KPI, each in four
 * open periods), row 10 is `12,5` (invalid), row 11 repeats row 2's slot (duplicate of row 2).
 */
function fixture(periods: readonly string[]): Row[] {
  const [p1, p2, p3, p4] = periods as [string, string, string, string];
  return [
    row(direct.id, p1, { source_record_id: "SRC-01", value: "120.5", comment: "Synthetic, first row" }),
    row(direct.id, p2, { source_record_id: "SRC-02", value: "121" }),
    row(direct.id, p3, { source_record_id: "SRC-03", value: "0.000001" }),
    row(direct.id, p4, { source_record_id: "SRC-04", value: "-3.25" }),
    row(review.id, p1, { source_record_id: "SRC-05", value: "1000" }),
    row(review.id, p2, { source_record_id: "SRC-06", value: "1000.000000" }),
    row(review.id, p3, { source_record_id: "SRC-07", missing_reason: "Synthetic: the source system was down" }),
    row(review.id, p4, { source_record_id: "SRC-08", value: "999999999999999999.999999" }),
    row(direct.id, p1, { source_record_id: "SRC-09", value: "12,5" }),
    row(direct.id, p1, { source_record_id: "SRC-10", value: "7" }),
  ];
}

async function fourPeriods(): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) out.push((await monthlyPeriod(api, w)).label);
  return out;
}

for (const format of ["csv", "xlsx"] as const) {
  describe(`the A17 8/1/1 fixture as ${format.toUpperCase()} (REQ-S17-002, REQ-S17-003)`, () => {
    it("stages 10 = 8 + 1 + 1, commits 8 KPI actuals through DG4 with 8 lineage rows; the 2 others keep their reasons", async () => {
      const periods = await fourPeriods();
      const bytes = format === "csv" ? csvOf(fixture(periods)) : xlsxOf(fixture(periods));
      const fileName = `synthetic-actuals.${format}`;
      const batch = await stage(bytes, format === "csv" ? CSV_MEDIA_TYPE : XLSX_MEDIA_TYPE, fileName);
      expect([batch.status, batch.rows_total, batch.rows_valid, batch.rows_invalid, batch.rows_duplicate]).toEqual([
        "staged",
        10,
        8,
        1,
        1,
      ]);
      const staged = await rowsOf(batch.id);
      expect(staged.map((r) => [r.row_number, r.validation_status])).toEqual([
        [2, "valid"],
        [3, "valid"],
        [4, "valid"],
        [5, "valid"],
        [6, "valid"],
        [7, "valid"],
        [8, "valid"],
        [9, "valid"],
        [10, "invalid"],
        [11, "duplicate_in_batch"],
      ]);
      // Decimals stay strings: normalized with the shared helper, never a double (the 18+6-digit value survives).
      expect(staged.map((r) => (r.normalized as Record<string, string | null> | null)?.["value"] ?? null)).toEqual([
        "120.5",
        "121",
        "0.000001",
        "-3.25",
        "1000",
        "1000",
        null,
        "999999999999999999.999999",
        null,
        null,
      ]);
      expect(reasonsOf(staged[8]!)).toEqual([
        { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "12,5" } },
      ]);
      expect(reasonsOf(staged[9]!)).toEqual([
        expect.objectContaining({
          code: "import.row.duplicate_in_batch",
          params: expect.objectContaining({ firstRow: 2 }),
        }),
      ]);
      expect(staged[9]!.duplicate_of_row_id).toBe(staged[0]!.id);

      const results = await commit(batch);
      expect([...results.keys()]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      const after = await rowsOf(batch.id);
      expect(after.map((r) => r.commit_status)).toEqual([
        ...Array(8).fill("committed"),
        "not_committed",
        "not_committed",
      ]);
      // The 2 others stay visible with their reasons after the commit.
      expect(reasonsOf(after[8]!)[0]!.code).toBe("import.row.value_not_decimal");
      expect(reasonsOf(after[9]!)[0]!.code).toBe("import.row.duplicate_in_batch");

      // 8 KPI actuals, status per the DG4 route: never accepted by the import itself on the review route.
      const ids = [...results.values()].map((r) => r.recordId);
      const actuals = await api.db.selectFrom("kpi_actual").selectAll().where("id", "in", ids).execute();
      expect(actuals).toHaveLength(8);
      const byId = new Map(actuals.map((a) => [a.id, a]));
      for (const [rowNumber, res] of results) {
        const a = byId.get(res.recordId)!;
        const isDirect = rowNumber <= 5;
        expect([a.kpi_definition_id, a.status, a.route, a.submitted_by, res.valueNo], `row ${rowNumber}`).toEqual([
          isDirect ? direct.id : review.id,
          isDirect ? "accepted" : "submitted",
          isDirect ? "direct_accept" : "review",
          k.users.kds.id,
          1,
        ]);
      }
      const values = await api.db
        .selectFrom("kpi_actual_value")
        .select(["kpi_actual_id", sql<string | null>`value::text`.as("value"), "missing_reason", "entered_by"])
        .where("kpi_actual_id", "in", ids)
        .execute();
      const valueOf = (rowNumber: number) => values.find((v) => v.kpi_actual_id === results.get(rowNumber)!.recordId)!;
      expect(valueOf(2).value).toBe("120.500000");
      expect(valueOf(9).value).toBe("999999999999999999.999999");
      expect([valueOf(8).value, valueOf(8).missing_reason]).toEqual([null, "Synthetic: the source system was down"]);

      // The DG4 audit trail: one event per slot (accepted or submitted), by the committer.
      const audits = await api.db
        .selectFrom("audit_event")
        .select(["record_id", "action", "actor_user_id"])
        .where("record_type", "=", "kpi_actual")
        .where("record_id", "in", ids)
        .execute();
      expect(audits).toHaveLength(8);
      expect(audits.filter((e) => e.action === "kpi_actual.accepted")).toHaveLength(4);
      expect(audits.filter((e) => e.action === "kpi_actual.submit")).toHaveLength(4);
      expect(new Set(audits.map((e) => e.actor_user_id))).toEqual(new Set([k.users.kds.id]));

      // 8 lineage rows, and the "Imported from {source} row {n}" read.
      const lineage = await api.db
        .selectFrom("import_row_commit")
        .selectAll()
        .where("import_batch_id", "=", batch.id)
        .execute();
      expect(lineage).toHaveLength(8);
      const read = await importLineageOf(api.db, k.transformationId, ids);
      expect(read.size).toBe(8);
      for (const [rowNumber, res] of results)
        expect(read.get(`${res.recordId}:1`), `row ${rowNumber}`).toMatchObject({
          importBatchId: batch.id,
          sourceKind: format === "csv" ? "csv_upload" : "xlsx_upload",
          source: fileName,
          rowNumber,
          sourceRecordId: `SRC-${String(rowNumber - 1).padStart(2, "0")}`,
        });

      // Recalculation: exactly one kpi.actual_accepted per accepted value, none for a submitted one; each becomes one run.
      for (const [rowNumber, res] of results) {
        const events = (await outboxOf(api, res.recordId)).filter((e) => e.event_type === "kpi.actual_accepted");
        expect(
          events.map((e) => e.idempotency_key),
          `row ${rowNumber}`,
        ).toEqual(rowNumber <= 5 ? [`kpi.actual_accepted:${res.recordId}:1`] : []);
      }
      for (const rowNumber of [2, 3, 4, 5]) {
        const id = results.get(rowNumber)!.recordId;
        await runRecalculation(api, id);
        await runRecalculation(api, id); // a replay recalculates nothing more
        const runs = await api.db
          .selectFrom("calculation_run")
          .select("id")
          .where("trigger_record_id", "=", id)
          .execute();
        expect(runs, `row ${rowNumber}`).toHaveLength(1);
      }
    }, 120_000);
  });
}

// ------------------------------------------------------------------------------------------------ row reasons

describe("row reasons of the KPI rules (ADR-0056 §4, §5)", () => {
  it("gives each reason with its field and params, and stages every row (none is dropped)", async () => {
    const open = await monthlyPeriod(api, w);
    const scheduled = await monthlyPeriod(api, w, { scheduled: true });
    const draftKpi = await createKpi(api, k, { ownerUserId: k.users.kds.id } as never); // active, but no active version
    const ratio = await ownedKpi(api, k, {
      ...DIRECT_FLOW,
      valueNature: "ratio",
      aggregationRule: "weighted_ratio",
      numeratorLabel: "Synthetic numerator",
      denominatorLabel: "Synthetic denominator",
    });
    const unmapped = await ownedKpi(api, k, { ...REVIEW_FLOW, reviewerPartyCode: "SP" });
    const rows: Row[] = [
      /* 2 */ row(direct.id, open.label, { kpi_id: "", value: "1" }),
      /* 3 */ row("0190a000-0000-7000-8000-00000000dead", open.label, { value: "1" }),
      /* 4 */ row(draftKpi.id, open.label, { value: "1" }),
      /* 5 */ row(direct.id, open.label, { scope_kind: "initiative", value: "1" }),
      /* 6 */ row(direct.id, "2099-13", { value: "1" }),
      /* 7 */ row(direct.id, scheduled.label, { value: "1" }),
      /* 8 */ row(direct.id, open.label, { value: "1", numerator: "1" }),
      /* 9 */ row(direct.id, open.label, { value: "1", currency: "SAR" }),
      /* 10 */ row(direct.id, open.label, { value: "1", data_as_of: "2041-02-30" }),
      /* 11 */ row(direct.id, open.label, { value: "1,000.5" }),
      /* 12 */ row(direct.id, open.label, { value: "1.1234567" }),
      /* 13 */ row(direct.id, open.label, { missing_reason: "   " }),
      /* 14 */ row(ratio.id, open.label, { value: "0.5" }),
      /* 15 */ row(direct.id, open.label, { value: "1", milestone_achieved: "maybe" }),
      /* 16 */ row(unmapped.id, open.label, { value: "1" }),
      /* 17 */ row(direct.id, open.label, { value: "=1+1" }),
    ];
    const batch = await stage(csvOf(rows), CSV_MEDIA_TYPE, "synthetic-reasons.csv");
    expect([batch.rows_total, batch.rows_valid, batch.rows_invalid]).toEqual([16, 0, 16]);
    const staged = await rowsOf(batch.id);
    const codes = (n: number) => reasonsOf(staged.find((r) => r.row_number === n)!);
    expect(codes(2)).toEqual([{ code: "import.row.required_missing", field: "kpi_id", params: { field: "kpi_id" } }]);
    expect(codes(3)).toEqual([
      {
        code: "import.row.kpi_unknown",
        field: "kpi_id",
        params: { field: "kpi_id", value: "0190a000-0000-7000-8000-00000000dead" },
      },
    ]);
    expect(codes(4)).toEqual([
      { code: "import.row.kpi_no_active_version", field: "kpi_id", params: { field: "kpi_id", value: draftKpi.id } },
    ]);
    expect(codes(5)).toEqual([
      {
        code: "import.row.scope_invalid",
        field: "scope_id",
        params: { field: "scope_id", value: `initiative ${k.transformationId}` },
      },
    ]);
    expect(codes(6)).toEqual([
      { code: "import.row.period_unknown", field: "period_label", params: { field: "period_label", value: "2099-13" } },
    ]);
    expect(codes(7)).toEqual([
      {
        code: "import.row.period_not_open",
        field: "period_label",
        params: { field: "period_label", value: scheduled.label },
      },
    ]);
    expect(codes(8)).toEqual([{ code: "import.row.value_shape", field: null, params: { expected: "a value" } }]);
    expect(codes(9)).toEqual([
      {
        code: "import.row.currency_mismatch",
        field: "currency",
        params: { field: "currency", value: "SAR", expected: "-" },
      },
    ]);
    expect(codes(10)).toEqual([
      { code: "import.row.date_invalid", field: "data_as_of", params: { field: "data_as_of", value: "2041-02-30" } },
    ]);
    expect(codes(11)).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "1,000.5" } },
    ]);
    expect(codes(12)).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "1.1234567" } },
    ]);
    expect(codes(13).map((r) => r.code)).toContain("import.row.text_length");
    expect(codes(14)).toEqual([
      { code: "import.row.value_shape", field: null, params: { expected: "a numerator and a denominator" } },
    ]);
    expect(codes(15)).toEqual([
      {
        code: "import.row.value_shape",
        field: "milestone_achieved",
        params: { field: "milestone_achieved", expected: "a value", value: "maybe" },
      },
    ]);
    expect(codes(16)).toEqual([
      { code: "import.row.reviewer_unavailable", field: "kpi_id", params: { field: "kpi_id", value: unmapped.id } },
    ]);
    // Formula-like CSV text is imported as text (D-195 Q11) and is then simply not a decimal for a value column.
    expect(codes(17)).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "=1+1" } },
    ]);
  }, 120_000);

  it("a KPI that requires evidence with each actual gives import.row.evidence_required (enter it by form)", async () => {
    const p = await monthlyPeriod(api, w);
    const evidenceKpi = await ownedKpi(api, k, {
      ...DIRECT_FLOW,
      dataQuality: { evidenceRequired: true, staleAfterDays: 45, validMin: null, validMax: null },
    });
    const batch = await stage(csvOf([row(evidenceKpi.id, p.label, { value: "5" })]), CSV_MEDIA_TYPE, "ev.csv");
    expect(reasonsOf((await rowsOf(batch.id))[0]!)).toEqual([
      { code: "import.row.evidence_required", field: null, params: {} },
    ]);
  }, 60_000);

  it("a user who is not an owner, steward or update assignee gives import.row.not_kpi_updater", async () => {
    const p = await monthlyPeriod(api, w);
    const prepared = await prepareImport(
      api.db,
      {
        templateVersion: KPI_ACTUAL_TEMPLATE_VERSION,
        transformationId: k.transformationId,
        actorUserId: k.users.tl.id,
        sheet: parseImportFile(csvOf([row(direct.id, p.label, { value: "5" })]), CSV_MEDIA_TYPE),
      },
      registry,
    );
    expect(prepared.rows[0]!.verdict).toEqual({
      valid: false,
      reasons: [{ code: "import.row.not_kpi_updater", field: "kpi_id", params: { field: "kpi_id", value: direct.id } }],
      duplicateKey: expect.stringMatching(/^kpi_actual:/),
    });
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ duplicates

describe("duplicate_committed against a form-entered actual (ADR-0056 §5)", () => {
  it("a row whose DG4 slot already exists is isolated with the existing actual's status", async () => {
    const p = await monthlyPeriod(api, w);
    const form = await submitActual(api, k, review.id, { reportingPeriodId: p.id, value: "10" });
    expect(form.status, JSON.stringify(form.body)).toBe(201);
    const batch = await stage(
      csvOf([row(review.id, p.label, { value: "11" }), row(direct.id, p.label, { value: "12" })]),
      CSV_MEDIA_TYPE,
      "dup.csv",
    );
    expect([batch.rows_valid, batch.rows_duplicate]).toEqual([1, 1]);
    const [first] = await rowsOf(batch.id);
    expect([first!.validation_status, reasonsOf(first!)]).toEqual([
      "duplicate_committed",
      [expect.objectContaining({ code: "import.row.duplicate_committed", params: { status: "submitted" } })],
    ]);
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ read-only, refusals

describe("validateRow and existingKeys are read-only; commitRow goes through DG4", () => {
  it("both run inside a READ ONLY transaction", async () => {
    const p = await monthlyPeriod(api, w);
    await api.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION READ ONLY`.execute(tx);
      const ctx: ImportTargetContext = {
        db: tx,
        organizationId: w.orgA.id,
        transformationId: k.transformationId,
        formSchemaVersionId: "unused",
        templateVersion: KPI_ACTUAL_TEMPLATE_VERSION,
        actorUserId: k.users.kds.id,
      };
      const verdict = await target.validateRow(ctx, {
        rowNumber: 2,
        cells: cellsOf(row(direct.id, p.label, { value: "1" })),
      });
      expect(verdict.valid).toBe(true);
      if (!verdict.valid) return;
      const existing = await target.existingKeys(ctx, [verdict.duplicateKey, "not-a-key"]);
      expect(existing.size).toBe(0);
    });
  }, 60_000);

  it("a slot filled between staging and commit: DG4 refuses (409) and the whole commit writes nothing", async () => {
    const p = await monthlyPeriod(api, w);
    const batch = await stage(csvOf([row(direct.id, p.label, { value: "3" })]), CSV_MEDIA_TYPE, "race.csv");
    expect(batch.rows_valid).toBe(1);
    const form = await submitActual(api, k, direct.id, { reportingPeriodId: p.id, value: "4" });
    expect(form.status).toBe(201);
    const err = await commit(batch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpProblem);
    expect((err as HttpProblem).status).toBe(409);
    const [r] = await rowsOf(batch.id);
    expect(r!.commit_status).toBe("pending");
    expect(
      await api.db.selectFrom("import_row_commit").select("id").where("import_batch_id", "=", batch.id).execute(),
    ).toEqual([]);
    const slots = await api.db
      .selectFrom("kpi_actual")
      .select("id")
      .where("kpi_definition_id", "=", direct.id)
      .where("reporting_period_id", "=", p.id)
      .execute();
    expect(slots).toHaveLength(1); // the form-entered one only
  }, 60_000);

  it("the composition root registers kpi_actual.v1 with the §9 columns (contract shape) and kpi_actual.submit", () => {
    const registered = importTargetRegistry().get(KPI_ACTUAL_TEMPLATE_VERSION);
    expect(registered?.kind).toBe("kpi_actual");
    expect(registered?.columns.map((c) => c.key)).toEqual([
      "source_record_id",
      "kpi_id",
      "kpi_name",
      "scope_kind",
      "scope_id",
      "period_label",
      "value",
      "numerator",
      "denominator",
      "milestone_achieved",
      "achieved_on",
      "currency",
      "missing_reason",
      "data_as_of",
      "comment",
    ]);
    // Every column has exactly the contract's ImportTemplateColumn members (additionalProperties: false).
    for (const c of registered?.columns ?? [])
      expect(Object.keys(c).sort()).toEqual(["example", "key", "kind", "labelAr", "labelEn", "required"]);
    expect(registered?.requiredPermissions).toEqual(["kpi_actual.submit"]);
  });
});
