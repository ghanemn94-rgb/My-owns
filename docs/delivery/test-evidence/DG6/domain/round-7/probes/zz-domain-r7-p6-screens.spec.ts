// domain-reviewer DG6 round 7 (T-DG6-REV-DOM-RG-R7): P6 screens rendered in EN and AR on the production-initialized
// stack. NOT part of the candidate: copied into a disposable clone's e2e/ folder and run with
// apps/web/e2e/support/with-stack.sh. Read-only: it opens screens as dev.admin (SYNTHETIC user), reads and screenshots.
// For every screen: the direction matches the language, the page heading renders, no line names an engineering
// delivery gate (DG0-DG7), and no line shows a placeholder leak ("undefined", "NaN", "[object Object]", "null").
// The assistant page must show it is off (production-initialized, disconnected install: REQ-S17-007).
// Round 7 adds the screens that render the texts reworded by migration 0130 (F-DG6-990 regression): the Jobs page
// (job descriptions), a seeded procedure definition (validation rules loaded into the form fields) and the
// automation rules list.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

const SHOTS = process.env["E2E_SCREENSHOT_DIR"] ?? "test-results/zz-domain-r7";
const DG = /(?<![A-Za-z0-9-])DG[0-7](?![0-9])/;
const LEAK = /(?<![A-Za-z])(undefined|NaN|\[object Object\]|null)(?![A-Za-z])/;

async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const values = Array.from(document.querySelectorAll("input, textarea")).map(
      (e) => (e as HTMLInputElement | HTMLTextAreaElement).value,
    );
    return `${document.body.innerText}\n${values.join("\n")}`;
  });
}

async function check(page: Page, lang: "en" | "ar", name: string, must: (string | RegExp)[] = []) {
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const text = await screenText(page);
  for (const m of must) {
    if (typeof m === "string") expect(text, `${name}: shows "${m}"`).toContain(m);
    else expect(text, `${name}: shows ${m}`).toMatch(m);
  }
  const dg = text.split("\n").filter((l) => DG.test(l));
  const leak = text.split("\n").filter((l) => LEAK.test(l));
  console.log(`[DOM-R7 ui] ${lang} ${name}: DG lines ${dg.length}, placeholder-leak lines ${leak.length}`);
  expect(dg, `${name}: DG token`).toEqual([]);
  expect(leak, `${name}: placeholder leak`).toEqual([]);
  mkdirSync(path.join(SHOTS, lang), { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, lang, `zz-r7-${name}.png`), fullPage: true });
}

test("DG6 round 7: P6 screens render in the user's language with no gate label or placeholder leak", async ({ page }, info) => {
  test.setTimeout(600_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");

  await page.goto("/admin/assistant");
  // Off by default in a disconnected install (REQ-S17-007): "Off (not configured)" or "Off", never "On".
  await check(page, lang, "assistant-off");
  const t = await screenText(page);
  expect(t.includes(tr(lang, "assistant.admin.statusNotConfigured")) || t.includes(tr(lang, "assistant.admin.statusOff")), "assistant off").toBe(true);

  for (const [route, name] of [
    ["/admin/integrations", "integrations"],
    ["/admin/integrations/outbound-writes", "outbound-writes"],
    ["/admin/integrations/webhooks", "webhooks"],
    ["/admin/notification-channels", "notification-channels"],
    ["/admin/operations", "operations"],
    ["/admin/jobs", "jobs"],
    ["/admin/jobs/operations", "jobs-operations"],
    ["/admin/jobs/operations/kpi.freshness_scan", "job-freshness-scan"],
    ["/admin/procedures", "procedures"],
    ["/admin/procedures/kpi_submission", "procedure-kpi-submission"],
    ["/admin/procedures/benefit_validation", "procedure-benefit-validation"],
    ["/admin/automation", "automation-rules"],
    ["/admin/sensitive-grants", "sensitive-grants"],
    ["/strategy-kpis/imports", "imports"],
    ["/my-work", "my-work"],
    ["/my-work/notification-preferences", "notification-preferences"],
    ["/search", "search"],
  ] as const) {
    await page.goto(route);
    await check(page, lang, name);
  }
});
