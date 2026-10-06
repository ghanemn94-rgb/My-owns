import { chromium } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL, OUT = process.env.OUT;
const b = await chromium.launch();
for (const lang of ["en", "ar"]) {
  const ctx = await b.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh", viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/login");
  const f = p.locator("input").first(); await f.fill("dev.lead"); await f.press("Enter");
  await p.waitForURL("**/my-work");
  const cur = await p.locator("html").getAttribute("lang");
  if (cur !== lang) { await p.getByRole("button", { name: lang === "ar" ? "Switch language to العربية" : /English/ }).click(); }
  await p.waitForTimeout(500);
  await p.goto(BASE + "/transformations/new"); await p.waitForTimeout(800);
  console.log(lang, "html lang/dir:", await p.locator("html").getAttribute("lang"), await p.locator("html").getAttribute("dir"));
  await p.screenshot({ path: `${OUT}/${lang}-create-mode-guidance.png`, fullPage: true });
  const txt = await p.locator("main").innerText();
  console.log(lang, "contains B0009 E2E how:", txt.includes("Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear."));
  console.log(lang, "contains B0009 Modular how:", txt.includes("Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits."));
  await ctx.close();
}
await b.close();
