// domain-reviewer DG2 round 16 (T-DG2-REV-DOM-R16): user outcome of FE14 / D-076 in a real browser, EN (LTR) and AR (RTL).
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
for (const lang of ["en", "ar"]) {
  console.log(`saved language of dev.lead and dev.nobody set to ${lang}:`, psql(`update app_user set preferred_locale='${lang}' where id in ('01920000-0000-7000-9000-000000000203','01920000-0000-7000-9000-000000000205') returning id`).split("\n").length, "row(s)");
  const secret = `R16 A-ONLY ${lang} ${randomUUID().slice(0, 8)}`;
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic ${secret}`, mode: "end_to_end" });
  console.log(`setup ${lang}: A's transformation '${secret}' create=${t.status} id=${t.body?.id}`);
  // ---------------- S2b ----------------
  {
    const { ctx, p, delay, aName, st } = await setup(lang, "S2b");
    await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(1500);
    const before = (await p.locator("body").innerText()).includes(secret);
    rec(`${lang}.S2b.control-a-sees-record`, `tab 1: A ('${aName}') sees '${secret}'`, `shown=${before}`, before);
    const tab2Name = await switchInTab2(ctx, lang);
    const waitMs = Math.max(0, Number(process.env.S2_WAIT_MS ?? 16000) - (Date.now() - st.lastMe)); await p.waitForTimeout(waitMs);
    const sinceMe = Date.now() - st.lastMe;
    await p.bringToFront(); delay.v = true; const tRefocus = Date.now();
    await p.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    const s = await sample(p, 5000, [secret, aName, tab2Name]);
    const bName = (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
    await p.screenshot({ path: `${OUT}/${lang}-r16-S2b-tab1-after-switch.png` });
    const after = st.reqs.filter((r) => r.t >= tRefocus).map((r) => `${r.path}@+${r.t - tRefocus}`);
    const firstApi = after[0]?.split("@")[0];
    const finalTxt = await p.locator("body").innerText();
    rec(`${lang}.S2b.me-first-then-b-name`, `refocus ${sinceMe} ms after tab 1's last /me (< 60 s /me staleTime, > 15 s page staleTime): first request after refocus is /api/v1/me; header shows B ('${tab2Name}'); '${secret}' never shown together with B's name and shown in at most 2 samples, '${aName}' in at most 2 samples (both only before /me answers: A's own screen) and gone at the end`,
      `requestsAfterRefocus=${JSON.stringify(after)} bName='${bName}' samples=${s.samples} seen=${JSON.stringify(s.seen)} finalHasSecret=${finalTxt.includes(secret)} finalHasAName=${finalTxt.includes(aName)} path=${new URL(p.url()).pathname} dir=${await p.locator("html").getAttribute("dir")}`,
      firstApi === "/api/v1/me" && bName === tab2Name && bName !== aName && !s.timeline.split(" ").some((r) => r[0] === "1" && r[2] === "1") && s.seen[secret] <= 2 && s.seen[aName] <= 2 && !finalTxt.includes(secret) && !finalTxt.includes(aName) && (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
    console.log(`timeline [secret aName bName] per 100 ms: ${s.timeline}`);
    await ctx.close();
  }
  // ---------------- S3 (observation) ----------------
  {
    const { ctx, p, aName, st } = await setup(lang, "S3");
    await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(1500);
    const tab2Name = await switchInTab2(ctx, lang);
    await p.bringToFront(); const t0 = Date.now();
    await p.evaluate(() => window.dispatchEvent(new Event("visibilitychange"))); await p.waitForTimeout(500);
    const link = p.locator(`a:has-text("${secret}")`).first(); const hasLink = (await link.count()) > 0;
    if (hasLink) await link.click(); await p.waitForTimeout(2500);
    const txt = await p.locator("body").innerText();
    const name = (await p.locator(".user-box__name").innerText().catch(() => "")).trim();
    await p.screenshot({ path: `${OUT}/${lang}-r16-S3-tab1-fresh-nav.png` });
    console.log(`OBSERVATION ${lang}.S3 (no PASS/FAIL): refocus within the fresh window, then click A's record link: linkFound=${hasLink} header='${name}' (A='${aName}', B='${tab2Name}') path=${new URL(p.url()).pathname} pageHasSecret=${txt.includes(secret)} requests=${JSON.stringify(st.reqs.filter((r) => r.t >= t0).map((r) => `${r.path}@+${r.t - t0}`))} stateMarkers=${JSON.stringify(await p.locator("[data-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-state"))))}`);
    await ctx.close();
  }
}
await b.close();
rec("no-page-errors", "no page errors / console errors other than 'Failed to load resource' for the expected 401/403s", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
