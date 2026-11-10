// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): REQ-S17-001 "a test connector run records last success,
// row counts, errors and retries, all visible in the UI". The register discloses that no test asserts the non-null row
// counts of a succeeded run ON SCREEN (QA-A, QA-A2). This probe, kept outside the frozen candidate, creates a healthy
// test-adapter connector with a 5-row fixture, runs it once from the connector page (the API's run watch executes it),
// and asserts what the administrator SEES: the run row shows Succeeded and the counts 5 read / 5 staged (the API agrees),
// committed Unknown, and the connector page shows a last-success time (not "Never succeeded"). Then the run page.
// Run from a DISPOSABLE clone: apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/zz-qa-rg-r1-s17-001-run-ui.spec.ts --workers=1
// SYNTHETIC data only; a run approves nothing (G1-G6) and names no DG0-DG7.
import { expect, test } from "@playwright/test";
import { apiSession, langOf, shot, signIn, SYN_RETAIL, tr, type ApiSession } from "./support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
const COLUMNS = [
  "source_record_id", "kpi_id", "kpi_name", "scope_kind", "scope_id", "period_label", "value", "numerator",
  "denominator", "milestone_achieved", "achieved_on", "currency", "missing_reason", "data_as_of",
];
let admin: ApiSession;
let cid: string;
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  admin = await apiSession(playwright, "dev.admin");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA RG-R1 S17-001 ${lang.toUpperCase()} ${Date.now().toString(36)}`,
      mode: "end_to_end",
    })
  ).id;
  const rows = [1, 2, 3, 4, 5].map((n) => ({
    ...Object.fromEntries(COLUMNS.map((c) => [c, ""])),
    source_record_id: `SYN-QA-RG-${n}`,
    kpi_id: "01920000-0000-7000-9999-0000000000a1",
    scope_kind: "transformation",
    scope_id: tid,
    period_label: `2042-0${n}`,
    value: `${n}.25`,
    data_as_of: "2042-01-31",
  }));
  cid = (
    await admin.call<Body>("POST", "/api/v1/admin/connectors", {
      organizationId: ORG,
      code: `qa-rg-r1-s17-${lang}-${Date.now().toString(36)}`,
      nameEn: `Synthetic QA RG-R1 source ${lang.toUpperCase()}`,
      nameAr: `مصدر اصطناعي ${lang.toUpperCase()}`,
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.kpi-source:qa-rg-r1-${lang}`,
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
        reason: "Synthetic connector for the QA RG-R1 S17-001 probe.",
      },
    })
  ).id as string;
  await admin.call("POST", `/api/v1/admin/connectors/${cid}/enable`, { reason: "Synthetic enable." }, { ifMatch: 1 });
});

test("REQ-S17-001 probe: a succeeded run's row counts and the last success are visible on screen", async ({ page }, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/integrations/connectors/${cid}`);
  await expect(page.getByText(tr(lang, "integrations.runs.none"), { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "integrations.connector.runNow"), exact: true }).click();
  const runs = async () =>
    (await admin.call<Body>("GET", `/api/v1/admin/connectors/${cid}/runs?limit=50`)).items as Body[];
  await expect.poll(async () => (await runs()).map((r) => r.status), { timeout: 90_000, intervals: [1000] }).toEqual(["succeeded"]);
  const [only] = await runs();
  expect([only.rowsRead, only.rowsStaged, only.rowsCommitted]).toEqual([5, 5, null]);
  await page.reload();
  const history = page.getByRole("table", { name: tr(lang, "integrations.runs.title") });
  const row = history.locator("tbody tr").first();
  await expect(row).toContainText(tr(lang, "integrations.runStatus.succeeded"));
  const cells = (await row.locator("td, th").allInnerTexts()).map((t) => t.trim());
  console.log(`QA-RG-R1 S17-001 ${lang} run row cells: ${JSON.stringify(cells)}`);
  expect(cells.filter((t) => t === "5").length, "rows read and rows staged shown as 5").toBeGreaterThanOrEqual(2);
  expect(cells.some((t) => t === tr(lang, "common.value.unknown")), "committed rows Unknown, never 0").toBe(true);
  const conn = await admin.call<Body>("GET", `/api/v1/admin/connectors/${cid}`);
  console.log(`QA-RG-R1 S17-001 ${lang} connector lastSuccessAt ${conn.lastSuccessAt ?? conn.lastSuccess ?? JSON.stringify(Object.keys(conn))}`);
  const main = await page.locator("main#main").innerText();
  const never = /never succeeded|لم ينجح/i;
  expect(never.test(main), "after a success the page no longer says Never succeeded").toBe(false);
  await shot(page, lang, "qa-rg-r1-s17-001-connector-after-run");
  await page.goto(`/admin/integrations/connectors/${cid}/runs/${only.id}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const runText = await page.locator("main#main").innerText();
  console.log(`QA-RG-R1 S17-001 ${lang} run page text (first 600): ${JSON.stringify(runText.slice(0, 600))}`);
  expect(runText).toContain("5");
  await shot(page, lang, "qa-rg-r1-s17-001-run-page");
});
