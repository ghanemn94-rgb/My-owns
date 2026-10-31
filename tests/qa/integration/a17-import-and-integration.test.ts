// A17 "Import and integration" (qa-verifier, T-DG6-QA-A): "Invalid rows are isolated, duplicates detected, valid rows
// committed with provenance; unavailable connector shows an actionable error" (master prompt §20).
//
// Binding row texts (docs/delivery/requirements.csv, final gate DG6, citing A17), each tested literally below:
//  - REQ-S17-002 "a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the
//    2 others with row-level reasons"                                                    -> describe "S17-002 …" (CSV, XLSX)
//  - REQ-S17-003 "CSV and XLSX KPI imports and a signed webhook call each commit valid data; an unsigned webhook is
//    rejected"                                                                           -> CSV/XLSX + describe "S17-003 …"
//  - REQ-S17-001 "a test connector run records last success, row counts, errors and retries" (API part; the UI part
//    is e2e/a17-import-and-integration.spec.ts)                                          -> describe "S17-001 …"
//  - REQ-S12-019 "a failing test connector produces one exception and the KPI shows Stale with its last value and
//    date"                                                                               -> describe "failing connector …"
//    (T-DG6-QA-A2, D-202 option (a): the linked KPI is read by holders of transformation.read at its transformation,
//    KDS and AUD; the technical administrator sees only linkedKpiCount 1 / hiddenKpiCount 1, ADR-0053 §2.)
//  - REQ-S17-005 "with the test connector stopped, a KPI actual can still be submitted by form, and the connector page
//    shows an actionable error message"                                                  -> describe "stopped connector …"
//  - REQ-S20-017 / REQ-DLV-038: this file plus the e2e spec are the executable A17 test.
// The assignment's own scenario adds "nothing partial" (an import commits all valid rows or nothing) and "no silent
// data change" for a failing or stopped connector: both are asserted on database state.
//
// Environment: the REAL API (Fastify inject) and the REAL production worker (in this process, pg-boss on the same
// scratch database of the run's disposable PostgreSQL). Due connector runs are executed by `connectorRunWatchStep`, the
// exact step the API process runs every 10 s in production (it is not started under NODE_ENV=test, by design); the
// worker consumes the `connector.run_failed` outbox event and opens the operational exception. The webhook signing
// secret is resolved by the built-in `env` secret provider from a synthetic process variable. Every assertion is
// derived from the acceptance texts and docs/api/openapi.yaml; every request through `call` is validated against the
// contract. All data is SYNTHETIC; nothing here approves anything real (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import { connectorRunWatchStep } from "../../../apps/api/src/modules/integrations/runs.ts";
import { inProcessWorker, qaBoss, scratchEnv, waitFor, type ScratchEnv } from "../support/a13-durable.ts";
import {
  A17_VALID_VALUES,
  a17Rows,
  CONNECTORS,
  CSV,
  csvFile,
  decimalCanon,
  enabledConnector,
  EXCEPTIONS,
  ifm,
  sha256,
  signWebhook,
  templateColumns,
  WEBHOOKS,
  webhookItems,
  xlsxFile,
  XLSX,
  type FixtureKpis,
  type Row,
} from "../support/a17.ts";
import { call, signIn, uniq, type Loose, type Session, type TestApi } from "../support/api.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  seedKpiWorld,
  seedWorld,
  submitActual,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

// The connector scenarios wait for a bounded retry backoff (10 s) and the worker's exception (up to 45 s each, waitFor
// says what it waited for); a test timeout above those bounds makes a failure name its cause instead of "timed out".
vi.setConfig({ testTimeout: 120_000 });

const SECRET_VAR = "QA_A17_WEBHOOK_SIGNING_SECRET";
const SECRET = "synthetic-qa-a17-signing-secret-not-real-0001";

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker;
let api: TestApi;
let w: World;
let k: KpiWorld;
let admin: Session; // ADM_TECH + ADM_ACCESS @ org A
let kpis: FixtureKpis;
let header: string[];

beforeAll(async () => {
  process.env[SECRET_VAR] = SECRET;
  env = await scratchEnv("mth_qa_a17");
  api = env.api;
  boss = qaBoss(env.appUrl, "qa-a17-boss");
  await boss.start();
  worker = await inProcessWorker(env, boss);
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id); // the review-route KPI's reviewer
  admin = await signIn(api.app, w.admin.subject);
  kpis = {
    direct: (await ownedKpi(api, k, DIRECT_FLOW)).id,
    review: (await ownedKpi(api, k, REVIEW_FLOW)).id,
  };
  header = await templateColumns(api, k.s.kds);
}, 180_000);

afterAll(async () => {
  delete process.env[SECRET_VAR];
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false }).catch(() => undefined);
  await env?.close();
}, 60_000);

// ------------------------------------------------------------------ helpers

const imports = () => `${k.base}/imports`;

async function openPeriods(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await monthlyPeriod(api, w)).label);
  return out;
}

function upload(bytes: Buffer, mediaType: string, fileName: string, session: Session = k.s.kds) {
  return call<Loose>(api.app, "POST", `${imports()}?template=kpi_actual.v1`, {
    session,
    headers: { "content-type": mediaType, "x-file-name": fileName },
    body: bytes,
  });
}

async function rowsOf(batchId: string): Promise<Loose[]> {
  const res = await call<Loose>(api.app, "GET", `${imports()}/${batchId}/rows?limit=100`, { session: k.s.auditor });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items as Loose[];
}

const commit = (batchId: string, version: number) =>
  call<Loose>(api.app, "POST", `${imports()}/${batchId}/commit`, {
    session: k.s.kds,
    headers: ifm(version),
    body: { note: "Synthetic A17 commit" },
  });

/** Every KPI actual of the transformation with its current value (database state, compared before/after). */
async function actualsSnapshot(): Promise<string[]> {
  const r = await api.db
    .selectFrom("kpi_actual as a")
    .innerJoin("kpi_actual_value as v", (j) => j.onRef("v.kpi_actual_id", "=", "a.id"))
    .select(["a.id", "a.status", "a.version", "a.current_value_no", "v.value_no", "v.value", "v.missing_reason"])
    .where("a.transformation_id", "=", k.transformationId)
    .orderBy("a.id")
    .orderBy("v.value_no")
    .execute();
  return r.map((x) => JSON.stringify(x));
}

async function countActuals(): Promise<number> {
  const r = await api.db
    .selectFrom("kpi_actual")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", k.transformationId)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** The slot's KPI actual and its current value, or null. */
async function slot(kpiId: string, periodLabel: string) {
  return (
    (await api.db
      .selectFrom("kpi_actual as a")
      .innerJoin("kpi_actual_value as v", (j) =>
        j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.current_value_no"),
      )
      .select(["a.id", "a.status", "a.route", "a.period_label", "a.kpi_definition_id", "v.value", "v.value_no"])
      .where("a.kpi_definition_id", "=", kpiId)
      .where("a.scope_kind", "=", "transformation")
      .where("a.scope_id", "=", k.transformationId)
      .where("a.period_label", "=", periodLabel)
      .executeTakeFirst()) ?? null
  );
}

/**
 * The full A17 8/1/1 flow for one uploaded file: stage (10 = 8 + 1 + 1, nothing committed), the two others with
 * row-level reasons, commit (8 KPI actuals through the DG4 path, each with lineage to its batch and source row), the
 * two others still visible and not committed. Returns the batch id.
 */
async function eightOneOne(bytes: Buffer, mediaType: string, fileName: string, rows: Row[], periods: string[]) {
  const before = await countActuals();
  const staged = await upload(bytes, mediaType, fileName);
  expect(staged.status, JSON.stringify(staged.body)).toBe(201);
  expect(String(staged.headers["location"])).toContain(staged.body.id);
  expect(staged.body).toMatchObject({
    status: "staged",
    sourceKind: mediaType === CSV ? "csv_upload" : "xlsx_upload",
    targetKind: "kpi_actual",
    templateVersion: "kpi_actual.v1",
    fileName,
    mediaType,
    byteSize: bytes.length,
    contentSha256: sha256(bytes),
    rowsTotal: 10,
    rowsValid: 8,
    rowsInvalid: 1,
    rowsDuplicate: 1,
    rowsCommitted: null, // Unknown until committed, never 0
    connectorId: null,
    webhookReceiptId: null,
  });
  // Staging commits nothing.
  expect(await countActuals()).toBe(before);

  const staged10 = await rowsOf(staged.body.id);
  expect(staged10.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const r of staged10.slice(0, 8)) {
    expect(r, `row ${r.rowNumber}`).toMatchObject({ validationStatus: "valid", reasons: [], commitStatus: "pending" });
    expect(decimalCanon(r.normalized?.value), `row ${r.rowNumber} normalized value`).toBe(
      A17_VALID_VALUES[r.rowNumber],
    );
  }
  const invalid = staged10[8];
  expect(invalid).toMatchObject({
    rowNumber: 10,
    validationStatus: "invalid",
    sourceRecordId: rows[8]!["source_record_id"],
  });
  expect(invalid.raw.value).toBe("12,5"); // the source text is kept, never coerced
  expect(invalid.reasons).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "import.row.value_not_decimal", field: "value" })]),
  );
  const dup = staged10[9];
  expect(dup).toMatchObject({ rowNumber: 11, validationStatus: "duplicate_in_batch", duplicateOfRowNumber: 3 });
  expect(dup.reasons.map((x: Loose) => x.code)).toContain("import.row.duplicate_in_batch");

  const committed = await commit(staged.body.id, staged.body.version);
  expect(committed.status, JSON.stringify(committed.body)).toBe(200);
  expect(committed.body).toMatchObject({ status: "committed", rowsCommitted: 8, committedBy: k.users.kds.id });
  expect(await countActuals()).toBe(before + 8);

  const after = await rowsOf(staged.body.id);
  const lineageIds = new Set<string>();
  for (const r of after.slice(0, 8)) {
    expect(r, `row ${r.rowNumber}`).toMatchObject({ commitStatus: "committed" });
    expect(r.lineage).toMatchObject({ targetRecordType: "kpi_actual", targetValueNo: 1 });
    lineageIds.add(r.lineage.targetRecordId);
    // Provenance: the lineage names the KPI actual of exactly this row's KPI, period and value.
    const src = rows[r.rowNumber - 2]!;
    const target = await slot(src["kpi_id"]!, src["period_label"]!);
    expect(target?.id, `row ${r.rowNumber} lineage`).toBe(r.lineage.targetRecordId);
    expect(decimalCanon(target!.value)).toBe(A17_VALID_VALUES[r.rowNumber]);
    // Committed through the DG4 submission path: the review route waits for a reviewer; never accepted directly.
    expect(target!.status).toBe(src["kpi_id"] === kpis.review ? "submitted" : "accepted");
  }
  expect(lineageIds.size).toBe(8);
  for (const r of after.slice(8)) {
    expect(r, `row ${r.rowNumber}`).toMatchObject({ commitStatus: "not_committed", lineage: null });
    expect(r.reasons.length, `row ${r.rowNumber} keeps its reason`).toBeGreaterThan(0);
  }
  // Database lineage: 8 rows linking this batch to its 8 actuals.
  const lineage = await api.db
    .selectFrom("import_row_commit")
    .select(["target_record_id"])
    .where("import_batch_id", "=", staged.body.id)
    .execute();
  expect(new Set(lineage.map((l) => l.target_record_id))).toEqual(lineageIds);
  // The invalid row's slot holds nothing; the duplicate's value 7 was not written over row 3's 121.
  expect(await slot(kpis.direct, periods[4]!)).toBeNull();
  expect(decimalCanon((await slot(kpis.direct, periods[1]!))!.value)).toBe("121");
  // The batch keeps its source (provenance) after the commit.
  const batch = await call<Loose>(api.app, "GET", `${imports()}/${staged.body.id}`, { session: k.s.auditor });
  expect(batch.body).toMatchObject({ fileName, contentSha256: sha256(bytes), status: "committed", rowsCommitted: 8 });
  return staged.body.id as string;
}

// ------------------------------------------------------------------ REQ-S17-002 / REQ-S17-003 (files)

describe("REQ-S17-002/003: a file with 8 valid rows, 1 invalid row and 1 duplicate commits 8 rows with provenance and shows the 2 others with row-level reasons", () => {
  it("CSV (UTF-8, RFC 4180)", async () => {
    const periods = await openPeriods(5);
    const rows = a17Rows(kpis, k.transformationId, periods, "QA-CSV");
    await eightOneOne(csvFile(header, rows), CSV, "qa-a17-actuals.csv", rows, periods);
  });

  it("XLSX (values as numeric cells, the invalid value as text)", async () => {
    const periods = await openPeriods(5);
    const rows = a17Rows(kpis, k.transformationId, periods, "QA-XLSX");
    await eightOneOne(xlsxFile(header, rows, ["value"]), XLSX, "qa-a17-actuals.xlsx", rows, periods);
  });

  it("duplicates against committed data are detected: re-importing a committed file commits nothing", async () => {
    const periods = await openPeriods(5);
    const rows = a17Rows(kpis, k.transformationId, periods, "QA-RE");
    const bytes = csvFile(header, rows);
    await eightOneOne(bytes, CSV, "qa-a17-first.csv", rows, periods);
    const snapshot = await actualsSnapshot();

    const again = await upload(bytes, CSV, "qa-a17-again.csv");
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toMatchObject({ status: "staged", rowsTotal: 10, rowsValid: 0 });
    const rs = await rowsOf(again.body.id);
    for (const r of rs.slice(0, 8)) expect(r.validationStatus, `row ${r.rowNumber}`).toBe("duplicate_committed");
    for (const r of rs.slice(0, 8))
      expect(r.reasons.map((x: Loose) => x.code)).toContain("import.row.duplicate_committed");
    const refused = await commit(again.body.id, again.body.version);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe("import.nothing_to_commit");
    expect(await actualsSnapshot()).toEqual(snapshot);
  });

  it("nothing partial: a commit whose valid row became invalid writes nothing at all (409 import.revalidation_failed)", async () => {
    const periods = await openPeriods(5);
    const rows = a17Rows(kpis, k.transformationId, periods, "QA-NP");
    const staged = await upload(csvFile(header, rows), CSV, "qa-a17-partial.csv");
    expect(staged.status, JSON.stringify(staged.body)).toBe(201);
    expect(staged.body.rowsValid).toBe(8);
    // Row 9's slot (review KPI, 4th period) is filled by form between staging and commit.
    const p4 = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("period_label", "=", periods[3]!)
      .executeTakeFirstOrThrow();
    const byForm = await submitActual(api, k, kpis.review, { reportingPeriodId: p4.id, value: "5" });
    expect(byForm.status, JSON.stringify(byForm.body)).toBe(201);
    const snapshot = await actualsSnapshot();

    const refused = await commit(staged.body.id, staged.body.version);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.code).toBe("import.revalidation_failed");
    expect(await actualsSnapshot()).toEqual(snapshot); // none of the 7 still-valid rows was written
    const lineage = await api.db
      .selectFrom("import_row_commit")
      .select("id")
      .where("import_batch_id", "=", staged.body.id)
      .execute();
    expect(lineage).toHaveLength(0);
    const batch = await call<Loose>(api.app, "GET", `${imports()}/${staged.body.id}`, { session: k.s.auditor });
    expect(batch.body).toMatchObject({ status: "staged", rowsCommitted: null });
    expect((await rowsOf(staged.body.id)).every((r) => r.commitStatus === "pending")).toBe(true);
  });
});

// ------------------------------------------------------------------ REQ-S17-003 (webhook)

describe("REQ-S17-003: a signed webhook call commits valid data; an unsigned or wrongly signed webhook is rejected", () => {
  let endpointKey: string;
  let connectorId: string;
  let periods: string[];
  let payload: Loose; // the delivery object; `body` is its exact JSON bytes (what is signed and what is sent)
  let body: Buffer;

  beforeAll(async () => {
    const c = await enabledConnector(api, admin, {
      organizationId: w.orgA.id,
      code: uniq("qa-a17-wh-").toLowerCase(),
      adapterKind: "webhook",
      targetTransformationId: k.transformationId,
      adapterSettings: {},
    });
    connectorId = c.id;
    const ep = await call<Loose>(api.app, "POST", WEBHOOKS, {
      session: admin,
      body: {
        connectorId,
        label: "Synthetic A17 sender",
        signingSecretRef: { provider: "env", name: SECRET_VAR },
        toleranceSeconds: 300,
      },
    });
    expect(ep.status, JSON.stringify(ep.body)).toBe(201);
    expect(JSON.stringify(ep.body)).not.toContain(SECRET); // a reference only, never the value
    endpointKey = ep.body.endpointKey;
    expect(ep.body.receivePath).toBe(`/api/v1/webhooks/${endpointKey}`);
    periods = await openPeriods(5);
    payload = {
      templateVersion: "kpi_actual.v1",
      items: webhookItems(a17Rows(kpis, k.transformationId, periods, "QA-WH")),
    };
    body = Buffer.from(JSON.stringify(payload));
  });

  const now = () => String(Math.floor(Date.now() / 1000));
  // The object is sent (Fastify inject serializes it with JSON.stringify: exactly `body`'s bytes), so the harness
  // validates the request against the contract's WebhookDelivery schema.
  const post = (headers: Record<string, string>) =>
    call<Loose>(api.app, "POST", `/api/v1/webhooks/${endpointKey}`, {
      headers: { "content-type": "application/json", ...headers },
      body: payload,
    });
  const receipts = async () =>
    (
      await api.db
        .selectFrom("webhook_receipt as r")
        .innerJoin("webhook_endpoint as e", "e.id", "r.webhook_endpoint_id")
        .select("r.id")
        .where("e.endpoint_key", "=", endpointKey)
        .execute()
    ).length;
  const batches = async () =>
    (await api.db.selectFrom("import_batch").select("id").where("connector_id", "=", connectorId).execute()).length;

  it("unsigned, wrongly signed, tampered and stale deliveries: 401 webhook.unauthenticated and nothing stored", async () => {
    const before = await actualsSnapshot();
    const ts = now();
    const cases: Array<[string, Record<string, string>, Buffer?]> = [
      [
        "unsigned (no signature header)",
        { "x-mth-webhook-timestamp": ts, "x-mth-webhook-delivery": "qa-a17-unsigned-01" },
      ],
      [
        "signed with a wrong secret",
        {
          "x-mth-webhook-timestamp": ts,
          "x-mth-webhook-delivery": "qa-a17-wrong-0001",
          "x-mth-webhook-signature": signWebhook("not-the-secret", ts, "qa-a17-wrong-0001", body),
        },
      ],
      [
        "signature of another body (tampered)",
        {
          "x-mth-webhook-timestamp": ts,
          "x-mth-webhook-delivery": "qa-a17-tamper-001",
          "x-mth-webhook-signature": signWebhook(SECRET, ts, "qa-a17-tamper-001", Buffer.from('{"items":[]}')),
        },
      ],
      [
        "stale timestamp (one hour old, tolerance 300 s)",
        {
          "x-mth-webhook-timestamp": String(Number(ts) - 3600),
          "x-mth-webhook-delivery": "qa-a17-stale-0001",
          "x-mth-webhook-signature": signWebhook(SECRET, String(Number(ts) - 3600), "qa-a17-stale-0001", body),
        },
      ],
    ];
    for (const [what, headers] of cases) {
      const res = await post(headers);
      expect([what, res.status, res.body.code], JSON.stringify(res.body)).toEqual([
        what,
        401,
        "webhook.unauthenticated",
      ]);
      expect(String(res.headers["content-type"])).toContain("application/problem+json");
    }
    expect(await receipts()).toBe(0);
    expect(await batches()).toBe(0);
    expect(await actualsSnapshot()).toEqual(before);
  });

  it("a correctly signed delivery is accepted (202), staged 10 = 8 + 1 + 1, and its 8 valid rows commit; a replay changes nothing", async () => {
    const ts = now();
    const id = "qa-a17-signed-0001";
    const headers = {
      "x-mth-webhook-timestamp": ts,
      "x-mth-webhook-delivery": id,
      "x-mth-webhook-signature": signWebhook(SECRET, ts, id, body),
    };
    const before = await countActuals();
    const res = await post(headers);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ replay: false, rowsTotal: 10, rowsValid: 8, rowsInvalid: 1, rowsDuplicate: 1 });
    const batch = await call<Loose>(api.app, "GET", `${imports()}/${res.body.importBatchId}`, { session: k.s.kds });
    expect(batch.status).toBe(200);
    expect(batch.body).toMatchObject({
      sourceKind: "webhook",
      status: "staged",
      connectorId,
      webhookReceiptId: res.body.receiptId,
      mediaType: "application/json",
    });
    expect(await countActuals()).toBe(before); // staged, not committed (manual commit mode)
    const rs = await rowsOf(res.body.importBatchId);
    expect(rs.filter((r) => r.validationStatus === "valid")).toHaveLength(8);
    expect(rs.find((r) => r.rowNumber === 10)?.reasons.map((x: Loose) => x.code)).toContain(
      "import.row.value_not_decimal",
    );

    const committed = await commit(res.body.importBatchId, batch.body.version);
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(committed.body).toMatchObject({ status: "committed", rowsCommitted: 8 });
    expect(await countActuals()).toBe(before + 8);
    expect(decimalCanon((await slot(kpis.direct, periods[0]!))!.value)).toBe("120.5");

    const snapshot = await actualsSnapshot();
    const replay = await post(headers);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({ replay: true, importBatchId: res.body.importBatchId });
    expect(await receipts()).toBe(1);
    expect(await actualsSnapshot()).toEqual(snapshot);
  });
});

// ------------------------------------------------------------------ connectors

/** Executes the connector's due runs the way the API process does, until `runId` is final. */
async function driveRun(connectorId: string, runId: string): Promise<Loose> {
  return waitFor(
    async () => {
      await connectorRunWatchStep(api.db, { onlyConnectors: [connectorId] });
      const d = await call<Loose>(api.app, "GET", `${CONNECTORS}/${connectorId}/runs/${runId}`, { session: admin });
      expect(d.status, JSON.stringify(d.body)).toBe(200);
      return ["succeeded", "failed", "cancelled"].includes(d.body.run.status) ? d.body : null;
    },
    `run ${runId} final`,
    45_000,
  );
}

async function runNow(connectorId: string, session: Session = admin): Promise<string> {
  const q = await call<Loose>(api.app, "POST", `${CONNECTORS}/${connectorId}/runs`, { session, body: {} });
  expect(q.status, JSON.stringify(q.body)).toBe(202);
  expect(q.body).toMatchObject({ status: "queued", triggerKind: "manual", attemptNo: 1 });
  return q.body.id as string;
}

async function exceptionsOf(code: string): Promise<Loose[]> {
  const res = await call<Loose>(
    api.app,
    "GET",
    `${EXCEPTIONS}?organizationId=${w.orgA.id}&sourceKind=connector&limit=100`,
    { session: admin },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as Loose[]).filter((e) => e.sourceCode === code);
}

describe("REQ-S17-001: a test connector run records last success, row counts, errors and retries", () => {
  it("a healthy run succeeds with row counts and sets last success; its staged batch keeps the 2 others with reasons", async () => {
    const periods = await openPeriods(5);
    const fixtureRows = a17Rows(kpis, k.transformationId, periods, "QA-TA").map((r) => {
      const { data_as_of: _d, ...rest } = r;
      return { ...rest, data_as_of: "2041-01-31" } as Record<string, string>;
    });
    const c = await enabledConnector(api, admin, {
      organizationId: w.orgA.id,
      code: uniq("qa-a17-ok-").toLowerCase(),
      adapterKind: "test_adapter",
      targetTransformationId: k.transformationId,
      adapterSettings: { mode: "healthy", fixture: { rows: fixtureRows, controlColumn: "value" } },
    });
    const runId = await runNow(c.id);
    const detail = await driveRun(c.id, runId);
    expect(detail.run).toMatchObject({
      status: "succeeded",
      rowsRead: 10,
      rowsStaged: 10,
      rowsRejected: 1,
      rowsDuplicate: 1,
      errorCode: null,
    });
    expect(detail.run.importBatchId).toEqual(expect.any(String));
    expect(detail.actionableError).toBeNull();
    const page = await call<Loose>(api.app, "GET", `${CONNECTORS}/${c.id}`, { session: k.s.auditor });
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.lastSuccessAt).toBe(detail.run.finishedAt);
    expect(page.body.lastRun).toMatchObject({ id: runId, status: "succeeded" });
    // A run only stages; the batch keeps the invalid and duplicate rows with their reasons.
    const rs = await rowsOf(detail.run.importBatchId);
    expect(rs.filter((r) => r.validationStatus === "valid")).toHaveLength(8);
    expect(rs.filter((r) => r.validationStatus !== "valid").every((r) => r.reasons.length > 0)).toBe(true);
  });

  it("a failing run records its error and its retry (attempt 2, retry of attempt 1); counts stay Unknown, never 0", async () => {
    const c = await enabledConnector(api, admin, {
      organizationId: w.orgA.id,
      code: uniq("qa-a17-retry-").toLowerCase(),
      adapterKind: "test_adapter",
      targetTransformationId: k.transformationId,
      adapterSettings: { mode: "failing", kpiId: kpis.direct },
      retryMaxAttempts: 1,
    });
    const first = await runNow(c.id);
    const d1 = await driveRun(c.id, first);
    expect(d1.run).toMatchObject({ status: "failed", errorCode: "connector.source_unavailable", attemptNo: 1 });
    expect(d1.run.rowsRead).toBeNull();
    expect(d1.run.rowsCommitted).toBeNull();
    expect(d1.retriedByRunId).toEqual(expect.any(String));
    const d2 = await driveRun(c.id, d1.retriedByRunId);
    expect(d2.run).toMatchObject({
      status: "failed",
      triggerKind: "retry",
      attemptNo: 2,
      retryOfRunId: first,
      errorCode: "connector.source_unavailable",
    });
    expect(d2.retriedByRunId).toBeNull(); // bounded: retryMaxAttempts 1
    const list = await call<Loose>(api.app, "GET", `${CONNECTORS}/${c.id}/runs`, { session: admin });
    expect(list.body.items.map((r: Loose) => [r.attemptNo, r.status])).toEqual([
      [2, "failed"],
      [1, "failed"],
    ]);
    const page = await call<Loose>(api.app, "GET", `${CONNECTORS}/${c.id}`, { session: admin });
    expect(page.body).toMatchObject({ lastSuccessAt: null, verification: "not_verified" });
  });
});

describe("failing connector (REQ-S12-019, A17): one exception, the KPI shows Stale with its last value and date, no silent data change", () => {
  it("the failure chain opens exactly one operational exception linked to the stale KPI; nothing in the KPI data changes", async () => {
    // A KPI whose last accepted actual is older than its staleAfterDays (D-197 item 3): a past period, data as of 2026-01-31.
    const stale = await ownedKpi(api, k, DIRECT_FLOW);
    const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
    const office = await signIn(api.app, w.office.subject);
    const p = await call<Loose>(api.app, "POST", base, {
      session: office,
      body: { frequency: "monthly", periodLabel: "2026-01", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const opened = await call<Loose>(api.app, "POST", `${base}/${p.body.id}/open`, {
      session: office,
      headers: ifm(p.body.version),
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const actual = await submitActual(api, k, stale.id, {
      reportingPeriodId: p.body.id,
      value: "250.75",
      dataAsOf: "2026-01-31",
    });
    expect(actual.status, JSON.stringify(actual.body)).toBe(201);
    // The panel of the period of the KPI's last value (the default panel is the newest period, where this KPI has no
    // actual yet and is rightly Unknown).
    const status = async () => {
      const s = await call<Loose>(
        api.app,
        "GET",
        `${k.base}/kpi-definitions/${stale.id}/status?scopeKind=transformation&scopeId=${k.transformationId}&reportingPeriodId=${p.body.id}`,
        {
          session: k.s.auditor,
        },
      );
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      return s.body;
    };
    // The panel is computed by the worker's recalculation after the accepted actual (pending until then).
    const st0 = await waitFor(
      async () => {
        const b = await status();
        return b.actualReason === "kpi.calculation_pending" ? null : b;
      },
      "the KPI panel's recalculation",
      45_000,
    );
    expect(st0.freshness).toMatchObject({ status: "stale", dataAsOf: "2026-01-31" });
    expect(decimalCanon(st0.actual)).toBe("250.75");
    // Time moves on: a later monthly reporting period is open, and the failing connector (the KPI's feed) delivers
    // nothing for it. This is why a connector failure matters (M0239 "retain last known values with freshness
    // labels"): the KPI's last known value stays the 2026-01 one. Opened here explicitly, so the scenario does not
    // depend on the order of the other tests in this file (which also open later periods).
    await monthlyPeriod(api, w);

    const c = await enabledConnector(api, admin, {
      organizationId: w.orgA.id,
      code: uniq("qa-a17-fail-").toLowerCase(),
      adapterKind: "test_adapter",
      targetTransformationId: k.transformationId,
      adapterSettings: { mode: "failing", kpiId: stale.id },
      retryMaxAttempts: 1,
    });
    const snapshot = await actualsSnapshot();
    const first = await runNow(c.id);
    const d1 = await driveRun(c.id, first);
    expect(d1.run.status).toBe("failed");
    const d2 = await driveRun(c.id, d1.retriedByRunId);
    expect(d2.run).toMatchObject({ status: "failed", errorCode: "connector.source_unavailable", importBatchId: null });

    // Exactly one exception for the whole failure chain (two failed attempts), raised by the worker.
    const [exception] = await waitFor(
      async () => {
        const e = await exceptionsOf(c.code);
        return e.length > 0 ? e : null;
      },
      "the connector's operational exception",
      45_000,
    );
    await new Promise((r) => setTimeout(r, 1500)); // let any second (duplicate) event land before counting
    const all = await exceptionsOf(c.code);
    expect(all, JSON.stringify(all)).toHaveLength(1);
    expect(exception).toMatchObject({
      sourceKind: "connector",
      status: "open",
      lastErrorCode: "connector.source_unavailable",
    });
    expect(["connector_run_failed", "connector_unreachable"]).toContain(exception.failureClass);
    // REQ-S12-019 "shown to admins and data owners" (ADR-0053 §2 "Readable links only"; D-202 option (a)).
    // The technical administrator (ADM_TECH + ADM_ACCESS, no transformation.read) sees the exception and that it is
    // linked to one KPI, but only as a count: the KPI is never named, valued or dated to them.
    const adminDetail = await call<Loose>(api.app, "GET", `${EXCEPTIONS}/${exception.id}`, { session: admin });
    expect(adminDetail.status, JSON.stringify(adminDetail.body)).toBe(200);
    expect(adminDetail.body, JSON.stringify(adminDetail.body)).toMatchObject({
      id: exception.id,
      status: "open",
      linkedKpiCount: 1,
      hiddenKpiCount: 1,
      linkedKpis: [],
    });
    // Holders of transformation.read at the KPI's transformation, its data owner (the KDS assigned there) and the
    // organization's auditor (AUD), see the stale KPI itself with its Stale label, last value and date (ADR-0053 §2
    // acceptance fixture). The date is the actual's dataAsOf 2026-01-31 in Asia/Riyadh.
    const riyadhDate = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", dateStyle: "short" }).format(new Date(iso));
    for (const [who, session] of [
      ["KDS", k.s.kds],
      ["AUD", k.s.auditor],
    ] as const) {
      // Soft per role, so one run reports both readers; any soft failure still fails the test.
      const d = await call<Loose>(api.app, "GET", `${EXCEPTIONS}/${exception.id}`, { session });
      expect(d.status, `${who}: ${JSON.stringify(d.body)}`).toBe(200);
      expect.soft(d.body, `${who}: ${JSON.stringify(d.body)}`).toMatchObject({
        id: exception.id,
        linkedKpiCount: 1,
        hiddenKpiCount: 0,
      });
      expect.soft(d.body.linkedKpis, `${who}: ${JSON.stringify(d.body.linkedKpis)}`).toHaveLength(1);
      const linked: Loose = (d.body.linkedKpis as Loose[])[0] ?? {};
      expect.soft(linked, `${who}: ${JSON.stringify(linked)}`).toMatchObject({
        kpiDefinitionId: stale.id,
        transformationId: k.transformationId,
        freshness: "stale",
      });
      expect.soft(decimalCanon(linked.lastValue), `${who}: ${JSON.stringify(linked)}`).toBe("250.75");
      expect.soft(linked.lastValueAt, `${who}: ${JSON.stringify(linked)}`).toEqual(expect.any(String));
      expect
        .soft(linked.lastValueAt && riyadhDate(linked.lastValueAt), `${who}: ${JSON.stringify(linked)}`)
        .toBe("2026-01-31");
    }
    // Negative: a user of another organization gets neither the exception nor its KPI (contract: 403 or 404).
    const outside = await call<Loose>(api.app, "GET", `${EXCEPTIONS}/${exception.id}`, { session: k.s.outsider });
    expect([403, 404], JSON.stringify(outside.body)).toContain(outside.status);
    expect(JSON.stringify(outside.body)).not.toContain(stale.id);

    // The KPI keeps its last value and date, labelled Stale; no KPI actual of the transformation changed.
    const st1 = await status();
    expect(st1.freshness).toMatchObject({ status: "stale", dataAsOf: "2026-01-31" });
    expect(decimalCanon(st1.actual)).toBe("250.75");
    expect(await actualsSnapshot()).toEqual(snapshot);
    const page = await call<Loose>(api.app, "GET", `${CONNECTORS}/${c.id}`, { session: admin });
    expect(page.body.actionableError).toMatchObject({
      runId: d2.run.id,
      errorCode: "connector.source_unavailable",
      attemptNo: 2,
      fallbacks: expect.arrayContaining(["kpi_form", "import_file"]),
    });
    expect(page.body.lastSuccessAt).toBeNull();
  });
});

describe("stopped connector (REQ-S17-005, A17): actionable error, one exception, no silent data change; the form and the import keep working", () => {
  it("the connector page shows which run failed, why and the fallbacks; a KPI actual is still submitted by form and a file still imports", async () => {
    const c = await enabledConnector(api, admin, {
      organizationId: w.orgA.id,
      code: uniq("qa-a17-stop-").toLowerCase(),
      adapterKind: "test_adapter",
      targetTransformationId: k.transformationId,
      adapterSettings: { mode: "stopped", kpiId: kpis.direct },
      retryMaxAttempts: 0,
    });
    const snapshot = await actualsSnapshot();
    const runId = await runNow(c.id);
    const d = await driveRun(c.id, runId);
    expect(d.run).toMatchObject({ status: "failed", errorCode: "connector.stopped", importBatchId: null });
    expect(d.actionableError).toMatchObject({ runId, errorCode: "connector.stopped" });
    expect(await actualsSnapshot()).toEqual(snapshot); // no silent data change

    const page = await call<Loose>(api.app, "GET", `${CONNECTORS}/${c.id}`, { session: k.s.kds });
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body).toMatchObject({ status: "enabled", verification: "not_verified", lastSuccessAt: null });
    expect(page.body.actionableError).toMatchObject({
      runId,
      triggerKind: "manual",
      attemptNo: 1,
      errorCode: "connector.stopped",
    });
    expect(page.body.actionableError.fallbacks).toEqual(expect.arrayContaining(["kpi_form", "import_file"]));
    expect(page.body.actionableError.finishedAt).toEqual(expect.any(String));

    const [exception] = await waitFor(
      async () => {
        const e = await exceptionsOf(c.code);
        return e.length > 0 ? e : null;
      },
      "the stopped connector's operational exception",
      45_000,
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(await exceptionsOf(c.code)).toHaveLength(1);
    expect(exception).toMatchObject({ status: "open", lastErrorCode: "connector.stopped" });

    // Fallback 1: the KPI actual by form.
    const [period] = await openPeriods(1);
    const pid = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("period_label", "=", period!)
      .executeTakeFirstOrThrow();
    const byForm = await submitActual(api, k, kpis.direct, { reportingPeriodId: pid.id, value: "77.125" });
    expect(byForm.status, JSON.stringify(byForm.body)).toBe(201);
    expect(decimalCanon((await slot(kpis.direct, period!))!.value)).toBe("77.125");
    // Fallback 2: a file import.
    const [p2] = await openPeriods(1);
    const one = csvFile(header, [
      {
        source_record_id: "QA-FB-01",
        kpi_id: kpis.review,
        scope_kind: "transformation",
        scope_id: k.transformationId,
        period_label: p2!,
        value: "8.5",
        data_as_of: "2041-01-31",
      },
    ]);
    const staged = await upload(one, CSV, "qa-a17-fallback.csv");
    expect(staged.status, JSON.stringify(staged.body)).toBe(201);
    expect(staged.body).toMatchObject({ status: "staged", rowsValid: 1 });
    const committed = await commit(staged.body.id, staged.body.version);
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(decimalCanon((await slot(kpis.review, p2!))!.value)).toBe("8.5");
  });
});
