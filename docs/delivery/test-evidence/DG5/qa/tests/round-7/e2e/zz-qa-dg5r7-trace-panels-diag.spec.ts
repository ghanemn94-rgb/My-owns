// T-DG5-REV-QA-R7C: copied from tests/round-7-r7-orphaned/e2e/ (written by this role's run T-DG5-REV-QA-R7, stopped by a container restart), re-read and re-run here; unchanged except where a comment says 'T-DG5-REV-QA-R7C'.
// qa-verifier DG5 round 7 (T-DG5-REV-QA-R7): diagnostic follow-up of R7-F148 (revision 2), which found the Traceability
// page scrolling sideways once the outcome's panels are selected (?root=&impact=&alloc=) with an unbroken token in the
// outcome statement. Per token (w120, w46, arU, plain) and per selection (none, root only, impact only, alloc only, all
// three) at 390 and 320 px, it records the page overflow and the WIDEST elements of main#main (right edge past innerWidth
// or left edge below 0, in ar), whatever their ancestors, with tag, classes, data-* attributes, width and the first 40
// characters of text, so the element that widens the page is named. REPORTED; one assertion: the plain token never
// overflows (control). NOT part of the candidate. Everything is SYNTHETIC; nothing here grants a business approval
// (G1-G6) or touches the delivery gates DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, langOf, shot, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r7-diag");
const stamp = Date.now().toString(36);
const TOKENS = {
  w120: `Synthetic_${"ABCDEFGHIJ".repeat(11)}`,
  w46: "Synthetic_roaming_bill_shock_reduction_program",
  arU: "اصطناعي_برنامج_خفض_صدمة_فواتير_التجوال_للمسافرين_الدوليين_عبر_التطبيق",
  plain: "Synthetic churn reduction on the prepaid base",
} as const;

test("R7-TRACE-DIAG: which element widens Traceability when a record's panels are selected", async ({ browser, playwright }, info) => {
  test.setTimeout(600_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const u = await asUser(browser, lang, "dev.lead");
  const p = u.page;
  const out: Record<string, unknown> = {};
  const plainFail: string[] = [];
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    const token = TOKENS[k];
    const tid = (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7d ${k} ${lang} ${stamp}`, mode: "end_to_end" })).id;
    await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: `QA7 ${token}` });
    await p.setViewportSize({ width: 390, height: 900 });
    await p.goto(`/transformations/${tid}/traceability`);
    await expect(p.locator("main#main")).toContainText(token, { timeout: 30_000 });
    const node = p.locator("li.trace-node").filter({ hasText: token }).first();
    const sel = `${await node.locator("[data-node-link]").first().getAttribute("data-node-link")}:${await node.getAttribute("data-node")}`;
    for (const [sl, q] of [["none", ""], ["root", `?root=${sel}`], ["impact", `?impact=${sel}`], ["alloc", `?alloc=${sel}`], ["all", `?root=${sel}&impact=${sel}&alloc=${sel}`]] as const) {
      for (const w of [390, 320]) {
        await p.setViewportSize({ width: w, height: 900 });
        await p.goto(`/transformations/${tid}/traceability${q}`);
        await expect(p.locator("main#main")).toContainText(token, { timeout: 30_000 });
        await p.waitForLoadState("networkidle");
        await p.waitForTimeout(400);
        const m = await p.evaluate(() => {
          const W = window.innerWidth;
          const wide = Array.from(document.querySelectorAll<HTMLElement>("main#main *"))
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.right > W + 1 || r.left < -1))
            .map(({ el, r }) => {
              const data = Array.from(el.attributes).filter((a) => a.name.startsWith("data-") || a.name === "id").map((a) => `${a.name}=${a.value.slice(0, 30)}`).join(",");
              return { w: Math.round(r.width), d: `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")}[${data}] [${Math.round(r.left)}..${Math.round(r.right)}] ows=${getComputedStyle(el).overflowWrap} "${(el.textContent ?? "").trim().slice(0, 40)}"` };
            });
          const inner = [...wide];
          return { W, pageOverflow: document.documentElement.scrollWidth - W, n: wide.length, widest: inner.sort((a, b) => b.w - a.w).slice(0, 4).map((x) => x.d), last: wide.slice(-6).map((x) => x.d) };
        });
        out[`${k}/${sl}/${w}`] = m;
        if (k === "plain" && m.pageOverflow > 1) plainFail.push(`${sl}/${w}: ${m.pageOverflow}`);
        if ((k === "w120" || k === "arU") && sl === "all" && w === 390) await p.screenshot({ path: path.join(EVIDENCE, lang, `r7-trace-diag-${k}-all-390.png`), fullPage: false }).catch(() => undefined);
      }
    }
  }
  await shot(p, lang, "r7-trace-diag-last");
  await u.close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r7-trace-diag.json"), JSON.stringify(out, null, 1));
  const brief = Object.fromEntries(Object.entries(out).map(([k2, v]) => [k2, (v as { pageOverflow: number }).pageOverflow]));
  console.info(`R7-TRACE-DIAG ${lang}: ${JSON.stringify(brief)}`);
  expect(plainFail).toEqual([]);
});
