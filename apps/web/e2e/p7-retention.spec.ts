// T-DG7-FE-D (p7-work-split §E.4 T-E25 is "axe, keyboard, 360 px" over the Retention screens of §E.6). Those screens are
// NOT BUILT: T-DG7-FE-C's assignment covered §I.2 only (its handback, Known gaps 1), so their five routes still show the
// honest "not available yet" placeholder (components/P7NotAvailablePage.tsx). This spec therefore does NOT satisfy T-E25.
// It checks only what exists, on the REAL stack (support/with-stack.sh), in chromium-en and chromium-ar: each placeholder
// is reachable, says it is not available (no data, no form), and passes axe at 1280 px and 360 px with no page-level
// horizontal scroll, its direction following the language. When the §E.6 screens land, this file is the place for T-E25.
// All data is SYNTHETIC (dev.admin holds ADM_TECH).
//
// Budget (F-DG5-145/146/151): 90 s. Measured worst case in docs/delivery/handbacks/DG7/T-DG7-FE-D-evidence/e2e-p7.log.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SHOTS, axeSummary, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

test.setTimeout(90_000);

// Every axe result of this file (violations of any impact, so moderate and minor ones are visible too), per language.
test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.startsWith(`${lang}/p7-placeholder-`)));
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "p7-retention-axe-summary.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

const PLACEHOLDERS: readonly { name: string; path: string; feature: string }[] = [
  { name: "retention", path: "/admin/retention", feature: "retention" },
  { name: "retention-class", path: "/admin/retention/classes/synthetic_class", feature: "retentionClass" },
  {
    name: "retention-run",
    path: "/admin/retention/runs/01920000-0000-7000-9000-00000000f7d1",
    feature: "retentionRun",
  },
  { name: "retention-archived", path: "/admin/retention/archived", feature: "retentionArchived" },
  { name: "backup-sets", path: "/admin/retention/backups", feature: "backupSets" },
];

test("P7 Retention routes (placeholders only; T-E25 not satisfiable): axe, RTL/LTR, 360 px", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  const dir = lang === "ar" ? "rtl" : "ltr";
  for (const p of PLACEHOLDERS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(p.path);
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, `nav.p7.${p.feature}.title`));
    await expect(page.locator(`[data-p7-feature='${p.feature}']`)).toBeVisible();
    await expect(page.locator("[data-state='being-built']")).toContainText(tr(lang, "nav.p7.notAvailableTitle"));
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    expect(await page.locator("main#main").evaluate((m) => getComputedStyle(m).direction)).toBe(dir);
    await expectAccessible(page, lang, `p7-placeholder-${p.name}`);
    await page.setViewportSize({ width: 360, height: 800 });
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(m.scroll, `${p.name}: no horizontal page scroll at 360 px`).toBeLessThanOrEqual(m.client);
    await expectAccessible(page, lang, `p7-placeholder-${p.name}-360`);
    await shot(page, lang, `p7-placeholder-${p.name}-360`);
  }
  expect(foreign).toEqual([]);
});
