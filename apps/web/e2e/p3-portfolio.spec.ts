// P3 portfolio screens on the REAL stack (support/with-stack.sh; no mocks), in the project's language (chromium-en ->
// English LTR, chromium-ar -> Arabic RTL). SYNTHETIC data (T-DG3-FE-A; ADR-0021):
//  - Portfolio: the initiative list with three separate columns (proposed rank, selection, funding), the filters, a
//    draft created through the UI at any time (before G1), and the read-only outcome hierarchy;
//  - Initiative Card (T05): the 14 fields, the 3-7 deliverables warning, submit refused before G1 with the translated
//    'Case for change not yet approved (G1)…', a gap link to a journey refused with the translated 'A project
//    portfolio is not a Target Operating Model…', an outcome contribution without a KPI;
//  - Readiness: the five missing B0012 areas for a fresh transformation and the translated sequencing blocker;
//  - Dispensations: a waiver recorded with reason, scope and expiry; the recorder is not offered the decision;
//  - the read-only auditor (AUD) sees every screen with no write control, and nothing is sent;
//  - axe (WCAG 2.0/2.1 A+AA) finds no serious or critical issue on any screen; every request stays on the origin.
// Flows that need BE-E (funding, capacity, G4 evaluation) are covered with stubbed responses in the unit tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  escape,
  exactly,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-portfolio.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let tid = "";
let iniId = "";
let journeyId = "";
const INI_NAME = "Synthetic customer onboarding";
const UI_INI_NAME = "Synthetic self-service upgrade";
const OUTCOME = "Synthetic: raise digital adoption";

const ws = (path: string) => `/transformations/${tid}/${path}`;

/** Non-GET requests the page sends (sign-in and the language preference happen before tracking starts). */
function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.method() !== "HEAD") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  return sent;
}

test("setup: a fresh End-to-End transformation with one draft initiative, an outcome and a journey", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 portfolio ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
  const ini = await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
    transformationId: tid,
    name: INI_NAME,
    objective: "Synthetic objective",
    executiveOwnerUserId: lead.userId,
  });
  iniId = ini.id;
  await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: OUTCOME });
  const journey = await lead.call<{ id: string }>("POST", `/api/v1/transformations/${tid}/journeys`, {
    name: "Synthetic onboarding journey",
    kind: "journey",
    state: "current",
    steps: [{ key: "01920000-0000-7000-8000-00000000f701", ordinal: 1, name: "Synthetic step", actor: "Synthetic" }],
  });
  journeyId = journey.id;
  expect(journeyId).toBeTruthy();
});

test("Portfolio: three separate columns, filters, a draft created before G1, the outcome hierarchy", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("portfolio"));
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "portfolio.title")));
  const table = page.locator("main#main table").first();
  for (const key of ["proposedRank", "selection", "funding", "wave", "owners", "warnings"])
    await expect(table.locator("thead")).toContainText(tr(lang, `portfolio.field.${key}`));
  const row = table.locator("tbody tr", { hasText: INI_NAME });
  await expect(row).toContainText(tr(lang, "portfolio.status.draft"));
  await expect(row.locator("[data-selection='not_selected']")).toBeVisible();
  await expect(row.locator("[data-funding='none']")).toHaveText("—");
  // No deliverables yet: the 3-7 hint is a warning on the row (never a block).
  await expect(row.locator("[data-warning='initiative.deliverable_count']")).toBeVisible();
  await expect(page.locator("[data-level='north-star']")).toContainText(tr(lang, "portfolio.hierarchy.noNorthStar"));
  await expect(page.locator("[data-level='outcome']").first()).toContainText(OUTCOME);
  await expectAccessible(page, lang, "p3-portfolio-list");
  await shot(page, lang, "p3-portfolio-list");

  // Filters are server queries: nothing is selected yet.
  await page.getByLabel(tr(lang, "portfolio.filter.status"), { exact: true }).selectOption("selected");
  await expect(page.getByText(tr(lang, "portfolio.list.emptyFiltered"))).toBeVisible();
  await page.getByLabel(tr(lang, "portfolio.filter.status"), { exact: true }).selectOption("");
  await expect(row).toBeVisible();

  // A draft can be created at any time (G1 is not approved here).
  await page.getByRole("button", { name: tr(lang, "portfolio.create.action") }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "portfolio.field.name"))}`)).fill(UI_INI_NAME);
  await expectAccessible(page, lang, "p3-portfolio-create");
  await shot(page, lang, "p3-portfolio-create");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.create.submit") }).click();
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "portfolio.initiativeTitle")));
  await expect(page.locator("#initiative-summary-title")).toContainText(UI_INI_NAME);
  await expect(page.locator("[data-state='draft']")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("Initiative Card: 14 T05 fields, submit refused before G1, not TOM evidence, an outcome contribution", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`initiatives/${iniId}`));
  await expect(page.locator("#initiative-summary-title")).toContainText(INI_NAME);
  await expect(page.locator("[data-t05]")).toHaveCount(14);
  await expect(page.locator("#deliverables [data-warning='initiative.deliverable_count']")).toContainText(
    tr(lang, "portfolio.deliverable.notABlock"),
  );
  await expectAccessible(page, lang, "p3-portfolio-card");
  await shot(page, lang, "p3-portfolio-card");

  // Submit before G1: the server refuses; the dialog shows the one translated alert.
  await page.locator("[data-transition='submit']").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.transition.submit.confirm"), exact: true }).click();
  let alert = dialog.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(tr(lang, "portfolio.problem.initiative__g1_not_approved"));
  await expect(alert).toHaveAttribute("data-problem", "initiative.g1_not_approved");
  await expectAccessible(page, lang, "p3-portfolio-submit-refused");
  await shot(page, lang, "p3-portfolio-submit-refused");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // A gap link to another TOM record (a journey) is refused: a portfolio is not a TOM (B0059).
  await page.getByRole("button", { name: tr(lang, "portfolio.gap.add") }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "portfolio.gap.field.type"))}`)).selectOption("journey");
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "portfolio.gap.field.target"))}`)).selectOption(journeyId);
  await dialog.getByRole("button", { name: tr(lang, "portfolio.gap.add"), exact: true }).click();
  alert = dialog.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(tr(lang, "portfolio.problem.initiative__not_tom_evidence"));
  await expectAccessible(page, lang, "p3-portfolio-not-tom");
  await shot(page, lang, "p3-portfolio-not-tom");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // An outcome contribution: the outcome is required, the KPI optional.
  await page.getByRole("button", { name: tr(lang, "portfolio.contribution.add") }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.contribution.add"), exact: true }).click();
  const outcome = dialog.getByLabel(new RegExp(`^${escape(tr(lang, "portfolio.contribution.field.outcome"))}`));
  await expect(outcome).toHaveAttribute("aria-invalid", "true");
  await outcome.selectOption({ label: OUTCOME });
  await dialog
    .getByLabel(new RegExp(`^${escape(tr(lang, "portfolio.contribution.field.statement"))}`))
    .fill("Synthetic: moves digital adoption");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.contribution.add"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const contribution = page.locator("#contributions [data-has-kpi='false']");
  await expect(contribution).toContainText(OUTCOME);
  await expect(contribution).toContainText(tr(lang, "portfolio.contribution.noKpi"));
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("Readiness: the five missing diagnostic areas and the translated sequencing blocker", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("readiness"));
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "readiness.title")));
  const missing = page.locator("[data-missing-areas]");
  await expect(missing).toHaveAttribute("data-missing-areas", "economics customer operations capability technology");
  for (const area of ["economics", "customer", "operations", "capability", "technology"])
    await expect(missing.locator(`[data-missing-area='${area}']`)).toHaveText(
      new RegExp(escape(tr(lang, `readiness.area.${area}`))),
    );
  await expect(page.locator("[data-blocker='initiative.g1_not_approved']")).toContainText(
    tr(lang, "readiness.blocker.initiative__g1_not_approved"),
  );
  await expect(page.locator("tr[data-gate='G1']")).toHaveAttribute("data-gate-status", "draft");
  await expectAccessible(page, lang, "p3-portfolio-readiness");
  await shot(page, lang, "p3-portfolio-readiness");
  expect(foreign).toEqual([]);
});

test("Dispensations: a waiver with reason, scope and expiry; the recorder is not offered the decision", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("dispensations"));
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "dispensations.title")));
  await page.getByRole("button", { name: tr(lang, "dispensations.record.action") }).click();
  const dialog = page.getByRole("dialog");
  // Nothing is sent without the reason and the expiry.
  await dialog.getByRole("button", { name: tr(lang, "dispensations.record.submit"), exact: true }).click();
  await expect(dialog.getByLabel(new RegExp(`^${escape(tr(lang, "dispensations.field.reason"))}`))).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "dispensations.field.gate"))}`)).selectOption("G3");
  await dialog
    .getByLabel(new RegExp(`^${escape(tr(lang, "dispensations.field.reason"))}`))
    .fill("Synthetic: pilot launch while the TOM is finalised");
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "dispensations.field.scope"))}`)).selectOption(iniId);
  await dialog.getByLabel(new RegExp(`^${escape(tr(lang, "dispensations.field.expiresOn"))}`)).fill("2099-12-31");
  await expectAccessible(page, lang, "p3-portfolio-dispensation-record");
  await shot(page, lang, "p3-portfolio-dispensation-record");
  await dialog.getByRole("button", { name: tr(lang, "dispensations.record.submit"), exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator("main#main tbody tr", { hasText: "Synthetic: pilot launch" });
  await expect(row).toContainText(tr(lang, "dispensations.status.pending"));
  await expect(row).toContainText(INI_NAME);
  await expect(row).toContainText(tr(lang, "dispensations.decide.recorderCannot"));
  await expect(row.locator("[data-action='decide']")).toHaveCount(0);
  await expectAccessible(page, lang, "p3-portfolio-dispensations");
  await shot(page, lang, "p3-portfolio-dispensations");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

const assertNoWriteControls = async (page: Page, lang: Lang) => {
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.locator("main#main [data-transition], main#main [data-action]")).toHaveCount(0);
  for (const key of [
    "portfolio.create.action",
    "portfolio.card.edit",
    "portfolio.gap.add",
    "portfolio.contribution.add",
    "portfolio.decisionLink.add",
    "dispensations.record.action",
  ])
    await expect(page.getByRole("button", { name: tr(lang, key) })).toHaveCount(0);
};

test("the read-only auditor sees every FE-A screen with no write control and sends nothing", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.auditor");
  const sent = trackMutations(page);
  for (const [path, name, ready] of [
    ["portfolio", "p3-portfolio-aud-list", "main#main tbody tr"],
    [`initiatives/${iniId}`, "p3-portfolio-aud-card", "[data-t05='14']"],
    ["readiness", "p3-portfolio-aud-readiness", "[data-missing-areas]"],
    ["dispensations", "p3-portfolio-aud-dispensations", "main#main tbody tr"],
  ] as const) {
    await page.goto(ws(path));
    await expect(page.locator(ready).first()).toBeVisible();
    await assertNoWriteControls(page, lang);
    await expectAccessible(page, lang, name);
    await shot(page, lang, name);
  }
  expect(sent).toEqual([]);
  expect(foreign).toEqual([]);
});
