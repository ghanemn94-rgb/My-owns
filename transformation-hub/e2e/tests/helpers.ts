import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

export const PERSONAS = {
  pm: 'Demo Project Manager',
  pmB: 'Demo PM — Project B',
  portfolioAdmin: 'Demo Portfolio Admin',
  contributor: 'Demo Contributor',
  partnerAlpha: 'Demo Partner Alpha User',
  finance: 'Demo Finance Member',
  sponsor: 'Demo Sponsor',
  secretary: 'Demo Secretary / CPMO',
  cleanTeam: 'Demo Clean Team Member',
  contributorB: 'Demo Contributor — Project B',
} as const;

/** Sign in through the real login page by clicking the persona's button. */
export async function loginAs(page: Page, persona: string): Promise<void> {
  await page.goto('/login');
  await page.locator(`[data-testid="demo-login"][data-persona="${persona}"]`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('user-menu')).toContainText(persona);
}

/** Persist a language for the signed-in persona through the API (same call the UI makes). */
export async function setSavedLocale(page: Page, locale: 'en' | 'ar'): Promise<void> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
  const res = await page.request.post('/api/v1/me/locale', { data: { locale }, headers: { 'x-csrf-token': csrf } });
  expect(res.ok(), `set locale ${locale} → HTTP ${res.status()}`).toBeTruthy();
}

/** API-only session for looking up fixture ids (never used to assert UI behaviour). */
export async function apiSessionAs(baseURL: string, persona: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const users = await (await ctx.get('/api/v1/auth/demo-users')).json();
  const user = (users.items as { id: string; displayName: string }[]).find((u) => u.displayName === persona);
  if (!user) throw new Error(`Demo persona not found: ${persona}`);
  const res = await ctx.post('/api/v1/auth/demo-login', { data: { userId: user.id } });
  expect(res.ok(), `demo login ${persona}`).toBeTruthy();
  return ctx;
}

/** Fail the test on uncaught page errors and unexpected console errors (HTTP 4xx resource logs are expected). */
export function watchConsole(page: Page): () => string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/.test(text)) return;
    problems.push(`console: ${text}`);
  });
  return () => problems;
}
