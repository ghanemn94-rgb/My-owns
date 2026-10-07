// domain-reviewer DG2 round 13 (T-DG2-REV-DOM-R13): follow-up to r13-ui.mjs (c), whose 1.5 s capture after the refused
// upload showed a blank page (a page still settling). This probe records what the user sees over time, sampling every
// 250 ms for up to 15 s, after an upload is refused because an administrator revoked the uploader's assignment
// (which ends their sessions). EN (LTR) and AR (RTL). SYNTHETIC data; role assignments are synthetic access changes.
// Expected product behaviour (apps/web/src/auth/session.tsx): any 401 re-probes /me, then redirects to
// /login?returnTo=...&error=session_expired, where the localized "session ended" message is shown.
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
async function api(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch) => { const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json" }; if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`; else h["idempotency-key"] = randomUUID(); const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };
}
const lead = await api("dev.lead"), admin = await api("dev.admin");
const NOBODY = "01920000-0000-7000-9000-000000000205";
const tmp = mkdtempSync(join(process.env.TMPDIR, "r13uiw-"));
const b = await chromium.launch();
const errors = [];
for (const lang of ["en", "ar"]) {
  const A = I(lang, "auth"), P = I(lang, "problems"), EV = I(lang, "evidence");
  const t = (await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R13 withdrawn ${lang}`, mode: "end_to_end" })).body;
  const a = await admin("POST", "/api/v1/role-assignments", { userId: NOBODY, roleCode: "TL", scope: { type: "transformation", id: t.id }, reason: "Synthetic R13 UI access" });
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${lang} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}: ${m.text()}`); });
  const meCalls = []; p.on("response", (r) => { if (new URL(r.url()).pathname === "/api/v1/me") meCalls.push(r.status()); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.nobody"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(500);
  const ev = await p.evaluate(async ([tid, owner, title]) => { const me = await (await fetch("/api/v1/me")).json(); const r = await fetch(`/api/v1/transformations/${tid}/evidence`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": me.csrfToken, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ kind: "file", title, ownerUserId: owner }) }); return { status: r.status, body: await r.json() }; }, [t.id, NOBODY, `Synthetic R13 withdrawn ${lang}`]);
  const file = join(tmp, `سحب-${lang}.bin`); writeFileSync(file, Buffer.from("‏ملف تجريبي 📎", "utf8"));
  await p.goto(`${BASE}/transformations/${t.id}/evidence`); await p.waitForTimeout(1500);
  await p.locator("button").filter({ hasText: EV.upload.action }).filter({ hasText: `Synthetic R13 withdrawn ${lang}` }).click();
  await p.locator("input[type=file]").setInputFiles(file);
  const rv = await admin("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, { reason: "Synthetic R13 UI revoke before upload" }, a.body.version);
  meCalls.length = 0;
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/evidence/${ev.body.id}/content`));
  await p.getByRole("button", { name: EV.upload.confirm, exact: true }).click();
  const r = await resp; const t0 = Date.now();
  const timeline = []; let last = ""; let shownAt = null;
  const msg = A.errors.session_expired;
  for (let i = 0; i < 60; i++) {
    const url = new URL(p.url()); const text = await p.locator("body").innerText().catch(() => "");
    const state = `${url.pathname}${url.search.includes("session_expired") ? "?…error=session_expired" : ""} | text=${text.trim() ? JSON.stringify(text.trim().slice(0, 60)) : "(blank)"} | msg=${text.includes(msg)}`;
    if (state !== last) { timeline.push(`+${Date.now() - t0}ms ${state}`); last = state; }
    // attempt 1 stopped at the first sight of the message (the upload dialog's own alert); now sample until the
    // sign-in page itself shows it, so the timeline records where the user actually ends up
    if (text.includes(msg) && shownAt === null) shownAt = Date.now() - t0;
    if (url.pathname === "/login" && text.includes(msg)) { timeline.push(`+${Date.now() - t0}ms on /login with the message`); break; }
    await p.waitForTimeout(250);
  }
  await p.screenshot({ path: `${OUT}/${lang}-r13-upload-access-withdrawn.png`, fullPage: false });
  const text = await p.locator("body").innerText();
  const enLeak = lang === "ar" && (text.includes(I("en", "auth").errors.session_expired) || /Your access to this record changed/.test(text));
  const revs = psql(`select count(*) from evidence_content where evidence_id='${ev.body.id}'`);
  console.log(`TIMELINE ${lang}\n  ${timeline.join("\n  ")}\n  /me answers after the upload: ${JSON.stringify(meCalls)}`);
  rec(`${lang}.upload-refused-after-access-withdrawn`, `assign 201; evidence 201; revoke 200; upload 401; the message '${msg}' (localized) is shown and the user ends on the sign-in page showing it, within 15 s; dir ${lang === "ar" ? "rtl" : "ltr"}; no English leak in AR; 0 revisions`, `assign=${a.status} evidence=${ev.status} revoke=${rv.status} upload=${r.status()} shownAt=${shownAt}ms url=${new URL(p.url()).pathname}${new URL(p.url()).search} dir=${await p.locator("html").getAttribute("dir")} enLeak=${enLeak} revisions=${revs}`, a.status === 201 && ev.status === 201 && rv.status === 200 && r.status() === 401 && shownAt !== null && new URL(p.url()).pathname === "/login" && (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr") && !enLeak && revs === "0");
  // signing in again after the refusal works
  const f2 = p.locator("input").first(); await f2.fill("dev.lead"); await f2.press("Enter"); await p.waitForTimeout(1500);
  rec(`${lang}.sign-in-after-refusal`, "the sign-in form on that page signs in again (dev.lead)", new URL(p.url()).pathname, !new URL(p.url()).pathname.startsWith("/login"));
  await ctx.close();
}
await b.close();
rec("no-page-errors", "no page errors or console errors other than Chromium's 'Failed to load resource' lines for the expected 401s", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
