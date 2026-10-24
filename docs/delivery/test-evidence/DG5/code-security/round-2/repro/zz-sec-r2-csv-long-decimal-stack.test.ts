// code-security-reviewer, DG5 round 2 (T-DG5-RG-SEC-R2): F-DG5-101 re-verification ON THE REAL STACK, en and ar.
// Disposable: copied into the review clone as apps/api/test/integration/zz-sec-r2-csv-long-decimal-stack.test.ts and
// removed afterwards; never part of the candidate.
//
// Flow (all through the API and the worker's real export runner, against the run's disposable PostgreSQL):
//   POST benefit (financial) with long NEGATIVE decimals that the API itself accepts (MEASURE 24,6 / MONEY 20,4):
//     baselineValue  -12345678901.234567   (17 significant digits)
//     targetValue    -1234567890.123456    (16 significant digits)
//     plannedValue   -1234567890123.4567   (17 significant digits)
//   and a control benefit with 15-significant-digit negatives (the number path), plus formula-like USER TEXT
//   (title "=HYPERLINK(...)", baseline unit "-2+3", statement line "@SUM(A1)") as the regression check of the RG1 change
//   (csv.ts now trusts the cell's quotePrefix instead of re-neutralizing).
//   -> POST reports/registers/generate {register: benefits} -> POST /api/v1/exports {csv|xlsx, en|ar}
//   -> worker runExport -> GET /api/v1/exports/{id}/download.
// Expected (ADR-0046 §4): every decimal is its canonical string, UNPREFIXED, in en and in ar; every formula-like user
// text is prefixed with ' in CSV and has quotePrefix in XLSX.
// All data is SYNTHETIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilesystemExportStore } from "../../../../packages/reporting/src/storage.ts";
import { readXlsx } from "../../../../packages/reporting/src/xlsx/read.ts";
import { runExport } from "../../../worker/src/reports/export-runner.ts";
import { call, seedWorld, startApi, testEvidenceDir, type TestApi, type World } from "../support/harness.ts";
import { financialBody, seedBenefitWorld, type BenefitWorld } from "./benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;
let snapshotId: string;
const store = () => new FilesystemExportStore(testEvidenceDir());

const LONG = { baseline: "-12345678901.234567", target: "-1234567890.123456", planned: "-1234567890123.4567" };
const SHORT = { baseline: "-1234567890.12345", target: "-123456789.012345", planned: "-12345678901.2345" };
/** SHORT as the API stores and exports it (the measure column has scale 6: "-1234567890.12345" -> "-1234567890.123450"). */
const SHORT_EXPORTED = { baseline: "-1234567890.123450", target: "-123456789.012345", planned: "-12345678901.2345" };
const HYPERLINK = '=HYPERLINK("http://x","y")';

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

async function exportBytes(format: "csv" | "xlsx", language: "en" | "ar"): Promise<Uint8Array> {
  const job = ok(
    await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: b.s.tl,
      body: { snapshotId, format, language },
      headers: { "idempotency-key": `sec-r2-${crypto.randomUUID()}` },
    }),
    202,
    `export ${format} ${language}`,
  );
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${job.id}`)
    .executeTakeFirstOrThrow();
  const envelope = {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: row.payload,
  };
  await runExport(api.db, envelope as Body, row.id, { retryCount: 0, retryLimit: 5 }, { store: store() });
  const r = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: b.s.tl });
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
  return new Uint8Array(r.raw.rawPayload as Buffer);
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  const mk = async (title: string, v: typeof LONG, unit: string, line: string) =>
    ok(
      await call<Body>(api.app, "POST", `${b.base}/benefits`, {
        session: b.s.tl,
        body: financialBody(b, {
          title,
          baselineValue: v.baseline,
          baselineUnit: unit,
          targetValue: v.target,
          plannedValue: v.planned,
          financialStatementLine: line,
        }),
      }),
      201,
      `createBenefit ${title}`,
    );
  await mk("SEC-R2 long negative decimals", LONG, "SAR", "Revenue - prepaid");
  await mk(HYPERLINK, SHORT, "-2+3", "@SUM(A1)");
  const snap = ok(
    await call<Body>(api.app, "POST", `${b.base}/reports/registers/generate`, {
      session: b.s.tl,
      body: { parameters: { register: "benefits" } },
    }),
    201,
    "generate benefits register",
  );
  snapshotId = snap.id;
}, 180_000);
afterAll(async () => {
  await api.close();
});

describe.each(["en", "ar"] as const)("F-DG5-101 on the real stack, CSV, %s", (language) => {
  it("long negative decimals are unprefixed canonical strings; formula-like user text is prefixed", async () => {
    const text = new TextDecoder().decode(await exportBytes("csv", language));
    const lines = text.split("\r\n");
    // Round-2 run 2: the register row of each benefit (code B01/B02; the one with the value class), not the totals table.
    const long = lines.find((l) => l.includes("SEC-R2 long negative decimals") && l.includes("revenue_uplift"));
    const evil = lines.find((l) => l.includes("HYPERLINK") && l.includes("revenue_uplift"));
    console.log(`SEC-R2 CSV ${language} long row: ${long}`);
    console.log(`SEC-R2 CSV ${language} formula-text row: ${evil}`);
    expect(long, text.slice(0, 2000)).toBeDefined();
    const fields = long!.split(",");
    for (const v of Object.values(LONG)) {
      expect(fields, `${language}: ${v} unprefixed`).toContain(v);
      expect(long, `${language}: no '${v}`).not.toContain(`'${v}`);
    }
    const ef = evil!.split(",");
    for (const v of Object.values(SHORT_EXPORTED)) expect(ef, `${language}: control ${v}`).toContain(v);
    expect(evil).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(ef).toContain("'-2+3");
    // No field of the whole file is an unprefixed formula-like USER text: every field starting with = + @ is prefixed;
    // a field starting with - is either prefixed or a canonical decimal.
    const all = lines.flatMap((l) => l.split(","));
    const bad = all.filter((f) => /^[=+@\t\r]/.test(f) || (/^-/.test(f) && !/^-[0-9]+(\.[0-9]+)?$/.test(f)));
    expect(bad, `${language}: unprefixed formula-like fields`).toEqual([]);
  });

  it(`XLSX ${language} cross-check: long decimals are text WITHOUT quotePrefix, user formulas text WITH quotePrefix`, async () => {
    const book = await readXlsx(await exportBytes("xlsx", language));
    const cells = book.sheets.flatMap((s) => s.rows.flat());
    const find = (t: string) => cells.find((c) => (c.text ?? c.value) === t);
    const qp = (c: { style: number }) => book.quotePrefix[c.style] === true;
    for (const v of Object.values(LONG)) {
      const c = find(v);
      console.log(`SEC-R2 XLSX ${language} ${v}: ${JSON.stringify(c)} quotePrefix=${c === undefined ? "n/a" : qp(c)}`);
      expect(c, v).toBeDefined();
      expect(qp(c!), v).toBe(false);
    }
    const h = find(HYPERLINK);
    console.log(`SEC-R2 XLSX ${language} hyperlink cell: ${JSON.stringify(h)} quotePrefix=${h === undefined ? "n/a" : qp(h)}`);
    expect(h).toBeDefined();
    expect(qp(h!)).toBe(true);
    expect(h!.formula).toBeNull();
  });
});
