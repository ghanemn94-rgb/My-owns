// Extension fields on the remaining native forms (T-DG5-FE-C3; D-164; F-DG5-QA-A-2; REQ-S06-004 "a new … record stores
// the new field"; ADR-0041 §1, §4, §5), against the REAL API (apps/web/e2e/support/with-stack.sh). Everything here is
// SYNTHETIC.
//  1. A fresh synthetic methodology administrator (organization ADM_METHOD, made through the access API by
//     `dev.admin`) adds a number field (0–100) to `lesson` (an M0149 extension type) and `business_case` (a source
//     deliverable) on one forms draft, through the Studio element operation the form builder calls (the
//     builder UI itself is p5-extension-fields.spec.ts and A06). The Transformation Office reviews it and it is
//     published; a configuration review approves nothing in the business sense (never G1-G6).
//  2. On a transformation created AFTER the publish:
//     - the Transformation Office (`lesson.edit`) creates a lesson (P4 dialog). Main refusal: 150 names the limit and
//       nothing is created; 70 creates the lesson and stores the value (If-Match "0"); the register's record view
//       shows it;
//     - the Lead creates a business case (custom dialog) with 55; the case page's record view shows it;
//     The T01 fill (create) dialog is not driven here: a transformation created now has all six T01 items from its
//     creation, so the dialog opens in edit mode (Form tools is the entry there, p5-forms.spec.ts and A06). Its create
//     path, for a dimension without an item, is covered by extension-hosts.test.tsx.
// Asserted on each screen: <html lang/dir>, axe with 0 serious/critical issues, no foreign request, no engineering-gate
// name in product text.
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
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
  const username = `fec3.adm.${lang}.${stamp}`;
  const user = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic FE-C3 methodology admin ${lang}`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: user.id,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: ORG },
    reason: "Synthetic methodology administrator for the FE-C3 extension-field e2e (approves nothing real)",
  });
  return username;
}

async function publish(adm: ApiSession, office: ApiSession, id: string): Promise<void> {
  const ver = async () => (await adm.call<Body>("GET", `${V}/${id}`)).version as number;
  await adm.call("POST", `${V}/${id}/compatibility-checks`, undefined, { ifMatch: await ver() });
  await adm.call("POST", `${V}/${id}/preview`, { samples: [] }, { ifMatch: await ver() });
  await adm.call("POST", `${V}/${id}/submit-review`, { note: "Synthetic FE-C3 fields" }, { ifMatch: await ver() });
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

test("fields published for a lesson and a business case are entered in their create forms and read back", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(300_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const key = `fec3_${lang}_${stamp}`;
  const labelEn = `Synthetic FE-C3 score ${lang}`;
  const labelAr = `درجة تجريبية ${lang}`;
  const label = lang === "en" ? labelEn : labelAr;
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const lead = await apiSession(playwright, "dev.lead");
  const adm = await apiSession(playwright, await methodologyAdmin(admin, lang));

  // ---- 1. one forms draft with the field on two record types, published
  const base = (await adm.call<{ items: Body[] }>("GET", `${V}?kind=form_schema&status=published`)).items.find(
    (v) => v.key === "forms" && v.isNewestPublished,
  );
  expect(base, "a published forms version").toBeTruthy();
  const draft = await adm.call<Body>("POST", V, {
    basedOnVersionId: base.id,
    changeSummary: `Synthetic FE-C3 (${lang}): a score on lesson and business case`,
  });
  for (const recordType of ["lesson", "business_case"]) {
    const version = (await adm.call<Body>("GET", `${V}/${draft.id}`)).version as number;
    await adm.call(
      "PUT",
      `${V}/${draft.id}/elements/form_field/${recordType}.${key}`,
      {
        origin: "admin",
        attributes: { labelEn, labelAr, required: false, fieldType: "number", min: "0", max: "100" },
      },
      { ifMatch: version },
    );
  }
  await publish(adm, office, draft.id);

  // ---- 2. a NEW transformation (pinned to the published version)
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic FE-C3 ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const o = await asUser(browser, lang, "dev.office");
  const op = o.page;
  const officeForeign = trackRequests(op);

  // -- a lesson (an M0149 extension type, in a P4 dialog), by the Transformation Office: the refusal, then the stored
  //    value and the record view
  await op.goto(`/transformations/${tid}/lessons`);
  await expect(op.locator("[data-extension-note='lesson']")).toBeVisible();
  await op.getByRole("button", { name: tr(lang, "sustainP4.lessons.create"), exact: true }).click();
  const ld = op.getByRole("dialog");
  const lin = ld.locator(`[data-extension-create='lesson'] [data-extension-field='${key}'] input`);
  await expect(lin).toBeVisible();
  await expect(ld.getByLabel(label)).toBeVisible();
  const lessonTitle = `Synthetic FE-C3 lesson ${lang}`;
  await ld.locator("[data-field='title']").fill(lessonTitle);
  await ld.locator("[data-field='lessonText']").fill("Synthetic lesson text");
  await lin.fill("150");
  await ld.getByRole("button", { name: tr(lang, "sustainP4.lessons.createSubmit"), exact: true }).click();
  await expect(lin).toHaveAttribute("aria-invalid", "true");
  await expect(ld).toContainText(tr(lang, "forms.extensions.range.between", { min: "0", max: "100" }));
  await checkPage(op, lang, "fec3-lesson-create-out-of-range");
  const noLesson = await office.call<{ items: Body[] }>("GET", `${T}/lessons?limit=100`);
  expect(noLesson.items.filter((x) => x.title === lessonTitle)).toHaveLength(0);
  await lin.fill("70");
  await ld.getByRole("button", { name: tr(lang, "sustainP4.lessons.createSubmit"), exact: true }).click();
  await expect(ld).toHaveCount(0);
  const lesson = (await office.call<{ items: Body[] }>("GET", `${T}/lessons?limit=100`)).items.find(
    (x) => x.title === lessonTitle,
  );
  expect(lesson, "the lesson was created").toBeTruthy();
  const lessonValues = await office.call<Body>("GET", `${T}/form-records/lesson/${lesson.id}/custom-fields`);
  expect([lessonValues.values[key], lessonValues.formSchemaVersionId, lessonValues.version]).toEqual([
    "70",
    draft.id,
    1,
  ]);
  await expect(
    op.locator(`[data-extension-values='lesson'][data-record-id='${lesson.id}'] [data-extension-value='${key}']`),
  ).toContainText("70");
  await expect(op.locator("[data-state='extension-save-failed']")).toHaveCount(0);
  await checkPage(op, lang, "fec3-lesson-record-view");

  expect(officeForeign).toEqual([]);
  await o.close();

  const l = await asUser(browser, lang, "dev.lead");
  const lp = l.page;
  const leadForeign = trackRequests(lp);

  // -- a business case (a source deliverable, in a custom dialog): created with the value; the case page shows it
  await lp.goto(`/transformations/${tid}/business-cases`);
  await lp.getByRole("button", { name: tr(lang, "businessCases.create.action"), exact: true }).click();
  const bd = lp.getByRole("dialog");
  await bd.getByLabel(fieldLabel(lang, "businessCases.field.title")).fill(`Synthetic FE-C3 case ${lang}`);
  const bin = bd.locator(`[data-extension-create='business_case'] [data-extension-field='${key}'] input`);
  await bin.fill("55");
  await bd.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(lp).toHaveURL(/\/business-cases\/[0-9a-f-]+$/);
  const caseId = new URL(lp.url()).pathname.split("/").pop()!;
  const caseValues = await lead.call<Body>("GET", `${T}/form-records/business_case/${caseId}/custom-fields`);
  expect([caseValues.values[key], caseValues.version]).toEqual(["55", 1]);
  await expect(
    lp.locator(`[data-extension-values='business_case'][data-record-id='${caseId}'] [data-extension-value='${key}']`),
  ).toContainText("55");
  await checkPage(lp, lang, "fec3-business-case-record-view");

  expect(leadForeign).toEqual([]);
  await l.close();
  expect(foreign).toEqual([]);
});
