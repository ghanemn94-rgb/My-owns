// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2; carried from my round-1 probe, unchanged otherwise) probes on the DEMO stack (e2e/support/with-demo-stack.sh: mth-db
// seed-demo, MTH_ENV=demo, AUTH_MODE=dev; the demo role users roaming.user.* sign in through the dev form, D-165).
// Runs in a DISPOSABLE clone only (copied to e2e/ there). Clauses tested literally where the register notes disclose
// partial coverage:
//   D1 REQ-PB-090: "the traceability view shows 'Low activation -> Proposition + journey -> Pass redesign + digital
//      activation -> Attach rate / activation -> Revenue uplift'" - ON THE RENDERED VIEW (the candidate asserts it on the
//      API response only): rooted at the Low activation node, downstream, the five labels are shown in chain order.
//   D2 REQ-S21-001: "demo G-approvals display 'Synthetic demonstration - approves nothing real'" - on the seeded
//      pending approval OPENED FROM THE INBOX (My Work -> approvals), not asserted by the candidate's e2e.
//   D3 REQ-PB-087: "all six questions render verbatim; unanswered questions mark the test incomplete" - on the Day-90
//      screen of the demo transformation (the candidate asserts the screen in a component test only).
// Every record is SYNTHETIC (an illustrative example, not Mobily actual performance); nothing approves anything real
// and nothing names an engineering gate.
import { expect as baseExpect, test } from "@playwright/test";
import { langOf } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoApi, demoPage } from "./support/a02-demo.ts";

const expect = baseExpect.configure({ timeout: 20_000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T_ID = "01995000-0000-7000-8000-000000000001";
const CHAIN = [
  "Low activation",
  "Proposition + journey",
  "Pass redesign + digital activation",
  "Attach rate / activation",
  "Revenue uplift",
] as const;
const DAY90 = [
  "Can leaders explain the same case for change and North Star?",
  "Can every initiative be traced to a target-state gap and outcome?",
  "Are executive decision rights clear?",
  "Is Finance aligned on baselines and benefit formulas?",
  "Are Wave 1 initiatives producing evidence rather than only plans?",
  "Can the transformation team show what it needs from executives this month?",
] as const;

test("QA-R1 D1 REQ-PB-090: the traceability VIEW shows the B0147 chain 1 in order, rooted at Low activation", async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const page = await demoPage(browser, lang, "tl");
  await page.goto(`/transformations/${T_ID}/traceability`);
  const graph = page.locator("#trace-graph");
  const start = graph.locator("li.trace-node", { hasText: CHAIN[0] }).first();
  await expect(start).toBeVisible();
  await start.locator("[data-action='focus']").click();
  await expect(page.locator("[data-root]")).toBeVisible();
  await page.locator("#trace-direction").selectOption("downstream").catch(() => undefined);
  await page.locator("#trace-depth").selectOption("8");
  await page.waitForTimeout(1000);
  // Each label is a node of the rooted view; the columns are in chain order, so their DOM order is the chain order.
  const positions: number[] = [];
  const columns: string[] = [];
  const nodes = graph.locator("li.trace-node");
  const texts = await nodes.allInnerTexts();
  for (const label of CHAIN) {
    const i = texts.findIndex((t) => t.split("\n")[0]!.includes(label));
    positions.push(i);
    if (i >= 0)
      columns.push(
        (await nodes.nth(i).evaluate((el) => el.closest("[data-node-type]")?.getAttribute("data-node-type") ?? "?")) ?? "?",
      );
  }
  const shown = (await graph.locator("[data-node-type]").evaluateAll((els) =>
    els.map((e) => `${e.getAttribute("data-node-type")}: ${Array.from(e.querySelectorAll("li.trace-node")).map((n) => (n as HTMLElement).innerText.split("\n")[0]).join(" | ")}`),
  )) as string[];
  console.info(`QA-R1 D1 ${lang}: positions=${JSON.stringify(positions)} columns=${JSON.stringify(columns)}\n${shown.join("\n")}`);
  await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/${lang}-qa-r1-d1-traceability-chain1.png`, fullPage: true });
  expect(positions.every((p) => p >= 0), "every chain-1 label is shown in the rooted view").toBe(true);
  expect([...positions].sort((a, b) => a - b), "in chain order").toEqual(positions);
  // The shown nodes are linked: each label's node lists links (its 'links' summary is present), the last is the benefit.
  expect(columns[0]).not.toBe(columns[4]);
  expect(columns[4]).toBe("benefit");
  await page.context().close();
});

test("QA-R1 D2 REQ-S21-001: the seeded pending approval opened from the inbox shows the synthetic approval label", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const label = catalogue(lang, "playbookP5.demo.approvalLabel");
  const bo = await demoApi(playwright, "bo");
  const inbox = await bo.req.get("/api/v1/me/work-items?limit=100");
  console.info(`QA-R1 D2 ${lang}: BO work items ${inbox.status()} ${(await inbox.text()).slice(0, 600)}`);
  const page = await demoPage(browser, lang, "bo");
  await page.goto("/my-work/approvals");
  const link = page.locator("main a[href^='/my-work/approvals/']").first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/my-work\/approvals\/[0-9a-f-]+$/);
  const note = page.locator("[data-state='synthetic-approval']");
  await expect(note).toBeVisible();
  await expect(note).toContainText(label);
  await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/${lang}-qa-r1-d2-inbox-approval.png`, fullPage: true });
  await page.context().close();
});

test("QA-R1 D3 REQ-PB-087: the demo Day-90 screen shows the six questions verbatim and is incomplete while unanswered", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const page = await demoPage(browser, lang, "tl");
  await page.goto(`/transformations/${T_ID}/day-90-test`);
  const qs = page.locator("[data-questions] [data-question]");
  await expect(page.locator("[data-questions]")).toHaveAttribute("data-questions", "6");
  await expect(qs).toHaveCount(6);
  const status = await page.locator("[data-test-status]").getAttribute("data-test-status");
  const answered = await page.locator("[data-question][data-answered='true']").count();
  const texts = await qs.allInnerTexts();
  console.info(`QA-R1 D3 ${lang}: status=${status} answered=${answered}/6 first lines=${JSON.stringify(texts.map((t) => t.split("\n")[0]))}`);
  if (lang === "en") for (const [i, q] of DAY90.entries()) expect(texts[i], `question ${i + 1} verbatim`).toContain(q);
  else {
    const api = await (await demoApi(playwright, "tl")).call<Body>("GET", `/api/v1/transformations/${T_ID}/day-90-test`);
    const ar = (api.questions as Body[]).map((q) => q.textAr as string);
    console.info(`QA-R1 D3 ar: API textAr=${JSON.stringify(ar)} textEn=${JSON.stringify((api.questions as Body[]).map((q) => q.textEn))}`);
    expect((api.questions as Body[]).map((q) => q.textEn), "API textEn verbatim B0136-B0141").toEqual([...DAY90]);
    for (const [i, q] of ar.entries()) expect(texts[i], `question ${i + 1} in Arabic`).toContain(q);
  }
  expect(answered, "the demo test is not fully answered").toBeLessThan(6);
  expect(status, "an unanswered test is not complete").not.toBe("completed");
  await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/${lang}-qa-r1-d3-day90.png`, fullPage: true });
  await page.context().close();
});

test("QA-R1 D4 REQ-S18-001: the synthetic banner on every P5 screen of the demo database (TL and ADM_ACCESS)", async ({
  browser,
}, info) => {
  test.setTimeout(600_000);
  const lang = langOf(info);
  const text = catalogue(lang, "playbookP5.demo.banner");
  const T = `/transformations/${T_ID}`;
  const plan: [("tl" | "adm_access"), string[]][] = [
    [
      "tl",
      [
        "/playbook/reader",
        "/playbook/reader/B0031",
        "/about",
        "/playbook/procedures",
        "/playbook/launch-plan",
        "/playbook/health-check",
        "/evidence-reports/reports",
        "/evidence-reports/exports",
        "/evidence-reports/presentation",
        "/evidence-reports/evidence-register",
        "/initiatives-roadmaps/updates",
        "/my-work/notification-preferences",
        `${T}/traceability`,
        `${T}/reports`,
        `${T}/exports`,
        `${T}/presentation`,
        `${T}/owner-updates`,
        `${T}/evidence-register`,
        `${T}/launch-plan`,
        `${T}/day-90-test`,
        `${T}/health-check`,
        `${T}/financial-metrics`,
        `${T}/config-pins`,
        `${T}/methodology-migrations`,
        `${T}/gate-conditions`,
      ],
    ],
    ["adm_access", ["/admin/demo", "/admin/branding", "/admin/jobs/operations", "/admin"]],
  ];
  const missing: string[] = [];
  let visited = 0;
  for (const [role, paths] of plan) {
    const page = await demoPage(browser, lang, role);
    for (const p of paths) {
      await page.goto(p);
      await page.locator("main h1").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      const banner = page.locator("[data-state='demo-synthetic']");
      // The banner depends on the environment read; wait for it (up to 15 s) before declaring it missing.
      await banner.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      const n = await banner.count();
      const t = n === 1 ? ((await banner.innerText()).trim()) : null;
      visited++;
      if (n !== 1 || t !== text) missing.push(`${role} ${p}: banners=${n} text=${JSON.stringify(t)}`);
    }
    await page.context().close();
  }
  console.info(`QA-R1 D4 ${lang}: visited ${visited} screens; problems ${JSON.stringify(missing)}`);
  expect(missing).toEqual([]);
});
