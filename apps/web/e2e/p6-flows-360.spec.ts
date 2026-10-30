// T-DG6-FE-F2 regression (REQ-S15-009; ADR-0061 §4.2; p6-work-split §I/K.4) on the REAL stack (support/with-stack.sh;
// no mocks): the review, approval and KPI-update flows at 360 × 800, in chromium-en and chromium-ar:
//  1. the configured gate approver (a SYNTHETIC Sponsor) opens the submitted product gate G1 and records "approved" with
//     its rationale and the three leadership confirmations (a business approval inside the product; never DG0-DG7);
//  2. the mapped Sponsor approves a P4 business approval request at /my-work/approvals/:approvalId;
//  3. the KPI owner submits a KPI actual at /transformations/:id/kpis/:kpiId/actuals;
//  4. the mapped Business Owner accepts it from the KPI review queue.
// Each step: no page-level horizontal scroll (documentElement.scrollWidth <= 360), every primary action button fully
// inside the viewport width, and the result read back through the API. A last test opens the same screens at 768 × 1024
// (the procedure's "768 px"). The acceptance proof is QA-D's (A20); this spec guards the fixes FE-F2 delivered. Every
// record is SYNTHETIC; every approval is a demo business approval that approves nothing real.
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): each test sets 60 s. Measured loaded worst case: see
// docs/delivery/handbacks/DG6/T-DG6-FE-F2-evidence/e2e-p6-fe-f2-and-neighbours.log (the slowest test of this file took
// 8.4 s while the full `pnpm test` ran in parallel on the same machine); 60 s is more than 7x that.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { g1Records, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  confirmG1Agreements,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  type ApiSession,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const PHONE = { width: 360, height: 800 };
const TABLET = { width: 768, height: 1024 };
const stamp = Date.now().toString(36);
let tid = "";
let T = "";
let kpiId = "";
let periodId = "";
let approvalId = "";
let sponsor: SyntheticUser;
let owner: SyntheticUser;
let reviewer: SyntheticUser;
let lead: ApiSession;

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P6 360 flows ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p6m.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  sponsor = await mk("sp", "SP", "Synthetic Sponsor");
  owner = await mk("kds", "KDS", "Synthetic KPI owner");
  reviewer = await mk("bo", "BO", "Synthetic Business Owner");
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sponsor.id });
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "BO", targetKind: "user", userId: reviewer.id });

  // 1. G1's records (the charter names the Sponsor as the gate approver), submitted by the Lead.
  await g1Records(T, lead, office, sponsor.id);
  const gate = await lead.call<{ gate: { version: number } }>("GET", `${T}/gates/G1`);
  await lead.call(
    "POST",
    `${T}/gates/G1/submissions`,
    { submissionNote: `Synthetic G1 submission ${lang}` },
    { ifMatch: gate.gate.version },
  );

  // 2. A business approval request routed by the T11 "Business scope change" row to the mapped Sponsor.
  const decision = await lead.call<{ id: string; version: number }>("POST", "/api/v1/decisions", {
    transformationId: tid,
    title: `Synthetic 360 scope change ${lang} ${stamp}`,
    ownerUserId: lead.userId,
    tomDimensionCode: "technology",
    options: [{ title: "Build" }, { title: "Buy" }],
  });
  const rights = await lead.call<{ items: { id: string; templateKey: string | null }[] }>(
    "GET",
    `${T}/decision-rights`,
  );
  approvalId = (
    await lead.call<{ id: string }>("POST", `${T}/approvals`, {
      approvalType: "decision_request",
      subjectId: decision.id,
      subjectVersion: decision.version,
      decisionRightId: rights.items.find((r) => r.templateKey === "business_scope_change")!.id,
      title: `Synthetic 360 approval ${lang} ${stamp}`,
    })
  ).id;

  // 3-4. A KPI owned by the KPI owner, its active version reviewed by the mapped Business Owner, one open period.
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: `Synthetic 360 adoption ${lang} ${stamp}`,
    unitKind: "percentage",
    polarity: "higher_is_better",
    frequency: "monthly",
    ownerUserId: owner.id,
  });
  await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
  kpiId = kpi.id;
  const version = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions/${kpiId}/versions`, {
    measureType: "higher_is_better",
    valueNature: "stock",
    aggregationRule: "last_value",
    targetValue: "0.25",
    targetDate: "2032-12-31",
    reviewerPartyCode: "BO",
  });
  await lead.call("POST", `${T}/kpi-versions/${version.id}/activate`, undefined, { ifMatch: version.version });
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  // A free month of the organization (periods never overlap; other specs take other years).
  for (let i = 0; i < 60 && !periodId; i++) {
    const n = (lang === "en" ? 0 : 30) + i;
    const y = 2041 + Math.floor(n / 12);
    const m = (n % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    try {
      const p = await office.call<{ id: string; version: number }>(
        "POST",
        P,
        {
          frequency: "monthly",
          periodLabel: `${y}-${mm}`,
          periodStart: `${y}-${mm}-01`,
          periodEnd: `${y}-${mm}-${last}`,
        },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      periodId = p.id;
    } catch {
      // that month exists already: try the next one
    }
  }
  expect(periodId, "an open monthly period").not.toBe("");
  await admin.req.dispose();
  await office.req.dispose();
});

test.afterAll(async () => {
  await lead.req.dispose();
});

/** No page-level horizontal scroll, and each primary action fully inside the viewport width. */
async function expectFits(page: Page, width: number, actions: Locator[], what: string) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${what}: page scroll width`).toBeLessThanOrEqual(width);
  for (const [n, a] of actions.entries()) {
    await expect(a, `${what}: action ${n}`).toBeVisible();
    // Scroll the page VERTICALLY only (never a table or region sideways: that would hide the defect this checks), then
    // the button must lie inside the viewport width and be the element hit at its centre (not clipped by a scroller).
    const hit = await a.evaluate((el) => {
      // Vertical scrolling is allowed (page, dialog); any sideways scroll it caused is undone before measuring.
      const scrollers: [Element, number][] = [];
      for (let p = el.parentElement; p; p = p.parentElement) scrollers.push([p, p.scrollLeft]);
      const pageX = window.scrollX;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      for (const [p, left] of scrollers) p.scrollLeft = left;
      window.scrollTo(pageX, window.scrollY);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const at = document.elementFromPoint(x, y);
      return { left: r.left, right: r.right, hit: !!at && (at === el || el.contains(at)) };
    });
    expect(hit.left, `${what}: action ${n} start`).toBeGreaterThanOrEqual(0);
    expect(hit.right, `${what}: action ${n} end`).toBeLessThanOrEqual(width);
    expect(hit.hit, `${what}: action ${n} reachable without sideways scrolling`).toBe(true);
  }
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

test("360 px: the Sponsor approves the submitted product gate G1 (business approval)", async ({ page }, info) => {
  const lang = langOf(info);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, sponsor.username);
  await open(page, `/transformations/${tid}/gates/G1`);
  const decide = page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true });
  await expectFits(page, PHONE.width, [decide], "gate page");
  await shot(page, lang, "p6-360-gate");
  await expectAccessible(page, lang, "p6-360-gate");
  await decide.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await confirmG1Agreements(dialog, lang);
  await dialog
    .getByLabel(fieldLabel(lang, "gates.decision.rationale"))
    .fill("Synthetic demo approval at 360 px (approves nothing real).");
  const confirm = dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true });
  await expectFits(page, PHONE.width, [confirm], "gate decision dialog");
  await shot(page, lang, "p6-360-gate-decision");
  await expectAccessible(page, lang, "p6-360-gate-decision");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-gate-status='approved']").first()).toBeVisible();
  await expectFits(page, PHONE.width, [], "gate approved");
  // Read back: one approved decision recorded on G1.
  const view = await lead.call<{ gate: { status: string } }>("GET", `${T}/gates/G1`);
  expect(view.gate.status).toBe("approved");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
});

test("360 px: the Sponsor approves a business approval request from My Work", async ({ page }, info) => {
  const lang = langOf(info);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, sponsor.username);
  await expectFits(page, PHONE.width, [], "home");
  await open(page, `/my-work/approvals/${approvalId}`);
  const decide = page.locator("[data-action='decide']");
  await expectFits(page, PHONE.width, [decide], "approval detail");
  await shot(page, lang, "p6-360-approval");
  await expectAccessible(page, lang, "p6-360-approval");
  await decide.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "approvals.decide.outcome")).selectOption("approve");
  await dialog
    .getByLabel(fieldLabel(lang, "approvals.decide.rationale"))
    .fill("Synthetic demo approval at 360 px (approves nothing real)");
  const submit = dialog.locator("[data-action='submit']");
  await expectFits(page, PHONE.width, [submit], "approval decision dialog");
  await shot(page, lang, "p6-360-approval-decision");
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-approval-status='approved']").first()).toBeVisible();
  await expectFits(page, PHONE.width, [], "approval approved");
  const after = await lead.call<{ status: string; decisions: unknown[] }>("GET", `/api/v1/approvals/${approvalId}`);
  expect(after.status).toBe("approved");
  expect(after.decisions).toHaveLength(1);
});

test("360 px: the KPI owner submits a KPI actual", async ({ page }, info) => {
  const lang = langOf(info);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, owner.username);
  await open(page, `/transformations/${tid}/kpis/${kpiId}/actuals`);
  const form = page.locator("form").filter({ has: page.locator("fieldset[data-step='1']") });
  await form.getByLabel(fieldLabel(lang, "kpiP4.field.period")).selectOption(periodId);
  await form.getByLabel(new RegExp(`^${escape(tr(lang, "kpiP4.field.actual"))}`)).fill("12.5");
  const submit = form.locator("[data-action='submit-actual']");
  await expectFits(page, PHONE.width, [submit], "KPI actual form");
  await shot(page, lang, "p6-360-kpi-actual");
  await expectAccessible(page, lang, "p6-360-kpi-actual");
  await submit.click();
  const confirmation = page.locator("[data-state='kpi-update-confirmation']");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(tr(lang, "kpiP4.actualStatus.submitted"));
  await expectFits(page, PHONE.width, [], "KPI actual confirmation");
  await shot(page, lang, "p6-360-kpi-actual-submitted");
  const actuals = await lead.call<{ items: { status: string }[] }>("GET", `${T}/kpi-definitions/${kpiId}/actuals`);
  expect(actuals.items.filter((a) => a.status === "submitted")).toHaveLength(1);
});

test("360 px: the Business Owner accepts the KPI actual from the review queue", async ({ page }, info) => {
  const lang = langOf(info);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, reviewer.username);
  await open(page, `/transformations/${tid}/kpi-review`);
  const row = page.locator("#kpi-review-queue tr", { hasText: `Synthetic 360 adoption ${lang} ${stamp}` });
  const accept = row.locator("[data-action='accept-actual']");
  await expectFits(page, PHONE.width, [accept], "KPI review queue");
  await shot(page, lang, "p6-360-kpi-review");
  await expectAccessible(page, lang, "p6-360-kpi-review");
  await accept.click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.locator("[data-action='submit']");
  await expectFits(page, PHONE.width, [submit], "KPI accept dialog");
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator("#kpi-review-queue tr", { hasText: `Synthetic 360 adoption ${lang} ${stamp}` }),
  ).toHaveCount(0);
  await expectFits(page, PHONE.width, [], "KPI review queue after accept");
  const actuals = await lead.call<{ items: { status: string }[] }>("GET", `${T}/kpi-definitions/${kpiId}/actuals`);
  expect(actuals.items.filter((a) => a.status === "accepted")).toHaveLength(1);
});

test("768 px: the gate, approval, KPI actual and KPI review screens keep their actions inside the viewport", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await page.setViewportSize(TABLET);
  await signIn(page, lang, "dev.lead");
  await expectFits(page, TABLET.width, [], "home");
  await open(page, `/transformations/${tid}/gates/G1`);
  await expectFits(page, TABLET.width, [], "gate page");
  await open(page, `/my-work/approvals/${approvalId}`);
  await expectFits(page, TABLET.width, [], "approval detail");
  await open(page, `/transformations/${tid}/kpis/${kpiId}/actuals`);
  await expectFits(page, TABLET.width, [], "KPI actual page");
  await open(page, `/transformations/${tid}/kpi-review`);
  await expectFits(page, TABLET.width, [], "KPI review queue");
  await shot(page, lang, "p6-768-kpi-review");
});
