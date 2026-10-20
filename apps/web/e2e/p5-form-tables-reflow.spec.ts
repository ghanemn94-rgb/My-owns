// The P5 form tables reflow at 390 px and with 200 % text (T-DG5-FE-Z1 and its continuation T-DG5-FE-Z1B, D-176;
// F-DG5-146, REQ-S15-009, REQ-S15-012 WCAG 2.1 SC 1.4.10), against the REAL API (apps/web/e2e/support/with-stack.sh),
// in chromium-en and chromium-ar.
// It is the qa-verifier's round-4 DB-free reproduction (docs/delivery/test-evidence/DG5/qa/round-4/scripts/
// zz-qa-r4-p5-layout.mjs and layout-p5/; read, not imported) turned into a product test on the running stack:
//  - the Form builder's field table (/admin/forms/T03): an open forms draft with an extension field, as the SYNTHETIC
//    methodology administrator, and the auditor's read-only view of the newest published version (chosen
//    explicitly: while a draft is open the builder opens the draft by default);
//  - the form framework's Attachments tab on a T14 benefit with one attachment, and the T14 export preview dialog
//    (the third table of the same class, ExportDialog.tsx).
// Each screen is measured at 390 x 900, and at 1280 x 900 with the root font at 200 %, and the spec asserts the
// finding's final condition, document.documentElement.scrollWidth - innerWidth <= 1, plus: the table sits in a
// keyboard-focusable (tabIndex 0), named (role=region, non-empty localized aria-label) scroll region, and that region
// fits the viewport. Set-up checks (so the test cannot pass trivially): the table is rendered with its rows, and at
// 390 px the measured table really is wider than its region (it scrolls inside it, not the page).
// It collects every measurement first and then asserts once, so a failure names each failing case. Everything is
// SYNTHETIC demo data. A configuration draft approves nothing in the business sense (never G1-G6), and nothing here
// touches the engineering delivery gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "./support/p3-journey-setup.ts";
import {
  apiSession,
  fieldLabel,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
const V = "/api/v1/admin/methodology-versions";
const stamp = Date.now().toString(36);

interface Version {
  id: string;
  status: string;
  draftStage: string | null;
  isNewestPublished: boolean;
  version: number;
}

interface Measure {
  W: number;
  pageOverflow: number;
  found: boolean;
  rows: number;
  region: { tabIndex: number; role: string | null; name: string; left: number; right: number } | null;
  scrolls: boolean;
}

/** Measures the page and the table matched by `selector` (and its nearest .table-wrap). */
async function measure(page: Page, selector: string): Promise<Measure> {
  return page.evaluate((sel) => {
    const W = window.innerWidth;
    const table = document.querySelector<HTMLTableElement>(sel);
    const wrap = table?.closest<HTMLElement>(".table-wrap") ?? null;
    const r = wrap?.getBoundingClientRect();
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      found: table !== null,
      rows: table?.tBodies[0]?.rows.length ?? 0,
      region:
        wrap && r
          ? {
              tabIndex: wrap.tabIndex,
              role: wrap.getAttribute("role"),
              name: (wrap.getAttribute("aria-label") ?? "").trim(),
              left: Math.round(r.left),
              right: Math.round(r.right),
            }
          : null,
      scrolls: wrap !== null && wrap.scrollWidth > wrap.clientWidth + 1,
    };
  }, selector);
}

const CASES = [
  ["390 px", 390, 0],
  ["200 % text", 1280, 200],
] as const;

/**
 * Opens the screen (`open`) at each case's size, measures `selector`, records failures; then screenshots.
 * `mustScroll`: the set-up check that, at 390 px, the table really is wider than its region (the finding's condition).
 */
async function sweep(
  page: Page,
  lang: Lang,
  screen: string,
  selector: string,
  open: () => Promise<void>,
  failures: string[],
  report: string[],
  mustScroll = true,
) {
  for (const [label, width, font] of CASES) {
    await page.setViewportSize({ width, height: 900 });
    await open();
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await page.waitForLoadState("networkidle");
    const m = await measure(page, selector);
    const where = `${screen}, ${label}`;
    if (!m.found || m.rows === 0) failures.push(`${where} — set-up: the table ${selector} is not rendered with rows`);
    if (m.pageOverflow > 1) failures.push(`${where} — the page scrolls ${m.pageOverflow} px horizontally`);
    if (!m.region) failures.push(`${where} — the table is in no scroll region (.table-wrap)`);
    else {
      if (m.region.tabIndex !== 0 || m.region.role !== "region" || m.region.name === "")
        failures.push(
          `${where} — bare table wrapper (tabIndex ${m.region.tabIndex}, role ${m.region.role ?? "none"}, name ${JSON.stringify(m.region.name)})`,
        );
      if (m.region.left < -1 || m.region.right > m.W + 1)
        failures.push(`${where} — the region runs off the viewport [${m.region.left}..${m.region.right}] of ${m.W} px`);
    }
    if (mustScroll && width === 390 && m.region && !m.scrolls)
      failures.push(`${where} — set-up: the table does not scroll inside its region (the finding's condition)`);
    report.push(
      `${where}: overflow ${m.pageOverflow} px, rows ${m.rows}, region ${m.region ? `"${m.region.name}" [${m.region.left}..${m.region.right}]` : "none"}, scrolls ${m.scrolls}`,
    );
    await shot(
      page,
      lang,
      `z1-${screen.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${width === 390 ? "390" : "200pct"}`,
    );
    if (font) await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  }
}

/** A SYNTHETIC ADM_METHOD grant for dev.nobody; returns the revoke to call in `finally` (as p5-forms.spec.ts). */
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
      reason: "Synthetic methodology administrator for the form-table reflow check",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic form-table reflow check" },
        { ifMatch: a.version },
      );
  };
}

test("Form builder: the field table scrolls in its own region at 390 px and with 200 % text (a draft with an extension field, and the auditor's read-only view)", async ({
  browser,
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  const adm = await apiSession(playwright, "dev.nobody");
  let draft: Version | null = null;
  const failures: string[] = [];
  const report: string[] = [];
  try {
    // One open forms draft per kind and key: discard a draft an earlier failed run left.
    for (const d of (await adm.call<{ items: Version[] }>("GET", `${V}?kind=form_schema&status=draft`)).items)
      if (d.draftStage === "editing" || d.draftStage === "preview")
        await adm.call("POST", `${V}/${d.id}/discard`, undefined, { ifMatch: d.version });
    const base = (await adm.call<{ items: Version[] }>("GET", `${V}?kind=form_schema&status=published`)).items.find(
      (v) => v.isNewestPublished,
    )!;
    expect(base, "a published forms version").toBeTruthy();
    draft = await adm.call<Version>("POST", V, {
      basedOnVersionId: base.id,
      changeSummary: `Synthetic: a T03 extension field for the reflow check (${lang})`,
    });
    const draftId = draft.id;

    // The draft gets an extension field through the builder itself (as p5-forms.spec.ts does).
    await signIn(page, lang, "dev.nobody");
    const openDraft = async () => {
      await page.goto("/admin/forms/T03");
      await page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(draftId);
      await expect(page.locator("[data-state='editable-draft']")).toBeVisible();
    };
    await openDraft();
    const key = `synthetic_reflow_${lang}`;
    await page.getByRole("button", { name: tr(lang, "forms.schema.addField"), exact: true }).click();
    const add = page.getByRole("dialog");
    await add.getByLabel(fieldLabel(lang, "forms.schema.fieldKey")).fill(key);
    await add.getByLabel(fieldLabel(lang, "forms.schema.labelEn")).fill(`Synthetic reflow note ${lang}`);
    await add.getByLabel(fieldLabel(lang, "forms.schema.labelAr")).fill(`ملاحظة اصطناعية للتدفق ${lang}`);
    await add.getByRole("button", { name: tr(lang, "studio.elements.save"), exact: true }).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator(`[data-field='${key}'] [data-protected='false']`)).toBeVisible();

    await sweep(page, lang, "form builder draft", "table[data-field-count]", openDraft, failures, report);

    // The auditor's read-only view of the newest published version (no actions column). The builder opens the open
    // draft by default while one exists (this test's), so the auditor chooses the published version explicitly.
    const publishedId = base.id;
    const aud = await asUser(browser, lang, "dev.auditor");
    await sweep(
      aud.page,
      lang,
      "form builder read-only",
      "table[data-field-count]",
      async () => {
        await aud.page.goto("/admin/forms/T03");
        await aud.page.getByLabel(fieldLabel(lang, "forms.schema.version")).selectOption(publishedId);
        await expect(aud.page.locator("[data-state='read-only-version']")).toBeVisible();
        await expect(aud.page.locator("table[data-field-count] tbody tr").first()).toBeVisible();
        await expect(aud.page.locator("[data-state='editable-draft']")).toHaveCount(0);
        await expect(aud.page.locator(`[data-field='${key}']`)).toHaveCount(0);
      },
      failures,
      report,
    );
    await aud.close();
  } finally {
    if (draft) {
      const d = await adm.call<Version>("GET", `${V}/${draft.id}`);
      if (d.status === "draft") await adm.call("POST", `${V}/${draft.id}/discard`, undefined, { ifMatch: d.version });
    }
    await revoke();
  }
  console.info(`Form builder reflow ${lang}: ${report.join("; ")}`);
  expect(failures).toEqual([]);
});

test("Form framework on T14: the Attachments table and the export preview scroll in their own regions at 390 px and with 200 % text", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic form-table reflow ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const owner = await syntheticUser(
    admin,
    ORG,
    tid,
    `dev.z1reflow.bo.${lang}.${stamp}`,
    `Synthetic Benefit Owner ${lang}`,
    "BO",
    lang,
  );
  const evidenceTitle = `Synthetic churn extract for the reflow check ${lang} ${stamp}`;
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: evidenceTitle,
    noteBody: "Synthetic extract (demo data).",
    ownerUserId: lead.userId,
  });
  const kpi = await lead.call<{ id: string }>("POST", `${T}/kpi-definitions`, {
    name: `Synthetic NPS reflow ${lang} ${stamp}`,
    unitKind: "score",
    polarity: "higher_is_better",
  });
  const bo = await apiSession(playwright, owner.username);
  const benefitId = (
    await bo.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic churn reduction reflow ${lang}`,
      description: "Lower churn on the synthetic prepaid base.",
      benefitType: "cx",
      valueClass: "non_financial",
      ownerUserId: owner.id,
      currency: "SAR",
      measurementKpiDefinitionId: kpi.id,
    })
  ).id;

  const user = await asUser(browser, lang, owner.username);
  const page = user.page;
  const ff = page.locator("[data-form-framework='T14']");
  const attachmentsTab = ff.getByRole("tab", { name: tr(lang, "forms.framework.tabs.attachments"), exact: true });
  const url = `/transformations/${tid}/benefits/${benefitId}`;
  await page.goto(url);
  await attachmentsTab.click();
  await ff.getByLabel(tr(lang, "forms.attachments.choose"), { exact: true }).selectOption({ label: evidenceTitle });
  await ff.getByRole("button", { name: tr(lang, "forms.attachments.attach"), exact: true }).click();
  await expect(ff.locator("[data-attachment-count='1'] [data-status='active']")).toContainText(evidenceTitle);

  const failures: string[] = [];
  const report: string[] = [];
  await sweep(
    page,
    lang,
    "T14 attachments",
    "table[data-attachment-count]",
    async () => {
      await page.goto(url);
      await attachmentsTab.click();
      await expect(ff.locator("[data-status='active']")).toContainText(evidenceTitle);
    },
    failures,
    report,
  );
  await sweep(
    page,
    lang,
    "T14 export preview",
    "[role='dialog'] [data-export-rows] table",
    async () => {
      await page.goto(url);
      await page.locator("[data-export='T14']").click();
      await expect(page.getByRole("dialog").locator("[data-export-rows]")).toHaveAttribute(
        "data-export-rows",
        /^[1-9][0-9]*$/,
      );
    },
    failures,
    report,
    // The preview table's width depends on the T14 columns, so only the page-level and region checks bind here;
    // whether it is wider than its region at 390 px is reported, not required.
    false,
  );
  await user.close();
  console.info(`T14 form tables reflow ${lang}: ${report.join("; ")}`);
  expect(failures).toEqual([]);
});
