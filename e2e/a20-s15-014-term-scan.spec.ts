// qa-verifier A20 term scan (DG6, T-DG6-QA-F). Binding row REQ-S15-014 (A05;A20), clause 2: "non-admin screens show
// no stack traces or infrastructure terms". ADR-0061 §8: "On the rendered text of every non-admin screen of the §7.2
// set (routes not under /admin), in both languages, none of these appears: [the term list of
// e2e/support/s15-014-terms.ts]. A forced server error ... shows the generic error state with its request id only."
//
// For every non-admin route of e2e/support/p6-axe-screens.ts (P6_AXE_ROUTES and KEY_FLOW_AXE_SCREENS minus /admin/**),
// in chromium-en and chromium-ar, three states are rendered and scanned:
//   1. "normal": the screen on the real stack with SYNTHETIC fixtures created here through the real API (a route whose
//      record this stack cannot create is opened with a SYNTHETIC unknown id and is scanned in the state it then shows;
//      the annotation says so);
//   2. "500": every API request the page makes (except GET /api/v1/me and /api/v1/auth/**, so the session stays signed
//      in) answers a 500 problem whose title, detail and field message carry a stack trace and every §8 term
//      (HOSTILE_DIAGNOSTICS) and whose requestId is a clean SYNTHETIC reference. The screen must show the error state
//      (data-state="error") with that reference, and nothing of the diagnostics;
//   3. "network": the same requests fail without any response (route.abort("failed")); the error state shows the
//      translated network text.
// In each state: <html> lang/dir, the scan of the visible text (document.body.innerText and the title) finds no
// pattern, axe (wcag2a/aa, wcag21a/aa) reports 0 serious or critical violations, and no request leaves the origin.
// The forced 500 is browser-side interception because the API has no fault-injection route (handback); the real
// server's own 500 is covered by tests/qa/integration/a20-s15-014-no-infra-terms.test.ts.
//
// Mutation switches (handback §Mutation checks; never set in a normal run):
//   QA_F_MUTATE=errorstate-stack  appends a stack frame to every rendered error state (data-state="error");
//   QA_F_MUTATE=screen-term       appends "connect ECONNREFUSED 127.0.0.1:5432" to the main region of every screen;
//   QA_F_MUTATE=no-request-id     removes the request reference from every rendered error state.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { KEY_FLOW_AXE_SCREENS, P6_AXE_ROUTES, type AxeScreen } from "./support/p6-axe-screens.ts";
import { HOSTILE_DIAGNOSTICS, scanTerms, type TermHit } from "./support/s15-014-terms.ts";
import { syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

// Not serial: one failing screen must not hide the others (each failure restarts the worker, whose beforeAll then
// creates fresh SYNTHETIC fixtures under a new stamp).
test.setTimeout(90_000);

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-f-s15-014");
const MUTATE = process.env["QA_F_MUTATE"] ?? "";
const stamp = Date.now().toString(36);

/** The §7.2 screens that are not Administration screens (ADR-0061 §8: "routes not under /admin"). */
const NON_ADMIN: readonly AxeScreen[] = [...P6_AXE_ROUTES, ...KEY_FLOW_AXE_SCREENS].filter(
  (s) => !s.route.startsWith("/admin"),
);

/** `:param` values from SYNTHETIC fixtures (beforeAll). */
const params: Record<string, string> = { gateCode: "G1" };
/** SYNTHETIC ids that exist nowhere, for the params this stack cannot create (fixed: deterministic). */
const UNKNOWN: Record<string, string> = {
  token: "qa-f-synthetic-unknown-token",
  writeId: "0193a1b2-0000-7000-8000-00000000f001",
  importId: "0193a1b2-0000-7000-8000-00000000f002",
  approvalId: "0193a1b2-0000-7000-8000-00000000f003",
  benefitId: "0193a1b2-0000-7000-8000-00000000f004",
};
const fixtureUser: Record<string, string> = {};
/** One line per scanned state, written to the evidence directory. */
const results: { route: string; state: string; lang: Lang; chars: number; hits: TermHit[]; note: string }[] = [];

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  try {
    const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA-F term scan ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    });
    params["id"] = t.id;
    const T = `/api/v1/transformations/${t.id}`;
    const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
    for (const role of ["SP", "KDS", "BO"]) {
      const u = await syntheticUser(
        admin,
        me.organization.id,
        t.id,
        `dev.qaf.${role.toLowerCase()}.${lang}.${stamp}`,
        `Synthetic QA-F ${role} ${lang}`,
        role,
        lang,
      );
      fixtureUser[`${role} fixture`] = u.username;
      if (role !== "KDS")
        await lead.call("POST", `${T}/role-mappings`, { partyCode: role, targetKind: "user", userId: u.id });
      else params["kdsUserId"] = u.id;
    }
    const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
      name: `Synthetic QA-F KPI ${lang} ${stamp}`,
      unitKind: "percentage",
      polarity: "higher_is_better",
      frequency: "monthly",
      ownerUserId: params["kdsUserId"],
    });
    await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
    params["kpiId"] = kpi.id;
  } finally {
    await lead.req.dispose();
    await admin.req.dispose();
  }
});

test.afterAll(async ({}, info) => {
  mkdirSync(EVIDENCE, { recursive: true });
  const suffix = MUTATE ? `-mutant-${MUTATE}` : "";
  writeFileSync(
    path.join(EVIDENCE, `term-scan-${info.project.name}${suffix}.json`),
    JSON.stringify(results, null, 2) + "\n",
  );
});

/** The route with its params filled; `unknown` lists the params filled with a SYNTHETIC unknown id. */
function fill(route: string): { url: string; unknown: string[] } {
  const unknown: string[] = [];
  const url = route.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    if (params[name]) return params[name]!;
    unknown.push(name);
    return UNKNOWN[name] ?? "0193a1b2-0000-7000-8000-00000000ffff";
  });
  return { url, unknown };
}

function userFor(s: AxeScreen): string {
  if (s.signInAs.startsWith("dev.") && !s.signInAs.includes(" ")) return s.signInAs;
  // The walkthrough names the demo database; on this stack it is opened by the seeded lead (it then shows its
  // "not a demo environment" state, which is scanned like any other).
  return fixtureUser[s.signInAs] ?? "dev.lead";
}

/** The API requests a forced failure applies to: everything but the session's own identity and sign-in. */
const isFaultable = (url: string): boolean => {
  const p = new URL(url).pathname;
  return p.startsWith("/api/v1/") && p !== "/api/v1/me" && !p.startsWith("/api/v1/auth/");
};

let requestSeq = 0;

async function force500(page: Page, refs: string[]): Promise<void> {
  await page.route(
    (url) => isFaultable(url.toString()),
    async (route: Route) => {
      const requestId = `qa-f-ref-${String(++requestSeq).padStart(5, "0")}`;
      refs.push(requestId);
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "urn:mth:problem:internal",
          title: HOSTILE_DIAGNOSTICS.split("\n")[0],
          status: 500,
          code: "internal",
          detail: HOSTILE_DIAGNOSTICS,
          requestId,
          errors: [{ pointer: "", code: "internal", message: HOSTILE_DIAGNOSTICS }],
        }),
      });
    },
  );
}

async function forceNetworkFailure(page: Page): Promise<void> {
  await page.route(
    (url) => isFaultable(url.toString()),
    (route: Route) => route.abort("failed"),
  );
}

/** Mutation switches: change what the screen renders, to show the scan fails when the asserted behaviour breaks. */
async function installMutant(page: Page): Promise<void> {
  if (!MUTATE) return;
  await page.addInitScript((mode: string) => {
    const apply = () => {
      if (mode === "errorstate-stack")
        document.querySelectorAll('[data-state="error"]:not([data-qa-mutant])').forEach((el) => {
          el.setAttribute("data-qa-mutant", "1");
          const p = document.createElement("p");
          p.textContent = "    at handler (/srv/app/node_modules/fastify/lib/route.js:12:34)";
          el.appendChild(p);
        });
      if (mode === "screen-term") {
        const main = document.querySelector("main#main:not([data-qa-mutant])");
        if (main) {
          main.setAttribute("data-qa-mutant", "1");
          const p = document.createElement("p");
          p.textContent = "connect ECONNREFUSED 127.0.0.1:5432";
          main.appendChild(p);
        }
      }
      if (mode === "no-request-id")
        document.querySelectorAll('[data-state="error"] .state__meta').forEach((el) => el.remove());
    };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true });
  }, MUTATE);
}

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => `${document.title}\n${document.body.innerText}`);
}

async function scanAndRecord(page: Page, lang: Lang, s: AxeScreen, state: string, note: string, project: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const text = await visibleText(page);
  const hits = scanTerms(text);
  results.push({ route: s.route, state, lang, chars: text.length, hits, note });
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${project}--${s.name}--${state}.jpeg`), type: "jpeg", quality: 40 });
  expect(hits, `${s.route} [${state}, ${lang}]: §8 terms in the visible text`).toEqual([]);
  expect(text.length, `${s.route} [${state}]: the screen rendered text`).toBeGreaterThan(20);
  await expectAccessible(page, lang, `qa-f/${s.name}/${state}`);
}

for (const s of NON_ADMIN) {
  test.describe(`${s.route} (${s.name})`, () => {
    test("normal: no stack trace or infrastructure term", async ({ page }, info) => {
      const lang = langOf(info);
      const foreign = trackRequests(page);
      await signIn(page, lang, userFor(s));
      await installMutant(page);
      const { url, unknown } = fill(s.route);
      const note = unknown.length
        ? `no SYNTHETIC record for :${unknown.join(", :")} on this stack: opened with an unknown id, the state it shows is scanned`
        : s.route === "/walkthrough"
          ? "not a demo database: the walkthrough's not-demo state is scanned"
          : "SYNTHETIC fixture";
      if (note !== "SYNTHETIC fixture") test.info().annotations.push({ type: "scanned-as", description: note });
      await page.goto(url);
      await expect(page.locator("main#main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scanAndRecord(page, lang, s, "normal", note, info.project.name);
      expect(foreign, "requests outside the application origin").toEqual([]);
    });

    test("forced 500: the generic error state with its request id only", async ({ page }, info) => {
      const lang = langOf(info);
      const foreign = trackRequests(page);
      await signIn(page, lang, userFor(s));
      await installMutant(page);
      const refs: string[] = [];
      await force500(page, refs);
      await page.goto(fill(s.route).url);
      const errorState = page.locator('[data-state="error"]').first();
      await expect(errorState).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState("networkidle");
      // The generic text of a server error in the page's language, never the server's title or detail.
      await expect(errorState).toContainText(tr(lang, "common.state.errorTitle"));
      // "with its request id": one of the references the forced answers carried is shown.
      expect(refs.length, "the screen requested data").toBeGreaterThan(0);
      const shown = await page.locator('[data-state="error"] bdi').allInnerTexts();
      expect(
        shown.some((t) => refs.includes(t.trim())),
        `a request reference is shown (got ${JSON.stringify(shown)})`,
      ).toBe(true);
      await scanAndRecord(page, lang, s, "500", `${refs.length} forced 500 answers`, info.project.name);
      expect(foreign, "requests outside the application origin").toEqual([]);
    });

    test("network failure: the error state with the network text", async ({ page }, info) => {
      const lang = langOf(info);
      const foreign = trackRequests(page);
      await signIn(page, lang, userFor(s));
      await installMutant(page);
      await forceNetworkFailure(page);
      await page.goto(fill(s.route).url);
      const errorState = page.locator('[data-state="error"]').first();
      await expect(errorState).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState("networkidle");
      await expect(errorState).toContainText(tr(lang, "problems.network"));
      await scanAndRecord(page, lang, s, "network", "requests aborted (no response)", info.project.name);
      expect(foreign, "requests outside the application origin").toEqual([]);
    });
  });
}
