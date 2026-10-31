// A17 / REQ-S12-019, the user-visible path of the failing-connector scenario (qa-verifier, T-DG6-QA-A2):
// "a failing test connector produces one exception and the KPI shows Stale with its last value and date"
// (docs/delivery/requirements.csv), with M0239 "retain last known values with freshness labels" and the row's
// "An exception is shown to admins and data owners; values display as Stale with last update time".
// The API-level proof (exactly one exception, database state, no silent data change) is the "failing connector"
// describe of tests/qa/integration/a17-import-and-integration.test.ts.
//
// Read rule (ADR-0053 §2 "Readable links only"; D-202 option (a)): the data owner (a KDS assigned to the KPI's
// transformation, holder of transformation.read there) sees the linked KPI by name with its Stale label, last value and
// date; the technical administrator (dev.admin) sees the exception and that one linked KPI is hidden, never its name.
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, the built
// API serving the built SPA; the API's connector run watch executes due runs every 10 s) plus the BUILT production
// worker as its own OS process (e2e/support/a13-a22-stack.ts `startProductionWorker`): it recalculates the KPI panel
// and opens the operational exception from the `connector.run_failed` event. Every fixture is created through the
// public API by seeded synthetic dev users and fresh synthetic users. Per project (chromium-en: English LTR;
// chromium-ar: Arabic RTL): <html lang/dir>, axe with 0 serious or critical issues, a screenshot of each screen.
// All data is SYNTHETIC; nothing is connected to a Mobily system; nothing here is a business approval (G1-G6) or
// touches the engineering gates.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests, type Lang } from "../apps/web/e2e/support/ui.ts";
import {
  apiSession,
  poll,
  send,
  startProductionWorker,
  type Api,
  type Body,
  type ProductionWorker,
} from "./support/a13-a22-stack.ts";
import { decimalCanon } from "../tests/qa/support/a17-files.ts";

const DEV_ISSUER = "urn:mth:dev-local";
/** The KPI's last accepted actual: a past period, older than the default staleAfterDays (45) on any later date. */
const PAST_PERIOD = "2026-01";
const LAST_VALUE = "250.75";
const LAST_DATE = "2026-01-31";
/** A later monthly period that is open while the connector delivers nothing (the KPI's last value stays 2026-01). */
const LATER_PERIOD = "2044-06";

test.describe.configure({ timeout: 180_000 });

let worker: ProductionWorker | null = null;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  worker = await startProductionWorker();
});
test.afterAll(async () => {
  await worker?.stop();
});

async function ok(p: Promise<{ status: number; body: Body; etag?: string | undefined }>, what: string): Promise<Body> {
  const r = await p;
  expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body;
}

const ifm = (v: number) => ({ "if-match": `"${v}"` });

/** Find or create and open a monthly period with a fixed label (shared by both projects on one stack). */
async function period(office: Api, orgId: string, label: string): Promise<string> {
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  const items = (await ok(send(office, "GET", `${P}?limit=100`), "periods")).items as Body[];
  const found = items.find((p) => p.periodLabel === label && p.frequency === "monthly");
  if (found) return found.id as string;
  const [y, m] = label.split("-").map(Number) as [number, number];
  const end = `${label}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const p = await ok(
    send(office, "POST", P, { frequency: "monthly", periodLabel: label, periodStart: `${label}-01`, periodEnd: end }),
    `period ${label}`,
  );
  await ok(send(office, "POST", `${P}/${p.id}/open`, undefined, ifm(p.version)), `open ${label}`);
  return p.id as string;
}

/** Every actual of the KPI with its current value and status (the database state, read through the contract). */
async function actualLines(kds: Api, T: string, kpiId: string): Promise<string[]> {
  const r = await ok(send(kds, "GET", `${T}/kpi-definitions/${kpiId}/actuals?limit=100`), "actuals");
  return (r.items as Body[]).map((a) => {
    const v = (a.values as Body[] | undefined)?.at(-1)?.value ?? a.value ?? null;
    return `${a.id}|${a.periodLabel}|${decimalCanon(v)}|${a.status}`;
  });
}

async function expectDocument(page: Page, lang: Lang): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

test("A17 / REQ-S12-019: a failing test connector opens one operational exception; the data owner sees the KPI Stale with its last value and date, the technical admin only its count", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const lang = langOf(info);
  const base = baseURL!;
  const stamp = `${lang}${randomBytes(3).toString("hex")}`;
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, base, "dev.admin");
  const office = await apiSession(playwright, base, "dev.office");
  const orgId = admin.organizationId;

  // ---- fixture (public API, synthetic): a transformation, its KDS (data owner) and TL, one direct-accept KPI.
  const units = await ok(send(admin, "GET", `/api/v1/organizations/${orgId}/business-units`), "units");
  const retail = (units.items as Body[]).find((u) => u.code === "SYN-RETAIL");
  expect(retail, "seeded business unit SYN-RETAIL").toBeDefined();
  const t = await ok(
    send(office, "POST", "/api/v1/transformations", {
      businessUnitId: retail.id,
      name: `QA A17 synthetic failing-connector transformation ${stamp}`,
      mode: "end_to_end",
    }),
    "transformation",
  );
  const tid: string = t.id;
  const T = `/api/v1/transformations/${tid}`;
  const user = async (role: string, label: string) => {
    const subject = `qa.a17x.${label}.${stamp}`;
    const u = await ok(
      send(admin, "POST", "/api/v1/users", {
        organizationId: orgId,
        displayName: `QA A17 synthetic ${label} ${stamp}`,
        email: `${subject}@example.invalid`,
        identity: { issuer: DEV_ISSUER, subject },
      }),
      `user ${label}`,
    );
    await ok(
      send(admin, "POST", "/api/v1/role-assignments", {
        userId: u.id,
        roleCode: role,
        scope: { type: "transformation", id: tid },
        reason: "QA A17 synthetic fixture",
      }),
      `grant ${role}`,
    );
    return { id: u.id as string, subject };
  };
  const kdsUser = await user("KDS", "kds");
  const leadUser = await user("TL", "lead");
  const kds = await apiSession(playwright, base, kdsUser.subject);
  const lead = await apiSession(playwright, base, leadUser.subject);
  const def = await ok(
    send(lead, "POST", `${T}/kpi-definitions`, {
      name: `QA A17 synthetic stale KPI ${stamp}`,
      unitKind: "count",
      unitLabel: "orders",
      polarity: "higher_is_better",
      frequency: "monthly",
      ownerUserId: kdsUser.id,
    }),
    "kpi",
  );
  await ok(send(lead, "POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, ifm(def.version)), "kpi activate");
  const ver = await ok(
    send(lead, "POST", `${T}/kpi-definitions/${def.id}/versions`, {
      measureType: "higher_is_better",
      valueNature: "flow",
      aggregationRule: "sum",
      submissionRoute: "direct_accept",
    }),
    "kpi version",
  );
  await ok(send(lead, "POST", `${T}/kpi-versions/${ver.id}/activate`, undefined, ifm(ver.version)), "version activate");
  const kpiId: string = def.id;

  // The KPI's last accepted actual: 250.75 as of 2026-01-31 (older than staleAfterDays: Stale).
  const pastId = await period(office, orgId, PAST_PERIOD);
  await ok(
    send(kds, "POST", `${T}/kpi-definitions/${kpiId}/actuals`, {
      scopeKind: "transformation",
      scopeId: tid,
      reportingPeriodId: pastId,
      action: "submit",
      value: LAST_VALUE,
      dataAsOf: LAST_DATE,
    }),
    "actual",
  );
  const panel = await poll(
    async () => {
      const s = await send(
        kds,
        "GET",
        `${T}/kpi-definitions/${kpiId}/status?scopeKind=transformation&scopeId=${tid}&reportingPeriodId=${pastId}`,
      );
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      return s.body.actualReason === "kpi.calculation_pending" ? null : s.body;
    },
    "the worker's recalculation of the KPI panel",
    60_000,
  );
  expect(panel.freshness).toMatchObject({ status: "stale", dataAsOf: LAST_DATE });
  // Time moves on: a later period is open and the failing connector delivers nothing for it.
  await period(office, orgId, LATER_PERIOD);

  // ---- the failing test connector feeding that KPI; one run, no retry.
  const code = `qa-a17x-fail-${stamp}`;
  const c = await ok(
    send(admin, "POST", "/api/v1/admin/connectors", {
      organizationId: orgId,
      code,
      nameEn: `QA A17 synthetic failing source ${stamp}`,
      nameAr: `مصدر اصطناعي متعطل ${stamp}`,
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.qa-a17x:failing-${stamp}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: tid,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "row_count",
        adapterSettings: { mode: "failing", kpiId },
        reason: "QA A17 synthetic failing connector",
      },
    }),
    "connector",
  );
  await ok(send(admin, "POST", `/api/v1/admin/connectors/${c.id}/enable`, { reason: null }, ifm(c.version)), "enable");
  const actualsBefore = await actualLines(kds, T, kpiId);
  expect(actualsBefore, "the one accepted 2026-01 actual").toEqual([
    expect.stringMatching(new RegExp(`\\|${PAST_PERIOD}\\|250\\.75\\|accepted$`)),
  ]);
  const queued = await ok(send(admin, "POST", `/api/v1/admin/connectors/${c.id}/runs`, {}), "run now");
  await poll(
    async () => {
      const d = await send(admin, "GET", `/api/v1/admin/connectors/${c.id}/runs/${queued.id}`);
      return d.status === 200 && d.body.run.status === "failed" ? d.body : null;
    },
    "the failed run (API run watch)",
    60_000,
  );
  const exceptions = await poll(
    async () => {
      const l = await send(
        admin,
        "GET",
        `/api/v1/admin/operations/exceptions?organizationId=${orgId}&sourceKind=connector&limit=100`,
      );
      expect(l.status, JSON.stringify(l.body)).toBe(200);
      const mine = (l.body.items as Body[]).filter((e) => e.sourceCode === code);
      return mine.length > 0 ? mine : null;
    },
    "the connector's operational exception (worker)",
    60_000,
  );
  expect(exceptions, JSON.stringify(exceptions)).toHaveLength(1);
  const exceptionId: string = exceptions[0].id;
  const kpiName: string = def.name;

  // ---- the data owner: the linked KPI by name, labelled Stale, its last value and date (never Unknown, never 0).
  const kdsMe = await ok(send(kds, "GET", "/api/v1/me"), "kds me");
  await ok(send(kds, "PUT", "/api/v1/me/preferences", { preferredLocale: lang }, ifm(kdsMe.user.version)), "locale");
  await signIn(page, lang, kdsUser.subject);
  await page.goto(`/admin/operations/exceptions/${exceptionId}`);
  await expectDocument(page, lang);
  await expect(page.locator(`[data-exception='${exceptionId}']`)).toBeVisible();
  const kpis = page.locator("table[data-table='exception-kpis']");
  await expect(kpis).toBeVisible();
  const row = kpis.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: kpiName })).toHaveAttribute(
    "href",
    `/transformations/${tid}/kpis/${kpiId}`,
  );
  await expectAccessible(page, lang, "a17-exception-data-owner");
  await shot(page, lang, "a17-exception-data-owner");
  await expect.soft(row, "freshness label").toHaveAttribute("data-kpi-freshness", "stale");
  await expect.soft(row.locator(`[data-last-value='${LAST_VALUE}']`), "last value").toHaveText(LAST_VALUE);
  // The date is the actual's 2026-01-31 in Asia/Riyadh, Latin digits in both languages (ADR-0009 §2).
  const dateCell = row.locator("td").nth(2);
  await expect.soft(dateCell, "last value date").toContainText("2026");
  await expect.soft(dateCell, "last value date").toContainText("31");
  await expect.soft(dateCell, "last value date").not.toContainText(tr(lang, "adminP6.common.unknown"));

  // ---- the technical administrator: the exception and one hidden linked KPI, never its name.
  await page.context().clearCookies();
  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/operations/exceptions/${exceptionId}`);
  await expectDocument(page, lang);
  await expect(page.locator(`[data-exception='${exceptionId}']`)).toHaveAttribute("data-status", "open");
  await expect(page.locator("[data-hidden-kpis='1']")).toBeVisible();
  await expect(page.locator("table[data-table='exception-kpis']")).toHaveCount(0);
  await expect(page.locator("main#main")).not.toContainText(kpiName);
  await expectAccessible(page, lang, "a17-exception-tech-admin");
  await shot(page, lang, "a17-exception-tech-admin");

  // No silent data change: the KPI's actuals are exactly those before the run.
  expect(await actualLines(kds, T, kpiId)).toEqual(actualsBefore);
  expect(foreign).toEqual([]);
  for (const a of [admin, office, kds, lead]) await a.ctx.dispose().catch(() => undefined);
});
