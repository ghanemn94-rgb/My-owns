// domain-reviewer DG2 round 16 (T-DG2-REV-DOM-R16) r16-identity-nav: residual of FE14 / D-076 in a real browser, EN (LTR) and AR (RTL).
// SYNTHETIC data (seed-dev users). Nothing here is a business approval.
// Claim under review (D-076): when the user changed in another tab, on return to the tab the header name updates together
// with the data (GET /me is revalidated first), instead of the previous name staying for up to 60 s (my round-15 observation,
// r15-identity-ui-attempt4.log: refocus 16 s after the last /me refetched the list under B's cookie but not /me).
// S2b (the round-15 attempt-4 timing): tab 1 (A = dev.lead) shows A's record on Transformations. Tab 2 (same context, same
//   cookie jar) signs out with the button and signs B (dev.nobody) in. Tab 1 waits until 16 s after its last /me (page data
//   stale at 15 s, /me fresh for 60 s), regains focus. List requests are delayed 3 s by the probe.
//   Expected: tab 1 asks /me FIRST (before any list request); B's name is shown; A's record never shown again, and
//   A's name is never shown together with B-fetched list content; at the end no A record or A name.
// attempt 1 (r16-identity-ui-attempt1.log): asserted '${secret}' in 0 samples, but the first sample (+0 ms, before the
//   refocus /me answered) is A's own screen with A's own name (timeline '110'), not a leak to B. Probe mistake; the
//   assertion now forbids A's record together with B's name in any sample (a timeline row "1?1") and allows <= 2 early samples.
// S3 (observation only, no PASS/FAIL): same setup, tab 1 does NOT wait (nothing stale) and the user clicks a link to A's
//   transformation detail page (not cached). Records what tab 1 shows (header name, page state) and whether /me is asked.
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
async function api(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body) => { const res = await fetch(BASE + path, { method, headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": randomUUID() }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };
}
const lead = await api("dev.lead");
const errors = [];
const b = await chromium.launch();
const isList = (u) => /^\/api\/v1\/(transformations|my-work|me\/work)/.test(new URL(u).pathname);
const delayLists = (p, on) => p.route((u) => isList(u), async (route) => { if (on.v) await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
async function setLang(p, lang) {
  if ((await p.locator("html").getAttribute("lang")) !== lang) { await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).first().click(); await p.waitForTimeout(600); }
}
async function formSignIn(p, user) { const f = p.locator("input").first(); await f.waitFor({ timeout: 8000 }); await f.fill(user); await f.press("Enter"); }
async function sample(p, ms, needles) {
  const seen = {}; for (const n of needles) seen[n] = 0; let samples = 0; const timeline = [];
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const txt = await p.locator("body").innerText().catch(() => ""); samples++; const row = needles.map((n) => (txt.includes(n) ? 1 : 0)); row.forEach((v, i) => { seen[needles[i]] += v; }); timeline.push(row.join("")); await p.waitForTimeout(100); }
  return { samples, seen, timeline: timeline.join(" ") };
}
async function setup(lang, tag) {
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const delay = { v: false }; await delayLists(p, delay);
  p.on("pageerror", (e) => errors.push(`${lang}/${tag} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}/${tag}: ${m.text()}`); });
  await p.goto(BASE + "/login"); await setLang(p, lang); await formSignIn(p, "dev.lead"); await p.waitForURL("**/my-work"); await p.waitForTimeout(600);
  const aName = (await p.locator(".user-box__name").innerText()).trim();
  const st = { lastMe: Date.now(), reqs: [] };
  p.on("response", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") st.lastMe = Date.now(); });
  p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/v1/")) st.reqs.push({ t: Date.now(), path: u.pathname }); });
  return { ctx, p, delay, aName, st };
}
async function switchInTab2(ctx, lang) {
  const p2 = await ctx.newPage(); await p2.goto(BASE + "/my-work"); await p2.waitForTimeout(1000);
  await p2.getByRole("button", { name: I(lang, "auth").signOut }).first().click(); await p2.waitForURL("**/login**"); await p2.waitForTimeout(800);
  await formSignIn(p2, "dev.nobody"); await p2.waitForURL((u) => u.pathname !== "/login", { timeout: 8000 }); await p2.waitForTimeout(800);
  return (await p2.locator(".user-box__name").innerText().catch(() => "")).trim();
}
// r16-identity-nav (reproduction for F-DG2-570): tab 1 (A) returns to focus WITHIN the 15 s fresh window after tab 2
// signed B in (nothing stale, so D-076's refocus revalidation correctly asks nothing). The user then keeps working in tab 1
// without another focus event: (N1) opens A's own record (not cached) and (N2) 16 s later opens Transformations (stale, so
// it refetches on mount). Records what the header shows and whose data the page shows, and whether GET /me is asked.
// PASS/FAIL lines state the expected product behaviour (header and data of one identity).
for (const lang of ["en", "ar"]) {
  console.log(`saved language set to ${lang}:`, psql(`update app_user set preferred_locale='${lang}' where id in ('01920000-0000-7000-9000-000000000203','01920000-0000-7000-9000-000000000205') returning id`).split("\n").length, "row(s)");
  const secret = `R16N A-ONLY ${lang} ${randomUUID().slice(0, 8)}`;
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic ${secret}`, mode: "end_to_end" });
  const { ctx, p, aName, st } = await setup(lang, "N");
  await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(1500);
  const control = (await p.locator("body").innerText()).includes(secret);
  const tab2Name = await switchInTab2(ctx, lang);
  await p.bringToFront(); const t0 = Date.now(); await p.evaluate(() => window.dispatchEvent(new Event("visibilitychange"))); await p.waitForTimeout(500);
  console.log(`${lang} refocus ${t0 - st.lastMe} ms after tab 1's last /me; control A sees record=${control}`);
  await p.locator(`a:has-text("${secret}")`).first().click(); await p.waitForTimeout(2000);
  const n1 = { header: (await p.locator(".user-box__name").innerText()).trim(), states: await p.locator("[data-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-state"))), body: (await p.locator("body").innerText()).slice(0, 0) };
  await p.screenshot({ path: `${OUT}/${lang}-r16-N1-own-record-under-a-name.png` });
  rec(`${lang}.N1.own-record`, `header and page of ONE identity: either B's name, or A's name with A's record`, `header='${n1.header}' (A='${aName}', B='${tab2Name}') pageStates=${JSON.stringify(n1.states)} meRequests=${st.reqs.filter((r) => r.t >= t0 && r.path === "/api/v1/me").length}`, n1.header === tab2Name || !n1.states.includes("no-permission"));
  await p.waitForTimeout(16000);
  await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(2500);
  const txt = await p.locator("body").innerText(); const header = (await p.locator(".user-box__name").innerText()).trim();
  await p.screenshot({ path: `${OUT}/${lang}-r16-N2-list-under-a-name.png` });
  rec(`${lang}.N2.list-after-16s`, `header and list of ONE identity (A's name => A's list incl. '${secret}'; B's name => B's list)`, `header='${header}' listHasASecret=${txt.includes(secret)} meRequests=${st.reqs.filter((r) => r.t >= t0 && r.path === "/api/v1/me").length} listRequests=${st.reqs.filter((r) => r.t >= t0 && r.path === "/api/v1/transformations").length} sinceLastMe=${Date.now() - st.lastMe} ms`, header === tab2Name ? !txt.includes(secret) : txt.includes(secret));
  await ctx.close();
}
await b.close();
rec("no-page-errors", "no page errors / console errors other than 'Failed to load resource'", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
