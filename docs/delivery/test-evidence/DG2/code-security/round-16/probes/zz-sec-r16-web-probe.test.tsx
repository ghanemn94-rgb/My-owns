// code-security-reviewer DG2 round-16 adversarial web probe (T-DG2-REV-SEC-R16). NOT product code: it lives in the
// reviewer's evidence directory and is copied into a disposable probe clone at apps/web/src/auth/ to run with the
// unit-web project. SYNTHETIC data, scripted API (the product's own test fixtures).
//
// Class probe for F-DG2-530 after FE14 (session generation in the API client): is there any remaining path where the
// answer to a request sent under identity A is written, navigated on or shown after this tab moved to identity B?
// FE14 gates the answer of each apiRequest. It does not gate what a success handler does AFTER further awaits.
// Y1  Create transformation (TransformationCreatePage.onSubmit): A's POST is answered 201 under A's generation, then the
//     handler awaits invalidateQueries + refreshEffectivePermissions (a GET /me). If A signed out and B signed in in
//     another tab while the POST was in flight, that GET /me returns B (identity change -> generation moves, reset),
//     and the handler still navigates to /transformations/<A's new id> with A's code and name in router state.
// Y1c Control: the same create under ONE identity (no switch) still lands on the created record (FE14 must not break it).
// Y4  X6 with the PRODUCTION query defaults (QUERY_DEFAULTS, no override): a refocus within /me's staleTime after B
//     signed in elsewhere fetches /me FIRST and shows B's header with B's data, never A's header with B's data.
// Y5  OBSERVATION (always passes, logs): an in-app navigation (no focus/visibility event, e.g. two windows side by side)
//     after B signed in elsewhere: which identity's header is shown above the newly fetched page data.
import { focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionGeneration } from "../api/client.ts";
import { QUERY_DEFAULTS } from "../app/App.tsx";
import { createI18n } from "../i18n/index.ts";
import {
  BUSINESS_UNIT,
  BU_ID,
  OFFICE_GRANTS,
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
const NEW_A_ID = "01920000-0000-7000-9000-0000000003a1";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Two synthetic users. `hold(pred)` holds matching requests (sent now, answered at release()). */
function server() {
  const state: { user: "A" | "B" } = { user: "A" };
  const meA = { ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User A" }), csrfToken: "a".repeat(43) };
  const meB = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const createdA = makeTransformation({ id: NEW_A_ID, code: "TR-A-NEW-SECRET", name: "A-CREATED-SECRET-NAME" });
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/users/, () => page([])),
    route("GET", /\/audit/, () => page([])),
    route("GET", /\/api\/v1\/transformations\?/, () =>
      state.user === "A"
        ? page([makeTransformation({ code: "TR-A-ROW", name: "A row" })])
        : page([makeTransformation({ code: "TR-B-ROW", name: "B row" })]),
    ),
    route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () =>
      state.user === "A" ? { status: 200, body: createdA } : problem(404, "not_found"),
    ),
    route("POST", /\/api\/v1\/transformations$/, () => ({ status: 201, body: createdA })),
  );
  const holds: { pred: (url: string, method: string) => boolean; waiters: (() => void)[] }[] = [];
  const mocked = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    for (const h of holds)
      if (h.pred(url, method)) {
        const res = mocked(input, init); // SENT now: the cookie of the moment decides the answer
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
  return { state, hold, createdA, ...api };
}

async function submitCreate() {
  const unit = (await screen.findByLabelText(/^Business unit/, undefined, { timeout: 5_000 })) as HTMLSelectElement;
  fireEvent.change(unit, { target: { value: BU_ID } });
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "A-CREATED-SECRET-NAME" } });
  fireEvent.click(screen.getByRole("button", { name: "Create transformation" }));
}

describe("Y1 a create of A's whose success continuation runs after the tab moved to B", () => {
  it("B is never navigated to A's new record nor shown A's code/name", async () => {
    const s = server();
    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    const releasePost = s.hold((_u, m) => m === "POST");
    await submitCreate();
    await waitFor(() => expect(s.requests.some((r) => r.method === "POST")).toBe(true));
    const genAtSend = getSessionGeneration();
    // While A's POST is in flight, A signs out and B signs in in another tab of the same browser profile.
    s.state.user = "B";
    // A's POST (committed under A) is answered now: still under the generation it was sent with, so it is returned.
    releasePost();
    await wait(400);
    await waitFor(() => expect(document.querySelector('[data-state="created-not-visible"], [data-state="no-permission"], [data-state="error"]')).not.toBeNull(), { timeout: 3_000 }).catch(() => undefined);
    // eslint-disable-next-line no-console
    console.log(`Y1 requests after the POST: ${JSON.stringify(s.requests.slice(s.requests.findIndex((r) => r.method === "POST")).map((r) => `${r.method} ${r.url.split("?")[0]}`))}`);
    const path = router.state.location.pathname;
    const headerB = screen.queryByText("Synthetic User B") !== null;
    const shownCode = screen.queryAllByText(/TR-A-NEW-SECRET/).length > 0;
    const shownName = screen.queryAllByText(/A-CREATED-SECRET-NAME/).length > 0;
    const meGets = s.requests.filter((r) => r.method === "GET" && r.url === "/api/v1/me").length;
    // eslint-disable-next-line no-console
    console.log(
      `Y1: generation at send ${genAtSend}, now ${getSessionGeneration()}; GET /me count ${meGets}; path ${path}; header B=${headerB}; B sees A's code=${shownCode}; B sees A's name=${shownName}; body excerpt=${JSON.stringify((document.querySelector("[data-state]")?.textContent ?? "").slice(0, 200))}`,
    );
    expect(headerB).toBe(true);
    expect(path).not.toBe(`/transformations/${NEW_A_ID}`);
    expect(shownCode || shownName).toBe(false);
  });

  it("Y1c control: under one identity the create still lands on the created record", async () => {
    server();
    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    await submitCreate();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_A_ID}`), { timeout: 5_000 });
    expect(await screen.findByText("Transformation created as a draft. It is not submitted or approved.")).toBeTruthy();
  });
});

describe("Y4 X6 with the production query defaults", () => {
  it("a refocus after B signed in elsewhere fetches /me first and never shows A's header with B's data", async () => {
    const s = server();
    const { queryClient } = renderApp("/transformations", { i18n: createI18n("en") });
    queryClient.setDefaultOptions({ queries: { ...QUERY_DEFAULTS } });
    await screen.findByText("TR-A-ROW");
    // Make the page data stale as TanStack would after 15 s (the /me query stays fresh: 60 s).
    queryClient.getQueryCache().findAll().forEach((q) => {
      if (q.queryKey[0] !== "me") q.setState({ dataUpdatedAt: Date.now() - 20_000 });
    });
    s.state.user = "B";
    const from = s.requests.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await wait(300);
    const urls = s.requests.slice(from).map((r) => `${r.method} ${r.url.split("?")[0]}`);
    const headerA = screen.queryByText("Synthetic User A") !== null;
    const bRow = screen.queryByText("TR-B-ROW") !== null;
    // eslint-disable-next-line no-console
    console.log(`Y4: requests on refocus = ${JSON.stringify(urls)}; header A=${headerA}; header B=${screen.queryByText("Synthetic User B") !== null}; B's row=${bRow}; A's row=${screen.queryByText("TR-A-ROW") !== null}`);
    expect(urls[0]).toBe("GET /api/v1/me");
    expect(headerA && bRow).toBe(false);
  });
});

describe("Y5 OBSERVATION: in-app navigation with no focus event after B signed in elsewhere", () => {
  it("logs which header is shown above the newly fetched page data (always passes)", async () => {
    const s = server();
    const { router, queryClient } = renderApp("/my-work", { i18n: createI18n("en") });
    queryClient.setDefaultOptions({ queries: { ...QUERY_DEFAULTS } });
    await screen.findByText("Synthetic User A");
    s.state.user = "B";
    const from = s.requests.length;
    await act(async () => {
      await router.navigate("/transformations");
    });
    await wait(300);
    const urls = s.requests.slice(from).map((r) => `${r.method} ${r.url.split("?")[0]}`);
    // eslint-disable-next-line no-console
    console.log(
      `Y5: requests on navigation = ${JSON.stringify(urls)}; header A=${screen.queryByText("Synthetic User A") !== null}; B's row=${screen.queryByText("TR-B-ROW") !== null}; A's row=${screen.queryByText("TR-A-ROW") !== null}`,
    );
    expect(true).toBe(true);
  });
});
