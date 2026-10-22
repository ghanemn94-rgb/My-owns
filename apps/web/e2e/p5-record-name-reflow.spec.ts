// Record names with long unbroken text reflow on Traceability and Modular entry, and the Define page's outcome card
// fits narrow phones (T-DG5-FE-AB1, D-180; F-DG5-148, F-DG5-149; REQ-S15-009, REQ-S15-012 WCAG 2.1 SC 1.4.10 Reflow),
// against the REAL API (apps/web/e2e/support/with-stack.sh), in chromium-en and chromium-ar.
// It turns the qa-verifier's round-6 probes into product tests that keep their final assertion,
// document.documentElement.scrollWidth - innerWidth <= 1 (read, not imported:
// docs/delivery/test-evidence/DG5/qa/tests/round-6/e2e/zz-qa-dg5r6-title-reflow-verify.spec.ts, R6-TITLE-B, and
// zz-qa-dg5r6-define-narrow.spec.ts, R6-DEFINE-NARROW):
//  - F-DG5-148: per language and token (a 120-character word without spaces, the 46-character token, an unbroken
//    Arabic token joined by underscores, ordinary text), a SYNTHETIC transformation with one Define outcome whose
//    statement holds the token. The outcome is a node of the Traceability graph (its record link, RecordName) and,
//    having no KPI, an item of the Modular entry "missing" list (the label "· <statement>"). Both pages are opened at
//    390, 360 and 320 px wide and at 1280 px with the root font at 200 %. Asserted: no page-level horizontal scroll,
//    the token is on the page (set-up check), and every element whose text holds the token lies inside the viewport
//    (in ar an overflow runs past the LEFT edge).
//  - F-DG5-149: a SYNTHETIC transformation with one ORDINARY outcome; Define at 390, 375, 360 and 320 px and at 200 %.
//    Asserted: no page-level horizontal scroll, the outcome card inside the viewport, and the Good-outcome test table
//    inside a focusable scroll region named by its localized caption.
// It collects every measurement first and then asserts once, so a failure names each failing case. Everything is
// SYNTHETIC demo data; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { asUser } from "./support/p3-journey-setup.ts";
import { apiSession, langOf, shot, SYN_RETAIL, tr } from "./support/ui.ts";

const stamp = Date.now().toString(36);
const TOKENS = {
  w120: `Synthetic_${"ABCDEFGHIJ".repeat(11)}`, // 120 characters, no break opportunity
  w46: "Synthetic_roaming_bill_shock_reduction_program",
  arU: "اصطناعي_برنامج_خفض_صدمة_فواتير_التجوال_للمسافرين_الدوليين_عبر_التطبيق", // unbroken Arabic
  plain: "Synthetic churn reduction on the prepaid base",
} as const;
const SIZES = [
  ["390", 390, 0],
  ["360", 360, 0],
  ["320", 320, 0],
  ["200pct", 1280, 200],
] as const;

async function settle(page: Page, font: number) {
  if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

/** Page overflow, and the innermost elements of main#main whose text holds `token` that lie outside the viewport
 *  without a horizontal scroll container between them and the page. */
async function measure(page: Page, token: string) {
  return page.evaluate((token) => {
    const W = window.innerWidth;
    const main = document.querySelector<HTMLElement>("main#main");
    const inScroller = (el: Element) => {
      for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
        const ox = getComputedStyle(x).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const outside: string[] = [];
    for (const el of Array.from(main?.querySelectorAll<HTMLElement>("*") ?? [])) {
      if (!(el.textContent ?? "").includes(token)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || inScroller(el)) continue;
      if (r.left < -1 || r.right > W + 1)
        outside.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return {
      pageOverflow: document.documentElement.scrollWidth - W,
      tokenPresent: (main?.textContent ?? "").includes(token),
      outside: outside.slice(0, 6),
    };
  }, token);
}

test("Record names with long unbroken text wrap on Traceability (graph record link) and Modular entry (missing-item label) at 390, 360, 320 px and with 200 % text", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(420_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const failures: string[] = [];
  const report: string[] = [];
  for (const [k, token] of Object.entries(TOKENS)) {
    const tid = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic AB1 ${k} ${lang} ${stamp}`,
        mode: "end_to_end",
      })
    ).id;
    await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: `AB1 ${token}` });
    const u = await asUser(browser, lang, "dev.lead");
    const screens = [
      ["traceability", `/transformations/${tid}/traceability`, "li.trace-node a.link"],
      ["modular", `/transformations/${tid}/modular-entry`, "ul[data-missing-items] > li"],
    ] as const;
    for (const [screen, url, holder] of screens) {
      for (const [label, width, font] of SIZES) {
        await u.page.setViewportSize({ width, height: 900 });
        await u.page.goto(url);
        await expect(u.page.locator(holder, { hasText: token }).first()).toBeVisible({ timeout: 20_000 });
        await settle(u.page, font);
        const m = await measure(u.page, token);
        const name = `${k}/${screen}/${label}`;
        report.push(`${name}: overflow ${m.pageOverflow}`);
        if (!m.tokenPresent) failures.push(`${name}: set-up, the token is not on the page`);
        if (m.pageOverflow > 1) failures.push(`${name}: the page scrolls horizontally by ${m.pageOverflow} px`);
        if (m.outside.length > 0) failures.push(`${name}: token text outside the viewport ${m.outside.join(", ")}`);
        if (label === "320" && k !== "plain") await shot(u.page, lang, `p5-record-name-${k}-${screen}-320`);
      }
    }
    await u.close();
  }
  console.info(`Record name reflow ${lang}: ${report.join("; ")}`);
  expect(failures).toEqual([]);
});

test("Define: the outcome card with ordinary text fits 390, 375, 360 and 320 px and 200 % text; the Good-outcome test table scrolls in its own named region", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const statement = "Synthetic: fewer roaming bill complaints";
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic AB1 define ${lang} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement });
  const u = await asUser(browser, lang, "dev.lead");
  const regionName = tr(lang, "common.table.scrollRegion", {
    caption: tr(lang, "define.goodOutcome.caption", { outcome: statement }),
  });
  const failures: string[] = [];
  const report: string[] = [];
  for (const [label, width, font] of [["375", 375, 0] as const, ...SIZES]) {
    await u.page.setViewportSize({ width, height: 900 });
    await u.page.goto(`/transformations/${tid}/define`);
    await expect(u.page.locator(".outcome-card__title", { hasText: statement })).toBeVisible({ timeout: 20_000 });
    await settle(u.page, font);
    // The table's scroll region: focusable and named by the localized caption (collected, not thrown, so a missing
    // region still reports the page overflow below).
    const region = u.page.getByRole("region", { name: regionName });
    const regions = await region.count();
    const inRegion = regions === 1 ? await region.locator("table.good-outcome__table").count() : 0;
    const focusable = regions === 1 ? await region.getAttribute("tabindex") : null;
    if (regions !== 1 || inRegion !== 1 || focusable !== "0")
      failures.push(`define/${label}: the Good-outcome table is not in one focusable region named "${regionName}"`);
    const m = await u.page.evaluate(() => {
      const W = window.innerWidth;
      const card = document.querySelector(".outcome-card")!.getBoundingClientRect();
      return {
        pageOverflow: document.documentElement.scrollWidth - W,
        card: [Math.round(card.left), Math.round(card.right)] as [number, number],
        W,
      };
    });
    report.push(`define/${label}: overflow ${m.pageOverflow}, card [${m.card[0]}..${m.card[1]}]`);
    if (m.pageOverflow > 1) failures.push(`define/${label}: the page scrolls horizontally by ${m.pageOverflow} px`);
    if (m.card[0] < -1 || m.card[1] > m.W + 1)
      failures.push(`define/${label}: the outcome card [${m.card[0]}..${m.card[1]}] is outside the viewport`);
    if (label === "320" || label === "360") await shot(u.page, lang, `p5-define-outcome-card-${label}`);
  }
  await u.close();
  console.info(`Define reflow ${lang}: ${report.join("; ")}`);
  expect(failures).toEqual([]);
});
