// P5 shell against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-A, D-144): the ten area landing pages of
// REQ-S03-007 list the contents master prompt §3 names for each area, with where each lives; the P5 screens of
// FE-B…FE-G are reachable from the navigation and say, in the project's language, that they are not available yet.
// Every page is checked with axe (no serious or critical violation) and captured as a screenshot. All data is
// SYNTHETIC (seeded dev users).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The area landing pages and their §3 content ids, read from app/nav.ts's AREA_CONTENTS order via the catalogue. */
const LANDING: readonly { area: string; path: string }[] = [
  { area: "playbook", path: "/playbook" },
  { area: "strategy", path: "/strategy-kpis" },
  { area: "tom", path: "/target-operating-model" },
  { area: "initiatives", path: "/initiatives-roadmaps" },
  { area: "governance", path: "/governance" },
  { area: "risks", path: "/risks-actions" },
  { area: "benefits", path: "/benefits-finance" },
  { area: "change", path: "/change-adoption" },
  { area: "evidence", path: "/evidence-reports" },
  { area: "bau", path: "/bau-improvement" },
];

/** The content ids of one area in catalogue order (the catalogue lists them in §3's order, as AREA_CONTENTS does). */
function contentIds(area: string): string[] {
  const nav = JSON.parse(readFileSync(join(HERE, "..", "src", "i18n", "en", "nav.json"), "utf8")) as {
    contents: Record<string, Record<string, string>>;
  };
  return Object.keys(nav.contents[area] ?? {});
}

test("P5: every area landing page lists its §3 contents in the project's language (Transformation Office)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  // No area carries the "planned" tag (every area has delivered screens; F-DG4-160).
  await expect(nav.getByText(tr(lang, "nav.planned"), { exact: true })).toHaveCount(0);
  for (const { area, path } of LANDING) {
    await page.goto(path);
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, `nav.areas.${area}.label`));
    await expect(page.getByRole("heading", { level: 2, name: tr(lang, "nav.willContain"), exact: true })).toBeVisible();
    const labels = page.locator(`[data-area-contents='${area}'] > li .area-content__label`);
    await expect(labels).toHaveText(contentIds(area).map((id) => tr(lang, `nav.contents.${area}.${id}`)));
    await expectAccessible(page, lang, `p5-area-${area}`);
    await shot(page, lang, `p5-area-${area}`);
  }
  // A P5 screen named on a landing page opens its placeholder: not available yet, no data, no form.
  await page.goto("/playbook");
  await page
    .locator("[data-content-item='source']")
    .getByRole("link", { name: tr(lang, "nav.sub.reader"), exact: true })
    .click();
  await expect(page).toHaveURL(/\/playbook\/reader$/);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.reader.title"));
  const note = page.locator("main [data-state='being-built']");
  await expect(note).toContainText(tr(lang, "nav.p5.notAvailableTitle"));
  await expect(note).toContainText(tr(lang, "nav.p5.notAvailableBody"));
  await expect(page.locator("main form, main table")).toHaveCount(0);
  await expectAccessible(page, lang, "p5-placeholder-reader");
  await shot(page, lang, "p5-placeholder-reader");
  // The P5 entries of the Transformation Office's areas are in the navigation.
  for (const id of ["reader", "myProcedures", "launchPlan", "healthCheck", "reports", "exports", "presentation"])
    await expect(nav.getByRole("link", { name: tr(lang, `nav.sub.${id}`), exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("P5: Administration lists the P5 configuration screens; each says it is not available yet (administrator)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  const admin = nav.getByRole("list", { name: tr(lang, "nav.areas.admin.label"), exact: true });
  for (const id of ["formBuilder", "procedureBuilder", "automation", "approvalRoutes", "branding", "demo"])
    await expect(admin.getByRole("link", { name: tr(lang, `nav.sub.${id}`), exact: true })).toBeVisible();
  await admin.getByRole("link", { name: tr(lang, "nav.sub.branding"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/branding$/);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.branding.title"));
  await expect(page.locator("main [data-state='being-built']")).toContainText(tr(lang, "nav.p5.notAvailableBody"));
  await expectAccessible(page, lang, "p5-placeholder-branding");
  await shot(page, lang, "p5-placeholder-branding");
  expect(foreign).toEqual([]);
});
