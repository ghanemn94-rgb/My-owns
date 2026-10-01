// qa-verifier, DG1 round 4 (F-DG1-210): independent end-to-end check that a business-unit-scoped Lead can go from
// create -> Edit (save) -> Archive on the new record WITHOUT a full page reload, in English LTR and Arabic RTL.
// It also checks that the client is not over-granted: the refreshed GET /me adds only a transformation-scope grant for
// the new record (the server's derived assignment, F-DG1-106) and nothing wider.
// All data is SYNTHETIC (seeded dev users; names created here). Not part of the candidate.
//
// Run (disposable clone, `pnpm -r build`):
//   mkdir -p e2e/qa-r4 && cp <this file> e2e/qa-r4/ && \
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_E2E_PG_PORT=5493 e2e/support/qa-stack.sh \
//     npx playwright test e2e/qa-r4 --workers=1
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Lang = "ar" | "en";
const I18N = join(process.cwd(), "apps", "web", "src", "i18n");
function tr(lang: Lang, key: string): string {
  const [ns, ...rest] = key.split(".");
  let node: unknown = JSON.parse(readFileSync(join(I18N, lang, `${ns}.json`), "utf8"));
  for (const part of rest) node = (node as Record<string, unknown>)[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${key}`);
  return node;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (s: string) => new RegExp(`^\\s*${esc(s)}\\s*$`);
const label = (lang: Lang, key: string) =>
  new RegExp(`^${esc(tr(lang, key))}(?:\\s*\\(${esc(tr(lang, "common.form.required"))}\\))?$`);
const langOf = (info: TestInfo): Lang => (info.project.name.endsWith("-ar") ? "ar" : "en");
const SHOTS = process.env["QA_EVIDENCE_DIR"] ?? join(process.cwd(), "test-results", "qa-r4");

type Grant = { scope: { type: string; id: string }; inheritsDownward: boolean; permissions: string[] };

async function marker(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __qaNoReload?: boolean }).__qaNoReload === true);
}

test("BU Lead: create -> Edit (save) -> Archive without a reload; refreshed /me adds only the new record's grant", async ({
  page,
}, info) => {
  const lang = langOf(info);
  let documentLoads = 0;
  page.on("load", () => documentLoads++);
  const meBodies: { at: number; grants: Grant[] }[] = [];
  let createdAt = Number.POSITIVE_INFINITY;
  page.on("response", async (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/v1/me" && r.request().method() === "GET" && r.status() === 200) {
      const at = Date.now();
      meBodies.push({ at, grants: ((await r.json()) as { effectivePermissions: Grant[] }).effectivePermissions });
    }
    if (path === "/api/v1/transformations" && r.request().method() === "POST" && r.status() === 201) createdAt = Date.now();
  });

  // Sign in as dev.lead (TL at SYN-RETAIL, business-unit scope only).
  await page.goto("/login");
  const field = page.getByLabel(
    new RegExp(`^(?:${label("ar", "auth.dev.username").source.slice(1, -1)}|${label("en", "auth.dev.username").source.slice(1, -1)})$`),
  );
  await field.fill("dev.lead");
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await expect(page.getByTestId("wordmark")).toBeVisible();
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    await page.getByRole("button", { name: lang === "en" ? /English/ : /العربية/ }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");

  // Client-side navigation to the create form (the marker must survive everything from here on).
  await page.goto("/transformations/new");
  await page.evaluate(() => {
    (window as unknown as { __qaNoReload?: boolean }).__qaNoReload = true;
  });
  const loadsBefore = documentLoads;
  const grantsBefore = meBodies.at(-1)?.grants ?? [];
  await page
    .getByLabel(label(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "التجزئة (اصطناعي) (SYN-RETAIL)" : "Synthetic Retail (SYN-RETAIL)" });
  const name = `QA r4 ${lang.toUpperCase()} lead ${Date.now()}`;
  await page.getByLabel(label(lang, "transformations.field.name")).fill(name);
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1)!;

  // 1. Controls and audit trail are there at once, with no reload and no extra wait beyond the default expect timeout.
  const main = page.locator("main#main");
  await expect(main.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) })).toBeVisible();
  await expect(main.getByRole("button", { name: exactly(tr(lang, "transformations.archive.action")) })).toBeVisible();
  await expect(page.getByRole("region", { name: tr(lang, "transformations.audit.title"), exact: true })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `${lang}-01-after-create.png`), fullPage: true });

  // 2. No over-grant: the /me read after the 201 differs from before only by a transformation-scope grant for `id`.
  const after = meBodies.filter((m) => m.at >= createdAt);
  expect(after.length, "GET /me re-read after the create").toBeGreaterThan(0);
  const key = (g: Grant) => JSON.stringify([g.scope, g.inheritsDownward, [...g.permissions].sort()]);
  const beforeKeys = new Set(grantsBefore.map(key));
  const added = after.at(-1)!.grants.filter((g) => !beforeKeys.has(key(g)));
  expect(added.length).toBeGreaterThan(0);
  for (const g of added) {
    expect(g.scope).toEqual({ type: "transformation", id });
    expect(g.inheritsDownward).toBe(false);
  }

  // 3. Edit and save, still without a reload.
  await main.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) }).click();
  await page.waitForURL(new RegExp(`/transformations/${id}/edit$`));
  await page.getByLabel(label(lang, "transformations.field.name")).fill(`${name} (edited)`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("(edited)");

  // 4. Archive with a reason, still without a reload.
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "common.form.reason")).fill("QA r4 synthetic archive");
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("QA r4 synthetic archive");
  await expect(page.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) })).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, `${lang}-02-after-edit-archive.png`), fullPage: true });

  // 5. Server agrees: the record is archived with the edited name.
  const rec = (await (await page.request.get(`/api/v1/transformations/${id}`)).json()) as {
    name: string;
    archivedAt: string | null;
  };
  expect(rec.name).toBe(`${name} (edited)`);
  expect(rec.archivedAt).not.toBeNull();

  expect(await marker(page), "window marker survived: no document reload").toBe(true);
  expect(documentLoads - loadsBefore, "no 'load' event after the create form opened").toBe(0);
  console.log(
    `[${info.project.name}] id=${id} /me reads after 201=${after.length} added grants=${JSON.stringify(added.map((g) => g.scope))} documentLoads after form=${documentLoads - loadsBefore}`,
  );
});
