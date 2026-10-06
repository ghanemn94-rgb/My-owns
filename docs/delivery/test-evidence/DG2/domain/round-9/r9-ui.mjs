// domain-reviewer DG2 round 9 (T-DG2-REV-DOM-R9): D-069 in the browser, EN (LTR) and AR (RTL). SYNTHETIC data.
// (a) Charter create where the browser's JSON body gets one invalid byte inside the ARABIC case-for-change text (route
//     interception; the real server answers): the localized validation.json message appears exactly once, in one alert,
//     and nothing is saved. Then the same Arabic+RLM+emoji text without interception is created verbatim.
// (b) Evidence: upload a binary file with an Arabic name through the Upload dialog (the web client's own octet-stream
//     request); the item's Download link returns the exact bytes.
import { chromium } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
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
const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = mkdtempSync(join(process.env.TMPDIR, "r9ui-"));
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const D = I(lang, "define").charter, P = I(lang, "problems"), EV = I(lang, "evidence");
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R9 UI ${lang}`, mode: "end_to_end" });
  const tid = t.body.id, charterPath = `/api/v1/transformations/${tid}/charter`;
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(400);
  // (a) form-level problem announced once
  const ar = "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء 📉‏";
  const answers = [];
  p.on("response", async (r) => { if (r.request().method() === "POST" && new URL(r.url()).pathname === charterPath) answers.push({ status: r.status(), body: await r.text().catch(() => "") }); });
  let inject = true;
  await p.route(`**${charterPath}`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || !inject) return route.continue();
    const buf = req.postDataBuffer(); const marker = Buffer.from("تجريبي", "utf8"); const at = buf.indexOf(marker);
    return route.continue({ postData: Buffer.concat([buf.subarray(0, at + marker.length), Buffer.from([0xff]), buf.subarray(at + marker.length)]) });
  });
  await p.goto(`${BASE}/transformations/${tid}/charter`); await p.waitForTimeout(800);
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", await p.locator("html").getAttribute("dir"), (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
  await p.getByRole("button", { name: D.create, exact: true }).click();
  const cfc = p.getByLabel(new RegExp(`^${D.field.caseForChange}`)).first();
  await cfc.fill(ar);
  await p.getByRole("button", { name: D.create, exact: true }).click();
  for (let i = 0; i < 40 && answers.length === 0; i++) await p.waitForTimeout(100);
  await p.waitForTimeout(500);
  const msg = P.validation__json;
  const alerts = await p.getByRole("alert").filter({ hasText: msg }).count();
  const allAlerts = await p.getByRole("alert").count();
  const occurrences = (await p.locator("body").innerText()).split(msg).length - 1;
  const formErrs = await p.locator("[data-state='form-errors']").count();
  const g1 = await lead("GET", charterPath);
  let pb = {}; try { pb = JSON.parse(answers[0]?.body ?? "{}"); } catch {}
  rec(`${lang}.form-level-problem-once`, `server 400 validation [["","validation.json"]]; '${msg}' in exactly 1 alert, text once, no form-errors list; no charter`, `status=${answers[0]?.status} errors=${JSON.stringify((pb.errors ?? []).map((e) => [e.pointer, e.code]))} alertsWithMsg=${alerts} alertsTotal=${allAlerts} occurrences=${occurrences} formErrors=${formErrs} GET=${g1.status}`, answers[0]?.status === 400 && alerts === 1 && occurrences === 1 && formErrs === 0 && g1.status === 404);
  await p.screenshot({ path: `${OUT}/${lang}-charter-form-level-problem-once.png`, fullPage: true });
  inject = false;
  await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(1500);
  const g2 = await lead("GET", charterPath);
  rec(`${lang}.charter-arabic-rlm-emoji-verbatim`, "created; stored verbatim", `status=${g2.status} verbatim=${g2.body?.charter?.caseForChange === ar}`, g2.status === 200 && g2.body?.charter?.caseForChange === ar);
  // (b) evidence upload through the dialog, download through the page link
  const ev = await lead("POST", `/api/v1/transformations/${tid}/evidence`, { kind: "file", title: `Synthetic R9 extract ${lang}`, ownerUserId: "01920000-0000-7000-9000-000000000203" });
  const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("‏خط الأساس 📊", "utf8"), Buffer.from([0xff, 0xc0, 0xaf])]);
  const file = join(tmp, `خط-الأساس-${lang}.bin`); writeFileSync(file, bytes);
  await p.goto(`${BASE}/transformations/${tid}/evidence`); await p.waitForTimeout(1500);
  console.log("DIAG evidence create", ev.status, ev.body?.kind, JSON.stringify(ev.body?.errors ?? null));
  await p.locator("button").filter({ hasText: EV.upload.action }).filter({ hasText: `Synthetic R9 extract ${lang}` }).click();
  await p.locator("input[type=file]").setInputFiles(file);
  const upResp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/evidence/${ev.body.id}/content`));
  await p.getByRole("button", { name: EV.upload.confirm, exact: true }).click();
  const up = await upResp; const reqCt = up.request().headers()["content-type"];
  await p.waitForTimeout(1000);
  const link = p.locator("a[download]").filter({ hasText: `Synthetic R9 extract ${lang}` });
  const [download] = await Promise.all([p.waitForEvent("download"), link.click()]);
  const got = readFileSync(await download.path());
  rec(`${lang}.evidence-upload-download-unchanged`, "web client sends application/octet-stream; 200; download byte-identical; Arabic file name suggested", `request content-type=${reqCt} status=${up.status()} bytes ${got.length}/${bytes.length} sha ${sha(got).slice(0, 16)}/${sha(bytes).slice(0, 16)} suggested=${download.suggestedFilename()}`, reqCt === "application/octet-stream" && up.status() === 200 && Buffer.compare(got, bytes) === 0 && download.suggestedFilename() === `خط-الأساس-${lang}.bin`);
  await p.screenshot({ path: `${OUT}/${lang}-evidence-uploaded.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
