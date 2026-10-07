// qa-verifier DG2 round 14 — independent verification of the D-074 repairs on candidate 9f3ca298 (T-DG2-REV-QA-R14):
// FE10 (F-DG2-480: a session that ends while the app is open lands ONCE on sign-in, with the localized message and a
// bounded number of GET /me), FE11 (a refused language-preference save keeps the chosen language and says so in it) and
// FE12 (notices and errors are translated at render time; the language notice is a banner below the header).
// Authored by qa-verifier, NOT by an implementer. Runs in chromium-en and chromium-ar against the REAL built API and
// PostgreSQL (e2e/support/qa-stack.sh, raised limits; or apps/web/e2e/support/with-stack.sh with
// E2E_DEFAULT_RATE_LIMITS=1 for the product's DEFAULT limits, R14-01..03 only). No server mocks. The only browser-side
// interception is R14-05(b), which aborts the preference save at the network layer to simulate a lost connection.
//
// R14-01 sign-out from the UI in a REAL second tab of the same browser, then an in-app link in the first tab: one landing
//   on /login with the localized session-ended message (the second tab, signed out on purpose, shows "signed out" and no
//   session-ended alert); /me and all API requests bounded over 5 s; the browser Back button lands on sign-in again
//   (bounded, no blank page, no loop); signing in again works.
// R14-02 an evidence upload refused with 401 after the uploader's access is revoked (D-073 ends their sessions) while the
//   dialog is open: the dialog closes, one landing on sign-in with the message; 0 content rows (psql), the store gains
//   no file and no .part; signing in again as the same (now unassigned) user is not a session end and not a loop.
// R14-03 after a session end the ended tab stays quiet for 10 s (all API requests counted), and a second browser context
//   from the same IP signs in and opens three pages: 0 responses 429 anywhere.
// R14-04 a 403 is never a session end: (a) a REAL 403 `forbidden` (an unassigned user opens the users administration);
//   (b) a 401 `auth.login_failed` on the sign-in form is not a session end either, and its message follows a language
//   switch (FE12, login page).
// R14-05 a refused language save, EN->AR (chromium-en) and AR->EN (chromium-ar), then back: (a) a real 403 `csrf` (the
//   session cookie was replaced by a sign-in in another tab); (b) a network failure. The notice is in the language
//   shown, html lang/dir and the live region's lang follow it, the user stays signed in; header layout at 320/768/1280
//   compared with a notice-free tab of the same language; a reload shows the saved language and no notice.
// R14-06 a language switch while form errors are visible (transformation create page, not touched by FE12): every
//   visible field error is re-rendered in the new language and direction; nothing of the old language remains.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import {
  BASE,
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  escape,
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
const otherOf = (l: Lang): Lang => (l === "ar" ? "en" : "ar");
const dirOf = (l: Lang) => (l === "ar" ? "rtl" : "ltr");

/** Annotation plus a stdout line, so the measurement is in the list-reporter log. */
function note(info: { annotations: { type: string; description?: string }[]; project: { name: string } }, a: { type: string; description: string }) {
  info.annotations.push(a);
  console.log(`[${info.project.name}] ${a.type}: ${a.description}`);
}

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-qa-r14.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

// ---- the real database and store (exported by qa-stack.sh / with-stack.sh) ----------------------------------------
function sql(query: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set: run under e2e/support/qa-stack.sh");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-qAtX", "-c", query], { encoding: "utf8" }).trim();
}
const safe = (s: string) => {
  if (!/^[0-9A-Za-z._:-]{1,80}$/.test(s)) throw new Error(`unexpected id ${s}`);
  return s;
};
/** Every regular file under the evidence store (no link following). */
function storeFiles(): string[] {
  const root = process.env["EVIDENCE_STORAGE_PATH"];
  if (!root || !existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.isFile()) out.push(`${p.slice(root.length + 1)} (${statSync(p).size} B)`);
    }
  };
  walk(root);
  return out.sort();
}

// ---- request accounting -------------------------------------------------------------------------------------------
type Watch = { me: number; api: number; tooMany: string[]; statuses: string[]; pageErrors: string[] };
function watch(page: Page): Watch {
  const w: Watch = { me: 0, api: 0, tooMany: [], statuses: [], pageErrors: [] };
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/")) return;
    w.api++;
    if (r.method() === "GET" && u.pathname === "/api/v1/me") w.me++;
  });
  page.on("response", (r: Response) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/") && r.status() >= 400) w.statuses.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
    if (r.status() === 429) w.tooMany.push(`${r.request().method()} ${u.pathname}`);
  });
  page.on("pageerror", (e) => w.pageErrors.push(e.message));
  return w;
}

const navLink = (page: Page, lang: Lang, key: string) =>
  page.getByRole("navigation", { name: tr(lang, "nav.primary") }).getByRole("link", { name: tr(lang, key), exact: true });
const signOutButton = (page: Page, lang: Lang) => page.getByRole("button", { name: tr(lang, "auth.signOut"), exact: true });
const switchButton = (page: Page, from: Lang) =>
  page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[otherOf(from)] }), exact: true });

/** Samples the path every 100 ms for `ms`; returns the distinct paths seen. */
async function pathsFor(page: Page, ms: number): Promise<string[]> {
  const seen = new Set<string>();
  for (let i = 0; i < ms / 100; i++) {
    seen.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  return [...seen];
}

/** The sign-in page with the localized session-ended alert, in `lang`, and no signed-in shell; stays there 3 s. */
async function expectEndedLanding(page: Page, lang: Lang) {
  await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(lang));
  expect(new URL(page.url()).pathname).toBe("/login");
  expect(new URL(page.url()).searchParams.get("error")).toBe("session_expired");
  expect(await pathsFor(page, 3_000)).toEqual(["/login"]);
  await expect(signOutButton(page, lang)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "nav.primary") })).toHaveCount(0);
  // Exactly one alert with the message (never repeated by a second landing).
  await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toHaveCount(1);
}

async function signInAgainHere(page: Page, lang: Lang, username: string) {
  const field = page.getByLabel(fieldLabel(lang, "auth.dev.username"));
  await field.fill(username);
  await field.press("Enter");
  await expect(signOutButton(page, lang)).toBeVisible({ timeout: 5_000 });
  expect(new URL(page.url()).pathname).not.toBe("/login");
}

// ------------------------------------------------------------------------------------------------------------------
test("R14-01 sign-out from the UI in a real second tab, then an in-app link: one landing with the message; Back stays bounded", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  await signIn(page, lang, "dev.lead");
  const tab2 = await page.context().newPage();
  const w2 = watch(tab2);
  await tab2.goto("/my-work");
  await expect(signOutButton(tab2, lang)).toBeVisible();
  await signOutButton(tab2, lang).click();
  await tab2.waitForURL(/\/login\?signedOut=1$/);
  await expect(tab2.getByRole("status").filter({ hasText: tr(lang, "auth.signedOut") })).toBeVisible();
  await expect(tab2.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toHaveCount(0);

  const me0 = w.me;
  const api0 = w.api;
  const t0 = Date.now();
  await navLink(page, lang, "nav.areas.transformations.label").click();
  await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toBeVisible({ timeout: 2_000 });
  const landedMs = Date.now() - t0;
  await expectEndedLanding(page, lang);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/transformations");
  await page.waitForTimeout(2_000); // 5 s+ after the end in total
  const meAfter = w.me - me0;
  const apiAfter = w.api - api0;
  expect(meAfter).toBeLessThanOrEqual(3);
  expect(apiAfter).toBeLessThanOrEqual(8);
  await expectAccessible(page, lang, "r14-01-ended");
  await shot(page, lang, "r14-01-ended");

  // Browser Back: the previous entry is a signed-in page; it must land on sign-in again, once, not loop or go blank.
  const me1 = w.me;
  await page.goBack();
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible({ timeout: 3_000 });
  expect(await pathsFor(page, 3_000)).toEqual(["/login"]);
  const meBack = w.me - me1;
  expect(meBack).toBeLessThanOrEqual(3);

  await signInAgainHere(page, lang, "dev.lead");
  expect(w.tooMany).toEqual([]);
  expect(w2.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  note(info, {
    type: "r14-01",
    description: `landed in ${landedMs} ms; GET /me after the end (5 s) ${meAfter}; all /api after the end ${apiAfter}; /me after Back ${meBack}; 4xx seen ${JSON.stringify(w.statuses)}; limits ${DEFAULT_LIMITS ? "product defaults" : "raised (harness)"}`,
  });
  await tab2.close();
});

test("R14-02 upload refused with 401 after the uploader's access is revoked: dialog closes, one landing, nothing stored", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const w = watch(page);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const tr0 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R14 upload ${lang.toUpperCase()} ${Date.now()}`,
    mode: "end_to_end",
  });
  const assignment = await admin.call<{ id: string; version: number }>("POST", "/api/v1/role-assignments", {
    userId: NOBODY,
    roleCode: "TL",
    scope: { type: "transformation", id: tr0.id },
    reason: "Synthetic QA R14 access",
  });
  const nobody = await apiSession(playwright, "dev.nobody");
  const title = `Synthetic QA R14 file ${lang.toUpperCase()}`;
  const item = await nobody.call<{ id: string }>("POST", `/api/v1/transformations/${tr0.id}/evidence`, {
    kind: "file",
    title,
    ownerUserId: NOBODY,
  });
  await signIn(page, lang, "dev.nobody");
  const evidencePath = `/transformations/${tr0.id}/evidence`;
  await page.goto(evidencePath);
  await page.getByRole("button", { name: rowAction(lang, "evidence.upload.action", title) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "synthetic-qa-r14.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic,qa\n14,1\n", "utf8"),
  });
  const storeBefore = storeFiles();
  await admin.call("POST", `/api/v1/role-assignments/${safe(assignment.id)}/revoke`, { reason: "Synthetic QA R14 revoke" }, {
    ifMatch: assignment.version,
  });
  const me0 = w.me;
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/content"));
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  const res = await refused;
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  await expectEndedLanding(page, lang);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(evidencePath);
  const meAfter = w.me - me0;
  expect(meAfter).toBeLessThanOrEqual(3);
  await expectAccessible(page, lang, "r14-02-upload-refused");
  await shot(page, lang, "r14-02-upload-refused");
  // Nothing stored.
  const rows = Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(item.id)}'`));
  expect(rows).toBe(0);
  const storeAfter = storeFiles();
  expect(storeAfter).toEqual(storeBefore);
  // No NEW temporary: the store may already hold the planted fixtures of dg2-qa-r13 R13-03 (fresh/non-UUID .part files
  // that the start-up sweep keeps by design) when the whole suite runs on one stack.
  const newParts = storeAfter.filter((f) => f.includes(".part") && !storeBefore.includes(f));
  expect(newParts).toEqual([]);
  const revokedSessions = Number(sql(`select count(*) from session where user_id = '${NOBODY}' and revoked_at is not null`));
  expect(revokedSessions).toBeGreaterThan(0);

  // Signing in again as the same user, now WITHOUT access: the page answers 403/404, which is not a session end.
  await signInAgainHere(page, lang, "dev.nobody");
  const me1 = w.me;
  await page.goto(evidencePath);
  await page.waitForTimeout(3_000);
  expect(new URL(page.url()).pathname).toBe(evidencePath);
  await expect(signOutButton(page, lang)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: tr(lang, "auth.errors.session_expired") })).toHaveCount(0);
  const meNoAccess = w.me - me1;
  expect(meNoAccess).toBeLessThanOrEqual(2);
  await expectAccessible(page, lang, "r14-02-no-access-after-revoke");
  await shot(page, lang, "r14-02-no-access-after-revoke");
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  note(info, {
    type: "r14-02",
    description: `upload 401 unauthenticated; /me after the end ${meAfter}; content rows ${rows}; store ${storeBefore.length}->${storeAfter.length} files, new .part ${newParts.length}; revoked sessions ${revokedSessions}; after re-sign-in without access: path kept, /me ${meNoAccess}; 4xx ${JSON.stringify(w.statuses)}; limits ${DEFAULT_LIMITS ? "product defaults" : "raised (harness)"}`,
  });
});

test("R14-03 the ended tab stays quiet for 10 s; a second context from the same IP signs in and works; no 429", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const mk = async () =>
    browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const ctxA = await mk();
  const a = await ctxA.newPage();
  const wa = watch(a);
  await signIn(a, lang, "dev.office");
  // End the session from a second tab of the same browser (real UI sign-out).
  const a2 = await ctxA.newPage();
  await a2.goto("/my-work");
  await signOutButton(a2, lang).click();
  await a2.waitForURL(/\/login\?signedOut=1$/);
  await a2.close();
  const api0 = wa.api;
  const me0 = wa.me;
  // (signIn lands on /my-work, which sends no API request; an in-app link to another page is the trigger)
  await navLink(a, lang, "nav.areas.transformations.label").click();
  await expectEndedLanding(a, lang);
  await a.waitForTimeout(7_000); // >= 10 s after the end in total
  const apiQuiet = wa.api - api0;
  const meQuiet = wa.me - me0;
  expect(meQuiet).toBeLessThanOrEqual(3);
  expect(apiQuiet).toBeLessThanOrEqual(8);

  const ctxB = await mk();
  const b = await ctxB.newPage();
  const wb = watch(b);
  await signIn(b, lang, "dev.lead");
  for (const key of ["nav.areas.transformations.label", "nav.areas.myWork.label", "nav.areas.transformations.label"]) {
    await navLink(b, lang, key).click();
    await expect(b.locator("main#main h1")).toBeVisible();
  }
  await expect(signOutButton(b, lang)).toBeVisible();
  expect(wa.tooMany).toEqual([]);
  expect(wb.tooMany).toEqual([]);
  expect(wa.pageErrors).toEqual([]);
  expect(wb.pageErrors).toEqual([]);
  note(info, {
    type: "r14-03",
    description: `ended tab over 10 s: /api ${apiQuiet}, /me ${meQuiet}; second context signed in and opened 3 pages (/api ${wb.api}); 429s 0; limits ${DEFAULT_LIMITS ? "product defaults" : "raised (harness)"}`,
  });
  await ctxB.close();
  await ctxA.close();
});

test("R14-04 a 403 is never a session end; a 401 login_failed is not either, and its message follows a language switch", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000); // about 16 s until the grant nears its end, then a throttled body of about 16 s
  const lang = langOf(info);
  const other = otherOf(lang);
  const w = watch(page);
  // (a1) a REAL 403 `forbidden`: dev.nobody's only grant (a scoped KDS assignment with effectiveTo, a product path) ends
  // while the upload body is still streaming (the browser's upload is throttled with Chromium's own network emulation,
  // not a mock), so the commit-time re-check (D-073) refuses it with 403 while the session stays valid. The Upload
  // dialog must show the forbidden message and stay; the user stays signed in where they are.
  const lead = await apiSession(playwright, "dev.lead");
  const t4 = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R14 forbidden ${lang.toUpperCase()} ${Date.now()}`,
    mode: "end_to_end",
  });
  const until = Date.now() + 20_000;
  await lead.call("POST", `/api/v1/transformations/${safe(t4.id)}/scoped-assignments`, {
    userId: NOBODY,
    roleCode: "KDS",
    effectiveTo: new Date(until).toISOString(),
    reason: `Synthetic QA R14 expiring grant ${lang}`,
  });
  const nobodyApi = await apiSession(playwright, "dev.nobody");
  const title = `Synthetic QA R14 forbidden file ${lang.toUpperCase()}`;
  const item = await nobodyApi.call<{ id: string }>("POST", `/api/v1/transformations/${safe(t4.id)}/evidence`, {
    kind: "file",
    title,
    ownerUserId: NOBODY,
  });
  await signIn(page, lang, "dev.nobody");
  const evidencePath = `/transformations/${t4.id}/evidence`;
  await page.goto(evidencePath);
  await page.getByRole("button", { name: rowAction(lang, "evidence.upload.action", title) }).click();
  const dialog = page.getByRole("dialog");
  const bytes = 8 * 1024 * 1024;
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "synthetic-qa-r14-forbidden.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(bytes, 0x5a),
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  // About 8 MiB at 512 KiB/s: about 16 s of body; it starts a few seconds before the grant ends.
  await page.waitForTimeout(Math.max(0, until - Date.now() - 4_000));
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 512 * 1024 });
  const me0 = w.me;
  const startedAt = Date.now();
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/content"), { timeout: 60_000 });
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  const res = await refused;
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const fStatus = res.status();
  const fCode = ((await res.json()) as { code: string }).code;
  const startedBeforeExpiry = startedAt < until;
  expect(startedBeforeExpiry).toBe(true);
  expect(fStatus).toBe(403);
  expect(fCode).toBe("forbidden");
  // The dialog stays and says why, in the page's language; no session end, no redirect.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(tr(lang, "problems.forbidden"))).toBeVisible();
  expect(await pathsFor(page, 3_000)).toEqual([evidencePath]);
  await expect(page.getByText(tr(lang, "auth.errors.session_expired"))).toHaveCount(0);
  await expectAccessible(page, lang, "r14-04-forbidden-dialog");
  await shot(page, lang, "r14-04-forbidden-dialog");
  const rows = Number(sql(`select count(*) from evidence_content where evidence_id = '${safe(item.id)}'`));
  expect(rows).toBe(0);
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  // Still signed in: an in-app link works.
  await navLink(page, lang, "nav.areas.myWork.label").click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(signOutButton(page, lang)).toBeVisible();
  const meForbidden = w.me - me0;
  expect(meForbidden).toBeLessThanOrEqual(2);
  const f = { status: fStatus, code: fCode };

  // (a2) a REAL 403 `csrf` on a change: a sign-in in another tab of the same browser replaced the session cookie, so
  // this tab's CSRF token no longer matches. Signing out from the shell is a change too: the API answers 403, which is
  // not a session end (the client's own sign-out then lands on sign-in, once, without the session-ended message).
  await navLink(page, lang, "nav.areas.transformations.label").click();
  await expect(page.locator("main#main h1")).toBeVisible();
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", { data: { username: "dev.nobody" }, headers: { Origin: BASE } });
  expect(relogin.status()).toBe(204);
  const me1 = w.me;
  const csrfRefused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  await switchButton(page, lang).click();
  const c = await csrfRefused;
  const cStatus = c.status();
  const cCode = ((await c.json()) as { code: string }).code;
  expect(cStatus).toBe(403);
  expect(cCode).toBe("csrf");
  expect(await pathsFor(page, 2_000)).toEqual(["/transformations"]);
  await expect(signOutButton(page, other)).toBeVisible();
  await expect(page.getByText(tr(other, "auth.errors.session_expired"))).toHaveCount(0);
  const meCsrf = w.me - me1;
  expect(meCsrf).toBeLessThanOrEqual(1);
  await page.reload(); // back to the saved language with a fresh CSRF token
  await expect(signOutButton(page, lang)).toBeVisible();

  // (b) 401 auth.login_failed on the sign-in form (no session in this context any more).
  await page.context().clearCookies();
  await page.goto("/login");
  const field = page.getByLabel(fieldLabel(lang, "auth.dev.username"));
  await field.fill("qa.r14.unknown");
  const failed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/auth/dev-login");
  await field.press("Enter");
  expect((await failed).status()).toBe(401);
  await expect(page.getByText(tr(lang, "problems.auth__login_failed"))).toBeVisible();
  expect(await pathsFor(page, 2_000)).toEqual(["/login"]);
  // FE12 on the login page: the visible error follows a language switch, with the direction.
  await switchButton(page, lang).click();
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(other));
  await expect(page.getByText(tr(other, "problems.auth__login_failed"))).toBeVisible();
  await expect(page.getByText(tr(lang, "problems.auth__login_failed"))).toHaveCount(0);
  await expectAccessible(page, other, "r14-04-login-failed-switched");
  await shot(page, other, "r14-04-login-failed-switched");
  await switchButton(page, other).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.getByText(tr(lang, "problems.auth__login_failed"))).toBeVisible();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  note(info, {
    type: "r14-04",
    description: `(a1) upload started ${until - startedAt} ms before the grant ended -> ${f.status} ${f.code}; dialog kept with the forbidden message; path held 3 s; content rows ${rows}; /me ${meForbidden}; (a2) preference save -> ${cStatus} ${cCode}, still signed in, /me ${meCsrf}; (b) login_failed 401 kept on /login; message switched ${lang}->${other}->${lang}`,
  });
});

async function header(page: Page) {
  return page.evaluate(() => {
    const h = document.querySelector("header.app-header")!.getBoundingClientRect();
    const wm = document.querySelector<HTMLElement>("header.app-header [data-testid='wordmark']")!;
    const n = document.querySelector("[data-testid='language-not-saved']");
    const btns = [...document.querySelectorAll<HTMLElement>("header.app-header button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    return {
      height: h.height,
      bottom: h.bottom,
      wordmarkWidth: wm.getBoundingClientRect().width,
      wordmarkOverflow: wm.scrollWidth - wm.clientWidth,
      noticeTop: n ? n.getBoundingClientRect().top : null,
      noticeInHeader: n ? document.querySelector("header.app-header")!.contains(n) : null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      buttonsInside: btns.every((b) => b.left >= -0.5 && b.right <= window.innerWidth + 0.5),
    };
  });
}

for (const variant of ["a-csrf-403", "b-network-failure"] as const) {
  test(`R14-05${variant[0]} refused language save (${variant}): notice in the language shown, both directions, layout holds`, async ({
    page,
  }, info) => {
    const lang = langOf(info);
    const other = otherOf(lang);
    const w = watch(page);
    await signIn(page, lang, "dev.lead"); // persists `lang` as the preference
    // A reference tab of the same browser, same language, never refused (for the header comparison).
    const ref = await page.context().newPage();
    await ref.goto("/about");
    await expect(signOutButton(ref, lang)).toBeVisible();
    await page.goto("/about");
    await expect(signOutButton(page, lang)).toBeVisible();
    if (variant === "a-csrf-403") {
      const relogin = await page.context().request.post("/api/v1/auth/dev-login", { data: { username: "dev.lead" }, headers: { Origin: BASE } });
      expect(relogin.status()).toBe(204);
    } else {
      await page.route("**/api/v1/me/preferences", (route) => route.abort("failed"));
    }
    const me0 = w.me;
    const outcomes: string[] = [];
    // 1) lang -> other, refused.
    const save1 = variant === "a-csrf-403" ? page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences") : null;
    await switchButton(page, lang).click();
    if (save1) {
      const r = await save1;
      outcomes.push(`${r.status()} ${((await r.json()) as { code: string }).code}`);
      expect(r.status()).toBe(403);
    } else outcomes.push("aborted");
    const notice = page.getByTestId("language-not-saved");
    await expect(notice).toHaveText(tr(other, "common.language.notSaved"));
    await expect(notice).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", other);
    await expect(page.locator("html")).toHaveAttribute("dir", dirOf(other));
    await expect(page.locator(".language-switch__live")).toHaveAttribute("lang", other);
    await expect(signOutButton(page, other)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/about");
    await expectAccessible(page, other, `r14-05${variant[0]}-refused-${lang}-to-${other}`);
    await shot(page, other, `r14-05${variant[0]}-refused-${lang}-to-${other}`);
    // 2) other -> lang, refused again: the notice now speaks `lang`, direction flips back.
    const save2 = variant === "a-csrf-403" ? page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences") : null;
    await switchButton(page, other).click();
    if (save2) {
      const r = await save2;
      outcomes.push(`${r.status()}`);
      expect(r.status()).toBe(403);
    } else outcomes.push("aborted");
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator("html")).toHaveAttribute("dir", dirOf(lang));
    await expect(notice).toHaveText(tr(lang, "common.language.notSaved"));
    await expect(page.locator(".language-switch__live")).toHaveAttribute("lang", lang);
    await expect(page.getByText(tr(other, "common.language.notSaved"))).toHaveCount(0);
    // Header layout at 320, 768 and 1280 px, against the notice-free reference tab in the same language.
    const layout: string[] = [];
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await ref.setViewportSize({ width, height: 900 });
      await expect(notice).toBeVisible();
      const now = await header(page);
      const base = await header(ref);
      const at = `${lang} ${width}px`;
      expect(now.noticeInHeader, at).toBe(false);
      expect(Math.abs(now.height - base.height), `${at} header height vs reference`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(now.wordmarkWidth - base.wordmarkWidth), `${at} wordmark width vs reference`).toBeLessThanOrEqual(0.5);
      expect(now.wordmarkOverflow, `${at} wordmark fits`).toBeLessThanOrEqual(0);
      expect(now.noticeTop!, `${at} notice below header`).toBeGreaterThanOrEqual(now.bottom - 0.5);
      expect(now.overflowX, `${at} no horizontal scroll`).toBeLessThanOrEqual(0);
      expect(now.buttonsInside, `${at} header buttons inside the viewport`).toBe(true);
      layout.push(`${width}: header ${now.height}/${base.height}, wordmark ${now.wordmarkWidth}/${base.wordmarkWidth}, overflowX ${now.overflowX}`);
      await expectAccessible(page, lang, `r14-05${variant[0]}-${width}`);
      await shot(page, lang, `r14-05${variant[0]}-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Still signed in, no session end, nothing flipped back a second later.
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toBe("/about");
    await expect(signOutButton(page, lang)).toBeVisible();
    await expect(page.getByText(tr(lang, "auth.errors.session_expired"))).toHaveCount(0);
    const meRefused = w.me - me0;
    expect(meRefused).toBeLessThanOrEqual(2);
    // A reload shows the SAVED language (`lang`, persisted by signIn) and no notice.
    if (variant === "b-network-failure") await page.unroute("**/api/v1/me/preferences");
    await page.reload();
    await expect(signOutButton(page, lang)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByTestId("language-not-saved")).toHaveCount(0);
    expect(w.tooMany).toEqual([]);
    expect(w.pageErrors).toEqual([]);
    note(info, {
      type: `r14-05${variant[0]}`,
      description: `saves ${outcomes.join(", ")}; /me ${meRefused}; ${layout.join("; ")}`,
    });
    await ref.close();
  });
}

test("R14-06 a language switch while form errors are visible re-renders them in the new language and direction", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const other = otherOf(lang);
  const w = watch(page);
  await signIn(page, lang, "dev.office");
  await navLink(page, lang, "nav.areas.transformations.label").click();
  await page.goto("/transformations/new");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  const req = (l: Lang) => page.getByText(new RegExp(`^\\s*${escape(tr(l, "problems.validation__required"))}\\s*$`));
  await expect(req(lang).first()).toBeVisible();
  const before = await req(lang).count();
  expect(before).toBeGreaterThan(0);
  const invalid = await page.locator('[aria-invalid="true"]').count();
  await switchButton(page, lang).click();
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(other));
  await expect(req(other).first()).toBeVisible();
  expect(await req(other).count()).toBe(before);
  expect(await req(lang).count()).toBe(0);
  expect(await page.locator('[aria-invalid="true"]').count()).toBe(invalid);
  await expect(page.getByRole("button", { name: tr(other, "transformations.form.create"), exact: true })).toBeVisible();
  await expectAccessible(page, other, "r14-06-errors-switched");
  await shot(page, other, "r14-06-errors-switched");
  // And back.
  await switchButton(page, other).click();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  expect(await req(lang).count()).toBe(before);
  expect(await req(other).count()).toBe(0);
  await expect(page.getByTestId("language-not-saved")).toHaveCount(0);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
  note(info, { type: "r14-06", description: `${before} required-field errors and ${invalid} aria-invalid controls followed ${lang}->${other}->${lang}` });
});
