// The shell's navigation against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-G2, D-163):
//  - REQ-S03-007 (ADR-0049 §9): the shell shows exactly the areas GET /me/navigation returns. "An ADM sees 14 areas in
//    en and ar; a Workstream Lead does not see Administration": a SYNTHETIC user holding the union of the role defaults
//    (every role of GET /roles, organization scope) sees all fourteen, and a SYNTHETIC Workstream Lead (role WL on one
//    transformation) sees no Administration. Both are created through the access API by `dev.admin`, and every
//    assignment is REVOKED at the end, so the all-roles user is never an approver candidate in the specs that follow.
//  - REQ-S15-004 (D-163): changing brand.primary in Branding Settings changes the navigation colour (its computed
//    background): the colour itself when white text reaches 4.5:1 on it, otherwise its darker contrast-checked shade.
//    The settings are restored afterwards, so later specs see the default.
// The project's language decides the run (chromium-en English LTR, chromium-ar Arabic RTL); every screen is checked with
// axe and captured. Branding is configuration, not a business approval; #0078FF stays a provisional token.
import { expect, test, type Page } from "@playwright/test";
import { deriveNavigationBackground } from "../../../packages/design-tokens/src/contrast.ts";
import {
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const DEV_ISSUER = "urn:mth:dev-local";
/** nav.ts order (ADR-0049 §9, M0100-M0113). */
const AREAS = [
  "myWork",
  "executive",
  "transformations",
  "playbook",
  "strategy",
  "tom",
  "initiatives",
  "governance",
  "risks",
  "benefits",
  "change",
  "evidence",
  "bau",
  "admin",
] as const;

type Assignment = { id: string; roleCode: string; revokedAt: string | null; version: number };

/** A SYNTHETIC dev-issuer user (so the development sign-in accepts it), with a unique name per run. */
async function syntheticUser(admin: ApiSession, lang: Lang, tag: string): Promise<{ id: string; username: string }> {
  const username = `syn.nav.${tag}.${lang}.${Date.now()}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic navigation ${tag} (${lang})`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  return { id: user.id, username };
}

/** Revokes every active assignment of the user (the end of each test); re-reads until none is left (paged lists). */
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
        { reason: "End of the synthetic navigation journey" },
        { ifMatch: a.version },
      );
  }
}

const primaryNav = (page: Page, lang: Lang) =>
  page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });

/** The primary navigation once GET /me/navigation has answered. */
async function readyNav(page: Page, lang: Lang) {
  const nav = primaryNav(page, lang);
  await expect(nav).toHaveAttribute("data-nav-state", "ready");
  return nav;
}

const areaIds = (page: Page, lang: Lang) =>
  primaryNav(page, lang)
    .locator("a[data-area]")
    .evaluateAll((links) => links.map((a) => a.getAttribute("data-area")));

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test("Navigation: an ADM holding the union of the role defaults sees all 14 areas; a Workstream Lead does not see Administration", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const roles = await admin.call<{ items: { code: string }[] }>("GET", "/api/v1/roles");
  expect(roles.items.length, "the seeded roles").toBeGreaterThan(10);
  const all = await syntheticUser(admin, lang, "adm");
  const wl = await syntheticUser(admin, lang, "wl");
  try {
    // The union of the role defaults: every role, organization-wide (ADR-0049 §9, last paragraph).
    for (const r of roles.items)
      await admin.call("POST", "/api/v1/role-assignments", {
        userId: all.id,
        roleCode: r.code,
        scope: { type: "organization", id: ORG },
        reason: "Synthetic union of the role defaults for the navigation journey (approves nothing real)",
      });
    // A Workstream Lead on one transformation.
    const transformations = await admin.call<{ items: { id: string }[] }>("GET", "/api/v1/transformations?limit=1");
    const scope =
      transformations.items.length > 0
        ? { type: "transformation", id: transformations.items[0]!.id }
        : { type: "organization", id: ORG };
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: wl.id,
      roleCode: "WL",
      scope,
      reason: "Synthetic Workstream Lead for the navigation journey (approves nothing real)",
    });

    // The ADM: all fourteen areas, in nav.ts order, Administration included, labelled in the project's language.
    await signIn(page, lang, all.username);
    const nav = await readyNav(page, lang);
    await expect(nav.locator("a[data-area]")).toHaveCount(14);
    expect(await areaIds(page, lang)).toEqual([...AREAS]);
    for (const area of AREAS)
      await expect(nav.locator(`a[data-area='${area}']`)).toContainText(tr(lang, `nav.areas.${area}.label`));
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectAccessible(page, lang, "p5-nav-adm-14");
    await shot(page, lang, "p5-nav-adm-14-areas");

    // The Workstream Lead: no Administration (hidden by the server), and /admin answers no-permission.
    const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const wlPage = await context.newPage();
    await signIn(wlPage, lang, wl.username);
    const wlNav = await readyNav(wlPage, lang);
    await expect(wlNav.locator("a[data-area='admin']")).toHaveCount(0);
    await expect(wlNav.getByRole("link", { name: tr(lang, "nav.areas.admin.label"), exact: true })).toHaveCount(0);
    await expect(wlNav.locator("a[data-area='myWork']")).toHaveCount(1);
    await expect(wlNav.locator("a[data-area='transformations']")).toHaveCount(1);
    await wlPage.goto("/admin");
    await expect(wlPage.locator("[data-state='no-permission']")).toBeVisible();
    await expectAccessible(wlPage, lang, "p5-nav-wl");
    await shot(wlPage, lang, "p5-nav-wl-no-admin");
    await context.close();
    expect(foreign).toEqual([]);
  } finally {
    await revokeAll(admin, all.id);
    await revokeAll(admin, wl.id);
  }
});

test("Navigation colour: changing brand.primary in Branding Settings changes the navigation background (contrast-checked), then restores it", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const before = await admin.call<Record<string, unknown> & { version: number; primaryColour: string }>(
    "GET",
    "/api/v1/admin/branding",
  );
  const navBackground = () => primaryNav(page, lang).evaluate((el) => getComputedStyle(el).backgroundColor);
  try {
    await signIn(page, lang, "dev.admin");
    await readyNav(page, lang);
    // Before: the navigation is the shade derived from the current primary colour (#0078FF -> #0071F1 by default).
    await expect.poll(navBackground).toBe(rgb(deriveNavigationBackground(before.primaryColour)));
    await page.goto("/admin/branding");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.branding.title"));
    const form = page.locator("form[data-form='branding']");
    const primary = form.getByLabel(
      new RegExp(tr(lang, "playbookP5.branding.field.primaryColour").replace(/[()]/g, "\\$&")),
    );
    const publish = () =>
      form.getByRole("button", { name: tr(lang, "playbookP5.branding.publish"), exact: true }).click();

    // A colour that carries white text (#C8102E, 5.88:1) is used as it is.
    await primary.fill("#C8102E");
    await expect(form.locator("[data-contrast='navigation']")).toContainText("#C8102E");
    await publish();
    await expect(page.locator("[data-state='branding-saved']")).toBeVisible();
    await expect.poll(navBackground).toBe("rgb(200, 16, 46)");
    await expectAccessible(page, lang, "p5-nav-colour-c8102e");
    await shot(page, lang, "p5-nav-colour-c8102e");

    // ADR-0061 §1.2 (REQ-S15-003, D-195 row 18): a colour that fails a declared pair is refused at publish. #FFD700 is
    // 1.40:1 on white (brand.primary / surface.card, controls, 3:1): its navigation shade would be #8B7500, but the
    // publish answers 422 branding.contrast_insufficient in the form's one alert, and the navigation keeps #C8102E.
    await primary.fill("#FFD700");
    await expect(form.locator("[data-contrast='navigation']")).toContainText("#8B7500");
    await publish();
    const refusal = page.locator("main#main").getByRole("alert");
    await expect(refusal).toContainText(tr(lang, "problems.branding__contrast_insufficient"));
    await expect(refusal.locator("[data-contrast-failure='/primaryColour']").first()).toBeVisible();
    await expect.poll(navBackground).toBe("rgb(200, 16, 46)");
    await expectAccessible(page, lang, "p5-nav-colour-ffd700-refused");
    await shot(page, lang, "p5-nav-colour-ffd700-refused");

    // A light colour that meets every declared pair but not 4.5:1 under white navigation text (#E4572E, 3.68:1 with
    // white) is darkened to its contrast-checked navigation shade #CB4E29.
    await primary.fill("#E4572E");
    await expect(form.locator("[data-contrast='navigation']")).toContainText("#CB4E29");
    await publish();
    await expect(page.locator("[data-state='branding-saved']")).toBeVisible();
    await expect.poll(navBackground).toBe("rgb(203, 78, 41)");
    await expectAccessible(page, lang, "p5-nav-colour-e4572e");
    await shot(page, lang, "p5-nav-colour-e4572e");
    expect(foreign).toEqual([]);
  } finally {
    // Restore the settings that were current before this test (a new version with the same values).
    const now = await admin.call<{ version: number }>("GET", "/api/v1/admin/branding");
    const b = before as Record<string, string | null>;
    await admin.call(
      "PUT",
      "/api/v1/admin/branding",
      {
        productNameEn: b["productNameEn"],
        productNameAr: b["productNameAr"],
        primaryColour: b["primaryColour"],
        secondaryColour: b["secondaryColour"],
        colourApprovalReference: b["colourApprovalReference"],
        fontLatin: "IBM Plex Sans",
        fontArabic: "IBM Plex Sans Arabic",
        logo: { mode: "keep" },
        reportHeaderEn: b["reportHeaderEn"],
        reportHeaderAr: b["reportHeaderAr"],
        reportFooterEn: b["reportFooterEn"],
        reportFooterAr: b["reportFooterAr"],
        changeNote: "Synthetic e2e: restore the settings that were current before the navigation-colour test",
      },
      { ifMatch: now.version },
    );
  }
  // After the restore, a fresh load shows the default navigation colour again.
  await page.reload();
  await readyNav(page, lang);
  await expect.poll(navBackground).toBe(rgb(deriveNavigationBackground(before.primaryColour)));
});
