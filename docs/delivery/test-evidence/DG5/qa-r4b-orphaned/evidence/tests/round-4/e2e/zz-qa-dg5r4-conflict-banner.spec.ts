// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4B): independent probe of FE-Y1's 409 conflict-banner reflow (.conflict, D-174/
// D-175) on the production-initialized stack (apps/web/e2e/support/with-stack.sh). NOT part of the candidate: copied
// into a disposable clone's e2e/ for the run only, then removed. Written from scratch for this round (the orphaned R4
// run's material is not used).
//  R4-CONF: a real 409 on the transformation edit form (another session PATCHes first through the real API with CSRF +
//           If-Match), in three layouts: 390 x 844, 320 x 800 (the WCAG 1.4.10 reference width), and 1280 x 900 with
//           the root font at 200 %. Two variants of the user's unsaved edit:
//             - "words": an ordinary long name with spaces;
//             - "token": a 120-character value with NO space (the case `overflow-wrap: anywhere` exists for).
//           Asserted for every case:
//             - no page-level horizontal scroll (scrollWidth - innerWidth <= 1);
//             - the banner, its compare table and every table cell lie inside the viewport;
//             - no column header (thead th) and no row label (tbody th) is broken INSIDE A WORD: each whitespace-
//               separated word of the header's text is laid out on ONE line (a Range over the word has client rects
//               on one line only). This is the "Arabic headers are never broken inside a word" claim, in ar and en;
//             - axe (the wcag2a/2aa/21a/21aa set) reports no serious/critical violation on the page with the banner.
// Everything is SYNTHETIC; approves nothing real; G1-G6 are product approvals and have nothing to do with DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, BASE, fieldLabel, langOf, shot, signIn, SYN_RETAIL, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
test.setTimeout(600_000);

interface Measure {
  W: number;
  pageOverflow: number;
  banner: { left: number; right: number } | null;
  table: { left: number; right: number } | null;
  cellsOutside: string[];
  headers: { text: string; lines: number; brokenWords: string[] }[];
  tokenCellLines: number | null;
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    };
    const banner = document.querySelector("[data-state='conflict']");
    const table = banner?.querySelector("table") ?? null;
    const cellsOutside: string[] = [];
    for (const c of Array.from(banner?.querySelectorAll("th, td") ?? [])) {
      const r = c.getBoundingClientRect();
      if (r.left < -1 || r.right > W + 1)
        cellsOutside.push(`${c.tagName.toLowerCase()} "${(c.textContent ?? "").slice(0, 40)}" [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    const linesOf = (rects: DOMRectList | DOMRect[]) => new Set(Array.from(rects).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    const headers = Array.from(banner?.querySelectorAll("thead th, tbody th") ?? []).map((th) => {
      const brokenWords: string[] = [];
      const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        const re = /\S+/g;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          if (linesOf(range.getClientRects()) > 1) brokenWords.push(m[0]);
        }
      }
      const all = document.createRange();
      all.selectNodeContents(th);
      return { text: (th.textContent ?? "").trim(), lines: linesOf(all.getClientRects()), brokenWords };
    });
    const tokenCell = Array.from(banner?.querySelectorAll("td") ?? []).find((td) => /QATOKEN/.test(td.textContent ?? ""));
    let tokenCellLines: number | null = null;
    if (tokenCell) {
      const r = document.createRange();
      r.selectNodeContents(tokenCell);
      tokenCellLines = linesOf(r.getClientRects());
    }
    return { W, pageOverflow: document.documentElement.scrollWidth - W, banner: box(banner ?? null), table: box(table), cellsOutside, headers, tokenCellLines };
  });
}

async function serious(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`);
}

test("R4-CONF: the 409 conflict banner reflows at 390 px, 320 px and 200 % text; headers never break inside a word", async ({
  browser,
  playwright,
}, info) => {
  const lang: Lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const results: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const variant of ["words", "token"] as const) {
    for (const [label, width, height, font] of [
      ["390", 390, 844, 0],
      ["320", 320, 800, 0],
      ["200pct", 1280, 900, 200],
    ] as const) {
      const T = (
        await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
          businessUnitId: SYN_RETAIL,
          name: `Synthetic QA r4 conflict ${variant} ${label} ${lang.toUpperCase()} ${Date.now()}`,
          mode: "end_to_end",
        })
      ).id;
      const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
      const page = await context.newPage();
      await page.setViewportSize({ width, height });
      // sign in exactly as the product specs do (dev sign-in), then pick the language
      await signIn(page, lang, "dev.lead");
      await page.goto(`/transformations/${T}/edit`);
      const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
      await expect(name).toBeVisible();
      const mine =
        variant === "token"
          ? `QATOKEN${"x".repeat(113)}`
          : lang === "ar"
            ? "تحوّل اصطناعي لاختبار إعادة التدفق في شريط التعارض مع اسم طويل نسبيًا"
            : "Synthetic transformation for the conflict banner reflow probe with a fairly long name";
      await name.fill(mine);
      const me = await (await page.request.get("/api/v1/me")).json();
      const current = await (await page.request.get(`/api/v1/transformations/${T}`)).json();
      const other = await page.request.patch(`/api/v1/transformations/${T}`, {
        headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${current.version}"`, Origin: BASE },
        data: { description: "Changed concurrently by another session (synthetic, qa r4)" },
      });
      expect(other.status()).toBe(200);
      if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
      await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
      const conflict = page.locator("[data-state='conflict']");
      await expect(conflict).toBeVisible();
      await expect(conflict.locator("table tbody tr").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      const m = await measure(page);
      const axe = await serious(page);
      const tag = `${variant} ${label}`;
      if (m.pageOverflow > 1) failures.push(`${tag}: page scrolls ${m.pageOverflow} px`);
      for (const [what, r] of [
        ["banner", m.banner],
        ["table", m.table],
      ] as const)
        if (!r || r.left < -1 || r.right > m.W + 1) failures.push(`${tag}: ${what} off the viewport ${JSON.stringify(r)}`);
      for (const c of m.cellsOutside) failures.push(`${tag}: cell off the viewport ${c}`);
      for (const h of m.headers) if (h.brokenWords.length) failures.push(`${tag}: header "${h.text}" broken inside ${JSON.stringify(h.brokenWords)}`);
      if (variant === "token" && m.tokenCellLines === null) failures.push(`${tag}: set-up: the no-space value is not in the compare table`);
      if (axe.length) failures.push(`${tag}: axe ${axe.join("; ")}`);
      results.push({ variant, label, ...m, axe });
      await shot(page, lang, `r4-conf-${variant}-${label}`);
      await context.close();
    }
  }
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-conf.json"), JSON.stringify({ results, failures }, null, 1));
  console.info(`R4-CONF ${lang}: ${JSON.stringify(results.map((r) => ({ v: r["variant"], l: r["label"], o: r["pageOverflow"], hdr: (r["headers"] as Measure["headers"]).map((h) => `${h.text}:${h.lines}`), tok: r["tokenCellLines"] })))}`);
  console.info(`R4-CONF ${lang} failures: ${JSON.stringify(failures)}`);
  expect(failures).toEqual([]);
});
