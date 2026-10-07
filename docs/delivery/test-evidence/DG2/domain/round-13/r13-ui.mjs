// domain-reviewer DG2 round 13 (T-DG2-REV-DOM-R13): sign-in and evidence after D-073, in the browser, EN (LTR) and AR (RTL).
// SYNTHETIC data (seed-dev users); role assignments here are synthetic access changes, not business approvals.
// (a) Dev sign-in through the login form lands on My work, in the chosen language and direction; sign-out shows the
//     localized signed-out message; signing in again works.
// (b) An evidence upload through the Upload dialog still stores the file and the Download link returns the same bytes.
// (c) Access withdrawn before the upload is confirmed (an administrator revokes the uploader's assignment, which ends the
//     sessions): the upload is refused, the user sees the localized session-ended message (no English leak in AR), and
//     nothing is stored.
import { chromium } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const psql = (q) => execFileSync("psql", [process.env.PSQL_MTH, "-qAtc", q], { encoding: "utf8" }).trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function api(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return async (method, path, body, ifMatch) => { const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json" }; if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`; else h["idempotency-key"] = randomUUID(); const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json().catch(() => null) }; };
}
const lead = await api("dev.lead"), admin = await api("dev.admin");
const NOBODY = "01920000-0000-7000-9000-000000000205", LEAD = "01920000-0000-7000-9000-000000000203";
const tmp = mkdtempSync(join(process.env.TMPDIR, "r13ui-"));
const b = await chromium.launch();
const consoleErrors = [];
async function signIn(p, lang, user) {
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill(user); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(500);
}
for (const lang of ["en", "ar"]) {
  const A = I(lang, "auth"), P = I(lang, "problems"), EV = I(lang, "evidence");
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${lang}: ${m.text()}`); });
  p.on("pageerror", (e) => consoleErrors.push(`${lang} pageerror: ${e.message}`));
  // (a) sign in, sign out, sign in again
  await p.goto(BASE + "/login"); await p.waitForTimeout(600);
  const loginLang = await p.locator("html").getAttribute("lang"), loginDir = await p.locator("html").getAttribute("dir");
  const loginText = await p.locator("body").innerText();
  await signIn(p, lang, "dev.lead");
  const dir = await p.locator("html").getAttribute("dir");
  await p.screenshot({ path: `${OUT}/${lang}-r13-signed-in.png`, fullPage: false });
  rec(`${lang}.dev-signin`, `My work reached; html lang=${lang} dir=${lang === "ar" ? "rtl" : "ltr"}; login page showed the development-only warning`, `url=${new URL(p.url()).pathname} lang=${await p.locator("html").getAttribute("lang")} dir=${dir}; login page lang=${loginLang} dir=${loginDir} warning(en|ar) shown=${loginText.includes(I("en", "auth").dev.warning) || loginText.includes(I("ar", "auth").dev.warning)}`, p.url().endsWith("/my-work") && dir === (lang === "ar" ? "rtl" : "ltr") && (loginText.includes(I("en", "auth").dev.warning) || loginText.includes(I("ar", "auth").dev.warning)));
  await p.getByRole("button", { name: A.signOut }).first().click(); await p.waitForTimeout(800);
  const soText = await p.locator("body").innerText();
  rec(`${lang}.sign-out-localized`, `'${A.signedOut}' shown; /me 401 for the browser`, `url=${new URL(p.url()).pathname} shown=${soText.includes(A.signedOut)} me=${(await p.request.get(`${BASE}/api/v1/me`)).status()}`, soText.includes(A.signedOut) && (await p.request.get(`${BASE}/api/v1/me`)).status() === 401);
  await signIn(p, lang, "dev.lead");
  rec(`${lang}.sign-in-again`, "My work reached again", new URL(p.url()).pathname, p.url().endsWith("/my-work"));
  // (b) upload and download through the dialog
  const t = (await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R13 UI ${lang}`, mode: "end_to_end" })).body;
  const ev = (await lead("POST", `/api/v1/transformations/${t.id}/evidence`, { kind: "file", title: `Synthetic R13 extract ${lang}`, ownerUserId: LEAD })).body;
  const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("‏خط الأساس 📊", "utf8"), Buffer.alloc(300000, 0x61)]);
  const file = join(tmp, `خط-الأساس-r13-${lang}.bin`); writeFileSync(file, bytes);
  await p.goto(`${BASE}/transformations/${t.id}/evidence`); await p.waitForTimeout(1500);
  await p.locator("button").filter({ hasText: EV.upload.action }).filter({ hasText: `Synthetic R13 extract ${lang}` }).click();
  await p.locator("input[type=file]").setInputFiles(file);
  const upResp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/evidence/${ev.id}/content`));
  await p.getByRole("button", { name: EV.upload.confirm, exact: true }).click();
  const up = await upResp; await p.waitForTimeout(1000);
  const link = p.locator("a[download]").filter({ hasText: `Synthetic R13 extract ${lang}` });
  const [download] = await Promise.all([p.waitForEvent("download"), link.click()]);
  const got = readFileSync(await download.path());
  await p.screenshot({ path: `${OUT}/${lang}-r13-evidence-uploaded.png`, fullPage: true });
  rec(`${lang}.evidence-upload-download-unchanged`, "200; download byte-identical; Arabic file name suggested", `status=${up.status()} bytes ${got.length}/${bytes.length} sha ${sha(got).slice(0, 16)}/${sha(bytes).slice(0, 16)} suggested=${download.suggestedFilename()}`, up.status() === 200 && Buffer.compare(got, bytes) === 0 && download.suggestedFilename() === `خط-الأساس-r13-${lang}.bin`);
  await ctx.close();
  // (c) access withdrawn before the upload is confirmed
  const a = await admin("POST", "/api/v1/role-assignments", { userId: NOBODY, roleCode: "TL", scope: { type: "transformation", id: t.id }, reason: "Synthetic R13 UI access" });
  const ctx2 = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => consoleErrors.push(`${lang} pageerror: ${e.message}`));
  await signIn(p2, lang, "dev.nobody");
  const nbEv = await p2.evaluate(async ([tid, owner, title]) => { const me = await (await fetch("/api/v1/me")).json(); const r = await fetch(`/api/v1/transformations/${tid}/evidence`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": me.csrfToken, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ kind: "file", title, ownerUserId: owner }) }); return { status: r.status, body: await r.json() }; }, [t.id, NOBODY, `Synthetic R13 withdrawn ${lang}`]);
  await p2.goto(`${BASE}/transformations/${t.id}/evidence`); await p2.waitForTimeout(1500);
  await p2.locator("button").filter({ hasText: EV.upload.action }).filter({ hasText: `Synthetic R13 withdrawn ${lang}` }).click();
  await p2.locator("input[type=file]").setInputFiles(file);
  const rv = await admin("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, { reason: "Synthetic R13 UI revoke before upload" }, a.body.version);
  const resp2 = p2.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/evidence/${nbEv.body.id}/content`));
  await p2.getByRole("button", { name: EV.upload.confirm, exact: true }).click();
  const r2 = await resp2; await p2.waitForTimeout(1500);
  const text2 = await p2.locator("body").innerText();
  await p2.screenshot({ path: `${OUT}/${lang}-r13-upload-access-withdrawn.png`, fullPage: false });
  const shown = [P.unauthenticated, A.errors?.session_expired].filter(Boolean).filter((m) => text2.includes(m));
  const enLeak = lang === "ar" && (text2.includes(I("en", "problems").unauthenticated) || /Your access to this record changed/.test(text2));
  const revs = psql(`select count(*) from evidence_content where evidence_id='${nbEv.body.id}'`);
  rec(`${lang}.upload-refused-after-access-withdrawn`, "assignment 201, revoke 200; upload answer 401; localized session-ended message shown; no English leak in AR; 0 revisions", `assign=${a.status} evidenceCreate=${nbEv.status} revoke=${rv.status} upload=${r2.status()} url=${new URL(p2.url()).pathname} shown=${JSON.stringify(shown)} enLeak=${enLeak} revisions=${revs} dir=${await p2.locator("html").getAttribute("dir")}`, a.status === 201 && nbEv.status === 201 && rv.status === 200 && r2.status() === 401 && shown.length > 0 && !enLeak && revs === "0");
  await ctx2.close();
}
await b.close();
rec("no-page-errors", "no page errors / console errors (other than Chromium's own 'Failed to load resource' lines for the expected 401)", JSON.stringify(consoleErrors), consoleErrors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
