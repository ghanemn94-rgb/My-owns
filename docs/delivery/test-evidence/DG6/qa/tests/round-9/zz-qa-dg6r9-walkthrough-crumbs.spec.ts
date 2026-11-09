// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-walkthrough-crumbs.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R9) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-walkthrough-crumbs.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R9 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R9) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-walkthrough-crumbs.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r9 and QA-R6 -> QA-R9 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R9; copied unchanged from my round-5 probe except names): copied from round-4/zz-qa-dg6r4-walkthrough-crumbs.spec.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 (round 5); now dg6r5 -> dg6r9 (round 6) outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): copied unchanged in its checks from round-3/zz-qa-dg6r3b-walkthrough-crumbs.spec.ts (round 3) and re-run on candidate 4b84bf20; only names r3 -> r4.
// qa-verifier DG6 round 3 continuation (T-DG6-REV-QA-R4): independent follow-up probe, NOT part of the frozen candidate.
// Copied into a disposable copy as e2e/zz-qa-dg6r9-walkthrough-crumbs.spec.ts and run inside e2e/support/with-demo-stack.sh.
// Settles the two kinds of line that the stopped run's walkthrough-keyboard probe (zz-qa-dg6r9-demo-keyboard.spec.ts)
// reported as "unreachable" on the walkthrough step screens (07-e2e-demo-unset-and-probes.log), WITHOUT the data-qa-kb
// marker that probe relies on:
//   1. the first breadcrumb link ("Transformations" / its Arabic label, or "Evidence and Reports"): on every step screen,
//      after the skip link, Tab is pressed until focus leaves the breadcrumb; the focused element is identified by its
//      href and text. The probe also records whether a marker set on the link survives 3 s (a re-rendered link loses it,
//      which would explain the other probe's report);
//   2. the "Value and feasibility per initiative" region on /prioritization: whether it is inside a closed <details>,
//      and whether, after opening the <details> by keyboard (Tab to its <summary>, Enter), Tab reaches the region.
// SYNTHETIC demo data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r9";

async function skipToMain(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.keyboard.press("Tab");
  const isSkip = await page.evaluate(() => {
    const el = document.activeElement as HTMLAnchorElement | null;
    return !!el && el.tagName === "A" && (el.getAttribute("href") ?? "").startsWith("#");
  });
  if (isSkip) await page.keyboard.press("Enter");
  return isSkip;
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    return {
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute("href"),
      text: (el.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      inCrumbs: !!el.closest("nav[aria-label] ol, nav.breadcrumbs, [data-breadcrumbs]") && !!el.closest("main#main"),
      role: el.getAttribute("role"),
    };
  });

test("walkthrough step screens: the breadcrumb links are Tab stops; the prioritization region after opening its details", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.to");
  await page.goto("/walkthrough");
  const picker = page.locator("[data-filter='walkthrough-transformation']");
  await expect(picker).toBeVisible();
  const tId = await picker.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v) ?? "");
  expect(tId).not.toBe("");
  await page.goto(`/walkthrough?transformationId=${tId}`);
  // Run 1 read the links before the list rendered (0 of 12; 33-...-cutf8.log): wait for all twelve first.
  await expect(page.locator("[data-step-link]")).toHaveCount(12, { timeout: 30_000 });
  const hrefs =await page.locator("[data-step-link]").evaluateAll((ls) => ls.map((l) => l.getAttribute("href") ?? ""));
  expect(hrefs).toHaveLength(12);
  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const href of [...new Set(hrefs)]) {
    await page.goto(href);
    await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const crumbs = await page.locator("main#main nav[aria-label] ol a[href], main#main [data-breadcrumbs] a[href]").evaluateAll((as) =>
      as.map((a) => ({ href: a.getAttribute("href"), text: (a as HTMLElement).innerText.trim(), tabIndex: (a as HTMLElement).tabIndex })),
    );
    // Marker persistence: does the first crumb element survive 3 s?
    const marked = await page
      .locator("main#main nav[aria-label] ol a[href]")
      .first()
      .evaluate((a) => {
        a.setAttribute("data-qa-r4", "1");
        return true;
      })
      .catch(() => false);
    await page.waitForTimeout(3_000);
    const markerKept = marked ? (await page.locator("main#main [data-qa-r4='1']").count()) === 1 : null;
    await skipToMain(page);
    const seq: unknown[] = [];
    for (let i = 0; i < Math.max(4, crumbs.length + 2); i++) {
      await page.keyboard.press("Tab");
      seq.push(await focused(page));
    }
    const reached = crumbs.map((c) => seq.some((s) => !!s && (s as { href: string | null }).href === c.href));
    crumbs.forEach((c, i) => {
      if (!reached[i]) problems.push(`${href}: crumb ${c.text} (${c.href}) not reached by Tab after the skip link`);
    });
    out[href] = { crumbs, markerKept, afterSkip: seq };
  }
  // The prioritization region.
  const prio = hrefs.find((h) => h.endsWith("/prioritization"));
  if (prio) {
    await page.goto(prio);
    await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    // Run 2 took the FIRST role=region ("Weight set versions"), not the one the other probe named; select it by its
    // label (prioritization.chart.tableCaption), which RankedTable.tsx renders inside <details><TableRegion>.
    const caption = lang === "ar" ? "القيمة وقابلية التنفيذ لكل مبادرة" : "Value and feasibility per initiative";
    const region = page.locator(`main#main [role=region][aria-label="${caption}"]`).first();
    const info0 = await region.evaluate((el) => ({
      label: el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby"),
      tabIndex: (el as HTMLElement).tabIndex,
      inClosedDetails: !!el.closest("details:not([open])"),
      size: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
    }));
    let opened = false;
    let regionReached = false;
    if (info0.inClosedDetails) {
      const summary = region.locator("xpath=ancestor::details[1]/summary");
      await skipToMain(page);
      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Tab");
        if (await summary.evaluate((el) => el === document.activeElement)) {
          await page.keyboard.press("Enter");
          opened = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
          break;
        }
      }
    }
    if (!info0.inClosedDetails) await skipToMain(page);
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press("Tab");
      if (await region.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))) {
        regionReached = true;
        break;
      }
    }
    out["prioritization-region"] = { ...info0, openedByKeyboard: opened, regionReachedByTab: regionReached };
    if (!regionReached) problems.push(`prioritization region not reached by Tab (closed details: ${info0.inClosedDetails}, opened: ${opened})`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `walkthrough-crumbs-${lang}.json`), JSON.stringify({ tId, out, problems }, null, 1));
  console.log(`QA-R5 CRUMBS ${lang}: ${JSON.stringify(out)}`);
  console.log(`QA-R5 CRUMBS ${lang} problems: ${JSON.stringify(problems)}`);
  expect(problems).toEqual([]);
});
