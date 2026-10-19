// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4): D-175 observation (n), on the DEMO stack (e2e/support/with-demo-stack.sh),
// chromium-en and chromium-ar. On /transformations/<roaming>/diagnose at 390 x 900, at 1280 x 900 with 200 % text and
// at 1366 x 900, it counts, per workstream register, the words of the statement column (`.text-cell`) whose rendered
// Range spans more than one line (a word broken inside the word), and also the page overflow and the region widths.
// It REPORTS only (one sanity assertion: the page renders workstream cards); the judgement is in the review record.
// SYNTHETIC data; approves nothing real; nothing relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, shot, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoPage } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
test.setTimeout(300_000);

test("R4-WORDS: Diagnose registers' statement cells: words broken inside the word, at 390 px, 200 % text and 1366 px", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  const out: Record<string, unknown> = {};
  for (const [label, w, font] of [
    ["390", 390, 0],
    ["200pct", 1280, 200],
    ["1366", 1366, 0],
  ] as const) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`/transformations/${ROAMING}/diagnose`);
    await expect(p.locator("main#main h1")).toBeVisible();
    await expect(p.locator("article.workstream").first()).toBeVisible();
    if (font) await p.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(500);
    out[label] = await p.evaluate(() => {
      const W = window.innerWidth;
      const regions = Array.from(document.querySelectorAll<HTMLElement>("article.workstream .table-wrap")).map((el) => {
        let words = 0;
        const broken: string[] = [];
        for (const cell of Array.from(el.querySelectorAll(".text-cell"))) {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const m of (n.textContent ?? "").matchAll(/\S+/g)) {
              words++;
              const r = document.createRange();
              r.setStart(n, m.index!);
              r.setEnd(n, m.index! + m[0].length);
              const tops = Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => x.top);
              if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 3) broken.push(m[0]);
            }
          }
        }
        return {
          where: `${el.closest("article.workstream")?.getAttribute("data-workstream") ?? "?"}`,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          textCellWords: words,
          brokenWords: broken.length,
          brokenSample: broken.slice(0, 6),
        };
      });
      return { W, pageOverflow: document.documentElement.scrollWidth - W, regions };
    });
    await shot(p, lang, `r4-words-diagnose-${label}`);
  }
  await p.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-words-diagnose.json"), JSON.stringify(out, null, 1));
  console.info(`R4-WORDS ${lang}: ${JSON.stringify(out)}`);
});
