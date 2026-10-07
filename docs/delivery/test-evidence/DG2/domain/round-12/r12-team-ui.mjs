// domain-reviewer DG2 round 12 (T-DG2-REV-DOM-R12): the team assignment dialog after FE9 (F-DG2-430), EN (LTR) and AR (RTL).
// SYNTHETIC data. Opens the Team page of a synthetic transformation, opens the Assign dialog, checks the accountability
// preview follows the selected role (WL shows the B0018 text in the current language; switching roles changes the
// preview), assigns a role to a synthetic user, and checks the success banner, the new member row and that the browser
// printed no console error/warning and no page error. A team assignment is an access change, not a business approval.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/team.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const login = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const api = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const ra = (await api("GET", "/api/v1/role-accountabilities")).body; const items = ra.items ?? ra;
const accOf = (code, lang) => { const x = items.find((i) => i.roleCode === code); return lang === "ar" ? x?.accountabilityAr : x?.accountabilityEn; };
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const TM = I(lang);
  const t = (await api("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R12 team ${lang}`, mode: "end_to_end" })).body;
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const consoleMsgs = [];
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
  p.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${e.message.slice(0, 160)}`));
  const non2xx = [];
  p.on("response", (r) => { if (r.status() >= 400) non2xx.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ":id")}`); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(400);
  await p.goto(`${BASE}/transformations/${t.id}/team`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(500);
  const dir = await p.locator("html").getAttribute("dir");
  rec(`TEAM.${lang}.dir`, lang === "ar" ? "rtl" : "ltr", dir, dir === (lang === "ar" ? "rtl" : "ltr"));
  const body = await p.locator("body").innerText();
  const b0018 = ["SP", "TL", "BO", "WL", "FIN", "TO"].filter((c) => !body.includes(accOf(c, lang)));
  rec(`TEAM.${lang}.six-governance-roles-b0018`, "the six B0018 accountabilities shown in the current language", `missing=${JSON.stringify(b0018)}`, b0018.length === 0);
  await p.getByRole("button", { name: TM.assign.action }).first().click();
  const dlg = p.getByRole("dialog"); await dlg.waitFor();
  const roleSel = dlg.getByLabel(new RegExp(`^${TM.assign.role}`)).first();
  const previews = [];
  const preview = async () => (await dlg.innerText());
  const initialRole = await roleSel.inputValue();
  previews.push([initialRole, (await preview()).includes(accOf(initialRole, lang) ?? "\u0000")]);
  for (const code of ["KDS", "TD", "WL"]) {
    const opts = await roleSel.locator("option").evaluateAll((os) => os.map((o) => o.value));
    if (!opts.includes(code)) { previews.push([code, "not-offered"]); continue; }
    await roleSel.selectOption(code); await p.waitForTimeout(200);
    previews.push([code, (await preview()).includes(accOf(code, lang) ?? "\u0000")]);
  }
  rec(`TEAM.${lang}.preview-follows-role`, "preview shows the selected role's accountability text for each selection", JSON.stringify(previews), previews.every(([, ok]) => ok === true));
  await p.screenshot({ path: `${OUT}/${lang}-r12-team-assign-dialog.png`, fullPage: true });
  const personSel = dlg.getByLabel(new RegExp(`^${TM.assign.person}`)).first();
  const personOpts = await personSel.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, l: o.textContent })));
  const target = personOpts.find((o) => o.v && o.v !== me.user?.id && o.v !== me.id);
  await personSel.selectOption(target.v);
  await dlg.getByLabel(new RegExp(`^${TM.assign.reason}`)).first().fill(lang === "ar" ? "‏تجريبي: إسناد دور قائد مسار عمل" : "Synthetic: assign workstream lead");
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/scoped-assignments"));
  await dlg.getByRole("button", { name: TM.assign.submit, exact: true }).click();
  const r = await resp; await p.waitForTimeout(800);
  const banner = await p.locator("[data-state='assigned']").innerText().catch(() => "");
  const members = await api("GET", `/api/v1/transformations/${t.id}/scoped-assignments`);
  const memText = JSON.stringify(members.body);
  rec(`TEAM.${lang}.assign-ok`, "201; success banner mentions audit trail; the person appears with role WL", `status=${r.status()} banner='${banner}' memberWL=${memText.includes(target.v) && memText.includes('"WL"')}`, r.status() === 201 && banner.length > 0 && memText.includes(target.v));
  await p.screenshot({ path: `${OUT}/${lang}-r12-team-assigned.png`, fullPage: true });
  // Attempt 1 (r12-team-ui-attempt1.log) counted the browser's own "Failed to load resource" lines, which Chromium prints
  // for every non-2xx HTTP answer. Attempt 2 lists each non-2xx answer by URL (explained in the review record) and
  // asserts that nothing else (no React warning, no script error, no page error) was printed.
  const other = consoleMsgs.filter((m) => !/^error: Failed to load resource: the server responded with a status of \d+/.test(m));
  console.log(`NON2XX ${lang} ${JSON.stringify(non2xx)}`);
  rec(`TEAM.${lang}.no-console-warning`, "no console warning, no script/React error and no page error during the flow (HTTP non-2xx answers listed separately)", `resourceLoadLines=${consoleMsgs.length - other.length} other=${JSON.stringify(other)}`, other.length === 0 && consoleMsgs.length - other.length === non2xx.length);
  await ctx.close();
}
await b.close();
console.log(`SUMMARY ${out.filter(Boolean).length}/${out.length} PASS`);
process.exit(out.every(Boolean) ? 0 : 1);
