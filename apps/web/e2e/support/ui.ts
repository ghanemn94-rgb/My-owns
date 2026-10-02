// Shared helpers of the P2 web journeys (p2-journeys.spec.ts): catalogue lookups in the project's language, sign-in
// through the development form, screenshots, axe, same-origin request tracking, and an API session per SYNTHETIC
// dev user for setup steps (real API calls with CSRF, Origin, If-Match and Idempotency-Key — never a mock).
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type Page, type PlaywrightWorkerArgs, type TestInfo } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = process.env["E2E_SCREENSHOT_DIR"] ?? join(HERE, "..", "screenshots");
export const BASE = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

export type Lang = "ar" | "en";
type Catalogue = Record<string, unknown>;
const cache = new Map<Lang, Catalogue>();
function catalogue(lang: Lang): Catalogue {
  let c = cache.get(lang);
  if (!c) {
    const dir = join(HERE, "..", "..", "src", "i18n", lang);
    c = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown]),
    );
    cache.set(lang, c);
  }
  return c;
}
/** A catalogue string with {{vars}} filled, e.g. tr("en", "kpi.valuePool.partial", { n: "1" }). */
export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = catalogue(lang);
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${key}`);
  return node.replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(vars[v] ?? ""));
}
export const langOf = (info: TestInfo): Lang => (info.project.name.endsWith("-ar") ? "ar" : "en");
export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The whole accessible name is exactly this string. */
export const exactly = (s: string) => new RegExp(`^\\s*${escape(s)}\\s*$`);
/** A control's label: the catalogue label, optionally followed by the "(required)" marker. */
export const fieldLabel = (lang: Lang, key: string) =>
  new RegExp(`^${escape(tr(lang, key))}(?:\\s*\\(${escape(tr(lang, "common.form.required"))}\\))?$`);
/** A row action: its visible label followed by the visually hidden ": <record name>". */
export const rowAction = (lang: Lang, key: string, name: string) =>
  new RegExp(`^\\s*${escape(tr(lang, key))}\\s*:\\s*${escape(name)}\\s*$`);

const LANGUAGE_NAMES: Record<Lang, string> = { ar: "العربية", en: "English" };

export async function ensureLanguage(page: Page, lang: Lang) {
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

export async function signIn(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  const field = page.getByLabel(
    new RegExp(
      `^(?:${escape(tr("ar", "auth.dev.username"))}|${escape(tr("en", "auth.dev.username"))})(?:\\s*\\((?:${escape(tr("ar", "common.form.required"))}|${escape(tr("en", "common.form.required"))})\\))?$`,
    ),
  );
  await expect(field).toBeVisible();
  await field.fill(username);
  await field.press("Enter");
  await page.waitForURL("**/my-work");
  await expect(page.getByTestId("wordmark")).toBeVisible();
  await expect(page.locator("main#main h1")).toBeVisible();
  await ensureLanguage(page, lang);
}

export async function shot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(SHOTS, lang), { recursive: true });
  await page.screenshot({ path: join(SHOTS, lang, `${name}.png`), fullPage: true });
}

export const axeSummary: Record<string, { violations: { id: string; impact: string | null; nodes: number }[] }> = {};

export async function expectAccessible(page: Page, lang: Lang, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  axeSummary[`${lang}/${name}`] = {
    violations: results.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length })),
  };
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Every request stays on the application origin (no CDN, no remote fonts), and nothing hits the CSP. */
export function trackRequests(page: Page): string[] {
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

// ------------------------------------------------------------------------------------------------ API sessions

export interface ApiSession {
  readonly req: APIRequestContext;
  readonly userId: string;
  call<T = Record<string, unknown>>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    data?: unknown,
    options?: { ifMatch?: number; expect?: number },
  ): Promise<T>;
}

/** Signs a SYNTHETIC dev user in through POST /auth/dev-login and returns a session that sends CSRF + Origin. */
export async function apiSession(
  playwright: PlaywrightWorkerArgs["playwright"],
  username: string,
): Promise<ApiSession> {
  const req = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const login = await req.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev-login ${username}`).toBe(204);
  const me = (await (await req.get("/api/v1/me")).json()) as { csrfToken: string; user: { id: string } };
  return {
    req,
    userId: me.user.id,
    async call(method, path, data, options = {}) {
      const headers: Record<string, string> = { "X-CSRF-Token": me.csrfToken };
      if (options.ifMatch !== undefined) headers["If-Match"] = `"${options.ifMatch}"`;
      if (method === "POST" && options.ifMatch === undefined) headers["Idempotency-Key"] = crypto.randomUUID();
      const res = await req.fetch(path, { method, headers, ...(data !== undefined ? { data } : {}) });
      const text = await res.text();
      if (options.expect !== undefined) expect(res.status(), `${method} ${path}: ${text}`).toBe(options.expect);
      else expect(res.ok(), `${method} ${path} -> ${res.status()}: ${text}`).toBe(true);
      return (text ? JSON.parse(text) : {}) as never;
    },
  };
}

export const DEV_USERS = {
  office: "01920000-0000-7000-9000-000000000202",
  lead: "01920000-0000-7000-9000-000000000203",
} as const;
export const SYN_RETAIL = "01920000-0000-7000-9000-000000000102";
