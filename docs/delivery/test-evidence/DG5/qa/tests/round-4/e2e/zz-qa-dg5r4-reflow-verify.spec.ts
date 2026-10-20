// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4C): independent verification of F-DG5-144 (and of the conflict-banner
// repair FE-Y1 made in the same wave) on the PRODUCTION-initialized stack (apps/web/e2e/support/with-stack.sh), in
// chromium-en and chromium-ar. NOT part of the candidate: copied into a disposable clone's e2e/ for the run only.
// Written from scratch for this round; it does not reuse the product spec p5-diagnose-reflow.spec.ts.
//  R4-CONF-FORM:   a real 409 on the transformation edit PAGE (RecordForm), with long values (a long word without spaces,
//                  and a long Arabic phrase), at 390 x 900 and at 1280 x 900 with 200 % text: no page-level horizontal
//                  scroll; the banner and its compare table inside the viewport; no column header or row header broken
//                  inside a word (each word of a <th> lies on one line box); values may wrap anywhere (reported).
//  R4-CONF-DIALOG: the same on a real 409 inside a modal RecordDialog (the Diagnose finding edit dialog), at 390 px and
//                  200 % text; the dialog itself must also fit the viewport.
//  R4-DIAG-PROD:   Diagnose on a transformation this test creates with a finding in EVERY workstream, one of them a
//                  120-character word without spaces and one a long Arabic statement, at 390 px, 320 px and 200 % text:
//                  no page-level horizontal scroll; every card inside the viewport; every scrolling register a
//                  focusable named region. It also counts the mid-word breaks in register text cells (D-175
//                  observation (n)): reported, not asserted.
// Everything is SYNTHETIC; nothing here approves anything real (G1-G6 are product approvals and have nothing to do with
// the engineering gates DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, BASE, fieldLabel, langOf, rowAction, shot, signIn, SYN_RETAIL, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
const LONG_WORD = `Synthetic_${"ABCDEFGHIJ".repeat(11)}`; // 120 characters, no break opportunity
const LONG_AR = "اصطناعي: تراجع رضا المسافرين بسبب صدمة فواتير التجوال وتأخر تفعيل الباقات في التطبيق ومراكز الخدمة";

interface Layout {
  W: number;
  pageOverflow: number;
  boxes: Record<string, { left: number; right: number } | null>;
  brokenHeaders: string[];
  headerCount: number;
  valueBreaks: number;
}

/** Measures the conflict banner (and an optional container) in the page. */
async function measureConflict(page: Page, container: string | null): Promise<Layout> {
  return page.evaluate((container) => {
    const W = window.innerWidth;
    const box = (el: Element | null | undefined) => {
      const r = el?.getBoundingClientRect();
      return r ? { left: Math.round(r.left), right: Math.round(r.right) } : null;
    };
    /** The words of `el` that span more than one line box. */
    const broken = (el: Element): string[] => {
      const out: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? "";
        for (const m of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(n, m.index!);
          range.setEnd(n, m.index! + m[0].length);
          const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top / 3)));
          if (tops.size > 1) out.push(m[0]);
        }
      }
      return out;
    };
    const banner = document.querySelector("[data-state='conflict']");
    const ths = Array.from(banner?.querySelectorAll("th") ?? []);
    const tds = Array.from(banner?.querySelectorAll("td") ?? []);
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      boxes: {
        banner: box(banner),
        table: box(banner?.querySelector("table")),
        ...(container ? { container: box(document.querySelector(container)) } : {}),
      },
      brokenHeaders: ths.flatMap((th) => broken(th).map((w) => `${th.getAttribute("scope")}: ${w}`)),
      headerCount: ths.length,
      valueBreaks: tds.reduce((n, td) => n + broken(td).length, 0),
    };
  }, container);
}

function judge(label: string, m: Layout, failures: string[]) {
  if (m.pageOverflow > 1) failures.push(`${label}: the page scrolls ${m.pageOverflow} px horizontally`);
  for (const [k, b] of Object.entries(m.boxes))
    if (!b || b.left < -1 || b.right > m.W + 1) failures.push(`${label}: ${k} off the viewport ${JSON.stringify(b)} of ${m.W}`);
  if (m.headerCount < 4) failures.push(`${label}: set-up: the compare table has only ${m.headerCount} header cells`);
  if (m.brokenHeaders.length) failures.push(`${label}: header broken inside a word: ${m.brokenHeaders.join(" | ")}`);
}

const sizes = [
  ["390", 390, 0],
  ["200pct", 1280, 200],
] as const;

test("R4-CONF-FORM: a 409 on the transformation edit page, at 390 px and 200 % text, with long values", async ({ browser, playwright }, info) => {
  test.setTimeout(300_000);
  const lang: Lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [label, width, font] of sizes) {
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
    const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
    await expect(name).toBeVisible();
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await name.fill(lang === "ar" ? `${LONG_AR} ${LONG_WORD}` : `My edit ${LONG_WORD}`);
    const current = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${T}`);
    await lead.call("PATCH", `/api/v1/transformations/${T}`, { description: `Concurrent ${LONG_WORD} ${LONG_AR}` }, { ifMatch: current.version });
    await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
    const conflict = page.locator("[data-state='conflict']");
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("table tbody tr").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const m = await measureConflict(page, null);
    judge(`form ${label}`, m, failures);
    out[label] = m;
    await shot(page, lang, `r4-conf-form-${label}`);
    await ctx.close();
  }
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-conf-form.json"), JSON.stringify(out, null, 1));
  console.info(`R4-CONF-FORM ${lang}: ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});

async function diagnoseFixture(lead: Awaited<ReturnType<typeof apiSession>>, lang: Lang, all: boolean) {
  const T = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic r4 diagnose ${lang} ${Date.now()}`,
      mode: "end_to_end",
    })
  ).id;
  const base = `/api/v1/transformations/${T}`;
  const ws = (await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`)).diagnosticWorkstreams;
  const ids: string[] = [];
  const statements = [`Synthetic finding ${LONG_WORD}`, LONG_AR, "Synthetic: order fallout between the CRM and billing hand-off"];
  for (const [i, w] of (all ? ws : ws.slice(0, 1)).entries()) {
    const f = await lead.call<{ id: string }>("POST", `${base}/diagnostic-findings`, {
      workstreamCode: w.code,
      kind: "root_cause",
      statement: all ? statements[i % statements.length] : `Synthetic r4 dialog finding ${lang}`,
      status: "confirmed",
    });
    ids.push(f.id);
  }
  return { T, ids, workstreams: ws.length };
}

test("R4-CONF-DIALOG: a 409 inside the Diagnose finding dialog, at 390 px and 200 % text", async ({ browser, playwright }, info) => {
  test.setTimeout(300_000);
  const lang: Lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [label, width, font] of sizes) {
    const { T, ids } = await diagnoseFixture(lead, lang, false);
    const statement = `Synthetic r4 dialog finding ${lang}`;
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, lang, "dev.lead");
    await page.goto(`/transformations/${T}/diagnose`);
    await expect(page.locator("article.workstream").first()).toBeVisible();
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await page.getByRole("button", { name: rowAction(lang, "common.action.edit", statement) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(fieldLabel(lang, "diagnose.finding.statement")).fill(`${lang === "ar" ? LONG_AR : "My edit"} ${LONG_WORD}`);
    const cur = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${T}/diagnostic-findings/${ids[0]}`);
    await lead.call(
      "PATCH",
      `/api/v1/transformations/${T}/diagnostic-findings/${ids[0]}`,
      { detail: `Concurrent ${LONG_WORD} ${LONG_AR}` },
      { ifMatch: cur.version },
    );
    await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
    const conflict = dialog.locator("[data-state='conflict']");
    await expect(conflict).toBeVisible();
    await expect(conflict.locator("table tbody tr").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const m = await measureConflict(page, "[role='dialog']");
    judge(`dialog ${label}`, m, failures);
    out[label] = m;
    await shot(page, lang, `r4-conf-dialog-${label}`);
    await ctx.close();
  }
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-conf-dialog.json"), JSON.stringify(out, null, 1));
  console.info(`R4-CONF-DIALOG ${lang}: ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});

test("R4-DIAG-PROD: Diagnose with a finding in every workstream (long word, long Arabic) at 390 px, 320 px and 200 % text", async ({ browser, playwright }, info) => {
  test.setTimeout(300_000);
  const lang: Lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const { T, workstreams } = await diagnoseFixture(lead, lang, true);
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await ctx.newPage();
  await signIn(page, lang, "dev.lead");
  const failures: string[] = [];
  const out: Record<string, unknown> = { workstreams };
  for (const [label, width, font] of [["390", 390, 0], ["320", 320, 0], ["200pct", 1280, 200]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/transformations/${T}/diagnose`);
    await expect(page.locator("article.workstream").first()).toBeVisible();
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const W = window.innerWidth;
      const brokenIn = (el: Element) => {
        let n = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode())
          for (const m of (t.textContent ?? "").matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(t, m.index!);
            r.setEnd(t, m.index! + m[0].length);
            if (new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top / 3))).size > 1) n++;
          }
        return n;
      };
      return {
        W,
        pageOverflow: document.documentElement.scrollWidth - W,
        cards: Array.from(document.querySelectorAll<HTMLElement>("article.workstream")).map((a) => {
          const r = a.getBoundingClientRect();
          return { code: a.dataset["workstream"], left: Math.round(r.left), right: Math.round(r.right) };
        }),
        regions: Array.from(document.querySelectorAll<HTMLElement>("article.workstream .table-wrap")).map((el) => ({
          tabIndex: el.tabIndex,
          role: el.getAttribute("role"),
          name: (el.getAttribute("aria-label") ?? "").trim(),
          scrolls: el.scrollWidth > el.clientWidth + 1,
        })),
        textCellBreaks: Array.from(document.querySelectorAll("article.workstream .text-cell")).reduce((n, c) => n + brokenIn(c), 0),
        headerBreaks: Array.from(document.querySelectorAll("article.workstream th")).reduce((n, c) => n + brokenIn(c), 0),
      };
    });
    if (m.pageOverflow > 1) failures.push(`${label}: page scrolls ${m.pageOverflow} px`);
    if (m.cards.length !== workstreams) failures.push(`${label}: ${m.cards.length} cards of ${workstreams}`);
    for (const c of m.cards) if (c.left < -1 || c.right > m.W + 1) failures.push(`${label}: card ${c.code} [${c.left}..${c.right}] of ${m.W}`);
    for (const r of m.regions)
      if (r.scrolls && (r.tabIndex !== 0 || r.role !== "region" || r.name === "")) failures.push(`${label}: unnamed/unfocusable scrolling register ${JSON.stringify(r)}`);
    out[label] = { ...m, scrolling: m.regions.filter((r) => r.scrolls).length, cards: m.cards.length };
    await shot(page, lang, `r4-diag-prod-${label}`);
  }
  await ctx.close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-diag-prod.json"), JSON.stringify(out, null, 1));
  console.info(`R4-DIAG-PROD ${lang}: ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
  void BASE;
});
