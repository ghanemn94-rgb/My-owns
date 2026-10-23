// qa-verifier DG5 round 7 (T-DG5-REV-QA-R7): independent real-stack verification of F-DG5-148 and F-DG5-149 (repair
// T-DG5-FE-AB1) on the PRODUCTION-initialized stack (apps/web/e2e/support/with-stack.sh), chromium-en and chromium-ar.
// NOT part of the candidate: copied into a disposable clone's e2e/ for the run only. It does not import the product spec
// p5-record-name-reflow.spec.ts. My round-6 reproduction (R6-TITLE-B of
// tests/round-6/e2e/zz-qa-dg5r6-title-reflow-verify.spec.ts, and R6-DEFINE-NARROW) is re-run UNCHANGED separately; this
// file adds what that reproduction did not measure:
//  R7-F148: per token (w120, w46, arU, plain) one transformation whose NAME and one Define OUTCOME statement hold the
//           token. Traceability (graph with record links + the trace panel of the outcome, opened by clicking its
//           record link) and Modular entry (missing-item label "· <statement>") at 390, 360, 320 px and 1280 px with
//           200 % root font. Scan = the whole body. ASSERTED: page overflow <= 1 px; no visible element whose text
//           holds the token lies outside [0, innerWidth] unless inside a horizontal scroll container; the token is on
//           the page. Other escapes are reported.
//  R7-F149: one ORDINARY outcome and one w120 outcome; Define at 390, 375, 360, 320 px and 200 %. ASSERTED: page
//           overflow <= 1 px; every .outcome-card inside the viewport; the Good-outcome table sits in a focusable
//           (tabindex=0) region with role=region and a non-empty accessible name; where the table is wider than its
//           region, the region scrolls (scrollWidth > clientWidth) and keyboard ArrowRight/Left moves it.
// Revision 2 (revision 1 kept in round-7/probe-revisions/): revision 1 opened the "trace panel" by clicking the outcome's
// record link, which navigates to the record's own page (Define); its measurement then ran before Define had loaded, so
// 24 cases failed as "set-up, token not on the page" (a probe error, not a product result). Revision 2 opens the
// trace/impact/allocation panels through the URL selection and waits for the token on every page before measuring.
// Everything is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, expectAccessible, langOf, shot, SYN_RETAIL, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r7");
const stamp = Date.now().toString(36);
const TOKENS = {
  w120: `Synthetic_${"ABCDEFGHIJ".repeat(11)}`,
  w46: "Synthetic_roaming_bill_shock_reduction_program",
  arU: "اصطناعي_برنامج_خفض_صدمة_فواتير_التجوال_للمسافرين_الدوليين_عبر_التطبيق",
  plain: "Synthetic churn reduction on the prepaid base",
} as const;
const SIZES = [
  ["390", 390, 0],
  ["360", 360, 0],
  ["320", 320, 0],
  ["200pct", 1280, 200],
] as const;

async function settle(page: Page, font: number) {
  if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

async function measure(page: Page, token: string) {
  return page.evaluate((token) => {
    const W = window.innerWidth;
    const inScroller = (el: Element) => {
      for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
        const ox = getComputedStyle(x).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const tokenEscapes: string[] = [];
    const otherEscapes: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || (cs.position === "absolute" && r.width <= 1)) continue;
      if (inScroller(el)) continue;
      if (r.left < -1 || r.right > W + 1) {
        const text = (el.textContent ?? "").trim();
        const d = `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}] "${text.slice(0, 40)}"`;
        (text.includes(token) ? tokenEscapes : otherEscapes).push(d);
      }
    }
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      tokenEscapes: tokenEscapes.slice(0, 8),
      otherEscapes: otherEscapes.slice(0, 8),
      tokenPresent: (document.querySelector("main#main")?.textContent ?? "").includes(token),
    };
  }, token);
}

function save(lang: Lang, file: string, out: unknown) {
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, file), JSON.stringify(out, null, 1));
}

test("R7-F148: record names on Traceability (graph + trace panel) and Modular entry at 390/360/320 px and 200 %", async ({ browser, playwright }, info) => {
  test.setTimeout(900_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const u = await asUser(browser, lang, "dev.lead");
  const p = u.page;
  const out: Record<string, unknown> = {};
  const failures: string[] = [];
  const reported: string[] = [];
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    const token = TOKENS[k];
    const tid = (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 ${token} ${lang} ${stamp}`, mode: "end_to_end" })).id;
    await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: `QA7 ${token}` });
    for (const [label, width, font] of SIZES) {
      await p.setViewportSize({ width, height: 900 });
      for (const tab of ["traceability", "traceability+panel", "modular-entry"]) {
        await p.goto(`/transformations/${tid}/${tab.split("+")[0]}`);
        await expect(p.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
        await expect(p.locator("main#main")).toContainText(token, { timeout: 30_000 });
        if (tab.endsWith("+panel")) {
          // Revision 2: the trace, impact and allocation panels of the outcome open through the URL selection
          // (?root=&impact=&alloc=, selection.ts), not through the record link (that link opens the record's own page).
          const node = p.locator("li.trace-node").filter({ hasText: token }).first();
          const rid = await node.getAttribute("data-node");
          const rtype = await node.locator("[data-node-link]").first().getAttribute("data-node-link");
          const sel = `${rtype}:${rid}`;
          await p.goto(`/transformations/${tid}/traceability?root=${sel}&impact=${sel}&alloc=${sel}`);
          await expect(p.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
          await expect(p.locator("main#main")).toContainText(token, { timeout: 30_000 });
        }
        await settle(p, font);
        const m = await measure(p, token);
        const where = `${k}/${tab}/${label}`;
        out[where] = { ...m, url: p.url().replace(tid, "<T>") };
        if (!m.tokenPresent) failures.push(`${where}: set-up, token not on the page`);
        if (m.pageOverflow > 1) failures.push(`${where}: page scrolls ${m.pageOverflow} px`);
        if (m.tokenEscapes.length) failures.push(`${where}: token escapes ${m.tokenEscapes.join(" | ")}`);
        if (m.otherEscapes.length) reported.push(`${where}: other escapes ${m.otherEscapes.join(" | ")}`);
        if (k !== "plain" && label !== "200pct") await shot(p, lang, `r7-f148-${k}-${tab.replace("+", "-")}-${label}`);
        if (font) await p.evaluate(() => (document.documentElement.style.fontSize = ""));
      }
    }
    if (k === "w120") {
      await p.setViewportSize({ width: 390, height: 900 });
      await p.goto(`/transformations/${tid}/modular-entry`);
      await settle(p, 0);
      await expectAccessible(p, lang, "r7-f148-modular-w120-390");
      await p.goto(`/transformations/${tid}/traceability`);
      await settle(p, 0);
      await expectAccessible(p, lang, "r7-f148-traceability-w120-390");
    }
  }
  await u.close();
  save(lang, "r7-f148.json", { failures, reported, out });
  console.info(`R7-F148 ${lang}: cases=${Object.keys(out).length} failures=${failures.length} ${JSON.stringify(failures.slice(0, 20))} REPORTED ${reported.length} ${JSON.stringify(reported.slice(0, 10))}`);
  expect(failures).toEqual([]);
});

test("R7-F149: Define Good-outcome table in a named, focusable scroll region; no page overflow at 390/375/360/320 px and 200 %", async ({ browser, playwright }, info) => {
  test.setTimeout(400_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const tid = (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7 define narrow ${lang} ${stamp}`, mode: "end_to_end" })).id;
  await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: "Synthetic: fewer roaming bill complaints" });
  await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: `QA7 ${TOKENS.w120}` });
  const u = await asUser(browser, lang, "dev.lead");
  const out: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const [label, width, font] of [["390", 390, 0], ["375", 375, 0], ["360", 360, 0], ["320", 320, 0], ["200pct", 1280, 200]] as const) {
    await u.page.setViewportSize({ width, height: 900 });
    await u.page.goto(`/transformations/${tid}/define`);
    await expect(u.page.locator(".outcome-card__title").first()).toBeVisible({ timeout: 30_000 });
    await settle(u.page, font);
    const m = await u.page.evaluate(() => {
      const W = window.innerWidth;
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".outcome-card")).map((c) => {
        const r = c.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.right)];
      });
      const tables = Array.from(document.querySelectorAll<HTMLElement>("table.good-outcome__table")).map((t) => {
        const reg = t.parentElement?.closest<HTMLElement>("[role='region']") ?? null;
        const name = reg ? (reg.getAttribute("aria-label") ?? (reg.getAttribute("aria-labelledby") ? document.getElementById(reg.getAttribute("aria-labelledby")!)?.textContent : "") ?? "") : "";
        return {
          inRegion: !!reg,
          tabindex: reg?.getAttribute("tabindex") ?? null,
          name: (name ?? "").trim().slice(0, 80),
          overflowX: reg ? getComputedStyle(reg).overflowX : null,
          regionScroll: reg ? reg.scrollWidth - reg.clientWidth : null,
          regionBox: reg ? [Math.round(reg.getBoundingClientRect().left), Math.round(reg.getBoundingClientRect().right)] : null,
        };
      });
      return { W, pageOverflow: document.documentElement.scrollWidth - W, cards, tables };
    });
    let keyScroll: number | null = null;
    const scrollable = m.tables.findIndex((t) => (t.regionScroll ?? 0) > 1);
    if (scrollable >= 0) {
      const reg = u.page.locator("table.good-outcome__table").nth(scrollable).locator("xpath=ancestor::*[@role='region'][1]");
      await reg.focus();
      const before = await reg.evaluate((e) => e.scrollLeft);
      await u.page.keyboard.press(lang === "ar" ? "ArrowLeft" : "ArrowRight");
      await u.page.keyboard.press(lang === "ar" ? "ArrowLeft" : "ArrowRight");
      await u.page.waitForTimeout(200);
      keyScroll = Math.abs((await reg.evaluate((e) => e.scrollLeft)) - before);
    }
    out[label] = { ...m, keyScroll };
    if (m.pageOverflow > 1) failures.push(`${label}: page scrolls ${m.pageOverflow} px`);
    m.cards.forEach((c, i) => {
      if (c[0]! < -1 || c[1]! > m.W + 1) failures.push(`${label}: outcome card ${i} outside the viewport ${JSON.stringify(c)}`);
    });
    if (m.tables.length < 2) failures.push(`${label}: set-up, expected 2 Good-outcome tables, found ${m.tables.length}`);
    m.tables.forEach((t, i) => {
      if (!t.inRegion) failures.push(`${label}: table ${i} not in a role=region`);
      if (t.tabindex !== "0") failures.push(`${label}: table ${i} region not focusable (${t.tabindex})`);
      if (!t.name) failures.push(`${label}: table ${i} region has no accessible name`);
      if (t.regionBox && (t.regionBox[0]! < -1 || t.regionBox[1]! > m.W + 1)) failures.push(`${label}: table ${i} region outside the viewport`);
    });
    if (scrollable >= 0 && !keyScroll) failures.push(`${label}: region scrolls ${m.tables[scrollable]!.regionScroll} px but the keyboard did not move it`);
    await shot(u.page, lang, `r7-f149-define-${label}`);
    if (font) await u.page.evaluate(() => (document.documentElement.style.fontSize = ""));
  }
  await u.page.setViewportSize({ width: 320, height: 900 });
  await u.page.goto(`/transformations/${tid}/define`);
  await settle(u.page, 0);
  await expectAccessible(u.page, lang, "r7-f149-define-320");
  await u.close();
  save(lang, "r7-f149.json", { failures, out });
  console.info(`R7-F149 ${lang}: failures=${failures.length} ${JSON.stringify(failures)} ${JSON.stringify(out)}`);
  expect(failures).toEqual([]);
});
