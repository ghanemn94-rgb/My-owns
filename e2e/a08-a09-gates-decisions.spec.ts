// A08 "Gate controls" and A09 "Decision escalation", acceptance-level UI checks on the REAL stack (qa-verifier,
// T-DG4-QA-B; apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, API serving the built SPA;
// no worker, no mocks). Run in chromium-en (English, LTR) and chromium-ar (Arabic, RTL).
//  1. A08, REQ-S04-012 / REQ-PB-015: the gate page lists every missing mandatory item (each criterion row is marked
//     incomplete with its missing reasons), the submit control is blocked, and the API refuses the same submission with
//     422 listing exactly the criteria the page shows as missing.
//  2. A09, REQ-PB-081 / REQ-S10-012: the T16 Executive Decision Log page shows the nine T16 columns in the page's language
//     and the executive ask raised through the API, with its why-now and impact-of-delay texts.
// Each screen: <html lang dir> of the user's stored language, and axe with 0 serious or critical violations.
// Every fixture is created through the public API by the seeded synthetic dev users and fresh synthetic users.
// Screenshots go to QA_EVIDENCE_DIR (default test-results/qa-b). All data is SYNTHETIC; nothing here approves anything,
// and product gates G1-G6 never imply any engineering gate DG0-DG7.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { tr } from "../apps/web/e2e/support/ui.ts";

type Playwright = PlaywrightWorkerArgs["playwright"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Lang = "en" | "ar";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-b");
const DEV_ISSUER = "urn:mth:dev-local";

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

async function raw(api: Api, method: "POST" | "PUT" | "PATCH", url: string, data: unknown, ifMatch?: number) {
  const res = await api.ctx.fetch(url, {
    method,
    data,
    headers: { "x-csrf-token": api.csrf, ...(ifMatch !== undefined ? { "if-match": `"${ifMatch}"` } : {}) },
  });
  const text = await res.text();
  return { status: res.status(), body: (text ? JSON.parse(text) : null) as Body };
}
async function send(api: Api, method: "POST" | "PUT" | "PATCH", url: string, data: unknown, ifMatch?: number) {
  const r = await raw(api, method, url, data, ifMatch);
  expect(r.status, `${method} ${url}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body;
}
async function getJson(api: Api, url: string): Promise<Body> {
  const res = await api.ctx.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  return res.json();
}

const projectLang = (name: string): Lang => (name.endsWith("-ar") ? "ar" : "en");

let world: { tid: string; leadSubject: string; askTitle: string; askWhyNow: string; askImpact: string };
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
    name: `QA B A08 A09 synthetic transformation ${stamp}`,
    mode: "end_to_end",
  });
  const tid: string = t.id;
  const T = `/api/v1/transformations/${tid}`;
  const user = async (role: string, label: string) => {
    const subject = `qa.b.${label}.${stamp}`;
    const u = await send(admin, "POST", "/api/v1/users", {
      organizationId: orgId,
      displayName: `QA B synthetic ${label} ${stamp}`,
      email: `${subject}@example.invalid`,
      identity: { issuer: DEV_ISSUER, subject },
    });
    await send(admin, "POST", "/api/v1/role-assignments", {
      userId: u.id,
      roleCode: role,
      scope: { type: "transformation", id: tid },
      reason: "QA B synthetic fixture (approves nothing real)",
    });
    return { id: u.id as string, subject };
  };
  const lead = await user("TL", "lead");
  const sp = await user("SP", "sp");
  const sLead = await session(playwright, base, lead.subject);
  opened.push(sLead);
  const leadMe = await getJson(sLead, "/api/v1/me");
  await send(sLead, "PUT", "/api/v1/me/preferences", { preferredLocale: lang }, leadMe.user.version);
  // A T16 executive ask with all seven elements (owner: the Sponsor, an executive).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const required = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const askTitle = `QA B synthetic: approve the vendor switch ${stamp}`;
  const askWhyNow = `QA B synthetic: the renewal window closes ${stamp}`;
  const askImpact = `QA B synthetic: one more quarter on current terms ${stamp}`;
  await send(sLead, "POST", `${T}/executive-decisions`, {
    title: askTitle,
    whyNow: askWhyNow,
    options: [{ title: "Switch vendor" }, { title: "Renew the contract" }],
    recommendation: "A",
    impactOfDelay: askImpact,
    ownerUserId: sp.id,
    requiredDate: required,
  });
  world = { tid, leadSubject: lead.subject, askTitle, askWhyNow, askImpact };
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

async function signInAs(page: Page, subject: string) {
  await page.goto("/login");
  const form = page.locator("form.dev-login");
  await expect(form).toBeVisible();
  await form.locator("input").fill(subject);
  const signedIn = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/dev-login") && r.status() === 204);
  await form.locator('button[type="submit"]').click();
  await signedIn;
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

async function expectLanguage(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

test("A08 REQ-S04-012, REQ-PB-015: the gate page lists every missing mandatory item and blocks submission; the API refuses it with 422 listing the same items", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const project = info.project.name;
  const lang = projectLang(project);
  const lead = await session(playwright, baseURL!, world.leadSubject);
  opened.push(lead);
  const view = await getJson(lead, `/api/v1/transformations/${world.tid}/gates/G1`);
  const missing = (view.criteria as Body[]).filter((c) => c.mandatory && c.completeness !== "complete");
  expect(missing.length).toBeGreaterThan(0);

  await signInAs(page, world.leadSubject);
  await page.goto(`/transformations/${world.tid}/gates/G1`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectLanguage(page, lang);
  for (const c of missing) {
    const row = page.locator(`[data-criterion='${c.key}']`);
    await expect(row, `criterion row ${c.key}`).toBeVisible();
    await expect(row).toHaveAttribute("data-completeness", "incomplete");
    await expect(row.locator("[data-missing]").first()).toBeVisible();
    // The criterion is named in the page's language (labels from the API, en or ar).
    await expect(row).toContainText(lang === "ar" ? c.labelAr : c.labelEn);
  }
  await expect(page.locator("[data-submit-blocked='true']")).toBeDisabled();
  await shot(page, lang, "a08-01-g1-missing-items", project);
  expect(await axeSeriousOrCritical(page), "axe on the gate page").toEqual([]);

  // The API refuses the submission and lists exactly the criteria the page shows as missing.
  const res = await raw(
    lead,
    "POST",
    `/api/v1/transformations/${world.tid}/gates/G1/submissions`,
    {
      submissionNote: "QA B synthetic attempt with missing evidence",
    },
    view.gate.version,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect(res.body.code).toBe("gate_criteria_incomplete");
  expect((res.body.errors as Body[]).map((e) => e.pointer).sort()).toEqual(
    missing.map((c) => `/criteria/${c.key}`).sort(),
  );
  const after = await getJson(lead, `/api/v1/transformations/${world.tid}/gates/G1`);
  expect([after.gate.status, after.gate.latestSubmissionNo]).toEqual(["draft", 0]);
});

test("A09 REQ-PB-081, REQ-S10-012: the T16 log shows the nine columns in the page language and the ask with its why-now and impact of delay", async ({
  page,
}, info) => {
  const project = info.project.name;
  const lang = projectLang(project);
  await signInAs(page, world.leadSubject);
  await page.goto(`/transformations/${world.tid}/executive-decisions`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectLanguage(page, lang);
  const table = page.getByRole("table", { name: tr(lang, "governanceP4.decisions.tableTitle") });
  await expect(table).toBeVisible();
  for (const col of [
    "id",
    "decision",
    "whyNow",
    "options",
    "recommendation",
    "owner",
    "decisionDate",
    "impactOfDelay",
    "outcome",
  ])
    await expect(table.locator("thead")).toContainText(tr(lang, `governanceP4.decisions.col.${col}`));
  const row = table.locator("tbody tr", { hasText: world.askTitle });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(world.askWhyNow);
  await expect(row).toContainText(world.askImpact);
  await expect(row).toContainText(/DEC-\d{2,}/);
  await shot(page, lang, "a09-01-t16-log", project);
  expect(await axeSeriousOrCritical(page), "axe on the T16 log").toEqual([]);
});
