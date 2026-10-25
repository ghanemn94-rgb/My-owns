// qa-verifier, DG5 re-gate round 4 (T-DG5-RG-QA-R4): a deterministic reproduction of F-DG5-146.
// Not part of the candidate: it is copied into a disposable clone's apps/web/e2e/ and run against the REAL stack
// (apps/web/e2e/support/with-stack.sh). All data is SYNTHETIC. No business approval is granted.
//
// F-DG5-146: session-end.spec.ts "signed out in another tab, then an in-app link" signs in (signIn returns once My
// Work's h1 is visible), signs out elsewhere, then clicks a primary-navigation link. If one of My Work's
// /api/v1/me/work-items requests is still in flight when the logout lands, that request is answered 401 and the app
// ends the session ITSELF (sign-in page, message, returnTo=/my-work) before the click, so the click waits for a link
// that no longer exists. Here the window is forced open by holding My Work's first work-items request for 2.5 s.
//
//  R1 (the race, forced): the product lands once on the sign-in page with the localized message and returnTo=/my-work,
//     never loops, keeps /me bounded, shows no stale shell; the in-app link the original test clicks does not exist.
//  R2 (the fix direction): with the same hold, waiting for the held request to settle BEFORE signing out restores the
//     original test's precondition, and its original assertions (returnTo=/transformations) pass unchanged.
import { expect, test, type Page, type Response } from "@playwright/test";
import { fieldLabel, langOf, signIn, tr, type Lang } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

const HOLD_MS = 2_500;

function watch(page: Page) {
  const state = { me: 0, tooMany: [] as string[], workItems401: 0 };
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/me") state.me++;
  });
  page.on("response", (r: Response) => {
    if (r.status() === 429) state.tooMany.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
    if (r.status() === 401 && new URL(r.url()).pathname === "/api/v1/me/work-items") state.workItems401++;
  });
  return state;
}

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

/** Holds the FIRST GET /api/v1/me/work-items for HOLD_MS, then lets it reach the real API unchanged. */
async function holdFirstWorkItems(page: Page) {
  let held = 0;
  let release!: () => void;
  const settled = new Promise<void>((r) => (release = r));
  await page.route(
    (u) => u.pathname === "/api/v1/me/work-items",
    async (route) => {
      if (held++ === 0) {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        await route.continue();
        release();
      } else await route.continue();
    },
  );
  return { settled, count: () => held };
}

async function expectSessionEndedOnce(page: Page, lang: Lang, returnTo: string, meDelta: () => number) {
  const message = tr(lang, "auth.errors.session_expired");
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible({ timeout: 1_500 + HOLD_MS });
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible({ timeout: 1_500 });
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("error")).toBe("session_expired");
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  const paths = new Set<string>();
  for (let i = 0; i < 30; i++) {
    paths.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  expect([...paths]).toEqual(["/login"]);
  expect(meDelta()).toBeLessThanOrEqual(3);
  await expect(page.getByRole("button", { name: tr(lang, "auth.signOut") })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "nav.primary") })).toHaveCount(0);
}

test("R1 forced race: logout while My Work's work-items load is in flight -> the app itself lands once on sign-in (returnTo=/my-work); the in-app link is gone", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const watched = watch(page);
  const hold = await holdFirstWorkItems(page);
  await signIn(page, lang, "dev.lead");
  // signIn() returned while the work-items request is still held (the original test's precondition is false here).
  expect(hold.count()).toBeGreaterThanOrEqual(1);
  const meAt = watched.me;
  expect(await signOutElsewhere(page)).toBe(200);
  await hold.settled;
  await expectSessionEndedOnce(page, lang, "/my-work", () => watched.me - meAt);
  expect(watched.workItems401).toBeGreaterThanOrEqual(1);
  // The original test's click target does not exist any more: its locator.click would wait for its whole budget.
  await expect(
    page
      .getByRole("navigation", { name: tr(lang, "nav.primary") })
      .getByRole("link", { name: tr(lang, "nav.areas.transformations.label") }),
  ).toHaveCount(0);
  expect(watched.tooMany).toEqual([]);
});

test("R2 fix direction: same hold, wait for My Work's load to settle before signing out -> the original assertions pass (returnTo=/transformations)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const watched = watch(page);
  const hold = await holdFirstWorkItems(page);
  await signIn(page, lang, "dev.lead");
  await hold.settled;
  await page.waitForLoadState("networkidle");
  expect(await signOutElsewhere(page)).toBe(200);
  const meAt = watched.me;
  await page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, "nav.areas.transformations.label") })
    .click();
  await expectSessionEndedOnce(page, lang, "/transformations", () => watched.me - meAt);
  expect(watched.workItems401).toBe(0);
  expect(watched.tooMany).toEqual([]);
});
