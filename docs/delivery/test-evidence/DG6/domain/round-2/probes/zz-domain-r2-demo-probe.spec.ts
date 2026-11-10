// domain-reviewer probe (T-DG6-REV-DOM-RG-R2), NOT part of the candidate: disposable clone only (copied to e2e/).
// Demo-initialized stack (e2e/support/with-demo-stack.sh): the SYNTHETIC International Roaming dataset.
// F-DG6-900 re-verification: the round-1 reproduction (roaming.user.to, the benefit E2 realized-value panel), now also
// asserting the pending table's third column and its cells name the COMPARISON BASIS, never a bare "Validated".
// The expected words are literal (en and ar), not read from the catalogue. Nothing approves anything (G1-G6) or DG0-DG7.
/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { langOf, shot } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ timeout: 240_000 });

const TERMS = /stack trace|ECONNREFUSED|SQLSTATE|postgres|Kysely|Fastify|outbox|pg-boss|localhost|TypeError|\[object Object\]/i;
const WORDS = {
  en: {
    pending: "Pending Finance validation (not realized)",
    column: "Comparison basis",
    validated: "Baseline and formula version validated by Finance",
    provisional: "Provisional: baseline or formula version not validated by Finance",
    bare: /^(Validated|Provisional)$/,
  },
  ar: {
    pending: null,
    column: "أساس المقارنة",
    validated: "خط الأساس وإصدار المعادلة تحققت منهما المالية",
    provisional: "مؤقت: خط الأساس أو إصدار المعادلة لم تتحقق منه المالية",
    bare: /^(معتمد|مؤقت)$/,
  },
} as const;

test("DOM-R2-D1 the pending realized-value line names its comparison basis (F-DG6-900)", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = WORDS[lang];
  const to = await demoApi(playwright, "to");
  const ts = await to.call<{ items: { id: string; name: string }[] }>("GET", "/api/v1/transformations?limit=50");
  const t = ts.items[0]!;
  console.log(`DOM-R2-D1 ${lang} transformation: ${t.name}`);
  const page = await demoPage(browser, lang, "to");
  const bs = await to.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${t.id}/benefits?limit=50`);
  let checked = 0;
  for (const b of bs.items) {
    await page.goto(`/transformations/${t.id}/benefits/${b.id}`);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const e2 = page.locator("[data-explanation='e2-benefit-realized']");
    if ((await e2.count()) === 0) continue;
    await e2.locator("button.explanation__toggle").click();
    const txt = (await e2.innerText()).replace(/\s+/g, " ");
    expect(txt).not.toMatch(TERMS);
    for (const table of await e2.locator("table").all()) {
      const caption = ((await table.locator("caption").textContent()) ?? "").trim();
      const headers = (await table.locator("thead th").allTextContents()).map((s) => s.trim());
      const rows = await table.locator("tbody tr").all();
      const basisCells: string[] = [];
      for (const r of rows) {
        const cells = (await r.locator("td, th").allTextContents()).map((s) => s.trim());
        if (cells.length >= 3) basisCells.push(cells[2]!);
      }
      console.log(`DOM-R2-D1 ${lang} ${b.id} table "${caption}" headers=${JSON.stringify(headers)} basis=${JSON.stringify(basisCells)}`);
      if (headers.length >= 3) {
        expect(headers[2]).toBe(w.column);
        for (const c of basisCells) {
          expect(c).not.toMatch(w.bare);
          expect([w.validated, w.provisional]).toContain(c);
        }
        checked += basisCells.length;
      }
    }
    console.log(`DOM-R2-D1 ${lang} E2 on ${b.id}: ${txt.slice(0, 1200)}`);
    await e2.scrollIntoViewIfNeeded();
    await shot(page, lang, "dom-r2-d1-benefit-realized-basis");
    await e2.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"]}/${lang}/dom-r2-d1-e2-panel.png` });
    if (checked > 0) break;
  }
  console.log(`DOM-R2-D1 ${lang} basis cells checked: ${checked}`);
  expect(checked).toBeGreaterThan(0);
  expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
});
