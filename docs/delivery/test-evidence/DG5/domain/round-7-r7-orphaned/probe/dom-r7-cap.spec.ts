// domain-reviewer DG5 round-7 probe (D-181 scope): the pre-existing helper fetchAllPages (apps/web/src/api/queries.ts
// lines 105-119: at most 20 pages of PAGINATION.maxLimit = 100, then `break`, no error) feeds the transformation
// choices that wave AB2 did not move to useAllTransformations. With MORE THAN 2000 transformations, compare the
// executive overview's "Transformation" filter (dashboards/ui.tsx FilterBar, useReadableTransformations) with the
// API's own all-pages count, in EN and AR. Production-initialized stack (apps/web/e2e/support/with-stack.sh).
// SYNTHETIC data only; nothing approves anything real; G1-G6 never relate to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
type TrPage = { items: { id: string; code: string }[]; nextCursor: string | null };

test("more than 2000 transformations: the executive-overview transformation filter vs the API", async ({ page, playwright }, info) => {
  test.setTimeout(1_500_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const countAll = async (s: typeof office) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ sort: "code:asc", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const p: TrPage = await s.call<TrPage>("GET", `/api/v1/transformations?${q.toString()}`);
      ids.push(...p.items.map((x) => x.id));
      cursor = p.nextCursor;
    } while (cursor);
    return ids;
  };
  let all = await countAll(office);
  for (let i = all.length; i <= 2010; i++)
    await lead.call("POST", "/api/v1/transformations", { businessUnitId: SYN_RETAIL, name: `Synthetic DOM-R7 cap ${i + 1}`, mode: "end_to_end" });
  all = await countAll(office);
  await signIn(page, lang, "dev.office");
  await page.goto("/executive-overview");
  const sel = page.locator("select[data-filter='transformation']");
  await expect(sel).toBeVisible({ timeout: 60_000 });
  await expect(sel.locator("option").nth(5)).toBeAttached({ timeout: 120_000 });
  const offered = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const missing = all.filter((id) => !offered.includes(id)).length;
  const alertText = await page.locator("main [role='alert']").allInnerTexts();
  const hint = await page.locator("[id$='-tr-hint']").first().innerText().catch(() => "");
  mkdirSync(join(OUT, "cap"), { recursive: true });
  writeFileSync(join(OUT, "cap", `${lang}-executive-filter.json`), JSON.stringify({ apiCount: all.length, offered: offered.length, missing, alertText, hint }, null, 1));
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, "r7-cap-executive-filter.png") });
  // Recorded, not asserted: the result is the observation.
  expect(all.length).toBeGreaterThan(2000);
});
