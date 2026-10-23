// qa-verifier DG5 round 7 (T-DG5-REV-QA-R7): confirmation of the cause found by R7-TRACE-DIAG. With ?root=<outcome> the
// Traceability graph shows the note "Rooted at <type> <name>" (TraceabilityPage.tsx, p.small[data-root]); its record name
// is plain text outside .record-name, so an unbroken token overflows as a TEXT NODE (no element leaves the viewport, which
// is why the element scans saw nothing). Per token (w120, w46, arU, plain) at 390 and 320 px: the page overflow, the note's
// scrollWidth - clientWidth and its overflow-wrap; then the same page with ONE test-only style
// (overflow-wrap:anywhere on [data-root] through the CSSOM, set in the page in this probe only, never into the product) to show the note
// is the only cause. REPORTED, with one assertion: with the injected style the page overflow is <= 1 px for every token.
// NOT part of the candidate. Everything is SYNTHETIC; no business approval (G1-G6); nothing touches DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, langOf, shot, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r7-root");
const stamp = Date.now().toString(36);
const TOKENS = {
  w120: `Synthetic_${"ABCDEFGHIJ".repeat(11)}`,
  w46: "Synthetic_roaming_bill_shock_reduction_program",
  arU: "اصطناعي_برنامج_خفض_صدمة_فواتير_التجوال_للمسافرين_الدوليين_عبر_التطبيق",
  plain: "Synthetic churn reduction on the prepaid base",
} as const;

test("R7-TRACE-ROOT: the 'Rooted at <name>' note is the element that widens Traceability", async ({ browser, playwright }, info) => {
  test.setTimeout(400_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const u = await asUser(browser, lang, "dev.lead");
  const p = u.page;
  const out: Record<string, unknown> = {};
  const withFix: string[] = [];
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    const token = TOKENS[k];
    const tid = (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA7r ${k} ${lang} ${stamp}`, mode: "end_to_end" })).id;
    await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: `QA7 ${token}` });
    await p.goto(`/transformations/${tid}/traceability`);
    await expect(p.locator("main#main")).toContainText(token, { timeout: 30_000 });
    const node = p.locator("li.trace-node").filter({ hasText: token }).first();
    const sel = `${await node.locator("[data-node-link]").first().getAttribute("data-node-link")}:${await node.getAttribute("data-node")}`;
    for (const w of [390, 320]) {
      for (const inject of [false, true]) {
        await p.setViewportSize({ width: w, height: 900 });
        await p.goto(`/transformations/${tid}/traceability?root=${sel}`);
        await expect(p.locator("[data-root]")).toContainText(token, { timeout: 30_000 });
        // Revision 2: revision 1 used page.addStyleTag, which the product's CSP (style-src 'self') refuses; the CSSOM
        // property set below is allowed and has the same effect on this one element.
        if (inject) await p.evaluate(() => { document.querySelector<HTMLElement>("[data-root]")!.style.overflowWrap = "anywhere"; });
        await p.waitForLoadState("networkidle");
        await p.waitForTimeout(300);
        const m = await p.evaluate(() => {
          const n = document.querySelector<HTMLElement>("[data-root]")!;
          const r = n.getBoundingClientRect();
          return {
            W: window.innerWidth,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
            noteBox: [Math.round(r.left), Math.round(r.right)],
            noteOverflow: n.scrollWidth - n.clientWidth,
            overflowWrap: getComputedStyle(n).overflowWrap,
            noteText: (n.textContent ?? "").slice(0, 60),
          };
        });
        out[`${k}/${w}/${inject ? "probe-style" : "as-shipped"}`] = m;
        if (inject && m.pageOverflow > 1) withFix.push(`${k}/${w}: ${m.pageOverflow}`);
        if (!inject && k === "w120") {
          await p.locator("[data-root]").scrollIntoViewIfNeeded();
          await shot(p, lang, `r7-trace-root-note-${k}-${w}`);
        }
      }
    }
  }
  await u.close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r7-trace-root.json"), JSON.stringify(out, null, 1));
  console.info(`R7-TRACE-ROOT ${lang}: ${JSON.stringify(out)}`);
  expect(withFix).toEqual([]);
});
