// domain-reviewer DG5 round-5 probe (new in round 5) on the DEMO-initialized stack (e2e/support/with-demo-stack.sh;
// AUTH_MODE=dev, MTH_ENV=demo). It looks at the screens repair wave Z changed (F-DG5-146: the T14 export preview, the
// form framework's History and Attachments tables) in en and ar, at 1280 px and 390 px, and fetches the native
// form-record export files (exportFormRecords, ADR-0041 §5) of T14 and T01 in CSV and JSON, en and ar, to read what
// labels the downloaded file carries (REQ-S18-001 "every demo ... export shows the synthetic label"; B0004).
// SYNTHETIC data only; read-only (GET requests and page views); no approval; nothing relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
const save = (sub: string, name: string, data: string) => {
  mkdirSync(join(OUT, sub), { recursive: true });
  writeFileSync(join(OUT, sub, name), data);
};
const shot = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: true });
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("API: the native form-record export files on the demo database (en project only)", async ({ playwright }, info) => {
  test.skip(langOf(info) !== "en");
  const tl = await apiSession(playwright, "roaming.user.tl");
  const env = await tl.req.get("/api/v1/environment");
  save("api", "environment.json", JSON.stringify({ status: env.status(), body: await env.json().catch(() => null) }, null, 1));
  for (const rt of ["T14", "T01"])
    for (const lang of ["en", "ar"])
      for (const format of ["csv", "json"]) {
        const res = await tl.req.get(`/api/v1/transformations/${T}/form-records/${rt}/export?format=${format}&lang=${lang}`);
        const body = await res.text();
        save("api", `export-${rt}-${lang}.${format}`, body);
        save(
          "api",
          `export-${rt}-${lang}.${format}.meta.json`,
          JSON.stringify(
            {
              status: res.status(),
              contentType: res.headers()["content-type"],
              disposition: res.headers()["content-disposition"],
              bytes: body.length,
              hasIllustrativeEn: body.includes("Illustrative example"),
              hasIllustrativeAr: body.includes("مثال توضيحي"),
              hasSyntheticWord: /synthetic|اصطناعي/i.test(body),
              hasB0004: body.includes("Practical synthesis inspired by PMI"),
              firstLine: body.split(/\r?\n/)[0]?.slice(0, 300),
            },
            null,
            1,
          ),
        );
        expect(res.status()).toBe(200);
      }
});

test("UI: T14 benefit form framework (History, Attachments) and the T14 / T01 export dialogs at 1280 px and 390 px", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const report: string[] = [];
  await signIn(page, lang, "roaming.user.tl");
  await page.goto(`/transformations/${T}/benefits`);
  await page.waitForLoadState("networkidle");
  const first = page.locator(`a[href*='/transformations/${T}/benefits/']`).first();
  const href = await first.getAttribute("href");
  report.push(`benefit link: ${href}`);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(href!);
    await page.waitForLoadState("networkidle");
    const ff = page.locator("[data-form-framework='T14']");
    for (const key of ["history", "attachments"]) {
      const tabs = ff.getByRole("tab");
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        const id = (await tabs.nth(i).getAttribute("id")) ?? "";
        const ctl = (await tabs.nth(i).getAttribute("aria-controls")) ?? "";
        if (id.includes(key) || ctl.includes(key)) {
          await tabs.nth(i).click();
          break;
        }
      }
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      report.push(`T14 ${key} @${width}: page overflow ${await overflow(page)} px; banner ${await page.getByText(/Illustrative example|مثال توضيحي/).count()}`);
      await shot(page, lang, `r5-t14-${key}-${width}`);
    }
    await page.locator("[data-export='T14']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-export-rows]")).toBeVisible();
    const box = await dialog.boundingBox();
    report.push(
      `T14 export dialog @${width}: rows ${await dialog.locator("[data-export-rows]").getAttribute("data-export-rows")}; page overflow ${await overflow(page)} px; dialog [${Math.round(box!.x)}..${Math.round(box!.x + box!.width)}]; dialog text has label: ${/Illustrative example|مثال توضيحي/.test(await dialog.innerText())}`,
    );
    save("text", `${lang}-r5-t14-export-${width}.txt`, await dialog.innerText());
    await shot(page, lang, `r5-t14-export-${width}`);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/transformations/${T}/diagnose`);
  await page.waitForLoadState("networkidle");
  await page.locator("[data-export='T01']").click();
  const d2 = page.getByRole("dialog");
  await expect(d2.locator("[data-export-rows]")).toBeVisible();
  report.push(`T01 export dialog: rows ${await d2.locator("[data-export-rows]").getAttribute("data-export-rows")}; dialog text has label: ${/Illustrative example|مثال توضيحي/.test(await d2.innerText())}`);
  save("text", `${lang}-r5-t01-export.txt`, await d2.innerText());
  await shot(page, lang, "r5-t01-export-1280");
  save("text", `${lang}-report.txt`, report.join("\n") + "\n");
});
