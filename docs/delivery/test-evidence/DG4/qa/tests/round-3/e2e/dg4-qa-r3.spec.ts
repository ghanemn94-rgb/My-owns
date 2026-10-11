// qa-verifier DG4 round 3 (T-DG4-REV-QA-R3; the round-2 sweep, plus R3 below): an independent sweep of the P4 screens on the REAL stack
// (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations 0001..0061, seed-dev, built API serving the built SPA;
// no mocks). This file lives OUTSIDE the frozen candidate (docs/delivery/test-evidence/DG4/qa/tests/round-3/e2e/); it is
// copied into a disposable clone's e2e/ only to run, and removed afterwards.
//
// For every P4 route of apps/web/src/app/router.tsx that needs no record id (plus the seeded forum's detail page and
// the G5/G6 gate pages), in the project's language (chromium-en English LTR, chromium-ar Arabic RTL):
//   S1 the read-only auditor (dev.auditor, AUD): the page renders (main h1), <html lang dir> match the language,
//      axe (wcag2a/aa, 21a/aa) reports 0 serious or critical issues, and the auditor's browsing sends no write request
//      (only GET/HEAD to /api, apart from the sign-in and the language preference before tracking starts); the enabled
//      buttons are recorded for review.
//   S2 390 px wide: no page-level horizontal scroll (documentElement.scrollWidth - innerWidth <= 1), as AUD and as
//      the transformation lead (dev.lead).
//   S3 200 % text (root font-size 200 %, 1280 px wide): no page-level horizontal scroll, as AUD and as dev.lead.
// Every check is recorded (id, requirement, pass, detail) in $QA_RESULTS_DIR/dg4-qa-r3-checks-<lang>.json so that one
// failing check never hides the others; the final test fails the run if any recorded check failed.
//
// R3 (round 3, F-DG4-122/123 as acceptance behaviour from the read-only auditor's side): the sweep's transformation
//   gets four financial benefits planned 2026-01..06 (revenue uplift 300, margin uplift 70, cash saving 20, avoided
//   cost 45 SAR; nothing validated) BEFORE the sweep, so every value surface is swept with the value headlines present.
//   As AUD, on T10, the Executive Overview, the Finance dashboard and the workspace header: the profit-and-cash planned
//   headline is 90 and labelled with its basis, top line 300 and non-cash 45 sit beside it (never summed: 435 nowhere),
//   the gap reads exactly "100 %" and never a money amount, and each surface has no page-level horizontal scroll at
//   390 px and at 200 % text. All recorded as checks.
// Everything is SYNTHETIC; no product gate (G1-G6) is decided, and none implies an engineering gate (DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL, tr, type ApiSession, type Lang } from "../apps/web/e2e/support/ui.ts";
import { syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";

test.describe.configure({ mode: "serial" });

const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");

interface Check {
  id: string;
  req: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(id: string, req: string, pass: boolean, detail: unknown): void {
  const d = typeof detail === "string" ? detail : String(JSON.stringify(detail) ?? "undefined");
  checks.push({ id, req, pass, detail: d.slice(0, 1500) });
  if (!pass) console.log(`QA-CHECK-FAIL ${id} [${req}] ${d.slice(0, 600)}`);
}

test.afterAll(async ({}, info) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `dg4-qa-r3-checks-${langOf(info)}.json`), `${JSON.stringify(checks, null, 2)}\n`);
});

let tid = "";
let forumId = "";
let lead: ApiSession;
const stamp = Date.now().toString(36);

const T_ROUTES = [
  "role-mappings",
  "decision-rights",
  "raci",
  "transform-readiness",
  "approval-decisions",
  "kpis",
  "kpi-review",
  "data-quality",
  "benefits",
  "benefit-groups",
  "benefit-overlaps",
  "benefit-scenarios",
  "benefit-valuation-methods",
  "raid",
  "raid-decision-log",
  "actions",
  "corrective-actions",
  "corrective-action-rules",
  "forums",
  "meetings",
  "executive-decisions",
  "escalations",
  "adoption",
  "adoption-interventions",
  "adoption-indicators",
  "adoption-training",
  "assessment-forms",
  "bau",
  "bau-handovers",
  "bau-controls",
  "bau-reviews",
  "improvement",
  "lessons",
  "dashboard",
  "traceability",
  "modular-entry",
  "workstreams",
  "closure",
  "change-requests",
  "phases",
  "finance-validations",
  "gates/G5",
  "gates/G6",
];
const G_ROUTES = [
  "/my-work",
  "/my-work/approvals",
  "/my-work/delegations",
  "/admin/calendar",
  "/admin/jobs",
  "/governance/groups",
  "/lessons",
  "/executive-overview",
  "/dashboards",
  "/dashboards/finance",
  "/dashboards/adoption",
  "/dashboards/personal",
  "/portfolios",
  "/dashboards/rag-policy",
  "/finance-validation",
];
function routes(): [string, string][] {
  const r: [string, string][] = T_ROUTES.map((p) => [`t/${p}`, `/transformations/${tid}/${p}`]);
  if (forumId) r.push(["t/forums/:forumId", `/transformations/${tid}/forums/${forumId}`]);
  for (const g of G_ROUTES) r.push([g, g]);
  return r;
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA DG4 R3 sweep ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tid = t.id;
  const forums = await lead.req.get(`/api/v1/transformations/${tid}/forums`);
  if (forums.ok()) {
    const body = (await forums.json()) as { items?: { id: string }[] };
    forumId = body.items?.[0]?.id ?? "";
  }
  check("setup-forums-seeded", "REQ-PB-060", forumId !== "", { status: forums.status(), forumId });
  // R3 world: four financial benefits planned in SAR through a synthetic Benefit Owner (API, as the product's spec does).
  const admin = await apiSession(playwright, "dev.admin");
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const bo = await syntheticUser(admin, orgId, tid, `dev.qar3.bo.${lang}.${stamp}`, `Synthetic QA R3 BO ${lang}`, "BO", lang);
  const boApi = await apiSession(playwright, bo.username);
  for (const [valueClass, benefitType, line, amount] of [
    ["revenue_uplift", "revenue", "Revenue - roaming", "300"],
    ["margin_uplift", "revenue", "Gross margin - roaming", "70"],
    ["cash_saving", "cost", "Opex - care", "20"],
    ["avoided_cost", "cost", "Opex - network", "45"],
  ] as const) {
    const b = await boApi.call<{ id: string }>("POST", `/api/v1/transformations/${tid}/benefits`, {
      title: `Synthetic QA R3 ${valueClass} ${lang} ${stamp}`,
      description: "Synthetic QA R3 benefit.",
      benefitType,
      valueClass,
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: line,
    });
    await boApi.call("POST", `/api/v1/transformations/${tid}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
      amount,
    });
  }
});

test("R3 AUD sees the value headlines on one basis and the gap as a percentage, at 1280 px, 390 px and 200 % text", async ({
  page,
}, info) => {
  test.setTimeout(10 * 60_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  const label = (k: string) => tr(lang, `dashboards.headline.dashboard__headline__value_${k}`);
  const surfaces: [string, string, string, boolean][] = [
    ["t10", `/transformations/${tid}/dashboard`, "section[data-area='value']", true],
    ["overview", `/executive-overview?tr=${tid}`, "section[data-area='value']", true],
    ["finance", `/dashboards/finance?tr=${tid}`, "#finance-headlines", true],
    ["header", `/transformations/${tid}`, "[data-element='benefits']", false],
  ];
  for (const [name, url, scope, withGap] of surfaces) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    const o = await open(page, url);
    check(`R3-${name}-renders`, "F-DG4-123", o.status === "ok", o);
    if (o.status !== "ok") continue;
    const pc = page.locator(`${scope} [data-headlines] [data-metric='value.planned'][data-headline-basis='profit_and_cash']`);
    const beside = page.locator(`${scope} [data-headlines-beside][data-not-summed='true']`);
    const top = beside.locator("[data-metric='value.planned'][data-headline-basis='top_line']");
    const nonCash = beside.locator("[data-metric='value.planned'][data-headline-basis='non_cash']");
    await pc.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const val = async (l: typeof pc) => ((await l.count()) === 1 ? await l.locator("[data-value]").first().getAttribute("data-value") : `count=${await l.count()}`);
    const txt = async (l: typeof pc) => ((await l.count()) === 1 ? (await l.innerText()).replace(/\s+/g, " ") : "");
    const [pv, tv, nv] = [await val(pc), await val(top), await val(nonCash)];
    check(`R3-${name}-pc-90`, "F-DG4-123", /^90(\.0+)?$/.test(pv ?? ""), pv);
    check(`R3-${name}-top-300`, "F-DG4-123", /^300(\.0+)?$/.test(tv ?? ""), tv);
    check(`R3-${name}-noncash-45`, "F-DG4-123", /^45(\.0+)?$/.test(nv ?? ""), nv);
    const [pt, tt, nt] = [await txt(pc), await txt(top), await txt(nonCash)];
    check(`R3-${name}-labels`, "F-DG4-123", pt.includes(label("planned_profit_and_cash")) && tt.includes(label("planned_top_line")) && nt.includes(label("planned_non_cash")), { pt, tt, nt });
    const all = await page.locator(scope).innerText();
    check(`R3-${name}-435-nowhere`, "F-DG4-123", !/435/.test(all), all.slice(0, 400));
    if (withGap) {
      const gap = page.locator(`${scope} [data-metric='value.gap']`).first();
      const amount = (await gap.locator("[data-value-state='value'] .amount").count()) > 0 ? (await gap.locator("[data-value-state='value'] .amount").first().innerText()).trim() : "";
      const gt = (await gap.innerText()).replace(/\s+/g, " ");
      const money = lang === "ar" ? /ر\.س|1\.00|SAR/ : /SAR|1\.00|ر\.س/;
      check(`R3-${name}-gap-percent`, "F-DG4-122", amount === "100 %" && !money.test(gt), { amount, gt });
    }
    const serious = await axe(page);
    check(`R3-${name}-axe`, "A20-ux", serious.length === 0, serious);
    await shotTo(page, lang, `R3-aud-${name}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(200);
    const o200 = await overflow(page);
    check(`R3-${name}-200pct`, "A20-ux", o200 <= 1, { overflowPx: o200 });
    await shotTo(page, lang, `R3-aud-${name}-200pct`);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 390, height: 844 });
    const o390 = await open(page, url);
    const ov = o390.status === "ok" ? await overflow(page) : -1;
    check(`R3-${name}-390px`, "A20-ux", o390.status === "ok" && ov <= 1, { ...o390, overflowPx: ov });
    await shotTo(page, lang, `R3-aud-${name}-390px`);
  }
});

// Revision 2 (after the first locale-unset run): (a) a page the signed-in role may not read renders the product's
// no-permission state (role="alert", data-state="no-permission", no h1; e.g. /admin/jobs needs job.read, which only
// ADM_TECH holds, migration 0031). That is a valid, by-design render: it is recorded as status "no-permission" and still
// gets the lang/dir, axe and overflow checks. (b) The networkidle wait is bounded (10 s): a page that keeps polling never
// reaches networkidle, and the unbounded wait of revision 1 stalled the lead sweep until the 30-minute test timeout.
// Revision 3: goto and textContent are bounded too. In the first run the lead's /admin/calendar showed an h1 and then
// replaced it with the "Not found" state (the lead may not read the organization calendar); the unbounded
// textContent(h1) of revision 1 then waited until the test timeout.
async function open(page: Page, url: string): Promise<{ h1: string; status: string }> {
  await page.goto(url, { timeout: 30_000 });
  const h1 = page.locator("main#main h1").first();
  const denied = page.locator("main#main [data-state='no-permission']").first();
  try {
    await expect(h1.or(denied)).toBeVisible({ timeout: 20_000 });
  } catch {
    return { h1: "", status: "no-h1" };
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  if (await denied.isVisible()) return { h1: "", status: "no-permission" };
  const text = await h1.textContent({ timeout: 5_000 }).catch(() => null);
  if (text === null) return { h1: "", status: (await denied.isVisible()) ? "no-permission" : "no-h1" };
  return { h1: text.trim(), status: "ok" };
}
const rendered = (o: { status: string }) => o.status === "ok" || o.status === "no-permission";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}:${v.nodes.map((n) => n.target.join(" ")).join(",")}`);
}

function dirOk(lang: Lang, d: [string, string]): boolean {
  return lang === "ar" ? d[0] === "rtl" && d[1].startsWith("ar") : d[0] !== "rtl" && d[1].startsWith("en");
}

test("S1+S2+S3 the read-only auditor on every P4 screen: renders, lang/dir, axe, no writes; 390 px; 200 % text", async ({
  page,
}, info) => {
  test.setTimeout(30 * 60_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  const writes: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !u.includes("/auth/"))
      writes.push(`${r.method()} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
  });
  for (const [name, url] of routes()) {
    await page.setViewportSize({ width: 1280, height: 720 });
    const o = await open(page, url);
    check(`S1-${name}-renders`, "P4-screens", (o.status === "ok" && o.h1.length > 0) || o.status === "no-permission", o);
    if (!rendered(o)) continue;
    const d = (await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang])) as [
      string,
      string,
    ];
    check(`S1-${name}-lang-dir`, "A20-ux", dirOk(lang, d), d);
    const serious = await axe(page);
    check(`S1-${name}-axe`, "A20-ux", serious.length === 0, serious);
    const enabled = await page
      .locator("main button:not([disabled]):not([aria-disabled='true'])")
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).filter((t) => t.length > 0));
    checks.push({ id: `S1-${name}-aud-enabled-buttons`, req: "info", pass: true, detail: JSON.stringify(enabled) });
    // 200 % text at 1280 px
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(150);
    const o200 = await overflow(page);
    check(`S3-aud-${name}-200pct`, "A20-ux", o200 <= 1, { overflowPx: o200 });
    if (o200 > 1) await shotTo(page, lang, `S3-aud-${name.replace(/[/:]/g, "_")}`);
    // 390 px
    await page.setViewportSize({ width: 390, height: 844 });
    const o390 = await open(page, url);
    const ov = rendered(o390) ? await overflow(page) : -1;
    check(`S2-aud-${name}-390px`, "A20-ux", rendered(o390) && ov <= 1, { ...o390, overflowPx: ov });
    if (ov > 1) await shotTo(page, lang, `S2-aud-${name.replace(/[/:]/g, "_")}`);
  }
  check("S1-aud-sends-no-writes", "AUD-read-only", writes.length === 0, writes);
});

async function shotTo(page: Page, lang: Lang, name: string) {
  mkdirSync(join(OUT, "screens", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "screens", lang, `${name}.png`), fullPage: true });
}

test("S2+S3 the transformation lead on every P4 screen: 390 px and 200 % text have no page-level horizontal scroll", async ({
  page,
}, info) => {
  test.setTimeout(30 * 60_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  for (const [name, url] of routes()) {
    await page.setViewportSize({ width: 390, height: 844 });
    const o = await open(page, url);
    const ov = rendered(o) ? await overflow(page) : -1;
    check(`S2-lead-${name}-390px`, "A20-ux", rendered(o) && ov <= 1, { ...o, overflowPx: ov });
    if (ov > 1) await shotTo(page, lang, `S2-lead-${name.replace(/[/:]/g, "_")}`);
    if (!rendered(o)) continue;
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(150);
    const o200 = await overflow(page);
    check(`S3-lead-${name}-200pct`, "A20-ux", o200 <= 1, { overflowPx: o200 });
    if (o200 > 1) await shotTo(page, lang, `S3-lead-${name.replace(/[/:]/g, "_")}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  }
});

test("Z every recorded check passed", async () => {
  const failed = checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id} [${c.req}] ${c.detail.slice(0, 300)}`)).toEqual([]);
});
