// Slice H screens with stubbed API responses, in English (LTR) and Arabic (RTL) (T-DG6-FE-D; ADR-0057 §3-§5, §9, §10;
// REQ-S15-010, REQ-S15-013). SYNTHETIC data. Proves:
//  - the initiative register sends its filters and sort to the API as listInitiatives query parameters and pages
//    with the server cursor (nothing filtered or sorted in the browser);
//  - filter chips: one per active filter, translated name and value, a remove control that drops the parameter;
//  - saved views: the default view is applied (columns, filters, sort); "Save as new view" posts the current columns,
//    filters and sort; Share is offered only with `saved_view.share`; the auditor applies views and is offered no
//    write; a view naming a key the list no longer offers is applied without it, with the ADR-0057 §10 notice;
//    the old per-browser column choice is read once as the unsaved state and never written again;
//  - global search: a 1-character query is not sent; hits are listed with type, transformation and code; the stale
//    state ("This information may be out of date. Last updated …") stays above the results; the empty state is
//    distinct from the stale empty state; 503 search.index_unavailable is translated;
//  - contextual help: the panel loads the screen's topics in the interface language, Arabic labelled provisional;
//  - breadcrumbs isolate labels with <bdi> and mark the current page.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { makeMe, mockApi, ORG_ID, renderApp, route, TR_ID, USER_ID, type Handler } from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, leadGrants } from "../../test/p2fixtures.ts";
import { EMPTY_HIERARCHY, esc, frameHandlers, initiative, page, TR, wave } from "../../pages/portfolio/p3fixtures.ts";
import type { SavedView } from "./api.ts";

type Locale = "en" | "ar";
const tr = (locale: Locale) => createI18n(locale).t;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W1 = wave();
const INI = [
  initiative({ code: "INI-01", name: "Synthetic network roll-out" }),
  initiative({ code: "INI-02", name: "Synthetic billing upgrade", status: "submitted" }),
];

function savedView(over: Partial<SavedView> = {}): SavedView {
  return {
    id: "01920006-0000-7000-8000-00000000a001",
    organizationId: ORG_ID,
    ownerUserId: USER_ID,
    ownerDisplayName: "Synthetic Test User",
    isOwner: true,
    listKey: "initiatives",
    transformationId: TR_ID,
    name: "Synthetic submitted view",
    visibility: "personal",
    columns: ["code", "status", "fundingState"],
    filters: { status: "submitted" },
    sort: [{ key: "name", direction: "desc" }],
    isDefault: true,
    sharedAt: null,
    sharedBy: null,
    status: "active",
    deletedAt: null,
    version: 2,
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-01T08:00:00Z",
    ...over,
  };
}

const VIEW_PERMS: Permission[] = ["initiative.edit", "saved_view.manage"];

function handlers(
  locale: Locale,
  opts: { perms?: Permission[]; auditor?: boolean; views?: SavedView[]; extra?: Handler[] },
) {
  const me = makeMe(opts.auditor ? AUDITOR_GRANTS : leadGrants(opts.perms ?? VIEW_PERMS), { preferredLocale: locale });
  return [
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me })),
    route("GET", /\/api\/v1\/saved-views\?/, () => page(opts.views ?? [])),
    ...(opts.extra ?? []),
    ...frameHandlers(locale, opts.auditor ? "auditor" : "lead", [
      route("GET", /\/api\/v1\/initiatives\?/, (req) => {
        const u = new URL(req.url, "http://x");
        const status = u.searchParams.get("status");
        const items = status ? INI.filter((i) => i.status === status) : INI;
        return u.searchParams.get("cursor")
          ? { status: 200, body: { items: [INI[1]], nextCursor: null } }
          : { status: 200, body: { items, nextCursor: status ? null : "c-page-2" } };
      }),
      route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
      route("GET", new RegExp(`${esc(TR)}/outcome-hierarchy$`), () => ({ status: 200, body: EMPTY_HIERARCHY })),
    ]),
  ];
}

/**
 * The register's own list requests: one server page (`limit` = the page size, 25). The outcome hierarchy on the same
 * page reads the whole list separately (limit 100), which is not the register.
 */
const initiativeGets = (requests: { method: string; url: string }[]) =>
  requests
    .filter((r) => r.method === "GET" && r.url.startsWith("/api/v1/initiatives?"))
    .map((r) => new URL(r.url, "http://x"))
    .filter((u) => u.searchParams.get("limit") === "25");

describe.each(["en", "ar"] as const)("Initiative register: server list, chips, saved views (%s)", (locale) => {
  const t = tr(locale);

  it("sends sort, filters and the page cursor to the API; chips name each filter and remove it", async () => {
    const { requests } = mockApi(...handlers(locale, {}));
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    await screen.findByText("INI-01");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    // Default: sort=code, a server page (limit), no client filtering.
    await waitFor(() => expect(initiativeGets(requests).some((u) => u.searchParams.get("sort") === "code")).toBe(true));
    expect(initiativeGets(requests).every((u) => u.searchParams.get("transformationId") === TR_ID)).toBe(true);

    // Next page uses the server cursor.
    fireEvent.click(screen.getByRole("button", { name: t("common.table.next") }));
    await waitFor(() =>
      expect(initiativeGets(requests).some((u) => u.searchParams.get("cursor") === "c-page-2")).toBe(true),
    );

    // Sorting by name descending is a server sort.
    const nameHeader = screen.getByRole("columnheader", { name: new RegExp(t("portfolio.field.name")) });
    fireEvent.click(within(nameHeader).getByRole("button"));
    await waitFor(() => expect(initiativeGets(requests).some((u) => u.searchParams.get("sort") === "name")).toBe(true));
    fireEvent.click(within(nameHeader).getByRole("button"));
    await waitFor(() =>
      expect(initiativeGets(requests).some((u) => u.searchParams.get("sort") === "-name")).toBe(true),
    );

    // Filter -> query parameter -> chip; removing the chip removes the parameter.
    fireEvent.change(screen.getByLabelText(t("portfolio.filter.status")), { target: { value: "submitted" } });
    await waitFor(() =>
      expect(initiativeGets(requests).some((u) => u.searchParams.get("status") === "submitted")).toBe(true),
    );
    const chip = await screen.findByRole("group", { name: t("productivity.chips.label") });
    expect(chip.textContent).toContain(t("portfolio.filter.status"));
    expect(chip.textContent).toContain(t("portfolio.status.submitted"));
    const qInput = screen.getByLabelText(t("productivity.register.q"));
    fireEvent.change(qInput, { target: { value: "billing" } });
    fireEvent.blur(qInput);
    await waitFor(() => expect(initiativeGets(requests).some((u) => u.searchParams.get("q") === "billing")).toBe(true));
    const before = initiativeGets(requests).length;
    fireEvent.click(
      screen.getByRole("button", {
        name: t("productivity.chips.remove", {
          name: t("portfolio.filter.status"),
          value: t("portfolio.status.submitted"),
        }),
      }),
    );
    await waitFor(() => expect(initiativeGets(requests).length).toBeGreaterThan(before));
    const last = initiativeGets(requests).at(-1)!;
    expect(last.searchParams.get("status")).toBeNull();
    expect(last.searchParams.get("q")).toBe("billing");
  });

  it("applies the default view (columns, filters, sort) and saves the current state as a new view", async () => {
    const view = savedView();
    const posted: unknown[] = [];
    const { requests } = mockApi(
      ...handlers(locale, {
        views: [view],
        extra: [
          route("POST", /\/api\/v1\/saved-views$/, (req) => {
            posted.push(req.body);
            return {
              status: 201,
              body: savedView({ id: "01920006-0000-7000-8000-00000000a002", name: "Mine", isDefault: false }),
            };
          }),
        ],
      }),
    );
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    await waitFor(() =>
      expect(
        initiativeGets(requests).some(
          (u) => u.searchParams.get("status") === "submitted" && u.searchParams.get("sort") === "-name",
        ),
      ).toBe(true),
    );
    const table = (await screen.findByText("INI-02")).closest("table")!;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    // The view hides name and wave; derived columns (owners, rank, selection) stay.
    expect(headers.some((h) => h.includes(t("portfolio.field.name")))).toBe(false);
    expect(headers.some((h) => h.includes(t("portfolio.field.wave")))).toBe(false);
    expect(headers.some((h) => h.includes(t("portfolio.field.funding")))).toBe(true);
    expect(headers.some((h) => h.includes(t("portfolio.field.owners")))).toBe(true);
    expect((screen.getByLabelText(t("productivity.views.label")) as HTMLSelectElement).value).toBe(view.id);
    expect(document.querySelector("[data-view-state]")?.getAttribute("data-view-state")).toBe("saved");

    // A change marks the view as changed; "Save as new view" posts columns, filters and sort.
    fireEvent.change(screen.getByLabelText(t("portfolio.filter.status")), { target: { value: "" } });
    await waitFor(() =>
      expect(document.querySelector("[data-view-state]")?.getAttribute("data-view-state")).toBe("changed"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("productivity.views.saveAs") }));
    fireEvent.change(screen.getByLabelText(t("productivity.views.name")), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: t("productivity.views.saveSubmit") }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      listKey: "initiatives",
      transformationId: TR_ID,
      name: "Mine",
      columns: ["code", "status", "fundingState"],
      filters: {},
      sort: [{ key: "name", direction: "desc" }],
      isDefault: false,
    });
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/v1/saved-views")!;
    expect(post.headers["idempotency-key"]).toBeTruthy();
    // Share is not offered without saved_view.share.
    expect(screen.queryByRole("button", { name: t("productivity.views.share") })).toBeNull();
  });

  it("offers Share with saved_view.share (If-Match), and drops a key the list no longer offers with the notice", async () => {
    const view = savedView({ columns: ["code", "retiredColumn"], filters: { retiredFilter: "x" }, isDefault: true });
    const shared: { body: unknown; ifMatch: string | undefined }[] = [];
    mockApi(
      ...handlers(locale, {
        perms: [...VIEW_PERMS, "saved_view.share"],
        views: [view],
        extra: [
          route("POST", /\/share$/, (req) => {
            shared.push({ body: req.body, ifMatch: req.headers["if-match"] });
            return { status: 200, body: { ...view, visibility: "shared", version: 3 } };
          }),
        ],
      }),
    );
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("productivity.views.ignoredNotice"))).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("productivity.views.share")) }));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]).toEqual({ body: { shared: true }, ifMatch: '"2"' });
  });

  it("the auditor applies a shared view and is offered no write", async () => {
    const view = savedView({
      isOwner: false,
      ownerDisplayName: "Synthetic Lead",
      visibility: "shared",
      isDefault: false,
    });
    const { requests } = mockApi(...handlers(locale, { auditor: true, views: [view] }));
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    await screen.findByText("INI-01");
    expect(await screen.findByText(t("productivity.views.applyOnly"))).toBeTruthy();
    for (const name of ["saveAs", "save", "rename", "delete", "share", "setDefault"])
      expect(screen.queryByRole("button", { name: t(`productivity.views.${name}`) }), name).toBeNull();
    fireEvent.change(screen.getByLabelText(t("productivity.views.label")), { target: { value: view.id } });
    await waitFor(() =>
      expect(initiativeGets(requests).some((u) => u.searchParams.get("status") === "submitted")).toBe(true),
    );
    expect(requests.some((r) => r.method !== "GET" && r.url.startsWith("/api/v1/saved-views"))).toBe(false);
  });

  it("reads the old per-browser column choice once, as the unsaved state, and never writes it again", async () => {
    localStorage.setItem("mth.table.p2.p3-initiatives.columns", JSON.stringify({ name: false }));
    mockApi(...handlers(locale, {}));
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    const table = (await screen.findByText("INI-01")).closest("table")!;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    expect(headers.some((h) => h.includes(t("portfolio.field.name")))).toBe(false);
    expect(document.querySelector("[data-view-state]")?.getAttribute("data-view-state")).toBe("unsaved");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("common.table.columns")) }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("portfolio.field.name") }));
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole("columnheader")
          .some((h) => h.textContent?.includes(t("portfolio.field.name"))),
      ).toBe(true),
    );
    expect(localStorage.getItem("mth.table.p2.p3-initiatives.columns")).toBe(JSON.stringify({ name: false }));
  });
});

const HIT = {
  recordType: "initiative",
  recordId: INI[0]!.id,
  recordVersion: 3,
  transformationId: TR_ID,
  transformationCode: "TR-SYN",
  transformationName: "Synthetic transformation",
  code: "INI-01",
  title: "Synthetic network roll-out",
  summary: "Upgrade synthetic network towers",
  recordStatus: "draft",
  isArchived: false,
};

function searchHandlers(locale: Locale, respond: (u: URL) => { status: number; body?: unknown }) {
  return [
    route("GET", /\/api\/v1\/search\?/, (req) => respond(new URL(req.url, "http://x"))),
    route("GET", /\/api\/v1\/help-topics\?/, (req) => {
      const u = new URL(req.url, "http://x");
      return page([
        {
          topicKey: "search.global",
          screenKey: u.searchParams.get("screenKey"),
          ordinal: 1,
          titleEn: "Searching records",
          titleAr: "البحث في السجلات (ترجمة مؤقتة)",
          bodyEn: "Synthetic help body.",
          bodyAr: "نص مساعدة اصطناعي (ترجمة مؤقتة)",
          arabicProvisional: true,
          sourceRefs: ["M0303"],
        },
      ]);
    }),
    ...handlers(locale, {}),
  ];
}

describe.each(["en", "ar"] as const)("Global search (%s)", (locale) => {
  const t = tr(locale);

  it("does not send a 1-character query; lists permitted hits; the stale state stays above them", async () => {
    const { requests } = mockApi(
      ...searchHandlers(locale, () => ({
        status: 200,
        body: { items: [HIT], nextCursor: null, indexedThrough: "2026-10-30T09:00:00Z", stale: true },
      })),
    );
    renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
    const box = await screen.findByRole("search", { name: t("productivity.search.globalLabel") });
    const field = within(box).getByLabelText(t("productivity.search.queryLabel"));
    fireEvent.change(field, { target: { value: "n" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await within(box).findByRole("alert")).toHaveProperty("textContent", t("problems.search__query_too_short"));
    expect(requests.some((r) => r.url.startsWith("/api/v1/search"))).toBe(false);

    fireEvent.change(field, { target: { value: "network" } });
    fireEvent.click(within(box).getByRole("button", { name: t("productivity.search.globalLabel") }));
    expect(await screen.findByRole("heading", { level: 1, name: t("productivity.search.title") })).toBeTruthy();
    const hit = await screen.findByText("INI-01");
    const card = hit.closest("[data-hit]")!;
    expect(card.textContent).toContain(t("productivity.search.type.initiative"));
    expect(card.textContent).toContain("TR-SYN");
    expect(card.querySelector("mark")?.textContent?.toLowerCase()).toBe("network");
    expect(card.querySelector("a")?.getAttribute("href")).toBe(`/transformations/${TR_ID}/initiatives/${HIT.recordId}`);
    const stale = document.querySelector("[data-state='stale']")!;
    expect(stale.textContent).toContain(t("common.status.stale"));
    expect(stale.textContent).toContain(t("productivity.search.stale", { time: "" }).split("{{")[0]!.slice(0, 12));
    const searchUrl = new URL(requests.find((r) => r.url.startsWith("/api/v1/search"))!.url, "http://x");
    expect(searchUrl.searchParams.get("q")).toBe("network");

    // Record-type filter -> repeated parameter and a chip.
    fireEvent.click(screen.getByRole("checkbox", { name: t("productivity.search.type.benefit") }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.url.startsWith("/api/v1/search") &&
            new URL(r.url, "http://x").searchParams.get("recordType") === "benefit",
        ),
      ).toBe(true),
    );
    expect(screen.getByRole("group", { name: t("productivity.chips.label") }).textContent).toContain(
      t("productivity.search.type.benefit"),
    );
  });

  it("the empty state differs from the stale empty state; 503 is translated", async () => {
    let mode: "empty" | "stale" | "down" = "empty";
    mockApi(
      ...searchHandlers(locale, () =>
        mode === "down"
          ? {
              status: 503,
              body: {
                type: "urn:mth:problem:unavailable",
                title: "x",
                status: 503,
                code: "search.index_unavailable",
                requestId: "req-1",
              },
            }
          : { status: 200, body: { items: [], nextCursor: null, indexedThrough: null, stale: mode === "stale" } },
      ),
    );
    renderApp(`/search?q=zzzz`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("productivity.search.emptyBody"))).toBeTruthy();
    expect(document.querySelector("[data-state='empty']")).toBeTruthy();
    expect(document.querySelector("[data-state='stale']")).toBeNull();
    cleanup();

    mode = "stale";
    renderApp(`/search?q=yyyy`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("productivity.search.emptyStale"))).toBeTruthy();
    expect(document.querySelector("[data-state='empty-stale']")).toBeTruthy();
    // indexedThrough null: the time is Unknown, never a made-up time.
    expect(document.querySelector("[data-state='stale']")?.textContent).toContain(t("common.value.unknown"));
    cleanup();

    mode = "down";
    renderApp(`/search?q=xxxx`, { i18n: createI18n(locale), retryDelayMs: 0 });
    expect(await screen.findByText(t("problems.search__index_unavailable"))).toBeTruthy();
  });

  it("contextual help loads the screen's topics in the interface language (Arabic labelled provisional)", async () => {
    const { requests } = mockApi(
      ...searchHandlers(locale, () => ({
        status: 200,
        body: { items: [], nextCursor: null, indexedThrough: "2026-10-30T09:00:00Z", stale: false },
      })),
    );
    renderApp(`/search?q=zzzz`, { i18n: createI18n(locale) });
    const toggle = await screen.findByRole("button", { name: new RegExp(t("productivity.help.open")) });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const title = await screen.findByText(locale === "ar" ? "البحث في السجلات (ترجمة مؤقتة)" : "Searching records");
    expect(title.tagName).toBe("H3");
    expect(requests.some((r) => r.url === "/api/v1/help-topics?screenKey=search&limit=100")).toBe(true);
    expect(Boolean(document.querySelector("[data-help-provisional]"))).toBe(locale === "ar");
    // Breadcrumbs: the current page is marked and isolated.
    const crumbs = screen.getByRole("navigation", { name: t("common.a11y.breadcrumbs") });
    expect(crumbs.querySelector("[aria-current='page'] bdi")?.textContent).toBe(t("productivity.search.title"));
  });
});
