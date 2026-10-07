// F-DG2-500 (REQ-S16-030): a session end clears the session-scoped cache WHEREVER it happens (the sign-in page
// included, no component has to be mounted), and no identity ever renders another identity's cached data:
//  - the reviewer's W5: Back to an in-document /login entry after a session end, then user B signs in with the
//    development form in the same tab: B never sees A's records;
//  - the reviewer's W5b: the same in OIDC mode, B arriving through a /me re-probe (B signed in in another tab);
//  - an identity change noticed by a refocus /me with NO 401 in between (A signed out and B signed in in another tab):
//    every session-scoped query is removed before B renders, and A's draft form state does not survive;
//  - sign-out here keeps clearing everything;
//  - a 403 is never a session end and clears nothing;
//  - the API client clears through the registered hook with no React tree mounted at all.
// EN (LTR) and AR (RTL). SYNTHETIC data, scripted API.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  getSessionPhase,
  markSessionActive,
  noteSessionIdentity,
  registerSessionReset,
  resetSessionStateForTests,
  type SessionResetReason,
} from "../api/client.ts";
import { fetchMe, keys } from "../api/queries.ts";
import { createQueryClient } from "../app/App.tsx";
import { createI18n } from "../i18n/index.ts";
import arAuth from "../i18n/ar/auth.json";
import arTransformations from "../i18n/ar/transformations.json";
import enAuth from "../i18n/en/auth.json";
import enTransformations from "../i18n/en/transformations.json";
import {
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type RecordedRequest,
} from "../test/fixtures.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TEXT = {
  en: { auth: enAuth, transformations: enTransformations, dir: "ltr" },
  ar: { auth: arAuth, transformations: arTransformations, dir: "rtl" },
} as const;
type Lang = keyof typeof TEXT;

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const A_SECRET = "TR-A-SECRET";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const unauthenticated = () => ({
  status: 401,
  body: { type: "urn:mth:problem:unauthenticated", title: "Sign-in required", status: 401, code: "unauthenticated" },
});
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const meCount = (requests: RecordedRequest[], from = 0) =>
  requests.slice(from).filter((r) => r.method === "GET" && /\/api\/v1\/me$/.test(r.url)).length;

/**
 * Two synthetic users on one scripted server. `state.user` is whose session the browser's cookie carries (null: no
 * valid session, every GET answers 401 `unauthenticated`). B's transformation list is held until `releaseB()`, so the
 * first render after B's identity arrives shows whatever the cache holds (the reviewer's technique).
 */
function twoUserServer(lang: Lang, options: { devLogin: boolean }) {
  const state: { user: "A" | "B" | null } = { user: "A" };
  const meA = makeMe(OFFICE_GRANTS, { preferredLocale: lang, displayName: "Synthetic User A" });
  // B: another user AND another session (another CSRF token, as the API derives it from the session token).
  const meB = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: lang, displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const holds: (() => void)[] = [];
  const api = mockApi(
    route("POST", /\/auth\/dev-login$/, (req) => {
      if (!options.devLogin) return problem(404, "not_found");
      const body = req.body as { username?: string } | undefined;
      if (!body?.username) return problem(400, "validation");
      state.user = "B";
      return { status: 204 };
    }),
    route("POST", /\/auth\/logout$/, () => {
      state.user = null;
      return { status: 200, body: { endSessionUrl: null } };
    }),
    (req) => (state.user === null && req.method === "GET" ? unauthenticated() : undefined),
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/transformations\?/, () =>
      state.user === "A"
        ? page([makeTransformation({ code: A_SECRET, name: "A only synthetic transformation" })])
        : page([]),
    ),
  );
  const mocked = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (state.user === "B" && url.startsWith("/api/v1/transformations?")) await new Promise<void>((r) => holds.push(r));
    return mocked(input, init);
  });
  const releaseB = () => holds.splice(0).forEach((r) => r());
  return { state, releaseB, ...api };
}

/**
 * No query that A's session fetched is left in the cache: nothing holds data except the side-effect-free development
 * sign-in probe. (The sign-in page's own GET /me observer may have re-created an EMPTY "me" query: no data, no identity.)
 */
function expectNoSessionCache(queryClient: ReturnType<typeof renderApp>["queryClient"]) {
  const withData = queryClient
    .getQueryCache()
    .findAll()
    .filter((q) => q.state.data !== undefined)
    .map((q) => JSON.stringify(q.queryKey))
    .filter((k) => k !== JSON.stringify(["dev-login-availability"]));
  expect(withData).toEqual([]);
  expect(queryClient.getQueryData(keys.me)).toBeUndefined();
}

for (const lang of ["en", "ar"] as const) {
  const T = TEXT[lang];

  describe(`F-DG2-500 a session end on the sign-in page (${lang})`, () => {
    it("W5: Back to /login after A's session ends, B signs in with the development form: B never sees A's records", async () => {
      const server = twoUserServer(lang, { devLogin: true });
      const { router, queryClient } = renderApp("/login?returnTo=%2Ftransformations", { i18n: createI18n(lang) });
      await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      expect(screen.getByText("Synthetic User A")).toBeTruthy();

      // A's session ends; the Back button returns to the earlier in-document /login entry (phase still "active").
      server.state.user = null;
      const from = server.requests.length;
      await act(async () => {
        await router.navigate("/login?returnTo=%2Ftransformations");
      });
      expect(await screen.findByLabelText(T.auth.dev.username)).toBeTruthy();
      await wait(200);
      // The sign-in page's own /me probe ended the session, and the cache was cleared there and then.
      expect(getSessionPhase()).toBe("ended");
      expectNoSessionCache(queryClient);
      expect(meCount(server.requests, from)).toBeLessThanOrEqual(2);
      expect(document.documentElement.dir).toBe(T.dir);

      // B signs in in the same tab.
      fireEvent.change(screen.getByLabelText(T.auth.dev.username), { target: { value: "dev.b" } });
      fireEvent.click(screen.getByRole("button", { name: T.auth.dev.submit }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
      await screen.findByText("Synthetic User B");
      await wait(100);
      expect(screen.queryByText(A_SECRET)).toBeNull();
      expect(screen.queryByText("Synthetic User A")).toBeNull();
      server.releaseB();
      expect(await screen.findByText(T.transformations.emptyTitle)).toBeTruthy();
      expect(screen.queryByText(A_SECRET)).toBeNull();
    });

    it("W5b (OIDC mode): B signs in in another tab and this tab's /me re-probe brings B: B never sees A's records", async () => {
      const server = twoUserServer(lang, { devLogin: false });
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      server.state.user = null;
      await act(async () => {
        await router.navigate("/login?returnTo=%2Ftransformations");
      });
      expect(await screen.findByRole("link", { name: T.auth.oidcButton })).toBeTruthy();
      await wait(200);
      expect(getSessionPhase()).toBe("ended");
      expectNoSessionCache(queryClient);

      // B signs in at the IdP in another tab (shared cookie); this tab regains focus and re-probes /me.
      server.state.user = "B";
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
      await screen.findByText("Synthetic User B");
      await wait(100);
      expect(screen.queryByText(A_SECRET)).toBeNull();
      server.releaseB();
      expect(await screen.findByText(T.transformations.emptyTitle)).toBeTruthy();
    });
  });

  describe(`F-DG2-500 an identity change with no session end in this tab (${lang})`, () => {
    it("a refocus /me that returns another identity removes every session query before B renders, and drops A's drafts", async () => {
      const server = twoUserServer(lang, { devLogin: true });
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      // A starts typing a search (component state, not yet in the URL).
      const search = screen.getByRole("searchbox");
      fireEvent.change(search, { target: { value: "draft typed by A" } });
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("draft typed by A");

      // In another tab A signs out and B signs in: no request of this tab ever answered 401.
      server.state.user = "B";
      const seenBeforeRelease: boolean[] = [];
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await screen.findByText("Synthetic User B");
      seenBeforeRelease.push(screen.queryByText(A_SECRET) !== null);
      await wait(100);
      seenBeforeRelease.push(screen.queryByText(A_SECRET) !== null);
      expect(seenBeforeRelease).toEqual([false, false]);
      expect(getSessionPhase()).toBe("active");
      expect(router.state.location.pathname).toBe("/transformations");
      // A's list query is gone (B's is pending), and A's draft did not survive into B's tree.
      const lists = queryClient.getQueryCache().findAll({ queryKey: ["transformations"] });
      expect(lists.every((q) => q.state.data === undefined)).toBe(true);
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
      server.releaseB();
      expect(await screen.findByText(T.transformations.emptyTitle)).toBeTruthy();
      expect(screen.queryByText(A_SECRET)).toBeNull();
    });

    it("a new session of the same person (signed in again elsewhere) refetches the queries but keeps their own draft", async () => {
      const server = twoUserServer(lang, { devLogin: true });
      const { queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "my own draft" } });
      const before = queryClient.getQueryCache().findAll({ queryKey: ["transformations"] })[0];
      // Same user, new session: the API derives another CSRF token from the new session token.
      const meA = queryClient.getQueryData<{ csrfToken: string }>(keys.me)!;
      server.fetchMock.mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ ...meA, csrfToken: "n".repeat(43) }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const from = server.requests.length;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await screen.findByText(A_SECRET);
      const after = queryClient.getQueryCache().findAll({ queryKey: ["transformations"] })[0];
      expect(after).not.toBe(before); // the previous session's query was removed, this one was fetched again
      expect(server.requests.slice(from).some((r) => r.url.startsWith("/api/v1/transformations?"))).toBe(true);
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("my own draft");
    });

    it("the same identity re-probed (window refocus) keeps the cache and the page state", async () => {
      const server = twoUserServer(lang, { devLogin: true });
      const { queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kept" } });
      const from = server.requests.length;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await wait(100);
      expect(meCount(server.requests, from)).toBe(1);
      expect(screen.getByText(A_SECRET)).toBeTruthy();
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("kept");
    });
  });

  describe(`F-DG2-500 sign-out here and 403 (${lang})`, () => {
    it("signing out here clears everything; B signing in afterwards never sees A's records", async () => {
      const server = twoUserServer(lang, { devLogin: true });
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      const from = server.requests.length;
      fireEvent.click(screen.getByRole("button", { name: new RegExp(T.auth.signOut) }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      expect(new URLSearchParams(router.state.location.search).get("signedOut")).toBe("1");
      await screen.findByLabelText(T.auth.dev.username);
      await wait(200);
      expect(getSessionPhase()).toBe("unknown");
      expectNoSessionCache(queryClient);
      expect(meCount(server.requests, from)).toBeLessThanOrEqual(1);

      fireEvent.change(screen.getByLabelText(T.auth.dev.username), { target: { value: "dev.b" } });
      fireEvent.click(screen.getByRole("button", { name: T.auth.dev.submit }));
      await screen.findByText("Synthetic User B");
      await act(async () => {
        await router.navigate("/transformations");
      });
      await wait(100);
      expect(screen.queryByText(A_SECRET)).toBeNull();
      server.releaseB();
      expect(await screen.findByText(T.transformations.emptyTitle)).toBeTruthy();
    });

    it("a 403 is never a session end: the phase, the identity and the cache are kept", async () => {
      const resets: SessionResetReason[] = [];
      const server = twoUserServer(lang, { devLogin: true });
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      registerSessionReset((r) => resets.push(r));
      expect(await screen.findByText(A_SECRET)).toBeTruthy();
      // A 403 (forbidden) on a GET and on a mutation: the API's "you may not", never "your session ended".
      const forbidden = () =>
        new Response(
          JSON.stringify({ type: "urn:mth:problem:forbidden", title: "x", status: 403, code: "forbidden" }),
          {
            status: 403,
            headers: { "Content-Type": "application/problem+json" },
          },
        );
      server.fetchMock.mockImplementationOnce(async () => forbidden());
      server.fetchMock.mockImplementationOnce(async () => forbidden());
      const outcomes = await Promise.allSettled([
        apiRequest("/api/v1/organizations"),
        apiRequest("/api/v1/organizations", { method: "POST", body: {} }),
      ]);
      expect(outcomes.map((o) => (o.status === "rejected" ? (o.reason as { status: number }).status : 0))).toEqual([
        403, 403,
      ]);
      await wait(100);
      expect(resets).toEqual([]);
      expect(getSessionPhase()).toBe("active");
      expect(router.state.location.pathname).toBe("/transformations");
      expect(screen.getByText(A_SECRET)).toBeTruthy();
      expect(queryClient.getQueryData(keys.me)).toBeTruthy();
    });
  });
}

describe("F-DG2-500 the API client clears through the registered hook, with nothing mounted", () => {
  it("a 401 `unauthenticated` while active runs the reset once, before the phase is announced", async () => {
    resetSessionStateForTests();
    const queryClient = createQueryClient();
    queryClient.setQueryData(keys.me, makeMe(OFFICE_GRANTS));
    queryClient.setQueryData(["transformations", {}], page([makeTransformation({ code: A_SECRET })]).body);
    const order: string[] = [];
    registerSessionReset((r) => order.push(`reset:${r}:phase=${getSessionPhase()}`));
    mockApi(() => unauthenticated());
    markSessionActive();
    await expect(apiRequest("/api/v1/transformations?limit=1")).rejects.toMatchObject({ status: 401 });
    await expect(apiRequest("/api/v1/transformations?limit=1")).rejects.toMatchObject({ status: 401 });
    expect(order).toEqual(["reset:ended:phase=active"]);
    expect(getSessionPhase()).toBe("ended");
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0);
  });

  it("a 401 with no session in this tab, a 401 with another code and a silent 401 clear nothing", async () => {
    resetSessionStateForTests();
    const resets: SessionResetReason[] = [];
    registerSessionReset((r) => resets.push(r));
    mockApi(() => unauthenticated());
    await expect(apiRequest("/api/v1/me")).rejects.toMatchObject({ status: 401 }); // phase "unknown"
    markSessionActive();
    await expect(apiRequest("/api/v1/auth/logout", { method: "POST", silent401: true })).rejects.toMatchObject({
      status: 401,
    });
    vi.unstubAllGlobals();
    mockApi(() => ({
      status: 401,
      body: { type: "urn:mth:problem:x", title: "x", status: 401, code: "auth.login_failed" },
    }));
    await expect(apiRequest("/api/v1/auth/dev-login", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 401,
    });
    expect(resets).toEqual([]);
    expect(getSessionPhase()).toBe("active");
  });

  it("GET /me with another user or another session resets every query except the identity being stored", async () => {
    resetSessionStateForTests();
    const queryClient = createQueryClient();
    const meA = makeMe(OFFICE_GRANTS);
    const meA2 = { ...meA, csrfToken: "d".repeat(43) }; // same user, new session
    const meB = { ...makeMe(OFFICE_GRANTS, { id: USER_B_ID }), csrfToken: "b".repeat(43) };
    let current = meA;
    mockApi(route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: current })));
    const resets: SessionResetReason[] = [];
    registerSessionReset((r) => resets.push(r));
    await queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe });
    queryClient.setQueryData(["transformations", {}], page([]).body);
    await queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 });
    expect(resets).toEqual([]); // same identity
    expect(queryClient.getQueryData(["transformations", {}])).toBeTruthy();

    current = meA2;
    await queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 });
    expect(resets).toEqual(["identity-changed"]);
    expect(queryClient.getQueryData(["transformations", {}])).toBeUndefined();
    expect(queryClient.getQueryData(keys.me)).toEqual(meA2);

    queryClient.setQueryData(["users-all", "org"], []);
    current = meB;
    await queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 });
    expect(resets).toEqual(["identity-changed", "identity-changed"]);
    expect(queryClient.getQueryData(["users-all", "org"])).toBeUndefined();
    expect(queryClient.getQueryData(keys.me)).toEqual(meB);
  });

  it("noteSessionIdentity: the first identity of a document is not a change", () => {
    resetSessionStateForTests();
    const resets: SessionResetReason[] = [];
    registerSessionReset((r) => resets.push(r));
    noteSessionIdentity("org\u0000a\u0000s1");
    noteSessionIdentity("org\u0000a\u0000s1");
    expect(resets).toEqual([]);
    noteSessionIdentity("org\u0000b\u0000s2");
    expect(resets).toEqual(["identity-changed"]);
  });
});
