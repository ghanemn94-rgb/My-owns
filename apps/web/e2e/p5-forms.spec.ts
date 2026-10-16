// The form builder and the common form framework against the REAL API (apps/web/e2e/support/with-stack.sh;
// T-DG5-FE-C; ADR-0041; REQ-S05-001, REQ-S05-002, REQ-S05-006). Everything here is SYNTHETIC demo data.
//  - REQ-S05-001 (T14 and T01): a saved draft reopens; saving lists a new version in history; a comment and an
//    attachment persist; export returns the rows; a conflicting concurrent save returns a recoverable conflict, which
//    re-applies the change on the current version. Main refusal: the 409 conflict; a reader gets read-only views.
//  - REQ-S05-002 (T03): the methodology administrator adds an extension field in a forms draft, which publishes
//    through the Studio pipeline (the Transformation Office reviews); deleting the T03 "gap" source column is refused
//    (422 form_schema.source_column_protected, shown in en/ar).
//  - REQ-S05-006: the twelve extension record types carry the "Extension" badge in the builder, and on their forms.
// The methodology administrator is a SYNTHETIC ADM_METHOD grant to the seeded `dev.nobody`, revoked at the end (as
// p5-studio.spec.ts does). A configuration review approves nothing in the business sense (never G1-G6), and nothing
// here touches the engineering delivery gates DG0-DG7. Every screen is checked with axe and captured in EN and AR.
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
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
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
const stamp = Date.now().toString(36);

let lead: ApiSession;
let tid = "";
let T = "";
let owner: SyntheticUser;
let auditor: SyntheticUser;
let benefitId = "";
let evidenceTitle = "";

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P5 forms ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  owner = await syntheticUser(
    admin,
    ORG,
    tid,
    `dev.p5forms.bo.${lang}.${stamp}`,
    `Synthetic Benefit Owner ${lang}`,
    "BO",
    lang,
  );
  auditor = await syntheticUser(
    admin,
    ORG,
    tid,
    `dev.p5forms.aud.${lang}.${stamp}`,
    `Synthetic Auditor ${lang}`,
    "AUD",
    lang,
  );
  evidenceTitle = `Synthetic churn extract ${lang} ${stamp}`;
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: evidenceTitle,
    noteBody: "Synthetic extract (demo data).",
    ownerUserId: lead.userId,
  });
  const kpi = await lead.call<{ id: string }>("POST", `${T}/kpi-definitions`, {
    name: `Synthetic NPS ${lang} ${stamp}`,
    unitKind: "score",
    polarity: "higher_is_better",
  });
  const bo = await apiSession(playwright, owner.username);
  benefitId = (
    await bo.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic churn reduction ${lang}`,
      description: "Lower churn on the synthetic prepaid base.",
      benefitType: "cx",
      valueClass: "non_financial",
      ownerUserId: owner.id,
      currency: "SAR",
      measurementKpiDefinitionId: kpi.id,
    })
  ).id;
  // One filled T01 item, so the T01 grid has a record with form tools.
  const items = await lead.call<{ items: { id: string; version: number; dimensionCode: string }[] }>(
    "GET",
    `${T}/diagnostic-items?limit=100`,
  );
  const first = items.items[0]!;
  await lead.call(
    "PATCH",
    `${T}/diagnostic-items/${first.id}`,
    { currentState: "Synthetic current state", rootCause: "Synthetic root cause", confidence: "M" },
    { ifMatch: first.version },
  );
});

const frameworkOf = (page: Page, recordType: string) => page.locator(`[data-form-framework='${recordType}']`);
const tab = (page: Page, lang: Lang, recordType: string, key: string) =>
  frameworkOf(page, recordType).getByRole("tab", { name: tr(lang, `forms.framework.tabs.${key}`), exact: true });

test("T14: a saved draft reopens, a save lists a new version, a comment and an attachment persist, export returns the rows, and a concurrent save is a recoverable conflict", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const bo = await asUser(browser, lang, owner.username);
  const page = bo.page;
  const foreign = trackRequests(page);
  const url = `/transformations/${tid}/benefits/${benefitId}`;
  await page.goto(url);
  const ff = frameworkOf(page, "T14");
  await expect(ff).toBeVisible();
  const title = ff.getByLabel(tr(lang, "benefitsP4.field.title"), { exact: true });
  await expect(title).toHaveValue(`Synthetic churn reduction ${lang}`);

  // 1. Save a draft: the record does not change; "Draft saved — not submitted".
  await title.fill(`Synthetic churn reduction ${lang} (draft)`);
  await ff.getByRole("button", { name: tr(lang, "forms.edit.saveDraft"), exact: true }).click();
  await expect(ff.locator("[data-state='notice']")).toContainText(tr(lang, "forms.edit.draftSaved"));
  await expectAccessible(page, lang, "p5-forms-t14-draft");
  await shot(page, lang, "p5-forms-t14-draft");

  // 2. The draft reopens after a reload, with its value and the open-draft banner.
  await page.reload();
  await expect(ff.locator("[data-state='draft-open']")).toBeVisible();
  await expect(ff.getByLabel(tr(lang, "benefitsP4.field.title"), { exact: true })).toHaveValue(
    `Synthetic churn reduction ${lang} (draft)`,
  );

  // 3. Save to the record: a new version is listed in history with the changed field; the draft is closed as saved.
  await ff.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true }).click();
  await expect(ff.locator("[data-state='notice']")).toContainText(tr(lang, "forms.edit.saved"));
  await expect(ff.locator("[data-draft-state='none']")).toBeVisible();
  await tab(page, lang, "T14", "history").click();
  const history = ff.getByRole("table", { name: tr(lang, "forms.history.caption") });
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(history.locator("[data-version='2']")).toBeVisible();
  await expectAccessible(page, lang, "p5-forms-t14-history");
  await shot(page, lang, "p5-forms-t14-history");

  // 4. A comment persists (read back after a reload).
  await tab(page, lang, "T14", "comments").click();
  await ff.getByLabel(tr(lang, "forms.comments.label"), { exact: true }).fill(`Synthetic comment ${lang}`);
  await ff.getByRole("button", { name: tr(lang, "forms.comments.post"), exact: true }).click();
  await expect(ff.locator("[data-comment-count='1']")).toBeVisible();
  await page.reload();
  await tab(page, lang, "T14", "comments").click();
  await expect(ff.getByText(`Synthetic comment ${lang}`, { exact: true })).toBeVisible();
  await shot(page, lang, "p5-forms-t14-comments");

  // 5. An attachment persists (T14 uses the P5 form attachment store).
  await tab(page, lang, "T14", "attachments").click();
  await ff.getByLabel(tr(lang, "forms.attachments.choose"), { exact: true }).selectOption({ label: evidenceTitle });
  await ff.getByRole("button", { name: tr(lang, "forms.attachments.attach"), exact: true }).click();
  await expect(ff.locator("[data-attachment-count='1'] [data-status='active']")).toContainText(evidenceTitle);
  await page.reload();
  await tab(page, lang, "T14", "attachments").click();
  await expect(ff.locator("[data-status='active']")).toContainText(evidenceTitle);
  await expectAccessible(page, lang, "p5-forms-t14-attachments");
  await shot(page, lang, "p5-forms-t14-attachments");

  // 6. Export returns the rows (the T14 register of this transformation: one benefit), in the chosen language.
  await page.locator("[data-export='T14']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-export-rows='1']")).toBeVisible();
  await expect(dialog.locator(`[data-export-language='${lang}']`)).toBeVisible();
  await expect(dialog).toContainText(`Synthetic churn reduction ${lang} (draft)`);
  await expectAccessible(page, lang, "p5-forms-t14-export");
  await shot(page, lang, "p5-forms-t14-export");
  await dialog.getByRole("button", { name: tr(lang, "forms.export.close"), exact: true }).click();

  // 7. Main refusal: a conflicting concurrent save. Someone else changes the record after this page read it.
  await tab(page, lang, "T14", "edit").click();
  const other = await apiSession(playwright, owner.username);
  const current = await other.call<{ version: number }>("GET", `${T}/benefits/${benefitId}`);
  await other.call(
    "PATCH",
    `${T}/benefits/${benefitId}`,
    { description: "Synthetic: changed by someone else" },
    { ifMatch: current.version },
  );
  await ff.getByLabel(tr(lang, "benefitsP4.field.title"), { exact: true }).fill(`Synthetic churn reduction ${lang} v3`);
  await ff.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true }).click();
  const conflict = ff.locator("[data-state='conflict']");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(`Synthetic churn reduction ${lang} v3`);
  await expectAccessible(page, lang, "p5-forms-t14-conflict");
  await shot(page, lang, "p5-forms-t14-conflict");
  await conflict.getByRole("button", { name: tr(lang, "common.conflict.reapply"), exact: true }).click();
  await expect(ff.locator("[data-state='notice']")).toContainText(tr(lang, "forms.edit.saved"));
  const after = await other.call<{ title: string; description: string }>("GET", `${T}/benefits/${benefitId}`);
  expect(after.title).toBe(`Synthetic churn reduction ${lang} v3`);
  expect(after.description).toBe("Synthetic: changed by someone else");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
  await bo.close();
});

test("T01: form tools on a diagnostic record (comment, attachment, history) and the T01 export; the auditor reads only", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/diagnose`);
  const tools = page.locator("#t01 [data-form-tools]").first();
  await expect(tools).toBeVisible();
  await tools.click();
  const dialog = page.getByRole("dialog");
  const ff = dialog.locator("[data-form-framework='T01']");
  await expect(ff).toBeVisible();
  await expect(ff.getByLabel(tr(lang, "diagnose.t01.rootCause"), { exact: true })).toHaveValue("Synthetic root cause");
  await expect(ff.locator("[data-state='no-extensions']")).toBeVisible();
  await expectAccessible(page, lang, "p5-forms-t01-tools");
  await shot(page, lang, "p5-forms-t01-tools");

  await ff.getByRole("tab", { name: tr(lang, "forms.framework.tabs.comments"), exact: true }).click();
  await ff.getByLabel(tr(lang, "forms.comments.label"), { exact: true }).fill(`Synthetic T01 comment ${lang}`);
  await ff.getByRole("button", { name: tr(lang, "forms.comments.post"), exact: true }).click();
  await expect(ff.getByText(`Synthetic T01 comment ${lang}`, { exact: true })).toBeVisible();

  // T01 attachments live in the DG2 evidence links (one attachment place per record type, ADR-0041 §5).
  await ff.getByRole("tab", { name: tr(lang, "forms.framework.tabs.attachments"), exact: true }).click();
  await ff.getByLabel(tr(lang, "forms.attachments.choose"), { exact: true }).selectOption({ label: evidenceTitle });
  await ff.getByRole("button", { name: tr(lang, "forms.attachments.attach"), exact: true }).click();
  await expect(ff.locator("[data-status='active']")).toContainText(evidenceTitle);
  await expect(ff.locator("[data-status='active']")).toContainText(tr(lang, "forms.attachments.storeEvidenceLink"));

  await ff.getByRole("tab", { name: tr(lang, "forms.framework.tabs.history"), exact: true }).click();
  await expect(
    ff
      .getByRole("table", { name: tr(lang, "forms.history.caption") })
      .locator("tbody tr")
      .first(),
  ).toBeVisible();
  await shot(page, lang, "p5-forms-t01-history");
  await dialog.getByRole("button", { name: tr(lang, "forms.framework.close"), exact: true }).click();

  // Export returns the six T01 rows of this transformation.
  await page.locator("[data-export='T01']").click();
  const exp = page.getByRole("dialog");
  await expect(exp.locator("[data-export-rows]")).toHaveAttribute("data-export-rows", /^[1-9][0-9]*$/);
  await expect(exp).toContainText("Synthetic root cause");
  await shot(page, lang, "p5-forms-t01-export");
  expect(foreign).toEqual([]);

  // The auditor reads the same record without any write action.
  const aud = await asUser(browser, lang, auditor.username);
  await aud.page.goto(`/transformations/${tid}/diagnose`);
  const audTools = aud.page.locator("#t01 [data-form-tools]").first();
  await audTools.click();
  const audFf = aud.page.getByRole("dialog").locator("[data-form-framework='T01']");
  await expect(audFf.getByText(tr(lang, "forms.framework.readOnly"), { exact: true })).toBeVisible();
  await expect(audFf.getByRole("button", { name: tr(lang, "forms.edit.save"), exact: true })).toHaveCount(0);
  await audFf.getByRole("tab", { name: tr(lang, "forms.framework.tabs.comments"), exact: true }).click();
  await expect(audFf.getByText(`Synthetic T01 comment ${lang}`, { exact: true })).toBeVisible();
  await expect(audFf.getByRole("button", { name: tr(lang, "forms.comments.post"), exact: true })).toHaveCount(0);
  await expectAccessible(aud.page, lang, "p5-forms-t01-auditor");
  await shot(aud.page, lang, "p5-forms-t01-auditor");
  await aud.close();
});

/** A SYNTHETIC ADM_METHOD grant for dev.nobody; returns the revoke to call in `finally` (as p5-studio.spec.ts). */
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
      reason: "Synthetic methodology administrator for the form-builder journey",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic form-builder journey" },
        { ifMatch: a.version },
      );
  };
}

interface Version {
  id: string;
  status: string;
  draftStage: string | null;
  isNewestPublished: boolean;
  version: number;
}

test("Form builder: the twelve extension badges; an extension field added to T03 publishes; deleting the T03 gap column is refused", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    const adm = await apiSession(playwright, "dev.nobody");
    const V = "/api/v1/admin/methodology-versions";
    // One open forms draft per kind and key: discard a draft an earlier failed run left.
    for (const d of (await adm.call<{ items: Version[] }>("GET", `${V}?kind=form_schema&status=draft`)).items)
      if (d.draftStage === "editing" || d.draftStage === "preview")
        await adm.call("POST", `${V}/${d.id}/discard`, undefined, { ifMatch: d.version });
    const base = (await adm.call<{ items: Version[] }>("GET", `${V}?kind=form_schema&status=published`)).items.find(
      (v) => v.isNewestPublished,
    )!;
    expect(base, "a published forms version").toBeTruthy();
    const draft = await adm.call<Version>("POST", V, {
      basedOnVersionId: base.id,
      changeSummary: `Synthetic: a T03 extension field (${lang})`,
    });

    // 1. The builder lists the native forms; the twelve M0149 record types carry the badge.
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/forms");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "forms.builder.title"));
    await expect(page.locator("[data-extension-badge]")).toHaveCount(12);
    await expect(page.locator("[data-extension-badge='lesson']")).toContainText(tr(lang, "forms.badge.extension"));
    await expectAccessible(page, lang, "p5-form-builder");
    await shot(page, lang, "p5-form-builder");

    // 2. T03 in the open draft: source columns protected; add an extension field.
    await page.goto("/admin/forms/T03");
    await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draft.id);
    await expect(page.locator("[data-state='editable-draft']")).toBeVisible();
    await expect(page.locator("[data-field='gap'] [data-protected='true']")).toContainText(
      tr(lang, "forms.badge.protected"),
    );
    const key = `synthetic_note_${lang}`;
    await page.getByRole("button", { name: tr(lang, "forms.schema.addField"), exact: true }).click();
    const add = page.getByRole("dialog");
    await add.getByLabel(fieldLabel(lang, "forms.schema.fieldKey")).fill(key);
    await add.getByLabel(fieldLabel(lang, "forms.schema.labelEn")).fill(`Synthetic note ${lang}`);
    await add.getByLabel(fieldLabel(lang, "forms.schema.labelAr")).fill(`ملاحظة اصطناعية ${lang}`);
    await add.getByLabel(tr(lang, "forms.schema.helpEn"), { exact: true }).fill("Synthetic help for the note.");
    await add.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator(`[data-field='${key}'] [data-protected='false']`)).toBeVisible();
    await expectAccessible(page, lang, "p5-form-schema-draft");
    await shot(page, lang, "p5-form-schema-draft");

    // 3. Main refusal: deleting the T03 "gap" source column is refused by the server, translated.
    await page
      .locator("[data-field='gap']")
      .getByRole("button", { name: new RegExp(`^\\s*${escape(tr(lang, "forms.schema.removeField"))}`) })
      .click();
    await page.getByRole("button", { name: tr(lang, "forms.schema.confirmRemove"), exact: true }).click();
    const refusal = page.locator("[data-problem='form_schema.source_column_protected']");
    await expect(refusal).toContainText(tr(lang, "problems.form_schema__source_column_protected"));
    await expect(page.locator("[data-field='gap']")).toBeVisible();
    await expectAccessible(page, lang, "p5-form-schema-refusal");
    await shot(page, lang, "p5-form-schema-refusal");

    // 4. The draft publishes through the Studio pipeline: preview, compatibility, review by the TO, publish.
    let v = await adm.call<Version>("GET", `${V}/${draft.id}`);
    await adm.call("POST", `${V}/${draft.id}/preview`, { samples: [] }, { ifMatch: v.version });
    v = await adm.call<Version>("GET", `${V}/${draft.id}`);
    await adm.call("POST", `${V}/${draft.id}/compatibility-checks`, undefined, { ifMatch: v.version });
    v = await adm.call<Version>("GET", `${V}/${draft.id}`);
    await adm.call(
      "POST",
      `${V}/${draft.id}/submit-review`,
      { note: "Synthetic: a T03 extension field" },
      { ifMatch: v.version },
    );
    const office = await apiSession(playwright, "dev.office");
    const reviews = await office.call<{ items: { id: string; status: string; version: number }[] }>(
      "GET",
      `${V}/${draft.id}/reviews`,
    );
    const review = reviews.items.find((r) => r.status === "pending")!;
    await office.call(
      "POST",
      `${V}/${draft.id}/reviews/${review.id}/decision`,
      { outcome: "approve", note: "Synthetic: the field is optional" },
      { ifMatch: review.version },
    );
    v = await adm.call<Version>("GET", `${V}/${draft.id}`);
    await adm.call("POST", `${V}/${draft.id}/publish`, undefined, { ifMatch: v.version });
    v = await adm.call<Version>("GET", `${V}/${draft.id}`);
    expect(v.isNewestPublished).toBe(true);

    await page.goto("/admin/forms/T03");
    await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draft.id);
    await expect(page.locator("[data-state='read-only-version']")).toBeVisible();
    await expect(page.locator(`[data-field='${key}']`)).toBeVisible();
    await shot(page, lang, "p5-form-schema-published");
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  } finally {
    await revoke();
  }
});
