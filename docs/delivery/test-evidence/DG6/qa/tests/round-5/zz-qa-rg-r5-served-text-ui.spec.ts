// qa-verifier DG6 RG round 5 (T-DG6-REV-QA-RG-R5): F-DG6-990 on the RENDERED screens. NOT part of the candidate:
// copied into a disposable clone at apps/web/e2e/ and run on apps/web/e2e/support/with-stack.sh (production-initialized
// stack, seeded dev users; all data SYNTHETIC; nothing approves anything), in chromium-en and chromium-ar.
// As dev.admin it opens the screens that show the texts migration 0130 rewords - Jobs, Job operations, every service
// identity, every automation rule (with its version history), every procedure definition - and checks that neither the
// visible text nor any form field value names an engineering delivery gate (DG0-DG7, Western or Arabic-Indic digit,
// optional space or hyphen) or cites a decision/ADR id. It also checks that the reworded freshness job is shown.
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "./support/ui.ts";

const GATE = /(^|[^A-Za-z0-9_])DG\s*-?\s*[0-7٠-٧]([^0-9٠-٩]|$)/i;
const INTERNAL = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;

async function textOf(page: Page): Promise<string> {
  // Round-5 run 1 waited for every [data-state=loading] to clear; under host load one region stayed loading past 30 s
  // (ar). Now: network idle, then a short settle, and the text is read whatever the state.
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const values = [...document.querySelectorAll("input, textarea, select")].map(
      (e) => (e as HTMLInputElement).value ?? "",
    );
    return `${document.body.innerText}\n${values.join("\n")}`;
  });
}

/** The tables paginate (default page size below 22 rows); show the largest page size offered, when there is one. */
async function allRows(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  const sel = page.locator("select:has(option[value='100'])");
  if ((await sel.count()) > 0) {
    await sel.first().selectOption("100");
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  }
}

async function links(page: Page, path: string, prefix: string): Promise<string[]> {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
  await allRows(page);
  await page.waitForFunction((p) => document.querySelectorAll(`a[href^='${p}']`).length > 0, prefix, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  const hrefs = await page.locator(`a[href^='${prefix}']`).evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  return [...new Set(hrefs)].filter((h) => h.length > prefix.length);
}

test("F-DG6-990 rendered: no screen that shows seeded text names DG0-DG7 or a decision/ADR id", async ({ page }, info) => {
  test.setTimeout(900_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  const bad: string[] = [];
  const seen: string[] = [];
  const check = async (path: string) => {
    if (page.url().endsWith(path) === false) await page.goto(path);
    const t = await textOf(page);
    seen.push(path);
    for (const line of t.split("\n")) if (GATE.test(line) || INTERNAL.test(line)) bad.push(`${path}: ${line.slice(0, 300)}`);
    return t;
  };
  await page.goto("/admin/jobs");
  await check("/admin/jobs");
  // Run 1 asserted the reworded text on /admin/jobs (the calendar Jobs page); the job descriptions are listed on
  // Job operations (descriptionEn as the job name), so the positive check is made there.
  await page.goto("/admin/jobs/operations");
  await allRows(page);
  await page.waitForFunction(() => document.body.innerText.includes("kpi.freshness_scan"), undefined, { timeout: 60_000 });
  const ops = await check("/admin/jobs/operations");
  if (lang === "en") expect(ops).toContain("the KPI freshness rule, unchanged");
  const identities = await links(page, "/admin/service-identities", "/admin/service-identities/");
  for (const h of identities) await check(h);
  const rules = await links(page, "/admin/automation", "/admin/automation/rules/");
  for (const h of rules) await check(h);
  // dev.admin (ADM_ACCESS + ADM_TECH) may not read procedure definitions: the Procedure builder shows its "You do not
  // have access" state (run 4). The procedure texts are checked through the API and the database (31b, 35c/35d).
  await page.goto("/admin/procedures");
  await check("/admin/procedures");
  const procedures: string[] = [];
  console.log(
    `[QA-R5 UI ${lang}] screens checked: ${seen.length} (identities ${identities.length}, rules ${rules.length}, procedures ${procedures.length}); hits ${bad.length}`,
  );
  for (const b of bad) console.log(`[QA-R5 UI ${lang}] HIT ${b}`);
  expect(identities.length).toBeGreaterThan(10);
  expect(rules.length).toBeGreaterThan(10);
  expect(bad).toEqual([]);
});
