// T-DG7-FE-B2 visual and interaction evidence: the Configuration transfer export form no longer offers
// `automation_rule` (ADR-0065 Amendment 1, A1.2) and says why, in English LTR and Arabic RTL, on the real stack
// (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, SYNTHETIC dev users, API serving apps/web/dist).
// Signs in as the synthetic dev.admin, checks the offered kinds and the note, walks the kinds with the keyboard (Tab,
// Space), exports every offered kind with a real request, runs axe (WCAG 2.0/2.1 A+AA tags) and writes screenshots plus
// a JSON summary to OUT. Nothing here approves anything.
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
const EXPECTED = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
  "branding",
  "notification_policy",
  "job_schedule",
  "config_review_policy",
  "upload_policy",
];
const summary = { base: BASE, user: "dev.admin (SYNTHETIC)", results: [] };
let failures = 0;
const record = (entry) => {
  if (!entry.ok) failures++;
  summary.results.push(entry);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
for (const lang of ["en", "ar"]) {
  mkdirSync(join(OUT, lang), { recursive: true });
  const tr = cat(lang, "transfer");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const foreign = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
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
  const axeOf = async () =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map(
      (v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }),
    );

  // 1. The form as loaded: 11 kinds in contract order, no automation_rule, the note inside the kinds group.
  await page.goto(`${BASE}/admin/config-transfer`);
  await page.locator("main#main h1", { hasText: tr.bundle.title }).waitFor({ timeout: 15000 });
  await page.waitForLoadState("networkidle");
  const form = page.locator("form[data-form='export-config-bundle']");
  const group = form.getByRole("group", { name: tr.bundle.kinds });
  const values = await group.locator("input[type=checkbox]").evaluateAll((els) => els.map((e) => e.value));
  const automationRuleBoxes = await page.getByLabel(tr.bundle.kind.automation_rule, { exact: true }).count();
  const note = group.locator("[data-state='not-carried-note']");
  const noteText = (await note.textContent())?.trim();
  const noteVisible = await note.isVisible();
  const describedBy = (await group.getAttribute("aria-describedby"))?.split(" ") ?? [];
  const noteId = await note.getAttribute("id");
  const dir = await page.locator("html").getAttribute("dir");
  const htmlLang = await page.locator("html").getAttribute("lang");
  const axeBefore = await axeOf();
  await page.screenshot({ path: join(OUT, lang, "config-transfer-export-form.png"), fullPage: true });
  await group.screenshot({ path: join(OUT, lang, "config-transfer-kinds-group.png") });
  record({
    lang,
    name: "config-transfer-export-form",
    dir,
    htmlLang,
    offeredKinds: values,
    automationRuleCheckboxes: automationRuleBoxes,
    noteText,
    noteVisible,
    noteInDescribedBy: describedBy.includes(noteId),
    axeViolations: axeBefore,
    ok:
      same(values, EXPECTED) &&
      automationRuleBoxes === 0 &&
      noteText === tr.bundle.notCarriedNote &&
      noteVisible &&
      describedBy.includes(noteId) &&
      dir === (lang === "ar" ? "rtl" : "ltr") &&
      htmlLang === lang &&
      axeBefore.length === 0,
  });

  // 2. Keyboard: focus the first kind, Tab through the group, Space ticks each; focus never reaches automation_rule
  // and every focused checkbox shows a focus indicator.
  await group.locator("input[type=checkbox]").first().focus();
  const visited = [];
  for (let i = 0; i < EXPECTED.length; i++) {
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        value: el.getAttribute("value"),
        type: el.getAttribute("type"),
        focusVisible: el.matches(":focus-visible"),
        outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
        shadow: cs.boxShadow,
      };
    });
    visited.push(f);
    await page.keyboard.press("Space");
    if (i === 0) await page.screenshot({ path: join(OUT, lang, "keyboard-focus-first-kind.png") });
    await page.keyboard.press("Tab");
  }
  const ticked = await group
    .locator("input[type=checkbox]")
    .evaluateAll((els) => els.filter((e) => e.checked).map((e) => e.value));
  const focusShown = visited.every((v) => v.focusVisible && (v.outline !== "none 0px" || v.shadow !== "none"));
  record({
    lang,
    name: "keyboard-kinds",
    visited: visited.map((v) => v.value),
    focusShown,
    ticked,
    ok: same(
      visited.map((v) => v.value),
      EXPECTED,
    ) && focusShown && same(ticked, EXPECTED),
  });

  // 3. A real export of every offered kind: the request never names automation_rule, and the server accepts it.
  await page.locator("#bundle-export-reason").fill(`Synthetic FE-B2 check (${lang})`);
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/config-bundles/exports")),
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/config-bundles/exports")),
    form.getByRole("button", { name: tr.bundle.export, exact: true }).click(),
  ]);
  const sent = req.postDataJSON();
  const status = res.status();
  const body = await res.json().catch(() => null);
  await page.waitForLoadState("networkidle");
  // Run 1 read this with isVisible() before the banner rendered (a script defect; the screenshot showed it).
  const exportedShown = await page
    .locator("[data-state='bundle-exported']")
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  const unportableShown = await page.getByText(cat(lang, "problems").config_bundle__unportable_reference).count();
  const axeAfter = await axeOf();
  await page.screenshot({ path: join(OUT, lang, "config-transfer-after-export.png"), fullPage: true });
  record({
    lang,
    name: "export-every-offered-kind",
    sentKinds: sent?.kinds,
    status,
    responseKinds: body?.kinds,
    problemCode: body?.code,
    exportedShown,
    unportableShown,
    axeViolations: axeAfter,
    ok:
      same(sent?.kinds, EXPECTED) &&
      status === 201 &&
      !(body?.kinds ?? []).includes("automation_rule") &&
      exportedShown &&
      unportableShown === 0 &&
      axeAfter.length === 0,
  });

  // 4. Narrow viewport (360 px): the kinds and the note wrap, no sideways scroll.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}/admin/config-transfer`);
  await page.locator("main#main h1", { hasText: tr.bundle.title }).waitFor();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(OUT, lang, "config-transfer-360.png"), fullPage: true });
  record({ lang, name: "config-transfer-360", horizontalOverflowPx: overflow, ok: overflow <= 0 });

  record({ lang, name: "no-foreign-requests", foreign, ok: foreign.length === 0 });
  await context.close();
}
await browser.close();
summary.failures = failures;
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${summary.results.length} checks, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
