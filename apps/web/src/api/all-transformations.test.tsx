// T-DG5-FE-AB2 (D-181; REQ-S15 usability): a transformation picker offers every transformation the user may see.
// fetchAllTransformations / useAllTransformations follow `nextCursor` of the existing list operation
// (GET /api/v1/transformations, PAGINATION.maxLimit per page) until it is null, and a page that fails fails the whole
// list (a picker never offers a partial list as if it were complete).
//  H1  one page: one request, limit 100, no cursor; its items.
//  H2  several pages: each cursor is sent once, in order; every item of every page, in order; the filters on every page.
//  H3  an error mid-way (page 2 of 3 answers 500): the query is an error with NO data, and page 3 is never requested.
//  H4  a server that repeats a cursor: an error, never an endless loop or a silently shortened list.
//  H5  the request signal reaches every page request (the same cancellation convention as useTransformations).
//  P1  the launch-procedure picker on "My procedures", EN (LTR) and AR (RTL): 250 transformations over three pages are
//      all offered, the last one (past the old 100 cap) included.
//  P2  the same picker when page 2 fails: the translated error state with "Try again", no picker with a partial list.
// SYNTHETIC data, scripted API (the product's own test fixtures). Nothing here is a business approval.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../i18n/index.ts";
import {
  ORG_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type RecordedRequest,
} from "../test/fixtures.tsx";
import { ApiError } from "./client.ts";
import { fetchAllTransformations, useAllTransformations } from "./queries.ts";
import type { Transformation } from "./types.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PAGE = 100;
const idOf = (n: number) => `01920000-0000-7000-a1b2-${String(n).padStart(12, "0")}`;
const many = (count: number): Transformation[] =>
  Array.from({ length: count }, (_, i) =>
    makeTransformation({
      id: idOf(i + 1),
      code: `TR-${String(i + 1).padStart(4, "0")}`,
      name: `Synthetic transformation ${i + 1}`,
    }),
  );
const isList = (r: RecordedRequest) => r.method === "GET" && /\/api\/v1\/transformations\?/.test(r.url);
const paramsOf = (r: RecordedRequest) => new URL(r.url, "http://localhost").searchParams;

/** Serves `all` in pages of 100 with opaque cursors ("c1", "c2", ...); `fail` answers that page number with a 500. */
function pagedTransformations(all: readonly Transformation[], opts: { fail?: number; repeatCursor?: boolean } = {}) {
  return route("GET", /\/api\/v1\/transformations\?/, (req) => {
    const cursor = paramsOf(req).get("cursor");
    const index = cursor ? Number(cursor.slice(1)) : 0;
    if (opts.fail === index + 1) return { status: 500, body: { title: "Synthetic outage", status: 500 } };
    const items = all.slice(index * PAGE, (index + 1) * PAGE);
    const more = (index + 1) * PAGE < all.length;
    return { status: 200, body: { items, nextCursor: more ? (opts.repeatCursor ? "c1" : `c${index + 1}`) : null } };
  });
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("fetchAllTransformations / useAllTransformations (D-181)", () => {
  it("H1 one page: one request with limit 100 and no cursor", async () => {
    const api = mockApi(pagedTransformations(many(3)));
    const { result } = renderHook(() => useAllTransformations({ sort: "code:asc" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((x) => x.code)).toEqual(["TR-0001", "TR-0002", "TR-0003"]);
    const lists = api.requests.filter(isList);
    expect(lists).toHaveLength(1);
    expect(paramsOf(lists[0]!).get("limit")).toBe(String(PAGE));
    expect(paramsOf(lists[0]!).get("sort")).toBe("code:asc");
    expect(paramsOf(lists[0]!).has("cursor")).toBe(false);
  });

  it("H2 several pages: follows nextCursor until null, keeps the filters, returns every item in order", async () => {
    const all = many(250);
    const api = mockApi(pagedTransformations(all));
    const { result } = renderHook(
      () => useAllTransformations({ sort: "updatedAt:desc", organizationId: ORG_ID, includeArchived: false }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(250);
    expect(result.current.data?.map((x) => x.id)).toEqual(all.map((x) => x.id));
    const lists = api.requests.filter(isList).map(paramsOf);
    expect(lists.map((p) => p.get("cursor"))).toEqual([null, "c1", "c2"]);
    for (const p of lists) {
      expect(p.get("limit")).toBe(String(PAGE));
      expect(p.get("sort")).toBe("updatedAt:desc");
      expect(p.get("organizationId")).toBe(ORG_ID);
      expect(p.has("includeArchived")).toBe(false);
    }
  });

  it("H3 an error mid-way: the query is an error with no partial data, and no later page is requested", async () => {
    const api = mockApi(pagedTransformations(many(250), { fail: 2 }));
    const { result } = renderHook(() => useAllTransformations({ sort: "code:asc" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(500);
    expect(
      api.requests
        .filter(isList)
        .map(paramsOf)
        .map((p) => p.get("cursor")),
    ).toEqual([null, "c1"]);
  });

  it("H4 a repeated cursor is an error, not an endless loop or a shortened list", async () => {
    const api = mockApi(pagedTransformations(many(350), { repeatCursor: true }));
    await expect(fetchAllTransformations({ sort: "code:asc" })).rejects.toThrow(/repeated a page cursor/);
    expect(api.requests.filter(isList)).toHaveLength(2);
  });

  it("H5 the request signal is passed to every page request", async () => {
    mockApi(pagedTransformations(many(150)));
    const signals: (AbortSignal | null | undefined)[] = [];
    const scripted = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return scripted(input, init);
    });
    const controller = new AbortController();
    const items = await fetchAllTransformations({ sort: "code:asc" }, controller.signal);
    expect(items).toHaveLength(150);
    expect(signals).toHaveLength(2);
    for (const s of signals) expect(s).toBeTruthy();
    controller.abort();
    for (const s of signals) expect(s?.aborted).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ the picker (P1, P2)

// procedure.launch: the launch form is offered only to a user who may launch (T-DG5-FE-RG1, F-DG5-140).
const PERMISSIONS = [
  "organization.read",
  "procedure.read",
  "procedure.act",
  "procedure.launch",
  "transformation.read",
] as Permission[];
const definitions = {
  items: [
    {
      id: "01920000-0000-7000-b200-000000000002",
      code: "baseline_validation",
      nameEn: "Synthetic baseline validation",
      nameAr: "التحقق من خط الأساس (اصطناعي)",
      versionNo: 2,
      versionStatus: "published",
      removed: false,
      scope: { level: "transformation" },
      inputSchema: [],
      steps: [],
    },
  ],
  nextCursor: null,
};

function pickerApp(lang: "en" | "ar", opts: { fail?: number } = {}) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(
        [{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions: PERMISSIONS }],
        { preferredLocale: lang },
      ),
    })),
    route("GET", /\/api\/v1\/procedure-definitions(\?|$)/, () => ({ status: 200, body: definitions })),
    pagedTransformations(many(250), opts),
    route("GET", /./, () => ({ status: 200, body: { items: [], nextCursor: null } })),
  );
  renderApp("/playbook/procedures", { i18n: createI18n(lang) });
  return api;
}

const t = (lang: "en" | "ar", key: string): string => {
  let node: unknown = catalogues[lang];
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  return node as string;
};

async function chooseProcedure(lang: "en" | "ar") {
  const form = await waitFor(() => {
    const el = document.querySelector<HTMLFormElement>("[data-form='launch-procedure']");
    if (!el) throw new Error("launch form not rendered");
    return el;
  });
  const procedure = await within(form).findByRole("combobox", {
    name: new RegExp(`^${t(lang, "workflowsP5.procedures.procedure")}`),
  });
  await waitFor(() => expect(within(procedure).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(procedure, { target: { value: "baseline_validation" } });
  return form;
}

describe.each(["en", "ar"] as const)("launch-procedure transformation picker (%s)", (lang) => {
  it(`P1 offers all 250 transformations over three pages, the last one included (${lang})`, async () => {
    pickerApp(lang);
    const form = await chooseProcedure(lang);
    expect(document.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
    const picker = await within(form).findByRole("combobox", {
      name: new RegExp(`^${t(lang, "workflowsP5.field.transformation")}`),
    });
    const values = within(picker)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values).toHaveLength(250);
    expect(values).toContain(idOf(250));
    expect(values).toContain(idOf(101));
  });

  it(`P2 a failed page shows the translated error state with "Try again", and no partial picker (${lang})`, async () => {
    pickerApp(lang, { fail: 2 });
    const form = await chooseProcedure(lang);
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain(t(lang, "common.state.errorTitle"));
    expect(alert.textContent).toContain(t(lang, "problems.status.5xx"));
    expect(within(alert).getByRole("button", { name: t(lang, "common.action.retry") })).toBeTruthy();
    expect(
      within(form).queryByRole("combobox", { name: new RegExp(`^${t(lang, "workflowsP5.field.transformation")}`) }),
    ).toBeNull();
    expect(screen.queryByText("TR-0001 · Synthetic transformation 1")).toBeNull();
  });
});
