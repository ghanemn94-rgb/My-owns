// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4): independent verification of FE-Y1's conflict-banner reflow (D-174/D-175,
// the F-DG5-144 defect class on `.conflict`) on the PRODUCTION-initialized stack (apps/web/e2e/support/with-stack.sh),
// in chromium-en and chromium-ar. Beyond FE-Y1's own spec (one variant, 390 px only, short values) it covers:
//  - BOTH conflict components: ConflictPanel (components/States.tsx; the transformation edit page) and FormConflict
//    (components/RecordForm.tsx; inside the RecordDialog of a Diagnose finding, a P5 screen);
//  - 390 x 900 AND 1280 x 900 with the root font at 200 %;
//  - a long value WITHOUT spaces (130 characters) next to normal words, in the language of the project;
//  - that no column header (thead th) and no row label (tbody th) is broken inside a word: each word's Range must lie on
//    one line (its client rects share one top), in English and in Arabic (Arabic letters must stay joined);
//  - it reports (does not fail on) words broken inside value cells (td; `overflow-wrap: anywhere` by design).
// It asserts: no page-level horizontal scroll; the banner and its compare table inside the viewport; no header/row-label
// word broken. Every record is SYNTHETIC; nothing approves anything real; nothing relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, BASE, escape, fieldLabel, langOf, shot, signIn, SYN_RETAIL, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
test.setTimeout(600_000);

const SIZES = [
  ["390", 390, 0],
  ["200pct", 1280, 200],
] as const;

const longValue = (lang: Lang) =>
  lang === "ar"
    ? `تعديل اصطناعي للتحقق من التعارض ${"مثال".repeat(32)}`
    : `Synthetic conflict reflow edit ${"X".repeat(130)}`;

interface ConflictMeasure {
  W: number;
  pageOverflow: number;
  banner: { left: number; right: number } | null;
  table: { left: number; right: number } | null;
  dialog: { left: number; right: number } | null;
  headers: string[];
  rowLabels: string[];
  brokenHeaderWords: string[];
  brokenValueWords: number;
  valueWords: number;
}

async function measureConflict(page: Page): Promise<ConflictMeasure> {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    };
    const banner = document.querySelector("[data-state='conflict']");
    // Each whitespace-separated word of an element: is its rendered Range on more than one line?
    const words = (el: Element) => {
      const out: { word: string; broken: boolean }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        for (const m of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(n, m.index!);
          range.setEnd(n, m.index! + m[0].length);
          const tops = Array.from(range.getClientRects())
            .filter((r) => r.width > 0)
            .map((r) => r.top);
          const broken = tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 3;
          out.push({ word: m[0], broken });
        }
      }
      return out;
    };
    const ths = Array.from(banner?.querySelectorAll("table th") ?? []);
    const brokenHeaderWords = ths.flatMap((th) => words(th).filter((w) => w.broken).map((w) => `${th.parentElement?.parentElement?.tagName}: ${w.word}`));
    const tdWords = Array.from(banner?.querySelectorAll("table td") ?? []).flatMap((td) => words(td));
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      banner: box(banner),
      table: box(banner?.querySelector("table") ?? null),
      dialog: box(document.querySelector("[role='dialog']")),
      headers: Array.from(banner?.querySelectorAll("thead th") ?? []).map((x) => (x.textContent ?? "").trim()),
      rowLabels: Array.from(banner?.querySelectorAll("tbody th") ?? []).map((x) => (x.textContent ?? "").trim()),
      brokenHeaderWords,
      brokenValueWords: tdWords.filter((w) => w.broken).length,
      valueWords: tdWords.length,
    };
  });
}

function judge(label: string, m: ConflictMeasure, failures: string[]) {
  if (m.pageOverflow > 1) failures.push(`${label}: the page scrolls ${m.pageOverflow} px horizontally`);
  for (const [what, r] of [
    ["conflict banner", m.banner],
    ["compare table", m.table],
  ] as const)
    if (!r || r.left < -1 || r.right > m.W + 1)
      failures.push(`${label}: the ${what} runs off the viewport ${r ? `[${r.left}..${r.right}]` : "(missing)"} of ${m.W} px`);
  if (m.headers.length !== 3) failures.push(`${label}: set-up: ${m.headers.length} column headers`);
  if (m.rowLabels.length === 0) failures.push(`${label}: set-up: no compare row`);
  for (const w of m.brokenHeaderWords) failures.push(`${label}: header/row-label word broken inside the word: ${w}`);
}

test("R4-CONFLICT-PANEL: transformation edit 409 (ConflictPanel) at 390 px and 200 % text, long values", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [label, width, font] of SIZES) {
    const T = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic r4 conflict ${lang} ${label} ${Date.now()}`,
        mode: "end_to_end",
      })
    ).id;
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, lang, "dev.lead");
    await page.goto(`/transformations/${T}/edit`);
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
    await expect(name).toBeVisible();
    await name.fill(longValue(lang));
    const me = await (await page.request.get("/api/v1/me")).json();
    const current = await (await page.request.get(`/api/v1/transformations/${T}`)).json();
    const other = await page.request.patch(`/api/v1/transformations/${T}`, {
      headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${current.version}"`, Origin: BASE },
      data: { name: lang === "ar" ? "اسم غيّره مستخدم آخر (اصطناعي)" : "Renamed concurrently by another session (synthetic)" },
    });
    expect(other.status()).toBe(200);
    await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
    const conflict = page.locator("[data-state='conflict']");
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("table tbody tr").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const m = await measureConflict(page);
    judge(`ConflictPanel ${label}`, m, failures);
    out[`panel-${label}`] = m;
    await shot(page, lang, `r4-conflict-panel-${label}`);
    await ctx.close();
  }
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-conflict-panel.json"), JSON.stringify(out, null, 1));
  console.info(`R4-CONFLICT-PANEL ${lang}: ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});

test("R4-CONFLICT-FORM: Diagnose finding dialog 409 (FormConflict) at 390 px and 200 % text, long values", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [label, width, font] of SIZES) {
    const T = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic r4 form conflict ${lang} ${label} ${Date.now()}`,
        mode: "end_to_end",
      })
    ).id;
    const base = `/api/v1/transformations/${T}`;
    const methodology = await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
    const statement = `Synthetic r4 finding ${lang} ${label}`;
    const f = await lead.call<{ id: string; version: number }>("POST", `${base}/diagnostic-findings`, {
      workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
      kind: "root_cause",
      statement,
      status: "confirmed",
    });
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, lang, "dev.lead");
    await page.goto(`/transformations/${T}/diagnose`);
    await expect(page.locator("main#main h1")).toBeVisible();
    if (font) await page.evaluate((x) => (document.documentElement.style.fontSize = `${x}%`), font);
    await page.getByRole("button", { name: new RegExp(`${escape(tr(lang, "common.action.edit"))}.*${escape(statement)}`) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole("textbox", { name: new RegExp(`^${escape(tr(lang, "diagnose.finding.statement"))}`) });
    await box.fill(longValue(lang));
    await lead.call("PATCH", `${base}/diagnostic-findings/${f.id}`, { statement: `${statement} (changed by someone else)` }, { ifMatch: f.version });
    await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
    const conflict = dialog.locator("[data-state='conflict']");
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("table tbody tr").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const m = await measureConflict(page);
    judge(`FormConflict ${label}`, m, failures);
    if (!m.dialog || m.dialog.left < -1 || m.dialog.right > m.W + 1)
      failures.push(`FormConflict ${label}: the dialog runs off the viewport ${JSON.stringify(m.dialog)} of ${m.W} px`);
    out[`form-${label}`] = m;
    await shot(page, lang, `r4-conflict-form-${label}`);
    await ctx.close();
  }
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-conflict-form.json"), JSON.stringify(out, null, 1));
  console.info(`R4-CONFLICT-FORM ${lang}: ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});
