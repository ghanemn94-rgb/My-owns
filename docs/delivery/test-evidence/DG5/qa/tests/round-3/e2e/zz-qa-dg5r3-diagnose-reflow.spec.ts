// qa-verifier DG5 round 3: diagnose the page-level horizontal overflow of /transformations/<roaming>/diagnose at 390 px
// (found by zz-qa-dg5r3-regions-verify.spec.ts R3-REG) on the DEMO stack. Reports, per workstream card, its width and
// the descendants whose own min-content forces the card wider than the viewport (outside any scroll container), then
// measures the page overflow again with the grid items allowed to shrink (`.workstreams > * { min-inline-size: 0 }`,
// injected in the browser only; no product file changes). SYNTHETIC data; approves nothing real.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoPage } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r3");
test.setTimeout(300_000);

test("R3-DIAG: diagnose at 390 px and 200 % text: which element widens the workstream cards", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  const out: Record<string, unknown> = {};
  for (const [label, w, font] of [
    ["390", 390, 0],
    ["200pct", 1280, 200],
  ] as const) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`/transformations/${ROAMING}/diagnose`);
    await expect(p.locator("main#main h1")).toBeVisible();
    if (font) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const W = window.innerWidth;
      const pageOverflow = document.documentElement.scrollWidth - W;
      const grid = document.querySelector<HTMLElement>(".workstreams");
      const cards = Array.from(document.querySelectorAll<HTMLElement>("article.workstream")).map((a) => {
        const wide: string[] = [];
        for (const el of Array.from(a.querySelectorAll<HTMLElement>("*"))) {
          let scroller = false;
          for (let x = el.parentElement; x && x !== a; x = x.parentElement) {
            const ox = getComputedStyle(x).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden") scroller = true;
          }
          if (scroller) continue;
          const ow = el.getBoundingClientRect().width;
          // An element as wide as the card is the culprit path; list the deepest such elements.
          if (ow > W - 40 && !Array.from(el.children).some((c) => (c as HTMLElement).getBoundingClientRect().width > W - 40)) {
            const cs = getComputedStyle(el);
            wide.push(
              `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")} w=${Math.round(ow)} display=${cs.display} white-space=${cs.whiteSpace} text="${(el.textContent ?? "").trim().slice(0, 60)}"`,
            );
          }
        }
        return { code: a.dataset["workstream"], width: Math.round(a.getBoundingClientRect().width), deepestWide: wide.slice(0, 8) };
      });
      const gridCols = grid ? getComputedStyle(grid).gridTemplateColumns : null;
      // Injected browser-side only: let the grid items shrink, then measure again.
      const style = document.createElement("style");
      style.textContent = ".workstreams > * { min-inline-size: 0; }";
      document.head.appendChild(style);
      const after = document.documentElement.scrollWidth - W;
      const cardWidthAfter = Math.round(document.querySelector("article.workstream")?.getBoundingClientRect().width ?? 0);
      style.remove();
      return { W, pageOverflow, gridWidth: grid?.getBoundingClientRect().width, gridCols, cards, withShrinkableGridItems: { pageOverflow: after, cardWidth: cardWidthAfter } };
    });
    out[label] = r;
    await shot(p, lang, `r3-diag-diagnose-${label}`);
  }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r3-diag-diagnose.json"), JSON.stringify(out, null, 1));
  console.info(`R3-DIAG ${lang}: ${JSON.stringify(out)}`);
});
