// T-DG1-FE2 visual evidence (F-DG1-003/004/005). It drives the BUILT SPA (apps/web/dist, served by `vite preview`)
// with the API MOCKED through page.route. This is not the live API+DB stack, which the reviewers run with
// apps/web/e2e. All data is SYNTHETIC. It writes full-page screenshots plus an axe summary (WCAG 2.0/2.1 A+AA) per
// language next to this file, and fails on any serious or critical axe violation.
//
// Run from the repository root (after `pnpm --filter @mth/web build`), in ONE shell so the preview server stays up:
//   (cd apps/web && npx vite preview --port 4179 --strictPort) & sleep 3;
//   E2E_BASE_URL=http://localhost:4179 npx playwright test --config docs/delivery/handbacks/DG1/round-2/T-DG1-FE2-evidence/capture.config.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "screenshots");
const ORG = "01920000-0000-7000-9000-000000000001";
const BU = "01920000-0000-7000-9000-000000000101";
const ME = "01920000-0000-7000-9000-000000000201";
const LEAD = "01920000-0000-7000-9000-000000000202";
const TR = "01920000-0000-7000-9000-000000000301";
const NEW = "01920000-0000-7000-9000-000000000399";
const T0 = "2026-10-01T06:29:00Z";

type Lang = "en" | "ar";

const org = {
  id: ORG,
  code: "SYN-DEV",
  nameEn: "Synthetic Dev Organization",
  nameAr: "جهة التطوير الاصطناعية",
  defaultTimezone: "Asia/Riyadh",
  defaultCurrency: "SAR",
  defaultLocale: "ar",
  status: "active",
  version: 1,
  createdAt: T0,
  updatedAt: T0,
};
const user = (id: string, displayName: string, lang: Lang) => ({
  id,
  organizationId: ORG,
  displayName,
  email: `${id.slice(-3)}@example.invalid`,
  preferredLocale: lang,
  timezone: null,
  status: "active",
  identities: [],
  version: 1,
  createdAt: T0,
  updatedAt: T0,
});
const grant = (type: string, id: string, inherits: boolean, permissions: string[]) => ({
  scope: { type, id },
  inheritsDownward: inherits,
  permissions,
});
const OFFICE = [
  grant("organization", ORG, true, [
    "organization.read",
    "business_unit.read",
    "role.read",
    "user.read",
    "transformation.read",
    "transformation.create",
    "transformation.update",
    "transformation.archive",
    "audit.read",
  ]),
];
const LEAD_AT_BU = [
  grant("business_unit", BU, false, [
    "organization.read",
    "business_unit.read",
    "role.read",
    "transformation.read",
    "transformation.create",
    "transformation.update",
  ]),
];
const me = (lang: Lang, grants: unknown[], name: string) => ({
  user: user(ME, name, lang),
  authMode: "dev",
  csrfToken: "c".repeat(43),
  productName: "Mobily Transformation Hub",
  organization: org,
  assignments: [],
  effectivePermissions: grants,
});
const bu = {
  id: BU,
  organizationId: ORG,
  parentBusinessUnitId: null,
  code: "SYN-RETAIL",
  nameEn: "Synthetic Retail",
  nameAr: "التجزئة (اصطناعي)",
  status: "active",
  version: 1,
  createdAt: T0,
  updatedAt: T0,
};
const transformation = (over: Record<string, unknown> = {}) => ({
  id: TR,
  organizationId: ORG,
  businessUnitId: BU,
  code: "TR-0001",
  name: "Synthetic closure UI",
  description: null,
  mode: "end_to_end",
  entryPhase: null,
  standaloneDeliverableType: null,
  status: "closed",
  currentPhase: "transform",
  sponsorUserId: null,
  leadUserId: LEAD,
  timezone: "Asia/Riyadh",
  currency: "SAR",
  archivedAt: null,
  archiveReason: null,
  version: 3,
  createdAt: T0,
  createdBy: ME,
  updatedAt: T0,
  updatedBy: ME,
  ...over,
});
const ev = (seq: number, action: string, prior: number | null, next: number, changes: unknown) => ({
  id: `01920000-0000-7000-9000-0000000005a${seq}`,
  seq: String(seq),
  occurredAt: T0,
  action,
  recordType: "transformation",
  recordId: TR,
  transformationId: TR,
  actor: { type: "user", userId: ME, displayName: "Synthetic Transformation Office" },
  onBehalfOfUserId: null,
  priorVersion: prior,
  newVersion: next,
  reason: null,
  requestId: null,
  changes,
});
const AUDIT = [
  ev(3, "transformation.update", 2, 3, { status: { from: "active", to: "closed" } }),
  ev(2, "transformation.update", 1, 2, {
    status: { from: "draft", to: "active" },
    lead_user_id: { from: null, to: LEAD },
  }),
  ev(1, "transformation.create", null, 1, {
    code: { from: null, to: "TR-0001" },
    mode: { from: null, to: "end_to_end" },
    name: { from: null, to: "Synthetic closure UI" },
    status: { from: null, to: "draft" },
    currency: { from: null, to: "SAR" },
    timezone: { from: null, to: "Asia/Riyadh" },
    current_phase: { from: null, to: "transform" },
    business_unit_id: { from: null, to: BU },
  }),
];
const notFound = { type: "urn:mth:problem:not-found", title: "Not found", status: 404, code: "not_found" };

async function mockApi(page: Page, lang: Lang, who: "office" | "lead") {
  const meBody =
    who === "office"
      ? me(lang, OFFICE, "Synthetic Transformation Office")
      : me(lang, LEAD_AT_BU, "Synthetic Transformation Lead");
  await page.addInitScript((l) => localStorage.setItem("mth.locale", l), lang);
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: status >= 400 ? "application/problem+json" : "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/api/v1/me") return json(200, meBody);
    if (p.endsWith("/business-units")) return json(200, { items: [bu], nextCursor: null });
    if (p === `/api/v1/users/${LEAD}`) return json(200, user(LEAD, "Synthetic Lead", lang));
    if (p === `/api/v1/users/${ME}`) return json(200, meBody.user);
    if (p === "/api/v1/users") return json(200, { items: [meBody.user], nextCursor: null });
    if (p === "/api/v1/transformations" && req.method() === "POST")
      return json(
        201,
        transformation({ id: NEW, code: "TR-0042", name: "Synthetic new transformation", status: "draft" }),
      );
    if (p === "/api/v1/transformations")
      return json(200, {
        items: [
          transformation(),
          transformation({
            id: NEW,
            code: "TR-0002",
            name: "Synthetic modular",
            mode: "modular",
            entryPhase: "mobilize",
            currentPhase: "mobilize",
            status: "draft",
          }),
        ],
        nextCursor: null,
      });
    if (p === `/api/v1/transformations/${TR}/audit`) return json(200, { items: AUDIT, nextCursor: null });
    if (p === `/api/v1/transformations/${TR}`) return json(200, transformation());
    return json(404, notFound);
  });
}

const axeSummary: Record<string, { id: string; impact: string | null; nodes: number }[]> = {};
async function shoot(page: Page, lang: Lang, name: string) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  mkdirSync(join(OUT, lang), { recursive: true });
  await page.screenshot({ path: join(OUT, lang, `${name}.png`), fullPage: true });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  axeSummary[`${lang}/${name}`] = results.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length }));
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id)).toEqual([]);
}

for (const lang of ["en", "ar"] as const) {
  test.describe(lang, () => {
    test.afterAll(() => {
      mkdirSync(join(OUT, lang), { recursive: true });
      writeFileSync(join(OUT, lang, "axe-summary.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
    });

    test("list, create form and About use the glossary terms (F-DG1-003)", async ({ page }) => {
      await mockApi(page, lang, "office");
      await page.goto("/transformations");
      await expect(page.getByText("TR-0001")).toBeVisible();
      await shoot(page, lang, "01-list");
      await page.goto("/transformations/new");
      await page.getByRole("radio").nth(1).check();
      await shoot(page, lang, "02-create-form-modular");
      await page.goto("/about");
      await shoot(page, lang, "03-about");
    });

    test("detail: phase stepper and localized audit trail (F-DG1-003, F-DG1-005)", async ({ page }) => {
      await mockApi(page, lang, "office");
      await page.goto(`/transformations/${TR}`);
      await expect(page.getByText("Synthetic Lead").first()).toBeVisible();
      await shoot(page, lang, "04-detail-audit-trail");
    });

    test("creator who cannot read the new record sees an explanation, not 'Not found' (F-DG1-004)", async ({
      page,
    }) => {
      await mockApi(page, lang, "lead");
      await page.goto("/transformations/new");
      await page.locator("select").first().selectOption(BU);
      await page.locator("input").first().fill("Synthetic new transformation");
      await page.locator("button[type=submit]").click();
      await expect(page.locator("[data-state='created-not-visible']")).toBeVisible();
      await shoot(page, lang, "05-created-not-visible");
      await page.goto(`/transformations/${TR}x`);
      await expect(page.locator("[data-state='no-permission']")).toBeVisible();
      await shoot(page, lang, "06-plain-not-found");
    });
  });
}
