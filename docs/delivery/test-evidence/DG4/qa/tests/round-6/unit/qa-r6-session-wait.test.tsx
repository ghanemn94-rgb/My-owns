// qa-verifier DG4 round 6 (T-DG4-REV-QA-R6), F-DG4-145 adversarial follow-up. NOT part of the candidate: this file lives
// in docs/delivery/test-evidence/DG4/qa/tests/round-6/unit/ and is copied into a disposable clone's apps/web/src/auth/
// only to run. It pins one rule of F-DG2-570 / D-077 (apps/web/src/api/client.ts) that no existing web unit test pins
// (my mutant M4, 02e-unit-web-mutants-full.log: 1340/1340 pass with it):
//   "Every GET sent while a check or any other GET /me is in flight waits for it."
// The /me answer is HELD, so the order of answers cannot hide a page GET that was sent too early.
//   H1  an in-app navigation after B signed in elsewhere: while /me is held, no page GET is sent and nothing of B's is
//       shown under A's header; once /me answers, B's header, then B's list.
//   H2  a page GET past SESSION_RECHECK_MS (a list refetch, no navigation): while the revalidation /me is held, the
//       refetch GET is not sent; afterwards exactly one /me, before it.
// EN (LTR) and AR (RTL). SYNTHETIC data, scripted API (the product's own test fixtures). Controlled Date.now clock.
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_RECHECK_MS } from "../api/client.ts";
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

function server(lang: "en" | "ar") {
  const state = { user: "A" as "A" | "B" };
  const meA = { ...makeMe(OFFICE_GRANTS, { preferredLocale: lang, displayName: "Synthetic User A" }), csrfToken: "a".repeat(43) };
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
  const mocked = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (held && /\/api\/v1\/me$/.test(url) && (init?.method ?? "GET") === "GET") {
      const res = mocked(input, init); // sent now; answered by the cookie of this moment
      const h = held;
      await new Promise<void>((r) => h.push(r));
      return res;
    }
    return mocked(input, init);
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

for (const lang of ["en", "ar"] as const) {
  describe(`qa-r6 F-DG2-570 page GETs wait for the identity check in flight (${lang})`, () => {
    it("H1: navigation after B signed in elsewhere: no page GET and nothing of B's while /me is held", async () => {
      const s = server(lang);
      const { router } = renderApp("/my-work", { i18n: createI18n(lang) });
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
      expect(whileHeld.filter((r) => !isMe(r)).map((r) => `${r.method} ${r.url}`)).toEqual([]);
      expect(screen.queryByText("TR-B-OWN")).toBeNull();
      expect(header()).toBe("Synthetic User A");
      s.releaseMe();
      await screen.findByText("TR-B-OWN");
      expect(header()).toBe("Synthetic User B");
      expect(isMe(s.requests[from]!)).toBe(true);
    });

    it("H2: a refetch past SESSION_RECHECK_MS is not sent while the revalidation /me is held; one /me, first", async () => {
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
      expect(whileHeld.filter((r) => !isMe(r)).map((r) => `${r.method} ${r.url}`)).toEqual([]);
      s.releaseMe();
      await wait(300);
      const after = s.requests.slice(from);
      expect(isMe(after[0]!)).toBe(true);
      expect(after.filter(isMe)).toHaveLength(1);
      expect(after.some((r) => r.method === "GET" && r.url.startsWith("/api/v1/transformations?"))).toBe(true);
    });
  });
}
