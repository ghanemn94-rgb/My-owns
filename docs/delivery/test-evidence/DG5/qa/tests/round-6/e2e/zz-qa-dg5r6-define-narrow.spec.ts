// qa-verifier DG5 round 6 (T-DG5-REV-QA-R6): follow-up of R6-TITLE-B, where the Define page overflowed 61 px at 320 px
// with an ORDINARY outcome statement (and 0 px at 390 px and 200 %). Measures the Define page with one ordinary outcome
// at 320, 360 (the width REQ-S15-009 names), 375 and 390 px, in chromium-en and chromium-ar, on the production-initialized
// real stack, and reports the outcome card's widest descendants (scrollWidth vs clientWidth) to locate the cause.
// REPORTED with one assertion at 390 px (the size every earlier round measured). NOT part of the candidate.
// Everything is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, langOf, shot, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r6-define");
const stamp = Date.now().toString(36);

test("R6-DEFINE-NARROW: Define with one ordinary outcome at 320, 360, 375 and 390 px", async ({ browser, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const tid = (await lead.call<{ id: string }>("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `QA6 define narrow ${lang} ${stamp}`, mode: "end_to_end" })).id;
  await lead.call("POST", `/api/v1/transformations/${tid}/outcomes`, { statement: "Synthetic: fewer roaming bill complaints" });
  const u = await asUser(browser, lang, "dev.lead");
  const out: Record<string, unknown> = {};
  for (const w of [320, 360, 375, 390]) {
    await u.page.setViewportSize({ width: w, height: 900 });
    await u.page.goto(`/transformations/${tid}/define`);
    await expect(u.page.locator(".outcome-card__title")).toBeVisible();
    await u.page.waitForLoadState("networkidle");
    await u.page.waitForTimeout(300);
    out[String(w)] = await u.page.evaluate(() => {
      const W = window.innerWidth;
      const card = document.querySelector<HTMLElement>(".outcome-card")!;
      const r = card.getBoundingClientRect();
      const wide = Array.from(card.querySelectorAll<HTMLElement>("*"))
        .map((el) => ({ el, sw: el.scrollWidth, cw: el.clientWidth, w: Math.round(el.getBoundingClientRect().width) }))
        .filter((x) => x.sw > x.cw + 1)
        .slice(0, 6)
        .map((x) => `${x.el.tagName.toLowerCase()}.${(x.el.getAttribute("class") ?? "").trim().split(/\s+/).join(".")} scrollWidth ${x.sw} clientWidth ${x.cw}`);
      const table = card.querySelector<HTMLElement>("table");
      const tr = table?.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return {
        W,
        pageOverflow: document.documentElement.scrollWidth - W,
        card: [Math.round(r.left), Math.round(r.right)],
        cardMinWidth: cs.minWidth,
        table: tr ? [Math.round(tr.left), Math.round(tr.right)] : null,
        tableInWrap: !!table?.closest(".table-wrap"),
        overflowingDescendants: wide,
      };
    });
    await shot(u.page, lang, `r6-define-narrow-${w}`);
  }
  await u.close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r6-define-narrow.json"), JSON.stringify(out, null, 1));
  console.info(`R6-DEFINE-NARROW ${lang}: ${JSON.stringify(out)}`);
  expect((out["390"] as { pageOverflow: number }).pageOverflow).toBeLessThanOrEqual(1);
});
