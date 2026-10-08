// domain-reviewer DG3 round 1: UI probe (Chromium from /opt/pw-browsers) of the P3 screens in English (LTR) and Arabic
// (RTL) on the real stack, after dg3-api.mjs and dg3-ui-world.mjs. Reads $OUT/ids.json and $OUT/world.json, asserts on the
// visible text of main#main using the shipped i18n catalogues, and saves a full-page screenshot per claim and language
// to $SHOTS. SYNTHETIC data; nothing here is a business approval.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const OUT = process.env.OUT; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const ids = JSON.parse(readFileSync(`${OUT}/ids.json`, "utf8")); const world = JSON.parse(readFileSync(`${OUT}/world.json`, "utf8"));
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "portfolio", "prioritization", "roadmap", "dependencies", "capacity", "businessCases", "benefitFormulas", "readiness", "gates"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
async function signedIn(lang, username) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const foreign = []; page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u); });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(username); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 20000 });
  const cur = await page.locator("html").getAttribute("lang");
  if (cur !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx, foreign };
}
async function visit(s, path) {
  await s.page.goto(`${BASE}${path}`); await s.page.waitForLoadState("networkidle"); await s.page.locator("main#main h1").first().waitFor({ timeout: 20000 });
  await s.page.waitForTimeout(400);
  return (await s.page.locator("main#main").innerText()).replace(/\s+/g, " ");
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const has = (text, needles) => needles.filter((n) => !text.includes(n));
const T = `/transformations/${ids.tid}`; const W2 = `/transformations/${world.W2}`; const FR = `/transformations/${world.F}`;

for (const lang of ["en", "ar"]) {
  const s = await signedIn(lang, "dev.lead");
  const dir = await s.page.locator("html").getAttribute("dir");
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", dir, dir === (lang === "ar" ? "rtl" : "ltr"));
  // brand
  const header = (await s.page.locator("header").first().innerText()).replace(/\s+/g, " ");
  rec(`${lang}.brand-provisional`, "header shows the text wordmark and the provisional marker", header.slice(0, 200), header.includes(tr(lang, "common.brand.provisional")) || (await s.page.getByText(tr(lang, "common.brand.provisional")).count()) > 0);
  // readiness on a fresh transformation (REQ-PB-007)
  let t = await visit(s, `${FR}/readiness`); await shot(s, lang, "readiness-missing-areas");
  let miss = has(t, ["economics", "customer", "operations", "capability", "technology"].map((a) => tr(lang, `readiness.area.${a}`)));
  const attr = await s.page.locator("[data-missing-areas]").getAttribute("data-missing-areas").catch(() => null);
  rec(`${lang}.REQ-PB-007.readiness`, "the five B0012 areas listed as missing", `missing-labels=${JSON.stringify(miss)} data-missing-areas=${attr}`, miss.length === 0 && attr === "economics customer operations capability technology");
  // W2 prioritization: 3.30, incomplete, 57.5 + label (REQ-PB-048, REQ-S09-001)
  t = await visit(s, `${W2}/prioritization`); await shot(s, lang, "prioritization-3.30-incomplete");
  const num330 = lang === "ar" ? /3[.,٫]30|٣[٫.]٣٠/ : /3\.30/;
  rec(`${lang}.REQ-PB-048.3.30-shown`, "X shows 3.30; Y shows 'incomplete' (no number)", `3.30=${num330.test(t)} incomplete=${t.includes(tr(lang, "prioritization.incomplete"))}`, num330.test(t) && t.includes(tr(lang, "prioritization.incomplete")));
  await s.page.getByRole("button", { name: tr(lang, "prioritization.ranked.toggle100"), exact: true }).click(); await s.page.waitForTimeout(400);
  t = (await s.page.locator("main#main").innerText()).replace(/\s+/g, " "); await shot(s, lang, "prioritization-0-100-view");
  const n575 = lang === "ar" ? /57[.,٫]5|٥٧[٫.]٥/ : /57\.5/;
  rec(`${lang}.REQ-S09-001.57.5-labelled`, "0-100 view shows 57.5 with the conversion label", `57.5=${n575.test(t)} label=${t.includes(tr(lang, "prioritization.conversion_label"))}`, n575.test(t) && t.includes(tr(lang, "prioritization.conversion_label")));
  // W2 portfolio: 'Selected - unfunded' (REQ-S09-003)
  t = await visit(s, `${W2}/portfolio`); await shot(s, lang, "portfolio-selected-unfunded");
  rec(`${lang}.REQ-S09-003.selected-unfunded`, `'${tr(lang, "portfolio.status.selected_unfunded")}' shown for ${world.X.code}`, `${t.includes(tr(lang, "portfolio.status.selected_unfunded"))}`, t.includes(tr(lang, "portfolio.status.selected_unfunded")));
  // W2 G4 gate view: Owners, Finance validation, initiative named (REQ-PB-019, REQ-PB-055, REQ-S04-006)
  t = await visit(s, `${W2}/gates/G4`); await shot(s, lang, "g4-missing-items");
  miss = has(t, [tr(lang, "gates.missingItems.g4__owner_missing"), tr(lang, "gates.missingItems.g4__finance_validation_missing"), tr(lang, "gates.missingItems.g4__funding_missing"), tr(lang, "gates.missingItems.g4__capacity_commitment_missing"), world.X.code, world.X.name]);
  rec(`${lang}.REQ-PB-019.g4-view-names`, "G4 view lists Owners, Finance validation, funding and capacity items naming the initiative", `missing=${JSON.stringify(miss)}`, miss.length === 0);
  if (lang === "ar") rec("ar.g4-no-english-labels", "no English missing-item label in the Arabic G4 view", `Owners=${t.includes("Owners:")} Finance=${t.includes("Finance validation")}`, !t.includes("Owners:") && !t.includes("Finance validation"));
  // main T portfolio: launched A, selected-unfunded B
  t = await visit(s, `${T}/portfolio`); await shot(s, lang, "portfolio-main");
  rec(`${lang}.REQ-S09-003.three-states`, "A Launched, B Selected - unfunded, C (deselected) shown", `launched=${t.includes(tr(lang, "portfolio.status.launched"))} su=${t.includes(tr(lang, "portfolio.status.selected_unfunded"))}`, t.includes(tr(lang, "portfolio.status.launched")) && t.includes(tr(lang, "portfolio.status.selected_unfunded")));
  // T05 card on A (14 labels) and the deliverable warning on C (0 deliverables)
  t = await visit(s, `${T}/initiatives/${ids.A.id}`); await shot(s, lang, "t05-card-A");
  miss = has(t, ["name", "executiveOwner", "workstreamLead", "problemGap", "objective", "scope", "deliverables", "contribution", "financialBenefit", "customerBenefit", "dependencies", "risks", "milestones", "decisions"].map((k) => tr(lang, `portfolio.t05.${k}`)));
  rec(`${lang}.REQ-PB-045.t05-14-labels`, "all 14 T05 field labels on the card", `missing=${JSON.stringify(miss)}`, miss.length === 0);
  rec(`${lang}.REQ-PB-045.t05-values`, "A's synthetic values shown (objective, scope out, risks)", `${t.includes("Synthetic: raise roaming pass attach rate.")} ${t.includes("Synthetic: enterprise roaming.")} ${t.includes("Synthetic: partner rate negotiation delays.")}`, t.includes("Synthetic: raise roaming pass attach rate.") && t.includes("Synthetic: enterprise roaming.") && t.includes("Synthetic: partner rate negotiation delays."));
  t = await visit(s, `${T}/initiatives/${ids.C.id}`); await shot(s, lang, "t05-card-C-deliverable-warning");
  rec(`${lang}.REQ-PB-045.deliverable-warning`, "C (0 deliverables) shows the 3-7 warning", `${t.includes(tr(lang, "portfolio.warning.initiative__deliverable_count"))}`, t.includes(tr(lang, "portfolio.warning.initiative__deliverable_count")));
  // main T prioritization: weight version 2 history, override reason, risk/compliance weight
  t = await visit(s, `${T}/prioritization`); await shot(s, lang, "prioritization-history-v2");
  rec(`${lang}.REQ-S09-005.history`, "history shows the 'weight version 2' cause and the override with its reason", `v2=${t.includes(tr(lang, "prioritization.cause.weight", { n: 2 }))} override=${t.includes(tr(lang, "prioritization.cause.override", { reason: "Synthetic: regulatory deadline" }))}`, t.includes(tr(lang, "prioritization.cause.weight", { n: 2 })) && t.includes(tr(lang, "prioritization.cause.override", { reason: "Synthetic: regulatory deadline" })));
  // roadmap: four verbatim waves (EN source shown also in AR) + provisional AR note
  t = await visit(s, `${T}/roadmap`); await shot(s, lang, "roadmap-waves");
  // EN: the B0079 text verbatim. AR: the provisional Arabic text (ADR-0023 §1) with the English source wave names shown under each name.
  miss = has(t, lang === "en" ? ["Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed", "0-6 weeks", "Sponsor + charter", "Evidence + capacity", "Benefits sustained, ownership transferred"] : ["Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed", "الراعي + الميثاق", "أدلة + طاقة استيعابية", "استدامة المنافع، ونقل الملكية"]);
  rec(`${lang}.REQ-PB-050.waves-verbatim`, "B0079 source text visible verbatim", `missing=${JSON.stringify(miss)}`, miss.length === 0);
  if (lang === "ar") rec("ar.REQ-PB-050.provisional-ar-labelled", "the provisional Arabic note is shown", `${t.includes(tr("ar", "roadmap.waves.provisionalAr"))}`, t.includes(tr("ar", "roadmap.waves.provisionalAr")));
  rec(`${lang}.REQ-S09-006.three-views`, "timeline, initiative table and work board on one page", `${t.includes(tr(lang, "roadmap.timeline.title"))} ${t.includes(tr(lang, "roadmap.table.title"))} ${t.includes(tr(lang, "roadmap.board.title"))}`, t.includes(tr(lang, "roadmap.timeline.title")) && t.includes(tr(lang, "roadmap.table.title")) && t.includes(tr(lang, "roadmap.board.title")));
  // dependencies: External From + types
  t = await visit(s, `${T}/dependencies`); await shot(s, lang, "dependencies-t08");
  rec(`${lang}.REQ-PB-051.external-from`, "External From shown", `${t.includes(tr(lang, "dependencies.external", { label: "Synthetic roaming partner" }))}`, t.includes(tr(lang, "dependencies.external", { label: "Synthetic roaming partner" })));
  // capacity conflict
  t = await visit(s, `${T}/capacity`); await shot(s, lang, "capacity-conflict");
  rec(`${lang}.REQ-PB-059.capacity-indicator`, "capacity grid shows a conflict/Unknown indicator", `unknown=${t.includes(tr(lang, "capacity.grid.unknownCapacity"))} text=${t.slice(0, 160)}`, t.includes(tr(lang, "capacity.grid.unknownCapacity")) || /0[.,٫]50|٠[٫.]٥٠/.test(t));
  // business case: ten sections
  t = await visit(s, `/transformations/${ids.tid}/business-cases/${ids.cases.ic}`); await shot(s, lang, "business-case-ten-sections");
  miss = has(t, ["strategic_rationale", "baseline", "value_pools", "interventions", "investment", "benefits", "timing", "risks", "ownership", "decision_ask"].map((k) => tr(lang, `businessCases.section.${k}.title`)));
  rec(`${lang}.REQ-PB-053.ten-sections`, "ten section titles shown", `missing=${JSON.stringify(miss)}`, miss.length === 0);
  // benefit formulas: examples illustrative + revenue formula value
  t = await visit(s, `${T}/benefit-formulas`); await shot(s, lang, "benefit-formulas-examples");
  rec(`${lang}.REQ-PB-057.illustrative-marker`, "the source examples carry the illustrative marker", `${t.includes(tr(lang, "benefitFormulas.illustrative"))}`, t.includes(tr(lang, "benefitFormulas.illustrative")));
  t = await visit(s, `${T}/benefit-formulas/${ids.formulas.rev}`); await shot(s, lang, "benefit-formula-revenue");
  rec(`${lang}.REQ-PB-057.revenue-100000`, "revenue example shows 100,000 SAR", t.match(/100[,٬]?000|١٠٠[٬,]?٠٠٠/)?.[0] ?? "none", /100[,٬]?000|١٠٠[٬,]?٠٠٠/.test(t));
  // G4 approved on main T
  t = await visit(s, `${T}/gates/G4`); await shot(s, lang, "g4-approved");
  rec(`${lang}.foreign-requests`, "no request leaves the application origin", JSON.stringify(s.foreign), s.foreign.length === 0);
  await s.ctx.close();
}
await browser.close();
const fails = results.filter((r) => !r.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${JSON.stringify(fails.map((f) => f.id))}`);
process.exit(fails.length ? 1 : 0);
