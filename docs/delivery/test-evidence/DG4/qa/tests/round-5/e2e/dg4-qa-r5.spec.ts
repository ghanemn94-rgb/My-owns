// qa-verifier DG4 round 5 (T-DG4-REV-QA-R5): my round-4 sweep (S1-S3 and R4, unchanged except the checks below), re-run on
// the round-5 candidate to verify F-DG4-143 adversarially, on the REAL stack (e2e/support/qa-stack.sh: disposable
// PostgreSQL, all migrations, seed-dev, built API serving the built SPA; no mocks, no request interception). This file lives
// OUTSIDE the frozen candidate (docs/delivery/test-evidence/DG4/qa/tests/round-5/e2e/); it is copied into a disposable
// clone's e2e/ only to run, and removed afterwards.
// Changes from round 4:
//   - R4-a: the not_applicable (nothing due) line must now read Not applicable WITH its reason
//     (dashboard.value.nothing_planned), carry data-value-state='not_applicable', show no number and no green, and never
//     Unknown (F-DG4-143's claimed fix; ADR-0037 N4 items 1 and 4; REQ-S13-003).
//   - U (new): a second transformation with a REAL unknown line: SAR margin uplift 70 planned 2026-01..06 (an amount) and
//     SAR avoided cost planned 2026-01..06 with a KPI value but NO amount (POST plan-values {kpiValue} only; the API's
//     'a line of the basis has no amount'). The API must send the non-cash SAR line {status unknown, gapRatio null,
//     reasonKey benefit.value_amount_missing}; T10 and the Executive Overview must show it as Unknown
//     (data-value-state='unknown'), never Not applicable, never 0 and never green, next to the SAR profit-and-cash line
//     (red, 100 %). As the read-only auditor, EN and AR, axe, 390 px and 200 %.
// Every check is recorded (id, requirement, pass, detail) in $QA_RESULTS_DIR/dg4-qa-r5-checks-<lang>.json; the final
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
  writeFileSync(join(OUT, `dg4-qa-r5-checks-${langOf(info)}.json`), `${JSON.stringify(checks, null, 2)}\n`);
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
    name: `Synthetic QA DG4 R5 sweep ${lang.toUpperCase()} ${stamp}`,
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
  const bo = await syntheticUser(admin, orgId, tid, `dev.qar5.bo.${lang}.${stamp}`, `Synthetic QA R4 BO ${lang}`, "BO", lang);
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
       VALUES ('${randomUUID()}', '${orgId}', '${tid}', 'user', '${lead.userId}', 'initiative.create', 'initiative', '${id}', 1, 'qa-r5-fixture-${id}', 'api'); COMMIT;`,
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
  // U: the unknown world (a second transformation; header).
  tidU = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA DG4 R5 unknown line ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const TU = `/api/v1/transformations/${tidU}`;
  const boU = await syntheticUser(admin, orgId, tidU, `dev.qar5u.bo.${lang}.${stamp}`, `Synthetic QA R5U BO ${lang}`, "BO", lang);
  const boUApi = await apiSession(playwright, boU.username);
  for (const [key, valueClass, benefitType, line, plan] of [
    ["margin", "margin_uplift", "revenue", "Gross margin - roaming", { amount: "70" }],
    ["avoidedNoAmount", "avoided_cost", "cost", "Opex - network", { kpiValue: "5" }],
  ] as const) {
    const b = await boUApi.call<{ id: string }>("POST", `${TU}/benefits`, {
      title: `Synthetic QA R5U ${key} ${lang} ${stamp}`,
      description: "Synthetic QA R5 benefit (unknown line world).",
      benefitType,
      valueClass,
      ownerUserId: boU.id,
      currency: "SAR",
      financialStatementLine: line,
    });
    await boUApi.call("POST", `${TU}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
      ...plan,
    });
  }
  const dashU = await lead.call<{ areas: { code: string; rag: { status: string; ruleKey: string; ruleParams: { lines?: unknown[] } } }[] }>("GET", `${TU}/dashboard`);
  const vU = dashU.areas.find((a) => a.code === "value");
  apiUnknownRag = vU?.rag ?? null;
  const ln = (vU?.rag.ruleParams.lines ?? []) as { currency: string; headlineBasis: string; gapRatio: string | null; status: string; reasonKey: string | null }[];
  check("U-api-lines", "REQ-S13-003", ln.length === 2 && ln[0]!.headlineBasis === "profit_and_cash" && ln[0]!.status === "red" &&
    JSON.stringify(ln[1]) === JSON.stringify({ currency: "SAR", headlineBasis: "non_cash", gapRatio: null, status: "unknown", reasonKey: "benefit.value_amount_missing" }), vU?.rag ?? null);
});

let tidU = "";
let apiUnknownRag: unknown = null;

test("U AUD: a real unknown Value RAG line (a planned value without an amount) reads Unknown on T10 and the Overview", async ({ page }, info) => {
  test.setTimeout(6 * 60_000);
  const lang = langOf(info);
  checks.push({ id: "U-api-rag-info", req: "info", pass: true, detail: JSON.stringify(apiUnknownRag).slice(0, 1500) });
  await signIn(page, lang, "dev.auditor");
  for (const [name, url] of [
    ["t10", `/transformations/${tidU}/dashboard`],
    ["overview", `/executive-overview?tr=${tidU}`],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    const o = await open(page, url);
    check(`U-${name}-renders`, "REQ-S13-003", o.status === "ok", o);
    if (o.status !== "ok") continue;
    const value = page.locator("section[data-area='value']").first();
    await value.locator("[data-value-rag-lines]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const lines = await value.locator("li[data-rag-line-basis]").evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-rag-line-currency"), e.getAttribute("data-rag-line-basis"), e.getAttribute("data-rag-line-status")].join("/")),
    );
    check(`U-${name}-rag-lines`, "REQ-S13-003", JSON.stringify(lines) === JSON.stringify(["SAR/profit_and_cash/red", "SAR/non_cash/unknown"]), lines);
    const un = value.locator("li[data-rag-line-basis='non_cash']");
    const unText = await flat(un);
    const unStates = await un.locator("[data-value-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value-state")));
    check(`U-${name}-unknown-line-state`, "REQ-S13-003", unStates.length === 1 && unStates[0] === "unknown", { unStates, unText });
    check(`U-${name}-unknown-line-says-unknown`, "REQ-S13-003", unText.includes(stateText(lang, "unknown")) && !unText.includes(stateText(lang, "not_applicable")), { unText });
    check(`U-${name}-unknown-line-never-0-green`, "M0159", !/\d/.test(unText.replace(/SAR/g, "")) && (await un.locator("[data-rag='green']").count()) === 0, { unText });
    checks.push({ id: `U-${name}-unknown-line-reason-shown`, req: "info", pass: true, detail: JSON.stringify({ reasonShown: unText.includes(tr(lang, "dashboards.reason.benefit__value_amount_missing")), unText }) });
    const pc = await flat(value.locator("li[data-rag-line-basis='profit_and_cash'] [data-value-state='value'] .amount"));
    check(`U-${name}-pc-line-100pct`, "F-DG4-126", pc === "100 %", pc);
    const areaStatus = await value.getAttribute("data-area-rag").catch(() => null);
    checks.push({ id: `U-${name}-area-rag-info`, req: "info", pass: true, detail: JSON.stringify({ areaStatus }) });
    check(`U-${name}-area-not-green`, "M0159", areaStatus !== "green", { areaStatus });
    const serious = await axe(page);
    check(`U-${name}-axe`, "A20-ux", serious.length === 0, serious);
    await shotTo(page, lang, `U-aud-${name}`);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(200);
    const o200 = await overflow(page);
    check(`U-${name}-200pct`, "A20-ux", o200 <= 1, { overflowPx: o200 });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 390, height: 844 });
    const o390 = await open(page, url);
    const ov = o390.status === "ok" ? await overflow(page) : -1;
    check(`U-${name}-390px`, "A20-ux", o390.status === "ok" && ov <= 1, { ...o390, overflowPx: ov });
    await shotTo(page, lang, `U-aud-${name}-390px`);
  }
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
    check(`R5-${name}-na-line-state-na`, "REQ-S13-003", naStates.length === 1 && naStates[0] === "not_applicable", { naStates });
    check(`R5-${name}-na-line-reason`, "REQ-S13-003", naText.includes(tr(lang, "dashboards.reason.dashboard__value__nothing_planned")), { naText });
    check(`R5-${name}-na-line-no-number`, "M0159", !/\d\s?%|\d/.test(naText.replace(/SAR/g, "")), { naText });
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
    // Round 5, revision 2: `.first()` on the union. A page that renders its h1 AND the no-permission state (the lead on
    // /dashboards/rag-policy, 24/24 in the diagnostic dg4-qa-r5-ragpolicy-diag.spec.ts) made `h1.or(denied)` match two
    // elements: a strict-mode error, caught below and recorded as 'no-h1' whenever both were present at the check.
    await expect(h1.or(denied).first()).toBeVisible({ timeout: 20_000 });
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
