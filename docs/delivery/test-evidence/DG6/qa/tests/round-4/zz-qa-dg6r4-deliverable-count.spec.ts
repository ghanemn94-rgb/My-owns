// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as e2e/zz-qa-dg6r4-deliverable-count.spec.ts and run on apps/web/e2e/support/with-stack.sh.
// Assignment item: "Run p3-ui-completion (the deliverable-count warning) in both locales and report what you see."
// p3-ui-completion asserts only that [data-warning='initiative.deliverable_count'] is visible with 0 deliverables and gone
// with 3. This probe records the warning's TEXT and direction in en and ar at 0, 3, 7 and 8 active deliverables
// (ADR-0021 §2: 3-7 recommended; outside it a warning, never a rejection), and that the 8th is accepted (201).
// SYNTHETIC data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test.setTimeout(240_000);

test("deliverable-count warning: text in the page language at 0, 3, 7 and 8 deliverables", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R4 deliverable count ${lang} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  const i = await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
    transformationId: t.id,
    name: `Synthetic QA R4 initiative ${lang}`,
  });
  await signIn(page, lang, "dev.lead");
  const expected = tr(lang, "portfolio.warning.initiative__deliverable_count");
  const results: Record<string, unknown>[] = [];
  let made = 0;
  for (const target of [0, 3, 7, 8]) {
    while (made < target) {
      made++;
      await lead.call("POST", `/api/v1/initiatives/${i.id}/deliverables`, { title: `Synthetic deliverable ${made}` });
    }
    await page.goto(`/transformations/${t.id}/initiatives/${i.id}`);
    await expect(page.locator("main#main h1")).toBeVisible();
    const section = page.locator("section#deliverables");
    await expect(section).toBeVisible();
    // Round-4 fix (probe race, run 08b): wait until the deliverables query has answered (the count is rendered with it).
    await expect(section.locator(`[data-deliverable-count='${target}']`)).toBeVisible({ timeout: 30_000 });
    const w = section.locator("[data-warning='initiative.deliverable_count']");
    const n = await w.count();
    const text = n > 0 ? ((await w.first().innerText()) ?? "").trim() : null;
    const dir = await page.locator("html").getAttribute("dir");
    // Round-4 extension (after the first run showed no warning at 8): the server's own answer and the displayed count.
    const apiList = await lead.call<{ items: unknown[]; countWarning: unknown }>("GET", `/api/v1/initiatives/${i.id}/deliverables?limit=100`);
    const shownCount = await section.locator("[data-deliverable-count]").getAttribute("data-deliverable-count");
    results.push({ deliverables: target, warningShown: n > 0, text, dir, catalogueTextContained: text?.includes(expected) ?? null,
      apiItems: apiList.items.length, apiCountWarning: apiList.countWarning, shownCount });
    await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/qa-r4-deliverable-count-${lang}-${target}.png`, fullPage: false });
  }
  console.log(`QA-R4 DELIVERABLE-COUNT ${lang}: expected text ${JSON.stringify(expected)}; ${JSON.stringify(results)}`);
  expect(results.map((r) => r["warningShown"])).toEqual([true, false, false, true]);
  for (const r of results.filter((x) => x["warningShown"])) expect(r["catalogueTextContained"]).toBe(true);
});
