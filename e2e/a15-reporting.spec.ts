// A15 "Reporting" (qa-verifier, T-DG5-QA-C): the user-visible path of "Executive pack and relevant PDF/DOCX/XLSX/PPTX
// outputs contain current selected data, correct provenance and readable Arabic/English layout" (REQ-S20-015,
// REQ-S13-004, REQ-S13-005, REQ-S13-009).
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, API serving
// the built SPA; no worker, D-162 d, so an export stays queued here; the rendered files are proven by the integration
// suites tests/qa/integration/a15-*.test.ts through the worker's runner). Fixtures through the public API by the seeded
// synthetic dev users: a transformation, a synthetic Transformation Lead (preferred locale = the project's language), a
// RAID risk and a RAID issue. The lead then, in the browser: opens the transformation's Reports page, chooses the
// Registers output (its label in the page language), the RAID register filtered to risks, previews it live, generates
// the snapshot and starts an XLSX export in the page language. Asserted: <html lang/dir> (en LTR, ar RTL), the twelve
// outputs offered by their labels in the page language, the live preview and the snapshot contain the risk and NOT the
// issue (current selected data), the snapshot shows the transformation's ID and the draft marking in the page language,
// the export job is recorded for exactly that snapshot, format and language, and axe reports 0 serious or critical
// issues on the reports page and on the snapshot page. Screenshots go to QA_EVIDENCE_DIR (default test-results/qa-a15).
// All data is SYNTHETIC; generating a report approves nothing.
/// <reference lib="dom" />
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

type Playwright = PlaywrightWorkerArgs["playwright"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Lang = "en" | "ar";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a15");
const DEV_ISSUER = "urn:mth:dev-local";
/** The product's shipped UI catalogues (the texts a user reads); nothing here is invented by the test. */
const catalogue = (lang: Lang): Body => {
  const raw = JSON.parse(readFileSync(path.join("apps", "web", "src", "i18n", lang, "reportsP5.json"), "utf8"));
  return raw.reportsP5 ?? raw;
};
const UI = { en: catalogue("en"), ar: catalogue("ar") };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Api {
  readonly ctx: APIRequestContext;
  readonly csrf: string;
}

async function session(playwright: Playwright, baseURL: string, username: string): Promise<Api> {
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: new URL(baseURL).origin } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev login ${username} (is the stack seeded with seed-dev?)`).toBe(204);
  const me = await (await ctx.get("/api/v1/me")).json();
  return { ctx, csrf: me.csrfToken };
}

async function send(api: Api, method: "POST" | "PUT", url: string, data: unknown, ifMatch?: number): Promise<Body> {
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

async function shot(page: Page, name: string, project: string) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${project}--${name}.png`), fullPage: true });
}

async function axeSeriousOrCritical(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

let world: { tid: string; code: string; leadSubject: string; risk: string; issue: string; definitions: Body[] };
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
    name: `QA A15 synthetic transformation ${stamp}`,
    mode: "end_to_end",
  });
  const leadSubject = `qa.a15.lead.${stamp}`;
  const lead = await send(admin, "POST", "/api/v1/users", {
    organizationId: orgId,
    displayName: `QA A15 synthetic lead ${stamp}`,
    email: `${leadSubject}@example.invalid`,
    identity: { issuer: DEV_ISSUER, subject: leadSubject },
  });
  await send(admin, "POST", "/api/v1/role-assignments", {
    userId: lead.id,
    roleCode: "TL",
    scope: { type: "transformation", id: t.id },
    reason: "QA A15 synthetic fixture",
  });
  const sLead = await session(playwright, base, leadSubject);
  opened.push(sLead);
  const leadMe = await getJson(sLead, "/api/v1/me");
  await send(sLead, "PUT", "/api/v1/me/preferences", { preferredLocale: lang }, leadMe.user.version);
  const risk = `QA A15 synthetic risk: partner settlement delay ${stamp}`;
  const issue = `QA A15 synthetic issue: not in the risk register ${stamp}`;
  const T = `/api/v1/transformations/${t.id}`;
  await send(sLead, "POST", `${T}/raid`, {
    type: "risk",
    description: risk,
    impact: "high",
    probability: "medium",
    ownerUserId: lead.id,
  });
  await send(sLead, "POST", `${T}/raid`, { type: "issue", description: issue, impact: "low", ownerUserId: lead.id });
  const definitions = (await getJson(sLead, "/api/v1/report-definitions")).items as Body[];
  world = { tid: t.id, code: t.code, leadSubject, risk, issue, definitions };
});

test.afterAll(async () => {
  for (const a of opened) await a.ctx.dispose();
});

test("A15: the lead generates the risk-filtered RAID register in the page language; the snapshot holds exactly the selected records; the export is recorded", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const project = info.project.name;
  const lang = projectLang(project);
  const ui = UI[lang];

  await page.goto("/login");
  const form = page.locator("form.dev-login");
  await expect(form).toBeVisible();
  await form.locator("input").fill(world.leadSubject);
  const signedIn = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/dev-login") && r.status() === 204);
  await form.locator('button[type="submit"]').click();
  await signedIn;
  await expect(page).not.toHaveURL(/\/login(\?|$)/);

  await page.goto(`/transformations/${world.tid}/reports`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.getByRole("heading", { level: 1, name: ui.reports.title })).toBeVisible();

  // The twelve outputs are offered by their labels in the page language (never the other language's).
  // The "Generate a report" section (the snapshot list below has its own "Output" filter).
  const gen = page.locator("section").filter({ has: page.getByRole("heading", { name: ui.generate.title }) });
  const output = gen.getByLabel(new RegExp(`^${esc(ui.generate.output)}`));
  await expect(output).toBeVisible();
  const offered = (await output.locator("option").allTextContents()).map((s) => s.trim());
  expect(world.definitions).toHaveLength(12);
  for (const d of world.definitions) {
    expect(offered).toContain(lang === "ar" ? d.labelAr : d.labelEn);
    expect(offered).not.toContain(lang === "ar" ? d.labelEn : d.labelAr);
  }
  const registers = world.definitions.find((d) => d.code === "registers");
  await output.selectOption({ label: lang === "ar" ? registers.labelAr : registers.labelEn });
  await gen.getByLabel(new RegExp(`^${esc(ui.generate.register)}`)).selectOption("raid");
  await gen.getByLabel(new RegExp(`^${esc(ui.generate.raidType)}`)).selectOption("risk");
  await gen.getByRole("button", { name: ui.generate.preview }).click();
  await expect(page.getByText(world.risk)).toBeVisible();
  await expect(page.getByText(world.issue)).toHaveCount(0);
  await shot(page, "a15-01-reports-live-preview", project);
  expect(await axeSeriousOrCritical(page), "axe on the reports page").toEqual([]);

  // Generate the snapshot: it opens, holds the risk and not the issue, with the transformation's ID and draft marking.
  await gen.getByRole("button", { name: ui.generate.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/transformations/${world.tid}/reports/[0-9a-f-]{36}$`));
  const snapshotId = page.url().split("/").pop()!;
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.getByText(world.risk)).toBeVisible();
  await expect(page.getByText(world.issue)).toHaveCount(0);
  await expect(page.getByText(world.code).first()).toBeVisible();
  await expect(page.getByText(ui.snapshot.draftBanner.split(".")[0]!).first()).toBeVisible();
  await shot(page, "a15-02-snapshot", project);
  expect(await axeSeriousOrCritical(page), "axe on the snapshot page").toEqual([]);

  // Export as XLSX in the page language: the job is recorded for this snapshot, format and language.
  await page.getByLabel(new RegExp(`^${esc(ui.exports.format)}`)).selectOption("xlsx");
  await page.getByLabel(new RegExp(`^${esc(ui.exports.language)}`)).selectOption(lang);
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/exports") && r.request().method() === "POST");
  await page.getByRole("button", { name: ui.exports.start }).click();
  const res = await created;
  expect(res.status(), await res.text()).toBe(202);
  const job = await res.json();
  expect(job).toMatchObject({ snapshotId, format: "xlsx", language: lang, status: "queued" });
  const mine = await (await page.request.get("/api/v1/exports")).json();
  expect((mine.items as Body[]).filter((j) => j.id === job.id)).toHaveLength(1);
  await shot(page, "a15-03-export-queued", project);
});
