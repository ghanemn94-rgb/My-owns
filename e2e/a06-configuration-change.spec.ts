// A06 "Configuration change" (qa-verifier, T-DG5-QA-A). Scenario (master prompt §20 A06): "Admin adds a field, changes
// a form rule and updates a workflow using the UI; a new published version works without application-code changes".
// Concrete check (REQ-S20-006): with no deployment between steps, a record created under the new published version
// stores the added field, the changed rule rejects a value it previously accepted, and the updated workflow routes to
// the new approver; records pinned to the old version are unchanged.
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, ONE API
// process serving the built SPA for the whole run; nothing is rebuilt or restarted between the steps). The methodology
// administrator is a fresh SYNTHETIC user with an organization ADM_METHOD grant made through the access API by
// `dev.admin`; the Transformation Office (`dev.office`) is the configured reviewer. Through the UI:
//   1. the administrator creates a forms draft in Playbook Studio, adds a number field (max 100) to T01 in the form
//      builder, runs preview and compatibility, submits for review; the office approves in the UI; the administrator
//      publishes in the UI;
//   2. on a transformation created AFTER the publish, the Lead enters 80 in the new field of a T01 record (stored);
//      a transformation created BEFORE stays on the old form (no field);
//   3. the administrator changes the rule in the form builder (max 50); after publish, a newer transformation refuses
//      80 (previously accepted) and stores 40; the record pinned to the previous version keeps 80;
//   4. the administrator changes a gate's approver (G3 in EN, G5 in AR: Sponsor -> Business Owner) in the Studio
//      elements editor; after publish, on a NEW transformation that gate's exception is decided by the Business Owner
//      and refused to the Sponsor, while an OLD transformation still routes it to the Sponsor.
// Publishing steps 3 and 4 use the same Studio API operations the UI calls (the UI publish path is exercised in step 1).
// Asserted throughout: <html lang/dir>, axe with 0 serious/critical issues on each screen, no foreign request, no
// engineering-gate name in product text. Screenshots: E2E_SCREENSHOT_DIR/<lang>/a06-*.png.
// A last, separate test checks that a field added to T13 (the form REQ-S06-004 names) can be entered on a stakeholder
// record in the UI.
// All data is SYNTHETIC. The configuration review, the exception decisions and every approval here are synthetic
// in-product actions on test data; they approve nothing real and never touch the engineering delivery gates.
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  apiSession,
  escape,
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
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
const DEV_ISSUER = "urn:mth:dev-local";
const V = "/api/v1/admin/methodology-versions";

interface World {
  adm: ApiSession;
  admUser: string;
  lead: ApiSession;
  office: ApiSession;
  admin: ApiSession;
  key: string;
  key13: string;
  txOld: string;
  txB?: string;
  formsV2?: string;
}
let W: World;

/** A fresh SYNTHETIC methodology administrator (organization ADM_METHOD) with the run's language preference. */
async function methodologyAdmin(admin: ApiSession, lang: Lang): Promise<string> {
  const username = `qa.a06.adm.${lang}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic A06 methodology admin ${lang}`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: ORG },
    reason: "Synthetic methodology administrator for the A06 acceptance test (approves nothing real)",
  });
  return username;
}

async function newTransformation(lead: ApiSession, name: string): Promise<string> {
  return (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name,
      mode: "end_to_end",
    })
  ).id;
}

/** Fills the first T01 diagnostic item so the T01 grid has a record with form tools; returns its id. */
async function t01Record(lead: ApiSession, tx: string): Promise<string> {
  const T = `/api/v1/transformations/${tx}`;
  const items = await lead.call<{ items: { id: string; version: number }[] }>("GET", `${T}/diagnostic-items?limit=100`);
  const first = items.items[0]!;
  await lead.call(
    "PATCH",
    `${T}/diagnostic-items/${first.id}`,
    { currentState: "Synthetic current state", rootCause: "Synthetic root cause", confidence: "M" },
    { ifMatch: first.version },
  );
  return first.id;
}

const newest = async (s: ApiSession, kind: string, key: string) =>
  (await s.call<{ items: Body[] }>("GET", `${V}?kind=${kind}&status=published`)).items.find(
    (v) => v.key === key && v.isNewestPublished,
  );

/** The publish pipeline through the Studio API (the operations the Studio UI calls). */
async function publishThroughApi(adm: ApiSession, office: ApiSession, id: string, kind: string): Promise<void> {
  const ver = async () => (await adm.call<Body>("GET", `${V}/${id}`)).version as number;
  await adm.call("POST", `${V}/${id}/compatibility-checks`, undefined, { ifMatch: await ver() });
  if (kind === "methodology") await adm.call("POST", "/api/v1/admin/source-coverage/runs", { versionId: id });
  await adm.call("POST", `${V}/${id}/preview`, { samples: [] }, { ifMatch: await ver() });
  await adm.call("POST", `${V}/${id}/submit-review`, { note: "Synthetic A06 change" }, { ifMatch: await ver() });
  const review = (await office.call<{ items: Body[] }>("GET", `${V}/${id}/reviews`)).items.find(
    (r) => r.status === "pending",
  );
  await office.call(
    "POST",
    `${V}/${id}/reviews/${review.id}/decision`,
    { outcome: "approve", note: "Synthetic review" },
    { ifMatch: review.version },
  );
  await adm.call("POST", `${V}/${id}/publish`, undefined, { ifMatch: await ver() });
  expect((await adm.call<Body>("GET", `${V}/${id}`)).isNewestPublished).toBe(true);
}

/** Studio home -> "New draft" copied from `baseId`; returns the version page path and the draft id. */
async function newDraftInUi(page: Page, lang: Lang, baseId: string, summary: string) {
  await page.goto("/admin/studio");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.studio.title"));
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(baseId);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill(summary);
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const path = new URL(page.url()).pathname;
  return { path, id: path.split("/").pop()! };
}

/** Opens the T01 form framework of the first filled diagnostic record. */
async function openT01Form(page: Page, tx: string) {
  await page.goto(`/transformations/${tx}/diagnose`);
  const tools = page.locator("#t01 [data-form-tools]").first();
  await tools.click();
  const ff = page.getByRole("dialog").locator("[data-form-framework='T01']");
  await expect(ff).toBeVisible();
  return ff;
}

async function checkPage(page: Page, lang: Lang, name: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await expectAccessible(page, lang, name);
  await shot(page, lang, name);
}

test.describe.serial("A06 configuration change", () => {
  test("an admin adds a field, changes a form rule and a gate approver in the UI; new published versions work at once", async ({
    page,
    browser,
    playwright,
  }, info) => {
    test.setTimeout(300_000);
    const lang = langOf(info);
    const foreign = trackRequests(page);
    const admin = await apiSession(playwright, "dev.admin");
    const admName = await methodologyAdmin(admin, lang);
    const adm = await apiSession(playwright, admName);
    const lead = await apiSession(playwright, "dev.lead");
    const office = await apiSession(playwright, "dev.office");
    W = {
      adm,
      admUser: admName,
      lead,
      office,
      admin,
      key: `qa_readiness_${lang}`,
      key13: `qa_stakeholder_score_${lang}`,
      txOld: await newTransformation(lead, `Synthetic A06 existing ${lang.toUpperCase()}`),
    };
    await t01Record(lead, W.txOld);

    // ---- 1. Studio draft, the new field in the form builder, preview/compatibility, review, publish (all UI)
    await test.step("1. add a T01 field in the form builder and publish through Studio", async () => {
      const base = await newest(adm, "form_schema", "forms");
      expect(base, "a published forms version").toBeTruthy();
      await signIn(page, lang, admName);
      const draft = await newDraftInUi(page, lang, base.id, `Synthetic A06 (${lang}): T01 readiness field`);
      W.formsV2 = draft.id;
      await page.goto("/admin/forms/T01");
      await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draft.id);
      await expect(page.locator("[data-state='editable-draft']")).toBeVisible();
      await page.getByRole("button", { name: tr(lang, "forms.schema.addField"), exact: true }).click();
      const add = page.getByRole("dialog");
      await add.getByLabel(fieldLabel(lang, "forms.schema.fieldKey")).fill(W.key);
      await add.getByLabel(fieldLabel(lang, "forms.schema.fieldType")).selectOption("number");
      await add.getByLabel(fieldLabel(lang, "forms.schema.labelEn")).fill(`Synthetic readiness ${lang}`);
      await add.getByLabel(fieldLabel(lang, "forms.schema.labelAr")).fill(`جاهزية تجريبية ${lang}`);
      await add.getByLabel(fieldLabel(lang, "forms.schema.min")).fill("0");
      await add.getByLabel(fieldLabel(lang, "forms.schema.max")).fill("100");
      await add.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
      await expect(add).toHaveCount(0);
      await expect(page.locator(`[data-field='${W.key}'] [data-protected='false']`)).toBeVisible();
      await checkPage(page, lang, "a06-form-builder-field-added");

      // The same draft also adds a T13 field (checked by the last test).
      await page.goto("/admin/forms/T13");
      await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draft.id);
      await page.getByRole("button", { name: tr(lang, "forms.schema.addField"), exact: true }).click();
      const add13 = page.getByRole("dialog");
      await add13.getByLabel(fieldLabel(lang, "forms.schema.fieldKey")).fill(W.key13);
      await add13.getByLabel(fieldLabel(lang, "forms.schema.fieldType")).selectOption("number");
      await add13.getByLabel(fieldLabel(lang, "forms.schema.labelEn")).fill(`Synthetic stakeholder score ${lang}`);
      await add13.getByLabel(fieldLabel(lang, "forms.schema.labelAr")).fill(`درجة صاحب مصلحة تجريبية ${lang}`);
      await add13.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
      await expect(add13).toHaveCount(0);
      await expect(page.locator(`[data-field='${W.key13}']`)).toBeVisible();

      await page.goto(draft.path);
      await expect(page.locator("[data-table='diff']")).toContainText(W.key);
      for (const kind of ["preview", "compatibility"]) {
        await page.locator(`[data-run-check='${kind}']`).click();
        await expect(page.locator(`[data-check-kind='${kind}'] [data-check]`)).toHaveAttribute(
          "data-check",
          /^(pass|warn)$/,
        );
      }
      await page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
      const submit = page.getByRole("dialog");
      await submit.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic: a T01 readiness field");
      await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
      await expect(submit).toHaveCount(0);
      await expect(page.locator("main [data-version-state='review']")).toHaveText(tr(lang, "studio.state.review"));
      await page.locator("[data-state='pending-review']").getByRole("link").click();
      const reviewUrl = new URL(page.url()).pathname;

      const o = await asUser(browser, lang, "dev.office");
      await o.page.goto(reviewUrl);
      await o.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
      const decide = o.page.getByRole("dialog");
      await decide.getByLabel(fieldLabel(lang, "studio.review.outcome")).selectOption("approve");
      await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic: approved");
      await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
      await expect(o.page.locator("[data-review-status]")).toHaveText(tr(lang, "studio.reviewStatus.approved"));
      await o.close();

      await page.goto(draft.path);
      await page.locator("[data-action='publish']").click();
      await expect(page.locator("main [data-version-state='newest_published']")).toHaveText(
        tr(lang, "studio.state.newest_published"),
      );
      await expect(page.locator("main [data-state='immutable']")).toHaveText(tr(lang, "studio.version.immutable"));
      await checkPage(page, lang, "a06-forms-published");
    });

    // ---- 2. a NEW transformation stores the field; the EXISTING one keeps its form
    await test.step("2. the Lead enters 80 on a new transformation; the existing one has no field", async () => {
      W.txB = await newTransformation(lead, `Synthetic A06 new ${lang.toUpperCase()}`);
      const recB = await t01Record(lead, W.txB);
      const l = await asUser(browser, lang, "dev.lead");
      const ff = await openT01Form(l.page, W.txB);
      const input = ff.locator(`[data-extension-field='${W.key}'] input`);
      await expect(input).toBeVisible();
      await input.fill("80");
      await ff.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true }).click();
      await expect(ff.locator("[data-state='notice']")).toContainText(tr(lang, "forms.edit.saved"));
      await checkPage(l.page, lang, "a06-new-transformation-field-saved");
      const stored = await lead.call<Body>(
        "GET",
        `/api/v1/transformations/${W.txB}/form-records/T01/${recB}/custom-fields`,
      );
      expect([stored.values[W.key], stored.formSchemaVersionId]).toEqual(["80", W.formsV2]);

      const ffOld = await openT01Form(l.page, W.txOld);
      await expect(ffOld.locator(`[data-extension-field='${W.key}']`)).toHaveCount(0);
      await shot(l.page, lang, "a06-existing-transformation-old-form");
      await l.close();
    });

    // ---- 3. the rule changes in the form builder; the new version refuses what the old one accepted
    await test.step("3. max 100 -> 50 in the form builder; 80 refused on a newer transformation, 40 stored", async () => {
      const draft = await newDraftInUi(page, lang, W.formsV2!, `Synthetic A06 (${lang}): readiness max 50`);
      await page.goto("/admin/forms/T01");
      await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draft.id);
      await page
        .locator(`[data-field='${W.key}']`)
        .getByRole("button", { name: new RegExp(`^\\s*${escape(tr(lang, "forms.schema.editField"))}`) })
        .click();
      const edit = page.getByRole("dialog");
      await expect(edit.getByLabel(fieldLabel(lang, "forms.schema.max"))).toHaveValue("100");
      await edit.getByLabel(fieldLabel(lang, "forms.schema.max")).fill("50");
      await edit.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
      await expect(edit).toHaveCount(0);
      await checkPage(page, lang, "a06-form-builder-rule-changed");
      await publishThroughApi(adm, office, draft.id, "form_schema");

      const txC = await newTransformation(lead, `Synthetic A06 newer ${lang.toUpperCase()}`);
      const recC = await t01Record(lead, txC);
      const l = await asUser(browser, lang, "dev.lead");
      const ff = await openT01Form(l.page, txC);
      const input = ff.locator(`[data-extension-field='${W.key}'] input`);
      await input.fill("80");
      await ff.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true }).click();
      await expect(
        ff
          .locator(
            `[data-extension-field='${W.key}'] [aria-invalid='true'], [data-extension-field='${W.key}'] input[aria-invalid='true']`,
          )
          .first(),
      ).toBeVisible();
      await expect(ff.locator("[data-state='notice']")).toHaveCount(0);
      await checkPage(l.page, lang, "a06-changed-rule-refuses-80");
      const none = await lead.call<Body>(
        "GET",
        `/api/v1/transformations/${txC}/form-records/T01/${recC}/custom-fields`,
      );
      expect(none.values[W.key] ?? null).toBeNull();
      expect(none.version).toBe(0);
      await input.fill("40");
      await ff.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true }).click();
      await expect(ff.locator("[data-state='notice']")).toContainText(tr(lang, "forms.edit.saved"));
      const ok = await lead.call<Body>("GET", `/api/v1/transformations/${txC}/form-records/T01/${recC}/custom-fields`);
      expect([ok.values[W.key], ok.formSchemaVersionId]).toEqual(["40", draft.id]);

      // the record pinned to the previous version is unchanged
      const ffB = await openT01Form(l.page, W.txB!);
      await expect(ffB.locator(`[data-extension-field='${W.key}'] input`)).toHaveValue("80");
      await l.close();
    });

    // ---- 4. the gate approver changes in the Studio elements editor; the new route applies to new transformations
    await test.step("4. a gate approver Sponsor -> Business Owner in Studio; a new transformation routes to BO", async () => {
      const gate = lang === "en" ? "G3" : "G5";
      const base = await newest(adm, "methodology", "playbook");
      const draft = await newDraftInUi(page, lang, base.id, `Synthetic A06 (${lang}): ${gate} approver`);
      const section = page.locator("#elements");
      await section.getByRole("combobox").first().selectOption("gate");
      const row = section.locator(`[data-element='gate:${gate}']`);
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: new RegExp(`^${escape(tr(lang, "studio.elements.edit"))}`) }).click();
      const edit = page.getByRole("dialog");
      const approver = edit.getByLabel(fieldLabel(lang, "studio.elements.attr.defaultApproverRoleCode"));
      await expect(approver).toHaveValue("SP");
      await approver.fill("BO");
      await edit.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
      await expect(edit).toHaveCount(0);
      await checkPage(page, lang, "a06-studio-gate-approver-changed");
      await publishThroughApi(adm, office, draft.id, "methodology");

      // An exception to the gate is decided by the gate's configured approver (the route), never anyone else.
      const route = async (tx: string) => {
        const sp = await syntheticUser(
          admin,
          ORG,
          tx,
          `qa.a06.sp.${lang}.${tx.slice(-6)}`,
          `Synthetic SP ${lang}`,
          "SP",
          lang,
        );
        const bo = await syntheticUser(
          admin,
          ORG,
          tx,
          `qa.a06.bo.${lang}.${tx.slice(-6)}`,
          `Synthetic BO ${lang}`,
          "BO",
          lang,
        );
        const T = `/api/v1/transformations/${tx}`;
        const view = await lead.call<Body>("GET", `${T}/gates/${gate}`);
        const criterion = (view.criteria as Body[])[0];
        const ex = await lead.call<Body>("POST", `${T}/gate-exceptions`, {
          gateCode: gate,
          criterionKey: criterion.key ?? criterion.criterionKey,
          reason: "Synthetic A06: evidence follows the pilot.",
          scope: `Synthetic A06: ${gate} only.`,
          compensatingAction: "Synthetic A06: weekly interim report.",
          compensatingOwnerUserId: bo.id,
          expiresOn: "2030-12-31",
        });
        const decide = async (username: string, expected: number) =>
          (await apiSession(playwright, username)).call(
            "POST",
            `${T}/gate-exceptions/${ex.id}/decision`,
            { outcome: "accepted", note: "Synthetic A06 decision (approves nothing real)." },
            { ifMatch: ex.version, expect: expected },
          );
        return { sp: sp.username, bo: bo.username, decide };
      };
      const txD = await newTransformation(lead, `Synthetic A06 after the route change ${lang.toUpperCase()}`);
      const fresh = await route(txD);
      await fresh.decide(fresh.sp, 403);
      await fresh.decide(fresh.bo, 200);
      const old = await route(W.txOld);
      await old.decide(old.bo, 403);
      await old.decide(old.sp, 200);
    });
    expect(foreign).toEqual([]);
  });

  test("a field added to T13 in Studio can be entered on a stakeholder record of a new transformation", async ({
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const lang = langOf(info);
    expect(W?.txB, "the first test published the T13 field").toBeTruthy();
    const T = `/api/v1/transformations/${W.txB}`;
    const schema = await W.lead.call<Body>("GET", `${T}/form-schemas/T13`);
    expect(
      (schema.fields as Body[]).some((f) => f.key === W.key13),
      "the T13 field is in the pinned form",
    ).toBe(true);
    await W.lead.call("POST", `${T}/stakeholder-groups`, {
      name: `Synthetic stakeholder group ${lang}`,
      impact: "H",
      currentStance: "neutral",
      requiredBehavior: "Synthetic behaviour",
      interventionTypes: ["training"],
      ownerUserId: W.lead.userId,
    });
    const l = await asUser(browser, lang, "dev.lead");
    await l.page.goto(`/transformations/${W.txB}/adoption`);
    await expect(l.page.locator("main#main h1")).toBeVisible();
    await shot(l.page, lang, "a06-t13-stakeholder-record");
    // Wherever the stakeholder record is edited, the published T13 extension field must be offered.
    const tools = l.page.locator("[data-form-tools]");
    await expect(tools.first(), "a form-tools entry on the T13 stakeholder record").toBeVisible({ timeout: 10_000 });
    await tools.first().click();
    await expect(l.page.locator(`[data-form-framework='T13'] [data-extension-field='${W.key13}']`)).toBeVisible();
    await l.close();
  });
});
