// T-DG6-FE-F2 regression (REQ-S15-001; ADR-0061 §4.1; p6-work-split §I/K.4) on the REAL stack (support/with-stack.sh;
// no mocks): at 1440 × 900, the home page (/my-work) and the executive page (/executive-overview) show the three regions
// "Key decisions", "Key outcomes" and "Next actions" — each role="region" with its catalogue name — above the fold with
// window.scrollY = 0, on light surfaces (surface.page) and blue navigation (nav.background), in chromium-en and
// chromium-ar. The acceptance proof is QA-D's (A20); this spec guards the layout FE-F2 delivered.
// Data (SYNTHETIC, through the real API): a transformation with a decision routed for business approval to a synthetic
// Sponsor (the Sponsor's open decision on the home page), an open executive decision required in 4 days (the executive
// page's open decision and next action), an action item due in 2 days owned by the Sponsor (the home page's next action),
// and a top outcome with an active KPI (the outcome). The approval is a demo business approval that
// approves nothing real; no product gate (G1-G6) implies any engineering gate (DG0-DG7).
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): each test sets 60 s. Measured loaded worst case: see
// docs/delivery/handbacks/DG6/T-DG6-FE-F2-evidence/e2e-p6-fe-f2-and-neighbours.log (the slowest test of this file took
// 8.9 s while the full `pnpm test` ran in parallel on the same machine); 60 s is more than 6x that.
import { expect, test, type Page } from "@playwright/test";
import { defineRecords, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, type Lang } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const VIEWPORT = { width: 1440, height: 900 };
const REGIONS = [
  { kind: "decisions", key: "myWork.home.decisions.title" },
  { kind: "outcomes", key: "myWork.home.outcomes.title" },
  { kind: "next-actions", key: "myWork.home.nextActions.title" },
] as const;
const stamp = Date.now().toString(36);
let sponsor: SyntheticUser;
let decisionTitle = "";
let actionTitle = "";
let execTitle = "";
let transformationId = "";

const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P6 home 1440 ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  const tid = created.id;
  transformationId = tid;
  const T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  sponsor = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.p6home.sp.${lang}.${stamp}`,
    `Synthetic Sponsor ${lang}`,
    "SP",
    lang,
  );
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sponsor.id });
  // One outcome with an active KPI (the Outcomes area counts it).
  await defineRecords(T, lead);
  // One open decision, due in 3 days, sent for business approval to the mapped Sponsor.
  decisionTitle = `Synthetic home decision ${lang} ${stamp}`;
  const decision = await lead.call<{ id: string; version: number }>("POST", "/api/v1/decisions", {
    transformationId: tid,
    title: decisionTitle,
    ownerUserId: lead.userId,
    dueDate: isoDay(3),
    tomDimensionCode: "technology",
    options: [{ title: "Build" }, { title: "Buy" }],
  });
  const rights = await lead.call<{ items: { id: string; templateKey: string | null }[] }>(
    "GET",
    `${T}/decision-rights`,
  );
  await lead.call("POST", `${T}/approvals`, {
    approvalType: "decision_request",
    subjectId: decision.id,
    subjectVersion: decision.version,
    decisionRightId: rights.items.find((r) => r.templateKey === "business_scope_change")!.id,
    title: `Synthetic home approval ${lang} ${stamp}`,
  });
  // One open executive decision (T16; the Decisions area of the executive page), required in 4 days.
  execTitle = `Synthetic executive ask ${lang} ${stamp}`;
  await lead.call("POST", `${T}/executive-decisions`, {
    title: execTitle,
    whyNow: "Synthetic: the pilot starts next month",
    options: [{ title: "Synthetic option one" }, { title: "Synthetic option two" }],
    recommendation: "A",
    impactOfDelay: "Synthetic: the pilot slips by a month",
    ownerUserId: sponsor.id,
    requiredDate: isoDay(4),
  });
  // One next action: an action item owned by the Sponsor, due in 2 days.
  actionTitle = `Synthetic home action ${lang} ${stamp}`;
  await lead.call("POST", `${T}/actions`, { title: actionTitle, ownerUserId: sponsor.id, dueDate: isoDay(2) });
  await lead.req.dispose();
  await admin.req.dispose();
});

/** The three regions: found by role and catalogue name, top edge above the fold, a height, and no scroll. */
async function expectRegionsAboveTheFold(page: Page, lang: Lang) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  for (const r of REGIONS) {
    const region = page.getByRole("region", { name: tr(lang, r.key), exact: true });
    await expect(region, r.kind).toHaveCount(1);
    await expect(region).toHaveAttribute("data-glance-region", r.kind);
    await expect(region.locator("[data-state='loading']")).toHaveCount(0);
    const box = await region.boundingBox();
    expect(box, r.kind).not.toBeNull();
    expect(box!.y, `${r.kind} top`).toBeLessThan(VIEWPORT.height);
    expect(box!.height, `${r.kind} height`).toBeGreaterThan(0);
    // The whole region fits in the first screen at this width (not only its top edge).
    expect(box!.y + box!.height, `${r.kind} bottom`).toBeLessThanOrEqual(VIEWPORT.height);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

/** Light surfaces and blue navigation: computed backgrounds equal the tokens' CSS variables. */
async function expectTokens(page: Page) {
  const colours = await page.evaluate(() => {
    const probe = (v: string) => {
      const el = document.createElement("div");
      el.style.background = `var(${v})`;
      document.body.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    };
    return {
      body: getComputedStyle(document.body).backgroundColor,
      nav: getComputedStyle(document.querySelector(".app-nav")!).backgroundColor,
      page: probe("--mth-surface-page"),
      navToken: probe("--mth-nav-background"),
    };
  });
  expect(colours.body).toBe(colours.page);
  expect(colours.nav).toBe(colours.navToken);
}

test("1440 px: the home page shows key decisions, key outcomes and next actions above the fold", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await page.setViewportSize(VIEWPORT);
  await signIn(page, lang, sponsor.username);
  await page.goto("/my-work");
  await expect(page.locator("main#main h1")).toBeVisible();
  const decisions = page.locator("[data-glance-region='decisions']");
  // The business approval request and the executive decision owned by the Sponsor: both wait for the Sponsor.
  await expect(decisions.locator("[data-glance-count='approvals']")).toHaveAttribute("data-total", "2");
  await expect(decisions.locator("[data-glance-list='decisions'] li")).toHaveCount(2);
  const next = page.locator("[data-glance-region='next-actions']");
  await expect(next.locator("[data-glance-list='next-actions']")).toContainText(actionTitle);
  // The Sponsor owes no KPI update and has no review: the designed empty state, never a blank region.
  await expect(page.locator("[data-glance-region='outcomes'] [data-state='glance-empty']")).toHaveText(
    tr(lang, "myWork.home.outcomes.empty"),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectRegionsAboveTheFold(page, lang);
  await expectTokens(page);
  await shot(page, lang, "p6-1440-home-full");
  await page.screenshot({ path: `${shotPath(lang)}p6-1440-home.png` });
  await expectAccessible(page, lang, "p6-1440-home");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
});

test("1440 px: the executive page shows key decisions, key outcomes and next actions above the fold", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await page.setViewportSize(VIEWPORT);
  await signIn(page, lang, "dev.lead");
  // The page's own transformation filter (`tr`, the FilterBar's URL state) narrows it to this spec's transformation.
  // Next actions are the first three dated decisions and blockers of what the page shows, earliest first (ADR-0061
  // §4.1, ExecutiveRegions.tsx); unfiltered, the dev.lead's whole Synthetic Retail portfolio competes, and overdue
  // dependencies that earlier specs of the same stack leave behind (for example p5-dependency-slip-impact, one per language) push
  // this spec's decision out of the three in the second project. The regions, their place above the fold and every
  // assertion below are unchanged.
  await page.goto(`/executive-overview?tr=${transformationId}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const decisions = page.locator("[data-glance-region='decisions']");
  await expect(decisions.locator("[data-glance-area='decisions'] .status-chip .icon")).toHaveCount(1);
  await expect(decisions.locator("[data-glance-metric='decisions.open']")).toBeVisible();
  const outcomes = page.locator("[data-glance-region='outcomes']");
  await expect(outcomes.locator("[data-glance-area='outcomes']")).toBeVisible();
  // An outcome KPI without any actual is Unknown, never green (the server's status, shown with its icon and label).
  await expect(outcomes.locator("[data-glance-area='outcomes']")).not.toHaveAttribute("data-glance-rag", "green");
  await expect(page.locator("[data-glance-region='next-actions'] [data-glance-list='next-actions']")).toContainText(
    execTitle,
  );
  await expectRegionsAboveTheFold(page, lang);
  await expectTokens(page);
  await shot(page, lang, "p6-1440-executive-full");
  await page.screenshot({ path: `${shotPath(lang)}p6-1440-executive.png` });
  await expectAccessible(page, lang, "p6-1440-executive");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
});

/** The viewport (not full-page) screenshot path: the fold itself is the evidence. */
function shotPath(lang: Lang): string {
  const dir = process.env["E2E_SCREENSHOT_DIR"] ?? new URL("./screenshots/", import.meta.url).pathname;
  return `${dir.replace(/\/?$/, "/")}${lang}/`;
}
