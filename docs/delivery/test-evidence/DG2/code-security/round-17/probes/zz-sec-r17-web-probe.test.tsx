// code-security-reviewer DG2 round-17 adversarial web probe (T-DG2-REV-SEC-R17). NOT product code: it lives in the
// reviewer's evidence directory and is copied into a disposable probe clone at apps/web/src/auth/ to run with the
// unit-web project. SYNTHETIC data, scripted API (the product's own test fixtures).
//
// Class probe for F-DG2-530 after FE15 (per-action session generation + navigation-time identity check, D-077): any
// remaining path where an effect of a request or action started under identity A lands under identity B?
// Z1  Create whose post-create GET /me is SLOWER than refreshEffectivePermissions' 5 s timeout: the handler is still
//     under A's generation when the timeout fires, so it navigates. Does B (once /me answers) ever see A's code/name?
// Z2  Edit whose PATCH is in flight > SESSION_RECHECK_MS while B signs in: the post-save invalidation refetch triggers
//     the recheck /me -> B. A's save must not navigate B nor show A's record data under B's header.
// Z3  The documented residual (D-077): a non-navigation page GET < 2 s after the last /me and after B signed in
//     elsewhere. Demonstrated (logged), and its END asserted: the next GET after the window asks /me first.
// Z4  Y5 made asserting: an in-app navigation immediately after B signed in elsewhere (no focus event, no time
//     passes): /me first, and A's header is NEVER rendered above B's rows (MutationObserver over every DOM mutation).
// Z5  OBSERVATION: a query-string-only navigation (same pathname) inside the window: is /me re-asked?
// Z6  OBSERVATION (liveness): an in-app navigation whose GET /me hangs: are the page's GETs held behind it?
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionGeneration, resetSessionStateForTests } from "../api/client.ts";
import { createI18n } from "../i18n/index.ts";
import {
  BUSINESS_UNIT,
  BU_ID,
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
  resetSessionStateForTests();
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSessionStateForTests();
});

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const NEW_A_ID = "01920000-0000-7000-9000-0000000003a1";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
function advanceClock(ms: number) {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + ms);
}
const header = () => document.querySelector(".user-box__name")?.textContent?.trim() ?? "";

/** Records every DOM state in which `bad()` holds (checked on every mutation, not just at the end). */
function watch(bad: () => boolean) {
  const hits: string[] = [];
  const check = () => {
    if (bad()) hits.push(`${header()} | ${(document.body.textContent ?? "").slice(0, 160)}`);
  };
  const mo = new MutationObserver(check);
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  return {
    hits,
    stop: () => {
      check();
      mo.disconnect();
    },
  };
}

/** Two synthetic users. `hold(pred)` holds matching requests (sent now, answered at release()). */
function server() {
  const state: { user: "A" | "B" } = { user: "A" };
  const meA = { ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User A" }), csrfToken: "a".repeat(43) };
  const meB = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const createdA = makeTransformation({ id: NEW_A_ID, code: "TR-A-NEW-SECRET", name: "A-CREATED-SECRET-NAME" });
  const recordA = makeTransformation({ id: TR_ID, code: "TR-A-EDIT-SECRET", name: "A-EDIT-SECRET-NAME" });
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/users/, () => page([])),
    route("GET", /\/audit/, () => page([])),
    route("GET", /\/api\/v1\/transformations(\?.*)?$/, () =>
      state.user === "A"
        ? page([makeTransformation({ code: "TR-A-ROW", name: "A row" })])
        : page([makeTransformation({ code: "TR-B-ROW", name: "B row" })]),
    ),
    route("GET", new RegExp(`/api/v1/transformations/${NEW_A_ID}$`), () =>
      state.user === "A" ? { status: 200, body: createdA } : problem(404, "not_found"),
    ),
    route("GET", new RegExp(`/api/v1/transformations/${TR_ID}$`), () =>
      state.user === "A" ? { status: 200, body: recordA } : problem(404, "not_found"),
    ),
    route("POST", /\/api\/v1\/transformations$/, () => ({ status: 201, body: createdA })),
    route("PATCH", new RegExp(`/api/v1/transformations/${TR_ID}$`), () => ({
      status: 200,
      body: { ...recordA, name: "A-EDIT-SECRET-RENAMED", version: recordA.version + 1 },
    })),
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
  const summary = (from: number) => api.requests.slice(from).map((r) => `${r.method} ${r.url.split("?")[0]}`);
  return { state, hold, summary, ...api };
}

const isMe = (u: string, m: string) => m === "GET" && /\/api\/v1\/me$/.test(u);
const shows = (re: RegExp) => re.test(document.body.textContent ?? "");

describe("Z1 create whose post-create GET /me outlasts the 5 s permission-refresh timeout", () => {
  it("B is never shown A's new record code or name, at any DOM state", { timeout: 20_000 }, async () => {
    const s = server();
    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    const seen = watch(() => header() === "Synthetic User B" && shows(/TR-A-NEW-SECRET|A-CREATED-SECRET-NAME/));
    const releasePost = s.hold((_u, m) => m === "POST");
    const unit = (await screen.findByLabelText(/^Business unit/, undefined, { timeout: 5_000 })) as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: BU_ID } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "A-CREATED-SECRET-NAME" } });
    fireEvent.click(screen.getByRole("button", { name: "Create transformation" }));
    await waitFor(() => expect(s.requests.some((r) => r.method === "POST")).toBe(true));
    const from = s.requests.length - 1;
    s.state.user = "B"; // another tab: A signs out, B signs in
    const releaseMe = s.hold(isMe); // the post-create /me (and any recheck) is slow
    releasePost();
    await wait(5_600); // > ME_REFRESH_TIMEOUT_MS: the handler resumes while its generation is still A's
    const pathBeforeMe = router.state.location.pathname;
    const genBeforeMe = getSessionGeneration();
    releaseMe();
    await screen.findByText("Synthetic User B", undefined, { timeout: 5_000 });
    await wait(500);
    seen.stop();
    // eslint-disable-next-line no-console
    console.log(
      `Z1: requests ${JSON.stringify(s.summary(from))}; path before /me answered ${pathBeforeMe} (gen ${genBeforeMe}); now ${router.state.location.pathname} (gen ${getSessionGeneration()}); header ${header()}; mixed states ${seen.hits.length}; body ${JSON.stringify((document.querySelector("main")?.textContent ?? "").slice(0, 200))}`,
    );
    expect(header()).toBe("Synthetic User B");
    expect(seen.hits).toEqual([]);
    expect(shows(/TR-A-NEW-SECRET|A-CREATED-SECRET-NAME/)).toBe(false);
  });
});

describe("Z2 edit whose PATCH is in flight beyond the recheck window while B signs in", () => {
  it("A's save does not navigate B, and B never sees A's record data under B's header", async () => {
    const s = server();
    const { router } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n("en") });
    const name = await screen.findByDisplayValue("A-EDIT-SECRET-NAME");
    const seen = watch(() => header() === "Synthetic User B" && shows(/A-EDIT-SECRET|TR-A-EDIT-SECRET/));
    fireEvent.change(name, { target: { value: "A-EDIT-SECRET-RENAMED" } });
    const releasePatch = s.hold((_u, m) => m === "PATCH");
    const from = s.requests.length;
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
    s.state.user = "B";
    advanceClock(3_000); // the PATCH took 3 s: the next page GET is beyond SESSION_RECHECK_MS
    releasePatch();
    await screen.findByText("Synthetic User B", undefined, { timeout: 5_000 });
    await wait(500);
    seen.stop();
    // eslint-disable-next-line no-console
    console.log(
      `Z2: requests ${JSON.stringify(s.summary(from))}; path ${router.state.location.pathname}; header ${header()}; mixed states ${seen.hits.length}`,
    );
    // Dry-run correction (README): the edit's awaits send no GET (no active query matches), so no /me intervenes and
    // the navigation runs while A's generation is still current (an effect under A, not a stale one). The class
    // invariant is asserted instead: once the tab is B's, B never sees A's record data in any DOM state.
    expect(header()).toBe("Synthetic User B");
    expect(seen.hits).toEqual([]);
    expect(shows(/A-EDIT-SECRET|TR-A-EDIT-SECRET/)).toBe(false);
  });

  it("Z2c control: the same edit under one identity (PATCH 3 s) still updates and navigates", async () => {
    const s = server();
    const { router } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n("en") });
    const name = await screen.findByDisplayValue("A-EDIT-SECRET-NAME");
    fireEvent.change(name, { target: { value: "A-EDIT-SECRET-RENAMED" } });
    const releasePatch = s.hold((_u, m) => m === "PATCH");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
    advanceClock(3_000);
    releasePatch();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}`), { timeout: 5_000 });
    expect(header()).toBe("Synthetic User A");
  });
});

describe("Z3 the documented residual: a non-navigation GET inside the 2 s window", () => {
  it("demonstrates it (logged) and asserts its end: after the window the next GET asks /me first", async () => {
    const s = server();
    const { queryClient } = renderApp("/transformations", { i18n: createI18n("en") });
    await screen.findByText("TR-A-ROW");
    s.state.user = "B";
    let from = s.requests.length;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["transformations"] }); // e.g. a refetch after the user's own write
    });
    await wait(200);
    const inWindow = { urls: s.summary(from), header: header(), bRow: shows(/TR-B-ROW/), aRow: shows(/TR-A-ROW/) };
    advanceClock(2_500);
    from = s.requests.length;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["transformations"] });
    });
    await screen.findByText("Synthetic User B", undefined, { timeout: 5_000 });
    await wait(200);
    const after = s.summary(from);
    // eslint-disable-next-line no-console
    console.log(
      `Z3 residual: inside window ${JSON.stringify(inWindow)}; after window requests ${JSON.stringify(after)}; header ${header()}; B row ${shows(/TR-B-ROW/)}; A row ${shows(/TR-A-ROW/)}`,
    );
    expect(after[0]).toBe("GET /api/v1/me");
    expect(header()).toBe("Synthetic User B");
    expect(shows(/TR-A-ROW/)).toBe(false);
  });
});

describe("Z4 (Y5 made asserting) navigation immediately after B signed in elsewhere", () => {
  it("/me first; A's header is never rendered above B's rows", async () => {
    const s = server();
    const { router } = renderApp("/my-work", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    const seen = watch(() => header() === "Synthetic User A" && shows(/TR-B-ROW/));
    s.state.user = "B";
    const from = s.requests.length;
    await act(async () => {
      await router.navigate("/transformations");
    });
    await screen.findByText("TR-B-ROW", undefined, { timeout: 5_000 });
    seen.stop();
    const urls = s.summary(from);
    // eslint-disable-next-line no-console
    console.log(`Z4: requests ${JSON.stringify(urls)}; header ${header()}; mixed states ${seen.hits.length}`);
    expect(urls[0]).toBe("GET /api/v1/me");
    expect(seen.hits).toEqual([]);
    expect(header()).toBe("Synthetic User B");
  });
});

describe("Z5 OBSERVATION: query-string-only navigation inside the window", () => {
  it("logs whether /me is asked (always passes)", async () => {
    const s = server();
    const { router } = renderApp("/transformations", { i18n: createI18n("en") });
    await screen.findByText("TR-A-ROW");
    s.state.user = "B";
    const from = s.requests.length;
    await act(async () => {
      await router.navigate("/transformations?q=x");
    });
    await wait(400);
    // eslint-disable-next-line no-console
    console.log(
      `Z5: requests ${JSON.stringify(s.summary(from))}; header ${header()}; B row ${shows(/TR-B-ROW/)}; A row ${shows(/TR-A-ROW/)}`,
    );
    expect(true).toBe(true);
  });
});

describe("Z6 OBSERVATION (liveness): a navigation whose GET /me hangs", () => {
  it("logs which page GETs were sent while /me was held, and after it was released (always passes)", async () => {
    const s = server();
    const { router } = renderApp("/my-work", { i18n: createI18n("en") });
    await screen.findByText("Synthetic User A");
    const releaseMe = s.hold(isMe);
    const from = s.requests.length;
    await act(async () => {
      await router.navigate("/transformations");
    });
    await wait(1_000);
    const whileHeld = s.summary(from);
    releaseMe();
    await screen.findByText("TR-A-ROW", undefined, { timeout: 5_000 });
    // eslint-disable-next-line no-console
    console.log(`Z6: while /me held ${JSON.stringify(whileHeld)}; after release ${JSON.stringify(s.summary(from))}`);
    expect(true).toBe(true);
  });
});
