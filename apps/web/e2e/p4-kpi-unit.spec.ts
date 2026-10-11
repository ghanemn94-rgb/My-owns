// D-124 items 1–3 (T-DG4-FE-R7; ADR-0037 amendment N5) on the REAL stack (support/with-stack.sh; no mocks, no
// interception). A KPI-derived dashboard value carries `kpiUnit = {kind, label}`, and the web formats it from the KIND,
// exactly as the KPI pages do:
//  - a `percentage` KPI labelled '% of users' with the actual 0.12 reads '12 % of users' (never '0.12 % of users');
//  - a `ratio` KPI with the actual 1.5 reads '1.5' (never '150 %', the format of the computed value gap).
// Both KPIs are created through the API (ARCH-R7 §4.3 fixtures F2 and F3), each with an accepted actual for this
// spec's own quarterly period (the p4-percentage-kpi.spec.ts pattern), and both are linked to an OUTCOME created
// through the API, so they appear in the T10 Outcomes area (D-124 item 1: the dashboards read non-archived outcomes).
// The labelled percentage KPI is also an adoption indicator of the transformation (People & adoption, the adoption
// dashboard). An adoption template's unit kind is `percentage` or `duration` (migration 0047, indicators.ts
// KPI_MISMATCH), so the ratio KPI is shown in the Outcomes area only.
// Merge dependency: the `kpiUnit` member (test 1) and the Outcomes area (test 3) come from T-DG4-KBE-R8's API. On the
// FE-R7 branch alone those assertions fail by design; they are not skipped (assignment T-DG4-FE-R7 item 3).
// with-stack.sh starts no worker, so the real worker runs for the calculation step only and is stopped.
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

/** The two KPIs of ARCH-R7 §4.3: F2 (a labelled percentage) and F3 (a ratio). */
interface Kpi {
  readonly key: "f2" | "f3";
  readonly unitKind: "percentage" | "ratio";
  readonly unitLabel: string | null;
  readonly numerator: string;
  readonly denominator: string;
  readonly actual: string;
  /** The rendered text, EN and AR alike (Latin digits, the same '%' position: ADR-0037 N5 examples). */
  readonly text: string;
  id: string;
  outcomeKpiId: string;
}
const KPIS: Kpi[] = [
  {
    key: "f2",
    unitKind: "percentage",
    unitLabel: "% of users",
    numerator: "12",
    denominator: "100",
    actual: "0.12",
    text: "12 % of users",
    id: "",
    outcomeKpiId: "",
  },
  {
    key: "f3",
    unitKind: "ratio",
    unitLabel: null,
    numerator: "3",
    denominator: "2",
    actual: "1.5",
    text: "1.5",
    id: "",
    outcomeKpiId: "",
  },
];
const f2 = KPIS[0]!;
const f3 = KPIS[1]!;

let tid = "";
let T = "";
let f2LinkId = "";
let lead: ApiSession;
let owner: SyntheticUser;
let ownerApi: ApiSession;

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
      name: `Synthetic P4 KPI unit ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  owner = await syntheticUser(
    admin,
    orgId,
    tid,
    `dev.p4unit.kds.${lang}.${stamp}`,
    `Synthetic KPI unit owner ${lang}`,
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
      // that quarter exists already (another spec's or the other language's run): try the next one
    }
  }
  expect(periodId, "an open quarterly period").not.toBe("");
  // One outcome, created through the API (no status transition, no database insert: D-124 item 1).
  const outcome = await lead.call<{ id: string }>("POST", `${T}/outcomes`, {
    statement: `Synthetic: more users adopt the new journey (${lang} ${stamp}).`,
  });
  for (const k of KPIS) {
    const def = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
      name: `Synthetic ${k.unitKind} KPI ${k.key} ${lang} ${stamp}`,
      unitKind: k.unitKind,
      ...(k.unitLabel ? { unitLabel: k.unitLabel } : {}),
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
      numeratorLabel: "Synthetic numerator",
      denominatorLabel: "Synthetic denominator",
    });
    await ownerApi.call("POST", `${T}/kpi-versions/${v.id}/activate`, undefined, { ifMatch: v.version });
    k.outcomeKpiId = (
      await lead.call<{ id: string }>("POST", `${T}/outcome-kpis`, {
        outcomeId: outcome.id,
        kpiDefinitionId: def.id,
        targetDate: "2099-12-31",
      })
    ).id;
    if (k.unitKind === "percentage")
      f2LinkId = (
        await lead.call<{ id: string }>("POST", `${T}/adoption-metric-links`, {
          templateKey: "usage_activation_rate",
          targetKind: "transformation",
          kpiDefinitionId: def.id,
        })
      ).id;
    const submitted = await ownerApi.call<{ actual: { status: string } }>(
      "POST",
      `${T}/kpi-definitions/${def.id}/actuals`,
      {
        scopeKind: "transformation",
        scopeId: tid,
        action: "submit",
        dataAsOf: periodEnd,
        reportingPeriodId: periodId,
        numerator: k.numerator,
        denominator: k.denominator,
      },
    );
    expect(submitted.actual.status).toBe("accepted");
    k.id = def.id;
  }
});

interface ApiValue {
  state: string;
  value: string | null;
  unit: string | null;
  kpiUnit?: { kind: string; label: string | null } | null;
}
interface ApiArea {
  code: string;
  items: { recordId: string; recordType: string; value: ApiValue | null }[];
  headlines: { metric: string; value: ApiValue }[];
}

test("1. the worker calculates both KPIs; People & adoption carries the KPI's kpiUnit (KBE-R8)", async () => {
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
    for (const k of KPIS)
      await expect
        .poll(
          async () => (await lead.call<{ actual: string | null }>("GET", `${T}/kpi-definitions/${k.id}/status`)).actual,
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(k.actual);
  } catch (e) {
    console.log(`worker log:\n${workerLog}`);
    throw e;
  } finally {
    worker.kill("SIGTERM");
    await new Promise((r) => (worker.exitCode !== null ? r(null) : worker.once("exit", r)));
  }
  const dash = await lead.call<{ areas: ApiArea[] }>("GET", `${T}/dashboard`);
  const people = dash.areas.find((a) => a.code === "people_adoption")!;
  // People & adoption: the labelled percentage KPI, with its kind apart from its label (ADR-0037 N5 item 1).
  expect(people.items.find((i) => i.recordId === f2LinkId)?.value).toMatchObject({
    state: "value",
    value: "0.12",
    kpiUnit: { kind: "percentage", label: "% of users" },
  });
});

test("2. People & adoption, its drill-down and the adoption dashboard read '12 % of users', never '0.12'", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  await go(page, `/transformations/${tid}/dashboard`);
  const area = page.locator("section[data-area='people_adoption']");
  const value = area.locator(`tr[data-item='${f2LinkId}'] [data-value='0.12']`);
  await expect(value).toBeVisible();
  await expect(value.locator(".amount")).toHaveText(f2.text);
  // The number is an LTR isolate; number and label share one auto-direction isolate (the label decides it).
  await expect(value.locator(".amount bdi[data-value-text] > bdi[dir='ltr']")).toHaveText("12");
  await expect(value.locator(".amount bdi[data-value-text] > [data-unit-label]")).toHaveText("% of users");
  await expect(area).not.toContainText("0.12");
  await shot(page, lang, "p4-kpi-unit-t10-people-adoption");
  await expectAccessible(page, lang, "p4-kpi-unit-t10-people-adoption");
  await area.locator("[data-drill]").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-drill-items]")).toBeVisible();
  const drill = dialog.locator("[data-drill-items] [data-value='0.12']");
  await expect(drill).toHaveCount(1);
  await expect(drill.locator(".amount")).toHaveText(f2.text);
  await expect(dialog).not.toContainText("0.12");
  await shot(page, lang, "p4-kpi-unit-t10-people-drilldown");
  await expectAccessible(page, lang, "p4-kpi-unit-t10-people-drilldown");
  await page.keyboard.press("Escape");
  await go(page, `/dashboards/adoption?tr=${tid}`);
  const register = page.locator("[data-register='dashboard-adoption-indicators']");
  const row = register.locator("[data-value='0.12']");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".amount")).toHaveText(f2.text);
  await expect(register).not.toContainText("0.12");
  await shot(page, lang, "p4-kpi-unit-adoption-dashboard");
  await expectAccessible(page, lang, "p4-kpi-unit-adoption-dashboard");
  await s.close();
});

test("3. the T10 Outcomes area lists the outcome created through the API: '12 % of users' and '1.5', never '150 %'", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  // The API (D-124 item 1): an outcome created through the API is listed in the Outcomes area, with both KPIs.
  const dash = await lead.call<{ areas: ApiArea[] }>("GET", `${T}/dashboard`);
  const outcomes = dash.areas.find((a) => a.code === "outcomes")!;
  for (const k of KPIS)
    expect(
      outcomes.items.find((i) => i.recordId === k.outcomeKpiId)?.value,
      `outcome KPI ${k.key} in ${JSON.stringify(outcomes.items)}`,
    ).toMatchObject({ state: "value", value: k.actual, kpiUnit: { kind: k.unitKind, label: k.unitLabel } });
  const s = await asUser(browser, lang, "dev.lead");
  const page = s.page;
  await go(page, `/transformations/${tid}/dashboard`);
  const area = page.locator("section[data-area='outcomes']");
  for (const k of KPIS) {
    const value = area.locator(`tr[data-item='${k.outcomeKpiId}'] [data-value='${k.actual}']`);
    await expect(value, `outcome KPI ${k.key}`).toBeVisible();
    await expect(value.locator(".amount")).toHaveText(k.text);
  }
  await expect(area.locator(`tr[data-item='${f3.outcomeKpiId}']`)).not.toContainText("%");
  await expect(area).not.toContainText("150 %");
  await expect(area).not.toContainText("0.12");
  await shot(page, lang, "p4-kpi-unit-t10-outcomes");
  await expectAccessible(page, lang, "p4-kpi-unit-t10-outcomes");
  // The area's drill-down lists both outcome KPIs, each formatted by its kind.
  await area.locator("[data-drill]").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-drill-items]")).toBeVisible();
  for (const k of KPIS)
    await expect(dialog.locator(`[data-drill-items] [data-value='${k.actual}'] .amount`)).toHaveText(k.text);
  await expect(dialog).not.toContainText("150 %");
  await expect(dialog).not.toContainText("0.12");
  await shot(page, lang, "p4-kpi-unit-t10-outcomes-drilldown");
  await expectAccessible(page, lang, "p4-kpi-unit-t10-outcomes-drilldown");
  await s.close();
});
