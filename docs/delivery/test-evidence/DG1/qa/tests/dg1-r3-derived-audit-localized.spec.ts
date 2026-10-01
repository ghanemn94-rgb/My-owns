// qa-verifier, DG1 round 3 (independent; written during the review of frozen candidate f0baa87d0163560f, so it lives
// under docs/delivery/test-evidence/DG1/qa/tests/ and is promoted to e2e/ by the orchestrator in the next stage).
//
// Re-tests F-DG1-005 / F-DG1-008 on the REAL stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations,
// SYNTHETIC dev seed), with HARD assertions (the round-2 spec used soft ones):
//   - a BU-scoped Transformation Lead (dev.lead @ SYN-RETAIL) creates a record through the UI;
//   - the server really wrote the derived scoped_assignment.create event (API cross-check of /audit), so the UI label
//     maps a real event and is not a filtered-out row;
//   - the record's audit trail shows that event with the localized action, field and role labels and the creator's
//     display name, in AR (RTL) and EN (LTR); no raw action code, camelCase key, JSON, UUID, bare role code or
//     "without a translation" marker anywhere in the trail.
// Plus a PROBE (recorded, not asserted) of the FE4-handback observation: right after the create, before any reload,
// is the audit trail / Edit control shown? The result is written to the test annotations and the console.
//
// Run (from a disposable clone with `pnpm -r build`):
//   mkdir -p e2e/qa-r3 && cp <this file> e2e/qa-r3/ && \
//   QA_E2E_PG_PORT=5473 QA_EVIDENCE_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/qa-r3 --workers=1
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Lang = "ar" | "en";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? join("test-results", "qa-r3");
const I18N = join(process.cwd(), "apps", "web", "src", "i18n");

function tr(lang: Lang, key: string): string {
  const [ns, ...rest] = key.split(".");
  let node: unknown = JSON.parse(readFileSync(join(I18N, lang, `${ns}.json`), "utf8"));
  for (const part of rest) node = (node as Record<string, unknown>)[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${key}`);
  return node;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const langOf = (info: TestInfo): Lang => (info.project.name.endsWith("-ar") ? "ar" : "en");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${info.project.name}--${name}.png`), fullPage: true });
}

async function signIn(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  const field = page.getByLabel(
    new RegExp(`^(?:${esc(tr("ar", "auth.dev.username"))}|${esc(tr("en", "auth.dev.username"))})`),
  );
  await field.fill(username);
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    await page.getByRole("button", { name: lang === "en" ? /English/ : /العربية/ }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

test.describe.configure({ mode: "serial" });

test("F-DG1-005/008: BU lead's derived creator assignment is localized on the record's audit trail", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const name = `QA r3 synthetic ${lang.toUpperCase()} ${Date.now()}`;
  await signIn(page, lang, "dev.lead");

  await page.goto("/transformations/new");
  await page
    .getByLabel(new RegExp(`^${esc(tr(lang, "transformations.field.businessUnit"))}`))
    .selectOption({ label: lang === "ar" ? "التجزئة (اصطناعي) (SYN-RETAIL)" : "Synthetic Retail (SYN-RETAIL)" });
  await page.getByLabel(new RegExp(`^${esc(tr(lang, "transformations.field.name"))}`)).fill(name);
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);

  // ---- PROBE (not asserted): post-create page before any reload.
  const auditTitle = tr(lang, "transformations.audit.title");
  const regionBefore = await page.getByRole("region", { name: auditTitle, exact: true }).count();
  const editBefore = await page
    .getByRole("link", { name: new RegExp(`^\\s*${esc(tr(lang, "common.action.edit"))}`) })
    .count();
  await shot(page, info, "01-post-create-before-reload");
  // Probe continued: in-app (client-side) navigation away and back, still without a full reload.
  await page.evaluate((path) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, "/transformations");
  await page.waitForURL("**/transformations");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate((path) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/transformations/${id}`);
  await page.waitForURL(new RegExp(`/transformations/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  const regionSpa = await page.getByRole("region", { name: auditTitle, exact: true }).count();
  const editSpa = await page
    .getByRole("link", { name: new RegExp(`^\\s*${esc(tr(lang, "common.action.edit"))}`) })
    .count();
  await shot(page, info, "01b-post-create-spa-navigation");

  // ---- API cross-check: the server wrote the derived assignment event for THIS record.
  const auditRes = await page.request.get(`/api/v1/transformations/${id}/audit`);
  expect(auditRes.status()).toBe(200);
  const auditBody = (await auditRes.json()) as { items?: { action: string; [k: string]: unknown }[] };
  const actions = (auditBody.items ?? []).map((e) => e.action);
  expect(actions).toContain("transformation.create");
  expect(actions).toContain("scoped_assignment.create");
  const derived = (auditBody.items ?? []).find((e) => e.action === "scoped_assignment.create")!;
  expect(JSON.stringify(derived)).toContain("derivedFromAssignmentId");

  // ---- After a reload: localized trail (hard assertions).
  await page.reload();
  const regionAfter = page.getByRole("region", { name: auditTitle, exact: true });
  await expect(regionAfter).toBeVisible();
  const editAfter = await page
    .getByRole("link", { name: new RegExp(`^\\s*${esc(tr(lang, "common.action.edit"))}`) })
    .count();
  const probe = `post-create before reload: auditTrailRegions=${regionBefore}, editLinks=${editBefore}; after in-app navigation list->record (no reload): auditTrailRegions=${regionSpa}, editLinks=${editSpa}; after reload: auditTrailRegions=1, editLinks=${editAfter}`;
  info.annotations.push({ type: "probe-stale-session", description: probe });
  console.log(`[${info.project.name}] ${probe}`);

  const derivedLabel = tr(lang, "transformations.audit.actions.scoped_assignment_create_derived");
  const row = regionAfter
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: derivedLabel, exact: true }) });
  await expect(row).toHaveCount(1);
  const rowText = (await row.innerText()).trim();
  expect(rowText).toContain(tr(lang, "transformations.audit.role.TL"));
  expect(rowText).toContain("Synthetic Transformation Lead");
  expect(rowText).toContain(tr(lang, "transformations.audit.value.thisTransformation"));
  for (const f of ["user_id", "role_code", "scope", "effective_to", "derived_from_assignment_id"]) {
    expect(rowText, `field label ${f}`).toContain(tr(lang, `transformations.audit.field.${f}`));
  }
  // The transformation's own create row is localized too (F-DG1-005 baseline).
  await expect(regionAfter).toContainText(tr(lang, "transformations.mode.end_to_end"));

  const text = await regionAfter.innerText();
  for (const raw of [
    "scoped_assignment",
    "transformation.create",
    "userId",
    "roleCode",
    "effectiveTo",
    "derivedFromAssignmentId",
    "end_to_end",
    "business_unit_id",
    '{"',
    '"type"',
    tr(lang, "transformations.audit.untranslatedField"),
    tr(lang, "transformations.audit.untranslatedValue"),
    tr(lang, "transformations.audit.untranslatedAction"),
  ]) {
    expect(text, `raw/untranslated '${raw}' in the audit trail`).not.toContain(raw);
  }
  // The source assignment's id ("Carried over from assignment: None -> <uuid>") is a technical identifier without a
  // catalogue label (allowed by the F-DG1-005 standard); every OTHER line must be free of raw UUIDs.
  const fromLabel = tr(lang, "transformations.audit.field.derived_from_assignment_id");
  const otherLines = text.split("\n").filter((l) => !l.includes(fromLabel));
  expect(otherLines.join("\n"), "a raw UUID in the audit trail (outside the source-assignment line)").not.toMatch(UUID);
  const fromLine = text.split("\n").find((l) => l.includes(fromLabel)) ?? "";
  info.annotations.push({ type: "source-assignment-line", description: fromLine });
  console.log(`[${info.project.name}] source-assignment line: ${fromLine}`);
  expect(text, "a bare role code TL in the audit trail").not.toMatch(/(^|[^A-Za-z])TL([^A-Za-z]|$)/);

  // Direction: the trail inherits the document direction.
  const dir = await regionAfter.evaluate((el) => getComputedStyle(el).direction);
  expect(dir).toBe(lang === "ar" ? "rtl" : "ltr");
  await regionAfter.scrollIntoViewIfNeeded();
  await shot(page, info, "02-derived-audit-localized");
});
