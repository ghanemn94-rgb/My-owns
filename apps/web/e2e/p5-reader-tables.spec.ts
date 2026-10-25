// The playbook reader shows table blocks as tables, never as raw Markdown, and one-cell callout tables wrap inside the
// page (T-DG5-FE-RG1, F-DG5-122; REQ-S03-010; ADR-0049 §1) on the REAL stack (support/with-stack.sh; the seeded
// playbook blocks, verbatim from docs/source/playbook.md), chromium-en and chromium-ar. It is the domain reviewer's
// reproduction (the reader's "About this methodology" B0024 panel and block list, /playbook/reader/B0016 and
// /playbook/reader/B0124 at 1280 px) turned into a product test, at 1280 px, 390 px and 200 % text:
//  - the B0024 panel and the block list show no Markdown table syntax ("|---|", a cell pipe, "<br>"); B0024 is a
//    callout table whose cell holds the verbatim sentence;
//  - on the B0016 and B0124 pages every callout table holds the whole verbatim sentence in one cell that ends inside
//    the viewport, its region does not scroll sideways, and the page has no horizontal scroll;
//  - axe: no serious or critical issue; a screenshot of each case.
// It collects every measurement first and asserts once, so a failure names each failing case. Read-only: nothing is
// written. Nothing here approves anything real, and nothing touches the engineering delivery gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectAccessible, langOf, shot, SHOTS, signIn, tr } from "./support/ui.ts";

// The verbatim cells of the one-cell callout tables (docs/source/playbook.md).
const CELLS: Record<string, string> = {
  B0016:
    "Rule of thumb  Every transformation deliverable should answer one of four questions: Why change? What must become different? How will we execute? How will we prove value?",
  B0024:
    "PMI/Brightline connection  The playbook uses the people-centered transformation logic and transformation operating-system thinking associated with PMI/Brightline, while adding a more explicit Target Operating Model and management-consulting-style diagnostic/design layer.",
  B0124:
    "PMI BRM connection  This phase aligns with PMI Benefits Realization Management logic: identify expected benefits, deliver/measure them during execution, and sustain benefits after transition to the business.",
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
// The table blocks of the source (`<!-- Bnnnn table -->`, docs/source/playbook.md, read-only). Prose may contain a
// verbatim "|" (B0005 "Version 1.0  |  September 2026"), so only the table blocks' previews must have no pipe at all.
const TABLE_REFS = new Set(
  [...readFileSync(join(process.cwd(), "docs/source/playbook.md"), "utf8").matchAll(/<!-- (B\d{4}) table -->/g)].map(
    (m) => m[1]!,
  ),
);
const MARKDOWN = /\|---|<br\s*\/?>|(^|\n)\s*\|/;

const MODES = [
  { label: "1280 px", width: 1280, height: 900, font: "" },
  { label: "390 px", width: 390, height: 844, font: "" },
  { label: "200 % text", width: 1280, height: 900, font: "200%" },
] as const;

interface CalloutMeasure {
  text: string;
  cellRight: number;
  cellLeft: number;
  regionOverflow: number;
}

async function setMode(page: Page, mode: (typeof MODES)[number]) {
  await page.setViewportSize({ width: mode.width, height: mode.height });
  await page.evaluate((font) => {
    document.documentElement.style.fontSize = font;
  }, mode.font);
}

async function measure(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const W = window.innerWidth;
    const callouts = [...document.querySelectorAll<HTMLElement>(`${sel} table[data-block-table='callout']`)].map(
      (table) => {
        const cell = table.querySelector<HTMLElement>("th")!.getBoundingClientRect();
        const region = table.closest<HTMLElement>(".table-wrap")!;
        return {
          text: table.querySelector("th")!.textContent ?? "",
          cellLeft: cell.left,
          cellRight: cell.right,
          regionOverflow: region.scrollWidth - region.clientWidth,
        };
      },
    );
    return { W, pageOverflow: document.documentElement.scrollWidth - W, callouts };
  }, scope);
}

test("Reader: table blocks are tables, not Markdown; B0016, B0024 and B0124 callouts wrap inside the page at 1280 px, 390 px and 200 % text", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
  };
  const checkCallouts = (where: string, ref: string, m: Awaited<ReturnType<typeof measure>>) => {
    check(m.callouts.length > 0, `${where}: no callout table for ${ref}`);
    // In Arabic the panel shows the provisional translation and the English verbatim: every callout is checked; the
    // English verbatim one holds exactly the source sentence.
    check(
      m.callouts.some((c: CalloutMeasure) => norm(c.text) === norm(CELLS[ref]!)),
      `${where}: no callout holds the verbatim ${ref} sentence (${m.callouts.map((c: CalloutMeasure) => c.text.slice(0, 40)).join(" / ")})`,
    );
    for (const c of m.callouts) {
      check(
        c.cellRight <= m.W + 1 && c.cellLeft >= -1,
        `${where}: ${ref} cell ${c.cellLeft}..${c.cellRight} outside 0..${m.W}`,
      );
      check(c.regionOverflow <= 1, `${where}: ${ref} callout region scrolls sideways by ${c.regionOverflow} px`);
    }
    check(m.pageOverflow <= 1, `${where}: the page scrolls sideways by ${m.pageOverflow} px`);
  };

  // The reader: the B0024 panel and the block list.
  await page.goto("/playbook/reader");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.reader.title"));
  const connection = page.locator("[data-source-text='connection']");
  await expect(connection.locator("table[data-block-table='callout']").first()).toBeVisible();
  const list = page.locator("[data-list='blocks']");
  await expect(list.locator("li").first()).toBeVisible();
  await expect(list.locator("li[data-block='B0009']")).toBeVisible();
  const listText = await list.innerText();
  check(
    !MARKDOWN.test(listText),
    `block list: Markdown table syntax in ${JSON.stringify(listText.match(/.{0,40}(\|---|<br|\n\s*\|).{0,40}/)?.[0])}`,
  );
  check(TABLE_REFS.size > 20 && TABLE_REFS.has("B0009"), `the source's table blocks were read (${TABLE_REFS.size})`);
  const previews = await list
    .locator("li[data-block]")
    .evaluateAll((lis) => lis.map((li) => [li.getAttribute("data-block") ?? "", (li as HTMLElement).innerText]));
  const piped = previews.filter(([ref, text]) => TABLE_REFS.has(ref!) && text!.includes("|")).map(([ref]) => ref);
  check(previews.length > 100, `block list: only ${previews.length} previews`);
  check(piped.length === 0, `block list: table block previews still show a cell pipe: ${piped.join(", ")}`);
  check(!MARKDOWN.test(await connection.innerText()), "B0024 panel: Markdown table syntax");
  for (const mode of MODES) {
    await setMode(page, mode);
    checkCallouts(
      `reader B0024 panel at ${mode.label}`,
      "B0024",
      await measure(page, "[data-source-text='connection']"),
    );
    await page.locator("section#about").screenshot({
      path: join(SHOTS, lang, `p5-rg1-reader-about-${mode.label.replace(/\W+/g, "")}.png`),
    });
  }
  await setMode(page, MODES[0]);
  await expectAccessible(page, lang, "p5-rg1-reader");

  // The callout blocks on their own pages.
  for (const ref of ["B0016", "B0124"]) {
    await setMode(page, MODES[0]);
    await page.goto(`/playbook/reader/${ref}`);
    await expect(page.locator("main#main h1")).toContainText(ref);
    await expect(page.locator("#text table[data-block-table='callout']").first()).toBeVisible();
    check(!MARKDOWN.test(await page.locator("#text").innerText()), `${ref} page: Markdown table syntax`);
    for (const mode of MODES) {
      await setMode(page, mode);
      checkCallouts(`${ref} page at ${mode.label}`, ref, await measure(page, "#text"));
      await shot(page, lang, `p5-rg1-reader-${ref}-${mode.label.replace(/\W+/g, "")}`);
    }
    await setMode(page, MODES[0]);
    await expectAccessible(page, lang, `p5-rg1-reader-${ref}`);
  }
  expect(failures).toEqual([]);
});
