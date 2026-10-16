// A16 "Health and launch" (qa-verifier, T-DG5-QA-D): the user-visible path of "All 25 questions and four source score
// bands work; incomplete assessments are labeled; launch tasks are generated from the chosen start date".
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, API serving
// the built SPA; no mocks). Fixtures are created through the public API by the seeded synthetic dev users and a fresh
// synthetic Transformation Lead whose stored language is the project's (chromium-en: English LTR, chromium-ar: Arabic
// RTL). Asserted in the browser:
//  - REQ-PB-091 / REQ-S14-002: the 25 questions render (English: verbatim from docs/source/playbook.md B0150; Arabic: the
//    contract's textAr); an assessment with 24 answers shows "Incomplete (24/25)" (Arabic: the shipped catalogue's
//    label with the same counts) and no band; the scoring method is shown as an implementation assumption (REQ-S14-001);
//  - REQ-S14-001 / REQ-PB-092: the Lead answers the 25th question with the keyboard-free form; 17 Yes -> score 17 and
//    the band '16-20' with the B0152 text (English verbatim; Arabic: the band's textAr);
//  - REQ-PB-086: the Lead generates the plan from the start date 2026-10-01 in the form; every Days 31-60 task row is
//    dated 2026-11-01..2026-11-30, every B0134 action appears (English verbatim), and the Day-90 test is due 2026-12-30;
//  - <html lang/dir> of the page language and axe with 0 serious or critical issues on both screens.
// Screenshots go to QA_EVIDENCE_DIR (default test-results/qa-a16).
// All data is SYNTHETIC; a score is an assessment of test data, not an approval of anything real.
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

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a16");
const DEV_ISSUER = "urn:mth:dev-local";
const START = "2026-10-01";

// ---------------------------------------------------------------- source texts (docs/source/playbook.md, read-only)
const PLAYBOOK = readFileSync(path.join("docs", "source", "playbook.md"), "utf8");
const slice = (a: string, b: string) => PLAYBOOK.slice(PLAYBOOK.indexOf(a), PLAYBOOK.indexOf(b, PLAYBOOK.indexOf(a)));
const B0150 = [...slice("<!-- B0150 table -->", "Interpretation <!-- B0151").matchAll(/☐ (\d+)\. ([^|]+?)\s*\|/g)]
  .map((m) => [Number(m[1]), m[2]!.trim()] as const)
  .sort((x, y) => x[0] - y[0])
  .map(([, t]) => t);
const B0152 = [...slice("<!-- B0152 table -->", "<!-- B0153").matchAll(/^\| (\d+-\d+) \| (.+?) \|$/gm)].map(
  (m) => [m[1]!, m[2]!] as const,
);
const B0134_ACTIONS = [
  ...slice("<!-- B0134 table -->", "Day-90 leadership test <!-- B0135").matchAll(
    /^\| (Days \d+-\d+) \| .+? \| (.+?) \| .+? \|$/gm,
  ),
].flatMap((m) =>
  m[2]!
    .replace(/\.\s*$/, "")
    .split(";")
    .map((s) => s.trim()),
);

/** The product's completion label (English is the row text "Incomplete (24/25)"; Arabic from the shipped catalogue). */
const AR = JSON.parse(
  readFileSync(path.join("apps", "web", "src", "i18n", "ar", "launchHealthP5.json"), "utf8"),
) as Body;
const incompleteLabel = (lang: Lang, answered: number, total: number) =>
  lang === "en"
    ? `Incomplete (${answered}/${total})`
    : ((AR.launchHealthP5 ?? AR).completion.incomplete as string)
        .replace("{{answered}}", String(answered))
        .replace("{{total}}", String(total));

// ---------------------------------------------------------------- API fixtures
interface Api {
  readonly ctx: APIRequestContext;
  readonly csrf: string;
}
async function apiSession(playwright: Playwright, baseURL: string, username: string): Promise<Api> {
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: new URL(baseURL).origin } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev login ${username} (is the stack seeded with seed-dev?)`).toBe(204);
  const me = await (await ctx.get("/api/v1/me")).json();
  return { ctx, csrf: me.csrfToken };
}
async function send(api: Api, method: string, url: string, data?: unknown, ifMatch?: number): Promise<Body> {
  const res = await api.ctx.fetch(url, {
    method,
    ...(data !== undefined ? { data } : {}),
    headers: { "x-csrf-token": api.csrf, ...(ifMatch !== undefined ? { "if-match": `"${ifMatch}"` } : {}) },
  });
  const text = await res.text();
  expect(res.status(), `${method} ${url}: ${text}`).toBeLessThan(300);
  return text ? JSON.parse(text) : null;
}
const getJson = async (api: Api, url: string): Promise<Body> => {
  const res = await api.ctx.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  return res.json();
};

const projectLang = (name: string): Lang => (name.endsWith("-ar") ? "ar" : "en");
let world: { tid: string; leadSubject: string; questionsAr: string[]; bandAr: string };
const opened: Api[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright, baseURL }, info) => {
  test.setTimeout(120_000);
  const lang = projectLang(info.project.name);
  const stamp = `${lang}${randomBytes(3).toString("hex")}`;
  const admin = await apiSession(playwright, baseURL!, "dev.admin");
  const office = await apiSession(playwright, baseURL!, "dev.office");
  opened.push(admin, office);
  const orgId: string = (await getJson(admin, "/api/v1/me")).organization.id;
  const units = await getJson(admin, `/api/v1/organizations/${orgId}/business-units`);
  const retail = (units.items as Body[]).find((u) => u.code === "SYN-RETAIL");
  expect(retail, "seeded business unit SYN-RETAIL").toBeDefined();
  const t = await send(office, "POST", "/api/v1/transformations", {
    businessUnitId: retail.id,
    name: `QA A16 synthetic transformation ${stamp}`,
    mode: "end_to_end",
  });
  const subject = `qa.a16.lead.${stamp}`;
  const u = await send(admin, "POST", "/api/v1/users", {
    organizationId: orgId,
    displayName: `QA A16 synthetic lead ${stamp}`,
    email: `${subject}@example.invalid`,
    identity: { issuer: DEV_ISSUER, subject },
  });
  await send(admin, "POST", "/api/v1/role-assignments", {
    userId: u.id,
    roleCode: "TL",
    scope: { type: "transformation", id: t.id },
    reason: "QA A16 synthetic fixture",
  });
  const lead = await apiSession(playwright, baseURL!, subject);
  opened.push(lead);
  const me = await getJson(lead, "/api/v1/me");
  await send(lead, "PUT", "/api/v1/me/preferences", { preferredLocale: lang }, me.user.version);
  // A health check with 24 answers, 16 of them Yes, and its three actions (q25 is answered in the browser).
  const HC = `/api/v1/transformations/${t.id}/health-checks`;
  let a = await send(lead, "POST", HC, { assessmentDate: "2026-10-05" });
  for (let i = 1; i <= 24; i++) {
    const code = `q${String(i).padStart(2, "0")}`;
    a = await send(lead, "PUT", `${HC}/${a.id}/answers/${code}`, { response: i <= 16 ? "yes" : "no" }, a.version);
  }
  a = await send(
    lead,
    "PUT",
    `${HC}/${a.id}/actions`,
    { actions: [1, 2, 3].map((rank) => ({ rank, actionText: `QA A16 synthetic action ${rank}` })) },
    a.version,
  );
  const questions = await getJson(lead, "/api/v1/health-check-questions");
  const schemes = await getJson(lead, "/api/v1/admin/health-check-schemes");
  const v1 = (schemes.items as Body[]).find((s) => s.key === "health-check" && s.versionNo === 1);
  world = {
    tid: t.id,
    leadSubject: subject,
    questionsAr: (questions.items as Body[]).sort((x, y) => x.ordinal - y.ordinal).map((q) => q.textAr),
    bandAr: (v1.bands as Body[]).find((b) => b.rangeLabel === "16-20").textAr,
  };
});

test.afterAll(async () => {
  for (const a of opened.splice(0)) await a.ctx.dispose();
});

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
async function expectLangDir(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

test("REQ-PB-091, REQ-S14-001, REQ-S14-002, REQ-PB-092: 25 questions verbatim; 'Incomplete (24/25)' with no band; the 25th answer gives 17 and '16-20'", async ({
  page,
}, info) => {
  const project = info.project.name;
  const lang = projectLang(project);
  await signInAs(page, world.leadSubject);
  await page.goto(`/transformations/${world.tid}/health-check`);
  await expectLangDir(page, lang);
  const facts = page.locator("[data-assessment-status='draft']");
  await expect(facts).toBeVisible();
  // 25 questions, each with its source text (English: the playbook, verbatim).
  const rows = page.locator("li[data-question]");
  await expect(rows).toHaveCount(25);
  const expected = lang === "en" ? B0150 : world.questionsAr;
  expect(expected).toHaveLength(25);
  for (let i = 0; i < 25; i++) {
    const code = `q${String(i + 1).padStart(2, "0")}`;
    await expect(page.locator(`li[data-question='${code}']`)).toContainText(expected[i]!);
  }
  // Incomplete (24/25), no score and no band; the scoring method is an implementation assumption.
  await expect(facts).toContainText(incompleteLabel(lang, 24, 25));
  await expect(facts.locator("[data-field='band'] [data-band='none']")).toBeVisible();
  await expect(facts.locator("[data-field='score'] [data-score='none']")).toBeVisible();
  await expect(facts.locator("[data-band]:not([data-band='none'])")).toHaveCount(0);
  await expect(page.locator("[data-state='scoring-assumption']")).toBeVisible();
  await shot(page, lang, "a16-01-health-incomplete", project);
  expect(await axeSeriousOrCritical(page), "axe on the incomplete health check").toEqual([]);

  // The Lead answers q25 Yes: 17 Yes in all.
  const q25 = page.locator("form[data-form='answer-q25']");
  await q25.locator("input[type='radio'][value='yes']").check();
  const saved = page.waitForResponse((r) => r.url().includes("/answers/q25") && r.request().method() === "PUT");
  await q25.locator("button[type='submit']").click();
  expect((await saved).status()).toBe(200);
  await expect(facts.locator("[data-field='score'] [data-score='17']")).toBeVisible();
  const band = facts.locator("[data-field='band'] [data-band='16-20']");
  await expect(band).toBeVisible();
  await expect(band).toContainText(lang === "en" ? B0152[1]![1] : world.bandAr);
  await expect(facts).not.toContainText(incompleteLabel(lang, 24, 25));
  await expectLangDir(page, lang);
  await shot(page, lang, "a16-02-health-complete-17", project);
  expect(await axeSeriousOrCritical(page), "axe on the complete health check").toEqual([]);
});

test("REQ-PB-086: the Lead generates the 90-day plan from 2026-10-01; Days 31-60 tasks fall in 2026-11-01..2026-11-30; every B0134 action appears", async ({
  page,
}, info) => {
  const project = info.project.name;
  const lang = projectLang(project);
  await signInAs(page, world.leadSubject);
  await page.goto(`/transformations/${world.tid}/launch-plan`);
  await expectLangDir(page, lang);
  const form = page.locator("form[data-form='generate-plan']");
  await expect(form).toBeVisible();
  await form.locator("input[type='date']").fill(START);
  const generated = page.waitForResponse((r) => r.url().endsWith("/launch-plan") && r.request().method() === "POST");
  await form.locator("button[type='submit']").click();
  expect((await generated).status()).toBe(201);
  await expect(page.locator(`[data-start-date='${START}']`)).toBeVisible();
  const table = page.locator("table[data-table='launch-tasks']");
  await expect(table.first()).toBeVisible();
  // Days 31-60: every row dated within 2026-11-01..2026-11-30.
  const mid = page.locator("#window-days_31_60 tr[data-task]");
  expect(await mid.count()).toBeGreaterThan(0);
  for (const row of await mid.all()) {
    const start = (await row.locator("td[data-start]").getAttribute("data-start"))!;
    const due = (await row.locator("td[data-due]").getAttribute("data-due"))!;
    expect(start >= "2026-11-01" && due <= "2026-11-30", `${start}..${due}`).toBe(true);
  }
  // The Day-90 test is due on day 90.
  const allDue = await page
    .locator("tr[data-task] td[data-due]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-due")));
  expect(allDue).toContain("2026-12-30");
  // Every B0134 action appears (English: verbatim).
  expect(B0134_ACTIONS).toHaveLength(17);
  if (lang === "en") {
    const text = (await page.locator("table[data-table='launch-tasks']").allInnerTexts()).join("\n");
    for (const action of B0134_ACTIONS) expect(text, action).toContain(action);
  }
  await expect(page.locator("tr[data-task]")).not.toHaveCount(0);
  await expectLangDir(page, lang);
  await shot(page, lang, "a16-03-launch-plan", project);
  expect(await axeSeriousOrCritical(page), "axe on the launch plan").toEqual([]);
});
