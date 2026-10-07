// F-DG2-480 (REQ-S16-030): a session that ends while the app is open lands ONCE on the sign-in page, against the REAL
// API and PostgreSQL (support/with-stack.sh; no mocks), in the project's language (chromium-en -> English LTR,
// chromium-ar -> Arabic RTL). The reviewer's round-13 scenarios:
//  1. signed out in another tab (POST /auth/logout with the browser's own cookie), then an in-app link: the sign-in
//     form and the localized "session ended" message appear within about 1 s; the URL stays on /login (no loop); a
//     bounded number of GET /me; no stale signed-in shell; axe 0 serious/critical; signing in again returns to the page;
//  2. the D-073 commit-time refusal: an administrator revokes the uploader's assignment (which ends their sessions)
//     while the evidence Upload dialog is open; the upload answers 401, nothing is stored, the dialog closes and the
//     user lands on the sign-in page with the message;
//  3. after a session end, a second browser context from the same IP can still sign in, and no response anywhere is
//     429. Run this file once more with the product's DEFAULT rate limits (E2E_DEFAULT_RATE_LIMITS=1, one project per
//     stack; see the handback T-DG2-FE10) to prove a session end never exhausts the per-IP bucket.
// All data is SYNTHETIC; the role assignment is a synthetic access change. No business approval is granted.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";
import {
  BASE,
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  ensureLanguage,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

const NOBODY = "01920000-0000-7000-9000-000000000205";
const DEFAULT_LIMITS = process.env["E2E_DEFAULT_RATE_LIMITS"] === "1";

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-session-end.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

/** T-DG2-FE12: the header and wordmark boxes, the language-not-saved notice's box, and the horizontal overflow. */
async function headerLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    };
    const header = document.querySelector("header.app-header")!;
    const wordmark = header.querySelector<HTMLElement>("[data-testid='wordmark']")!;
    const notice = document.querySelector("[data-testid='language-not-saved']");
    const root = document.documentElement;
    return {
      header: box(header),
      wordmark: box(wordmark),
      /** > 0 when the wordmark's content no longer fits its box (squeezed). */
      wordmarkOverflow: wordmark.scrollWidth - wordmark.clientWidth,
      notice: notice ? box(notice) : null,
      noticeInHeader: notice ? header.contains(notice) : null,
      /** > 0 when the page scrolls horizontally. */
      horizontalOverflow: root.scrollWidth - root.clientWidth,
    };
  });
}
const LAYOUT_WIDTHS = [320, 768, 1280] as const;

/** Runs `measure` with the language notice's live region (and the notice in it) removed from the layout. */
async function withoutNotice<T>(page: Page, measure: () => Promise<T>): Promise<T> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>(".language-switch__live")) el.style.display = "none";
  });
  try {
    return await measure();
  } finally {
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>(".language-switch__live")) el.style.display = "";
    });
  }
}

/** Counts GET /me requests and records every 429 the page receives. */
function watch(page: Page) {
  const state = { me: 0, tooMany: [] as string[] };
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/me") state.me++;
  });
  page.on("response", (r: Response) => {
    if (r.status() === 429) state.tooMany.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return state;
}

/** Ends the browser's session from outside the page, as a sign-out in another tab does. */
async function signOutElsewhere(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const me = (await (await fetch("/api/v1/me")).json()) as { csrfToken: string };
    const res = await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": me.csrfToken, "content-type": "application/json" },
      body: "{}",
    });
    return res.status;
  });
}

const devUsername = (lang: Lang) => fieldLabel(lang, "auth.dev.username");

/** The sign-in page with the localized session-ended message and the form; it then stays there (sampled 3 s). */
async function expectSessionEndedSignIn(page: Page, lang: Lang, returnTo: string, meBefore: () => number) {
  const message = tr(lang, "auth.errors.session_expired");
  // Within about 1 s of the trigger (1.5 s budget for a loaded CI machine).
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible({ timeout: 1_500 });
  await expect(page.getByLabel(devUsername(lang))).toBeVisible({ timeout: 1_500 });
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("error")).toBe("session_expired");
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  // No loop: sample the URL for 3 s; it never leaves /login, and /me stays bounded.
  const paths = new Set<string>();
  for (let i = 0; i < 30; i++) {
    paths.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  expect([...paths]).toEqual(["/login"]);
  expect(meBefore()).toBeLessThanOrEqual(3);
  // No stale signed-in shell.
  await expect(page.getByRole("button", { name: tr(lang, "auth.signOut") })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "nav.primary") })).toHaveCount(0);
}

async function newLangPage(browser: Browser, lang: Lang) {
  const context = await browser.newContext({
    locale: lang === "ar" ? "ar-SA" : "en-US",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
  });
  return { context, page: await context.newPage() };
}

test("signed out in another tab, then an in-app link: one landing on sign-in with the message", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const watched = watch(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, lang, "dev.lead");
  expect(await signOutElsewhere(page)).toBe(200);
  const meAt = watched.me;
  await page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, "nav.areas.transformations.label") })
    .click();
  await expectSessionEndedSignIn(page, lang, "/transformations", () => watched.me - meAt);
  await shot(page, lang, "session-end-in-app-link");
  await expectAccessible(page, lang, "session-end-in-app-link");
  // Signing in again returns the user to the page they asked for.
  const field = page.getByLabel(devUsername(lang));
  await field.fill("dev.lead");
  await field.press("Enter");
  await page.waitForURL("**/transformations");
  await expect(page.getByRole("button", { name: tr(lang, "auth.signOut") })).toBeVisible();
  expect(watched.tooMany).toEqual([]);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test("access withdrawn while the Upload dialog is open: the upload is refused, the dialog closes, one landing on sign-in", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const watched = watch(page);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const title = `Synthetic session-end upload ${lang.toUpperCase()}`;
  const tr0 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic session-end ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  const assignment = await admin.call<{ id: string; version: number }>("POST", "/api/v1/role-assignments", {
    userId: NOBODY,
    roleCode: "TL",
    scope: { type: "transformation", id: tr0.id },
    reason: "Synthetic session-end UI access",
  });
  await signIn(page, lang, "dev.nobody");
  const evidence = await page.evaluate(
    async ([tid, owner, name]) => {
      const me = (await (await fetch("/api/v1/me")).json()) as { csrfToken: string };
      const res = await fetch(`/api/v1/transformations/${tid}/evidence`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": me.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ kind: "file", title: name, ownerUserId: owner }),
      });
      return { status: res.status, body: (await res.json()) as { id: string } };
    },
    [tr0.id, NOBODY, title] as const,
  );
  expect(evidence.status).toBe(201);
  const evidencePath = `/transformations/${tr0.id}/evidence`;
  await page.goto(evidencePath);
  await page.getByRole("button", { name: rowAction(lang, "evidence.upload.action", title) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "synthetic-session-end.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic,data\n1,2\n", "utf8"),
  });
  // The administrator withdraws the access, which ends the uploader's sessions (D-073).
  await admin.call(
    "POST",
    `/api/v1/role-assignments/${assignment.id}/revoke`,
    { reason: "Synthetic session-end revoke" },
    {
      ifMatch: assignment.version,
    },
  );
  const meAt = watched.me;
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/content"));
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  expect((await refused).status()).toBe(401);
  await expectSessionEndedSignIn(page, lang, evidencePath, () => watched.me - meAt);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, lang, "session-end-upload-refused");
  await expectAccessible(page, lang, "session-end-upload-refused");
  // Nothing was stored: the item still has no file revision.
  const list = await lead.call<{ items: { id: string; currentContentId: string | null }[] }>(
    "GET",
    `/api/v1/transformations/${tr0.id}/evidence`,
  );
  expect(list.items.find((i) => i.id === evidence.body.id)?.currentContentId ?? null).toBeNull();
  expect(watched.tooMany).toEqual([]);
});

test(`after a session end, another browser context from the same IP can still sign in (no 429${DEFAULT_LIMITS ? ", product default limits" : ""})`, async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const first = await newLangPage(browser, lang);
  const watched = watch(first.page);
  await signIn(first.page, lang, "dev.office");
  expect(await signOutElsewhere(first.page)).toBe(200);
  const meAt = watched.me;
  await first.page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, "nav.areas.transformations.label") })
    .click();
  await expectSessionEndedSignIn(first.page, lang, "/transformations", () => watched.me - meAt);
  // Leave the ended tab open a while longer: it must stay quiet.
  await first.page.waitForTimeout(2_000);
  expect(watched.me - meAt).toBeLessThanOrEqual(3);
  const second = await newLangPage(browser, lang);
  const watched2 = watch(second.page);
  await signIn(second.page, lang, "dev.lead");
  await expect(second.page.getByRole("button", { name: tr(lang, "auth.signOut") })).toBeVisible();
  expect(watched.tooMany).toEqual([]);
  expect(watched2.tooMany).toEqual([]);
  info.annotations.push({
    type: "session-end",
    description: `rate limits=${DEFAULT_LIMITS ? "product defaults" : "harness (raised)"}; /me after the end in 5 s=${watched.me - meAt}; 429s=0`,
  });
  await second.context.close();
  await first.context.close();
});

test("a 403 is not a session end: a refused change keeps the user signed in where they are", async ({ page }, info) => {
  const lang = langOf(info);
  const watched = watch(page);
  await signIn(page, lang, "dev.lead");
  await page.goto("/about");
  // A sign-in in another tab of the same browser replaces the session cookie, so this tab's CSRF token no longer
  // matches: the real API refuses the next change with 403 `csrf` (not 401: the browser still has a valid session).
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", {
    data: { username: "dev.lead" },
    headers: { Origin: BASE },
  });
  expect(relogin.status()).toBe(204);
  const viewport = page.viewportSize()!;
  const meAt = watched.me;
  const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  const other: Lang = lang === "ar" ? "en" : "ar";
  await page
    .getByRole("button", {
      name: tr(lang, "common.language.switchTo", { language: other === "ar" ? "العربية" : "English" }),
    })
    .click();
  expect((await refused).status()).toBe(403);
  // T-DG2-FE11, behaviour (a): the language the user chose stays on screen, and the "not saved" notice says so in
  // exactly that language (never the previous one), inside one polite live region whose lang is that language.
  const notice = page.getByTestId("language-not-saved");
  await expect(notice).toHaveText(tr(other, "common.language.notSaved"));
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(page.locator("html")).toHaveAttribute("dir", other === "ar" ? "rtl" : "ltr");
  const live = page.locator('.language-switch__live[aria-live="polite"]');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveAttribute("lang", other);
  await expect(live).toHaveAttribute("aria-atomic", "true");
  await expect(live.getByTestId("language-not-saved")).toHaveCount(1);
  await expectAccessible(page, lang, "language-not-saved");
  await shot(page, lang, "language-not-saved");
  // T-DG2-FE12: the notice is a banner below the header. At 320, 768 and 1280 px it neither wraps the header nor
  // squeezes the wordmark (same header height and wordmark box as before the notice, the wordmark's content fits), it
  // does not overlap the wordmark, and the page does not scroll horizontally. axe at each width.
  for (const width of LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height: viewport.height });
    await expect(notice).toBeVisible();
    const now = await headerLayout(page);
    // The reference: the same page, language and width with the notice's region taken out of the layout, so any
    // difference in the header is caused by the notice alone (wrapping the header or squeezing the wordmark).
    const ref = await withoutNotice(page, () => headerLayout(page));
    const at = `${lang} ${width}px`;
    expect(now.noticeInHeader, at).toBe(false);
    expect(Math.abs(now.header.height - ref.header.height), `${at} header height`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.wordmark.width - ref.wordmark.width), `${at} wordmark width`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.wordmark.height - ref.wordmark.height), `${at} wordmark height`).toBeLessThanOrEqual(0.5);
    expect(now.wordmarkOverflow, `${at} wordmark content fits`).toBeLessThanOrEqual(0);
    expect(now.notice!.top, `${at} notice below the header`).toBeGreaterThanOrEqual(now.header.bottom - 0.5);
    expect(now.notice!.top, `${at} notice clear of the wordmark`).toBeGreaterThanOrEqual(now.wordmark.bottom);
    expect(now.horizontalOverflow, `${at} no horizontal scroll`).toBeLessThanOrEqual(0);
    expect(ref.horizontalOverflow, `${at} no horizontal scroll without the notice either`).toBeLessThanOrEqual(0);
    await expectAccessible(page, lang, `language-not-saved-${width}`);
    await shot(page, lang, `language-not-saved-${width}`);
    if (width <= 900) {
      // The small-screen menu opens below the header and the notice, never over them.
      const toggle = page.getByRole("button", { name: tr(other, "nav.toggle") });
      await toggle.click();
      const nav = page.getByRole("navigation", { name: tr(other, "nav.primary") });
      await expect(nav).toBeVisible();
      const navTop = (await nav.boundingBox())!.y;
      const noticeBox = (await notice.boundingBox())!;
      expect(navTop, `${at} menu below the header`).toBeGreaterThanOrEqual(now.header.bottom - 0.5);
      expect(navTop, `${at} menu below the notice`).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height - 0.5);
      await toggle.click();
      await expect(nav).toBeHidden();
    }
  }
  await page.setViewportSize(viewport);
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe("/about");
  // A second later nothing has flipped the page back: same language, same notice, signed in (in that language).
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(notice).toHaveText(tr(other, "common.language.notSaved"));
  await expect(page.getByRole("button", { name: tr(other, "auth.signOut"), exact: true })).toBeVisible();
  expect(watched.me - meAt).toBeLessThanOrEqual(1);
  expect(watched.tooMany).toEqual([]);
});

// F-DG2-500 (T-DG2-FE13): a session that ends while the SIGN-IN PAGE is shown clears the session-scoped cache there and
// then, and the next identity to sign in in that tab never sees the previous user's records. The reviewer's W5 path,
// in a real browser against the real API: user A (dev.office, organization-wide Transformation Office) sees a record
// in Synthetic Finance; A signs in from an in-document /login entry (the sign-in page's own wordmark link), so the
// browser history holds that entry; A's session ends elsewhere; the history goes back to that /login entry (the sign-in
// page's GET /me is what notices the end); user B (dev.lead, Synthetic Retail only, who cannot read A's record)
// signs in with the development form in the same tab and lands on the same list. B's list request is held for 1.5 s so
// the first render under B shows whatever the cache still holds; a MutationObserver records whether A's record text
// ever appears in the document while B is signed in. All data is SYNTHETIC.
const SYN_FIN = "01920000-0000-7000-9000-000000000103";

test("a session end on the sign-in page: the next user to sign in in the tab never sees the previous user's records", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const marker = `Synthetic A-only FE13 ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  const office = await apiSession(playwright, "dev.office");
  const record = await office.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_FIN,
    name: marker,
    mode: "end_to_end",
  });
  // Server-side authorisation is the first line: B cannot read A's record at all.
  const lead = await apiSession(playwright, "dev.lead");
  const leadList = await lead.call<{ items: { id: string }[] }>(
    "GET",
    `/api/v1/transformations?q=${encodeURIComponent(record.code)}`,
  );
  expect(leadList.items.map((i) => i.id)).not.toContain(record.id);

  // A: the sign-in page, its wordmark link (pushes an in-document /login entry), then the development sign-in.
  await page.goto("/login?returnTo=%2Ftransformations");
  await page.getByTestId("wordmark").click();
  await expect(page).toHaveURL(/\/login$/);
  const field = page.getByLabel(
    new RegExp(`^(?:${tr("ar", "auth.dev.username")}|${tr("en", "auth.dev.username")})(?:\\s*\\(.*\\))?$`),
  );
  await field.fill("dev.office");
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
  await page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, "nav.areas.transformations.label") })
    .click();
  await page.waitForURL("**/transformations");
  await expect(page.getByText(marker)).toBeVisible();
  await shot(page, lang, "fe13-user-a-sees-record");

  // A's session ends elsewhere; the history returns to the earlier in-document /login entry (same document).
  expect(await signOutElsewhere(page)).toBe(200);
  const docId = await page.evaluate(() => ((window as unknown as { __fe13: number }).__fe13 = Math.random()));
  await page.evaluate(() => history.go(-2));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ftransformations$/);
  await expect(page.getByLabel(devUsername(lang))).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __fe13: number }).__fe13)).toBe(docId); // no reload
  await expect(page.getByText(marker)).toHaveCount(0);

  // From now on, record whether A's record text ever reaches the document.
  await page.evaluate((m) => {
    const w = window as unknown as { __fe13Leak: string[] };
    w.__fe13Leak = [];
    new MutationObserver(() => {
      if (document.body.textContent?.includes(m)) w.__fe13Leak.push(location.pathname);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, marker);
  // B's list is slow: hold it so a stale cache would have time to render.
  let holdLists = false;
  await page.route(/\/api\/v1\/transformations\?/, async (route) => {
    if (holdLists) await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  holdLists = true;
  await page.getByLabel(devUsername(lang)).fill("dev.lead");
  await page.getByLabel(devUsername(lang)).press("Enter");
  await page.waitForURL("**/transformations");
  await page.waitForTimeout(2_500); // past the held list request
  holdLists = false;
  await ensureLanguage(page, lang);
  expect(await page.evaluate(() => (window as unknown as { __fe13: number }).__fe13)).toBe(docId); // same document
  expect(await page.evaluate(() => (window as unknown as { __fe13Leak: string[] }).__fe13Leak)).toEqual([]);
  await expect(page.getByText(marker)).toHaveCount(0);
  await expect(page.getByRole("button", { name: tr(lang, "auth.signOut") })).toBeVisible();
  await expect(page.getByText("Synthetic Transformation Lead")).toBeVisible();
  await expect(page.getByText("Synthetic Transformation Office")).toHaveCount(0);
  await shot(page, lang, "fe13-user-b-never-sees-a");
  await expectAccessible(page, lang, "fe13-user-b-never-sees-a");
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});
