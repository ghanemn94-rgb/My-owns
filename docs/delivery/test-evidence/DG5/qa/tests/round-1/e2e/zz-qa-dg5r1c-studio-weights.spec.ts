// qa-verifier DG5 round 1 (T-DG5-REV-QA-R1C) independent probe on the PRODUCTION-initialized stack
// (apps/web/e2e/support/with-stack.sh). NOT part of the candidate: copied into a disposable clone's e2e/ for the run.
// P-PB-093 (literal acceptance, in the UI): "an admin changes the default Feasibility rubric text and the default weights
// to 30/20/20/15/15 in the UI and publishes without a code change; a transformation created afterwards starts with the
// new default; an existing transformation keeps its weight set and rubric version; publishing defaults that total 95% is
// rejected". The register notes disclose that the exact 30/20/20/15/15 browser path is not driven end to end.
// It PUBLISHES new scoring defaults, so it runs in its own stack. SYNTHETIC users and data; approves nothing real.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiSession, fieldLabel, langOf, shot, signIn, tr, SYN_RETAIL, type ApiSession, type Lang } from "../apps/web/e2e/support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
test.setTimeout(300_000);

const ERR = {
  en: "Default weights must total exactly 100% over 2 to 6 criteria.",
  ar: "يجب أن يبلغ مجموع الأوزان الافتراضية 100% بالضبط، موزّعة على ما بين 2 و6 من المعايير.",
};

async function asUser(browser: Browser, lang: Lang, username: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

async function grantAdmMethod(admin: ApiSession): Promise<void> {
  const list = await admin.call<{ items: Body[] }>("GET", `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`);
  if (!list.items.some((a) => a.roleCode === "ADM_METHOD" && a.revokedAt === null))
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: ORG },
      reason: "Synthetic methodology administrator for the QA R1C probe",
    });
}

const pct = (b: Body) =>
  Object.fromEntries((b.weights as Body[]).map((x) => [x.criterionCode, String(x.weightPercent).replace(/\.0+$/, "")]));

/** Draft from the newest published defaults, weights and the Feasibility en descriptor 1 edited in the UI, saved. */
async function draftInUi(page: Page, lang: Lang, adm: ApiSession, weights: string[], descriptor: string): Promise<string> {
  const published = await adm.call<{ items: Body[] }>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published");
  const base = published.items.find((v) => v.isNewestPublished)!;
  await page.goto("/admin/studio");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(base.id);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill(`Synthetic R1C: ${weights.join("/")}`);
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const versionUrl = new URL(page.url()).pathname;
  await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
  const crit = ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value", "risk_compliance"];
  for (const [i, c] of crit.entries()) await page.locator(`[data-weight='${c}']`).fill(weights[i] ?? "");
  await page
    .getByLabel(
      tr(lang, "studio.defaults.descriptorLabel", {
        criterion: tr(lang, "studio.criterion.feasibility"),
        score: 1,
        language: tr(lang, "common.language.name.en"),
      }),
      { exact: true },
    )
    .fill(descriptor);
  await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
  return versionUrl;
}

/** Preview + compatibility, submit for review (UI), TO approves (UI); returns to the version page. */
async function reviewInUi(page: Page, browser: Browser, lang: Lang, versionUrl: string): Promise<void> {
  await page.goto(versionUrl);
  for (const kind of ["preview", "compatibility"]) {
    await page.locator(`[data-run-check='${kind}']`).click();
    await expect(page.locator(`[data-check-kind='${kind}'] [data-check]`)).toHaveAttribute("data-check", /^(pass|warn|fail)$/);
  }
  await page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  const submit = page.getByRole("dialog");
  await submit.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic R1C review request");
  await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  await expect(submit).toHaveCount(0);
  await page.locator("[data-state='pending-review']").getByRole("link").click();
  const reviewUrl = new URL(page.url()).pathname;
  const office = await asUser(browser, lang, "dev.office");
  await office.page.goto(reviewUrl);
  await office.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
  const decide = office.page.getByRole("dialog");
  await decide.getByLabel(fieldLabel(lang, "studio.review.outcome")).selectOption("approve");
  await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic R1C approval of a configuration review");
  await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
  await expect(decide).toHaveCount(0);
  await office.close();
  await page.goto(versionUrl);
}

test("P-PB-093: weights 30/20/20/15/15 and a Feasibility rubric text changed and published in the Studio UI; 95% refused", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  await grantAdmMethod(admin);
  const adm = await apiSession(playwright, "dev.nobody");
  const lead = await apiSession(playwright, "dev.lead");
  const before = await lead.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic R1C before new defaults ${lang}`,
    mode: "end_to_end",
  });
  const beforeDefaults = await lead.call<Body>("GET", `/api/v1/transformations/${before.id}/scoring-defaults`);
  console.info(`P-PB-093 ${lang}: existing transformation defaults v=${beforeDefaults.versionId} ${JSON.stringify(pct(beforeDefaults))}`);
  await signIn(page, lang, "dev.nobody");

  // (1) 95 %: 25/20/20/15/15 through the UI pipeline; publish must be refused, with the translated reason.
  const u95 = await draftInUi(page, lang, adm, ["25", "20", "20", "15", "15", ""], `Synthetic R1C 95 ${lang}`);
  await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "95.00");
  await shot(page, lang, "r1c-pb093-95-editor");
  await reviewInUi(page, browser, lang, u95);
  // Wait for the version page to show the approved draft (count() does not wait: run 1 of this probe raced here).
  await expect(page.locator("main [data-version-state='approved']")).toHaveText(tr(lang, "studio.state.approved"));
  const publish95 = page.locator("[data-action='publish']");
  await expect(publish95).toBeVisible();
  await publish95.click();
  await expect(page.getByText(ERR[lang], { exact: false }).first()).toBeVisible();
  await expect(page.locator("main [data-version-state='newest_published']")).toHaveCount(0);
  await page.getByText(ERR[lang], { exact: false }).first().scrollIntoViewIfNeeded();
  await shot(page, lang, "r1c-pb093-95-refused");
  const v95 = await adm.call<Body>("GET", `/api/v1/admin/methodology-versions/${u95.split("/").pop()}`);
  console.info(`P-PB-093 ${lang}: 95% version after publish attempt: status=${v95.status} stage=${v95.draftStage}`);
  expect(v95.status).not.toBe("published");
  await adm.call("POST", `/api/v1/admin/methodology-versions/${v95.id}/discard`, undefined, { ifMatch: v95.version });

  // (2) 30/20/20/15/15 and a new Feasibility rubric text, published through the UI.
  const text = `Synthetic R1C feasibility ${lang} ${Date.now()}`;
  const u100 = await draftInUi(page, lang, adm, ["30", "20", "20", "15", "15", ""], text);
  await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "100.00");
  await expect(page.locator("[data-state='saved-draft']")).toBeVisible();
  await reviewInUi(page, browser, lang, u100);
  await page.locator("[data-action='publish']").click();
  await expect(page.locator("main [data-version-state='newest_published']")).toHaveText(tr(lang, "studio.state.newest_published"));
  await shot(page, lang, "r1c-pb093-published");
  const newId = u100.split("/").pop()!;

  // (3) a transformation created afterwards starts with the new defaults; the existing one keeps its own.
  const after = await lead.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic R1C after new defaults ${lang}`,
    mode: "end_to_end",
  });
  const a = await lead.call<Body>("GET", `/api/v1/transformations/${after.id}/scoring-defaults`);
  const b = await lead.call<Body>("GET", `/api/v1/transformations/${before.id}/scoring-defaults`);
  console.info(`P-PB-093 ${lang}: after=${a.versionId} ${JSON.stringify(pct(a))}; before=${b.versionId} ${JSON.stringify(pct(b))}`);
  expect(a.versionId).toBe(newId);
  expect(pct(a)).toMatchObject({ strategic_fit: "30", financial_value: "20", customer_impact: "20", feasibility: "15", time_to_value: "15" });
  expect((a.rubrics as Body[]).find((r) => r.criterionCode === "feasibility").levels[0].descriptorEn).toBe(text);
  expect(b.versionId).toBe(beforeDefaults.versionId);
  expect(pct(b)).toEqual(pct(beforeDefaults));
  expect(JSON.stringify(b.rubrics)).toBe(JSON.stringify(beforeDefaults.rubrics));
});
