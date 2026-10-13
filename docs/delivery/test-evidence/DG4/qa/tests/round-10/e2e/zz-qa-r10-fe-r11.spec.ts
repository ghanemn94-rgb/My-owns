// qa-verifier DG4 round 10 (T-DG4-REV-QA-R10): independent probe of the FE-R11 repair (F-DG4-160 and the D-137 sweep)
// (revision 2: P2 also opens each sub-entry's workspace link) on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, all migrations, seed-dev, built API
// serving the built SPA; no mocks, no request interception). This file lives OUTSIDE the frozen candidate
// (docs/delivery/test-evidence/DG4/qa/tests/round-10/e2e/); it is copied into a disposable clone's apps/web/e2e/ only to
// run, and removed afterwards.
//
// What it checks, literally, in chromium-en (LTR) and chromium-ar (RTL):
//   P1 (F-DG4-160 reproduction): the Status hint on /transformations/:id/edit is the corrected catalogue text, contains
//      no 'later release' / 'إصدار لاحق' / 'سيتاح', and the select offers no 'closed'. What the hint claims is true: the
//      transformation's Closure page (/transformations/:id/closure) opens with its own heading (closureP4.title). axe, 390 px
//      and 200 % text on the edit page.
//   P2 (sweep, nav.plannedBody / nav.willContain): on each of the 4 planned areas the body and heading are shown, and every
//      sub-entry the text says is "listed under it in the navigation" is a nav link that opens a working page (an h1 that is
//      neither 'Not found' nor the 'being built' placeholder). The Dashboards link under the Executive Overview opens.
//   P3 (sweep, nav.entry.portfolioPlanned): on the 6 partial-area entry pages the planned card shows the corrected text.
// Everything is SYNTHETIC; no product gate (G1-G6) is decided, and none implies an engineering gate (DG0-DG7).
import { expect, test, type Page } from "@playwright/test";
import { apiSession, expectAccessible, langOf, shot, signIn, SYN_RETAIL, tr, type Lang } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

const PLANNED: Record<string, { path: string; subs: string[] }> = {
  playbook: { path: "/playbook", subs: ["/playbook/phases"] },
  risks: { path: "/risks-actions", subs: ["/risks-actions/raid", "/risks-actions/actions", "/risks-actions/corrective-actions"] },
  change: { path: "/change-adoption", subs: ["/change-adoption/adoption"] },
  bau: {
    path: "/bau-improvement",
    subs: ["/bau-improvement/bau", "/bau-improvement/improvement", "/bau-improvement/lessons"],
  },
};
// The workspace tab each sub-entry opens (app/nav.ts NAV_SUBPAGES workspaceTab), where it differs from the last path segment.
const TAB: Record<string, string> = { "/change-adoption/adoption": "adoption" };
const PARTIAL = [
  "/strategy-kpis",
  "/target-operating-model",
  "/initiatives-roadmaps",
  "/governance",
  "/benefits-finance",
  "/evidence-reports",
];

async function overflowPx(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function workingPage(page: Page, lang: Lang): Promise<string> {
  const h1 = page.locator("main#main h1").first();
  await expect(h1).toBeVisible({ timeout: 20_000 });
  const text = (await h1.textContent())?.trim() ?? "";
  expect(text).not.toBe(tr(lang, "common.state.notFoundTitle"));
  expect(text).not.toBe(tr(lang, "nav.p4.beingBuiltTitle"));
  return text;
}

let tid = "";

test("P1 F-DG4-160: the edit page's Status hint is corrected and its Closure page exists", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const office = await apiSession(playwright, "dev.office");
  const t = await office.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA DG4 R10 hint ${lang.toUpperCase()} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  tid = t.id;
  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${tid}/edit`);
  const expected = tr(lang, "transformations.form.statusHint");
  const hint = page.getByText(expected, { exact: true });
  await expect(hint).toBeVisible();
  const shown = (await hint.textContent())?.trim() ?? "";
  expect(shown).toBe(expected);
  for (const stale of ["later release", "available in", "إصدار لاحق", "سيتاح", "not available"]) expect(shown).not.toContain(stale);
  expect(shown).toContain(lang === "ar" ? "«الإغلاق»" : "Closure page");
  expect(shown).toContain(lang === "ar" ? "G6 (الاستدامة)" : "G6 (Sustain)");
  // The select still offers no 'closed' (closure is governed on the Closure page).
  const values = await page.locator("main#main select").evaluateAll((els) =>
    els.flatMap((el) => [...(el as HTMLSelectElement).options].map((o) => o.value)),
  );
  expect(values).not.toContain("closed");
  await expectAccessible(page, lang, "qa-r10-edit-hint");
  await shot(page, lang, "qa-r10-edit-hint");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.waitForTimeout(200);
  await expect(hint).toBeVisible();
  expect(await overflowPx(page), "200 % text overflow").toBeLessThanOrEqual(1);
  await shot(page, lang, "qa-r10-edit-hint-200pct");
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/transformations/${tid}/edit`);
  await expect(page.getByText(expected, { exact: true })).toBeVisible();
  expect(await overflowPx(page), "390 px overflow").toBeLessThanOrEqual(1);
  await shot(page, lang, "qa-r10-edit-hint-390px");
  await page.setViewportSize({ width: 1280, height: 720 });
  // What the hint claims: the transformation's Closure page opens.
  await page.goto(`/transformations/${tid}/closure`);
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "closureP4.title"), exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expectAccessible(page, lang, "qa-r10-closure-page");
  await shot(page, lang, "qa-r10-closure-page");
});

test("P2 sweep: each planned area's text is true; its delivered screens are under it in the navigation", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  for (const [area, { path, subs }] of Object.entries(PLANNED)) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: tr(lang, `nav.areas.${area}.label`), exact: true })).toBeVisible();
    await expect(page.getByText(tr(lang, "nav.plannedBody"), { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: tr(lang, "nav.willContain"), exact: true })).toBeVisible();
    const body = tr(lang, "nav.plannedBody");
    for (const stale of ["not available yet", "غير متاح بعد"]) expect(body).not.toContain(stale);
    await expectAccessible(page, lang, `qa-r10-planned-${area}`);
    await shot(page, lang, `qa-r10-planned-${area}`);
    for (const sub of subs) {
      const link = nav.locator(`a[href='${sub}']`);
      await expect(link, `${area}: nav link ${sub}`).toBeVisible();
      await link.click();
      await page.waitForURL(`**${sub}`);
      const h = await workingPage(page, lang);
      // Revision 2: the sub-entry page is NOT the planned placeholder (its h1 is also the area label): it lists the
      // transformations and links into the matching workspace tab of each (AreaEntryPage), here the one P1 created.
      await expect(page.getByText(tr(lang, "nav.plannedBody"), { exact: true })).toHaveCount(0);
      const tab = sub.split("/").pop()!.replace(/^phases$/, "phases");
      const into = page.locator(`main#main a[href='/transformations/${tid}/${TAB[sub] ?? tab}']`);
      await expect(into, `${sub}: link into /transformations/${tid}/${TAB[sub] ?? tab}`).toBeVisible({ timeout: 20_000 });
      await into.click();
      await page.waitForURL(`**/transformations/${tid}/${TAB[sub] ?? tab}`);
      const h2 = await workingPage(page, lang);
      console.log(`QA-R10 ${lang} ${area} ${sub} -> h1 "${h}" -> /transformations/<tid>/${TAB[sub] ?? tab} h1 "${h2}"`);
      await page.goto(path);
      await expect(page.getByText(tr(lang, "nav.plannedBody"), { exact: true })).toBeVisible();
    }
    // 390 px and 200 % text on the planned area page.
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(150);
    expect(await overflowPx(page), `${area} 200 %`).toBeLessThanOrEqual(1);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PLANNED["risks"]!.path);
  await expect(page.getByText(tr(lang, "nav.plannedBody"), { exact: true })).toBeVisible();
  expect(await overflowPx(page), "risks 390 px").toBeLessThanOrEqual(1);
  await shot(page, lang, "qa-r10-planned-risks-390px");
  await page.setViewportSize({ width: 1280, height: 720 });
  // "The dashboards under the Executive Overview": the link exists in the navigation and opens a working page.
  await page.goto("/my-work");
  const dash = nav.locator("a[href='/dashboards']");
  await expect(dash).toBeVisible();
  await dash.click();
  await page.waitForURL("**/dashboards");
  console.log(`QA-R10 ${lang} /dashboards -> h1 "${await workingPage(page, lang)}"`);
});

test("P3 sweep: the partial areas' planned card shows the corrected portfolioPlanned text", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  const text = tr(lang, "nav.entry.portfolioPlanned");
  for (const path of PARTIAL) {
    await page.goto(path);
    await expect(page.locator("#entry-planned + p")).toHaveText(text, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 3, name: tr(lang, "nav.willContain"), exact: true })).toBeVisible();
  }
  await expectAccessible(page, lang, "qa-r10-partial-evidence");
});
