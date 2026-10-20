// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4B): measurement for D-175 observation (n) on the DEMO stack
// (e2e/support/with-demo-stack.sh). NOT part of the candidate: copied into a disposable clone's e2e/ for the run only.
//  R4-WORDS: /transformations/<roaming>/diagnose at 390 x 844, 1280 x 900 with 200 % text, and 1366 x 900 (baseline).
//            For every rendered table cell (th/td) inside a workstream card, every whitespace-separated word is checked:
//            is it laid out on ONE line (a Range over the word has client rects on one line only)? Reports, per
//            layout and per cell kind (column header, row header, text cell, other cell), the number of words and of
//            words broken inside the word, with examples, and the page-level overflow. It ASSERTS ONLY the set-up
//            (cards rendered, words found) and the page-level overflow (F-DG5-144), never the mid-word count: that is
//            the observation to be judged, recorded as data. It also asserts that no rendered element sticks out of
//            its (now shrinkable) workstream card outside a horizontal scroll container.
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoPage } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
test.setTimeout(300_000);

test("R4-WORDS: mid-word breaks in the Diagnose registers (observation (n)); no page-level overflow", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  const out: Record<string, unknown> = {};
  for (const [label, w, h, font] of [
    ["390", 390, 844, 0],
    ["200pct", 1280, 900, 200],
    ["1366", 1366, 900, 0],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`/transformations/${ROAMING}/diagnose`);
    await expect(p.locator("main#main h1")).toBeVisible();
    await expect(p.locator("article.workstream").first()).toBeVisible();
    if (font) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const linesOf = (rects: DOMRectList) =>
        new Set(Array.from(rects).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
      const kinds: Record<string, { words: number; broken: number; examples: string[]; cells: number }> = {};
      for (const cell of Array.from(document.querySelectorAll<HTMLElement>("article.workstream th, article.workstream td"))) {
        if (!cell.checkVisibility()) continue;
        const kind =
          cell.tagName === "TH" && cell.closest("thead")
            ? "column-header"
            : cell.tagName === "TH"
              ? "row-header"
              : cell.classList.contains("text-cell") || cell.querySelector(".text-cell")
                ? "text-cell"
                : "other-cell";
        const k = (kinds[kind] ??= { words: 0, broken: 0, examples: [], cells: 0 });
        k.cells++;
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? "";
          const re = /\S+/g;
          for (let m = re.exec(text); m; m = re.exec(text)) {
            k.words++;
            const range = document.createRange();
            range.setStart(n, m.index);
            range.setEnd(n, m.index + m[0].length);
            if (linesOf(range.getClientRects()) > 1) {
              k.broken++;
              if (k.examples.length < 8) k.examples.push(`${m[0]} (cell ${Math.round(cell.getBoundingClientRect().width)} px)`);
            }
          }
        }
      }
      // The cards are now shrinkable grid items (FE-Y1): does any rendered element stick out of its card's box, outside
      // a horizontal scroll container (content cut off or overlapping the neighbour, which page overflow may not show)?
      const outsideCard: string[] = [];
      for (const a of Array.from(document.querySelectorAll<HTMLElement>("article.workstream"))) {
        const ar = a.getBoundingClientRect();
        for (const el of Array.from(a.querySelectorAll<HTMLElement>("*"))) {
          if (!el.checkVisibility()) continue;
          let scroller = false;
          for (let x = el.parentElement; x && x !== a; x = x.parentElement) {
            const ox = getComputedStyle(x).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") scroller = true;
          }
          if (scroller) continue;
          const r = el.getBoundingClientRect();
          // > 1 px: a visually hidden (sr-only, 1 x 1 px) element is not rendered content
          if (r.width > 1 && r.height > 1 && (r.left < ar.left - 1 || r.right > ar.right + 1) && outsideCard.length < 12)
            outsideCard.push(
              `${a.dataset["workstream"]}: ${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}] card [${Math.round(ar.left)}..${Math.round(ar.right)}] "${(el.textContent ?? "").trim().slice(0, 40)}"`,
            );
        }
      }
      return { W: window.innerWidth, pageOverflow: document.documentElement.scrollWidth - window.innerWidth, outsideCard, kinds };
    });
    out[label] = r;
    await shot(p, lang, `r4-words-diagnose-${label}`);
  }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-words-diagnose.json"), JSON.stringify(out, null, 1));
  console.info(`R4-WORDS ${lang}: ${JSON.stringify(out)}`);
  for (const [label, r] of Object.entries(out) as [string, { pageOverflow: number; outsideCard: string[]; kinds: Record<string, { words: number }> }][]) {
    expect(r.pageOverflow, `${label} page overflow`).toBeLessThanOrEqual(1);
    expect(r.outsideCard, `${label} content outside its card`).toEqual([]);
    expect(Object.values(r.kinds).reduce((a, k) => a + k.words, 0), `${label} words found`).toBeGreaterThan(0);
  }
});
