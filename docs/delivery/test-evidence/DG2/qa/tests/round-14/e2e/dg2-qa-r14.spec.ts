// qa-verifier DG2 round 14 — independent negative/regression probes for the D-074 repairs on candidate 9f3ca298
// (T-DG2-REV-QA-R14, rerun R14B): FE10 (8cb3bb8, F-DG2-480: a session that ends while the app is open lands ONCE on
// sign-in), FE11 (59d38ad: the language-not-saved notice speaks the language shown) and FE12 (7f03453: render-time
// translation; the notice is a banner below the header). Authored by qa-verifier, NOT by an implementer. Runs in
// chromium-en and chromium-ar against the REAL built API + PostgreSQL (e2e/support/qa-stack.sh, or
// apps/web/e2e/support/with-stack.sh with E2E_DEFAULT_RATE_LIMITS=1 for R14-03). Where a probe needs a status the
// seed cannot produce through the UI (R14-04a/b: a 403 `forbidden` on a read and on a create), the ONE response is
// replaced with page.route and this is said in the test name; everything else is the real API.
//
// R14-01 sign-out in a REAL second tab (its own Sign out button), then an in-app link in the first tab: one landing
//   on sign-in with the localized message, dir/lang right, URL stable for 3 s, GET /me bounded, no stale shell; the
//   second tab shows "signed out" (not "session ended"); Back from sign-in never re-renders the signed-in shell nor
//   loops; switching language on the sign-in page translates the message and flips dir (FE12); signing in again
//   returns to the requested page.
// R14-02 an upload refused with 401 after the uploader's access is revoked (the revoke ends their sessions, D-073):
//   the user sees the localized "session ended" message on the sign-in page, the dialog is gone, nothing stored (DB),
//   the revoke is audited as session.revoke; signing in again (no grant left) shows no-permission/not-found, no loop.
// R14-03 THREE tabs of one browser whose session ends at once, left open 10 s: each lands once, total GET /me bounded,
//   no 429 anywhere; a second browser context from the same IP signs in and navigates. Run once more under the
//   product's DEFAULT limits (20 auth / 300 general per minute).
// R14-04 a 403 is never a session end: (a) a 403 `forbidden` on the list read [route-replaced], (b) a 403 `forbidden`
//   on the create POST [route-replaced], (c) a REAL 403 `csrf` on the preference save: the user stays signed in where
//   they are; no /login; /me bounded.
// R14-05 a refused language-preference save (REAL 403 csrf), both directions in one page: EN->AR then AR->EN (or the
//   reverse in chromium-ar): the notice text is exactly the shown language's string, html lang/dir and the live
//   region's lang match, the notice's computed direction matches; a reload restores the persisted language, no notice.
// R14-06 a language switch while an error is visible (required-field errors, a 403 server error banner, a not-found
//   state, the dev-login invalid-username error) updates its text and direction; the header layout holds at 320, 768
//   and 1280 px with the notice shown in both languages (no header growth, wordmark fits, no horizontal scroll); axe.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";
import {
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  shot,
  signIn,
  tr,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const NOBODY = "01920000-0000-7000-9000-000000000205"; // dev.nobody: no grant in the synthetic dev seed
const DEFAULT_LIMITS = process.env["E2E_DEFAULT_RATE_LIMITS"] === "1";
const NAMES: Record<Lang, string> = { ar: "العربية", en: "English" };
const other = (l: Lang): Lang => (l === "ar" ? "en" : "ar");
const ARABIC = /[؀-ۿ]/;

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-qa-r14.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh or with-stack.sh");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const safe = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};

/** Counts GET /me, every response status >= 400 by path, and every 429. */
function watch(page: Page) {
  const st = { me: 0, tooMany: [] as string[], errors: [] as string[], pageErrors: [] as string[], requests: 0 };
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) st.requests++;
    if (r.method() === "GET" && u.pathname === "/api/v1/me") st.me++;
  });
  page.on("response", (r: Response) => {
    if (r.status() === 429) st.tooMany.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => st.pageErrors.push(e.message));
  return st;
}

const signOutButton = (page: Page, lang: Lang) => page.getByRole("button", { name: tr(lang, "auth.signOut"), exact: true });
const navLink = (page: Page, lang: Lang, area: string) =>
  page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, `nav.areas.${area}.label`), exact: true });
const switchTo = (page: Page, from: Lang) =>
  page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[other(from)] }), exact: true });

async function expectDir(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

/** Samples the path every 100 ms for `ms`; returns the distinct paths seen. */
async function pathsFor(page: Page, ms: number): Promise<string[]> {
  const seen = new Set<string>();
  for (let i = 0; i < ms / 100; i++) {
    seen.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  return [...seen];
}

/** The landing after a session end: the sign-in page, the localized message, the form, no shell, stable. */
async function expectEndedLanding(page: Page, lang: Lang, returnTo: string | null) {
  const message = tr(lang, "auth.errors.session_expired");
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible({ timeout: 2_000 });
  await expectDir(page, lang);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("error")).toBe("session_expired");
  if (returnTo !== null) expect(url.searchParams.get("returnTo")).toBe(returnTo);
  expect(await pathsFor(page, 3_000)).toEqual(["/login"]);
  await expect(signOutButton(page, lang)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "nav.primary") })).toHaveCount(0);
}

async function endSessionFromOutside(page: Page): Promise<number> {
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

async function newLangContext(browser: Browser, lang: Lang): Promise<BrowserContext> {
  return browser.newContext({
    locale: lang === "ar" ? "ar-SA" : "en-US",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
  });
}

const problem = (status: number, code: string) => ({
  status,
  contentType: "application/problem+json",
  body: JSON.stringify({
    type: `https://mth.invalid/problems/${code}`,
    title: code,
    status,
    code,
    detail: "qa-verifier R14 replaced response",
    requestId: "qa-r14-replaced",
  }),
});

// ------------------------------------------------------------------------------------------------------------------
test("R14-01 sign-out in a real second tab, then an in-app link: one landing; Back; language switch on sign-in", async ({
  page,
}, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  const w = watch(page);
  await signIn(page, lang, "dev.lead");
  const tabB = await page.context().newPage();
  const wB = watch(tabB);
  await tabB.goto("/about");
  await expect(signOutButton(tabB, lang)).toBeVisible();
  await signOutButton(tabB, lang).click();
  await tabB.waitForURL("**/login**");
  await expect(tabB.getByRole("status").filter({ hasText: tr(lang, "auth.signedOut") })).toBeVisible();
  await expect(tabB.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toHaveCount(0);
  await page.bringToFront();
  const meAt = w.me;
  const already = new URL(page.url()).pathname === "/login";
  info.annotations.push({ type: "r14-01", description: `tab A already on /login before the click: ${already}` });
  if (!already) await navLink(page, lang, "transformations").click();
  await expectEndedLanding(page, lang, already ? null : "/transformations");
  expect(w.me - meAt, "GET /me after the trigger").toBeLessThanOrEqual(3);
  await shot(page, lang, "qa-r14-01-landing");
  await expectAccessible(page, lang, "qa-r14-01-landing");

  // Back: the previous entry is a signed-in page; it must not render the shell nor loop.
  await page.goBack();
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible({ timeout: 3_000 });
  expect(await pathsFor(page, 3_000)).toEqual(["/login"]);
  await expect(signOutButton(page, lang)).toHaveCount(0);
  expect(w.me - meAt, "GET /me after Back").toBeLessThanOrEqual(6);

  // FE12: switching language while the message is visible translates it and flips the direction.
  if (new URL(page.url()).searchParams.get("error") === "session_expired") {
    await switchTo(page, lang).click();
    const o = other(lang);
    await expectDir(page, o);
    await expect(page.getByRole("alert").filter({ hasText: tr(o, "auth.errors.session_expired") })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toHaveCount(0);
    await expectAccessible(page, lang, "qa-r14-01-landing-switched");
    await shot(page, lang, "qa-r14-01-landing-switched");
    await switchTo(page, o).click();
    await expectDir(page, lang);
  }
  // Signing in again returns to the requested page.
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  const field = page.getByLabel(fieldLabel(lang, "auth.dev.username"));
  await field.fill("dev.lead");
  await field.press("Enter");
  await expect(signOutButton(page, lang)).toBeVisible();
  if (returnTo) expect(new URL(page.url()).pathname).toBe(returnTo);
  expect(w.tooMany).toEqual([]);
  expect(wB.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  await tabB.close();
});

// ------------------------------------------------------------------------------------------------------------------
test("R14-02 upload refused with 401 after revocation: message, sign-in, nothing stored, audited", async ({
  page,
  playwright,
}, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  const w = watch(page);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const t0 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R14 upload ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  const asg = await admin.call<{ id: string; version: number }>("POST", "/api/v1/role-assignments", {
    userId: NOBODY,
    roleCode: "TL",
    scope: { type: "transformation", id: t0.id },
    reason: "Synthetic QA R14 access",
  });
  await signIn(page, lang, "dev.nobody");
  const title = `QA R14 evidence ${lang}`;
  const ev = await page.evaluate(
    async ([tid, owner, name]) => {
      const me = (await (await fetch("/api/v1/me")).json()) as { csrfToken: string };
      const res = await fetch(`/api/v1/transformations/${tid}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": me.csrfToken, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ kind: "file", title: name, ownerUserId: owner }),
      });
      return { status: res.status, body: (await res.json()) as { id: string } };
    },
    [t0.id, NOBODY, title] as const,
  );
  expect(ev.status).toBe(201);
  const path = `/transformations/${t0.id}/evidence`;
  await page.goto(path);
  await page.getByRole("button", { name: rowAction(lang, "evidence.upload.action", title) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "qa-r14.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic,qa\n1,2\n", "utf8"),
  });
  const sessionsBefore = Number(sql(`select count(*) from audit_event where action = 'session.revoke'`));
  await admin.call("POST", `/api/v1/role-assignments/${asg.id}/revoke`, { reason: "Synthetic QA R14 revoke" }, { ifMatch: asg.version });
  const meAt = w.me;
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/content"));
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  const res = await refused;
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  await expectEndedLanding(page, lang, path);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(w.me - meAt).toBeLessThanOrEqual(3);
  await shot(page, lang, "qa-r14-02-upload-refused");
  await expectAccessible(page, lang, "qa-r14-02-upload-refused");
  // Nothing stored; the session end is audited.
  expect(Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(ev.body.id)}'`))).toBe(0);
  expect(Number(sql(`select count(*) from audit_event where action = 'session.revoke'`))).toBeGreaterThan(sessionsBefore);
  // Signing in again with no grant left: an explained state on the evidence page, never a loop back to sign-in.
  const field = page.getByLabel(fieldLabel(lang, "auth.dev.username"));
  await field.fill("dev.nobody");
  await field.press("Enter");
  await expect(signOutButton(page, lang)).toBeVisible();
  await expect(page.locator("[data-state='no-permission'], [data-state='error']").first()).toBeVisible();
  expect(await pathsFor(page, 2_000)).toEqual([path]);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test(`R14-03 three tabs ended at once, open 10 s; another context signs in (no 429${DEFAULT_LIMITS ? ", PRODUCT DEFAULT LIMITS" : ""})`, async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const ctx = await newLangContext(browser, lang);
  const tabs = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
  const ws = tabs.map(watch);
  await signIn(tabs[0]!, lang, "dev.office");
  await tabs[1]!.goto("/about");
  await tabs[2]!.goto("/about");
  for (const t of tabs) await expect(signOutButton(t, lang)).toBeVisible();
  expect(await endSessionFromOutside(tabs[0]!)).toBe(200);
  const at = ws.map((w) => w.me);
  const reqAt = ws.map((w) => w.requests);
  // Each tab follows a link to an area that needs the API (the transformations register; tab 0 is on /my-work, tabs 1
  // and 2 on /about). A page that makes no API request (My Work is static in P2) cannot learn that the session ended
  // (dev run 1: observation recorded in the review, not a test of FE10's rule).
  const targets = ["transformations", "transformations", "transformations"] as const;
  const paths = ["/transformations", "/transformations", "/transformations"];
  for (const [i, t] of tabs.entries()) {
    await t.bringToFront();
    if (new URL(t.url()).pathname !== "/login") await navLink(t, lang, targets[i]!).click();
  }
  for (const [i, t] of tabs.entries()) {
    const landed = new URL(t.url()).searchParams.get("returnTo");
    await expectEndedLanding(t, lang, landed === null ? paths[i]! : landed);
  }
  await tabs[0]!.waitForTimeout(10_000);
  const meAfter = ws.map((w, i) => w.me - at[i]!);
  const apiAfter = ws.map((w, i) => w.requests - reqAt[i]!);
  for (const n of meAfter) expect(n).toBeLessThanOrEqual(3);
  for (const t of tabs) expect(new URL(t.url()).pathname).toBe("/login");
  const ctx2 = await newLangContext(browser, lang);
  const p2 = await ctx2.newPage();
  const w2 = watch(p2);
  await signIn(p2, lang, "dev.lead");
  await navLink(p2, lang, "transformations").click();
  await expect(p2.locator("main#main h1")).toBeVisible();
  await navLink(p2, lang, "myWork").click();
  await expect(p2.locator("main#main h1")).toBeVisible();
  for (const w of ws) expect(w.tooMany).toEqual([]);
  expect(w2.tooMany).toEqual([]);
  for (const w of ws) expect(w.pageErrors).toEqual([]);
  info.annotations.push({
    type: "r14-03",
    description: `limits=${DEFAULT_LIMITS ? "product defaults" : "harness (raised)"}; GET /me per ended tab in ~16 s=${meAfter.join(",")}; API requests per ended tab=${apiAfter.join(",")}; 429s=0`,
  });
  await ctx2.close();
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------------------------
test("R14-04a a 403 forbidden on a read [route-replaced] is not a session end", async ({ page }, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  const w = watch(page);
  await signIn(page, lang, "dev.lead");
  await page.route(
    (u) => u.pathname === "/api/v1/transformations",
    (route) => (route.request().method() === "GET" ? route.fulfill(problem(403, "forbidden")) : route.fallback()),
  );
  const meAt = w.me;
  await navLink(page, lang, "transformations").click();
  await expect(page.locator("[data-state='no-permission'], [data-state='error']").first()).toBeVisible();
  expect(await pathsFor(page, 2_000)).toEqual(["/transformations"]);
  await expect(signOutButton(page, lang)).toBeVisible();
  expect(w.me - meAt).toBeLessThanOrEqual(1);
  await expectAccessible(page, lang, "qa-r14-04a-403-read");
  await shot(page, lang, "qa-r14-04a-403-read");
  // FE12: the state follows a language switch.
  const before = (await page.locator("[data-state='no-permission'], [data-state='error']").first().innerText()).trim();
  const o = other(lang);
  await switchTo(page, lang).click(); // the preference save is real and succeeds
  await expectDir(page, o);
  const after = (await page.locator("[data-state='no-permission'], [data-state='error']").first().innerText()).trim();
  expect(after).not.toBe(before);
  expect(ARABIC.test(after)).toBe(o === "ar");
  await switchTo(page, o).click();
  await expectDir(page, lang);
  await page.unroute((u) => u.pathname === "/api/v1/transformations");
  expect(w.pageErrors).toEqual([]);
});

test("R14-04b+06 a 403 forbidden on create [route-replaced] keeps the user; errors follow a language switch", async ({
  page,
}, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  const o = other(lang);
  const w = watch(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/transformations/new");
  // Required-field errors (client-side), then a language switch.
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect(page.getByText(tr(lang, "problems.validation__required"), { exact: true }).first()).toBeVisible();
  const nReq = await page.getByText(tr(lang, "problems.validation__required"), { exact: true }).count();
  await switchTo(page, lang).click();
  await expectDir(page, o);
  await expect(page.getByText(tr(o, "problems.validation__required"), { exact: true })).toHaveCount(nReq);
  await expect(page.getByText(tr(lang, "problems.validation__required"), { exact: true })).toHaveCount(0);
  const dirOfError = await page
    .getByText(tr(o, "problems.validation__required"), { exact: true })
    .first()
    .evaluate((el) => getComputedStyle(el).direction);
  expect(dirOfError).toBe(o === "ar" ? "rtl" : "ltr");
  await expectAccessible(page, lang, "qa-r14-06-required-switched");
  await shot(page, lang, "qa-r14-06-required-switched");
  await switchTo(page, o).click();
  await expectDir(page, lang);
  // A 403 on the create POST.
  await page.route(
    (u) => u.pathname === "/api/v1/transformations",
    (route) => (route.request().method() === "POST" ? route.fulfill(problem(403, "forbidden")) : route.fallback()),
  );
  await page
    .getByLabel(fieldLabel(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "العمليات (اصطناعي) (SYN-OPS)" : "Synthetic Operations (SYN-OPS)" });
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(`Synthetic QA R14 403 ${lang}`);
  const meAt = w.me;
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/transformations");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  expect((await refused).status()).toBe(403);
  const banner = page.getByText(tr(lang, "problems.forbidden"), { exact: false }).first();
  await expect(banner).toBeVisible();
  expect(await pathsFor(page, 2_000)).toEqual(["/transformations/new"]);
  await expect(signOutButton(page, lang)).toBeVisible();
  expect(w.me - meAt).toBeLessThanOrEqual(1);
  await expectAccessible(page, lang, "qa-r14-04b-403-create");
  await shot(page, lang, "qa-r14-04b-403-create");
  await switchTo(page, lang).click();
  await expectDir(page, o);
  await expect(page.getByText(tr(o, "problems.forbidden"), { exact: false }).first()).toBeVisible();
  await expect(page.getByText(tr(lang, "problems.forbidden"), { exact: false })).toHaveCount(0);
  await expectAccessible(page, lang, "qa-r14-06-403-create-switched");
  await shot(page, lang, "qa-r14-06-403-create-switched");
  await switchTo(page, o).click();
  await expectDir(page, lang);
  await page.unroute((u) => u.pathname === "/api/v1/transformations");
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
async function headerLayout(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.app-header")!.getBoundingClientRect();
    const wm = document.querySelector<HTMLElement>("[data-testid='wordmark']")!;
    const notice = document.querySelector("[data-testid='language-not-saved']");
    return {
      headerHeight: header.height,
      headerBottom: header.bottom,
      wordmarkWidth: wm.getBoundingClientRect().width,
      wordmarkOverflow: wm.scrollWidth - wm.clientWidth,
      noticeTop: notice ? notice.getBoundingClientRect().top : null,
      noticeDir: notice ? getComputedStyle(notice).direction : null,
      hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test("R14-05+06 refused preference save (real 403 csrf) both directions; 403 not a session end; header layout 320/768/1280", async ({
  page,
}, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  const w = watch(page);
  await signIn(page, lang, "dev.lead");
  await page.goto("/about");
  await expect(signOutButton(page, lang)).toBeVisible();
  // Reference header geometry with NO notice, per language and width.
  const ref: Record<string, Awaited<ReturnType<typeof headerLayout>>> = {};
  for (const l of [lang, other(lang)] as Lang[]) {
    if ((await page.locator("html").getAttribute("lang")) !== l) {
      await switchTo(page, other(l)).click();
      await expectDir(page, l);
    }
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      ref[`${l}-${width}`] = await headerLayout(page);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    await switchTo(page, other(lang)).click();
    await expectDir(page, lang);
  }
  await expect(page.getByTestId("language-not-saved")).toHaveCount(0);
  // Another sign-in of the same browser replaces the cookie: this tab's CSRF token no longer matches (real 403 csrf).
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", {
    data: { username: "dev.lead" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(relogin.status()).toBe(204);
  const meAt = w.me;
  let shown: Lang = lang;
  for (const step of [1, 2]) {
    const from = shown;
    const to = other(from);
    const saved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
    await switchTo(page, from).click();
    const res = await saved;
    expect(res.status(), `step ${step} ${from}->${to}`).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("csrf");
    shown = to;
    const notice = page.getByTestId("language-not-saved");
    await expect(notice).toHaveText(tr(to, "common.language.notSaved"));
    await expectDir(page, to);
    await expect(page.locator(".language-switch__live")).toHaveAttribute("lang", to);
    await expect(page.getByTestId("language-not-saved")).toHaveCount(1);
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(notice).toBeVisible();
      await page.waitForTimeout(150);
      const now = await headerLayout(page);
      const r = ref[`${to}-${width}`]!;
      const at = `step ${step} ${to} ${width}px`;
      expect(now.noticeDir, `${at} notice direction`).toBe(to === "ar" ? "rtl" : "ltr");
      expect(Math.abs(now.headerHeight - r.headerHeight), `${at} header height vs no-notice`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.wordmarkWidth - r.wordmarkWidth), `${at} wordmark width vs no-notice`).toBeLessThanOrEqual(0.5);
      expect(now.wordmarkOverflow, `${at} wordmark fits`).toBeLessThanOrEqual(0);
      expect(now.noticeTop!, `${at} notice below header`).toBeGreaterThanOrEqual(now.headerBottom - 0.5);
      expect(now.hscroll, `${at} no horizontal scroll`).toBeLessThanOrEqual(0);
      await expectAccessible(page, lang, `qa-r14-05-step${step}-${to}-${width}`);
      await shot(page, lang, `qa-r14-05-step${step}-${to}-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  // Two refusals, still signed in, still on /about, no /login, /me bounded.
  expect(await pathsFor(page, 1_500)).toEqual(["/about"]);
  await expect(signOutButton(page, shown)).toBeVisible();
  expect(w.me - meAt, "GET /me during two refused saves").toBeLessThanOrEqual(2);
  // A reload re-reads the persisted preference (unchanged: both saves were refused): the original language, no notice.
  await page.reload();
  await expect(signOutButton(page, lang)).toBeVisible();
  await expectDir(page, lang);
  await expect(page.getByTestId("language-not-saved")).toHaveCount(0);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

test("R14-06b dev-login invalid-username error follows a language switch (signed out)", async ({ page }, info) => {
  test.skip(DEFAULT_LIMITS, "R14-03 only under default limits");
  const lang = langOf(info);
  await page.goto("/login");
  const current = ((await page.locator("html").getAttribute("lang")) ?? "en") as Lang;
  if (current !== lang) {
    await switchTo(page, current).click();
  }
  await expectDir(page, lang);
  const field = page.getByLabel(fieldLabel(lang, "auth.dev.username"));
  await field.fill("X!");
  await field.press("Enter");
  await expect(page.getByText(tr(lang, "auth.dev.invalidUsername"), { exact: true })).toBeVisible();
  await switchTo(page, lang).click();
  const o = other(lang);
  await expectDir(page, o);
  await expect(page.getByText(tr(o, "auth.dev.invalidUsername"), { exact: true })).toBeVisible();
  await expect(page.getByText(tr(lang, "auth.dev.invalidUsername"), { exact: true })).toHaveCount(0);
  await expectAccessible(page, lang, "qa-r14-06b-invalid-username-switched");
  await shot(page, lang, "qa-r14-06b-invalid-username-switched");
  await switchTo(page, o).click();
  await expectDir(page, lang);
});
