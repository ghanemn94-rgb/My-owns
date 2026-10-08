// domain-reviewer DG3 round 2: layout measurement of the inherited-approval badge (F-DG3-120 repair) on the real stack.
// SYNTHETIC data; the Sponsor acceptance is a demo business decision that approves nothing real (never DG0-DG7).
// For an accepted (counting) G1 inherited approval it measures, in EN and AR at viewport widths 1366, 1920 and 1024:
//  - on the Gates list: the badge's box vs the G1 card's box (does it stay inside?), and whether its full text is visible
//    (scrollWidth vs clientWidth of the badge and of the card);
//  - on the G1 gate view: the badge's box vs its row and the page's horizontal overflow (document scrollWidth vs viewport).
// It saves a viewport (not full-page) screenshot of each case. Expected for a correct layout: the badge stays inside its
// card/row and the page never scrolls horizontally. Exit 1 = at least one case overflows (reported, by design).
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const DEV_ISSUER = "urn:mth:dev-local"; const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const j = (x) => JSON.stringify(x);
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body)}`); return r.body; };
const lead = await session("dev.lead"); const admin = await session("dev.admin"); const office = await session("dev.office");
const orgId = admin.me.organization.id; const stamp = Date.now().toString(36);
const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular layout R2", mode: "modular", entryPhase: "mobilize" }), 201, "m");
const MT = `/api/v1/transformations/${m.id}`;
const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: "Synthetic SP", preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: `dl.sp.${stamp}` } }), 201, "user");
must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode: "SP", scope: { type: "transformation", id: m.id }, reason: "Synthetic demo role (approves nothing real)" }), 201, "grant");
const sp = await session(`dl.sp.${stamp}`);
const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic prior board minute", ownerUserId: lead.id, noteBody: "Synthetic." }), 201, "ev");
must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, ev.version), 200, "verify");
const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic demo (approves nothing real)" }, d.version), 200, "accept");

const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
for (const lang of ["en", "ar"]) {
  for (const width of [1366, 1920, 1024]) {
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
    await field.fill("dev.lead"); await field.press("Enter"); await page.waitForURL("**/my-work", { timeout: 20000 });
    if ((await page.locator("html").getAttribute("lang")) !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
    // Gates list
    await page.goto(`${BASE}/transformations/${m.id}/gates`); await page.waitForLoadState("networkidle"); await page.locator("[data-inherited-approval]").waitFor();
    let mm = await page.evaluate(() => {
      const b = document.querySelector("[data-inherited-approval]"); const c = b.closest("[data-gate]");
      const br = b.getBoundingClientRect(); const cr = c.getBoundingClientRect();
      return { badge: [Math.round(br.left), Math.round(br.right)], card: [Math.round(cr.left), Math.round(cr.right)], badgeScroll: b.scrollWidth, badgeClient: b.clientWidth, docScroll: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    const inside = mm.badge[0] >= mm.card[0] && mm.badge[1] <= mm.card[1];
    await page.screenshot({ path: `${SHOTS}/${lang}-overflow-${width}-gates-list.png` });
    rec(`${lang}.${width}.list.badge-inside-card`, "badge box within the G1 card box; page not wider than the viewport", j(mm), inside && mm.docScroll <= mm.vw);
    // G1 view
    await page.goto(`${BASE}/transformations/${m.id}/gates/G1`); await page.waitForLoadState("networkidle"); await page.locator("[data-inherited-approval]").waitFor();
    mm = await page.evaluate(() => {
      const b = document.querySelector("[data-inherited-approval]"); const c = b.closest("section, .card, [class*=card]") ?? document.querySelector("main");
      const br = b.getBoundingClientRect(); const cr = c.getBoundingClientRect();
      return { badge: [Math.round(br.left), Math.round(br.right)], container: [Math.round(cr.left), Math.round(cr.right)], docScroll: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    await page.screenshot({ path: `${SHOTS}/${lang}-overflow-${width}-gate-view.png` });
    rec(`${lang}.${width}.view.no-horizontal-overflow`, "badge within its container; document scrollWidth <= viewport width", j(mm), mm.badge[0] >= mm.container[0] && mm.badge[1] <= mm.container[1] && mm.docScroll <= mm.vw);
    await ctx.close();
  }
}
await browser.close();
const fails = results.filter((x) => !x.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${JSON.stringify(fails.map((f) => f.id))}`);
process.exit(fails.length ? 1 : 0);
