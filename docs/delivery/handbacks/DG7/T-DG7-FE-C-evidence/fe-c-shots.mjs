// T-DG7-FE-C visual and interaction evidence: Administration > Requirement register and About this release, in English
// LTR and Arabic RTL, on the real stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, SYNTHETIC dev users,
// the API serving apps/web/dist and reading apps/api/dist/release/register-snapshot.json).
// Signs in as the synthetic dev.admin (ADM_TECH holds operations.read).
//  Phase 1 (snapshot moved aside before the API has loaded it): both screens show the Unavailable state, never empty.
//  Phase 2 (snapshot restored, same API process): the register lists the real 412 rows; filters go to the URL and the
//  request; the detail panel opens by keyboard and gets focus; About shows the counts, unfinished items and Unknown
//  for the dependency list this build did not include. Also: axe (WCAG 2.0/2.1 A+AA), a 360 px viewport, no request
//  that leaves the origin, no write request.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.env.REPO_ROOT;
const require = createRequire(join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT;
const SNAP = join(ROOT, "apps/api/dist/release/register-snapshot.json");
const SNAP_ASIDE = `${SNAP}.fe-c-aside`;
const cat = (lang, ns) => require(join(ROOT, "apps/web/src/i18n", lang, `${ns}.json`));
const snapshot = require(SNAP);
const summary = { base: BASE, user: "dev.admin (SYNTHETIC)", snapshotRows: snapshot.rowCount, results: [] };
let failures = 0;
const record = (entry) => {
  if (!entry.ok) failures++;
  summary.results.push(entry);
};

const browser = await chromium.launch();
async function session(lang, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const foreign = [];
  const writes = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
    if (r.method() !== "GET" && /\/api\/v1\/admin\/(requirements|about)/.test(u)) writes.push(`${r.method()} ${u}`);
  });
  await page.goto(`${BASE}/login`);
  const field = page.getByLabel(/^(Synthetic user name|اسم المستخدم الاصطناعي)/);
  await field.fill("dev.admin");
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await page.locator("main#main h1").waitFor();
  if ((await page.locator("html").getAttribute("lang")) !== lang) {
    const other = lang === "en" ? "ar" : "en";
    const names = { en: "English", ar: "العربية" };
    const label = cat(other, "common").language.switchTo.replace("{{language}}", names[lang]);
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  }
  return { context, page, foreign, writes };
}
async function check(s, lang, name, expectedH1, extraFn = async () => ({})) {
  const { page } = s;
  const found = await page
    .locator("main#main h1", { hasText: expectedH1 })
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  await page.waitForLoadState("networkidle");
  const extra = await extraFn();
  const dir = await page.locator("html").getAttribute("dir");
  const htmlLang = await page.locator("html").getAttribute("lang");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  mkdirSync(join(OUT, lang), { recursive: true });
  await page.screenshot({ path: join(OUT, lang, `${name}.png`), fullPage: true });
  const ok =
    found &&
    dir === (lang === "ar" ? "rtl" : "ltr") &&
    htmlLang === lang &&
    axe.violations.length === 0 &&
    (extra.ok ?? true);
  record({
    lang,
    name,
    url: page.url().replace(BASE, ""),
    heading: found ? expectedH1 : (await page.locator("main#main h1").first().textContent())?.trim(),
    dir,
    htmlLang,
    axeViolations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    ...extra,
    ok,
  });
}

// ------------------------------------------------------------------------------------------- phase 1: no snapshot
renameSync(SNAP, SNAP_ASIDE);
try {
  for (const lang of ["en", "ar"]) {
    const rel = cat(lang, "release");
    const s = await session(lang);
    await s.page.goto(`${BASE}/admin/requirements`);
    await check(s, lang, "requirements-unavailable", rel.register.title, async () => {
      const state = s.page.locator("[data-state='register-unavailable']");
      await state.waitFor({ timeout: 20000 }).catch(() => {});
      const shown = await state.count();
      const emptyShown = await s.page.getByText(rel.register.empty).count();
      const text = shown ? await state.textContent() : null;
      return { unavailableShown: shown, emptyTextShown: emptyShown, ok: shown === 1 && emptyShown === 0 && text.includes(rel.register.unavailable) };
    });
    await s.page.goto(`${BASE}/admin/about`);
    await check(s, lang, "about-unavailable", rel.about.title, async () => {
      await s.page.locator("#release-versions").waitFor({ timeout: 15000 });
      const unavailable = await s.page.locator("[data-chip='unavailable'], .status-chip", { hasText: rel.about.unavailable }).count();
      const unknown = await s.page.getByText(rel.about.unknown).count();
      const counts = await s.page.locator("[data-count]").count();
      const none = await s.page.getByText(rel.about.openItems.none).count();
      return { unavailableChips: unavailable, unknownLines: unknown, countsRendered: counts, noneTextShown: none, ok: unavailable >= 4 && unknown === 1 && counts === 0 && none === 0 };
    });
    record({ lang, name: "phase1-origin-and-writes", foreign: s.foreign, writes: s.writes, ok: s.foreign.length === 0 && s.writes.length === 0 });
    await s.context.close();
  }
} finally {
  if (existsSync(SNAP_ASIDE)) renameSync(SNAP_ASIDE, SNAP);
}

// ------------------------------------------------------------------------- phase 2: snapshot restored, no restart
for (const lang of ["en", "ar"]) {
  const rel = cat(lang, "release");
  const s = await session(lang);
  const { page } = s;
  await page.goto(`${BASE}/admin/requirements`);
  await check(s, lang, "requirements", rel.register.title, async () => {
    await page.locator("[data-register='p7-requirements'] tbody tr").first().waitFor({ timeout: 20000 });
    const line = await page.locator("[data-state='snapshot']").textContent();
    const rows = await page.locator("[data-register='p7-requirements'] tbody tr").count();
    const ltr = await page.locator("[data-register='p7-requirements'] [data-register-text]").first().evaluate((e) => [e.dir, e.lang]);
    return {
      snapshotLine: line,
      rowsOnPage: rows,
      firstTitleDirLang: ltr,
      ok: line.includes(snapshot.sourceSha256.slice(0, 12)) && rows > 0 && ltr[0] === "ltr" && ltr[1] === "en",
    };
  });
  // Filter by status through the select: the URL and the request carry it; every row shows that status.
  const reqs = [];
  const onReq = (r) => r.url().includes("/api/v1/admin/requirements?") && reqs.push(r.url());
  page.on("request", onReq);
  const filtered = page.waitForRequest((r) => new URL(r.url()).searchParams.get("status") === "BLOCKED", { timeout: 15000 });
  await page.getByLabel(rel.register.filter.status, { exact: true }).selectOption("BLOCKED");
  await filtered.catch(() => {});
  // The result has rendered: rows, or the empty text (never neither).
  await page
    .locator("[data-register='p7-requirements'] tbody tr")
    .or(page.getByText(rel.register.empty))
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  await check(s, lang, "requirements-filter-blocked", rel.register.title, async () => {
    const url = page.url();
    const rows = page.locator("[data-register='p7-requirements'] tbody tr");
    const empty = await page.getByText(rel.register.empty).count();
    const n = await rows.count();
    const statuses = n ? await rows.locator("td, th").filter({ hasText: rel.status.BLOCKED }).count() : 0;
    const sent = reqs.some((u) => new URL(u).searchParams.get("status") === "BLOCKED");
    return {
      url: url.replace(BASE, ""),
      requestCarriesStatus: sent,
      rows: n,
      emptyTextShown: empty,
      rowsWithBlockedLabel: statuses,
      ok: url.includes("status=BLOCKED") && sent && (empty === 1 || statuses >= n),
    };
  });
  page.off("request", onReq);
  await page.getByLabel(rel.register.filter.status, { exact: true }).selectOption("");
  await page.waitForLoadState("networkidle");
  // Keyboard: Tab from the class filter into the table until a requirement link is focused, then Enter.
  await page.locator("[data-register='p7-requirements'] tbody tr").first().waitFor();
  await page.getByLabel(rel.register.filter.class, { exact: true }).focus();
  let reached = null;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const a = document.activeElement;
      return a && a.tagName === "A" && a.closest("[data-register='p7-requirements']") ? a.getAttribute("href") : null;
    });
  }
  const outline = reached
    ? await page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement);
        return `${cs.outlineStyle} ${cs.outlineWidth}`;
      })
    : null;
  if (reached) await page.keyboard.press("Enter");
  await check(s, lang, "requirement-detail", rel.register.title, async () => {
    await page.locator("[data-requirement]").waitFor({ timeout: 15000 }).catch(() => {});
    const focused = await page.evaluate(() => document.activeElement?.id ?? null);
    const fields = await page.locator("[data-requirement] [data-field]").count();
    const notesDir = await page
      .locator("[data-requirement] [data-field='notes'] [data-register-text], [data-requirement] [data-field='notes'] .muted")
      .first()
      .evaluate((e) => e.getAttribute("dir") ?? "empty-field");
    return { keyboardReachedLink: reached, focusOutline: outline, focusedAfterOpen: focused, detailFields: fields, notesDir, ok: Boolean(reached) && focused === "requirement-detail-title" && fields === 13 };
  });
  // About.
  await page.goto(`${BASE}/admin/about`);
  await check(s, lang, "about", rel.about.title, async () => {
    await page.locator("[data-p7-counts]").waitFor({ timeout: 15000 });
    const total = await page.locator("[data-p7-counts] tfoot [data-count]").getAttribute("data-count");
    const open = await page.locator("#release-open-items").getAttribute("id");
    const openRows = await page.locator("[data-register='p7-open-items'] tbody tr").count().catch(() => 0);
    const deps = await page.locator("#release-external-dependencies").textContent();
    const green = await page.locator(".status-chip--on-track").count();
    return {
      totalCount: total,
      openItemsRowsOnFirstPage: openRows,
      externalDependencies: deps.includes(rel.about.unknown) ? "Unknown shown" : deps.slice(0, 120),
      successColourChips: green,
      ok: total === String(snapshot.rowCount) && open && green === 0 && (snapshot.externalDependencies !== null || deps.includes(rel.about.unknown)),
    };
  });
  record({ lang, name: "phase2-origin-and-writes", foreign: s.foreign, writes: s.writes, ok: s.foreign.length === 0 && s.writes.length === 0 });
  await s.context.close();
  // 360 px.
  const m = await session(lang, 360);
  await m.page.goto(`${BASE}/admin/requirements`);
  await check(m, lang, "requirements-360", rel.register.title, async () => {
    await m.page.locator("[data-register='p7-requirements'] tbody tr").first().waitFor({ timeout: 20000 });
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { pageHorizontalOverflowPx: overflow, ok: overflow <= 1 };
  });
  await m.page.goto(`${BASE}/admin/about`);
  await check(m, lang, "about-360", rel.about.title, async () => {
    await m.page.locator("[data-p7-counts]").waitFor({ timeout: 15000 });
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { pageHorizontalOverflowPx: overflow, ok: overflow <= 1 };
  });
  await m.context.close();
}

await browser.close();
summary.failures = failures;
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`${summary.results.length} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
