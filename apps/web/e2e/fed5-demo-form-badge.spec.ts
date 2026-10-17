// T-DG5-FE-D5 (D-167; QA-E2 D-QA-E2-1; REQ-S18-001; ADR-0050 §1 and §2 b): the demo record badge in form and dialog
// headers is rendered ONLY in a demo database. On the production-marked stack (apps/web/e2e/support/with-stack.sh,
// `mth-db seed-dev`): the server answers `synthetic: false`, and the edit form page's header, the create form page's
// header and a create dialog's header (Diagnose › "Add baseline", the shared RecordDialog/Dialog header) carry NO
// badge and no banner, in chromium-en and chromium-ar. The demo side (the badge IS shown) is the root spec
// e2e/a02-demo-labels.spec.ts on e2e/support/with-demo-stack.sh. Everything here is SYNTHETIC.
import { expect, test, type Page } from "@playwright/test";
import { apiSession, expectAccessible, langOf, shot, signIn, SYN_RETAIL, tr, trackRequests } from "./support/ui.ts";

test.setTimeout(120_000);

/** Opens `url` and waits for the server's environment answer, so "no badge" is not checked before it could appear. */
async function openAndReadEnvironment(page: Page, url: string): Promise<{ synthetic: boolean }> {
  const env = page.waitForResponse((r) => r.url().endsWith("/api/v1/environment") && r.request().method() === "GET");
  await page.goto(url);
  await expect(page.locator("main#main h1")).toBeVisible();
  return (await (await env).json()) as { synthetic: boolean };
}

test("production database: no demo record badge in form page headers or a create dialog header", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-D5 ${lang.toUpperCase()} form headers ${Date.now()}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");

  // The edit form page: the server says production, and the h1's block carries no badge.
  const env = await openAndReadEnvironment(page, `/transformations/${created.id}/edit`);
  expect(env.synthetic).toBe(false);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transformations.editTitle"));
  await expect(page.locator("main#main h1").locator("xpath=..").locator("[data-state='demo-record']")).toHaveCount(0);
  await expect(page.locator("[data-state='demo-synthetic']")).toHaveCount(0);
  await shot(page, lang, "fed5-production-edit-form-header");
  await expectAccessible(page, lang, "fed5-production-edit-form-header");

  // The create form page.
  await page.goto("/transformations/new");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transformations.createTitle"));
  await expect(page.locator("[data-state='demo-record']")).toHaveCount(0);

  // A create dialog's header (Diagnose › "Add baseline").
  await page.goto(`/transformations/${created.id}/diagnose`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "kpi.baseline.add"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: tr(lang, "kpi.baseline.add") });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".dialog__header h2")).toHaveText(tr(lang, "kpi.baseline.add"));
  await expect(dialog.locator("[data-state='demo-record']")).toHaveCount(0);
  await shot(page, lang, "fed5-production-create-dialog-header");
  await expectAccessible(page, lang, "fed5-production-create-dialog-header");
  // Escape closes the dialog and returns focus to its opener (the header change keeps the dialog's keyboard rules).
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: tr(lang, "kpi.baseline.add"), exact: true })).toBeFocused();

  await lead.req.dispose();
  expect(foreign).toEqual([]);
});
