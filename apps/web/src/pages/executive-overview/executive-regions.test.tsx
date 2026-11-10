// T-DG6-FE-F2 (REQ-S15-001; ADR-0061 §4.1): the executive page's three "at a glance" regions, in English and Arabic,
// on mocked API responses (SYNTHETIC data). They show only what getExecutiveOverview returned: the Decisions and
// Outcomes areas' status (icon + label) and headlines, and the dated open decisions and blockers, earliest first.
// Unknown and Stale stay Unknown and Stale, never 0 or green; an empty list shows its designed empty state. The layout
// above the fold at 1440 × 900 is proven on the real stack (apps/web/e2e/p6-layout-1440.spec.ts; QA-D's A20).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { ExecutiveOverview } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { mockApi, problem, renderApp } from "../../test/fixtures.tsx";
import { executiveOverview } from "../dashboards/dashboardFixtures.ts";
import { json, p4Handlers } from "../my-work/p4fixtures.ts";
import { nextActionItems } from "./ExecutiveRegions.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERMISSIONS: Permission[] = ["organization.read", "transformation.read"];

function setup(locale: "en" | "ar", overview: ExecutiveOverview | null) {
  mockApi(
    ...p4Handlers(locale, PERMISSIONS, [
      (req) =>
        /^\/api\/v1\/overview\?/.test(req.url) ? (overview ? json(overview) : problem(500, "internal")) : undefined,
    ]),
  );
  renderApp("/executive-overview", { i18n: createI18n(locale) });
}

describe.each(["en", "ar"] as const)("Executive Overview: key decisions, outcomes, next actions (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("renders the three named regions above the filters, each once, from the overview response", async () => {
    setup(locale, executiveOverview());
    const decisions = await screen.findByRole("region", { name: t("myWork.home.decisions.title") });
    const outcomes = screen.getByRole("region", { name: t("myWork.home.outcomes.title") });
    const next = screen.getByRole("region", { name: t("myWork.home.nextActions.title") });
    for (const key of ["decisions", "outcomes", "nextActions"])
      expect(screen.getAllByRole("region", { name: t(`myWork.home.${key}.title`) })).toHaveLength(1);
    // Above the filters (the band precedes the filter bar in the document).
    const filters = await within(document.querySelector("main")!).findByRole("search");
    expect(document.querySelector("[data-glance-band='executive-overview']")!.compareDocumentPosition(filters)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Decisions: the server's Red status with its icon and label, and the overdue headline.
    await waitFor(() => expect(decisions.querySelector("[data-glance-rag='red']")).not.toBeNull());
    const chip = decisions.querySelector("[data-glance-area='decisions'] .status-chip")!;
    expect(chip.querySelector(".icon")).not.toBeNull();
    expect(chip.textContent).toContain(t("dashboards.rag.red"));
    expect(decisions.querySelector("[data-glance-metric='decisions.overdue']")!.textContent).toContain("1");
    // Outcomes: Unknown stays Unknown (icon + label), never green and never 0.
    expect(outcomes.querySelector("[data-glance-rag='unknown']")).not.toBeNull();
    expect(outcomes.querySelector("[data-rag='green']")).toBeNull();
    const kpis = outcomes.querySelector("[data-glance-metric='outcomes.area']")!;
    expect(kpis.querySelector("[data-value-state='unknown']")).not.toBeNull();
    expect(kpis.querySelector("dd")!.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    // Next actions: the dated open decision, linked to its record.
    const items = next.querySelectorAll("[data-glance-list='next-actions'] li");
    expect(items).toHaveLength(1);
    expect(within(next).getByRole("link", { name: /Synthetic funding ask/ })).toBeTruthy();
    expect(next.querySelector("[data-due='2026-10-09']")).not.toBeNull();
  });

  it("no dated decision or blocker: the next-actions region shows its designed empty state", async () => {
    const d = executiveOverview();
    d.areas = d.areas.map((a) => ({ ...a, items: a.items.map((i) => ({ ...i, dueDate: null })) }));
    setup(locale, d);
    await waitFor(() =>
      expect(
        document.querySelector("[data-glance-region='next-actions'] [data-state='glance-empty']")?.textContent,
      ).toBe(t("myWork.home.executive.nextActions.empty")),
    );
  });

  it("a failed overview read shows 'unavailable' in each region, never a status or a number", async () => {
    setup(locale, null);
    await waitFor(
      () => expect(document.querySelectorAll("[data-glance-region] [data-state='glance-unavailable']")).toHaveLength(3),
      { timeout: 15_000 },
    );
    expect(document.querySelectorAll("[data-glance-region] [data-glance-rag]")).toHaveLength(0);
  });
});

describe("nextActionItems", () => {
  it("takes the dated decisions and dependencies only, earliest first", () => {
    const d = executiveOverview();
    const base = d.areas.find((a) => a.code === "decisions")!.items[0]!;
    const mk = (recordId: string, dueDate: string | null) => ({ ...base, recordId, dueDate });
    d.areas = d.areas.map((a) =>
      a.code === "decisions"
        ? { ...a, items: [mk("b", "2026-11-03"), mk("c", null)] }
        : a.code === "dependencies"
          ? { ...a, items: [mk("a", "2026-11-01")] }
          : a.code === "portfolio"
            ? { ...a, items: [mk("z", "2026-01-01")] }
            : a,
    );
    expect(nextActionItems(d).map((x) => x.item.recordId)).toEqual(["a", "b"]);
  });
});
