// Table scroll regions on the non-P5 (DG2-DG4) screens at 390 px (T-DG5-FE-X1, D-172; F-DG5-142, REQ-S15-012),
// against the REAL API, in chromium-en and chromium-ar. The screens are the ones the qa-verifier's round-2 probe
// listed (docs/delivery/test-evidence/DG5/qa/tests/round-2/e2e/zz-qa-dg5r2-regions-keyboard.spec.ts, P2-DG24; read,
// not imported): the transformation overview, charter, readiness, gates G1 and G4, the transformation dashboard,
// the dashboards hub, the executive overview, admin organizations, and a business case, an initiative and a benefit
// formula. For every screen, at 390 x 844:
//  - axe (the rule set of support/ui.ts expectAccessible) reports no serious or critical violation; this is where
//    'scrollable-region-focusable' appeared on the four DG2-DG3 screens of the finding;
//  - every table wrapper (.table-wrap) in the main content is a keyboard-focusable (tabIndex 0), named region
//    (role=region and a non-empty localized aria-label), whether or not this data makes it scroll, so a later bare
//    wrapper fails here even on small data;
//  - on the demo stack, real keyboard: Tab reaches the charter's scope-check table region and the arrow key of the
//    reading direction scrolls it (the hidden columns the finding's screenshot shows cut off).
// It collects every screen's result first and then asserts once, so the failure names EACH failing screen.
//
// Two stacks, one spec (no skipped test on either):
//  - the DEMO stack (e2e/support/with-demo-stack.sh; GET /environment answers `synthetic: true`): the SYNTHETIC
//    International Roaming transformation, signed in as its demo role users, as the probe did. There the four
//    screens of the finding must really scroll horizontally at 390 px, so the check exercises the defect's condition;
//  - the production-marked stack (apps/web/e2e/support/with-stack.sh): a transformation this spec creates, and the
//    SYNTHETIC dev users. The record pages that need demo records (business case, initiative, benefit formula) are
//    visited only on the demo stack.
// Nothing here approves anything real, and nothing touches the engineering delivery gates DG0-DG7.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiSession, langOf, shot, SHOTS, signIn, SYN_RETAIL, type ApiSession, type Lang } from "./support/ui.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
type Role = "tl" | "adm";
/** The four screens of F-DG5-142 (axe 'scrollable-region-focusable' on the demo data). */
const FINDING_SCREENS = new Set([
  "/transformations/<T>",
  "/transformations/<T>/charter",
  "/transformations/<T>/readiness",
]);
const isFindingScreen = (screen: string) =>
  FINDING_SCREENS.has(screen) || screen.startsWith("/transformations/<T>/benefit-formulas/");

/** Serious or critical axe violations, as "rule: targets". */
async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

interface Wrapper {
  where: string;
  tabIndex: number;
  role: string | null;
  name: string;
  scrolls: boolean;
}

/** Every .table-wrap in the main content: focusable? named region? does it scroll horizontally here? */
async function wrappers(page: Page): Promise<Wrapper[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main#main .table-wrap")).map((el) => {
      const section = el.closest("[id]");
      return {
        where: `${section ? `#${section.id} ` : ""}.table-wrap > ${el.querySelector("caption")?.textContent?.trim() ?? "(no caption)"}`,
        tabIndex: el.tabIndex,
        role: el.getAttribute("role"),
        name: (el.getAttribute("aria-label") ?? "").trim(),
        scrolls: el.scrollWidth > el.clientWidth + 1,
      };
    }),
  );
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

/**
 * Real keyboard on one scrolling region: from the top of the page, Tab (bounded) until the region holds focus, then
 * the arrow key of the reading direction scrolls it. Returns a problem, or null. Captures the focused region.
 */
async function keyboardScrolls(page: Page, lang: Lang, selector: string, name: string): Promise<string | null> {
  const region = page.locator(selector).first();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  for (let presses = 0; presses < 250 && !reached; presses++) {
    await page.keyboard.press("Tab");
    reached = await region.evaluate((el) => document.activeElement === el);
  }
  if (!reached) return `keyboard: Tab never reaches ${selector}`;
  const before = await region.evaluate((el) => el.scrollLeft);
  for (let i = 0; i < 6; i++) await page.keyboard.press(lang === "ar" ? "ArrowLeft" : "ArrowRight");
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).not.toBe(before);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  await page.screenshot({ path: join(SHOTS, lang, `${name}.png`) });
  return null;
}

/** The first id of a list endpoint (the demo's record pages); a missing record is a set-up failure, not a skip. */
async function firstId(api: ApiSession, url: string): Promise<string | null> {
  const r = await api.call<{ items?: { id: string }[] } | { id: string }[]>("GET", url);
  const items = Array.isArray(r) ? r : (r.items ?? []);
  return items[0]?.id ?? null;
}

test("non-P5 screens at 390 px: every table wrapper is a focusable, named region, and axe reports no serious or critical violation", async ({
  browser,
  playwright,
}, info) => {
  // Up to 12 screens x (1 load + 1 axe run) per language; measured at well under a minute unloaded.
  test.setTimeout(300_000);
  const lang = langOf(info);
  // GET /environment needs a session; the SYNTHETIC dev users exist on both stacks (the demo stack runs seed-dev too).
  const devLead = await apiSession(playwright, "dev.lead");
  const demo = (await devLead.call<{ synthetic: boolean }>("GET", "/api/v1/environment")).synthetic === true;

  const users: Record<Role, string> = demo
    ? { tl: "roaming.user.tl", adm: "roaming.user.adm_access" }
    : { tl: "dev.lead", adm: "dev.admin" };
  const lead = await apiSession(playwright, users.tl);
  const T = demo
    ? ROAMING
    : (
        await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
          businessUnitId: SYN_RETAIL,
          name: `Synthetic table regions ${lang.toUpperCase()} ${Date.now()}`,
          mode: "end_to_end",
        })
      ).id;
  const base = `/transformations/${T}`;
  const screens: Array<[Role, string]> = [
    ["tl", base],
    ["tl", `${base}/charter`],
    ["tl", `${base}/readiness`],
    ["tl", `${base}/gates/G1`],
    ["tl", `${base}/gates/G4`],
    ["tl", `${base}/dashboard`],
    ["tl", "/dashboards"],
    ["tl", "/executive-overview"],
    ["adm", "/admin/organizations"],
  ];
  const failures: string[] = [];
  if (demo) {
    for (const [path, list] of [
      ["business-cases", `/api/v1/business-cases?transformationId=${T}&limit=5`],
      ["initiatives", `/api/v1/initiatives?transformationId=${T}&limit=5`],
      ["benefit-formulas", `/api/v1/benefit-formulas?transformationId=${T}&limit=5`],
    ] as const) {
      const id = await firstId(lead, list);
      if (id) screens.push(["tl", `${base}/${path}/${id}`]);
      else failures.push(`${base.replace(T, "<T>")}/${path}/<id> — set-up: the demo has no record (${list})`);
    }
  }

  const pages = new Map<Role, Page>();
  const report: string[] = [];
  for (const [role, url] of screens) {
    let page = pages.get(role);
    if (!page) {
      page = await userPage(browser, lang, users[role]);
      pages.set(role, page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const screen = url.replace(T, "<T>").replace(/\/[0-9a-f-]{36}$/, "/<id>");
    const problems: string[] = [];
    const setup = await open(page, url);
    if (setup) problems.push(setup);
    const found = await wrappers(page);
    for (const w of found) {
      if (w.tabIndex !== 0 || w.role !== "region" || w.name === "")
        problems.push(
          `bare table wrapper ${w.where} (tabIndex ${w.tabIndex}, role ${w.role ?? "none"}, name ${JSON.stringify(w.name)}${w.scrolls ? ", scrolls" : ""})`,
        );
    }
    const scrolling = found.filter((w) => w.scrolls).length;
    if (demo && isFindingScreen(screen) && scrolling === 0)
      problems.push("set-up: no table scrolls horizontally at 390 px on the demo data (the finding's condition)");
    for (const v of await seriousAxe(page)) problems.push(`390 px axe ${v}`);
    report.push(`${screen}: ${found.length} wrapper(s), ${scrolling} scrolling`);
    if (demo && isFindingScreen(screen))
      await shot(page, lang, `x1-regions-390${screen.replace(/[^a-zA-Z0-9]+/g, "_")}`);
    if (demo && screen === "/transformations/<T>/charter") {
      const kbd = await keyboardScrolls(page, lang, "#charter-scope .table-wrap", "x1-regions-390-charter-keyboard");
      if (kbd) problems.push(kbd);
    }
    for (const p of problems) failures.push(`${screen} — ${p}`);
  }
  for (const page of pages.values()) await page.context().close();
  console.info(
    `Table regions ${lang} (${demo ? "demo" : "production"} stack): ${screens.length} screens, ${failures.length} problem(s); ${report.join("; ")}`,
  );
  expect(failures).toEqual([]);
});
