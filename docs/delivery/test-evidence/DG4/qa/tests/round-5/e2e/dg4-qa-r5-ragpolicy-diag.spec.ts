// qa-verifier DG4 round 5 (T-DG4-REV-QA-R5): a diagnostic of the sweep check S2-lead-/dashboards/rag-policy-390px, which
// recorded 'no-h1' (neither an h1 nor the no-permission state within 20 s) in chromium-en with C.UTF-8 in two runs and
// passed (status 'no-permission') elsewhere. As the transformation lead (who may not read the RAG policy), the page is
// opened N times at 390 px, each time after the previous sweep route (/dashboards/personal) as the sweep does; every
// attempt records what main#main shows at 1, 5, 10 and 20 s (h1, data-state values, role=alert text, the API responses
// of the page with their status), and a screenshot of any attempt that has neither an h1 nor the no-permission state.
// REAL stack (qa-stack.sh), no mocks. SYNTHETIC data. Outside the frozen candidate; copied into a disposable clone only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");
const N = Number(process.env["QA_DIAG_N"] ?? "12");

test("diag: the lead opens /dashboards/rag-policy at 390 px N times; what is shown", async ({ page }, info) => {
  test.setTimeout(20 * 60_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.setViewportSize({ width: 390, height: 844 });
  const rows: unknown[] = [];
  for (let i = 0; i < N; i++) {
    await page.goto("/dashboards/personal");
    await page.locator("main#main h1").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const responses: string[] = [];
    const onResp = (r: import("@playwright/test").Response) => {
      if (r.url().includes("/api/")) responses.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
    };
    page.on("response", onResp);
    const t0 = Date.now();
    await page.goto("/dashboards/rag-policy", { timeout: 30_000 });
    const snaps: Record<string, unknown> = {};
    for (const at of [1000, 5000, 10000, 20000]) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      snaps[`${at / 1000}s`] = await page.evaluate(() => {
        const main = document.querySelector("main#main");
        return {
          h1: main?.querySelector("h1")?.textContent?.trim() ?? null,
          states: [...(main?.querySelectorAll("[data-state]") ?? [])].map((e) => e.getAttribute("data-state")),
          alerts: [...(main?.querySelectorAll("[role='alert']") ?? [])].map((e) => (e.textContent ?? "").trim().slice(0, 160)),
          mainText: (main?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
          path: location.pathname,
        };
      });
    }
    page.off("response", onResp);
    const last = snaps["20s"] as { h1: string | null; states: string[] };
    const ok = last.h1 !== null || last.states.includes("no-permission");
    if (!ok) {
      mkdirSync(join(OUT, "screens", lang), { recursive: true });
      await page.screenshot({ path: join(OUT, "screens", lang, `diag-ragpolicy-${i}.png`), fullPage: true });
    }
    rows.push({ i, ok, snaps, responses });
    console.log(`QA-DIAG ${lang} ${i} ok=${ok} ${JSON.stringify(snaps["20s"])} ${JSON.stringify(responses)}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `diag-ragpolicy-${lang}.json`), `${JSON.stringify(rows, null, 2)}\n`);
});
