// code-security-reviewer DG2 round-15 adversarial web probe (T-DG2-REV-SEC-R15). NOT product code: it lives in the
// reviewer's evidence directory and is copied into a disposable probe clone at apps/web/src/auth/ to run with the
// unit-web project. SYNTHETIC data, scripted API (the product's own test fixtures).
//
// Class probe for F-DG2-500 (one identity's data carried into another identity's session in the same tab), beyond the
// round-14 W5/W5b and the implementer's own session-identity.test.tsx. Users A and B differ in user id AND session
// (CSRF token), as the API would answer.
// X2  Back/Forward after an identity change: B pressing Back to A's detail page never sees A's cached record.
// X3  A mutation of A's that was in flight when the identity changed, and that succeeds afterwards: does its success
//     handler write A's record into the cache under B (TransformationEditPage save -> setQueryData + navigate)?
// X3b The same but the session ENDED in this tab (401) and B then signed in: the defence in depth (identity change at
//     B's /me) must remove it.
// X4  A query of A's in flight when the identity changed, answered afterwards: never lands in B's cache / screen.
// X6  OBSERVATION (always passes, logs): production staleTime of GET /me (60 s) - a refocus within it refetches page
//     queries with the new cookie but not /me, so the tab keeps A's identity while showing B's data.
// X7  403 csrf on a mutation (PATCH) is not a session end: the reset hooks do not run, the cache and phase are kept.
import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionPhase } from "../api/client.ts";
import { keys } from "../api/queries.ts";
import { createI18n } from "../i18n/index.ts";
import enAuth from "../i18n/en/auth.json";
import {
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  TR_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
} from "../test/fixtures.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const unauthenticated = () => ({
  status: 401,
  body: { type: "urn:mth:problem:unauthenticated", title: "Sign-in required", status: 401, code: "unauthenticated" },
});
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Two synthetic users. `hold(pred)` holds matching requests until `release()`. */
function server() {
  const state: { user: "A" | "B" | null } = { user: "A" };
  const meA = { ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User A" }), csrfToken: "a".repeat(43) };
  const meB = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const trA = makeTransformation({ code: "TR-A-SECRET", name: "A-ONLY-DETAIL" });
  const api = mockApi(
    route("POST", /\/auth\/dev-login$/, (req) => {
      const body = req.body as { username?: string } | undefined;
      if (!body?.username) return problem(400, "validation");
      state.user = "B";
      return { status: 204 };
    }),
    (req) => (state.user === null && req.method === "GET" ? unauthenticated() : undefined),
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/users/, () => page([])),
    route("GET", /\/audit/, () => page([])),
    route("GET", /\/api\/v1\/transformations\?/, () =>
      state.user === "A" ? page([trA]) : page([makeTransformation({ code: "TR-B-OWN", name: "B own" })]),
    ),
    route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () =>
      state.user === "A" ? { status: 200, body: trA } : problem(404, "not_found"),
    ),
    route("PATCH", /\/api\/v1\/transformations\//, (req) => ({
      status: 200,
      body: { ...trA, name: (req.body as { name: string }).name, version: 2 },
    })),
  );
  const holds: { pred: (url: string, method: string) => boolean; waiters: (() => void)[] }[] = [];
  const mocked = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    for (const h of holds)
      if (h.pred(url, method)) {
        // The request is SENT now (the cookie of the moment decides the answer), the answer is delivered later.
        const res = mocked(input, init);
        await new Promise<void>((r) => h.waiters.push(r));
        return res;
      }
    return mocked(input, init);
  });
  const hold = (pred: (url: string, method: string) => boolean) => {
    const h = { pred, waiters: [] as (() => void)[] };
    holds.push(h);
    return () => {
      holds.splice(holds.indexOf(h), 1);
      h.waiters.splice(0).forEach((r) => r());
    };
  };
  return { state, hold, trA, ...api };
}

describe("X2 Back/Forward after an identity change", () => {
  it("B pressing Back to A's detail page never sees A's cached record", async () => {
    const s = server();
    const { router, queryClient } = renderApp("/transformations", { i18n: createI18n("en") });
    await screen.findByText("TR-A-SECRET");
    await act(async () => {
      await router.navigate(`/transformations/${TR_ID}`);
    });
    await screen.findAllByText("A-ONLY-DETAIL");
    await act(async () => {
      await router.navigate("/my-work");
    });
    s.state.user = "B";
    const releaseB = s.hold((url) => url.startsWith("/api/v1/transformations"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await screen.findByText("Synthetic User B");
    const seen: boolean[] = [];
    for (const step of [-1, -1, 1]) {
      await act(async () => {
        await router.navigate(step);
      });
      await wait(50);
      seen.push(screen.queryByText("A-ONLY-DETAIL") !== null || screen.queryByText("TR-A-SECRET") !== null);
    }
    // eslint-disable-next-line no-console
    console.log(`X2: path ${router.state.location.pathname}; A's record seen after Back/Back/Forward = ${seen}`);
    releaseB();
    expect(seen).toEqual([false, false, false]);
  });
});

describe("X3 a mutation of A's in flight across an identity change", () => {
  it("its success (A's record) is not written into B's cache nor shown to B", async () => {
    const s = server();
    const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n("en") });
    // Production defaults (App.tsx createQueryClient): queries are fresh for 15 s.
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } });
    const name = await screen.findByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "A-PATCHED-SECRET" } });
    const releasePatch = s.hold((_u, m) => m === "PATCH");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
    // In another tab A signs out and B signs in; this tab re-probes /me (refocus).
    s.state.user = "B";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await screen.findByText("Synthetic User B");
    const releaseB = s.hold((url, m) => m === "GET" && url.startsWith(`/api/v1/transformations/${TR_ID}`));
    // A's PATCH (committed under A's session, sent before the switch) is answered now.
    releasePatch();
    await wait(200);
    const cached = queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID));
    const shown = screen.queryAllByText("A-PATCHED-SECRET").length > 0;
    const detailGets = s.requests.filter((r) => r.method === "GET" && r.url === `/api/v1/transformations/${TR_ID}`).length;
    // eslint-disable-next-line no-console
    console.log(
      `X3: GET detail requests so far ${detailGets} (1 = A's own edit-page load; a 2nd would be B refetching); path ${router.state.location.pathname}; header B=${screen.queryByText("Synthetic User B") !== null}; cache[transformation ${TR_ID}].name=${cached?.name}; B sees A-PATCHED-SECRET=${shown}`,
    );
    releaseB();
    await wait(300);
    // After B's own refetch of that record answers 404 (B has no access): is A's record still on B's screen?
    // eslint-disable-next-line no-console
    console.log(
      `X3 after B's refetch (404): B still sees A-PATCHED-SECRET=${screen.queryAllByText("A-PATCHED-SECRET").length > 0}; cache name=${queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name}`,
    );
    expect(cached?.name).toBeUndefined();
    expect(shown).toBe(false);
  });

  it("X3b the same after a session END in this tab and B's sign-in: the identity change at B's /me removes it", async () => {
    const s = server();
    const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n("en") });
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } });
    const name = await screen.findByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "A-PATCHED-SECRET" } });
    const releasePatch = s.hold((_u, m) => m === "PATCH");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
    s.state.user = null; // A's session ends; the next /me answers 401 -> session end, reset, /login
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    releasePatch();
    await wait(200);
    const afterEnd = queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name;
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    fireEvent.change(await screen.findByLabelText(enAuth.dev.username), { target: { value: "dev.b" } });
    const releaseB = s.hold((url, m) => m === "GET" && url.startsWith(`/api/v1/transformations/${TR_ID}`));
    fireEvent.click(screen.getByRole("button", { name: enAuth.dev.submit }));
    await screen.findByText("Synthetic User B");
    await wait(100);
    const cached = queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID));
    const shown = screen.queryAllByText("A-PATCHED-SECRET").length > 0;
    // eslint-disable-next-line no-console
    console.log(
      `X3b: cache after the end and the late PATCH = ${afterEnd}; after B's sign-in path ${router.state.location.pathname}; cache name=${cached?.name}; B sees it=${shown}`,
    );
    releaseB();
    expect(cached?.name).toBeUndefined();
    expect(shown).toBe(false);
  });
});

describe("X4 a query of A's in flight across an identity change", () => {
  it("A's late answer never lands in B's cache or screen", async () => {
    const s = server();
    const { queryClient } = renderApp("/my-work", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    const releaseA = s.hold((url) => url.startsWith("/api/v1/transformations?"));
    // Not awaited: the fetch is SENT now under A's cookie and its answer is held until releaseA().
    const pending = queryClient
      .prefetchQuery({
        queryKey: ["transformations", { probe: 1 }],
        queryFn: () => fetch("/api/v1/transformations?limit=1").then((r) => r.json()),
      })
      .catch(() => undefined);
    await wait(50);
    // the prefetch above is pending (held): switch identity, then release A's answer.
    s.state.user = "B";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await screen.findByText("Synthetic User B");
    releaseA();
    await pending;
    await wait(200);
    const data = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["transformations"] })
      .map((q) => JSON.stringify(q.state.data ?? null));
    // eslint-disable-next-line no-console
    console.log(`X4: transformations queries after release = ${data.join(" | ")}`);
    expect(data.some((d) => d.includes("TR-A-SECRET"))).toBe(false);
  });
});

describe("X6 OBSERVATION: refocus within GET /me's 60 s staleTime", () => {
  it("logs what the tab shows after B signs in elsewhere and the window regains focus (always passes)", async () => {
    const s = server();
    const { queryClient } = renderApp("/transformations", { i18n: createI18n("en") });
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0, refetchOnWindowFocus: true } });
    await screen.findByText("TR-A-SECRET");
    s.state.user = "B";
    const from = s.requests.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await wait(300);
    const urls = s.requests.slice(from).map((r) => `${r.method} ${r.url.split("?")[0]}`);
    // eslint-disable-next-line no-console
    console.log(
      `X6: requests on refocus = ${JSON.stringify(urls)}; header A=${screen.queryByText("Synthetic User A") !== null}; B's row shown=${screen.queryByText("TR-B-OWN") !== null}; A's row shown=${screen.queryByText("TR-A-SECRET") !== null}`,
    );
    expect(true).toBe(true);
  });
});

describe("X7 403 csrf on a mutation is not a session end", () => {
  it("PATCH 403 csrf keeps the phase, the identity and the cache", async () => {
    const s = server();
    s.fetchMock.mockImplementation(s.fetchMock.getMockImplementation()!);
    const { queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n("en") });
    const name = await screen.findByLabelText(/^Name/);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH")
        return new Response(
          JSON.stringify({ type: "urn:mth:problem:csrf", title: "csrf", status: 403, code: "csrf" }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } },
        );
      return s.fetchMock(input, init);
    });
    const before = queryClient.getQueryCache().findAll().filter((q) => q.state.data !== undefined).length;
    fireEvent.change(name, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await wait(300);
    const after = queryClient.getQueryCache().findAll().filter((q) => q.state.data !== undefined).length;
    // eslint-disable-next-line no-console
    console.log(`X7: phase ${getSessionPhase()}; queries with data before ${before} after ${after}; me cached ${queryClient.getQueryData(keys.me) !== undefined}`);
    expect(getSessionPhase()).toBe("active");
    expect(queryClient.getQueryData(keys.me)).toBeDefined();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
