// T-DG7-FE-A visual evidence: the P7 Administration entries and placeholders in English LTR and Arabic RTL, on the real
// stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, SYNTHETIC dev users, API serving apps/web/dist).
// Signs in as the synthetic dev.admin (ADM_ACCESS + ADM_TECH), runs axe (WCAG 2.0/2.1 A+AA) on each screen, checks the
// keyboard path to a P7 nav entry, and writes full-page screenshots plus a JSON summary to OUT.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.env.REPO_ROOT;
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT;
const cat = (lang, ns) => require(join(ROOT, "apps/web/src/i18n", lang, `${ns}.json`));
const SCREENS = [
  ["admin", "/admin", null],
  ["data-export", "/admin/migration/exports", "dataExport"],
  ["migration-status", "/admin/migration/imports", "migrationStatus"],
  ["reconciliation", "/admin/migration/imports/01920000-0000-7000-9000-00000000e002/reconciliations/01920000-0000-7000-9000-00000000e003", "migrationReconciliation"],
  ["config-transfer", "/admin/config-transfer", "configTransfer"],
  ["retention", "/admin/retention", "retention"],
  ["requirements", "/admin/requirements", "requirements"],
  ["about", "/admin/about", "releaseAbout"],
];
const summary = { base: BASE, user: "dev.admin (SYNTHETIC)", results: [] };
const browser = await chromium.launch();
let failures = 0;
for (const lang of ["en", "ar"]) {
  mkdirSync(join(OUT, lang), { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const foreign = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) foreign.push(r.url());
  });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(/^(Synthetic user name|اسم المستخدم الاصطناعي)/);
  await field.fill("dev.admin");
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await page.locator("main#main h1").waitFor();
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    const other = lang === "en" ? "ar" : "en";
    const names = { en: "English", ar: "العربية" };
    const label = cat(other, "common").language.switchTo.replace("{{language}}", names[lang]);
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  const nav = cat(lang, "nav");
  for (const [name, path, feature] of SCREENS) {
    await page.goto(`${BASE}${path}`);
    const h1 = page.locator("main#main h1");
    await h1.waitFor();
    const heading = (await h1.textContent())?.trim();
    const dir = await page.locator("html").getAttribute("dir");
    const htmlLang = await page.locator("html").getAttribute("lang");
    const placeholder = feature ? await page.locator(`[data-p7-feature='${feature}']`).count() : null;
    const expected = feature ? nav.p7[feature].title : nav.areas.admin.label;
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const file = join(OUT, lang, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const ok = heading === expected && dir === (lang === "ar" ? "rtl" : "ltr") && htmlLang === lang && serious.length === 0 && (feature ? placeholder === 1 : true);
    if (!ok) failures++;
    summary.results.push({ lang, name, path, heading, expected, dir, htmlLang, placeholder, axeViolations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), ok });
  }
  // Keyboard: Tab from the top of /admin reaches the Retention entry with a visible focus; Enter opens it.
  await page.goto(`${BASE}/admin`);
  await page.locator("main#main h1").waitFor();
  const target = nav.sub.retention;
  let reached = false;
  let outline = null;
  for (let i = 0; i < 120 && !reached; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent?.trim(), href: el.getAttribute("href"), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow };
    });
    if (info && info.href === "/admin/retention") { reached = true; outline = info; }
  }
  if (reached) {
    await page.screenshot({ path: join(OUT, lang, "keyboard-focus-retention.png"), fullPage: false });
    await page.keyboard.press("Enter");
    await page.waitForURL("**/admin/retention");
  }
  // Wait for the lazily loaded page's own heading (the URL changes before the new page renders).
  const opened = reached
    ? await page
        .locator("main#main h1", { hasText: nav.p7.retention.title })
        .waitFor({ timeout: 10000 })
        .then(() => true, () => false)
    : false;
  const kbOk = opened && (outline.outline !== "none 0px" || outline.shadow !== "none");
  if (!kbOk) failures++;
  summary.results.push({ lang, name: "keyboard", target, reached, opened, focusStyle: outline, ok: kbOk });
  summary.results.push({ lang, name: "origin", foreignRequests: foreign, ok: foreign.length === 0 });
  if (foreign.length) failures++;
  await context.close();
}
await browser.close();
summary.failures = failures;
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`p7-shots: ${summary.results.length} checks, ${failures} failed; ${OUT}`);
process.exit(failures ? 1 : 0);
