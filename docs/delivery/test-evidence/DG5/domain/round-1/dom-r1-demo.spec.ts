// domain-reviewer DG5 round 1 (T-DG5-RG2-DOM-R1): my own black-box probe of the DEMO-initialized stack
// (e2e/support/with-demo-stack.sh: seed-demo, MTH_ENV=demo, AUTH_MODE=dev; demo role users roaming.user.* sign in
// through the dev sign-in, D-165). Copied into the disposable clone as e2e/zz-dom-r1-demo.spec.ts; chromium-en and
// chromium-ar. Everything is SYNTHETIC, the International Roaming example is illustrative (B0144), and nothing here
// approves anything real or names an engineering gate. Screenshots: E2E_SCREENSHOT_DIR/<lang>/dom-demo-*.png.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, shot, signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoApi, demoPage } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ROAMING = "01995000-0000-7000-8000-000000000001";
const fact = (o: Record<string, unknown>) => console.log("DOMFACT " + JSON.stringify(o));
const PLAYBOOK = readFileSync(path.join("docs", "source", "playbook.md"), "utf8");
const rowsOf = (ref: string) =>
  PLAYBOOK.slice(PLAYBOOK.indexOf(`<!-- ${ref} table -->`))
    .split("\n")
    .slice(3)
    .filter((l) => l.startsWith("| "))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
const B0145 = rowsOf("B0145").slice(0, 7);
const B0147 = rowsOf("B0147").slice(0, 3);
const text = async (p: Page) => (await p.locator("body").innerText()).replace(/\s+/g, " ");

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

async function open(p: Page, lang: Lang, url: string, name: string) {
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible();
  await p.waitForTimeout(1200);
  const t = await text(p);
  const banner = await p.locator("[data-state='demo-synthetic']").count();
  const badge = t.includes(catalogue(lang, "playbookP5.demo.recordBadge"));
  fact({ p: "D", lang, url, banner, recordBadge: badge, dir: await p.locator("html").getAttribute("dir"), dg: /\bDG[0-7]\b/.test(t) });
  await shot(p, lang, `dom-demo-${name}`);
  return t;
}

test("D1 roaming record: North Star, the seven B0145 elements, labels; gates carry the synthetic approval label", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.tl");
  let t = await open(page, lang, `/transformations/${ROAMING}`, "transformation");
  fact({ p: "D1", lang, northStar: t.includes("Make international roaming effortless, trusted and economically accretive.") });
  const tl = await demoApi(playwright, "tl");
  const tr0 = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}`);
  fact({ p: "D1", lang, apiTransformation: { name: tr0.name, northStar: tr0.northStar ?? null, keys: Object.keys(tr0).slice(0, 40) } });
  const env = await tl.call<Body>("GET", "/api/v1/admin/environment").catch((e) => ({ error: String(e).slice(0, 200) }));
  fact({ p: "D1", lang, environment: env });
  t = await open(page, lang, `/transformations/${ROAMING}/charter`, "charter");
  fact({ p: "D1", lang, charterNorthStar: t.includes("Make international roaming effortless, trusted and economically accretive."), b0145InCharter: B0145.map(([k, v]) => [k, t.includes(v!)]) });
  t = await open(page, lang, `/transformations/${ROAMING}/gates`, "gates");
  for (const g of ["G1", "G2", "G3"]) {
    t = await open(page, lang, `/transformations/${ROAMING}/gates/${g}`, `gate-${g}`);
    fact({ p: "D1", lang, gate: g, approvalLabel: t.includes(catalogue(lang, "playbookP5.demo.approvalLabel")) });
  }
  t = await open(page, lang, `/transformations/${ROAMING}/benefits`, "benefits");
  t = await open(page, lang, `/transformations/${ROAMING}/health-check`, "health-check");
  t = await open(page, lang, `/transformations/${ROAMING}/dashboard`, "dashboard");
});

test("D2 traceability view renders the three B0147 chains", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.tl");
  const t = await open(page, lang, `/transformations/${ROAMING}/traceability`, "traceability");
  const present = B0147.map((row) => row.map((cell) => [cell, t.includes(cell)]));
  fact({ p: "D2", lang, chainsLabelsPresent: present, counts: await page.locator("[data-graph-counts]").getAttribute("data-graph-counts").catch(() => null) });
  // Focus on the first chain's problem node when the view offers it.
  const node = page.locator(".trace-node", { hasText: "Low activation" }).first();
  if ((await node.count()) > 0) {
    const focus = node.locator("[data-action='focus']");
    if ((await focus.count()) > 0) {
      await focus.first().click();
      await page.waitForTimeout(1500);
      const ft = await text(page);
      fact({ p: "D2", lang, focused: true, chain1: B0147[0]!.map((c) => [c, ft.includes(c)]), chain2Labels: B0147[1]!.map((c) => [c, ft.includes(c)]) });
      await shot(page, lang, "dom-demo-traceability-chain1");
    }
  }
});

test("D3 walkthrough and environment screens; inbox approval label; Finance queue; TOM design", async ({ page, browser }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.tl");
  await open(page, lang, `/walkthrough`, "walkthrough");
  fact({ p: "D3", lang, walkthroughListItems: await page.locator("main ol > li").count() });
  const d = await open(page, lang, `/transformations/${ROAMING}/design`, "design");
  fact({ p: "D3", lang, tomFocusOnDesign: d.includes("Product/pricing, digital journey") });
  const bo = await demoPage(browser, lang, "bo");
  await open(bo, lang, "/my-work/approvals", "approvals-bo");
  const first = bo.locator("main a[href*='/my-work/approvals/']").first();
  if ((await first.count()) > 0) {
    await first.click();
    await expect(bo.locator("main#main h1")).toBeVisible();
    await bo.waitForTimeout(1500);
    const t = await text(bo);
    fact({ p: "D3", lang, inboxApprovalLabel: t.includes(catalogue(lang, "playbookP5.demo.approvalLabel")), url: bo.url() });
    await shot(bo, lang, "dom-demo-approval-detail");
  } else fact({ p: "D3", lang, inboxApprovalLabel: "no approval link" });
  const fin = await demoPage(browser, lang, "fin");
  const f = await open(fin, lang, `/transformations/${ROAMING}/finance-validations`, "finance-queue");
  fact({ p: "D3", lang, financeApprovalLabel: f.includes(catalogue(lang, "playbookP5.demo.approvalLabel")) });
  const adm = await demoPage(browser, lang, "adm_access");
  await open(adm, lang, "/admin/demo", "environment");
});
