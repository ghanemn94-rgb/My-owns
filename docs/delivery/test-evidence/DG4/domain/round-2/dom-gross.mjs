// domain-reviewer DG4 round 2 (T-DG4-REV-DOM-R2): F-DG4-121 re-verification on the REAL stack (with-stack.sh), API and
// UI, EN (LTR) and AR (RTL). Creates one synthetic transformation with four financial benefits, revenue_uplift 300,
// margin_uplift 70, cash_saving 20 and avoided_cost 45 SAR planned for 2026-01..06, through the public API as the dev
// Transformation Lead and a synthetic Business Owner. Then it reads:
//   - GET benefit-totals (gross/net and the class lines),
//   - GET the T10 transformation dashboard (Value area headlines),
//   - GET /dashboards/finance?transformationId (gross/net lines and headlines),
//   - GET /executive-overview,
// and screenshots the benefits page (totals), the Finance dashboard, the T10 dashboard and the Executive Overview in EN
// and AR. It also screenshots the T11 page in AR/EN and asserts the provisional-Arabic notice (F-DG4-120).
// SYNTHETIC data; nothing here is a business or Finance approval; nothing relates to DG0-DG7.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const OUT = process.env.OUT; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "dashboards", "benefitsP4", "decisionRights"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const OBS = (id, actual) => console.log(`OBS ${id} :: ${actual}`);
const j = (x, n = 4000) => String(JSON.stringify(x)).slice(0, n);
const EV = process.env.SHOTS + "/.."; // the evidence directory (JSON reads are kept there)
const valueHeadlines = (o) => { const out = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (typeof v.metric === "string" && /^value\./.test(v.metric)) out.push(`${v.metric}=${v.value?.value ?? "?"} ${v.value?.currency ?? ""} (${v.value?.state})`); Object.values(v).forEach(walk); } }; walk(o); return out; };
const DEV_ISSUER = "urn:mth:dev-local";
const BU_RETAIL = "01920000-0000-7000-9000-000000000102"; // the dev seed's synthetic retail business unit (as dom-api.mjs)

async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1200)}`); return r.body; };
const canon = (v) => (v === null || v === undefined ? v : String(Number(v)));

const lead = await session("dev.lead");
const admin = await session("dev.admin");
const orgId = admin.me.organization.id;
const stamp = Date.now().toString(36);
async function synthUser(tid, username, roleCode) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode} ${username}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, `user ${username}`);
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope: { type: "transformation", id: tid }, reason: `Synthetic demo ${roleCode} for the DG4 round-2 domain review (approves nothing real)` }), 201, `grant ${roleCode}`);
  return { ...(await session(username)), username };
}
const bu = BU_RETAIL;
const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: bu, name: `Synthetic DG4 R2 gross-net ${stamp}`, mode: "end_to_end" }), 201, "create t");
const tid = t.id; const T = `/api/v1/transformations/${tid}`;
const bo = await synthUser(tid, `dom4r2.bo.${stamp}`, "BO");
const classes = [
  ["revenue_uplift", "revenue", "Revenue - roaming", "300"],
  ["margin_uplift", "revenue", "Gross margin - roaming", "70"],
  ["cash_saving", "cost", "Opex - care", "20"],
  ["avoided_cost", "cost", "Opex - network", "45"],
];
for (const [valueClass, benefitType, line, amount] of classes) {
  const b = must(await bo.call("POST", `${T}/benefits`, { title: `Synthetic ${valueClass} (roaming, B0145 style)`, description: "Synthetic demo benefit for the domain review.", benefitType, valueClass, ownerUserId: bo.id, currency: "SAR", financialStatementLine: line }), 201, `benefit ${valueClass}`);
  must(await bo.call("POST", `${T}/benefits/${b.id}/plan-values`, { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-06-30", amount }), 201, `plan ${valueClass}`);
}
// API reads
const tot = must(await lead.call("GET", `${T}/benefit-totals`), 200, "totals");
const sar = tot.currencies.find((c) => c.currency === "SAR");
const lines = Object.fromEntries(sar.lines.filter((l) => l.state === "planned").map((l) => [l.valueClass, canon(l.total.amount)]));
rec("API.totals.class-lines", "revenue_uplift 300, margin_uplift 70, cash_saving 20, avoided_cost 45", j(lines), lines.revenue_uplift === "300" && lines.margin_uplift === "70" && lines.cash_saving === "20" && lines.avoided_cost === "45");
rec("API.totals.gross-planned", "90 (= 70 + 20; D-117)", canon(sar.gross.planned.amount), canon(sar.gross.planned.amount) === "90");
rec("API.totals.net-planned", "90 (gross 90 - cost 0)", `${canon(sar.net.planned.amount)} cost=${j(sar.implementationCost, 300)}`, canon(sar.net.planned.amount) === "90");
OBS("API.totals.gross-validated", j(sar.gross.validated, 300));
const dash = must(await lead.call("GET", `${T}/dashboard`), 200, "T10");
writeFileSync(`${EV}/gross-t10.json`, JSON.stringify(dash, null, 1));
OBS("API.T10.value-headlines", j(valueHeadlines(dash)));
const fin = must(await lead.call("GET", `/api/v1/dashboards/finance?organizationId=${orgId}&transformationId=${tid}`), 200, "finance");
writeFileSync(`${EV}/gross-finance.json`, JSON.stringify(fin, null, 1));
const fl = fin.lines.filter((l) => l.state === "planned" || l.valueClass === "gross" || l.valueClass === "net").map((l) => `${l.valueClass}/${l.state}/${l.currency}=${l.total?.value ?? "?"}(${l.total?.state})${l.drilldownHref ? " href" : " nohref"}`);
OBS("API.finance.lines", j(fl));
const fg = fin.lines.find((l) => l.valueClass === "gross" && l.state === "planned");
rec("API.finance.gross-planned", "90, no drill-down href (revenue/avoided lines enter the state; ADR-0037 N2 note)", `${fg?.total?.value} href=${fg?.drilldownHref}`, canon(fg?.total?.value) === "90" && fg?.drilldownHref === null);
const fh = fin.headlines.filter((h) => /value\.(planned|validated)/.test(h.metric)).map((h) => `${h.metric}=${h.value.value}(${h.value.state}) label=${h.labelKey}`);
OBS("API.finance.headlines", j(fh));
const ov = await lead.call("GET", `/api/v1/overview?organizationId=${orgId}&transformationId=${tid}`);
writeFileSync(`${EV}/gross-overview.json`, JSON.stringify(ov.body, null, 1));
OBS("API.overview.value-headlines", `${ov.status} ${j(valueHeadlines(ov.body))}`);
const hdr = await lead.call("GET", `${T}/summary`);
OBS("API.workspace-header.benefits", `${hdr.status} ${j(hdr.body?.benefits, 800)}`);
writeFileSync(`${OUT}/gross-ids.json`, JSON.stringify({ tid }, null, 1));

// UI
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
async function signedIn(lang, username) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(username); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  const cur = await page.locator("html").getAttribute("lang");
  if (cur !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx };
}
async function visit(s, path, waitSel) {
  await s.page.goto(`${BASE}${path}`); await s.page.waitForLoadState("networkidle"); await s.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  if (waitSel) await s.page.locator(waitSel).first().waitFor({ timeout: 30000 });
  await s.page.waitForTimeout(800);
  return (await s.page.locator("main#main").innerText()).replace(/\s+/g, " ");
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const num = (lang, v) => new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US").format(v);
for (const lang of ["en", "ar"]) {
  const s = await signedIn(lang, "dev.lead");
  const step = async (name, path, waitSel, fn) => { try { const txt = await visit(s, path, waitSel); await shot(s, lang, name); await fn(txt); } catch (e) { rec(`${lang}.${name}.exception`, "no exception", String(e.message).slice(0, 400), false); await shot(s, lang, `${name}-error`).catch(() => {}); } };
  await step("benefits-totals-gross", `/transformations/${tid}/benefits`, "#benefit-totals [data-totals='net']", async () => {
    const net = s.page.locator("#benefit-totals [data-totals='net']");
    const grossTh = (await net.locator("[data-row='gross'] th").innerText()).replace(/\s+/g, " ");
    const grossAmt = await net.locator("[data-row='gross'] [data-state='planned'] [data-amount]").getAttribute("data-amount");
    const netAmt = await net.locator("[data-row='net'] [data-state='planned'] [data-amount]").getAttribute("data-amount").catch(() => "?");
    const rev = await net.locator("[data-row='beside-revenue_uplift'][data-not-summed='true'] [data-state='planned'] [data-amount]").getAttribute("data-amount");
    const avo = await net.locator("[data-row='beside-avoided_cost'][data-not-summed='true'] [data-state='planned'] [data-amount]").getAttribute("data-amount");
    const want = [tr(lang, "benefitsP4.totals.gross"), tr(lang, "benefitsP4.totals.grossBasis")];
    rec(`${lang}.benefits.gross-label-basis`, j(want), grossTh, want.every((w) => grossTh.includes(w)));
    rec(`${lang}.benefits.gross-net-90`, "gross 90, net 90; revenue 300 and avoided 45 beside, not summed", `gross=${grossAmt} net=${netAmt} rev=${rev} avoided=${avo}`, canon(grossAmt) === "90" && canon(netAmt) === "90" && canon(rev) === "300" && canon(avo) === "45");
  });
  await step("finance-dashboard-gross", `/dashboards/finance?tr=${tid}`, "#finance-net", async (txt) => {
    const want = [tr(lang, "dashboards.valueClass.gross"), tr(lang, "dashboards.finance.besideGross.revenue_uplift"), tr(lang, "dashboards.finance.besideGross.avoided_cost")];
    rec(`${lang}.finance.gross-labels`, j(want), `missing=${j(want.filter((w) => !txt.includes(w)))}`, want.every((w) => txt.includes(w)));
    const hl = (await s.page.locator("[data-headlines='finance']").innerText()).replace(/\s+/g, " ");
    OBS(`${lang}.finance.headlines-text`, hl.slice(0, 600));
    const net = (await s.page.locator("#finance-net").innerText()).replace(/\s+/g, " ");
    OBS(`${lang}.finance.gross-net-text`, net.slice(0, 900));
  });
  await step("workspace-header-gross", `/transformations/${tid}`, null, async (txt) => { OBS(`${lang}.header.text`, txt.slice(0, 900)); });
  await step("t10-value-area", `/transformations/${tid}/dashboard`, null, async (txt) => { OBS(`${lang}.T10.text`, txt.slice(0, 1500)); });
  await step("executive-overview-gross", `/executive-overview?tr=${tid}`, null, async (txt) => { OBS(`${lang}.overview.text`, txt.slice(0, 1200)); });
  await step("decision-rights-T11-notice", `/transformations/${tid}/decision-rights`, "main#main table tbody tr", async (txt) => {
    const notice = s.page.locator("#decision-rights-ar-provisional");
    const n = await notice.count();
    if (lang === "ar") {
      const nt = n ? (await notice.innerText()).replace(/\s+/g, " ") : "";
      rec("ar.T11.provisional-notice", "the provisional-Arabic notice naming the five columns", nt.slice(0, 300), n === 1 && nt.includes("مؤقتة"));
      const enCells = await s.page.locator("[data-verbatim-en]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-verbatim-en")}|${e.getAttribute("lang")}|${e.getAttribute("dir")}|${e.textContent}`));
      rec("ar.T11.english-labels-marked", "English source labels carry lang=en dir=ltr", j(enCells.slice(0, 6), 600), enCells.length >= 16 && enCells.every((c) => c.includes("|en|ltr|")));
      rec("ar.T11.arabic-sla-days", "Arabic working-days text under the SLA (decisionRights.workingDays)", `${txt.includes(tr("ar", "decisionRights.workingDays", { count: 5 }))}`, txt.includes(tr("ar", "decisionRights.workingDays", { count: 5 })));
      OBS("ar.T11.template-arabic-5-ayyam", `'5 أيام عمل' shown: ${txt.includes("5 أيام عمل")} (D-117: not shown by design)`);
    } else rec("en.T11.no-ar-notice", "no Arabic notice in English", `count=${n}`, n === 0);
  });
  await s.ctx.close();
}
await browser.close();
console.log(`### summary ${results.filter((r) => r.pass).length}/${results.length} PASS`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
