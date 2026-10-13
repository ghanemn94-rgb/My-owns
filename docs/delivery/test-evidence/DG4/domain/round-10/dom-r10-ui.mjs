// domain-reviewer DG4 round 10 (T-DG4-REV-DOM-R10): UI probe of the round-10 text changes (F-DG4-160 and the sweep)
// on the real stack (with-stack.sh: PostgreSQL + API serving the built web, synthetic dev seed), pre-installed Chromium
// (/opt/pw-browsers), in English (LTR) and Arabic (RTL). Asserts on rendered text against the shipped catalogues and
// saves a full-page screenshot per claim and language to $SHOTS. SYNTHETIC data; nothing here is a business approval.
// Claims:
//  edit      /transformations/:id/edit shows the new Status hint verbatim; 'closed' is not offered; no 'later release'.
//  closure   the workspace has a Closure tab, and /transformations/:id/closure renders the governed close guidance
//            (closureP4.transformation.closeDescription or the status model) — the place the hint points to.
//  planned   each of the 4 planned areas shows nav.plannedBody and nav.willContain verbatim, and the delivered sub-entries
//            the text points to are links under the area in the primary navigation; the Dashboards link is present.
//  dashboards the Dashboards link opens a working page (h1), as the text says.
//  partial   /benefits-finance and /initiatives-roadmaps show nav.entry.portfolioPlanned and nav.willContain verbatim.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL;
const SHOTS = process.env.SHOTS;
mkdirSync(SHOTS, { recursive: true });
const I18N = `${process.cwd()}/apps/web/src/i18n`;
const cat = {};
for (const l of ["en", "ar"]) {
  cat[l] = {};
  for (const ns of ["common", "auth", "nav", "transformations", "closureP4"])
    cat[l][ns] = JSON.parse(readFileSync(`${I18N}/${l}/${ns}.json`, "utf8"));
}
const tr = (l, key, vars = {}) => {
  let n = cat[l];
  for (const p of key.split(".")) n = n?.[p];
  if (typeof n !== "string") throw new Error(`missing i18n ${l} ${key}`);
  return n.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars[v] ?? ""));
};
const results = [];
const rec = (id, expected, actual, pass) => {
  results.push({ id, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} :: expected ${expected} :: actual ${actual}`);
};
const NAMES = { ar: "العربية", en: "English" };
const PLANNED = [
  { path: "/playbook", area: "playbook", subs: ["phaseWorkspace"] },
  { path: "/risks-actions", area: "risks", subs: ["raid", "actions", "correctiveActions"] },
  { path: "/change-adoption", area: "change", subs: ["adoptionPlan"] },
  { path: "/bau-improvement", area: "bau", subs: ["performanceAreas", "improvementBacklog", "lessons"] },
];
const PARTIAL = [
  { path: "/benefits-finance", area: "benefits" },
  { path: "/initiatives-roadmaps", area: "initiatives" },
];
// Run 2 fix: seed-dev seeds users only (run 1 found no transformation). Create one SYNTHETIC transformation through the
// real API as dev.lead (dev login, CSRF, idempotency key), as in my round-7 dom-api.mjs; BU_RETAIL is the seeded unit.
const BU_RETAIL = "01920000-0000-7000-9000-000000000102";
async function apiCreateTransformation() {
  const r = await fetch(`${BASE}/api/v1/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "dev.lead" }) });
  if (r.status !== 204) throw new Error(`login dev.lead ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  const res = await fetch(`${BASE}/api/v1/transformations`, {
    method: "POST",
    headers: { cookie, origin: BASE, "x-csrf-token": me.csrfToken, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ businessUnitId: BU_RETAIL, name: "Synthetic DG4 domain review round 10", mode: "end_to_end" }),
  });
  const body = await res.json();
  console.log(`API create transformation: ${res.status} ${body.code ?? ""} ${body.status ?? ""}`);
  if (res.status !== 201) throw new Error(JSON.stringify(body).slice(0, 400));
  return body;
}
const created = await apiCreateTransformation();
const browser = await chromium.launch();
async function signedIn(lang, username) {
  const ctx = await browser.newContext({
    locale: lang === "ar" ? "ar-SA" : "en-US",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();
  const foreign = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
  });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(new RegExp(`^(${tr("en", "auth.dev.username")}|${tr("ar", "auth.dev.username")})`));
  await field.fill(username);
  await field.press("Enter");
  await page.waitForURL("**/my-work", { timeout: 30000 });
  const cur = await page.locator("html").getAttribute("lang");
  if (cur !== lang) {
    const from = lang === "en" ? "ar" : "en";
    await page
      .getByRole("button", { name: tr(from, "common.language.switchTo", { language: NAMES[lang] }), exact: true })
      .click();
  }
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  return { page, ctx, foreign };
}
async function visit(s, path) {
  await s.page.goto(`${BASE}${path}`);
  await s.page.waitForLoadState("networkidle");
  await s.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
  await s.page.waitForTimeout(600);
  return (await s.page.locator("main#main").innerText()).replace(/\s+/g, " ");
}
const shot = (s, lang, name) => s.page.screenshot({ path: `${SHOTS}/${lang}-${name}.png`, fullPage: true });
const norm = (x) => x.replace(/\s+/g, " ").trim();

for (const lang of ["en", "ar"]) {
  const s = await signedIn(lang, "dev.office");
  const dir = await s.page.locator("html").getAttribute("dir");
  rec(`${lang}.dir`, lang === "ar" ? "rtl" : "ltr", dir, dir === (lang === "ar" ? "rtl" : "ltr"));
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      rec(`${lang}.${name}.exception`, "no exception", String(e.message).slice(0, 400), false);
      await shot(s, lang, `${name}-error`).catch(() => {});
    }
  };
  // The synthetic transformation created through the API above, opened by its lead (dev.lead) in this language.
  const t = created;
  rec(`${lang}.seed.transformation`, "the synthetic transformation created through the API", `${t.code} ${t.status}`, !!t.id);
  const nav = s;
  const lead = await signedIn(lang, "dev.lead");
  { const d = await lead.page.locator("html").getAttribute("dir"); rec(`${lang}.lead.dir`, lang === "ar" ? "rtl" : "ltr", d, d === (lang === "ar" ? "rtl" : "ltr")); }

  const as = (x, f) => async () => { const keep = s.page; s.page = x.page; try { await f(); } finally { s.page = keep; } };
  await step("edit-status-hint", as(lead, async () => {
    const text = await visit(s, `/transformations/${t.id}/edit`);
    const hint = tr(lang, "transformations.form.statusHint");
    rec(`${lang}.edit.hint-verbatim`, hint, text.includes(norm(hint)) ? "present" : "absent", text.includes(norm(hint)));
    const stale = lang === "en" ? /later release|available in/i : /إصدار لاحق|سيتاح/;
    rec(`${lang}.edit.no-later-release`, "no 'later release' wording on the page", stale.test(text) ? "found" : "none", !stale.test(text));
    const values = await s.page.locator("main#main select").evaluateAll((els) =>
      els.flatMap((e) => [...e.options].map((o) => o.value)),
    );
    rec(`${lang}.edit.closed-not-offered`, "no 'closed' option", JSON.stringify(values), !values.includes("closed"));
    await s.page.getByText(hint, { exact: true }).scrollIntoViewIfNeeded();
    await shot(s, lang, "edit-status-hint");
  }));

  await step("closure-page", as(lead, async () => {
    const text = await visit(s, `/transformations/${t.id}/closure`);
    const tab = await s.page.getByRole("link", { name: tr(lang, "closureP4.tab"), exact: true }).count();
    rec(`${lang}.closure.tab`, `workspace tab '${tr(lang, "closureP4.tab")}'`, `links=${tab}`, tab > 0);
    const desc = norm(tr(lang, "closureP4.transformation.closeDescription"));
    const btn = await s.page.getByRole("button", { name: tr(lang, "closureP4.transformation.close"), exact: true }).count();
    rec(
      `${lang}.closure.governed-close`,
      "the close action or its G6 guidance on the Closure page",
      `closeButton=${btn} descriptionShown=${text.includes(desc)}`,
      btn > 0 || text.includes(desc),
    );
    await shot(s, lang, "closure-page");
  }));
  await lead.ctx.close();

  for (const p of PLANNED) {
    await step(`planned-${p.area}`, async () => {
      const text = await visit(s, p.path);
      const body = norm(tr(lang, "nav.plannedBody"));
      rec(`${lang}.planned.${p.area}.body`, "nav.plannedBody verbatim", text.includes(body) ? "present" : "absent", text.includes(body));
      const h3 = await s.page.getByRole("heading", { level: 3, name: tr(lang, "nav.willContain"), exact: true }).count();
      rec(`${lang}.planned.${p.area}.covers`, `h3 '${tr(lang, "nav.willContain")}'`, `count=${h3}`, h3 === 1);
      const nav = s.page.getByRole("navigation", { name: tr(lang, "nav.primary") });
      const sub = nav.getByRole("list", { name: tr(lang, `nav.areas.${p.area}.label`), exact: true });
      const missing = [];
      for (const id of p.subs)
        if ((await sub.getByRole("link", { name: tr(lang, `nav.sub.${id}`), exact: true }).count()) !== 1) missing.push(id);
      rec(`${lang}.planned.${p.area}.subentries`, `links ${p.subs.join(",")} under the area`, `missing=${JSON.stringify(missing)}`, missing.length === 0);
      const dash = await nav.getByRole("link", { name: tr(lang, "nav.sub.dashboards"), exact: true }).count();
      rec(`${lang}.planned.${p.area}.dashboards-link`, "Dashboards link in the navigation", `count=${dash}`, dash === 1);
      await shot(s, lang, `planned-${p.area}`);
    });
  }

  await step("dashboards", async () => {
    await visit(s, "/risks-actions");
    await s.page
      .getByRole("navigation", { name: tr(lang, "nav.primary") })
      .getByRole("link", { name: tr(lang, "nav.sub.dashboards"), exact: true })
      .click();
    await s.page.waitForURL("**/dashboards", { timeout: 30000 });
    await s.page.locator("main#main h1").first().waitFor({ timeout: 30000 });
    await s.page.waitForLoadState("networkidle");
    const h1 = norm(await s.page.locator("main#main h1").first().innerText());
    rec(`${lang}.dashboards.opens`, "the Dashboards page opens with an h1", h1, h1.length > 0);
    await shot(s, lang, "dashboards");
  });

  for (const p of PARTIAL) {
    await step(`partial-${p.area}`, async () => {
      const text = await visit(s, p.path);
      const pp = norm(tr(lang, "nav.entry.portfolioPlanned"));
      rec(`${lang}.partial.${p.area}.portfolioPlanned`, "nav.entry.portfolioPlanned verbatim", text.includes(pp) ? "present" : "absent", text.includes(pp));
      const h3 = await s.page.getByRole("heading", { level: 3, name: tr(lang, "nav.willContain"), exact: true }).count();
      rec(`${lang}.partial.${p.area}.covers`, `h3 '${tr(lang, "nav.willContain")}'`, `count=${h3}`, h3 === 1);
      await shot(s, lang, `partial-${p.area}`);
    });
  }
  rec(`${lang}.no-foreign-requests`, "no request outside the app origin", JSON.stringify(s.foreign.slice(0, 3)), s.foreign.length === 0);
  await s.ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`SUMMARY ${results.length - failed.length}/${results.length} PASS${failed.length ? ` FAILED: ${failed.map((f) => f.id).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
