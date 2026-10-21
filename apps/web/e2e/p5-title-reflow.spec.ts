// Long unbroken text in record titles reflows at 390 px, 320 px and with 200 % text (T-DG5-FE-AA1, D-178; F-DG5-147,
// REQ-S15-009, REQ-S15-012 WCAG 2.1 SC 1.4.10 Reflow), against the REAL API (apps/web/e2e/support/with-stack.sh), in
// chromium-en and chromium-ar.
// It is the qa-verifier's round-5 probe R5-TITLE (docs/delivery/test-evidence/DG5/qa/tests/round-5/e2e/
// zz-qa-dg5r5-form-tables-verify.spec.ts; read, not imported), which reported without asserting, turned into a product
// test that asserts its final condition, document.documentElement.scrollWidth - innerWidth <= 1:
//  - per language, three SYNTHETIC transformations whose name and T14 benefit title hold (a) a 120-character word
//    without spaces, (b) the 46-character token "Synthetic_roaming_bill_shock_reduction_program", (c) ordinary text;
//  - each is opened on the T14 benefit page (the DG4 card heading "B01 · <title>" and the P5 form framework heading
//    "Form tools: <title>") and the transformation overview (h1 page header and breadcrumbs), at 390 x 900, 320 x 900
//    and 1280 x 900 with the root font at 200 %;
//  - the P5 transformation picker (/playbook/launch-plan and /playbook/health-check, as the lead), which lists the
//    same names as links in .entry-list items, at the same sizes (found by p5-reflow-axe.spec.ts in ar when it ran
//    after this spec's data existed).
// Beyond the page-level check it asserts that every heading that carries the title (the h1, the page header's subtitle,
// the breadcrumbs, each h2.card__title) lies inside the viewport (in ar an overflow runs past the LEFT edge), and, so the fix cannot wrap
// ordinary text needlessly, that at 1280 x 900 with the default font the ordinary title renders the h1 and the
// "Form tools: <title>" heading on one line each. Set-up check: the long tokens really are in the headings measured
// (the page header: the overview's h1 and breadcrumbs, the benefit page's workspace subtitle; and the card titles).
// It collects every measurement first and then asserts once, so a failure names each failing case. Everything is
// SYNTHETIC demo data; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "./support/p3-journey-setup.ts";
import { apiSession, langOf, shot, SYN_RETAIL } from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const stamp = Date.now().toString(36);
const TOKENS = {
  w120: `Synthetic_${"ABCDEFGHIJ".repeat(11)}`, // 120 characters, no break opportunity
  w46: "Synthetic_roaming_bill_shock_reduction_program",
  plain: "Synthetic churn reduction on the prepaid base",
} as const;
const SIZES = [
  ["390", 390, 0],
  ["320", 320, 0],
  ["200pct", 1280, 200],
] as const;

interface Measure {
  W: number;
  pageOverflow: number;
  /** Headings carrying the title that lie (partly) outside the viewport. */
  outside: string[];
  /** Whether the token is present in the page header / in some h2.card__title (set-up check). */
  tokenInHeader: boolean;
  tokenInCard: boolean;
  /** Line counts of the h1 and of the "Form tools" card heading (if any). */
  h1Lines: number;
  toolsLines: number | null;
}

async function measure(page: Page, token: string): Promise<Measure> {
  return page.evaluate((token) => {
    const W = window.innerWidth;
    // Line count from the box height (a mixed-direction or mixed-font line has rects at several tops).
    const lines = (el: Element | null) => {
      if (!el) return 0;
      const lh = Number(getComputedStyle(el).lineHeight.replace("px", "")); // a CSS length in px, not a value
      return Math.round(el.getBoundingClientRect().height / lh);
    };
    const main = document.querySelector("main#main");
    const h1 = main?.querySelector("h1") ?? null;
    const cards = Array.from(main?.querySelectorAll<HTMLElement>("h2.card__title") ?? []);
    const outside: string[] = [];
    const header = main?.querySelector(".page-header") ?? null;
    for (const el of [
      h1,
      header?.querySelector(".page-header__subtitle"),
      header?.querySelector("nav.breadcrumbs"),
      ...cards,
    ]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -1 || r.right > W + 1)
        outside.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    const tools = cards.find((c) => c.closest("#benefit-form-tools")) ?? null;
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      outside,
      tokenInHeader: (header?.textContent ?? "").includes(token),
      tokenInCard: cards.some((c) => (c.textContent ?? "").includes(token)),
      h1Lines: lines(h1),
      toolsLines: tools ? lines(tools) : null,
    };
  }, token);
}

test("Record titles with long unbroken text wrap in page headings, breadcrumbs and card titles at 390, 320 px and with 200 % text (benefit page, transformation overview)", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(300_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const failures: string[] = [];
  const report: string[] = [];
  for (const [k, token] of Object.entries(TOKENS)) {
    const tid = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic ${token} ${lang} ${stamp}`,
        mode: "end_to_end",
      })
    ).id;
    const T = `/api/v1/transformations/${tid}`;
    const owner = await syntheticUser(
      admin,
      ORG,
      tid,
      `dev.aa1title.${k}.${lang}.${stamp}`,
      `Synthetic Benefit Owner ${lang}`,
      "BO",
      lang,
    );
    const kpi = await lead.call<{ id: string }>("POST", `${T}/kpi-definitions`, {
      name: `Synthetic NPS ${k} ${lang} ${stamp}`,
      unitKind: "score",
      polarity: "higher_is_better",
    });
    const bo = await apiSession(playwright, owner.username);
    const bid = (
      await bo.call<{ id: string }>("POST", `${T}/benefits`, {
        title: token,
        description: "Synthetic.",
        benefitType: "cx",
        valueClass: "non_financial",
        ownerUserId: owner.id,
        currency: "SAR",
        measurementKpiDefinitionId: kpi.id,
      })
    ).id;
    const u = await asUser(browser, lang, owner.username);
    const screens = [
      ["benefit", `/transformations/${tid}/benefits/${bid}`],
      ["overview", `/transformations/${tid}`],
    ] as const;
    const open = async (url: string, font: number) => {
      await u.page.goto(url);
      await expect(u.page.locator("main#main h1")).toBeVisible();
      await expect(u.page.locator("main#main .page-header")).toContainText(token);
      if (font) await u.page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
      await u.page.waitForLoadState("networkidle");
      await u.page.waitForTimeout(300);
    };
    for (const [screen, url] of screens) {
      for (const [label, width, font] of SIZES) {
        await u.page.setViewportSize({ width, height: 900 });
        await open(url, font);
        if (screen === "benefit")
          await expect(u.page.locator("#benefit-form-tools h2.card__title")).toContainText(token);
        const m = await measure(u.page, token);
        const name = `${k}/${screen}/${label}`;
        report.push(`${name}: overflow ${m.pageOverflow}`);
        if (!m.tokenInHeader) failures.push(`${name}: set-up, the token is not in the page header`);
        if (screen === "benefit" && !m.tokenInCard) failures.push(`${name}: set-up, the token is not in a card title`);
        if (m.pageOverflow > 1) failures.push(`${name}: the page scrolls horizontally by ${m.pageOverflow} px`);
        if (m.outside.length > 0) failures.push(`${name}: headings outside the viewport ${m.outside.join(", ")}`);
        if (label === "390" && k !== "plain") await shot(u.page, lang, `p5-title-reflow-${k}-${screen}-390`);
      }
      // No needless wrapping: the ordinary title stays on one line where it fits (1280 px, default font).
      if (k === "plain") {
        await u.page.setViewportSize({ width: 1280, height: 900 });
        await open(url, 0);
        const m = await measure(u.page, token);
        report.push(`plain/${screen}/1280: h1 ${m.h1Lines} line(s), Form tools ${m.toolsLines ?? "-"} line(s)`);
        if (m.h1Lines !== 1) failures.push(`plain/${screen}/1280: the h1 renders on ${m.h1Lines} lines`);
        if (screen === "benefit" && m.toolsLines !== 1)
          failures.push(`plain/${screen}/1280: the Form tools heading renders on ${m.toolsLines} lines`);
        if (screen === "benefit") await shot(u.page, lang, "p5-title-reflow-plain-benefit-1280");
      }
    }
    await u.close();
  }
  // The P5 transformation picker (/playbook/launch-plan, /playbook/health-check) lists the same names as links in
  // .entry-list items; the lead sees the transformations created above (an entry list is a title container too).
  const l = await asUser(browser, lang, "dev.lead");
  for (const segment of ["launch-plan", "health-check"] as const) {
    for (const [label, width, font] of SIZES) {
      await l.page.setViewportSize({ width, height: 900 });
      await l.page.goto(`/playbook/${segment}`);
      const list = l.page.locator(`ul[data-entry='${segment}']`);
      await expect(list).toContainText(TOKENS.w120);
      await expect(list).toContainText(TOKENS.w46);
      if (font) await l.page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
      await l.page.waitForLoadState("networkidle");
      await l.page.waitForTimeout(300);
      const m = await l.page.evaluate((segment) => {
        const W = window.innerWidth;
        const outside = Array.from(document.querySelectorAll(`ul[data-entry='${segment}'] > li a`))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.left < -1 || r.right > W + 1)
          .map((r) => `li a [${Math.round(r.left)}..${Math.round(r.right)}]`);
        return { pageOverflow: document.documentElement.scrollWidth - W, outside };
      }, segment);
      const name = `picker/${segment}/${label}`;
      report.push(`${name}: overflow ${m.pageOverflow}`);
      if (m.pageOverflow > 1) failures.push(`${name}: the page scrolls horizontally by ${m.pageOverflow} px`);
      if (m.outside.length > 0) failures.push(`${name}: entries outside the viewport ${m.outside.join(", ")}`);
      if (label === "390" && segment === "launch-plan") await shot(l.page, lang, "p5-title-reflow-picker-390");
    }
  }
  await l.close();
  console.info(`Title reflow ${lang}: ${report.join("; ")}`);
  expect(failures).toEqual([]);
});
