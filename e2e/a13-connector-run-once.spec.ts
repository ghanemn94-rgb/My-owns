// A13 "Durable automation", the user-visible path of a P6 connector run (qa-verifier, T-DG6-QA-C; REQ-S20-013,
// REQ-S16-022 IntegrationRun). Acceptance (§20 A13; requirements.csv REQ-S20-013): "Retried events, worker restarts
// and partial failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable".
// The kill-and-restart drills themselves run against real processes in tests/qa/integration/a13-p6-*.test.ts (a
// browser cannot kill the API it is served by); this spec checks what an administrator SEES of the same guarantees on
// the REAL stack (apps/web/e2e/support/with-stack.sh: the API process executes due runs with its run watch):
//  1. `dev.admin` (ADM_TECH) opens the connector page and presses "Run now": the page says the run is queued;
//  2. a retried request for another run while that one is active is refused (409 connector.run_active): no second
//     run is created;
//  3. the run history shows the run with its counts Unknown (never 0) until it ran, then exactly ONE run, Succeeded,
//     with 3 rows read and 3 staged (the configured 3-row fixture), and Unknown committed rows (a run never commits).
// Asserted in English (LTR) and Arabic (RTL): <html lang/dir>, the texts from the catalogues, axe with 0
// serious/critical issues, no request off the application origin, no engineering-gate name in product text.
// Screenshots: E2E_SCREENSHOT_DIR/<lang>/a13-*.png. All data is SYNTHETIC; a run approves nothing.
import { expect, test } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  trackRequests,
  type ApiSession,
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
let admin: ApiSession;
let cid: string;

/** Every column of the shipped kpi_actual.v1 template; the KPI id exists nowhere, so the rows stage as invalid. */
const COLUMNS = [
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
];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  admin = await apiSession(playwright, "dev.admin");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A13 connector target ${lang.toUpperCase()}`,
      mode: "end_to_end",
    })
  ).id;
  const rows = [1, 2, 3].map((n) => ({
    ...Object.fromEntries(COLUMNS.map((c) => [c, ""])),
    source_record_id: `SYN-E2E-${n}`,
    kpi_id: "01920000-0000-7000-9999-0000000000a1",
    scope_kind: "transformation",
    scope_id: tid,
    period_label: `2041-0${n}`,
    value: `${n}.5`,
    data_as_of: "2041-01-31",
  }));
  const created = await admin.call<Body>("POST", "/api/v1/admin/connectors", {
    organizationId: ORG,
    code: `qa-a13-e2e-${lang}`,
    nameEn: `Synthetic QA A13 source ${lang.toUpperCase()}`,
    nameAr: `مصدر اختبار اصطناعي ${lang.toUpperCase()}`,
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: {
      sourceSystemId: `synthetic.kpi-source:qa-a13-e2e-${lang}`,
      endpointUrl: null,
      credentialRefs: {},
      fieldMappings: [],
      targetTransformationId: tid,
      cadence: "manual",
      retryMaxAttempts: 0,
      retryBackoffSeconds: 60,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "row_count",
      adapterSettings: { mode: "healthy", fixture: { rows, controlColumn: "value" } },
      reason: "Synthetic connector for the QA A13 e2e.",
    },
  });
  cid = created.id as string;
  await admin.call("POST", `/api/v1/admin/connectors/${cid}/enable`, { reason: "Synthetic enable." }, { ifMatch: 1 });
});

test("A13: one press of Run now gives one run; a retried request is refused; the run completes once", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/integrations/connectors/${cid}`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.getByText(tr(lang, "integrations.runs.none"), { exact: true }).first()).toBeVisible();
  await expectAccessible(page, lang, "a13-connector");

  await page.getByRole("button", { name: tr(lang, "integrations.connector.runNow"), exact: true }).click();
  await expect(page.getByText(tr(lang, "integrations.connector.runQueued"))).toBeVisible();

  // A retried request for another run while this one is active creates nothing.
  const retried = await admin.call<Body>("POST", `/api/v1/admin/connectors/${cid}/runs`, {}, { expect: 409 });
  const runs = async () =>
    (await admin.call<Body>("GET", `/api/v1/admin/connectors/${cid}/runs?limit=50`)).items as Body[];
  expect([retried.code, (await runs()).length]).toEqual(["connector.run_active", 1]);

  // The API's run watch executes it (every 10 s); the page shows the outcome after a reload.
  await expect
    .poll(async () => (await runs()).map((r) => r.status), { timeout: 60_000, intervals: [1000] })
    .toEqual(["succeeded"]);
  await page.reload();
  const history = page.getByRole("table", { name: tr(lang, "integrations.runs.title") });
  await expect(history).toBeVisible();
  const bodyRows = history.locator("tbody tr");
  await expect(bodyRows, "exactly one run").toHaveCount(1);
  const row = bodyRows.first();
  await expect(row).toContainText(tr(lang, "integrations.runStatus.succeeded"));
  await expect(row, "a run never commits: committed rows Unknown").toContainText(tr(lang, "common.value.unknown"));
  const [only] = await runs();
  expect([only.rowsRead, only.rowsStaged, only.rowsCommitted]).toEqual([3, 3, null]);
  await expectAccessible(page, lang, "a13-connector-run-once");
  await shot(page, lang, "a13-connector-run-once");

  const text = (await page.locator("body").innerText()).toUpperCase();
  expect(text, "no engineering-gate name in product text").not.toMatch(/\bDG[0-7]\b/);
  expect(foreign, "no request leaves the application origin").toEqual([]);
});
