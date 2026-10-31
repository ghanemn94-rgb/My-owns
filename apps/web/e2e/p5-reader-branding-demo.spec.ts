// The playbook reader, Branding Settings, the environment screen and the walkthrough against the REAL API
// (apps/web/e2e/support/with-stack.sh; T-DG5-FE-G; slices I and J). The e2e stack's database has no environment marker,
// so it is a production database (ADR-0050 §1, fail-safe): no synthetic label appears, the walkthrough and the demo
// reset are refused with environment.not_demo, and nothing is reset. All data is SYNTHETIC (seeded dev users and a
// transformation created here). Every screen is checked with axe (no serious or critical violation) and captured in EN
// and AR. Nothing here is a business approval, and nothing touches the engineering delivery gates.
//  - REQ-S03-010 / PB-001 / PB-002 / PB-011 / PB-077: About shows B0004 verbatim and the Source / Used for table;
//    "value pools" finds Diagnose blocks with marked matches; a 1-character query is refused in the field; badges and
//    question tags in en and ar; the Realize phase shows B0124.
//  - REQ-S02-004: B0031 links to the T01 register of the transformation, and the T01 form links back to B0031.
//  - REQ-S03-010: "Launch" on the gate-review procedure (B0023) creates a procedure instance.
//  - REQ-S15-004 / S01-002: publishing a new product name and primary colour changes the shell header and the
//    navigation theme without a reload of the code; the original settings are published back at the end. A prohibited
//    claim is refused with its translated 422; the auditor gets the no-permission state.
//  - REQ-S03-007: the Workstream Lead's navigation (from /me/navigation) has no Administration.
//  - REQ-S18-001 / S18-004: production shows no synthetic banner; the walkthrough and the reset say environment.not_demo.
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
} from "./support/ui.ts";

const B0004 =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";

test("Reader: About (B0004 verbatim), search with marks and its refusal, badges and the Realize note (Transformation Office)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/playbook/reader");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.reader.title"));
  const statement = page.locator("[data-source-text='statement'] [data-verbatim='en']");
  await expect(statement).toHaveText(B0004);
  await expect(page.locator("[data-table='source-foundations'] tbody tr")).toHaveCount(3);
  await expect(page.locator("[data-list='guiding-questions'] > li")).toHaveCount(4);
  // Badges: every template is a custom extension with exactly one question tag (REQ-PB-002, REQ-PB-011).
  const t01 = page.locator("[data-element='template.T01']");
  await expect(t01).toContainText(tr(lang, "playbookP5.provenance.custom_extension"));
  await expect(t01).toContainText(tr(lang, "playbookP5.question.why_change"));
  await expect(page.locator("[data-table='element-profiles']")).not.toContainText(/PMI standard|certified/i);
  await expectAccessible(page, lang, "p5-feg-reader");
  await shot(page, lang, "p5-feg-reader");
  // The refusal: a 1-character query is refused in the field and nothing is searched.
  const search = page.locator("form[data-form='reader-search']");
  const query = search.getByLabel(new RegExp(tr(lang, "playbookP5.search.query")));
  await query.fill("v");
  await search.getByRole("button", { name: tr(lang, "playbookP5.search.submit"), exact: true }).click();
  await expect(search).toContainText(tr(lang, "problems.validation__search_query"));
  // "value pools" (English) returns the Diagnose blocks, with the matches marked.
  await query.fill("value pools");
  await search.getByLabel(tr(lang, "playbookP5.search.lang")).selectOption("en");
  await search.getByRole("button", { name: tr(lang, "playbookP5.search.submit"), exact: true }).click();
  const hits = page.locator("[data-list='search-results'] > li");
  await expect(hits.first()).toBeVisible();
  await expect(page.locator("[data-list='search-results'] > li[data-phase='diagnose']").first()).toBeVisible();
  await expect(hits.first().locator("mark").first()).toBeVisible();
  await shot(page, lang, "p5-feg-search");
  // Realize guidance (REQ-PB-077).
  await page.locator("select[data-filter='phase']").selectOption("realize");
  await expect(page.locator("[data-state='realize-guidance']")).toContainText(
    "aligns with PMI Benefits Realization Management logic",
  );
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  // Production database: no synthetic banner (ADR-0050 §1).
  await expect(page.locator("[data-state='demo-synthetic']")).toHaveCount(0);
  expect(foreign).toEqual([]);
});

test("Reader: B0031 opens the T01 register and the T01 form links back; Launch on the gate-review procedure creates an instance (Transformation Lead)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead: ApiSession = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-G reader ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/playbook/reader/B0031?transformationId=${created.id}`);
  await expect(page.locator("main#main h1")).toContainText("B0031");
  const t01 = page.locator("[data-link='template:T01']");
  await expect(t01.getByRole("link")).toHaveAttribute("href", `/transformations/${created.id}/diagnose`);
  await expect(t01).toContainText(tr(lang, "playbookP5.provenance.custom_extension"));
  await expectAccessible(page, lang, "p5-feg-block");
  await shot(page, lang, "p5-feg-block-b0031");
  await t01.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/transformations/${created.id}/diagnose$`));
  const back = page.locator("[data-source-links='T01'] [data-source-link='B0031']");
  await expect(back).toBeVisible();
  await expect(page.locator("[data-template-provenance='T01']")).toContainText(
    tr(lang, "playbookP5.question.why_change"),
  );
  await shot(page, lang, "p5-feg-t01-source-link");
  await back.click();
  await expect(page).toHaveURL(/\/playbook\/reader\/B0031$/);
  // Launch the gate-review procedure linked from B0023 (REQ-S03-010).
  await page.goto(`/playbook/reader/B0023?transformationId=${created.id}`);
  const link = page.locator("[data-link='procedure:gate_review']");
  await link.getByRole("button", { name: tr(lang, "playbookP5.links.launch"), exact: true }).click();
  const form = page.locator("form[data-form='launch-procedure']");
  await form.getByLabel(tr(lang, "playbookP5.links.transformation")).selectOption(created.id);
  await shot(page, lang, "p5-feg-launch");
  await form.getByRole("button", { name: tr(lang, "playbookP5.links.launchConfirm"), exact: true }).click();
  await expect(page).toHaveURL(/\/playbook\/procedures\/[0-9a-f-]{36}$/);
  const instances = await lead.call<{ items: { procedureCode: string; transformationId: string | null }[] }>(
    "GET",
    `/api/v1/procedure-instances?transformationId=${created.id}`,
  );
  expect(instances.items.some((i) => i.procedureCode === "gate_review")).toBe(true);
  // The Workstream Lead's navigation comes from /me/navigation: no Administration (REQ-S03-007).
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  await expect(nav.locator("[data-area='myWork']")).toBeVisible();
  await expect(nav.locator("[data-area='admin']")).toHaveCount(0);
  expect(foreign).toEqual([]);
});

test("Branding: publish a name and colour (header and theme follow), the prohibited-claim refusal, then restore (administrator); the auditor has no access", async ({
  page,
  playwright,
  browser,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const before = await admin.call<Record<string, unknown> & { version: number }>("GET", "/api/v1/admin/branding");
  const name = lang === "ar" ? "منصة التجوال الاصطناعية" : "Synthetic Roaming Hub";
  try {
    await signIn(page, lang, "dev.admin");
    await page.goto("/admin/branding");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.branding.title"));
    const form = page.locator("form[data-form='branding']");
    const field = (key: string) =>
      form.getByLabel(new RegExp(tr(lang, `playbookP5.branding.field.${key}`).replace(/[()]/g, "\\$&")));
    // The refusal: a name claiming PMI certification is refused by the server with its translated text.
    await field("productNameEn").fill("PMI certified Hub");
    await form.getByRole("button", { name: tr(lang, "playbookP5.branding.publish"), exact: true }).click();
    await expect(form).toContainText(tr(lang, "problems.branding__prohibited_claim"));
    await shot(page, lang, "p5-feg-branding-refused");
    // Publish: new name (en and ar) and a new primary colour.
    await field("productNameEn").fill(lang === "ar" ? "Synthetic Hub" : name);
    await field("productNameAr").fill(lang === "ar" ? name : "منصة اصطناعية");
    await field("primaryColour").fill("#0057B8");
    await form.getByRole("button", { name: tr(lang, "playbookP5.branding.publish"), exact: true }).click();
    await expect(page.locator("[data-state='branding-saved']")).toBeVisible();
    await expect(page.getByTestId("wordmark")).toContainText(name);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--mth-brand-primary")))
      .toBe("#0057B8");
    await expect(page.locator("[data-table='branding-versions'] tbody tr").first()).toContainText("#0057B8");
    await expectAccessible(page, lang, "p5-feg-branding");
    await shot(page, lang, "p5-feg-branding-published");
  } finally {
    // Restore the settings that were current before this test (a new version with the same values).
    const now = await admin.call<{ version: number }>("GET", "/api/v1/admin/branding");
    const b = before as Record<string, string | null>;
    await admin.call(
      "PUT",
      "/api/v1/admin/branding",
      {
        productNameEn: b["productNameEn"],
        productNameAr: b["productNameAr"],
        primaryColour: b["primaryColour"],
        secondaryColour: b["secondaryColour"],
        colourApprovalReference: b["colourApprovalReference"],
        fontLatin: "IBM Plex Sans",
        fontArabic: "IBM Plex Sans Arabic",
        logo: { mode: "keep" },
        reportHeaderEn: b["reportHeaderEn"],
        reportHeaderAr: b["reportHeaderAr"],
        reportFooterEn: b["reportFooterEn"],
        reportFooterAr: b["reportFooterAr"],
        changeNote: "Synthetic e2e: restore the settings that were current before the branding test",
      },
      { ifMatch: now.version },
    );
  }
  // The auditor: no access to Branding Settings (403 shown as the no-permission state).
  const context = await browser.newContext();
  const audit = await context.newPage();
  await signIn(audit, lang, "dev.auditor");
  await audit.goto("/admin/branding");
  await expect(audit.locator("[data-state='no-permission']")).toBeVisible();
  await expect(audit.locator("form[data-form='branding']")).toHaveCount(0);
  await context.close();
  expect(foreign).toEqual([]);
});

test("Environment and walkthrough in a production database: no synthetic label; the reset and the walkthrough say environment.not_demo (administrator)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/demo");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.environment.title"));
  await expect(page.locator("[data-environment-kind='production']")).toBeVisible();
  await expect(page.locator("[data-state='no-run']")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "playbookP5.environment.requestReset"), exact: true }).click();
  await page.getByRole("button", { name: tr(lang, "playbookP5.environment.confirm"), exact: true }).click();
  await expect(page.locator("main#main")).toContainText(tr(lang, "problems.environment__not_demo"));
  await expect(page.locator("[data-state='reset-queued']")).toHaveCount(0);
  await expectAccessible(page, lang, "p5-feg-environment");
  await shot(page, lang, "p5-feg-environment-refused");
  await page.goto("/walkthrough");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.walkthrough.title"));
  await expect(page.locator("[data-state='not-demo']")).toContainText(tr(lang, "problems.environment__not_demo"));
  await expect(page.locator("[data-state='demo-synthetic']")).toHaveCount(0);
  await expectAccessible(page, lang, "p5-feg-walkthrough");
  await shot(page, lang, "p5-feg-walkthrough-not-demo");
  // Administration no longer calls any shipped feature planned (F-DG4-160, D-162 e).
  await page.goto("/admin");
  await expect(page.locator("[data-card='configuration']")).toContainText(tr(lang, "admin.configurationTitle"));
  await expect(page.locator("main#main")).not.toContainText(tr(lang, "nav.planned"));
  expect(foreign).toEqual([]);
});
