// qa-verifier DG2 round 15 — independent negative/regression probes for the D-075 repair on candidate 3f01c610
// (T-DG2-REV-QA-R15): FE13 (29da00d, F-DG2-500: a session that ended while the sign-in page was shown never cleared the
// session-scoped cache, so the next identity in the tab saw the previous user's records). Authored by qa-verifier, NOT
// by an implementer. Runs in chromium-en and chromium-ar against the REAL built API + PostgreSQL
// (e2e/support/qa-stack.sh). Where a probe replaces a response with page.route, the test name says so.
//
// R15-01 Back-history leak path, different from the implementer's e2e: user A (dev.office) opens A's record (list AND
//   detail); A's session is ended by a REAL second tab's Sign out button; tab 1 walks Back (page.goBack) to an
//   in-document /login entry, whose /me probe notices the end; user B (dev.lead, Retail only, cannot read A's record)
//   signs in with the development form in the same tab and then walks Back through the history entries of A's list
//   and A's DETAIL page (whose cached query is keyed by A's record id). A MutationObserver records any moment where
//   A's record text is in the document after the sign-in page was reached. B's list/detail requests are held 1.2 s
//   so a stale cache would have time to render. Expected: never; B sees B's identity; A's detail is not-found for B.
// R15-02 identity change with NO 401 seen by the tab: tab 1 shows A's list; in a second tab of the same browser A
//   signs out (UI) and B signs in (UI); tab 1 is refocused (visibilitychange -> /me refetch -> another identity):
//   no moment ever shows B's identity together with A's record; then B's list never shows A's record.
// R15-03 an in-app session end lands ONCE on sign-in with the localized message, /me bounded, no stale shell, and the
//   cache is cleared at the landing: Back from sign-in never renders A's record nor the shell.
// R15-04 a 403 is never a session end and never clears the session cache: a REAL 403 csrf (preference save refused)
//   and a 403 forbidden on a detail read [route-replaced]: the user stays signed in where they are, A's list is still
//   rendered; the language notice equals the shown language's string (FE11/FE12).
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SHOTS,
  apiSession,
  axeSummary,
  ensureLanguage,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  tr,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const SYN_FIN = "01920000-0000-7000-9000-000000000103"; // Synthetic Finance: dev.office (org-wide) reads it, dev.lead not
const A_NAME = "Synthetic Transformation Office";
const B_NAME = "Synthetic Transformation Lead";
const NAMES: Record<Lang, string> = { ar: "العربية", en: "English" };
const other = (l: Lang): Lang => (l === "ar" ? "en" : "ar");

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-qa-r15.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

function watch(page: Page) {
  const st = { me: 0, tooMany: [] as string[], pageErrors: [] as string[] };
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/me") st.me++;
  });
  page.on("response", (r) => {
    if (r.status() === 429) st.tooMany.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => st.pageErrors.push(e.message));
  return st;
}

const devField = (page: Page, lang: Lang) => page.getByLabel(fieldLabel(lang, "auth.dev.username"));
const anyDevField = (page: Page) =>
  page.getByLabel(
    new RegExp(`^(?:${tr("ar", "auth.dev.username")}|${tr("en", "auth.dev.username")})(?:\\s*\\(.*\\))?$`),
  );
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

/** Records (in the page) every DOM moment where `marker` is in the document; also with `together` if given. */
async function installLeakObserver(page: Page, marker: string, together: string | null) {
  await page.evaluate(
    ([m, t]) => {
      const w = window as unknown as { __qaLeak: string[]; __qaDoc: number };
      w.__qaLeak = [];
      w.__qaDoc = w.__qaDoc ?? Math.random();
      const check = () => {
        const text = document.body.textContent ?? "";
        if (text.includes(m) && (t === null || text.includes(t))) w.__qaLeak.push(location.pathname);
      };
      check();
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    [marker, together] as const,
  );
}
const leaks = (page: Page) => page.evaluate(() => (window as unknown as { __qaLeak: string[] }).__qaLeak);
const docId = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __qaDoc?: number };
    w.__qaDoc = w.__qaDoc ?? Math.random();
    return w.__qaDoc;
  });

/** Signs in with the development form from an IN-DOCUMENT /login entry (the wordmark link), so the history keeps it. */
async function signInKeepingLoginEntry(page: Page, lang: Lang, username: string) {
  // A Link to the SAME URL replaces the entry, and the sign-in itself replaces /login with the landing page, so the
  // document starts on another URL (/login?returnTo=/about) and the wordmark pushes /login (dev run 2).
  await page.goto("/login?returnTo=%2Fabout");
  await page.getByTestId("wordmark").click();
  await expect(page).toHaveURL(/\/login$/);
  await anyDevField(page).fill(username);
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
}

async function createARecord(playwright: Parameters<typeof apiSession>[0], lang: Lang, tag: string) {
  const marker = `Synthetic QA R15 ${tag} ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  const office = await apiSession(playwright, "dev.office");
  const rec = await office.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_FIN,
    name: marker,
    mode: "end_to_end",
  });
  // Server-side authorization first: B (dev.lead) cannot read A's record.
  const lead = await apiSession(playwright, "dev.lead");
  const list = await lead.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations?q=${encodeURIComponent(rec.code)}`);
  expect(list.items.map((i) => i.id)).not.toContain(rec.id);
  return { marker, ...rec };
}

/** Holds GET list/detail transformation reads for `ms` while `on()` is true, then lets the real request through. */
async function holdReads(page: Page, on: () => boolean, ms: number) {
  await page.route(/\/api\/v1\/transformations(\?|\/[0-9a-f-]+$)/, async (route) => {
    if (route.request().method() === "GET" && on()) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

// ------------------------------------------------------------------------------------------------------------------
test("R15-01 A's session ends on the sign-in page (Back); B signs in in the same tab and walks Back through A's list and detail: never sees A's record", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  const a = await createARecord(playwright, lang, "R15-01 A-only");
  await signInKeepingLoginEntry(page, lang, "dev.office");
  await navLink(page, lang, "transformations").click();
  await page.waitForURL("**/transformations");
  await expect(page.getByText(a.marker)).toBeVisible();
  await page.getByRole("link", { name: a.marker }).first().click();
  await page.waitForURL(`**/transformations/${a.id}`);
  await expect(page.getByText(a.marker).first()).toBeVisible();
  await expect(page.getByText(A_NAME).first()).toBeVisible();
  await shot(page, lang, "qa-r15-01-a-detail");
  const doc = await docId(page);

  // A REAL second tab's Sign out button ends A's session.
  const tab2 = await page.context().newPage();
  await tab2.goto("/about");
  await signOutButton(tab2, lang).click();
  await tab2.waitForURL("**/login**");
  await tab2.close();
  await page.bringToFront();

  // Tab 1 walks Back until the in-document /login entry (detail -> list -> my-work -> /login).
  const back: string[] = [new URL(page.url()).pathname];
  for (let i = 0; i < 6 && new URL(page.url()).pathname !== "/login"; i++) {
    await page.goBack();
    await page.waitForTimeout(300);
    back.push(page.url().startsWith("about:") ? page.url() : new URL(page.url()).pathname + new URL(page.url()).search);
  }
  info.annotations.push({ type: "r15-01-back", description: `A's Back walk: ${back.join(" -> ")}` });
  expect(new URL(page.url()).pathname, `A's Back walk: ${back.join(" -> ")}`).toBe("/login");
  await expect(devField(page, lang)).toBeVisible({ timeout: 3_000 });
  await page.waitForTimeout(500);
  expect(await docId(page), "same document (no reload)").toBe(doc);
  await expect(signOutButton(page, lang)).toHaveCount(0);
  await expectDir(page, lang);
  await installLeakObserver(page, a.marker, null);
  const meAtLogin = w.me;

  // B signs in in the same tab; B's reads are held so a stale cache would render first.
  let hold = true;
  await holdReads(page, () => hold, 1_200);
  await devField(page, lang).fill("dev.lead");
  await devField(page, lang).press("Enter");
  await page.waitForURL((u) => u.pathname !== "/login");
  // B's own preferred language applies after B's sign-in (dev run 3: dev.lead prefers AR); check language-agnostically
  // first, then switch the tab to this project's language (a real preference save for B).
  await expect(page.getByText(B_NAME).first()).toBeVisible();
  await expect(page.getByText(A_NAME)).toHaveCount(0);
  await ensureLanguage(page, lang);
  await expect(signOutButton(page, lang)).toBeVisible();
  const afterSignIn = new URL(page.url()).pathname;
  // The sign-in REPLACED the /login entry, so A's later entries are still FORWARD in this tab's history:
  // my-work -> A's list -> A's detail (whose cached query is keyed by A's record id). B walks forward through them,
  // then back again; every step stays in the same document.
  const visited: string[] = [afterSignIn];
  for (const step of ["fwd", "fwd", "fwd", "back", "back", "back"]) {
    if (step === "fwd") await page.goForward();
    else await page.goBack();
    await page.waitForTimeout(1_600); // past the held read
    visited.push(`${step}:${page.url().startsWith("about:") ? page.url() : new URL(page.url()).pathname}`);
    expect(await docId(page), `same document at ${visited.join(" -> ")}`).toBe(doc);
  }
  info.annotations.push({ type: "r15-01", description: `B's history walk: ${visited.join(" -> ")}` });
  // Go to A's detail entry explicitly (in-document, via the router) and to the list.
  await page.evaluate((id) => {
    history.pushState({}, "", `/transformations/${id}`);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, a.id);
  await page.waitForTimeout(1_600);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission'], [data-state='error']").first()).toBeVisible();
  await shot(page, lang, "qa-r15-01-b-on-a-detail-url");
  await expectAccessible(page, lang, "qa-r15-01-b-on-a-detail-url");
  await navLink(page, lang, "transformations").click();
  await page.waitForTimeout(1_600);
  await expect(page.locator("main#main h1")).toBeVisible();
  hold = false;
  await shot(page, lang, "qa-r15-01-b-list");
  await expectAccessible(page, lang, "qa-r15-01-b-list");
  expect(await docId(page), "same document throughout").toBe(doc);
  expect(await leaks(page), "A's record text in the document after the sign-in page was reached").toEqual([]);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await expect(signOutButton(page, lang)).toBeVisible();
  expect(w.me - meAtLogin, "GET /me from the sign-in page through B's walk").toBeLessThanOrEqual(25);
  info.annotations.push({ type: "r15-01-me", description: `GET /me from /login through B's walk: ${w.me - meAtLogin}` });
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R15-02 identity change with no 401 (A signs out and B signs in in another tab; refocus): B's identity never shows with A's record", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  const a = await createARecord(playwright, lang, "R15-02 A-only");
  await page.goto("/login");
  await anyDevField(page).fill("dev.office");
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
  await navLink(page, lang, "transformations").click();
  await expect(page.getByText(a.marker)).toBeVisible();
  const doc = await docId(page);
  await installLeakObserver(page, a.marker, B_NAME);

  // Tab 2: A signs out (UI), B signs in (UI). Tab 1 sees no 401 at all.
  const tab2 = await page.context().newPage();
  await tab2.goto("/about");
  await signOutButton(tab2, lang).click();
  await tab2.waitForURL("**/login**");
  await devField(tab2, lang).fill("dev.lead");
  await devField(tab2, lang).press("Enter");
  await expect(tab2.getByText(B_NAME).first()).toBeVisible();

  // Refocus tab 1: TanStack refetches /me on window focus (refetchOnWindowFocus) only once /me is older than its
  // staleTime, which is 60 s for GET /me (useMeQuery; dev runs 4 and 5: an earlier refocus refetches no /me and tab 1
  // keeps showing A's identity and the data it already had).
  test.setTimeout(150_000);
  await page.waitForTimeout(61_000);
  let hold = true;
  await holdReads(page, () => hold, 1_200);
  const meAt = w.me;
  await page.bringToFront();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByText(B_NAME).first()).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  hold = false;
  await shot(page, lang, "qa-r15-02-b-after-refocus");
  await expectAccessible(page, lang, "qa-r15-02-b-after-refocus");
  expect(await docId(page)).toBe(doc);
  expect(await leaks(page), "moments showing B's identity together with A's record").toEqual([]);
  expect(w.me - meAt, "GET /me after the refocus").toBeLessThanOrEqual(3);
  info.annotations.push({ type: "r15-02", description: `GET /me after refocus: ${w.me - meAt}` });
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R15-03 an in-app session end lands once with the message, /me bounded, no stale shell; Back never renders A's record", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  const a = await createARecord(playwright, lang, "R15-03 A-only");
  await page.goto("/login");
  await anyDevField(page).fill("dev.office");
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
  await navLink(page, lang, "transformations").click();
  await expect(page.getByText(a.marker)).toBeVisible();
  await page.getByRole("link", { name: a.marker }).first().click();
  await page.waitForURL(`**/transformations/${a.id}`);
  await expect(page.getByText(a.marker).first()).toBeVisible();
  const doc = await docId(page);
  await page.waitForTimeout(16_000); // past the list query's 15 s staleTime
  // End the session from outside the React tree (same cookie).
  const status = await page.evaluate(async () => {
    const me = (await (await fetch("/api/v1/me")).json()) as { csrfToken: string };
    return (
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": me.csrfToken, "content-type": "application/json" },
        body: "{}",
      })
    ).status;
  });
  expect(status).toBe(200);
  const meAt = w.me;
  // In-app: the list query is older than its 15 s staleTime (waited above), so following the link refetches it and
  // that request answers 401 unauthenticated.
  await navLink(page, lang, "transformations").click();
  await page.waitForURL("**/login?**", { timeout: 4_000 });
  await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toBeVisible({ timeout: 3_000 });
  await expect(devField(page, lang)).toBeVisible();
  await expectDir(page, lang);
  expect(new URL(page.url()).searchParams.get("error")).toBe("session_expired");
  expect(await docId(page)).toBe(doc);
  await installLeakObserver(page, a.marker, null);
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) {
    seen.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  expect([...seen], "URL stays on /login for 3 s").toEqual(["/login"]);
  await expect(signOutButton(page, lang)).toHaveCount(0);
  expect(w.me - meAt, "GET /me after the trigger").toBeLessThanOrEqual(3);
  await shot(page, lang, "qa-r15-03-landing");
  await expectAccessible(page, lang, "qa-r15-03-landing");
  // Back twice: A's list and detail entries must not render the shell nor A's record.
  for (let i = 0; i < 2; i++) {
    await page.goBack();
    await page.waitForTimeout(1_000);
    await expect(signOutButton(page, lang)).toHaveCount(0);
  }
  expect(await leaks(page), "A's record after the landing").toEqual([]);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  expect(w.me - meAt, "GET /me after Back").toBeLessThanOrEqual(6);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R15-04 a 403 (real csrf; forbidden detail read [route-replaced]) is not a session end and keeps the session cache; notice matches the shown language", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  const a = await createARecord(playwright, lang, "R15-04 A-only");
  await page.goto("/login");
  await anyDevField(page).fill("dev.office");
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
  await navLink(page, lang, "transformations").click();
  await expect(page.getByText(a.marker)).toBeVisible();
  // Another sign-in of the same browser replaces the cookie: this tab's CSRF token no longer matches (real 403 csrf).
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", {
    data: { username: "dev.office" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(relogin.status()).toBe(204);
  const meAt = w.me;
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  await switchTo(page, lang).click();
  const res = await saved;
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { code: string }).code).toBe("csrf");
  const o = other(lang);
  await expectDir(page, o);
  await expect(page.getByTestId("language-not-saved")).toHaveText(tr(o, "common.language.notSaved"));
  await expect(page.locator(".language-switch__live")).toHaveAttribute("lang", o);
  // Not a session end: still signed in, still on the list, A's record still rendered (cache NOT cleared).
  await expect(signOutButton(page, o)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/transformations");
  await expect(page.getByText(a.marker)).toBeVisible();
  await shot(page, lang, "qa-r15-04-csrf-403");
  await expectAccessible(page, lang, "qa-r15-04-csrf-403");
  // A forbidden detail read [route-replaced].
  await page.route(
    (u) => u.pathname === `/api/v1/transformations/${a.id}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 403,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "https://mth.invalid/problems/forbidden",
              title: "forbidden",
              status: 403,
              code: "forbidden",
              requestId: "qa-r15-replaced",
            }),
          })
        : route.fallback(),
  );
  await page.getByRole("link", { name: a.marker }).first().click();
  await page.waitForURL(`**/transformations/${a.id}`);
  await page.waitForTimeout(1_500);
  expect(new URL(page.url()).pathname).toBe(`/transformations/${a.id}`);
  await expect(signOutButton(page, o)).toBeVisible();
  await page.goBack();
  await expect(page.getByText(a.marker)).toBeVisible();
  expect(w.me - meAt, "GET /me during the 403s").toBeLessThanOrEqual(2);
  await page.unroute((u) => u.pathname === `/api/v1/transformations/${a.id}`);
  // Switch back (the save is refused again): the notice follows the shown language.
  await switchTo(page, o).click();
  await expectDir(page, lang);
  await expect(page.getByTestId("language-not-saved")).toHaveText(tr(lang, "common.language.notSaved"));
  await expect(page.getByTestId("language-not-saved")).toHaveCount(1);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});
