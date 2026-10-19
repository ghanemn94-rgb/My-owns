// qa-verifier DG5 round 3 (T-DG5-REV-QA-R3B): independent verification of F-DG5-142 on the DEMO stack
// (e2e/support/with-demo-stack.sh). NOT part of the candidate: copied into a disposable clone's e2e/ for the run only.
// Written from scratch for this round (the orphaned R3 run's material is not used).
//  R3-REG: the round-2 P2-DG24 screens plus further DG2-DG4 screens (gates list, G2/G3/G5/G6, diagnose, closure, BAU,
//          prioritization, roadmap, approval decisions, KPI list, admin users), on populated SYNTHETIC roaming data, at
//          390 x 844, 1366 x 900 and 1280 x 900 with 200 % text:
//          - axe (the wcag2a/2aa/21a/21aa rule set of apps/web/e2e/support/ui.ts) reports no serious/critical issue;
//          - every horizontally scrolling element in main (computed overflow-x auto|scroll, scrollWidth > clientWidth)
//            is tabIndex >= 0, role=region and has a non-empty aria-label;
//          - each such element really scrolls by keyboard: it is focused with el.focus() (it accepts focus:
//            document.activeElement === el) and the arrow key of the reading direction changes scrollLeft;
//          - region names repeated on one page are recorded (D-173 observation (k)); reported, not asserted.
//  R3-TAB: the four screens of F-DG5-142 (overview, charter, readiness, benefit formula) at 390 px: REAL Tab presses
//          from the top of the page reach EVERY scrolling region in turn (bounded), and the arrow keys scroll it.
// Revision 2 (after attempt 1, whose logs are kept): every <details> in main is opened before the audits (a closed
// <details> keeps its content laid out but unrendered, so its region scrolled yet could not take focus: a probe
// artefact on the prioritization chart's data table), only rendered elements (checkVisibility) are audited, and any
// page-level overflow records its culprits (the outermost elements past the viewport edge, outside a scroll region).
// Revision 3 (after the C.UTF-8 run of revision 2, logs kept): Chromium animates keyboard scrolling, and under the
// review load a single read 250 ms after the key presses sometimes came before the animation started (scrollLeft
// still 0, while other reads caught it part-way: 112 of 186, 54, 95). The read now polls up to 5 s for a change, as
// apps/web/e2e/p5-table-regions-axe.spec.ts does with expect.poll. Nothing else changes.
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real; G1-G6 are
// product approvals and have nothing to do with the engineering gates DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage, type DemoRole } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r3");
test.setTimeout(1_800_000);

async function serious(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

interface Region {
  idx: number;
  el: string;
  tabIndex: number;
  role: string | null;
  name: string | null;
  excess: number;
  ok: boolean;
}

/** Every horizontally scrolling element in main; tags each with data-qa-r3 = its index. */
async function scrollRegions(page: Page): Promise<Region[]> {
  return page.evaluate(() => {
    const out: Region[] = [];
    let i = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main#main *"))) {
      if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
      const ox = getComputedStyle(el).overflowX;
      if (ox !== "auto" && ox !== "scroll") continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      el.setAttribute("data-qa-r3", String(i));
      const name = el.getAttribute("aria-label");
      out.push({
        idx: i++,
        el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).join(".")}`,
        tabIndex: el.tabIndex,
        role: el.getAttribute("role"),
        name,
        excess: el.scrollWidth - el.clientWidth,
        ok: el.tabIndex >= 0 && el.getAttribute("role") === "region" && (name ?? "").trim() !== "",
      });
    }
    return out;
  });
}

/** scrollLeft once it differs from `before` (polled every 100 ms, up to 5 s), else the last value read. */
async function settledScroll(loc: ReturnType<Page["locator"]>, before: number): Promise<number> {
  let v = before;
  for (let t = 0; t < 50; t++) {
    await loc.page().waitForTimeout(100);
    v = await loc.evaluate((el) => el.scrollLeft);
    if (v !== before) {
      await loc.page().waitForTimeout(300); // let the animation finish, then read the settled value
      return loc.evaluate((el) => el.scrollLeft);
    }
  }
  return v;
}

/** Focus each tagged region with el.focus() and press the reading-direction arrow; did scrollLeft change? */
async function keyboardScroll(page: Page, lang: Lang, regions: Region[]) {
  const key = lang === "ar" ? "ArrowLeft" : "ArrowRight";
  const res: Array<{ idx: number; focused: boolean; before: number; after: number; scrolled: boolean }> = [];
  for (const r of regions) {
    const loc = page.locator(`[data-qa-r3='${r.idx}']`);
    await loc.evaluate((el: HTMLElement) => {
      el.scrollLeft = 0;
      el.focus();
    });
    const focused = await loc.evaluate((el) => document.activeElement === el);
    const before = await loc.evaluate((el) => el.scrollLeft);
    for (let i = 0; i < 6; i++) await page.keyboard.press(key);
    const after = await settledScroll(loc, before);
    res.push({ idx: r.idx, focused, before, after, scrolled: Math.abs(after - before) > 0 });
  }
  return res;
}

const duplicateNames = (regions: Array<{ name: string | null }>) => {
  const n = new Map<string, number>();
  for (const r of regions) if (r.name) n.set(r.name, (n.get(r.name) ?? 0) + 1);
  return [...n.entries()].filter(([, c]) => c > 1).map(([name, c]) => `${name} x${c}`);
};

/** All named regions on the page (scrolling or not), for observation (k). */
const allRegionNames = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main#main [role='region']")).map((el) => ({
      name: el.getAttribute("aria-label"),
    })),
  );

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** The outermost elements that extend past the viewport (either edge), not inside a horizontal scroll container. */
const overflowCulprits = (page: Page) =>
  page.evaluate(() => {
    const W = window.innerWidth;
    const out: string[] = [];
    const inScroller = (el: Element) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden") && a !== document.documentElement && a !== document.body) return true;
      }
      return false;
    };
    const past = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > W + 1 || r.left < -1);
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!past(el) || inScroller(el)) continue;
      if (el.parentElement && past(el.parentElement) && !inScroller(el.parentElement) && el.parentElement !== document.body) continue;
      const r = el.getBoundingClientRect();
      const id = el.id ? `#${el.id}` : "";
      const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      out.push(`${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""} [${Math.round(r.left)}..${Math.round(r.right)}] in ${el.closest("[id]")?.id ?? "-"}`);
      if (out.length >= 12) break;
    }
    return out;
  });

const openDetails = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>("main#main details:not([open])"))) {
      d.open = true;
      n++;
    }
    return n;
  });

async function openAt(p: Page, url: string, w: number, h: number, fontPct?: number) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible();
  if (fontPct) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), fontPct);
  await p.waitForLoadState("networkidle");
  await openDetails(p);
  await p.waitForTimeout(300);
}

async function screenList(playwright: Parameters<typeof demoApi>[0]): Promise<Array<[DemoRole, string]>> {
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
    ["tl", `${base}/diagnose`],
    ["tl", `${base}/gates`],
    ["tl", `${base}/gates/G1`],
    ["tl", `${base}/gates/G2`],
    ["tl", `${base}/gates/G3`],
    ["tl", `${base}/gates/G4`],
    ["tl", `${base}/gates/G5`],
    ["tl", `${base}/gates/G6`],
    ["tl", `${base}/approval-decisions`],
    ["tl", `${base}/dashboard`],
    ["tl", `${base}/prioritization`],
    ["tl", `${base}/roadmap`],
    ["tl", `${base}/closure`],
    ["tl", `${base}/bau`],
    ["tl", `${base}/kpis`],
    ["tl", `${base}/portfolio`],
    ["tl", `${base}/capacity`],
    ["tl", `${base}/business-cases`],
    ["tl", `${base}/benefits`],
    ["tl", `${base}/finance-validations`],
    ["tl", `${base}/raid`],
    ["tl", `${base}/dispensations`],
    ["tl", `${base}/change-requests`],
    ["tl", `${base}/decisions`],
    ["tl", `${base}/phases`],
    ["tl", "/dashboards"],
    ["tl", "/executive-overview"],
    ["adm_access", "/admin/organizations"],
    ["adm_access", "/admin/users"],
  ];
  const bc = await list(`/api/v1/business-cases?transformationId=${ROAMING}&limit=10`);
  for (const b of bc.slice(0, 2)) if (b?.id) urls.push(["tl", `${base}/business-cases/${b.id}`]);
  const ini = await list(`/api/v1/initiatives?transformationId=${ROAMING}&limit=10`);
  for (const i of ini.slice(0, 2)) if (i?.id) urls.push(["tl", `${base}/initiatives/${i.id}`]);
  const bf = await list(`/api/v1/benefit-formulas?transformationId=${ROAMING}&limit=10`);
  for (const f of bf.slice(0, 2)) if (f?.id) urls.push(["tl", `${base}/benefit-formulas/${f.id}`]);
  return urls;
}

test("R3-REG: DG2-DG4 screens on demo data at 390 px, 1366 px and 200 % text: axe clean, every scrolling region focusable, named and keyboard-scrollable", async ({
  browser,
  playwright,
}, info) => {
  const lang: Lang = langOf(info);
  const urls = await screenList(playwright);
  const pages = new Map<string, Page>();
  const rows: Array<Record<string, unknown>> = [];
  for (const [role, url] of urls) {
    let p = pages.get(role);
    if (!p) pages.set(role, (p = await demoPage(browser, lang, role)));
    const row: Record<string, unknown> = { role, url: url.replace(ROAMING, "<roaming>") };
    try {
      await openAt(p, url, 390, 844);
      row["h1"] = (await p.locator("main#main h1").first().innerText()).trim();
      row["overflow390"] = await overflowOf(p);
      if ((row["overflow390"] as number) > 1) row["culprits390"] = await overflowCulprits(p);
      const r390 = await scrollRegions(p);
      row["regions390"] = r390;
      row["axe390"] = await serious(p);
      row["kbd390"] = await keyboardScroll(p, lang, r390);
      row["dupNames390"] = duplicateNames(await allRegionNames(p));
      await shot(p, lang, `r3-reg-390${url.replace(ROAMING, "T").replace(/[^a-zA-Z0-9]+/g, "_")}`);
      await openAt(p, url, 1366, 900);
      row["axe1366"] = await serious(p);
      row["regions1366"] = await scrollRegions(p);
      await openAt(p, url, 1280, 900, 200);
      row["axe200pct"] = await serious(p);
      row["overflow200pct"] = await overflowOf(p);
      if ((row["overflow200pct"] as number) > 1) row["culprits200pct"] = await overflowCulprits(p);
      const r200 = await scrollRegions(p);
      row["regions200pct"] = r200;
      row["kbd200pct"] = await keyboardScroll(p, lang, r200);
    } catch (e) {
      row["error"] = String(e).slice(0, 400);
    }
    rows.push(row);
  }
  for (const p of pages.values()) await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r3-reg.json"), JSON.stringify(rows, null, 1));
  type K = Array<{ focused: boolean; scrolled: boolean }>;
  const bad = rows.filter(
    (r) =>
      r["error"] ||
      (r["axe390"] as string[]).length ||
      (r["axe1366"] as string[]).length ||
      (r["axe200pct"] as string[]).length ||
      (r["overflow390"] as number) > 1 ||
      (r["overflow200pct"] as number) > 1 ||
      [...(r["regions390"] as Region[]), ...(r["regions1366"] as Region[]), ...(r["regions200pct"] as Region[])].some((x) => !x.ok) ||
      [...(r["kbd390"] as K), ...(r["kbd200pct"] as K)].some((k) => !k.focused || !k.scrolled),
  );
  const n390 = rows.reduce((n, r) => n + ((r["regions390"] as unknown[]) ?? []).length, 0);
  const n200 = rows.reduce((n, r) => n + ((r["regions200pct"] as unknown[]) ?? []).length, 0);
  const dups = rows.filter((r) => ((r["dupNames390"] as string[]) ?? []).length).map((r) => [r["url"], r["dupNames390"]]);
  console.info(
    `R3-REG ${lang}: ${rows.length} screens; scrolling regions ${n390} at 390 px, ${n200} at 200 %; bad ${bad.length}: ${JSON.stringify(bad)}; duplicate region names: ${JSON.stringify(dups)}`,
  );
  expect(rows.length).toBeGreaterThanOrEqual(24);
  expect(bad).toEqual([]);
});

test("R3-TAB: the four F-DG5-142 screens at 390 px: real Tab presses reach every scrolling region, and the arrow keys scroll it", async ({
  browser,
  playwright,
}, info) => {
  const lang: Lang = langOf(info);
  const tl = await demoApi(playwright, "tl");
  const bf = (await tl.call<Body>("GET", `/api/v1/benefit-formulas?transformationId=${ROAMING}&limit=5`)).items as Body[];
  const base = `/transformations/${ROAMING}`;
  const urls = [base, `${base}/charter`, `${base}/readiness`, `${base}/benefit-formulas/${bf[0].id}`];
  const p = await demoPage(browser, lang, "tl");
  const key = lang === "ar" ? "ArrowLeft" : "ArrowRight";
  const out: Array<Record<string, unknown>> = [];
  for (const url of urls) {
    await openAt(p, url, 390, 844);
    const regions = await scrollRegions(p);
    const res: Array<Record<string, unknown>> = [];
    for (const r of regions) {
      const loc = p.locator(`[data-qa-r3='${r.idx}']`);
      await p.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await p.locator("body").focus();
      let presses = 0;
      let reached = false;
      for (; presses < 400 && !reached; presses++) {
        await p.keyboard.press("Tab");
        reached = await loc.evaluate((el) => document.activeElement === el);
      }
      const before = await loc.evaluate((el) => el.scrollLeft);
      for (let i = 0; i < 6; i++) await p.keyboard.press(key);
      const after = await settledScroll(loc, before);
      res.push({ idx: r.idx, name: r.name, excess: r.excess, reached, presses, before, after, scrolled: after !== before });
    }
    out.push({ url: url.replace(ROAMING, "<roaming>"), regions: res });
    await shot(p, lang, `r3-tab${url.replace(ROAMING, "T").replace(/[^a-zA-Z0-9]+/g, "_")}`);
  }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r3-tab.json"), JSON.stringify(out, null, 1));
  console.info(`R3-TAB ${lang}: ${JSON.stringify(out)}`);
  // The defect's condition must hold: each of the four screens really has a scrolling table at 390 px.
  for (const o of out) expect((o["regions"] as unknown[]).length, String(o["url"])).toBeGreaterThan(0);
  const bad = out.flatMap((o) => (o["regions"] as Array<Record<string, unknown>>).filter((r) => !r["reached"] || !r["scrolled"]).map((r) => [o["url"], r]));
  expect(bad).toEqual([]);
});
