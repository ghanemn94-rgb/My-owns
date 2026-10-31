// qa-verifier A20 accessibility on the P6 screens (DG6, T-DG6-QA-D). Binding row REQ-S15-012: "A20: an automated axe
// scan reports no serious or critical violations on key screens; ...". The scope is e2e/support/p6-axe-screens.ts:
// every route the web router registers in P6 (P6_AXE_ROUTES; a unit test keeps that list equal to router.tsx) and the
// key flows of ADR-0061 §7.2 (KEY_FLOW_AXE_SCREENS). Each screen is opened in chromium-en and chromium-ar at
// 1366 × 900 and at 360 × 800, its <html> lang/dir is asserted, and axe (wcag2a, wcag2aa, wcag21a, wcag21aa; the
// shared helper of apps/web/e2e/support/ui.ts) must report 0 serious or critical violations. No request may leave the
// application origin. `:param` segments are filled from SYNTHETIC fixtures created here through the real API, or from
// the first row link of the screen's own list. A screen whose record cannot be created on this stack is SKIPPED with
// its reason (reported by Playwright, never passed silently) and listed in the handback. The violation summary (all
// impacts) is written to QA_EVIDENCE_DIR/axe-summary-<project>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { KEY_FLOW_AXE_SCREENS, P6_AXE_ROUTES, type AxeScreen } from "./support/p6-axe-screens.ts";
import { syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  axeSummary,
  expectAccessible,
  langOf,
  signIn,
  trackRequests,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a20-p6");
const VIEWPORTS = [
  { name: "1366", width: 1366, height: 900 },
  { name: "360", width: 360, height: 800 },
] as const;
const stamp = Date.now().toString(36);

/** Values for the `:param` segments, filled in beforeAll. */
const params: Record<string, string> = { channelKind: "email", gateCode: "G1" };
/** Fixture users that open a key-flow screen (username per role). */
const fixtureUser: Record<string, string> = {};

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  try {
    const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A20 axe ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    });
    params["id"] = t.id;
    const T = `/api/v1/transformations/${t.id}`;
    const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
    const orgId = me.organization.id;
    for (const role of ["SP", "KDS", "BO"]) {
      const u = await syntheticUser(
        admin,
        orgId,
        t.id,
        `dev.qa20axe.${role.toLowerCase()}.${lang}.${stamp}`,
        `Synthetic QA ${role} ${lang}`,
        role,
        lang,
      );
      fixtureUser[`${role} fixture`] = u.username;
      if (role !== "KDS")
        await lead.call("POST", `${T}/role-mappings`, { partyCode: role, targetKind: "user", userId: u.id });
      if (role === "KDS") params["kdsUserId"] = u.id;
    }
    // A KPI owned by the KPI-owner fixture (kpi, kpi actual entry).
    const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
      name: `Synthetic QA axe KPI ${lang} ${stamp}`,
      unitKind: "percentage",
      polarity: "higher_is_better",
      frequency: "monthly",
      ownerUserId: params["kdsUserId"],
    });
    await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
    params["kpiId"] = kpi.id;
    // A connector with one (queued) run: connector, edit, mappings, run, service identity.
    const c = await admin.call<{ id: string; serviceIdentityId: string }>("POST", "/api/v1/admin/connectors", {
      organizationId: orgId,
      code: `qa-a20-axe-${lang}-${stamp}`,
      nameEn: `Synthetic QA axe connector ${lang}`,
      nameAr: `موصل اصطناعي للفحص ${lang}`,
      adapterKind: "test_adapter",
      targetKind: "none",
      config: {
        sourceSystemId: `synthetic.qa-a20:${lang}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: null,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: { mode: "healthy" },
        reason: "Synthetic connector for the QA A20 accessibility scan.",
      },
    });
    params["connectorId"] = c.id;
    params["serviceIdentityId"] = c.serviceIdentityId;
    const full = await admin.req.get(`/api/v1/admin/connectors/${c.id}`);
    const etag = full.headers()["etag"]!;
    const csrf = ((await (await admin.req.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
    const en = await admin.req.post(`/api/v1/admin/connectors/${c.id}/enable`, {
      headers: { "X-CSRF-Token": csrf, "If-Match": etag },
      data: { reason: null },
    });
    expect(en.status(), await en.text()).toBe(200);
    const run = await admin.req.post(`/api/v1/admin/connectors/${c.id}/runs`, {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data: {},
    });
    if (run.ok()) params["runId"] = ((await run.json()) as { id: string }).id;
    // An audit event (the admin's own changes above are audited).
    const audit = await admin.req.get(`/api/v1/audit-events?organizationId=${orgId}&limit=1`);
    if (audit.ok()) {
      const first = ((await audit.json()) as { items: { id: string }[] }).items[0];
      if (first) params["auditEventId"] = first.id;
    }
  } finally {
    await lead.req.dispose();
    await admin.req.dispose();
  }
});

test.afterAll(async ({}, info) => {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE, `axe-summary-${info.project.name}.json`),
    JSON.stringify(axeSummary, null, 2) + "\n",
  );
});

/** Fills the route's `:params`; returns null (with the missing names) when a value is not available. */
function fill(route: string): { url: string | null; missing: string[] } {
  const missing: string[] = [];
  const url = route.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = params[name];
    if (!v) missing.push(name);
    return v ?? "";
  });
  return { url: missing.length ? null : url, missing };
}

/** The SYNTHETIC user that opens a screen: a seeded dev user, or one of this file's fixture users. */
function userFor(s: AxeScreen): string | null {
  if (s.signInAs.startsWith("dev.") && !s.signInAs.includes(" ")) return s.signInAs;
  return fixtureUser[s.signInAs] ?? null;
}

async function scan(page: Page, lang: Lang, s: AxeScreen, url: string, project: string) {
  const foreign = trackRequests(page);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(url);
    await expect(page.locator("main#main")).toBeVisible();
    await expect(page.locator("main#main h1").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await page.waitForLoadState("networkidle");
    const dir = path.join(EVIDENCE, lang, "axe");
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${project}--${s.name}--${vp.name}.png`), fullPage: true });
    await expectAccessible(page, lang, `${s.name}@${vp.name}`);
  }
  expect(foreign, `${s.name}: requests outside the application origin`).toEqual([]);
}

const DEMO_ONLY: Record<string, string> = {
  "/walkthrough": "the guided walkthrough answers only in a DEMO database (409 environment.not_demo on this stack)",
};
const NEEDS_UNAVAILABLE_RECORD: Record<string, string> = {
  "/l/:token":
    "a deep-link token is minted only by an external channel send (email), which this A21-style stack never enables",
  "/admin/operations/exceptions/:exceptionId":
    "an operational exception needs a failed worker job; with-stack.sh runs no worker",
  "/admin/sensitive-grants/:grantId":
    "a sensitive grant needs a sensitive benefit/business case/evidence record (not created by this scan)",
  "/admin/integrations/webhooks/:webhookId":
    "a webhook endpoint needs a resolvable signing-secret reference on the API host",
  "/transformations/:id/outbound-writes/:writeId":
    "an outbound write needs a deliverable and a TD user (covered by the A21 integration suite, not scanned)",
  "/transformations/:id/imports/:importId": "an import batch needs a file upload (A17's e2e scans the batch screen)",
  "/my-work/approvals/:approvalId":
    "an approval request needs a routed decision (the A20 UX spec opens approvals at 360 px)",
  "/transformations/:id/benefits/:benefitId": "a benefit needs the P4 value chain (not created by this scan)",
};

for (const s of [...P6_AXE_ROUTES, ...KEY_FLOW_AXE_SCREENS]) {
  test(`axe 0 serious/critical: ${s.route} (${s.name})`, async ({ page }, info) => {
    const lang = langOf(info);
    const demo = DEMO_ONLY[s.route];
    test.skip(!!demo, `NOT SCANNED: ${demo}`);
    const unavailable = NEEDS_UNAVAILABLE_RECORD[s.route];
    test.skip(!!unavailable && !fill(s.route).url, `NOT SCANNED: ${unavailable}`);
    const user = userFor(s);
    test.skip(!user, `NOT SCANNED: no fixture user for "${s.signInAs}"`);
    const { url, missing } = fill(s.route);
    test.skip(!url, `NOT SCANNED: no value for :${missing.join(", :")}`);
    await signIn(page, lang, user!);
    await scan(page, lang, s, url!, info.project.name);
  });
}
