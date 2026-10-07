// qa-verifier DG2 round 17 — DIAGNOSTIC for the R15-04 failure in the round-17 full run (17-e2e-qa-stack-unset.log,
// both projects): R15-04's LAST step expected the second language switch to show the "not saved" notice again, and it
// did not. R17-10 replays R15-04 step by step against the REAL stack and records, for every PUT /me/preferences, its
// status, the X-CSRF-Token it carried, and the csrfToken of every GET /me answer, so the cause is measured, not guessed:
//  - if FE15's /me confirmation on the in-app navigation (detail, then Back) picked up the same person's NEW session
//    (its new CSRF token), the second save carries the new token and succeeds: no notice is correct and the preference
//    is persisted (improved behaviour, not a regression);
//  - if the second save is refused (403) and no notice shows, that is a regression of FE11/FE12 (a finding).
// Everything R15-04 asserted before its last step is asserted again here unchanged. All data is SYNTHETIC.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { apiSession, ensureLanguage, langOf, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const SYN_FIN = "01920000-0000-7000-9000-000000000103";
const NAMES: Record<Lang, string> = { ar: "العربية", en: "English" };
const other = (l: Lang): Lang => (l === "ar" ? "en" : "ar");
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
function note(info: TestInfo, type: string, description: string) {
  info.annotations.push({ type, description });
  console.log(`[${info.project.name}] ${type}: ${description}`);
}
const short = (s: string | null | undefined) => (s ? `${s.slice(0, 8)}…` : String(s));

test("R17-10 (diagnostic for R15-04) a 403 csrf is not a session end; after an in-app navigation the same person's new session is confirmed and the next save succeeds", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const o = other(lang);
  const ev: string[] = [];
  let me = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p === "/api/v1/me/preferences") ev.push(`send ${r.method()} preferences csrf=${short(r.headers()["x-csrf-token"])}`);
    if (p === "/api/v1/me" && r.method() === "GET") me++;
  });
  page.on("response", async (r) => {
    const p = new URL(r.url()).pathname;
    if (p === "/api/v1/me/preferences") ev.push(`answer ${r.request().method()} preferences ${r.status()}`);
    if (p === "/api/v1/me" && r.request().method() === "GET" && r.status() === 200) {
      const b = (await r.json().catch(() => null)) as { csrfToken?: string; user?: { preferredLocale?: string } } | null;
      ev.push(`answer GET me 200 csrf=${short(b?.csrfToken)} preferredLocale=${b?.user?.preferredLocale}`);
    }
  });
  const office = await apiSession(playwright, "dev.office");
  const marker = `Synthetic QA R17-10 ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  const a = await office.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_FIN, name: marker, mode: "end_to_end" });
  await page.goto("/login");
  await anyDevField(page).fill("dev.office");
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
  await navLink(page, lang, "transformations").click();
  await expect(page.getByText(marker)).toBeVisible();
  // The same person signs in again in this browser (another session; this tab's CSRF token no longer matches).
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", {
    data: { username: "dev.office" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(relogin.status()).toBe(204);
  ev.push("--- relogin (same person, new session)");
  const meAt = me;
  const first = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  await switchTo(page, lang).click();
  const r1 = await first;
  expect(r1.status()).toBe(403);
  expect(((await r1.json()) as { code: string }).code).toBe("csrf");
  await expectDir(page, o);
  await expect(page.getByTestId("language-not-saved")).toHaveText(tr(o, "common.language.notSaved"));
  await expect(signOutButton(page, o)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/transformations");
  await expect(page.getByText(marker)).toBeVisible();
  // A forbidden detail read [route-replaced], as in R15-04; then Back.
  ev.push("--- in-app navigation to the detail (403 route-replaced), then Back");
  await page.route(
    (u) => u.pathname === `/api/v1/transformations/${a.id}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 403,
            contentType: "application/problem+json",
            body: JSON.stringify({ type: "https://mth.invalid/problems/forbidden", title: "forbidden", status: 403, code: "forbidden", requestId: "qa-r17-10" }),
          })
        : route.fallback(),
  );
  await page.getByRole("link", { name: marker }).first().click();
  await page.waitForURL(`**/transformations/${a.id}`);
  await page.waitForTimeout(1_500);
  expect(new URL(page.url()).pathname).toBe(`/transformations/${a.id}`);
  await expect(signOutButton(page, o)).toBeVisible();
  await page.goBack();
  await expect(page.getByText(marker)).toBeVisible();
  expect(me - meAt, "GET /me during the 403s").toBeLessThanOrEqual(2);
  await page.unroute((u) => u.pathname === `/api/v1/transformations/${a.id}`);
  // The second switch: what does the save carry and answer?
  ev.push("--- second switch");
  const second = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/me/preferences");
  await switchTo(page, o).click();
  const r2 = await second;
  await expectDir(page, lang);
  await page.waitForTimeout(1_000);
  const notice = await page.getByTestId("language-not-saved").count();
  const persisted = await page.context().request.get("/api/v1/me");
  const persistedLocale = ((await persisted.json()) as { user: { preferredLocale: string } }).user.preferredLocale;
  note(info, "r17-10", `${JSON.stringify(ev)}; second save ${r2.status()}; notice shown ${notice}; server preferredLocale now ${persistedLocale}; /me since relogin ${me - meAt}`);
  // Exactly one of the two consistent outcomes: saved (2xx, no notice, persisted) or refused (403, notice shown).
  if (r2.ok()) {
    expect(notice, "a successful save shows no 'not saved' notice").toBe(0);
    expect(persistedLocale, "the preference is persisted").toBe(lang);
  } else {
    expect(r2.status()).toBe(403);
    await expect(page.getByTestId("language-not-saved")).toHaveText(tr(lang, "common.language.notSaved"));
  }
  await expect(signOutButton(page, lang)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
