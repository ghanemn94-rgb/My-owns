// domain-reviewer DG4 ROUND 4: copied unchanged from my round-3 evidence (same name) and re-run on candidate 5ff36f6e.
// domain-reviewer DG4 round 3 (T-DG4-REV-DOM-R3): how the REAL built web renders a percentage KPI value on the T10
// Outcomes area and its drill-down, EN and AR, on the real stack (with-stack.sh).
// The dev seed has no percentage KPI and the stack runs no worker (the KPI recalculation consumer), so the API leg is
// proven in-process (zz-domain-r3.test.ts R3-7: the T10 Outcomes area sends a 12 % KPI actual as
// {state:"value", value:"0.12", unit:"percentage"|"%", currency:null}). Here the real T10 response of a synthetic
// transformation is intercepted in the browser (page.route) and ONE outcomes-area item is appended carrying exactly
// that value object (as recorded by R3-7), so the real web code formats it. Expected by the source: 12 % (M0170,
// ADR-0028 s3: percentages are stored as fractions; the KPI pages show 12 %).
// SYNTHETIC data; nothing here is a business approval; nothing relates to DG0-DG7.
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const t = await (await fetch(`${BASE}/api/v1/transformations`, { method: "POST", headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic DG4 R3 percentage KPI ${Date.now().toString(36)}`, mode: "end_to_end" }) })).json();
const tid = t.id;
const kpiItem = (unit, label) => ({ recordType: "outcome_kpi", recordId: randomUUID(), code: null, label, href: `/api/v1/transformations/${tid}/kpi-definitions/${randomUUID()}/status`, rag: "amber", dueDate: null, value: { state: "value", value: "0.12", unit, currency: null, reasonKey: null }, ownerUserId: null, flags: [] });
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill("dev.lead"); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  if ((await page.locator("html").getAttribute("lang")) !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  await page.route(new RegExp(`/api/v1/transformations/${tid}/dashboard(\\?|$)`), async (route) => {
    const res = await route.fetch(); const body = await res.json();
    const out = body.areas.find((a) => a.code === "outcomes");
    out.items.push(kpiItem("percentage", "Synthetic activation rate A (unit kind percentage, no label)"), kpiItem("%", "Synthetic activation rate B (unit label %)"));
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`${BASE}/transformations/${tid}/dashboard`); await page.waitForLoadState("networkidle");
  await page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  for (const [k, name] of [["A", "Synthetic activation rate A"], ["B", "Synthetic activation rate B"]]) {
    const row = page.locator("tr", { hasText: name }).first();
    const txt = (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : "<row absent>";
    rec(`${lang}.t10.outcomes.kpi-${k}`, "the 12 % KPI actual (fraction 0.12) shows 12 %", txt, /(^|[^.\d])12 ?%/.test(txt) && !/0\.12/.test(txt));
  }
  await page.locator("tr", { hasText: "Synthetic activation rate A" }).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${SHOTS}/${lang}-r3-t10-outcomes-percentage-kpi.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(`### summary ${results.filter((x) => x.pass).length}/${results.length} PASS`);
process.exit(results.every((x) => x.pass) ? 0 : 1);
