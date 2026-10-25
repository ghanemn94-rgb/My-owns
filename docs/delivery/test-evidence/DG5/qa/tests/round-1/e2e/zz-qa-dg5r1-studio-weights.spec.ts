// qa-verifier DG5 round 1 (T-DG5-RG2-QA-R1) probe for REQ-PB-093, tested literally IN THE UI (the register note says
// the exact 30/20/20/15/15 browser path is not driven end to end by the candidate's own specs):
//   "an admin changes the default Feasibility rubric text and the default weights to 30/20/20/15/15 in the UI and
//    publishes without a code change; a transformation created afterwards starts with the new default; an existing
//    transformation keeps its weight set and rubric version; publishing defaults that total 95% is rejected".
// Runs on apps/web/e2e/support/with-stack.sh in a DISPOSABLE clone only (copied to e2e/ there). All data SYNTHETIC; the
// configuration review is a synthetic in-product action that approves nothing real. No engineering gate is named.
import { expect as baseExpect, test, type Page } from "@playwright/test";
// The three reviews run at once (load 10-15 on 4 cores): locator assertions wait up to 20 s, not 5 s.
const expect = baseExpect.configure({ timeout: 20_000 });
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
const V = "/api/v1/admin/methodology-versions";
const CRIT = ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"] as const;

async function methodologyAdmin(admin: ApiSession, lang: Lang): Promise<string> {
  const username = `qa.r1.pb093.adm.${lang}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic QA-R1 methodology admin ${lang}`,
    preferredLocale: lang,
    identity: { issuer: "urn:mth:dev-local", subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: ORG },
    reason: "Synthetic methodology administrator for a QA probe (approves nothing real)",
  });
  return username;
}
const newTx = async (lead: ApiSession, name: string) =>
  (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" }))
    .id;
const newestDefaults = async (s: ApiSession) =>
  (await s.call<{ items: Body[] }>("GET", `${V}?kind=scoring_defaults&status=published`)).items.find(
    (v) => v.key === "scoring-defaults" && v.isNewestPublished,
  );

/** Studio home -> New draft from `baseId` (UI). */
async function draftInUi(page: Page, lang: Lang, baseId: string, summary: string): Promise<string> {
  await page.goto("/admin/studio");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(baseId);
  await d.getByLabel(tr(lang, "studio.field.changeSummary")).fill(summary);
  await d.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Scoring defaults screen of the draft: type the weights and the Feasibility level texts, Save (UI). */
async function editDefaults(page: Page, lang: Lang, id: string, w: string[], feas: string | null) {
  await page.goto(`/admin/studio/scoring-defaults?versionId=${id}`);
  for (const [i, c] of CRIT.entries()) await page.locator(`input[data-weight='${c}']`).fill(w[i]!);
  if (feas !== null)
    for (let s = 1; s <= 5; s++) {
      const label = tr(lang, "studio.defaults.descriptorLabel", {
        criterion: tr(lang, "studio.criterion.feasibility"),
        score: s,
        language: tr(lang, "common.language.name.en"),
      });
      await page.getByLabel(label, { exact: true }).fill(`${feas} ${s}`);
    }
  await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
}

/** Version page: run the checks (waits for each verdict), submit for review, the office approves, publish (all UI).
 * Returns the checks' verdicts and the alert texts shown after the publish click. */
async function publishInUi(page: Page, lang: Lang, id: string, browser: Parameters<typeof asUser>[0]) {
  await page.goto(`/admin/studio/versions/${id}`);
  await expect(page.locator("[data-table='checks']")).toBeVisible();
  await expect(page.locator("[data-action='publish']")).toBeVisible();
  const verdicts: Record<string, string | null> = {};
  for (const kind of ["preview", "compatibility"]) {
    const b = page.locator(`[data-run-check='${kind}']`);
    await expect(b).toBeVisible();
    await b.click();
    const cell = page.locator(`[data-check-kind='${kind}'] [data-check]`);
    await expect(cell).toHaveAttribute("data-check", /^(pass|warn|fail)$/);
    verdicts[kind] = await cell.getAttribute("data-check");
  }
  const submitBtn = page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true });
  if ((await submitBtn.count()) > 0) {
    await submitBtn.click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic QA-R1 scoring defaults");
    await dlg.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
    await expect(dlg).toHaveCount(0);
    const pending = page.locator("[data-state='pending-review']").getByRole("link");
    if ((await pending.count()) > 0 || (await pending.waitFor({ timeout: 10_000 }).then(() => true, () => false))) {
      await pending.click();
      const reviewUrl = new URL(page.url()).pathname;
      const o = await asUser(browser, lang, "dev.office");
      await o.page.goto(reviewUrl);
      await o.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
      const dec = o.page.getByRole("dialog");
      await dec.getByLabel(fieldLabel(lang, "studio.review.outcome")).selectOption("approve");
      await dec.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic: approved");
      await dec.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
      await expect(o.page.locator("[data-review-status]")).toHaveText(tr(lang, "studio.reviewStatus.approved"));
      await o.close();
    }
    await page.goto(`/admin/studio/versions/${id}`);
    await expect(page.locator("[data-action='publish']")).toBeVisible();
  }
  const before = await page.locator("main [role='alert']").allInnerTexts();
  await page.locator("[data-action='publish']").click();
  await page.waitForTimeout(1500);
  const after = await page.locator("main [role='alert']").allInnerTexts();
  return { verdicts, before, after };
}

test.describe.serial("QA-R1 REQ-PB-093 in the Studio UI", () => {
  test("95% is rejected; 30/20/20/15/15 and a new Feasibility rubric published in the UI reach only new transformations", async ({
    page,
    browser,
    playwright,
  }, info) => {
    test.setTimeout(240_000);
    const lang = langOf(info);
    const admin = await apiSession(playwright, "dev.admin");
    const admName = await methodologyAdmin(admin, lang);
    const adm = await apiSession(playwright, admName);
    const lead = await apiSession(playwright, "dev.lead");
    // Clean-up of a previous attempt: no other open scoring-defaults draft (one open draft per key).
    for (const d of (await adm.call<{ items: Body[] }>("GET", `${V}?kind=scoring_defaults&status=draft`)).items.filter(
      (v) => v.key === "scoring-defaults" && v.draftStage !== "discarded",
    ))
      await adm.call("POST", `${V}/${d.id}/discard`, undefined, { ifMatch: d.version });
    const base = await newestDefaults(adm);
    const txOld = await newTx(lead, `Synthetic QA-R1 PB-093 existing ${lang}`);
    const oldSets = await lead.call<{ items: Body[] }>("GET", `/api/v1/transformations/${txOld}/prioritization/weight-sets`);
    const oldDefaults = await lead.call<Body>("GET", `/api/v1/transformations/${txOld}/scoring-defaults`);
    await signIn(page, lang, admName);

    // (1) 95 % in the UI: refused at save or at publish; never published.
    const d95 = await draftInUi(page, lang, base.id, `Synthetic QA-R1 (${lang}) defaults total 95`);
    await editDefaults(page, lang, d95, ["25", "20", "20", "15", "15"], null);
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", /^95(\.0+)?$/);
    await expect(page.locator("[data-weight-total]")).toContainText(tr(lang, "studio.defaults.totalNot100"));
    await shot(page, lang, "qa-r1-pb093-total-95");
    // In the UI: checks, review submitted and approved by the office, then publish: the refusal is shown.
    const r95 = await publishInUi(page, lang, d95, browser);
    await shot(page, lang, "qa-r1-pb093-95-publish-refused");
    console.info(`QA-R1 PB-093 ${lang} 95%: checks=${JSON.stringify(r95.verdicts)} alerts before publish=${JSON.stringify(r95.before)} after=${JSON.stringify(r95.after)}`);
    const refusal = tr(lang, "problems.config_version__weights_total");
    expect(r95.after.join(" | "), "publish names the 100 % rule").toContain(refusal);
    const v95 = await adm.call<Body>("GET", `${V}/${d95}`);
    expect(v95.status, "the 95% draft is never published").toBe("draft");
    expect((await newestDefaults(adm)).id).toBe(base.id);
    await adm.call("POST", `${V}/${d95}/discard`, undefined, { ifMatch: v95.version });

    // (2) 30/20/20/15/15 and new Feasibility texts in the UI; published in the UI.
    const feas = `Synthetic QA-R1 feasibility ${lang}`;
    const d30 = await draftInUi(page, lang, base.id, `Synthetic QA-R1 (${lang}) defaults 30/20/20/15/15`);
    await editDefaults(page, lang, d30, ["30", "20", "20", "15", "15"], feas);
    await expect(page.locator("[data-state='saved-draft']")).toBeVisible();
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", /^100(\.0+)?$/);
    await expectAccessible(page, lang, "qa-r1-pb093-defaults-30");
    await shot(page, lang, "qa-r1-pb093-defaults-30-saved");
    const r30 = await publishInUi(page, lang, d30, browser);
    console.info(`QA-R1 PB-093 ${lang} 30/20/20/15/15: checks=${JSON.stringify(r30.verdicts)} alerts after=${JSON.stringify(r30.after)}`);
    await expect(page.locator("main [data-version-state='newest_published']")).toHaveText(
      tr(lang, "studio.state.newest_published"),
    );
    await shot(page, lang, "qa-r1-pb093-published");

    // (3) a transformation created afterwards starts with the new default (its T06 weight set v1 and its rubric).
    const txNew = await newTx(lead, `Synthetic QA-R1 PB-093 new ${lang}`);
    const l = await asUser(browser, lang, "dev.lead");
    await l.page.goto(`/transformations/${txNew}/prioritization`);
    const row = l.page.locator("[data-testid='weight-set-history'] tr[data-version='1']");
    await expect(row).toBeVisible();
    const pct = (n: string) => tr(lang, "prioritization.weights.percent", { value: n });
    for (const [c, n] of [
      ["strategic_fit", "30"],
      ["financial_value", "20"],
      ["customer_impact", "20"],
      ["feasibility", "15"],
      ["time_to_value", "15"],
    ] as const)
      await expect(row).toContainText(`${tr(lang, `prioritization.criterion.${c}`)}: ${pct(n)}`);
    await expect(l.page.locator("[data-testid='active-weight-set']")).toContainText(
      tr(lang, "prioritization.weights.basis.studio_default"),
    );
    await expectAccessible(l.page, lang, "qa-r1-pb093-new-tx-weights");
    await shot(l.page, lang, "qa-r1-pb093-new-transformation-weights");
    const newDefaults = await lead.call<Body>("GET", `/api/v1/transformations/${txNew}/scoring-defaults`);
    expect(newDefaults.versionId).toBe(d30);
    const rub = (newDefaults.rubrics as Body[]).find((r) => r.criterionCode === "feasibility");
    expect(rub.levels.map((x: Body) => x.descriptorEn)).toEqual([1, 2, 3, 4, 5].map((s) => `${feas} ${s}`));

    // (4) the existing transformation keeps its weight set (25/25/20/15/15) and its rubric version.
    await l.page.goto(`/transformations/${txOld}/prioritization`);
    const oldRow = l.page.locator("[data-testid='weight-set-history'] tr[data-version='1']");
    // Its weights as recorded BEFORE the publish (25/25/20/15/15 when it predates every probe publish; in the second
    // project the first project's published defaults are already in force when it is created).
    const oldW = (oldSets.items.find((x) => x.versionNo === 1)?.weights ?? []) as Body[];
    expect(oldW.length).toBe(5);
    for (const w of oldW)
      await expect(oldRow).toContainText(
        `${tr(lang, `prioritization.criterion.${w.criterionCode}`)}: ${pct(String(Number(w.weightPercent)))}`,
      );
    console.info(`QA-R1 PB-093 ${lang}: existing transformation's weight set v1 = ${JSON.stringify(oldW.map((w) => [w.criterionCode, w.weightPercent]))}`);
    await shot(l.page, lang, "qa-r1-pb093-existing-transformation-weights");
    await l.close();
    const oldAfter = await lead.call<{ items: Body[] }>("GET", `/api/v1/transformations/${txOld}/prioritization/weight-sets`);
    expect(oldAfter.items).toEqual(oldSets.items);
    const oldDefaultsAfter = await lead.call<Body>("GET", `/api/v1/transformations/${txOld}/scoring-defaults`);
    expect(oldDefaultsAfter.versionId).toBe(oldDefaults.versionId);
    expect(oldDefaultsAfter.rubrics).toEqual(oldDefaults.rubrics);
    console.info(
      `QA-R1 PB-093 ${lang}: base=${base.id} d95=${d95} (draft, discarded) d30=${d30} old pin=${oldDefaults.versionId} new pin=${newDefaults.versionId}`,
    );
  });
});
