// T-DG6-FE-G probe (evidence only; not part of the product suites): the DG5 carry-forward screens in a REAL browser
// against the REAL API (apps/web/e2e/support/with-stack.sh), in chromium-en and chromium-ar, with screenshots.
//  - F-DG5-150: the Traceability note "Showing the links of <record>" with a 200-character unbroken record name: no
//    page-level horizontal scroll at 390, 360 and 320 px and at 1280 px with 200 % text.
//  - F-DG5-120 / F-DG5-121: a T06 scoring-defaults draft that changes one weight pair and one rubric descriptor: the
//    Elements table in the page language, "Changed" only where the value differs from the base, the rubric diff
//    readable (no raw JSON), the legend.
//  - F-DG5-125: the Executive Overview filter and the organization Finance queue with 2,150 readable transformations.
//    The transformation list (and the per-transformation queues) are answered by page.route with SYNTHETIC rows,
//    because the stack holds far fewer; everything else is the real API.
// Everything is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  ensureLanguage,
  fieldLabel,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  type ApiSession,
} from "../../../../../../apps/web/e2e/support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
const LONG = `Synthetic_${"R".repeat(190)}`; // 200 characters, no break opportunity
const SIZES = [
  ["390", 390, 0],
  ["360", 360, 0],
  ["320", 320, 0],
  ["1280-200pct", 1280, 200],
] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("F-DG5-150: the rooted note wraps a 200-character record name; no page-level horizontal scroll", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const { id: tid } = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-G note ${lang} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  const outcome = await lead.call<{ id: string }>("POST", `/api/v1/transformations/${tid}/outcomes`, {
    statement: LONG,
  });
  await signIn(page, lang, "dev.lead");
  const results: string[] = [];
  for (const [label, width, font] of SIZES) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/transformations/${tid}/traceability?root=outcome:${outcome.id}`);
    const name = page.locator("[data-root] .record-name");
    await expect(name).toHaveText(LONG, { timeout: 20_000 });
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await page.waitForTimeout(400);
    const o = await overflow(page);
    const wrap = await name.evaluate((el) => getComputedStyle(el).overflowWrap);
    results.push(`${lang} ${label}: page overflow ${o} px, .record-name overflow-wrap ${wrap}`);
    expect(o, `${lang} ${label}`).toBeLessThanOrEqual(1);
    expect(wrap).toBe("anywhere");
    await name.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"]}/${lang}/f150-rooted-note-${label}.png` });
  }
  console.info(`F-DG5-150 ${results.join("; ")}`);
});

/** A SYNTHETIC ADM_METHOD grant for dev.nobody (as in p5-studio.spec.ts); returns the revoke. */
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
      reason: "Synthetic methodology administrator for the FE-G probe",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic FE-G probe" },
        { ifMatch: a.version },
      );
  };
}

type Version = { id: string; version: number; draftStage: string | null; isNewestPublished: boolean };

test("F-DG5-120/121: the Studio Elements labels and the rubric diff on a real T06 draft", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  const adm = await apiSession(playwright, "dev.nobody");
  let draftId: string | null = null;
  try {
    const drafts = await adm.call<{ items: Version[] }>(
      "GET",
      "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=draft",
    );
    for (const d of drafts.items)
      if (d.draftStage === "editing" || d.draftStage === "preview")
        await adm.call("POST", `/api/v1/admin/methodology-versions/${d.id}/discard`, undefined, { ifMatch: d.version });
    const published = await adm.call<{ items: Version[] }>(
      "GET",
      "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published",
    );
    const base = published.items.find((v) => v.isNewestPublished)!;
    await signIn(page, lang, "dev.nobody");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/studio");
    await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
    const create = page.getByRole("dialog");
    await create.getByLabel(fieldLabel(lang, "studio.create.base")).selectOption(base.id);
    await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill("Synthetic FE-G probe");
    await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
    const versionUrl = new URL(page.url()).pathname;
    draftId = versionUrl.split("/").pop()!;
    // The T06 editor: strategic fit 30, financial value 20 (total 100.00); Feasibility score-1 English descriptor.
    await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
    await page.locator("[data-weight='strategic_fit']").fill("30");
    await page.locator("[data-weight='financial_value']").fill("20");
    await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "100.00");
    await page
      .getByLabel(
        tr(lang, "studio.defaults.descriptorLabel", {
          criterion: tr(lang, "studio.criterion.feasibility"),
          score: 1,
          language: tr(lang, "common.language.name.en"),
        }),
        { exact: true },
      )
      .fill("Synthetic: needs capabilities the organization does not have");
    await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
    await expect(page.locator("[data-state='saved-draft']")).toBeVisible();
    await page.goto(versionUrl);
    await ensureLanguage(page, lang);

    // F-DG5-120: the Elements table (Scoring weight) in the page language; F-DG5-121: "Changed" only where it differs.
    const elements = page.locator("[data-table='elements']");
    const row = (key: string) => elements.locator(`[data-element='scoring_weight:${key}']`);
    await expect(row("strategic_fit")).toContainText(lang === "en" ? "Strategic fit" : "الملاءمة الاستراتيجية");
    await expect(row("strategic_fit")).not.toContainText(lang === "en" ? "الملاءمة الاستراتيجية" : "Strategic fit");
    await expect(row("strategic_fit").locator("[data-element-change]")).toHaveText(
      tr(lang, "studio.diff.kind.changed"),
    );
    await expect(row("financial_value").locator("[data-element-change]")).toHaveText(
      tr(lang, "studio.diff.kind.changed"),
    );
    await expect(row("feasibility").locator("[data-element-change]")).toHaveText(tr(lang, "studio.elements.unchanged"));
    await elements.scrollIntoViewIfNeeded();
    await shot(page, lang, "f120-f121-elements-scoring-weights");

    // F-DG5-121: the rubric diff reads level by level, never raw JSON; one Changed marker for the one changed level.
    const diff = page.locator("[data-table='diff']");
    await expect(diff.locator("tr[data-rubric-level]")).toHaveCount(1);
    await expect(diff.locator("tr[data-rubric-level='1']")).toContainText(
      "Synthetic: needs capabilities the organization does not have",
    );
    const text = (await diff.textContent()) ?? "";
    expect(text).not.toMatch(/[{"]/);
    await expect(page.locator("#diff [data-legend='changed']")).toHaveText(tr(lang, "studio.diff.changedLegend"));
    await diff.scrollIntoViewIfNeeded();
    await shot(page, lang, "f121-rubric-diff");
  } finally {
    if (draftId) {
      const d = await adm.call<Version>("GET", `/api/v1/admin/methodology-versions/${draftId}`);
      if (d.draftStage === "editing" || d.draftStage === "preview")
        await adm.call("POST", `/api/v1/admin/methodology-versions/${draftId}/discard`, undefined, {
          ifMatch: d.version,
        });
    }
    await revoke();
  }
});

test("F-DG5-125: 2,150 readable transformations: the overview filter and the Finance queue say the list is incomplete", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const rows = Array.from({ length: 2150 }, (_, n) => ({
    id: `01920000-0000-7000-9000-${(0xc00000000 + n).toString(16).padStart(12, "0")}`,
    organizationId: ORG,
    code: `SYN-${String(n).padStart(4, "0")}`,
    name: `Synthetic transformation ${n}`,
    businessUnitId: SYN_RETAIL,
    currentPhase: "diagnose",
    status: "active",
    archivedAt: null,
  }));
  await page.route(/\/api\/v1\/transformations\?/, async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const limit = Number(q.get("limit") ?? "50");
    const from = Number(q.get("cursor") ?? "0");
    await route.fulfill({
      json: { items: rows.slice(from, from + limit), nextCursor: rows.length > from + limit ? String(from + limit) : null },
    });
  });
  await page.route(/\/api\/v1\/transformations\/[^/]+\/finance-validations/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await signIn(page, lang, "dev.office");
  const notice = tr(lang, "common.table.listIncomplete", { n: 2000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/executive-overview");
  await expect(page.locator("[data-filter-bar] [data-state='list-incomplete']")).toHaveText(notice, { timeout: 30_000 });
  await expect(page.locator("select[data-filter='transformation'] option")).toHaveCount(2001);
  await page.locator("[data-filter-bar]").scrollIntoViewIfNeeded();
  await shot(page, lang, "f125-executive-overview-filter");
  await page.goto("/finance-validation");
  await expect(page.locator("#finance-queue [data-state='list-incomplete']")).toHaveText(notice, { timeout: 60_000 });
  await shot(page, lang, "f125-finance-queue");
});
