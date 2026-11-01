// qa-verifier DG6 round 1 diagnostic (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// e2e/zz-qa-dg6r1-upload-policy-overflow.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
// Follows up the reflow probe (zz-qa-dg6r1-aud-reflow.spec.ts B): Administration > Upload policy scrolled horizontally in
// English at 360 px. This lists the elements of <main> whose right edge (en) or left edge (ar) lies outside the viewport,
// at 360 x 800 and at 1280 x 900 with the root font size at 200 %, and takes screenshots. Synthetic data only.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r1";

test("diagnostic: which element of /admin/upload-policy overflows at 360 px and at 200 % text", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  const out: Record<string, unknown> = {};
  for (const m of [
    { name: "360", width: 360, height: 800, font: null as string | null },
    { name: "200pct", width: 1280, height: 900, font: "200%" },
  ]) {
    await page.setViewportSize({ width: m.width, height: m.height });
    await page.goto("/admin/upload-policy");
    if (m.font) await page.evaluate((f) => document.documentElement.style.setProperty("font-size", f, "important"), m.font);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const r = await page.evaluate(() => {
      const se = document.scrollingElement as HTMLElement;
      const vw = se.clientWidth;
      const over: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("main#main *"))) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (b.right > vw + 1 || b.left < -1) {
          const parentOver = el.parentElement && (() => { const p = el.parentElement!.getBoundingClientRect(); return p.right > vw + 1 || p.left < -1; })();
          if (!parentOver)
            over.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 60)} [${Math.round(b.left)}..${Math.round(b.right)}] "${(el.innerText ?? "").replace(/\s+/g, " ").slice(0, 80)}"`);
        }
      }
      return { scrollW: se.scrollWidth, clientW: vw, over: over.slice(0, 15) };
    });
    out[m.name] = r;
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `upload-policy-${lang}-${m.name}.png`), fullPage: true });
  }
  writeFileSync(path.join(OUT, `upload-policy-overflow-${lang}.json`), JSON.stringify(out, null, 1));
  console.log(`UPLOAD-POLICY ${lang}: ${JSON.stringify(out)}`);
});
