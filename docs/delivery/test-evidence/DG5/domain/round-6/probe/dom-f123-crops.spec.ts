// domain-reviewer DG5 round-4 probe: F-DG5-123 verification crops on the DEMO-initialized stack
// (e2e/support/with-demo-stack.sh; AUTH_MODE=dev, MTH_ENV=demo). SYNTHETIC illustrative data only. Read-only page views.
// Element screenshots of: the portfolio table (warnings column), INI-01..03 key deliverables, the roadmap Deliverables
// section, the capability heatmap, and the traceability orphan report; in EN and AR (one project each).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
const INI = ["21", "22", "23"].map((n) => `01995000-0000-7000-8000-0000000000${n}`);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction(() => !/Loading…|جارٍ التحميل…/.test(document.body.innerText), undefined, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}
async function crop(page: Page, lang: string, name: string, selector: string) {
  mkdirSync(join(OUT, "crops", lang), { recursive: true });
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: join(OUT, "crops", lang, `${name}.png`) });
  writeFileSync(join(OUT, "crops", lang, `${name}.txt`), await el.innerText());
  return el.innerText();
}

test("F-DG5-123 crops (demo TL)", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.tl");
  const dir = await page.evaluate(() => document.documentElement.dir);
  await page.goto(`/transformations/${T}/portfolio`);
  await settle(page);
  const portfolio = await crop(page, lang, "c1-portfolio-table", "table:has-text('INI-01')");
  await page.goto(`/transformations/${T}/traceability`);
  await settle(page);
  const orphans = await crop(page, lang, "c2-orphan-report", "#trace-orphans");
  await page.goto(`/transformations/${T}/roadmap`);
  await settle(page);
  const roadmap = await crop(page, lang, "c3-roadmap-deliverables", "#deliverables");
  await page.goto(`/transformations/${T}/design`);
  await settle(page);
  const heat = await crop(page, lang, "c4-capability-heatmap", "#heatmap");
  for (const [k, id] of INI.entries()) {
    await page.goto(`/transformations/${T}/initiatives/${id}`);
    await settle(page);
    await crop(page, lang, `c5-initiative-INI-0${k + 1}-deliverables`, "#deliverables");
  }
  writeFileSync(join(OUT, "crops", lang, "dir.txt"), `document dir=${await page.evaluate(() => document.documentElement.dir)} (after sign-in: ${dir})\n`);
  expect(portfolio).not.toMatch(/3 to 7|من 3 إلى 7/);
  expect(orphans).not.toMatch(/INI-0[123]/);
  expect(roadmap).toMatch(/INI-03/);
  expect(heat).toMatch(/Proactive roaming service assurance/);
});
