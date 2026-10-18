// qa-verifier DG5 round 2 (T-DG5-REV-QA-R2) independent probes on the DEMO stack (e2e/support/with-demo-stack.sh).
// NOT part of the candidate: copied into a disposable clone's e2e/ only for the run, then removed.
//  P2-AXE: the 31 P5 screens of the round-1 probe (populated SYNTHETIC roaming data) — axe (no serious/critical)
//          at 1366 x 900 and at 1280 x 900 with 200 % text (the round-1 probe ran axe at 390 px only; it is re-run
//          unchanged separately), plus a scroll-region audit at 390 px and with 200 % text: every element that
//          scrolls horizontally (overflow-x auto/scroll and scrollWidth > clientWidth) must be keyboard-focusable
//          (tabIndex >= 0) and named (role=region + non-empty aria-label), else it is reported.
//  P2-KBD: F-DG5-141 / F-DG5-140 — on /admin/source-coverage and /admin/studio/scoring-defaults at 390 px, real
//          Tab presses from the top of the page reach the table region, and arrow keys scroll it (scrollLeft
//          changes; in ar the arrows run right-to-left).
//  P2-DG24: observation (f) of D-171 — DG2-DG4 screens that still hold bare .table-wrap elements, on populated demo
//          data, at 390 px: axe serious/critical and the same scroll-region audit.
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoApi, demoPage, type DemoRole } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r2");
test.setTimeout(1_200_000);

async function serious(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** Every horizontally scrolling element in main, and whether it is focusable and named. */
async function scrollRegions(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main#main *"))) {
      const ox = getComputedStyle(el).overflowX;
      if (ox !== "auto" && ox !== "scroll") continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      out.push({
        el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).join(".")}`,
        tabIndex: el.tabIndex,
        role: el.getAttribute("role"),
        name: el.getAttribute("aria-label"),
        excess: el.scrollWidth - el.clientWidth,
        ok: el.tabIndex >= 0 && el.getAttribute("role") === "region" && (el.getAttribute("aria-label") ?? "").trim() !== "",
      });
    }
    return out;
  });
}

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const P5_SCREENS: Array<[DemoRole, string]> = [
  ["tl", "/playbook/reader"],
  ["tl", "/playbook/reader/B0031"],
  ["tl", "/playbook/procedures"],
  ["tl", "/playbook/launch-plan"],
  ["tl", "/playbook/health-check"],
  ["tl", `/transformations/${ROAMING}/launch-plan`],
  ["tl", `/transformations/${ROAMING}/day-90-test`],
  ["tl", `/transformations/${ROAMING}/health-check`],
  ["tl", `/transformations/${ROAMING}/reports`],
  ["tl", `/transformations/${ROAMING}/exports`],
  ["tl", `/transformations/${ROAMING}/presentation`],
  ["tl", `/transformations/${ROAMING}/owner-updates`],
  ["tl", `/transformations/${ROAMING}/evidence-register`],
  ["tl", `/transformations/${ROAMING}/financial-metrics`],
  ["tl", `/transformations/${ROAMING}/gate-conditions`],
  ["tl", `/transformations/${ROAMING}/config-pins`],
  ["tl", `/transformations/${ROAMING}/traceability`],
  ["tl", "/walkthrough"],
  ["tl", "/my-work/notification-preferences"],
  ["to", "/admin/studio"],
  ["to", "/admin/studio/scoring-defaults"],
  ["to", "/admin/forms"],
  ["to", "/admin/procedures"],
  ["to", "/admin/automation"],
  ["to", "/admin/automation/failures"],
  ["to", "/admin/jobs/operations"],
  ["to", "/admin/approval-routes"],
  ["to", "/admin/source-coverage"],
  ["to", "/admin/health-schemes"],
  ["adm_access", "/admin/branding"],
  ["adm_access", "/admin/demo"],
];

async function openAt(p: Page, url: string, w: number, h: number, fontPct?: number) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible();
  if (fontPct) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), fontPct);
  await p.waitForLoadState("networkidle");
}

test("P2-AXE: 31 P5 screens on demo data — axe at 1366 px and with 200 % text; scroll regions focusable and named at 390 px and 200 %", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const pages = new Map<string, Page>();
  const rows: Array<Record<string, unknown>> = [];
  for (const [role, url] of P5_SCREENS) {
    let p = pages.get(role);
    if (!p) pages.set(role, (p = await demoPage(browser, lang, role)));
    const row: Record<string, unknown> = { role, url: url.replace(ROAMING, "<roaming>") };
    await openAt(p, url, 390, 844);
    row["regions390"] = await scrollRegions(p);
    await openAt(p, url, 1366, 900);
    row["axe1366"] = await serious(p);
    await openAt(p, url, 1280, 900, 200);
    row["axe200pct"] = await serious(p);
    row["overflow200pct"] = await overflowOf(p);
    row["regions200pct"] = await scrollRegions(p);
    rows.push(row);
  }
  for (const p of pages.values()) await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "p2-axe-regions.json"), JSON.stringify(rows, null, 1));
  const bad = rows.filter(
    (r) =>
      (r["axe1366"] as string[]).length ||
      (r["axe200pct"] as string[]).length ||
      (r["overflow200pct"] as number) > 1 ||
      (r["regions390"] as Array<{ ok: boolean }>).some((x) => !x.ok) ||
      (r["regions200pct"] as Array<{ ok: boolean }>).some((x) => !x.ok),
  );
  const nRegions = rows.reduce((n, r) => n + (r["regions390"] as unknown[]).length, 0);
  console.info(`P2-AXE ${lang}: ${rows.length} screens, ${nRegions} scrolling regions at 390 px, ${bad.length} bad: ${JSON.stringify(bad)}`);
  expect(bad).toEqual([]);
});

for (const [role, url, sel] of [
  // the scroll region itself (the first one in document order)
  ["to", "/admin/source-coverage", ".table-wrap:has(table[data-table='coverage'])"],
  ["to", "/admin/studio/scoring-defaults", "fieldset[data-rubric] > .table-wrap"],
] as Array<[DemoRole, string, string]>) {
  test(`P2-KBD: ${url} at 390 px — Tab reaches the table's scroll region and the arrow keys scroll it`, async ({ browser }, info) => {
    const lang: Lang = langOf(info);
    const p = await demoPage(browser, lang, role);
    await openAt(p, url, 390, 844);
    const region = p.locator(sel).first();
    await expect(region).toBeVisible();
    const attrs = await region.evaluate((el: HTMLElement) => ({
      tabIndex: el.tabIndex,
      role: el.getAttribute("role"),
      name: el.getAttribute("aria-label"),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // Real keyboard: focus the document start, then Tab until the region holds focus (bounded).
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await p.locator("body").focus();
    let presses = 0;
    let reached = false;
    for (; presses < 250 && !reached; presses++) {
      await p.keyboard.press("Tab");
      reached = await region.evaluate((el) => document.activeElement === el);
    }
    const before = await region.evaluate((el) => el.scrollLeft);
    const key = lang === "ar" ? "ArrowLeft" : "ArrowRight";
    for (let i = 0; i < 6; i++) await p.keyboard.press(key);
    await p.waitForTimeout(300);
    const after = await region.evaluate((el) => el.scrollLeft);
    const stillFocused = await region.evaluate((el) => document.activeElement === el);
    const pageOverflow = await overflowOf(p);
    const res = { lang, url, attrs, reached, presses, scrollLeftBefore: before, scrollLeftAfter: after, stillFocused, pageOverflow };
    mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
    writeFileSync(path.join(EVIDENCE, lang, `p2-kbd-${url.replace(/[^a-z]+/g, "_")}.json`), JSON.stringify(res, null, 1));
    await shot(p, lang, `r2-kbd${url.replace(/[^a-z]+/g, "_")}`);
    console.info(`P2-KBD ${JSON.stringify(res)}`);
    expect(attrs.tabIndex).toBe(0);
    expect(attrs.role).toBe("region");
    expect((attrs.name ?? "").trim()).not.toBe("");
    expect(attrs.scrollWidth).toBeGreaterThan(attrs.clientWidth); // it really scrolls at 390 px
    expect(reached).toBe(true);
    expect(Math.abs(after - before)).toBeGreaterThan(0);
    expect(pageOverflow).toBeLessThanOrEqual(1);
    await p.context().close();
  });
}

test("P2-S21: the seeded G1-G4 decisions (BE-V3) are shown with the synthetic approval label wherever they are listed", async ({ browser, playwright }, info) => {
  const lang: Lang = langOf(info);
  const label = catalogue(lang, "playbookP5.demo.approvalLabel");
  const tl = await demoApi(playwright, "tl");
  const statuses: Record<string, string> = {};
  for (const g of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
    const v = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/gates/${g}`);
    statuses[g] = v.gate.status;
  }
  const p = await demoPage(browser, lang, "tl");
  const res: Record<string, unknown> = { statuses };
  for (const [key, url] of [
    ["list", `/transformations/${ROAMING}/gates`],
    ["G1", `/transformations/${ROAMING}/gates/G1`],
    ["G4", `/transformations/${ROAMING}/gates/G4`],
    ["records", `/transformations/${ROAMING}/approval-decisions`],
  ]) {
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    await p.waitForLoadState("networkidle");
    const notes = p.locator("[data-state='synthetic-approval']");
    const text = (await p.locator("main#main").innerText()).replace(/\s+/g, " ");
    res[key] = {
      labelCount: await notes.count(),
      labelText: (await notes.count()) ? (await notes.first().innerText()).trim() : null,
      excerpt: key === "G4" ? text.match(/.{0,40}(mandatory|إلزامية).{0,160}/)?.[0] ?? null : null,
      rowsMentioningGate: key === "records" ? (text.match(/\bG[1-6]\b/g) ?? []).length : null,
    };
    await shot(p, lang, `r2-s21-${key}`);
  }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "p2-s21.json"), JSON.stringify(res, null, 1));
  console.info(`P2-S21 ${lang}: ${JSON.stringify(res)}`);
  expect(statuses).toEqual({ G1: "approved", G2: "approved", G3: "approved", G4: "approved", G5: "draft", G6: "draft" });
  for (const key of ["list", "G1", "G4", "records"]) {
    const r = res[key] as { labelCount: number; labelText: string | null };
    expect(r.labelCount, key).toBeGreaterThan(0);
    expect(r.labelText, key).toContain(label.trim());
  }
});

test("P2-DG24: DG2-DG4 screens with bare .table-wrap on demo data at 390 px — axe and scroll regions (observation f)", async ({ browser, playwright }, info) => {
  const lang: Lang = langOf(info);
  const tl = await demoApi(playwright, "tl");
  const list = async (u: string): Promise<Body[]> => {
    try {
      const r = await tl.call<Body>("GET", u);
      return (r.items ?? r) as Body[];
    } catch {
      return [];
    }
  };
  const base = `/transformations/${ROAMING}`;
  const urls: Array<[DemoRole, string]> = [
    ["tl", base],
    ["tl", `${base}/charter`],
    ["tl", `${base}/readiness`],
    ["tl", `${base}/gates/G4`],
    ["tl", `${base}/gates/G1`],
    ["tl", `${base}/dashboard`],
    ["tl", "/dashboards"],
    ["tl", "/executive-overview"],
    ["adm_access", "/admin/organizations"],
  ];
  const bc = await list(`/api/v1/business-cases?transformationId=${ROAMING}&limit=5`);
  if (bc[0]?.id) urls.push(["tl", `${base}/business-cases/${bc[0].id}`]);
  const ini = await list(`/api/v1/initiatives?transformationId=${ROAMING}&limit=5`);
  if (ini[0]?.id) urls.push(["tl", `${base}/initiatives/${ini[0].id}`]);
  const bf = await list(`/api/v1/benefit-formulas?transformationId=${ROAMING}&limit=5`);
  if (bf[0]?.id) urls.push(["tl", `${base}/benefit-formulas/${bf[0].id}`]);
  const pages = new Map<string, Page>();
  const rows: Array<Record<string, unknown>> = [];
  for (const [role, url] of urls) {
    let p = pages.get(role);
    if (!p) pages.set(role, (p = await demoPage(browser, lang, role)));
    const row: Record<string, unknown> = { role, url: url.replace(ROAMING, "<roaming>") };
    try {
      await openAt(p, url, 390, 844);
      row["overflow390"] = await overflowOf(p);
      row["regions390"] = await scrollRegions(p);
      row["axe390"] = await serious(p);
      await shot(p, lang, `r2-dg24-390${url.replace(ROAMING, "T").replace(/[^a-zA-Z0-9]+/g, "_")}`);
    } catch (e) {
      row["error"] = String(e).slice(0, 300);
    }
    rows.push(row);
  }
  for (const p of pages.values()) await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "p2-dg24.json"), JSON.stringify(rows, null, 1));
  console.info(`P2-DG24 ${lang}: ${JSON.stringify(rows)}`);
  // Reported, not asserted: this is a judgement input for observation (f).
});
