// qa-verifier support for the A02 demo-stack specs (DG5, T-DG5-QA-E2). Runs inside a stack started by
// e2e/support/with-demo-stack.sh (`mth-db seed-demo` with AUTH_MODE=dev, so the dataset's demo role users
// roaming.user.<role> are also bound to the dev issuer (D-165); MTH_ENV=demo; the built API serving the built SPA).
//  - `ui(lang, english)`: the visible text of a catalogue string in the project's language, found by its exact English
//    value in apps/web/src/i18n/en (reverse lookup), so one spec drives the en and the ar UI with the same steps;
//  - `field(lang, english)`: a control's accessible name, optionally followed by the "(required)" marker;
//  - `demoPage(browser, lang, role)`: a browser page signed in as the demo role user through the dev sign-in form;
//  - `demoApi(playwright, role)`: an API session of the same demo user (staffing and record verification only).
// Every record is SYNTHETIC (a demo database); nothing here approves anything real or names DG0-DG7.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { apiSession, escape, signIn, type ApiSession, type Lang } from "../../apps/web/e2e/support/ui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, "..", "..", "apps", "web", "src", "i18n");

type Flat = Map<string, string>;
const flats = new Map<Lang, Flat>();
function flat(lang: Lang): Flat {
  let f = flats.get(lang);
  if (f) return f;
  f = new Map();
  const walk = (prefix: string, node: unknown) => {
    if (typeof node === "string") f!.set(prefix, node);
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(prefix ? `${prefix}.${k}` : k, v);
  };
  const dir = join(I18N, lang);
  for (const file of readdirSync(dir).filter((x) => x.endsWith(".json")))
    walk(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown);
  flats.set(lang, f);
  return f;
}

/** Every rendering of an English catalogue string in `lang` (one English text may have several keys). */
export function uiAll(lang: Lang, english: string): string[] {
  if (lang === "en") return [english];
  const en = flat("en");
  const target = flat(lang);
  const out = new Set<string>();
  for (const [k, v] of en) if (v === english && target.has(k)) out.add(target.get(k)!);
  if (out.size === 0) throw new Error(`no catalogue key has the English text ${JSON.stringify(english)}`);
  return [...out];
}
/** The rendering in `lang`; when several keys disagree, a regex that accepts any of them. */
export function ui(lang: Lang, english: string): string {
  const all = uiAll(lang, english);
  return all[0]!;
}
export const uiRe = (lang: Lang, english: string): RegExp =>
  new RegExp(`^\\s*(?:${uiAll(lang, english).map(escape).join("|")})\\s*$`);
/** A control's accessible name, optionally followed by the "(required)" marker of the language. */
export function field(lang: Lang, english: string): RegExp {
  const req = uiAll(lang, "required").map(escape).join("|");
  return new RegExp(`^(?:${uiAll(lang, english).map(escape).join("|")})(?:\\s*\\((?:${req})\\))?$`);
}
export function catalogue(lang: Lang, key: string): string {
  const v = flat(lang).get(key);
  if (v === undefined) throw new Error(`missing i18n key ${key}`);
  return v;
}

export const DEMO_BU = "01995000-0000-7000-8000-000000000003";
export type DemoRole = "sp" | "tl" | "bo" | "fin" | "kds" | "wl" | "to" | "cm" | "adm_access";
export const demoUser = (role: DemoRole) => `roaming.user.${role}`;

/** A new browser context and page, signed in as the demo role user through the dev sign-in form (D-165). */
export async function demoPage(browser: Browser, lang: Lang, role: DemoRole): Promise<Page> {
  const ctx = await browser.newContext({
    locale: lang === "ar" ? "ar-SA" : "en-US",
    timezoneId: "Asia/Riyadh",
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3000",
  });
  const page = await ctx.newPage();
  await signIn(page, lang, demoUser(role));
  return page;
}

export async function demoApi(playwright: PlaywrightWorkerArgs["playwright"], role: DemoRole): Promise<ApiSession> {
  return apiSession(playwright, demoUser(role));
}

/** The persistent synthetic banner of a demo database (ADR-0050 §2 a), with its exact text in the language. */
export async function expectBanner(page: Page, lang: Lang): Promise<void> {
  const banner = page.locator("[data-state='demo-synthetic']");
  await expect(banner).toHaveCount(1);
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(catalogue(lang, "playbookP5.demo.banner"));
}
