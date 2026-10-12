// domain-reviewer DG4 round 4 (T-DG4-REV-DOM-R4): F-DG4-125 / D-124 on the REAL stack (with-stack.sh, WORKER=1 starts
// the real worker so the KPI recalculation runs as in production). NO interception, NO database writes: everything is
// created through the API, then the REAL built web is read in EN and AR.
// World: one synthetic transformation; an outcome created through the API (stays draft) and a second one archived;
// four KPIs linked to the first outcome: percentage without label, percentage labelled '%', percentage labelled
// '% of users' (also an adoption indicator), ratio 3/2; plus one margin benefit planned 100, nothing validated (value
// gap 1 -> '100 %').
// Expected (M0170, ADR-0028 s3, ADR-0037 N5): '12 %', '12 %', '12 % of users', '1.5' (never '150 %' / '0.12'), '100 %'.
// Surfaces: T10 (Outcomes, People & adoption, Value), its outcomes drill-down, the Executive Overview (area + drill),
// the adoption dashboard. The archived outcome never appears.
// SYNTHETIC data; no product gate (G1-G6) is decided; nothing relates to DG0-DG7.
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const stamp = Date.now().toString(36);

async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`dev-login ${username} -> ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return {
    me,
    async call(method, path, body, { ifMatch, expect } = {}) {
      const headers = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (ifMatch !== undefined) headers["if-match"] = `"${ifMatch}"`;
      if (method === "POST" && ifMatch === undefined) headers["idempotency-key"] = randomUUID();
      const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      const ok = expect !== undefined ? res.status === expect : res.ok;
      if (!ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
      return text ? JSON.parse(text) : {};
    },
  };
}
const admin = await session("dev.admin"); const lead = await session("dev.lead"); const office = await session("dev.office");
const orgId = admin.me.organization.id;
const t = await lead.call("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic DG4 R4 KPI unit ${stamp}`, mode: "end_to_end" });
const tid = t.id; const T = `/api/v1/transformations/${tid}`;
async function synUser(code) {
  const username = `dev.r4dom.${code.toLowerCase()}.${stamp}`;
  const u = await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic R4 ${code}`, preferredLocale: "en", identity: { issuer: "urn:mth:dev-local", subject: username } });
  await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode: code, scope: { type: "transformation", id: tid }, reason: `Synthetic ${code} for the domain-reviewer DG4 R4 probe (approves nothing real)` });
  return { id: u.id, s: await session(username), username };
}
const kds = await synUser("KDS");
// One open quarterly period far in the future.
const P = `/api/v1/organizations/${orgId}/reporting-periods`; let periodId = ""; let periodEnd = "";
for (let i = 0; i < 60 && !periodId; i++) {
  const y = 2150 + Math.floor(i / 4); const q = i % 4; const em = q * 3 + 3;
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`; const end = `${y}-${String(em).padStart(2, "0")}-${new Date(Date.UTC(y, em, 0)).getUTCDate()}`;
  try { const p = await office.call("POST", P, { frequency: "quarterly", periodLabel: `${y}-Q${q + 1}`, periodStart: start, periodEnd: end }, { expect: 201 }); await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version }); periodId = p.id; periodEnd = end; } catch { /* taken */ }
}
const outcome = await lead.call("POST", `${T}/outcomes`, { statement: `Synthetic R4: more users adopt the new journey (${stamp}).` });
const archived = await lead.call("POST", `${T}/outcomes`, { statement: `Synthetic R4 ARCHIVED outcome ${stamp}` });
console.log(`outcome via API status=${outcome.status}; archived candidate=${archived.id}`);
const V = [
  { key: "A", unitKind: "percentage", unitLabel: null, n: "12", d: "100", expect: /^12 ?%$/ , exp: "12 %" },
  { key: "B", unitKind: "percentage", unitLabel: "%", n: "12", d: "100", expect: /^12 ?%$/, exp: "12 %" },
  { key: "C", unitKind: "percentage", unitLabel: "% of users", n: "12", d: "100", expect: /^12 ?% of users$/, exp: "12 % of users" },
  { key: "D", unitKind: "ratio", unitLabel: null, n: "3", d: "2", expect: /^1\.5$/, exp: "1.5" },
];
let adoptionLinkId = "";
for (const v of V) {
  const def = await lead.call("POST", `${T}/kpi-definitions`, { name: `Synthetic R4 KPI ${v.key} ${v.unitKind}${v.unitLabel ? ` [${v.unitLabel}]` : ""}`, unitKind: v.unitKind, ...(v.unitLabel ? { unitLabel: v.unitLabel } : {}), polarity: "higher_is_better", frequency: "quarterly", ownerUserId: kds.id });
  await lead.call("POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, { ifMatch: def.version });
  const ver = await kds.s.call("POST", `${T}/kpi-definitions/${def.id}/versions`, { measureType: "higher_is_better", valueNature: "ratio", aggregationRule: "weighted_ratio", submissionRoute: "direct_accept", numeratorLabel: "Synthetic numerator", denominatorLabel: "Synthetic denominator" });
  await kds.s.call("POST", `${T}/kpi-versions/${ver.id}/activate`, undefined, { ifMatch: ver.version });
  v.outcomeKpiId = (await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: outcome.id, kpiDefinitionId: def.id, targetDate: "2199-12-31" })).id;
  if (v.key === "B") await lead.call("POST", `${T}/outcome-kpis`, { outcomeId: archived.id, kpiDefinitionId: def.id, targetDate: "2199-12-31" });
  if (v.key === "C") adoptionLinkId = (await lead.call("POST", `${T}/adoption-metric-links`, { templateKey: "usage_activation_rate", targetKind: "transformation", kpiDefinitionId: def.id })).id;
  const sub = await kds.s.call("POST", `${T}/kpi-definitions/${def.id}/actuals`, { scopeKind: "transformation", scopeId: tid, action: "submit", dataAsOf: periodEnd, reportingPeriodId: periodId, numerator: v.n, denominator: v.d });
  v.id = def.id; console.log(`KPI ${v.key} ${def.id} actual status=${sub.actual.status}`);
}
const arcNow = await lead.call("GET", `${T}/outcomes/${archived.id}`);
await lead.call("POST", `${T}/outcomes/${archived.id}/archive`, { reason: "Synthetic: archived for the R4 probe" }, { ifMatch: arcNow.version });
// A margin benefit planned 100 in H1 2026, nothing validated: value gap 1.
let benefitNote = "";
try {
  const ben = await lead.call("POST", `${T}/benefits`, { title: "Synthetic R4 margin", description: "Synthetic margin uplift for the gap rendering.", benefitType: "revenue", valueClass: "margin_uplift", ownerUserId: lead.me.user.id, currency: "SAR", financialStatementLine: "Revenue - prepaid" });
  await lead.call("POST", `${T}/benefits/${ben.id}/plan-values`, { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-06-30", amount: "100" });
  benefitNote = `benefit ${ben.id} planned 100`;
} catch (e) { benefitNote = `benefit setup refused: ${String(e).slice(0, 300)}`; }
console.log(benefitNote);
// Wait for the real worker to calculate every KPI.
for (const v of V) {
  let a = null;
  let st = null; const t0 = Date.now();
  for (let i = 0; i < 360 && a === null; i++) { st = await lead.call("GET", `${T}/kpi-definitions/${v.id}/status`); a = st.actual; if (a === null) await new Promise((r) => setTimeout(r, 500)); }
  console.log(`KPI ${v.key} status.actual=${a} after ${Date.now() - t0} ms${a === null ? ` status=${JSON.stringify(st).slice(0, 400)}` : ""}`);
}
const apiDash = await lead.call("GET", `${T}/dashboard`);
console.log(`API T10 outcomes items: ${JSON.stringify(apiDash.areas.find((a) => a.code === "outcomes").items.map((i) => [i.recordType, i.label, i.value?.value, i.value?.kpiUnit]))}`);
rec("api.t10.archived-absent", "the archived outcome is absent from the T10 response", JSON.stringify(apiDash).includes(archived.id) ? "present" : "absent", !JSON.stringify(apiDash).includes(archived.id));

const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
const norm = (s) => s.replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
for (const lang of ["en", "ar"]) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill("dev.lead"); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 3 && (await page.locator("html").getAttribute("lang")) !== lang; i++) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click().catch((e) => console.log(`lang switch attempt ${i}: ${String(e).slice(0, 200)}`)); await page.waitForTimeout(1500); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 30000 });
  const valueText = async (scope, recordId) => {
    const cell = scope.locator(`tr[data-item='${recordId}'], tr[data-drill-item='${recordId}']`).first().locator("[data-value-state]").first();
    return (await cell.count()) ? norm(await cell.innerText()) : "<absent>";
  };
  // T10
  await page.goto(`${BASE}/transformations/${tid}/dashboard`); await page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  await page.locator("section[data-area='outcomes']").waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  const outA = page.locator("section[data-area='outcomes']");
  const showAll = outA.locator("button", { hasText: /./ }).filter({ hasText: new RegExp(lang === "en" ? "Show all" : "") });
  for (const v of V) { const txt = await valueText(outA, v.outcomeKpiId); rec(`${lang}.t10.outcomes.${v.key}`, v.exp, txt, v.expect.test(txt)); }
  const outTxt = norm(await outA.innerText());
  rec(`${lang}.t10.outcomes.api-outcome-visible`, "the API-created (draft) outcome is listed", outTxt.includes(`(${stamp})`) ? "listed" : "absent", outTxt.includes(`(${stamp})`));
  rec(`${lang}.t10.outcomes.archived-hidden`, "the archived outcome is not listed", outTxt.includes("ARCHIVED") ? "listed" : "absent", !outTxt.includes("ARCHIVED"));
  const ppl = page.locator("section[data-area='people_adoption']");
  { const txt = await valueText(ppl, adoptionLinkId); rec(`${lang}.t10.people.C`, "12 % of users", txt, /^12 ?% of users$/.test(txt)); }
  const val = page.locator("section[data-area='value']");
  { const gap = val.locator("[data-metric='value.gap'][data-headline-basis='profit_and_cash'] [data-value-state]").first(); const txt = (await gap.count()) ? norm(await gap.innerText()) : "<absent>"; rec(`${lang}.t10.value.gap`, "100 % (computed ratio, kpiUnit null)", txt, /^100 ?%$/.test(txt)); }
  await outA.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${lang}-r4-t10-kpi-units.png`, fullPage: true });
  // Outcomes drill-down
  const drillBtn = outA.locator("button[data-drill]").first();
  if (await drillBtn.count()) {
    await drillBtn.click(); const dlg = page.locator("[data-drilldown]"); await dlg.waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    for (const v of V) { const txt = await valueText(dlg, v.outcomeKpiId); rec(`${lang}.t10.outcomes-drill.${v.key}`, v.exp, txt, v.expect.test(txt)); }
    const dtxt = norm(await dlg.innerText()); rec(`${lang}.t10.outcomes-drill.archived-hidden`, "archived outcome absent", dtxt.includes("ARCHIVED") ? "listed" : "absent", !dtxt.includes("ARCHIVED"));
    await page.screenshot({ path: `${SHOTS}/${lang}-r4-t10-outcomes-drill.png`, fullPage: true });
    await page.keyboard.press("Escape");
  } else rec(`${lang}.t10.outcomes-drill`, "a drill-down button in the Outcomes area", "<absent>", false);
  // People & adoption drill-down
  const pBtn = ppl.locator("button[data-drill]").first();
  if (await pBtn.count()) { await pBtn.click(); const dlg = page.locator("[data-drilldown]"); await dlg.waitFor({ timeout: 20000 }); await page.waitForTimeout(500); const txt = await valueText(dlg, adoptionLinkId); rec(`${lang}.t10.people-drill.C`, "12 % of users", txt, /^12 ?% of users$/.test(txt)); await page.screenshot({ path: `${SHOTS}/${lang}-r4-t10-people-drill.png`, fullPage: true }); await page.keyboard.press("Escape"); }
  // Executive Overview scoped to the transformation
  await page.goto(`${BASE}/executive-overview?organizationId=${orgId}&transformationId=${tid}`); await page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  await page.locator("section[data-area='outcomes']").waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  const ovO = page.locator("section[data-area='outcomes']");
  for (const v of V) { const txt = await valueText(ovO, v.outcomeKpiId); rec(`${lang}.overview.outcomes.${v.key}`, v.exp, txt, v.expect.test(txt)); }
  { const txt = await valueText(page.locator("section[data-area='people_adoption']"), adoptionLinkId); rec(`${lang}.overview.people.C`, "12 % of users", txt, /^12 ?% of users$/.test(txt)); }
  { const ovTxt = norm(await ovO.innerText()); rec(`${lang}.overview.outcomes.archived-hidden`, "archived outcome absent", ovTxt.includes("ARCHIVED") ? "listed" : "absent", !ovTxt.includes("ARCHIVED")); }
  await page.screenshot({ path: `${SHOTS}/${lang}-r4-overview-kpi-units.png`, fullPage: true });
  const oBtn = ovO.locator("button[data-drill]").first();
  if (await oBtn.count()) { await oBtn.click(); const dlg = page.locator("[data-drilldown]"); await dlg.waitFor({ timeout: 20000 }); await page.waitForTimeout(500); for (const v of V) { const txt = await valueText(dlg, v.outcomeKpiId); rec(`${lang}.overview.outcomes-drill.${v.key}`, v.exp, txt, v.expect.test(txt)); } await page.screenshot({ path: `${SHOTS}/${lang}-r4-overview-outcomes-drill.png`, fullPage: true }); await page.keyboard.press("Escape"); }
  // Adoption dashboard
  await page.goto(`${BASE}/dashboards/adoption?organizationId=${orgId}&transformationId=${tid}`); await page.locator("main#main h1").first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  const adTxt = norm(await page.locator("main#main").innerText());
  const cells = await page.locator("main#main [data-value-state]").allInnerTexts();
  const hit = cells.map(norm).find((c) => /% of users/.test(c)) ?? "<absent>";
  rec(`${lang}.adoption-dashboard.C`, "12 % of users (never 0.12)", hit, /^12 ?% of users$/.test(hit) && !/0\.12/.test(adTxt));
  await page.screenshot({ path: `${SHOTS}/${lang}-r4-adoption-dashboard.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(`### summary ${results.filter((x) => x.pass).length}/${results.length} PASS`);
process.exit(results.every((x) => x.pass) ? 0 : 1);
