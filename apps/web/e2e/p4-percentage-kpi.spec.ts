// F-DG4-125 (T-DG4-FE-R6; D-122) on the REAL stack (support/with-stack.sh; no mocks, no interception): a percentage KPI
// is stored as a fraction (ADR-0028 §3: 0.12 = 12 %) and must read "12 %" on the T10 People & adoption area, its
// drill-down and the adoption dashboard, in English and Arabic, never "0.12 %".
// The dev seed has no percentage KPI, so this spec creates two through the API, as the round-3 domain reviewer's R3-7
// did in-process: unitKind `percentage` without a unit label (the API sends `unit: "percentage"`) and with the label
// "%" (`unit: "%"`; kpi/dashboard-facts.ts `unit_label ?? unit_kind`). Each is a weighted ratio with an accepted actual
// 12 / 100, and feeds a percentage adoption indicator of the transformation (createAdoptionMetricLink; the
// `usage_activation_rate` and `new_journey_share` templates, B0109 and B0114). with-stack.sh starts no worker, so the
// real worker runs for the calculation step only and is stopped (the p4-benefits.spec.ts precedent).
// Why not the Outcomes area (R3-7's surface): it lists only `active` outcomes (kpi/dashboard-facts.ts loadOutcomeRows),
// and no API operation makes an outcome active (created `draft`; R3-7 inserted an active outcome in the database).
// That is reported in the T-DG4-FE-R6 handback; the Outcomes area renders through the same formatter (unit tests).
// The KPIs report QUARTERLY: no other spec creates a quarterly period, so the KPI's current period (the latest
// open quarterly period of the organization, ADR-0028 §6) is this spec's own, and no other spec's period changes.
// SYNTHETIC data; no product gate (G1-G6) is decided, and none implies an engineering gate (DG0-DG7).
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, type ApiSession } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const stamp = Date.now().toString(36);

let tid = "";
let T = "";
let lead: ApiSession;
let owner: SyntheticUser;
let ownerApi: ApiSession;
/** The two KPIs: the KPI, its adoption metric link, the unit the API sends, its actual. */
const kpis: { id: string; linkId: string; unit: string; actualId: string }[] = [];

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 percentage KPI ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  owner = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.p4pct.kds.${lang}.${stamp}`,
    `Synthetic KPI owner ${lang}`,
    "KDS",
    lang,
  );
  ownerApi = await apiSession(playwright, owner.username);
  // One open quarterly period of the organization, far in the future (the next free quarter).
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  let periodId = "";
  let periodEnd = "";
  for (let i = 0; i < 40 && !periodId; i++) {
    const y = 2090 + Math.floor(i / 4);
    const q = i % 4;
    const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    const endMonth = q * 3 + 3;
    const end = `${y}-${String(endMonth).padStart(2, "0")}-${new Date(Date.UTC(y, endMonth, 0)).getUTCDate()}`;
    try {
      const p = await office.call<{ id: string; version: number }>(
        "POST",
        P,
        { frequency: "quarterly", periodLabel: `${y}-Q${q + 1}`, periodStart: start, periodEnd: end },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      periodId = p.id;
      periodEnd = end;
    } catch {
      // that quarter exists already (the other language's run): try the next one
    }
  }
  expect(periodId, "an open quarterly period").not.toBe("");
  const TEMPLATES = { percentage: "usage_activation_rate", "%": "new_journey_share" } as const;
  for (const unitLabel of [null, "%"] as const) {
    const def = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
      name: `Synthetic adoption rate ${unitLabel ?? "percentage"} ${lang} ${stamp}`,
      unitKind: "percentage",
      ...(unitLabel ? { unitLabel } : {}),
      polarity: "higher_is_better",
      frequency: "quarterly",
      ownerUserId: owner.id,
    });
    await lead.call("POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, { ifMatch: def.version });
    const v = await ownerApi.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions/${def.id}/versions`, {
      measureType: "higher_is_better",
      valueNature: "ratio",
      aggregationRule: "weighted_ratio",
      submissionRoute: "direct_accept",
      numeratorLabel: "Synthetic active users",
      denominatorLabel: "Synthetic users",
    });
    await ownerApi.call("POST", `${T}/kpi-versions/${v.id}/activate`, undefined, { ifMatch: v.version });
    const link = await lead.call<{ id: string }>("POST", `${T}/adoption-metric-links`, {
      templateKey: TEMPLATES[unitLabel ?? "percentage"],
      targetKind: "transformation",
      kpiDefinitionId: def.id,
    });
    const submitted = await ownerApi.call<{ actual: { id: string; status: string } }>(
      "POST",
      `${T}/kpi-definitions/${def.id}/actuals`,
      {
        scopeKind: "transformation",
        scopeId: tid,
        action: "submit",
        dataAsOf: periodEnd,
        reportingPeriodId: periodId,
        numerator: "12",
        denominator: "100",
      },
    );
    expect(submitted.actual.status).toBe("accepted");
    kpis.push({ id: def.id, linkId: link.id, unit: unitLabel ?? "percentage", actualId: submitted.actual.id });
  }
});

test("1. the real worker calculates both KPIs: the API sends {value: '0.12', unit: 'percentage' | '%'}", async () => {
  // The e2e stack runs no worker: start the real one for this step, against the same database, then stop it.
  const worker: ChildProcess = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let workerLog = "";
  worker.stdout?.on("data", (b: Buffer) => (workerLog += b.toString()));
  worker.stderr?.on("data", (b: Buffer) => (workerLog += b.toString()));
  try {
    for (const k of kpis)
      await expect
        .poll(
          async () => (await lead.call<{ actual: string | null }>("GET", `${T}/kpi-definitions/${k.id}/status`)).actual,
          {
            timeout: 20_000,
            intervals: [500],
          },
        )
        .toBe("0.12");
  } catch (e) {
    console.log(`worker log:\n${workerLog}`);
    throw e;
  } finally {
    worker.kill("SIGTERM");
    await new Promise((r) => (worker.exitCode !== null ? r(null) : worker.once("exit", r)));
  }
  // The T10 response carries the API's own value objects (R3-7): a fraction with the KPI's unit.
  const dash = await lead.call<{
    areas: {
      code: string;
      items: { recordId: string; value: { state: string; value: string; unit: string } | null }[];
    }[];
  }>("GET", `${T}/dashboard`);
  const people = dash.areas.find((a) => a.code === "people_adoption")!;
  for (const k of kpis) {
    const item = people.items.find((i) => i.recordId === k.linkId);
    expect(item, `adoption indicator ${k.unit} in ${JSON.stringify(people.items)}`).toBeDefined();
    expect(item!.value).toMatchObject({ state: "value", value: "0.12", unit: k.unit });
  }
});

test("2. F-DG4-125: T10 People & adoption, its drill-down and the adoption dashboard read 12 %, never 0.12 %", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  await go(page, `/transformations/${tid}/dashboard`);
  const area = page.locator("section[data-area='people_adoption']");
  for (const k of kpis) {
    const value = area.locator(`tr[data-item='${k.linkId}'] [data-value='0.12']`);
    await expect(value, `adoption indicator ${k.unit}`).toBeVisible();
    await expect(value.locator(".amount")).toHaveText("12 %");
  }
  await expect(area).not.toContainText("0.12");
  await shot(page, lang, "p4-pct-kpi-t10-people-adoption");
  await expectAccessible(page, lang, "p4-pct-kpi-t10-people-adoption");
  // The area's drill-down lists the indicators, each 12 %.
  await area.locator("[data-drill]").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-drill-items]")).toBeVisible();
  const drillValues = dialog.locator("[data-drill-items] [data-value='0.12']");
  await expect(drillValues).toHaveCount(kpis.length);
  for (const v of await drillValues.all()) await expect(v.locator(".amount")).toHaveText("12 %");
  await expect(dialog).not.toContainText("0.12");
  await shot(page, lang, "p4-pct-kpi-t10-drilldown");
  await expectAccessible(page, lang, "p4-pct-kpi-t10-drilldown");
  // The adoption dashboard, filtered to the transformation: each indicator row reads 12 %.
  await go(page, `/dashboards/adoption?tr=${tid}`);
  const rows = page.locator("[data-register='dashboard-adoption-indicators'] [data-value='0.12']");
  await expect(rows).toHaveCount(kpis.length);
  for (const v of await rows.all()) await expect(v.locator(".amount")).toHaveText("12 %");
  await expect(page.locator("[data-register='dashboard-adoption-indicators']")).not.toContainText("0.12");
  await shot(page, lang, "p4-pct-kpi-adoption-dashboard");
  await expectAccessible(page, lang, "p4-pct-kpi-adoption-dashboard");
  await s.close();
});
