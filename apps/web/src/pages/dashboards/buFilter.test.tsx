// F-DG4-144 (D-127; ADR-0037 §4; REQ-S13-002): the business-unit chip's 'more than 50 transformations' note names
// remedies that work. The unit's transformation list (DG1 listTransformations, which takes `phase` and `status` with the
// dashboards' meaning) is narrowed by the phase and status chips BEFORE the 50-transformation limit, so narrowing as the
// note advises lifts the block when 50 or fewer remain. The transformation chip, the note's other remedy, is
// intersected with the unit through the caller's full readable list, so a transformation beyond the unit's first 51
// still reaches the request. On the Executive Overview, Finance and adoption dashboards (one shared hook), in English and
// Arabic, with mocked responses. SYNTHETIC data.
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { BU_ID, mockApi, renderApp, route, type RecordedRequest } from "../../test/fixtures.tsx";
import { json, p4Handlers } from "../my-work/p4fixtures.ts";
import { executiveOverview, financeDashboard } from "./dashboardFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tid = (n: number) => `01920000-0000-7000-9000-${(0xa00000000 + n).toString(16).padStart(12, "0")}`;
/** 120 readable transformations in the unit; only #7 and #8 are in Realize, and only #8 is closed. */
const UNIT = Array.from({ length: 120 }, (_, n) => ({
  id: tid(n),
  code: `TR-${String(n).padStart(4, "0")}`,
  name: `Synthetic unit transformation ${n}`,
  businessUnitId: BU_ID,
  currentPhase: n === 7 || n === 8 ? "realize" : "diagnose",
  status: n === 8 ? "closed" : "active",
}));
const BEYOND = UNIT[100]!; // never on the unit's first page of 51

/** listTransformations, filtered as the server does (businessUnitId, phase, status), paged by `limit`. */
function listTransformations(req: RecordedRequest) {
  if (req.method !== "GET" || !/^\/api\/v1\/transformations\?/.test(req.url)) return undefined;
  const q = new URLSearchParams(req.url.split("?")[1]);
  const bu = q.get("businessUnitId");
  const phase = q.get("phase");
  const statuses = q.getAll("status");
  const limit = Number(q.get("limit") ?? "50");
  const rows = UNIT.filter(
    (r) =>
      (!bu || r.businessUnitId === bu) &&
      (!phase || r.currentPhase === phase) &&
      (statuses.length === 0 || statuses.includes(r.status)),
  );
  const from = Number(q.get("cursor") ?? "0");
  return json({
    items: rows.slice(from, from + limit),
    nextCursor: rows.length > from + limit ? String(from + limit) : null,
  });
}

const SURFACES = {
  overview: { path: "/executive-overview", api: /^\/api\/v1\/overview\?/ },
  finance: { path: "/dashboards/finance", api: /^\/api\/v1\/dashboards\/finance\?/ },
  adoption: { path: "/dashboards/adoption", api: /^\/api\/v1\/dashboards\/adoption\?/ },
} as const;

function setup(locale: "en" | "ar", surface: keyof typeof SURFACES, search: string) {
  const s = SURFACES[surface];
  const api = mockApi(
    ...p4Handlers(
      locale,
      [],
      [
        listTransformations,
        route("GET", /^\/api\/v1\/overview\?/, () => json(executiveOverview())),
        route("GET", /^\/api\/v1\/dashboards\/finance\?/, () => json(financeDashboard())),
      ],
    ),
  );
  renderApp(`${s.path}?${search}`, { i18n: createI18n(locale) });
  const dashboardRequests = () =>
    api.requests.filter((r) => s.api.test(r.url)).map((r) => new URLSearchParams(r.url.split("?")[1]));
  const unitListRequests = () =>
    api.requests
      .filter((r) => /^\/api\/v1\/transformations\?/.test(r.url) && r.url.includes("businessUnitId="))
      .map((r) => new URLSearchParams(r.url.split("?")[1]));
  return { dashboardRequests, unitListRequests };
}

describe.each(["en", "ar"] as const)(
  "business-unit chip and its 50-transformation limit (F-DG4-144) (%s)",
  (locale) => {
    const t = createI18n(locale).t;

    it("the too_many note names only remedies that work: phase or status until 50 or fewer, the transformation chip, the own dashboards", () => {
      const text = t("dashboards.filter.blocked.too_many");
      expect(text).toContain("50");
      if (locale === "en") {
        expect(text).toMatch(/phase or status until 50 or fewer remain/);
        expect(text).toContain(t("dashboards.filter.transformation").toLowerCase());
      } else {
        expect(text).toContain("المرحلة أو الحالة حتى يبقى 50 أو أقل");
        expect(text).toContain(t("dashboards.filter.transformation"));
      }
    });

    it.each(Object.keys(SURFACES) as (keyof typeof SURFACES)[])(
      "%s: a unit of 120 is blocked (too_many), and no dashboard request is sent",
      async (surface) => {
        const { dashboardRequests } = setup(locale, surface, `bu=${BU_ID}`);
        const note = await waitFor(() => {
          const el = document.querySelector("[data-filter-blocked='too_many']");
          expect(el).not.toBeNull();
          return el!;
        });
        expect(note.textContent).toContain(t("dashboards.filter.blocked.too_many"));
        expect(dashboardRequests().filter((q) => q.has("transformationId"))).toHaveLength(0);
      },
    );

    it.each(Object.keys(SURFACES) as (keyof typeof SURFACES)[])(
      "%s: narrowing by phase, as the note advises, lifts the block: the unit list is read with phase, and the dashboard gets the 2 left",
      async (surface) => {
        const { dashboardRequests, unitListRequests } = setup(locale, surface, `bu=${BU_ID}&phase=realize`);
        await waitFor(() => expect(dashboardRequests().some((q) => q.has("transformationId"))).toBe(true));
        expect(unitListRequests().some((q) => q.get("phase") === "realize")).toBe(true);
        const q = dashboardRequests().find((x) => x.has("transformationId"))!;
        expect(q.getAll("transformationId").sort()).toEqual([tid(7), tid(8)].sort());
        expect(q.get("phase")).toBe("realize");
        expect(document.querySelector("[data-filter-blocked]")).toBeNull();
      },
    );

    it("phase and status together narrow the list (status sent to the list read); one left is requested", async () => {
      const { dashboardRequests, unitListRequests } = setup(
        locale,
        "overview",
        `bu=${BU_ID}&phase=realize&status=closed`,
      );
      await waitFor(() => expect(dashboardRequests().some((q) => q.has("transformationId"))).toBe(true));
      expect(unitListRequests().some((q) => q.get("phase") === "realize" && q.get("status") === "closed")).toBe(true);
      expect(
        dashboardRequests()
          .find((x) => x.has("transformationId"))!
          .getAll("transformationId"),
      ).toEqual([tid(8)]);
      expect(document.querySelector("[data-filter-blocked]")).toBeNull();
    });

    it("a narrowing that leaves none says so (none_matching), never 'you cannot read any', and sends no request", async () => {
      const { dashboardRequests } = setup(locale, "overview", `bu=${BU_ID}&phase=sustain`);
      const note = await screen.findByText(t("dashboards.filter.blocked.none_matching"), { exact: false });
      expect(note.closest("[data-filter-blocked]")!.getAttribute("data-filter-blocked")).toBe("none_matching");
      expect(document.body.textContent).not.toContain(t("dashboards.filter.blocked.none"));
      expect(document.querySelector("[data-filter-blocked='too_many']")).toBeNull();
      expect(dashboardRequests().filter((q) => q.has("transformationId"))).toHaveLength(0);
    });

    it("the transformation chip lifts the block, also for a transformation beyond the unit's first 51", async () => {
      const { dashboardRequests } = setup(locale, "overview", `bu=${BU_ID}&tr=${BEYOND.id}`);
      await waitFor(() => expect(dashboardRequests().some((q) => q.has("transformationId"))).toBe(true));
      expect(
        dashboardRequests()
          .find((x) => x.has("transformationId"))!
          .getAll("transformationId"),
      ).toEqual([BEYOND.id]);
      expect(document.querySelector("[data-filter-blocked]")).toBeNull();
    });

    it("a transformation chip outside the unit sends no request (none_matching), never 'all'", async () => {
      const other = "01920000-0000-7000-9000-0000000fffff";
      const { dashboardRequests } = setup(locale, "overview", `bu=${BU_ID}&tr=${other}`);
      await waitFor(() => expect(document.querySelector("[data-filter-blocked='none_matching']")).not.toBeNull());
      expect(dashboardRequests().filter((q) => q.has("transformationId"))).toHaveLength(0);
    });
  },
);
