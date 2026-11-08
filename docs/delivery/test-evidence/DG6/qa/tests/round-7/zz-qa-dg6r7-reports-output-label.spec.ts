// qa-verifier DG6 round 7 (T-DG6-REV-QA-R7) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-reports-output-label.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r7 and QA-R6 -> QA-R7 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R7; copied unchanged from my round-5 probe except names): copied from round-4/zz-qa-dg6r4-reports-output-label.spec.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 (round 5); now dg6r5 -> dg6r7 (round 6) outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as e2e/zz-qa-dg6r7-reports-output-label.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
// Verifies F-DG6-261 (round 3): e2e/a02-demo-users-walkthrough.spec.ts step 10 selected the report output with
//     tlPage.getByLabel(field(lang, "Output")).first().selectOption("charter")
// and, when GET /report-definitions answered late, hit the snapshot list's filter (then also labelled "Output").
// The repair (T-DG6-FE-Z2) has two parts: (a) product: the filter is labelled reportsP5.snapshots.filterOutput
// ("Filter by output"); (b) spec: step 10 scopes the locator to form[data-form='generate-report'], waits for the
// charter option, asserts the value and that Generate is enabled.
// For each language this probe holds GET /report-definitions for 4 s and runs:
//   R  the round-3 reproduction (the OLD spec locator) on THIS candidate          -> expect generate=charter (fixed by a)
//   N  the NEW spec locator sequence                                              -> expect generate=charter, enabled
//   M1 mutant of (a): the filter's label text set back to the catalogue "Output" in the DOM before the definitions
//      arrive, with the NEW spec locator                                          -> expect still charter (b holds alone)
//   M2 the same mutant with the OLD locator (both repairs reverted)              -> expect the round-3 failure (filter)
// SYNTHETIC data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, fieldLabel, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
let tid = "";

// fieldLabel(lang, key) is the same anchored regex as e2e/support/a02-demo.ts field(): ^label(\s*\(required\))?$.
const field = fieldLabel;

test("setup: a fresh synthetic transformation", async ({ playwright }, info) => {
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R4 reports ${langOf(info)} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  tid = t.id;
});

type Variant = "R" | "N" | "M1" | "M2";
async function attempt(page: Page, lang: "en" | "ar", variant: Variant, delayMs: number) {
  await page.unroute("**/report-definitions**").catch(() => undefined);
  if (delayMs > 0)
    await page.route("**/report-definitions**", async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  await page.goto(`/transformations/${tid}/reports`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const filterLabelBefore = (await page.locator("label[for='snapshot-filter-code']").textContent()) ?? null;
  if (variant === "M1" || variant === "M2") {
    // Mutant of repair (a): give the filter back the Generate form's label text.
    await page.evaluate((txt) => {
      const l = document.querySelector("label[for='snapshot-filter-code']");
      if (l) l.textContent = txt;
    }, tr(lang, "reportsP5.generate.output"));
  }
  let error: string | null = null;
  try {
    if (variant === "R" || variant === "M2") {
      await page.getByLabel(field(lang, "reportsP5.generate.output")).first().selectOption("charter", { timeout: 20_000 });
    } else {
      const generate = page.locator("form[data-form='generate-report']");
      const output = generate.getByLabel(field(lang, "reportsP5.generate.output"));
      await expect(output.locator("option[value='charter']")).toHaveCount(1, { timeout: 30_000 });
      await output.selectOption("charter");
      await expect(output).toHaveValue("charter");
    }
  } catch (e) {
    error = String((e as Error).message).split("\n")[0] ?? "error";
  }
  await page.waitForTimeout(delayMs + 1_000);
  const state = await page.evaluate(() => ({
    generate: (document.getElementById("report-definition") as HTMLSelectElement | null)?.value ?? null,
    filter: (document.getElementById("snapshot-filter-code") as HTMLSelectElement | null)?.value ?? null,
  }));
  const submit = page.locator("form[data-form='generate-report']").getByRole("button", { name: tr(lang, "reportsP5.generate.submit") });
  const generateEnabled = (await submit.count()) === 1 ? await submit.isEnabled() : null;
  return { variant, delayMs, filterLabelBefore, ...state, generateEnabled, error };
}

test("F-DG6-261: the step-10 locator under a late report-definitions answer, with mutants", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  const results = [];
  for (const v of ["R", "N", "M1", "M2"] as Variant[]) results.push(await attempt(page, lang, v, 4_000));
  for (const r of results) console.log(`QA-R5 OUTPUT-LABEL ${lang}: ${JSON.stringify(r)}`);
  const by = Object.fromEntries(results.map((r) => [r.variant, r]));
  expect(by["R"]!.filterLabelBefore).toBe(tr(lang, "reportsP5.snapshots.filterOutput"));
  expect(by["R"]).toMatchObject({ generate: "charter", filter: "", generateEnabled: true, error: null });
  expect(by["N"]).toMatchObject({ generate: "charter", filter: "", generateEnabled: true, error: null });
  expect(by["M1"]).toMatchObject({ generate: "charter", filter: "", generateEnabled: true, error: null });
  // M2 is the round-3 defect: the mutant must be caught (the filter gets "charter", Generate stays disabled).
  expect(by["M2"]).toMatchObject({ generate: "", filter: "charter", generateEnabled: false });
});
