// T-DG7-FE-C2, T-E25 (p7-work-split §E.4: "axe, keyboard, 360 px" over the Retention screens of §E.6): the five
// Administration > Retention screens built by T-DG7-FE-C2 (pages/admin/retention), against the REAL API
// (apps/web/e2e/support/with-stack.sh; no mocks), in chromium-en and chromium-ar. All data is SYNTHETIC: the seeded
// dev.admin (ADM_ACCESS) only creates and grants one synthetic dev-issuer user per test and project (ADM_TECH or AUD;
// see "Language isolation" below), who drives the screens. No real IT reference is written: the reference text begins
// with TEST-ONLY.
//
// For every screen (`checkScreen`):
//  - it renders from the API: its `data-p7-screen` root, never the placeholder (`data-p7-feature`), no loading spinner;
//  - `<html lang dir>` and the computed `direction` of `main` are rtl in Arabic and ltr in English;
//  - axe (WCAG 2.0/2.1 A+AA tags) reports no serious or critical violation, at 1280 px and again at 360 px;
//  - at 360 x 800 the page has no page-level horizontal scroll (documentElement.scrollWidth <= clientWidth);
//  - a full-page screenshot is saved in each language at both widths.
// Keyboard: every path starts with the skip link and continues with Tab, Enter and typing only; every focus stop on the
// way must show a visible indicator (computed outline or box-shadow).
//  - Retention -> the project's own class link (EDIT_CLASS) (Enter) -> the change form: period, IT approval reference
//    and reason typed, Save with Enter; the saved period is read back from the page (and so from the API, If-Match from the loaded version). The
//    action stays "Keep" (no class is enabled by a test, p7-work-split §E.10).
//  - The run form: "Dry run" pressed with no reason shows the inline error and moves focus to the reason field; nothing
//    is posted. A dry run is NOT queued here: the e2e stack runs no worker, so a queued run would stay queued and every
//    later class change would be refused with retention.run_in_progress (the run requests are covered by the component
//    tests and the API integration tests, T-E13).
//  - Archived records: the table filter typed and applied with Enter; the URL carries exactly the filter.
// The measurements are statements of what was measured on these screens, not a claim of conformity to a standard.
//
// A run's detail screen is checked in its "Not found" (404) state only (no run exists on a fresh stack, see above).
//
// Language isolation (T-DG7-FE-C3, REQ-S16-024/REQ-S20-022): chromium-en and chromium-ar run in parallel workers. A
// shared seeded user (dev.admin, dev.auditor) has ONE stored language preference, so the other project's language
// switch reached this page on its next load or in-app navigation (GET /me re-read; prefreeze-r2 e2e-retention*.log).
// Each test therefore signs in as its own SYNTHETIC dev-issuer user, created for this project with
// preferredLocale = the project's language and granted only the role under test (ADM_TECH or AUD) by dev.admin
// (ADM_ACCESS), as p5-navigation.spec.ts does; its grants are revoked at the end. The language is set and verified
// with ensureLanguage after sign-in and after every page load, whatever order the projects run in.
//
// Budget (F-DG5-145/146/151): every test sets 90 s; the measured times are in
// docs/delivery/handbacks/DG7/T-DG7-FE-C2-evidence/e2e-p7-retention.log.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SHOTS,
  apiSession,
  axeSummary,
  ensureLanguage,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

test.setTimeout(90_000);

// Every axe result of this file (violations of any impact, so moderate and minor ones are visible too), per language.
test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.startsWith(`${lang}/retention-`)));
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "p7-retention-axe-summary.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 360, height: 800 };
const UNKNOWN_RUN = "01920000-0000-7000-9000-00000000f7d1";
/** A seeded operational class with no expiry job (migration 0143): its form is offered to ADM_TECH. */
const CLASS = "job_history";
/**
 * The class each project CHANGES (T-DG7-FE-C3): the projects run in parallel and a class is one shared server record,
 * so with one class for both, whichever saved second got the (correct) 409 "Someone else changed this record". Two
 * classes of the same shape (operational, archive-only, append-only, no expiry job; migration 0143) keep each
 * project's If-Match its own, in any run order. Read-only checks keep CLASS.
 */
const EDIT_CLASS: Record<Lang, string> = { en: "job_history", ar: "webhook_receipt_log" };
const ORG = "01920000-0000-7000-9000-000000000001";
const DEV_ISSUER = "urn:mth:dev-local";

type Assignment = { id: string; revokedAt: string | null; version: number };

/** A SYNTHETIC dev-issuer user of this project only (its own language preference), holding exactly `roleCode`. */
async function isolatedUser(admin: ApiSession, lang: Lang, roleCode: "ADM_TECH" | "AUD"): Promise<UserOf> {
  const username = `syn.retention.${roleCode.toLowerCase()}.${lang}.${Date.now()}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic retention ${roleCode} (${lang})`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode,
    scope: { type: "organization", id: ORG },
    reason: "Synthetic user for the retention end-to-end check (approves nothing real)",
  });
  return { id: user.id, username };
}
type UserOf = { id: string; username: string };

/** Revokes every active grant of the synthetic user (paged lists: re-read until none is left). */
async function revokeAll(admin: ApiSession, userId: string): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const list = await admin.call<{ items: Assignment[] }>(
      "GET",
      `/api/v1/role-assignments?organizationId=${ORG}&userId=${userId}`,
    );
    const active = list.items.filter((x) => x.revokedAt === null);
    if (active.length === 0) return;
    for (const a of active)
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic retention end-to-end check" },
        { ifMatch: a.version },
      );
  }
}

/** A full page load in this project's language: no spinner, then `<html lang dir>` set and verified. */
async function load(page: Page, lang: Lang, path: string) {
  await page.goto(path);
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
  await ensureLanguage(page, lang);
}

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
async function tabTo(page: Page, target: Locator, what: string, max = 150): Promise<number> {
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
  await load(page, lang, path);
  await expect(page.locator("main#main h1")).toHaveText(title);
}

async function checkScreen(page: Page, lang: Lang, name: string) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  await expect(page.locator("[data-p7-screen]")).toHaveCount(1);
  await expect(page.locator("[data-p7-feature]"), `${name}: not the placeholder`).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
  expect(
    await page.locator("main#main").evaluate((m) => getComputedStyle(m).direction),
    `${name}: main direction`,
  ).toBe(dir);
  await expectAccessible(page, lang, `retention-${name}`);
  await shot(page, lang, `p7-retention-${name}`);
  await page.setViewportSize(PHONE);
  await expect(page.locator("main#main h1")).toBeVisible();
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(m.scroll, `${name}: no horizontal page scroll at 360 px (${JSON.stringify(m)})`).toBeLessThanOrEqual(m.client);
  await expectAccessible(page, lang, `retention-${name}-360`);
  await shot(page, lang, `p7-retention-${name}-360`);
  await page.setViewportSize(DESKTOP);
}

/** Records every request to a retention or backup operation that is not a GET. */
function trackRetentionWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && /\/api\/v1\/admin\/(retention|backups)/.test(req.url()))
      writes.push(`${req.method()} ${req.url()}`);
  });
  return writes;
}

test("T-E25 Retention (ADM_TECH): classes, change form, run form, archived, backups, run 404", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const user = await isolatedUser(admin, lang, "ADM_TECH");
  try {
    await adminJourney(page, lang, user.username);
  } finally {
    await revokeAll(admin, user.id);
    await admin.req.dispose();
  }
});

async function adminJourney(page: Page, lang: Lang, username: string) {
  const foreign = trackRequests(page);
  const writes = trackRetentionWrites(page);
  const CLASS = EDIT_CLASS[lang];
  await signIn(page, lang, username);

  // Retention: every class from the API; a NULL period is "Not set (IT to agree)", never 0.
  await open(page, lang, "/admin/retention", tr(lang, "retention.title"));
  const classes = page.getByRole("table", { name: tr(lang, "retention.classes.title") });
  await expect(classes).toBeVisible();
  const auditRow = classes.getByRole("row").filter({ hasText: "audit_trail" }).first();
  await expect(auditRow.getByText(tr(lang, "retention.period.notSet"))).toBeVisible();
  await expect(auditRow.locator("[data-period]")).toHaveCount(0);
  await expect(page.locator("[data-form='request-retention-run']")).toBeVisible();
  await checkScreen(page, lang, "home");

  // Keyboard: the run form refuses an empty reason and moves focus to the field; nothing is posted.
  await load(page, lang, "/admin/retention");
  await skipToMain(page, lang);
  const dry = page.locator("[data-action='dry-run']");
  await tabTo(page, dry, "Dry run button");
  await page.keyboard.press("Enter");
  await expect(page.locator("#retention-run-reason")).toBeFocused();
  await expect(page.getByText(tr(lang, "adminP6.common.reasonInvalid"))).toBeVisible();
  await expectFocusVisible(page, "reason field after the refusal");
  expect(writes, "no run requested").toEqual([]);

  // Keyboard: a class link -> its page -> the change form, saved with Enter.
  await load(page, lang, "/admin/retention");
  await skipToMain(page, lang);
  const classLink = classes.locator(`a[href='/admin/retention/classes/${CLASS}']`);
  await tabTo(page, classLink, "class link");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", lang); // in-app navigation re-reads GET /me
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p7.retentionClass.title"));
  await expect(page.locator(`[data-class='${CLASS}']`)).toBeVisible();
  await expect(page.getByText(tr(lang, "retention.reference.help"))).toBeVisible();
  await checkScreen(page, lang, "class");
  await load(page, lang, `/admin/retention/classes/${CLASS}`);
  await expect(page.locator("[data-form='update-retention-class']")).toBeVisible();
  await skipToMain(page, lang);
  const days = lang === "ar" ? 400 : 401;
  await tabTo(page, page.locator("#retention-period"), "period field");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(String(days));
  await tabTo(page, page.locator("#retention-reference"), "reference field");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(`TEST-ONLY E2E-${lang}`);
  await tabTo(page, page.locator("#retention-class-reason"), "reason field");
  await page.keyboard.type("Synthetic end-to-end check of the retention form");
  await tabTo(page, page.locator("[data-action='save-class']"), "Save button");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-state='saved']")).toContainText(tr(lang, "retention.class.saved"));
  await expect(page.locator(`[data-class='${CLASS}'] [data-period='${days}']`)).toBeVisible();
  await expect(page.locator(`[data-class='${CLASS}']`)).toHaveAttribute("data-class-action", "retain");
  await expect(page.locator(`[data-class='${CLASS}']`).getByText(`TEST-ONLY E2E-${lang}`)).toBeVisible();
  expect(writes.filter((w) => w.startsWith("PUT ")).length, "one PUT").toBe(1);
  await shot(page, lang, "p7-retention-class-saved");

  // Archived records: the filter typed and applied from the keyboard.
  await open(page, lang, "/admin/retention/archived", tr(lang, "retention.archived.title"));
  await expect(page.getByText(tr(lang, "retention.archived.empty"))).toBeVisible();
  await checkScreen(page, lang, "archived");
  await load(page, lang, "/admin/retention/archived");
  await skipToMain(page, lang);
  await tabTo(page, page.locator("#archived-table"), "table filter");
  await page.keyboard.type("inbox_notification");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/retention\/archived\?table=inbox_notification$/);
  await expect(page.getByText(tr(lang, "retention.archived.empty"))).toBeVisible();

  // Backup sets: read-only, none reported on a fresh stack.
  await open(page, lang, "/admin/retention/backups", tr(lang, "retention.backups.title"));
  await expect(page.locator("[data-state='read-only']")).toContainText(tr(lang, "retention.backups.readOnly"));
  await expect(page.getByText(tr(lang, "retention.backups.none"))).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
  await checkScreen(page, lang, "backups");

  // A run that does not exist: the not-found state, never invented data.
  await open(page, lang, `/admin/retention/runs/${UNKNOWN_RUN}`, tr(lang, "nav.p7.retentionRun.title"));
  await expect(page.locator("[data-state='no-permission']")).toContainText(tr(lang, "common.state.notFoundTitle"));
  await checkScreen(page, lang, "run-404");

  expect(
    writes.filter((w) => !w.startsWith("PUT ")),
    "only the class change was written",
  ).toEqual([]);
  expect(foreign).toEqual([]);
}

test("T-E25 Retention (AUD): read-only class, no run form, backups readable", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const user = await isolatedUser(admin, lang, "AUD");
  try {
    await auditorJourney(page, lang, user.username);
  } finally {
    await revokeAll(admin, user.id);
    await admin.req.dispose();
  }
});

async function auditorJourney(page: Page, lang: Lang, username: string) {
  const writes = trackRetentionWrites(page);
  await signIn(page, lang, username);
  await open(page, lang, "/admin/retention", tr(lang, "retention.title"));
  await expect(page.getByRole("table", { name: tr(lang, "retention.classes.title") })).toBeVisible();
  await expect(page.locator("[data-form='request-retention-run']")).toHaveCount(0);
  await open(page, lang, `/admin/retention/classes/${CLASS}`, tr(lang, "nav.p7.retentionClass.title"));
  await expect(page.locator("[data-state='read-only']")).toContainText(tr(lang, "retention.class.readOnly"));
  await expect(page.locator("main form")).toHaveCount(0);
  await checkScreen(page, lang, "class-auditor");
  await open(page, lang, "/admin/retention/backups", tr(lang, "retention.backups.title"));
  await expect(page.getByText(tr(lang, "retention.backups.none"))).toBeVisible();
  expect(writes).toEqual([]);
}
