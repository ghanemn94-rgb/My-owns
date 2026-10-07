// domain-reviewer DG2 round 14 (T-DG2-REV-DOM-R14): verifies F-DG2-480's fix (FE10, D-074) in the browser, EN (LTR) and
// AR (RTL). SYNTHETIC data (seed-dev users); role assignments/revocations are synthetic access changes, not approvals.
// For each way a session can end while the app is open, the user is on an app page, the session ends outside the page,
// and the user then clicks an in-app link (SPA navigation). Expected (assignment R14 item 1/2):
//   - the tab lands ONCE on /login?returnTo=<page>&error=session_expired with the sign-in form and the localized message;
//   - the number of /me requests is bounded (< 10 in 10 s), no 429 is ever answered, and no stale signed-in shell
//     (sign-out button, user name, navigation) is shown after the session ended;
//   - a second browser context from the same IP can still sign in;
//   - signing in again on that page returns the user to the page they were on.
// Triggers: other-tab sign-out (a real second tab of the same browser context clicks "Sign out"), administrator
// revocation of the user's role assignment, idle expiry and absolute expiry (the session row's expiry moved into the past
// with psql, which is what the clock passing the expiry does), and the logout-by-API control used in round 13.
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT, TAG = process.env.TAG ?? "raised-limits";
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
async function api(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch) => { const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json" }; if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`; else h["idempotency-key"] = randomUUID(); const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };
}
const admin = await api("dev.admin"), lead = await api("dev.lead");
const NOBODY = "01920000-0000-7000-9000-000000000205";
const b = await chromium.launch();
const errors = [];
const triggers = (process.env.TRIGGERS ?? "other-tab-signout,revocation,idle-expiry,absolute-expiry,api-logout").split(",");
async function signIn(p, lang, user) {
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill(user); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(800);
}
for (const lang of ["en", "ar"]) {
  const A = I(lang, "auth"); const msg = A.errors.session_expired;
  for (const trig of triggers) {
    const user = trig === "revocation" ? "dev.nobody" : "dev.lead";
    let assignment = null, t = null;
    if (trig === "revocation") {
      t = (await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R14 revoke ${lang} ${TAG}`, mode: "end_to_end" })).body;
      assignment = (await admin("POST", "/api/v1/role-assignments", { userId: NOBODY, roleCode: "TL", scope: { type: "transformation", id: t.id }, reason: "Synthetic R14 UI access" })).body;
    }
    const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${lang}/${trig} pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}/${trig}: ${m.text()}`); });
    let me = 0, s429 = 0, loginNavs = 0, counting = false;
    p.on("request", (r) => { if (counting && new URL(r.url()).pathname === "/api/v1/me") me++; });
    p.on("response", (r) => { if (counting && r.status() === 429) s429++; });
    p.on("framenavigated", (fr) => { if (counting && fr === p.mainFrame() && new URL(fr.url()).pathname === "/login") loginNavs++; });
    await signIn(p, lang, user);
    const startPath = trig === "revocation" ? `/transformations/${t.id}` : "/my-work";
    if (startPath !== "/my-work") { await p.goto(BASE + startPath); await p.waitForTimeout(1200); }
    const userName = (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
    // end the session outside this page
    let how = "";
    if (trig === "other-tab-signout") {
      const p2 = await ctx.newPage(); await p2.goto(BASE + "/my-work"); await p2.waitForTimeout(1000);
      await p2.getByRole("button", { name: A.signOut }).first().click(); await p2.waitForURL("**/login**"); await p2.waitForTimeout(500);
      how = `second tab signed out -> ${new URL(p2.url()).pathname}${new URL(p2.url()).search}`; await p2.close();
    } else if (trig === "revocation") {
      const r = await admin("POST", `/api/v1/role-assignments/${assignment.id}/revoke`, { reason: "Synthetic R14 UI revoke" }, assignment.version);
      how = `revoke=${r.status}`;
    } else if (trig === "idle-expiry" || trig === "absolute-expiry") {
      const col = trig === "idle-expiry" ? "idle_expires_at" : "absolute_expires_at";
      const n = psql(`with u as (update session set ${col} = now() - interval '1 second' where user_id='01920000-0000-7000-9000-000000000203' and revoked_at is null and idle_expires_at > now() - interval '1 day' returning 1) select count(*) from u`);
      how = `${col} moved to the past for ${n} live dev.lead session(s)`;
    } else {
      const csrf = await p.evaluate(async () => (await (await fetch("/api/v1/me")).json()).csrfToken);
      const lo = await p.evaluate(async (c) => (await fetch("/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": c, "content-type": "application/json" }, body: "{}" })).status, csrf);
      how = `logout by API from the page = ${lo}`;
    }
    me = 0; s429 = 0; loginNavs = 0; counting = true; const t0 = Date.now();
    const link = startPath === "/my-work" ? 'a[href="/transformations"]' : 'a[href="/my-work"]';
    const target = startPath === "/my-work" ? "/transformations" : "/my-work";
    await p.locator(link).first().click();
    const timeline = []; let last = ""; let settled = null; let staleShellAfterLogin = false;
    for (let i = 0; i < 40; i++) {
      const url = new URL(p.url()); const text = (await p.locator("body").innerText().catch(() => "")).trim();
      const form = await p.locator("input").count();
      const shell = (await p.locator(".user-box").count()) > 0 || (await p.getByRole("button", { name: A.signOut }).count()) > 0;
      if (url.pathname === "/login" && shell) staleShellAfterLogin = true;
      const state = `${url.pathname} blank=${!text} form=${form > 0} msg=${text.includes(msg)} shell=${shell}`;
      if (state !== last) { timeline.push(`+${Date.now() - t0}ms ${state}`); last = state; }
      if (url.pathname === "/login" && form > 0 && settled === null) settled = Date.now() - t0;
      await p.waitForTimeout(250);
    }
    counting = false;
    const u = new URL(p.url());
    const bodyText = await p.locator("body").innerText();
    const final = { path: u.pathname, returnTo: u.searchParams.get("returnTo"), error: u.searchParams.get("error"), form: (await p.locator("input").count()) > 0, msg: bodyText.includes(msg), shell: (await p.locator(".user-box").count()) > 0, nameShown: !!userName && bodyText.includes(userName), dir: await p.locator("html").getAttribute("dir"), lang: await p.locator("html").getAttribute("lang") };
    const enLeak = lang === "ar" && bodyText.includes(I("en", "auth").errors.session_expired);
    await p.screenshot({ path: `${OUT}/${lang}-r14-session-end-${trig}-${TAG}.png`, fullPage: false });
    console.log(`TIMELINE ${lang} ${trig} [${TAG}] (${how}; /me requests in 10 s: ${me}; 429s: ${s429}; navigations to /login: ${loginNavs})\n  ${timeline.join("\n  ")}`);
    const okRet = final.returnTo === target || final.returnTo === startPath;
    rec(`${lang}.${trig}.lands-once-on-sign-in`, `one navigation to /login?returnTo=${target}&error=session_expired; sign-in form; '${msg}'; dir ${lang === "ar" ? "rtl" : "ltr"}; /me < 10; no 429; no stale shell; no EN leak`, `${how}; final=${JSON.stringify(final)}; loginNavs=${loginNavs}; /me=${me}; 429=${s429}; staleShellOnLogin=${staleShellAfterLogin}; settled=${settled}ms; enLeak=${enLeak}`,
      loginNavs === 1 && final.path === "/login" && okRet && final.error === "session_expired" && final.form && final.msg && !final.shell && !final.nameShown && final.dir === (lang === "ar" ? "rtl" : "ltr") && me < 10 && s429 === 0 && !staleShellAfterLogin && !enLeak);
    // a second browser context from the same IP still signs in
    const c3 = await b.newContext({ locale: "en-US" }); const p3 = await c3.newPage();
    await p3.goto(BASE + "/login"); const f3 = p3.locator("input").first(); await f3.fill("dev.auditor"); await f3.press("Enter");
    const ok3 = await p3.waitForURL("**/my-work", { timeout: 8000 }).then(() => true, () => false);
    rec(`${lang}.${trig}.other-context-signs-in`, "a second context from the same IP signs in (dev.auditor reaches /my-work)", `${new URL(p3.url()).pathname} ok=${ok3}`, ok3); await c3.close();
    // signing in again returns the user to their page
    const f2 = p.locator("input").first(); await f2.fill(user); await f2.press("Enter");
    const back = await p.waitForURL((x) => x.pathname !== "/login", { timeout: 8000 }).then(() => true, () => false); await p.waitForTimeout(800);
    const bp = new URL(p.url()).pathname;
    rec(`${lang}.${trig}.sign-in-returns`, `signing in again (${user}) lands on ${final.returnTo}`, `landed=${bp} ok=${back} msgStillShown=${(await p.locator("body").innerText()).includes(msg)}`, back && bp === final.returnTo);
    await ctx.close();
  }
}
await b.close();
rec("no-page-errors", "no page errors / console errors other than Chromium's 'Failed to load resource' for the expected 401s", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
