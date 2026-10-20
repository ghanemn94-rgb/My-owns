// qa-verifier DG5 round 4 (T-DG5-REV-QA-R4C): DB-FREE substitute for the browser reflow checks of F-DG5-144, used only
// because this run's sandbox cannot start PostgreSQL (docs/delivery/test-evidence/DG5/qa/round-4/03-sandbox-userns-blocker.log).
// NOT part of the candidate: copied into a disposable clone's apps/web/src/ for the run only, then removed.
// It renders the REAL components in jsdom against a scripted API (the same fixtures as p2.test.tsx; SYNTHETIC data):
//  - the Diagnose screen (/transformations/<T>/diagnose) with one finding in every workstream, one statement a
//    120-character word without spaces and one a long Arabic statement, in en and ar;
//  - the 409 ConflictPanel (components/States.tsx) with a compare table whose values include the same long word,
//    in en and ar, with the catalogue's own field labels;
// and writes each document's <html> (lang, dir and body) to $QA_DUMP_DIR. zz-qa-r4-layout.mjs then lays each dump out in
// the pre-installed Chromium with the candidate's BUILT stylesheet (apps/web/dist/assets/*.css) and measures it. jsdom
// does no layout, so nothing is asserted here beyond the set-up (the cards and the table rendered).
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "./app/App.tsx";
import { ConflictPanel } from "./components/States.tsx";
import { createI18n } from "./i18n/index.ts";
import { BUSINESS_UNIT, ORG_ID, TR_ID, USER_ID, makeMe, makeTransformation, mockApi, renderApp, route, type Handler } from "./test/fixtures.tsx";
import { METHODOLOGY, leadGrants } from "./test/p2fixtures.ts";

const OUT = process.env["QA_DUMP_DIR"] ?? path.join(process.cwd(), "qa-r4-dumps");
const LONG_WORD = `Synthetic_${"ABCDEFGHIJ".repeat(11)}`;
const LONG_AR = "اصطناعي: تراجع رضا المسافرين بسبب صدمة فواتير التجوال وتأخر تفعيل الباقات في التطبيق ومراكز الخدمة";
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const T = "2026-09-30T09:00:00Z";
let n = 0;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dump(name: string) {
  mkdirSync(OUT, { recursive: true });
  const html = document.documentElement;
  writeFileSync(
    path.join(OUT, `${name}.html`),
    `<!doctype html>\n<html lang="${html.lang}" dir="${html.dir}"><head><meta charset="utf-8"></head>${document.body.outerHTML}</html>`,
  );
}

function finding(workstreamCode: string, statement: string) {
  return {
    id: `01920000-0000-7000-c000-${String(++n).padStart(12, "0")}`,
    organizationId: ORG_ID,
    transformationId: TR_ID,
    version: 1,
    createdAt: T,
    createdBy: USER_ID,
    updatedAt: T,
    updatedBy: USER_ID,
    workstreamCode,
    diagnosticItemId: null,
    kind: "root_cause",
    statement,
    detail: null,
    confidence: "M",
    ownerUserId: USER_ID,
    status: "confirmed",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
  };
}

describe.each(["en", "ar"] as const)("qa r4 DOM dump (%s)", (locale) => {
  it("Diagnose with a finding in every workstream", async () => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    const statements = [`Synthetic finding ${LONG_WORD}`, LONG_AR, "Synthetic: order fallout between the CRM and billing hand-off"];
    const findings = METHODOLOGY.diagnosticWorkstreams.map((w, i) => finding(w.code, statements[i % statements.length]!));
    const handlers: Handler[] = [
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(leadGrants(), { preferredLocale: locale }) })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation({ currentPhase: "diagnose", entryPhase: null }) })),
      route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
      route("GET", new RegExp(`${esc(TR)}/diagnostic-findings(\\?|$)`), () => page(findings)),
      (req) =>
        req.method === "GET" &&
        /\/api\/v1\/(transformations\/[^/]+\/[a-z-]+(\/[^/]+\/[a-z-]+)?|decisions)(\?|$)/.test(req.url) &&
        !/\/(tom-canvas|gates|charter|north-star|methodology)(\?|$)/.test(req.url)
          ? page([])
          : undefined,
    ];
    mockApi(...handlers);
    renderApp(`/transformations/${TR_ID}/diagnose`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelectorAll("article.workstream").length).toBe(METHODOLOGY.diagnosticWorkstreams.length), {
      timeout: 15000,
    });
    await screen.findAllByText(new RegExp(LONG_WORD), undefined, { timeout: 15000 });
    await waitFor(() => expect(document.querySelectorAll("article.workstream .table-wrap").length).toBeGreaterThan(0), { timeout: 15000 });
    dump(`diagnose-${locale}`);
  }, 60_000);

  it("the 409 conflict panel with long values", async () => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    const i18n = createI18n(locale);
    await i18n.changeLanguage(locale);
    const t = i18n.t.bind(i18n);
    const rows = [
      { field: "name", label: t("transformations.field.name"), mine: `${locale === "ar" ? LONG_AR : "My edit"} ${LONG_WORD}`, current: "Synthetic name" },
      { field: "description", label: t("transformations.field.description"), mine: "—", current: `Concurrent ${LONG_WORD} ${LONG_AR}` },
      { field: "mode", label: t("transformations.field.mode"), mine: t("common.value.none"), current: t("common.value.unknown") },
    ];
    render(
      <AppProviders i18n={i18n} queryClient={new QueryClient()}>
        <main id="main" className="main">
          <ConflictPanel yourVersion={1} currentVersion={2} rows={rows} onReapply={() => {}} onDiscard={() => {}} />
        </main>
      </AppProviders>,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-state='conflict'] tbody tr").length).toBe(3));
    dump(`conflict-${locale}`);
  });
});
