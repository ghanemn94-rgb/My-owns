// T-DG4-FE-R2 (D-111): route-level code splitting on the REAL stack (support/with-stack.sh; no mocks). SYNTHETIC
// demo users only. No product gate (G1-G6) is decided here, and none implies an engineering gate (DG0-DG7).
//  1. The pages are separate chunks served by the app itself: opening a page that was not visited yet fetches its
//     chunk from the application origin (no CDN, no remote loading), and the sign-in did not fetch it.
//  2. While a page's chunk is held back, the main area shows the ONE shared fallback: a translated role="status", no
//     number and no status colour; the shell (header, wordmark, navigation) stays in place and does not move. Released,
//     the page renders with its title and h1, and the fallback is gone.
//  3. A chunk that cannot be fetched shows a translated error with a reload, inside the shell (never a blank page).
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Page } from "@playwright/test";
import { BASE, escape, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

const scripts = (page: Page): string[] => {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "script") urls.push(req.url());
  });
  return urls;
};

/** The shell's position, to prove that it does not move while the fallback is replaced by the page. */
async function shellBoxes(page: Page) {
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  return { header: await box("header.app-header"), nav: await box("nav.app-nav"), main: await box("main#main") };
}

test("a page not visited yet is its own same-origin chunk; the shared fallback shows while it loads", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const loaded = scripts(page);
  await signIn(page, lang, "dev.lead");
  const beforeNavigation = loaded.length;
  expect(loaded.some((u) => /\/assets\/TransformationListPage-[^/]+\.js$/.test(u))).toBe(false);

  // Hold back every script chunk requested from now on, until released.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  const shellBefore = await shellBoxes(page);
  await page.locator('nav.app-nav a[href="/transformations"]').first().click();
  await page.waitForURL("**/transformations");

  const status = page.locator('main#main [data-route-fallback="loading"] [role="status"]');
  await expect(status).toBeVisible();
  await expect(status).toHaveText(tr(lang, "common.state.loadingPage"));
  await expect(status).toHaveAttribute("aria-live", "polite");
  // Never mistakable for data: no digit, no chip or status colour in the main area while the page loads.
  const mainText = (await page.locator("main#main").innerText()).trim();
  expect(mainText).toBe(tr(lang, "common.state.loadingPage"));
  expect(mainText).not.toMatch(/[0-9٠-٩]/);
  await expect(page.locator("main#main [data-tone], main#main .chip, main#main .badge")).toHaveCount(0);
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await shot(page, lang, "fe-r2-01-route-loading");
  await expectAccessible(page, lang, "fe-r2-01-route-loading");

  release();
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transformations.listTitle"));
  await expect(page.locator("[data-route-fallback]")).toHaveCount(0);
  await expect(page).toHaveTitle(new RegExp(`^${escape(tr(lang, "transformations.listTitle"))} · `));
  const shellAfter = await shellBoxes(page);
  // The shell did not move: the header and the navigation keep their place, the main area its start.
  expect(shellAfter.header).toEqual(shellBefore.header);
  expect(shellAfter.nav.x).toBe(shellBefore.nav.x);
  expect(shellAfter.nav.y).toBe(shellBefore.nav.y);
  expect(shellAfter.main.x).toBe(shellBefore.main.x);
  expect(shellAfter.main.y).toBe(shellBefore.main.y);

  // The page's chunk came from the application origin, after the sign-in, and nothing was fetched elsewhere.
  const chunk = loaded.slice(beforeNavigation).find((u) => /\/assets\/TransformationListPage-[^/]+\.js$/.test(u));
  expect(chunk, loaded.slice(beforeNavigation).join("\n")).toBeTruthy();
  expect(chunk!.startsWith(`${BASE}/assets/`)).toBe(true);
  expect(loaded.every((u) => u.startsWith(BASE))).toBe(true);
  expect(foreign).toEqual([]);
  await shot(page, lang, "fe-r2-02-route-loaded");
  await expectAccessible(page, lang, "fe-r2-02-route-loaded");
});

test("a chunk that cannot be fetched shows a translated error with a reload inside the shell", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.route(/\/assets\/[^/]+\.js$/, (route) => route.abort("failed"));
  await page.locator('nav.app-nav a[href="/about"]').first().click();
  await page.waitForURL("**/about");

  const alert = page.locator('main#main [data-route-fallback="failed"] [role="alert"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(tr(lang, "common.state.pageLoadFailed"));
  await expect(alert.getByRole("button", { name: tr(lang, "common.action.retry") })).toBeVisible();
  await expect(page.locator('main#main [role="status"]')).toHaveCount(0);
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await shot(page, lang, "fe-r2-03-route-load-failed");
  await expectAccessible(page, lang, "fe-r2-03-route-load-failed");

  // The reload fetches the chunk again; with the network back, the page renders.
  await page.unroute(/\/assets\/[^/]+\.js$/);
  await alert.getByRole("button", { name: tr(lang, "common.action.retry") }).click();
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(page.locator("[data-route-fallback]")).toHaveCount(0);
});
