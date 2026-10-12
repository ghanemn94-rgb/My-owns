// F-DG4-146 (REQ-S16-030; F-DG2-570 / D-077): "Every GET sent while a check or any other GET /me is in flight waits for
// it." This rule keeps B's page data from being fetched, and rendered under A's header, before /me has answered. The
// other session tests answer /me at once and assert the order in which requests are SENT, so a client that dropped the
// wait still passed them (qa-verifier's mutant M4). Here the /me answer is HELD, and each case asserts that no page GET
// is sent until it is answered:
//   W1  an in-app navigation after B signed in elsewhere (the navigation's identity check, held);
//   W2  a list refetch past SESSION_RECHECK_MS (the revalidation /me, held), no navigation;
//   W3  client level: a GET waits for a GET /me probe in flight (asIdentityProbe), with no identity check pending;
//   W4  client level: a GET waits for a pending identity check (revalidateSessionIdentity), with no /me probe in flight.
// W1/W2 are adapted from qa-verifier's round-6 probe (docs/delivery/test-evidence/DG4/qa/tests/round-6/unit/
// qa-r6-session-wait.test.tsx). W3 and W4 each pin one of the two awaits in apiRequest, so dropping either one fails.
// EN (LTR) and AR (RTL). SYNTHETIC data, scripted API (the product's own test fixtures). Controlled Date.now clock.
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_RECHECK_MS,
  apiRequest,
  asIdentityProbe,
  markSessionActive,
  registerSessionCheck,
  resetSessionStateForTests,
  revalidateSessionIdentity,
} from "../api/client.ts";
import { createI18n } from "../i18n/index.ts";
import {
  OFFICE_GRANTS,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type RecordedRequest,
} from "../test/fixtures.tsx";

let clockNow = 0;
beforeEach(() => {
  localStorage.clear();
  clockNow = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clockNow);
});
afterEach(() => {
  cleanup();
  resetSessionStateForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const isMe = (r: RecordedRequest) => r.method === "GET" && /\/api\/v1\/me$/.test(r.url);
const header = () => document.querySelector(".user-box__name")?.textContent?.trim() ?? null;
const describeRequest = (r: RecordedRequest) => `${r.method} ${r.url}`;

/** A scripted API whose GET /me answers can be held: the /me is sent (and recorded) at once, its answer waits. */
function server(lang: "en" | "ar") {
  const state = { user: "A" as "A" | "B" };
  const meA = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: lang, displayName: "Synthetic User A" }),
    csrfToken: "a".repeat(43),
  };
  const meB = {
    ...makeMe(OFFICE_GRANTS, { preferredLocale: lang, displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/api\/v1\/transformations\?/, () =>
      state.user === "A"
        ? page([makeTransformation({ code: "TR-A-SECRET", name: "A only" })])
        : page([makeTransformation({ code: "TR-B-OWN", name: "B own" })]),
    ),
    route("GET", /./, () => page([])),
  );
  let held: (() => void)[] | null = null;
  const scripted = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (held && /\/api\/v1\/me$/.test(url) && (init?.method ?? "GET") === "GET") {
      const res = scripted(input, init); // sent now, answered for the cookie of this moment
      const h = held;
      await new Promise<void>((r) => h.push(r));
      return res;
    }
    return scripted(input, init);
  });
  return {
    state,
    ...api,
    holdMe: () => {
      held = [];
    },
    releaseMe: () => {
      const h = held ?? [];
      held = null;
      h.forEach((r) => r());
    },
  };
}

/** A promise with its resolver, for holding a /me probe or an identity check from outside. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

for (const lang of ["en", "ar"] as const) {
  describe(`F-DG4-146 page GETs wait for the identity check in flight (${lang})`, () => {
    it("W1: a navigation after B signed in elsewhere sends no page GET, and shows nothing of B's, while /me is held", async () => {
      const s = server(lang);
      const { router } = renderApp("/my-work", { i18n: createI18n(lang) });
      expect(document.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
      await screen.findByText("Synthetic User A");
      await wait(100);
      s.state.user = "B";
      s.holdMe();
      const from = s.requests.length;
      await act(async () => {
        void router.navigate("/transformations");
      });
      await wait(400);
      const whileHeld = s.requests.slice(from);
      expect(whileHeld.filter(isMe).length).toBeGreaterThanOrEqual(1);
      expect(whileHeld.filter((r) => !isMe(r)).map(describeRequest)).toEqual([]);
      expect(screen.queryByText("TR-B-OWN")).toBeNull();
      expect(header()).toBe("Synthetic User A");
      s.releaseMe();
      await screen.findByText("TR-B-OWN");
      expect(header()).toBe("Synthetic User B");
      expect(screen.queryByText("TR-A-SECRET")).toBeNull();
      expect(isMe(s.requests[from]!)).toBe(true);
    });

    it("W2: a refetch past SESSION_RECHECK_MS is not sent while the revalidation /me is held; one /me, first", async () => {
      const s = server(lang);
      const { queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      await screen.findByText("TR-A-SECRET");
      await wait(100);
      clockNow += SESSION_RECHECK_MS + 1;
      s.holdMe();
      const from = s.requests.length;
      await act(async () => {
        void queryClient.invalidateQueries({ queryKey: ["transformations"] });
      });
      await wait(400);
      const whileHeld = s.requests.slice(from);
      expect(whileHeld.filter(isMe)).toHaveLength(1);
      expect(whileHeld.filter((r) => !isMe(r)).map(describeRequest)).toEqual([]);
      s.releaseMe();
      await wait(300);
      const after = s.requests.slice(from);
      expect(isMe(after[0]!)).toBe(true);
      expect(after.filter(isMe)).toHaveLength(1);
      expect(after.some((r) => r.method === "GET" && r.url.startsWith("/api/v1/transformations?"))).toBe(true);
    });
  });
}

describe("F-DG4-146 apiRequest: a page GET is sent only after the identity work in flight is done", () => {
  beforeEach(() => resetSessionStateForTests());

  it("W3: a GET waits for a GET /me probe in flight (no identity check pending)", async () => {
    const { requests } = mockApi(route("GET", /./, () => page([])));
    const probe = deferred();
    const probing = asIdentityProbe(() => probe.promise);
    const get = apiRequest("/api/v1/transformations?limit=1");
    await wait(50);
    expect(requests.map(describeRequest)).toEqual([]);
    probe.resolve();
    await probing;
    await get;
    expect(requests.map(describeRequest)).toEqual(["GET /api/v1/transformations?limit=1"]);
  });

  it("W4: a GET waits for a pending identity check (no GET /me probe in flight)", async () => {
    const { requests } = mockApi(route("GET", /./, () => page([])));
    const check = deferred();
    const runner = vi.fn(() => check.promise);
    registerSessionCheck(runner);
    markSessionActive();
    const checking = revalidateSessionIdentity();
    expect(runner).toHaveBeenCalledTimes(1);
    const get = apiRequest("/api/v1/transformations?limit=1");
    await wait(50);
    expect(requests.map(describeRequest)).toEqual([]);
    check.resolve();
    await checking;
    await get;
    expect(requests.map(describeRequest)).toEqual(["GET /api/v1/transformations?limit=1"]);
    // Answered just now: the GET did not start another check of its own.
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
