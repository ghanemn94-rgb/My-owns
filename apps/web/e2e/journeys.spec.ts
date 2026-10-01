// Frontend journeys against the REAL API (apps/web/e2e/support/with-stack.sh): sign-in, bilingual shell, create /
// list / detail / edit-with-409 / archive, administration, and a user without roles. Every step captures a screenshot
// in the project's language (chromium-en -> English LTR, chromium-ar -> Arabic RTL) and runs axe (no serious or
// critical violations allowed). All data is SYNTHETIC (seeded dev users; names created here).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

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

// Name matching (F-DG1-208). Playwright matches a string `name`/text as a case-insensitive SUBSTRING by default, and
// an unanchored RegExp likewise matches anywhere. Localized labels can contain one another (Arabic 'عملي' is inside
// 'العمليات الاعتيادية والتحسين'), so every locator below matches the WHOLE accessible name or text: plain strings
// use `exact: true`, and names that legitimately carry extra text are spelled out completely and anchored.
/** The whole name/text is exactly this string (whitespace at the ends ignored). */
const exactly = (s: string) => new RegExp(`^\\s*${escape(s)}\\s*$`);
/** A form control's label: the catalogue label, optionally followed by the "(required)" marker (Form.tsx). */
function fieldLabelSource(lang: Lang, key: string): string {
  return `${escape(tr(lang, key))}(?:\\s*\\(${escape(tr(lang, "common.form.required"))}\\))?`;
}
const fieldLabel = (lang: Lang, key: string) => new RegExp(`^${fieldLabelSource(lang, key)}$`);
/** A primary-navigation link (Shell.tsx): the area label, optionally followed by the "planned" tag. */
function navLink(nav: Locator, lang: Lang, area: string): Locator {
  const label = escape(tr(lang, `nav.areas.${area}.label`));
  return nav.getByRole("link", { name: new RegExp(`^${label}(?:\\s+${escape(tr(lang, "nav.planned"))})?$`) });
}
/** The language switch (LanguageSwitch.tsx) is named in the CURRENT language after the target language. */
const LANGUAGE_NAMES: Record<Lang, string> = { ar: "العربية", en: "English" };

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
    const from: Lang = lang === "en" ? "ar" : "en";
    await page
      .getByRole("button", {
        name: tr(from, "common.language.switchTo", { language: LANGUAGE_NAMES[lang] }),
        exact: true,
      })
      .click();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function signIn(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  // The page language is not known yet (Arabic by default, or the remembered choice): accept either label exactly.
  const field = page.getByLabel(
    new RegExp(`^(?:${fieldLabelSource("ar", "auth.dev.username")}|${fieldLabelSource("en", "auth.dev.username")})$`),
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

/**
 * Waits until the shell has (re)mounted after a document load and can take keyboard input deterministically
 * (F-DG1-232): the primary navigation and the page heading are visible, the document has the focus, and no element
 * is focused yet, so the next Tab starts at the top of the document. Nothing is clicked (a click would move the
 * sequential-focus starting point), and no assertion about the focus order is weakened.
 */
async function expectShellReadyForKeyboard(page: Page, lang: Lang, nav: Locator) {
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(navLink(nav, lang, "myWork")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.bringToFront();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        hasFocus: document.hasFocus(),
        nothingFocused: document.activeElement === null || document.activeElement === document.body,
      })),
    )
    .toEqual({ hasFocus: true, nothingFocused: true });
}

async function signOut(page: Page, lang: Lang) {
  await page.getByRole("button", { name: tr(lang, "auth.signOut"), exact: true }).click();
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
  await expect(page.getByRole("link", { name: tr(lang, "auth.oidcButton"), exact: true })).toBeVisible();
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible();
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
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  // The Transformation Office holds no administration permission: 13 areas, no Administration.
  await expect(nav.locator("a[data-area]")).toHaveCount(13);
  await expect(navLink(nav, lang, "admin")).toHaveCount(0);
  await expect(navLink(nav, lang, "myWork")).toHaveAttribute("aria-current", "page");
  await shot(page, lang, "02-my-work");
  await expectAccessible(page, lang, "my-work");
  // The language survives a reload (persisted to the profile and to localStorage).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  // Keyboard: the skip link is the first focusable element and moves focus to <main>.
  // F-DG1-232: after the reload the shell mounts asynchronously (session and profile requests). A Tab pressed before
  // it has mounted lands nowhere and the assertion below raced. Wait until the shell is mounted again and the
  // document holds the focus with nothing focused yet, so the first Tab starts from the top of the document.
  await expectShellReadyForKeyboard(page, lang, nav);
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent"), exact: true });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  // A planned area is labelled planned.
  await navLink(nav, lang, "governance").click();
  await expect(
    page.getByRole("heading", { level: 1, name: tr(lang, "nav.areas.governance.label"), exact: true }),
  ).toBeVisible();
  await shot(page, lang, "03-planned-area");
  expect(foreign).toEqual([]);
});

test("create a modular transformation with an entry phase", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/transformations/new");
  await expect(
    page.getByRole("heading", { level: 1, name: tr(lang, "transformations.createTitle"), exact: true }),
  ).toBeVisible();
  // Validation (shared zod schema) in the selected language.
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect(page.getByText(tr(lang, "problems.validation__required"), { exact: true }).first()).toBeVisible();
  await shot(page, lang, "04-create-validation");
  await expectAccessible(page, lang, "create-validation");

  await page
    .getByLabel(fieldLabel(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "العمليات (اصطناعي) (SYN-OPS)" : "Synthetic Operations (SYN-OPS)" });
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(`Synthetic ${lang.toUpperCase()} journey`);
  // A mode radio is named by its label followed by its help text (TransformationCreatePage.tsx).
  await page
    .getByRole("radio", {
      name: new RegExp(
        `^${escape(tr(lang, "transformations.mode.modular"))}\\s+${escape(tr(lang, "transformations.form.modeHelp.modular"))}$`,
      ),
    })
    .check();
  await page.getByLabel(fieldLabel(lang, "transformations.field.entryPhase")).selectOption("design");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  createdId = page.url().split("/").pop()!;
  await expect(page.getByRole("status").filter({ hasText: tr(lang, "transformations.created") })).toBeVisible();
  await expect(page.getByText(tr(lang, "transformations.workspace.gateReadiness"), { exact: true })).toBeVisible();
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
  await expect(page.getByRole("link", { name: createdCode, exact: true })).toBeVisible();
  await shot(page, lang, "06-list");
  await expectAccessible(page, lang, "list");
  // A sortable header is named by its label followed by the (visually hidden) sort state (DataTable.tsx).
  const sortStates = ["notSorted", "sortedAsc", "sortedDesc"].map((k) => escape(tr(lang, `common.table.${k}`)));
  const codeHeader = page.getByRole("columnheader", {
    name: new RegExp(`^${escape(tr(lang, "transformations.field.code"))}\\s+(?:${sortStates.join("|")})$`),
  });
  await codeHeader.getByRole("button").click();
  await expect(codeHeader).toHaveAttribute("aria-sort", "ascending");
  // Filters live in the URL; the router applies them asynchronously, so assert the settled state.
  const draft = page.getByRole("checkbox", { name: tr(lang, "transformations.status.draft"), exact: true });
  await draft.click();
  await expect(draft).toBeChecked();
  await expect(page).toHaveURL(/status=draft/);
  // The removable filter chip: "<Status>: <Draft>" followed by the hidden "remove filter" text.
  const chipLabel = `${tr(lang, "transformations.field.status")}: ${tr(lang, "transformations.status.draft")}`;
  await expect(
    page.getByRole("group", { name: tr(lang, "common.filter.active"), exact: true }).getByRole("button", {
      name: new RegExp(`^${escape(chipLabel)}\\s+${escape(tr(lang, "common.filter.remove"))}$`),
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "common.table.columns"), exact: true }).click();
  const modeColumn = page.getByRole("checkbox", { name: tr(lang, "transformations.field.mode"), exact: true });
  await modeColumn.click();
  await expect(modeColumn).not.toBeChecked();
  await expect(
    page.getByRole("columnheader", { name: tr(lang, "transformations.field.mode"), exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: tr(lang, "common.table.pagination"), exact: true })).toBeVisible();
  await shot(page, lang, "07-list-filtered");
  await expectAccessible(page, lang, "list-filtered");
  expect(foreign).toEqual([]);
});

test("edit: a concurrent change gives a 409 conflict with compare and re-apply", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${createdId}/edit`);
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await name.fill(`Synthetic ${lang.toUpperCase()} journey (my edit)`);
  // Someone else saves first (same session cookie, through the real API with CSRF + If-Match).
  const me = await (await page.request.get("/api/v1/me")).json();
  const current = await (await page.request.get(`/api/v1/transformations/${createdId}`)).json();
  const other = await page.request.patch(`/api/v1/transformations/${createdId}`, {
    headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${current.version}"`, Origin: BASE },
    data: { description: "Changed concurrently by another session (synthetic)" },
  });
  expect(other.status()).toBe(200);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  await shot(page, lang, "08-conflict");
  await expectAccessible(page, lang, "conflict");
  await conflict.getByRole("button", { name: tr(lang, "common.conflict.reapply"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${createdId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("(my edit)");
  // The other session's change is kept.
  await expect(page.locator("dd", { hasText: "Changed concurrently by another session (synthetic)" })).toBeVisible();
  // ...and both changes are in the audit trail.
  await expect(page.getByRole("region", { name: tr(lang, "transformations.audit.title"), exact: true })).toContainText(
    "(my edit)",
  );
  await shot(page, lang, "08b-after-reapply");
  expect(foreign).toEqual([]);
});

test("archive with a mandatory reason makes the record read-only", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${createdId}`);
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  await expect(dialog.getByText(tr(lang, "problems.validation__too_small"), { exact: true })).toBeVisible();
  await shot(page, lang, "09-archive-dialog");
  await expectAccessible(page, lang, "archive-dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill("Synthetic journey finished");
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Synthetic journey finished");
  await expect(page.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) })).toHaveCount(0);
  await shot(page, lang, "10-archived");
  expect(foreign).toEqual([]);
});

test("administration screens (access + technical administrator)", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  await expect(nav.locator("a[data-area]")).toHaveCount(14);
  await navLink(nav, lang, "admin").click();
  await expect(
    page.getByRole("heading", { level: 1, name: tr(lang, "nav.areas.admin.label"), exact: true }),
  ).toBeVisible();
  await shot(page, lang, "11-admin");
  await expectAccessible(page, lang, "admin");

  await page.getByRole("link", { name: tr(lang, "admin.organizations.title"), exact: true }).click();
  await page.getByRole("link", { name: "SYN-DEV", exact: true }).click();
  await expect(page.getByRole("heading", { name: tr(lang, "admin.businessUnits.title"), exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "SYN-RETAIL", exact: true })).toBeVisible();
  await shot(page, lang, "12-organization");
  await expectAccessible(page, lang, "organization");

  await page.goto("/admin/users");
  await expect(page.getByRole("link", { name: "Synthetic Transformation Lead", exact: true })).toBeVisible();
  await shot(page, lang, "13-users");
  await expectAccessible(page, lang, "users");

  await page.goto("/admin/assignments");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "admin.assignments.new"), exact: true }).click();
  await expect(page.getByLabel(fieldLabel(lang, "admin.assignments.role"))).toBeVisible();
  await shot(page, lang, "14-assignments");
  await expectAccessible(page, lang, "assignments");
  // A technical administrator has no business-record access: the transformations register is empty for them.
  await page.goto("/transformations");
  await expect(page.getByText(tr(lang, "transformations.emptyTitle"), { exact: true })).toBeVisible();
  await signOut(page, lang);
  expect(foreign).toEqual([]);
});

test("a user without roles sees no Administration and no business records", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.nobody");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  await expect(navLink(nav, lang, "admin")).toHaveCount(0);
  await page.goto(`/transformations/${createdId}`);
  await expect(page.locator("[data-state='no-permission']")).toBeVisible();
  await shot(page, lang, "15-no-permission");
  await expectAccessible(page, lang, "no-permission");
  await page.goto("/transformations");
  await expect(page.getByText(tr(lang, "transformations.emptyTitle"), { exact: true })).toBeVisible();
  await shot(page, lang, "16-empty");
  expect(foreign).toEqual([]);
});

test("a business-unit Lead creates a record: Edit/Archive and the audit trail appear without a reload (F-DG1-210), the derived grant localized (F-DG1-008)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  // dev.lead holds TL at SYN-RETAIL only (business-unit scope, no downward inheritance): creating a record adds the
  // audited, derived transformation-scope TL assignment (F-DG1-106) to the new record's own audit trail.
  await signIn(page, lang, "dev.lead");
  await page.goto("/transformations/new");
  await page
    .getByLabel(fieldLabel(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "التجزئة (اصطناعي) (SYN-RETAIL)" : "Synthetic Retail (SYN-RETAIL)" });
  await page
    .getByLabel(fieldLabel(lang, "transformations.field.name"))
    .fill(`Synthetic ${lang.toUpperCase()} lead-created record`);
  // A marker on `window` survives in-app navigation but not a document reload: it proves no reload happened below.
  await page.evaluate(() => {
    (window as unknown as { __mthNoReload?: boolean }).__mthNoReload = true;
  });
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  // F-DG1-210: the create page re-reads GET /me after the 201, so the server-granted derived transformation-scope TL
  // assignment shows Edit, Archive and the audit trail straight away, WITHOUT a reload (previously hidden until one).
  const header = page.locator("main#main");
  await expect(header.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) })).toBeVisible();
  await expect(header.getByRole("button", { name: exactly(tr(lang, "transformations.archive.action")) })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __mthNoReload?: boolean }).__mthNoReload === true)).toBe(
    true,
  );
  await shot(page, lang, "17a-lead-created-controls");
  await expectAccessible(page, lang, "lead-created-controls");
  const trail = page.getByRole("region", { name: tr(lang, "transformations.audit.title"), exact: true });
  const derivedLabel = tr(lang, "transformations.audit.actions.scoped_assignment_create_derived");
  const row = trail.getByRole("row").filter({ has: page.getByRole("cell", { name: derivedLabel, exact: true }) });
  await expect(row).toHaveCount(1);
  const changes = row.getByRole("cell").nth(4);
  const none = tr(lang, "common.value.none");
  for (const [field, value] of [
    ["user_id", "Synthetic Transformation Lead"],
    ["role_code", tr(lang, "transformations.audit.role.TL")],
    [
      "scope",
      `${tr(lang, "admin.scopeType.transformation")}: ${tr(lang, "transformations.audit.value.thisTransformation")}`,
    ],
    ["effective_to", none],
  ] as const) {
    await expect(changes).toContainText(`${tr(lang, `transformations.audit.field.${field}`)}: ${none}`);
    await expect(changes).toContainText(value);
  }
  await expect(changes).toContainText(tr(lang, "transformations.audit.field.derived_from_assignment_id"));
  // No raw action code, camelCase key, JSON or role code, and nothing marked "without a translation".
  const text = (await trail.textContent()) ?? "";
  for (const raw of [
    "scoped_assignment",
    "userId",
    "roleCode",
    "effectiveTo",
    "derivedFromAssignmentId",
    '"type"',
    tr(lang, "transformations.audit.untranslatedField"),
    tr(lang, "transformations.audit.untranslatedValue"),
    tr(lang, "transformations.audit.untranslatedAction"),
  ]) {
    expect(text).not.toContain(raw);
  }
  expect(await page.evaluate(() => (window as unknown as { __mthNoReload?: boolean }).__mthNoReload === true)).toBe(
    true,
  );
  await trail.scrollIntoViewIfNeeded();
  await shot(page, lang, "17-lead-audit-trail");
  await expectAccessible(page, lang, "lead-audit-trail");
  expect(foreign).toEqual([]);
});
