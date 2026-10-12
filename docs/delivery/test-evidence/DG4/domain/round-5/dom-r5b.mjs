// domain-reviewer DG4 round 5 (T-DG4-REV-DOM-R5), dom-r5b = dom-r5.mjs with ONE probe fix: the rewritten 'unknown' line now
// also carries the API's own unknown reason (benefit.value_amount_missing, areas.ts valueGapStatus/line 465) instead of
// keeping the n/a reason, whose Arabic text starts with the n/a word and tripped my own assertion in run 1.
// Original header: my own real-stack check of the T-DG4-FE-R8 repair, EN (LTR) and AR (RTL).
// Runs inside with-stack.sh (PostgreSQL + the built API serving the built web, dev seed). SYNTHETIC data only; nothing
// here is a business or Finance approval; nothing relates to DG0-DG7.
//  F-DG4-143 world C: revenue_uplift 300 SAR planned 2026-01..06 (top line due, nothing validated) and margin_uplift 70
//    SAR planned 2027-01..06 only (profit and cash: nothing planned to date). API: the T10 Value RAG lines are
//    profit_and_cash not_applicable (nothing_planned, gapRatio null) and top_line red 1. UI: the profit_and_cash line reads
//    'Not applicable', never 'Unknown', and shows no number; the top-line line reads 100 % red. Then the API response is
//    intercepted (page.route) and ONLY that line's status is rewritten to 'unknown' (reason kept), to see the real web
//    code read 'Unknown' for an unknown line (the two null-ratio states stay distinct, ADR-0037 N4 item 4).
//  F-DG4-144 world U: a new business unit with 53 transformations (more than the 50 limit and the 51-row first page);
//    two of them activated (draft -> active through PATCH, the DG1 explicit transition). On the Executive Overview, the
//    Finance and the adoption dashboards:
//    (a) bu=U -> 'too_many' note, no dashboard request carries a transformationId of U;
//    (b) bu=U & status=active -> no note; the request carries exactly the two active ids;
//    (c) bu=U & status=active & phase=<their phase> -> the same two ids; phase=<another> -> 'none_matching';
//    (d) bu=U & status=closed -> 'none_matching' (new key), not 'none';
//    (e) bu=U & tr=<the LAST transformation of U by code, beyond the unit's first 51> -> the request carries that id only;
//    (f) bu=U & tr=<a transformation of another unit> -> 'none_matching';
//    (g) bu=<empty new unit> -> 'none' (the old note still holds).
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "dashboards"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const OBS = (id, actual) => console.log(`OBS ${id} :: ${actual}`);
const j = (x, n = 4000) => String(JSON.stringify(x)).slice(0, n);
const flat = (s) => s.replace(/\s+/g, " ").trim();

async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, extra = {}) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken, ...extra };
    if (body !== undefined) h["content-type"] = "application/json";
    if (method === "POST") h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, text, etag: res.headers.get("etag") };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1200)}`); return r.body; };
const admin = await session("dev.admin");
const office = await session("dev.office");
const lead = await session("dev.lead");
const orgId = admin.me.organization.id;
const stamp = Date.now().toString(36);
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";

// ---------------------------------------------------------------- world C (F-DG4-143)
const tC = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: `Synthetic DG4 R5 n/a line ${stamp}`, mode: "end_to_end" }), 201, "create C");
const uC = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic BO r5 ${stamp}`, preferredLocale: "en", identity: { issuer: "urn:mth:dev-local", subject: `dom5.c.${stamp}` } }), 201, "user");
must(await admin.call("POST", "/api/v1/role-assignments", { userId: uC.id, roleCode: "BO", scope: { type: "transformation", id: tC.id }, reason: "Synthetic demo BO for the DG4 round-5 domain review (approves nothing real)" }), 201, "grant");
const bo = await session(`dom5.c.${stamp}`);
for (const [valueClass, benefitType, line, amount, from, to] of [["revenue_uplift", "revenue", "Revenue - roaming", "300", "2026-01-01", "2026-06-30"], ["margin_uplift", "revenue", "Gross margin - roaming", "70", "2027-01-01", "2027-06-30"]]) {
  const b = must(await bo.call("POST", `/api/v1/transformations/${tC.id}/benefits`, { title: `Synthetic ${valueClass} r5`, description: "Synthetic demo benefit.", benefitType, valueClass, ownerUserId: bo.id, currency: "SAR", financialStatementLine: line }), 201, `benefit ${valueClass}`);
  must(await bo.call("POST", `/api/v1/transformations/${tC.id}/benefits/${b.id}/plan-values`, { valueKind: "planned", periodStart: from, periodEnd: to, amount }), 201, `plan ${valueClass}`);
}
const t10C = must(await lead.call("GET", `/api/v1/transformations/${tC.id}/dashboard`), 200, "T10 C");
const ragC = t10C.areas.find((a) => a.code === "value").rag;
const linesC = (ragC.ruleParams?.lines ?? []).map((l) => `${l.headlineBasis}:${l.currency}:${l.gapRatio}:${l.status}:${l.reasonKey}`);
rec("API.C.value-rag-lines", "profit_and_cash SAR null not_applicable dashboard.value.nothing_planned; top_line SAR 1 red; area red", `${ragC.status} ${linesC.join(" | ")}`,
  ragC.status === "red" && linesC.some((l) => l === "profit_and_cash:SAR:null:not_applicable:dashboard.value.nothing_planned") && linesC.some((l) => /^top_line:SAR:1(\.0+)?:red:/.test(l)));

// ---------------------------------------------------------------- world U (F-DG4-144)
const mkUnit = async (code) => must(await admin.call("POST", `/api/v1/organizations/${orgId}/business-units`, { code, nameEn: `Synthetic unit ${code}`, nameAr: `وحدة اصطناعية ${code}` }), 201, `unit ${code}`).id;
const U = await mkUnit(`SYN-R5-U-${stamp}`.toUpperCase());
const EMPTY = await mkUnit(`SYN-R5-E-${stamp}`.toUpperCase());
const idsU = [];
for (let i = 0; i < 53; i++) idsU.push(must(await office.call("POST", "/api/v1/transformations", { businessUnitId: U, name: `Synthetic R5 unit ${String(i).padStart(2, "0")} ${stamp}`, mode: "end_to_end" }), 201, `t${i}`).id);
const listU = must(await office.call("GET", `/api/v1/transformations?organizationId=${orgId}&businessUnitId=${U}&sort=code:asc&limit=100`), 200, "list U").items;
rec("API.U.count", "53 readable transformations in U", String(listU.length), listU.length === 53);
const active = [listU[0].id, listU[1].id];
for (const id of active) {
  const g = await office.call("GET", `/api/v1/transformations/${id}`);
  must(await office.call("PATCH", `/api/v1/transformations/${id}`, { status: "active" }, { "if-match": g.etag }), 200, `activate ${id}`);
}
const phaseU = listU[0].currentPhase;
const otherPhase = ["diagnose", "define", "design", "mobilize", "transform", "realize"].find((p) => p !== phaseU);
const lastU = listU[52].id; // beyond the unit's first page of 51 (sort code:asc, limit 51)
OBS("API.U.phase", `currentPhase of U's transformations=${phaseU}; other=${otherPhase}; last by code=${listU[52].code}`);
const apiActive = must(await office.call("GET", `/api/v1/transformations?organizationId=${orgId}&businessUnitId=${U}&status=active&phase=${phaseU}&sort=code:asc&limit=51`), 200, "list U active").items.map((x) => x.id);
rec("API.U.list-narrow", "listTransformations(bu=U,status=active,phase) returns exactly the two activated", j(apiActive), apiActive.length === 2 && active.every((x) => apiActive.includes(x)));

// ---------------------------------------------------------------- UI
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
async function signedIn(lang, user) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(user); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  if ((await page.locator("html").getAttribute("lang")) !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx };
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const DASH = [["overview", "/executive-overview"], ["finance", "/dashboards/finance"], ["adoption", "/dashboards/adoption"]];
for (const lang of ["en", "ar"]) {
  const step = async (s, name, fn) => { try { await fn(); } catch (e) { rec(`${lang}.${name}.exception`, "no exception", String(e.message).slice(0, 400), false); await shot(s, lang, `r5-${name}-error`).catch(() => {}); } };
  // F-DG4-143 on the T10 screen (dev.lead).
  const s = await signedIn(lang, "dev.lead");
  const lineTexts = async () => s.page.locator("section[data-area='value'] [data-rag-line-basis]").evaluateAll((els) => els.map((e) => ({ basis: e.getAttribute("data-rag-line-basis"), status: e.getAttribute("data-rag-line-status"), text: e.innerText.replace(/\s+/g, " ").trim() })));
  const NA = tr(lang, "dashboards.state.not_applicable"), UNK = tr(lang, "dashboards.state.unknown"), WHY = tr(lang, "dashboards.reason.dashboard__value__nothing_planned");
  await step(s, "C.t10", async () => {
    await s.page.goto(`${BASE}/transformations/${tC.id}/dashboard`); await s.page.waitForLoadState("networkidle");
    await s.page.locator("section[data-area='value'] [data-rag-line-basis]").first().waitFor({ timeout: 30000 }); await s.page.waitForTimeout(600);
    await s.page.locator("section[data-area='value']").scrollIntoViewIfNeeded();
    await shot(s, lang, "r5-C-t10-na-line");
    const L = await lineTexts();
    const pc = L.find((l) => l.basis === "profit_and_cash"), tl = L.find((l) => l.basis === "top_line");
    rec(`${lang}.C.t10.pc-line-na`, `profit_and_cash line status not_applicable, reads '${NA}' and the reason '${WHY}', never '${UNK}', no digit`, j(pc), pc?.status === "not_applicable" && pc.text.includes(NA) && pc.text.includes(WHY) && !pc.text.includes(UNK) && !/[0-9٠-٩]\s?%/.test(pc.text));
    rec(`${lang}.C.t10.tl-line-red`, "top_line line red, 100 %", j(tl), tl?.status === "red" && /100 ?%|١٠٠ ?٪/.test(tl.text));
    // The unknown line, rendered by the real web code: only the status of the profit_and_cash line is rewritten.
    const re = new RegExp(`/api/v1/transformations/${tC.id}/dashboard(\\?|$)`);
    await s.page.route(re, async (route) => {
      const res = await route.fetch(); const body = await res.json();
      for (const a of body.areas) for (const l of a.rag?.ruleParams?.lines ?? []) if (l.headlineBasis === "profit_and_cash") { l.status = "unknown"; l.reasonKey = "benefit.value_amount_missing"; }
      await route.fulfill({ response: res, json: body });
    });
    await s.page.reload(); await s.page.waitForLoadState("networkidle");
    await s.page.locator("section[data-area='value'] [data-rag-line-basis]").first().waitFor({ timeout: 30000 }); await s.page.waitForTimeout(600);
    const L2 = await lineTexts(); const pc2 = L2.find((l) => l.basis === "profit_and_cash");
    rec(`${lang}.C.t10.unknown-line-reads-unknown`, `an 'unknown' line (rewritten) reads '${UNK}', not '${NA}'`, j(pc2), pc2?.status === "unknown" && pc2.text.includes(UNK) && !pc2.text.includes(NA));
    await s.page.unroute(re);
  });
  await s.ctx.close();
  // F-DG4-144 on the three organization-wide dashboards (dev.office reads U).
  const o = await signedIn(lang, "dev.office");
  const reqs = [];
  o.page.on("request", (r) => { const u = r.url(); if (/\/api\/v1\/(overview|dashboards\/(finance|adoption))\?/.test(u)) reqs.push(u); });
  const tidsOf = (u) => new URL(u).searchParams.getAll("transformationId");
  const NOTE = (k) => tr(lang, `dashboards.filter.blocked.${k}`);
  for (const [name, path] of DASH) {
    const visit = async (qs, label, expectBlocked, expectIds) => {
      await step(o, `U.${name}.${label}`, async () => {
        reqs.length = 0;
        await o.page.goto(`${BASE}${path}?${qs}`); await o.page.waitForLoadState("networkidle");
        await o.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
        await o.page.waitForTimeout(1500);
        const blocked = await o.page.locator("[data-filter-blocked]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-filter-blocked")}::${e.textContent.replace(/\s+/g, " ").trim()}`));
        const sent = reqs.map(tidsOf);
        const uSent = sent.flat().filter((x) => idsU.includes(x) || x === tC.id);
        if (["too_many", "none_matching", "none"].includes(expectBlocked) || label.startsWith("a-") || label === "b-active") await shot(o, lang, `r5-U-${name}-${label}`);
        if (expectBlocked) {
          rec(`${lang}.U.${name}.${label}`, `note '${expectBlocked}' with its ${lang} text; no request carries a transformation of U`, `${j(blocked, 600)} sent=${j(sent, 300)}`,
            blocked.length === 1 && blocked[0].startsWith(`${expectBlocked}::`) && blocked[0].includes(NOTE(expectBlocked)) && uSent.length === 0);
        } else {
          const last = sent.filter((x) => x.length > 0).at(-1) ?? [];
          rec(`${lang}.U.${name}.${label}`, `no note; the request carries exactly ${j(expectIds)}`, `blocked=${j(blocked)} lastIds=${j(last)}`,
            blocked.length === 0 && last.length === expectIds.length && expectIds.every((x) => last.includes(x)));
        }
      });
    };
    await visit(`bu=${U}`, "a-too_many", "too_many");
    await visit(`bu=${U}&status=active`, "b-active", null, active);
    await visit(`bu=${U}&status=active&phase=${phaseU}`, "c-active-phase", null, active);
    await visit(`bu=${U}&phase=${otherPhase}`, "c-other-phase", "none_matching");
    await visit(`bu=${U}&status=closed`, "d-closed", "none_matching");
    await visit(`bu=${U}&tr=${lastU}`, "e-tr-last-of-unit", null, [lastU]);
    await visit(`bu=${U}&tr=${tC.id}`, "f-tr-other-unit", "none_matching");
    await visit(`bu=${EMPTY}`, "g-empty-unit", "none");
  }
  await o.ctx.close();
}
await browser.close();
console.log(`### summary ${results.filter((r) => r.pass).length}/${results.length} PASS`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
