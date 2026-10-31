// qa-verifier A20 "UX and branding" (DG6, T-DG6-QA-D), chromium-en and chromium-ar on the real stack. Binding rows:
//   REQ-S15-001 "A20: visual review of the Arabic and English executive and home pages at 1440 px shows decisions,
//               outcomes and next actions without scrolling, with light surfaces and blue navigation";
//   REQ-S20-020 "... changing the primary brand token updates screens and output templates".
// 1440 px: the home page (/my-work) of a SYNTHETIC Sponsor with a business approval waiting (a decision) and an owed KPI
// update (an outcome), and the executive page (/executive-overview): the three regions "Key decisions", "Key outcomes"
// and "Next actions" (role=region, catalogue names) lie entirely inside the first 1440 × 900 screen with scrollY = 0;
// the page background is a light surface (relative luminance > 0.85) equal to the surface.page token, and the primary
// navigation paints the nav.background token, whose hue is blue. Screenshots go to QA_EVIDENCE_DIR for the visual review.
// Brand token: an administrator publishes a branding version with another primary colour (a SYNTHETIC in-product
// setting); after a reload the screen's --mth-brand-primary and the navigation background follow it, and the branding
// read for output templates (GET /api/v1/branding, "read at render time" by screens and report/export templates)
// returns it; then the provisional default #0078FF is published again. Nothing here approves anything real; #0078FF
// is a provisional token, not a verified Mobily colour.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { syntheticUser, type SyntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a20-p6");
const WIDE = { width: 1440, height: 900 };
const REGIONS = ["myWork.home.decisions.title", "myWork.home.outcomes.title", "myWork.home.nextActions.title"];
const stamp = Date.now().toString(36);
let sponsor: SyntheticUser;
let approvalTitle = "";

async function shot(page: Page, lang: Lang, name: string) {
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  try {
    const tid = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic QA A20 1440 ${lang.toUpperCase()} ${stamp}`,
        mode: "end_to_end",
      })
    ).id;
    const T = `/api/v1/transformations/${tid}`;
    const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
    sponsor = await syntheticUser(
      admin,
      orgId,
      tid,
      `dev.qa20w.sp.${lang}.${stamp}`,
      `Synthetic QA Sponsor 1440 ${lang}`,
      "SP",
      lang,
    );
    await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sponsor.id });
    const decision = await lead.call<{ id: string; version: number }>("POST", "/api/v1/decisions", {
      transformationId: tid,
      title: `Synthetic QA 1440 scope change ${lang} ${stamp}`,
      ownerUserId: lead.userId,
      tomDimensionCode: "technology",
      options: [{ title: "Build" }, { title: "Buy" }],
    });
    const rights = await lead.call<{ items: { id: string; templateKey: string | null }[] }>(
      "GET",
      `${T}/decision-rights`,
    );
    approvalTitle = `Synthetic QA 1440 approval ${lang} ${stamp}`;
    await lead.call("POST", `${T}/approvals`, {
      approvalType: "decision_request",
      subjectId: decision.id,
      subjectVersion: decision.version,
      decisionRightId: rights.items.find((r) => r.templateKey === "business_scope_change")!.id,
      title: approvalTitle,
    });
  } finally {
    await lead.req.dispose();
    await admin.req.dispose();
  }
});

/** The three regions entirely inside the first screen, with no scrolling. */
async function expectRegionsAboveFold(page: Page, lang: Lang, what: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const key of REGIONS) {
    const region = page.getByRole("region", { name: tr(lang, key), exact: true });
    await expect(region, `${what}: ${key}`).toHaveCount(1);
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    expect(box.y, `${what}: ${key} top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${what}: ${key} bottom inside the first screen`).toBeLessThanOrEqual(WIDE.height);
    expect(box.x + box.width).toBeLessThanOrEqual(WIDE.width);
  }
  expect(await page.evaluate(() => window.scrollY), `${what}: no scrolling`).toBe(0);
}

/** Light page surface and blue navigation, read from the rendered page. */
async function expectSurfaces(page: Page, what: string) {
  const c = await page.evaluate(() => {
    const probe = (v: string) => {
      const el = document.createElement("div");
      el.style.backgroundColor = `var(${v})`;
      document.body.appendChild(el);
      const out = getComputedStyle(el).backgroundColor;
      el.remove();
      return out;
    };
    const nav =
      document.querySelector("nav[aria-label]")?.closest(".app-nav") ??
      document.querySelector(".app-nav") ??
      document.querySelector("nav");
    return {
      body: getComputedStyle(document.body).backgroundColor,
      nav: nav ? getComputedStyle(nav).backgroundColor : "",
      pageToken: probe("--mth-surface-page"),
      navToken: probe("--mth-nav-background"),
    };
  });
  const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
  const lum = ([r, g, b]: [number, number, number]) => {
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  expect(c.body, `${what}: page background = surface.page`).toBe(c.pageToken);
  expect(lum(rgb(c.body)), `${what}: light surface`).toBeGreaterThan(0.85);
  expect(c.nav, `${what}: navigation background = nav.background`).toBe(c.navToken);
  const [r, g, b] = rgb(c.nav);
  expect(b > r && b > g && b >= 150, `${what}: blue navigation (${c.nav})`).toBe(true);
}

test("REQ-S15-001: at 1440 px the home page shows decisions, outcomes and next actions without scrolling", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await page.setViewportSize(WIDE);
  await signIn(page, lang, sponsor.username);
  await page.goto("/my-work");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectRegionsAboveFold(page, lang, "home");
  const decisions = page.getByRole("region", { name: tr(lang, "myWork.home.decisions.title"), exact: true });
  await expect(decisions, "the waiting business approval is listed in Key decisions").toContainText(approvalTitle);
  await expectSurfaces(page, "home");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await shot(page, lang, "a20-1440-home");
  await expectAccessible(page, lang, "a20-1440-home");
});

test("REQ-S15-001: at 1440 px the executive page shows decisions, outcomes and next actions without scrolling", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await page.setViewportSize(WIDE);
  await signIn(page, lang, "dev.lead");
  await page.goto("/executive-overview");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectRegionsAboveFold(page, lang, "executive");
  await expectSurfaces(page, "executive");
  await shot(page, lang, "a20-1440-executive");
  await expectAccessible(page, lang, "a20-1440-executive");
});

test("REQ-S20-020: publishing another primary brand colour re-themes the screen and the branding read by output templates; then the default is restored", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const NEW = "#1F4FA8";
  const admin = await apiSession(playwright, "dev.admin");
  const put = async (primary: string, note: string) => {
    const res = await admin.req.get("/api/v1/admin/branding");
    expect(res.status()).toBe(200);
    const s = (await res.json()) as Record<string, unknown>;
    const etag = res.headers()["etag"]!;
    const csrf = ((await (await admin.req.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
    const body = {
      productNameEn: s["productNameEn"],
      productNameAr: s["productNameAr"],
      primaryColour: primary,
      secondaryColour: s["secondaryColour"],
      colourApprovalReference: null,
      fontLatin: s["fontLatin"],
      fontArabic: s["fontArabic"],
      logo: { mode: "keep" },
      reportHeaderEn: s["reportHeaderEn"] ?? null,
      reportHeaderAr: s["reportHeaderAr"] ?? null,
      reportFooterEn: s["reportFooterEn"] ?? null,
      reportFooterAr: s["reportFooterAr"] ?? null,
      changeNote: note,
    };
    const r = await admin.req.put("/api/v1/admin/branding", {
      headers: { "X-CSRF-Token": csrf, "If-Match": etag },
      data: body,
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  const cssPrimary = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mth-brand-primary").trim().toUpperCase(),
    );
  const navBg = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector(".app-nav") ?? document.querySelector("nav")!).backgroundColor,
    );
  try {
    await signIn(page, lang, "dev.lead");
    await page.goto("/my-work");
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const before = { primary: await cssPrimary(), nav: await navBg() };
    expect(before.primary).toBe("#0078FF");
    await put(NEW, "Synthetic QA A20: brand token propagation check (restored afterwards)");
    await page.reload();
    await expect(page.locator("main#main h1")).toBeVisible();
    await expect.poll(cssPrimary, { message: "the screen follows the published primary colour" }).toBe(NEW);
    const after = await navBg();
    expect(after, "the navigation background is re-derived from the new primary").not.toBe(before.nav);
    await shot(page, lang, "a20-brand-token-changed");
    const branding = (await (await admin.req.get("/api/v1/branding")).json()) as {
      primaryColour?: string;
      colours?: unknown;
    };
    expect(JSON.stringify(branding).toUpperCase(), "the branding read at render time by output templates").toContain(
      NEW,
    );
  } finally {
    await put("#0078FF", "Synthetic QA A20: restore the provisional default primary colour");
    await page.reload();
    await expect.poll(cssPrimary).toBe("#0078FF");
    await admin.req.dispose();
  }
});
