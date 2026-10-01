// qa-verifier, DG1 round 2 (independent; written during review of frozen candidate 991d3241..., so it lives under
// docs/delivery/test-evidence/DG1/qa/tests/ and is promoted to e2e/ by the orchestrator in the next stage).
//
// Verifies against the REAL stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations, SYNTHETIC dev seed):
//   F-DG1-004  a Transformation Lead with a BUSINESS-UNIT grant (dev.lead @ SYN-RETAIL) who creates a transformation
//              lands on its detail page (no dead "Not found"), and the record is still reachable after a reload
//              (server-loaded, not client-cached state).
//   F-DG1-001  the edit form never offers the governed `closed` status (draft and active), and the API refuses a
//              direct PATCH status=closed with 422 (consistency between web and API).
//   F-DG1-005  the audit-trail "Changes" column shows localized labels (status, mode, phase, field names) in AR and
//              EN, no raw snake_case keys / enum codes, and no "without a translation" fallback markers.
// Plus a cross-scope negative: the same record is not visible to a lead without a grant on it (dev.nobody -> 404).
//
// Run (from a disposable clone with `pnpm -r build`):
//   mkdir -p e2e/qa-r2 && cp <this file> e2e/qa-r2/ && \
//   QA_E2E_PG_PORT=5452 QA_EVIDENCE_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/qa-r2 --workers=1
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Lang = "ar" | "en";
const BASE = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? join("test-results", "qa-r2");
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

async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${info.project.name}--${name}.png`), fullPage: true });
}

async function signIn(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  const field = page.getByLabel(new RegExp(`${esc(tr("ar", "auth.dev.username"))}|${esc(tr("en", "auth.dev.username"))}`));
  await field.fill(username);
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await expect(page.locator("main#main h1")).toBeVisible();
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    await page.getByRole("button", { name: lang === "en" ? /English/ : /العربية/ }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function statusOptionValues(page: Page, lang: Lang): Promise<string[]> {
  const select = page.getByLabel(new RegExp(`^${esc(tr(lang, "transformations.field.status"))}`));
  await expect(select).toBeVisible();
  return select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
}

async function save(page: Page, lang: Lang, id: string) {
  await page.getByRole("button", { name: tr(lang, "common.action.save") }).click();
  await page.waitForURL(new RegExp(`/transformations/${id}$`));
}

test.describe.configure({ mode: "serial" });

test("BU-scoped lead: create -> reachable detail; no governed 'closed'; localized audit trail", async ({ page }, info) => {
  const lang = langOf(info);
  const name = `QA r2 synthetic ${lang.toUpperCase()} ${Date.now()}`;
  await signIn(page, lang, "dev.lead");

  // ---- F-DG1-004: create in the lead's business unit, land on a reachable detail page.
  await page.goto("/transformations/new");
  await page
    .getByLabel(tr(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "التجزئة (اصطناعي) (SYN-RETAIL)" : "Synthetic Retail (SYN-RETAIL)" });
  await page.getByLabel(new RegExp(`^${esc(tr(lang, "transformations.field.name"))}`)).fill(name);
  await page.getByRole("radio", { name: new RegExp(esc(tr(lang, "transformations.mode.end_to_end"))) }).check();
  await page.getByRole("button", { name: tr(lang, "transformations.form.create") }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByText(tr(lang, "common.state.notFoundTitle"), { exact: true })).toHaveCount(0);
  await expect(page.getByText(tr(lang, "transformations.createdNotVisible.title"))).toHaveCount(0);
  await shot(page, info, "01-lead-after-create");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByText(tr(lang, "common.state.notFoundTitle"), { exact: true })).toHaveCount(0);
  const api = await page.request.get(`/api/v1/transformations/${id}`);
  expect(api.status()).toBe(200);

  // ---- F-DG1-001: draft offers no 'closed'; move to active; active offers no 'closed'.
  await page.goto(`/transformations/${id}/edit`);
  const draftOptions = await statusOptionValues(page, lang);
  expect(draftOptions).toContain("draft");
  expect(draftOptions).not.toContain("closed");
  await page.getByLabel(new RegExp(`^${esc(tr(lang, "transformations.field.status"))}`)).selectOption("active");
  await save(page, lang, id);
  await page.goto(`/transformations/${id}/edit`);
  const activeOptions = await statusOptionValues(page, lang);
  expect(activeOptions.sort()).toEqual(["active", "on_hold"]);
  await shot(page, info, "02-edit-active-status-options");
  // API agrees: a direct status=closed is refused (422), and the record is unchanged.
  const me = await (await page.request.get("/api/v1/me")).json();
  const cur = await (await page.request.get(`/api/v1/transformations/${id}`)).json();
  const close = await page.request.patch(`/api/v1/transformations/${id}`, {
    headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${cur.version}"`, Origin: BASE },
    data: { status: "closed" },
  });
  expect(close.status()).toBe(422);
  const after = await (await page.request.get(`/api/v1/transformations/${id}`)).json();
  expect(after.status).toBe("active");
  expect(after.version).toBe(cur.version);

  // ---- F-DG1-005: localized audit "Changes".
  await page.goto(`/transformations/${id}`);
  const region = page.getByRole("region", { name: tr(lang, "transformations.audit.title") });
  await expect(region).toBeVisible();
  await expect(region).toContainText(tr(lang, "transformations.status.active"));
  await expect(region).toContainText(tr(lang, "transformations.status.draft"));
  await expect(region).toContainText(tr(lang, "transformations.mode.end_to_end"));
  await expect(region).toContainText(tr(lang, "transformations.field.status"));
  const text = (await region.innerText()).toLowerCase();
  for (const raw of ["end_to_end", "current_phase", "entry_phase", "business_unit_id", "lead_user_id", ":status", ":mode"]) {
    expect(text, `raw code '${raw}' in the audit trail`).not.toContain(raw);
  }
  await region.scrollIntoViewIfNeeded();
  await shot(page, info, "03-audit-trail-localized");
  // Soft: recorded as a failure, but the remaining (negative) steps still run and produce evidence.
  expect.soft(text, "audit trail shows an untranslated field").not.toContain(
    tr(lang, "transformations.audit.untranslatedField").toLowerCase(),
  );
  expect.soft(text, "audit trail shows an untranslated value").not.toContain(
    tr(lang, "transformations.audit.untranslatedValue").toLowerCase(),
  );
  expect.soft(text, "audit trail shows a raw action code").not.toContain("scoped_assignment.create");

  // ---- negative: a user without any grant cannot see the record (404, not leaked).
  await page.getByRole("button", { name: tr(lang, "auth.signOut") }).click();
  await page.waitForURL("**/login**");
  await signIn(page, lang, "dev.nobody");
  const denied = await page.request.get(`/api/v1/transformations/${id}`);
  expect(denied.status()).toBe(404);
});
