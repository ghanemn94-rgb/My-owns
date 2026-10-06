// domain-reviewer DG2 round 6: the charter form with blank and INVISIBLE-only text, in EN (LTR) and AR (RTL). SYNTHETIC data.
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const D = I(lang, "define").charter, P = I(lang, "problems");
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic blank UI ${lang}`, mode: "end_to_end" });
  const tid = t.body.id;
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const sent = []; p.on("request", (q) => { if (!["GET", "HEAD"].includes(q.method())) sent.push(`${q.method()} ${new URL(q.url()).pathname}`); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(400);
  await p.goto(`${BASE}/transformations/${tid}/charter`); await p.waitForTimeout(800);
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", await p.locator("html").getAttribute("dir"), (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
  await p.getByRole("button", { name: D.create, exact: true }).click();
  const cfc = p.getByLabel(new RegExp(`^${D.field.caseForChange}`)).first();
  // invisible only: ZWSP + RLM + word joiner (nothing visible on screen)
  await cfc.fill("​‏⁠"); sent.length = 0;
  await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(500);
  const msg = P.validation__blank;
  const shown = await p.getByText(msg, { exact: false }).count();
  rec(`${lang}.charter-create-invisible`, `inline '${msg}'; aria-invalid; focus; nothing sent`, `shown=${shown} aria-invalid=${await cfc.getAttribute("aria-invalid")} focused=${await cfc.evaluate((e) => e === document.activeElement)} sent=${JSON.stringify(sent)}`, shown > 0 && (await cfc.getAttribute("aria-invalid")) === "true" && sent.filter((s) => s.endsWith("/charter")).length === 0);
  await p.screenshot({ path: `${OUT}/${lang}-charter-create-invisible.png`, fullPage: true });
  // ROUND 5 (F-DG2-180): VS16 + CGJ + Mongolian FVS only (default-ignorable; nothing visible)
  await cfc.fill("️͏᠋"); sent.length = 0;
  await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(500);
  rec(`${lang}.charter-create-default-ignorable-only`, `inline '${msg}'; aria-invalid; nothing sent`, `shown=${await p.getByText(msg, { exact: false }).count()} aria-invalid=${await cfc.getAttribute("aria-invalid")} sent=${JSON.stringify(sent)}`, (await p.getByText(msg, { exact: false }).count()) > 0 && (await cfc.getAttribute("aria-invalid")) === "true" && sent.filter((s) => s.endsWith("/charter")).length === 0);
  await p.screenshot({ path: `${OUT}/${lang}-charter-create-default-ignorable.png`, fullPage: true });
  // spaces only
  await cfc.fill("    "); sent.length = 0; await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(400);
  rec(`${lang}.charter-create-spaces`, "same inline message; nothing sent", `shown=${await p.getByText(msg, { exact: false }).count()} sent=${JSON.stringify(sent)}`, (await p.getByText(msg, { exact: false }).count()) > 0 && sent.filter((s) => s.endsWith("/charter")).length === 0);
  // visible text with a leading RLM is accepted verbatim
  const vis = lang === "ar" ? "\u200Fتجريبي: أخطاء الفوترة تسبب فقدان العملاء\u200F \u061C(٤٫٢٥٪)\u200F" : "Synthetic: billing errors drive churn";
  await cfc.fill(vis); sent.length = 0; await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(1200);
  const got = await lead("GET", `/api/v1/transformations/${tid}/charter`);
  rec(`${lang}.charter-create-visible`, "201 created; stored verbatim", `sent=${JSON.stringify(sent)} status=${got.status} verbatim=${got.body?.charter?.caseForChange === vis}`, got.status === 200 && got.body.charter.caseForChange === vis);
  await p.screenshot({ path: `${OUT}/${lang}-charter-created-visible.png`, fullPage: true });
  // thesis incomplete is visible
  const txt = await p.locator("main").innerText();
  rec(`${lang}.thesis-incomplete-shown`, `'${D.thesis.incomplete}' shown with 4 parts empty`, `${txt.includes(D.thesis.incomplete)}`, txt.includes(D.thesis.incomplete));
  // edit: invisible Out of scope
  const region = p.getByRole("region", { name: D.fieldsTitle, exact: true });
  await region.getByRole("button", { name: D.edit, exact: true }).click(); await p.waitForTimeout(300);
  const oos = p.getByLabel(new RegExp(`^${D.field.outOfScope}`)).first();
  await oos.fill("ㅤ⠀"); await p.getByLabel(new RegExp(`^${D.changeSummary}`)).first().fill(lang === "ar" ? "تجريبي" : "Synthetic");
  sent.length = 0; await p.getByRole("button", { name: D.saveVersion, exact: true }).click(); await p.waitForTimeout(500);
  const v = await lead("GET", `/api/v1/transformations/${tid}/charter`);
  rec(`${lang}.charter-edit-invisible-oos`, "inline blank message; no version written", `shown=${await p.getByText(msg, { exact: false }).count()} aria-invalid=${await oos.getAttribute("aria-invalid")} sent=${JSON.stringify(sent)} version=${v.body.charter.version}`, (await oos.getAttribute("aria-invalid")) === "true" && v.body.charter.version === 1 && sent.length === 0);
  await p.screenshot({ path: `${OUT}/${lang}-charter-edit-invisible-oos.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
