// domain-reviewer DG5 round-2 probe on the DEMO-initialized stack (e2e/support/with-demo-stack.sh; AUTH_MODE=dev,
// MTH_ENV=demo). SYNTHETIC illustrative data only; no demo approval approves anything real; product gates G1-G6 never
// relate to the engineering gates DG0-DG7. Run from a disposable clone (copied to <clone>/probe/).
// Round 2 adds: every gate page G1-G6 (F-DG5-120 verification), the gate history through the API (gates, gate detail,
// submissions, decisions, exceptions, phases, decision log, audit trail) and the environment checksum.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
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
  ];
  for (const g of GATES) {
    paths.push([`demo-gate-${g}`, `/api/v1/transformations/${T}/gates/${g}`]);
    paths.push([`demo-gate-${g}-submissions`, `/api/v1/transformations/${T}/gates/${g}/submissions`]);
    paths.push([`demo-gate-${g}-decision`, `/api/v1/transformations/${T}/gates/${g}/decision`]);
  }
  for (const [name, path] of paths) {
    const res = await tl.req.get(path);
    dump(name, { status: res.status(), body: await res.json().catch(() => null) });
  }
  for (const g of ["G1", "G4"]) {
    const res = await tl.req.get(`/api/v1/transformations/${T}/gates/${g}/submissions/1`);
    dump(`demo-gate-${g}-submission-1`, { status: res.status(), body: await res.json().catch(() => null) });
  }
  const admin = await apiSession(playwright, "dev.admin");
  const env = await admin.req.get("/api/v1/admin/environment");
  dump("demo-environment", { status: env.status(), body: await env.json().catch(() => null) });
});

test("UI on the demo database: labels, workspace, gates G1-G6, traceability, walkthrough, form headers", async ({
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
      // Round 2 (run 2): wait until no section is still loading, so the screen is captured complete (max 15 s).
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
