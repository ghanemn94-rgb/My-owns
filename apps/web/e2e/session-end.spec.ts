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
  escape,
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
  const meAt = watched.me;
  const refused = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  const other: Lang = lang === "ar" ? "en" : "ar";
  await page
    .getByRole("button", {
      name: tr(lang, "common.language.switchTo", { language: other === "ar" ? "العربية" : "English" }),
    })
    .click();
  expect((await refused).status()).toBe(403);
  // The "not saved" notice (in whichever language the page shows afterwards: the persisted preference is re-applied
  // when the save is refused, a pre-existing behaviour outside F-DG2-480, reported in the handback).
  const notSaved = new RegExp(
    `${escape(tr("en", "common.language.notSaved"))}|${escape(tr("ar", "common.language.notSaved"))}`,
  );
  await expect(page.getByRole("status").filter({ hasText: notSaved })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe("/about");
  const signOut = new RegExp(`^\\s*(${escape(tr("en", "auth.signOut"))}|${escape(tr("ar", "auth.signOut"))})\\s*$`);
  await expect(page.getByRole("button", { name: signOut })).toBeVisible();
  expect(watched.me - meAt).toBeLessThanOrEqual(1);
  expect(watched.tooMany).toEqual([]);
});
