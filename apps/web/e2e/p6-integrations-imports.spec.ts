// Administration > Integrations and Strategy and KPIs > Imports against the REAL API (apps/web/e2e/support/with-stack.sh;
// T-DG6-FE-C; p6-work-split §B/A.9; ADR-0055, ADR-0056). All data is SYNTHETIC: a transformation, a connector on the
// local TEST ADAPTER (mode "stopped"), and a synthetic KDS user scoped to the transformation. Nothing here is "live" or
// connected to a Mobily system; nothing is a business approval; nothing touches the engineering delivery gates.
//  - REQ-S17-001 / S17-005: the connector is "Not verified" and "Never succeeded"; "Test now" with the adapter stopped
//    records a failed run, and the connector page shows the actionable error (which run, why, what to do) with the two
//    fallback links; the run page shows Unknown counts and the retry chain; AUD sees the same page read-only.
//  - REQ-S17-002 / S17-003: a KDS user uploads a CSV (UTF-8) with the template's header; the staged batch shows each row
//    with its reason in the page language and is labelled "Staged – not committed".
// Every screen is checked with axe (no serious or critical violation) and captured in EN and AR.
// Budget (rule 13/15): 120 s per test. Measured on the 4-core sandbox with other agents running (load average 18.4-18.7):
// 17.1 s (en) and 17.2 s (ar) for the connector test, 6.2 s and 7.1 s for the import test; 120 s is about 7x the loaded
// worst case (handback evidence e2e-p6-integrations-imports.txt).
import { expect, test } from "@playwright/test";
import { syntheticUser } from "./support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const ORG_ID = "01920000-0000-7000-9000-000000000001";
const HEADER =
  "source_record_id,kpi_id,kpi_name,scope_kind,scope_id,period_label,value,numerator,denominator,milestone_achieved,achieved_on,currency,missing_reason,data_as_of,comment";

interface Connector {
  id: string;
  version: number;
}

test("a stopped test connector: Not verified, Never succeeded, a failed test run and its actionable error; AUD read-only", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const stamp = Date.now();
  const lead = await apiSession(playwright, "dev.lead");
  const tr1 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-C ${lang.toUpperCase()} integrations ${stamp}`,
    mode: "end_to_end",
  });
  const admin = await apiSession(playwright, "dev.admin");
  const connector = await admin.call<Connector>("POST", "/api/v1/admin/connectors", {
    organizationId: ORG_ID,
    code: `syn-fec-${lang}-${stamp}`,
    nameEn: `Synthetic KPI feed ${lang.toUpperCase()}`,
    nameAr: `تغذية مؤشرات اصطناعية ${lang.toUpperCase()}`,
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: {
      sourceSystemId: "SYN-SOURCE-1",
      endpointUrl: null,
      credentialRefs: {},
      fieldMappings: [],
      targetTransformationId: tr1.id,
      cadence: "manual",
      retryMaxAttempts: 0,
      retryBackoffSeconds: 60,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "row_count",
      adapterSettings: { mode: "stopped" },
      reason: "Synthetic e2e connector (test adapter, stopped)",
    },
  });
  await lead.req.dispose();
  await admin.req.dispose();

  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/integrations");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "integrations.connectors.title"));
  const list = page.getByRole("table", { name: tr(lang, "integrations.connectors.title") });
  await expect(list).toContainText(tr(lang, "integrations.verification.not_verified"));
  await expect(list).toContainText(tr(lang, "integrations.lastSuccess.never"));
  await expectAccessible(page, lang, "fec-connectors");
  await shot(page, lang, "fec-connectors");

  await page.goto(`/admin/integrations/connectors/${connector.id}`);
  await expect(page.locator("[data-last-success='never']")).toContainText(tr(lang, "integrations.lastSuccess.never"));
  await page.getByRole("button", { name: tr(lang, "integrations.connector.test"), exact: true }).click();
  // A failed test is announced as a warning, never in the success style.
  await expect(page.locator("[data-notice='warning']")).toContainText(tr(lang, "integrations.connector.testFailed"));
  const error = page.locator("[data-actionable-error='connector.stopped']");
  await expect(error).toBeVisible();
  await expect(error.locator("[data-why]")).toHaveText(tr(lang, "integrations.actionable.connector__stopped.why"));
  await expect(error.locator("[data-what-to-do]")).toHaveText(
    tr(lang, "integrations.actionable.connector__stopped.todo"),
  );
  await expect(error.locator("[data-fallback='kpi_form']")).toHaveAttribute("href", `/transformations/${tr1.id}/kpis`);
  await expect(error.locator("[data-fallback='import_file']")).toHaveAttribute(
    "href",
    `/transformations/${tr1.id}/imports`,
  );
  // Still not verified and never succeeded: a failed test proves nothing.
  await expect(page.locator("[data-status='not_verified']").first()).toBeVisible();
  await expectAccessible(page, lang, "fec-connector-actionable-error");
  await shot(page, lang, "fec-connector-actionable-error");

  // The run page: counts Unknown (never 0), the retry chain (first attempt).
  await error.getByRole("link").first().click();
  await expect(page.locator("main#main h1")).toContainText(String(1));
  await expect(page.locator("[data-retry-chain]")).toContainText(tr(lang, "integrations.run.firstAttempt"));
  await expectAccessible(page, lang, "fec-run");
  await shot(page, lang, "fec-run");

  // The fallback still works while the connector is stopped: the import page opens (REQ-S17-005).
  await page.goto(`/transformations/${tr1.id}/imports`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "imports.title"));

  // AUD: the same connector, read-only.
  await page.getByRole("button", { name: tr(lang, "auth.signOut"), exact: true }).click();
  await page.waitForURL("**/login**");
  await signIn(page, lang, "dev.auditor");
  await page.goto(`/admin/integrations/connectors/${connector.id}`);
  await expect(page.locator("[data-actionable-error='connector.stopped']")).toBeVisible();
  await expect(page.locator("[data-read-only]")).toBeVisible();
  await expect(page.getByRole("button", { name: tr(lang, "integrations.connector.test"), exact: true })).toHaveCount(0);
  await expectAccessible(page, lang, "fec-connector-aud");
  await shot(page, lang, "fec-connector-aud");
  expect(foreign).toEqual([]);
});

test("a KDS user stages a CSV: each row shows its reason in the page language; the batch is Staged – not committed", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const stamp = Date.now();
  const lead = await apiSession(playwright, "dev.lead");
  const tr1 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-C ${lang.toUpperCase()} imports ${stamp}`,
    mode: "end_to_end",
  });
  await lead.req.dispose();
  const admin = await apiSession(playwright, "dev.admin");
  const kds = await syntheticUser(
    admin,
    ORG_ID,
    tr1.id,
    `syn.fec.kds.${lang}.${stamp}`,
    `Synthetic KPI data steward ${lang.toUpperCase()}`,
    "KDS",
    lang,
  );
  await admin.req.dispose();

  await signIn(page, lang, kds.username);
  await page.goto(`/transformations/${tr1.id}/imports`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "imports.title"));
  await expect(page.locator("[data-template='kpi_actual.v1']")).toBeVisible();
  await expect(page.locator("[data-download='csv']")).toHaveAttribute("href", /format=csv/);
  const csv = [
    HEADER,
    "SYN-1,01920000-0000-7000-9000-00000000feed,,transformation,,2026-10,12.5,,,,,,,,",
    'SYN-2,01920000-0000-7000-9000-00000000feed,,transformation,,2026-10,"12,5",,,,,,,,',
  ].join("\n");
  await page.locator("[data-upload-form] input[type='file']").setInputFiles({
    name: "synthetic-actuals.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${csv}\n`, "utf8"),
  });
  await page.getByRole("button", { name: tr(lang, "imports.upload.submit") }).click();
  await page.waitForURL(`**/transformations/${tr1.id}/imports/*`);
  const rows = page.getByRole("table", { name: tr(lang, "imports.rows.title") });
  await expect(rows.locator("[data-reason='import.row.kpi_unknown']").first()).toBeVisible();
  await expect(rows.locator("[data-reason='import.row.value_not_decimal']")).toHaveCount(1);
  // The reason text is rendered by the client in the page language (ADR-0056 §5), with the field's localized label.
  const kpiUnknown = rows.locator("[data-reason='import.row.kpi_unknown']").first();
  await expect(kpiUnknown).toContainText(lang === "ar" ? "المؤشر" : "KPI");
  await expect(rows.locator("[data-reason='import.row.required_missing']").first()).toContainText(
    lang === "ar" ? "مطلوب" : "is required",
  );
  await expect(page.locator("[data-draft-label]")).toContainText(tr(lang, "imports.batch.stagedNotCommitted"));
  // No valid row: no commit control, the reason is said, and the import can still be cancelled.
  await expect(page.locator("[data-nothing-to-commit]")).toHaveText(tr(lang, "imports.batch.nothingToCommit"));
  await expect(page.getByRole("button", { name: tr(lang, "imports.batch.commit") })).toHaveCount(0);
  await expectAccessible(page, lang, "fec-import-batch");
  await shot(page, lang, "fec-import-batch");
  expect(foreign).toEqual([]);
});
