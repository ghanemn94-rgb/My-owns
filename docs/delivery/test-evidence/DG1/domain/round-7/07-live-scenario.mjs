// DG1 round-7 domain-reviewer live scenario (reviewer-authored evidence script; not part of the candidate).
// Runs against a disposable stack built from candidate d3743a352912a357 (commit a6bdea0; SYNTHETIC dev users, AUTH_MODE=dev).
// Usage (from the disposable clone root): BASE=http://localhost:<port> SHOTS=<dir> DB=<admin url to /mth> node 07-live-scenario.mjs
// Sections (A-H re-confirm the round-3/round-4 closures; I and J are new in round 5 for the F-DG1-124 no-regression check):
//  A closure refused 422/G6 (F-DG1-001); B BU-scoped TL creator (F-DG1-004/106); C branding tokens (provisional);
//  D rendered shell/edit/detail in ar+en; E derived creator-assignment audit entry localized (F-DG1-005/008);
//  F the same entry seen by another user (TO); G marked fallback for an untranslated action/field (synthetic probe row);
//  H F-DG1-210: dev.lead creates THROUGH THE UI; Edit/Archive + audit trail appear with NO document reload (ar+en),
//    the Edit link really opens the edit form and the server accepts the edit (server-granted access is real).
//  I live cursor pagination over all six sorts, cursor binding/tamper refusal, scoped list; J identity cookie handling.
import { chromium, request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const BASE = process.env.BASE;
const SHOTS = process.env.SHOTS;
const DB = process.env.DB;
let failures = 0;
const log = (s) => console.log(s);
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};
const psql = (sql) => execFileSync("psql", [DB, "-qAtc", sql], { encoding: "utf8" }).trim();

// i18n catalogue of the candidate: "<file>.<path>" keys, e.g. common.action.edit
const CAT = {};
for (const lang of ["en", "ar"]) {
  CAT[lang] = {};
  const dir = `apps/web/src/i18n/${lang}`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")))
    CAT[lang][f.replace(/\.json$/, "")] = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
}
const tr = (lang, key) => {
  const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), CAT[lang]);
  if (typeof v !== "string") throw new Error(`missing catalogue key ${lang}:${key}`);
  return v;
};

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
const trx = await created.json();
check("A1 create 201 draft", created.status() === 201 && trx.status === "draft", `${created.status()} ${trx.status}`);
const act = await send(office, "PATCH", `/api/v1/transformations/${trx.id}`, { status: "active" }, '"1"');
check("A2 draft->active 200", act.status() === 200, String(act.status()));
const auditBefore = psql(`select count(*) from audit_event where record_id='${trx.id}'`);
for (const [label, body] of [
  ["status only", { status: "closed" }],
  ["mixed with rename", { status: "closed", name: "Renamed while closing" }],
]) {
  const r = await send(office, "PATCH", `/api/v1/transformations/${trx.id}`, body, '"2"');
  const j = await r.json();
  check(
    `A3 active->closed (${label}) refused 422 invalid-transition citing G6`,
    r.status() === 422 && j.type === "urn:mth:problem:invalid-transition" && /G6/.test(j.detail ?? ""),
    `${r.status()} ${j.type} :: ${j.detail}`,
  );
}
const row = psql(`select status||'|'||version||'|'||name from transformation where id='${trx.id}'`);
check("A4 record unchanged (active, v2, name)", row === "active|2|SYNTHETIC domain-review closure probe", row);
const auditAfter = psql(`select count(*) from audit_event where record_id='${trx.id}'`);
check("A5 no audit row written by the refused close", auditBefore === auditAfter, `${auditBefore} -> ${auditAfter}`);
check("A6 no transformation is closed in the database", psql(`select count(*) from transformation where status='closed'`) === "0");

// ---- B. F-DG1-004/106: the BU-scoped TL creator can open what it created; access stays scoped ----
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
  `select r.code||'|'||a.scope_type||'|'||(a.derived_from_assignment_id is not null) from scoped_assignment a join role r on r.id=a.role_id join user_identity i on i.user_id=a.user_id where i.subject='dev.lead' and a.scope_type='transformation' and a.scope_id='${ltr.id}'`,
);
check("B3 derived assignment is TL @ transformation, linked to source", derived === "TL|transformation|true", derived);
check(
  "B4 the carried-over TL role holds no gate approval permission",
  psql(`select count(*) from role_permission rp join role r on r.id=rp.role_id where r.code='TL' and rp.permission_code like 'gate.%'`) === "0",
);
const otherTr = await lead.ctx.get(`/api/v1/transformations/${trx.id}`);
check("B5 dev.lead still cannot read a record it did not create (404)", otherTr.status() === 404, String(otherTr.status()));
const auditApi = await (await lead.ctx.get(`/api/v1/transformations/${ltr.id}/audit`)).json();
const items = auditApi.items ?? auditApi;
const derivedEv = items.find((e) => e.action === "scoped_assignment.create");
log(`B6 API audit entry of the derived grant: ${JSON.stringify(derivedEv)}`);
check("B6 derived grant recorded on the transformation's own trail", Boolean(derivedEv && derivedEv.changes && "derivedFromAssignmentId" in derivedEv.changes));

// ---- C. Branding tokens API ----
const bt = await office.ctx.get("/api/v1/branding/tokens");
const btj = await bt.json();
log(`C0 GET /api/v1/branding/tokens -> ${bt.status()} ${JSON.stringify(btj)}`);
const anon = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
check("C1 tokens unauthenticated -> 401", (await anon.get("/api/v1/branding/tokens")).status() === 401);
const jsonText = JSON.stringify(btj);
check("C2 tokens: 200, #0078FF present, provenance provisional, never official", bt.status() === 200 && /#0078FF/i.test(jsonText) && /provisional/.test(jsonText) && !/"provenance":"official"/.test(jsonText));

// ---- I. F-DG1-124 no-regression: live cursor pagination over all six sorts (Map-based SORTS, entries-based filter hash) ----
{
  // Seven more SYNTHETIC records (mixed scripts/case; some active, one on hold) so limit=2 really spans several pages.
  const extra = ["SYNTHETIC alpha", "SYNTHETIC Beta", "SYNTHETIC beta", "SYNTHETIC تحوّل تجريبي", "SYNTHETIC Zeta", "SYNTHETIC _under", "SYNTHETIC 10"];
  for (const [i, name] of extra.entries()) {
    const c = await send(office, "POST", "/api/v1/transformations", { businessUnitId: RETAIL, name, mode: "end_to_end" });
    const cj = await c.json();
    if (i % 2 === 0) await send(office, "PATCH", `/api/v1/transformations/${cj.id}`, { status: "active" }, '"1"');
    if (i === 2) await send(office, "PATCH", `/api/v1/transformations/${cj.id}`, { status: "on_hold" }, '"2"');
  }
  const all = await (await office.ctx.get("/api/v1/transformations?limit=100")).json();
  log(`I0 dev.office unpaged list: ${all.items.length} items, nextCursor=${all.nextCursor}`);
  for (const sort of ["updatedAt:desc", "updatedAt:asc", "name:asc", "name:desc", "code:asc", "code:desc"]) {
    const full = await (await office.ctx.get(`/api/v1/transformations?limit=100&sort=${sort}`)).json();
    const ids = [];
    let cursor = null;
    let pages = 0;
    do {
      const r = await office.ctx.get(`/api/v1/transformations?limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`);
      const j = await r.json();
      if (r.status() !== 200) { ids.push(`HTTP${r.status()}`); break; }
      ids.push(...j.items.map((x) => x.id));
      cursor = j.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    const fullIds = full.items.map((x) => x.id);
    const sorted = full.items.map((x) => (sort.startsWith("name") ? x.name : sort.startsWith("code") ? x.code : x.updatedAt));
    check(`I1 ${sort}: paging by 2 (${pages} pages) returns the same ordered set as one page, no duplicates/gaps`,
      JSON.stringify(ids) === JSON.stringify(fullIds) && new Set(ids).size === ids.length && ids.length === all.items.length,
      `${ids.length} vs ${fullIds.length}; first keys ${JSON.stringify(sorted.slice(0, 3))}`);
  }
  const p1 = await (await office.ctx.get("/api/v1/transformations?limit=1&sort=name:asc")).json();
  const reuse = await office.ctx.get(`/api/v1/transformations?limit=1&sort=name:desc&cursor=${p1.nextCursor}`);
  check("I2 a cursor reused with another sort is refused 400", reuse.status() === 400, String(reuse.status()));
  const reuseStatus = await office.ctx.get(`/api/v1/transformations?limit=1&sort=name:asc&status=active&cursor=${p1.nextCursor}`);
  check("I3 a cursor reused with another status filter is refused 400", reuseStatus.status() === 400, String(reuseStatus.status()));
  const tampered = await office.ctx.get(`/api/v1/transformations?limit=1&sort=name:asc&cursor=${p1.nextCursor.slice(0, -3)}AAA`);
  check("I4 a tampered cursor is refused 400", tampered.status() === 400, String(tampered.status()));
  const badSort = await office.ctx.get("/api/v1/transformations?sort=__proto__");
  check("I5 an unknown sort (e.g. __proto__) is a 400 validation problem, never a 500", badSort.status() === 400, String(badSort.status()));
  const multi = await office.ctx.get("/api/v1/transformations?status=active&status=on_hold&limit=100");
  const mj = await multi.json();
  check("I6 repeatable status filter works and returns only those statuses", multi.status() === 200 && mj.items.every((x) => ["active", "on_hold"].includes(x.status)), `${multi.status()} ${mj.items.map((x) => x.status).join(",")}`);
  const ordered = await office.ctx.get("/api/v1/transformations?status=on_hold&status=active&limit=1");
  const oj = await ordered.json();
  if (oj.nextCursor) {
    const swapped = await office.ctx.get(`/api/v1/transformations?status=active&status=on_hold&limit=1&cursor=${oj.nextCursor}`);
    check("I7 the filter hash is order-insensitive for status (cursor from on_hold,active accepted under active,on_hold)", swapped.status() === 200, String(swapped.status()));
  } else log("I7 skipped: fewer than 2 active/on_hold records");
  const leadList = await (await lead.ctx.get("/api/v1/transformations?limit=100")).json();
  const leadIds = new Set(leadList.items.map((x) => x.id));
  check("I8 scoped list: dev.lead sees its own created record but not the office's record", leadIds.has(ltr.id) && !leadIds.has(trx.id), `${leadList.items.length} items`);
}

// ---- J. F-DG1-124 no-regression: identity routes read cookies from the jar's own entries ----
{
  const mk = (cookie) => request.newContext({ baseURL: BASE, extraHTTPHeaders: cookie ? { origin: BASE, cookie } : { origin: BASE } });
  const noCookie = await mk(null);
  check("J1 GET /me without a session cookie -> 401", (await noCookie.get("/api/v1/me")).status() === 401);
  const garbage = await mk("mth_session=not-a-real-token");
  check("J2 GET /me with an unknown session token -> 401", (await garbage.get("/api/v1/me")).status() === 401);
  const proto = await mk("__proto__=x; constructor=y; toString=z; hasOwnProperty=w");
  const pr = await proto.get("/api/v1/me");
  check("J3 prototype-named cookies only -> 401 (no 500, no session)", pr.status() === 401, String(pr.status()));
  const protoList = await proto.get("/api/v1/transformations");
  check("J4 prototype-named cookies on a business route -> 401", protoList.status() === 401, String(protoList.status()));
  const s = await session("dev.lead");
  const me = await s.ctx.get("/api/v1/me");
  const mej = await me.json();
  check("J5 dev-login then GET /me -> 200 with the user", me.status() === 200, `${me.status()} ${JSON.stringify(mej).slice(0, 160)}`);
  check("J6 dev.lead's effective permissions hold no gate/finance approval", !/gate\.decide|finance\.validate/.test(JSON.stringify(mej)));
  const out = await send(s, "POST", "/api/v1/auth/logout", {});
  check("J7 logout accepted", [200, 204].includes(out.status()), String(out.status()));
  check("J8 after logout GET /me -> 401", (await s.ctx.get("/api/v1/me")).status() === 401);
  const cb = await (await mk("mth_login=abc")).get("/api/v1/auth/callback?code=x&state=y", { maxRedirects: 0 });
  check("J9 OIDC callback in AUTH_MODE=dev (OIDC not configured) -> 404, no session", cb.status() === 404, String(cb.status()));
}

// ---- G (setup). A synthetic audit row with an action and a field the catalogue does not know, on the lead's record ----
const leadUserId = psql(`select user_id from user_identity where subject='dev.lead'`);
psql(
  `insert into audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, source, changes)
   select gen_random_uuid(), organization_id, id, 'user', '${leadUserId}', 'zz_probe.synthetic_event', 'transformation', id, 'cli',
          '{"mysteryField":{"from":null,"to":"zz_code"}}'::jsonb from transformation where id='${ltr.id}'`,
);

const browser = await chromium.launch();
async function signedIn(username, lang) {
  const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })).newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/login");
  await page.locator("form.dev-login input").fill(username);
  await page.locator('form.dev-login button[type="submit"]').click();
  await page.getByRole("navigation").first().waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) {
    await page.locator(".language-switch button").first().click();
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  }
  return { page, requests };
}
async function auditRows(page) {
  return page.locator("table").last().locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim())),
  );
}

// ---- D. Rendered screens, Arabic and English (Chromium headless), as dev.office ----
for (const lang of ["ar", "en"]) {
  const { page, requests } = await signedIn("dev.office", lang);
  const dir = await page.evaluate(() => document.documentElement.dir);
  check(`D1 ${lang}: html dir`, dir === (lang === "ar" ? "rtl" : "ltr"), dir);
  const header = await page.locator("header").first().innerText();
  check(`D2 ${lang}: provisional wordmark marker`, lang === "ar" ? /مؤقت/.test(header) : /Provisional/i.test(header), header.replace(/\s+/g, " ").slice(0, 120));
  await page.screenshot({ path: `${SHOTS}/${lang}-01-shell.png` });

  await page.goto(`/transformations/${trx.id}/edit`);
  const select = page.locator("select").filter({ has: page.locator('option[value="active"]') }).first();
  await select.waitFor();
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => `${o.value}=${o.textContent}`));
  check(`D3 ${lang}: edit form status options exclude closed`, !options.some((o) => o.startsWith("closed=")), options.join(", "));
  const hint = await page.locator("body").innerText();
  check(`D4 ${lang}: status hint names the G6 business approval`, lang === "ar" ? /البوابة 6/.test(hint) : /G6 \(Sustain\)/.test(hint));
  await page.screenshot({ path: `${SHOTS}/${lang}-02-edit-no-closed.png`, fullPage: true });

  await page.goto(`/transformations/${trx.id}`);
  await page.getByRole("heading").first().waitFor();
  await page.waitForTimeout(1000);
  const body = await page.locator("main").innerText();
  check(`D5 ${lang}: detail uses the Transformation glossary term`, lang === "ar" ? /التحوّل/.test(body) : /Transformation/.test(body));
  check(`D6 ${lang}: no 'مبادرة التحوّل' conflation`, !/مبادر(?:ة|ات)\s+(?:ال)?تحو/.test(body));
  check(`D7 ${lang}: audit trail shows no raw keys`, !/\bcurrent_phase\b|\bbusiness_unit_id\b|\bend_to_end\b/.test(body));
  check(`D8 ${lang}: audit trail shows localized status label`, lang === "ar" ? /نشط/.test(body) : /Active/.test(body));
  check(`D9 ${lang}: missing value data shows Unknown, never 0/green`, lang === "ar" ? /غير معروف/.test(body) : /Unknown/.test(body));
  await page.screenshot({ path: `${SHOTS}/${lang}-03-detail-audit.png`, fullPage: true });
  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
  check(`D10 ${lang}: no request outside the stack origin (fonts bundled, no CDN)`, external.length === 0, external.join(" "));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
  });
  check(`D11 ${lang}: bundled IBM Plex faces loaded`, fonts.some((f) => /IBM Plex Sans/.test(f)), [...new Set(fonts)].join(", "));
}

// ---- E. F-DG1-005/008: the derived creator-assignment entry, as the creator (dev.lead), strict ----
const EXPECT = {
  en: {
    action: "Role granted to the creator (carried over from a business-unit assignment)",
    role: "Transformation Lead",
    user: "Synthetic Transformation Lead",
    scope: /Transformation: this transformation/,
    source: "Carried over from assignment",
    fieldMarker: "field without a translation",
    valueMarker: "value without a translation",
    actionMarker: "action without a translation",
  },
  ar: {
    action: "إسناد دور لمُنشئ السجل (منقول من إسناد على مستوى وحدة العمل)",
    role: "قائد التحوّل",
    user: "Synthetic Transformation Lead",
    scope: /هذا التحوّل/,
    source: "منقول من الإسناد",
    fieldMarker: "حقل بلا ترجمة",
    valueMarker: "قيمة بلا ترجمة",
    actionMarker: "إجراء بلا ترجمة",
  },
};
for (const lang of ["ar", "en"]) {
  const x = EXPECT[lang];
  const { page } = await signedIn("dev.lead", lang);
  await page.goto(`/transformations/${ltr.id}`);
  await page.locator("h1").first().waitFor();
  await page.waitForTimeout(1500);
  const h1 = await page.locator("h1").first().innerText();
  check(`E0 ${lang}: dev.lead opens its own created record`, h1.includes("SYNTHETIC lead-created"), h1);
  const rows = await auditRows(page);
  log(`E-rows ${lang}: ${JSON.stringify(rows)}`);
  const d = rows.find((r) => r.some((c) => c.includes(x.action)));
  check(`E1 ${lang}: derived entry action is the localized 'carried over' label`, Boolean(d), d ? d.join(" | ") : "not found");
  const txt = d ? d.join(" | ") : "";
  check(`E2 ${lang}: no raw action code`, !/scoped_assignment/.test(txt));
  check(`E3 ${lang}: role shown as '${x.role}'`, txt.includes(x.role) && !/\bTL\b/.test(txt.replace(x.role, "")));
  check(`E4 ${lang}: user shown by name, not id`, txt.includes(x.user) && !txt.includes(leadUserId));
  check(`E5 ${lang}: scope shown as scope type + 'this transformation'`, x.scope.test(txt) && !txt.includes(ltr.id) && !/"type"/.test(txt));
  check(`E6 ${lang}: source labelled '${x.source}'`, txt.includes(x.source));
  check(`E7 ${lang}: nothing in the derived entry marked untranslated`, !txt.includes(x.fieldMarker) && !txt.includes(x.valueMarker) && !txt.includes(x.actionMarker));
  check(`E8 ${lang}: no raw camelCase field keys`, !/userId|roleCode|derivedFromAssignmentId|effectiveTo/.test(txt));
  const g = rows.find((r) => r.some((c) => c.includes("zz_probe.synthetic_event")));
  const gt = g ? g.join(" | ") : "";
  check(`G1 ${lang}: unknown action stays readable and marked '${x.actionMarker}'`, Boolean(g) && gt.includes(x.actionMarker), gt);
  check(`G2 ${lang}: unknown field stays readable and marked '${x.fieldMarker}'`, gt.includes("mysteryField") && gt.includes(x.fieldMarker), gt);
  check(`G3 ${lang}: unknown value stays readable and marked '${x.valueMarker}'`, gt.includes("zz_code") && gt.includes(x.valueMarker), gt);
  const bdiLtr = await page.locator('bdi[dir="ltr"]', { hasText: "zz_probe.synthetic_event" }).count();
  check(`G4 ${lang}: the raw action code is LTR-isolated (bdi dir=ltr)`, bdiLtr >= 1, String(bdiLtr));
  await page.screenshot({ path: `${SHOTS}/${lang}-04-lead-derived-audit.png`, fullPage: true });
}

// ---- F. The same entry seen by another authorized user (dev.office, TO @ organization) ----
for (const lang of ["ar", "en"]) {
  const x = EXPECT[lang];
  const { page } = await signedIn("dev.office", lang);
  await page.goto(`/transformations/${ltr.id}`);
  await page.locator("h1").first().waitFor();
  await page.waitForTimeout(1500);
  const rows = await auditRows(page);
  const d = rows.find((r) => r.some((c) => c.includes(x.action)));
  const txt = d ? d.join(" | ") : "";
  log(`F-row ${lang}: ${txt}`);
  check(`F1 ${lang}: TO sees the localized derived entry with the role label`, Boolean(d) && txt.includes(x.role));
  const unknownWord = lang === "ar" ? "غير معروف" : "Unknown";
  check(`F2 ${lang}: TO sees the user by name or as an honest Unknown, never a raw id`, (txt.includes(x.user) || txt.includes(unknownWord)) && !txt.includes(leadUserId), txt);
  await page.screenshot({ path: `${SHOTS}/${lang}-05-office-derived-audit.png`, fullPage: true });
}

// ---- H. F-DG1-210: UI create by the BU-scoped Lead; controls + audit trail without a reload ----
for (const lang of ["ar", "en"]) {
  const x = EXPECT[lang];
  const { page } = await signedIn("dev.lead", lang);
  // Warm the cached GET /me (as a real user's earlier browsing would), then go to the create page IN-APP.
  await page.goto("/transformations");
  await page.getByRole("heading").first().waitFor();
  const meCalls = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/me") meCalls.push({ at: Date.now(), status: r.status() });
  });
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });
  await page.goto("/transformations/new");
  await page.getByLabel(tr(lang, "transformations.field.name"), { exact: false }).first().waitFor();
  const buSelect = page.getByLabel(tr(lang, "transformations.field.businessUnit"), { exact: false }).first();
  const buOptions = await buSelect.locator("option").evaluateAll((os) => os.map((o) => o.textContent));
  log(`H0 ${lang}: business-unit options offered to dev.lead: ${JSON.stringify(buOptions)}`);
  await buSelect.selectOption({ label: buOptions.find((o) => /SYN-RETAIL/.test(o)) });
  const name = `SYNTHETIC ${lang.toUpperCase()} UI lead-created (F-DG1-210)`;
  await page.getByLabel(tr(lang, "transformations.field.name"), { exact: false }).first().fill(name);
  await page.evaluate(() => {
    window.__mthNoReload = true;
  });
  const navBefore = navigations;
  const meBefore = meCalls.length;
  const t0 = Date.now();
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const newId = page.url().split("/").pop();
  const main = page.locator("main#main");
  const edit = main.getByRole("link", { name: tr(lang, "common.action.edit"), exact: true });
  const archive = main.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true });
  const trail = page.getByRole("region", { name: tr(lang, "transformations.audit.title"), exact: true });
  let visible = true;
  try {
    await edit.waitFor({ state: "visible", timeout: 8000 });
    await archive.waitFor({ state: "visible", timeout: 2000 });
    await trail.waitFor({ state: "visible", timeout: 4000 });
  } catch {
    visible = false;
  }
  const elapsed = Date.now() - t0;
  const noReload = await page.evaluate(() => window.__mthNoReload === true);
  check(`H1 ${lang}: Edit link visible on the new record without a reload`, (await edit.count()) === 1 && visible, `edit=${await edit.count()} after ${elapsed} ms`);
  check(`H2 ${lang}: Archive button visible`, (await archive.count()) === 1, String(await archive.count()));
  check(`H3 ${lang}: audit trail region visible`, (await trail.count()) === 1, String(await trail.count()));
  check(`H4 ${lang}: no document reload happened (window marker survives; SPA navigation only)`, noReload, `framenavigated main-frame events since submit: ${navigations - navBefore}`);
  check(`H5 ${lang}: GET /me was re-fetched after the create`, meCalls.length > meBefore, JSON.stringify(meCalls.slice(meBefore)));
  const rows = await auditRows(page);
  const d = rows.find((r) => r.some((c) => c.includes(x.action)));
  check(`H6 ${lang}: the trail already shows the localized derived grant`, Boolean(d), d ? d.join(" | ") : JSON.stringify(rows));
  await page.screenshot({ path: `${SHOTS}/${lang}-06-lead-ui-create-no-reload.png`, fullPage: true });
  // The control is real: the Edit link opens the edit form and the server accepts the change (If-Match concurrency).
  await edit.click();
  await page.waitForURL(new RegExp(`/transformations/${newId}/edit$`));
  const nameField = page.getByLabel(tr(lang, "transformations.field.name"), { exact: false }).first();
  await nameField.waitFor();
  await nameField.fill(`${name} - edited`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${newId}$`));
  const persisted = psql(`select name||'|'||version from transformation where id='${newId}'`);
  check(`H7 ${lang}: the edit via the newly shown control is persisted (server-authorized)`, persisted === `${name} - edited|2`, persisted);
  const auditUpdate = psql(`select count(*) from audit_event where record_id='${newId}' and action='transformation.update'`);
  check(`H8 ${lang}: the edit wrote an audit event`, auditUpdate === "1", auditUpdate);
  check(`H9 ${lang}: still no document reload through create -> edit -> save`, await page.evaluate(() => window.__mthNoReload === true));
}

await browser.close();
log(`SUMMARY failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
