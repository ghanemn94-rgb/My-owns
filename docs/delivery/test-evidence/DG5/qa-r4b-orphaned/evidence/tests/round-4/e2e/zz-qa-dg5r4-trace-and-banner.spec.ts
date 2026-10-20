// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4B), DEMO stack (e2e/support/with-demo-stack.sh). NOT part of the candidate:
// copied into a disposable clone's e2e/ for the run only. The round-1 probe (zz-qa-dg5r1c-demo-probes.spec.ts) reads the
// screen once, right after `networkidle`; under the round-4 review load it read the traceability screen while its graph
// still showed "Loading…" (en, locale unset), and the demo banner before /environment had resolved on 2 screens per
// language. This revision checks the SAME things, but waits (polls up to 30 s) for the rendered content first:
//  R4-PB-090: the traceability screen renders each B0147 chain's five labels (verbatim from docs/source/playbook.md);
//  R4-S18-001: the persistent synthetic banner, with its catalogue text, on the screens where the round-1 probe's
//              single read missed it (reader B0031, admin health schemes, launch plan, health check) and on the
//              Diagnose and traceability screens.
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance; approves nothing real).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";
import { catalogue, demoPage } from "./support/a02-demo.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r4");
test.setTimeout(300_000);

const CHAINS = [
  ["Low activation", "Proposition + journey", "Pass redesign + digital activation", "Attach rate / activation", "Revenue uplift"],
  ["High complaints", "Journey + service assurance", "Proactive comms + QoS monitoring", "Complaint rate", "CX + care cost"],
  ["Partner cost pressure", "Partner model + analytics", "Partner optimization", "Cost/MB, margin", "Margin improvement"],
];

test("R4-PB-090 and R4-S18-001: the B0147 chains on the rendered traceability screen; the demo banner on every listed screen", async ({ browser }, info) => {
  const lang: Lang = langOf(info);
  const p = await demoPage(browser, lang, "tl");
  await p.goto(`/transformations/${ROAMING}/traceability`);
  await expect(p.locator("main#main h1")).toBeVisible();
  const missingOf = async () => {
    const text = (await p.locator("main#main").innerText()).replace(/\s+/g, " ");
    return CHAINS.flat().filter((l) => !text.includes(l));
  };
  await expect.poll(missingOf, { timeout: 30_000, intervals: [500] }).toEqual([]);
  const text = (await p.locator("main#main").innerText()).replace(/\s+/g, " ");
  const lines = CHAINS.map((c) => c.join(" -> "));
  const banners: Record<string, boolean> = {};
  const expected = catalogue(lang, "playbookP5.demo.banner").trim();
  const screens = [
    "/playbook/reader/B0031",
    `/transformations/${ROAMING}/launch-plan`,
    `/transformations/${ROAMING}/health-check`,
    `/transformations/${ROAMING}/diagnose`,
    `/transformations/${ROAMING}/traceability`,
  ];
  for (const url of screens) {
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    const banner = p.locator("[data-state='demo-synthetic']");
    await expect(banner).toHaveCount(1, { timeout: 30_000 });
    banners[url.replace(ROAMING, "<roaming>")] = (await banner.innerText()).trim() === expected;
  }
  await p.context().close();
  // admin health schemes: the demo methodology owner (TO), as in the round-1 probe
  const adm = await demoPage(browser, lang, "to");
  await adm.goto("/admin/health-schemes");
  await expect(adm.locator("main#main h1")).toBeVisible();
  const ab = adm.locator("[data-state='demo-synthetic']");
  await expect(ab).toHaveCount(1, { timeout: 30_000 });
  banners["/admin/health-schemes"] = (await ab.innerText()).trim() === expected;
  await adm.context().close();
  mkdirSync(path.join(EVIDENCE, lang), { recursive: true });
  writeFileSync(path.join(EVIDENCE, lang, "r4-trace-banner.json"), JSON.stringify({ chainLines: lines, banners, traceText: text }, null, 1));
  console.info(`R4 ${lang}: all 15 chain labels rendered; banners ${JSON.stringify(banners)}`);
  expect(Object.values(banners).every(Boolean), JSON.stringify(banners)).toBe(true);
});
