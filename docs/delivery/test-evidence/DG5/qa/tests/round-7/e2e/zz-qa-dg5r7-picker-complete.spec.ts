// T-DG5-REV-QA-R7C: copied from tests/round-7-r7-orphaned/e2e/ (written by this role's run T-DG5-REV-QA-R7, stopped by a container restart), re-read and re-run here; unchanged except where a comment says 'T-DG5-REV-QA-R7C'.
// qa-verifier DG5 round 7 (T-DG5-REV-QA-R7): independent real-stack check of the D-181 picker fix (waves AB2/AB2B) on
// the PRODUCTION-initialized stack (apps/web/e2e/support/with-stack.sh), chromium-en and chromium-ar. NOT part of the
// candidate: copied into a disposable clone's e2e/ for the run only. It does not import the product spec
// p5-transformation-picker-complete.spec.ts, which checks ONE screen (My procedures).
//  R7-PICKER: make sure MORE THAN 100 transformations exist (100 = PAGINATION.maxLimit, the old one-page cap of most
//  pickers; the old launch-plan/health-check picker used 50), then create one more ("newest"). The API's first
//  `updatedAt:desc` page then holds it, but the first `code:asc` page does not (its code sorts last), so the probe also
//  creates an OLDEST-updated check: the transformation that sorts LAST by updatedAt (the first one ever created) must be
//  offered too (a one-page updatedAt:desc picker could not offer it). Every transformation-picking screen I could reach
//  without filling a form is then opened, and the probe counts links `a[href*="/transformations/<id>"]` and options
//  `option[value="<id>"]` for both ids. ASSERTED on every screen in ASSERT; REPORTED for the rest.
//  For the updatedAt:desc link lists it also asserts that the NEWEST transformation is the first entry.
// Everything is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, expectAccessible, langOf, shot, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r7-picker");
const stamp = Date.now().toString(36);

interface TrPage {
  items: { id: string; code: string; updatedAt?: string }[];
  nextCursor: string | null;
}

// [user, url, sort of the screen's picker, kind]
const SCREENS: [string, string, "updatedAt:desc" | "code:asc", "links" | "select"][] = [
  ["dev.lead", "/playbook/launch-plan", "updatedAt:desc", "links"],
  ["dev.lead", "/playbook/health-check", "updatedAt:desc", "links"],
  ["dev.lead", "/evidence-reports/reports", "updatedAt:desc", "links"],
  ["dev.lead", "/evidence-reports/presentation", "updatedAt:desc", "links"],
  ["dev.lead", "/evidence-reports/evidence-register", "updatedAt:desc", "links"],
  ["dev.lead", "/initiatives-roadmaps/updates", "updatedAt:desc", "links"],
  ["dev.lead", "/strategy-kpis/kpis", "updatedAt:desc", "links"],
  ["dev.lead", "/risks-actions/raid", "updatedAt:desc", "links"],
  ["dev.lead", "/dashboards/transformation", "code:asc", "links"],
  ["dev.admin", "/admin/methodology-migrations", "updatedAt:desc", "links"],
];
const ASSERT = new Set(SCREENS.map((s) => s[1]));

test("R7-PICKER: with more than 100 transformations every reachable picker offers the newest and the oldest", async ({ browser, playwright }, info) => {
  test.setTimeout(1_200_000); // T-DG5-REV-QA-R7C: was 600 s
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const listAll = async (sort: string) => {
    const all: TrPage["items"] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ sort, limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const p: TrPage = await lead.call<TrPage>("GET", `/api/v1/transformations?${q.toString()}`);
      all.push(...p.items);
      cursor = p.nextCursor;
    } while (cursor);
    return all;
  };
  const before = await listAll("code:asc");
  for (let i = before.length; i <= 100; i++) {
    await lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 picker filler ${lang} ${stamp} ${i + 1}`, mode: "end_to_end" });
  }
  const newest = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 picker NEWEST ${lang} ${stamp}`, mode: "end_to_end" });
  const byUpdated = await listAll("updatedAt:desc");
  const oldest = byUpdated[byUpdated.length - 1]!;
  const firstCode = await lead.call<TrPage>("GET", "/api/v1/transformations?sort=code:asc&limit=100");
  const firstUpd = await lead.call<TrPage>("GET", "/api/v1/transformations?sort=updatedAt:desc&limit=100");
  const pre = {
    total: byUpdated.length,
    newest: newest.code,
    oldest: oldest.code,
    newestOnFirstCodePage: firstCode.items.some((x) => x.id === newest.id),
    oldestOnFirstUpdatedPage: firstUpd.items.some((x) => x.id === oldest.id),
    firstUpdatedIsNewest: byUpdated[0]?.id === newest.id,
  };
  expect(pre.total).toBeGreaterThan(100);
  expect(pre.newestOnFirstCodePage).toBe(false);
  expect(pre.oldestOnFirstUpdatedPage).toBe(false);

  const sessions = new Map<string, Awaited<ReturnType<typeof asUser>>>();
  const out: Record<string, unknown> = { pre };
  const failures: string[] = [];
  for (const [user, url, sort, kind] of SCREENS) {
    let u = sessions.get(user);
    if (!u) {
      u = await asUser(browser, lang, user);
      sessions.set(user, u);
    }
    const p = u.page;
    await p.goto(url);
    await expect(p.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(500);
    const count = async (id: string) => p.locator(`main#main a[href*="/transformations/${id}"], main#main option[value="${id}"]`).count();
    const n = await count(newest.id);
    const o = await count(oldest.id);
    // T-DG5-REV-QA-R7C (revision 2): bounded; revision 1 waited without limit on a screen with no transformation link
    // (/admin/methodology-migrations) until the test timeout, in both projects (a probe error, not a product result).
    const firstHref = await p.locator(`main#main a[href*="/transformations/"]`).first().getAttribute("href", { timeout: 3_000 }).catch(() => null);
    const alertText = (await p.locator("main#main [role='alert']").allInnerTexts()).join(" | ");
    const r = { user, sort, kind, newest: n, oldest: o, firstHref, alert: alertText };
    out[url] = r;
    if (ASSERT.has(url)) {
      if (n < 1) failures.push(`${url}: newest ${newest.code} not offered`);
      if (o < 1) failures.push(`${url}: oldest-updated ${oldest.code} not offered`);
      if (sort === "updatedAt:desc" && kind === "links" && !(firstHref ?? "").includes(newest.id)) failures.push(`${url}: first entry is not the newest (${firstHref})`);
    }
    await shot(p, lang, `r7-picker-${url.replace(/\//g, "_")}`);
  }
  // axe on one of the long lists (all >100 entries rendered).
  const lu = sessions.get("dev.lead")!;
  await lu.page.goto("/playbook/launch-plan");
  await expect(lu.page.locator(`main#main a[href*="/transformations/${newest.id}"]`).first()).toBeVisible({ timeout: 30_000 });
  await expectAccessible(lu.page, lang, "r7-picker-launch-plan-axe");
  for (const s of sessions.values()) await s.close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r7-picker.json"), JSON.stringify({ failures, out }, null, 1));
  console.info(`R7-PICKER ${lang}: failures=${failures.length} ${JSON.stringify(failures)} ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});

// Added by T-DG5-REV-QA-R7C (revision 3): the two screens revision 2 could not judge.
//  - /dashboards/transformation is a RegisterTable with client paging ("Page 1 of 11 · 10 of 102 rows") and search, so a
//    row on a later page is not on page 1: the follow-up reads the pager's row count and searches the newest code.
//  - /admin/methodology-migrations as dev.admin showed "No transformation is visible to you" (dev.admin holds no
//    transformation-scoped grant): the follow-up opens it as dev.lead and records whether the newest and oldest appear.
// ASSERTED: the dashboard's row count equals the API's total and the search finds the newest; on the migrations entry,
// if dev.lead may open it (an h1, no 403 state), the newest and the oldest-updated are offered and the newest is first.
test("R7-PICKER-FOLLOWUP: the dashboard chooser pages all transformations; the migrations entry as a user who sees them", async ({ browser, playwright }, info) => {
  test.setTimeout(1_200_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const listAll = async (sort: string) => {
    const all: TrPage["items"] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ sort, limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const pg: TrPage = await lead.call<TrPage>("GET", `/api/v1/transformations?${q.toString()}`);
      all.push(...pg.items);
      cursor = pg.nextCursor;
    } while (cursor);
    return all;
  };
  const before = await listAll("code:asc");
  for (let i = before.length; i <= 100; i++) {
    await lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 picker3 filler ${lang} ${stamp} ${i + 1}`, mode: "end_to_end" });
  }
  const newest = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 picker3 NEWEST ${lang} ${stamp}`, mode: "end_to_end" });
  const byUpdated = await listAll("updatedAt:desc");
  const oldest = byUpdated[byUpdated.length - 1]!;
  const u = await asUser(browser, lang, "dev.lead");
  const p = u.page;
  const failures: string[] = [];
  // Dashboard chooser.
  await p.goto("/dashboards/transformation");
  await expect(p.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await p.waitForLoadState("networkidle");
  // T-DG5-REV-QA-R7C (revision 4): wait for the pager line (revision 3 read it once, before it rendered, in one of 4 runs).
  await expect(p.locator("main#main")).toContainText(/(rows|صف)/, { timeout: 30_000 }).catch(() => undefined);
  const pager = (await p.locator("main#main").innerText()).match(/(\d+)\s*(?:of|من)\s*(\d+)\s*(?:rows|صف)/);
  const pagerText = (await p.locator("main#main").innerText()).split("\n").filter((l) => /\d+/.test(l) && /(rows|صف|Page|صفحة)/.test(l)).slice(0, 3);
  await p.locator("main#main input[type='search'], main#main input").first().fill(newest.code);
  await p.waitForTimeout(800);
  const dashNewest = await p.locator(`main#main a[href*="/transformations/${newest.id}"]`).count();
  await shot(p, lang, "r7-picker3-dashboard-search-newest");
  if (dashNewest < 1) failures.push(`/dashboards/transformation: search for ${newest.code} finds no row`);
  const total = byUpdated.length;
  const pagerTotal = pager ? Number(pager[2]) : null;
  if (pagerTotal !== total) failures.push(`/dashboards/transformation: pager total ${pagerTotal} (text ${JSON.stringify(pagerText)}) != API total ${total}`);
  // Migrations entry as dev.lead.
  await p.goto("/admin/methodology-migrations");
  await expect(p.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(500);
  const migText = (await p.locator("main#main").innerText()).slice(0, 300);
  const migNewest = await p.locator(`main#main a[href*="/transformations/${newest.id}"]`).count();
  const migOldest = await p.locator(`main#main a[href*="/transformations/${oldest.id}"]`).count();
  const migFirst = await p.locator(`main#main a[href*="/transformations/"]`).first().getAttribute("href", { timeout: 3_000 }).catch(() => null);
  await shot(p, lang, "r7-picker3-migrations-dev-lead");
  const migOpen = migNewest + migOldest > 0 || (await p.locator(`main#main a[href*="/transformations/"]`).count()) > 0;
  if (migOpen) {
    if (migNewest < 1) failures.push(`/admin/methodology-migrations (dev.lead): newest not offered`);
    if (migOldest < 1) failures.push(`/admin/methodology-migrations (dev.lead): oldest-updated not offered`);
    if (!(migFirst ?? "").includes(newest.id)) failures.push(`/admin/methodology-migrations (dev.lead): first entry ${migFirst} is not the newest`);
  }
  await u.close();
  const out = { total, newest: newest.code, oldest: oldest.code, pagerTotal, pagerText, dashNewest, migOpen, migNewest, migOldest, migFirst, migText };
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r7-picker3.json"), JSON.stringify({ failures, out }, null, 1));
  console.info(`R7-PICKER-FOLLOWUP ${lang}: failures=${failures.length} ${JSON.stringify(failures)} ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});
