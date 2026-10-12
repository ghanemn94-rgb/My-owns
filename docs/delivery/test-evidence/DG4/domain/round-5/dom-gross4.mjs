// domain-reviewer DG4 round 5 (T-DG4-REV-DOM-R4; copied from my round-3 dom-gross3.mjs): F-DG4-122/123 regression and
// F-DG4-126 on screen. Round-4 changes: world B's Value RAG is now expected Red with the top-line and non-cash lines
// (D-123 item 1 retired the revenue-only n/a BY DESIGN); the per-basis RAG lines are read on the T10 screen.
// Original round-3 header: F-DG4-122 and F-DG4-123 re-verification on the REAL stack
// (with-stack.sh: PostgreSQL + the built API serving the built web, dev seed), API and UI, EN (LTR) and AR (RTL).
// World A (DOM-GROSS): revenue_uplift 300, margin_uplift 70, cash_saving 20, avoided_cost 45 SAR planned 2026-01..06.
// World B (revenue-only): revenue_uplift 300 and avoided_cost 45 only.
// Reads T10 (/transformations/{id}/dashboard), the Executive Overview, the Finance dashboard and the workspace header
// through the API and the UI; opens the profit-and-cash, top-line and non-cash drill-downs in the UI.
// Gap rendering of other ratios (25 %, -20 %, 12.5 %): the REAL API response of world A's T10, Overview and Finance reads
// is intercepted in the browser (page.route) and ONLY the value.gap headline's value is rewritten, so the real built web
// code formats it. (The API producing those ratios is proven in-process by zz-domain-r3.test.ts R3-3.)
// SYNTHETIC data; nothing here is a business or Finance approval; nothing relates to DG0-DG7.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const EV = process.env.SHOTS + "/..";
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "dashboards"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const hk = (l, key) => tr(l, `dashboards.headline.${key.replaceAll(".", "__")}`);
const rk = (l, key) => tr(l, `dashboards.reason.${key.replaceAll(".", "__")}`);
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const OBS = (id, actual) => console.log(`OBS ${id} :: ${actual}`);
const j = (x, n = 4000) => String(JSON.stringify(x)).slice(0, n);
const canon = (v) => (v === null || v === undefined ? v : String(Number(v)));
const has435 = (s) => /(^|[^\d.,])435([^\d]|$)/.test(s);

async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (method === "POST") h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, text };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1200)}`); return r.body; };
const lead = await session("dev.lead");
const admin = await session("dev.admin");
const orgId = admin.me.organization.id;
const stamp = Date.now().toString(36);
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
async function world(name, classes) {
  const t = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: `Synthetic DG4 R3 ${name} ${stamp}`, mode: "end_to_end" }), 201, "create t");
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic BO ${name} ${stamp}`, preferredLocale: "en", identity: { issuer: "urn:mth:dev-local", subject: `dom4r3.${name}.${stamp}` } }), 201, "user");
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode: "BO", scope: { type: "transformation", id: t.id }, reason: "Synthetic demo BO for the DG4 round-3 domain review (approves nothing real)" }), 201, "grant");
  const bo = await session(`dom4r3.${name}.${stamp}`);
  const T = `/api/v1/transformations/${t.id}`;
  for (const [valueClass, benefitType, line, amount] of classes) {
    const b = must(await bo.call("POST", `${T}/benefits`, { title: `Synthetic ${valueClass} (B0145 style)`, description: "Synthetic demo benefit.", benefitType, valueClass, ownerUserId: bo.id, currency: "SAR", financialStatementLine: line }), 201, `benefit ${valueClass}`);
    must(await bo.call("POST", `${T}/benefits/${b.id}/plan-values`, { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-06-30", amount }), 201, `plan ${valueClass}`);
  }
  return t.id;
}
const REV = ["revenue_uplift", "revenue", "Revenue - roaming", "300"], MAR = ["margin_uplift", "revenue", "Gross margin - roaming", "70"];
const CASH = ["cash_saving", "cost", "Opex - care", "20"], AVO = ["avoided_cost", "cost", "Opex - network", "45"];
const A = await world("gross", [REV, MAR, CASH, AVO]);
const B = await world("onlyrev", [REV, AVO]);

// ---------------------------------------------------------------- API reads
const pick = (l, m, b) => l.find((h) => h.metric === m && h.headlineBasis === b && (h.value.currency === "SAR"));
const area = (o, code) => o.areas.find((a) => a.code === code);
async function reads(tid) {
  const T = `/api/v1/transformations/${tid}`;
  const t10 = await lead.call("GET", `${T}/dashboard`);
  const ov = await lead.call("GET", `/api/v1/overview?organizationId=${orgId}&transformationId=${tid}`);
  const fin = await lead.call("GET", `/api/v1/dashboards/finance?organizationId=${orgId}&transformationId=${tid}`);
  const hdr = await lead.call("GET", `${T}/summary`);
  return { t10, ov, fin, hdr, lists: { T10: area(t10.body, "value").headlines, overview: area(ov.body, "value").headlines, finance: fin.body.headlines.filter((h) => h.metric.startsWith("value.")), header: hdr.body.benefits.headlines } };
}
const ra = await reads(A);
writeFileSync(`${EV}/r5-gross-api.json`, JSON.stringify({ t10: ra.t10.body, overview: ra.ov.body, finance: ra.fin.body, header: ra.hdr.body }, null, 1));
for (const [where, l] of Object.entries(ra.lists)) {
  const v = (m, b) => canon(pick(l, m, b)?.value.value);
  rec(`API.A.${where}.90-300-45`, "p&c planned 90, top line 300, non-cash 45; validated p&c zero", `${v("value.planned", "profit_and_cash")}/${v("value.planned", "top_line")}/${v("value.planned", "non_cash")} validated=${pick(l, "value.validated", "profit_and_cash")?.value.state}`,
    v("value.planned", "profit_and_cash") === "90" && v("value.planned", "top_line") === "300" && v("value.planned", "non_cash") === "45" && pick(l, "value.validated", "profit_and_cash")?.value.state === "zero");
  if (where !== "header") { const g = pick(l, "value.gap", "profit_and_cash")?.value; rec(`API.A.${where}.gap`, "ratio 1, unit ratio", j(g, 300), canon(g?.value) === "1" && g?.unit === "ratio"); }
  for (const h of l) { // drill invariant through the HTTP API
    if (h.metric === "value.gap") continue;
    const d = must(await lead.call("GET", `${h.drilldownHref}&limit=50`), 200, "drill");
    const sum = d.items.filter((i) => i.value?.currency === "SAR" || i.value?.currency == null).reduce((a, i) => a + Number(i.value?.value ?? 0), 0);
    rec(`API.A.${where}.drill.${h.metric}.${h.headlineBasis}`, `items sum = headline ${canon(h.value.value) ?? h.value.state}, basis ${h.headlineBasis}`, `sum=${sum} n=${d.items.length} basis=${d.headlineBasis} more=${d.nextCursor !== null}`,
      d.headlineBasis === h.headlineBasis && d.nextCursor === null && String(sum) === String(Number(h.value.value ?? 0)));
  }
}
for (const [k, r] of Object.entries({ t10: ra.t10, ov: ra.ov, fin: ra.fin, hdr: ra.hdr })) rec(`API.A.${k}.no-435-figure`, "no value/amount 435", `${/"(value|amount)":"435(\.0+)?"/.test(r.text)}`, !/"(value|amount)":"435(\.0+)?"/.test(r.text));
const fgA = ra.fin.body.lines.find((l) => l.valueClass === "gross" && l.state === "planned" && l.currency === "SAR");
rec("API.A.finance.gross=headline+drills", "gross planned 90, href = p&c planned headline's href", `${fgA?.total?.value} ${fgA?.drilldownHref}`, canon(fgA?.total?.value) === "90" && fgA?.drilldownHref === pick(ra.lists.finance, "value.planned", "profit_and_cash")?.drilldownHref);
const rb = await reads(B);
writeFileSync(`${EV}/r5-onlyrev-api.json`, JSON.stringify({ t10: rb.t10.body, overview: rb.ov.body, finance: rb.fin.body, header: rb.hdr.body }, null, 1));
for (const [where, l] of Object.entries(rb.lists)) {
  const pc = l.filter((h) => h.headlineBasis === "profit_and_cash").map((h) => `${h.metric}=${h.value.state}/${h.value.reasonKey}`);
  rec(`API.B.${where}.pc-na`, "every p&c headline (and gap) not_applicable no_profit_and_cash_benefit; top line 300, non-cash 45", `${j(pc, 600)} top=${canon(pick(l, "value.planned", "top_line")?.value.value)} nc=${canon(pick(l, "value.planned", "non_cash")?.value.value)}`,
    pc.length > 0 && pc.every((x) => x.endsWith("=not_applicable/dashboard.value.no_profit_and_cash_benefit")) && canon(pick(l, "value.planned", "top_line")?.value.value) === "300" && canon(pick(l, "value.planned", "non_cash")?.value.value) === "45");
}
const ragB = area(rb.t10.body, "value").rag;
rec("API.B.T10.value-rag", "D-123 item 1: red, dashboard.rag.value.validated_gap, lines top_line 1 red + non_cash 1 red (never green)", j(ragB, 400), ragB.status === "red" && ragB.ruleKey === "dashboard.rag.value.validated_gap" && ragB.ruleParams.lines.map((l) => `${l.headlineBasis}:${canon(l.gapRatio)}:${l.status}`).join(",") === "top_line:1:red,non_cash:1:red");
const ovRowB = rb.ov.body.transformations?.find((t) => (t.transformationId ?? t.id) === B);
OBS("API.B.overview.row", j(ovRowB, 800));
const fgB = rb.fin.body.lines.filter((l) => ["gross", "net"].includes(l.valueClass)).map((l) => `${l.valueClass}/${l.state}=${l.total?.state}:${l.total?.value}`);
OBS("API.B.finance.gross-net (KBE-R6 §5.3 (a))", j(fgB));

// ---------------------------------------------------------------- UI
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
async function signedIn(lang) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill("dev.lead"); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  if ((await page.locator("html").getAttribute("lang")) !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx };
}
const flat = (s) => s.replace(/\s+/g, " ").trim();
async function visit(s, path, sel) {
  await s.page.goto(`${BASE}${path}`); await s.page.waitForLoadState("networkidle");
  await s.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  if (sel) await s.page.locator(sel).first().waitFor({ timeout: 30000 });
  await s.page.waitForTimeout(600);
  return flat(await s.page.locator("main#main").innerText());
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const money = /SAR|ر\.س|﷼/;
const SCREENS = [
  ["t10", (t) => `/transformations/${t}/dashboard`, "[data-headlines='value']", "value"],
  ["overview", (t) => `/executive-overview?tr=${t}`, "[data-headlines='value']", "value"],
  ["finance", (t) => `/dashboards/finance?tr=${t}`, "[data-headlines='finance']", "finance"],
  ["header", (t) => `/transformations/${t}`, "[data-headlines='header-benefits']", "header-benefits"],
];
async function headlineText(s, id, metric, basis) {
  const loc = s.page.locator(`[data-headlines='${id}'] [data-metric='${metric}'][data-headline-basis='${basis}'], [data-headlines-beside='${id}'] [data-metric='${metric}'][data-headline-basis='${basis}']`).first();
  return (await loc.count()) ? flat(await loc.innerText()) : "<absent>";
}
for (const lang of ["en", "ar"]) {
  const s = await signedIn(lang);
  const step = async (name, fn) => { try { await fn(); } catch (e) { rec(`${lang}.${name}.exception`, "no exception", String(e.message).slice(0, 400), false); await shot(s, lang, `${name}-error`).catch(() => {}); } };
  for (const [name, path, sel, id] of SCREENS) {
    await step(`A.${name}`, async () => {
      const txt = await visit(s, path(A), sel);
      await shot(s, lang, `r5-A-${name}`);
      const pc = await headlineText(s, id, "value.planned", "profit_and_cash");
      const tl = await headlineText(s, id, "value.planned", "top_line");
      const nc = await headlineText(s, id, "value.planned", "non_cash");
      OBS(`${lang}.A.${name}.headlines`, `pc=[${pc}] top=[${tl}] nc=[${nc}]`);
      rec(`${lang}.A.${name}.labels+figures`, `'${hk(lang, "dashboard.headline.value_planned_profit_and_cash")}' 90; '${hk(lang, "dashboard.headline.value_planned_top_line")}' 300; '${hk(lang, "dashboard.headline.value_planned_non_cash")}' 45`,
        `${pc} | ${tl} | ${nc}`, pc.includes(hk(lang, "dashboard.headline.value_planned_profit_and_cash")) && /90\.00/.test(pc) && tl.includes(hk(lang, "dashboard.headline.value_planned_top_line")) && /300\.00/.test(tl) && nc.includes(hk(lang, "dashboard.headline.value_planned_non_cash")) && /45\.00/.test(nc));
      const beside = s.page.locator(`[data-headlines-beside='${id}'][data-not-summed='true']`);
      rec(`${lang}.A.${name}.beside-group`, "top line and non-cash in a separate 'not summed' group with the beside note", `group=${await beside.count()} note=${await s.page.locator(`[data-beside-note='${id}']`).count()}`, (await beside.count()) === 1 && (await s.page.locator(`[data-beside-note='${id}']`).count()) === 1);
      rec(`${lang}.A.${name}.no-435`, "435 nowhere on the screen", `${has435(txt)}`, !has435(txt));
      if (name !== "header") {
        const gap = await headlineText(s, id, "value.gap", "profit_and_cash");
        rec(`${lang}.A.${name}.gap-100%`, "'100 %' and no currency text", gap, /100 ?%/.test(gap) && !money.test(gap));
      }
      if (name === "t10") {
        const lines = await s.page.locator("section[data-area='value'] [data-rag-line-basis]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-rag-line-basis")}:${e.getAttribute("data-rag-line-status")}:${e.hasAttribute("data-worst")}:${e.innerText.replace(/\s+/g, " ").trim()}`));
        rec(`${lang}.A.t10.value-rag-lines`, "three lines (profit_and_cash, top_line, non_cash), each red, each '100 %', all data-worst", lines.join(" | "), lines.length === 3 && lines.every((l) => /:red:true:/.test(l) && /100 ?%/.test(l)) && ["profit_and_cash", "top_line", "non_cash"].every((b, i) => lines[i].startsWith(b)));
      }
      if (lang === "ar") rec(`ar.A.${name}.provisional-basis-note`, "provisional-Arabic basis note", `${await s.page.locator(`[data-provisional='basis']`).count()}`, (await s.page.locator(`[data-provisional='basis']`).count()) >= 1);
    });
  }
  // Drill-downs from the T10 Value area, through the UI.
  await step("A.t10.drills", async () => {
    await visit(s, `/transformations/${A}/dashboard`, "[data-headlines='value']");
    for (const [basis, want, inTitles, outTitles] of [["profit_and_cash", "90.00", ["margin_uplift", "cash_saving"], ["revenue_uplift", "avoided_cost"]], ["top_line", "300.00", ["revenue_uplift"], ["margin_uplift", "cash_saving", "avoided_cost"]], ["non_cash", "45.00", ["avoided_cost"], ["revenue_uplift", "margin_uplift", "cash_saving"]]]) {
      await s.page.locator(`[data-metric='value.planned'][data-headline-basis='${basis}'] button[data-drill]`).first().click();
      const panel = s.page.getByRole("dialog").last();
      await panel.waitFor({ timeout: 30000 });
      await s.page.waitForTimeout(1200);
      const pt = flat(await panel.innerText());
      await shot(s, lang, `r5-A-t10-drill-${basis}`);
      const ok = pt.includes(want) && inTitles.every((c) => pt.includes(`Synthetic ${c}`)) && outTitles.every((c) => !pt.includes(`Synthetic ${c}`)) && pt.includes(tr(lang, `dashboards.basis.classes.${basis}`));
      rec(`${lang}.A.t10.drill.${basis}`, `panel total ${want}, lists only ${inTitles}, shows the basis classes`, pt.slice(0, 500), ok);
      await s.page.keyboard.press("Escape"); await s.page.waitForTimeout(400);
    }
  });
  // World B: n/a with its reason, never 0 or green.
  for (const [name, path, sel, id] of SCREENS) {
    await step(`B.${name}`, async () => {
      await visit(s, path(B), sel);
      await shot(s, lang, `r5-B-onlyrev-${name}`);
      const pc = await headlineText(s, id, "value.planned", "profit_and_cash");
      const na = rk(lang, "dashboard.value.no_profit_and_cash_benefit");
      rec(`${lang}.B.${name}.pc-na`, `n/a with '${na.slice(0, 60)}…', no 0.00`, pc.slice(0, 300), pc.includes(na) && !/(^|\s)0\.00/.test(pc) && !money.test(pc.replace(na, "")));
      if (name === "t10") {
        const card = flat(await s.page.locator("[data-area='value'], #area-value, section:has([data-headlines='value'])").first().innerText());
        OBS(`${lang}.B.t10.value-card`, card.slice(0, 500));
        rec(`${lang}.B.t10.value-rag-not-green`, "the Value status is not Green", card.slice(0, 120), !card.includes(tr(lang, "dashboards.rag.green")));
        const linesB = await s.page.locator("section[data-area='value'] [data-rag-line-basis]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-rag-line-basis")}:${e.getAttribute("data-rag-line-status")}:${e.innerText.replace(/\s+/g, " ").trim()}`));
        rec(`${lang}.B.t10.value-rag-lines`, "two lines (top_line, non_cash), red, '100 %'; area RAG red", `${await s.page.locator("section[data-area='value']").getAttribute("data-area-rag")} ${linesB.join(" | ")}`, (await s.page.locator("section[data-area='value']").getAttribute("data-area-rag")) === "red" && linesB.length === 2 && linesB.every((l) => /:red:/.test(l) && /100 ?%/.test(l)));
      }
    });
  }
  // Other ratios rendered by the real web code (API response intercepted; only value.gap's value rewritten).
  for (const [ratio, want] of [["0.25", /25 ?%/], ["-0.2", /-\s?20 ?%|−\s?20 ?%|20-? ?%/], ["0.125", /12\.5 ?%/]]) {
    await step(`ratio.${ratio}`, async () => {
      const rewrite = async (route) => {
        const res = await route.fetch(); const body = await res.json();
        const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.metric === "value.gap" && o.value?.state === "value") o.value.value = ratio; Object.values(o).forEach(walk); } };
        walk(body); await route.fulfill({ response: res, json: body });
      };
      await s.page.route(/\/api\/v1\/(transformations\/[^/]+\/dashboard|overview|dashboards\/finance)(\?|$)/, rewrite);
      for (const [name, path, sel, id] of SCREENS.slice(0, 3)) {
        await visit(s, path(A), sel);
        const gap = await headlineText(s, id, "value.gap", "profit_and_cash");
        rec(`${lang}.ratio.${ratio}.${name}`, `${want} and no currency text`, gap, want.test(gap) && !money.test(gap));
        if (ratio === "0.25") await shot(s, lang, `r5-ratio-25pct-${name}`);
        if (ratio === "-0.2" && name === "t10") await shot(s, lang, `r5-ratio-neg20pct-${name}`);
      }
      await s.page.unroute(/\/api\/v1\/(transformations\/[^/]+\/dashboard|overview|dashboards\/finance)(\?|$)/);
    });
  }
  await s.ctx.close();
}
await browser.close();
console.log(`### summary ${results.filter((r) => r.pass).length}/${results.length} PASS`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
