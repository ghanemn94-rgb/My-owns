// P6 shell against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-A; p6-work-split §E/F.12, §J/C.13): the
// Administration entries of slices E, F, J and C (Audit, Security, Sensitive grants, Operations, Identity, Storage,
// Notifications) are in the navigation of a technical and access administrator, and each opens an honest "not
// available yet" placeholder that loads no P6 data (FE-B replaces them); the deep-link landing /l/:token is a route
// behind sign-in that sends nothing to the API until FE-B builds it. Every page is checked with axe (no serious or
// critical violation) and captured as a screenshot in English LTR and Arabic RTL. All data is SYNTHETIC (seeded dev
// users).
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): the default 30 s per test is kept. Measured loaded worst
// cases are in docs/delivery/handbacks/DG6/T-DG6-FE-A-evidence/e2e-p6-shell.log (the per-test durations of the run under
// a parallel CPU load); each is well under half of 30 s, so the default is at least 2x the loaded worst case.
import { expect, test } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

/** The P6 Administration entries and their placeholder feature ids (app/nav.ts P6_SUBPAGES, app/router.tsx). */
const ENTRIES: readonly { id: string; path: string; feature: string }[] = [
  { id: "audit", path: "/admin/audit", feature: "audit" },
  { id: "security", path: "/admin/security", feature: "security" },
  { id: "sensitiveGrants", path: "/admin/sensitive-grants", feature: "sensitiveGrants" },
  { id: "operations", path: "/admin/operations", feature: "operations" },
  { id: "identity", path: "/admin/identity", feature: "identity" },
  { id: "storage", path: "/admin/storage", feature: "storage" },
  { id: "notifications", path: "/admin/notification-channels", feature: "notifications" },
];

/** The P6 request paths of slices E, F, J and C (app/api/p6.ts): none may be sent by a placeholder. */
const P6_API =
  /\/api\/v1\/(admin\/(sensitive-grants|upload-policy|security|operations|service-identities|identity|storage|notification-)|audit-events|links\/)/;

test("P6: Administration lists the seven P6 entries for the technical and access administrator", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  const admin = nav.getByRole("list", { name: tr(lang, "nav.areas.admin.label"), exact: true });
  for (const e of ENTRIES)
    await expect(admin.getByRole("link", { name: tr(lang, `nav.sub.${e.id}`), exact: true })).toHaveAttribute(
      "href",
      e.path,
    );
  await shot(page, lang, "p6-admin-nav");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

for (const e of ENTRIES) {
  test(`P6: Administration > ${e.id} opens its "not available yet" placeholder and loads no P6 data`, async ({
    page,
  }, info) => {
    const lang = langOf(info);
    const foreign = trackRequests(page);
    const p6Requests: string[] = [];
    page.on("request", (r) => {
      if (P6_API.test(new URL(r.url()).pathname)) p6Requests.push(r.url());
    });
    await signIn(page, lang, "dev.admin");
    const admin = page
      .getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true })
      .getByRole("list", { name: tr(lang, "nav.areas.admin.label"), exact: true });
    await admin.getByRole("link", { name: tr(lang, `nav.sub.${e.id}`), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${e.path}$`));
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, `nav.p6.${e.feature}.title`));
    await expect(page.locator(`[data-p6-feature='${e.feature}'] [data-state='being-built']`)).toContainText(
      tr(lang, "nav.p6.notAvailableTitle"),
    );
    await expect(admin.getByRole("link", { name: tr(lang, `nav.sub.${e.id}`), exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectAccessible(page, lang, `p6-placeholder-${e.id}`);
    await shot(page, lang, `p6-placeholder-${e.id}`);
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(p6Requests).toEqual([]);
    expect(foreign).toEqual([]);
  });
}

test("P6: /l/:token is a signed-in route that shows its placeholder and sends nothing to /links yet", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const linkRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/links/")) linkRequests.push(r.url());
  });
  // A synthetic, well-formed token (43 base64url characters); no notification carries it.
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";
  await signIn(page, lang, "dev.office");
  await page.goto(`/l/${token}`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p6.deepLink.title"));
  await expect(page.locator("[data-p6-feature='deepLink'] [data-state='being-built']")).toBeVisible();
  await expectAccessible(page, lang, "p6-placeholder-deep-link");
  await shot(page, lang, "p6-placeholder-deep-link");
  expect(linkRequests).toEqual([]);
  expect(foreign).toEqual([]);
});
