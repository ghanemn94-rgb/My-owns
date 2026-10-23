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
  test.setTimeout(600_000);
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
    const firstHref = await p.locator(`main#main a[href*="/transformations/"]`).first().getAttribute("href").catch(() => null);
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
