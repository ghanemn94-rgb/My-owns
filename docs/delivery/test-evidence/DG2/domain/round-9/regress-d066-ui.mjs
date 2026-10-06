// domain-reviewer DG2 round 7: charter form in EN (LTR) and AR (RTL) with the D-066 inputs. SYNTHETIC data, disposable stack.
// U+0000 inside text -> localized validation__invalid_character message; placeholder-only (U+16FE4 / U+1D159) -> localized
// validation__blank; Arabic text with RLM marks -> accepted verbatim.
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
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic D066 UI ${lang}`, mode: "end_to_end" });
  const tid = t.body.id;
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const sent = []; const statuses = [];
  p.on("request", (q) => { if (!["GET", "HEAD"].includes(q.method())) sent.push(`${q.method()} ${new URL(q.url()).pathname}`); });
  p.on("response", (r) => { if (r.status() >= 500) statuses.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(400);
  await p.goto(`${BASE}/transformations/${tid}/charter`); await p.waitForTimeout(800);
  const dir = await p.locator("html").getAttribute("dir");
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", dir, dir === (lang === "ar" ? "rtl" : "ltr"));
  await p.getByRole("button", { name: D.create, exact: true }).click();
  const cfc = p.getByLabel(new RegExp(`^${D.field.caseForChange}`)).first();
  // U+0000 inside visible text
  await cfc.fill(lang === "ar" ? "تجريبي\u0000نص" : "Synthetic\u0000text"); sent.length = 0;
  const filled = await cfc.inputValue();
  await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(700);
  const msgInv = P.validation__invalid_character;
  const shownInv = await p.getByText(msgInv, { exact: false }).count();
  const g = await lead("GET", `/api/v1/transformations/${tid}/charter`);
  rec(`${lang}.charter-nul-refused`, `inline '${msgInv}'; aria-invalid; no charter stored; no 5xx`, `inputHasNul=${filled.includes("\u0000")} shown=${shownInv} aria-invalid=${await cfc.getAttribute("aria-invalid")} sent=${JSON.stringify(sent)} charterStatus=${g.status} hasCharter=${!!g.body?.charter} 5xx=${JSON.stringify(statuses)}`, shownInv > 0 && (await cfc.getAttribute("aria-invalid")) === "true" && !g.body?.charter && statuses.length === 0);
  await p.screenshot({ path: `${OUT}/${lang}-charter-nul-refused.png`, fullPage: true });
  // placeholder only (F-DG2-230)
  await cfc.fill("\u{16FE4}\u{1D159}"); sent.length = 0;
  await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(500);
  const msgBlank = P.validation__blank;
  rec(`${lang}.charter-placeholder-only`, `inline '${msgBlank}'; nothing sent`, `shown=${await p.getByText(msgBlank, { exact: false }).count()} aria-invalid=${await cfc.getAttribute("aria-invalid")} sent=${JSON.stringify(sent)}`, (await p.getByText(msgBlank, { exact: false }).count()) > 0 && (await cfc.getAttribute("aria-invalid")) === "true" && sent.filter((s) => s.endsWith("/charter")).length === 0);
  // Arabic with RLM marks accepted verbatim
  const vis = "‏تجريبي: أخطاء الفوترة تسبب فقدان العملاء‏ ؜(٤٫٢٥٪)‏";
  await cfc.fill(vis); sent.length = 0; await p.getByRole("button", { name: D.create, exact: true }).click(); await p.waitForTimeout(1200);
  const got = await lead("GET", `/api/v1/transformations/${tid}/charter`);
  rec(`${lang}.charter-arabic-rlm-verbatim`, "created; stored code point for code point", `sent=${JSON.stringify(sent)} status=${got.status} verbatim=${got.body?.charter?.caseForChange === vis}`, got.status === 200 && got.body?.charter?.caseForChange === vis);
  await p.screenshot({ path: `${OUT}/${lang}-charter-arabic-rlm-created.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
