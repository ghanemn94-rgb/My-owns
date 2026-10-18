// qa-verifier DG5 round 1 probes (T-DG5-REV-QA-R1B), outside the frozen candidate; copied into the disposable clone's
// e2e/ to run on e2e/support/with-demo-stack.sh (MTH_ENV=demo, AUTH_MODE=dev, the demo role users roaming.user.*).
//  P1 REQ-S21-001: "demo G-approvals display 'Synthetic demonstration - approves nothing real'": the register note says the
//     label on an approval OPENED FROM THE INBOX is not asserted by any e2e. The seeded pending approval (BE-T5,
//     DEMO_PENDING_APPROVAL) is opened by roaming.user.bo from My Work > Approvals.
//  P2 REQ-PB-087: "all six questions render verbatim": the register note says the Day-90 screen is asserted only in a
//     component test. A new transformation with a launch plan; its Day-90 screen in the browser.
//  P3 assignment item 4: 390 px and 200 % text on the P5 screens: no page-level horizontal scroll, h1 visible.
// Everything is SYNTHETIC and approves nothing real; nothing names the engineering gates.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf } from "../apps/web/e2e/support/ui.ts";
import { DEMO_BU, catalogue, demoApi, demoPage, expectBanner } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-dg5r1");
const ROAMING = "01995000-0000-7000-8000-000000000001";
test.setTimeout(300_000);

const DAY90_EN = [
  "Can leaders explain the same case for change and North Star?",
  "Can every initiative be traced to a target-state gap and outcome?",
  "Are executive decision rights clear?",
  "Is Finance aligned on baselines and benefit formulas?",
  "Are Wave 1 initiatives producing evidence rather than only plans?",
  "Can the transformation team show what it needs from executives this month?",
];

async function overflow(p: Page): Promise<number> {
  return p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("P1 REQ-S21-001: the seeded pending approval opened from the BO's inbox shows the synthetic approval label", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const label = catalogue(lang, "playbookP5.demo.approvalLabel");
  const boApi = await demoApi(playwright, "bo");
  const pending = await boApi.call<Body>("GET", "/api/v1/approvals?role=assignee&status=pending&limit=100");
  console.info(`QA-DG5R1 P1 ${lang}: BO pending approvals: ${JSON.stringify((pending.items as Body[]).map((a) => [a.id, a.subjectType ?? a.subject?.type]))}`);
  expect((pending.items as Body[]).length).toBeGreaterThan(0);
  const id = (pending.items as Body[])[0].id as string;
  const bo = await demoPage(browser, lang, "bo");
  // From the inbox list: the approval is listed and its link opens the detail.
  await bo.goto("/my-work/approvals");
  await expect(bo.locator("main#main h1")).toBeVisible();
  await expectBanner(bo, lang);
  const link = bo.locator(`main a[href*="/my-work/approvals/${id}"]`).first();
  await expect(link, "the pending approval is linked from the inbox").toBeVisible();
  await link.click();
  await expect(bo).toHaveURL(new RegExp(`/my-work/approvals/${id}`));
  await expect(bo.locator("main#main h1")).toBeVisible();
  const labels = bo.locator("[data-state='synthetic-approval']");
  await expect(labels.first(), "synthetic approval label on the approval opened from the inbox").toBeVisible();
  for (const text of await labels.allInnerTexts()) expect(text.trim()).toBe(label);
  await bo.screenshot({ path: path.join(dir, "p1-inbox-approval.png"), fullPage: true });
  await expectAccessible(bo, lang, "qa-dg5r1-inbox-approval");
  await bo.context().close();
  await boApi.req.dispose();
});

test("P2 REQ-PB-087: the Day-90 leadership test screen renders the six questions (en verbatim) and Incomplete (0/6)", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const tlApi = await demoApi(playwright, "tl");
  const created = await tlApi.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: DEMO_BU,
    name: `Synthetic QA-DG5R1 ${lang.toUpperCase()} day 90`,
    mode: "end_to_end",
  });
  // The demo e2e stack runs no worker (starter 1 does not run), so the Lead generates the plan the way the A16 spec does:
  // POST /launch-plan {startDate} (LaunchPlanCreate), which creates the tasks and the Day-90 test.
  await tlApi.call<Body>("POST", `/api/v1/transformations/${created.id}/launch-plan`, { startDate: "2026-10-01" }, { expect: 201 });
  let test90: Body = null;
  for (let i = 0; i < 30; i++) {
    const r = await tlApi.req.get(`/api/v1/transformations/${created.id}/day-90-test`);
    if (r.status() === 200) { test90 = await r.json(); break; }
    await new Promise((res) => setTimeout(res, 1000));
  }
  console.info(`QA-DG5R1 P2 ${lang}: day-90-test via API: ${test90 === null ? "not available" : JSON.stringify({ status: test90.status, n: test90.questions?.length })}`);
  const tl = await demoPage(browser, lang, "tl");
  await tl.goto(`/transformations/${created.id}/day-90-test`);
  await expect(tl.locator("main#main h1")).toBeVisible();
  await tl.waitForLoadState("networkidle");
  await tl.screenshot({ path: path.join(dir, "p2-day-90.png"), fullPage: true });
  expect(test90, "the Day-90 test exists for a transformation created with a launch plan").not.toBeNull();
  const items = tl.locator("[data-question]");
  await expect(items).toHaveCount(6);
  const titles = (await items.locator("h3").allInnerTexts()).map((s) => s.replace(/^\s*\d+\.\s*/, "").trim());
  console.info(`QA-DG5R1 P2 ${lang}: rendered questions: ${JSON.stringify(titles)}`);
  if (lang === "en") expect(titles).toEqual(DAY90_EN);
  else {
    expect(titles.map((t) => (test90.questions as Body[]).some((q) => q.textAr === t))).toEqual([true, true, true, true, true, true]);
    for (const t of titles) expect(DAY90_EN).not.toContain(t);
  }
  await expect(tl.locator("[data-answered='false']")).toHaveCount(6);
  await expectAccessible(tl, lang, "qa-dg5r1-day-90");
  await tl.context().close();
  await tlApi.req.dispose();
});

test("P3: the P5 screens at 390 px and at 200 % text: no page-level horizontal scroll", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const tlApi = await demoApi(playwright, "tl");
  const created = await tlApi.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: DEMO_BU,
    name: `Synthetic QA-DG5R1 ${lang.toUpperCase()} reflow`,
    mode: "end_to_end",
  });
  await tlApi.call<Body>("POST", `/api/v1/transformations/${created.id}/launch-plan`, { startDate: "2026-10-01" }, { expect: 201 });
  await tlApi.req.dispose();
  const plan: [string, string[]][] = [
    ["to", ["/admin/studio", "/admin/forms", "/admin/procedures", "/admin/automation", "/admin/branding", "/admin/demo", "/admin/health-schemes", "/admin/source-coverage", "/admin/methodology-migrations"]],
    // The jobs screen is for technical administrators (REQ-S12-022); no demo role user holds ADM_TECH, so /admin/jobs is
    // checked on the production-initialized stack as dev.admin (zz-qa-dg5r1-prod-reflow.spec.ts).
    ["tl", ["/playbook/reader", "/playbook/procedures", "/playbook/launch-plan", "/playbook/health-check", "/evidence-reports/reports", `/walkthrough?transformationId=${created.id}`, `/transformations/${created.id}/launch-plan`, `/transformations/${created.id}/day-90-test`, `/transformations/${created.id}/health-check`, `/transformations/${ROAMING}/health-check`]],
  ];
  const results: string[] = [];
  const bad: string[] = [];
  for (const [role, urls] of plan) {
    const p = await demoPage(browser, lang, role as never);
    for (const [mode, setup] of [
      ["390px", async () => p.setViewportSize({ width: 390, height: 844 })],
      ["200pct", async () => p.setViewportSize({ width: 1280, height: 900 })],
    ] as const) {
      await setup();
      for (const url of urls) {
        await p.goto(url);
        await expect(p.locator("main#main h1"), `${url} h1 (${role})`).toBeVisible();
        await p.waitForLoadState("networkidle");
        if (mode === "200pct") await p.evaluate(() => (document.documentElement.style.fontSize = "200%"));
        await p.waitForTimeout(150);
        const o = await overflow(p);
        const h1 = (await p.locator("main#main h1").innerText()).trim();
        results.push(`${role} ${mode} ${url} overflow=${o} h1="${h1}"`);
        if (o > 1) bad.push(`${role} ${mode} ${url} overflow=${o}`);
        const name = `p3-${mode}-${url.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}`;
        await p.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
      }
    }
    await p.context().close();
  }
  console.info(`QA-DG5R1 P3 ${lang}:\n${results.join("\n")}`);
  expect(bad).toEqual([]);
});

test("P4 REQ-PB-090: the traceability VIEW of the demo transformation shows the five steps of chain 1 (B0147)", async ({ browser }, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const chain = ["Low activation", "Proposition + journey", "Pass redesign + digital activation", "Attach rate / activation", "Revenue uplift"];
  const tl = await demoPage(browser, lang, "tl");
  await tl.goto(`/transformations/${ROAMING}/traceability`);
  await expect(tl.locator("main#main h1")).toBeVisible();
  await tl.waitForLoadState("networkidle");
  const text = await tl.locator("main#main").innerText();
  const positions = chain.map((c) => text.indexOf(c));
  console.info(`QA-DG5R1 P4 ${lang}: chain-1 label positions in the traceability view: ${JSON.stringify(positions)}`);
  await tl.screenshot({ path: path.join(dir, "p4-traceability.png"), fullPage: true });
  for (const [i, c] of chain.entries()) expect(positions[i], `"${c}" shown`).toBeGreaterThanOrEqual(0);
  await expectAccessible(tl, lang, "qa-dg5r1-traceability");
  await tl.context().close();
});
