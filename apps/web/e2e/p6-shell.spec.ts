// P6 shell against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-A; p6-work-split §E/F.12, §J/C.13): the
// Administration entries of slices E, F, J and C (Audit, Security, Sensitive grants, Operations, Identity, Storage,
// Notifications) are in the navigation of a technical and access administrator. T-DG6-FE-B replaced the "not available
// yet" placeholders with the screens: each entry now opens its screen (no placeholder is left), which is checked in
// depth by p6-admin-screens.spec.ts (axe, screenshots, interactions). All data is SYNTHETIC (seeded dev users).
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): the default 30 s per test is kept. Measured loaded worst
// cases are in docs/delivery/handbacks/DG6/T-DG6-FE-A-evidence/e2e-p6-shell.log (4.6 s, under a parallel typecheck) and
// fe-ab-e2e-p6-shell.log (4.4 s, under a parallel prettier --check of the repository); 30 s is more than 6x either.
import { expect, test } from "@playwright/test";
import { langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

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
  test(`P6: Administration > ${e.id} opens its screen, not a placeholder`, async ({ page }, info) => {
    const lang = langOf(info);
    const foreign = trackRequests(page);
    await signIn(page, lang, "dev.admin");
    const admin = page
      .getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true })
      .getByRole("list", { name: tr(lang, "nav.areas.admin.label"), exact: true });
    await admin.getByRole("link", { name: tr(lang, `nav.sub.${e.id}`), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${e.path}$`));
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, `nav.p6.${e.feature}.title`));
    await expect(page.locator("[data-p6-screen]")).toBeVisible();
    await expect(page.locator("[data-p6-feature]")).toHaveCount(0);
    await expect(admin.getByRole("link", { name: tr(lang, `nav.sub.${e.id}`), exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  });
}
