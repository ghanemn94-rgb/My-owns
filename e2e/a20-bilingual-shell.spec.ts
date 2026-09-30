// A20 (REQ-S20-020 first cases; REQ-S15-002, REQ-S15-007): bilingual shell and design-token propagation.
//
// Acceptance criteria asserted here (black-box, against the running API + built SPA):
//   1. With no stored preference the shell renders Arabic RTL by default: <html lang="ar" dir="rtl"> before and after
//      sign-in, in BOTH browser locales (chromium-en and chromium-ar projects) - the default does not follow the browser.
//   2. The language switch turns it into English LTR (<html lang="en" dir="ltr">), the layout mirrors (primary
//      navigation on the right in RTL, on the left in LTR), the choice survives a reload, and switching back restores
//      Arabic RTL.
//   3. The rendered CSS equals the single token source: every seeded `--mth-*` colour on :root equals
//      packages/design-tokens/src/tokens.json of the tree that was BUILT (QA_TOKENS_JSON, default the cwd's copy), and
//      the navigation and header paint with the tokens they reference. Running this same spec against a build with a
//      changed token (e2e/support/a20-token-propagation.sh) proves that a token change propagates to the rendered CSS.
//   4. EN and AR full-page screenshots are written to QA_EVIDENCE_DIR (default test-results/qa-a20).
// Every user and record is synthetic. The user is created fresh per run, so the Arabic default is not affected by
// preferences other suites stored.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a20");
const TOKENS_JSON = process.env["QA_TOKENS_JSON"] ?? path.join("packages", "design-tokens", "src", "tokens.json");
const DEV_ISSUER = "urn:mth:dev-local";

// ------------------------------------------------------------------------------------------------ token source
interface TokenFile {
  color: Record<string, { value: string }>;
  derived?: Record<string, { value?: string }>;
  semantic?: Record<string, { value?: string; ref?: string }>;
}
const tokenFile = JSON.parse(readFileSync(TOKENS_JSON, "utf8")) as TokenFile;

/** Resolve a token name to its hex value following `ref` chains (independent re-implementation for the test). */
function tokenHex(name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`token ref cycle: ${[...seen, name].join(" -> ")}`);
  const spec: { value?: string; ref?: string } | undefined =
    tokenFile.color[name] ?? tokenFile.derived?.[name] ?? tokenFile.semantic?.[name];
  if (!spec) throw new Error(`unknown token ${name}`);
  if (spec.ref) return tokenHex(spec.ref, [...seen, name]);
  if (!spec.value) throw new Error(`token ${name} has no value`);
  return spec.value.toUpperCase();
}
const cssVar = (name: string) => `--mth-${name.replace(/\./g, "-")}`;
const hexToRgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

// ------------------------------------------------------------------------------------------------ helpers
async function htmlLangDir(page: Page) {
  return page.evaluate(() => ({
    lang: document.documentElement.getAttribute("lang"),
    dir: document.documentElement.getAttribute("dir"),
    computed: getComputedStyle(document.body).direction,
  }));
}

async function shot(page: Page, lang: "ar" | "en", name: string, project: string) {
  const dir = path.join(EVIDENCE_DIR, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${project}--${name}.png`), fullPage: true });
}

/** Primary navigation and main landmark positions (x of their centres). */
async function layout(page: Page) {
  const nav = await page.getByRole("navigation").first().boundingBox();
  const main = await page.getByRole("main").boundingBox();
  if (!nav || !main) throw new Error("navigation or main landmark not rendered");
  return { navX: nav.x + nav.width / 2, mainX: main.x + main.width / 2 };
}

let subject = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  // A fresh synthetic user (no stored preference) created through the contract by the synthetic dev access admin.
  const origin = new URL(baseURL!).origin;
  const ctx = await playwright.request.newContext({ baseURL: baseURL!, extraHTTPHeaders: { origin } });
  try {
    const login = await ctx.post("/api/v1/auth/dev-login", { data: { username: "dev.admin" } });
    expect(login.status(), "dev login as the synthetic admin (is the stack seeded with seed-dev?)").toBe(204);
    const me = await (await ctx.get("/api/v1/me")).json();
    subject = `qa.a20.${randomBytes(4).toString("hex")}`;
    const created = await ctx.post("/api/v1/users", {
      headers: { "x-csrf-token": me.csrfToken },
      data: {
        organizationId: me.organization.id,
        displayName: `QA A20 synthetic ${subject}`,
        email: `${subject}@example.invalid`,
        identity: { issuer: DEV_ISSUER, subject },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
  } finally {
    await ctx.dispose();
  }
});

test.describe("A20 bilingual shell", () => {
  test("Arabic RTL by default; English LTR after the switch; persisted; switch back", async ({ page }, info) => {
    const project = info.project.name;
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    // 1. Signed out, no stored hint: Arabic RTL regardless of the browser locale.
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect((await htmlLangDir(page)).computed).toBe("rtl");
    await shot(page, "ar", "01-sign-in", project);

    // Sign in through the development form (present only in AUTH_MODE=dev).
    const form = page.locator("form.dev-login");
    await expect(form).toBeVisible();
    await form.locator("input").fill(subject);
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();

    // 2. Shell in Arabic RTL, navigation on the inline-start (right) side.
    expect(await htmlLangDir(page)).toEqual({ lang: "ar", dir: "rtl", computed: "rtl" });
    const ar = await layout(page);
    expect(ar.navX, "RTL: navigation should be right of main").toBeGreaterThan(ar.mainX);
    await expect(page.locator("header")).toContainText("مؤقت"); // provisional badge in Arabic
    await shot(page, "ar", "02-shell", project);

    // 3. Switch to English: LTR, mirrored layout, English strings.
    const persisted = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/me/preferences") && r.request().method() === "PUT",
    );
    await page.locator(".language-switch button").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    expect((await persisted).status(), "language preference persisted").toBe(200);
    expect((await htmlLangDir(page)).computed).toBe("ltr");
    const en = await layout(page);
    expect(en.navX, "LTR: navigation should be left of main").toBeLessThan(en.mainX);
    await expect(page.locator("header")).toContainText(/Provisional/i);
    await shot(page, "en", "02-shell", project);

    // 4. The choice survives a reload.
    await page.reload();
    await expect(page.getByRole("navigation").first()).toBeVisible();
    expect(await htmlLangDir(page)).toEqual({ lang: "en", dir: "ltr", computed: "ltr" });

    // 5. Switch back to Arabic.
    await page.locator(".language-switch button").first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await shot(page, "ar", "03-shell-after-switch-back", project);

    expect(consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
  });
});

test.describe("A20 design tokens reach the rendered CSS", () => {
  test("seeded --mth-* colours and referencing surfaces equal the built token source", async ({ page }, info) => {
    await page.goto("/login");
    const seeds = Object.keys(tokenFile.color);
    expect(seeds.length, "the seven §15 seed tokens").toBe(7);
    // Set by e2e/support/a20-token-propagation.sh when the tree was rebuilt with a changed token.
    const changed = process.env["QA_EXPECT_BRAND_DEEP"];
    if (changed) expect(tokenHex("brand.deep"), "the token source under test carries the changed value").toBe(changed);
    const rendered = await page.evaluate(
      (names) =>
        Object.fromEntries(
          names.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase()]),
        ),
      seeds.map(cssVar),
    );
    for (const name of seeds) {
      expect(rendered[cssVar(name)], `${cssVar(name)} on :root`).toBe(tokenHex(name));
    }

    // Surfaces that reference tokens (semantic refs) paint with the source values: sign in and inspect the shell.
    const form = page.locator("form.dev-login");
    await form.locator("input").fill(subject);
    await form.locator('button[type="submit"]').click();
    const nav = page.getByRole("navigation").first();
    await expect(nav).toBeVisible();
    const navBg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(navBg, "nav.background -> rendered navigation background").toBe(hexToRgb(tokenHex("nav.background")));
    const headerBg = await page
      .locator("header")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(headerBg, "header.gradient-start -> rendered header gradient").toContain(
      hexToRgb(tokenHex("header.gradient-start")),
    );
    const lang = (await htmlLangDir(page)).lang === "en" ? "en" : "ar";
    await shot(page, lang, `04-tokens-${tokenHex("brand.deep").slice(1)}`, info.project.name);
  });
});
