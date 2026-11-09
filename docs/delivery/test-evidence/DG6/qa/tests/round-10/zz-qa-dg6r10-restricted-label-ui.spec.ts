// qa-verifier DG6 round 10 (T-DG6-REV-QA-R10, session 094e31f2) on candidate 56415aee (source cde60365): round 9's standing probe re-used; changes: names r9 -> r10 only (the lines below are the earlier rounds' text).
// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-restricted-label-ui.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-restricted-label-ui.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R10 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R7) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-restricted-label-ui.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r9 and QA-R6 -> QA-R10 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R6): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as e2e/zz-qa-dg6r10-restricted-label-ui.spec.ts and run on e2e/support/with-demo-stack.sh
// (demo-initialized stack, AUTH_MODE=dev, demo role users roaming.user.* via the dev sign-in, D-165), chromium-en and
// chromium-ar.
// Question (REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the grant"; ADR-0051 §2
// "Totals and rollups" and its 2026-11-06 amendment "Totals that are the same for every reader ... the table totals and
// metrics of every report section"; D-195 Q3; T-DG6-BE-Z7B F-DG6-340/360 and its residual §7 item 4): on the REAL stack
// and screens, once the TO marks one demo benefit sensitive,
//   1. the Executive Overview shown to the TL (not admitted) carries the label "Includes restricted records" /
//      "يشمل سجلات مقيدة" and never the benefit's id; the TO (admitted) sees no label;
//   2. the live benefits register: through the API, every section's totals are identical for TL and TO and the TL's
//      flagged sections carry includesRestrictedRecords true (the API side of the rule);
//   3. the same preview ON SCREEN: the TL sees no row of the benefit and the label, and the SAME totals rows as the TO
//      (the totals are identical for every reader), unchanged by marking; the TO sees the row and no label.
// Round-6 first run (07-e2e-demo-unset.log): clause 3 failed in en (TL 2 totals rows, TO 3): a section whose only row is
// the restricted benefit shows its empty text and NO totals to the TL. This version also reads the sensitivity version
// before marking (the first version assumed version 0 and got 409 in the second project) and saves screenshots.
// The benefit is unmarked at the end. Every value is SYNTHETIC demo data. Nothing approves anything (no G1-G6 business
// approval; unrelated to DG0-DG7).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, tr, type Lang } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r10";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function preview(page: Page, lang: Lang, tid: string) {
  await page.goto(`/transformations/${tid}/reports`);
  const form = page.locator("[data-form='generate-report']");
  await form.locator("#report-definition").selectOption("registers");
  await form.locator("#report-register").selectOption("benefits");
  await form.getByRole("button", { name: tr(lang, "reportsP5.generate.preview") }).click();
  const live = page.locator("[data-live-preview='registers']");
  await expect(live.locator("[data-state='live-not-stored']")).toBeVisible({ timeout: 60_000 });
  await expect(live.locator("table, [data-empty-table]").first()).toBeVisible({ timeout: 60_000 });
  return live;
}

test("QA-R10 restricted benefit: overview label, register rows, labels and identical totals (API and screen)", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  mkdirSync(OUT, { recursive: true });
  const to = await demoApi(playwright, "to");
  const tl = await demoApi(playwright, "tl");
  const ts = await to.call<Body>("GET", "/api/v1/transformations?limit=50");
  let tid = "";
  let benefit: Body | undefined;
  for (const t of ts.items as Body[]) {
    const bs = await to.call<Body>("GET", `/api/v1/transformations/${t.id}/benefits?limit=100`);
    if ((bs.items as Body[]).length >= 2) {
      tid = t.id;
      benefit = (bs.items as Body[])[0];
      break;
    }
  }
  expect(benefit, "a demo transformation with at least two benefits").toBeDefined();
  const bid = String(benefit!.id);
  const sensPath = `/api/v1/transformations/${tid}/records/benefit/${bid}/sensitivity`;
  const livePath = `/api/v1/transformations/${tid}/reports/registers/live?parameters=${encodeURIComponent(JSON.stringify({ register: "benefits" }))}`;
  console.log(`QA-R10 restricted-label ${lang}: transformation ${tid}, benefit ${bid} (${benefit!.code})`);

  const toPage = await demoPage(browser, lang, "to");
  const tlPage = await demoPage(browser, lang, "tl");
  const tlBefore = await preview(tlPage, lang, tid);
  const beforeTotals = await tlBefore.locator("tr[data-totals='true']").allInnerTexts();
  expect(await tlBefore.locator(`[data-record='${bid}']`).count(), "TL sees the row before marking").toBeGreaterThan(0);

  const current = await to.call<Body>("GET", sensPath);
  expect(current.isSensitive, "the benefit starts unmarked").toBe(false);
  const mark = await to.call<Body>(
    "PUT",
    sensPath,
    { isSensitive: true, reason: "QA-R10 synthetic sensitivity probe" },
    { ifMatch: Number(current.version) },
  );
  const failures: string[] = [];
  try {
    // 1. Executive Overview.
    for (const [who, page, expectLabel] of [
      ["TL", tlPage, true],
      ["TO", toPage, false],
    ] as const) {
      await page.goto(`/executive-overview`);
      await expect(page.locator("[data-transformation-count]")).toBeVisible({ timeout: 60_000 });
      const labels = page.locator("main [data-restricted-records='true']");
      if (expectLabel) {
        await expect(labels.first()).toBeVisible();
        await expect(labels.first()).toContainText(tr(lang, "access.includesRestrictedRecords"));
        expect((await page.content()).includes(bid), `${who} overview DOM names the benefit id`).toBe(false);
      } else await expect(labels).toHaveCount(0);
      console.log(`QA-R10 overview ${who} ${lang}: labels ${await labels.count()}`);
    }
    // 2. The API: per section, totals of TL and TO, the TL's rows of the benefit and the flag.
    const docTo = (await to.call<Body>("GET", livePath)).document;
    const docTl = (await tl.call<Body>("GET", livePath)).document;
    for (const s of docTl.sections as Body[]) {
      if (s.kind !== "table") continue;
      const t = (docTo.sections as Body[]).find((x) => x.key === s.key)!;
      const line =
        `QA-R10 API ${lang} section ${s.key}: TL rows ${s.rows.length} (TO ${t.rows.length}); ` +
        `TL totals ${JSON.stringify(s.totals)} TO totals ${JSON.stringify(t.totals)}; ` +
        `flag TL ${s.includesRestrictedRecords} TO ${t.includesRestrictedRecords}; ` +
        `TL rows of the benefit ${s.rows.filter((r: Body) => r.recordId === bid).length}`;
      console.log(line);
      if (JSON.stringify(s.totals) !== JSON.stringify(t.totals)) failures.push(`API totals differ: ${s.key}`);
      if (s.rows.some((r: Body) => r.recordId === bid)) failures.push(`API TL row of the benefit: ${s.key}`);
    }
    // 3. On screen.
    const tlLive = await preview(tlPage, lang, tid);
    const toLive = await preview(toPage, lang, tid);
    await tlPage.screenshot({ path: path.join(OUT, `restricted-register-TL-${lang}.png`), fullPage: true });
    await toPage.screenshot({ path: path.join(OUT, `restricted-register-TO-${lang}.png`), fullPage: true });
    expect(await tlLive.locator(`[data-record='${bid}']`).count(), "TL: no row of the benefit").toBe(0);
    expect(await toLive.locator(`[data-record='${bid}']`).count(), "TO: the benefit's row").toBeGreaterThan(0);
    const tlLabel = tlLive.locator("[data-restricted-records='true']");
    await expect(tlLabel.first()).toBeVisible();
    await expect(tlLabel.first()).toContainText(tr(lang, "access.includesRestrictedRecords"));
    await expect(toLive.locator("[data-restricted-records='true']")).toHaveCount(0);
    const tlEmpty = await tlLive.locator("[data-empty-table]").evaluateAll((els) =>
      els.map((e) => `${e.getAttribute("data-empty-table")}: ${(e.textContent ?? "").trim()}`),
    );
    const toEmpty = await toLive.locator("[data-empty-table]").evaluateAll((els) =>
      els.map((e) => `${e.getAttribute("data-empty-table")}: ${(e.textContent ?? "").trim()}`),
    );
    const tlTotals = await tlLive.locator("tr[data-totals='true']").allInnerTexts();
    const toTotals = await toLive.locator("tr[data-totals='true']").allInnerTexts();
    console.log(
      `QA-R10 screen ${lang}: TL totals rows ${tlTotals.length} ${JSON.stringify(tlTotals)}; TO totals rows ${toTotals.length} ${JSON.stringify(toTotals)}; ` +
        `before ${beforeTotals.length}; TL empty-table texts ${JSON.stringify(tlEmpty)}; TO ${JSON.stringify(toEmpty)}`,
    );
    if (JSON.stringify(tlTotals) !== JSON.stringify(toTotals)) failures.push("screen totals differ between TL and TO");
    if (JSON.stringify(tlTotals) !== JSON.stringify(beforeTotals)) failures.push("screen totals changed by marking");
    expect((await tlPage.content()).includes(bid), "TL report DOM names the benefit id").toBe(false);
  } finally {
    await to.call(
      "PUT",
      sensPath,
      { isSensitive: false, reason: "QA-R10 probe cleanup" },
      { ifMatch: Number(mark.version) },
    );
  }
  expect(failures, "API and screen totals identical for every reader").toEqual([]);
});
