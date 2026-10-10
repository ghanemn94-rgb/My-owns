// P4 slice J (dashboards, Executive Overview, workspace header, My Work sections) on the REAL stack
// (support/with-stack.sh; no mocks): T-DG4-FE-G (p4-work-split §J+K JK.7; ADR-0037). Every record is SYNTHETIC demo
// data. No product gate (G1-G6) is decided here, and none implies an engineering gate (DG0-DG7).
//  1. Workspace header (REQ-S03-011): the eight elements from getWorkspaceHeader, each Unknown where the data is
//     missing (no North Star, sponsor, lead, outcome KPI or benefit), never 0 or green; ONE click on the header's RAID
//     link opens the transformation's RAID register filtered to it (its own entry listed, the other transformation's
//     entry absent).
//  2. Transformation dashboard (REQ-PB-062, REQ-S13-003): the six Template 10 areas from persisted data; Outcomes is
//     Unknown without a KPI; a headline opens the drill-down with a known zero (labelled) distinct from Unknown/n/a.
//  3. Executive Overview (REQ-S03-009, REQ-S13-001/002): the organization's readable transformations, the filter chips
//     (business unit, owner) narrow the request, the window and as-of date are shown.
//  4. Finance and adoption dashboards (REQ-S13-001): headlines, non-financial benefits n/a (never 0), the People &
//     adoption area.
//  5. My Work (REQ-S03-008): the six sections with totals and the upcoming deadlines; the personal dashboard.
//  6. 390 px wide, and 200 % text: no page-level horizontal scroll on the overview, the dashboard and the header.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Page } from "@playwright/test";
import { asUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tidA = "";
let tidB = "";
let codeA = "";
let lead: ApiSession;
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const a = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P4 dashboards A ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tidA = a.id;
  codeA = a.code;
  tidB = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 dashboards B ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  for (const [tid, label] of [
    [tidA, "A"],
    [tidB, "B"],
  ] as const) {
    await lead.call("POST", `/api/v1/transformations/${tid}/raid`, {
      type: "risk",
      description: `Synthetic dashboard risk ${label} ${lang} ${stamp}`,
      impact: "high",
      probability: "medium",
      ownerUserId: lead.userId,
    });
  }
});

test("1. Workspace header: eight elements, Unknown where missing; one click opens the RAID register filtered to it", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tidA}`);
  const header = page.getByRole("region", { name: tr(lang, "transformations.workspace.title") });
  await expect(header.locator("[data-element='northStar']")).toBeVisible();
  // Each element is there; the missing ones say Unknown (never 0, never green).
  for (const el of ["gateReadiness", "northStar", "owners", "outcomeHealth", "benefits", "keyDecisions", "nextActions"])
    await expect(header.locator(`[data-element='${el}']`)).toBeVisible();
  await expect(header.locator("[data-element='northStar'] [data-health='unknown']")).toBeVisible();
  await expect(header.locator("[data-element='benefits'] [data-health='unknown']")).toBeVisible();
  await expect(header.locator("[data-element='outcomeHealth'] [data-rag='unknown']")).toBeVisible();
  await expect(header.locator("[data-rag='green']")).toHaveCount(0);
  await expect(header.locator("[data-owner='sponsor'] [data-health='unknown']")).toBeVisible();
  // The gate readiness comes live through the server's port: G1 with its missing mandatory criteria.
  await expect(header.locator("[data-gate='G1']")).toBeVisible();
  await expect(header.locator("[aria-current='step']")).toContainText(tr(lang, "transformations.phase.diagnose"));
  await shot(page, lang, "p4dash-01-workspace-header");
  await expectAccessible(page, lang, "p4dash-header");
  // ONE click: the RAID register of this transformation, filtered to it.
  await header.locator("[data-header-link='raid']").click();
  await expect(page).toHaveURL(new RegExp(`/transformations/${tidA}/raid$`));
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "raidP4.register.title"));
  await expect(page.locator("tr", { hasText: `Synthetic dashboard risk A ${lang} ${stamp}` })).toBeVisible();
  await expect(page.locator("tr", { hasText: `Synthetic dashboard risk B ${lang} ${stamp}` })).toHaveCount(0);
  await expect(page.getByText(codeA, { exact: false }).first()).toBeVisible();
  await shot(page, lang, "p4dash-02-raid-from-header");
  await expectAccessible(page, lang, "p4dash-raid-from-header");
  expect(foreign).toEqual([]);
  await tl.close();
});

test("2. Transformation dashboard: six T10 areas from persisted data; drill-down; zero is distinct from Unknown", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tidA}/dashboard`);
  await expect(page.locator("[data-tab='dashboard']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("section[data-area]")).toHaveCount(6);
  // No outcome KPI yet: Outcomes is Unknown, never green; People & adoption without indicators is Unknown too.
  await expect(page.locator("section[data-area='outcomes']")).toHaveAttribute("data-area-rag", "unknown");
  await expect(page.locator("section[data-area='people_adoption']")).toHaveAttribute("data-area-rag", "unknown");
  await expect(page.locator("[data-asof]")).toBeVisible();
  if (lang === "ar") await expect(page.locator("[data-provisional='true']").first()).toBeVisible();
  await shot(page, lang, "p4dash-03-transformation-dashboard");
  await expectAccessible(page, lang, "p4dash-transformation");
  // The open decisions headline drills to its records: a known zero, labelled, never Unknown.
  await page.locator("section[data-area='decisions'] [data-drill='decisions.open']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-drill-value] [data-value-state='zero']")).toBeVisible();
  await expect(dialog.locator("[data-drill-value]")).toContainText(tr(lang, "dashboards.state.zero"));
  await expect(dialog.locator("[data-drill-empty]")).toBeVisible();
  await shot(page, lang, "p4dash-04-drilldown-zero");
  await expectAccessible(page, lang, "p4dash-drilldown");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("main")).not.toContainText(/\bDG[0-7]\b/);
  await tl.close();
});

test("3. Executive Overview: readable transformations, business-unit and owner chips, window and as-of date", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  const overviewRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/overview?")) overviewRequests.push(r.url());
  });
  await go(page, "/executive-overview");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.areas.executive.label"));
  await expect(page.locator(`[data-row='${tidA}']`)).toBeVisible();
  await expect(page.locator("section[data-area]")).toHaveCount(6);
  await expect(page.locator("[data-asof]")).toBeVisible();
  await shot(page, lang, "p4dash-05-executive-overview");
  await expectAccessible(page, lang, "p4dash-overview");
  // Business-unit chip: the request carries that unit's readable transformations (the contract has no unit param).
  await page.locator("[data-filter='bu']").selectOption(SYN_RETAIL);
  await expect(page.locator("[data-chip='bu']")).toBeVisible();
  await expect.poll(() => overviewRequests.some((u) => u.includes(`transformationId=${tidA}`))).toBe(true);
  await expect(page.locator(`[data-row='${tidA}']`)).toBeVisible();
  // Owner chip: me.
  const owner = page.locator("[data-filter='owner']");
  await owner.selectOption({ index: 1 });
  await expect(page.locator("[data-chip='owner']")).toBeVisible();
  await expect.poll(() => overviewRequests.some((u) => u.includes("ownerUserId="))).toBe(true);
  await shot(page, lang, "p4dash-06-overview-filtered");
  await expectAccessible(page, lang, "p4dash-overview-filtered");
  // The chip removes its filter.
  await page.locator("[data-chip='owner']").click();
  await expect(page.locator("[data-chip='owner']")).toHaveCount(0);
  await to.close();
});

test("4. Finance and adoption dashboards: non-financial is n/a, never 0; the People & adoption area", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  await go(page, "/dashboards/finance");
  await expect(page.locator("[data-pending-validation]")).toBeVisible();
  await expect(page.locator("[data-non-financial-count] [data-value-state='not_applicable']")).toBeVisible();
  await expect(page.locator("#finance-lines")).toBeVisible();
  await shot(page, lang, "p4dash-07-finance");
  await expectAccessible(page, lang, "p4dash-finance");
  await go(page, "/dashboards/adoption");
  await expect(page.locator("section[data-area='people_adoption']")).toBeVisible();
  await expect(page.locator("[data-open-interventions]")).toBeVisible();
  await shot(page, lang, "p4dash-08-adoption");
  await expectAccessible(page, lang, "p4dash-adoption");
  await go(page, "/dashboards");
  await expect(page.locator("[data-dashboard-kind]")).toHaveCount(6);
  await shot(page, lang, "p4dash-09-hub");
  await expectAccessible(page, lang, "p4dash-hub");
  await to.close();
});

// T-DG4-FE-R3 (ADR-0037 K1; KBE-R4): every Finance class line drills by its state's metric and `valueClass`; a net line
// is "gross − implementation cost" with its two inputs, never a drillable total. The lines are the real organization's
// (every earlier spec's SYNTHETIC benefits); when the database has none the step says so in an annotation.
test("4b. Finance class lines drill by valueClass; the drill-down rule is translated; a net line links its inputs", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  // The very response the screen renders (getFinanceDashboard, organization-wide).
  const read = page.waitForResponse(
    (r) => r.request().method() === "GET" && /\/api\/v1\/dashboards\/finance\?/.test(r.url()),
  );
  await go(page, "/dashboards/finance");
  const res = await read;
  expect(res.status()).toBe(200);
  const fd = (await res.json()) as {
    lines: { valueClass: string; state: string; currency: string; drilldownHref: string | null }[];
  };
  const classLines = fd.lines.filter((l) => l.valueClass !== "gross" && l.valueClass !== "net");
  const netLines = fd.lines.filter((l) => l.valueClass === "net");
  info.annotations.push({
    type: "finance-lines",
    description: `${classLines.length} class, ${fd.lines.length - classLines.length - netLines.length} gross, ${netLines.length} net`,
  });
  // The contract (KBE-R4): every class line has a drill-down with its value class; a net line has none.
  for (const l of classLines) expect(l.drilldownHref, JSON.stringify(l)).toContain(`valueClass=${l.valueClass}`);
  for (const l of netLines) expect(l.drilldownHref).toBeNull();
  if (classLines.length === 0) {
    await expect(page.locator("#finance-lines")).toContainText(tr(lang, "dashboards.finance.noLines"));
  } else {
    for (const l of classLines)
      await expect(page.locator(`[data-drill-line='${l.valueClass}-${l.state}-${l.currency}']`)).toHaveCount(1);
    const first = classLines[0]!;
    const drillRead = page.waitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes("/api/v1/dashboard-drilldown?"),
    );
    await page.locator(`[data-drill-line='${first.valueClass}-${first.state}-${first.currency}']`).click();
    const drillRes = await drillRead;
    expect(drillRes.status()).toBe(200);
    expect(new URL(drillRes.url()).searchParams.get("valueClass")).toBe(first.valueClass);
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-drill-value]")).toBeVisible();
    // The value-state rule (rows 187-193) is translated, never "Rule not listed in this release."
    const rule = dialog.locator("[data-calculation]");
    await expect(rule).toHaveAttribute("data-calculation", `dashboard.value.sum_${first.state}`);
    await expect(rule).not.toContainText(tr(lang, "dashboards.rule.other"));
    await shot(page, lang, "p4dash-07b-finance-class-drilldown");
    await expectAccessible(page, lang, "p4dash-finance-class-drilldown");
    await page.keyboard.press("Escape");
  }
  for (const l of netLines) {
    const cell = page.locator(`[data-net-inputs='${l.state}-${l.currency}']`);
    await expect(cell).toContainText(tr(lang, "dashboards.finance.netFormula"));
  }
  await to.close();
});

test("5. My Work: the six sections with totals and the upcoming deadlines; the personal dashboard", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, "/my-work");
  await expect(page.locator("[data-section-link]")).toHaveCount(6);
  for (const s of ["assigned_actions", "drafts", "reviews", "approvals", "missing_updates", "other"])
    await expect(page.locator(`#mw-${s}`)).toBeVisible();
  await expect(page.locator("#mw-deadlines")).toBeVisible();
  await shot(page, lang, "p4dash-10-my-work-sections");
  await expectAccessible(page, lang, "p4dash-my-work");
  await go(page, "/dashboards/personal");
  await expect(page.locator("[data-section-link]")).toHaveCount(6);
  await shot(page, lang, "p4dash-11-personal-dashboard");
  await expectAccessible(page, lang, "p4dash-personal");
  await tl.close();
});

test("6. 390 px wide and 200 % text: no page-level horizontal scroll", async ({ browser }, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  const screens: [string, string][] = [
    ["/executive-overview", "p4dash-12-overview"],
    [`/transformations/${tidA}/dashboard`, "p4dash-13-dashboard"],
    [`/transformations/${tidA}`, "p4dash-14-header"],
    ["/dashboards/finance", "p4dash-15-finance"],
    ["/my-work", "p4dash-16-my-work"],
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of screens) {
    await go(page, path);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoPageOverflow(page);
    await shot(page, lang, `${name}-390`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of screens) {
    await go(page, path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.waitForLoadState("networkidle");
    await expectNoPageOverflow(page);
    await shot(page, lang, `${name}-200pct`);
  }
  await to.close();
});
