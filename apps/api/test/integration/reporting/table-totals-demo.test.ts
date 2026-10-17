// System SUM totals in the assembled tables, on the DEMO dataset (T-DG5-KBE-D3; D-163, F-DG5-qa-c-3; ADR-0045
// §"Every number…"; ADR-0046 §4; REQ-S13-006 "a system SUM total remains a formula"). Proves, literally:
//  - on the demo dataset, the XLSX of `business_cases` and of `registers` with `{register: "benefits"}` each contain a
//    `SUM(…)` formula whose cached value equals the screen's total (GET /business-cases/{id}/totals and
//    GET /transformations/{id}/benefit-totals), through the real API and the worker's export runner;
//  - every formula in those files is a declared total of the document (the writer emits no other formula).
// The database is a scratch database of this run's disposable cluster, migrated and seeded with the REAL synthetic
// demo dataset (`seedDemo`, ADR-0050). Everything is SYNTHETIC: an illustrative example, not Mobily actual performance;
// any approval in the dataset is a synthetic in-product demonstration that approves nothing real. Nothing here names or
// touches the engineering gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { readXlsx, type ReadWorkbook } from "../../../../../packages/reporting/src/xlsx/read.ts";
import { REPORT_CONTENT_LABELS } from "../../../../../packages/shared/src/reports/content-labels.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import {
  call,
  createUser,
  grant,
  signIn,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ORG = DEMO_ANCHORS.organizationId;
const T = `/api/v1/transformations/${DEMO_ANCHORS.transformationId}`;

let api: TestApi;
let scratch: string | null = null;
let qa: Session;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};
const dec = (a: string, b: string) => new Decimal(a).eq(new Decimal(b));

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_kbe_d3_totals");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"])
    await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function generate(code: string, body: Record<string, unknown>): Promise<Body> {
  return ok(
    await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: qa, body }),
    201,
    `generate ${code}`,
  );
}

/** POST /exports (202) -> the worker's reports.export runner (production labels) -> download (200) -> read back. */
async function xlsxOf(snapshotId: string): Promise<ReadWorkbook> {
  const created = ok(
    await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: qa,
      body: { snapshotId, format: "xlsx", language: "en" },
    }),
    202,
    "createExport",
  );
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${created.id}`)
    .executeTakeFirstOrThrow();
  const envelope = {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: row.payload,
  };
  const outcome = await runExport(
    api.db,
    envelope,
    row.id,
    { retryCount: 0, retryLimit: 5 },
    { store: new FilesystemExportStore(testEvidenceDir()), labels: REPORT_CONTENT_LABELS },
  );
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ outcome: "succeeded" });
  const res = await call<Body>(api.app, "GET", `/api/v1/exports/${created.id}/download`, { session: qa });
  expect(res.status).toBe(200);
  return readXlsx(new Uint8Array(res.raw.rawPayload));
}

/**
 * The SUM cells of the workbook, each with the table section its sheet renders (sheet 0 is "About"; then one sheet per
 * table section, in document order).
 */
function sumCells(
  wb: ReadWorkbook,
  content: Body,
): { section: Body; formula: string; cached: string; header: string[] }[] {
  const tables = content.sections.filter((s: Body) => s.kind === "table");
  const out: { section: Body; formula: string; cached: string; header: string[] }[] = [];
  tables.forEach((section: Body, i: number) => {
    const sheet = wb.sheets[i + 1]!;
    for (const row of sheet.rows)
      for (const c of row) {
        if (c.formula === null) continue;
        // The column's header: the text of the same column in the rows above the data (title, label, header rows).
        const letter = c.ref.replace(/\d+$/, "");
        const texts = sheet.rows.map((r) => r.find((x) => x.ref.replace(/\d+$/, "") === letter)?.text ?? null);
        out.push({
          section,
          formula: c.formula,
          cached: c.value ?? "",
          header: texts.filter((t): t is string => t !== null),
        });
      }
  });
  // No formula anywhere else (the About and Legend sheets carry none).
  const all = wb.sheets.flatMap((sh) => sh.rows.flat()).filter((c) => c.formula !== null);
  expect(all).toHaveLength(out.length);
  return out;
}

describe("REQ-S13-006 on the demo dataset: a system SUM total remains a formula whose cached value is the screen's total", () => {
  it("business_cases: SUM(...) cached = GET /business-cases/{id}/totals (gross per value basis, cost cash/non-cash)", async () => {
    const s = await generate("business_cases", {});
    const caseIds: string[] = s.content.sections.find((x: Body) => x.key === "cases").rows.map((r: Body) => r.recordId);
    const wb = await xlsxOf(s.id);
    const sums = sumCells(wb, s.content);
    console.info(
      `KBE-D3 demo business_cases SUM cells: ${JSON.stringify(sums.map((x) => [x.section.key, x.formula, x.cached]))}`,
    );
    expect(sums.length).toBeGreaterThan(0);
    for (const { section, formula, cached } of sums) {
      expect(formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
      // group_<case index>_<value basis | cost_cash | cost_non_cash>_<currency>
      const m = /^group_(\d+)_(.+)_([a-z]{3})$/.exec(section.key);
      expect(m, section.key).not.toBeNull();
      const caseId = caseIds[Number(m![1]) - 1]!;
      const currency = m![3]!.toUpperCase();
      const screen = ok(
        await call<Body>(api.app, "GET", `/api/v1/business-cases/${caseId}/totals`, { session: qa }),
        200,
        "getBusinessCaseTotals",
      );
      const list =
        m![2] === "cost_cash"
          ? screen.implementationCostCash
          : m![2] === "cost_non_cash"
            ? screen.implementationCostNonCash
            : screen.grossBenefitsByValueBasis[m![2]!];
      const figure = list.find((x: Body) => x.currency === currency);
      expect(figure.unknownLineCount, section.key).toBe(0);
      expect(dec(cached, figure.amount), `${section.key}: ${cached} vs ${figure.amount}`).toBe(true);
      expect(dec(section.totals[0].value.value, figure.amount)).toBe(true);
    }
  }, 300_000);

  it('registers {register: "benefits"}: SUM(...) cached = GET /benefit-totals (class × state, per currency)', async () => {
    const s = await generate("registers", { parameters: { register: "benefits" } });
    const screen = ok(await call<Body>(api.app, "GET", `${T}/benefit-totals`, { session: qa }), 200, "benefit-totals");
    const wb = await xlsxOf(s.id);
    const sums = sumCells(wb, s.content);
    console.info(
      `KBE-D3 demo benefits register SUM cells: ${JSON.stringify(sums.map((x) => [x.section.key, x.formula, x.cached]))}`,
    );
    expect(sums.length).toBeGreaterThan(0);
    const STATE: Record<string, string> = {
      realized_validated: "validated",
      realized_sustained: "sustained",
      pending: "submitted",
    };
    for (const { section, formula, cached, header } of sums) {
      expect(formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
      const m = /^totals_([a-z]{3})_(.+)$/.exec(section.key);
      expect(m, section.key).not.toBeNull();
      const block = screen.currencies.find((c: Body) => c.currency === m![1]!.toUpperCase());
      const valueClass = m![2] === "non_financial" ? "non_financial_valued" : m![2];
      // Which column the formula totals: the sheet's header text of its column is that column's English label.
      const columnKey = Object.keys(STATE).find((k) =>
        header.includes(REPORT_CONTENT_LABELS.en[`report.registers.benefits.${k}`]!),
      );
      expect(columnKey, `${section.key}: header ${header.join("|")}`).toBeDefined();
      const line = block.lines.find((l: Body) => l.valueClass === valueClass && l.state === STATE[columnKey!]);
      expect(line.total.status, `${section.key}.${columnKey}`).toBe("known");
      expect(dec(cached, line.total.amount), `${section.key}.${columnKey}: ${cached} vs ${line.total.amount}`).toBe(
        true,
      );
    }
  }, 300_000);
});
