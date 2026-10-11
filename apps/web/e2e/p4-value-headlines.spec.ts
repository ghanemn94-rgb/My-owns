// F-DG4-122 and F-DG4-123 (T-DG4-FE-R5; D-119; ADR-0037 / ADR-0030 amendment N3) on the REAL stack
// (support/with-stack.sh; no mocks). The domain reviewer's SYNTHETIC world: one transformation with four financial
// benefits planned for 2026-01..06, revenue uplift 300, margin uplift 70, cash saving 20 and avoided cost 45 SAR, nothing
// validated. No product gate (G1-G6) is decided here, and none implies an engineering gate (DG0-DG7).
//  1. F-DG4-122: the value gap (API: {unit: "ratio", currency: "SAR", value: "1"}) reads "100 %" on the T10 Value
//     area, the Executive Overview and the Finance dashboard, never a money amount ("SAR 1.00" / "1.00 ر.س.").
//  2. F-DG4-123 (needs T-DG4-KBE-R6's API, which sends `headlineBasis`): the value headlines are labelled profit and
//     cash (90); top line (300) and non-cash (45) sit beside them, labelled and never summed (435 nowhere), on T10,
//     the Executive Overview, the Finance dashboard and the workspace header. Until that API is merged, the test SKIPS
//     itself and says why; it never passes on an API without the member.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "./support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, tr, type ApiSession } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
let lead: ApiSession;
let hasBasis = false;
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 value headlines ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const bo = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.p4vh.bo.${lang}.${stamp}`,
    `Synthetic Benefit Owner ${lang}`,
    "BO",
    lang,
  );
  const boApi = await apiSession(playwright, bo.username);
  const classes = [
    ["revenue_uplift", "revenue", "Revenue - roaming", "300"],
    ["margin_uplift", "revenue", "Gross margin - roaming", "70"],
    ["cash_saving", "cost", "Opex - care", "20"],
    ["avoided_cost", "cost", "Opex - network", "45"],
  ] as const;
  for (const [valueClass, benefitType, line, amount] of classes) {
    const b = await boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic ${valueClass} ${lang} ${stamp}`,
      description: "Synthetic demo benefit (F-DG4-122/123 world).",
      benefitType,
      valueClass,
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: line,
    });
    await boApi.call("POST", `${T}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
      amount,
    });
  }
  // The API's own value gap: a ratio carrying the block's currency (the F-DG4-122 input).
  const dash = await lead.call<{
    areas: { code: string; headlines: { metric: string; headlineBasis?: string | null; value: { value: string } }[] }[];
  }>("GET", `${T}/dashboard`);
  const value = dash.areas.find((a) => a.code === "value")!;
  const gap = value.headlines.find((h) => h.metric === "value.gap")!;
  expect(gap.value).toMatchObject({ state: "value", value: "1", unit: "ratio", currency: "SAR" });
  hasBasis = value.headlines.some((h) => h.headlineBasis);
});

/** The gap's figure inside a headline container: exactly "100 %", and no money text. */
async function expectGap100(page: Page, container: string, lang: "ar" | "en") {
  const gap = page.locator(`${container} [data-metric='value.gap']`).first();
  await expect(gap).toBeVisible();
  const amount = gap.locator("[data-value-state='value'] .amount");
  await expect(amount).toHaveText("100 %");
  const text = await gap.innerText();
  expect(text).not.toMatch(lang === "ar" ? /ر\.س|1\.00/ : /SAR|1\.00/);
}

test("1. F-DG4-122: the value gap reads 100 % on T10, the Executive Overview and the Finance dashboard", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  // T10 Value area
  await go(page, `/transformations/${tid}/dashboard`);
  await expectGap100(page, "section[data-area='value']", lang);
  await shot(page, lang, "p4-value-gap-t10");
  await expectAccessible(page, lang, "p4-value-gap-t10");
  // Executive Overview, filtered to the transformation
  await go(page, `/executive-overview?tr=${tid}`);
  await expectGap100(page, "section[data-area='value']", lang);
  await shot(page, lang, "p4-value-gap-overview");
  await expectAccessible(page, lang, "p4-value-gap-overview");
  // Finance dashboard, filtered to the transformation
  await go(page, `/dashboards/finance?tr=${tid}`);
  await expectGap100(page, "#finance-headlines", lang);
  await shot(page, lang, "p4-value-gap-finance");
  await expectAccessible(page, lang, "p4-value-gap-finance");
  await s.close();
});

test("2. F-DG4-123: profit-and-cash headlines labelled; top line and non-cash beside, never summed (needs KBE-R6's API)", async ({
  browser,
}, info) => {
  test.skip(!hasBasis, "the API does not send headlineBasis yet: T-DG4-KBE-R6 (D-119) is not merged in this tree");
  const lang = langOf(info);
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  const label = (k: string) => tr(lang, `dashboards.headline.dashboard__headline__value_${k}`);
  const checkScope = async (scope: string, withGap: boolean) => {
    const pc = page.locator(
      `${scope} [data-headlines] [data-metric='value.planned'][data-headline-basis='profit_and_cash']`,
    );
    await expect(pc).toContainText(label("planned_profit_and_cash"));
    await expect(pc.locator("[data-value]")).toHaveAttribute("data-value", /^90(\.0+)?$/);
    const beside = page.locator(`${scope} [data-headlines-beside][data-not-summed='true']`);
    const top = beside.locator("[data-metric='value.planned'][data-headline-basis='top_line']");
    const nonCash = beside.locator("[data-metric='value.planned'][data-headline-basis='non_cash']");
    await expect(top).toContainText(label("planned_top_line"));
    await expect(nonCash).toContainText(label("planned_non_cash"));
    await expect(top.locator("[data-value]")).toHaveAttribute("data-value", /^300(\.0+)?$/);
    await expect(nonCash.locator("[data-value]")).toHaveAttribute("data-value", /^45(\.0+)?$/);
    if (withGap) await expectGap100(page, scope, lang);
    expect(await page.locator(scope).innerText()).not.toMatch(/435/);
  };
  await go(page, `/transformations/${tid}/dashboard`);
  await checkScope("section[data-area='value']", true);
  // the top-line headline drills by valueClass=revenue_uplift; its drill-down sums to 300
  await page.locator("section[data-area='value'] [data-drill='value.planned'][data-drill-basis='top_line']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-drilldown*='valueClass=revenue_uplift']")).toBeVisible();
  await expect(dialog.locator("[data-drill-value] [data-value]")).toHaveAttribute("data-value", /^300(\.0+)?$/);
  await shot(page, lang, "p4-value-basis-t10-drill-top-line");
  await dialog.getByRole("button", { name: tr(lang, "dashboards.drill.close") }).click();
  await shot(page, lang, "p4-value-basis-t10");
  await expectAccessible(page, lang, "p4-value-basis-t10");
  await go(page, `/executive-overview?tr=${tid}`);
  await checkScope("section[data-area='value']", true);
  await shot(page, lang, "p4-value-basis-overview");
  await expectAccessible(page, lang, "p4-value-basis-overview");
  await go(page, `/dashboards/finance?tr=${tid}`);
  await checkScope("#finance-headlines", true);
  await shot(page, lang, "p4-value-basis-finance");
  await expectAccessible(page, lang, "p4-value-basis-finance");
  await go(page, `/transformations/${tid}`);
  await checkScope("[data-element='benefits']", false);
  await shot(page, lang, "p4-value-basis-header");
  await expectAccessible(page, lang, "p4-value-basis-header");
  await s.close();
});
