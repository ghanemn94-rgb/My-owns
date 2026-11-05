// The connector edit screen when the stored target is a transformation the administrator cannot list, against the
// REAL API (apps/web/e2e/support/with-stack.sh). F-DG6-281, REQ-S17-001 "connectors record their mappings and targets"
// (T-DG6-FE-Z3). All data is SYNTHETIC; nothing here is a business approval and nothing touches the engineering
// delivery gates.
//  - dev.lead creates a transformation; dev.admin (who cannot list it: the precondition is checked through the API)
//    creates a test-adapter kpi_actual connector targeting it, then opens Administration > Integrations > the
//    connector > Edit.
//  - The required "Target transformation" select shows that a target is set ("A transformation you cannot view" with
//    its id, in the page language), never "Choose…"; a hint says it is kept on save and describes the select.
//  - The stored target stays selectable by keyboard: choose nothing, then the stored target again.
//  - Save: the PUT carries the stored target unchanged, the API answers 200 and reports the same target.
//  - No read of the transformation itself is made for it (nothing more is disclosed).
// Every screen is checked with axe and captured in EN and AR.
// Budget (rule 13/15): 90 s per test. Measured on the 4-core sandbox (T-DG6-FE-Z3 handback evidence
// 10-e2e-connector-target-run1.log alone, load average 1.8: 4.5 s en, 4.3 s ar; 11-e2e-touched-product-specs.log inside
// a 7-spec, 44-test run, load average 3.1-4.3: 3.8 s en, 3.9 s ar). 90 s is 20x the slowest run and covers the 4-6x
// slow-down seen on this host at a load average of about 18 (F-DG6-144 budget table).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
} from "./support/ui.ts";

const ORG_ID = "01920000-0000-7000-9000-000000000001";

test.describe.configure({ mode: "serial", timeout: 90_000 });

interface ConnectorBody {
  id: string;
  version: number;
  config: { versionNo: number; targetTransformationId: string | null };
}

test("connector edit: a stored target the administrator cannot view is shown as set, stays selectable and is kept on save", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const stamp = randomUUID().slice(0, 8);
  const lead = await apiSession(playwright, "dev.lead");
  const tr1 = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-Z3 ${lang.toUpperCase()} unlisted target ${stamp}`,
    mode: "end_to_end",
  });
  await lead.req.dispose();
  const admin = await apiSession(playwright, "dev.admin");
  // Precondition: the administrator cannot read the target (a list without it, and 403/404 on the record).
  const listed = await admin.call<{ items: { id: string }[] }>("GET", "/api/v1/transformations?limit=100");
  expect(listed.items.map((x) => x.id)).not.toContain(tr1.id);
  const direct = await admin.req.get(`/api/v1/transformations/${tr1.id}`);
  expect([403, 404]).toContain(direct.status());
  const connector = await admin.call<ConnectorBody>("POST", "/api/v1/admin/connectors", {
    organizationId: ORG_ID,
    code: `syn-fez3-${lang}-${stamp}`,
    nameEn: `Synthetic FE-Z3 feed ${lang.toUpperCase()}`,
    nameAr: `تغذية اصطناعية ${lang.toUpperCase()}`,
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: {
      sourceSystemId: `synthetic.kpi-source:fe-z3-${lang}`,
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
      adapterSettings: { mode: "healthy" },
      reason: "Synthetic connector for the unlisted-target check.",
    },
  });

  const transformationReads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/api/v1/transformations/${tr1.id}`)) transformationReads.push(r.url());
  });
  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/integrations/connectors/${connector.id}/edit`);
  const form = page.locator("form[data-connector-form]");
  await expect(form).toBeVisible({ timeout: 30_000 });
  const select = form.getByLabel(fieldLabel(lang, "integrations.field.targetTransformation"));
  const unreadable = tr(lang, "integrations.field.targetUnreadable", { id: tr1.id });
  await expect(select).toHaveValue(tr1.id);
  await expect(select.locator("option:checked")).toHaveText(unreadable);
  await expect(select.locator("option:checked")).not.toHaveText(tr(lang, "common.form.choose"));
  await expect(select).toHaveAccessibleDescription(tr(lang, "integrations.field.targetStoredUnlistedHint"));
  if (lang === "ar") expect(unreadable).toMatch(/[؀-ۿ]/);
  else expect(unreadable).not.toMatch(/[؀-ۿ]/);
  await expectAccessible(page, lang, "p6-connector-target-unlisted");
  await shot(page, lang, "p6-connector-target-unlisted");

  // Selectable by keyboard: focus, choose nothing, then the stored target again.
  await select.focus();
  await expect(select).toBeFocused();
  await select.selectOption("");
  await expect(select).toHaveValue("");
  await select.selectOption(tr1.id);
  await expect(select).toHaveValue(tr1.id);

  // Save keeps the stored value.
  await form.locator("textarea").last().fill("Synthetic: a save that keeps the stored target");
  const put = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/admin/connectors/${connector.id}`) && r.request().method() === "PUT",
  );
  await form.getByRole("button", { name: tr(lang, "integrations.form.save") }).click();
  const resp = await put;
  expect(resp.status()).toBe(200);
  expect((resp.request().postDataJSON() as { config: { targetTransformationId: string } }).config).toMatchObject({
    targetTransformationId: tr1.id,
  });
  await page.waitForURL(`**/admin/integrations/connectors/${connector.id}`);
  const after = await admin.call<ConnectorBody>("GET", `/api/v1/admin/connectors/${connector.id}`);
  expect(after.config.targetTransformationId).toBe(tr1.id);
  expect(after.config.versionNo).toBeGreaterThan(connector.config.versionNo);
  await admin.req.dispose();

  // The edit screen again: still shown as set.
  await page.goto(`/admin/integrations/connectors/${connector.id}/edit`);
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(select.locator("option:checked")).toHaveText(unreadable);
  expect(transformationReads).toEqual([]);
  expect(foreign).toEqual([]);
});
