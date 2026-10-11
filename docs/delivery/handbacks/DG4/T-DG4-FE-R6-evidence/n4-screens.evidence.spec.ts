// EVIDENCE ONLY (T-DG4-FE-R6), not part of the product suite: screenshots of the N4 screens (F-DG4-126 / F-DG4-127)
// before KBE-R7's API is merged. The REAL built SPA runs on the REAL stack (with-stack.sh, real sign-in); ONLY the
// dashboard, overview, Finance and drill-down responses are replaced by the SYNTHETIC N4 unit-test fixtures
// (dashboardFixtures.ts n4*; ARCH-R6 §4.3 R3-6a and the ranking world), passed as JSON in N4_JSON. These screenshots
// are therefore MOCKED API responses, labelled as such in the handback. Axe runs on each screen.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { asUser } from "../../../../../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, expectAccessible, langOf, shot, SYN_RETAIL } from "../../../../../apps/web/e2e/support/ui.ts";

const N4 = JSON.parse(readFileSync(process.env["N4_JSON"]!, "utf8")) as Record<string, Record<string, unknown>>;

async function mock(page: Page, tid: string) {
  const body = (x: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
  await page.route(/\/api\/v1\/transformations\/[^/]+\/dashboard(\?|$)/, (r) =>
    r.fulfill(body({ ...N4["t10"], transformationId: tid })),
  );
  await page.route(/\/api\/v1\/overview\?/, (r) => r.fulfill(body(N4["overview"])));
  await page.route(/\/api\/v1\/dashboards\/finance\?/, (r) => r.fulfill(body(N4["finance"])));
  await page.route(/\/api\/v1\/dashboard-drilldown\?/, (r) => r.fulfill(body(N4["drill"])));
}

test("N4 screens (mocked dashboard responses)", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic N4 evidence ${lang} ${Date.now().toString(36)}`,
      mode: "end_to_end",
    })
  ).id;
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  await mock(page, tid);
  await page.goto(`/transformations/${tid}/dashboard`);
  await expect(page.locator("section[data-area='value'] [data-value-rag-lines='2']")).toBeVisible();
  await expect(page.locator("[data-area-items='portfolio'] [data-value-column-basis='profit_and_cash']")).toBeVisible();
  await shot(page, lang, "n4-t10-value-rag-lines-portfolio");
  await expectAccessible(page, lang, "n4-t10");
  await page.goto("/executive-overview");
  await expect(page.locator("section[data-area='value'] [data-value-rag-lines='2']")).toBeVisible();
  await shot(page, lang, "n4-overview-value-rag-lines");
  await expectAccessible(page, lang, "n4-overview");
  await page.goto("/dashboards/finance");
  const gap = page.locator("#finance-headlines [data-headlines-beside] [data-metric='value.gap']");
  await expect(gap).toContainText("100 %");
  await shot(page, lang, "n4-finance-top-line-gap");
  await gap.getByRole("button").click();
  await expect(page.getByRole("dialog").locator("[data-drill-currency='SAR']")).toBeVisible();
  await shot(page, lang, "n4-finance-gap-drilldown-currency");
  await expectAccessible(page, lang, "n4-finance-drilldown");
  await s.close();
});
