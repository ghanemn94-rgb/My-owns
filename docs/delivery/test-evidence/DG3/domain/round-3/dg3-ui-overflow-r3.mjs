// domain-reviewer DG3 round 3: ADVERSARIAL re-measurement of the inherited-approval badge (F-DG3-170 verification) on the
// real stack, beyond the round-2 probe (dg3-ui-overflow.mjs, re-run unchanged alongside). SYNTHETIC data; the Sponsor
// acceptance is a demo business decision that approves nothing real (never DG0-DG7).
// For an accepted (counting) G1 inherited approval, in EN and AR, at viewport widths 320, 390, 768, 1024, 1280, 1366, 1920:
//  Gates list (G1 card) and G1 gate view (the "Inherited approval" row):
//   - fit:      the badge box lies within its container (card / dd row) and within the viewport; the document never scrolls
//               horizontally; the badge is not clipped (scrollWidth<=clientWidth, scrollHeight<=clientHeight);
//   - lines:    every rendered line box of the badge text (Range.getClientRects) lies inside the badge and the viewport;
//   - text:     the badge's visible text equals the full translated string, ending with the disclaimer
//               "(does not approve this gate)" / "(لا يعتمد هذه البوابة)";
//   - overlap:  the badge's box does not intersect any sibling chip in the card's chip row (list only);
//   - icon:     the info icon sits at the inline start (EN: left of the text; AR: right of the text) on the first line;
//   - neutral:  the badge keeps status-chip--unknown, never on-track, never the check icon; G1's status chip reads
//               "Not submitted" / "لم تُقدَّم" (data-gate-status=draft); no element has data-gate-status=approved.
// Viewport screenshots plus a cropped screenshot of the container are saved for each case. Exit 1 = any assertion failed.
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL; const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const DEV_ISSUER = "urn:mth:dev-local"; const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {}; for (const l of ["en", "ar"]) { cat[l] = {}; for (const ns of ["common", "auth", "gates"]) cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8")); }
const tr = (l, key, vars = {}) => { const [ns, ...rest] = key.split("."); let n = cat[l][ns]; for (const p of rest) n = n?.[p]; return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? "")); };
const results = []; const rec = (id, expected, actual, pass) => { results.push({ id, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`); };
const j = (x) => JSON.stringify(x);
const norm = (s) => s.replace(/\s+/g, " ").trim();
async function session(username) {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username }) });
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
const must = (r, s, what) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${j(r.body)}`); return r.body; };
const lead = await session("dev.lead"); const admin = await session("dev.admin"); const office = await session("dev.office");
const orgId = admin.me.organization.id; const stamp = Date.now().toString(36);
const m = must(await lead.call("POST", "/api/v1/transformations", { businessUnitId: BU_RETAIL, name: "Synthetic modular layout R3", mode: "modular", entryPhase: "mobilize" }), 201, "m");
const MT = `/api/v1/transformations/${m.id}`;
const u = must(await admin.call("POST", "/api/v1/users", { organizationId: orgId, displayName: "Synthetic SP", preferredLocale: "en", identity: { issuer: DEV_ISSUER, subject: `dl3.sp.${stamp}` } }), 201, "user");
must(await admin.call("POST", "/api/v1/role-assignments", { userId: u.id, roleCode: "SP", scope: { type: "transformation", id: m.id }, reason: "Synthetic demo role (approves nothing real)" }), 201, "grant");
const sp = await session(`dl3.sp.${stamp}`);
const ev = must(await lead.call("POST", `${MT}/evidence`, { kind: "note", title: "Synthetic prior board minute", ownerUserId: lead.id, noteBody: "Synthetic." }), 201, "ev");
must(await office.call("POST", `${MT}/evidence/${ev.id}/review`, { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" }, ev.version), 200, "verify");
const d = must(await lead.call("POST", `${MT}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G1", approvingBody: "Synthetic executive committee", approvedOn: "2026-01-15", evidenceId: ev.id }), 201, "disp");
must(await sp.call("POST", `${MT}/gate-dispensations/${d.id}/decision`, { result: "accepted", note: "Synthetic demo (approves nothing real)" }, d.version), 200, "accept");
const g1 = must(await lead.call("GET", `${MT}/gates/G1`), 200, "g1");
rec("api.g1.annotation", "G1 gate draft with inheritedApproval accepted/counts=true", j({ status: g1.gate.status, ia: g1.gate.inheritedApproval }), g1.gate.status === "draft" && g1.gate.inheritedApproval?.status === "accepted" && g1.gate.inheritedApproval?.counts === true);

/** In-page measurement of the badge inside `containerSel` (closest ancestor). */
function measureInPage(containerSel) {
  const b = document.querySelector("[data-inherited-approval]");
  const c = b.closest(containerSel);
  const R = (r) => ({ l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10 });
  const icon = b.querySelector(".icon, svg"); const textSpan = b.querySelector(":scope > span");
  const range = document.createRange(); range.selectNodeContents(textSpan ?? b);
  const lines = [...range.getClientRects()].map(R);
  const chipRow = b.parentElement;
  const sibs = [...chipRow.children].filter((x) => x !== b && x.classList.contains("status-chip")).map((x) => ({ text: x.textContent.trim(), box: R(x.getBoundingClientRect()) }));
  return {
    badge: R(b.getBoundingClientRect()), container: R(c.getBoundingClientRect()), lines,
    icon: icon ? R(icon.getBoundingClientRect()) : null, text: b.textContent,
    scrollW: b.scrollWidth, clientW: b.clientWidth, scrollH: b.scrollHeight, clientH: b.clientHeight,
    cls: b.className, hasCheck: b.innerHTML.includes("M4 10.5l4 4 8-9"), sibs,
    docScroll: document.documentElement.scrollWidth, vw: window.innerWidth, dir: document.documentElement.dir,
    approved: document.querySelectorAll('[data-gate-status="approved"]').length,
    g1Status: (document.querySelector('[data-gate="G1"] [data-gate-status]') ?? document.querySelector("[data-gate-status]"))?.getAttribute("data-gate-status"),
    g1StatusText: ((document.querySelector('[data-gate="G1"] [data-gate-status]') ?? document.querySelector("[data-gate-status]"))?.textContent ?? "").trim(),
  };
}
const inBox = (a, o, eps = 0.5) => a.l >= o.l - eps && a.r <= o.r + eps && a.t >= o.t - eps && a.b <= o.b + eps;
const inH = (a, o, eps = 0.5) => a.l >= o.l - eps && a.r <= o.r + eps;
const overlaps = (a, o) => a.l < o.r - 0.5 && o.l < a.r - 0.5 && a.t < o.b - 0.5 && o.t < a.b - 0.5;

function assess(lang, width, where, mm) {
  const id = `${lang}.${width}.${where}`;
  const vp = { l: 0, r: mm.vw, t: -1e9, b: 1e9 };
  rec(`${id}.fit`, "badge within container and viewport; doc not wider than viewport; badge not clipped", j({ badge: mm.badge, container: mm.container, docScroll: mm.docScroll, vw: mm.vw, scrollW: mm.scrollW, clientW: mm.clientW, scrollH: mm.scrollH, clientH: mm.clientH }),
    inH(mm.badge, mm.container) && inH(mm.badge, vp) && mm.docScroll <= mm.vw && mm.scrollW <= mm.clientW && mm.scrollH <= mm.clientH);
  rec(`${id}.lines`, "every text line box inside the badge and the viewport", j({ n: mm.lines.length, lines: mm.lines }), mm.lines.length > 0 && mm.lines.every((r) => inBox(r, mm.badge, 1) && inH(r, vp)));
  const want = tr(lang, "gates.inheritedApproval.status.accepted");
  const disclaimer = lang === "en" ? "(does not approve this gate)" : "(لا يعتمد هذه البوابة)";
  rec(`${id}.text`, `full text "${want}" ending with "${disclaimer}"`, j(norm(mm.text)), norm(mm.text) === want && norm(mm.text).endsWith(disclaimer));
  if (where === "list") rec(`${id}.no-overlap`, "badge intersects no sibling chip", j(mm.sibs), mm.sibs.every((s) => !overlaps(mm.badge, s.box)));
  const first = mm.lines[0];
  const iconStart = mm.icon && first && (lang === "en" ? mm.icon.r <= first.l + 1 : mm.icon.l >= first.r - 1) && mm.icon.t < first.b && mm.icon.b > first.t;
  rec(`${id}.icon-start`, `${lang === "en" ? "LTR: icon left of" : "RTL: icon right of"} the text, on its first line; dir=${lang === "en" ? "ltr" : "rtl"}`, j({ icon: mm.icon, firstLine: first, dir: mm.dir }), Boolean(iconStart) && mm.dir === (lang === "en" ? "ltr" : "rtl"));
  const statusWant = tr(lang, "gates.status.draft");
  rec(`${id}.neutral`, `status-chip--unknown, no on-track, no check icon; G1 status draft "${statusWant}"; 0 approved`, j({ cls: mm.cls, hasCheck: mm.hasCheck, g1: mm.g1Status, g1Text: mm.g1StatusText, approved: mm.approved }),
    mm.cls.includes("status-chip--unknown") && !mm.cls.includes("on-track") && !mm.hasCheck && mm.g1Status === "draft" && mm.g1StatusText === statusWant && mm.approved === 0);
}

const NAMES = { ar: "العربية", en: "English" };
const browser = await chromium.launch();
for (const lang of ["en", "ar"]) {
  for (const width of [320, 390, 768, 1024, 1280, 1366, 1920]) {
    // Sign in and switch language at 1366 px (the switcher is in the wide header), then resize to the case's width.
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
    await field.fill("dev.lead"); await field.press("Enter"); await page.waitForURL("**/my-work", { timeout: 20000 });
    if ((await page.locator("html").getAttribute("lang")) !== lang) { const from = lang === "en" ? "ar" : "en"; await page.getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true }).click(); }
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/transformations/${m.id}/gates`); await page.waitForLoadState("networkidle"); await page.locator("[data-inherited-approval]").waitFor();
    assess(lang, width, "list", await page.evaluate(measureInPage, "[data-gate]"));
    await page.locator("[data-inherited-approval]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${lang}-r3-${width}-gates-list.png` });
    await page.locator('[data-gate="G1"]').screenshot({ path: `${SHOTS}/${lang}-r3-${width}-gates-list-g1card.png` });
    await page.goto(`${BASE}/transformations/${m.id}/gates/G1`); await page.waitForLoadState("networkidle"); await page.locator("[data-inherited-approval]").waitFor();
    assess(lang, width, "view", await page.evaluate(measureInPage, "dd"));
    await page.locator("[data-inherited-approval]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${lang}-r3-${width}-gate-view.png` });
    await page.locator("[data-inherited-approval]").locator("xpath=ancestor::dd[1]").screenshot({ path: `${SHOTS}/${lang}-r3-${width}-gate-view-row.png` });
    await ctx.close();
  }
}
await browser.close();
const fails = results.filter((x) => !x.pass);
console.log(`SUMMARY ${results.length - fails.length}/${results.length} PASS; FAIL: ${JSON.stringify(fails.map((f) => f.id))}`);
process.exit(fails.length ? 1 : 0);
