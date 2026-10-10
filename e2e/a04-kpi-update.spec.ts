// A04 / REQ-S07-017 (qa-verifier, T-DG4-QA-A): "a keyboard-only user completes an update in four steps; the
// confirmation lists affected dashboards and 'Finance review pending' where applicable".
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, API
// serving the built SPA; no worker, no mocks). Every fixture is created through the public API by the seeded synthetic
// dev users and fresh synthetic users: a transformation, a KPI owned by a KDS user (direct accept), an outcome KPI on it,
// a Finance-validated benefit formula and a benefit at Measure measured by the KPI (Finance validation required), an
// open reporting period for the current month and an evidence note. The KPI owner then signs in through the dev form
// and, with the KEYBOARD ONLY, completes the update in four steps. Asserted: <html lang/dir> of the project's language
// (chromium-en: English LTR, chromium-ar: Arabic RTL, from the user's stored preference), the four labelled steps, the
// confirmation listing the downstream dashboards (Executive Overview outcomes) and the benefit, "Finance review pending"
// in the page language, the submitted value stored once (API read), and axe with 0 serious or critical issues on the
// form and the confirmation. Screenshots go to QA_EVIDENCE_DIR (default test-results/qa-a04).
// All data is SYNTHETIC; the Finance formula and baseline validations are synthetic in-product approvals of test data.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";

type Playwright = PlaywrightWorkerArgs["playwright"];

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a04");
const DEV_ISSUER = "urn:mth:dev-local";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Lang = "en" | "ar";

/** The product's confirmation texts for Finance review (Arabic from the shipped catalogue; English is the row text). */
const AR_KPI = JSON.parse(readFileSync(path.join("apps", "web", "src", "i18n", "ar", "kpiP4.json"), "utf8")) as Body;
const FINANCE_PENDING: Record<Lang, string> = {
  en: "Finance review pending",
  ar: (AR_KPI.kpiP4 ?? AR_KPI).confirm.finance.pending as string,
};
/** The value field's label (English as rendered; Arabic from the shipped catalogue). */
const ACTUAL_LABEL: Record<Lang, string> = { en: "Actual", ar: (AR_KPI.kpiP4 ?? AR_KPI).field.actual as string };

interface Api {
  readonly ctx: APIRequestContext;
  readonly csrf: string;
  readonly userId: string;
}

async function session(playwright: Playwright, baseURL: string, username: string): Promise<Api> {
  const origin = new URL(baseURL).origin;
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev login ${username} (is the stack seeded with seed-dev?)`).toBe(204);
  const me = await (await ctx.get("/api/v1/me")).json();
  return { ctx, csrf: me.csrfToken, userId: me.user.id };
}

async function send(
  api: Api,
  method: "POST" | "PUT" | "PATCH",
  url: string,
  data: unknown,
  ifMatch?: number,
): Promise<Body> {
  const res = await api.ctx.fetch(url, {
    method,
    data,
    headers: { "x-csrf-token": api.csrf, ...(ifMatch !== undefined ? { "if-match": `"${ifMatch}"` } : {}) },
  });
  const text = await res.text();
  expect(res.status(), `${method} ${url}: ${text}`).toBeLessThan(300);
  return text ? JSON.parse(text) : null;
}

async function getJson(api: Api, url: string): Promise<Body> {
  const res = await api.ctx.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  return res.json();
}

const projectLang = (name: string): Lang => (name.endsWith("-ar") ? "ar" : "en");

let world: {
  tid: string;
  kpiId: string;
  benefitId: string;
  periodId: string;
  evidenceTitle: string;
  ownerSubject: string;
};
const opened: Api[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const lang = projectLang(info.project.name);
  const base = baseURL!;
  const stamp = `${lang}${randomBytes(3).toString("hex")}`;
  const admin = await session(playwright, base, "dev.admin");
  const office = await session(playwright, base, "dev.office");
  opened.push(admin, office);
  const me = await getJson(admin, "/api/v1/me");
  const orgId: string = me.organization.id;
  const units = await getJson(admin, `/api/v1/organizations/${orgId}/business-units`);
  const retail = (units.items as Body[]).find((u) => u.code === "SYN-RETAIL");
  expect(retail, "seeded business unit SYN-RETAIL").toBeDefined();

  const t = await send(office, "POST", "/api/v1/transformations", {
    businessUnitId: retail.id,
    name: `QA A04 synthetic transformation ${stamp}`,
    mode: "end_to_end",
  });
  const tid: string = t.id;
  const T = `/api/v1/transformations/${tid}`;

  // Synthetic users with transformation-scoped roles (granted by the synthetic access administrator).
  const user = async (role: string, label: string) => {
    const subject = `qa.a04.${label}.${stamp}`;
    const u = await send(admin, "POST", "/api/v1/users", {
      organizationId: orgId,
      displayName: `QA A04 synthetic ${label} ${stamp}`,
      email: `${subject}@example.invalid`,
      identity: { issuer: DEV_ISSUER, subject },
    });
    await send(admin, "POST", "/api/v1/role-assignments", {
      userId: u.id,
      roleCode: role,
      scope: { type: "transformation", id: tid },
      reason: "QA A04 synthetic fixture",
    });
    return { id: u.id as string, subject };
  };
  const owner = await user("KDS", "owner");
  const lead = await user("TL", "lead");
  const bo = await user("BO", "bo");
  const fin = await user("FIN", "fin");
  const [sOwner, sLead, sBo, sFin] = await Promise.all(
    [owner, lead, bo, fin].map((u) => session(playwright, base, u.subject)),
  );
  opened.push(sOwner!, sLead!, sBo!, sFin!);
  const ownerMe = await getJson(sOwner!, "/api/v1/me");
  await send(sOwner!, "PUT", "/api/v1/me/preferences", { preferredLocale: lang }, ownerMe.user.version);

  // The KPI (count of customers, monthly, direct accept), owned by the KDS user.
  const def = await send(sLead!, "POST", `${T}/kpi-definitions`, {
    name: `QA A04 eligible customers ${stamp}`,
    unitKind: "count",
    unitLabel: "customers",
    polarity: "higher_is_better",
    frequency: "monthly",
    ownerUserId: owner.id,
  });
  await send(sLead!, "POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, def.version);
  const ver = await send(sLead!, "POST", `${T}/kpi-definitions/${def.id}/versions`, {
    measureType: "higher_is_better",
    valueNature: "flow",
    aggregationRule: "sum",
    submissionRoute: "direct_accept",
  });
  await send(sLead!, "POST", `${T}/kpi-versions/${ver.id}/activate`, undefined, ver.version);
  // Linked dashboards: an outcome measured by the KPI.
  const outcome = await send(sLead!, "POST", `${T}/outcomes`, { statement: `QA A04 synthetic outcome ${stamp}` });
  await send(sLead!, "POST", `${T}/outcome-kpis`, {
    outcomeId: outcome.id,
    kpiDefinitionId: def.id,
    targetValue: "120000",
    targetDate: "2027-12-31",
  });
  // A benefit measured by the KPI that needs Finance validation (B0087 revenue example; synthetic values).
  const formula = await send(sLead!, "POST", "/api/v1/benefit-formulas", {
    transformationId: tid,
    benefitName: `QA A04 attach uplift ${stamp}`,
    initialVersion: {
      expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
      variables: [
        { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" },
        { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
        { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
        { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
      ],
    },
  });
  await send(
    sFin!,
    "POST",
    `/api/v1/benefit-formulas/${formula.id}/versions/1/validation`,
    { result: "validated", note: "QA A04 synthetic Finance check of the formula logic" },
    formula.currentVersion.version,
  );
  let ben = await send(sBo!, "POST", `${T}/benefits`, {
    title: `QA A04 synthetic attach benefit ${stamp}`,
    description: "Synthetic benefit measured by the KPI.",
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    ownerUserId: bo.id,
    currency: "SAR",
    financialStatementLine: "Revenue - prepaid",
    baselineValue: "1000000",
    baselineUnit: "SAR",
    targetValue: "1200000",
    benefitFormulaId: formula.id,
    measurementKpiDefinitionId: def.id,
    measurementKpiVariable: "eligible_customers",
  });
  const ini = await send(sLead!, "POST", "/api/v1/initiatives", {
    transformationId: tid,
    name: `QA A04 synthetic enabling initiative ${stamp}`,
  });
  for (const toStep of ["plan", "enable", "measure"]) {
    if (toStep === "measure") await send(sBo!, "POST", `${T}/benefits/${ben.id}/enablers`, { initiativeId: ini.id });
    ben = await send(sBo!, "POST", `${T}/benefits/${ben.id}/lifecycle`, { toStep }, ben.version);
  }
  await send(sFin!, "POST", `${T}/benefits/${ben.id}/baseline-validation`, { decision: "validated" }, ben.version);

  // The current month's reporting period (created once per stack; the second project reuses it).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const [y, m] = today.split("-").map(Number) as [number, number];
  const label = `${y}-${String(m).padStart(2, "0")}`;
  const end = `${label}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  const existing = ((await getJson(office, P)).items as Body[]).find(
    (p) => p.periodLabel === label && p.frequency === "monthly",
  );
  let period = existing;
  if (!period)
    period = await send(office, "POST", P, {
      frequency: "monthly",
      periodLabel: label,
      periodStart: `${label}-01`,
      periodEnd: end,
    });
  if (period.status !== "open")
    period = await send(office, "POST", `${P}/${period.id}/open`, undefined, period.version);

  const evidenceTitle = `QA A04 synthetic extract ${stamp}`;
  await send(sLead!, "POST", `${T}/evidence`, {
    kind: "note",
    title: evidenceTitle,
    noteBody: "Synthetic customer count extract",
    ownerUserId: lead.id,
  });
  world = { tid, kpiId: def.id, benefitId: ben.id, periodId: period.id, evidenceTitle, ownerSubject: owner.subject };
});

test.afterAll(async () => {
  for (const a of opened.splice(0)) await a.ctx.dispose();
});

async function shot(page: Page, lang: Lang, name: string, project: string) {
  const dir = path.join(EVIDENCE_DIR, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${project}--${name}.png`), fullPage: true });
}

async function axeSeriousOrCritical(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("REQ-S07-017: the KPI owner updates the KPI in four keyboard-only steps; the confirmation lists the dashboards and 'Finance review pending'", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const project = info.project.name;
  const lang = projectLang(project);
  // Sign in through the development form as the KPI owner.
  await page.goto("/login");
  const form = page.locator("form.dev-login");
  await expect(form).toBeVisible();
  await form.locator("input").fill(world.ownerSubject);
  // Wait for the sign-in itself (the login page has a main landmark too, so a landmark proves nothing).
  const signedIn = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/dev-login") && r.status() === 204);
  await form.locator('button[type="submit"]').click();
  await signedIn;
  await expect(page).not.toHaveURL(/\/login(\?|$)/);

  await page.goto(`/transformations/${world.tid}/kpis/${world.kpiId}/actuals`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const update = page.locator("form").filter({ has: page.locator("fieldset[data-step]") });
  // Exactly four labelled steps.
  await expect(update.locator("fieldset[data-step]")).toHaveCount(4);
  await expect(update.locator("fieldset[data-step] > legend")).toHaveCount(4);
  await shot(page, lang, "a04-01-update-form", project);
  expect(await axeSeriousOrCritical(page), "axe on the update form").toEqual([]);

  // Keyboard only: Tab between controls, ArrowDown in the period list, type the value, Space for evidence, Enter.
  const tabTo = async (target: Locator) => {
    for (let i = 0; i < 200; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    await expect(target).toBeFocused();
  };
  await page.locator("main h1").first().focus();
  // Step 1 is the KPI of the page. Step 2: the reporting period.
  const periodSelect = update.locator("fieldset[data-step='2'] select").first();
  await tabTo(periodSelect);
  for (let i = 0; i < 50 && (await periodSelect.inputValue()) !== world.periodId; i++)
    await page.keyboard.press("ArrowDown");
  await expect(periodSelect).toHaveValue(world.periodId);
  // Step 3: the value and the evidence.
  const value = update.getByLabel(new RegExp(`^${ACTUAL_LABEL[lang]}`)).first();
  await tabTo(value);
  await page.keyboard.type("100000");
  const evidence = update.getByLabel(world.evidenceTitle);
  await tabTo(evidence);
  await page.keyboard.press("Space");
  await expect(evidence).toBeChecked();
  // Step 4: submit.
  await tabTo(update.locator("[data-action='submit-actual']"));
  await page.keyboard.press("Enter");

  const confirmation = page.locator("[data-state='kpi-update-confirmation']");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toHaveAttribute("data-finance-review", "pending");
  await expect(confirmation).toContainText(FINANCE_PENDING[lang]);
  // The affected dashboards and the benefit are listed.
  await expect(
    confirmation.locator("[data-downstream-kind='executive_overview_outcomes'], [data-downstream-kind='dashboard']"),
  ).not.toHaveCount(0);
  await expect(confirmation.locator("[data-downstream-kind='benefit']")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await shot(page, lang, "a04-02-confirmation", project);
  expect(await axeSeriousOrCritical(page), "axe on the confirmation").toEqual([]);

  // The value is stored once, accepted (direct accept), for the chosen period.
  const auditor = await session(playwright, baseURL!, "dev.auditor");
  try {
    const list = await getJson(auditor, `/api/v1/transformations/${world.tid}/kpi-definitions/${world.kpiId}/actuals`);
    const slots = (list.items as Body[]).filter((a) => a.reportingPeriodId === world.periodId);
    expect(slots.map((a) => [a.status, a.values.length, a.values[0].value])).toEqual([["accepted", 1, "100000"]]);
  } finally {
    await auditor.ctx.dispose();
  }
});
