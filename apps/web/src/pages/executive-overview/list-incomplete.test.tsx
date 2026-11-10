// F-DG5-125 (ADR-0061 §9; T-DG6-FE-G): `fetchAllPages` never stops silently at its page cap (20 pages of 100). The
// Executive Overview transformation filter and the organization Finance queue either load every readable
// transformation, or show the plain notice "This list is incomplete: showing the first N of more than N." (en and ar)
// with N the number loaded. With 2,150 readable transformations in the mocked API, both screens show the notice with
// N = 2000; with 1,500 they offer all 1,500 and show no notice. SYNTHETIC data; mocked responses.
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { fetchPages } from "../../api/queries.ts";
import { createI18n } from "../../i18n/index.ts";
import { BU_ID, mockApi, problem, renderApp, type RecordedRequest } from "../../test/fixtures.tsx";
import { executiveOverview } from "../dashboards/dashboardFixtures.ts";
import { json, p4Handlers } from "../my-work/p4fixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tid = (n: number) => `01920000-0000-7000-9000-${(0xb00000000 + n).toString(16).padStart(12, "0")}`;
const transformations = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    id: tid(n),
    organizationId: "01920000-0000-7000-9000-000000000001",
    code: `TR-${String(n).padStart(4, "0")}`,
    name: `Synthetic transformation ${n}`,
    businessUnitId: BU_ID,
    currentPhase: "diagnose",
    status: "active",
    archivedAt: null,
  }));

/** listTransformations, paged by `limit` and a numeric cursor, as the server pages it. */
function listTransformations(rows: readonly unknown[]) {
  return (req: RecordedRequest) => {
    if (req.method !== "GET" || !/^\/api\/v1\/transformations\?/.test(req.url)) return undefined;
    const q = new URLSearchParams(req.url.split("?")[1]);
    const limit = Number(q.get("limit") ?? "50");
    const from = Number(q.get("cursor") ?? "0");
    return json({
      items: rows.slice(from, from + limit),
      nextCursor: rows.length > from + limit ? String(from + limit) : null,
    });
  };
}

function setup(locale: "en" | "ar", path: string, count: number) {
  const permissions: Permission[] = ["organization.read", "transformation.read", "finance.validate"];
  const api = mockApi(
    ...p4Handlers(locale, permissions, [
      listTransformations(transformations(count)),
      // The Finance page's portfolio totals panel is outside this check: refused, so it renders its own state.
      (req) => (/\/organizations\/[^/]+\/benefit-totals/.test(req.url) ? problem(403, "forbidden") : undefined),
      (req) => (/^\/api\/v1\/overview\?/.test(req.url) ? json(executiveOverview()) : undefined),
    ]),
  );
  renderApp(path, { i18n: createI18n(locale) });
  return api;
}

describe("fetchPages", () => {
  it("reads every page and says the list is complete; stops at the cap of 20 pages and says it is not", async () => {
    mockApi(listTransformations(transformations(2150)));
    const capped = await fetchPages("/api/v1/transformations", { organizationId: "x" });
    expect(capped.items).toHaveLength(2000);
    expect(capped.complete).toBe(false);
    vi.unstubAllGlobals();
    mockApi(listTransformations(transformations(1500)));
    const all = await fetchPages("/api/v1/transformations", { organizationId: "x" });
    expect(all.items).toHaveLength(1500);
    expect(all.complete).toBe(true);
  });
});

describe.each(["en", "ar"] as const)("the page cap is never silent (F-DG5-125) (%s)", (locale) => {
  const t = createI18n(locale).t;
  const notice = t("common.table.listIncomplete", { n: 2000 });

  it("the notice reads in the page language with N = 2000", () => {
    expect(notice).toBe(
      locale === "en"
        ? "This list is incomplete: showing the first 2000 of more than 2000."
        : "هذه القائمة غير مكتملة: يُعرض أول 2000 من أكثر من 2000.",
    );
  });

  it("Executive Overview: 2,150 readable transformations give 2,000 options and the notice with N = 2000", async () => {
    setup(locale, "/executive-overview", 2150);
    const el = await screen.findByText(notice, {}, { timeout: 20_000 });
    expect(el.closest("[data-state='list-incomplete']")).not.toBeNull();
    const select = document.querySelector<HTMLSelectElement>("select[data-filter='transformation']")!;
    expect(select.options).toHaveLength(2000 + 1); // the "add a transformation" prompt + the 2,000 loaded
    expect(select.getAttribute("aria-describedby")).toContain(el.closest("[id]")!.id);
  }, 30_000);

  it("Executive Overview: 1,500 readable transformations are all offered, with no notice", async () => {
    setup(locale, "/executive-overview", 1500);
    await waitFor(
      () =>
        expect(document.querySelector<HTMLSelectElement>("select[data-filter='transformation']")?.options).toHaveLength(
          1500 + 1,
        ),
      { timeout: 20_000 },
    );
    expect(document.querySelector("[data-state='list-incomplete']")).toBeNull();
  }, 30_000);

  it("Finance queue: 2,150 readable transformations show the notice with N = 2000; only the 2,000 are queried", async () => {
    const api = setup(locale, "/finance-validation", 2150);
    const el = await screen.findByText(notice, {}, { timeout: 25_000 });
    expect(el.closest("[data-state='list-incomplete']")).not.toBeNull();
    const queues = new Set(
      api.requests
        .filter((r) => /\/finance-validations/.test(r.url))
        .map((r) => r.url.split("/finance-validations")[0]),
    );
    expect(queues.size).toBe(2000);
  }, 40_000);

  it("Finance queue: 1,500 readable transformations show no notice", async () => {
    const api = setup(locale, "/finance-validation", 1500);
    await waitFor(
      () =>
        expect(
          new Set(api.requests.filter((r) => /\/finance-validations/.test(r.url)).map((r) => r.url.split("?")[0])).size,
        ).toBe(1500),
      { timeout: 25_000 },
    );
    await waitFor(() => expect(screen.queryByText(t("common.state.loading"))).toBeNull(), { timeout: 25_000 });
    expect(document.querySelector("[data-state='list-incomplete']")).toBeNull();
  }, 40_000);
});
