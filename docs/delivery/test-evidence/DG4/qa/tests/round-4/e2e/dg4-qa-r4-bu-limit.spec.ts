// qa-verifier DG4 round 4 (T-DG4-REV-QA-R4): a probe of the business-unit chip's 50-transformation limit (ADR-0037 §4,
// T-DG4-FE-G2: useOrgQuery `blocked: "too_many"`) on the REAL stack (e2e/support/qa-stack.sh; no mocks). It explains
// why p4-dashboards.spec.ts test 3 failed in chromium-ar in both full runs (the full suite leaves more than 50
// transformations in SYN_RETAIL) and checks the remedy the note gives: "Narrow the filter by phase or status".
// This file lives OUTSIDE the frozen candidate and is copied into a disposable clone's e2e/ only to run.
//   1. The lead creates transformations in SYN_RETAIL until it holds 51 (API, as every spec does).
//   2. As the transformation office (dev.office), /executive-overview with the business-unit chip: the too_many note.
//   3. Then the phase chip, then the status chip, as the note advises: is the note gone and the overview requested?
// Each observation is recorded; the test asserts the note's advice literally (it fails if the advice cannot work).
// Revision 2 (after try 1): try 1 chose the first phase and status ('diagnose', 'draft'), which every new
// transformation has, so it could not tell a working remedy from a broken one. Now phase 'realize' and the LAST status
// option are chosen: no transformation of the unit is in Realize, so a remedy that narrowed by phase would leave at
// most 50 (here none) and lift the block.
// SYNTHETIC data; no product gate (G1-G6) is decided, and none implies an engineering gate (DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");
const stamp = Date.now().toString(36);

test("BU chip with 51 transformations: the too_many note, then phase / status as the note advises", async ({ page, playwright }, info) => {
  test.setTimeout(5 * 60_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const list = await lead.call<{ items: { id: string }[]; nextCursor: string | null }>(
    "GET",
    `/api/v1/transformations?businessUnitId=${SYN_RETAIL}&limit=51`,
  );
  let have = list.items.length;
  for (let n = 0; have < 51; n++, have++)
    await lead.call("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA R4 BU limit ${lang} ${stamp} ${n}`,
      mode: "end_to_end",
    });
  const obs: Record<string, unknown> = { lang, transformationsInUnitAtLeast: have };
  await signIn(page, lang, "dev.office");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/overview?")) requests.push(r.url().replace(/^https?:\/\/[^/]+/, ""));
  });
  await page.goto("/executive-overview");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.locator("[data-filter='bu']").selectOption(SYN_RETAIL);
  const note = page.locator("[data-filter-blocked='too_many']");
  await expect(note).toBeVisible();
  obs["noteText"] = (await note.innerText()).trim();
  const before = requests.length;
  // The note's advice: narrow by phase.
  const phase = page.locator("[data-filter='phase']");
  const phaseOptions = await phase.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  await phase.selectOption("realize");
  await page.waitForTimeout(1500);
  obs["phaseOptions"] = phaseOptions;
  obs["afterPhase_noteVisible"] = await note.isVisible();
  obs["afterPhase_overviewRequestsWithUnit"] = requests.slice(before).filter((u) => u.includes("transformationId=")).length;
  // And by status.
  const status = page.locator("[data-filter='status']");
  const statusOptions = await status.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  obs["statusOptions"] = statusOptions;
  await status.selectOption(statusOptions[statusOptions.length - 1]!);
  await page.waitForTimeout(1500);
  obs["afterStatus_noteVisible"] = await note.isVisible();
  obs["afterStatus_overviewRequestsWithUnit"] = requests.slice(before).filter((u) => u.includes("transformationId=")).length;
  obs["url"] = page.url().replace(/^https?:\/\/[^/]+/, "");
  mkdirSync(join(OUT, "screens", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "screens", lang, "R4-bu-limit-after-phase-status.png"), fullPage: true });
  writeFileSync(join(OUT, `dg4-qa-r4-bu-limit-${lang}.json`), `${JSON.stringify(obs, null, 2)}\n`);
  console.log(`QA-BU-LIMIT ${JSON.stringify(obs)}`);
  // The advice, literally: after narrowing by phase and status the note is gone (the dashboard can be read).
  expect(obs["afterStatus_noteVisible"], JSON.stringify(obs)).toBe(false);
});
