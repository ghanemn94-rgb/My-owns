// Extension fields on every native form, the T13 case (T-DG5-FE-C2; D-163; F-DG5-QA-A-2, F-DG5-QA-A-4; REQ-S06-004
// "a new T13 record stores the new field"; A06 "works without code changes"; ADR-0041 §1, §4, §5), against the REAL
// API (apps/web/e2e/support/with-stack.sh). Everything here is SYNTHETIC.
//  1. A fresh synthetic methodology administrator (organization ADM_METHOD, made through the access API by
//     `dev.admin`) adds a number field (max 100) to T13 in the form builder, on a forms draft created in the Studio
//     UI; the draft is checked, reviewed by the Transformation Office and published through the Studio operations
//     the UI calls (the UI publish path itself is p5-studio.spec.ts and A06).
//  2. On a transformation created AFTER the publish, the Lead opens "New stakeholder group" (T13): the field is
//     offered. Main refusal: 150 names the limit (100) and nothing is created. 80 creates the group and stores the
//     value (putFormRecordCustomFields, If-Match "0"); the record view shows it, Form tools offers it, and the API
//     reads it back with the published version.
//  3. The register's header carries the T13 question tag strip (REQ-PB-011).
// Asserted on each screen: <html lang/dir>, axe with 0 serious/critical issues, no foreign request, no engineering-gate
// name in product text. A configuration review approves nothing in the business sense (never G1-G6).
import { expect, test, type Page } from "@playwright/test";
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
import { asUser } from "./support/p3-journey-setup.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
const DEV_ISSUER = "urn:mth:dev-local";
const V = "/api/v1/admin/methodology-versions";
const stamp = Date.now().toString(36);

async function methodologyAdmin(admin: ApiSession, lang: Lang): Promise<string> {
  const username = `fec2.adm.${lang}.${stamp}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic FE-C2 methodology admin ${lang}`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: ORG },
    reason: "Synthetic methodology administrator for the T13 extension-field e2e (approves nothing real)",
  });
  return username;
}

async function publish(adm: ApiSession, office: ApiSession, id: string): Promise<void> {
  const ver = async () => (await adm.call<Body>("GET", `${V}/${id}`)).version as number;
  await adm.call("POST", `${V}/${id}/compatibility-checks`, undefined, { ifMatch: await ver() });
  await adm.call("POST", `${V}/${id}/preview`, { samples: [] }, { ifMatch: await ver() });
  await adm.call("POST", `${V}/${id}/submit-review`, { note: "Synthetic FE-C2 T13 field" }, { ifMatch: await ver() });
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

async function checkPage(page: Page, lang: Lang, name: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await expectAccessible(page, lang, name);
  await shot(page, lang, name);
}

test("a T13 field published in the form builder is entered on a new stakeholder group and read back", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const key = `fec2_score_${lang}_${stamp}`;
  const labelEn = `Synthetic FE-C2 score ${lang}`;
  const labelAr = `درجة تجريبية ${lang}`;
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const lead = await apiSession(playwright, "dev.lead");
  const admName = await methodologyAdmin(admin, lang);
  const adm = await apiSession(playwright, admName);

  // ---- 1. the field in the form builder, on a draft made in the Studio UI
  const base = (await adm.call<{ items: Body[] }>("GET", `${V}?kind=form_schema&status=published`)).items.find(
    (v) => v.key === "forms" && v.isNewestPublished,
  );
  expect(base, "a published forms version").toBeTruthy();
  await signIn(page, lang, admName);
  await page.goto("/admin/studio");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(base.id);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill(`Synthetic FE-C2 (${lang}): T13 score`);
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const draftId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto("/admin/forms/T13");
  await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draftId);
  await expect(page.locator("[data-state='editable-draft']")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "forms.schema.addField"), exact: true }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel(fieldLabel(lang, "forms.schema.fieldKey")).fill(key);
  await add.getByLabel(fieldLabel(lang, "forms.schema.fieldType")).selectOption("number");
  await add.getByLabel(fieldLabel(lang, "forms.schema.labelEn")).fill(labelEn);
  await add.getByLabel(fieldLabel(lang, "forms.schema.labelAr")).fill(labelAr);
  await add.getByLabel(fieldLabel(lang, "forms.schema.min")).fill("0");
  await add.getByLabel(fieldLabel(lang, "forms.schema.max")).fill("100");
  await add.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect(page.locator(`[data-field='${key}']`)).toBeVisible();
  await checkPage(page, lang, "fec2-t13-field-added");
  await publish(adm, office, draftId);

  // ---- 2. a NEW transformation: the field in the create form, the refusal, the stored value, the record view
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic FE-C2 T13 ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const l = await asUser(browser, lang, "dev.lead");
  const lp = l.page;
  const leadForeign = trackRequests(lp);
  await lp.goto(`/transformations/${tid}/adoption`);
  await expect(lp.locator("[data-template-provenance='T13']")).toBeVisible();
  await lp.getByRole("button", { name: tr(lang, "adoptionP4.groups.create"), exact: true }).click();
  const dialog = lp.getByRole("dialog");
  const input = dialog.locator(`[data-extension-create='T13'] [data-extension-field='${key}'] input`);
  await expect(input).toBeVisible();
  await expect(dialog.getByLabel(lang === "en" ? labelEn : labelAr)).toBeVisible();
  const name = `Synthetic FE-C2 group ${lang}`;
  await dialog.locator("[data-field='name']").fill(name);
  await dialog.locator("[data-field='impact']").selectOption("M");
  await dialog.locator("[data-field='currentStance']").selectOption("neutral");
  await dialog.locator("[data-field='requiredBehavior']").fill("Synthetic behaviour");
  await dialog.getByLabel(new RegExp(tr(lang, "adoptionP4.intervention.training"))).check();
  // Main refusal: a well-formed number above the maximum names the limit, and nothing is created.
  await input.fill("150");
  await dialog.getByRole("button", { name: tr(lang, "adoptionP4.groups.createSubmit"), exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toContainText(tr(lang, "forms.extensions.range.between", { min: "0", max: "100" }));
  await checkPage(lp, lang, "fec2-t13-create-out-of-range");
  const none = await lead.call<{ items: Body[] }>("GET", `/api/v1/transformations/${tid}/stakeholder-groups?limit=100`);
  expect(none.items.filter((g) => g.name === name)).toHaveLength(0);
  // A valid value: the group is created and the value stored with it.
  await input.fill("80");
  await dialog.getByRole("button", { name: tr(lang, "adoptionP4.groups.createSubmit"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const created = (
    await lead.call<{ items: Body[] }>("GET", `/api/v1/transformations/${tid}/stakeholder-groups?limit=100`)
  ).items.find((g) => g.name === name);
  expect(created, "the group was created").toBeTruthy();
  const stored = await lead.call<Body>(
    "GET",
    `/api/v1/transformations/${tid}/form-records/T13/${created.id}/custom-fields`,
  );
  expect([stored.values[key], stored.formSchemaVersionId, stored.version]).toEqual(["80", draftId, 1]);
  // The record view shows it; Form tools offers it with the stored value.
  const view = lp.locator(
    `[data-extension-values='T13'][data-record-id='${created.id}'] [data-extension-value='${key}']`,
  );
  await expect(view).toContainText("80");
  await expect(lp.locator("[data-state='extension-save-failed']")).toHaveCount(0);
  await checkPage(lp, lang, "fec2-t13-record-view");
  await lp.locator(`[data-form-tools='${created.id}']`).click();
  const ff = lp.getByRole("dialog").locator("[data-form-framework='T13']");
  await expect(ff.locator(`[data-extension-field='${key}'] input`)).toHaveValue("80");
  await checkPage(lp, lang, "fec2-t13-form-tools");
  expect(leadForeign).toEqual([]);
  await l.close();
  expect(foreign).toEqual([]);
});
