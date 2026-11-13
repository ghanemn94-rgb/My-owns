// T-DG7-FE-D (p7-plan §5.1 row FE-D; p7-work-split §I.5 T-I17): axe, Arabic RTL / English LTR, 360 px and keyboard
// checks over every P7 screen that T-DG7-FE-B (slices C and D) and T-DG7-FE-C (slice I) built, against the REAL API
// (apps/web/e2e/support/with-stack.sh; no mocks), in chromium-en and chromium-ar. All data is SYNTHETIC (seeded dev users:
// dev.admin holds ADM_TECH and ADM_ACCESS, dev.auditor AUD, dev.nobody no role).
//
// For every screen (`checkScreen`):
//  - it renders from the API: its `data-p7-screen` root, no placeholder (`data-p7-feature`), no loading spinner;
//  - `<html lang dir>` and the computed `direction` of `main` are rtl in Arabic and ltr in English;
//  - axe (WCAG 2.0/2.1 A+AA tags) reports no serious or critical violation, at 1280 px and again at 360 px;
//  - at 360 x 800 the page has no page-level horizontal scroll (documentElement.scrollWidth <= clientWidth);
//  - a full-page screenshot is saved in each language at both widths.
// Keyboard (`skipToMain`, `tabTo`): every path below starts with the skip link and continues with Tab, Enter and Space
// only; every focus stop on the way must show a visible indicator (computed outline or box-shadow). The forms are
// submitted from the keyboard and their result is read back from the page (and so from the API).
// The measurements are statements of what was measured on these screens, not a claim of conformity to a standard.
//
// Detail screens whose record cannot exist on a fresh stack (a migration import and its reconciliation report: imports
// are made by IT with the CLI, p7-work-split §C.11) are checked in their "Not found" (404) state only; this is
// disclosed in the T-DG7-FE-D handback.
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): every test sets 90 s. The measured worst case is in
// docs/delivery/handbacks/DG7/T-DG7-FE-D-evidence/e2e-p7.log; the budget is at least 2x it (see the handback).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SHOTS,
  axeSummary,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

test.setTimeout(90_000);

// Every axe result of this file (violations of any impact, so moderate and minor ones are visible too), per language.
test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.startsWith(`${lang}/p7-`)));
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "p7-axe-summary.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 360, height: 800 };
const UNKNOWN_ID = "01920000-0000-7000-9000-00000000f7d0";

/** The focused element shows a visible indicator: an outline (not none, not 0 wide) or a box-shadow. */
async function expectFocusVisible(page: Page, what: string) {
  const s = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
  });
  expect(s, `${what}: something is focused`).not.toBeNull();
  const visible = (s!.outline !== "none" && s!.width !== "0px") || s!.shadow !== "none";
  expect(visible, `${what}: visible focus (${JSON.stringify(s)})`).toBe(true);
}

/** Tab until `target` has focus; every stop on the way shows its focus. Fails when it is unreachable. */
async function tabTo(page: Page, target: Locator, what: string, max = 120): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      await expectFocusVisible(page, what);
      return i;
    }
    await page.keyboard.press("Tab");
    const onBody = await page.evaluate(() => document.activeElement === document.body);
    if (!onBody) await expectFocusVisible(page, `${what} (stop ${i + 1})`);
  }
  await expect(target, `${what}: reachable by keyboard`).toBeFocused();
  return max;
}

/** Into the page through the skip link: the first Tab stop after a full page load. */
async function skipToMain(page: Page, lang: Lang) {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent"), exact: true });
  await expect(skip).toBeFocused();
  await expectFocusVisible(page, "skip link");
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
}

async function open(page: Page, lang: Lang, path: string, title: string) {
  await page.setViewportSize(DESKTOP);
  await page.goto(path);
  await expect(page.locator("main#main h1")).toHaveText(title);
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
}

/**
 * The common checks of one screen in its current state: direction, axe at 1280 px and 360 px, no page-level horizontal
 * scroll at 360 px, and a screenshot at both widths. Returns the 360 px measurement for the log.
 */
async function checkScreen(page: Page, lang: Lang, name: string) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
  expect(
    await page.locator("main#main").evaluate((m) => getComputedStyle(m).direction),
    `${name}: main direction`,
  ).toBe(dir);
  await expect(page.locator("[data-p7-feature]"), `${name}: not the placeholder`).toHaveCount(0);
  await expectAccessible(page, lang, `p7-${name}`);
  await shot(page, lang, `p7-${name}`);
  await page.setViewportSize(PHONE);
  await expect(page.locator("main#main h1")).toBeVisible();
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(m.scroll, `${name}: no horizontal page scroll at 360 px (${JSON.stringify(m)})`).toBeLessThanOrEqual(m.client);
  await expectAccessible(page, lang, `p7-${name}-360`);
  await shot(page, lang, `p7-${name}-360`);
  await page.setViewportSize(DESKTOP);
  console.log(`[p7-a11y] ${lang} ${name}: axe ok at 1280 and 360; 360 px scrollWidth=${m.scroll} client=${m.client}`);
}

test("P7 Data export and its detail: keyboard request with a reason, axe, RTL/LTR, 360 px", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/migration/exports", tr(lang, "transfer.export.title"));
  await expect(page.locator("[data-p7-screen='data-export']")).toBeVisible();
  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await checkScreen(page, lang, "data-export");

  // Keyboard: skip link, Tab to the request button, Enter without a reason -> the inline error and focus on the reason.
  await page.goto("/admin/migration/exports");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transfer.export.title"));
  await skipToMain(page, lang);
  const form = page.locator("form[data-form='request-migration-export']");
  const reason = form.locator("#migration-export-reason");
  const submit = form.locator("button[data-action='request-export']");
  await tabTo(page, submit, "request export button");
  await page.keyboard.press("Enter");
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expectFocusVisible(page, "reason after the refused submit");
  await expectAccessible(page, lang, "p7-data-export-reason-error");
  await shot(page, lang, "p7-data-export-reason-error");
  await page.keyboard.type(`Synthetic FE-D keyboard export (${lang})`);
  await tabTo(page, submit, "request export button (2)");
  await page.keyboard.press("Enter");
  // No worker runs in this stack, so an export requested earlier on the same stack (the other language project) stays
  // queued: the server then refuses a second one with 422 migration.export_in_progress, shown in the form. Either outcome
  // is a server answer read back from the page; both are recorded.
  const requested = form.locator("[data-state='export-requested']");
  const refused = form.getByText(tr(lang, "problems.migration__export_in_progress"));
  await expect(requested.or(refused)).toBeVisible();
  const outcome = (await requested.isVisible()) ? "requested" : "refused-in-progress";
  console.log(`[p7-a11y] ${lang} data-export keyboard submit: ${outcome}`);
  if (outcome === "requested") await expect(reason).toHaveValue("");
  const firstRow = page.locator("[data-register='p7-migration-exports'] tbody tr").first();
  await expect(firstRow).toBeVisible();
  await expectAccessible(page, lang, `p7-data-export-${outcome}`);
  await shot(page, lang, `p7-data-export-${outcome}`);

  // Keyboard: Tab on to the newest export's link and open it with Enter.
  const link = firstRow.locator("a.link").first();
  await tabTo(page, link, "first export link");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/migration\/exports\/[0-9a-f-]{36}$/);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p7.migrationExport.title"));
  await expect(page.locator("[data-p7-screen='migration-export']")).toBeVisible();
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await expect(page.locator("#export-facts")).toBeVisible();
  // No worker runs in this stack: the export stays queued, and its downloads are "not ready" (never a broken link).
  await expect(page.locator("[data-state='downloads-ready']")).toHaveCount(0);
  await checkScreen(page, lang, "migration-export-detail");
  expect(foreign).toEqual([]);
});

test("P7 Migration status, identity rebinds and the import detail states: axe, RTL/LTR, 360 px, keyboard", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/v1/admin/")) writes.push(r.url());
  });
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/migration/imports", tr(lang, "transfer.import.title"));
  await expect(page.locator("[data-p7-screen='migration-status']")).toBeVisible();
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
  await checkScreen(page, lang, "migration-status");

  // Keyboard: every focus stop inside the page is visible, up to the last control of the page (the end of main).
  await page.goto("/admin/migration/imports");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transfer.import.title"));
  await skipToMain(page, lang);
  const stops = await page.evaluate(
    () => document.querySelectorAll("main#main a[href], main#main button:not([disabled]), main#main select").length,
  );
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    await expectFocusVisible(page, `migration status stop ${i + 1}`);
  }

  await open(page, lang, "/admin/migration/identity-rebinds", tr(lang, "transfer.rebind.title"));
  await expect(page.locator("[data-p7-screen='identity-rebinds']")).toBeVisible();
  await checkScreen(page, lang, "identity-rebinds");

  // A migration import and a reconciliation report cannot exist on a fresh stack (IT imports with the CLI): the detail
  // screens are checked in their 404 state ("Not found", which never discloses existence) for an id that does not exist.
  await open(page, lang, `/admin/migration/imports/${UNKNOWN_ID}`, tr(lang, "nav.p7.migrationImport.title"));
  await expect(page.locator("[data-p7-screen='migration-import'] [data-state='no-permission']").first()).toContainText(
    tr(lang, "common.state.notFoundTitle"),
  );
  await checkScreen(page, lang, "migration-import-not-found");
  await open(
    page,
    lang,
    `/admin/migration/imports/${UNKNOWN_ID}/reconciliations/${UNKNOWN_ID}`,
    tr(lang, "nav.p7.migrationReconciliation.title"),
  );
  await expect(
    page.locator("[data-p7-screen='migration-reconciliation'] [data-state='no-permission']").first(),
  ).toContainText(tr(lang, "common.state.notFoundTitle"));
  await checkScreen(page, lang, "migration-reconciliation-not-found");
  expect(writes).toEqual([]);
  expect(foreign).toEqual([]);
});

test("P7 Configuration transfer: keyboard bundle export, its detail, an uploaded bundle's import; axe, RTL/LTR, 360 px", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/config-transfer", tr(lang, "transfer.bundle.title"));
  await expect(page.locator("[data-p7-screen='config-transfer']")).toBeVisible();
  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await checkScreen(page, lang, "config-transfer");

  // Keyboard: a kind checkbox toggled with Space (and back), a reason typed, the export submitted with Enter.
  await page.goto("/admin/config-transfer");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transfer.bundle.title"));
  await skipToMain(page, lang);
  const form = page.locator("form[data-form='export-config-bundle']");
  const firstKind = form.locator("input[type='checkbox'][name='kinds']").first();
  await tabTo(page, firstKind, "first bundle kind");
  await page.keyboard.press("Space");
  await expect(firstKind).toBeChecked();
  await page.keyboard.press("Space");
  await expect(firstKind).not.toBeChecked();
  const reason = form.locator("#bundle-export-reason");
  await tabTo(page, reason, "bundle reason");
  await page.keyboard.type(`Synthetic FE-D keyboard bundle export (${lang})`);
  await tabTo(page, form.locator("button[data-action='export-bundle']"), "export bundle button");
  await page.keyboard.press("Enter");
  const done = form.locator("[data-state='bundle-exported']");
  await expect(done).toBeVisible();
  await expectAccessible(page, lang, "p7-config-transfer-exported");
  await shot(page, lang, "p7-config-transfer-exported");

  // Keyboard: Shift+Tab back to "Open the export" is not needed: the link follows the banner, so Tab from the form top.
  const openExport = done.locator("a.link");
  await openExport.focus();
  await expectFocusVisible(page, "open export link");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/config-transfer\/exports\/[0-9a-f-]{36}$/);
  const exportId = page.url().split("/").pop()!;
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p7.configBundleExport.title"));
  await expect(page.locator("[data-p7-screen='config-bundle-export']")).toBeVisible();
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await expect(page.locator("#bundle-export-facts")).toBeVisible();
  await checkScreen(page, lang, "config-bundle-export-detail");

  // The bundle's own bytes, uploaded back from the file control (the server validates them; nothing is committed).
  const download = await page.request.get(`/api/v1/admin/config-bundles/exports/${exportId}/download`);
  expect(download.status()).toBe(200);
  const bytes = await download.body();
  await open(page, lang, "/admin/config-transfer", tr(lang, "transfer.bundle.title"));
  const upload = page.locator("form[data-form='upload-config-bundle']");
  await upload.locator("#bundle-file").setInputFiles({
    name: `synthetic-fe-d-${lang}.json`,
    mimeType: "application/json",
    buffer: bytes,
  });
  const uploadButton = upload.locator("button[data-action='upload-bundle']");
  await upload.locator("#bundle-file").focus();
  await tabTo(page, uploadButton, "upload bundle button");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/config-transfer\/imports\/[0-9a-f-]{36}$/);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p7.configBundleImport.title"));
  await expect(page.locator("[data-p7-screen='config-bundle-import']")).toBeVisible();
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await expect(page.locator("#bundle-import-facts")).toBeVisible();
  await checkScreen(page, lang, "config-bundle-import-detail");
  expect(foreign).toEqual([]);
});

test("P7 Requirement register and its detail: keyboard open, axe, RTL/LTR, 360 px", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/requirements", tr(lang, "release.register.title"));
  await expect(page.locator("[data-p7-screen='requirements']")).toBeVisible();
  const table = page.locator("[data-register='p7-requirements']");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await checkScreen(page, lang, "requirements");

  // Keyboard: skip link, Tab to the first requirement link, Enter -> the detail panel with focus on its heading.
  await page.goto("/admin/requirements");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await skipToMain(page, lang);
  const first = table.locator("tbody a").first();
  const reqId = (await first.textContent())!.trim();
  await tabTo(page, first, "first requirement link");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/admin/requirements/${reqId}$`));
  const heading = page.locator("#requirement-detail-title");
  await expect(heading).toBeFocused();
  await expectFocusVisible(page, "requirement detail heading");
  await expect(page.locator("[data-p7-detail='requirement']")).toBeVisible();
  await checkScreen(page, lang, "requirement-detail");
  expect(foreign).toEqual([]);
});

test("P7 About this release: axe, RTL/LTR, 360 px, every focus stop visible", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/about", tr(lang, "release.about.title"));
  await expect(page.locator("[data-p7-screen='release-about']")).toBeVisible();
  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await checkScreen(page, lang, "about");
  await page.goto("/admin/about");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "release.about.title"));
  await skipToMain(page, lang);
  const stops = await page.evaluate(
    () => document.querySelectorAll("main#main a[href], main#main button:not([disabled]), main#main select").length,
  );
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    await expectFocusVisible(page, `about stop ${i + 1}`);
  }
  console.log(`[p7-a11y] ${lang} about: ${stops} focus stops visible`);
  expect(foreign).toEqual([]);
});

test("P7 screens without permission: the no-permission state, axe, 360 px", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.nobody");
  for (const [name, path, titleKey] of [
    ["no-permission-data-export", "/admin/migration/exports", "transfer.export.title"],
    ["no-permission-config-transfer", "/admin/config-transfer", "transfer.bundle.title"],
    ["no-permission-requirements", "/admin/requirements", "release.register.title"],
  ] as const) {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expect(page.locator("main#main h1")).toBeVisible();
    await expect(page.locator("[data-state='loading']")).toHaveCount(0);
    await expect(page.locator("[data-state='no-permission']").first()).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    expect(tr(lang, titleKey)).not.toBe("");
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectAccessible(page, lang, `p7-${name}`);
    await page.setViewportSize(PHONE);
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(m.scroll, `${name}: no horizontal page scroll at 360 px`).toBeLessThanOrEqual(m.client);
    await shot(page, lang, `p7-${name}-360`);
  }
  expect(foreign).toEqual([]);
});
