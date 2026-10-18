// P5 reflow and axe regression (T-DG5-FE-V1, D-170; F-DG5-140 REQ-PB-093, F-DG5-141 REQ-S02-001) against the REAL API
// (apps/web/e2e/support/with-stack.sh). It visits the 31 P5 screens that the qa-verifier's round-1 probe listed
// (docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts, P-REFLOW; read, not imported)
// and, for each one, in chromium-en and chromium-ar:
//  - at 390 x 844: no page-level horizontal scroll, and axe reports no serious or critical violation;
//  - at 1366 x 900: axe reports no serious or critical violation;
//  - at 1280 x 900 with 200 % text (the method of the DG4 specs p4-traceability / p4-dashboards): no page-level
//    horizontal scroll, and axe reports no serious or critical violation.
// It collects every screen's result first and then asserts once, so the failure names EACH failing screen.
// The probe ran on the demo stack (SYNTHETIC roaming records); here the product stack's SYNTHETIC dev users are used:
// the transformation lead (`dev.lead`, on a transformation this spec creates), the Transformation Office
// (`dev.office`, the probe's TO) and the access administrator (`dev.admin`). Nothing here approves anything real, and
// nothing touches the engineering delivery gates DG0-DG7.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiSession, langOf, shot, signIn, SYN_RETAIL, type Lang } from "./support/ui.ts";

type Role = "tl" | "to" | "adm";
const USERS: Record<Role, string> = { tl: "dev.lead", to: "dev.office", adm: "dev.admin" };

/** The 31 screens of the qa probe, in its order; `T` is the transformation created below. */
const SCREENS = (T: string): Array<[Role, string]> => [
  ["tl", "/playbook/reader"],
  ["tl", "/playbook/reader/B0031"],
  ["tl", "/playbook/procedures"],
  ["tl", "/playbook/launch-plan"],
  ["tl", "/playbook/health-check"],
  ["tl", `/transformations/${T}/launch-plan`],
  ["tl", `/transformations/${T}/day-90-test`],
  ["tl", `/transformations/${T}/health-check`],
  ["tl", `/transformations/${T}/reports`],
  ["tl", `/transformations/${T}/exports`],
  ["tl", `/transformations/${T}/presentation`],
  ["tl", `/transformations/${T}/owner-updates`],
  ["tl", `/transformations/${T}/evidence-register`],
  ["tl", `/transformations/${T}/financial-metrics`],
  ["tl", `/transformations/${T}/gate-conditions`],
  ["tl", `/transformations/${T}/config-pins`],
  ["tl", `/transformations/${T}/traceability`],
  ["tl", "/walkthrough"],
  ["tl", "/my-work/notification-preferences"],
  ["to", "/admin/studio"],
  ["to", "/admin/studio/scoring-defaults"],
  ["to", "/admin/forms"],
  ["to", "/admin/procedures"],
  ["to", "/admin/automation"],
  ["to", "/admin/automation/failures"],
  ["adm", "/admin/jobs/operations"],
  ["to", "/admin/approval-routes"],
  ["to", "/admin/source-coverage"],
  ["to", "/admin/health-schemes"],
  ["adm", "/admin/branding"],
  ["adm", "/admin/demo"],
];

/** The screens repaired by T-DG5-FE-V1: always captured, in both languages, as visual evidence. */
const CAPTURED = new Set(["/admin/studio/scoring-defaults", "/admin/source-coverage"]);

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Serious or critical axe violations (the rule set of support/ui.ts expectAccessible), as "rule: targets". */
async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** The innermost elements that stick out of the viewport (names the cause of an overflow in the failure). */
async function offenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("main#main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= w + 1 && r.left >= -1)) continue;
      const kids = Array.from(el.children).some((c) => {
        const k = c.getBoundingClientRect();
        return k.width > 0 && (k.right > w + 1 || k.left < -1);
      });
      if (kids) continue;
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".");
      out.push(
        `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} left=${Math.round(r.left)} right=${Math.round(r.right)}`,
      );
      if (out.length >= 4) break;
    }
    return out;
  });
}

/** Opens the screen; returns a problem when it rendered a no-permission or error state (that would pass trivially). */
async function open(page: Page, url: string): Promise<string | null> {
  await page.goto(url);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const states = page.locator("main [data-state='no-permission'], main [data-state='error']").filter({ visible: true });
  return (await states.count()) > 0
    ? `set-up: the screen shows ${await states.first().getAttribute("data-state")} for this user`
    : null;
}

async function userPage(browser: Browser, lang: Lang, username: string): Promise<Page> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return page;
}

test("P5 screens: no page-level horizontal scroll at 390 px or with 200 % text, and no serious or critical axe violation at 390 px, 1366 px or with 200 % text", async ({
  browser,
  playwright,
}, info) => {
  // 31 screens x (3 loads + 3 axe runs); measured at about 3-4 minutes per language unloaded.
  test.setTimeout(900_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P5 reflow ${lang.toUpperCase()} ${Date.now()}`,
      mode: "end_to_end",
    })
  ).id;

  const pages = new Map<Role, Page>();
  const failures: string[] = [];
  for (const [role, url] of SCREENS(T)) {
    let page = pages.get(role);
    if (!page) {
      page = await userPage(browser, lang, USERS[role]);
      pages.set(role, page);
    }
    const screen = url.replace(T, "<T>");
    const name = screen.replace(/[^a-zA-Z0-9]+/g, "_");
    const problems: string[] = [];

    await page.setViewportSize({ width: 390, height: 844 });
    const setup = await open(page, url);
    if (setup) problems.push(setup);
    const o390 = await overflowOf(page);
    if (o390 > 1)
      problems.push(`390 px: page scrolls ${o390} px horizontally ${JSON.stringify(await offenders(page))}`);
    for (const v of await seriousAxe(page)) problems.push(`390 px axe ${v}`);
    if (CAPTURED.has(screen) || problems.length) await shot(page, lang, `p5-reflow-390${name}`);

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(url);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (const v of await seriousAxe(page)) problems.push(`1366 px axe ${v}`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.waitForLoadState("networkidle");
    const o200 = await overflowOf(page);
    if (o200 > 1)
      problems.push(`200 % text: page scrolls ${o200} px horizontally ${JSON.stringify(await offenders(page))}`);
    for (const v of await seriousAxe(page)) problems.push(`200 % text axe ${v}`);
    if (CAPTURED.has(screen) || problems.length) await shot(page, lang, `p5-reflow-200pct${name}`);

    for (const p of problems) failures.push(`${screen} — ${p}`);
  }
  for (const page of pages.values()) await page.context().close();
  console.info(`P5 reflow/axe ${lang}: ${SCREENS(T).length} screens, ${failures.length} problem(s)`);
  expect(failures).toEqual([]);
});
