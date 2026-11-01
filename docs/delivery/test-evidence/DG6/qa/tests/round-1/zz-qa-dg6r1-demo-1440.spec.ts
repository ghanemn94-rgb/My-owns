// qa-verifier DG6 round 1 probe (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// e2e/zz-qa-dg6r1-demo-1440.spec.ts and run inside e2e/support/with-demo-stack.sh.
// REQ-S15-001 "visual review of the Arabic and English executive and home pages at 1440 px shows decisions, outcomes
// and next actions without scrolling, with light surfaces and blue navigation". The candidate's A20 spec (dev stack)
// saw "Key outcomes" and "Next actions" only in their EMPTY states (register notes). Here the seeded International
// Roaming demo data (synthetic) fills them: for the demo Sponsor and the demo Transformation Lead, the home page and the
// executive page at 1440 x 900 are read with scrollY = 0; each of the three regions must lie inside the first screen,
// and the probe records whether each shows content or its empty state (screenshots for the visual review). Synthetic
// data only; nothing approves anything.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test.setTimeout(180_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r1";
const WIDE = { width: 1440, height: 900 };
const REGIONS = ["myWork.home.decisions.title", "myWork.home.outcomes.title", "myWork.home.nextActions.title"];

for (const who of ["roaming.user.sp", "roaming.user.tl"] as const) {
  test(`REQ-S15-001 at 1440 px with demo data (${who}): home and executive pages`, async ({ page }, info) => {
    const lang = langOf(info);
    await page.setViewportSize(WIDE);
    await signIn(page, lang, who);
    const out: Record<string, unknown>[] = [];
    const problems: string[] = [];
    for (const route of ["/my-work", "/executive-overview"]) {
      await page.goto(route);
      await expect(page.locator("main#main h1")).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.evaluate(() => window.scrollTo(0, 0));
      for (const key of REGIONS) {
        const region = page.getByRole("region", { name: tr(lang, key), exact: true });
        const n = await region.count();
        if (n !== 1) {
          problems.push(`${route} ${key}: ${n} regions`);
          continue;
        }
        const box = (await region.boundingBox())!;
        const empty = await region.locator("[data-state='empty']").count();
        const items = await region.locator("li, tr, [data-item], a[href]").count();
        const text = (await region.innerText()).replace(/\s+/g, " ").trim();
        out.push({ route, key, top: Math.round(box.y), bottom: Math.round(box.y + box.height), empty: empty > 0, items, text: text.slice(0, 200) });
        if (box.y < 0 || box.y + box.height > WIDE.height) problems.push(`${route} ${key}: outside the first screen (${Math.round(box.y)}-${Math.round(box.y + box.height)})`);
      }
      const scrollY = await page.evaluate(() => window.scrollY);
      if (scrollY !== 0) problems.push(`${route}: scrollY ${scrollY}`);
      mkdirSync(path.join(OUT, "shots"), { recursive: true });
      await page.screenshot({ path: path.join(OUT, "shots", `1440-${lang}-${who}-${route.slice(1)}.png`) });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `demo-1440-${lang}-${who}.json`), JSON.stringify({ out, problems }, null, 1));
    console.log(`DEMO-1440 ${lang} ${who}: ${JSON.stringify(out.map((o) => `${o["route"]} ${String(o["key"]).split(".")[2]} empty=${o["empty"]} items=${o["items"]}`))}; problems ${JSON.stringify(problems)}`);
    expect(problems).toEqual([]);
  });
}
