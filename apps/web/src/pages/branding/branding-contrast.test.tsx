// Branding Settings and the contrast rule (T-DG6-FE-F; ADR-0061 §1, §5, §6, §7.3; REQ-S15-003, REQ-S15-007), in English
// and Arabic, against the mocked API (SYNTHETIC data):
//  - a publish refused with 422 branding.contrast_insufficient shows ONE form-level alert: the translated refusal and,
//    inside it, each failing pair (the translated pair code and the language-neutral "<fg> / <bg> | <use> | <ratio>:1 <
//    <threshold>:1" in an LTR isolate); the colour field the pair resolves through shows the pair code;
//  - the "Contrast report" section reads getBrandingVersionContrast for the current version and for a version chosen in
//    the versions table; a `not_recorded` version whose colours fail shows the warning to publish corrected colours,
//    a `recorded` one does not;
//  - a user without branding.configure (AUD, a transformation lead) gets the no-permission state and no form.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = "en" | "ar";
const LANGS: readonly Lang[] = ["en", "ar"];
const C = (l: Lang) => catalogues[l].explanations.contrast;
const PROBLEMS = (l: Lang) => catalogues[l].problems as unknown as Record<string, string>;
const B = (l: Lang) => catalogues[l].playbookP5.branding;

const meRoute = (lang: Lang, permissions: Permission[]) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions }], {
      preferredLocale: lang,
    }),
  }));
const ADMIN: Permission[] = ["organization.read", "branding.configure"];

const settings = (over: Record<string, unknown> = {}) => ({
  versionNo: 2,
  source: "configured",
  productNameEn: "Mobily Transformation Hub",
  productNameAr: "منصة موبايلي للتحوّل",
  primaryColour: "#0078FF",
  secondaryColour: "#003B73",
  coloursProvisional: true,
  fontLatin: "IBM Plex Sans",
  fontArabic: "IBM Plex Sans Arabic",
  logo: null,
  wordmarkProvisional: true,
  reportHeaderEn: null,
  reportHeaderAr: null,
  reportFooterEn: null,
  reportFooterAr: null,
  colourApprovalReference: null,
  version: 2,
  updatedAt: "2026-10-01T09:00:00.000Z",
  updatedBy: null,
  ...over,
});
const version = (n: number, primary: string) => ({
  versionNo: n,
  productNameEn: "Mobily Transformation Hub",
  productNameAr: "منصة موبايلي للتحوّل",
  primaryColour: primary,
  secondaryColour: "#003B73",
  coloursProvisional: true,
  colourApprovalReference: null,
  changeNote: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  createdBy: "00000000-0000-4000-8000-000000000001",
});
const pair = (ordinal: number, fg: string, bg: string, ratio: string, pass: boolean) => ({
  ordinal,
  fg,
  bg,
  use: "text" as const,
  fgHex: "#FFFFFF",
  bgHex: "#FFD700",
  ratio,
  threshold: "4.5",
  pass,
});
const report = (n: number, status: "recorded" | "not_recorded", failing: number) => ({
  versionNo: n,
  status,
  rules: "wcag2x-aa-v1",
  tokenSourceSha256: status === "recorded" ? "a".repeat(64) : null,
  recordedAt: status === "recorded" ? "2026-10-01T09:00:00.000Z" : null,
  pairCount: 2,
  failingCount: failing,
  pairs: [
    pair(1, "text.inverse", "action.primary", failing > 0 ? "1.40" : "5.12", failing === 0),
    pair(2, "text.primary", "surface.card", "15.80", true),
  ],
});

const MSG_1 = "text.inverse / action.primary | text | 1.40:1 < 4.5:1";
const MSG_2 = "text.inverse / nav.background | text | 1.40:1 < 4.5:1";

function routes(lang: Lang, onPut?: () => { status: number; body?: unknown }) {
  return [
    meRoute(lang, ADMIN),
    route("GET", /\/api\/v1\/admin\/branding$/, () => ({ status: 200, body: settings() })),
    route("GET", /\/api\/v1\/admin\/branding\/versions\?|\/api\/v1\/admin\/branding\/versions$/, () => ({
      status: 200,
      body: { items: [version(2, "#0078FF"), version(1, "#FFD700")], nextCursor: null },
    })),
    route("GET", /\/api\/v1\/admin\/branding\/versions\/2\/contrast$/, () => ({
      status: 200,
      body: report(2, "recorded", 0),
    })),
    route("GET", /\/api\/v1\/admin\/branding\/versions\/1\/contrast$/, () => ({
      status: 200,
      body: report(1, "not_recorded", 1),
    })),
    route("PUT", /\/api\/v1\/admin\/branding$/, () =>
      onPut
        ? onPut()
        : problem(422, "branding.contrast_insufficient", {
            errors: [
              { pointer: "/primaryColour", code: "branding.contrast_pair_below_threshold", message: MSG_1 },
              { pointer: "/primaryColour", code: "branding.contrast_pair_below_threshold", message: MSG_2 },
            ],
          }),
    ),
  ];
}

describe("Branding Settings: the contrast refusal (ADR-0061 §6, §7.3)", () => {
  for (const lang of LANGS)
    it(`${lang}: one form-level alert with the translated refusal and each failing pair in an LTR isolate`, async () => {
      const { requests } = mockApi(...routes(lang));
      renderApp("/admin/branding", { i18n: createI18n(lang) });
      const primary = await screen.findByLabelText(new RegExp(B(lang).field.primaryColour.replace(/[()]/g, "\\$&")));
      fireEvent.change(primary, { target: { value: "#FFD700" } });
      fireEvent.click(screen.getByRole("button", { name: B(lang).publish }));
      const alertText = PROBLEMS(lang)["branding__contrast_insufficient"]!;
      expect(await screen.findByText(alertText, { exact: false })).toBeTruthy();
      const form = document.querySelector("form[data-form='branding']")!;
      const alerts = form.querySelectorAll("[role='alert']");
      expect([...alerts].filter((a) => a.classList.contains("banner")).length).toBe(1);
      const alert = [...alerts].find((a) => a.classList.contains("banner"))!;
      expect(alert.getAttribute("data-problem")).toBe("branding.contrast_insufficient");
      const items = alert.querySelectorAll("[data-contrast-failure]");
      expect(items.length).toBe(2);
      const pairText = PROBLEMS(lang)["branding__contrast_pair_below_threshold"]!;
      for (const [i, msg] of [MSG_1, MSG_2].entries()) {
        expect(items[i]!.textContent).toContain(pairText);
        const iso = items[i]!.querySelector("bdi")!;
        expect(iso.getAttribute("dir")).toBe("ltr");
        expect(iso.textContent).toBe(msg);
      }
      // The primary colour field names the pair code (inline, not a second alert).
      await waitFor(() => expect(document.body.textContent).toContain(pairText));
      expect(requests.filter((r) => r.method === "PUT")[0]!.headers["if-match"]).toBe('"2"');
    });
});

describe("Branding Settings: the contrast report (ADR-0061 §5)", () => {
  for (const lang of LANGS)
    it(`${lang}: the current version's recorded report, then a not_recorded failing version shows the warning`, async () => {
      const { requests } = mockApi(...routes(lang));
      renderApp("/admin/branding", { i18n: createI18n(lang) });
      const section = await screen.findByRole("heading", { name: C(lang).title, level: 2 });
      const reportSection = section.closest("section")!;
      await waitFor(() =>
        expect(reportSection.querySelector("[data-contrast-report='2']")?.getAttribute("data-contrast-status")).toBe(
          "recorded",
        ),
      );
      expect(within(reportSection).getByText(C(lang).allPass, { exact: false })).toBeTruthy();
      expect(reportSection.querySelector("[data-state='contrast-failing']")).toBeNull();
      expect(reportSection.querySelectorAll("tbody tr").length).toBe(2);
      const ratio = reportSection.querySelector(
        "tr[data-pair='text.primary/surface.card/text'] td:nth-of-type(3) bdi",
      )!;
      expect(ratio.textContent).toBe("15.80:1");
      expect(ratio.getAttribute("dir")).toBe("ltr");
      // Choose version 1 in the versions table (accessible name includes the version).
      const show = screen
        .getAllByRole("button", { name: new RegExp(C(lang).show) })
        .find((b) => b.closest("tr")?.getAttribute("data-version") === "1")!;
      fireEvent.click(show);
      await waitFor(() => expect(reportSection.querySelector("[data-contrast-report='1']")).toBeTruthy());
      const warning = reportSection.querySelector("[data-state='contrast-failing']")!;
      expect(warning.textContent).toContain(C(lang).failing);
      expect(warning.querySelector(".icon")).not.toBeNull();
      const failRow = reportSection.querySelector("tr[data-pass='no']")!;
      expect(failRow.textContent).toContain(C(lang).fail);
      expect(failRow.querySelector(".status-chip .icon")).not.toBeNull();
      expect(requests.some((r) => r.url.endsWith("/admin/branding/versions/1/contrast"))).toBe(true);
    });

  it("the English warning is exactly the work-split text", () => {
    expect(C("en").failing).toBe("The current colours fail the contrast rules; publish corrected colours.");
  });

  for (const perms of [
    ["organization.read", "audit_event.read"],
    ["organization.read", "transformation.read"],
  ] as Permission[][])
    it(`a user without branding.configure (${perms.join(", ")}) gets the no-permission state and no report`, async () => {
      const { requests } = mockApi(
        meRoute("en", perms),
        route("GET", /\/api\/v1\/admin\/branding$/, () => problem(403, "forbidden")),
      );
      renderApp("/admin/branding", { i18n: createI18n("en") });
      await waitFor(() => expect(document.querySelector("[data-state='no-permission']")).toBeTruthy());
      expect(document.querySelector("form[data-form='branding']")).toBeNull();
      expect(document.querySelector("[data-contrast-report]")).toBeNull();
      expect(requests.some((r) => r.url.includes("/contrast"))).toBe(false);
    });
});
