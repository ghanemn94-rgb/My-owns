// Playbook Studio against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-B; REQ-S06-007, REQ-PB-093,
// REQ-S06-010, REQ-S02-001): the draft → preview and test → review → publish path through the UI, with the methodology
// administrator (a SYNTHETIC ADM_METHOD grant to the seeded `dev.nobody`, made through the access API by `dev.admin` and
// REVOKED at the end of each test, because journeys.spec.ts relies on `dev.nobody` having no role) and the Transformation
// Office as the configured reviewer.
// The journey publishes a T06 scoring-defaults version that changes one rubric descriptor only (the weights stay
// 25/25/20/15/15), so the specs that run after it in the same stack are unaffected. It does NOT publish a methodology
// version: a transformation pinned to a methodology version other than the seeded v1 gets empty DG2 catalogues
// (methodology/repository.ts loadMethodologyCatalogue reads the catalogue rows of the pinned version only), which breaks
// later specs; that backend defect is reported in the FE-B handback. Every screen is checked with axe (no serious
// or critical violation) and captured in EN and AR. A configuration review is not a business approval, and nothing
// here touches the engineering delivery gates DG0-DG7.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";

interface Version {
  id: string;
  configKind: string;
  status: string;
  draftStage: string | null;
  isNewestPublished: boolean;
  version: number;
}

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

/** A SYNTHETIC ADM_METHOD grant for dev.nobody; returns the revoke to call in `finally`. */
async function grantMethodologyAdmin(admin: ApiSession): Promise<() => Promise<void>> {
  type Assignment = { id: string; roleCode: string; revokedAt: string | null; version: number };
  const active = async () =>
    (
      await admin.call<{ items: Assignment[] }>(
        "GET",
        `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`,
      )
    ).items.filter((a) => a.roleCode === "ADM_METHOD" && a.revokedAt === null);
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: ORG },
      reason: "Synthetic methodology administrator for the Studio journey",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic Studio journey" },
        { ifMatch: a.version },
      );
  };
}

/** Discards an open scoring-defaults draft left by an earlier, failed run (one open draft per kind and key). */
async function discardOpenDrafts(adm: ApiSession): Promise<void> {
  const drafts = await adm.call<{ items: Version[] }>(
    "GET",
    "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=draft",
  );
  for (const d of drafts.items)
    if (d.draftStage === "editing" || d.draftStage === "preview")
      await adm.call("POST", `/api/v1/admin/methodology-versions/${d.id}/discard`, undefined, { ifMatch: d.version });
}

const checkOf = (page: Page, kind: string) => page.locator(`[data-check-kind='${kind}'] [data-check]`);

test("Studio: the methodology administrator drafts T06 scoring defaults, previews and tests, the Transformation Office reviews, the administrator publishes", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    const adm = await apiSession(playwright, "dev.nobody");
    await discardOpenDrafts(adm);
    const published = await adm.call<{ items: Version[] }>(
      "GET",
      "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published",
    );
    const base = published.items.find((v) => v.isNewestPublished)!;
    expect(base, "a published scoring-defaults version").toBeTruthy();

    // 1. Studio home: the versions, their states, and "New draft" for the methodology administrator.
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/studio");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.studio.title"));
    await expect(page.locator("[data-version-state='newest_published']").first()).toHaveText(
      tr(lang, "studio.state.newest_published"),
    );
    await expectAccessible(page, lang, "p5-studio-home");
    await shot(page, lang, "p5-studio-home");

    // 2. A new draft copied from the newest published scoring defaults.
    await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
    const create = page.getByRole("dialog");
    await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(base.id);
    await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill("Synthetic: Feasibility descriptor");
    await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
    const versionUrl = new URL(page.url()).pathname;
    await expect(page.locator("main [data-version-state='editing']")).toHaveText(tr(lang, "studio.state.editing"));
    await expect(page.locator("main [data-state='draft']")).toHaveText(tr(lang, "studio.version.draftNote"));

    // 3. The T06 editor: weights unchanged (total 100.00), the Feasibility score-1 descriptor edited; saved as a draft.
    await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "studio.defaults.title"));
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "100.00");
    const descriptor = page.getByLabel(
      tr(lang, "studio.defaults.descriptorLabel", {
        criterion: tr(lang, "studio.criterion.feasibility"),
        score: 1,
        language: tr(lang, "common.language.name.en"),
      }),
      { exact: true },
    );
    await descriptor.fill(`Synthetic (${lang}, ${Date.now()}): needs capabilities the organization does not have`);
    await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
    await expect(page.locator("[data-state='saved-draft']")).toHaveText(tr(lang, "studio.defaults.savedDraft"));
    await expectAccessible(page, lang, "p5-scoring-defaults-draft");
    await shot(page, lang, "p5-scoring-defaults-draft");

    // 4. Back on the version: the diff lists the change; preview and compatibility on the current content.
    await page.goto(versionUrl);
    await expect(page.locator("[data-table='diff']")).toContainText(`Synthetic (${lang}, `);
    for (const kind of ["preview", "compatibility"]) {
      await page.locator(`[data-run-check='${kind}']`).click();
      await expect(checkOf(page, kind)).toHaveAttribute("data-check", /^(pass|warn)$/);
    }
    await expectAccessible(page, lang, "p5-studio-draft");
    await shot(page, lang, "p5-studio-draft");

    // 5. Submit for review (scoring defaults require one; the reviewer role is TO).
    await page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
    const submit = page.getByRole("dialog");
    await submit.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic: please review the Feasibility descriptor");
    await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
    await expect(submit).toHaveCount(0);
    await expect(page.locator("main [data-version-state='review']")).toHaveText(tr(lang, "studio.state.review"));
    // The requester cannot decide its own review: the decision action is not offered to the administrator.
    await page.locator("[data-state='pending-review']").getByRole("link").click();
    await expect(page.locator("main#main h1")).toContainText(tr(lang, "studio.review.heading", { title: "" }).trim());
    await expect(page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true })).toHaveCount(0);
    const reviewUrl = new URL(page.url()).pathname;

    // 6. The Transformation Office approves the configuration review.
    const office = await asUser(browser, lang, "dev.office");
    await office.page.goto(reviewUrl);
    await office.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
    const decide = office.page.getByRole("dialog");
    await decide.getByLabel(fieldLabel(lang, "studio.review.outcome")).selectOption("approve");
    await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic: the descriptor is clearer");
    await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
    await expect(decide).toHaveCount(0);
    await expect(office.page.locator("[data-review-status]")).toHaveText(tr(lang, "studio.reviewStatus.approved"));
    await expectAccessible(office.page, lang, "p5-studio-review");
    await shot(office.page, lang, "p5-studio-review");
    await office.close();

    // 7. The administrator publishes: an immutable, current version; no edit action remains.
    await page.goto(versionUrl);
    await expect(page.locator("main [data-version-state='approved']")).toHaveText(tr(lang, "studio.state.approved"));
    await page.locator("[data-action='publish']").click();
    await expect(page.locator("main [data-version-state='newest_published']")).toHaveText(
      tr(lang, "studio.state.newest_published"),
    );
    await expect(page.locator("main [data-state='immutable']")).toHaveText(tr(lang, "studio.version.immutable"));
    await expect(page.locator("[data-action='publish']")).toHaveCount(0);
    await expectAccessible(page, lang, "p5-studio-published");
    await shot(page, lang, "p5-studio-published");
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  } finally {
    await revoke();
  }
});

test("Studio: scoring defaults, source coverage, review policies and migrations are readable; the auditor sees no write action", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/studio/scoring-defaults");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "studio.defaults.title"));
    await expect(page.locator("[data-weight-total]")).toBeVisible();
    await expectAccessible(page, lang, "p5-scoring-defaults");
    await shot(page, lang, "p5-scoring-defaults");

    await page.goto("/admin/source-coverage");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.sourceCoverage.title"));
    const sets = page.locator("[data-table='coverage'] tbody tr");
    await expect(sets).toHaveCount(10);
    await expect(page.locator("[data-set='phase'] [data-expected]")).toHaveText("6");
    await expect(page.locator("[data-set='template'] [data-expected]")).toHaveText("16");
    await expect(page.locator("[data-set='health_question'] [data-expected]")).toHaveText("25");
    // The newest published version is immutable: the check runs on drafts (from the version page), not here.
    await expect(page.locator("[data-action='run-coverage']")).toHaveCount(0);
    await expect(page.getByText(tr(lang, "studio.coverage.runDraftOnly"), { exact: true })).toBeVisible();
    await expectAccessible(page, lang, "p5-source-coverage");
    await shot(page, lang, "p5-source-coverage");

    await page.goto("/admin/methodology-migrations");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.methodologyMigrations.title"));
    await expectAccessible(page, lang, "p5-migrations-entry");
    await shot(page, lang, "p5-migrations-entry");

    // The auditor: read-only views, no write action.
    const ctx = await page
      .context()
      .browser()!
      .newContext({ locale: lang === "ar" ? "ar-SA" : "en-US" });
    const aud = await ctx.newPage();
    await signIn(aud, lang, "dev.auditor");
    await aud.goto("/admin/studio");
    await expect(aud.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.studio.title"));
    await expect(aud.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true })).toHaveCount(0);
    await expect(aud.getByText(tr(lang, "studio.readOnly"), { exact: true })).toBeVisible();
    await aud.goto("/admin/studio/review-policies");
    await expect(aud.locator("[data-table='policies'] tbody tr").first()).toBeVisible();
    await expect(aud.getByRole("button", { name: new RegExp(`^${tr(lang, "studio.policies.edit")}`) })).toHaveCount(0);
    await expectAccessible(aud, lang, "p5-review-policies-auditor");
    await shot(aud, lang, "p5-review-policies-auditor");
    await ctx.close();
    expect(foreign).toEqual([]);
  } finally {
    await revoke();
  }
});
