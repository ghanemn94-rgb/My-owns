// A17 "Import and integration" (qa-verifier, T-DG6-QA-A), the user-visible paths: "Invalid rows are isolated,
// duplicates detected, valid rows committed with provenance; unavailable connector shows an actionable error"
// (master prompt §20). The API-level proof (database state, nothing partial, exceptions) is
// tests/qa/integration/a17-import-and-integration.test.ts.
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, the built
// API serving the built SPA, NODE_ENV=development so the API's connector run watch executes due runs every 10 s; no
// worker, no mocks). Every fixture is created through the public API by the seeded synthetic dev users and fresh
// synthetic users. Per project (chromium-en: English LTR; chromium-ar: Arabic RTL, from the user's preference):
//  1. REQ-S17-002/003: a KDS user uploads the 8/1/1 file as CSV and as XLSX on Strategy and KPIs > Imports; the batch
//     page shows the invalid row with "not a decimal" and the duplicate with "duplicate of row 3"; after Commit, 8 rows
//     are committed with a lineage link and 2 are not committed; the API confirms 8 KPI actuals with lineage;
//  2. REQ-S17-003: a signed webhook delivery to the real server is accepted (202) and its batch is listed on the
//     Imports page; an unsigned one is refused 401 (the webhook signing secret is the synthetic process variable
//     QA_A17_WEBHOOK_SIGNING_SECRET, exported before the stack starts and read by the built-in `env` SecretProvider);
//  3. REQ-S17-005 / A17: a failing and a stopped test connector, each run with "Run now": the connector page shows which
//     run failed, why and what to do, with both fallbacks, "Never succeeded" and "Not verified"; no KPI actual changes;
//     with the connector stopped, the fallback links open and a KPI actual is still submitted.
// Each screen: <html lang/dir>, axe with 0 serious or critical issues, a screenshot. All data is SYNTHETIC; nothing is
// "live" or connected to a Mobily system; nothing here is a business approval or touches DG0-DG7.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests, type Lang } from "../apps/web/e2e/support/ui.ts";
import {
  a17Rows,
  csvFile,
  decimalCanon,
  signWebhook,
  webhookItems,
  xlsxFile,
  XLSX,
  type Row,
} from "../tests/qa/support/a17-files.ts";

type Playwright = PlaywrightWorkerArgs["playwright"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const DEV_ISSUER = "urn:mth:dev-local";
const SECRET_VAR = "QA_A17_WEBHOOK_SIGNING_SECRET";
/** The template's columns (ADR-0056 §9; also read from GET /api/v1/import-templates in beforeAll). */
let HEADER: string[] = [];

interface Api {
  call(
    method: "GET" | "POST" | "PUT",
    url: string,
    data?: unknown,
    ifMatch?: number,
  ): Promise<{ status: number; body: Body }>;
  dispose(): Promise<void>;
  userId: string;
}

async function session(playwright: Playwright, baseURL: string, username: string): Promise<Api> {
  const origin = new URL(baseURL).origin;
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev login ${username}`).toBe(204);
  const me = await (await ctx.get("/api/v1/me")).json();
  return {
    userId: me.user.id,
    async call(method, url, data, ifMatch) {
      const res = await ctx.fetch(url, {
        method,
        ...(data !== undefined ? { data } : {}),
        headers: { "x-csrf-token": me.csrfToken, ...(ifMatch !== undefined ? { "if-match": `"${ifMatch}"` } : {}) },
      });
      const text = await res.text();
      return { status: res.status(), body: text ? JSON.parse(text) : null };
    },
    dispose: () => ctx.dispose(),
  };
}

async function ok(p: Promise<{ status: number; body: Body }>, what: string): Promise<Body> {
  const r = await p;
  expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body;
}

interface World {
  orgId: string;
  tid: string;
  kpis: { direct: string; review: string };
  kdsSubject: string;
  formPeriodId: string;
  admin: Api;
  kds: Api;
}
let world: World;
const opened: Api[] = [];

test.describe.configure({ timeout: 120_000 });

/** Open monthly periods with fixed labels (created once per stack; the second project reuses them). */
async function fixedPeriods(office: Api, orgId: string, labels: readonly string[]): Promise<void> {
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  const existing = ((await ok(office.call("GET", `${P}?limit=100`), "periods")).items as Body[]).map(
    (p) => p.periodLabel,
  );
  for (const label of labels) {
    if (existing.includes(label)) continue;
    const [y, m] = label.split("-").map(Number) as [number, number];
    const end = `${label}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const p = await ok(
      office.call("POST", P, { frequency: "monthly", periodLabel: label, periodStart: `${label}-01`, periodEnd: end }),
      `period ${label}`,
    );
    await ok(office.call("POST", `${P}/${p.id}/open`, undefined, p.version), `open ${label}`);
  }
}

const CSV_PERIODS = ["2042-01", "2042-02", "2042-03", "2042-04", "2042-05"];
const XLSX_PERIODS = ["2042-06", "2042-07", "2042-08", "2042-09", "2042-10"];
const WEBHOOK_PERIODS = ["2042-11", "2042-12", "2043-01", "2043-02", "2043-03"];
const FORM_PERIOD = "2043-04";

test.beforeAll(async ({ playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const base = baseURL!;
  const stamp = `${lang}${randomBytes(3).toString("hex")}`;
  const admin = await session(playwright, base, "dev.admin");
  const office = await session(playwright, base, "dev.office");
  opened.push(admin, office);
  const me = await ok(admin.call("GET", "/api/v1/me"), "me");
  const orgId: string = me.organization.id;
  const units = await ok(admin.call("GET", `/api/v1/organizations/${orgId}/business-units`), "units");
  const retail = (units.items as Body[]).find((u) => u.code === "SYN-RETAIL");
  expect(retail, "seeded business unit SYN-RETAIL").toBeDefined();
  const t = await ok(
    office.call("POST", "/api/v1/transformations", {
      businessUnitId: retail.id,
      name: `QA A17 synthetic transformation ${stamp}`,
      mode: "end_to_end",
    }),
    "transformation",
  );
  const tid: string = t.id;
  const T = `/api/v1/transformations/${tid}`;
  const user = async (role: string, label: string) => {
    const subject = `qa.a17.${label}.${stamp}`;
    const u = await ok(
      admin.call("POST", "/api/v1/users", {
        organizationId: orgId,
        displayName: `QA A17 synthetic ${label} ${stamp}`,
        email: `${subject}@example.invalid`,
        identity: { issuer: DEV_ISSUER, subject },
      }),
      `user ${label}`,
    );
    await ok(
      admin.call("POST", "/api/v1/role-assignments", {
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
  const kds = await session(playwright, base, kdsUser.subject);
  const lead = await session(playwright, base, leadUser.subject);
  opened.push(kds, lead);
  const kdsMe = await ok(kds.call("GET", "/api/v1/me"), "kds me");
  await ok(kds.call("PUT", "/api/v1/me/preferences", { preferredLocale: lang }, kdsMe.user.version), "locale");

  const kpi = async (name: string): Promise<string> => {
    const def = await ok(
      lead.call("POST", `${T}/kpi-definitions`, {
        name: `QA A17 ${name} ${stamp}`,
        unitKind: "count",
        unitLabel: "orders",
        polarity: "higher_is_better",
        frequency: "monthly",
        ownerUserId: kdsUser.id,
      }),
      "kpi",
    );
    await ok(lead.call("POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, def.version), "kpi activate");
    const ver = await ok(
      lead.call("POST", `${T}/kpi-definitions/${def.id}/versions`, {
        measureType: "higher_is_better",
        valueNature: "flow",
        aggregationRule: "sum",
        submissionRoute: "direct_accept",
      }),
      "kpi version",
    );
    await ok(lead.call("POST", `${T}/kpi-versions/${ver.id}/activate`, undefined, ver.version), "version activate");
    return def.id as string;
  };
  const kpis = { direct: await kpi("synthetic orders A"), review: await kpi("synthetic orders B") };
  await fixedPeriods(office, orgId, [...CSV_PERIODS, ...XLSX_PERIODS, ...WEBHOOK_PERIODS, FORM_PERIOD]);
  const templates = await ok(kds.call("GET", "/api/v1/import-templates"), "templates");
  HEADER = (templates.items as Body[])
    .find((x) => x.templateVersion === "kpi_actual.v1")
    .columns.map((c: Body) => String(c.key));
  const periods = await ok(office.call("GET", `/api/v1/organizations/${orgId}/reporting-periods?limit=100`), "periods");
  const formPeriodId: string = (periods.items as Body[]).find((p) => p.periodLabel === FORM_PERIOD).id;
  world = { orgId, tid, kpis, kdsSubject: kdsUser.subject, formPeriodId, admin, kds };
});

test.afterAll(async () => {
  for (const a of opened.splice(0)) await a.dispose().catch(() => undefined);
});

async function expectDocument(page: Page, lang: Lang): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

/** KPI actuals of the two fixture KPIs (API read), as "kpi|period|value" lines. */
async function actualLines(): Promise<string[]> {
  const out: string[] = [];
  for (const id of [world.kpis.direct, world.kpis.review]) {
    const r = await ok(
      world.kds.call("GET", `/api/v1/transformations/${world.tid}/kpi-definitions/${id}/actuals?limit=100`),
      "actuals",
    );
    for (const a of r.items as Body[]) {
      const v = (a.values as Body[] | undefined)?.at(-1)?.value ?? a.value ?? null;
      out.push(`${id}|${a.periodLabel}|${decimalCanon(v)}|${a.status}`);
    }
  }
  return out.sort();
}

async function uploadAndCommit(
  page: Page,
  lang: Lang,
  file: { name: string; mimeType: string; buffer: Buffer },
  name: string,
): Promise<void> {
  await signIn(page, lang, world.kdsSubject);
  await page.goto(`/transformations/${world.tid}/imports`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "imports.title"));
  await expectDocument(page, lang);
  const before = (await actualLines()).length;
  await page.locator("[data-upload-form] input[type='file']").setInputFiles(file);
  await page.getByRole("button", { name: tr(lang, "imports.upload.submit") }).click();
  await page.waitForURL(`**/transformations/${world.tid}/imports/*`);
  const batchId = page.url().split("/").at(-1)!.split("?")[0]!;
  const rows = page.getByRole("table", { name: tr(lang, "imports.rows.title") });
  // The 2 others, isolated with row-level reasons in the page language.
  await expect(rows.locator("[data-reason='import.row.value_not_decimal']")).toHaveCount(1);
  await expect(rows.locator("[data-reason='import.row.duplicate_in_batch']")).toHaveCount(1);
  await expect(rows.locator("[data-reason='import.row.value_not_decimal']")).toContainText("12,5");
  await expect(rows.locator("[data-reason='import.row.duplicate_in_batch']")).toContainText("3");
  await expect(page.locator("[data-draft-label]")).toContainText(tr(lang, "imports.batch.stagedNotCommitted"));
  await expect(rows.locator("[data-commit-status='pending']")).toHaveCount(10);
  expect((await actualLines()).length, "staging commits nothing").toBe(before);
  await expectAccessible(page, lang, `a17-${name}-staged`);
  await shot(page, lang, `a17-${name}-staged`);

  await page.getByRole("button", { name: tr(lang, "imports.batch.commit") }).click();
  await expect(rows.locator("[data-commit-status='committed']")).toHaveCount(8, { timeout: 30_000 });
  await expect(rows.locator("[data-commit-status='not_committed']")).toHaveCount(2);
  await expect(rows.locator("[data-lineage]")).toHaveCount(8);
  // The 2 others stay visible with their reasons after the commit.
  await expect(rows.locator("[data-reason='import.row.value_not_decimal']")).toHaveCount(1);
  await expect(rows.locator("[data-reason='import.row.duplicate_in_batch']")).toHaveCount(1);
  await expectDocument(page, lang);
  await expectAccessible(page, lang, `a17-${name}-committed`);
  await shot(page, lang, `a17-${name}-committed`);

  // API: 8 KPI actuals more, each named by a committed row's lineage (provenance).
  expect((await actualLines()).length).toBe(before + 8);
  const rs = await ok(
    world.kds.call("GET", `/api/v1/transformations/${world.tid}/imports/${batchId}/rows?limit=100`),
    "rows",
  );
  const lineage = (rs.items as Body[]).filter((r) => r.lineage !== null);
  expect(lineage).toHaveLength(8);
  const batch = await ok(world.kds.call("GET", `/api/v1/transformations/${world.tid}/imports/${batchId}`), "batch");
  expect(batch).toMatchObject({ status: "committed", rowsCommitted: 8, fileName: file.name });
}

test("REQ-S17-002/003: the 8/1/1 CSV file commits 8 rows with lineage; the invalid and the duplicate row show their reasons", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const rows: Row[] = a17Rows(world.kpis, world.tid, CSV_PERIODS, `E2E-CSV-${lang}`);
  await uploadAndCommit(
    page,
    lang,
    { name: `qa-a17-${lang}.csv`, mimeType: "text/csv", buffer: csvFile(HEADER, rows) },
    "csv",
  );
  expect(foreign).toEqual([]);
});

test("REQ-S17-002/003: the same 8/1/1 fixture as XLSX commits 8 rows with lineage", async ({ page }, info) => {
  const lang = langOf(info);
  const rows: Row[] = a17Rows(world.kpis, world.tid, XLSX_PERIODS, `E2E-XLSX-${lang}`);
  await uploadAndCommit(
    page,
    lang,
    { name: `qa-a17-${lang}.xlsx`, mimeType: XLSX, buffer: xlsxFile(HEADER, rows, ["value"]) },
    "xlsx",
  );
});

test("REQ-S17-003: a signed webhook is accepted by the real server and its batch is listed; an unsigned one is refused", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const lang = langOf(info);
  const secret = process.env[SECRET_VAR];
  expect(secret, `${SECRET_VAR} must be exported before the stack starts (BLOCKED otherwise)`).toBeTruthy();
  const stamp = randomBytes(3).toString("hex");
  const c = await ok(
    world.admin.call("POST", "/api/v1/admin/connectors", {
      organizationId: world.orgId,
      code: `qa-a17-wh-${lang}-${stamp}`,
      nameEn: `QA A17 synthetic webhook ${lang}`,
      nameAr: `ويب هوك اصطناعي ${lang}`,
      adapterKind: "webhook",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.qa-a17:wh-${lang}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: world.tid,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: {},
        reason: "QA A17 synthetic webhook connector",
      },
    }),
    "webhook connector",
  );
  await ok(world.admin.call("POST", `/api/v1/admin/connectors/${c.id}/enable`, { reason: null }, c.version), "enable");
  const ep = await ok(
    world.admin.call("POST", "/api/v1/admin/webhooks", {
      connectorId: c.id,
      label: "QA A17 synthetic sender",
      signingSecretRef: { provider: "env", name: SECRET_VAR },
      toleranceSeconds: 300,
    }),
    "endpoint",
  );
  const raw = Buffer.from(
    JSON.stringify({
      templateVersion: "kpi_actual.v1",
      items: webhookItems(a17Rows(world.kpis, world.tid, WEBHOOK_PERIODS, `E2E-WH-${lang}`)),
    }),
  );
  const anon = await playwright.request.newContext({ baseURL: baseURL! });
  const ts = String(Math.floor(Date.now() / 1000));
  const unsigned = await anon.post(ep.receivePath, {
    data: raw,
    headers: {
      "content-type": "application/json",
      "x-mth-webhook-timestamp": ts,
      "x-mth-webhook-delivery": `qa-a17-u-${stamp}`,
    },
  });
  expect(unsigned.status()).toBe(401);
  expect((await unsigned.json()).code).toBe("webhook.unauthenticated");
  const delivery = `qa-a17-s-${lang}-${stamp}`;
  const signed = await anon.post(ep.receivePath, {
    data: raw,
    headers: {
      "content-type": "application/json",
      "x-mth-webhook-timestamp": ts,
      "x-mth-webhook-delivery": delivery,
      "x-mth-webhook-signature": signWebhook(secret!, ts, delivery, raw),
    },
  });
  const signedText = await signed.text();
  await anon.dispose();
  expect(signed.status(), `signed delivery: ${signedText}`).toBe(202);
  const receipt = JSON.parse(signedText);
  expect(receipt).toMatchObject({ rowsTotal: 10, rowsValid: 8, rowsInvalid: 1, rowsDuplicate: 1 });

  await signIn(page, lang, world.kdsSubject);
  await page.goto(`/transformations/${world.tid}/imports/${receipt.importBatchId}`);
  await expectDocument(page, lang);
  const rows = page.getByRole("table", { name: tr(lang, "imports.rows.title") });
  await expect(rows.locator("[data-reason='import.row.value_not_decimal']")).toHaveCount(1);
  await expectAccessible(page, lang, "a17-webhook-batch");
  await shot(page, lang, "a17-webhook-batch");
});

for (const mode of ["failing", "stopped"] as const) {
  const code = mode === "failing" ? "connector.source_unavailable" : "connector.stopped";
  const why = mode === "failing" ? "The source system did not respond." : "The connector's test adapter is stopped.";
  const todo =
    mode === "failing"
      ? "Retry the run later. Until the source is back, enter the values by form or import a file."
      : "Start the adapter (set its mode to healthy), or enter the values by form or import a file.";

  test(`A17 / REQ-S17-005: a ${mode} test connector shows the right state and an actionable error; no KPI actual changes`, async ({
    page,
  }, info) => {
    const lang = langOf(info);
    const foreign = trackRequests(page);
    const stamp = randomBytes(3).toString("hex");
    const c = await ok(
      world.admin.call("POST", "/api/v1/admin/connectors", {
        organizationId: world.orgId,
        code: `qa-a17-${mode}-${lang}-${stamp}`,
        nameEn: `QA A17 synthetic ${mode} source ${lang}`,
        nameAr: `مصدر اصطناعي ${mode} ${lang}`,
        adapterKind: "test_adapter",
        targetKind: "kpi_actual",
        config: {
          sourceSystemId: `synthetic.qa-a17:${mode}-${lang}`,
          endpointUrl: null,
          credentialRefs: {},
          fieldMappings: [],
          targetTransformationId: world.tid,
          cadence: "manual",
          retryMaxAttempts: 0,
          retryBackoffSeconds: 60,
          commitMode: "manual",
          commitOnBehalfOf: null,
          outboundActions: [],
          reconciliationRule: "row_count",
          adapterSettings: { mode, kpiId: world.kpis.direct },
          reason: `QA A17 synthetic ${mode} connector`,
        },
      }),
      "connector",
    );
    await ok(
      world.admin.call("POST", `/api/v1/admin/connectors/${c.id}/enable`, { reason: null }, c.version),
      "enable",
    );
    const before = await actualLines();

    await signIn(page, lang, "dev.admin");
    await page.goto(`/admin/integrations/connectors/${c.id}`);
    await expectDocument(page, lang);
    await page.getByRole("button", { name: tr(lang, "integrations.connector.runNow"), exact: true }).click();
    // The API's run watch executes the queued run (every 10 s); the page shows the failure once it is recorded.
    const error = page.locator(`[data-actionable-error='${code}']`);
    await expect(async () => {
      await page.reload();
      await expect(error).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });
    await expectDocument(page, lang);
    const whyText = lang === "en" ? why : tr(lang, `integrations.actionable.${code.replace(".", "__")}.why`);
    const todoText = lang === "en" ? todo : tr(lang, `integrations.actionable.${code.replace(".", "__")}.todo`);
    await expect(error.locator("[data-why]")).toHaveText(whyText);
    await expect(error.locator("[data-what-to-do]")).toHaveText(todoText);
    await expect(error.locator("[data-fallback='kpi_form']")).toHaveAttribute(
      "href",
      `/transformations/${world.tid}/kpis`,
    );
    await expect(error.locator("[data-fallback='import_file']")).toHaveAttribute(
      "href",
      `/transformations/${world.tid}/imports`,
    );
    await expect(page.locator("[data-last-success='never']")).toContainText(tr(lang, "integrations.lastSuccess.never"));
    await expect(page.locator("[data-status='not_verified']").first()).toBeVisible();
    await expectAccessible(page, lang, `a17-connector-${mode}`);
    await shot(page, lang, `a17-connector-${mode}`);

    // The run record: failed with the error code, counts Unknown (null), nothing staged.
    const runs = await ok(world.admin.call("GET", `/api/v1/admin/connectors/${c.id}/runs`), "runs");
    expect(runs.items[0]).toMatchObject({ status: "failed", errorCode: code, rowsRead: null, importBatchId: null });
    // No silent data change.
    expect(await actualLines()).toEqual(before);

    if (mode === "stopped") {
      // The fallbacks keep working while the connector is stopped: both pages open, and a KPI actual is still
      // submitted by the KPI's owner through the form's route.
      await error.locator("[data-fallback='import_file']").click();
      await expect(page.locator("main#main h1")).toHaveText(tr(lang, "imports.title"));
      await expectDocument(page, lang);
      const pid = world.formPeriodId;
      const submitted = await world.kds.call(
        "POST",
        `/api/v1/transformations/${world.tid}/kpi-definitions/${world.kpis.review}/actuals`,
        {
          scopeKind: "transformation",
          scopeId: world.tid,
          reportingPeriodId: pid,
          action: "submit",
          value: "64.5",
          dataAsOf: "2043-04-30",
        },
      );
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      expect(await actualLines()).toContain(`${world.kpis.review}|${FORM_PERIOD}|64.5|accepted`);
    }
    expect(foreign).toEqual([]);
  });
}
