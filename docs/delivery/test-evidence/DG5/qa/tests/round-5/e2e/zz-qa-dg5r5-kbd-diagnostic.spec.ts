// qa-verifier DG5 round 5: DIAGNOSTIC for the keyboard-scroll misses of the UNCHANGED round-3 probe R3-REG in this
// round (05-e2e-probe-r3regions-*.log): "focused: true, scrollLeft 0 -> 0" on regions that R3-TAB (real Tab presses)
// and my round-5 probe scroll. On the DEMO stack, at 390 x 844, for six screens R3-REG flagged, and five trials each,
// it compares three ways of reaching the first scrolling region and pressing the reading-direction arrow six times:
//  A  "r3reg": R3-REG's exact sequence (open, wait networkidle, open <details>, axe analyze, el.scrollLeft = 0 and
//     el.focus() inside page.evaluate, six key presses, poll scrollLeft 5 s);
//  B  "r3reg-noaxe": the same without the axe run;
//  C  "tab": real Tab presses from the top of the page until the region has focus (bounded at 80), then the keys.
// For each trial it records: focus before/after the keys (document.activeElement === region), document.hasFocus(),
// and scrollLeft before/after. REPORTED, not asserted: it only explains the probe result. NOT part of the candidate.
// SYNTHETIC demo data; approves nothing real.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoPage } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r5-kbd");
const base = `/transformations/${ROAMING}`;
const SCREENS = [base, `${base}/charter`, `${base}/readiness`, `${base}/diagnose`, `${base}/gates/G1`, `${base}/kpis`];

async function open(p: Page, url: string) {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(url);
  await p.locator("main#main h1").first().waitFor({ state: "visible", timeout: 30_000 });
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.querySelectorAll("main#main details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await p.waitForTimeout(300);
  return p.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main#main *"))) {
      if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
      const ox = getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
        el.setAttribute("data-qa-r5k", "0");
        return true;
      }
    }
    return false;
  });
}

async function poll(p: Page, before: number) {
  const loc = p.locator("[data-qa-r5k='0']");
  let v = before;
  for (let t = 0; t < 50 && v === before; t++) {
    await p.waitForTimeout(100);
    v = await loc.evaluate((el) => el.scrollLeft);
  }
  return v;
}

async function trial(p: Page, lang: Lang, url: string, method: "r3reg" | "r3reg-noaxe" | "tab") {
  const found = await open(p, url);
  if (!found) return { method, found };
  const key = lang === "ar" ? "ArrowLeft" : "ArrowRight";
  const loc = p.locator("[data-qa-r5k='0']");
  if (method === "r3reg") await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  let tabs = 0;
  if (method === "tab") {
    await p.locator("body").focus();
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    while (tabs < 80 && !(await loc.evaluate((el) => document.activeElement === el))) {
      await p.keyboard.press("Tab");
      tabs++;
    }
  } else {
    await loc.evaluate((el: HTMLElement) => {
      el.scrollLeft = 0;
      el.focus();
    });
  }
  const focusedBefore = await loc.evaluate((el) => document.activeElement === el);
  const hasFocus = await p.evaluate(() => document.hasFocus());
  const before = await loc.evaluate((el) => el.scrollLeft);
  for (let i = 0; i < 6; i++) await p.keyboard.press(key);
  const focusedAfter = await loc.evaluate((el) => document.activeElement === el);
  const after = await poll(p, before);
  return { method, found, tabs, focusedBefore, focusedAfter, hasFocus, before, after, scrolled: after !== before };
}

test("R5-KBD: keyboard scrolling of the first region on six R3-REG screens, three methods, five trials", async ({ browser }, info) => {
  test.setTimeout(900_000);
  const lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  const out: Record<string, unknown[]> = {};
  const tally: Record<string, { trials: number; scrolled: number }> = {};
  for (const url of SCREENS)
    for (const method of ["r3reg", "r3reg-noaxe", "tab"] as const)
      for (let i = 0; i < 5; i++) {
        const r = await trial(p, lang, url, method);
        (out[`${url.replace(ROAMING, "<roaming>")} ${method}`] ??= []).push(r);
        const t = (tally[method] ??= { trials: 0, scrolled: 0 });
        if (r.found) {
          t.trials++;
          if ((r as { scrolled?: boolean }).scrolled) t.scrolled++;
        }
      }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r5-kbd.json"), JSON.stringify({ tally, out }, null, 1));
  console.info(`R5-KBD ${lang}: tally ${JSON.stringify(tally)}`);
  for (const [k, v] of Object.entries(out))
    console.info(`R5-KBD ${lang} ${k}: ${v.map((r) => JSON.stringify(r)).join(" ")}`);
});
