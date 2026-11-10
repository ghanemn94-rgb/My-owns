// T-DG6-FE-F2 regression (REQ-S15-012 "the guided walkthrough can be completed by keyboard alone"; ADR-0061 §7.1;
// p6-work-split §I/K.4) in chromium-en and chromium-ar. From the sign-in on, every interaction is a key press
// (Tab, Shift+Tab, Enter, Space, the arrow keys, Escape); there is no click and no fill. At every focus stop the focused
// element shows a visible indicator (computed outline or box-shadow; the focus.ring token), and each completed step is
// read back from the page:
//  1. the skip link moves focus into the page; Help > Guided walkthrough's transformation picker is reached by Tab and
//     set with the arrow keys; each of the twelve step links is reached by Tab, in order;
//  2. step 1 "create transformation" is performed in its native create form by keyboard; the walkthrough shows it done;
//  3. step 10 "generate report" is opened from its step link with Enter and performed by keyboard; the walkthrough
//     shows two steps done.
// The walkthrough answers only in a DEMO database (409 environment.not_demo elsewhere), so this spec runs on the demo
// stack: `e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/p6-walkthrough-keyboard.spec.ts --workers=1`.
// On the production-marked stack of apps/web/e2e (support/with-stack.sh) it is SKIPPED with that reason (never passed
// silently). Everything is SYNTHETIC; nothing approves anything real or names DG0-DG7. The acceptance proof is QA-D's.
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): 90 s. Measured loaded worst case: see
// docs/delivery/handbacks/DG6/T-DG6-FE-F2-evidence/e2e-p6-walkthrough-keyboard-demo-stack.log (the slowest run took
// 14.5 s while the full `pnpm test` ran in parallel on the same machine); 90 s is more than 6x that.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fieldLabel, langOf, signIn, tr, trackRequests } from "./support/ui.ts";

test.setTimeout(90_000);

/** The focused element shows a visible indicator: an outline (not none, not 0 wide) or a box-shadow. */
async function expectFocusVisible(page: Page, what: string) {
  const s = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
  });
  expect(s, `${what}: something is focused`).not.toBeNull();
  const visible = (s!.outline !== "none" && s!.width !== "0px") || s!.shadow !== "none";
  expect(visible, `${what}: visible focus (${JSON.stringify(s)})`).toBe(true);
}

/** Tab (or Shift+Tab) until `target` has focus; every stop on the way shows its focus. Fails when it is unreachable. */
async function tabTo(page: Page, target: Locator, what: string, max = 250, back = false) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      await expectFocusVisible(page, what);
      return;
    }
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const onBody = await page.evaluate(() => document.activeElement === document.body);
    if (!onBody) await expectFocusVisible(page, `${what} (stop ${i + 1})`);
  }
  await expect(target, `${what}: reachable by keyboard`).toBeFocused();
}

/** Arrow keys on a focused, closed <select> until it holds `value` (Chromium changes the value and fires change). */
async function arrowSelect(page: Page, select: Locator, value: string, what: string) {
  const count = await select.locator("option").count();
  for (let i = 0; i <= count && (await select.inputValue()) !== value; i++) await page.keyboard.press("ArrowDown");
  await expect(select, what).toHaveValue(value);
}

/** Into the page through the skip link: the first Tab stop of every screen. */
async function skipToMain(page: Page, lang: "en" | "ar") {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent"), exact: true });
  await expect(skip).toBeFocused();
  await expectFocusVisible(page, "skip link");
  await page.keyboard.press("Enter");
}

test("REQ-S15-012: the guided walkthrough is completed by keyboard alone (demo database)", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  const env = (await (await page.request.get("/api/v1/environment")).json()) as { synthetic?: boolean };
  test.skip(
    env.synthetic !== true,
    "needs a DEMO database: run it with e2e/support/with-demo-stack.sh (the walkthrough answers 409 environment.not_demo)",
  );

  // Step 1 in the native create form, by keyboard.
  await page.goto("/transformations/new");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transformations.createTitle"));
  await skipToMain(page, lang);
  const unit = page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit"));
  await tabTo(page, unit, "business unit");
  const opsValue = await unit
    .locator("option", { hasText: "SYN-OPS" })
    .first()
    .evaluate((o) => (o as HTMLOptionElement).value);
  await arrowSelect(page, unit, opsValue, "business unit chosen by arrow keys");
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await tabTo(page, name, "name");
  const title = `Synthetic FE-F2 keyboard ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  await page.keyboard.type(title);
  const create = page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true });
  await tabTo(page, create, "create");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  // The walkthrough: the picker by Tab and arrow keys; the twelve step links by Tab, in order.
  await page.goto("/walkthrough");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.walkthrough.title"));
  await skipToMain(page, lang);
  const picker = page.locator("[data-filter='walkthrough-transformation']");
  await tabTo(page, picker, "transformation picker");
  await arrowSelect(page, picker, id, "transformation chosen by arrow keys");
  await expect(page).toHaveURL(new RegExp(`transformationId=${id}`));
  await expect(page.locator("[data-progress]")).toHaveAttribute("data-progress", "1");
  await expect(page.locator("li[data-step='create_transformation']")).toHaveAttribute("data-completed", "yes");
  const links = page.locator("[data-step-link]");
  await expect(links).toHaveCount(12);
  for (let i = 0; i < 12; i++) await tabTo(page, links.nth(i), `step link ${i + 1}`, 6);
  // Back to step 10 with Shift+Tab, then Enter opens its native screen.
  const report = page.locator("[data-step-link='generate_report']");
  await tabTo(page, report, "step 10 link (Shift+Tab)", 6, true);
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/transformations/${id}/reports`);
  await expect(page.locator("main#main h1")).toBeVisible();

  // Step 10 by keyboard: the output chosen with the arrow keys, "Generate" with Enter. After an in-app navigation the
  // shell leaves the focus starting point where the activated link was (in the navigation, before main), so Tab
  // continues from there into the page (reported in the FE-F2 handback for the shell's owner; not a trap).
  const definition = page.locator("#report-definition");
  await tabTo(page, definition, "report definition");
  await arrowSelect(page, definition, "charter", "charter chosen by arrow keys");
  const generate = page.locator("form").filter({ has: definition }).locator("button[type='submit']");
  await tabTo(page, generate, "generate");
  await expect(generate).toBeEnabled();
  await page.keyboard.press("Enter");

  // Read back from the walkthrough: two steps done (the guide only reads persisted records).
  await expect(async () => {
    await page.goto(`/walkthrough?transformationId=${id}`);
    await expect(page.locator("[data-progress]")).toHaveAttribute("data-progress", "2", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.locator("li[data-step='generate_report']")).toHaveAttribute("data-completed", "yes");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});
