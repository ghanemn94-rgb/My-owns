// T-DG7-FE-B visual and interaction evidence: Data export, Migration status, Identity rebind and Configuration
// transfer in English LTR and Arabic RTL, on the real stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL,
// SYNTHETIC dev users, API serving apps/web/dist). Signs in as the synthetic dev.admin (ADM_ACCESS + ADM_TECH), runs
// real requests (request an export, export a bundle, download it, upload it, validate it), runs axe (WCAG 2.0/2.1
// A+AA) on each screen, checks a keyboard path, and writes screenshots plus a JSON summary to OUT.
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
const summary = { base: BASE, user: "dev.admin (SYNTHETIC)", results: [] };
let failures = 0;
const record = (entry) => {
  if (!entry.ok) failures++;
  summary.results.push(entry);
};

const browser = await chromium.launch();
for (const lang of ["en", "ar"]) {
  mkdirSync(join(OUT, lang), { recursive: true });
  const tr = cat(lang, "transfer");
  const nav = cat(lang, "nav");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const foreign = [];
  const writes = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
    if (r.method() !== "GET" && u.includes("/api/v1/admin/")) writes.push(`${r.method()} ${new URL(u).pathname}`);
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
  // `extraFn` runs after the page's own heading has rendered (run 1 evaluated it before: a script defect).
  const check = async (name, expectedH1, extraFn = async () => ({})) => {
    const h1 = page.locator("main#main h1", { hasText: expectedH1 });
    const found = await h1.waitFor({ timeout: 15000 }).then(
      () => true,
      () => false,
    );
    await page.waitForLoadState("networkidle");
    const extra = await extraFn();
    const dir = await page.locator("html").getAttribute("dir");
    const htmlLang = await page.locator("html").getAttribute("lang");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await page.screenshot({ path: join(OUT, lang, `${name}.png`), fullPage: true });
    const ok =
      found && dir === (lang === "ar" ? "rtl" : "ltr") && htmlLang === lang && axe.violations.length === 0 && (extra.ok ?? true);
    record({
      lang,
      name,
      url: page.url().replace(BASE, ""),
      heading: found ? expectedH1 : (await page.locator("main#main h1").first().textContent())?.trim(),
      dir,
      htmlLang,
      axeViolations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      ...extra,
      ok,
    });
  };

  // 1. Data export: empty or existing list, then a real export request with a reason (the worker is not running in
  // this harness, so the export stays Queued and its counts stay Unknown: the honest state, never 0).
  await page.goto(`${BASE}/admin/migration/exports`);
  await check("data-export-before", tr.export.title);
  // Keyboard: Tab into the reason field, type, Tab to the button, Enter submits.
  await page.locator("#migration-export-reason").focus();
  await page.keyboard.type(`Synthetic transfer drill (${lang})`);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = el ? getComputedStyle(el) : null;
    return el
      ? { action: el.getAttribute("data-action"), outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow }
      : null;
  });
  await page.screenshot({ path: join(OUT, lang, "keyboard-focus-request-export.png"), fullPage: false });
  await page.keyboard.press("Enter");
  const requested = await page
    .getByText(tr.export.requested)
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      // A second request while the first is queued is refused with 422 migration.export_in_progress (the ar pass).
      async () => (await page.locator("[data-problem='migration.export_in_progress']").count()) === 1,
    );
  const kbOk = focused?.action === "request-export" && (focused.outline !== "none 0px" || focused.shadow !== "none");
  record({ lang, name: "keyboard-request-export", focused, requestedOrInProgress: requested, ok: kbOk && requested });
  await check("data-export-after-request", tr.export.title, async () => ({
    queuedRows: await page.locator("[data-status='queued']").count(),
    unknownChips: await page.locator("#migration-exports [data-status='unknown']").count(),
  }));
  // Export detail: the manifests are not offered before success.
  await page.locator("#migration-exports tbody a.link").first().click();
  await check("migration-export-detail", nav.p7.migrationExport.title, async () => ({
    ok: (await page.locator("[data-state='downloads-not-ready']").count()) === 1,
    downloadsReady: await page.locator("[data-state='downloads-ready']").count(),
  }));

  // 2. Migration status (read-only) and the identity rebind list.
  await page.goto(`${BASE}/admin/migration/imports`);
  await check("migration-status", tr.import.title, async () => ({
    forms: await page.locator("[data-p7-screen] form").count(),
    ok: (await page.locator("[data-p7-screen] form").count()) === 0,
  }));
  await page.goto(`${BASE}/admin/migration/identity-rebinds?state=unbound`);
  await check("identity-rebinds", tr.rebind.title);

  // 3. Configuration transfer: export every kind, download the bundle, upload it, validate it.
  await page.goto(`${BASE}/admin/config-transfer`);
  await check("config-transfer-before", tr.bundle.title);
  await page.locator("#bundle-export-reason").fill(`Synthetic bundle for the transfer drill (${lang})`);
  await page.locator("[data-action='export-bundle']").click();
  const exported = await page
    .getByText(tr.bundle.exported)
    .waitFor({ timeout: 15000 })
    .then(
      () => "exported",
      async () => (await page.locator("[role='alert'][data-problem]").getAttribute("data-problem")) ?? "no answer",
    );
  await check("config-transfer-after-export", tr.bundle.title, async () => ({ exportResult: exported }));
  let uploaded = false;
  if (exported === "exported") {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#bundle-exports [data-action='download-bundle']").first().click(),
    ]);
    const file = join(process.env.TMPDIR ?? "/tmp", `fe-b-bundle-${lang}.json`);
    await download.saveAs(file);
    await page.locator("[data-action='export-bundle']").scrollIntoViewIfNeeded();
    await page.locator("#bundle-file").setInputFiles(file);
    await page.locator("[data-action='upload-bundle']").click();
    uploaded = await page
      .locator("main#main h1", { hasText: nav.p7.configBundleImport.title })
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    await check("config-bundle-import-uploaded", nav.p7.configBundleImport.title, async () => ({ ok: uploaded }));
    await page.locator("[data-action='validate-bundle']").click();
    await page.locator("[data-bundle-status='validated'], [data-bundle-status='invalid']").waitFor({ timeout: 15000 });
    const status = await page.locator("[data-bundle-import]").getAttribute("data-bundle-status");
    const actions = await page.locator("#bundle-items [data-status]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-status")),
    );
    await check("config-bundle-import-validated", nav.p7.configBundleImport.title, async () => ({
      status,
      itemActions: actions,
      commitOffered: await page.locator("[data-action='commit-bundle']").count(),
    }));
    await page.goto(`${BASE}/admin/config-transfer`);
    await page.locator("#bundle-exports tbody a.link").first().click();
    await check("config-bundle-export-detail", nav.p7.configBundleExport.title);
  }
  record({ lang, name: "bundle-round-trip-in-ui", exported, uploaded, ok: exported === "exported" ? uploaded : true });
  // 4. Narrow viewport (360 px): the configuration import page wraps, it does not scroll sideways.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/admin/config-transfer`);
  await page.locator("main#main h1").waitFor();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(OUT, lang, "config-transfer-360.png"), fullPage: true });
  record({ lang, name: "narrow-360", horizontalOverflowPx: overflow, ok: overflow <= 0 });
  record({ lang, name: "origin", foreignRequests: foreign, ok: foreign.length === 0 });
  record({ lang, name: "writes", writes, ok: !writes.some((w) => /migration-imports|identity-rebinds/.test(w)) });
  await context.close();
}
await browser.close();
summary.failures = failures;
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`fe-b-shots: ${summary.results.length} checks, ${failures} failed; ${OUT}`);
process.exit(failures ? 1 : 0);
