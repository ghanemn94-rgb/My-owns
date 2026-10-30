// T-DG6-FE-F2 (REQ-S15-001; ADR-0061 §4.1): the home page's three "at a glance" regions, in English and Arabic, on
// mocked API responses (SYNTHETIC data). Each region is role="region" with its catalogue name, unique on the page; it
// shows only what getMyWork returned, or its designed empty state (never a blank), a busy note while loading, and an
// "unavailable" note when the read fails. The layout above the fold at 1440 × 900 is proven on the real stack
// (apps/web/e2e/p6-layout-1440.spec.ts; QA-D's A20).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyWork } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { myWork } from "../dashboards/dashboardFixtures.ts";
import { json, p4Handlers } from "./p4fixtures.ts";
import { FE_F2_PROVISIONAL_ARABIC } from "./provisional-ar.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REGIONS = [
  ["decisions", "myWork.home.decisions.title"],
  ["outcomes", "myWork.home.outcomes.title"],
  ["next-actions", "myWork.home.nextActions.title"],
] as const;

function empty(): MyWork {
  const d = myWork();
  return {
    ...d,
    sections: d.sections.map((s) => ({ ...s, total: 0, items: [] })),
    upcomingDeadlines: [],
  };
}

describe.each(["en", "ar"] as const)("My Work: key decisions, key outcomes, next actions (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("renders the three named regions first, each once, from getMyWork", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work$/, () => json(myWork()))]));
    renderApp("/my-work", { i18n: createI18n(locale) });
    for (const [kind, key] of REGIONS) {
      const region = await screen.findByRole("region", { name: t(key) });
      expect(region.getAttribute("data-glance-region")).toBe(kind);
      expect(screen.getAllByRole("region", { name: t(key) })).toHaveLength(1);
    }
    // The band is the first content after the header: before the deadlines and the sections.
    const band = document.querySelector("[data-glance-band='my-work']")!;
    const deadlines = document.getElementById("mw-deadlines");
    await waitFor(() => expect(document.getElementById("mw-deadlines")).not.toBeNull());
    expect(band.compareDocumentPosition(deadlines ?? document.getElementById("mw-deadlines")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Decisions: none waiting -> the designed empty state.
    const decisions = screen.getByRole("region", { name: t("myWork.home.decisions.title") });
    await waitFor(() => expect(within(decisions).getByText(t("myWork.home.decisions.empty"))).toBeTruthy());
    // Outcomes: the KPI update owed (1), with its link and the overdue cue (icon + text, not colour alone).
    const outcomes = screen.getByRole("region", { name: t("myWork.home.outcomes.title") });
    expect(outcomes.querySelector("[data-glance-count='missing_updates']")!.getAttribute("data-total")).toBe("1");
    expect(within(outcomes).getByText(t("myWork.home.outcomes.owed", { count: 1 }))).toBeTruthy();
    const link = within(outcomes).getByRole("link", { name: /Synthetic churn rate/ });
    expect(link.getAttribute("href")).toMatch(/\/kpis\/.+\/actuals$/);
    const overdue = outcomes.querySelector("[data-overdue='true']")!;
    expect(overdue.querySelector(".icon")).not.toBeNull();
    expect(overdue.textContent).toContain(t("dashboards.myWork.overdue"));
    // Next actions: the upcoming deadline (the same KPI update), with its section link.
    const next = screen.getByRole("region", { name: t("myWork.home.nextActions.title") });
    expect(next.querySelectorAll("[data-glance-list='next-actions'] li")).toHaveLength(1);
    expect(
      within(next)
        .getByRole("link", {
          name: t("myWork.home.showSection", { section: t("dashboards.myWork.section.assigned_actions") }),
        })
        .getAttribute("href"),
    ).toBe("#mw-assigned_actions");
  });

  it("an empty My Work shows each region's designed empty state, never a blank region", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work$/, () => json(empty()))]));
    renderApp("/my-work", { i18n: createI18n(locale) });
    for (const [kind, key] of [
      ["decisions", "myWork.home.decisions.empty"],
      ["outcomes", "myWork.home.outcomes.empty"],
      ["next-actions", "myWork.home.nextActions.empty"],
    ] as const) {
      await waitFor(() =>
        expect(document.querySelector(`[data-glance-region='${kind}'] [data-state='glance-empty']`)?.textContent).toBe(
          t(key),
        ),
      );
    }
  });

  it("a failed read shows 'unavailable' in each region, not an empty state or a zero", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work$/, () => problem(500, "internal"))]));
    renderApp("/my-work", { i18n: createI18n(locale) });
    await waitFor(
      () => expect(document.querySelectorAll("[data-glance-region] [data-state='glance-unavailable']")).toHaveLength(3),
      { timeout: 15_000 },
    );
    expect(document.querySelectorAll("[data-glance-region] [data-state='glance-empty']")).toHaveLength(0);
    expect(document.querySelectorAll("[data-glance-count]")).toHaveLength(0);
  });

  it("while loading, each region shows a busy note (no live region on the landing page)", async () => {
    const { fetchMock } = mockApi(
      ...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work$/, () => json(myWork()))]),
    );
    const answer = fetchMock.getMockImplementation()!;
    // getMyWork never answers: the regions stay in their pending state.
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/api/v1/me/work") ? new Promise<Response>(() => {}) : answer(input, init),
    );
    renderApp("/my-work", { i18n: createI18n(locale) });
    await waitFor(() =>
      expect(document.querySelectorAll("[data-glance-region] [data-state='loading'][aria-busy='true']")).toHaveLength(
        3,
      ),
    );
    expect(document.querySelectorAll("[data-glance-region] [role='status']")).toHaveLength(0);
  });
});

describe("the region texts (provisional Arabic, labelled in provisional-ar.ts)", () => {
  /** Every string leaf under `prefix` in one language's catalogue, keyed by its path. */
  function leaves(locale: "en" | "ar", prefix: string): Map<string, string> {
    const i18n = createI18n(locale);
    let node: unknown = i18n.getResourceBundle(locale, "translation");
    const rest = prefix.replace(/\.$/, "").split(".");
    for (const k of rest) node = (node as Record<string, unknown>)[k];
    const out = new Map<string, string>();
    const walk = (n: unknown, path: string) => {
      if (typeof n === "string") out.set(path, n);
      else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(node, prefix.replace(/\.$/, ""));
    return out;
  }

  it("every listed Arabic text exists, is Arabic and differs from the English; en and ar have the same keys", () => {
    for (const prefix of Object.keys(FE_F2_PROVISIONAL_ARABIC)) {
      const en = leaves("en", prefix);
      const ar = leaves("ar", prefix);
      expect(en.size, prefix).toBeGreaterThan(0);
      expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
      for (const [k, v] of ar) {
        expect(v, k).toMatch(/[؀-ۿ]/);
        expect(v, k).not.toBe(en.get(k));
        expect(v, k).not.toMatch(/\bDG[0-7]\b/);
      }
    }
  });
});
