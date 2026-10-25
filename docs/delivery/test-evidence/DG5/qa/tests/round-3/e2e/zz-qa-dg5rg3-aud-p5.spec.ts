// qa-verifier DG5 clean re-gate round 3 (T-DG5-RG-QA-R3; carried from rounds 1-2 as a regression probe) — independent AUD read-only pass over the P5 screens, with
// 390 px reflow, 200 % text and axe, in chromium-en and chromium-ar. Runs against the REAL stack
// (apps/web/e2e/support/with-stack.sh), copied into the disposable clone's apps/web/e2e/ for the run only.
//
// The SYNTHETIC read-only auditor `dev.auditor` opens each P5 screen (the 31-screen list of the product's
// p5-reflow-axe.spec.ts, re-typed here, plus the evidence-reports area), on a transformation `dev.lead` creates through
// the API. For each screen it records, and then asserts once (so the failure names every failing screen):
//  - R1: no mutating request (POST/PUT/PATCH/DELETE) is sent to /api while the auditor opens the screen;
//  - R2: no ENABLED write control in main: no enabled submit button, no enabled button or link-button whose name is a
//        write verb (en: the regex below; ar: the same screen's enabled-button count must equal en's, and every
//        enabled button name is logged for reading);
//  - R3: at 390 x 844 no page-level horizontal scroll; at 1280 x 900 with 200 % root font size none either;
//  - R4: axe (wcag2a/aa, 21a/aa) has no serious or critical violation at 390 px and at 200 %.
// A screen that shows the product's no-permission state to the auditor is recorded as such (it then has no write
// control by construction); that list is printed for the review to judge.
// Nothing is approved; nothing names DG0-DG7.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, shot, signIn, SYN_RETAIL } from "./support/ui.ts";

const SCREENS = (T: string): string[] => [
  "/playbook/reader",
  "/playbook/reader/B0031",
  "/playbook/procedures",
  "/playbook/launch-plan",
  "/playbook/health-check",
  `/transformations/${T}/launch-plan`,
  `/transformations/${T}/day-90-test`,
  `/transformations/${T}/health-check`,
  `/transformations/${T}/reports`,
  `/transformations/${T}/exports`,
  `/transformations/${T}/presentation`,
  `/transformations/${T}/owner-updates`,
  `/transformations/${T}/evidence-register`,
  `/transformations/${T}/financial-metrics`,
  `/transformations/${T}/gate-conditions`,
  `/transformations/${T}/config-pins`,
  `/transformations/${T}/traceability`,
  // round 2: the screens the RG1 wave added or changed (F-DG5-120 slip impacts; F-DG5-122 reader tables)
  `/transformations/${T}/dependencies`,
  "/playbook/reader/B0156",
  "/evidence-reports/evidence-register",
  "/walkthrough",
  "/my-work/notification-preferences",
  "/admin/studio",
  "/admin/studio/scoring-defaults",
  "/admin/forms",
  "/admin/procedures",
  "/admin/automation",
  "/admin/automation/failures",
  "/admin/jobs/operations",
  "/admin/approval-routes",
  "/admin/source-coverage",
  "/admin/health-schemes",
  "/admin/branding",
  "/admin/demo",
];

const WRITE_EN =
  /\b(save|create|new|add|publish|submit|delete|remove|archive|generate|approve|reject|record|run|retry|upload|edit|launch|complete|start|discard|roll ?back|issue|reissue|decide|assign|invite|enable|disable|update|reset|restore|change)\b/i;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function serious(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
async function enabledButtons(page: Page): Promise<{ name: string; submit: boolean }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("main#main button"))
      // Refined after the first (unset) run: column sort headers (inside th) and the submit of a role="search" form are
      // read-only controls, not write controls.
      .filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && b.offsetParent !== null)
      .filter((b) => !b.closest("th") && !b.closest("form[role='search']"))
      .map((b) => ({ name: (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "), submit: b.type === "submit" })),
  );
}
async function open(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const st = page.locator("main [data-state='no-permission'], main [data-state='error']").filter({ visible: true });
  return (await st.count()) > 0 ? ((await st.first().getAttribute("data-state")) ?? "state") : "ok";
}

// en and ar run in separate workers: the en counts go through a scratch file ($QA_AUD_COUNTS, under $TMPDIR).
const COUNTS = process.env["QA_AUD_COUNTS"] ?? "";
const enCounts = new Map<string, number>(
  COUNTS && existsSync(COUNTS) ? (Object.entries(JSON.parse(readFileSync(COUNTS, "utf8"))) as [string, number][]) : [],
);

test("QA AUD P5: the read-only auditor sends no mutation and has no enabled write control on any P5 screen; 390 px, 200 % and axe", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(600_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic qa AUD P5 ${lang} ${Date.now()}`,
      mode: "end_to_end",
    })
  ).id;
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await ctx.newPage();
  await signIn(page, lang, "dev.auditor");
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method())) mutations.push(`${r.method()} ${r.url()}`);
  });

  const failures: string[] = [];
  const states: string[] = [];
  for (const url of SCREENS(T)) {
    const screen = url.replace(T, "<T>");
    const name = screen.replace(/[^a-zA-Z0-9]+/g, "_");
    const before = mutations.length;
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await open(page, url);
    states.push(`${screen}=${state}`);
    const buttons = await enabledButtons(page);
    const o390 = await overflow(page);
    const a390 = await serious(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.waitForLoadState("networkidle");
    const o200 = await overflow(page);
    const a200 = await serious(page);
    const sent = mutations.slice(before);
    const writes = buttons.filter((b) => b.submit || (lang === "en" && WRITE_EN.test(b.name)));
    console.info(
      `QA-AUD ${lang} ${screen} state=${state} overflow390=${o390} overflow200=${o200} axe390=${a390.length} axe200=${a200.length} mutations=${sent.length} enabledButtons=${JSON.stringify(buttons.map((b) => b.name))}`,
    );
    if (lang === "en") enCounts.set(screen, buttons.length);
    else if (enCounts.has(screen) && enCounts.get(screen) !== buttons.length)
      failures.push(`${screen}: ar has ${buttons.length} enabled buttons, en had ${enCounts.get(screen)}`);
    if (sent.length) failures.push(`${screen}: mutating requests ${JSON.stringify(sent)}`);
    if (writes.length) failures.push(`${screen}: enabled write control(s) ${JSON.stringify(writes)}`);
    if (o390 > 1) failures.push(`${screen}: 390 px page scrolls ${o390} px`);
    if (o200 > 1) failures.push(`${screen}: 200 % text page scrolls ${o200} px`);
    for (const v of a390) failures.push(`${screen}: 390 px axe ${v}`);
    for (const v of a200) failures.push(`${screen}: 200 % axe ${v}`);
    if (failures.some((f) => f.startsWith(`${screen}:`))) await shot(page, lang, `qa-aud-fail${name}`);
  }
  if (lang === "en" && COUNTS) writeFileSync(COUNTS, JSON.stringify(Object.fromEntries(enCounts)));
  await shot(page, lang, "qa-aud-last-screen-200pct");
  console.info(`QA-AUD ${lang} states: ${states.join(" ")}`);
  console.info(`QA-AUD ${lang}: ${SCREENS(T).length} screens, ${failures.length} problem(s)`);
  await ctx.close();
  expect(failures).toEqual([]);
});
