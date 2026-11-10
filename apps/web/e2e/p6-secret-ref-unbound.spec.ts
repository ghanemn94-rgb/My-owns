// A secret reference IT has not bound (D-209; ADR-0052 §5 amendment of 2026-11-04) against the REAL API
// (apps/web/e2e/support/with-stack.sh, whose SECRET_BINDINGS_FILE binds only A17's webhook secret). F-DG6-222,
// REQ-S15-011 "the error state is handled explicitly". All data is SYNTHETIC; nothing here is a business approval and
// nothing touches the engineering delivery gates.
//  - Connector form: the administrator names a credential reference IT has not bound and saves. The API answers 400
//    validation with `validation.secret_ref_not_bound` at /config/credentialRefs/api. The form marks exactly that
//    credential row (its secret-name field is invalid and described by the reason) and says, in the page language,
//    that IT has not bound this secret to this setting. The server's English message and the raw code are never shown.
//  - Storage (a SecretRef form on the shared runner): "Test these values" with two unbound key references answers 400
//    at /candidate/accessKeyRef and /candidate/secretKeyRef; both reference boxes are marked with the localized reason.
// Every screen is checked with axe and captured in EN and AR.
// Budget (rule 13/15): 90 s per test. Measured on the 4-core sandbox (T-DG6-FE-Z2 handback evidence
// 30-e2e-secret-ref-run1.log alone, and 31-e2e-touched-product-specs.log inside an 8-spec run; load average 1.3-3.0):
// the connector test took at most 4.3 s and the storage test at most 3.8 s in en and ar. 90 s is about 20x the slowest
// run, which also covers the 4-6x slow-down seen on this host at a load average of about 18 (F-DG6-144 budget table).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

const ORG_ID = "01920000-0000-7000-9000-000000000001";
/** The server's English field-error texts (packages/config secret-bindings.ts); never the user-facing message. */
const SERVER_ENGLISH = /Name a secret IT bound to this setting\. IT binds each secret/;
const RAW_CODE = /secret_ref_not_bound|secret_ref_host_not_bound/;

test.describe.configure({ mode: "serial", timeout: 90_000 });

test("connector form: a credential reference IT has not bound marks its row and says why", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const stamp = randomUUID().slice(0, 8);
  const lead = await apiSession(playwright, "dev.lead");
  const tr1 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-Z2 ${lang.toUpperCase()} unbound secret ${stamp}`,
    mode: "end_to_end",
  });
  const admin = await apiSession(playwright, "dev.admin");
  const connector = await admin.call<{ id: string }>("POST", "/api/v1/admin/connectors", {
    organizationId: ORG_ID,
    code: `syn-fez2-${lang}-${stamp}`,
    nameEn: `Synthetic FE-Z2 feed ${lang.toUpperCase()}`,
    nameAr: `تغذية اصطناعية ${lang.toUpperCase()}`,
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: {
      sourceSystemId: `synthetic.kpi-source:fe-z2-${lang}`,
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
      reason: "Synthetic connector for the unbound-secret check.",
    },
  });

  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/integrations/connectors/${connector.id}/edit`);
  const form = page.locator("form[data-connector-form]");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByRole("button", { name: tr(lang, "integrations.credentials.add") }).click();
  const row = form.locator(".integrations-credential").last();
  await row.getByLabel(tr(lang, "integrations.credentials.purpose")).fill("api");
  await row.getByLabel(tr(lang, "integrations.credentials.provider")).fill("env");
  await row.getByLabel(tr(lang, "integrations.credentials.secretName")).fill(`MTH_SECRET_FE_Z2_NOT_BOUND`);
  await form.locator("textarea").last().fill("Synthetic: name the feed credential (unbound check)");
  const put = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/admin/connectors/${connector.id}`) && r.request().method() === "PUT",
  );
  await form.getByRole("button", { name: tr(lang, "integrations.form.save") }).click();
  const resp = await put;
  expect(resp.status()).toBe(400);
  const body = (await resp.json()) as { code: string; errors: { pointer: string; code: string }[] };
  expect(body.code).toBe("validation");
  expect(body.errors).toEqual([
    expect.objectContaining({ pointer: "/config/credentialRefs/api", code: "validation.secret_ref_not_bound" }),
  ]);

  // The one alert, and the row it points at: marked, its secret name invalid and described by the reason.
  const alert = form.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(tr(lang, "problems.validation"));
  const marked = form.locator("[data-credential-row='api']");
  await expect(marked).toHaveAttribute("data-invalid", "true");
  const reason = tr(lang, "problems.validation__secret_ref_not_bound");
  await expect(marked.locator(".field--invalid .field__error")).toHaveText(reason);
  const secretName = marked.getByLabel(tr(lang, "integrations.credentials.secretName"));
  await expect(secretName).toHaveAttribute("aria-invalid", "true");
  await expect(secretName).toHaveAccessibleDescription(reason);
  await expect(form.locator(".field--invalid")).toHaveCount(1);
  const text = await page.locator("main#main").innerText();
  expect(text).not.toMatch(SERVER_ENGLISH);
  expect(text).not.toMatch(RAW_CODE);
  if (lang === "ar") expect(reason).toMatch(/[؀-ۿ]/);
  // Keyboard: the marked field is reachable and focusable.
  await secretName.focus();
  await expect(secretName).toBeFocused();
  await expectAccessible(page, lang, "p6-connector-unbound-secret");
  await shot(page, lang, "p6-connector-unbound-secret");
  expect(foreign).toEqual([]);
});

test("storage: testing key references IT has not bound marks both references and says why", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/storage");
  const form = page.locator("form[data-form='storage-setting']");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.locator("input[name='storage-driver'][value='s3']").check();
  await form.locator("#storage-endpoint").fill("https://s3.example.invalid");
  await form.locator("#storage-region").fill("me-central-1");
  await form.locator("#storage-bucket").fill("mth-evidence-synthetic");
  await form.locator("#storage-access-key-provider").fill("env");
  await form.locator("#storage-access-key-name").fill("MTH_SECRET_FE_Z2_S3_ACCESS");
  await form.locator("#storage-secret-key-provider").fill("env");
  await form.locator("#storage-secret-key-name").fill("MTH_SECRET_FE_Z2_S3_SECRET");
  const post = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/storage/test"));
  await form.getByRole("button", { name: tr(lang, "adminP6.storage.test") }).click();
  const resp = await post;
  expect(resp.status()).toBe(400);
  const body = (await resp.json()) as { errors: { pointer: string; code: string }[] };
  expect(body.errors.map((e) => `${e.pointer} ${e.code}`).sort()).toEqual([
    "/candidate/accessKeyRef validation.secret_ref_not_bound",
    "/candidate/secretKeyRef validation.secret_ref_not_bound",
  ]);
  const reason = tr(lang, "problems.validation__secret_ref_not_bound");
  for (const id of ["storage-access-key", "storage-secret-key"]) {
    const box = form.locator(`[data-secret-ref='${id}']`);
    await expect(box).toHaveAttribute("data-error-code", "validation.secret_ref_not_bound");
    await expect(box.locator(".field__error")).toHaveText(reason);
    await expect(form.locator(`#${id}-name`)).toHaveAttribute("aria-invalid", "true");
    await expect(form.locator(`#${id}-name`)).toHaveAccessibleDescription(reason);
  }
  await expect(form.locator("[data-error-code]")).toHaveCount(2);
  const text = await page.locator("main#main").innerText();
  expect(text).not.toMatch(SERVER_ENGLISH);
  expect(text).not.toMatch(RAW_CODE);
  await expectAccessible(page, lang, "p6-storage-unbound-secret");
  await shot(page, lang, "p6-storage-unbound-secret");
  expect(foreign).toEqual([]);
});
