// P3 frontend seams on the REAL stack (support/with-stack.sh; no mocks), in the project's language (chromium-en ->
// English LTR, chromium-ar -> Arabic RTL). SYNTHETIC data (T-DG3-FE-A0; p3-work-split §4):
//  - every P3 route opens inside the transformation workspace with its bilingual title and an honest "being built in
//    this stage" state (no data, no form), axe-clean;
//  - the workspace tabs carry the P3 tabs; "Initiatives and Roadmaps" and "Benefits and Finance" lead into the
//    Portfolio and Business cases tabs of each transformation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  exactly,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-seams.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let tid = "";
const SOME_ID = "01920000-0000-7000-9000-0000000009a1";

/** [path segment(s) under the transformation, title key, namespace, workspace tab id or null for a detail page] */
const PAGES = [
  ["portfolio", "portfolio.title", "portfolio", "portfolio"],
  [`initiatives/${SOME_ID}`, "portfolio.initiativeTitle", "portfolio", null],
  ["readiness", "readiness.title", "readiness", "readiness"],
  ["dispensations", "dispensations.title", "dispensations", "dispensations"],
  ["prioritization", "prioritization.title", "prioritization", "prioritization"],
  ["roadmap", "roadmap.title", "roadmap", "roadmap"],
  ["dependencies", "dependencies.title", "dependencies", "dependencies"],
  ["capacity", "capacity.title", "capacity", "capacity"],
  ["business-cases", "businessCases.title", "businessCases", "business-cases"],
  [`business-cases/${SOME_ID}`, "businessCases.detailTitle", "businessCases", null],
  ["benefit-formulas", "benefitFormulas.title", "benefitFormulas", "benefit-formulas"],
  [`benefit-formulas/${SOME_ID}`, "benefitFormulas.detailTitle", "benefitFormulas", null],
] as const;

test("setup: a fresh synthetic transformation for the P3 seam checks", async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 seams ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
});

test("P3 pages: bilingual titles, an honest 'being built' state and the P3 workspace tabs", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.method() !== "HEAD") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await signIn(page, lang, "dev.lead");
  sent.length = 0; // signing in (and the language preference) are not page writes
  for (const [path, titleKey, ns, tab] of PAGES) {
    await page.goto(`/transformations/${tid}/${path}`);
    await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, titleKey)));
    const state = page.locator("[data-state='being-built']");
    await expect(state).toBeVisible();
    await expect(state).toHaveAttribute("role", "note");
    await expect(state).toContainText(tr(lang, `${ns}.stub.title`));
    await expect(state).toContainText(tr(lang, `${ns}.stub.body`));
    await expect(page.locator("main#main").locator("form, input, textarea, select")).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: tr(lang, "transformations.tabs.label"), exact: true });
    if (tab) {
      const current = tabs.locator(`[data-tab='${tab}']`);
      await expect(current).toHaveAttribute("aria-current", "page");
      await expect(current).toHaveText(tr(lang, `${ns}.tab`));
    }
    const name = `p3-seam-${path.split("/")[0]}${tab ? "" : "-detail"}`;
    await expectAccessible(page, lang, name);
    if (["portfolio", "roadmap", "business-cases"].includes(path) || !tab) await shot(page, lang, name);
  }
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(sent).toEqual([]);
  expect(foreign).toEqual([]);
});

test("Initiatives and Roadmaps / Benefits and Finance lead into the Portfolio and Business cases tabs", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  for (const [area, path, tab, tabKey] of [
    ["initiatives", "/initiatives-roadmaps", "portfolio", "portfolio.tab"],
    ["benefits", "/benefits-finance", "business-cases", "businessCases.tab"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, `nav.areas.${area}.label`)));
    await expect(page.locator("#entry-title")).toHaveText(tr(lang, "nav.entry.title", { tab: tr(lang, tabKey) }));
    const link = page.locator(`a[href='/transformations/${tid}/${tab}']`);
    await expect(link).toBeVisible();
    await expectAccessible(page, lang, `p3-area-${area}`);
    await shot(page, lang, `p3-area-${area}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/transformations/${tid}/${tab}$`));
    await expect(page.locator("[data-state='being-built']")).toBeVisible();
  }
  expect(foreign).toEqual([]);
});
