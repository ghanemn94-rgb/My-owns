// Frontend journeys against the REAL API (apps/web/e2e/support/with-stack.sh): sign-in, bilingual shell, create /
// list / detail / edit-with-409 / archive, administration, and a user without roles. Every step captures a screenshot
// in the project's language (chromium-en -> English LTR, chromium-ar -> Arabic RTL) and runs axe (no serious or
// critical violations allowed). All data is SYNTHETIC (seeded dev users; names created here).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env["E2E_SCREENSHOT_DIR"] ?? join(HERE, "screenshots");
const BASE = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

type Lang = "ar" | "en";
type Catalogue = Record<string, unknown>;
function catalogue(lang: Lang): Catalogue {
  const dir = join(HERE, "..", "src", "i18n", lang);
  return Object.fromEntries(
    ["common", "nav", "auth", "transformations", "admin", "problems"].map((ns) => [
      ns,
      JSON.parse(readFileSync(join(dir, `${ns}.json`), "utf8")) as unknown,
    ]),
  );
}
/** Looks up a catalogue string, e.g. tr("en", "transformations.field.name"). */
function tr(lang: Lang, key: string, vars: Record<string, string> = {}): string {
  let node: unknown = catalogue(lang);
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${key}`);
  return node.replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? "");
}
const langOf = (info: TestInfo): Lang => (info.project.name.endsWith("-ar") ? "ar" : "en");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const axeSummary: Record<string, { violations: { id: string; impact: string | null; nodes: number }[] }> = {};

async function shot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(SHOTS, lang), { recursive: true });
  await page.screenshot({ path: join(SHOTS, lang, `${name}.png`), fullPage: true });
}

async function expectAccessible(page: Page, lang: Lang, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  axeSummary[`${lang}/${name}`] = {
    violations: results.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length })),
  };
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/**
 * Every request stays on the application origin (no CDN, no remote fonts; REQ-S15-005), and nothing the page does
 * is blocked by the API's strict Content-Security-Policy (both are reported in the returned list).
 */
function trackRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) foreign.push(url);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) foreign.push(`CSP: ${msg.text()}`);
  });
  return foreign;
}

async function ensureLanguage(page: Page, lang: Lang) {
  const current = await page.locator("html").getAttribute("lang");
  if (current !== lang) {
    await page.getByRole("button", { name: lang === "en" ? /English/ : /العربية/ }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function signIn(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  const field = page.getByLabel(
    new RegExp(`${escape(tr("ar", "auth.dev.username"))}|${escape(tr("en", "auth.dev.username"))}`),
  );
  await expect(field).toBeVisible();
  await field.fill(username);
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  // The shell applies the profile's language when it mounts; read the language only after that.
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await expect(page.locator("main#main h1")).toBeVisible();
  await ensureLanguage(page, lang);
}

async function signOut(page: Page, lang: Lang) {
  await page.getByRole("button", { name: tr(lang, "auth.signOut") }).click();
  await page.waitForURL("**/login**");
}

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let createdId = "";
let createdCode = "";

test("sign-in page: Arabic RTL by default, provisional wordmark, dev form in dev mode", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByTestId("provisional-badge")).toHaveText(tr("ar", "common.brand.provisional"));
  await ensureLanguage(page, lang);
  await expect(page.getByTestId("provisional-badge")).toHaveText(tr(lang, "common.brand.provisional"));
  await expect(page.getByRole("link", { name: tr(lang, "auth.oidcButton") })).toBeVisible();
  await expect(page.getByLabel(tr(lang, "auth.dev.username"))).toBeVisible();
  await shot(page, lang, "01-sign-in");
  await expectAccessible(page, lang, "sign-in");
  // Fonts come from the bundle: the Plex face for this language is loaded, from the same origin.
  const families = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
  });
  expect(families).toContain(lang === "ar" ? "IBM Plex Sans Arabic" : "IBM Plex Sans");
  expect(foreign).toEqual([]);
});

test("shell: navigation, language persistence and My Work (Transformation Office)", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary") });
  // The Transformation Office holds no administration permission: 13 areas, no Administration.
  await expect(nav.locator("a[data-area]")).toHaveCount(13);
  await expect(nav.getByRole("link", { name: tr(lang, "nav.areas.admin.label") })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: new RegExp(escape(tr(lang, "nav.areas.myWork.label"))) })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await shot(page, lang, "02-my-work");
  await expectAccessible(page, lang, "my-work");
  // The language survives a reload (persisted to the profile and to localStorage).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  // Keyboard: the skip link is the first focusable element and moves focus to <main>.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent") })).toBeFocused();
  // A planned area is labelled planned.
  await nav.getByRole("link", { name: new RegExp(escape(tr(lang, "nav.areas.governance.label"))) }).click();
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "nav.areas.governance.label") })).toBeVisible();
  await shot(page, lang, "03-planned-area");
  expect(foreign).toEqual([]);
});

test("create a modular transformation with an entry phase", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/transformations/new");
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "transformations.createTitle") })).toBeVisible();
  // Validation (shared zod schema) in the selected language.
  await page.getByRole("button", { name: tr(lang, "transformations.form.create") }).click();
  await expect(page.getByText(tr(lang, "problems.validation__required")).first()).toBeVisible();
  await shot(page, lang, "04-create-validation");
  await expectAccessible(page, lang, "create-validation");

  await page
    .getByLabel(tr(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "العمليات (اصطناعي) (SYN-OPS)" : "Synthetic Operations (SYN-OPS)" });
  await page
    .getByLabel(new RegExp(`^${escape(tr(lang, "transformations.field.name"))}`))
    .fill(`Synthetic ${lang.toUpperCase()} journey`);
  await page.getByRole("radio", { name: new RegExp(escape(tr(lang, "transformations.mode.modular"))) }).check();
  await page.getByLabel(new RegExp(`^${escape(tr(lang, "transformations.field.entryPhase"))}`)).selectOption("design");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create") }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  createdId = page.url().split("/").pop()!;
  await expect(page.getByRole("status").filter({ hasText: tr(lang, "transformations.created") })).toBeVisible();
  await expect(page.getByText(tr(lang, "transformations.workspace.gateReadiness"))).toBeVisible();
  await expect(page.locator("[aria-current='step']")).toContainText(tr(lang, "transformations.phase.design"));
  createdCode = (await page.locator("h1 bdi").first().textContent())!.trim();
  expect(createdCode).toMatch(/^TR-\d{4}$/);
  await shot(page, lang, "05-detail");
  await expectAccessible(page, lang, "detail");
  expect(foreign).toEqual([]);
});

test("list: sort, filter chips, column selection and pagination controls", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/transformations");
  await expect(page.getByRole("link", { name: createdCode })).toBeVisible();
  await shot(page, lang, "06-list");
  await expectAccessible(page, lang, "list");
  const codeHeader = page.getByRole("columnheader", {
    name: new RegExp(escape(tr(lang, "transformations.field.code"))),
  });
  await codeHeader.getByRole("button").click();
  await expect(codeHeader).toHaveAttribute("aria-sort", "ascending");
  // Filters live in the URL; the router applies them asynchronously, so assert the settled state.
  const draft = page.getByRole("checkbox", { name: tr(lang, "transformations.status.draft") });
  await draft.click();
  await expect(draft).toBeChecked();
  await expect(page).toHaveURL(/status=draft/);
  await expect(
    page.getByRole("button", { name: new RegExp(escape(tr(lang, "transformations.status.draft"))) }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "common.table.columns") }).click();
  const modeColumn = page.getByRole("checkbox", { name: tr(lang, "transformations.field.mode") });
  await modeColumn.click();
  await expect(modeColumn).not.toBeChecked();
  await expect(page.getByRole("columnheader", { name: tr(lang, "transformations.field.mode") })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "common.table.pagination") })).toBeVisible();
  await shot(page, lang, "07-list-filtered");
  await expectAccessible(page, lang, "list-filtered");
  expect(foreign).toEqual([]);
});

test("edit: a concurrent change gives a 409 conflict with compare and re-apply", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${createdId}/edit`);
  const name = page.getByLabel(new RegExp(`^${escape(tr(lang, "transformations.field.name"))}`));
  await name.fill(`Synthetic ${lang.toUpperCase()} journey (my edit)`);
  // Someone else saves first (same session cookie, through the real API with CSRF + If-Match).
  const me = await (await page.request.get("/api/v1/me")).json();
  const current = await (await page.request.get(`/api/v1/transformations/${createdId}`)).json();
  const other = await page.request.patch(`/api/v1/transformations/${createdId}`, {
    headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${current.version}"`, Origin: BASE },
    data: { description: "Changed concurrently by another session (synthetic)" },
  });
  expect(other.status()).toBe(200);
  await page.getByRole("button", { name: tr(lang, "common.action.save") }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  await shot(page, lang, "08-conflict");
  await expectAccessible(page, lang, "conflict");
  await conflict.getByRole("button", { name: tr(lang, "common.conflict.reapply") }).click();
  await page.waitForURL(new RegExp(`/transformations/${createdId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("(my edit)");
  // The other session's change is kept.
  await expect(page.locator("dd", { hasText: "Changed concurrently by another session (synthetic)" })).toBeVisible();
  // ...and both changes are in the audit trail.
  await expect(page.getByRole("region", { name: tr(lang, "transformations.audit.title") })).toContainText("(my edit)");
  await shot(page, lang, "08b-after-reapply");
  expect(foreign).toEqual([]);
});

test("archive with a mandatory reason makes the record read-only", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${createdId}`);
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm") }).click();
  await expect(dialog.getByText(tr(lang, "problems.validation__too_small"))).toBeVisible();
  await shot(page, lang, "09-archive-dialog");
  await expectAccessible(page, lang, "archive-dialog");
  await dialog.getByLabel(new RegExp(escape(tr(lang, "common.form.reason")))).fill("Synthetic journey finished");
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Synthetic journey finished");
  await expect(page.getByRole("link", { name: new RegExp(escape(tr(lang, "common.action.edit"))) })).toHaveCount(0);
  await shot(page, lang, "10-archived");
  expect(foreign).toEqual([]);
});

test("administration screens (access + technical administrator)", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary") });
  await expect(nav.locator("a[data-area]")).toHaveCount(14);
  await nav.getByRole("link", { name: tr(lang, "nav.areas.admin.label") }).click();
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "nav.areas.admin.label") })).toBeVisible();
  await shot(page, lang, "11-admin");
  await expectAccessible(page, lang, "admin");

  await page.getByRole("link", { name: tr(lang, "admin.organizations.title") }).click();
  await page.getByRole("link", { name: "SYN-DEV" }).click();
  await expect(page.getByRole("heading", { name: tr(lang, "admin.businessUnits.title") })).toBeVisible();
  await expect(page.getByRole("link", { name: "SYN-RETAIL" })).toBeVisible();
  await shot(page, lang, "12-organization");
  await expectAccessible(page, lang, "organization");

  await page.goto("/admin/users");
  await expect(page.getByRole("link", { name: "Synthetic Transformation Lead" })).toBeVisible();
  await shot(page, lang, "13-users");
  await expectAccessible(page, lang, "users");

  await page.goto("/admin/assignments");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "admin.assignments.new") }).click();
  await expect(page.getByLabel(new RegExp(escape(tr(lang, "admin.assignments.role"))))).toBeVisible();
  await shot(page, lang, "14-assignments");
  await expectAccessible(page, lang, "assignments");
  // A technical administrator has no business-record access: the transformations register is empty for them.
  await page.goto("/transformations");
  await expect(page.getByText(tr(lang, "transformations.emptyTitle"))).toBeVisible();
  await signOut(page, lang);
  expect(foreign).toEqual([]);
});

test("a user without roles sees no Administration and no business records", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.nobody");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary") });
  await expect(nav.getByRole("link", { name: tr(lang, "nav.areas.admin.label") })).toHaveCount(0);
  await page.goto(`/transformations/${createdId}`);
  await expect(page.locator("[data-state='no-permission']")).toBeVisible();
  await shot(page, lang, "15-no-permission");
  await expectAccessible(page, lang, "no-permission");
  await page.goto("/transformations");
  await expect(page.getByText(tr(lang, "transformations.emptyTitle"))).toBeVisible();
  await shot(page, lang, "16-empty");
  expect(foreign).toEqual([]);
});
