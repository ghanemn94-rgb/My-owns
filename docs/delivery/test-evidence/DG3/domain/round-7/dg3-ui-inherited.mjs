// domain-reviewer DG3 round 2: UI probe of the F-DG3-120 repair (ADR-0021 §5) on the real stack, in English (LTR) and
// Arabic (RTL), Chromium from /opt/pw-browsers. SYNTHETIC data; the Sponsor decisions are demo business decisions that
// approve nothing real and never touch DG0-DG7.
// It drives a Modular transformation through the API (none -> pending_verification -> accepted (counts) ->
// accepted with the evidence re-reviewed 'rejected' (does not count) -> revoked), and a second one to 'rejected', and
// after each state it opens the Gates list, the G1 gate view, Readiness and Dispensations in both languages, asserts on
// the rendered DOM with the shipped i18n catalogues and saves a full-page screenshot per screen, state and language.
// It also compares the badge's computed colours with an APPROVED gate chip (world W2 of dg3-ui-world.mjs, G1 approved).
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const OUT = process.env.OUT; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const world = JSON.parse(readFileSync(`${OUT}/world.json`, "utf8"));
const DEV_ISSUER = "urn:mth:dev-local"; const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "gates", "readiness", "dispensations"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { let n = cat[l]; for (const p of key.split(".")) n = n?.[p]; if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`); return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const j = (x, n = 1200) => JSON.stringify(x)?.slice(0, n);
const CHECK_PATH = "M4 10.5l4 4 8-9";
// ---------------------------------------------------------------- API
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
  if (r.status !== 204) throw new Error(`login ${username} ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const call = async (method, path, body, ifMatch) => {
    const h = { cookie, origin: BASE, "x-csrf-token": me.csrfToken };
    if (body !== undefined) h["content-type"] = "application/json";
    if (ifMatch !== undefined) h["if-match"] = `"${ifMatch}"`;
    if (method === "POST" && ifMatch === undefined) h["idempotency-key"] = randomUUID();
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { call, me, id: me.user.id };
}
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body, 1500)}`); return r.body; };
const lead = await session("dev.lead"); const admin = await session("dev.admin"); const office = await session("dev.office");
const orgId = admin.me.organization.id; const stamp = Date.now().toString(36);
async function synthUser(tid, username, roleCode) {
  const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: `Synthetic ${roleCode}`, preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: username } }), 201, "user");
  must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode, scope: { type: "transformation", id: tid }, reason: "Synthetic demo role (approves nothing real)" }), 201, "grant");
  return session(username);
}
// ---------------------------------------------------------------- browser
const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
async function signedIn(lang, username) {
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const foreign = []; page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u); });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(username); await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 20000 });
  const cur = await page.locator("html").getAttribute("lang");
  if (cur !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx, foreign, lang };
}
// The preferred language is stored on the (shared) dev.lead user, so each visit re-asserts this context's language
// (attempt 1 failed because the AR context's switch also changed what the EN context rendered).
async function visit(s, path) {
  await s.page.goto(`${BASE}${path}`); await s.page.waitForLoadState("networkidle"); await s.page.locator("main#main h1").first().waitFor({ timeout: 20000 });
  if ((await s.page.locator("html").getAttribute("lang")) !== s.lang) {
    const from = s.lang === "en" ? "ar" : "en";
    await s.page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[s.lang] }), exact: true }).click();
    await s.page.waitForFunction((l) => document.documentElement.lang === l, s.lang);
    await s.page.waitForLoadState("networkidle");
  }
  await s.page.waitForTimeout(400);
  return (await s.page.locator("main#main").innerText()).replace(/\s+/g, " ");
}
const shot = (s, name) => s.page.screenshot({ path: `${SHOTS}/${s.lang}-${name}.png`, fullPage: true });
const styleOf = (loc) => loc.evaluate((el) => { const c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor, border: c.borderTopColor, cls: el.className, html: el.innerHTML }; });
const S = { en: await signedIn("en", "dev.lead"), ar: await signedIn("ar", "dev.lead") };
for (const lang of ["en", "ar"]) rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", await S[lang].page.locator("html").getAttribute("dir"), (await S[lang].page.locator("html").getAttribute("dir")) === (lang === "ar" ? "rtl" : "ltr"));

// The approved gate chip's colours (W2's G1 is approved by the synthetic Sponsor in dg3-ui-world.mjs).
const approvedStyle = {};
for (const lang of ["en", "ar"]) {
  const s = S[lang];
  await visit(s, `/transformations/${world.W2}/gates`);
  const chip = s.page.locator('[data-gate="G1"] [data-gate-status="approved"]');
  approvedStyle[lang] = (await chip.count()) ? await styleOf(chip.first()) : null;
  rec(`${lang}.approved-chip-reference`, "W2 G1 approved chip present (reference colours)", j(approvedStyle[lang] && { ...approvedStyle[lang], html: undefined }), approvedStyle[lang] !== null);
}

/** Asserts the four screens for one state in one language; `key` is the gates.inheritedApproval.status key or null. */
async function screens(s, tid, state, key, body, expect) {
  const lang = s.lang; const T = `/transformations/${tid}`;
  // Gates list
  let t = await visit(s, `${T}/gates`); await shot(s, `inherited-${state}-gates-list`);
  const card = s.page.locator('[data-gate="G1"]');
  const statusChip = card.locator("[data-gate-status]");
  const st = await statusChip.getAttribute("data-gate-status"); const stText = (await statusChip.innerText()).trim();
  const approvedAny = await s.page.locator('[data-gate-status="approved"]').count();
  const badges = s.page.locator("[data-inherited-approval]");
  const nb = await badges.count();
  rec(`${lang}.${state}.list.gate-draft`, `G1 chip draft '${tr(lang, "gates.status.draft")}', no approved chip on the page`, `${st} '${stText}' approvedChips=${approvedAny}`, st === "draft" && stText.includes(tr(lang, "gates.status.draft")) && approvedAny === 0);
  if (key === null) {
    rec(`${lang}.${state}.list.no-badge`, "no inherited-approval badge", `badges=${nb} label=${t.includes(tr(lang, "gates.inheritedApproval.label"))}`, nb === 0 && !t.includes(tr(lang, "gates.inheritedApproval.label")));
  } else {
    const badge = card.locator("[data-inherited-approval]");
    const text = (await badge.innerText()).trim(); const sty = await styleOf(badge);
    const exp = tr(lang, `gates.inheritedApproval.status.${key}`);
    rec(`${lang}.${state}.list.badge-text`, `'${exp}'`, `'${text}' data=${await badge.getAttribute("data-inherited-approval")}/${await badge.getAttribute("data-counts")}`, nb === 1 && text === exp && (await badge.getAttribute("data-inherited-approval")) === expect.status && (await badge.getAttribute("data-counts")) === String(expect.counts));
    const sameAsApproved = approvedStyle[lang] && sty.color === approvedStyle[lang].color && sty.bg === approvedStyle[lang].bg;
    rec(`${lang}.${state}.list.badge-never-approved`, "neutral chip (status-chip--unknown), no check icon, colours differ from the approved chip, text not the 'Approved' status label",
      `cls=${sty.cls} color=${sty.color} bg=${sty.bg} border=${sty.border} vs approved color=${approvedStyle[lang]?.color} bg=${approvedStyle[lang]?.bg}; check=${sty.html.includes(CHECK_PATH)}`,
      sty.cls.includes("status-chip--unknown") && !sty.cls.includes("on-track") && !sty.html.includes(CHECK_PATH) && !sameAsApproved && !text.includes(tr(lang, "gates.status.approved")));
    const src = (await card.locator("[data-inherited-approval-source]").innerText()).trim();
    rec(`${lang}.${state}.list.source`, `source line names '${body}' and says it is evidence, not a decision`, src, src.includes(body) && src.startsWith(tr(lang, "gates.inheritedApproval.source", { body: "§", date: "§" }).split("§")[0]));
    const sameRow = await badge.evaluate((b, sel) => b.parentElement === b.ownerDocument.querySelector(sel)?.parentElement, '[data-gate="G1"] [data-gate-status]');
    rec(`${lang}.${state}.list.next-to-status`, "badge in the same row as the 'Not submitted' status chip", String(sameRow), sameRow === true);
  }
  // G1 gate view
  t = await visit(s, `${T}/gates/G1`); await shot(s, `inherited-${state}-gate-view`);
  const vst = await s.page.locator("[data-gate-status]").first().getAttribute("data-gate-status");
  const row = s.page.locator("[data-inherited-approval-row]");
  if (key === null) {
    rec(`${lang}.${state}.view.no-row`, "G1 view: status draft, no inherited row", `${vst} rows=${await row.count()}`, vst === "draft" && (await row.count()) === 0);
  } else {
    const rt = (await row.innerText()).replace(/\s+/g, " ");
    const vb = await styleOf(row.locator("[data-inherited-approval]"));
    const link = await row.getByRole("link", { name: tr(lang, "gates.inheritedApproval.viewDispensations") }).getAttribute("href");
    rec(`${lang}.${state}.view.row`, `G1 view: status draft, row '${tr(lang, "gates.inheritedApproval.label")}' with '${tr(lang, `gates.inheritedApproval.status.${key}`)}', body, neutral chip, link to dispensations`,
      `${vst} | ${rt} | cls=${vb.cls} check=${vb.html.includes(CHECK_PATH)} | link=${link}`,
      vst === "draft" && rt.includes(tr(lang, "gates.inheritedApproval.label")) && rt.includes(tr(lang, `gates.inheritedApproval.status.${key}`)) && rt.includes(body) && vb.cls.includes("status-chip--unknown") && !vb.html.includes(CHECK_PATH) && link === `${T}/dispensations` && (await s.page.locator('[data-gate-status="approved"]').count()) === 0);
  }
  // Readiness
  t = await visit(s, `${T}/readiness`); await shot(s, `inherited-${state}-readiness`);
  const rk = expect.readiness; // inheritedCounts | inheritedPending | null
  const rOk = rk === null ? !t.includes(tr(lang, "readiness.dispensation.inheritedCounts", { gate: "G1" })) && !t.includes(tr(lang, "readiness.dispensation.inheritedPending", { gate: "G1" })) : t.includes(tr(lang, `readiness.dispensation.${rk}`, { gate: "G1" }));
  rec(`${lang}.${state}.readiness`, rk === null ? "no counting/pending inherited line" : `'${tr(lang, `readiness.dispensation.${rk}`, { gate: "G1" })}'`, `found=${rOk}`, rOk);
  // Dispensations
  if (expect.dispStatus) {
    t = await visit(s, `${T}/dispensations`); await shot(s, `inherited-${state}-dispensations`);
    const needs = [tr(lang, "dispensations.kind.inherited_approval"), tr(lang, `dispensations.status.${expect.dispStatus}`), tr(lang, `dispensations.counts.${expect.counts ? "yes" : "no"}`), body];
    const miss = needs.filter((n) => !t.includes(n));
    rec(`${lang}.${state}.dispensations`, `shows ${j(needs)}`, `missing=${j(miss)}`, miss.length === 0);
  }
}

async function both(tid, state, key, body, expect) { for (const lang of ["en", "ar"]) await screens(S[lang], tid, state, key, body, expect); }

// ---------------------------------------------------------------- world M: none -> pending -> accepted -> unverified -> revoked
const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular UI R2", mode: "modular", entryPhase: "mobilize" }), 201, "m");
const MT = `/api/v1/transformations/${m.id}`;
const sp = await synthUser(m.id, `du.sp.${stamp}`, "SP");
await both(m.id, "none", null, "", { readiness: null });
const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic prior board minute", ownerUserId: lead.id, noteBody: "Synthetic: approved 2026-01-15." }), 201, "ev");
const evv = must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, ev.version), 200, "verify");
const BODY = "Synthetic executive committee";
const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: BODY, approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
await both(m.id, "pending", "pending_verification", BODY, { status: "pending_verification", counts: false, readiness: "inheritedPending", dispStatus: "pending" });
const acc = must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic demo (approves nothing real)" }, d.version), 200, "accept");
await both(m.id, "accepted", "accepted", BODY, { status: "accepted", counts: true, readiness: "inheritedCounts", dispStatus: "accepted" });
const evr = must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "rejected", accessibilityStatus: "accessible", note: "Synthetic: re-review" }, evv.version), 200, "re-review");
await both(m.id, "accepted-unverified", "acceptedNotCounting", BODY, { status: "accepted", counts: false, readiness: "inheritedPending", dispStatus: "accepted" });
must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: re-verified" }, evr.version), 200, "re-verify");
const cur = must(await lead.call("GET", `${MT}/gate-dispensations`), 200, "list").items.find((x) => x.id === d.id);
must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/revoke`, { reason: "Synthetic: the minutes were superseded." }, cur.version), 200, "revoke");
await both(m.id, "revoked", "revoked", BODY, { status: "revoked", counts: false, readiness: null, dispStatus: "revoked" });
// ---------------------------------------------------------------- world R: rejected
const r = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular UI rejected R2", mode: "modular", entryPhase: "mobilize" }), 201, "r");
const RT = `/api/v1/transformations/${r.id}`;
const spr = await synthUser(r.id, `du.spr.${stamp}`, "SP");
const ev2 = must(await lead.call("POST", `${RT}/evidence`, { kind: "note", title: "Synthetic claimed minute", ownerUserId: lead.id, noteBody: "Synthetic." }), 201, "ev2");
const BODY2 = "Synthetic steering board";
const d2 = must(await lead.call("POST", `${RT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: BODY2, approvedOn: "2026-02-01", evidenceId: ev2.id }), 201, "disp2");
must(await spr.call("POST", `${RT}/gate-dispensations/${d2.id}/decision`, { result: "rejected", note: "Synthetic: the minute does not show an approval" }, d2.version), 200, "reject");
await both(r.id, "rejected", "rejected", BODY2, { status: "rejected", counts: false, readiness: null, dispStatus: "rejected" });

for (const lang of ["en", "ar"]) rec(`${lang}.foreign-requests`, "no request leaves the application origin", j(S[lang].foreign), S[lang].foreign.length === 0);
await S.en.ctx.close(); await S.ar.ctx.close(); await browser.close();
const fails = results.filter((x) => !x.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${JSON.stringify(fails.map((f) => f.id))}`);
process.exit(fails.length ? 1 : 0);
