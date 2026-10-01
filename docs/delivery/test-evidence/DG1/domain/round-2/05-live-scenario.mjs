// DG1 round-2 domain-reviewer live scenario (reviewer-authored evidence script; not part of the candidate).
// Runs against a disposable stack built from candidate f32c705 (SYNTHETIC dev users, AUTH_MODE=dev).
// Usage (from the disposable clone root): BASE=http://localhost:<port> SHOTS=<dir> DB=<admin url to /mth> node 05-live-scenario.mjs
import { chromium, request } from "@playwright/test";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE;
const SHOTS = process.env.SHOTS;
const DB = process.env.DB;
const out = [];
let failures = 0;
const log = (s) => {
  out.push(s);
  console.log(s);
};
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};
const psql = (sql) => execFileSync("psql", [DB, "-qAtc", sql], { encoding: "utf8" }).trim();

async function session(username) {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  const me = await (await ctx.get("/api/v1/me")).json();
  return { ctx, csrf: me.csrfToken, status: login.status() };
}
const send = (s, method, url, body, ifMatch) =>
  s.ctx.fetch(url, {
    method,
    data: body,
    headers: { "x-csrf-token": s.csrf, ...(ifMatch ? { "if-match": ifMatch } : {}) },
  });

const RETAIL = "01920000-0000-7000-9000-000000000102";

// ---- A. F-DG1-001: closure refused at the API (422, G6), nothing written ----
const office = await session("dev.office");
check("A0 dev.office login 204", office.status === 204, String(office.status));
const created = await send(office, "POST", "/api/v1/transformations", {
  businessUnitId: RETAIL,
  name: "SYNTHETIC domain-review closure probe",
  mode: "end_to_end",
});
const tr = await created.json();
check("A1 create 201 draft", created.status() === 201 && tr.status === "draft", `${created.status()} ${tr.status}`);
const act = await send(office, "PATCH", `/api/v1/transformations/${tr.id}`, { status: "active" }, '"1"');
check("A2 draft->active 200", act.status() === 200, String(act.status()));
const auditBefore = psql(`select count(*) from audit_event where record_id='${tr.id}'`);
for (const [label, body] of [
  ["status only", { status: "closed" }],
  ["mixed with rename", { status: "closed", name: "Renamed while closing" }],
]) {
  const r = await send(office, "PATCH", `/api/v1/transformations/${tr.id}`, body, '"2"');
  const j = await r.json();
  check(
    `A3 active->closed (${label}) refused 422 invalid-transition citing G6`,
    r.status() === 422 && j.type === "urn:mth:problem:invalid-transition" && /G6/.test(j.detail ?? ""),
    `${r.status()} ${j.type} :: ${j.detail}`,
  );
}
const row = psql(`select status||'|'||version||'|'||name from transformation where id='${tr.id}'`);
check("A4 record unchanged (active, v2, name)", row === "active|2|SYNTHETIC domain-review closure probe", row);
const auditAfter = psql(`select count(*) from audit_event where record_id='${tr.id}'`);
check("A5 no audit row written by the refused close", auditBefore === auditAfter, `${auditBefore} -> ${auditAfter}`);
const anyClosed = psql(`select count(*) from transformation where status='closed'`);
check("A6 no transformation is closed in the database", anyClosed === "0", anyClosed);

// ---- B. F-DG1-004: the BU-scoped TL creator can open what it created ----
const lead = await session("dev.lead");
const lc = await send(lead, "POST", "/api/v1/transformations", {
  businessUnitId: RETAIL,
  name: "SYNTHETIC lead-created transformation",
  mode: "modular",
  entryPhase: "design",
});
const ltr = await lc.json();
check("B1 dev.lead (TL @ SYN-RETAIL) create 201", lc.status() === 201, String(lc.status()));
const lr = await lead.ctx.get(`/api/v1/transformations/${ltr.id}`);
check("B2 dev.lead GET own record 200 (no dead not-found)", lr.status() === 200, String(lr.status()));
const derived = psql(
  `select r.code||'|'||a.scope_type||'|'||(a.derived_from_assignment_id is not null) from scoped_assignment a join role r on r.id=a.role_id join app_user u on u.id=a.user_id join user_identity i on i.user_id=u.id where i.subject='dev.lead' and a.scope_type='transformation'`,
);
check("B3 derived assignment is TL @ transformation, linked to source", derived === "TL|transformation|true", derived);
const approvalPerms = psql(
  `select count(*) from role_permission rp join role r on r.id=rp.role_id where r.code='TL' and rp.permission_code like 'gate.%'`,
);
check("B4 the carried-over TL role holds no gate approval permission", approvalPerms === "0", approvalPerms);
const otherTr = await lead.ctx.get(`/api/v1/transformations/${tr.id}`);
check("B5 dev.lead still cannot read a record it did not create (404)", otherTr.status() === 404, String(otherTr.status()));

// ---- C. Branding tokens API ----
const bt = await office.ctx.get("/api/v1/branding/tokens");
const btj = await bt.json();
log(`C0 GET /api/v1/branding/tokens -> ${bt.status()} ${JSON.stringify(btj)}`);
const anon = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
check("C1 tokens unauthenticated -> 401", (await anon.get("/api/v1/branding/tokens")).status() === 401);
const jsonText = JSON.stringify(btj);
check("C2 tokens include #0078FF and no 'official' provenance", /#0078FF/i.test(jsonText) && !/"provenance":"official"/.test(jsonText));

// ---- D. Rendered screens, Arabic and English (Chromium headless) ----
const browser = await chromium.launch();
for (const lang of ["ar", "en"]) {
  const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })).newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/login");
  const form = page.locator("form.dev-login");
  await form.locator("input").fill("dev.office");
  await form.locator('button[type="submit"]').click();
  await page.getByRole("navigation").first().waitFor();
  const cur = await page.evaluate(() => document.documentElement.lang);
  if (cur !== lang) {
    await page.locator(".language-switch button").first().click();
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  }
  const dir = await page.evaluate(() => document.documentElement.dir);
  check(`D1 ${lang}: html dir`, dir === (lang === "ar" ? "rtl" : "ltr"), dir);
  const header = await page.locator("header").first().innerText();
  check(`D2 ${lang}: provisional wordmark marker`, lang === "ar" ? /مؤقت/.test(header) : /Provisional/i.test(header), header.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: `${SHOTS}/${lang}-01-shell.png` });

  await page.goto(`/transformations/${tr.id}/edit`);
  const select = page.locator("select").filter({ has: page.locator('option[value="active"]') }).first();
  await select.waitFor();
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => `${o.value}=${o.textContent}`));
  check(`D3 ${lang}: edit form status options exclude closed`, !options.some((o) => o.startsWith("closed=")), options.join(", "));
  const hint = await page.locator("body").innerText();
  check(`D4 ${lang}: status hint names the G6 business approval`, lang === "ar" ? /البوابة 6/.test(hint) : /G6 \(Sustain\)/.test(hint));
  await page.screenshot({ path: `${SHOTS}/${lang}-02-edit-no-closed.png`, fullPage: true });

  await page.goto(`/transformations/${tr.id}`);
  await page.getByRole("heading").first().waitFor();
  await page.waitForTimeout(800);
  const body = await page.locator("main").innerText();
  check(`D5 ${lang}: detail shows Transformation glossary term`, lang === "ar" ? /التحوّل/.test(body) : /Transformation/.test(body));
  check(`D6 ${lang}: no 'مبادرة التحو' conflation`, !/مبادر(?:ة|ات)\s+(?:ال)?تحو/.test(body));
  const auditTab = page.getByRole("tab", { name: lang === "ar" ? /سجل التدقيق|التدقيق/ : /Audit/i });
  if (await auditTab.count()) await auditTab.first().click();
  else {
    const link = page.getByRole("link", { name: lang === "ar" ? /التدقيق/ : /Audit/i });
    if (await link.count()) await link.first().click();
  }
  await page.waitForTimeout(800);
  const auditText = await page.locator("main").innerText();
  check(`D7 ${lang}: audit trail shows no raw keys (status/current_phase/business_unit_id)`, !/\bcurrent_phase\b|\bbusiness_unit_id\b|\bend_to_end\b/.test(auditText), "");
  check(
    `D8 ${lang}: audit trail shows localized status label`,
    lang === "ar" ? /نشط/.test(auditText) : /Active/.test(auditText),
  );
  await page.screenshot({ path: `${SHOTS}/${lang}-03-detail-audit.png`, fullPage: true });

  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
  check(`D9 ${lang}: no request outside the stack origin (fonts bundled, no CDN)`, external.length === 0, external.join(" "));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  });
  check(`D10 ${lang}: bundled IBM Plex faces loaded`, fonts.some((f) => /IBM Plex Sans/.test(f)), [...new Set(fonts)].join(", "));
}

// ---- E. F-DG1-004 in the browser: dev.lead opens the record it created (ar, then en) ----
// (round-2 correction: the first draft matched 'غير موجود' anywhere, which also hits the Unknown footnote
//  '«غير معروف» يعني أن البيانات غير موجودة بعد'; the check now reads the page heading and the not-found state.)
for (const lang of ["ar", "en"]) {
  const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto("/login");
  await page.locator("form.dev-login input").fill("dev.lead");
  await page.locator('form.dev-login button[type="submit"]').click();
  await page.getByRole("navigation").first().waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) {
    await page.locator(".language-switch button").first().click();
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  }
  await page.goto(`/transformations/${ltr.id}`);
  await page.waitForTimeout(1500);
  const h1 = await page.locator("h1").first().innerText();
  const noPerm = await page.locator('[data-state="no-permission"], [data-state="created-not-visible"], .state--no-permission').count();
  check(`E1 ${lang}: dev.lead opens its own created record (heading = record, no not-found state)`, h1.includes("SYNTHETIC lead-created") && noPerm === 0, `${h1} | notFoundStates=${noPerm}`);
  const main = await page.locator("main").innerText();
  const marker = lang === "ar" ? "حقل بلا ترجمة" : "field without a translation";
  const untranslated = main.split(marker).length - 1;
  const rawAction = /scoped_assignment\.create/.test(main);
  log(`E2 ${lang}: audit trail of the lead-created record: raw action code 'scoped_assignment.create' shown=${rawAction}; fields marked '${marker}'=${untranslated}`);
  await page.screenshot({ path: `${SHOTS}/${lang}-04-lead-own-record.png`, fullPage: true });
}
await browser.close();
log(`SUMMARY failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
