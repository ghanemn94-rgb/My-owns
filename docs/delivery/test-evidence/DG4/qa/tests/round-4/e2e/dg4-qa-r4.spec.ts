// qa-verifier DG4 round 4 (T-DG4-REV-QA-R4; the round-2/3 sweep, plus R4 below): an independent sweep of the P4 screens on the
// REAL stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations 0001..0061, seed-dev, built API serving the built
// SPA; no mocks, no request interception). This file lives OUTSIDE the frozen candidate
// (docs/delivery/test-evidence/DG4/qa/tests/round-4/e2e/); it is copied into a disposable clone's e2e/ only to run, and
// removed afterwards.
//
// S1-S3 (unchanged from round 3): for every P4 route that needs no record id (plus the seeded forum and the G5/G6 gate
//   pages), in the project's language: S1 the read-only auditor (dev.auditor) - renders, lang/dir, axe (wcag2a/aa,
//   21a/aa) 0 serious/critical, no write request; S2 390 px and S3 200 % text without page-level horizontal scroll, as
//   AUD and as the lead.
// R4 (round 4, the round-3 repairs as acceptance behaviour on the integrated stack, as the read-only auditor):
//   world, through the API as the product's own specs do: SAR margin uplift 70, SAR revenue uplift 300 and USD revenue
//   uplift 11 planned 2026-01..06; SAR avoided cost 45 planned only in 2099 (nothing due on the non-cash basis);
//   nothing validated. Three COMPLETED initiatives are a DB fixture (one INSERT each, as the candidate's own
//   integration fixture insertInitiative does: no API puts an initiative in `completed` without the P3 portfolio
//   workflow); the allocations go through the API: INI-1 <- margin 70 + revenue 300, INI-2 <- avoided cost 45, INI-3
//   nothing. An outcome and a KPI with no actual are created through the API (D-124 item 1).
//   R4-a T10 Value: one RAG line per basis and currency (SAR p&c red 100 %, SAR top line red 100 %, SAR non-cash n/a,
//        USD top line red 100 %), the area Red; a not_applicable line is shown as Not applicable, never as Unknown,
//        never 0 and never green (ADR-0037 N4 item 4, REQ-S13-003 "distinguish zero, unknown and not applicable").
//   R4-b T10 Portfolio: the value column names the profit-and-cash basis; INI-1 is 70 (never 370), INI-2 n/a with its
//        reason, INI-3 Unknown; INI-1 ranks first.
//   R4-c drill-downs: the USD top-line planned headline drills to USD 11 (currency shown, no SAR item); the SAR
//        profit-and-cash planned headline drills to SAR 70 (currency shown); the gap reads '100 %'.
//   R4-d T10 Outcomes: the outcome created through the API is listed, its KPI Unknown (no actual), never 0 or green.
//   R4-e the Executive Overview shows the same RAG lines for the transformation. All at 1280 px, axe, 390 px, 200 %.
// Every check is recorded (id, requirement, pass, detail) in $QA_RESULTS_DIR/dg4-qa-r4-checks-<lang>.json; the final
// test fails the run if any recorded check failed. Everything is SYNTHETIC; no product gate (G1-G6) is decided, and
// none implies an engineering gate (DG0-DG7).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  writeFileSync(join(OUT, `dg4-qa-r4-checks-${langOf(info)}.json`), `${JSON.stringify(checks, null, 2)}\n`);
});

let tid = "";
let forumId = "";
let lead: ApiSession;
const stamp = Date.now().toString(36);
const ini: string[] = [];
let outcomeKpiId = "";

/** One SQL statement as the schema owner of the e2e database (qa-stack.sh exports DATABASE_OWNER_URL). */
function sql(statement: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("DATABASE_OWNER_URL not set (run under e2e/support/qa-stack.sh)");
  // Revision 2 (try 1): psql does not decode the URL's '+' in `options=-c+role=...`; connect without it and SET ROLE.
  const u = new URL(url);
  u.searchParams.delete("options");
  return execFileSync("psql", [u.toString(), "-v", "ON_ERROR_STOP=1", "-qAtc", `SET ROLE mth_owner; ${statement}`], {
    encoding: "utf8",
  }).trim();
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA DG4 R4 sweep ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tid = t.id;
  const T = `/api/v1/transformations/${tid}`;
  const forums = await lead.req.get(`${T}/forums`);
  if (forums.ok()) {
    const body = (await forums.json()) as { items?: { id: string }[] };
    forumId = body.items?.[0]?.id ?? "";
  }
  check("setup-forums-seeded", "REQ-PB-060", forumId !== "", { status: forums.status(), forumId });
  const admin = await apiSession(playwright, "dev.admin");
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const bo = await syntheticUser(admin, orgId, tid, `dev.qar4.bo.${lang}.${stamp}`, `Synthetic QA R4 BO ${lang}`, "BO", lang);
  const boApi = await apiSession(playwright, bo.username);
  // Three completed initiatives (DB fixture, see the header).
  for (let n = 1; n <= 3; n++) {
    const id = randomUUID();
    // Revision 3 (try 2): the database requires the audit event of the insert in the same transaction (ADR-0004,
    // p2_audit_required), as the candidate's insertInitiative fixture writes it.
    sql(
      `BEGIN; INSERT INTO initiative (id, organization_id, transformation_id, code, name, status, launched_at, launched_by, created_by, updated_by)
       VALUES ('${id}', '${orgId}', '${tid}', 'INI-9${n}0', 'Synthetic QA R4 initiative ${n}', 'completed', now(), '${lead.userId}', '${lead.userId}', '${lead.userId}');
       INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, record_id, new_version, request_id, source)
       VALUES ('${randomUUID()}', '${orgId}', '${tid}', 'user', '${lead.userId}', 'initiative.create', 'initiative', '${id}', 1, 'qa-r4-fixture-${id}', 'api'); COMMIT;`,
    );
    ini.push(id);
  }
  const ids: Record<string, string> = {};
  for (const [key, valueClass, benefitType, line, currency, amount, start, end] of [
    ["margin", "margin_uplift", "revenue", "Gross margin - roaming", "SAR", "70", "2026-01-01", "2026-06-30"],
    ["revenue", "revenue_uplift", "revenue", "Revenue - roaming", "SAR", "300", "2026-01-01", "2026-06-30"],
    ["revenueUsd", "revenue_uplift", "revenue", "Revenue - roaming", "USD", "11", "2026-01-01", "2026-06-30"],
    ["avoided", "avoided_cost", "cost", "Opex - network", "SAR", "45", "2099-01-01", "2099-06-30"],
  ] as const) {
    const b = await boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic QA R4 ${key} ${lang} ${stamp}`,
      description: "Synthetic QA R4 benefit.",
      benefitType,
      valueClass,
      ownerUserId: bo.id,
      currency,
      financialStatementLine: line,
    });
    await boApi.call("POST", `${T}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: start,
      periodEnd: end,
      amount,
    });
    ids[key] = b.id;
  }
  for (const [key, initiativeId] of [
    ["margin", ini[0]],
    ["revenue", ini[0]],
    ["avoided", ini[1]],
  ] as const) {
    const cur = await lead.call<{ version: number }>("GET", `${T}/benefits/${ids[key]}`);
    await lead.call("PUT", `${T}/benefits/${ids[key]}/allocations`, { allocations: [{ initiativeId, share: "1" }] }, {
      ifMatch: cur.version,
    });
  }
  // D-124 item 1: an outcome and an active KPI linked to it, through the API; no actual (Unknown).
  const outcome = await lead.call<{ id: string }>("POST", `${T}/outcomes`, {
    statement: `Synthetic QA R4: fewer repeat care contacts (${lang} ${stamp}).`,
  });
  const def = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: `Synthetic QA R4 KPI ${lang} ${stamp}`,
    unitKind: "percentage",
    polarity: "lower_is_better",
    frequency: "quarterly",
    ownerUserId: lead.userId,
  });
  await lead.call("POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, { ifMatch: def.version });
  outcomeKpiId = (
    await lead.call<{ id: string }>("POST", `${T}/outcome-kpis`, {
      outcomeId: outcome.id,
      kpiDefinitionId: def.id,
      targetDate: "2099-12-31",
    })
  ).id;
});

const stateText = (lang: Lang, s: string) => tr(lang, `dashboards.state.${s}`);
const flat = async (l: Locator) => ((await l.count()) > 0 ? (await l.first().innerText()).replace(/\s+/g, " ").trim() : "");

test("R4 AUD: per-basis Value RAG lines, Portfolio on its basis, currency-exact drill-downs, API outcomes (T10 and Overview)", async ({
  page,
}, info) => {
  test.setTimeout(10 * 60_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  // ---- R4-a / R4-b / R4-d on T10, R4-e on the Overview
  for (const [name, url] of [
    ["t10", `/transformations/${tid}/dashboard`],
    ["overview", `/executive-overview?tr=${tid}`],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    const o = await open(page, url);
    check(`R4-${name}-renders`, "F-DG4-126", o.status === "ok", o);
    if (o.status !== "ok") continue;
    const value = page.locator("section[data-area='value']").first();
    const linesBox = value.locator("[data-value-rag-lines]");
    await linesBox.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const lines = await value.locator("li[data-rag-line-basis]").evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-rag-line-currency"), e.getAttribute("data-rag-line-basis"), e.getAttribute("data-rag-line-status")].join("/")),
    );
    check(`R4-${name}-rag-lines`, "F-DG4-126", JSON.stringify(lines) === JSON.stringify(["SAR/profit_and_cash/red", "SAR/top_line/red", "SAR/non_cash/not_applicable", "USD/top_line/red"]), lines);
    const areaStatus = await value.getAttribute("data-area-rag").catch(() => null);
    check(`R4-${name}-area-red`, "F-DG4-126", areaStatus === "red", { areaStatus });
    // The not_applicable (nothing due) line: shown as n/a, never as Unknown, never 0, never green.
    const na = value.locator("li[data-rag-line-basis='non_cash']");
    const naText = await flat(na);
    const naStates = await na.locator("[data-value-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value-state")));
    check(`R4-${name}-na-line-not-unknown`, "REQ-S13-003", naStates.length > 0 && !naStates.includes("unknown") && !naText.includes(stateText(lang, "unknown")), { naStates, naText });
    check(`R4-${name}-na-line-says-na`, "REQ-S13-003", naText.includes(stateText(lang, "not_applicable")), { naText });
    check(`R4-${name}-na-line-never-0-green`, "M0159", !/\b0 %|\b0%/.test(naText) && (await na.locator("[data-rag='green']").count()) === 0, { naText });
    // Each red line shows 100 %.
    for (const [cur, basis] of [["SAR", "profit_and_cash"], ["SAR", "top_line"], ["USD", "top_line"]]) {
      const l = value.locator(`li[data-rag-line-basis='${basis}'][data-rag-line-currency='${cur}'] [data-value-state='value'] .amount`);
      const txt = (await l.count()) === 1 ? (await l.innerText()).trim() : `count=${await l.count()}`;
      check(`R4-${name}-line-${cur}-${basis}-100pct`, "F-DG4-126", txt === "100 %", txt);
    }
    if (name === "t10") {
      // R4-b Portfolio
      const pf = page.locator("section[data-area='portfolio']").first();
      const head = await flat(pf.locator("th[data-value-column-basis='profit_and_cash']"));
      check("R4-t10-portfolio-column-basis", "F-DG4-127", head === tr(lang, "dashboards.basis.portfolioValue"), head);
      const order = await pf.locator("tr[data-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item")));
      check("R4-t10-portfolio-ini1-first", "F-DG4-127", order[0] === ini[0], { order, ini });
      const v1 = await pf.locator(`tr[data-item='${ini[0]}'] [data-value-state]`).first().getAttribute("data-value").catch(() => null);
      check("R4-t10-portfolio-ini1-70", "F-DG4-127", /^70(\.0+)?$/.test(v1 ?? ""), v1);
      const pfText = await flat(pf);
      check("R4-t10-portfolio-370-nowhere", "F-DG4-127", !/370/.test(pfText), pfText.slice(0, 400));
      const s2 = await pf.locator(`tr[data-item='${ini[1]}'] [data-value-state]`).first().getAttribute("data-value-state").catch(() => null);
      const t2 = await flat(pf.locator(`tr[data-item='${ini[1]}']`));
      check("R4-t10-portfolio-ini2-na", "F-DG4-127", s2 === "not_applicable" && t2.includes(tr(lang, "dashboards.reason.dashboard__portfolio__no_profit_and_cash_allocation")), { s2, t2 });
      const s3 = await pf.locator(`tr[data-item='${ini[2]}'] [data-value-state]`).first().getAttribute("data-value-state").catch(() => null);
      check("R4-t10-portfolio-ini3-unknown", "F-DG4-127", s3 === "unknown", s3);
      const chip = await pf.locator(`tr[data-item='${ini[0]}'] td[data-item-basis='profit_and_cash']`).count();
      check("R4-t10-portfolio-ini1-basis-chip", "F-DG4-127", chip === 1, chip);
      // R4-d Outcomes
      const oc = page.locator("section[data-area='outcomes']").first();
      const row = oc.locator(`tr[data-item='${outcomeKpiId}']`);
      const rs = await row.locator("[data-value-state]").first().getAttribute("data-value-state").catch(() => null);
      check("R4-t10-outcomes-api-outcome-listed", "D-124-1", (await row.count()) === 1 && rs === "unknown", { count: await row.count(), rs });
      check("R4-t10-outcomes-not-green", "M0159", (await row.locator("[data-rag='green']").count()) === 0, "");
      // R4-c drill-downs: USD top line planned -> USD 11; SAR p&c planned -> SAR 70.
      for (const [cur, basis, val, region] of [
        ["USD", "top_line", "11", "[data-headlines-beside]"],
        ["SAR", "profit_and_cash", "70", "[data-headlines]"],
      ] as const) {
        const h = value.locator(`${region} [data-metric='value.planned'][data-headline-basis='${basis}']`).filter({ has: page.locator(`[data-value='${val}']`) });
        const n = await h.count();
        check(`R4-drill-${cur}-${basis}-headline`, "F-DG4-105", n === 1, n);
        if (n !== 1) continue;
        await h.locator("button[data-drill]").click();
        const dialog = page.getByRole("dialog");
        await dialog.locator("[data-drill-currency], [data-drill-items], [data-drill-empty]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
        const dc = await dialog.locator("[data-drill-currency]").getAttribute("data-drill-currency").catch(() => null);
        const dv = await dialog.locator("[data-drill-value] [data-value]").first().getAttribute("data-value").catch(() => null);
        const items = await dialog.locator("[data-drill-items] tr[data-drill-item]").count();
        const dText = await flat(dialog);
        const other = cur === "USD" ? /SAR|ر\.س/ : /USD|US\$|\$/;
        check(`R4-drill-${cur}-${basis}`, "F-DG4-105", dc === cur && new RegExp(`^${val}(\\.0+)?$`).test(dv ?? "") && items === 1 && !other.test(dText.replace(/currency|عملة/gi, "")), { dc, dv, items, dText: dText.slice(0, 300) });
        const serious = await axe(page);
        check(`R4-drill-${cur}-${basis}-axe`, "A20-ux", serious.length === 0, serious);
        await shotTo(page, lang, `R4-aud-drill-${cur}-${basis}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
      }
      // The gap stays a percentage.
      const gap = value.locator("[data-headlines] [data-metric='value.gap'][data-headline-basis='profit_and_cash'] [data-value-state='value'] .amount");
      const gt = (await gap.count()) > 0 ? (await gap.first().innerText()).trim() : "";
      check("R4-t10-gap-100pct", "F-DG4-122", gt === "100 %", gt);
    }
    const serious = await axe(page);
    check(`R4-${name}-axe`, "A20-ux", serious.length === 0, serious);
    await shotTo(page, lang, `R4-aud-${name}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(200);
    const o200 = await overflow(page);
    check(`R4-${name}-200pct`, "A20-ux", o200 <= 1, { overflowPx: o200 });
    await shotTo(page, lang, `R4-aud-${name}-200pct`);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 390, height: 844 });
    const o390 = await open(page, url);
    const ov = o390.status === "ok" ? await overflow(page) : -1;
    check(`R4-${name}-390px`, "A20-ux", o390.status === "ok" && ov <= 1, { ...o390, overflowPx: ov });
    await shotTo(page, lang, `R4-aud-${name}-390px`);
  }
});


// ---- the round-3 sweep (S1-S3), unchanged except the file names
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
