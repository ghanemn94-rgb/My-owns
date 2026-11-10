// qa-verifier DG6 re-gate round 2 (T-DG6-REV-QA-RG-R2): the F-DG6-900 reproduction on THIS candidate. NOT part of the
// candidate: copied into a disposable clone at e2e/ and run on e2e/support/with-demo-stack.sh (the SYNTHETIC
// International Roaming dataset), in chromium-en and chromium-ar. The round-1 sequence (domain probe
// zz-domain-demo-probe.spec.ts): roaming.user.to opens the benefit 01995000-4401-7000-8000-000000000001 ("Revenue
// uplift") and its realized-value explanation (E2). Expected after T-DG6-FE-RG1: the pending table's third column is
// "Comparison basis" / "أساس المقارنة", and no cell of the pending table is the bare word "Validated" / "معتمد".
// Nothing here is a business approval (G1-G6) or relates to DG0-DG7.
/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { langOf, shot } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ timeout: 180_000 });

const BENEFIT = "01995000-4401-7000-8000-000000000001";
const L = {
  en: { col: "Comparison basis", bare: "Validated", oldCol: "Basis", full: "Baseline and formula version validated by Finance" },
  ar: { col: "أساس المقارنة", bare: "معتمد", oldCol: "الأساس", full: "خط الأساس وإصدار المعادلة تحققت منهما المالية" },
} as const;

test("QA-RG-R2 F-DG6-900: the pending line's basis column says what is validated, never a bare 'Validated'", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info) as "en" | "ar";
  const to = await demoApi(playwright, "to");
  const ts = await to.call<{ items: { id: string; name: string }[] }>("GET", "/api/v1/transformations?limit=50");
  let tid: string | null = null;
  for (const t of ts.items) {
    const bs = await to.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${t.id}/benefits?limit=50`);
    if (bs.items.some((b) => b.id === BENEFIT)) tid = t.id;
  }
  expect(tid, "the demo benefit of the round-1 reproduction").not.toBeNull();
  const page = await demoPage(browser, lang, "to");
  await page.goto(`/transformations/${tid}/benefits/${BENEFIT}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const e2 = page.locator("[data-explanation='e2-benefit-realized']");
  await e2.locator("button.explanation__toggle").click();
  const tables = e2.locator("table");
  const n = await tables.count();
  console.log(`QA-RG-R2 F900 ${lang}: E2 tables = ${n}`);
  const panelText = (await e2.innerText()).replace(/\s+/g, " ");
  console.log(`QA-RG-R2 F900 ${lang}: E2 text = ${panelText.slice(0, 1200)}`);
  let pendingSeen = false;
  for (let i = 0; i < n; i++) {
    const tb = tables.nth(i);
    const heads = (await tb.locator("thead th").allInnerTexts()).map((s) => s.trim());
    const cells = (await tb.locator("tbody td").allInnerTexts()).map((s) => s.trim());
    console.log(`QA-RG-R2 F900 ${lang}: table ${i} heads=${JSON.stringify(heads)} cells=${JSON.stringify(cells)}`);
    expect(heads).not.toContain(L[lang].oldCol);
    if (heads.length >= 3) expect(heads[2]).toBe(L[lang].col);
    expect(cells, "no bare 'Validated' cell").not.toContain(L[lang].bare);
    if (cells.includes(L[lang].full)) pendingSeen = true;
  }
  expect(panelText).toContain(L[lang].col);
  console.log(`QA-RG-R2 F900 ${lang}: a line shows the full basis wording: ${pendingSeen}`);
  expect(pendingSeen).toBe(true);
  expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
  await e2.scrollIntoViewIfNeeded();
  await shot(page, lang, "qa-rg-r2-f900-e2-basis");
});
