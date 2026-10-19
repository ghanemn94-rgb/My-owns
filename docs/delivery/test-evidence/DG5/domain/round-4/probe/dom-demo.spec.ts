// domain-reviewer DG5 round-4 probe (copied from round 3; round 4 adds the F-DG5-123 verification: deliverables,
// capability heatmap, orphan report, roadmap Deliverables section) on the DEMO-initialized stack (e2e/support/with-demo-stack.sh; AUTH_MODE=dev,
// MTH_ENV=demo). SYNTHETIC illustrative data only; no demo approval approves anything real; product gates G1-G6 never
// relate to the engineering gates DG0-DG7. Run from a disposable clone (copied to <clone>/probe/).
// Round 3 adds (F-DG5-120 / F-DG5-122 verification): the portfolio, roadmap, capacity, business cases BC-01..BC-04,
// the three initiative pages (funding decisions), executive decisions, prioritization, in EN and AR, and the G4
// submission snapshot through the API. Read-only: GET requests and page views only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
const ORG = "01995000-0000-7000-8000-000000000002";
const INI = [
  "01995000-0000-7000-8000-000000000021",
  "01995000-0000-7000-8000-000000000022",
  "01995000-0000-7000-8000-000000000023",
];
const GATES = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
const dump = (name: string, data: unknown) => {
  mkdirSync(join(OUT, "api"), { recursive: true });
  writeFileSync(join(OUT, "api", `${name}.json`), JSON.stringify(data, null, 1));
};
const shot = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: true });
};
const text = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "text", lang), { recursive: true });
  writeFileSync(join(OUT, "text", lang, `${name}.txt`), await page.locator("body").innerText());
};

test("API dumps on the demo database (en project only)", async ({ playwright }, info) => {
  test.skip(langOf(info) !== "en");
  const tl = await apiSession(playwright, "roaming.user.tl");
  const paths: [string, string][] = [
    ["demo-transformation", `/api/v1/transformations/${T}`],
    ["demo-traceability", `/api/v1/transformations/${T}/traceability`],
    ["demo-north-star", `/api/v1/transformations/${T}/north-star`],
    ["demo-walkthrough", `/api/v1/demo/walkthrough`],
    ["demo-gates", `/api/v1/transformations/${T}/gates`],
    ["demo-phases", `/api/v1/transformations/${T}/phases`],
    ["demo-phase-steps", `/api/v1/transformations/${T}/phase-steps`],
    ["demo-gate-exceptions", `/api/v1/transformations/${T}/gate-exceptions`],
    ["demo-decisions", `/api/v1/decisions?transformationId=${T}&limit=100`],
    ["demo-audit", `/api/v1/transformations/${T}/audit?limit=100`],
    ["demo-procedures", `/api/v1/procedure-definitions`],
    ["demo-initiatives", `/api/v1/initiatives?transformationId=${T}&limit=100`],
    ["demo-funding-decisions", `/api/v1/funding-decisions?transformationId=${T}&limit=100`],
    ["demo-resource-demands", `/api/v1/resource-demands?transformationId=${T}&limit=100`],
    ["demo-capacity-plan", `/api/v1/transformations/${T}/capacity-plan`],
    ["demo-prioritization", `/api/v1/transformations/${T}/prioritization`],
    ["demo-ranking-snapshots", `/api/v1/transformations/${T}/prioritization/rankings`],
    ["demo-roadmap", `/api/v1/transformations/${T}/roadmap`],
    ["demo-portfolios", `/api/v1/organizations/${ORG}/portfolios`],
    ["demo-business-cases", `/api/v1/business-cases?transformationId=${T}&limit=100`],
    ["demo-orphans", `/api/v1/transformations/${T}/orphans?limit=100`],
    ["demo-capability-heatmap", `/api/v1/transformations/${T}/capability-heatmap`],
    ["demo-trace-links", `/api/v1/transformations/${T}/trace-links?limit=200`],
  ];
  for (const g of GATES) {
    paths.push([`demo-gate-${g}`, `/api/v1/transformations/${T}/gates/${g}`]);
    paths.push([`demo-gate-${g}-submissions`, `/api/v1/transformations/${T}/gates/${g}/submissions`]);
    paths.push([`demo-gate-${g}-decision`, `/api/v1/transformations/${T}/gates/${g}/decision`]);
  }
  for (const i of INI) paths.push([`demo-milestones-${i.slice(-2)}`, `/api/v1/initiatives/${i}/milestones`]);
  for (const i of INI) paths.push([`demo-initiative-${i.slice(-2)}`, `/api/v1/initiatives/${i}`]);
  for (const i of INI) paths.push([`demo-deliverables-${i.slice(-2)}`, `/api/v1/initiatives/${i}/deliverables`]);
  for (const [name, path] of paths) {
    const res = await tl.req.get(path);
    dump(name, { path, status: res.status(), body: await res.json().catch(() => null) });
  }
  for (const g of ["G1", "G4"]) {
    for (const sub of ["", "/criteria"]) {
      const res = await tl.req.get(`/api/v1/transformations/${T}/gates/${g}/submissions/1${sub}`);
      dump(`demo-gate-${g}-submission-1${sub.replace("/", "-")}`, {
        status: res.status(),
        body: await res.json().catch(() => null),
      });
    }
  }
  const cases = (await (await tl.req.get(`/api/v1/business-cases?transformationId=${T}&limit=100`)).json()) as {
    items?: { id: string; code: string }[];
  };
  for (const c of cases.items ?? []) {
    for (const sub of ["", "/totals", "/financial-metrics"]) {
      const res = await tl.req.get(`/api/v1/business-cases/${c.id}${sub}`);
      dump(`demo-case-${c.code}${sub.replace("/", "-")}`, { status: res.status(), body: await res.json().catch(() => null) });
    }
  }
  const admin = await apiSession(playwright, "dev.admin");
  const env = await admin.req.get("/api/v1/admin/environment");
  dump("demo-environment", { status: env.status(), body: await env.json().catch(() => null) });
});

test("UI on the demo database: labels, workspace, gates G1-G6, G4 basis screens, walkthrough, form headers", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const go = async (role: string, routes: [string, string][]) => {
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const page = await ctx.newPage();
    await signIn(page, lang, role);
    for (const [name, route] of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page
        .waitForFunction(() => !/Loading…|جارٍ التحميل…/.test(document.body.innerText), undefined, { timeout: 15_000 })
        .catch(() => undefined);
      await page.waitForTimeout(500);
      await shot(page, lang, name);
      await text(page, lang, name);
    }
    return { ctx, page };
  };
  const tl = await go("roaming.user.tl", [
    ["d01-workspace", `/transformations/${T}`],
    ["d02-charter", `/transformations/${T}/charter`],
    ["d03-define", `/transformations/${T}/define`],
    ["d04-traceability", `/transformations/${T}/traceability`],
    ["d05-gates", `/transformations/${T}/gates`],
    ...GATES.map((g, i): [string, string] => [`d06-gate-${i + 1}-${g}`, `/transformations/${T}/gates/${g}`]),
    ["d07-reports", `/transformations/${T}/reports`],
    ["d08-walkthrough", `/walkthrough`],
    ["d09-raid", `/transformations/${T}/raid`],
    ["d10-health-check", `/transformations/${T}/health-check`],
    ["d11-launch-plan", `/transformations/${T}/launch-plan`],
    ["d12-decisions", `/transformations/${T}/decisions`],
    ["d13-procedures", `/playbook/procedures`],
    ["d14-diagnose", `/transformations/${T}/diagnose`],
    ["d18-phases", `/transformations/${T}/phases`],
    ["d19-portfolio", `/transformations/${T}/portfolio`],
    ["d20-prioritization", `/transformations/${T}/prioritization`],
    ["d21-benefits", `/transformations/${T}/benefits`],
    ["d22-roadmap", `/transformations/${T}/roadmap`],
    ["d23-capacity", `/transformations/${T}/capacity`],
    ["d24-business-cases", `/transformations/${T}/business-cases`],
    ...INI.map((id, k): [string, string] => [`d25-initiative-INI-0${k + 1}`, `/transformations/${T}/initiatives/${id}`]),
    ["d26-executive-decisions", `/transformations/${T}/executive-decisions`],
    ["d28-design-heatmap", `/transformations/${T}/design`],
  ]);
  await tl.ctx.close();
  const sp = await go("roaming.user.sp", [
    ["d15-sp-gate-G4", `/transformations/${T}/gates/G4`],
    ["d16-sp-approvals", `/my-work/approvals`],
  ]);
  await sp.ctx.close();
  const fin = await go("roaming.user.fin", [["d17-finance-queue", `/finance-validation`]]);
  await fin.ctx.close();
  expect(true).toBe(true);
});

test("UI on the demo database: business case detail pages BC-01..BC-04", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const tlApi = await apiSession(playwright, "roaming.user.tl");
  const cases = (await (await tlApi.req.get(`/api/v1/business-cases?transformationId=${T}&limit=100`)).json()) as {
    items?: { id: string; code: string }[];
  };
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await ctx.newPage();
  await signIn(page, lang, "roaming.user.tl");
  for (const c of cases.items ?? []) {
    await page.goto(`/transformations/${T}/business-cases/${c.id}`);
    await page.waitForLoadState("networkidle");
    await page
      .waitForFunction(() => !/Loading…|جارٍ التحميل…/.test(document.body.innerText), undefined, { timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await shot(page, lang, `d27-case-${c.code}`);
    await text(page, lang, `d27-case-${c.code}`);
  }
  await ctx.close();
  expect((cases.items ?? []).length).toBeGreaterThan(0);
});
