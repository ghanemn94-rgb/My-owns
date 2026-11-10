// Import routes against the run's disposable PostgreSQL (ADR-0056 §2-§6, §9; REQ-S17-002, REQ-S17-003;
// p6-work-split §B/A.5; T-DG6-BE-M2). Every request goes through the API (the validating client) except where a test
// says otherwise:
//  1. the A17 8/1/1 fixture as CSV and as XLSX: createImport stages 10 = 8 + 1 + 1, listImportRows shows the 2 others
//     with their reasons, commitImport commits 8 KPI actuals through the DG4 path with 8 lineage rows (provenance), one
//     audit event with prior and new version, and the 2 others stay visible, not committed;
//  2. import.revalidation_failed when a slot is filled (by form) between staging and commit; nothing is written;
//  3. commit twice -> 409 import.not_staged; If-Match missing 428, stale 409;
//  4. commit without kpi_actual.submit -> 403; AUD 403 on upload, commit and cancel; no transformation.read -> 404;
//  5. the commit-time re-check runs inside the transaction, after the lock, before any write;
//  6. cancel: reason required, rows kept, final;
//  7. templates: listed with bilingual columns; downloaded as CSV and XLSX, prefilled with the active KPIs, and
//     re-imported without a whole-file refusal (a filled CSV row commits);
//  8. file refusals: 413 import.file_too_large, 415 import.unsupported_media_type, 422 csv_not_utf8, header_mismatch,
//     template_unknown; 400 for a missing X-File-Name or an undeclared media type.
// Every value is SYNTHETIC. A commit submits KPI actuals through DG4 and approves nothing; nothing here touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitBatchInTx, requireImportAction } from "../../../src/modules/integrations/imports/commit.ts";
import { parseImportFile } from "../../../src/modules/integrations/imports/staging.ts";
import { xlsxWorkbook } from "../../../src/modules/integrations/imports/templates.ts";
import { CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE } from "../../../src/modules/integrations/imports/targets.ts";
import { KPI_ACTUAL_IMPORT_COLUMNS } from "../../../src/modules/kpi/import-target.ts";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import {
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  submitActual,
} from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let direct: { id: string; versionId: string; name: string };
let review: { id: string; versionId: string; name: string };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  direct = await ownedKpi(api, k, DIRECT_FLOW);
  review = await ownedKpi(api, k, REVIEW_FLOW);
}, 120_000);
afterAll(() => api.close());

// ------------------------------------------------------------------------------------------------ files

const HEADER = KPI_ACTUAL_IMPORT_COLUMNS.map((c) => c.key);
type Row = Partial<Record<string, string>>;
const quote = (t: string) => (/[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
const csvOf = (rows: readonly Row[], header: readonly string[] = HEADER): Buffer =>
  Buffer.from(
    [header.join(","), ...rows.map((r) => header.map((h) => quote(r[h] ?? "")).join(","))].join("\r\n") + "\r\n",
  );
const xlsxOf = (rows: readonly Row[]): Buffer =>
  Buffer.from(
    xlsxWorkbook([{ name: "Data", rtl: false, rows: [HEADER, ...rows.map((r) => HEADER.map((h) => r[h] ?? ""))] }]),
  );

const row = (kpiId: string, periodLabel: string, extra: Row = {}): Row => ({
  kpi_id: kpiId,
  scope_kind: "transformation",
  scope_id: k.transformationId,
  period_label: periodLabel,
  data_as_of: "2041-01-31",
  ...extra,
});

/** ADR-0056 §6's A17 fixture: rows 2-9 valid, row 10 `12,5` (invalid), row 11 a duplicate of row 2. */
function fixture(periods: readonly string[]): Row[] {
  const [p1, p2, p3, p4] = periods as [string, string, string, string];
  return [
    row(direct.id, p1, { source_record_id: "SRC-01", value: "120.5" }),
    row(direct.id, p2, { source_record_id: "SRC-02", value: "121" }),
    row(direct.id, p3, { source_record_id: "SRC-03", value: "0.000001" }),
    row(direct.id, p4, { source_record_id: "SRC-04", value: "-3.25" }),
    row(review.id, p1, { source_record_id: "SRC-05", value: "1000" }),
    row(review.id, p2, { source_record_id: "SRC-06", value: "1000.000000" }),
    row(review.id, p3, { source_record_id: "SRC-07", missing_reason: "Synthetic: the source was down" }),
    row(review.id, p4, { source_record_id: "SRC-08", value: "999999999999999999.999999" }),
    row(direct.id, p1, { source_record_id: "SRC-09", value: "12,5" }),
    row(direct.id, p1, { source_record_id: "SRC-10", value: "7" }),
  ];
}

async function periods(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await monthlyPeriod(api, w)).label);
  return out;
}

const imports = () => `${k.base}/imports`;
const ifm = (v: number) => ({ "if-match": `"${v}"` });

function upload(
  bytes: Buffer,
  mediaType: string,
  opts: { session?: Session; fileName?: string | null; template?: string } = {},
) {
  return call(api.app, "POST", `${imports()}?template=${opts.template ?? "kpi_actual.v1"}`, {
    session: opts.session ?? k.s.kds,
    headers: {
      "content-type": mediaType,
      ...(opts.fileName === null ? {} : { "x-file-name": opts.fileName ?? "synthetic-actuals" }),
    },
    body: bytes,
  });
}

const commit = (id: string, version: number | null, session: Session = k.s.kds, note: string | null = null) =>
  call(api.app, "POST", `${imports()}/${id}/commit`, {
    session,
    headers: version === null ? {} : ifm(version),
    body: { note },
  });
const cancel = (id: string, version: number, session: Session = k.s.kds, reason = "Synthetic: wrong file") =>
  call(api.app, "POST", `${imports()}/${id}/cancel`, { session, headers: ifm(version), body: { reason } });
const rowsOf = async (id: string, session: Session = k.s.kds) => {
  const res = await call(api.app, "GET", `${imports()}/${id}/rows?limit=100`, { session });
  expect(res.status).toBe(200);
  return res.body.items as Array<{
    rowNumber: number;
    validationStatus: string;
    commitStatus: string;
    duplicateOfRowNumber: number | null;
    sourceRecordId: string | null;
    raw: Record<string, string | null>;
    reasons: Array<{ code: string; field: string | null; params: Record<string, unknown> }>;
    lineage: { targetRecordType: string; targetRecordId: string; targetValueNo: number } | null;
  }>;
};
const batchRow = (id: string) =>
  api.db.selectFrom("import_batch").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const lineageCount = async (id: string) =>
  Number(
    (
      await api.db
        .selectFrom("import_row_commit")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("import_batch_id", "=", id)
        .executeTakeFirstOrThrow()
    ).n,
  );

// ------------------------------------------------------------------------------------------------ 1. the 8/1/1 fixture

for (const format of ["csv", "xlsx"] as const) {
  describe(`the A17 8/1/1 fixture through the API as ${format.toUpperCase()} (REQ-S17-002, REQ-S17-003)`, () => {
    it("stages 10 = 8 + 1 + 1, commits 8 with provenance, and keeps the 2 others visible with their reasons", async () => {
      const ps = await periods(4);
      const bytes = format === "csv" ? csvOf(fixture(ps)) : xlsxOf(fixture(ps));
      const staged = await upload(bytes, format === "csv" ? CSV_MEDIA_TYPE : XLSX_MEDIA_TYPE, {
        fileName: `synthetic-actuals.${format}`,
      });
      expect(staged.status, JSON.stringify(staged.body)).toBe(201);
      expect(staged.headers["etag"]).toBe('"2"');
      expect(staged.headers["location"]).toBe(`${imports()}/${staged.body.id}`);
      const b = staged.body;
      expect([b.status, b.rowsTotal, b.rowsValid, b.rowsInvalid, b.rowsDuplicate, b.rowsCommitted]).toEqual([
        "staged",
        10,
        8,
        1,
        1,
        null,
      ]);
      expect([b.sourceKind, b.fileName, b.mediaType, b.byteSize]).toEqual([
        `${format}_upload`,
        `synthetic-actuals.${format}`,
        format === "csv" ? CSV_MEDIA_TYPE : XLSX_MEDIA_TYPE,
        bytes.length,
      ]);
      // Staging audit: created (v1) and staged (v2), in the upload request.
      const stageAudit = await auditOfRequest(api.db, String(staged.headers["x-request-id"]));
      expect(stageAudit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
        ["import_batch.created", null, 1],
        ["import_batch.staged", 1, 2],
      ]);

      const before = await rowsOf(b.id);
      expect(before).toHaveLength(10);
      const invalid = before.find((r) => r.rowNumber === 10)!;
      expect([invalid.validationStatus, invalid.reasons.map((x) => x.code)]).toEqual([
        "invalid",
        ["import.row.value_not_decimal"],
      ]);
      expect(invalid.raw["value"]).toBe("12,5");
      const dup = before.find((r) => r.rowNumber === 11)!;
      expect([dup.validationStatus, dup.duplicateOfRowNumber, dup.reasons.map((x) => x.code)]).toEqual([
        "duplicate_in_batch",
        2,
        ["import.row.duplicate_in_batch"],
      ]);

      // AUD reads the batch and its rows, never commits.
      expect((await call(api.app, "GET", `${imports()}/${b.id}`, { session: k.s.auditor })).status).toBe(200);
      expect((await commit(b.id, 2, k.s.auditor)).status).toBe(403);

      const done = await commit(b.id, 2, k.s.kds, "Synthetic monthly upload");
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.headers["etag"]).toBe('"3"');
      expect([done.body.status, done.body.rowsCommitted, done.body.committedBy]).toEqual([
        "committed",
        8,
        k.users.kds.id,
      ]);
      const commitAudit = await auditOfRequest(api.db, String(done.headers["x-request-id"]));
      const batchEvents = commitAudit.filter((a) => a.record_type === "import_batch");
      expect(batchEvents.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
        ["import_batch.committed", 2, 3],
      ]);
      // The DG4 path wrote its own audit events for the 8 slots, in the same request.
      expect(commitAudit.filter((a) => a.record_type === "kpi_actual").length).toBeGreaterThanOrEqual(8);

      const after = await rowsOf(b.id);
      const committed = after.filter((r) => r.commitStatus === "committed");
      expect(committed.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      for (const r of committed) expect(r.lineage?.targetRecordType).toBe("kpi_actual");
      expect(
        after.filter((r) => r.commitStatus === "not_committed").map((r) => [r.rowNumber, r.reasons[0]!.code]),
      ).toEqual([
        [10, "import.row.value_not_decimal"],
        [11, "import.row.duplicate_in_batch"],
      ]);
      expect(await lineageCount(b.id)).toBe(8);
      // Provenance: each lineage row names a KPI actual of this transformation, with its source row id.
      const actuals = await api.db
        .selectFrom("import_row_commit as l")
        .innerJoin("import_row as r", "r.id", "l.import_row_id")
        .innerJoin("kpi_actual as a", "a.id", "l.target_record_id")
        .select(["r.source_record_id", "a.status", "a.kpi_definition_id"])
        .where("l.import_batch_id", "=", b.id)
        .orderBy("r.row_number")
        .execute();
      expect(actuals.map((a) => a.source_record_id)).toEqual([
        "SRC-01",
        "SRC-02",
        "SRC-03",
        "SRC-04",
        "SRC-05",
        "SRC-06",
        "SRC-07",
        "SRC-08",
      ]);
      // Never accepted by the import itself: the review KPI's actuals wait for their reviewer.
      expect(actuals.filter((a) => a.kpi_definition_id === review.id).every((a) => a.status === "submitted")).toBe(
        true,
      );

      // The list shows it; a filter excludes it.
      const list = await call(api.app, "GET", `${imports()}?status=committed&limit=100`, { session: k.s.bo });
      expect(list.status).toBe(200);
      expect(list.body.items.some((x: { id: string }) => x.id === b.id)).toBe(true);
      const staging = await call(api.app, "GET", `${imports()}?status=staged&limit=100`, { session: k.s.bo });
      expect(staging.body.items.some((x: { id: string }) => x.id === b.id)).toBe(false);

      // 3. commit twice -> 409 import.not_staged (whatever the If-Match).
      for (const v of [2, 3]) {
        const again = await commit(b.id, v);
        expect([again.status, again.body.code]).toEqual([409, "import.not_staged"]);
      }
      expect(await lineageCount(b.id)).toBe(8);
    });
  });
}

// ------------------------------------------------------------------------------------------------ 2-5. commit rules

describe("commitImport rules (ADR-0056 §6, §9)", () => {
  it("import.revalidation_failed when a slot is filled between staging and commit; nothing is written", async () => {
    const [p1, p2] = await periods(2);
    const staged = await upload(
      csvOf([row(direct.id, p1!, { value: "1" }), row(direct.id, p2!, { value: "2" })]),
      CSV_MEDIA_TYPE,
    );
    expect([staged.status, staged.body.rowsValid]).toEqual([201, 2]);
    const period2 = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("period_label", "=", p2!)
      .where("frequency", "=", "monthly")
      .executeTakeFirstOrThrow();
    const form = await submitActual(api, k, direct.id, { reportingPeriodId: period2.id, value: "9" });
    expect(form.status, JSON.stringify(form.body)).toBe(201);
    const refused = await commit(staged.body.id, 2);
    expect([refused.status, refused.body.code, refused.body.params]).toEqual([
      409,
      "import.revalidation_failed",
      { rows: "3" },
    ]);
    expect(refused.body.detail).toBe("Rows 3 are no longer valid. Cancel this import and upload the file again.");
    const b = await batchRow(staged.body.id);
    expect([b.status, b.version, b.rows_committed]).toEqual(["staged", 2, null]);
    expect(await lineageCount(staged.body.id)).toBe(0);
    // Row 2's slot was not written either: the whole commit rolled back.
    const p1Actuals = await api.db
      .selectFrom("kpi_actual as a")
      .innerJoin("reporting_period as p", "p.id", "a.reporting_period_id")
      .select("a.id")
      .where("a.kpi_definition_id", "=", direct.id)
      .where("p.period_label", "=", p1!)
      .execute();
    expect(p1Actuals).toEqual([]);
    expect(await auditOfRequest(api.db, String(refused.headers["x-request-id"]))).toEqual([]);
  });

  it("If-Match: missing -> 428, stale -> 409; 422 import.nothing_to_commit for a batch without a valid row", async () => {
    const [p] = await periods(1);
    const staged = await upload(csvOf([row(direct.id, p!, { value: "5" })]), CSV_MEDIA_TYPE);
    expect((await commit(staged.body.id, null)).status).toBe(428);
    const stale = await commit(staged.body.id, 1);
    expect([stale.status, stale.body.type]).toEqual([409, "urn:mth:problem:version-conflict"]);
    expect((await batchRow(staged.body.id)).status).toBe("staged");

    const none = await upload(csvOf([row(direct.id, p!, { value: "x" })]), CSV_MEDIA_TYPE);
    expect([none.status, none.body.rowsValid]).toEqual([201, 0]);
    const empty = await commit(none.body.id, 2);
    expect([empty.status, empty.body.code]).toEqual([422, "import.nothing_to_commit"]);
  });

  it("authorization: commit without kpi_actual.submit -> 403; AUD 403 on upload, commit, cancel; unreadable -> 404", async () => {
    const [p] = await periods(1);
    const staged = await upload(csvOf([row(direct.id, p!, { value: "5" })]), CSV_MEDIA_TYPE);
    expect(staged.status).toBe(201);
    const id = staged.body.id as string;

    // TO holds import.read but neither import.commit nor kpi_actual.submit. Give TO import.commit for this test only
    // (roles are configurable; restored below): the commit is still refused, for the missing kpi_actual.submit.
    const to = (await api.owner.query("SELECT id FROM role WHERE code = 'TO'")).rows[0].id as string;
    await api.owner.query("INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'import.commit')", [to]);
    try {
      const office = await signIn(api.app, w.office.subject);
      const refused = await commit(id, 2, office);
      expect([refused.status, refused.body.type]).toEqual([403, "urn:mth:problem:forbidden"]);
      // With import.commit, TO may cancel (no target permission is needed to cancel); not exercised here.
    } finally {
      await api.owner.query("DELETE FROM role_permission WHERE role_id = $1 AND permission_code = 'import.commit'", [
        to,
      ]);
    }

    // AUD: read-only.
    const aud = k.s.auditor;
    expect((await upload(csvOf([row(direct.id, p!, { value: "5" })]), CSV_MEDIA_TYPE, { session: aud })).status).toBe(
      403,
    );
    expect((await commit(id, 2, aud)).status).toBe(403);
    expect((await cancel(id, 2, aud)).status).toBe(403);
    expect((await call(api.app, "GET", `${imports()}/${id}/rows`, { session: aud })).status).toBe(200);

    // No transformation.read: 404 everywhere (existence never disclosed).
    for (const s of [k.s.outsider, k.s.nobody]) {
      expect((await call(api.app, "GET", `${imports()}/${id}`, { session: s })).status).toBe(404);
      expect((await call(api.app, "GET", imports(), { session: s })).status).toBe(404);
      expect((await commit(id, 2, s)).status).toBe(404);
    }
    // A batch id of another transformation is 404 in this one.
    expect((await call(api.app, "GET", `${imports()}/${crypto.randomUUID()}`, { session: k.s.kds })).status).toBe(404);

    const b = await batchRow(id);
    expect([b.status, b.version]).toEqual(["staged", 2]);
    expect((await cancel(id, 2)).status).toBe(200);
  });

  it("the commit-time re-check runs inside the transaction, after the lock and before any write", async () => {
    const [p] = await periods(1);
    const staged = await upload(csvOf([row(direct.id, p!, { value: "5" })]), CSV_MEDIA_TYPE);
    const id = staged.body.id as string;
    let checked: readonly string[] = [];
    const attempt = api.db.transaction().execute((tx) =>
      commitBatchInTx(tx, {
        transformationId: k.transformationId,
        batchId: id,
        expectedVersion: 2,
        note: null,
        userId: k.users.kds.id,
        committedBy: k.users.kds.id,
        audit: { actorUserId: k.users.kds.id, actorType: "user", requestId: `test-recheck-${id}` },
        recheck: async (_t, permissions) => {
          checked = permissions;
          // The grants changed meanwhile: the re-check refuses (the route's commitTimeDenial gives this 403).
          throw new HttpProblem({
            status: 403,
            type: "urn:mth:problem:forbidden",
            code: "forbidden",
            title: "Forbidden",
          });
        },
      }),
    );
    await expect(attempt).rejects.toMatchObject({ status: 403 });
    expect(checked).toEqual(["import.commit", "kpi_actual.submit"]);
    expect([(await batchRow(id)).status, await lineageCount(id)]).toEqual(["staged", 0]);
    expect(await auditOfRequest(api.db, `test-recheck-${id}`)).toEqual([]);

    // The real re-check on reloaded grants: a principal without grants is refused (404 read gate first).
    const principal = { kind: "user", userId: w.nobody.id, grants: [], tracker: { decisions: 0 } };
    await expect(
      requireImportAction(api.db, principal as never, k.transformationId, ["import.commit"]),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ------------------------------------------------------------------------------------------------ 6. cancel

describe("cancelImport (ADR-0056 §6)", () => {
  it("staged -> cancelled with a reason, rows kept, audited; final afterwards", async () => {
    const [p] = await periods(1);
    const staged = await upload(
      csvOf([row(direct.id, p!, { value: "5" }), row(direct.id, p!, { value: "x" })]),
      CSV_MEDIA_TYPE,
    );
    const id = staged.body.id as string;
    const noReason = await call(api.app, "POST", `${imports()}/${id}/cancel`, {
      session: k.s.kds,
      headers: ifm(2),
      body: {},
    });
    expect(noReason.status).toBe(400);
    const missing = await call(api.app, "POST", `${imports()}/${id}/cancel`, {
      session: k.s.kds,
      body: { reason: "Synthetic: wrong file" },
    });
    expect(missing.status).toBe(428);
    expect((await cancel(id, 1)).status).toBe(409);
    const done = await cancel(id, 2);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect([done.body.status, done.body.cancelReason, done.body.cancelledBy, done.headers["etag"]]).toEqual([
      "cancelled",
      "Synthetic: wrong file",
      k.users.kds.id,
      '"3"',
    ]);
    const events = await auditOfRequest(api.db, String(done.headers["x-request-id"]));
    expect(events.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([["import_batch.cancelled", 2, 3]]);
    expect(await rowsOf(id)).toHaveLength(2);
    for (const again of [await cancel(id, 3), await commit(id, 3)])
      expect([again.status, again.body.code]).toEqual([409, "import.not_staged"]);
  });
});

// ------------------------------------------------------------------------------------------------ 7. templates

describe("import templates (ADR-0056 §9; REQ-S17-003)", () => {
  it("lists kpi_actual.v1 with its bilingual columns; 403 for a caller without import.read", async () => {
    const list = await call(api.app, "GET", "/api/v1/import-templates", { session: k.s.auditor });
    expect(list.status).toBe(200);
    const t = list.body.items.find((x: { templateVersion: string }) => x.templateVersion === "kpi_actual.v1");
    expect(t.mediaTypes).toEqual([CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE]);
    expect(t.columns.map((c: { key: string }) => c.key)).toEqual(HEADER);
    expect(t.columns.every((c: { labelAr: string }) => c.labelAr.length > 0)).toBe(true);
    expect((await call(api.app, "GET", "/api/v1/import-templates", { session: k.s.nobody })).status).toBe(403);
  });

  it("downloads CSV and XLSX prefilled with the active KPIs; both re-import without a whole-file refusal", async () => {
    const base = `/api/v1/import-templates/kpi_actual.v1/download?transformationId=${k.transformationId}`;
    const csv = await call(api.app, "GET", `${base}&format=csv`, { session: k.s.kds });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toMatch(/^text\/csv/);
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="kpi_actual.v1-template.csv"');
    const csvBytes = csv.raw.rawPayload;
    const sheet = parseImportFile(csvBytes, CSV_MEDIA_TYPE);
    expect(sheet.header).toEqual(HEADER);
    const kpiCol = HEADER.indexOf("kpi_id");
    const prefilled = sheet.rows.map((r) => r.values[kpiCol]);
    expect(prefilled).toEqual(expect.arrayContaining([direct.id, review.id]));

    const xlsx = await call(api.app, "GET", `${base}&format=xlsx`, { session: k.s.auditor });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toBe(XLSX_MEDIA_TYPE);
    const xlsxBytes = xlsx.raw.rawPayload;
    const xsheet = parseImportFile(xlsxBytes, XLSX_MEDIA_TYPE);
    expect(xsheet.header).toEqual(HEADER);
    expect(xsheet.rows.map((r) => r.values[kpiCol])).toEqual(prefilled);

    // Re-import as downloaded: staged, every row reported (values empty), no whole-file refusal.
    for (const [bytes, media] of [
      [csvBytes, CSV_MEDIA_TYPE],
      [xlsxBytes, XLSX_MEDIA_TYPE],
    ] as const) {
      const again = await upload(Buffer.from(bytes), media);
      expect([again.status, again.body.status, again.body.rowsTotal]).toEqual([201, "staged", prefilled.length]);
      expect((await cancel(again.body.id, 2)).status).toBe(200);
    }

    // A filled template row commits: the direct KPI's row with a period, a date and a value.
    const [p] = await periods(1);
    const lines = new TextDecoder()
      .decode(csvBytes)
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((l) => l.length > 0);
    const directLine = lines.find((l) => l.startsWith(`,${direct.id},`) || l.includes(`,${direct.id},`))!;
    const cells = directLine.split(",");
    cells[HEADER.indexOf("period_label")] = p!;
    cells[HEADER.indexOf("data_as_of")] = "2041-01-31";
    cells[HEADER.indexOf("value")] = "42.5";
    cells[HEADER.indexOf("source_record_id")] = "TEMPLATE-1";
    const filled = await upload(Buffer.from(`${lines[0]}\r\n${cells.join(",")}\r\n`), CSV_MEDIA_TYPE);
    expect([filled.status, filled.body.rowsValid, filled.body.rowsTotal]).toEqual([201, 1, 1]);
    const committed = await commit(filled.body.id, 2);
    expect([committed.status, committed.body.rowsCommitted]).toEqual([200, 1]);
  });

  it("download refusals: unknown template 404, unreadable transformation 404, no transformationId 400", async () => {
    const q = `?transformationId=${k.transformationId}`;
    expect(
      (await call(api.app, "GET", `/api/v1/import-templates/nope.v1/download${q}`, { session: k.s.kds })).status,
    ).toBe(404);
    expect(
      (await call(api.app, "GET", `/api/v1/import-templates/kpi_actual.v1/download${q}`, { session: k.s.outsider }))
        .status,
    ).toBe(404);
    expect(
      (await call(api.app, "GET", "/api/v1/import-templates/kpi_actual.v1/download", { session: k.s.kds })).status,
    ).toBe(400);
  });
});

// ------------------------------------------------------------------------------------------------ 8. file refusals

describe("createImport file refusals (ADR-0056 §3, §9)", () => {
  const expectRefusal = async (res: Awaited<ReturnType<typeof upload>>, status: number, code: string) => {
    expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([status, code]);
    expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
  };

  it("413 over 10 MiB, 415 content that is not the declared type, 422 for bad files; nothing is written", async () => {
    const before = Number(
      (
        await api.db
          .selectFrom("import_batch")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("transformation_id", "=", k.transformationId)
          .executeTakeFirstOrThrow()
      ).n,
    );
    await expectRefusal(await upload(Buffer.alloc(10_485_761, 0x61), CSV_MEDIA_TYPE), 413, "import.file_too_large");
    await expectRefusal(await upload(csvOf([]), XLSX_MEDIA_TYPE), 415, "import.unsupported_media_type");
    await expectRefusal(await upload(csvOf([]), "text/csv; charset=latin1"), 415, "import.unsupported_media_type");
    await expectRefusal(
      await upload(Buffer.from([0x6b, 0xff, 0xfe, 0x0a]), CSV_MEDIA_TYPE),
      422,
      "import.csv_not_utf8",
    );
    await expectRefusal(
      await upload(csvOf([], [...HEADER, "unknown_column"]), CSV_MEDIA_TYPE),
      422,
      "import.header_mismatch",
    );
    await expectRefusal(
      await upload(csvOf([]), CSV_MEDIA_TYPE, { template: "nope.v1" }),
      422,
      "import.template_unknown",
    );
    const noName = await upload(csvOf([]), CSV_MEDIA_TYPE, { fileName: null });
    expect(noName.status).toBe(400);
    const plain = await upload(csvOf([]), "text/plain");
    expect([plain.status, plain.body.errors[0].code]).toEqual([400, "validation.content_type"]);
    const after = Number(
      (
        await api.db
          .selectFrom("import_batch")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("transformation_id", "=", k.transformationId)
          .executeTakeFirstOrThrow()
      ).n,
    );
    expect(after).toBe(before);
  });
});
