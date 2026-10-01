// qa-verifier, DG1 round 3: PROBE for the stale-session observation (FE4 handback §4; finding raised by qa-verifier).
// After a business-unit-scoped Lead creates a record, the SPA's cached /api/v1/me (staleTime 60 s,
// refetchOnWindowFocus) does not yet hold the derived transformation-scope grant, so the record's audit trail and Edit
// control are hidden. This probe measures (a) immediately after create, (b) after 61 s plus a window-focus signal
// (visibilitychange + focus, as a user switching back to the tab), without a full reload.
//
// Run (disposable clone with `pnpm -r build`):
//   mkdir -p e2e/qa-r3p && cp <this file> e2e/qa-r3p/ && \
//   QA_E2E_PG_PORT=5473 e2e/support/qa-stack.sh npx playwright test e2e/qa-r3p --workers=1 --project=chromium-en
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const I18N = join(process.cwd(), "apps", "web", "src", "i18n");
function tr(key: string): string {
  const [ns, ...rest] = key.split(".");
  let node: unknown = JSON.parse(readFileSync(join(I18N, "en", `${ns}.json`), "utf8"));
  for (const part of rest) node = (node as Record<string, unknown>)[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${key}`);
  return node;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function counts(page: Page) {
  const audit = await page.getByRole("region", { name: tr("transformations.audit.title"), exact: true }).count();
  const edit = await page.getByRole("link", { name: new RegExp(`^\\s*${esc(tr("common.action.edit"))}`) }).count();
  return { audit, edit };
}

test("stale session after a BU lead's create: immediate vs after 61 s + focus (no reload)", async ({ page }, info) => {
  test.setTimeout(120_000);
  let meCalls = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/me") meCalls++;
  });
  await page.goto("/login");
  const field = page.getByLabel(new RegExp(`^${esc(tr("auth.dev.username"))}|^اسم المستخدم`));
  await field.fill("dev.lead");
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  if ((await page.locator("html").getAttribute("lang")) !== "en") {
    await page.getByRole("button", { name: /English/ }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/transformations/new");
  const select = page.getByLabel(new RegExp(`^${esc(tr("transformations.field.businessUnit"))}`));
  const retail = await select.locator("option", { hasText: "SYN-RETAIL" }).first().getAttribute("value");
  await select.selectOption(retail!);
  await page.getByLabel(new RegExp(`^${esc(tr("transformations.field.name"))}`)).fill(`QA r3 probe ${Date.now()}`);
  await page.getByRole("button", { name: tr("transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const meBefore = meCalls;
  const immediate = await counts(page);

  await page.waitForTimeout(61_000);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(2_000);
  const afterFocus = await counts(page);
  const result = `immediately after create: audit=${immediate.audit} edit=${immediate.edit}; after 61 s + focus signal (no reload): audit=${afterFocus.audit} edit=${afterFocus.edit}; /api/v1/me refetched after create: ${meCalls - meBefore} time(s)`;
  info.annotations.push({ type: "probe", description: result });
  console.log(`[${info.project.name}] ${result}`);
  // Expected per the code reading (staleTime 60 s + refetchOnWindowFocus): hidden at first, shown after the refetch.
  expect(immediate).toEqual({ audit: 0, edit: 0 });
  expect(afterFocus).toEqual({ audit: 1, edit: 1 });
});
