// qa-verifier DG5 round 3 (T-DG5-REV-QA-R3) independent probe on the DEMO stack (e2e/support/with-demo-stack.sh).
// NOT part of the candidate: copied into a disposable clone's e2e/ only for the run, then removed.
// F-DG5-142 re-verification, beyond the candidate's own p5-table-regions-axe.spec.ts (390 px only, keyboard on one table):
//  R3-AXE: the round-2 P2-DG24 screen list (unchanged) plus the gate list, G2, G3, G5, the approval decisions and the
//          dashboards hub with a business unit, at 390 x 844, at 1366 x 900 and at 1280 x 900 with 200 % text:
//          axe serious/critical = none; every horizontally scrolling element in main is focusable + role=region + named;
//          every .table-wrap (scrolling or not) is focusable + role=region + named; page overflow <= 1 px.
//          ASSERTED (round 2 only reported).
//  R3-KBD: at 390 px, for EVERY horizontally scrolling element on those screens: real Tab presses from the top of the
//          page (bounded) reach it, and the arrow key of the reading direction scrolls it (|scrollLeft| changes).
//  R3-NAMES: duplicate region names per page are reported (FE-X1 observation: identical names on the dashboards).
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage, DEMO_BU, type DemoRole } from "./support/a02-demo.ts";

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
  name: string;
  scrolls: boolean;
  tableWrap: boolean;
  ok: boolean;
}

/** Every element in main that scrolls horizontally, plus every .table-wrap; tagged with data-qa-r3 for later lookup. */
async function regions(page: Page): Promise<Region[]> {
  return page.evaluate(() => {
    const out: Region[] = [];
    let idx = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main#main *"))) {
      const ox = getComputedStyle(el).overflowX;
      const scrolls = (ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1;
      const tableWrap = el.classList.contains("table-wrap");
      if (!scrolls && !tableWrap) continue;
      el.setAttribute("data-qa-r3", String(idx));
      const name = (el.getAttribute("aria-label") ?? "").trim();
      out.push({
        idx,
        el: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).join(".")}`,
        tabIndex: el.tabIndex,
        role: el.getAttribute("role"),
        name,
        scrolls,
        tableWrap,
        ok: el.tabIndex >= 0 && el.getAttribute("role") === "region" && name !== "",
      });
      idx++;
    }
    return out;
  });
}

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function openAt(p: Page, url: string, w: number, h: number, fontPct?: number) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible();
  if (fontPct) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), fontPct);
  await p.waitForLoadState("networkidle");
}

/** Real Tab presses from the top; returns the set of data-qa-r3 indices that received focus. */
async function tabWalk(p: Page, max: number): Promise<{ reached: number[]; presses: number }> {
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.locator("body").focus();
  const reached = new Set<number>();
  let presses = 0;
  let lastKey = "";
  let repeats = 0;
  for (; presses < max; presses++) {
    await p.keyboard.press("Tab");
    const k = await p.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a ? `${a.getAttribute("data-qa-r3") ?? ""}|${a.tagName}|${a.id}|${a.textContent?.slice(0, 20)}` : "";
    });
    const idx = k.split("|")[0];
    if (idx !== "") reached.add(Number(idx));
    if (k === lastKey) {
      if (++repeats > 3) break;
    } else repeats = 0;
    lastKey = k;
    if (k.startsWith("|BODY")) break; // wrapped out of the document
  }
  return { reached: [...reached].sort((a, b) => a - b), presses };
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
  // The round-2 P2-DG24 list, unchanged ...
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
  // ... plus round-3 additions.
  urls.push(
    ["tl", `${base}/gates`],
    ["tl", `${base}/gates/G2`],
    ["tl", `${base}/gates/G3`],
    ["tl", `${base}/gates/G5`],
    ["tl", `${base}/approval-decisions`],
    ["fin", "/dashboards/finance"],
    ["cm", "/dashboards/adoption"],
    ["tl", "/dashboards/personal"],
    ["sp", `${base}/dashboard`],
    ["sp", `/executive-overview?businessUnitId=${DEMO_BU}`],
  );
  return urls;
}

test("R3-AXE + R3-KBD + R3-NAMES: DG2-DG4 table regions on demo data at 390 / 1366 / 200 %", async ({ browser, playwright }, info) => {
  const lang: Lang = langOf(info);
  const urls = await screenList(playwright);
  const pages = new Map<string, Page>();
  const rows: Array<Record<string, unknown>> = [];
  for (const [role, url] of urls) {
    let p = pages.get(role);
    if (!p) pages.set(role, (p = await demoPage(browser, lang, role)));
    const row: Record<string, unknown> = { role, url: url.replace(ROAMING, "<T>") };
    try {
      // 390 px: regions, axe, keyboard
      await openAt(p, url, 390, 844);
      const r390 = await regions(p);
      row["overflow390"] = await overflowOf(p);
      row["regions390"] = r390;
      row["axe390"] = await serious(p);
      const scrolling = r390.filter((r) => r.scrolls);
      const walk = await tabWalk(p, 600);
      row["tabPresses"] = walk.presses;
      const kbd: Array<Record<string, unknown>> = [];
      for (const r of scrolling) {
        const loc = p.locator(`[data-qa-r3='${r.idx}']`);
        let reached = walk.reached.includes(r.idx);
        let targetedPresses: number | null = null;
        if (!reached) {
          // Run-1 fix: a targeted walk from the top until THIS region holds focus (bounded), as the candidate's spec does.
          await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await p.locator("body").focus();
          for (targetedPresses = 0; targetedPresses < 600 && !reached; targetedPresses++) {
            await p.keyboard.press("Tab");
            reached = await loc.evaluate((el) => document.activeElement === el);
          }
        }
        // Focus it the way Tab did (it was reached), then scroll with the reading-direction arrow key.
        // Run-1 fix: Tab through the links inside a region scrolls it (to its end); start from the reading start (0).
        await loc.focus();
        await loc.evaluate((el) => (el.scrollLeft = 0));
        const before = await loc.evaluate((el) => el.scrollLeft);
        const key = lang === "ar" ? "ArrowLeft" : "ArrowRight";
        for (let i = 0; i < 6; i++) await p.keyboard.press(key);
        await p.waitForTimeout(250);
        const after = await loc.evaluate((el) => el.scrollLeft);
        kbd.push({ idx: r.idx, name: r.name, reached, targetedPresses, scrollLeftBefore: before, scrollLeftAfter: after, scrolled: Math.abs(after - before) > 0 });
      }
      row["kbd390"] = kbd;
      const names = r390.map((r) => r.name).filter((n) => n);
      row["duplicateNames390"] = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      // 1366 px
      await openAt(p, url, 1366, 900);
      row["axe1366"] = await serious(p);
      row["regions1366"] = await regions(p);
      // 200 % text
      await openAt(p, url, 1280, 900, 200);
      row["axe200pct"] = await serious(p);
      row["overflow200pct"] = await overflowOf(p);
      row["regions200pct"] = await regions(p);
    } catch (e) {
      row["error"] = String(e).slice(0, 400);
    }
    rows.push(row);
  }
  for (const p of pages.values()) await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r3-regions-all.json"), JSON.stringify(rows, null, 1));
  const problems: string[] = [];
  let nScroll = 0;
  for (const r of rows) {
    const u = r["url"] as string;
    if (r["error"]) problems.push(`${u}: error ${r["error"]}`);
    for (const k of ["axe390", "axe1366", "axe200pct"]) if (((r[k] as string[]) ?? []).length) problems.push(`${u}: ${k} ${JSON.stringify(r[k])}`);
    for (const k of ["regions390", "regions1366", "regions200pct"])
      for (const g of (r[k] as Region[]) ?? []) if (!g.ok) problems.push(`${u}: ${k} not ok ${JSON.stringify(g)}`);
    if (((r["overflow390"] as number) ?? 0) > 1 || ((r["overflow200pct"] as number) ?? 0) > 1) problems.push(`${u}: page overflow`);
    for (const k of (r["kbd390"] as Array<Record<string, unknown>>) ?? []) {
      nScroll++;
      if (!k["reached"]) problems.push(`${u}: region ${k["name"]} not reached by Tab`);
      if (!k["scrolled"]) problems.push(`${u}: region ${k["name"]} did not scroll with the arrow key`);
    }
  }
  const dups = rows.filter((r) => ((r["duplicateNames390"] as string[]) ?? []).length).map((r) => [r["url"], r["duplicateNames390"]]);
  console.info(`R3 ${lang}: ${rows.length} screens, ${nScroll} scrolling regions at 390 px checked by keyboard; duplicate names: ${JSON.stringify(dups)}; problems: ${JSON.stringify(problems)}`);
  expect(problems).toEqual([]);
});
