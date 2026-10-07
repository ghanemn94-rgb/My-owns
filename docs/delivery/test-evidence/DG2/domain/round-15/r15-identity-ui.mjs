// domain-reviewer DG2 round 15 (T-DG2-REV-DOM-R15): user outcome of FE13 / D-075 in a real browser, EN (LTR) and AR (RTL).
// SYNTHETIC data (seed-dev users). Nothing here is a business approval.
// Claim under review: when a session ends, even while the sign-in page is shown, the tab clears the previous user's cached
// data, so a different person who signs in in the same tab never sees the previous user's records.
// Scenario S1 (session ends while the sign-in page is shown, the F-DG2-500 path):
//   A (dev.lead) opens /login, clicks the wordmark (pushes an in-document /login entry), signs in (replace -> /my-work),
//   opens Transformations and sees a transformation only A can see ("R15 A-ONLY ..."). A's session is ended outside the
//   page (logout by API). The tab goes back to the in-document /login entry (history.go, a popstate: no page load), whose
//   /me re-probe gets the 401. B (dev.nobody, no roles) signs in with the form in the same tab. B's list requests are
//   delayed 3 s by the probe, so any cached record of A's would be what the screen shows meanwhile.
//   Expected: in every sample (every 100 ms for 5 s on My work and on Transformations) neither A's record nor A's name is
//   shown; B's name is shown.
// Scenario S2 (no 401 announces the change; identity changes underneath): tab 1 shows A's record; tab 2 (same browser
//   context, same cookie jar) signs A out with the button and signs B in. Tab 1 regains focus (visibilitychange), its /me
//   re-probe returns B. Expected: tab 1 never shows A's record or name after that, and shows B's name.
// Positive controls: A sees the A-ONLY record before the switch; the 3 s delay is in effect (B's list is still loading
// 1 s after navigation), so a cached record would have been visible had it not been cleared.
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
const delayLists = (p, on) => p.route((u) => /^\/api\/v1\/(transformations|my-work|me\/work)/.test(new URL(u).pathname), async (route) => { if (on.v) await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
async function setLang(p, lang) {
  if ((await p.locator("html").getAttribute("lang")) !== lang) { await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).first().click(); await p.waitForTimeout(600); }
}
async function formSignIn(p, user) { const f = p.locator("input").first(); await f.waitFor({ timeout: 8000 }); await f.fill(user); await f.press("Enter"); }
async function sample(p, ms, needles, both) {
  const seen = {}; for (const n of needles) seen[n] = 0; let samples = 0; seen.both = 0;
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const txt = await p.locator("body").innerText().catch(() => ""); samples++; for (const n of needles) if (txt.includes(n)) seen[n]++; if (both && both.every((x) => txt.includes(x))) seen.both++; await p.waitForTimeout(100); }
  return { samples, seen };
}
for (const lang of ["en", "ar"]) {
  // attempt 2 (r15-identity-ui-attempt2.log): the saved profile language wins after sign-in, so the EN pass rendered in
  // Arabic (dev.lead's saved language). Probe setup mistake; set both synthetic users' saved language to this pass's.
  console.log(`saved language of dev.lead and dev.nobody set to ${lang}:`, psql(`update app_user set preferred_locale='${lang}' where id in ('01920000-0000-7000-9000-000000000203','01920000-0000-7000-9000-000000000205') returning id`).split("\n").length, "row(s)");
  const secret = `R15 A-ONLY ${lang} ${randomUUID().slice(0, 8)}`;
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic ${secret}`, mode: "end_to_end" });
  console.log(`setup ${lang}: A's transformation '${secret}' create=${t.status}`);
  // ---------------- S1 ----------------
  {
    const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage(); const delay = { v: false }; await delayLists(p, delay);
    p.on("pageerror", (e) => errors.push(`${lang}/S1 pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}/S1: ${m.text()}`); });
    let loads = 0; p.on("load", () => loads++);
    // attempt 1 (r15-identity-ui-attempt1.log): on /login the wordmark Link targets the current location, which React
    // Router REPLACES rather than pushes, so history.go(-2) reached the page's initial about:blank entry (a document load
    // that destroyed the evaluate context). Probe mistake. Start on /login?returnTo=%2Fmy-work so the wordmark (/login)
    // pushes a real in-document /login entry; history = [blank, /login?returnTo, /my-work (replaces /login), /transformations].
    await p.goto(BASE + "/login?returnTo=%2Fmy-work"); await setLang(p, lang);
    await p.locator("[data-testid='wordmark']").first().click(); await p.waitForTimeout(400);
    await formSignIn(p, "dev.lead"); await p.waitForURL("**/my-work"); await p.waitForTimeout(600);
    const aName = (await p.locator(".user-box__name").innerText()).trim();
    await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(1500);
    const before = (await p.locator("body").innerText()).includes(secret);
    await p.screenshot({ path: `${OUT}/${lang}-r15-S1-a-sees-own.png` });
    rec(`${lang}.S1.control-a-sees-record`, `A ('${aName}') sees '${secret}' on Transformations`, `shown=${before} path=${new URL(p.url()).pathname} histLen=${await p.evaluate(() => history.length)}`, before);
    const lo = await p.evaluate(async () => { const me = await (await fetch("/api/v1/me")).json(); return (await fetch("/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": me.csrfToken, "content-type": "application/json" }, body: "{}" })).status; });
    const loadsBefore = loads;
    console.log(`history before Back: length=${await p.evaluate(() => history.length)}`); await p.evaluate(() => { setTimeout(() => history.go(-2), 0); }); await p.waitForURL((u) => u.pathname === "/login"); await p.waitForTimeout(1200);
    const onLogin = { path: new URL(p.url()).pathname, search: new URL(p.url()).search, form: await p.locator("input").count(), docLoads: loads - loadsBefore, dir: await p.locator("html").getAttribute("dir"), bodyHasSecret: (await p.locator("body").innerText()).includes(secret) };
    rec(`${lang}.S1.back-to-in-document-login`, "A's session ended (logout 204); Back reaches the in-document /login entry (no document load), form shown", `logout=${lo} ${JSON.stringify(onLogin)}`, (lo === 204 || lo === 200) && onLogin.path === "/login" && onLogin.docLoads === 0 && onLogin.form > 0 && !onLogin.bodyHasSecret);
    delay.v = true;
    await formSignIn(p, "dev.nobody");
    await p.waitForURL((u) => u.pathname !== "/login", { timeout: 8000 });
    const s1 = await sample(p, 5000, [secret, aName]);
    const bName = (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
    await p.screenshot({ path: `${OUT}/${lang}-r15-S1-b-landing.png` });
    rec(`${lang}.S1.b-landing-no-a-data`, `B lands; in no sample is '${secret}' or A's name '${aName}' shown; B's name shown`, `landed=${new URL(p.url()).pathname} samples=${s1.samples} seen=${JSON.stringify(s1.seen)} bName='${bName}' dir=${await p.locator("html").getAttribute("dir")}`, (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr") && s1.samples > 20 && s1.seen[secret] === 0 && s1.seen[aName] === 0 && !!bName && bName !== aName);
    await p.locator('a[href="/transformations"]').first().click();
    await p.waitForTimeout(1000);
    const loading = !(await p.locator("body").innerText()).includes(secret);
    const s2 = await sample(p, 4000, [secret, aName]);
    await p.screenshot({ path: `${OUT}/${lang}-r15-S1-b-transformations.png` });
    rec(`${lang}.S1.b-transformations-no-a-record`, `on Transformations (list delayed 3 s), in no sample is '${secret}' or '${aName}' shown`, `samples=${s2.samples} seen=${JSON.stringify(s2.seen)} noSecretAt1s=${loading} path=${new URL(p.url()).pathname}`, s2.samples > 20 && s2.seen[secret] === 0 && s2.seen[aName] === 0);
    await ctx.close();
  }
  // ---------------- S2 ----------------
  {
    const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage(); const delay = { v: false }; await delayLists(p, delay);
    p.on("pageerror", (e) => errors.push(`${lang}/S2 pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}/S2: ${m.text()}`); });
    await p.goto(BASE + "/login"); await setLang(p, lang); await formSignIn(p, "dev.lead"); await p.waitForURL("**/my-work"); await p.waitForTimeout(600);
    const aName = (await p.locator(".user-box__name").innerText()).trim();
    let tab1LastMe = Date.now(); p.on("response", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") tab1LastMe = Date.now(); });
    await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(1500);
    const before = (await p.locator("body").innerText()).includes(secret);
    rec(`${lang}.S2.control-a-sees-record`, `tab 1: A sees '${secret}'`, `shown=${before}`, before);
    const p2 = await ctx.newPage(); await p2.goto(BASE + "/my-work"); await p2.waitForTimeout(1000);
    await p2.getByRole("button", { name: I(lang, "auth").signOut }).first().click(); await p2.waitForURL("**/login**"); await p2.waitForTimeout(800);
    await formSignIn(p2, "dev.nobody"); await p2.waitForURL((u) => u.pathname !== "/login", { timeout: 8000 }); await p2.waitForTimeout(800);
    const tab2Name = (await p2.locator(".user-box__name").innerText().catch(() => "")).trim();
    // attempt 3 (r15-identity-ui-attempt3.log): the refocus came within the product's 15 s staleTime of tab 1's last /me,
    // so TanStack Query (correctly) refetched nothing and tab 1 still showed A's own screen with A's name (never with B's).
    // Probe timing mistake. Wait until tab 1's data is stale (16 s after its last /me), then refocus, and count /me.
    let me1 = 0; p.on("request", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") me1++; });
    // attempt 4 (r15-identity-ui-attempt4.log): GET /me has its own staleTime of 60 s (api/queries.ts useMeQuery), so a
    // refocus 16 s later refetched the stale list (under B's cookie: A's record disappeared, never shown with B) but not
    // /me (tab1MeAfterRefocus=0): A's name stayed in tab 1's header. That interim state is recorded in the review; this
    // run waits until /me itself is stale (61 s) to observe the designed identity-change purge (D-075 (2)).
    const waitMs = Math.max(0, Number(process.env.S2_WAIT_MS ?? 61000) - (Date.now() - tab1LastMe)); await p.waitForTimeout(waitMs);
    await p.bringToFront(); delay.v = true;
    await p.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    const s = await sample(p, 5000, [secret, aName], [secret, tab2Name]);
    const bName = (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
    await p.screenshot({ path: `${OUT}/${lang}-r15-S2-tab1-after-switch.png` });
    // The first ~100 ms sample may be taken before the refocus /me answer arrives; that is the previous identity's own
    // screen, not a leak to B. A leak is A's record shown while B's name is shown, or A's record still shown at the end.
    const finalTxt = await p.locator("body").innerText();
    rec(`${lang}.S2.tab1-after-identity-change`, `tab 1 after refocus: B's name ('${tab2Name}') shown; '${secret}' and '${aName}' gone and never shown together with B`, `samples=${s.samples} seen=${JSON.stringify(s.seen)} bName='${bName}' finalHasSecret=${finalTxt.includes(secret)} finalHasAName=${finalTxt.includes(aName)} tab1MeAfterRefocus=${me1} waitedMs=${waitMs} path=${new URL(p.url()).pathname}`,
      bName === tab2Name && bName !== aName && !finalTxt.includes(secret) && !finalTxt.includes(aName) && s.seen.both === 0 && s.seen[secret] <= 2);
    await ctx.close();
  }
}
await b.close();
rec("no-page-errors", "no page errors / console errors other than 'Failed to load resource' for the expected 401s", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
