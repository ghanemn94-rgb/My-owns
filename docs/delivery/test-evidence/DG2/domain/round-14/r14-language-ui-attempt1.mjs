// domain-reviewer DG2 round 14 (T-DG2-REV-DOM-R14): FE11 and FE12 (D-074) in the browser, EN (LTR) and AR (RTL).
// SYNTHETIC data (seed-dev users); team assignments are synthetic, not approvals.
// (1) FE11: a language change whose save to the profile is refused (PUT /api/v1/me/preferences answered 503 by a
//     Playwright route, i.e. the server being unavailable) keeps the chosen language and shows the "not saved" notice in
//     THAT language, EN->AR (dev.lead, saved EN) and AR->EN (dev.office, saved AR). The language does not flip back.
// (2) FE12 header: with the notice visible at 320, 768 and 1280 px, the notice is below the header, the header row is
//     not taller than without it, the wordmark keeps its width and nothing overflows horizontally.
// (3) FE12 render-time translation: the dev-login error (client-side and server-side), the Team "Role assigned" notice and
//     the journey steps error follow a language switch made while they are visible (text and direction).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const I = (l, f) => JSON.parse(readFileSync(`apps/web/src/i18n/${l}/${f}.json`, "utf8"));
const out = []; const rec = (id, exp, act, ok) => { out.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} :: expected ${exp} :: actual ${act}`); };
const NAME = { ar: "العربية", en: "English" };
const switchBtn = (p, to) => p.locator(`.language-switch button[lang=${to}]`).first();
const errors = [];
const b = await chromium.launch();
async function signedIn(user, width = 1280) {
  const ctx = await b.newContext({ locale: "en-US", timezoneId: "Asia/Riyadh", viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${user} pageerror: ${e.message}`));
  p.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/Failed to load resource/.test(m.text())) errors.push(`${user}: ${m.text().slice(0, 200)}`); });
  await p.goto(BASE + "/login"); const f = p.locator("input").first(); await f.fill(user); await f.press("Enter"); await p.waitForURL("**/my-work"); await p.waitForTimeout(800);
  return { ctx, p };
}
const refuse = (p) => p.route("**/api/v1/me/preferences", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Service unavailable", status: 503, code: "service_unavailable" }) }) : r.continue());
const noticeState = async (p) => ({ lang: await p.locator("html").getAttribute("lang"), dir: await p.locator("html").getAttribute("dir"), notice: (await p.locator("[data-testid=language-not-saved]").innerText().catch(() => "")).trim(), regionLang: await p.locator(".app-notice").getAttribute("lang").catch(() => null) });

// (1) FE11
for (const [user, from, to] of [["dev.lead", "en", "ar"], ["dev.office", "ar", "en"]]) {
  const { ctx, p } = await signedIn(user);
  const start = await noticeState(p);
  await refuse(p);
  const put = p.waitForResponse((r) => r.url().endsWith("/api/v1/me/preferences") && r.request().method() === "PUT");
  await switchBtn(p, to).click(); const pr = await put; await p.waitForTimeout(1200);
  const s1 = await noticeState(p);
  await p.locator('a[href="/transformations"]').first().click(); await p.waitForTimeout(2500);
  const s2 = await noticeState(p);
  await p.screenshot({ path: `${OUT}/${to}-r14-language-not-saved-1280.png` });
  const want = I(to, "common").language.notSaved;
  rec(`FE11.${from}->${to}.refused-notice-in-chosen-language`, `start lang=${from}; PUT 503; html lang=${to} dir=${to === "ar" ? "rtl" : "ltr"}; notice = '${want}' (lang ${to}); still ${to} 2.5 s later after an in-app navigation`, `start=${JSON.stringify(start)} put=${pr.status()} after=${JSON.stringify(s1)} later=${JSON.stringify({ ...s2, notice: s2.notice.slice(0, 30) })}`,
    start.lang === from && pr.status() === 503 && s1.lang === to && s1.dir === (to === "ar" ? "rtl" : "ltr") && s1.notice === want && s1.regionLang === to && s2.lang === to);
  // and back again (also refused): the notice switches to the other language
  await switchBtn(p, from).click(); await p.waitForTimeout(1200);
  const s3 = await noticeState(p);
  rec(`FE11.${from}->${to}->${from}.refused-again`, `notice = '${I(from, "common").language.notSaved}' in ${from}`, JSON.stringify(s3), s3.lang === from && s3.notice === I(from, "common").language.notSaved && s3.regionLang === from);
  // a successful save removes the notice and persists
  await p.unroute("**/api/v1/me/preferences");
  await switchBtn(p, to).click(); await p.waitForTimeout(1500);
  const s4 = await noticeState(p);
  const pref = await p.evaluate(async () => (await (await fetch("/api/v1/me")).json()).user.preferredLocale);
  rec(`FE11.${from}->${to}.saved-clears-notice`, `lang=${to}, no notice, preferredLocale=${to}`, `${JSON.stringify(s4)} preferredLocale=${pref}`, s4.lang === to && s4.notice === "" && pref === to);
  // restore the seed preference
  await switchBtn(p, from).click(); await p.waitForTimeout(1200);
  await ctx.close();
}

// (2) FE12 header layout with the notice visible
for (const width of [320, 768, 1280]) {
  for (const [user, lang, other] of [["dev.lead", "en", "ar"], ["dev.office", "ar", "en"]]) {
    const { ctx, p } = await signedIn(user, width);
    const measure = async () => p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
      return { header: r(".app-header"), wordmark: r(".app-header .wordmark") ?? r(".app-header [class*=wordmark]"), notice: r("[data-testid=language-not-saved]"), overflowX: document.documentElement.scrollWidth - window.innerWidth };
    });
    const m0 = await measure();
    await refuse(p);
    await switchBtn(p, other).click(); await p.waitForTimeout(800);
    await switchBtn(p, lang).click(); await p.waitForTimeout(1200);
    const m1 = await measure(); const st = await noticeState(p);
    await p.screenshot({ path: `${OUT}/${lang}-r14-language-notice-${width}.png` });
    const ok = st.lang === lang && st.notice === I(lang, "common").language.notSaved && m1.notice && m1.notice.top >= m1.header.bottom - 1 && m1.header.height <= m0.header.height + 1 && m1.wordmark && m0.wordmark && m1.wordmark.width >= m0.wordmark.width - 1 && m1.overflowX <= 0;
    rec(`FE12.header.${lang}.${width}px`, "notice in the shown language, below the header; header height and wordmark width unchanged; no horizontal overflow", `lang=${st.lang} noticeOk=${st.notice === I(lang, "common").language.notSaved} header h ${m0.header?.height}->${m1.header?.height} bottom=${m1.header?.bottom} noticeTop=${m1.notice?.top} wordmark w ${m0.wordmark?.width}->${m1.wordmark?.width} overflowX=${m1.overflowX}`, !!ok);
    await ctx.close();
  }
}

// (3a) FE12 dev-login errors follow a language switch
for (const [from, to] of [["en", "ar"], ["ar", "en"]]) {
  const ctx = await b.newContext({ locale: from === "ar" ? "ar-SA" : "en-US", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`login pageerror: ${e.message}`));
  await p.goto(BASE + "/login"); await p.waitForTimeout(600);
  if ((await p.locator("html").getAttribute("lang")) !== from) { await switchBtn(p, from).click(); await p.waitForTimeout(400); }
  const f = p.locator("input").first(); await f.fill("X"); await f.press("Enter"); await p.waitForTimeout(500);
  const e1 = await p.locator("body").innerText();
  await switchBtn(p, to).click(); await p.waitForTimeout(600);
  const e2 = await p.locator("body").innerText();
  const A1 = I(from, "auth").dev.invalidUsername, A2 = I(to, "auth").dev.invalidUsername;
  rec(`FE12.login.invalid-username.${from}->${to}`, `'${A1}' then, after switching, '${A2}' (dir ${to === "ar" ? "rtl" : "ltr"}) and not the ${from} text`, `before=${e1.includes(A1)} after=${e2.includes(A2)} stale=${e2.includes(A1)} dir=${await p.locator("html").getAttribute("dir")}`, e1.includes(A1) && e2.includes(A2) && !e2.includes(A1) && (await p.locator("html").getAttribute("dir")) === (to === "ar" ? "rtl" : "ltr"));
  // server-side refusal (unknown user)
  await switchBtn(p, from).click(); await p.waitForTimeout(400);
  await f.fill("dev.nosuchuser"); const rq = p.waitForResponse((r) => r.url().endsWith("/auth/dev-login")); await f.press("Enter"); const rr = await rq; await p.waitForTimeout(600);
  const alert1 = (await p.locator("[role=alert]").allInnerTexts()).join(" | ");
  await switchBtn(p, to).click(); await p.waitForTimeout(600);
  const alert2 = (await p.locator("[role=alert]").allInnerTexts()).join(" | ");
  await p.screenshot({ path: `${OUT}/${to}-r14-login-error-after-switch.png` });
  const arabic = /[؀-ۿ]/;
  const okLang = (s, l) => (l === "ar" ? arabic.test(s) : !arabic.test(s) && /[A-Za-z]/.test(s));
  rec(`FE12.login.server-error.${from}->${to}`, `dev-login refused (4xx); the alert is in ${from}, then in ${to} after the switch, and differs`, `status=${rr.status()} before='${alert1}' after='${alert2}'`, rr.status() >= 400 && alert1 && alert2 && alert1 !== alert2 && okLang(alert1, from) && okLang(alert2, to));
  await ctx.close();
}

// (3b) FE12 Team "Role assigned" notice follows a language switch
{
  const { ctx, p } = await signedIn("dev.lead");
  const csrf = await p.evaluate(async () => (await (await fetch("/api/v1/me")).json()).csrfToken);
  const t = await p.evaluate(async (c) => (await (await fetch("/api/v1/transformations", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": c, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ businessUnitId: "01920000-0000-7000-9000-000000000102", name: "Synthetic R14 team notice", mode: "end_to_end" }) })).json()), csrf);
  await p.goto(`${BASE}/transformations/${t.id}/team`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(500);
  const TM = I("en", "team");
  await p.getByRole("button", { name: TM.assign.action }).first().click();
  const dlg = p.getByRole("dialog"); await dlg.waitFor();
  const personSel = dlg.getByLabel(new RegExp(`^${TM.assign.person}`)).first();
  const opts = await personSel.locator("option").evaluateAll((os) => os.map((o) => o.value));
  await personSel.selectOption(opts.find((v) => v && v !== "01920000-0000-7000-9000-000000000203"));
  const role = await dlg.getByLabel(new RegExp(`^${TM.assign.role}`)).first().inputValue();
  await dlg.getByLabel(new RegExp(`^${TM.assign.reason}`)).first().fill("Synthetic: R14 notice check");
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/scoped-assignments"));
  await dlg.getByRole("button", { name: TM.assign.submit, exact: true }).click(); const r = await resp; await p.waitForTimeout(800);
  const b1 = (await p.locator("[data-state='assigned']").innerText().catch(() => "")).trim();
  await switchBtn(p, "ar").click(); await p.waitForTimeout(1000);
  const b2 = (await p.locator("[data-state='assigned']").innerText().catch(() => "")).trim();
  await p.screenshot({ path: `${OUT}/ar-r14-team-assigned-after-switch.png` });
  const pre = (l) => I(l, "team").assign.done.split("{{role}}")[0].trim();
  rec("FE12.team.role-assigned.en->ar", `201; banner starts '${pre("en")}' in EN, then '${pre("ar")}' after switching to AR (dir rtl), with the role name in Arabic`, `status=${r.status()} role=${role} before='${b1}' after='${b2}' dir=${await p.locator("html").getAttribute("dir")}`, r.status() === 201 && b1.startsWith(pre("en")) && b2.startsWith(pre("ar")) && /[؀-ۿ]/.test(b2.slice(pre("ar").length)) && (await p.locator("html").getAttribute("dir")) === "rtl");
  await switchBtn(p, "en").click(); await p.waitForTimeout(1000);
  const b3 = (await p.locator("[data-state='assigned']").innerText().catch(() => "")).trim();
  rec("FE12.team.role-assigned.ar->en", `banner back to '${pre("en")}…'`, `'${b3}'`, b3 === b1);

  // (3c) journey steps error follows a language switch (if the header switch is reachable while the editor is open)
  const j = await p.evaluate(async ([c, tid]) => (await (await fetch(`/api/v1/transformations/${tid}/journeys`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": c, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ name: "Synthetic R14 journey", kind: "process", state: "current", status: "active", ownerUserId: "01920000-0000-7000-9000-000000000203" }) })).json()), [csrf, t.id]);
  await p.goto(`${BASE}/transformations/${t.id}/design`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(500);
  const DS = I("en", "design").journeys, CM = I("en", "common");
  await p.getByRole("button", { name: new RegExp(`${DS.open}.*${j.name}`) }).first().click(); await p.waitForTimeout(300);
  await p.getByRole("button", { name: new RegExp(DS.editSteps) }).first().click();
  const d2 = p.getByRole("dialog").last(); await d2.waitFor();
  await d2.getByRole("button", { name: DS.addStep }).click(); await p.waitForTimeout(150);
  await d2.locator("fieldset").nth(0).getByLabel(new RegExp(`^${DS.cycleTime}`)).first().fill("-1");
  await d2.getByRole("button", { name: CM.action.save, exact: true }).click(); await p.waitForTimeout(600);
  const t1 = await d2.innerText();
  const click = await switchBtn(p, "ar").click({ timeout: 3000 }).then(() => "clicked", (e) => `not reachable: ${e.message.split("\n")[0]}`);
  await p.waitForTimeout(900);
  const t2 = await p.getByRole("dialog").last().innerText().catch(() => "");
  await p.screenshot({ path: `${OUT}/ar-r14-journey-steps-error-after-switch.png` });
  const arabic = /[؀-ۿ]/;
  const errEn = t1.split("\n").filter((l) => /required|must|blank|enter|number|zero|negative/i.test(l));
  const errAr = t2.split("\n").filter((l) => arabic.test(l));
  console.log(`STEPS before (EN dialog text):\n  ${t1.split("\n").join("\n  ")}\nSTEPS switch: ${click}\nSTEPS after:\n  ${t2.split("\n").join("\n  ")}`);
  rec("FE12.journey-steps-error.en->ar", "a validation error is shown in EN; after switching to AR while it is visible the dialog (labels and error) is in Arabic, no English error text remains, dir rtl", `errorLinesEN=${JSON.stringify(errEn)} switch=${click} arabicLines=${errAr.length} englishErrorRemains=${errEn.some((l) => t2.includes(l))} dir=${await p.locator("html").getAttribute("dir")}`,
    errEn.length > 0 && click === "clicked" && errAr.length > 0 && !errEn.some((l) => t2.includes(l)) && (await p.locator("html").getAttribute("dir")) === "rtl");
  await ctx.close();
}
await b.close();
rec("no-page-errors", "no page errors or console errors/warnings (Chromium's 'Failed to load resource' lines for the intended 4xx/5xx excluded)", JSON.stringify(errors), errors.length === 0);
console.log("SUMMARY", JSON.stringify({ pass: out.filter(Boolean).length, fail: out.filter((x) => !x).length }));
process.exit(out.every(Boolean) ? 0 : 1);
