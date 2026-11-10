// domain-reviewer probe (T-DG6-REV-DOM-RG-R1), NOT part of the candidate: disposable clone only, copied into the
// reviewer's evidence. Demo-initialized stack (e2e/support/with-demo-stack.sh): the SYNTHETIC International Roaming
// dataset. REQ-S15-014 clause 1 on real screens: the weighted score and the benefit realized value explained in plain
// language, en and ar. Nothing here is a business approval (G1-G6) or relates to DG0-DG7.
/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { langOf, shot } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ timeout: 180_000 });

const TERMS = /stack trace|ECONNREFUSED|SQLSTATE|postgres|Kysely|Fastify|outbox|pg-boss|localhost|TypeError|\[object Object\]/i;

test("DOM-D1 the weighted score and the benefit realized value are explained in plain language", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const to = await demoApi(playwright, "to");
  const ts = await to.call<{ items: { id: string; name: string }[] }>("GET", "/api/v1/transformations?limit=50");
  console.log(`DOM-D1 ${lang} transformations: ${ts.items.map((t) => t.name).join(" | ")}`);
  const t = ts.items[0]!;
  const page = await demoPage(browser, lang, "to");

  // E1: the weighted score on the prioritization scorecard.
  await page.goto(`/transformations/${t.id}/prioritization`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const e1 = page.locator("[data-explanation]").first();
  const e1count = await page.locator("[data-explanation]").count();
  console.log(`DOM-D1 ${lang} prioritization explanations: ${e1count}`);
  if (e1count > 0) {
    await e1.locator("button.explanation__toggle").click();
    const txt = (await e1.innerText()).replace(/\s+/g, " ");
    console.log(`DOM-D1 ${lang} E1 (${await e1.getAttribute("data-explanation")}): ${txt.slice(0, 900)}`);
    expect(txt).not.toMatch(TERMS);
    await e1.scrollIntoViewIfNeeded();
  }
  await shot(page, lang, "dom-d1-weighted-score-explained");

  // E2: the realized value on a benefit page.
  const bs = await to.call<{ items: { id: string; name?: string; title?: string }[] }>(
    "GET",
    `/api/v1/transformations/${t.id}/benefits?limit=50`,
  );
  console.log(`DOM-D1 ${lang} benefits: ${bs.items.length}`);
  expect(bs.items.length).toBeGreaterThan(0);
  let shown = false;
  for (const b of bs.items) {
    await page.goto(`/transformations/${t.id}/benefits/${b.id}`);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const panels = page.locator("[data-explanation]");
    if ((await panels.count()) === 0) continue;
    const e2 = panels.first();
    await e2.locator("button.explanation__toggle").click();
    const txt = (await e2.innerText()).replace(/\s+/g, " ");
    console.log(`DOM-D1 ${lang} E2 (${await e2.getAttribute("data-explanation")}) on ${b.id}: ${txt.slice(0, 900)}`);
    expect(txt).not.toMatch(TERMS);
    await e2.scrollIntoViewIfNeeded();
    await shot(page, lang, "dom-d1-benefit-realized-explained");
    shown = true;
    break;
  }
  expect(shown).toBe(true);
  expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
});
