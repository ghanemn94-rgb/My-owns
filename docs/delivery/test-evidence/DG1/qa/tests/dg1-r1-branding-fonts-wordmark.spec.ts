// qa-verifier DG1 round-1 independent verification (T-DG1-REV-QA-R1). Stored as review evidence so it does not alter
// the frozen candidate; the orchestrator may promote it into e2e/ in a later stage.
// Run (disposable clone, copied into e2e/): e2e/support/qa-stack.sh npx playwright test e2e/qa-dg1-r1 --workers=1
//
//  REQ-S15-002  GET /api/v1/branding/tokens -> exactly the seven seeded tokens with the §15 values, provenance=provisional;
//               unauthenticated -> 401.
//  REQ-S15-005  Signing in and rendering the shell in AR and EN makes NO request to any non-local host (fonts, CDNs) and
//               the bundled IBM Plex faces are loaded from the app origin.
//  REQ-S15-006  The header shows a text wordmark with a provisional marker; no <img>/<svg> logo inside the wordmark.
//  Honesty     No rendered text claims official Mobily brand compliance, PMI certification or "official standard".
// All users/data are SYNTHETIC (seed-dev).
/// <reference lib="dom" />
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-dg1-r1");

const EXPECTED: Record<string, string> = {
  "brand.primary": "#0078FF",
  "brand.deep": "#003B73",
  "surface.page": "#F5F8FC",
  "surface.card": "#FFFFFF",
  "text.primary": "#142438",
  "text.secondary": "#526174",
  "border.default": "#DCE5EF",
};

// Positive claims only: the product's own disclaimers negate them ("not an official PMI standard",
// "غير معتمد من PMI" = "not certified by PMI"), so a negation right before the phrase is allowed (iteration 1 of
// this spec flagged the Arabic disclaimer itself: log 11-qa-branding-fonts-wordmark.iter1-testbug.log).
const FORBIDDEN_CLAIMS = [
  /(?<!(?:not|no|non|never)\s(?:an?\s)?)official\s+mobily\s+(brand|logo|colou?r)s?(?!\s+(?:was|were|is|are)\s+not)/i,
  /(?<!(?:not|no|non|never)\s(?:an?\s)?)pmi[-\s]?(certified|approved|compliant)/i,
  /(?<!(?:not|no|never)\s(?:been\s)?)certified\s+by\s+pmi/i,
  /(?<!(?:not|no|non|never)\s(?:an?\s)?)official\s+pmi/i,
  /(?<!غير\s)معتمد\s+من\s+PMI/i,
];

test.describe("REQ-S15-002 branding tokens API", () => {
  test("unauthenticated -> 401", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL: baseURL! });
    const r = await ctx.get("/api/v1/branding/tokens");
    expect(r.status()).toBe(401);
    await ctx.dispose();
  });

  test("signed-in user gets the seven seeded tokens, provenance=provisional", async ({ playwright, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    // dev.nobody: a signed-in user with no roles (the endpoint is authenticated-only by design).
    for (const username of ["dev.admin", "dev.nobody"]) {
      const ctx = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { origin } });
      expect((await ctx.post("/api/v1/auth/dev-login", { data: { username } })).status()).toBe(204);
      const r = await ctx.get("/api/v1/branding/tokens");
      expect(r.status(), `${username}: ${await r.text()}`).toBe(200);
      const body = (await r.json()) as {
        provenance: string;
        tokens: { name: string; value: string; provisional: boolean; purpose: string }[];
      };
      expect(body.provenance).toBe("provisional");
      const got = Object.fromEntries(body.tokens.map((t) => [t.name, t.value.toUpperCase()]));
      expect(got).toEqual(EXPECTED);
      for (const t of body.tokens) expect(t.provisional, t.name).toBe(true);
      await ctx.dispose();
    }
  });
});

async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.evaluate(async (u) => {
    const r = await fetch("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u }),
    });
    if (r.status !== 204) throw new Error(`dev-login ${r.status}`);
  }, username);
  await page.goto("/");
  await expect(page.getByRole("navigation").first()).toBeVisible();
}

test.describe("REQ-S15-005/006 + honesty in the rendered shell", () => {
  test("no external requests; bundled Plex fonts; provisional text wordmark; no official claims (AR and EN)", async ({
    page,
    baseURL,
  }, info) => {
    const appHost = new URL(baseURL!).host;
    const external: string[] = [];
    const fontUrls: string[] = [];
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (u.protocol.startsWith("http") && u.host !== appHost) external.push(req.url());
      if (req.resourceType() === "font") fontUrls.push(req.url());
    });

    await signIn(page, "dev.office");
    const texts: string[] = [];
    for (const lang of ["ar", "en"] as const) {
      const cur = await page.evaluate(() => document.documentElement.lang);
      if (cur !== lang) {
        await page.getByRole("button", { name: lang === "en" ? "English" : "العربية" }).click();
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang);
      }
      await page.evaluate(() => document.fonts.ready);
      const families = await page.evaluate(() =>
        [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
      );
      expect(families.some((f) => /IBM Plex Sans/i.test(f)), `loaded faces: ${families.join(",")}`).toBe(true);
      if (lang === "ar")
        expect(families.some((f) => /IBM Plex Sans Arabic/i.test(f)), `AR faces: ${families.join(",")}`).toBe(true);

      // Wordmark: a text element in the banner with a provisional marker, no image logo.
      const banner = page.getByRole("banner");
      const marker = lang === "ar" ? "مؤقت" : "Provisional";
      await expect(banner.getByText(marker, { exact: true }).first()).toBeVisible();
      const imgCount = await banner.locator("img, svg image, image").count();
      expect(imgCount, "no image logo in the header").toBe(0);

      texts.push(await page.evaluate(() => document.body.innerText));
      mkdirSync(path.join(EVIDENCE_DIR, lang), { recursive: true });
      await page.screenshot({ path: path.join(EVIDENCE_DIR, lang, `${info.project.name}--shell.png`), fullPage: true });
      // "About this product" page carries the methodology disclaimer: scan it too.
      const about = page.getByRole("link", { name: lang === "ar" ? "حول هذا المنتج" : "About this product" });
      if (await about.count()) {
        await about.first().click();
        await page.waitForLoadState("networkidle");
        texts.push(await page.evaluate(() => document.body.innerText));
        await page.screenshot({
          path: path.join(EVIDENCE_DIR, lang, `${info.project.name}--about.png`),
          fullPage: true,
        });
        await page.goto("/");
      }
    }
    for (const t of texts) for (const re of FORBIDDEN_CLAIMS) expect(t, `forbidden claim ${re}`).not.toMatch(re);
    expect(external, "requests to non-local hosts").toEqual([]);
    for (const f of fontUrls) expect(new URL(f).host).toBe(appHost);
    expect(fontUrls.length, "at least one bundled font file fetched from the app origin").toBeGreaterThan(0);
  });
});
