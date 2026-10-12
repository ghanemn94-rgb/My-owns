// qa-verifier DG4 round 6 (T-DG4-REV-QA-R6): a REAL-stack probe of the identity-recheck rules that the repaired unit
// tests (apps/web/src/auth/session-bound/-identity/-generation.test.tsx, T-DG4-FE-R9B, F-DG4-145) model with a controlled
// clock: F-DG2-570 / D-077 (apps/web/src/api/client.ts, SESSION_RECHECK_MS = 2 000 ms).
//   W1  an in-app navigation sends GET /me before any page GET of the new page, and one /me per navigation;
//   W2  an idle page sends no /me at all while idle (4 s, longer than the window);
//   W3  after another sign-in elsewhere in the same browser (a different SYNTHETIC user), the next in-app
//       navigation in the first tab shows the NEW identity's header, and the page GETs are sent only after that /me;
//       the first identity's name is no longer shown.
// Real stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations, seed-dev, built API + built SPA); no mocks, no
// request interception (only observation of requests). This file lives OUTSIDE the frozen candidate
// (docs/delivery/test-evidence/DG4/qa/tests/round-6/e2e/); it is copied into a disposable clone's e2e/ only to run.
// Every check is recorded in $QA_RESULTS_DIR/dg4-qa-r6-session-<lang>.json. SYNTHETIC users only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");
interface Check {
  id: string;
  req: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(id: string, req: string, pass: boolean, detail: unknown): void {
  const d = typeof detail === "string" ? detail : String(JSON.stringify(detail) ?? "undefined");
  checks.push({ id, req, pass, detail: d.slice(0, 1500) });
  if (!pass) console.log(`QA-CHECK-FAIL ${id} [${req}] ${d.slice(0, 600)}`);
}
test.afterAll(async ({}, info) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `dg4-qa-r6-session-${langOf(info)}.json`), `${JSON.stringify(checks, null, 2)}\n`);
});

/** Records every /api/ request the page sends: "METHOD path" in send order. */
function record(page: Page): string[] {
  const log: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) log.push(`${r.method()} ${u.pathname}${u.search}`);
  });
  return log;
}
const isMe = (s: string) => s === "GET /api/v1/me";
const isPageGet = (s: string) => s.startsWith("GET ") && !isMe(s);

async function navAreas(page: Page): Promise<string[]> {
  return page.locator("nav a.app-nav__link[data-area]").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href") ?? "").filter((h) => h && h !== "/my-work"),
  );
}

// Revision 3: wait for the navigation's first page-data RESPONSE (not only the h1 and networkidle): under load (rev 2, en,
// load 14) the navigation's /me and GET were reported after networkidle and landed in the W2 idle window.
async function clickNav(page: Page, href: string) {
  const pageData = page.waitForResponse(
    (r) => r.request().method() === "GET" && new URL(r.url()).pathname.startsWith("/api/v1/") && new URL(r.url()).pathname !== "/api/v1/me",
    { timeout: 30_000 },
  );
  await page.locator(`nav a.app-nav__link[href="${href}"]`).first().click();
  await page.waitForURL(`**${href}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await pageData;
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_000);
}

test("W1-W3: identity recheck on the real stack (F-DG2-570, D-077; F-DG4-145 context)", async ({ page }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const log = record(page);
  await signIn(page, lang, "dev.lead");
  await page.waitForLoadState("networkidle");
  const leadName = (await page.locator(".user-box__name").textContent())?.trim() ?? "";
  const hrefs = await navAreas(page);
  check("W0-nav-areas", "REQ-S16-030", hrefs.length >= 2, hrefs);

  // W1: two in-app navigations, each > 2 s after the last /me.
  for (const [i, href] of hrefs.slice(0, 2).entries()) {
    await page.waitForTimeout(2_500);
    const from = log.length;
    await clickNav(page, href);
    const sent = log.slice(from);
    const firstPage = sent.findIndex(isPageGet);
    const meCount = sent.filter(isMe).length;
    check(`W1-${i}-me-first ${href}`, "REQ-S16-030", sent.length > 0 && isMe(sent[0]!), sent.slice(0, 6));
    check(
      `W1-${i}-no-page-get-before-me ${href}`,
      "REQ-S16-030",
      firstPage === -1 || sent.slice(0, firstPage).some(isMe),
      { firstPage, head: sent.slice(0, 6) },
    );
    check(`W1-${i}-one-me-per-navigation ${href}`, "REQ-S16-030", meCount === 1, { meCount, sent });
  }

  // W2: idle for 4 s (twice the window): nothing at all is sent, in particular no /me.
  const idleFrom = log.length;
  await page.waitForTimeout(4_000);
  const idle = log.slice(idleFrom);
  check("W2-idle-sends-no-me", "REQ-S16-030", idle.filter(isMe).length === 0, idle);

  // W3: another sign-in (dev.office) elsewhere in the SAME browser (shared cookie jar), through the context's request API
  // as apps/web/e2e/session-end.spec.ts does. Revision 2: revision 1 opened a second tab on /login, which the signed-in
  // cookie redirects away from the sign-in form (a defect of my probe, not of the product).
  const relogin = await page.context().request.post("/api/v1/auth/dev-login", {
    data: { username: "dev.office" },
    headers: { Origin: new URL(page.url()).origin },
  });
  check("W3-relogin-204", "REQ-S16-030", relogin.status() === 204, relogin.status());
  const meB = (await (await page.context().request.get("/api/v1/me")).json()) as { user: { displayName: string } };
  const officeName = meB.user.displayName.trim();
  check("W3-two-identities", "REQ-S16-030", leadName !== "" && officeName !== "" && leadName !== officeName, {
    leadName,
    officeName,
  });
  const from = log.length;
  const back = hrefs[0]!;
  await clickNav(page, back);
  await expect(page.locator(".user-box__name")).toHaveText(officeName, { timeout: 10_000 });
  const sent = log.slice(from);
  const firstPage = sent.findIndex(isPageGet);
  check("W3-me-before-page-get", "REQ-S16-030", sent.length > 0 && firstPage !== 0 && sent.slice(0, Math.max(firstPage, 1)).some(isMe), sent.slice(0, 8));
  const header = (await page.locator(".user-box__name").textContent())?.trim();
  check("W3-header-is-new-identity", "REQ-S16-030", header === officeName, { header, officeName });
  const shown = await page.locator("body").innerText();
  check("W3-old-name-not-shown", "REQ-S16-030", !shown.includes(leadName), { leadName });
  check("W3-one-me", "REQ-S16-030", sent.filter(isMe).length === 1, sent.slice(0, 8));

  const failed = checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
});
