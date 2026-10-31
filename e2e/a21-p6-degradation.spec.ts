// qa-verifier A21 "No-AI operation" on the P6 screens (DG6, T-DG6-QA-D), in chromium-en and chromium-ar. Master
// prompt §20 A21: "Core lifecycle, approvals, calculations and reports still work with AI and external notification
// channels disabled". Binding rows: REQ-S17-009 "a fresh install shows AI disabled, and a network capture during the e2e
// suite shows no outbound calls to model or telemetry hosts"; REQ-S12-023 "with no email adapter configured all
// workflows complete and notifications appear in the inbox"; REQ-S17-010 "the guided lifecycle e2e test passes with AI
// disabled and external notification channels off"; REQ-S20-021.
// The stack (apps/web/e2e/support/with-stack.sh, a freshly migrated database) saves no assistant setting and no
// notification channel: AI and every external channel are off, exactly as shipped. The user-visible path:
//  1. Administration > AI assistant shows "Off (not configured)" and telemetry off; Administration > Notifications lists
//     both channels as not enabled, and says that the in-app inbox always works;
//  2. a KPI actual is submitted on a review route (setup through the real API); the reviewer signs in and finds the
//     reminder in the in-app inbox on My Work, in the selected language, follows it, and accepts the actual in the UI;
//     the accepted value reads back exactly ("0.125", i.e. 12.5 %);
//  3. during the whole path no browser request leaves the application origin (no model, telemetry, mail or CDN host);
//     the API process's own outbound connections are checked by e2e/support/connection-log-check.ts after the run
//     (e2e/support/a21-connection-log-run.sh).
// Every record is SYNTHETIC; nothing approves anything real or names an engineering gate.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { syntheticUser, type SyntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a21-p6");
const stamp = Date.now().toString(36);
let lead: ApiSession;
let reviewer: SyntheticUser;
let owner: SyntheticUser;
let tid = "";
let kpiId = "";
let kpiName = "";
let actualId = "";

async function freeMonthlyPeriod(office: ApiSession, orgId: string, offset: number): Promise<string> {
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  for (let i = 0; i < 120; i++) {
    const n = offset + i;
    const y = 2051 + Math.floor(n / 12);
    const m = (n % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const res = await office.req.fetch(P, {
      method: "POST",
      headers: {
        "X-CSRF-Token": (await (await office.req.get("/api/v1/me")).json()).csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        frequency: "monthly",
        periodLabel: `${y}-${mm}`,
        periodStart: `${y}-${mm}-01`,
        periodEnd: `${y}-${mm}-${last}`,
      },
    });
    if (res.status() !== 201) continue;
    const p = (await res.json()) as { id: string; version: number };
    await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
    return p.id;
  }
  throw new Error("no free synthetic monthly period");
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A21 P6 ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  owner = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.qa21.kds.${lang}.${stamp}`,
    `Synthetic KPI owner ${lang}`,
    "KDS",
    lang,
  );
  reviewer = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.qa21.bo.${lang}.${stamp}`,
    `Synthetic reviewer ${lang}`,
    "BO",
    lang,
  );
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "BO", targetKind: "user", userId: reviewer.id });
  kpiName = `Synthetic A21 adoption ${lang} ${stamp}`;
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: kpiName,
    unitKind: "percentage",
    polarity: "higher_is_better",
    frequency: "monthly",
    ownerUserId: owner.id,
  });
  await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
  kpiId = kpi.id;
  const v = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions/${kpiId}/versions`, {
    measureType: "higher_is_better",
    valueNature: "stock",
    aggregationRule: "last_value",
    targetValue: "0.25",
    targetDate: "2052-12-31",
    reviewerPartyCode: "BO",
  });
  await lead.call("POST", `${T}/kpi-versions/${v.id}/activate`, undefined, { ifMatch: v.version });
  const periodId = await freeMonthlyPeriod(office, orgId, lang === "en" ? 0 : 60);
  // The KPI owner submits the actual through the real API (the UI submission is A20's 360 px flow).
  const ownerApi = await apiSession(playwright, owner.username);
  const submitted = await ownerApi.call<{ actual: { id: string } }>(
    "POST",
    `${T}/kpi-definitions/${kpiId}/actuals`,
    {
      scopeKind: "transformation",
      scopeId: tid,
      action: "submit",
      dataAsOf: "2051-01-31",
      reportingPeriodId: periodId,
      value: "0.125",
    },
    { expect: 201 },
  );
  actualId = submitted.actual.id;
  for (const s of [admin, office, ownerApi]) await s.req.dispose();
});

test.afterAll(async () => {
  await lead?.req.dispose();
});

test("A21 / REQ-S17-009: Administration shows the assistant off (not configured), telemetry off, and every channel not enabled", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");

  const settingRes = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/admin/assistant") && r.request().method() === "GET",
  );
  await page.goto("/admin/assistant");
  const setting = (await (await settingRes).json()) as {
    configured: boolean;
    enabled: boolean;
    telemetryEnabled: boolean;
  };
  expect(setting).toMatchObject({ configured: false, enabled: false, telemetryEnabled: false });
  const main = page.locator("main#main");
  await expect(main).toContainText(tr(lang, "assistant.admin.statusNotConfigured"));
  await expect(main).toContainText(tr(lang, "assistant.admin.telemetry"));
  await expect(main).not.toContainText(new RegExp(`^${tr(lang, "assistant.admin.statusOn")}$`));
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await page.screenshot({ path: path.join(dir, "a21-admin-assistant-off.png"), fullPage: true });
  await expectAccessible(page, lang, "a21-admin-assistant-off");

  await page.goto("/admin/notification-channels");
  await expect(main).toContainText(tr(lang, "adminP6.channels.inAppNote"));
  await expect(main).toContainText(tr(lang, "adminP6.channels.kindValue.email"));
  await expect(main).toContainText(tr(lang, "adminP6.channels.kindValue.enterprise_messaging"));
  // Every channel row's status is something other than "Enabled" (Not configured / Not enabled / Not available).
  const rows = main.getByRole("table", { name: tr(lang, "adminP6.channels.listTitle") }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const status = (await rows.nth(i).getByRole("cell").first().innerText()).trim();
    expect(status, `channel row ${i} status`).not.toBe(tr(lang, "adminP6.channels.statusEnabled"));
    expect(status.length).toBeGreaterThan(0);
  }
  await page.screenshot({ path: path.join(dir, "a21-admin-channels-off.png"), fullPage: true });
  await expectAccessible(page, lang, "a21-admin-channels-off");
  expect(foreign).toEqual([]);
});

test("A21 / REQ-S12-023: with no channel configured the reviewer finds the reminder in the inbox, follows it and accepts the actual", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const foreign = trackRequests(page);
  await signIn(page, lang, reviewer.username);
  const inbox = page.locator("section#inbox, #inbox").first();
  await expect(inbox).toBeVisible();
  const item = inbox
    .locator("li[data-notification]")
    .filter({ has: page.locator(`a[href*="${kpiId}"], a[href*="${actualId}"], a[href*="kpi-review"]`) });
  await expect(item.first(), "the reminder of the submitted actual is in the in-app inbox").toBeVisible();
  await expect(item.first()).toHaveAttribute("data-read", "false");
  await expect(inbox).toContainText(tr(lang, "myWork.inbox.unread"));
  await page.screenshot({ path: path.join(dir, "a21-inbox-reminder.png"), fullPage: true });
  await expectAccessible(page, lang, "a21-inbox");

  await item.first().getByRole("link").click();
  await expect(page.locator("main#main h1")).toBeVisible();
  // Accept from the KPI review queue (the reviewer's native workflow).
  await page.goto(`/transformations/${tid}/kpi-review`);
  const row = page.locator("#kpi-review-queue tr", { hasText: kpiName });
  await row.locator("[data-action='accept-actual']").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[data-action='submit']").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-review-queue tr", { hasText: kpiName })).toHaveCount(0);
  const actuals = await lead.call<{
    items: {
      id: string;
      status: string;
      currentValueNo: number;
      values: { valueNo: number; value: string | null }[];
    }[];
  }>("GET", `/api/v1/transformations/${tid}/kpi-definitions/${kpiId}/actuals`);
  const a = actuals.items.find((x) => x.id === actualId)!;
  expect(a.status).toBe("accepted");
  const value = a.values.find((x) => x.valueNo === a.currentValueNo)!.value!;
  expect(value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")).toBe("0.125"); // 12.5 % as an exact fraction
  await page.screenshot({ path: path.join(dir, "a21-actual-accepted.png"), fullPage: true });
  expect(foreign).toEqual([]);
});
