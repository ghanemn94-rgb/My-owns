// domain-reviewer DG2 round 16 (T-DG2-REV-DOM-R16): editing and archiving a transformation in a real browser, EN (LTR)
// and AR (RTL), after FE14 changed TransformationEditPage, ReasonDialog and useVersionedSave (SessionChangedError handling).
// SYNTHETIC data (seed-dev users). Nothing here is a business approval.
// Claims: a normal same-identity edit still saves and navigates to the detail page with the new name; the archive dialog
// refuses an invisible-only reason with the localized blank message and sends nothing; a visible Arabic reason with RLM
// marks archives the record (read-only note + reason shown), stored code-point-for-code-point; no banner/console error.
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
const errors = [];
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const C = I(lang, "common"), T = I(lang, "transformations"), P = I(lang, "problems");
  const t = await lead("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R16 edit ${lang} ${randomUUID().slice(0, 6)}`, mode: "end_to_end" });
  const id = t.body?.id;
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${lang} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${lang}: ${m.text()}`); });
  const sent = []; p.on("request", (r) => { if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/v1/transformations")) sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(500);
  // ---- edit ----
  await p.goto(`${BASE}/transformations/${id}`); await p.waitForTimeout(800);
  await p.getByRole("link", { name: C.action.edit, exact: true }).first().click(); await p.waitForURL(`**/transformations/${id}/edit`); await p.waitForTimeout(500);
  const newName = lang === "ar" ? `‏تحويل اصطناعي معدّل‏ ${randomUUID().slice(0, 4)}` : `Synthetic R16 edited ${randomUUID().slice(0, 4)}`;
  await p.getByLabel(T.field.name, { exact: false }).first().fill(newName);
  await p.getByRole("button", { name: C.action.save }).click();
  await p.waitForURL((u) => u.pathname === `/transformations/${id}`, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(800);
  const afterEdit = await lead("GET", `/api/v1/transformations/${id}`);
  const shownNew = (await p.locator("body").innerText()).includes(newName.replace(/‏/g, "")) || (await p.locator("body").textContent()).includes(newName);
  const errBanner = await p.locator("[data-state='error'], .banner--error").count();
  await p.screenshot({ path: `${OUT}/${lang}-r16-edited.png` });
  rec(`${lang}.edit-saves-and-navigates`, `PATCH sent; detail page /transformations/${id}; new name shown; stored verbatim; version 1->2; no error banner; dir ${lang === "ar" ? "rtl" : "ltr"}`,
    `path=${new URL(p.url()).pathname} sent=${JSON.stringify(sent)} shown=${shownNew} storedVerbatim=${afterEdit.body?.name === newName} version=${afterEdit.body?.version} errorBanners=${errBanner} dir=${await p.locator("html").getAttribute("dir")}`,
    new URL(p.url()).pathname === `/transformations/${id}` && shownNew && afterEdit.body?.name === newName && afterEdit.body?.version === 2 && errBanner === 0 && (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
  // ---- archive: invisible-only reason refused ----
  await p.getByRole("button", { name: T.archive.action }).first().click(); await p.waitForTimeout(400);
  const dlg = p.getByRole("dialog"); const ta = dlg.locator("textarea, input").first();
  const nSent = sent.length;
  await ta.fill("‏​ ⁠"); await dlg.getByRole("button", { name: T.archive.confirm }).click(); await p.waitForTimeout(500);
  const dlgTxt = await dlg.innerText();
  await p.screenshot({ path: `${OUT}/${lang}-r16-archive-invisible-refused.png` });
  rec(`${lang}.archive-invisible-reason-refused`, `inline '${P.validation__blank}'; aria-invalid; nothing sent`, `shown=${dlgTxt.includes(P.validation__blank)} ariaInvalid=${await ta.getAttribute("aria-invalid")} newRequests=${sent.length - nSent}`,
    dlgTxt.includes(P.validation__blank) && (await ta.getAttribute("aria-invalid")) === "true" && sent.length === nSent);
  // ---- archive: visible reason ----
  const reason = lang === "ar" ? "‏سبب اصطناعي: دُمج مع تحويل آخر‏" : "Synthetic reason: merged into another transformation";
  await ta.fill(reason); await dlg.getByRole("button", { name: T.archive.confirm }).click(); await p.waitForTimeout(1200);
  const arch = await lead("GET", `/api/v1/transformations/${id}`);
  const body = await p.locator("body").innerText();
  const readOnly = body.includes(T.archive.reasonLabel) && (await p.getByRole("link", { name: C.action.edit, exact: true }).count()) === 0 && (await p.getByRole("button", { name: T.archive.action }).count()) === 0;
  await p.screenshot({ path: `${OUT}/${lang}-r16-archived.png` });
  rec(`${lang}.archive-visible-reason`, `POST .../archive; archivedAt set; reason stored verbatim (RLM kept); dialog closed; read-only note with reason; no Edit/Archive controls; no error banner`,
    `sent=${JSON.stringify(sent.slice(nSent))} archivedAt=${!!arch.body?.archivedAt} reasonVerbatim=${arch.body?.archiveReason === reason} dialogOpen=${await p.getByRole("dialog").count()} readOnly=${readOnly} errorBanners=${await p.locator("[data-state='error'], .banner--error").count()}`,
    sent.slice(nSent).some((s) => s.endsWith("/archive")) && !!arch.body?.archivedAt && arch.body?.archiveReason === reason && (await p.getByRole("dialog").count()) === 0 && readOnly && (await p.locator("[data-state='error'], .banner--error").count()) === 0);
  await ctx.close();
}
await b.close();
rec("no-page-errors", "no page errors / console errors", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
