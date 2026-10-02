// P2 web journeys against the REAL API and PostgreSQL (support/with-stack.sh; no mocks): Diagnose, Charter, Define,
// Design, Decisions, Evidence and the product gates, in the project's language (chromium-en -> English LTR,
// chromium-ar -> Arabic RTL). Every step takes a full-page screenshot (screenshots/<lang>/p2-*.png) and runs axe.
//
// Setup data is created through the real API as the SYNTHETIC dev users (with CSRF, If-Match, Idempotency-Key);
// the behaviour under test is driven through the UI. Nothing here is Mobily data, and the G1 approval recorded below
// is a synthetic demo approval by a synthetic user: it approves nothing real and never implies any engineering gate.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  DEV_USERS,
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  escape,
  exactly,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-p2.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let tid = "";
const ws = (tab: string) => `/transformations/${tid}/${tab}`;

/** A fresh browser context signed in as `username` (each role in its own session). */
async function asUser(
  browser: Browser,
  lang: Lang,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

const section = (page: Page, lang: Lang, key: string) => page.getByRole("region", { name: tr(lang, key), exact: true });

test("lead creates an End-to-End transformation; the workspace tabs lead to the P2 screens", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P2 ${lang.toUpperCase()} journey`,
    mode: "end_to_end",
  });
  tid = created.id;
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}`);
  const tabs = page.getByRole("navigation", { name: tr(lang, "transformations.tabs.label"), exact: true });
  for (const tab of ["overview", "diagnose", "charter", "define", "design", "decisions", "gates", "evidence"])
    await expect(tabs.getByRole("link", { name: tr(lang, `transformations.tabs.${tab}`), exact: true })).toBeVisible();
  // The header composes P2 data: no North Star yet is Unknown, never blank; G1 readiness is live.
  await expect(page.getByRole("link", { name: "G1", exact: true })).toBeVisible();
  await shot(page, lang, "p2-01-overview");
  await expectAccessible(page, lang, "p2-overview");
  await tabs.getByRole("link", { name: tr(lang, "transformations.tabs.diagnose"), exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "diagnose.title"), exact: true })).toBeVisible();
  expect(foreign).toEqual([]);
});

test("Diagnose: six T01 dimensions with Unknown; value pools labelled Unquantified with a partial total", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("diagnose"));
  const t01 = section(page, lang, "diagnose.t01.title");
  await expect(t01.getByRole("rowheader")).toHaveCount(6);
  await expect(t01.locator("[data-health='unknown']").first()).toContainText(tr(lang, "common.value.unknown"));
  const workstreams = section(page, lang, "diagnose.workstreams.title");
  await expect(workstreams.locator("[data-workstream]")).toHaveCount(6);
  await shot(page, lang, "p2-02-diagnose");
  await expectAccessible(page, lang, "p2-diagnose");

  // Fill the first T01 row through the dialog (only changed fields are sent, with If-Match).
  const firstDimension = (await t01.getByRole("rowheader").first().textContent())!.trim();
  await t01.getByRole("button", { name: rowAction(lang, "common.action.edit", firstDimension) }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(fieldLabel(lang, "diagnose.t01.currentState"))
    .fill("Synthetic: invoices are corrected by hand");
  await dialog.getByLabel(fieldLabel(lang, "diagnose.t01.rootCause")).fill("Synthetic: no validation at order entry");
  await dialog.getByLabel(fieldLabel(lang, "diagnose.confidence.label")).selectOption("M");
  await shot(page, lang, "p2-02b-t01-dialog");
  await expectAccessible(page, lang, "p2-t01-dialog");
  await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(t01.getByText("Synthetic: no validation at order entry")).toBeVisible();
  await expect(t01.getByText(tr(lang, "diagnose.confidence.M"), { exact: true })).toBeVisible();

  // An unquantified value pool: labelled, never 0; the total is Unknown and "partial: 1 unquantified".
  const pools = section(page, lang, "kpi.valuePool.title");
  await pools.getByRole("button", { name: tr(lang, "kpi.valuePool.add"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "common.field.name")).fill("Synthetic billing leakage");
  await dialog
    .getByLabel(fieldLabel(lang, "kpi.valuePool.unquantifiedReason"))
    .fill("Synthetic: data not yet extracted");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pools.getByRole("rowheader", { name: "Synthetic billing leakage" })).toBeVisible();
  await expect(pools.locator("[data-quantification='unquantified']").first()).toHaveText(
    new RegExp(escape(tr(lang, "kpi.valuePool.unquantified"))),
  );
  const total = pools.locator("[data-total-currency='SAR']");
  await expect(total).toContainText(tr(lang, "common.value.unknown"));
  await expect(total).toContainText(tr(lang, "kpi.valuePool.partial", { n: 1 }));
  await expect(total).not.toContainText(/SAR\s*0\b|0\s*SAR/);

  // A quantified pool: amounts are exact decimals, summed per currency; the total stays "partial: 1 unquantified".
  await pools.getByRole("button", { name: tr(lang, "kpi.valuePool.add"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "common.field.name")).fill("Synthetic churn reduction");
  await dialog.getByLabel(fieldLabel(lang, "kpi.valuePool.quantification")).selectOption("quantified");
  await dialog.getByLabel(fieldLabel(lang, "kpi.valuePool.downside")).fill("1500000.25");
  await dialog.getByLabel(fieldLabel(lang, "kpi.valuePool.upside")).fill("2500000.75");
  await dialog.getByLabel(fieldLabel(lang, "kpi.valuePool.materiality")).selectOption("material");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(total).toContainText("1,500,000.25");
  await expect(total).toContainText("2,500,000.75");
  await expect(total).toContainText(tr(lang, "kpi.valuePool.partial", { n: 1 }));
  await pools.scrollIntoViewIfNeeded();
  await shot(page, lang, "p2-03-value-pools");
  await expectAccessible(page, lang, "p2-value-pools");
  expect(foreign).toEqual([]);
});

test("Charter: create, save a second version, compare versions; the 3-5 top-outcomes warning", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("charter"));
  await expect(page.getByText(tr(lang, "define.charter.empty"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page
    .getByLabel(fieldLabel(lang, "define.charter.field.caseForChange"))
    .fill("Synthetic: billing errors drive churn and cost.");
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("Synthetic: wholesale billing");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(page.locator("[data-state='charter-version']")).toHaveAttribute("data-charter-version", "1");
  const fields = section(page, lang, "define.charter.fieldsTitle");
  await expect(fields.locator("li.charter-field")).toHaveCount(14);
  await expect(page.locator("[data-warning='charter.top_outcomes_count']")).toContainText(
    tr(lang, "define.charter.topOutcomesWarning", { n: 0 }),
  );
  const scope = section(page, lang, "define.charter.scope.title");
  await expect(scope.locator("[data-scope-check]")).toHaveCount(5);

  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.inScope")).fill("Synthetic: retail consumer billing");
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("Synthetic: scope added");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  await expect(page.locator("[data-state='charter-version']")).toHaveAttribute("data-charter-version", "2");
  await shot(page, lang, "p2-04-charter");
  await expectAccessible(page, lang, "p2-charter");
  await page
    .getByRole("button", {
      name: tr(lang, "define.charter.versions.compare", { version: 2, previous: 1 }),
      exact: true,
    })
    .click();
  const diff = page.getByRole("region", {
    name: tr(lang, "define.charter.versions.diffTitle", { previous: 1, version: 2 }),
    exact: true,
  });
  await expect(
    diff.getByRole("rowheader", { name: tr(lang, "define.charter.field.inScope"), exact: true }),
  ).toBeVisible();
  await expect(diff).toContainText("Synthetic: retail consumer billing");
  await diff.scrollIntoViewIfNeeded();
  await shot(page, lang, "p2-05-charter-diff");
  await expectAccessible(page, lang, "p2-charter-diff");
  expect(foreign).toEqual([]);
});

test("Define: North Star, the good outcome test with reasons, and a required T02 target date", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  await lead.call("POST", `/api/v1/transformations/${tid}/kpi-definitions`, {
    name: "Synthetic billing error rate",
    unitKind: "percentage",
    unitLabel: "%",
    polarity: "lower_is_better",
    ownerUserId: DEV_USERS.lead,
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("define"));
  await expect(page.getByText(tr(lang, "define.northStar.notSet"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "define.northStar.set"), exact: true }).click();
  await page
    .getByLabel(fieldLabel(lang, "define.northStar.statement"))
    .fill("Every synthetic retail bill is right the first time");
  await page.getByRole("button", { name: tr(lang, "define.northStar.save"), exact: true }).click();
  await expect(page.locator("[data-north-star='current']")).toContainText(
    "Every synthetic retail bill is right the first time",
  );

  // An activity-worded outcome fails the "specific" criterion; owner and KPI are missing too.
  const outcomes = section(page, lang, "define.outcomes.title");
  await outcomes.getByRole("button", { name: tr(lang, "define.outcomes.add"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "define.outcomes.statement")).fill("Launch the synthetic billing app");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const test_ = outcomes.locator("[data-good-outcome-test]").first();
  await expect(test_.locator("[data-criterion='specific']")).toHaveAttribute("data-result", "fail");
  await expect(test_.locator("[data-criterion='measurable']")).toHaveAttribute("data-result", "fail");
  await expect(test_).toContainText(tr(lang, "define.goodOutcome.reasons.specific.activity"));
  await expect(test_.locator("[data-result='unknown']").first()).toBeVisible();
  await shot(page, lang, "p2-06-good-outcome-test");
  await expectAccessible(page, lang, "p2-good-outcome-test");

  // T02: nothing is sent without a target date.
  const t02 = section(page, lang, "kpi.t02.title");
  await t02.getByRole("button", { name: tr(lang, "kpi.t02.add"), exact: true }).click();
  await dialog
    .getByLabel(fieldLabel(lang, "kpi.t02.outcome"))
    .selectOption({ label: "Launch the synthetic billing app" });
  await dialog
    .getByLabel(fieldLabel(lang, "kpi.definition.single"))
    .selectOption({ label: "Synthetic billing error rate" });
  await dialog.getByLabel(fieldLabel(lang, "kpi.t02.targetValue")).fill("1.5");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog.getByLabel(fieldLabel(lang, "kpi.t02.targetDate"))).toHaveAttribute("aria-invalid", "true");
  await shot(page, lang, "p2-07-t02-target-date-required");
  await expectAccessible(page, lang, "p2-t02-date-required");
  await dialog.getByLabel(fieldLabel(lang, "kpi.t02.targetDate")).fill("2027-06-30");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(t02.getByRole("rowheader", { name: "Launch the synthetic billing app" })).toBeVisible();
  // Now linked to a KPI: "measurable" passes.
  await expect(test_.locator("[data-criterion='measurable']")).toHaveAttribute("data-result", "pass");
  expect(foreign).toEqual([]);
});

test("Design: ten canvas boxes, the per-dimension view; workshop mode converts an unresolved item into T04", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  const lead = await apiSession(playwright, "dev.lead");
  const workshop = await lead.call<{ id: string }>("POST", `/api/v1/transformations/${tid}/tom-workshops`, {
    title: "Synthetic TOM workshop",
    workshopDate: "2026-10-05",
    durationMinutes: 90,
    facilitatorUserId: DEV_USERS.lead,
  });
  await lead.call("POST", `/api/v1/transformations/${tid}/tom-workshops/${workshop.id}/items`, {
    kind: "unresolved",
    body: "Synthetic: who owns billing exceptions?",
    ownerUserId: DEV_USERS.lead,
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("design"));
  const canvas = page.getByRole("list", { name: tr(lang, "design.canvas.gridLabel"), exact: true });
  await expect(canvas.locator("[data-dimension]")).toHaveCount(10);
  await canvas
    .locator("[data-dimension]")
    .first()
    .getByRole("button", { name: new RegExp(`^\\s*${escape(tr(lang, "design.canvas.open"))}`) })
    .click();
  const view = page.locator("[data-dimension-view]");
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: tr(lang, "design.gaps.title"), exact: true })).toBeVisible();
  await shot(page, lang, "p2-08-design-canvas");
  await expectAccessible(page, lang, "p2-design-canvas");

  const workshops = section(page, lang, "design.workshops.title");
  await workshops
    .getByRole("button", { name: rowAction(lang, "design.workshops.open", "Synthetic TOM workshop") })
    .click();
  const mode = page.locator("[data-workshop]");
  await expect(mode.locator("[data-unresolved='1']")).toBeVisible();
  await mode
    .getByRole("button", {
      name: rowAction(lang, "design.workshops.convert", "Synthetic: who owns billing exceptions?"),
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tr(lang, "design.workshops.convert"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mode.locator("[data-unresolved='0']")).toBeVisible();
  await expect(mode).toContainText(tr(lang, "design.workshops.convertedToDecision"));
  await mode.scrollIntoViewIfNeeded();
  await shot(page, lang, "p2-09-workshop-mode");
  await expectAccessible(page, lang, "p2-workshop-mode");

  // The converted item is a T04 design decision D-01, status Open, read through GET /decisions?kind=design.
  await page
    .getByRole("navigation", { name: tr(lang, "transformations.tabs.label"), exact: true })
    .getByRole("link", { name: tr(lang, "transformations.tabs.decisions"), exact: true })
    .click();
  const log = section(page, lang, "decisions.log");
  const row = log.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "D-01", exact: true }) });
  await expect(row).toContainText("Synthetic: who owns billing exceptions?");
  await expect(row).toContainText(tr(lang, "common.recordStatus.open"));
  // The T04 log is read from the canonical decision register with kind=design.
  expect(urls.some((u) => u.includes("/api/v1/decisions?") && u.includes("kind=design"))).toBe(true);
  await shot(page, lang, "p2-10-decisions");
  await expectAccessible(page, lang, "p2-decisions");
  expect(foreign).toEqual([]);
});

test("Evidence: note, filename reference and file upload; a link; review by another person", async ({
  page,
  browser,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("evidence"));
  const reg = section(page, lang, "evidence.register");
  const dialog = page.getByRole("dialog");
  // A note.
  await reg.getByRole("button", { name: tr(lang, "evidence.addKind.note"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "evidence.field.title")).fill("Synthetic interview note");
  await dialog
    .getByLabel(fieldLabel(lang, "evidence.field.noteBody"))
    .fill("Synthetic: agents re-key 30 invoices a day.");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // A bare filename: never verifiable.
  await reg.getByRole("button", { name: tr(lang, "evidence.addKind.file_reference"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "evidence.field.title")).fill("Synthetic filename only");
  await dialog.getByLabel(fieldLabel(lang, "evidence.field.fileName")).fill("billing-extract.xlsx");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // A file: create, then upload a revision (octet-stream, percent-encoded name, If-Match).
  await reg.getByRole("button", { name: tr(lang, "evidence.addKind.file"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "evidence.field.title")).fill("Synthetic billing extract");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "evidence.upload.title", { title: "Synthetic billing extract" }) }),
  ).toBeVisible();
  const upload = page.waitForRequest((r) => r.url().endsWith("/content") && r.method() === "POST");
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "مستخرج اصطناعي.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic,rows\n1,2\n"),
  });
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  const sent = await upload;
  expect(sent.headers()["content-type"]).toBe("application/octet-stream");
  expect(sent.headers()["x-file-name"]).toBe(encodeURIComponent("مستخرج اصطناعي.csv"));
  await expect(dialog).toHaveCount(0);
  await expect(
    reg.getByRole("link", { name: rowAction(lang, "evidence.download", "Synthetic billing extract") }),
  ).toBeVisible();
  // Link the filename reference to the first T01 row: it stays Unverified and is listed so at G1.
  await reg.getByRole("button", { name: rowAction(lang, "evidence.links.add", "Synthetic filename only") }).click();
  await dialog.getByLabel(fieldLabel(lang, "evidence.links.recordType")).selectOption("diagnostic_item");
  await dialog.getByLabel(fieldLabel(lang, "evidence.links.record")).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: tr(lang, "evidence.links.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reg.locator("[data-evidence-state='unverified']")).toHaveCount(3);
  // The creator is never offered the review of their own evidence.
  await expect(
    reg.getByRole("button", { name: rowAction(lang, "evidence.review.action", "Synthetic interview note") }),
  ).toHaveCount(0);
  await shot(page, lang, "p2-11-evidence");
  await expectAccessible(page, lang, "p2-evidence");

  // The Transformation Office reviews the note: verified, accessible.
  const office = await asUser(browser, lang, "dev.office");
  await office.page.goto(ws("evidence"));
  const reg2 = section(office.page, lang, "evidence.register");
  await reg2
    .getByRole("button", { name: rowAction(lang, "evidence.review.action", "Synthetic interview note") })
    .click();
  const d2 = office.page.getByRole("dialog");
  await d2.getByRole("radio", { name: tr(lang, "evidence.review.state.verified"), exact: true }).check();
  await d2.getByRole("radio", { name: tr(lang, "evidence.accessibility.accessible"), exact: true }).check();
  await d2.getByLabel(fieldLabel(lang, "evidence.review.note")).fill("Synthetic: read and checked.");
  await d2.getByRole("button", { name: tr(lang, "evidence.review.record"), exact: true }).click();
  await expect(d2).toHaveCount(0);
  await expect(reg2.locator("[data-evidence-state='verified']")).toHaveCount(1);
  // A filename reference cannot be verified: only "Rejected" is offered.
  await reg2
    .getByRole("button", { name: rowAction(lang, "evidence.review.action", "Synthetic filename only") })
    .click();
  await expect(d2.getByRole("radio", { name: tr(lang, "evidence.review.state.verified"), exact: true })).toHaveCount(0);
  await expect(d2.getByRole("radio", { name: tr(lang, "evidence.review.state.rejected"), exact: true })).toBeVisible();
  await d2.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await shot(office.page, lang, "p2-12-evidence-reviewed");
  await expectAccessible(office.page, lang, "p2-evidence-reviewed");
  await office.close();
  expect(foreign).toEqual([]);
});

/** Makes G1 complete through the real API (the UI paths for these records are exercised above). */
async function completeG1(lead: ApiSession, office: ApiSession) {
  const base = `/api/v1/transformations/${tid}`;
  const baseline = await lead.call<{ id: string }>("POST", `${base}/baselines`, {
    metric: "Synthetic billing error rate",
    unit: "%",
    scope: "operational",
    value: "4.25",
    source: "Synthetic billing extract",
    baselineDate: "2026-09-01",
  });
  const note = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
    kind: "note",
    title: "Synthetic baseline working paper",
    ownerUserId: DEV_USERS.lead,
    noteBody: "Synthetic: 4.25% of bills corrected in August.",
  });
  await lead.call("POST", `${base}/evidence-links`, {
    evidenceId: note.id,
    recordType: "baseline",
    recordId: baseline.id,
  });
  await office.call(
    "POST",
    `${base}/evidence/${note.id}/review`,
    { result: "verified", accessibilityStatus: "accessible", note: "Synthetic check" },
    { ifMatch: note.version },
  );
  const items = await lead.call<{ items: { id: string; version: number }[] }>(
    "GET",
    `${base}/diagnostic-items?limit=100`,
  );
  for (const item of items.items)
    await lead.call(
      "PATCH",
      `${base}/diagnostic-items/${item.id}`,
      {
        currentState: "Synthetic current state",
        rootCause: "Synthetic root cause",
        impactText: "Synthetic impact",
        confidence: "M",
        baselineId: baseline.id,
      },
      { ifMatch: item.version },
    );
  const methodology = await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
  await lead.call("POST", `${base}/diagnostic-findings`, {
    workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
    kind: "root_cause",
    statement: "Synthetic: no validation at order entry",
    status: "confirmed",
  });
  const pools = await lead.call<{ items: { id: string; version: number; materiality: string }[] }>(
    "GET",
    `${base}/value-pools?limit=100`,
  );
  for (const p of pools.items.filter((x) => x.materiality === "not_assessed"))
    await lead.call("PATCH", `${base}/value-pools/${p.id}`, { materiality: "material" }, { ifMatch: p.version });
  const charter = await lead.call<{ charter: { version: number } }>("GET", `${base}/charter`);
  await lead.call(
    "PATCH",
    `${base}/charter`,
    {
      executiveSponsorUserId: DEV_USERS.office,
      transformationLeadUserId: DEV_USERS.lead,
      baselineDate: "2026-09-01",
      changeSummary: "Synthetic: sponsor, lead and baseline date",
    },
    { ifMatch: charter.charter.version },
  );
}

test("Gates: G1 shows unverified evidence and offers no submission while incomplete; once complete it is submitted", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("gates"));
  await expect(page.locator("[data-business-approval]")).toContainText(tr(lang, "gates.businessApproval"));
  await expect(page.locator("[data-gate]")).toHaveCount(6);
  await expect(page.locator("main#main")).not.toContainText(/\bDG[0-7]\b/);
  await shot(page, lang, "p2-13-gates");
  await expectAccessible(page, lang, "p2-gates");
  await page.locator("[data-gate='G1']").getByRole("link").click();
  const readiness = section(page, lang, "gates.readinessTitle");
  const diagnostic = readiness.locator("[data-criterion='g1.diagnostic']");
  await expect(diagnostic).toHaveAttribute("data-completeness", "incomplete");
  await expect(diagnostic.getByRole("link", { name: "Synthetic filename only", exact: true })).toBeVisible();
  await expect(diagnostic).toContainText(tr(lang, "gates.unverifiedNote"));
  // Incomplete: submission is not offered (the server's canSubmit is false); the reason is stated.
  const submit = page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true });
  await expect(submit).toBeDisabled();
  // "Submission opens when every mandatory output is complete (N of 6 now)."
  await expect(page.locator("#gate-submit-blocked")).toContainText(
    tr(lang, "gates.submit.blocked").split("(")[0]!.trim(),
  );
  await expect(page.locator("#gate-submit-blocked")).toContainText(/6/);
  await shot(page, lang, "p2-14-gate-incomplete");
  await expectAccessible(page, lang, "p2-gate-incomplete");

  await completeG1(await apiSession(playwright, "dev.lead"), await apiSession(playwright, "dev.office"));
  await page.reload();
  await expect(readiness.locator("[data-criterion][data-completeness='incomplete']")).toHaveCount(0);
  // Complete, yet the filename reference is still listed as unverified evidence (it simply does not count).
  await expect(diagnostic.getByRole("link", { name: "Synthetic filename only", exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill("Synthetic submission for a demo decision");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-gate-status='submitted']").first()).toBeVisible();
  await shot(page, lang, "p2-15-gate-submitted");
  await expectAccessible(page, lang, "p2-gate-submitted");
  expect(foreign).toEqual([]);
});

test("Gates: the approver's decision — 409 when the submission was superseded, then approval with a rationale", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  // A synthetic Executive Sponsor grant for the Transformation Office user on this transformation only (demo data).
  const admin = await apiSession(playwright, "dev.admin");
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic demo approver for the P2 journey",
  });
  const office = await asUser(browser, lang, "dev.office");
  const page = office.page;
  const foreign = trackRequests(page);
  await page.goto(ws("gates/G1"));
  await page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "gates.decision.title", { code: "G1", n: 1 }) }),
  ).toBeVisible();
  // Meanwhile the lead resubmits: submission 1 is superseded by 2.
  const lead = await apiSession(playwright, "dev.lead");
  const gate = await lead.call<{ gate: { version: number } }>("GET", `/api/v1/transformations/${tid}/gates/G1`);
  await lead.call(
    "POST",
    `/api/v1/transformations/${tid}/gates/G1/submissions`,
    { submissionNote: "Synthetic resubmission" },
    { ifMatch: gate.gate.version },
  );
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await dialog
    .getByLabel(fieldLabel(lang, "gates.decision.rationale"))
    .fill("Synthetic demo rationale: case for change evidenced.");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  const conflict = dialog.locator("[data-problem='gate.submission_superseded']");
  await expect(conflict).toHaveAttribute("data-state", "conflict");
  await expect(conflict).toContainText(tr(lang, "problems.gate__submission_superseded"));
  await shot(page, lang, "p2-16-gate-409-superseded");
  await expectAccessible(page, lang, "p2-gate-409");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // Decide the current submission (#2).
  await page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "gates.decision.title", { code: "G1", n: 2 }) }),
  ).toBeVisible();
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await dialog
    .getByLabel(fieldLabel(lang, "gates.decision.rationale"))
    .fill("Synthetic demo rationale: case for change evidenced.");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-gate-status='approved']").first()).toBeVisible();
  // G1 approval advances the phase to Define.
  await expect(page.locator("main#main .page-header__subtitle")).toContainText(
    tr(lang, "transformations.phase.define"),
  );
  await page.getByRole("button", { name: exactly(`${tr(lang, "gates.history.view")} #2`) }).click();
  await expect(page.locator("[data-gate-decision='approved']")).toContainText("Synthetic demo rationale");
  await shot(page, lang, "p2-17-gate-approved");
  await expectAccessible(page, lang, "p2-gate-approved");
  expect(foreign).toEqual([]);
  await office.close();
});

test("read-only auditor (AUD): every P2 screen without write controls; Unknown and Unquantified rendered", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.auditor");
  const writeLabels = [
    "common.action.edit",
    "common.action.create",
    "common.action.archive",
    "kpi.valuePool.add",
    "kpi.baseline.add",
    "kpi.validation.action",
    "diagnose.finding.add",
    "diagnose.output.add",
    "define.charter.edit",
    "define.charter.create",
    "define.northStar.set",
    "define.northStar.refine",
    "define.outcomes.add",
    "kpi.t02.add",
    "kpi.definition.add",
    "define.guardrails.add",
    "design.gaps.add",
    "design.heatmap.add",
    "design.journeys.add",
    "design.workshops.add",
    "decisions.add",
    "gates.submit.action",
    "gates.decision.action",
    "gates.configure.action",
    "evidence.addKind.file",
    "evidence.addKind.note",
    "evidence.review.action",
    "evidence.upload.action",
    "evidence.links.add",
  ].map((k) => tr(lang, k));
  const startsWithWrite = new RegExp(`^\\s*(?:${writeLabels.map(escape).join("|")})(?:\\s*:.*)?\\s*$`);
  for (const tab of ["diagnose", "charter", "define", "design", "decisions", "gates", "evidence"]) {
    await page.goto(ws(tab));
    await expect(page.locator("[data-state='read-only']")).toContainText(tr(lang, "transformations.tabs.readOnly"));
    await expect(page.locator("[data-state='loading']")).toHaveCount(0);
    const enabled = await page
      .locator("main#main button:not([disabled])")
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
    expect(
      enabled.filter((text) => startsWithWrite.test(text)),
      `${tab}: enabled write controls`,
    ).toEqual([]);
    if (tab === "diagnose") {
      const pools = section(page, lang, "kpi.valuePool.title");
      await expect(pools.locator("[data-quantification='unquantified']").first()).toBeVisible();
      await expect(page.locator("[data-health='unknown']").first()).toContainText(tr(lang, "common.value.unknown"));
    }
    await shot(page, lang, `p2-18-aud-${tab}`);
    await expectAccessible(page, lang, `p2-aud-${tab}`);
  }
  expect(foreign).toEqual([]);
});
