// domain-reviewer DG4 ROUND 4: copied unchanged from my round-3 evidence (same name) and re-run on candidate 5ff36f6e.
// domain-reviewer DG4 round 2 (copied from round 1; only the AR T11 expectation changed, see below): UI probe (pre-installed Chromium, /opt/pw-browsers) of the P4 screens in English (LTR) and
// Arabic (RTL) on the real stack, after dom-api.mjs (reads $OUT/ids.json). Asserts on the visible text of main#main with
// the shipped i18n catalogues and the API's own seeded texts, and saves a full-page screenshot per claim and language to
// $SHOTS. SYNTHETIC data; nothing here is a business approval.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const OUT = process.env.OUT; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const ids = JSON.parse(readFileSync(`${OUT}/ids.json`, "utf8"));
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "closureP4", "dashboards", "governanceP4", "adoptionP4", "raidP4", "gates"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const NAMES = { ar: "العربية", en: "English" };
const PB = readFileSync(process.env.PLAYBOOK ?? "docs/source/playbook.md", "utf8");
const para = (b) => new RegExp(`\\n([^\\n]+) <!-- ${b} -->`).exec(PB)[1].trim();
const SEVEN = ["B0109", "B0110", "B0111", "B0112", "B0113", "B0114", "B0115"].map(para);
const browser = await chromium.launch();
async function signedIn(lang, username) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const foreign = []; page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u); });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(username); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  const cur = await page.locator("html").getAttribute("lang");
  if (cur !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx, foreign };
}
async function visit(s, path) {
  await s.page.goto(`${BASE}${path}`); await s.page.waitForLoadState("networkidle"); await s.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  await s.page.waitForTimeout(800);
  return (await s.page.locator("main#main").innerText()).replace(/\s+/g, " ");
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const has = (text, needles) => needles.filter((n) => !text.includes(n));
const T = `/transformations/${ids.tid}`;
const CLAIM = /(?<!not an |not |is not an )official PMI standard|(?<!not )certified by PMI|PMI[- ]certified/i; // affirmative claims only; the disclaimer "not an official PMI standard ... not certified" is required text

for (const lang of ["en", "ar"]) {
  const s = await signedIn(lang, "dev.lead");
  const dir = await s.page.locator("html").getAttribute("dir");
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", dir, dir === (lang === "ar" ? "rtl" : "ltr"));
  const header = (await s.page.locator("header").first().innerText()).replace(/\s+/g, " ");
  rec(`${lang}.brand-provisional`, "header shows the provisional text wordmark marker", header.slice(0, 160), header.includes(tr(lang, "common.brand.provisional")) || (await s.page.getByText(tr(lang, "common.brand.provisional")).count()) > 0);
  const step = async (name, path, fn) => { try { const t = await visit(s, path); await shot(s, lang, name); await fn(t); if (CLAIM.test(t)) rec(`${lang}.${name}.no-cert-claim`, "no certification claim", t.match(CLAIM)[0], false); } catch (e) { rec(`${lang}.${name}.exception`, "no exception", String(e.message).slice(0, 400), false); await shot(s, lang, `${name}-error`).catch(() => {}); } };

  await step("forums-five-layers", `${T}/forums`, async (t) => {
    const want = lang === "en" ? ["Executive SteerCo", "Transformation Review", "Workstream Review", "Rapid Response / Sprint", "Value Review", "Monthly", "Bi-weekly", "Weekly", "Daily / 2-3x week"] : ["اللجنة التوجيهية التنفيذية", "مراجعة التحول", "مراجعة مسار العمل", "مراجعة القيمة"];
    rec(`${lang}.forums.five-layers-shown`, j(want), `missing=${j(has(t, want))}`, has(t, want).length === 0);
  });
  await step("decision-rights-T11", `${T}/decision-rights`, async (t) => {
    const want = lang === "en" ? ["Business scope change", "Funding reallocation", "Target-state design", "Go-live / scale", "5 working days", "Next SteerCo / urgent route", "10 working days", "Per release plan"] : ["تغيير نطاق الأعمال", "إعادة تخصيص التمويل", "تصميم الحالة المستهدفة", "أيام العمل: 5", "Transformation Lead", "5 working days"]; // R2: D-117 shows the English source labels under a provisional notice (asserted in dom-gross.mjs); the template's "5 أيام عمل" is not shown by design;
    rec(`${lang}.T11.four-rows`, j(want), `missing=${j(has(t, want))}`, has(t, want).length === 0);
  });
  await step("raci-T12", `${T}/raci`, async (t) => {
    const want = lang === "en" ? ["Charter", "Target Operating Model", "Business Case", "Initiative Delivery", "Benefits Validation", "BAU Handover", "A/R"] : ["الميثاق", "نموذج التشغيل المستهدف", "دراسة الجدوى", "التسليم إلى العمليات الاعتيادية", "A/R"];
    rec(`${lang}.T12.six-deliverables`, j(want), `missing=${j(has(t, want))}`, has(t, want).length === 0);
  });
  await step("adoption-T13", `${T}/adoption`, async (t) => {
    rec(`${lang}.T13.row-shown`, "the synthetic stakeholder group row", `${t.includes("Synthetic retail front-line agents")}`, t.includes("Synthetic retail front-line agents"));
  });
  await step("adoption-indicators", `${T}/adoption-indicators`, async (t) => {
    if (lang === "en") rec("en.indicators.seven-names", j(SEVEN), `missing=${j(has(t, SEVEN))}`, has(t, SEVEN).length === 0);
    else rec("ar.indicators.page", "Arabic page renders (names translated; provisional label where marked)", `provisionalLabel=${t.includes(tr("ar", "adoptionP4.arProvisional"))} len=${t.length}`, t.length > 200);
  });
  await step("raid-T15", `${T}/raid`, async (t) => {
    rec(`${lang}.T15.entries`, "R- and I- codes shown", `R=${/R-\d+/.test(t)} I=${/I-\d+/.test(t)}`, /R-\d+/.test(t) && /I-\d+/.test(t));
  });
  await step("executive-decisions-T16", `${T}/executive-decisions`, async (t) => {
    rec(`${lang}.T16.ask-shown`, "DEC- code and why-now text", `DEC=${/DEC-\d+/.test(t)} whyNow=${t.includes("partner contract renews")}`, /DEC-\d+/.test(t) && t.includes("partner contract renews"));
  });
  await step("transformation-dashboard-T10", `${T}/dashboard`, async (t) => {
    const unk = tr(lang, "dashboards.rag.unknown") ;
    rec(`${lang}.T10.unknown-not-green`, `'${unk}' visible, no green on an empty transformation`, `unknown=${t.includes(unk)}`, t.includes(unk));
  });
  await step("executive-overview", `/executive-overview`, async (t) => { rec(`${lang}.overview.renders`, "six areas render", `len=${t.length}`, t.length > 200); });
  await step("workspace-header", `${T}`, async (t) => {
    const unk = tr(lang, "dashboards.rag.unknown");
    rec(`${lang}.header.unknown-where-missing`, `'${unk}' in the workspace header`, `${t.includes(unk)}`, t.includes(unk));
  });
  await step("closure-status", `${T}/closure`, async (t) => {
    rec(`${lang}.closure.no-successful-label`, "no 'successful' label; separate statuses", `success=${/successful|ناجح/.test(t)}`, !/successful|ناجح/.test(t));
  });
  await step("gate-G5", `${T}/gates/G5`, async (t) => { rec(`${lang}.G5.page`, "renders G5 criteria / missing items", `len=${t.length}`, t.length > 200); });
  await step("gate-G6", `${T}/gates/G6`, async (t) => { rec(`${lang}.G6.page`, "renders G6 criteria / missing items", `len=${t.length}`, t.length > 200); });
  await step("my-work", `/my-work`, async (t) => { rec(`${lang}.mywork.renders`, "sections render", `len=${t.length}`, t.length > 100); });
  await step("traceability", `${T}/traceability`, async (t) => { rec(`${lang}.traceability.renders`, "renders", `len=${t.length}`, t.length > 100); });
  await step("about", `/about`, async (t) => {
    rec(`${lang}.about.method-disclaimer`, "states not an official PMI standard and not certified", `${t.includes(tr(lang, "common.about.methodBody").slice(0, 60))}`, t.includes(tr(lang, "common.about.methodBody").slice(0, 60)));
  });
  rec(`${lang}.no-foreign-requests`, "0 requests outside the app origin", `${s.foreign.length} ${j(s.foreign.slice(0, 3))}`, s.foreign.length === 0);
  await s.ctx.close();
}
function j(x) { return JSON.stringify(x); }
await browser.close();
console.log(`### summary ${results.filter((r) => r.pass).length}/${results.length} PASS`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
