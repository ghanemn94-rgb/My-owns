// qa-verifier DG5 clean re-gate round 2 (T-DG5-RG-QA-R2; carried from round 1 as a regression probe) — independent probe of REQ-PB-093 (A06/A07), the clause the
// register notes disclose as only partly covered in the UI: "an admin changes the default Feasibility rubric text and
// the default weights to 30/20/20/15/15 IN THE UI and publishes without a code change; a transformation created
// afterwards starts with the new default; an existing transformation keeps its weight set and rubric version;
// publishing defaults that total 95% is rejected".
//
// Runs against the REAL stack (apps/web/e2e/support/with-stack.sh), copied into the disposable clone's apps/web/e2e/
// for the run only (the candidate is frozen; this file lives under docs/delivery/test-evidence/DG5/qa/tests/round-1/).
// It changes the stack's T06 scoring defaults, so it runs ALONE in its own stack, one project per stack.
// Users: SYNTHETIC dev users. dev.nobody gets a SYNTHETIC ADM_METHOD grant (revoked at the end), dev.office (TO) is the
// configured reviewer, dev.lead creates the transformations through the API. Every step that the clause puts "in the
// UI" is driven through the UI; the API is used only to create the transformations and to READ the result.
// A configuration review is not a business approval; nothing here names or touches DG0-DG7.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
const CRITERIA = ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"] as const;
type Weights = Record<(typeof CRITERIA)[number], string>;
interface Version {
  id: string;
  status: string;
  draftStage: string | null;
  isNewestPublished: boolean;
  version: number;
}
interface Defaults {
  versionId: string;
  weights: { criterionCode: string; weightPercent: string }[];
  rubrics: { criterionCode: string; levels: { score: number; descriptorEn: string; descriptorAr: string }[] }[];
}

async function grantMethodologyAdmin(admin: ApiSession): Promise<() => Promise<void>> {
  type A = { id: string; roleCode: string; revokedAt: string | null; version: number };
  const active = async () =>
    (await admin.call<{ items: A[] }>("GET", `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`)).items.filter(
      (a) => a.roleCode === "ADM_METHOD" && a.revokedAt === null,
    );
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: ORG },
      reason: "Synthetic methodology administrator for the qa PB-093 probe",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic qa PB-093 probe" },
        { ifMatch: a.version },
      );
  };
}

const pct = (d: Defaults) =>
  Object.fromEntries(d.weights.map((w) => [w.criterionCode, w.weightPercent.replace(/\.0+$/, "")]));

async function asUser(browser: Browser, lang: Lang, username: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const p = await ctx.newPage();
  await signIn(p, lang, username);
  return p;
}

/** Studio home -> New draft from the newest published scoring defaults -> the T06 editor. Returns the version path. */
async function newDraftInUi(page: Page, lang: Lang, baseId: string, summary: string): Promise<string> {
  await page.goto("/admin/studio");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(baseId);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill(summary);
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const versionPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "studio.defaults.title"));
  return versionPath;
}

async function typeWeights(page: Page, w: Weights) {
  for (const c of CRITERIA) await page.locator(`input[data-weight='${c}']`).fill(w[c]);
}

/** Version page: preview + compatibility, submit for review; TO approves in its own browser; back to the version. */
async function reviewInUi(page: Page, browser: Browser, lang: Lang, versionPath: string, note: string) {
  await page.goto(versionPath);
  for (const kind of ["preview", "compatibility"]) {
    await page.locator(`[data-run-check='${kind}']`).click();
    await expect(page.locator(`[data-check-kind='${kind}'] [data-check]`)).toHaveAttribute("data-check", /^(pass|warn|fail)$/);
  }
  await page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  const submit = page.getByRole("dialog");
  await submit.getByLabel(tr(lang, "studio.review.note")).fill(note);
  await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  await expect(submit).toHaveCount(0);
  await page.locator("[data-state='pending-review']").getByRole("link").click();
  const reviewPath = new URL(page.url()).pathname;
  const office = await asUser(browser, lang, "dev.office");
  await office.goto(reviewPath);
  await office.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
  const decide = office.getByRole("dialog");
  await decide.getByLabel(fieldLabel(lang, "studio.review.outcome")).selectOption("approve");
  await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic qa probe: reviewed");
  await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
  await expect(decide).toHaveCount(0);
  await office.context().close();
  await page.goto(versionPath);
  await expect(page.locator("main [data-version-state='approved']")).toHaveText(tr(lang, "studio.state.approved"));
}

test("QA PB-093: 95 % is refused at publish in the UI; 30/20/20/15/15 + a new Feasibility rubric published in the UI reach only a NEW transformation", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const lead = await apiSession(playwright, "dev.lead");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    const adm = await apiSession(playwright, "dev.nobody");
    const base = (
      await adm.call<{ items: Version[] }>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published")
    ).items.find((v) => v.isNewestPublished)!;
    expect(base, "a published scoring-defaults version").toBeTruthy();

    // 0. An EXISTING transformation, created before any change.
    const txBefore = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic qa PB-093 existing ${lang} ${Date.now()}`,
        mode: "end_to_end",
      })
    ).id;
    const before0 = await lead.call<Defaults>("GET", `/api/v1/transformations/${txBefore}/scoring-defaults`);
    console.info(`QA-PB093 ${lang} existing before: version ${before0.versionId} weights ${JSON.stringify(pct(before0))}`);
    expect(pct(before0)).toMatchObject({ strategic_fit: "25", financial_value: "25", customer_impact: "20", feasibility: "15", time_to_value: "15" });

    await signIn(page, lang, "dev.nobody");

    // 1. NEGATIVE: 25/20/20/15/15 = 95 % typed in the UI; the total shows 95.00 and "not 100"; publish is refused.
    const v95 = await newDraftInUi(page, lang, base.id, "Synthetic qa probe: weights total 95");
    await typeWeights(page, { strategic_fit: "25", financial_value: "20", customer_impact: "20", feasibility: "15", time_to_value: "15" });
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "95.00");
    await expect(page.locator("[data-weight-total]")).toContainText(tr(lang, "studio.defaults.totalNot100"));
    await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
    const saved95 = await page
      .locator("[data-state='saved-draft']")
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    console.info(`QA-PB093 ${lang} 95%: saving the draft ${saved95 ? "succeeded" : "was refused"}`);
    await shot(page, lang, "qa-pb093-95-editor");
    if (saved95) {
      await reviewInUi(page, browser, lang, v95, "Synthetic qa probe: 95 % total");
      await page.locator("[data-action='publish']").click();
      const problem = tr(lang, "problems.config_version__weights_total");
      await expect(page.locator("main")).toContainText(problem);
      await expect(page.locator("main [data-version-state='newest_published']")).toHaveCount(0);
      const after95 = await adm.call<Version>("GET", `/api/v1/admin/methodology-versions/${v95.split("/").pop()}`);
      expect(after95.status).toBe("draft");
      console.info(`QA-PB093 ${lang} 95%: publish refused in the UI with "${problem}", version stays ${after95.status}`);
      await shot(page, lang, "qa-pb093-95-publish-refused");
      await page.getByRole("button", { name: tr(lang, "studio.discard.action"), exact: true }).click();
      // A discarded draft keeps status "draft" with draftStage "discarded" (drafts.ts discardDraft); attempt 1 of this
      // probe polled `status` and failed here by its own error, after the refusal above had already passed.
      await expect
        .poll(async () => (await adm.call<Version>("GET", `/api/v1/admin/methodology-versions/${v95.split("/").pop()}`)).draftStage)
        .toBe("discarded");
    } else {
      // A refusal before publication also satisfies "is rejected"; record the visible reason.
      console.info(`QA-PB093 ${lang} 95%: editor text: ${(await page.locator("main form").innerText()).slice(0, 400)}`);
      await adm.call("POST", `/api/v1/admin/methodology-versions/${v95.split("/").pop()}/discard`, undefined, {
        ifMatch: (await adm.call<Version>("GET", `/api/v1/admin/methodology-versions/${v95.split("/").pop()}`)).version,
      });
    }
    const still = (
      await adm.call<{ items: Version[] }>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published")
    ).items.find((v) => v.isNewestPublished)!;
    expect(still.id, "the 95 % draft never became the newest published defaults").toBe(base.id);

    // 2. POSITIVE: 30/20/20/15/15 and a new Feasibility rubric text (score 1, en and ar), all typed in the UI.
    const vNew = await newDraftInUi(page, lang, base.id, "Synthetic qa probe: weights 30/20/20/15/15");
    await typeWeights(page, { strategic_fit: "30", financial_value: "20", customer_impact: "20", feasibility: "15", time_to_value: "15" });
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "100.00");
    const stamp = Date.now();
    const feasEn = `Synthetic qa PB-093 feasibility rubric ${lang} ${stamp}`;
    const feasAr = `قابلية تنفيذ تجريبية للفحص ${stamp}`;
    for (const [l, text] of [["en", feasEn], ["ar", feasAr]] as const)
      await page
        .getByLabel(
          tr(lang, "studio.defaults.descriptorLabel", {
            criterion: tr(lang, "studio.criterion.feasibility"),
            score: 1,
            language: tr(lang, `common.language.name.${l}`),
          }),
          { exact: true },
        )
        .fill(text);
    await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
    await expect(page.locator("[data-state='saved-draft']")).toHaveText(tr(lang, "studio.defaults.savedDraft"));
    await expectAccessible(page, lang, "qa-pb093-editor-30");
    await shot(page, lang, "qa-pb093-editor-30");
    await page.goto(vNew);
    await expect(page.locator("[data-table='diff']")).toContainText(feasEn);
    await reviewInUi(page, browser, lang, vNew, "Synthetic qa probe: 30/20/20/15/15");
    await page.locator("[data-action='publish']").click();
    await expect(page.locator("main [data-version-state='newest_published']")).toHaveText(tr(lang, "studio.state.newest_published"));
    await shot(page, lang, "qa-pb093-published-30");
    const newId = vNew.split("/").pop()!;

    // 3. A transformation created AFTERWARDS starts with the new default; the existing one keeps its own.
    const txAfter = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic qa PB-093 new ${lang} ${stamp}`,
        mode: "end_to_end",
      })
    ).id;
    const after = await lead.call<Defaults>("GET", `/api/v1/transformations/${txAfter}/scoring-defaults`);
    const before = await lead.call<Defaults>("GET", `/api/v1/transformations/${txBefore}/scoring-defaults`);
    const feasRubric = (d: Defaults) => d.rubrics.find((r) => r.criterionCode === "feasibility")!.levels.find((x) => x.score === 1)!;
    console.info(
      `QA-PB093 ${lang} new: version ${after.versionId} (published ${newId}) weights ${JSON.stringify(pct(after))} feasibility-1 ${JSON.stringify(feasRubric(after))}`,
    );
    console.info(
      `QA-PB093 ${lang} existing after: version ${before.versionId} (base ${base.id}) weights ${JSON.stringify(pct(before))} feasibility-1 ${JSON.stringify(feasRubric(before))}`,
    );
    expect(after.versionId).toBe(newId);
    expect(pct(after)).toEqual({ strategic_fit: "30", financial_value: "20", customer_impact: "20", feasibility: "15", time_to_value: "15" });
    expect(feasRubric(after)).toMatchObject({ descriptorEn: feasEn, descriptorAr: feasAr });
    expect(before.versionId).toBe(base.id);
    expect(pct(before)).toEqual(pct(before0));
    expect(feasRubric(before)).toEqual(feasRubric(before0));
    expect(foreign).toEqual([]);
  } finally {
    await revoke();
  }
});
