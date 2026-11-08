// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-breadcrumb-tab-order.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r8 and QA-R7 -> QA-R8 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R8) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-breadcrumb-tab-order.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r8 and QA-R6 -> QA-R8 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R8; copied unchanged from my round-5 probe except names): copied from round-4/zz-qa-dg6r4-breadcrumb-tab-order.spec.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 (round 5); now dg6r5 -> dg6r8 (round 6) outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): copied unchanged in its checks from round-3/zz-qa-dg6r3-breadcrumb-tab-order.spec.ts (round 3) and re-run on candidate 4b84bf20; only names r3 -> r4.
// qa-verifier DG6 round 3 (T-DG6-REV-QA-R4): the round-2 probe zz-qa-dg6r2-breadcrumb-tab-order.spec.ts re-run on candidate aa219bd2, unchanged except for its names (dg6r2 -> dg6r4).
// qa-verifier DG6 round 2 (T-DG6-REV-QA-R2; the round-1 probe re-run unchanged except for its names)
// Originally: qa-verifier DG6 round 1 diagnostic (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// e2e/zz-qa-dg6r8-breadcrumb-tab-order.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
// Follows up the walkthrough keyboard probe, which never focused the FIRST breadcrumb link of a screen. This records the
// real Tab order on two screens with breadcrumbs: (1) from the top of the document through the whole shell, and (2) after
// activating the skip link; and reports whether every breadcrumb link is a Tab stop. Synthetic data only.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r8";

async function tabOrder(page: Page, max: number) {
  const seq: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    seq.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "(body)";
        const where = el.closest("nav[aria-label*='readcrumb'], nav.breadcrumbs, [data-breadcrumbs], ol.breadcrumbs")
          ? "breadcrumb"
          : el.closest("main#main")
            ? "main"
            : "shell";
        return `${where}: ${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
      }),
    );
  }
  return seq;
}

test("diagnostic: breadcrumb links in the Tab order", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  const out: Record<string, unknown> = {};
  for (const route of ["/admin/upload-policy", "/admin/integrations/webhooks"]) {
    await page.goto(route);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const crumbs = await page.evaluate(() => {
      const main = document.querySelector("main#main")!;
      const nav = main.querySelector("nav");
      return {
        navLabel: nav?.getAttribute("aria-label") ?? null,
        links: Array.from(nav?.querySelectorAll("a") ?? []).map((a) => ({
          text: (a as HTMLElement).innerText.trim(),
          tabIndex: (a as HTMLElement).tabIndex,
          href: a.getAttribute("href"),
          display: getComputedStyle(a).display,
          visibility: getComputedStyle(a).visibility,
        })),
        mainTabIndex: (main as HTMLElement).getAttribute("tabindex"),
        firstInMain: (main.firstElementChild as HTMLElement | null)?.tagName ?? null,
      };
    });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const fromTop = await tabOrder(page, 80);
    await page.goto(route);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab"); // skip link
    const skip = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("href"));
    await page.keyboard.press("Enter");
    const afterSkipFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName.toLowerCase()}#${el.id}` : null;
    });
    const afterSkip = await tabOrder(page, 6);
    out[route] = { crumbs, fromTop: fromTop.filter((s) => !s.startsWith("shell")).slice(0, 8), fromTopShellStops: fromTop.filter((s) => s.startsWith("shell")).length, skip, afterSkipFocus, afterSkip };
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `breadcrumb-tab-order-${lang}.json`), JSON.stringify(out, null, 1));
  console.log(`BREADCRUMB-TAB ${lang}: ${JSON.stringify(out)}`);
});
