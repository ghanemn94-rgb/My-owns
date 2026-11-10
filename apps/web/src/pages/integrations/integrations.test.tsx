// T-DG6-FE-C (p6-work-split §B/A.9; ADR-0055 §1-§6, ADR-0056 §2-§6; REQ-S17-001, REQ-S17-002, REQ-S17-005,
// REQ-S01-005): the Integrations, Imports and external-change screens against a scripted API (SYNTHETIC data), in
// English LTR and Arabic RTL.
//  - Connector: "Not verified" until a test succeeds, "Never succeeded" without a success, counts "Unknown" when null,
//    the actionable error (which run, why, what to do) with its two fallback links; AUD reads with no write control.
//  - Run: the retry chain and the retry (POST, then the new attempt).
//  - Outbound write: requested and pending_confirmation are "Pending confirmation", never "Confirmed".
//  - Import batch: row reasons rendered in en and ar, the draft label of a staged batch, commit with If-Match, AUD
//    without commit; a staging batch shows Unknown counts.
//  - External change: Unconfirmed is never green; a connector confirmation shows its provenance; flagging sends
//    If-Match "0".
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import {
  ORG_ID,
  TR_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import type { ImportBatch, ImportRow } from "../imports/api.ts";
import type { Connector, IntegrationRun, OutboundWrite } from "./api.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions },
];
const ADM_TECH: Permission[] = [
  "connector.read",
  "connector.configure",
  "connector.run",
  "webhook.configure",
  "organization.read",
];
const AUD: Permission[] = [
  "connector.read",
  "import.read",
  "outbound_write.read",
  "organization.read",
  "transformation.read",
];
const KDS: Permission[] = [
  "connector.read",
  "connector.run",
  "import.read",
  "import.create",
  "import.commit",
  "outbound_write.read",
  "organization.read",
  "transformation.read",
];
let userLocale: "en" | "ar" = "en";
const meRoute = (permissions: Permission[]): Handler =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: userLocale }),
  }));
const i18nFor = (locale: "en" | "ar") => {
  userLocale = locale;
  return createI18n(locale);
};

const CONNECTOR_ID = "01920000-0000-7000-c000-000000000001";
const RUN_FAILED = "01920000-0000-7000-c000-000000000011";
const RUN_RETRY = "01920000-0000-7000-c000-000000000012";
const BATCH_ID = "01920000-0000-7000-c000-000000000021";
const WRITE_ID = "01920000-0000-7000-c000-000000000031";
const DELIVERABLE_ID = "01920000-0000-7000-c000-000000000041";
const KPI_ID = "01920000-0000-7000-c000-000000000051";

function run(over: Partial<IntegrationRun> = {}): IntegrationRun {
  return {
    id: RUN_FAILED,
    connectorId: CONNECTOR_ID,
    configVersionNo: 1,
    triggerKind: "manual",
    status: "failed",
    attemptNo: 1,
    retryOfRunId: null,
    idempotencyKey: "run-key-0001",
    requestedBy: null,
    serviceIdentityId: "01920000-0000-7000-c000-000000000099",
    queuedAt: "2026-10-30T08:00:00Z",
    startedAt: "2026-10-30T08:00:01Z",
    finishedAt: "2026-10-30T08:00:02Z",
    rowsRead: null,
    rowsStaged: null,
    rowsCommitted: null,
    rowsRejected: null,
    rowsDuplicate: null,
    errorCount: null,
    errorCode: "connector.stopped",
    errorMessage: null,
    reconciliation: { status: "not_checked", sourceRowCount: null, sourceControlTotal: null, stagedControlTotal: null },
    importBatchId: null,
    version: 3,
    ...over,
  };
}

function connector(over: Partial<Connector> = {}): Connector {
  return {
    id: CONNECTOR_ID,
    organizationId: ORG_ID,
    code: "syn-kpi-feed",
    nameEn: "Synthetic KPI feed",
    nameAr: "تغذية مؤشرات اصطناعية",
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    status: "enabled",
    statusReason: null,
    config: {
      versionNo: 2,
      sourceSystemId: "SYN-SRC-1",
      endpointUrl: null,
      credentialRefs: { api: { provider: "env", name: "SYN_FEED_TOKEN", resolvable: null } },
      fieldMappings: [],
      targetTransformationId: TR_ID,
      cadence: "daily",
      retryMaxAttempts: 2,
      retryBackoffSeconds: 60,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "row_count",
      adapterSettings: { mode: "stopped" },
      reason: "Synthetic configuration",
      createdAt: "2026-10-29T08:00:00Z",
      createdBy: "01920000-0000-7000-9000-000000000201",
    },
    verification: "not_verified",
    lastSuccessAt: null,
    lastRun: run(),
    actionableError: {
      runId: RUN_FAILED,
      triggerKind: "manual",
      attemptNo: 1,
      finishedAt: "2026-10-30T08:00:02Z",
      errorCode: "connector.stopped",
      params: {},
      fallbacks: ["kpi_form", "import_file"],
    },
    serviceIdentityId: "01920000-0000-7000-c000-000000000099",
    version: 4,
    updatedAt: "2026-10-30T08:00:02Z",
    ...over,
  };
}

const connectorRoutes = (c: Connector = connector()): Handler[] => [
  route("GET", /\/api\/v1\/organizations(\?|$)/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
  route("GET", /\/api\/v1\/admin\/connectors\?/, () => ({ status: 200, body: { items: [c], nextCursor: null } })),
  route("GET", new RegExp(`/api/v1/admin/connectors/${CONNECTOR_ID}$`), () => ({ status: 200, body: c })),
  route("GET", new RegExp(`/api/v1/admin/connectors/${CONNECTOR_ID}/runs(\\?|$)`), () => ({
    status: 200,
    body: { items: [run()], nextCursor: null },
  })),
];

describe.each(LOCALES)("connectors (%s)", (locale) => {
  it("shows Not verified, Never succeeded, Unknown counts and the actionable error with both fallbacks", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(meRoute(ADM_TECH), ...connectorRoutes());
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}`, { i18n });
    const panel = await screen.findByText(t("integrations.actionable.title"));
    const section = panel.closest("section")!;
    expect(within(section).getByText(t("integrations.actionable.connector__stopped.why"))).toBeTruthy();
    expect(within(section).getByText(t("integrations.actionable.connector__stopped.todo"))).toBeTruthy();
    const form = within(section).getByRole("link", { name: t("integrations.actionable.fallback.kpi_form") });
    const file = within(section).getByRole("link", { name: t("integrations.actionable.fallback.import_file") });
    expect(form.getAttribute("href")).toBe(`/transformations/${TR_ID}/kpis`);
    expect(file.getAttribute("href")).toBe(`/transformations/${TR_ID}/imports`);
    expect(screen.getAllByText(t("integrations.verification.not_verified")).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-last-success="never"]')?.textContent).toContain(
      t("integrations.lastSuccess.never"),
    );
    // run history: null counts are Unknown, never 0
    const table = await screen.findByRole("table", { name: t("integrations.runs.title") });
    expect(within(table).getAllByText(t("common.value.unknown")).length).toBeGreaterThanOrEqual(6);
    expect(within(table).queryByText("0")).toBeNull();
    expect(within(table).getByText(t("integrations.reconciliation.not_checked"))).toBeTruthy();
    // ADM_TECH sees the configure controls; the secret reference is a reference only, its state Not checked
    expect(screen.getByRole("button", { name: t("integrations.connector.test") })).toBeTruthy();
    expect(screen.getByText("env:SYN_FEED_TOKEN")).toBeTruthy();
    expect(document.querySelector('[data-resolvable="null"]')?.textContent).toContain(
      t("integrations.credentials.notChecked"),
    );
  });

  it("gives AUD a read-only view: no test, run, edit, enable or disable control", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(meRoute(AUD), ...connectorRoutes());
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}`, { i18n });
    await screen.findByText(t("integrations.actionable.title"));
    expect(document.querySelector("[data-read-only]")).toBeTruthy();
    for (const k of ["test", "runNow", "disable", "enable"])
      expect(screen.queryByRole("button", { name: t(`integrations.connector.${k}`) })).toBeNull();
    expect(screen.queryByRole("link", { name: t("integrations.connector.edit") })).toBeNull();
  });

  it("queues a manual run with an Idempotency-Key and shows the one form-level alert on a 409", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    const api = mockApi(
      meRoute(ADM_TECH),
      route("POST", /\/runs$/, () => ({
        status: 409,
        body: {
          type: "urn:mth:problem:conflict",
          title: "x",
          status: 409,
          code: "connector.run_active",
          requestId: "r",
        },
      })),
      ...connectorRoutes(),
    );
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}`, { i18n });
    fireEvent.click(await screen.findByRole("button", { name: t("integrations.connector.runNow") }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t("problems.connector__run_active"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lists connectors with their verification and last success", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(
      meRoute(ADM_TECH),
      ...connectorRoutes(connector({ verification: "verified", lastSuccessAt: "2026-10-29T09:00:00Z" })),
    );
    renderApp("/admin/integrations", { i18n });
    const table = await screen.findByRole("table", { name: t("integrations.connectors.title") });
    expect(within(table).getByText(t("integrations.verification.verified"))).toBeTruthy();
    expect(within(table).queryByText(t("integrations.lastSuccess.never"))).toBeNull();
    expect(
      within(table).getByRole("link", { name: locale === "ar" ? "تغذية مؤشرات اصطناعية" : "Synthetic KPI feed" }),
    ).toBeTruthy();
  });
});

// F-DG6-102: the budget of each step of the retry chain (POST, then the refetch and navigation, then the new attempt's
// render), and of the test. Measured (docs/delivery/handbacks/DG6/T-DG6-FE-Y1-evidence/f102-measure-chain.log and
// f102-before-after-loaded.log; MTH_UNIT_WEB_TIMING_REPORT=1 prints the marks): run alone at a 1-minute load of 24-29 on
// 4 CPUs, click to rendered took at most 1.9 s (slowest step 1.4 s); in the whole file at a load of 31-36 the test took
// at most 27.3 s, its first render included. Each step gets 15 s (about 8x the slowest chain) and the test 60 s (2x).
const RETRY_CHAIN_WAIT = { timeout: 15_000 };
const RETRY_CHAIN_TEST_TIMEOUT_MS = 60_000;

describe("integration run detail", () => {
  it(
    "shows the retry chain and retries a failed run once",
    async () => {
      const i18n = i18nFor("en");
      const t = i18n.t.bind(i18n);
      let retried = false;
      const api = mockApi(
        meRoute(KDS),
        route("POST", new RegExp(`/runs/${RUN_FAILED}/retry$`), () => {
          retried = true;
          return {
            status: 202,
            body: run({ id: RUN_RETRY, status: "queued", attemptNo: 2, retryOfRunId: RUN_FAILED }),
          };
        }),
        route("GET", new RegExp(`/runs/${RUN_RETRY}$`), () => ({
          status: 200,
          body: {
            run: run({ id: RUN_RETRY, status: "queued", attemptNo: 2, retryOfRunId: RUN_FAILED, errorCode: null }),
            retriedByRunId: null,
            events: [],
            actionableError: null,
          },
        })),
        route("GET", new RegExp(`/runs/${RUN_FAILED}$`), () => ({
          status: 200,
          body: {
            run: run(),
            retriedByRunId: retried ? RUN_RETRY : null,
            events: [
              {
                recordVersion: 1,
                status: "queued",
                rowsRead: null,
                rowsStaged: null,
                rowsCommitted: null,
                rowsRejected: null,
                rowsDuplicate: null,
                errorCount: null,
                errorCode: null,
                occurredAt: "2026-10-30T08:00:00Z",
              },
            ],
            actionableError: connector().actionableError,
          },
        })),
        ...connectorRoutes(),
      );
      renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/runs/${RUN_FAILED}`, { i18n });
      expect(await screen.findByText(t("integrations.run.firstAttempt"), {}, RETRY_CHAIN_WAIT)).toBeTruthy();
      expect(screen.getByText(t("integrations.run.notRetried"))).toBeTruthy();
      // F-DG6-102: after the click the page posts the retry, refetches the integrations queries, navigates to the new
      // attempt and fetches it. Each step is awaited on its own, with the measured RETRY_CHAIN_WAIT budget, instead of
      // one findBy* with the 5 s default covering the whole chain (which failed in 2 of 3 runs at a load of about 20).
      const started = performance.now();
      const mark: Record<string, number> = {};
      const since = () => Math.round(performance.now() - started);
      fireEvent.click(screen.getByRole("button", { name: t("integrations.run.retry") }));
      await waitFor(
        () => expect(api.requests.some((r) => r.method === "POST" && /retry$/.test(r.url))).toBe(true),
        RETRY_CHAIN_WAIT,
      );
      mark["post"] = since();
      // The navigation to the new attempt: its detail is requested (only the new route asks for RUN_RETRY).
      await waitFor(
        () =>
          expect(api.requests.some((r) => r.method === "GET" && new RegExp(`/runs/${RUN_RETRY}$`).test(r.url))).toBe(
            true,
          ),
        RETRY_CHAIN_WAIT,
      );
      mark["navigated"] = since();
      // The new attempt is rendered: its heading names attempt 2, and it links back to the failed attempt.
      const nextHeading = t("integrations.run.heading", {
        trigger: t(`integrations.trigger.${run().triggerKind}`),
        attempt: 2,
      });
      await screen.findByRole("heading", { level: 1, name: nextHeading }, RETRY_CHAIN_WAIT);
      expect(
        await screen.findByRole("link", { name: t("integrations.run.openPrevious") }, RETRY_CHAIN_WAIT),
      ).toBeTruthy();
      mark["rendered"] = since();
      if (process.env["MTH_UNIT_WEB_TIMING_REPORT"] === "1") {
        process.stderr.write(`[retry-chain] ${JSON.stringify(mark)} ms\n`);
      }
    },
    RETRY_CHAIN_TEST_TIMEOUT_MS,
  );
});

describe("T-DG6-BE-Z13C (D-228 (2), (3); D-227, D-218): the restricted label on the run detail", () => {
  const detailRoutes = (masked: boolean): Handler[] => [
    route("GET", new RegExp(`/runs/${RUN_FAILED}$`), () => ({
      status: 200,
      body: {
        run: run({
          errorCode: "connector.secret_unresolvable",
          ...(masked
            ? {
                idempotencyKey: "manual:01920000-0000-7000-9000-000000000201:vr-[restricted]",
                errorMessage: "The secret reference z13c-[restricted] could not be resolved. {name=z13c-[restricted]}",
                includesRestrictedRecords: true as const,
              }
            : {}),
        }),
        retriedByRunId: null,
        events: [],
        actionableError: {
          runId: RUN_FAILED,
          triggerKind: "manual",
          attemptNo: 1,
          finishedAt: "2026-10-30T08:00:02Z",
          errorCode: "connector.secret_unresolvable",
          params: { name: masked ? "z13c-[restricted]" : "SYN_FEED_TOKEN" },
          fallbacks: ["kpi_form", "import_file"],
          ...(masked ? { includesRestrictedRecords: true as const } : {}),
        },
      },
    })),
    ...connectorRoutes(),
  ];

  for (const locale of LOCALES) {
    it(`${locale}: a run whose key or error text is masked shows the item label on its key and its actionable error`, async () => {
      const i18n = i18nFor(locale);
      const t = i18n.t.bind(i18n);
      mockApi(meRoute(AUD), ...detailRoutes(true));
      renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/runs/${RUN_FAILED}`, { i18n });
      const key = await screen.findByText("manual:01920000-0000-7000-9000-000000000201:vr-[restricted]");
      const onKey = key.closest("dd")?.querySelector("[data-restricted-records='true']");
      expect(onKey?.getAttribute("data-restricted-scope")).toBe("item");
      expect(onKey?.getAttribute("title")).toBe(t("adminP6.restricted.hintItem"));
      expect(onKey?.textContent).toContain(t("access.includesRestrictedRecords"));
      const why = document.querySelector("[data-why]");
      expect(why?.querySelector("[data-restricted-records='true']")?.getAttribute("data-restricted-scope")).toBe(
        "item",
      );
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it("a run without the marker shows no label", async () => {
    const i18n = i18nFor("en");
    mockApi(meRoute(AUD), ...detailRoutes(false));
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/runs/${RUN_FAILED}`, { i18n });
    await screen.findByText("run-key-0001");
    await waitFor(() => expect(document.querySelector("[data-why]")).not.toBeNull());
    expect(document.querySelector("[data-restricted-records]")).toBeNull();
  });
});

function write(over: Partial<OutboundWrite> = {}): OutboundWrite {
  return {
    id: WRITE_ID,
    transformationId: TR_ID,
    connectorId: CONNECTOR_ID,
    configVersionNo: 2,
    actionCode: "deliverable_status_push",
    deliverableId: DELIVERABLE_ID,
    idempotencyKey: "push-0001-key",
    payload: {},
    payloadSha256: "a".repeat(64),
    status: "requested",
    attemptCount: 1,
    lastAttemptAt: "2026-10-30T08:00:00Z",
    externalReference: null,
    confirmedAt: null,
    failureCode: null,
    failureMessage: null,
    requestedBy: "01920000-0000-7000-9000-000000000201",
    createdAt: "2026-10-30T08:00:00Z",
    version: 1,
    ...over,
  };
}

describe.each(LOCALES)("outbound writes (%s)", (locale) => {
  it("shows requested and pending_confirmation as Pending confirmation, never Confirmed", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(
      meRoute(KDS),
      route("GET", new RegExp(`/api/v1/transformations/${TR_ID}$`), () => ({
        status: 200,
        body: makeTransformation(),
      })),
      route("GET", /\/outbound-writes(\?|$)/, () => ({
        status: 200,
        body: {
          items: [write(), write({ id: `${WRITE_ID.slice(0, -1)}2`, status: "pending_confirmation" })],
          nextCursor: null,
        },
      })),
    );
    renderApp(`/transformations/${TR_ID}/outbound-writes`, { i18n });
    const table = await screen.findByRole("table", { name: t("integrations.outbound.title") });
    expect(within(table).getAllByText(t("integrations.outbound.status.pending_confirmation"))).toHaveLength(2);
    expect(table.querySelectorAll('[data-status="confirmed"]')).toHaveLength(0);
    expect(table.querySelectorAll('[data-status="requested"], [data-status="pending_confirmation"]')).toHaveLength(2);
  });
});

function batch(over: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: BATCH_ID,
    transformationId: TR_ID,
    targetKind: "kpi_actual",
    templateVersion: "kpi_actual.v1",
    formSchemaVersionId: "01920000-0000-7000-c000-000000000061",
    sourceKind: "csv_upload",
    connectorId: null,
    integrationRunId: null,
    webhookReceiptId: null,
    fileName: "synthetic-actuals.csv",
    mediaType: "text/csv",
    byteSize: 812,
    contentSha256: "b".repeat(64),
    status: "staged",
    rowsTotal: 10,
    rowsValid: 8,
    rowsInvalid: 1,
    rowsDuplicate: 1,
    rowsCommitted: null,
    failureCode: null,
    commitMode: "manual",
    onBehalfOfUserId: null,
    committedAt: null,
    committedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-10-30T08:00:00Z",
    createdBy: "01920000-0000-7000-9000-000000000201",
    version: 1,
    ...over,
  };
}

function row(n: number, over: Partial<ImportRow> = {}): ImportRow {
  return {
    id: `01920000-0000-7000-c100-${String(n).padStart(12, "0")}`,
    rowNumber: n,
    sourceRecordId: `SRC-${n}`,
    raw: { kpi_id: KPI_ID, value: "12.5" },
    normalized: { value: "12.5" },
    duplicateKey: "k",
    validationStatus: "valid",
    duplicateOfRowNumber: null,
    reasons: [],
    commitStatus: "pending",
    lineage: null,
    ...over,
  };
}

const TEMPLATE = {
  templateVersion: "kpi_actual.v1",
  targetKind: "kpi_actual",
  titleEn: "KPI actuals",
  titleAr: "القيم الفعلية للمؤشرات",
  mediaTypes: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  columns: [
    { key: "value", labelEn: "Value", labelAr: "القيمة", required: false, kind: "decimal", example: "12.5" },
    { key: "kpi_id", labelEn: "KPI ID", labelAr: "معرّف المؤشر", required: true, kind: "uuid", example: null },
  ],
};

const importRoutes = (b: ImportBatch, rows: ImportRow[]): Handler[] => [
  route("GET", new RegExp(`/api/v1/transformations/${TR_ID}$`), () => ({ status: 200, body: makeTransformation() })),
  route("GET", /\/api\/v1\/import-templates$/, () => ({ status: 200, body: { items: [TEMPLATE] } })),
  route("GET", new RegExp(`/imports/${BATCH_ID}$`), () => ({ status: 200, body: b })),
  route("GET", new RegExp(`/imports/${BATCH_ID}/rows`), () => ({
    status: 200,
    body: { items: rows, nextCursor: null },
  })),
];

describe.each(LOCALES)("import batch (%s)", (locale) => {
  const rows = [
    row(2),
    row(3, {
      validationStatus: "invalid",
      normalized: null,
      reasons: [{ code: "import.row.value_not_decimal", field: "value", params: { value: "12,5" } }],
      commitStatus: "pending",
    }),
    row(4, {
      validationStatus: "duplicate_in_batch",
      normalized: null,
      duplicateOfRowNumber: 2,
      reasons: [{ code: "import.row.duplicate_in_batch", field: null, params: { firstRow: 2 } }],
    }),
  ];

  it("renders each row reason in the reader's language and labels the staged batch as not committed", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(meRoute(KDS), ...importRoutes(batch(), rows));
    renderApp(`/transformations/${TR_ID}/imports/${BATCH_ID}`, { i18n });
    const table = await screen.findByRole("table", { name: t("imports.rows.title") });
    const label = locale === "ar" ? "القيمة" : "Value";
    expect(
      await within(table).findByText(
        t("imports.reason.import__row__value_not_decimal", { field: label, value: "12,5" }),
      ),
    ).toBeTruthy();
    expect(within(table).getByText(t("imports.reason.import__row__duplicate_in_batch", { firstRow: 2 }))).toBeTruthy();
    expect(document.querySelector("[data-draft-label]")?.textContent).toContain(t("imports.batch.stagedNotCommitted"));
    expect(screen.getByRole("button", { name: t("imports.batch.commit") })).toBeTruthy();
  });

  it("commits the valid rows with If-Match and gives AUD no commit control", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    const api = mockApi(
      meRoute(KDS),
      route("POST", /\/commit$/, () => ({
        status: 200,
        body: batch({ status: "committed", rowsCommitted: 8, version: 2 }),
      })),
      ...importRoutes(batch(), rows),
    );
    renderApp(`/transformations/${TR_ID}/imports/${BATCH_ID}`, { i18n });
    fireEvent.click(await screen.findByRole("button", { name: t("imports.batch.commit") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST" && /commit$/.test(r.url))).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"1"');
    expect(post.body).toEqual({ note: null });
    cleanup();
    mockApi(meRoute(AUD), ...importRoutes(batch(), rows));
    renderApp(`/transformations/${TR_ID}/imports/${BATCH_ID}`, { i18n });
    await screen.findByRole("table", { name: t("imports.rows.title") });
    expect(screen.queryByRole("button", { name: t("imports.batch.commit") })).toBeNull();
    expect(document.querySelector("[data-read-only]")).toBeTruthy();
  });

  it("shows Unknown counts while a batch is staging, never 0", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(
      meRoute(KDS),
      ...importRoutes(
        batch({ status: "staging", rowsTotal: null, rowsValid: null, rowsInvalid: null, rowsDuplicate: null }),
        [],
      ),
    );
    renderApp(`/transformations/${TR_ID}/imports/${BATCH_ID}`, { i18n });
    await screen.findByText(t("imports.batch.factsTitle"));
    const facts = screen.getByText(t("imports.batch.factsTitle")).closest("section")!;
    expect(within(facts).getAllByText(t("common.value.unknown")).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole("button", { name: t("imports.batch.commit") })).toBeNull();
  });
});

// F-DG6-222 (REQ-S15-011): a credential reference IT has not bound to this connector (D-209). The API answers 400
// validation with the field error at the reference's pointer; the form marks that credential row and says why in the
// reader's language, and an error the form shows no field for is said in its one alert (never "check the highlighted
// fields" with nothing highlighted).
const validation400 = (errors: { pointer: string; code: string }[]) => ({
  status: 400,
  body: {
    type: "urn:mth:problem:validation",
    title: "Validation failed",
    status: 400,
    code: "validation",
    requestId: "r",
    errors: errors.map((e) => ({ ...e, message: "English diagnostics only" })),
  },
});

describe.each(LOCALES)("connector form: an unbound secret reference (%s)", (locale) => {
  const editRoutes = (put: Parameters<typeof route>[2]): Handler[] => [
    meRoute(ADM_TECH),
    route("GET", /\/api\/v1\/transformations\?/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    route("PUT", new RegExp(`/api/v1/admin/connectors/${CONNECTOR_ID}$`), put),
    ...connectorRoutes(
      connector({
        config: {
          ...connector().config,
          credentialRefs: {
            api: { provider: "env", name: "MTH_SECRET_SYN_FEED", resolvable: null },
            backup: { provider: "env", name: "MTH_SECRET_SYN_BACKUP", resolvable: null },
          },
        },
      }),
    ),
  ];
  const save = async (t: (k: string) => string) => {
    fireEvent.change(await screen.findByLabelText(new RegExp(t("integrations.field.reason"))), {
      target: { value: "Synthetic reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("integrations.form.save") }));
  };

  it("marks the credential row the pointer names and says IT has not bound it", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    const api = mockApi(
      ...editRoutes(() =>
        validation400([{ pointer: "/config/credentialRefs/backup", code: "validation.secret_ref_not_bound" }]),
      ),
    );
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/edit`, { i18n });
    await save(t);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t("problems.validation"));
    const text = t("problems.validation__secret_ref_not_bound");
    expect(text).not.toBe("");
    expect(locale === "ar" ? /[؀-ۿ]/.test(text) : !/[؀-ۿ]/.test(text)).toBe(true);
    // the "backup" row (the second) is marked; its secret-name field says why and is invalid; the "api" row is not
    const rows = [...document.querySelectorAll<HTMLElement>("[data-credential-row]")];
    expect(rows.map((r) => r.getAttribute("data-credential-row"))).toEqual(["api", "backup"]);
    await waitFor(() => expect(rows[1]!.getAttribute("data-invalid")).toBe("true"));
    expect(rows[0]!.getAttribute("data-invalid")).toBeNull();
    expect(within(rows[1]!).getByText(text)).toBeTruthy();
    const name = within(rows[1]!).getByLabelText(t("integrations.credentials.secretName"));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!.split(" ").pop()!)?.textContent).toContain(
      text,
    );
    expect(document.querySelectorAll(".field--invalid")).toHaveLength(1);
    // the server's English message is never shown; one alert only
    expect(document.body.textContent).not.toContain("English diagnostics only");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const put = api.requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"4"');
  });

  it("says a host error the form shows no field for inside its one alert", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    // a test adapter shows no endpoint field: /config/endpointUrl has nothing to highlight
    mockApi(
      ...editRoutes(() =>
        validation400([{ pointer: "/config/endpointUrl", code: "validation.secret_ref_host_not_bound" }]),
      ),
    );
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/edit`, { i18n });
    await save(t);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert.textContent).toContain(t("problems.validation__secret_ref_host_not_bound")));
    expect(document.querySelectorAll(".field--invalid")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("English diagnostics only");
  });
});

// F-DG6-281 (REQ-S17-001; T-DG6-FE-Z3): the stored target of a kpi_actual connector is a transformation the
// administrator cannot list (a technical administrator without transformation.read, ADR-0051 §7). The required select
// shows that a target is set ("A transformation you cannot view" with its id), keeps it selectable, and a save keeps
// the stored value. No other read is made for it.
describe.each(LOCALES)("connector form: a target the administrator cannot view (%s)", (locale) => {
  const editRoutes = (listed: ReturnType<typeof makeTransformation>[]): Handler[] => [
    meRoute(ADM_TECH),
    route("GET", /\/api\/v1\/transformations\?/, () => ({ status: 200, body: { items: listed, nextCursor: null } })),
    route("PUT", new RegExp(`/api/v1/admin/connectors/${CONNECTOR_ID}$`), (req) => ({
      status: 200,
      body: {
        ...connector(),
        version: 5,
        config: { ...connector().config, ...(req.body as { config: object }).config },
      },
    })),
    ...connectorRoutes(),
  ];
  const targetSelect = async (t: (k: string) => string) =>
    (await screen.findByLabelText(new RegExp(t("integrations.field.targetTransformation")))) as HTMLSelectElement;

  it("shows the stored target as set, keeps it selectable, and saves it unchanged", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    const api = mockApi(...editRoutes([]));
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/edit`, { i18n });
    const select = await targetSelect(t);
    const unreadable = i18n.t("integrations.field.targetUnreadable", { id: TR_ID });
    await waitFor(() => expect(select.selectedOptions[0]?.textContent).toBe(unreadable));
    expect(select.value).toBe(TR_ID);
    expect(unreadable).toContain(TR_ID);
    expect(locale === "ar" ? /[؀-ۿ]/.test(unreadable) : !/[؀-ۿ]/.test(unreadable)).toBe(true);
    expect(select.selectedOptions[0]!.textContent).not.toBe(t("common.form.choose"));
    // the hint says why, and the select is described by it
    const hint = t("integrations.field.targetStoredUnlistedHint");
    expect(document.getElementById(select.getAttribute("aria-describedby")!.split(" ")[0]!)?.textContent).toBe(hint);
    // selectable: choose nothing, then the stored target again
    const stored = [...select.options].find((o) => o.value === TR_ID)!;
    expect(stored.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "" } });
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: TR_ID } });
    expect(select.value).toBe(TR_ID);
    // save keeps the stored value
    fireEvent.change(await screen.findByLabelText(new RegExp(t("integrations.field.reason"))), {
      target: { value: "Synthetic reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("integrations.form.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = api.requests.find((r) => r.method === "PUT")!;
    expect((put.body as { config: { targetTransformationId: string } }).config.targetTransformationId).toBe(TR_ID);
    // nothing beyond the list is read for the stored target
    expect(api.requests.some((r) => r.method === "GET" && new RegExp(`/transformations/${TR_ID}`).test(r.url))).toBe(
      false,
    );
  });

  it("shows the listed target by its code and name, with no extra option", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(...editRoutes([makeTransformation()]));
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/edit`, { i18n });
    const select = await targetSelect(t);
    await waitFor(() => expect(select.selectedOptions[0]?.textContent).toBe("TR-0001 · Synthetic retail journey"));
    expect(select.querySelector("[data-stored-target]")).toBeNull();
    expect(select.getAttribute("aria-describedby")).toBeNull();
  });

  // F-DG6-301: the form places /config/commitOnBehalfOf on its field with its own text, not the generic one
  it("says why an automatic commit needs an on-behalf-of user, in the reader's language", async () => {
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    mockApi(
      meRoute(ADM_TECH),
      route("GET", /\/api\/v1\/transformations\?/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
      route("PUT", new RegExp(`/api/v1/admin/connectors/${CONNECTOR_ID}$`), () =>
        validation400([{ pointer: "/config/commitOnBehalfOf", code: "validation.commit_on_behalf_of" }]),
      ),
      ...connectorRoutes(),
    );
    renderApp(`/admin/integrations/connectors/${CONNECTOR_ID}/edit`, { i18n });
    fireEvent.change(await screen.findByLabelText(new RegExp(t("integrations.field.reason"))), {
      target: { value: "Synthetic reason" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("integrations.form.save") }));
    const text = t("problems.validation__commit_on_behalf_of");
    expect(text).not.toBe(t("problems.validation__invalid"));
    expect(locale === "ar" ? /[؀-ۿ]/.test(text) : !/[؀-ۿ]/.test(text)).toBe(true);
    await waitFor(() => expect(document.body.textContent).toContain(text));
    expect(document.body.textContent).not.toContain("English diagnostics only");
  });
});

// F-DG6-222: the webhook signing-secret rotation names a reference IT has not bound to webhook signing (D-209): 400 at
// /signingSecretRef marks the secret-name field with the localized reason.
describe.each(LOCALES)("webhook rotation: an unbound signing secret (%s)", (locale) => {
  it("marks the secret name and says IT has not bound it", async () => {
    const WEBHOOK_ID = "01920000-0000-7000-c000-000000000061";
    const endpoint = {
      id: WEBHOOK_ID,
      organizationId: ORG_ID,
      connectorId: CONNECTOR_ID,
      endpointKey: "syn-key",
      receivePath: "/api/v1/webhooks/syn-key",
      label: "Synthetic webhook",
      signingSecretRef: { provider: "env", name: "MTH_SECRET_SYN_SIGN" },
      previousSecretRef: null,
      previousValidUntil: null,
      secretRotatedAt: null,
      toleranceSeconds: 300,
      status: "active",
      disabledAt: null,
      disabledBy: null,
      disableReason: null,
      lastReceiptAt: null,
      version: 2,
      updatedAt: "2026-10-30T08:00:00Z",
    };
    const i18n = i18nFor(locale);
    const t = i18n.t.bind(i18n);
    const api = mockApi(
      meRoute(ADM_TECH),
      route("GET", new RegExp(`/api/v1/admin/webhooks/${WEBHOOK_ID}$`), () => ({ status: 200, body: endpoint })),
      route("POST", /\/rotate-secret$/, () =>
        validation400([{ pointer: "/signingSecretRef", code: "validation.secret_ref_not_bound" }]),
      ),
      ...connectorRoutes(),
    );
    renderApp(`/admin/integrations/webhooks/${WEBHOOK_ID}`, { i18n });
    fireEvent.click(await screen.findByRole("button", { name: t("integrations.webhooks.rotate") }));
    const form = document.querySelector<HTMLElement>("form[data-rotate-form]")!;
    fireEvent.change(within(form).getByLabelText(new RegExp(`^${t("integrations.credentials.secretName")}`)), {
      target: { value: "MTH_SECRET_SYN_SIGN_2" },
    });
    fireEvent.change(within(form).getByLabelText(new RegExp(`^${t("integrations.field.reason")}`)), {
      target: { value: "Synthetic rotation" },
    });
    fireEvent.click(within(form).getByRole("button", { name: t("integrations.webhooks.rotateSubmit") }));
    const text = t("problems.validation__secret_ref_not_bound");
    expect(await within(form).findByText(text)).toBeTruthy();
    const name = within(form).getByLabelText(new RegExp(`^${t("integrations.credentials.secretName")}`));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(form.querySelectorAll(".field--invalid")).toHaveLength(1);
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("English diagnostics only");
    expect(api.requests.find((r) => r.method === "POST")!.headers["if-match"]).toBe('"2"');
  });
});
