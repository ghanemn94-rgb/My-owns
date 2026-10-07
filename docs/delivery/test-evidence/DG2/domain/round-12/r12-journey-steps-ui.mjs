// domain-reviewer DG2 round 12 (T-DG2-REV-DOM-R12): the journey/process map steps editor after the F-DG2-430 sweep
// (StepsEditor row key now generated outside the state updater), EN (LTR) and AR (RTL). SYNTHETIC data. REQ-PB-025.
// Creates a synthetic process map through the API, opens Design > Edit steps in the browser, adds three steps (Arabic
// names with RLM in AR), moves the third up, saves, and checks the stored steps through the API: count, order, names
// verbatim, decimal cycle time kept; no console warning/script error.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const login = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
const api = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const DS = I(lang, "design").journeys, CM = I(lang, "common");
  const t = (await api("POST", "/api/v1/transformations", { businessUnitId: "01920000-0000-7000-9000-000000000102", name: `Synthetic R12 steps ${lang}`, mode: "end_to_end" })).body;
  const T = `/api/v1/transformations/${t.id}`;
  const j = await api("POST", `${T}/journeys`, { name: `Synthetic order-to-bill ${lang}`, kind: "process", state: "current", status: "active", ownerUserId: "01920000-0000-7000-9000-000000000203" });
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const msgs = [];
  p.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/^Failed to load resource/.test(m.text())) msgs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
  p.on("pageerror", (e) => msgs.push(`pageerror: ${e.message.slice(0, 160)}`));
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter"); await p.waitForURL("**/my-work");
  if ((await p.locator("html").getAttribute("lang")) !== lang) await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click();
  await p.waitForTimeout(400);
  await p.goto(`${BASE}/transformations/${t.id}/design`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(500);
  // Attempt 1 (r12-journey-steps-ui-attempt1.log) clicked "Edit steps" directly; it is inside the journey detail, which
  // opens from the row's "Open" button first (probe selector error, not a product defect).
  await p.getByRole("button", { name: new RegExp(`${DS.open}.*${j.body.name}`) }).first().click(); await p.waitForTimeout(300);
  await p.getByRole("button", { name: new RegExp(DS.editSteps) }).first().click();
  const dlg = p.getByRole("dialog"); await dlg.waitFor();
  const names = lang === "ar" ? ["‏استلام الطلب", "‏إصدار الفاتورة", "‏التحقق من البيانات"] : ["Receive order", "Issue bill", "Validate data"];
  for (let i = 0; i < 3; i++) {
    await dlg.getByRole("button", { name: DS.addStep }).click(); await p.waitForTimeout(100);
    const fs = dlg.locator("fieldset").nth(i);
    await fs.getByLabel(new RegExp(`^${CM.field.name}`)).first().fill(names[i]);
  }
  await dlg.locator("fieldset").nth(1).getByLabel(new RegExp(`^${DS.cycleTime}`)).first().fill("1.5");
  await dlg.locator("fieldset").nth(1).locator("select").selectOption("days");
  await dlg.locator("fieldset").nth(2).getByRole("button", { name: new RegExp(DS.moveUp) }).click(); await p.waitForTimeout(100);
  const legends = await dlg.locator("fieldset legend").allInnerTexts();
  await p.screenshot({ path: `${OUT}/${lang}-r12-journey-steps-editor.png`, fullPage: false });
  const resp = p.waitForResponse((r) => ["PUT", "PATCH", "POST"].includes(r.request().method()) && r.url().includes(`/journeys/${j.body.id}`));
  await dlg.getByRole("button", { name: CM.action.save, exact: true }).click();
  const r = await resp; await p.waitForTimeout(800);
  const g = await api("GET", `${T}/journeys/${j.body.id}`);
  const steps = g.body?.steps ?? [];
  const want = [names[0], names[2], names[1]];
  rec(`STEPS.${lang}.dir`, lang === "ar" ? "rtl" : "ltr", await p.locator("html").getAttribute("dir"), (await p.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));
  rec(`STEPS.${lang}.add-reorder-save`, `save 2xx; 3 steps stored in order ${JSON.stringify(want)} verbatim; moved step keeps cycle time 1.5 days (decimal)`, `save=${r.request().method()} ${r.status()} legends=${JSON.stringify(legends)} stored=${JSON.stringify(steps.map((s) => [s.name, s.cycleTimeValue ?? null, s.cycleTimeUnit ?? null]))}`,
    r.status() < 300 && steps.length === 3 && JSON.stringify(steps.map((s) => s.name)) === JSON.stringify(want) && String(steps[2]?.cycleTimeValue).startsWith("1.5") && steps[2]?.cycleTimeUnit === "days");
  rec(`STEPS.${lang}.no-console-warning`, "no console warning, script error or page error (HTTP resource-load lines excluded)", JSON.stringify(msgs), msgs.length === 0);
  await ctx.close();
}
await b.close();
console.log(`SUMMARY ${out.filter(Boolean).length}/${out.length} PASS`);
process.exit(out.every(Boolean) ? 0 : 1);
