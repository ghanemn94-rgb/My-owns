// domain-reviewer DG2 round 17 (T-DG2-REV-DOM-R17) r17-identity-residual: challenge of the documented D-077 residual in a
// real browser, EN (LTR) and AR (RTL). SYNTHETIC data (seed-dev users). Nothing here is a business approval.
// Claim (D-077 (4)): a page GET that is NOT a navigation, sent < 2 s after the last /me and < 2 s after another sign-in,
// may still be fetched under the new cookie under the previous header; it ends at the next navigation, the next GET after
// the window, or a refocus. Navigations have no window.
// Setup per scenario: tab 1 (A = dev.lead) opens Transformations through the nav link (pathname change => /me now),
// the list shows A's own record (secret). Immediately after the list is shown, B (dev.nobody) is signed in IN THE SAME
// COOKIE JAR (context.request POST /auth/dev-login, i.e. another tab's sign-in, without clicking anything in tab 1).
//  R1 (residual, observation): within the 2 s window tab 1 toggles "Include archived" (search param only, no pathname
//     change). OBS line records header / whether A's record is still listed / /me asked. Then, > 2 s after the last /me,
//     tab 1 toggles it back: PASS iff /me is asked before that list GET and header and list are B's (A's record gone,
//     B's name shown).
//  R2 (navigation, no window): within the 2 s window tab 1 clicks the nav link "My work" then "Transformations": PASS iff
//     /me is asked, and header and data belong to one identity (B's name and no A record).
// attempt 1 (r17-identity-residual-attempt1.log): used locator.check(), which throws "Clicking the checkbox did not change
//   its state" because the checkbox is URL-driven (re-rendered after the search param changes). Probe mistake; now click()
//   and record the resulting URL search.
//  No sample during R2 may show A's name together with B-fetched data (no A record visible while A name shown is A's own
//  screen; we record timelines).
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const obs = (id, act) => console.log(`OBS ${id} :: ${act}`);
async function api(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body) => { const res = await fetch(BASE + path, { method, headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": randomUUID() }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };
}
const lead = await api("dev.lead");
const errors = [];
const b = await chromium.launch();
async function setLang(p, lang) {
  if ((await p.locator("html").getAttribute("lang")) !== lang) { await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).first().click(); await p.waitForTimeout(600); }
}
async function formSignIn(p, user) { const f = p.locator("input").first(); await f.waitFor({ timeout: 8000 }); await f.fill(user); await f.press("Enter"); }
const header = async (p) => (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
async function setup(lang, tag, secret) {
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${lang}/${tag} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}/${tag}: ${m.text()}`); });
  await p.goto(BASE + "/login"); await setLang(p, lang); await formSignIn(p, "dev.lead"); await p.waitForURL("**/my-work"); await p.waitForTimeout(600);
  const aName = await header(p);
  const st = { lastMe: 0, reqs: [] };
  p.on("response", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") st.lastMe = Date.now(); });
  p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/v1/")) st.reqs.push({ t: Date.now(), path: u.pathname, search: u.search }); });
  await p.locator('a[href="/transformations"]').first().click();
  await p.locator(`text=${secret}`).first().waitFor({ timeout: 8000 });
  return { ctx, p, aName, st };
}
async function signInBInJar(ctx) {
  const r = await ctx.request.post(`${BASE}/api/v1/auth/dev-login`, { headers: { origin: BASE, "content-type": "application/json" }, data: { username: "dev.nobody" } });
  return r.status();
}
const since = (st, t0, path) => st.reqs.filter((r) => r.t >= t0 && r.path === path);
for (const lang of ["en", "ar"]) {
  psql(`update app_user set preferred_locale='${lang}' where id in ('01920000-0000-7000-9000-000000000203','01920000-0000-7000-9000-000000000205')`);
  const secret = `R17R A-ONLY ${lang} ${randomUUID().slice(0, 8)}`;
  const tr = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic ${secret}`, mode: "end_to_end" });
  console.log(`${lang} A record created: ${tr.status}`);
  const archivedLabel = I(lang, "transformations").filter?.includeArchived ?? I(lang, "transformations").transformations?.filter?.includeArchived;
  // ---------------- R1: non-navigation GET inside the window, then after it
  {
    const { ctx, p, aName, st } = await setup(lang, "R1", secret);
    const lastMe0 = st.lastMe;
    const s = await signInBInJar(ctx); const tSwitch = Date.now();
    await p.getByLabel(archivedLabel).click(); const tFilter = Date.now();
    await p.waitForTimeout(1200);
    const h1 = await header(p), body1 = await p.locator("body").innerText();
    const listReq1 = since(st, tSwitch, "/api/v1/transformations").length, me1 = since(st, tSwitch, "/api/v1/me").length;
    await p.screenshot({ path: `${OUT}/${lang}-r17-R1-filter-inside-window.png` });
    obs(`${lang}.R1.inside-window`, `B dev-login status=${s}; switch ${tSwitch - lastMe0} ms and filter ${tFilter - lastMe0} ms after tab 1's last /me; header='${h1}' (A='${aName}') A-record-listed=${body1.includes(secret)} listGETs=${listReq1} meGETs=${me1} url=${new URL(p.url()).search}`);
    await p.waitForTimeout(Math.max(0, 2300 - (Date.now() - st.lastMe)));
    const t2 = Date.now();
    await p.getByLabel(archivedLabel).click({ timeout: 4000 }).catch((e) => obs(`${lang}.R1.second-click`, `could not click: ${e.message.split("\n")[0]}`));
    await p.waitForTimeout(2500);
    const h2 = await header(p), body2 = await p.locator("body").innerText(); const url2 = new URL(p.url()).search;
    const me2 = since(st, t2, "/api/v1/me"), list2 = since(st, t2, "/api/v1/transformations");
    const meFirst = me2.length > 0 && (list2.length === 0 || me2[0].t <= list2[0].t);
    await p.screenshot({ path: `${OUT}/${lang}-r17-R1-filter-after-window.png` });
    rec(`${lang}.R1.after-window`, `the next GET after the 2 s window asks /me first; header and page then B's (no A record, header != A)`, `t=${t2 - lastMe0} ms after setup /me; meGETs=${me2.length} listGETs=${list2.length} meFirst=${meFirst} header='${h2}' A-record-listed=${body2.includes(secret)} url=${url2}`, meFirst && h2 !== aName && h2 !== "" && !body2.includes(secret));
    await ctx.close();
  }
  // ---------------- R2: navigation inside the window (no window for navigations)
  {
    const { ctx, p, aName, st } = await setup(lang, "R2", secret);
    const lastMe0 = st.lastMe;
    const s = await signInBInJar(ctx); const tSwitch = Date.now();
    await p.locator('a[href="/my-work"]').first().click();
    const tl = []; for (let i = 0; i < 12; i++) { const h = await header(p), txt = await p.locator("body").innerText().catch(() => ""); tl.push(`${h === aName ? "A" : h ? "B" : "-"}${txt.includes(secret) ? 1 : 0}`); await p.waitForTimeout(100); }
    await p.locator('a[href="/transformations"]').first().click().catch(() => {});
    await p.waitForTimeout(2000);
    const h = await header(p), body = await p.locator("body").innerText();
    const me = since(st, tSwitch, "/api/v1/me");
    await p.screenshot({ path: `${OUT}/${lang}-r17-R2-nav-inside-window.png` });
    rec(`${lang}.R2.nav-inside-window`, `navigation ${"<"} 2 s after the last /me asks /me; header and data then B's (header != A, no A record)`, `B dev-login status=${s}; nav ${tSwitch - lastMe0} ms after last /me; meGETs=${me.length} header='${h}' (A='${aName}') A-record-listed=${body.includes(secret)} timeline(header,Arecord)=${tl.join(" ")}`, me.length > 0 && h !== aName && h !== "" && !body.includes(secret));
    await ctx.close();
  }
}
await b.close();
rec("no-page-errors", "no page errors / console errors other than 'Failed to load resource'", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
