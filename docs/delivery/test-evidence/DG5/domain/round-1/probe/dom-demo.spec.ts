// domain-reviewer DG5 round-1 probe on the DEMO-initialized stack (e2e/support/with-demo-stack.sh; AUTH_MODE=dev,
// MTH_ENV=demo). SYNTHETIC illustrative data only; no demo approval approves anything real; nothing relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
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
  for (const [name, path] of [
    ["demo-transformation", `/api/v1/transformations/${T}`],
    ["demo-traceability", `/api/v1/transformations/${T}/traceability`],
    ["demo-north-star", `/api/v1/transformations/${T}/north-star`],
    ["demo-walkthrough-step1", `/api/v1/demo/walkthrough`],
    ["demo-gates", `/api/v1/transformations/${T}/gates`],
    ["demo-procedures", `/api/v1/procedure-definitions`],
  ] as const) {
    const res = await tl.req.get(path);
    dump(name, { status: res.status(), body: await res.json().catch(() => null) });
  }
  const admin = await apiSession(playwright, "dev.admin");
  const env = await admin.req.get("/api/v1/admin/environment");
  dump("demo-environment", { status: env.status(), body: await env.json().catch(() => null) });
});

test("UI on the demo database: labels, North Star, traceability chains, gates, walkthrough, form header", async ({
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
      await page.waitForTimeout(400);
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
    ["d06-gate-G1", `/transformations/${T}/gates/G1`],
    ["d07-reports", `/transformations/${T}/reports`],
    ["d08-walkthrough", `/walkthrough`],
    ["d09-raid", `/transformations/${T}/raid`],
    ["d10-health-check", `/transformations/${T}/health-check`],
    ["d11-launch-plan", `/transformations/${T}/launch-plan`],
    ["d12-day-90", `/transformations/${T}/day-90-test`],
    ["d13-procedures", `/playbook/procedures`],
  ]);
  // A form page header (T13 stakeholders via the change area; T01 diagnose).
  await tl.page.goto(`/transformations/${T}/diagnose`);
  await tl.page.waitForLoadState("networkidle");
  await shot(tl.page, lang, "d14-diagnose");
  await text(tl.page, lang, "d14-diagnose");
  await tl.ctx.close();
  const fin = await go("roaming.user.fin", [["d15-finance-queue", `/finance-validation`]]);
  await fin.ctx.close();
  const bo = await go("roaming.user.bo", [["d16-bo-approvals", `/my-work/approvals`]]);
  await bo.ctx.close();
  expect(true).toBe(true);
});
