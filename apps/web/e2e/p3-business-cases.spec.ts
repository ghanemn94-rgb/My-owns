// Business cases and the T09 benefit-formula builder on the REAL stack (support/with-stack.sh; no mocks), in the
// project's language (chromium-en → English LTR, chromium-ar → Arabic RTL). SYNTHETIC data (T-DG3-FE-C):
//  - the lead creates the transformation case, fills sections (If-Match), adds one investment and one benefit line
//    (exactly one class each) and reads gross / cost / net apart; a linked initiative case rolls up by reference;
//  - a synthetic Finance grant (FIN on this transformation only) records the baseline validation as a BUSINESS
//    APPROVAL; a later baseline edit by the lead makes it Stale (text + icon, never green);
//  - a concurrent edit gives the standard 409 conflict panel;
//  - T09: the two B0087 examples are marked illustrative with previews of 100000 and 500000 SAR per year; one is
//    instantiated; the live builder shows the period mismatch before saving; a new version is saved, previewed with
//    lineage, and validated by Finance (never its author);
//  - the read-only auditor sees no enabled write control; every screen is axe-clean (0 serious/critical).
// Screenshots: apps/web/e2e/screenshots/{en,ar}/p3-business-*.png. Nothing here grants a real approval.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  DEV_USERS,
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  escape,
  exactly,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-business.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let tid = "";
let caseId = "";
let formulaId = "";

async function asUser(
  browser: Browser,
  lang: Lang,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

const region = (page: Page, lang: Lang, key: string) => page.getByRole("region", { name: tr(lang, key), exact: true });
const money = (lang: Lang, amount: string) => (lang === "ar" ? `${amount} SAR` : `SAR ${amount}`);
const perYear = (lang: Lang, value: string) =>
  tr(lang, "benefitFormulas.perPeriod", { value, period: tr(lang, "benefitFormulas.periodUnit.year") });

/** No enabled write control in the page body (table sorting, filters, pagination and navigation are reading aids). */
async function expectNoWriteControl(page: Page) {
  const enabled = await page
    .locator("main#main")
    .locator("form, input, textarea, select, button")
    .evaluateAll((els) =>
      els
        .filter(
          (el) =>
            !(el as HTMLButtonElement).disabled &&
            !el.closest("thead, .register__toolbar, .pager, .column-picker, nav, .section-nav, [data-view-control]"),
        )
        .map((el) => `${el.tagName}:${el.textContent ?? ""}`),
    );
  expect(enabled).toEqual([]);
}

test("setup: a synthetic transformation, an initiative, and a synthetic Finance grant on it", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 business cases ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
  await lead.call("POST", "/api/v1/initiatives", { transformationId: tid, name: "Synthetic digital onboarding" });
  // A synthetic Finance (FIN) grant for the Transformation Office user on this transformation only (demo data).
  const admin = await apiSession(playwright, "dev.admin");
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "FIN",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic demo Finance validator for the P3 business-case journey",
  });
});

test("lead: transformation case with sections, one-class lines and gross / cost / net apart; initiative roll-up", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/business-cases`);
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "businessCases.title")));
  await expect(page.locator("[data-state='empty']")).toContainText(tr(lang, "businessCases.empty"));
  await expectAccessible(page, lang, "p3-business-cases-empty");

  await page.getByRole("button", { name: tr(lang, "businessCases.create.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: tr(lang, "businessCases.level.transformation") })).toBeChecked();
  await dialog.getByLabel(fieldLabel(lang, "businessCases.field.title")).fill("Synthetic retail transformation case");
  await expectAccessible(page, lang, "p3-business-case-create");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/business-cases/[0-9a-f-]{36}$`));
  caseId = page.url().split("/").pop()!;
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "businessCases.detailTitle")));
  await expect(page.locator("[data-business-case='BC-01']")).toBeVisible();

  // Sections (If-Match; saved as a draft).
  const sections = region(page, lang, "businessCases.sections.title");
  await expect(sections.locator("fieldset[data-section]")).toHaveCount(10);
  await sections
    .getByLabel(fieldLabel(lang, "businessCases.sectionField.strategicRationale"))
    .fill("Synthetic rationale");
  await sections
    .getByLabel(fieldLabel(lang, "businessCases.sectionField.baselineSummary"))
    .fill("Synthetic baseline: 1.2M customers");
  await sections.getByRole("button", { name: tr(lang, "businessCases.sections.save"), exact: true }).click();
  await expect(sections.locator("[data-state='saved']")).toBeVisible();

  // One investment line (capex) and one benefit line (revenue): exactly one class each.
  await page.getByRole("button", { name: tr(lang, "businessCases.line.add.investment"), exact: true }).click();
  let line = page.getByRole("dialog");
  await line.getByLabel(fieldLabel(lang, "businessCases.line.class")).selectOption("capex");
  await line.getByLabel(fieldLabel(lang, "businessCases.line.title")).fill("Synthetic platform licence");
  await line
    .getByLabel(new RegExp(`^${escape(tr(lang, "businessCases.line.amountIn", { currency: "SAR" }))}`))
    .fill("1250000.50");
  await expectAccessible(page, lang, "p3-business-case-line-dialog");
  await shot(page, lang, "p3-business-case-line-dialog");
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);
  await page.getByRole("button", { name: tr(lang, "businessCases.line.add.benefit"), exact: true }).click();
  line = page.getByRole("dialog");
  await line.getByLabel(fieldLabel(lang, "businessCases.line.class")).selectOption("revenue");
  await expect(line.getByLabel(fieldLabel(lang, "businessCases.line.valueBasis")).locator("option")).toHaveCount(2);
  await line.getByLabel(fieldLabel(lang, "businessCases.line.title")).fill("Synthetic attach-rate uplift");
  await line
    .getByLabel(new RegExp(`^${escape(tr(lang, "businessCases.line.amountIn", { currency: "SAR" }))}`))
    .fill("3000000");
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);

  const totals = page.locator("[data-totals]");
  await expect(totals.locator("[data-total='gross'] [data-amount]").first()).toContainText(money(lang, "3,000,000.00"));
  await expect(totals.locator("[data-total='cost'] [data-amount]").first()).toContainText(money(lang, "1,250,000.50"));
  await expect(totals.locator("[data-total='net'] [data-amount]")).toContainText(money(lang, "1,749,999.50"));

  // A linked initiative case with one line rolls up by reference (each distinct line once).
  const lead = await apiSession(playwright, "dev.lead");
  const inis = await lead.call<{ items: { id: string }[] }>("GET", `/api/v1/initiatives?transformationId=${tid}`);
  const ini = await lead.call<{ id: string }>("POST", "/api/v1/business-cases", {
    transformationId: tid,
    level: "initiative",
    initiativeId: inis.items[0]!.id,
    title: "Synthetic onboarding initiative case",
  });
  await lead.call("POST", `/api/v1/business-cases/${ini.id}/lines`, {
    lineKind: "investment",
    class: "internal_fte",
    valueBasis: "non_cash",
    title: "Synthetic onboarding team",
    amount: "400000",
    currency: "SAR",
    fte: "2.5",
  });
  await page.reload();
  await expect(page.locator("[data-roll-up='2']")).toContainText(tr(lang, "businessCases.totals.rollUp", { count: 1 }));
  await expect(totals.locator("[data-total='cost'] [data-amount]").first()).toContainText(money(lang, "1,650,000.50"));
  await expect(totals.locator("[data-total='net'] [data-amount]")).toContainText(money(lang, "1,349,999.50"));
  await expectAccessible(page, lang, "p3-business-case-detail");
  await shot(page, lang, "p3-business-case-detail");

  await page.goto(`/transformations/${tid}/business-cases`);
  await expect(
    page.getByRole("table", { name: tr(lang, "businessCases.registerTitle") }).locator("tbody tr"),
  ).toHaveCount(2);
  await expectAccessible(page, lang, "p3-business-cases");
  await shot(page, lang, "p3-business-cases");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("Finance validates the baseline (business approval); the lead's later baseline edit makes it Stale; 409 conflict", async ({
  browser,
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const fin = await asUser(browser, lang, "dev.office");
  const foreign = trackRequests(fin.page);
  await fin.page.goto(`/transformations/${tid}/business-cases/${caseId}`);
  const finance = region(fin.page, lang, "businessCases.finance.title");
  await expect(finance.locator("[data-finance-validation='unvalidated']")).toBeVisible();
  await finance.getByRole("button", { name: tr(lang, "businessCases.finance.action"), exact: true }).click();
  const dialog = fin.page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "businessCases.finance.choice.validated"), exact: true }).check();
  await dialog
    .getByLabel(fieldLabel(lang, "businessCases.finance.note"))
    .fill("Synthetic Finance check of the baseline");
  await expectAccessible(fin.page, lang, "p3-business-case-finance-dialog");
  await shot(fin.page, lang, "p3-business-case-finance-dialog");
  await dialog.getByRole("button", { name: tr(lang, "businessCases.finance.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(finance.locator("[data-finance-validation='validated']")).toContainText(
    tr(lang, "businessCases.finance.state.validated"),
  );
  await shot(fin.page, lang, "p3-business-case-validated");
  expect(foreign).toEqual([]);
  await fin.close();

  // The lead edits the baseline: the validation becomes Stale (never green).
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/business-cases/${caseId}`);
  const sections = region(page, lang, "businessCases.sections.title");
  await expect(sections.locator("[data-state='baseline-edit-warning']")).toBeVisible();
  await sections
    .getByLabel(fieldLabel(lang, "businessCases.sectionField.baselineSummary"))
    .fill("Synthetic baseline: 1.3M customers");
  await sections.getByRole("button", { name: tr(lang, "businessCases.sections.save"), exact: true }).click();
  await expect(sections.locator("[data-state='saved']")).toBeVisible();
  const finance2 = region(page, lang, "businessCases.finance.title");
  const stale = finance2.locator("[data-finance-validation='stale']");
  await expect(stale).toContainText(tr(lang, "businessCases.finance.state.stale"));
  await expect(stale).toHaveClass(/status-chip--stale/);
  await expect(stale).not.toHaveClass(/on-track/);
  await expect(finance2.locator("[data-state='baseline-stale']")).toBeVisible();
  await expectAccessible(page, lang, "p3-business-case-stale");
  await shot(page, lang, "p3-business-case-stale");

  // Meanwhile someone else saves: the next save gets the standard conflict panel and nothing is written.
  const lead = await apiSession(playwright, "dev.lead");
  const current = await lead.call<{ version: number }>("GET", `/api/v1/business-cases/${caseId}`);
  await lead.call(
    "PATCH",
    `/api/v1/business-cases/${caseId}`,
    { sections: { upsideCase: "Synthetic upside (concurrent edit)" } },
    { ifMatch: current.version },
  );
  await sections.getByLabel(fieldLabel(lang, "businessCases.sectionField.downsideCase")).fill("Synthetic downside");
  await sections.getByRole("button", { name: tr(lang, "businessCases.sections.save"), exact: true }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  await expectAccessible(page, lang, "p3-business-case-conflict");
  await shot(page, lang, "p3-business-case-conflict");
  await conflict.getByRole("button", { name: tr(lang, "common.conflict.discard"), exact: true }).click();
  await expect(conflict).toHaveCount(0);
});

test("T09: illustrative B0087 examples (100000 / 500000 SAR per year), live builder, new version, preview lineage", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/benefit-formulas`);
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "benefitFormulas.title")));
  const revenue = page.locator("[data-example='revenue_uplift']");
  const cost = page.locator("[data-example='cost_reduction']");
  for (const card of [revenue, cost]) await expect(card).toContainText(tr(lang, "benefitFormulas.illustrative"));
  await expect(revenue.locator("[data-example-preview]")).toHaveAttribute("data-example-preview", "100000");
  await expect(revenue.locator("[data-example-preview]")).toContainText(perYear(lang, money(lang, "100,000.00")));
  await expect(cost.locator("[data-example-preview]")).toHaveAttribute("data-example-preview", "500000");
  await expect(cost.locator("[data-example-preview]")).toContainText(perYear(lang, money(lang, "500,000.00")));
  await expectAccessible(page, lang, "p3-business-formulas-empty");
  await shot(page, lang, "p3-business-formulas-examples");

  await revenue
    .getByRole("button", { name: new RegExp(`^\\s*${escape(tr(lang, "benefitFormulas.examples.instantiate"))}`) })
    .click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/benefit-formulas/[0-9a-f-]{36}$`));
  formulaId = page.url().split("/").pop()!;
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "benefitFormulas.detailTitle")));
  await expect(page.locator("[data-benefit-formula='BF-01']")).toContainText(tr(lang, "benefitFormulas.illustrative"));

  // Live builder: monthly ARPU × annual customers is refused BEFORE saving, translated, with its position.
  const builder = page.locator("[data-formula-builder]");
  const live = builder.locator("[data-live-check]");
  await expect(live.locator("[data-check='valid']")).toBeVisible();
  const arpu = builder.locator("[data-variable='arpu']");
  await arpu.getByLabel(tr(lang, "benefitFormulas.variables.period"), { exact: true }).selectOption("month");
  await expect(live.locator("[data-error-code='formula.period_mismatch']")).toBeVisible();
  await expect(live).toContainText(
    tr(lang, "benefitFormulas.engine.periodMismatch", {
      left: "arpu",
      leftPeriod: tr(lang, "benefitFormulas.periodUnit.month"),
      right: "eligible_customers",
      rightPeriod: tr(lang, "benefitFormulas.periodUnit.year"),
      convertTo: "year",
    }),
  );
  await expect(live.locator("mark")).toBeVisible();
  await expectAccessible(page, lang, "p3-business-formula-builder");
  await shot(page, lang, "p3-business-formula-builder-mismatch");
  await arpu.getByLabel(tr(lang, "benefitFormulas.variables.period"), { exact: true }).selectOption("year");
  // A fraction entered as percent: 13% → stored 0.13; preview 0.03 × 100000 × 50 = 150000 SAR per year.
  const target = builder.locator("[data-variable='target_attach_rate']");
  await target.getByLabel(tr(lang, "benefitFormulas.variables.valueIn.percent"), { exact: true }).fill("13");
  await expect(live.locator("[data-formula-value='150000']")).toBeVisible();
  await builder
    .getByLabel(tr(lang, "benefitFormulas.builder.changeNote"), { exact: true })
    .fill("Synthetic target 13%");
  await builder.getByRole("button", { name: tr(lang, "benefitFormulas.builder.save"), exact: true }).click();
  await expect(page.locator("[data-state='version-saved']")).toContainText(
    tr(lang, "benefitFormulas.builder.saved", { n: 2 }),
  );
  const versions = region(page, lang, "benefitFormulas.versions.title");
  await expect(versions.locator("[data-version='2'] [data-finance-validation='unvalidated']")).toBeVisible();

  // A preview calculation with its lineage.
  const run = page.locator("[data-run-calculation]");
  await run
    .getByLabel(tr(lang, "benefitFormulas.calc.assumptions"), { exact: true })
    .fill("Synthetic assumption: flat ARPU");
  await run.getByRole("button", { name: tr(lang, "benefitFormulas.calc.run"), exact: true }).click();
  await expect(page.locator("[data-state='calculation-recorded']")).toBeVisible();
  await expect(page.locator("[data-calculation='ok']").first()).toContainText(perYear(lang, money(lang, "150,000.00")));
  await expectAccessible(page, lang, "p3-business-formula-detail");
  await shot(page, lang, "p3-business-formula-detail");

  await page.goto(`/transformations/${tid}/benefit-formulas`);
  const register = page.getByRole("table", { name: tr(lang, "benefitFormulas.registerTitle") });
  await expect(register.locator("tbody tr")).toHaveCount(1);
  await expect(register).toContainText(tr(lang, "benefitFormulas.confidence.M"));
  await expectAccessible(page, lang, "p3-business-formulas");
  await shot(page, lang, "p3-business-formulas");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("Finance validates formula version 2 (business approval, not its author)", async ({ browser }, info) => {
  const lang = langOf(info);
  const fin = await asUser(browser, lang, "dev.office");
  await fin.page.goto(`/transformations/${tid}/benefit-formulas/${formulaId}`);
  const row = fin.page.locator("[data-version='2']");
  await row
    .getByRole("button", { name: new RegExp(`^\\s*${escape(tr(lang, "benefitFormulas.versions.validate"))}`) })
    .click();
  const dialog = fin.page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "businessCases.finance.choice.validated"), exact: true }).check();
  await dialog
    .getByLabel(fieldLabel(lang, "businessCases.finance.note"))
    .fill("Synthetic Finance check of the benefit logic");
  await dialog.getByRole("button", { name: tr(lang, "businessCases.finance.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator("[data-finance-validation='validated']")).toContainText(
    tr(lang, "businessCases.finance.state.validated"),
  );
  await expectAccessible(fin.page, lang, "p3-business-formula-validated");
  await shot(fin.page, lang, "p3-business-formula-validated");
  await fin.close();
});

test("read-only auditor: the four screens with no enabled write control, axe-clean", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.method() !== "HEAD") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await signIn(page, lang, "dev.auditor");
  sent.length = 0;
  for (const [path, title, name] of [
    ["business-cases", "businessCases.title", "p3-business-aud-cases"],
    [`business-cases/${caseId}`, "businessCases.detailTitle", "p3-business-aud-case"],
    ["benefit-formulas", "benefitFormulas.title", "p3-business-aud-formulas"],
    [`benefit-formulas/${formulaId}`, "benefitFormulas.detailTitle", "p3-business-aud-formula"],
  ] as const) {
    await page.goto(`/transformations/${tid}/${path}`);
    await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, title)));
    await expect(page.locator("[data-state='read-only']")).toBeVisible();
    await expect(page.locator("[data-state='loading']")).toHaveCount(0);
    await expectNoWriteControl(page);
    await expectAccessible(page, lang, name);
    await shot(page, lang, name);
  }
  await expect(page.locator("[data-finance-validation='validated']").first()).toBeVisible();
  expect(sent).toEqual([]);
  expect(foreign).toEqual([]);
});
