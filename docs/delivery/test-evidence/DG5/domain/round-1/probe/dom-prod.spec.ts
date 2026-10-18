// domain-reviewer DG5 round-1 probe on the PRODUCTION-initialized stack (apps/web/e2e/support/with-stack.sh).
// Dumps API responses for an offline source comparison and captures EN/AR screenshots. Synthetic data only;
// nothing here approves anything real, and nothing relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const dump = (name: string, data: unknown) => {
  mkdirSync(join(OUT, "api"), { recursive: true });
  writeFileSync(join(OUT, "api", `${name}.json`), JSON.stringify(data, null, 1));
};
const shot = async (page: import("@playwright/test").Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: true });
};
const B0004 =
  "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.";

test("API dumps for the source comparison (en project only)", async ({ playwright }, info) => {
  test.skip(langOf(info) !== "en");
  const office = await apiSession(playwright, "dev.office");
  const blocks: unknown[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: unknown[]; nextCursor: string | null } = await office.call(
      "GET",
      `/api/v1/methodology/blocks?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    blocks.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  dump("blocks", blocks);
  for (const [name, path] of [
    ["provenance", "/api/v1/methodology/provenance"],
    ["guiding-questions", "/api/v1/methodology/guiding-questions"],
    ["elements", "/api/v1/methodology/elements"],
    ["health-questions", "/api/v1/health-check-questions"],
    ["launch-template", "/api/v1/launch-plan-template"],
    ["branding", "/api/v1/branding"],
    ["search-value-pools", "/api/v1/methodology/search?q=value%20pools&lang=en"],
    ["b0031-links", "/api/v1/methodology/blocks/B0031/links"],
    ["t01-source-links", "/api/v1/methodology/templates/T01/source-links"],
  ] as const) {
    const res = await office.req.get(path);
    dump(name, { status: res.status(), body: await res.json().catch(() => null) });
  }
  const tech = await apiSession(playwright, "dev.admin");
  const schemes = await tech.req.get("/api/v1/admin/health-check-schemes");
  dump("health-schemes-admin", { status: schemes.status(), body: await schemes.json().catch(() => null) });
  const schemesTo = await office.req.get("/api/v1/admin/health-check-schemes");
  dump("health-schemes-office", { status: schemesTo.status(), body: await schemesTo.json().catch(() => null) });
  for (const u of ["dev.admin", "dev.office", "dev.lead", "dev.auditor", "dev.nobody"]) {
    const s = await apiSession(playwright, u);
    const nav = await s.req.get("/api/v1/me/navigation");
    dump(`navigation-${u}`, { status: nav.status(), body: await nav.json().catch(() => null) });
  }
  // Demo seeding/environment refusals on a production database.
  const env = await tech.req.get("/api/v1/admin/environment");
  dump("environment-admin", { status: env.status(), body: await env.json().catch(() => null) });
  const walk = await office.req.get("/api/v1/demo/walkthrough");
  dump("walkthrough-office", { status: walk.status(), body: await walk.json().catch(() => null) });
});

test("UI: reader, About, Realize note, guiding questions, launch plan, health check, Studio, branding, navigation", async ({
  page,
  browser,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  await page.goto("/playbook/reader");
  await expect(page.locator("[data-source-text='statement'] [data-verbatim='en']")).toHaveText(B0004);
  await expect(page.locator("[data-list='guiding-questions'] > li")).toHaveCount(4);
  await page.waitForTimeout(500);
  await shot(page, lang, "01-reader");
  writeFileSync(join(OUT, `reader-text-${lang}.txt`), await page.locator("main#main").innerText());
  await page.goto("/playbook/reader/B0124");
  await page.waitForLoadState("networkidle");
  await shot(page, lang, "02-reader-B0124-realize");
  writeFileSync(join(OUT, `reader-B0124-${lang}.txt`), await page.locator("main#main").innerText());
  await page.goto("/playbook/reader/B0031");
  await page.waitForLoadState("networkidle");
  await shot(page, lang, "03-reader-B0031");
  await page.goto("/about");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main#main")).toContainText(B0004);
  await shot(page, lang, "04-about");
  writeFileSync(join(OUT, `about-${lang}.txt`), await page.locator("main#main").innerText());
  await page.goto("/playbook/launch-plan");
  await page.waitForLoadState("networkidle");
  await shot(page, lang, "05-playbook-launch-plan");
  writeFileSync(join(OUT, `launch-plan-${lang}.txt`), await page.locator("main#main").innerText());
  await page.goto("/playbook/health-check");
  await page.waitForLoadState("networkidle");
  await shot(page, lang, "06-playbook-health-check");
  writeFileSync(join(OUT, `health-check-${lang}.txt`), await page.locator("main#main").innerText());
  await page.goto("/admin/studio");
  await page.waitForLoadState("networkidle");
  await shot(page, lang, "07-studio-office");
  writeFileSync(join(OUT, `studio-${lang}.txt`), await page.locator("main#main").innerText());
  const nav = page.getByRole("navigation").first();
  writeFileSync(
    join(OUT, `nav-office-${lang}.json`),
    JSON.stringify(await page.locator("a[data-area]").evaluateAll((l) => l.map((a) => a.getAttribute("data-area")))),
  );
  void nav;
  // Technical administrator (ADM_ACCESS + ADM_TECH): navigation and branding.
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const p2 = await ctx.newPage();
  await signIn(p2, lang, "dev.admin");
  await p2.goto("/admin/branding");
  await p2.waitForLoadState("networkidle");
  await shot(p2, lang, "08-branding-admin");
  writeFileSync(join(OUT, `branding-${lang}.txt`), await p2.locator("main#main").innerText());
  writeFileSync(
    join(OUT, `nav-admin-${lang}.json`),
    JSON.stringify(await p2.locator("a[data-area]").evaluateAll((l) => l.map((a) => a.getAttribute("data-area")))),
  );
  await shot(p2, lang, "09-admin-shell-nav");
  const bg = await p2
    .locator("nav a[data-area]")
    .first()
    .evaluate((a) => getComputedStyle(a.closest("nav") as Element).backgroundColor);
  writeFileSync(join(OUT, `nav-bg-${lang}.txt`), bg);
  const wm = await p2.getByTestId("wordmark").innerText();
  writeFileSync(join(OUT, `wordmark-${lang}.txt`), wm);
  await ctx.close();
  // Lead and auditor navigation.
  for (const u of ["dev.lead", "dev.auditor"]) {
    const c = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    const p = await c.newPage();
    await signIn(p, lang, u);
    writeFileSync(
      join(OUT, `nav-${u}-${lang}.json`),
      JSON.stringify(await p.locator("a[data-area]").evaluateAll((l) => l.map((a) => a.getAttribute("data-area")))),
    );
    await shot(p, lang, `10-nav-${u}`);
    await c.close();
  }
});
