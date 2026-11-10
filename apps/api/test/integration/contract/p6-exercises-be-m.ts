// P6 contract exercises of BE-M (p6-plan §5.1, p6-work-split §2 rule 16, §B/A.3, §B/A.5). BE-M routes nothing (the
// engine only); its split task T-DG6-BE-M2 appends the eight import operations here (ADR-0056 §2-§6, §9), each with a
// success and every declared refusal it can reach, through the validating client. The mirrors restate the contract
// schemas of the JSON success bodies (no shared zod mirror exists for imports in packages/shared); downloadImportTemplate
// answers a file (text/csv or XLSX), which the validating client checks against the contract's media types.
// Every value is SYNTHETIC; a commit submits KPI actuals through DG4, approves nothing and never touches DG0-DG7.
import { expect } from "vitest";
import { z } from "zod";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";

// ------------------------------------------------------------------------------------------------ T-DG6-BE-M2 mirrors

const nullableUuid = z.uuid().nullable();
const importBatch = z.strictObject({
  id: z.uuid(),
  transformationId: z.uuid(),
  targetKind: z.literal("kpi_actual"),
  templateVersion: z.string(),
  formSchemaVersionId: z.uuid(),
  sourceKind: z.enum(["csv_upload", "xlsx_upload", "webhook", "connector"]),
  connectorId: nullableUuid,
  integrationRunId: nullableUuid,
  webhookReceiptId: nullableUuid,
  fileName: z.string().max(255).nullable(),
  mediaType: z
    .enum(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/json"])
    .nullable(),
  byteSize: z.number().int().min(1).max(10_485_760).nullable(),
  contentSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  status: z.enum(["staging", "staged", "committed", "cancelled", "failed"]),
  rowsTotal: z.number().int().min(0).max(5000).nullable(),
  rowsValid: z.number().int().min(0).nullable(),
  rowsInvalid: z.number().int().min(0).nullable(),
  rowsDuplicate: z.number().int().min(0).nullable(),
  rowsCommitted: z.number().int().min(0).nullable(),
  failureCode: z.string().max(100).nullable(),
  commitMode: z.enum(["manual", "auto"]),
  onBehalfOfUserId: nullableUuid,
  committedAt: z.string().nullable(),
  committedBy: nullableUuid,
  cancelledAt: z.string().nullable(),
  cancelledBy: nullableUuid,
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  createdBy: nullableUuid,
  version: z.number().int().min(1),
});
const importRow = z.strictObject({
  id: z.uuid(),
  rowNumber: z.number().int().min(1),
  sourceRecordId: z.string().max(200).nullable(),
  raw: z.record(z.string(), z.string().nullable()),
  normalized: z.record(z.string(), z.string().nullable()).nullable(),
  duplicateKey: z.string().nullable(),
  validationStatus: z.enum(["valid", "invalid", "duplicate_in_batch", "duplicate_committed"]),
  duplicateOfRowNumber: z.number().int().min(1).nullable(),
  reasons: z
    .array(
      z.strictObject({
        code: z.string().regex(/^import\.row\.[a-z_]+$/),
        field: z.string().nullable(),
        params: z.record(z.string(), z.union([z.string(), z.number().int()])),
      }),
    )
    .max(20),
  commitStatus: z.enum(["pending", "committed", "not_committed"]),
  lineage: z
    .strictObject({
      targetRecordType: z.literal("kpi_actual"),
      targetRecordId: z.uuid(),
      targetValueNo: z.number().int().min(1),
      committedAt: z.string(),
    })
    .nullable(),
});
const importTemplateList = z.strictObject({
  items: z.array(
    z.strictObject({
      templateVersion: z.string(),
      targetKind: z.literal("kpi_actual"),
      titleEn: z.string(),
      titleAr: z.string(),
      mediaTypes: z.array(z.enum(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])),
      columns: z.array(
        z.strictObject({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
          labelEn: z.string(),
          labelAr: z.string(),
          required: z.boolean(),
          kind: z.enum(["text", "uuid", "decimal", "date", "boolean", "enum"]),
          example: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export const P6_MIRRORS_BE_M: Readonly<Record<string, z.ZodType>> = {
  // T-DG6-BE-M2
  listImports: z.strictObject({ items: z.array(importBatch), nextCursor: z.string().nullable() }),
  createImport: importBatch,
  getImport: importBatch,
  listImportRows: z.strictObject({ items: z.array(importRow), nextCursor: z.string().nullable() }),
  commitImport: importBatch,
  cancelImport: importBatch,
  listImportTemplates: importTemplateList,
};

const CSV = "text/csv";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function exerciseP6BeMOperations(ctx: P6ExerciseContext): Promise<void> {
  // BE-M: no route (the staging engine). T-DG6-BE-M2: the eight import operations below.
  const { api, world: w, mirrored } = ctx;
  const k = await seedKpiWorld(api, w);
  const kpi = await ownedKpi(api, k, DIRECT_FLOW);
  const p1 = await monthlyPeriod(api, w);
  const p2 = await monthlyPeriod(api, w);
  const kds = k.s.kds;
  const aud = k.s.auditor;
  const tl = k.s.tl; // reads the transformation, holds no import permission
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const L = `${k.base}/imports`;
  const header =
    "source_record_id,kpi_id,kpi_name,scope_kind,scope_id,period_label,value,numerator,denominator,milestone_achieved," +
    "achieved_on,currency,missing_reason,data_as_of,comment";
  const line = (src: string, period: string, value: string) =>
    `${src},${kpi.id},,transformation,${k.transformationId},${period},${value},,,,,,,2041-01-31,`;
  const file = (...lines: string[]) => Buffer.from(`${header}\r\n${lines.join("\r\n")}\r\n`);
  const upload = (bytes: Buffer, opts: { session?: typeof kds | null; type?: string; name?: string | null } = {}) =>
    mirrored("POST", `${L}?template=kpi_actual.v1`, {
      ...(opts.session === null ? {} : { session: opts.session ?? kds }),
      headers: {
        "content-type": opts.type ?? CSV,
        ...(opts.name === null ? {} : { "x-file-name": opts.name ?? "synthetic-contract.csv" }),
      },
      body: bytes,
    });

  // listImportTemplates: 200; 400; 401; 403 (no import.read anywhere).
  const templates = await mirrored("GET", "/api/v1/import-templates", { session: aud });
  expect(templates.status).toBe(200);
  expect((await mirrored("GET", "/api/v1/import-templates?x=1", { session: kds })).status).toBe(400);
  expect((await mirrored("GET", "/api/v1/import-templates")).status).toBe(401);
  expect((await mirrored("GET", "/api/v1/import-templates", { session: nobody })).status).toBe(403);

  // downloadImportTemplate: 200 (csv, xlsx); 400; 401; 403 (TL: reads the transformation, no import.read); 404.
  const D = `/api/v1/import-templates/kpi_actual.v1/download?transformationId=${k.transformationId}`;
  const csvTemplate = await mirrored("GET", `${D}&format=csv`, { session: kds });
  expect(csvTemplate.status).toBe(200);
  expect(String(csvTemplate.headers["content-type"])).toMatch(/^text\/csv/);
  const xlsxTemplate = await mirrored("GET", `${D}&format=xlsx`, { session: aud });
  expect([xlsxTemplate.status, xlsxTemplate.headers["content-type"]]).toEqual([200, XLSX]);
  expect((await mirrored("GET", `${D}&format=pdf`, { session: kds })).status).toBe(400);
  expect((await mirrored("GET", D)).status).toBe(401);
  expect((await mirrored("GET", D, { session: tl })).status).toBe(403);
  expect((await mirrored("GET", D, { session: nobody })).status).toBe(404);
  expect(
    (
      await mirrored("GET", `/api/v1/import-templates/nope.v1/download?transformationId=${k.transformationId}`, {
        session: kds,
      })
    ).status,
  ).toBe(404);

  // createImport: 201; 400 (no X-File-Name); 401; 403 (AUD); 404; 413; 415; 422.
  const created = await upload(file(line("C-1", p1.label, "10"), line("C-2", p2.label, "1,5")));
  expect(created.status).toBe(201);
  expect(created.headers["etag"]).toBe('"2"');
  const id = created.body.id as string;
  const one = `${L}/${id}`;
  expect((await upload(file(), { name: null })).status).toBe(400);
  expect((await upload(file(), { session: null })).status).toBe(401);
  expect((await upload(file(), { session: aud })).status).toBe(403);
  expect(
    (
      await mirrored("POST", `/api/v1/transformations/${missing}/imports?template=kpi_actual.v1`, {
        session: kds,
        headers: { "content-type": CSV, "x-file-name": "x.csv" },
        body: file(),
      })
    ).status,
  ).toBe(404);
  const big = await upload(Buffer.alloc(10_485_761, 0x61));
  expect([big.status, big.body.code]).toEqual([413, "import.file_too_large"]);
  const notXlsx = await upload(file(), { type: XLSX, name: "x.xlsx" });
  expect([notXlsx.status, notXlsx.body.code]).toEqual([415, "import.unsupported_media_type"]);
  const badHeader = await upload(Buffer.from("nope\r\n1\r\n"));
  expect([badHeader.status, badHeader.body.code]).toEqual([422, "import.header_mismatch"]);

  // listImports: 200; 400; 401; 403 (TL); 404.
  const list = await mirrored("GET", `${L}?limit=10`, { session: aud });
  expect(list.status).toBe(200);
  expect(list.body.items.some((b: { id: string }) => b.id === id)).toBe(true);
  expect((await mirrored("GET", `${L}?status=done`, { session: kds })).status).toBe(400);
  expect((await mirrored("GET", L)).status).toBe(401);
  expect((await mirrored("GET", L, { session: tl })).status).toBe(403);
  expect((await mirrored("GET", L, { session: nobody })).status).toBe(404);

  // getImport: 200; 400; 401; 403 (TL); 404.
  expect((await mirrored("GET", one, { session: aud })).status).toBe(200);
  expect((await mirrored("GET", `${L}/not-a-uuid`, { session: kds })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", one, { session: tl })).status).toBe(403);
  expect((await mirrored("GET", `${L}/${missing}`, { session: kds })).status).toBe(404);

  // listImportRows: 200; 400; 401; 403 (TL); 404.
  const rows = await mirrored("GET", `${one}/rows`, { session: aud });
  expect(rows.status).toBe(200);
  expect(rows.body.items.map((r: { validationStatus: string }) => r.validationStatus)).toEqual(["valid", "invalid"]);
  expect((await mirrored("GET", `${one}/rows?validationStatus=bad`, { session: kds })).status).toBe(400);
  expect((await mirrored("GET", `${one}/rows`)).status).toBe(401);
  expect((await mirrored("GET", `${one}/rows`, { session: tl })).status).toBe(403);
  expect((await mirrored("GET", `${L}/${missing}/rows`, { session: kds })).status).toBe(404);

  // commitImport: 200; 400; 401; 403 (AUD); 404; 409 (stale, then not staged); 422 (nothing to commit); 428.
  const commitBody = { note: "Synthetic contract commit" };
  const C = `${one}/commit`;
  expect(
    (await mirrored("POST", C, { session: kds, headers: { "if-match": '"2"' }, body: { note: "x" } })).status,
  ).toBe(400);
  expect((await mirrored("POST", C, { headers: { "if-match": '"2"' }, body: commitBody })).status).toBe(401);
  expect((await mirrored("POST", C, { session: aud, headers: { "if-match": '"2"' }, body: commitBody })).status).toBe(
    403,
  );
  expect(
    (
      await mirrored("POST", `${L}/${missing}/commit`, {
        session: kds,
        headers: { "if-match": '"2"' },
        body: commitBody,
      })
    ).status,
  ).toBe(404);
  expect((await mirrored("POST", C, { session: kds, body: commitBody })).status).toBe(428);
  expect((await mirrored("POST", C, { session: kds, headers: { "if-match": '"1"' }, body: commitBody })).status).toBe(
    409,
  );
  const committed = await mirrored("POST", C, { session: kds, headers: { "if-match": '"2"' }, body: commitBody });
  expect([committed.status, committed.body.rowsCommitted]).toEqual([200, 1]);
  const twice = await mirrored("POST", C, { session: kds, headers: { "if-match": '"3"' }, body: { note: null } });
  expect([twice.status, twice.body.code]).toEqual([409, "import.not_staged"]);
  const invalidOnly = await upload(file(line("C-3", p2.label, "x")));
  expect(invalidOnly.status).toBe(201);
  const nothing = await mirrored("POST", `${L}/${invalidOnly.body.id}/commit`, {
    session: kds,
    headers: { "if-match": '"2"' },
    body: { note: null },
  });
  expect([nothing.status, nothing.body.code]).toEqual([422, "import.nothing_to_commit"]);

  // cancelImport: 200; 400; 401; 403 (AUD); 404; 409; 428.
  const X = `${L}/${invalidOnly.body.id}/cancel`;
  const reason = { reason: "Synthetic: wrong file" };
  expect((await mirrored("POST", X, { session: kds, headers: { "if-match": '"2"' }, body: {} })).status).toBe(400);
  expect((await mirrored("POST", X, { headers: { "if-match": '"2"' }, body: reason })).status).toBe(401);
  expect((await mirrored("POST", X, { session: aud, headers: { "if-match": '"2"' }, body: reason })).status).toBe(403);
  expect(
    (await mirrored("POST", `${L}/${missing}/cancel`, { session: kds, headers: { "if-match": '"2"' }, body: reason }))
      .status,
  ).toBe(404);
  expect((await mirrored("POST", X, { session: kds, body: reason })).status).toBe(428);
  const cancelled = await mirrored("POST", X, { session: kds, headers: { "if-match": '"2"' }, body: reason });
  expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
  expect((await mirrored("POST", X, { session: kds, headers: { "if-match": '"3"' }, body: reason })).status).toBe(409);
}
