// F-DG2-530 (REQ-S16-030): nothing fetched or written under one identity lands after the tab has moved to another.
// The API client records the session generation when a request is SENT; an answer that arrives after the session
// ended, after a sign-out here or after GET /me returned another identity is a SessionChangedError, never data. So no
// success continuation (setQueryData, navigate, a "Saved." banner) runs for it, and callers stay silent.
//  - the reviewer's X3 / X3b: an edit (PATCH) in flight across an identity change / a session end and B's sign-in;
//  - the same for an archive (TransformationDetailPage), an organization and a user write (useVersionedSave);
//  - a same-person new session: the draft is kept, no banner, no navigation, the form is usable again;
//  - X6: a refocus or a reconnect revalidates GET /me FIRST, then the stale page queries, bounded (one /me per event);
//  - sanity: an in-flight write that finishes under the same identity still updates the cache and navigates;
//  - API client: no error-level log, and an old request's 401 never ends the identity that replaced it.
// EN (LTR) and AR (RTL). SYNTHETIC data, scripted API.
import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionChangedError,
  apiRequest,
  getSessionGeneration,
  getSessionPhase,
  isSessionChangedError,
  markSessionActive,
  markSignedOut,
  noteSessionIdentity,
  registerSessionReset,
  resetSessionStateForTests,
  type SessionResetReason,
} from "../api/client.ts";
import { keys } from "../api/queries.ts";
import { QUERY_DEFAULTS } from "../app/App.tsx";
import { createI18n } from "../i18n/index.ts";
import arAuth from "../i18n/ar/auth.json";
import arCommon from "../i18n/ar/common.json";
import arTransformations from "../i18n/ar/transformations.json";
import enAuth from "../i18n/en/auth.json";
import enCommon from "../i18n/en/common.json";
import enTransformations from "../i18n/en/transformations.json";
import {
  ADMIN_GRANTS,
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  ORG_ID,
  TR_ID,
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
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

const TEXT = {
  en: { auth: enAuth, common: enCommon, transformations: enTransformations },
  ar: { auth: arAuth, common: arCommon, transformations: arTransformations },
} as const;
type Lang = keyof typeof TEXT;

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const TARGET_USER_ID = "01920000-0000-7000-9000-0000000002c3";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const unauthenticated = () => ({
  status: 401,
  body: { type: "urn:mth:problem:unauthenticated", title: "Sign-in required", status: 401, code: "unauthenticated" },
});
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const isMe = (r: RecordedRequest) => r.method === "GET" && /\/api\/v1\/me$/.test(r.url);

const ORG = {
  id: ORG_ID,
  code: "SYN-DEV",
  nameEn: "Synthetic Organization",
  nameAr: "جهة اصطناعية",
  defaultTimezone: "Asia/Riyadh",
  defaultCurrency: "SAR",
  defaultLocale: "ar",
  status: "active",
  version: 1,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};
const TARGET_USER = {
  id: TARGET_USER_ID,
  organizationId: ORG_ID,
  displayName: "Synthetic Target User",
  email: "synthetic.target@example.invalid",
  preferredLocale: "en",
  timezone: null,
  status: "active",
  identities: [],
  version: 4,
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};

/**
 * Two synthetic users (another user id AND another session) on one scripted server. `state.user` is whose session the
 * browser's cookie carries (null: no valid session). Every write answers with the record carrying the submitted
 * change, so A's change is recognisable wherever it might land. `hold(pred)` holds the ANSWER of matching requests
 * (they are sent, and answered by the cookie of the moment) until the returned release function is called.
 */
function server(lang: Lang, grants: typeof OFFICE_GRANTS | typeof ADMIN_GRANTS = OFFICE_GRANTS) {
  const state: { user: "A" | "B" | null; sameUserNewSession: boolean } = { user: "A", sameUserNewSession: false };
  const meA = {
    ...makeMe(grants, { preferredLocale: lang, displayName: "Synthetic User A" }),
    csrfToken: "a".repeat(43),
  };
  const meA2 = { ...meA, csrfToken: "n".repeat(43) }; // the same person signed in again elsewhere: a new session
  const meB = {
    ...makeMe(grants, { preferredLocale: lang, displayName: "Synthetic User B", id: USER_B_ID }),
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
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: state.user === "A" ? (state.sameUserNewSession ? meA2 : meA) : meB,
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/users\/[^/?]+$/, () => ({ status: 200, body: TARGET_USER })),
    route("GET", /\/api\/v1\/users/, () => page([])),
    route("GET", /\/audit/, () => page([])),
    route("GET", /\/api\/v1\/organizations\/[^/?]+$/, () => ({ status: 200, body: ORG })),
    route("GET", /\/api\/v1\/organizations/, () => page([ORG])),
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
    route("POST", /\/api\/v1\/transformations\/[^/]+\/archive$/, () => ({
      status: 200,
      body: { ...trA, name: "A-ARCHIVED-SECRET", archivedAt: "2026-10-07T10:00:00Z", status: "archived", version: 2 },
    })),
    route("PATCH", /\/api\/v1\/organizations\//, (req) => ({
      status: 200,
      body: { ...ORG, ...(req.body as object), version: 2 },
    })),
    // A's language save meets a version conflict at the moment B has signed in in another tab.
    route("PUT", /\/api\/v1\/me\/preferences$/, () => {
      state.user = "B";
      return problem(409, "version_conflict", { currentVersion: 4 });
    }),
    route("PATCH", /\/api\/v1\/users\//, (req) => ({
      status: 200,
      body: { ...TARGET_USER, ...(req.body as object), version: 5 },
    })),
  );
  const holds: { pred: (url: string, method: string) => boolean; waiters: (() => void)[] }[] = [];
  const mocked = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    for (const h of holds)
      if (h.pred(url, method)) {
        const res = mocked(input, init); // sent now: the cookie of the moment decides the answer
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

/** In another tab A signs out and B signs in; this tab re-probes GET /me (as a refocus does) and gets B. */
async function identityChangesToB(
  s: ReturnType<typeof server>,
  queryClient: ReturnType<typeof renderApp>["queryClient"],
) {
  s.state.user = "B";
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
  });
  await screen.findByText("Synthetic User B");
}

const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");

for (const lang of ["en", "ar"] as const) {
  const T = TEXT[lang];

  describe(`F-DG2-530 a write in flight across an identity change (${lang})`, () => {
    it("X3: A's PATCH answered after B's /me is not written into B's cache, not shown, and does not navigate B", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "A-PATCHED-SECRET" } });
      const releasePatch = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      await identityChangesToB(s, queryClient);
      const releaseB = s.hold((url, m) => m === "GET" && url.startsWith(`/api/v1/transformations/${TR_ID}`));
      const errors = vi.spyOn(console, "error");
      releasePatch();
      await wait(200);
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).toBeUndefined();
      expect(screen.queryAllByText("A-PATCHED-SECRET")).toEqual([]);
      expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}/edit`); // no navigation on A's answer
      releaseB();
      await wait(200);
      // After B's own GET answers 404, nothing of A's is on screen or in the cache.
      expect(screen.queryAllByText("A-PATCHED-SECRET")).toEqual([]);
      expect(screen.queryAllByText("A-ONLY-DETAIL")).toEqual([]);
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).toBeUndefined();
      expect(screen.getByText("Synthetic User B")).toBeTruthy();
      expect(errors).not.toHaveBeenCalled();
    });

    it("X3b: the same after a session END here and B's sign-in: A's late answer never lands", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "A-PATCHED-SECRET" } });
      const releasePatch = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      s.state.user = null;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      releasePatch();
      await wait(200);
      expect(queryClient.getQueryData(keys.transformation(TR_ID))).toBeUndefined();
      expect(router.state.location.pathname).toBe("/login"); // one navigation (the session end), none for A's answer
      fireEvent.change(await screen.findByLabelText(T.auth.dev.username), { target: { value: "dev.b" } });
      const releaseB = s.hold((url, m) => m === "GET" && url.startsWith(`/api/v1/transformations/${TR_ID}`));
      fireEvent.click(screen.getByRole("button", { name: T.auth.dev.submit }));
      await screen.findByText("Synthetic User B");
      await wait(100);
      expect(queryClient.getQueryData(keys.transformation(TR_ID))).toBeUndefined();
      expect(screen.queryAllByText("A-PATCHED-SECRET")).toEqual([]);
      releaseB();
    });

    it("an archive in flight across an identity change: A's archived record never lands in B's cache", async () => {
      const s = server(lang);
      const { queryClient } = renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(lang) });
      await screen.findAllByText("A-ONLY-DETAIL");
      fireEvent.click(screen.getByRole("button", { name: T.transformations.archive.action }));
      fireEvent.change(await screen.findByLabelText(new RegExp(`^${T.common.form.reason}`)), {
        target: { value: "Synthetic archive reason" },
      });
      const releaseArchive = s.hold((url, m) => m === "POST" && url.endsWith("/archive"));
      fireEvent.click(screen.getByRole("button", { name: T.transformations.archive.confirm }));
      await waitFor(() => expect(s.requests.some((r) => r.url.endsWith("/archive"))).toBe(true));
      await identityChangesToB(s, queryClient);
      releaseArchive();
      await wait(300);
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).not.toBe(
        "A-ARCHIVED-SECRET",
      );
      expect(screen.queryAllByText("A-ARCHIVED-SECRET")).toEqual([]);
      expect(screen.queryAllByText("A-ONLY-DETAIL")).toEqual([]);
      expect(screen.queryByRole("dialog")).toBeNull(); // A's dialog went with A's tree; nothing reopened it
    });

    it("an organization save in flight across an identity change: A's change is never stored under B", async () => {
      const s = server(lang, ADMIN_GRANTS);
      const { queryClient } = renderApp(`/admin/organizations/${ORG_ID}`, { i18n: createI18n(lang) });
      const nameEn = await screen.findByDisplayValue(ORG.nameEn);
      fireEvent.change(nameEn, { target: { value: "A-ORG-PATCHED" } });
      const release = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      // B's own GET of the record is held, so whatever the cache holds is what B sees.
      const releaseB = s.hold((url, m) => m === "GET" && url === `/api/v1/organizations/${ORG_ID}`);
      await identityChangesToB(s, queryClient);
      release();
      await wait(300);
      expect(screen.queryByDisplayValue("A-ORG-PATCHED")).toBeNull();
      releaseB();
      await wait(100);
      expect(queryClient.getQueryData<{ nameEn: string }>(keys.organization(ORG_ID))?.nameEn).not.toBe("A-ORG-PATCHED");
      expect(screen.queryByDisplayValue("A-ORG-PATCHED")).toBeNull();
      expect(screen.queryByText(T.common.state.saved)).toBeNull();
      expect(await screen.findByDisplayValue(ORG.nameEn)).toBeTruthy(); // B's own load of the record
    });

    it("a user save in flight across an identity change: A's change is never stored under B", async () => {
      const s = server(lang, ADMIN_GRANTS);
      const { queryClient } = renderApp(`/admin/users/${TARGET_USER_ID}`, { i18n: createI18n(lang) });
      const display = await screen.findByDisplayValue(TARGET_USER.displayName);
      fireEvent.change(display, { target: { value: "A-USER-PATCHED" } });
      const release = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      const releaseB = s.hold((url, m) => m === "GET" && url === `/api/v1/users/${TARGET_USER_ID}`);
      await identityChangesToB(s, queryClient);
      release();
      await wait(300);
      expect(screen.queryByDisplayValue("A-USER-PATCHED")).toBeNull();
      releaseB();
      await wait(100);
      expect(queryClient.getQueryData<{ displayName: string }>(keys.user(TARGET_USER_ID))?.displayName).not.toBe(
        "A-USER-PATCHED",
      );
      expect(screen.queryByDisplayValue("A-USER-PATCHED")).toBeNull();
      expect(screen.queryByText(T.common.state.saved)).toBeNull();
      expect(await screen.findByDisplayValue(TARGET_USER.displayName)).toBeTruthy();
    });

    it("a same-person new session: the in-flight save is dropped silently, the draft is kept and usable", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "my own draft" } });
      const releasePatch = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      s.state.sameUserNewSession = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      releasePatch();
      await wait(300);
      expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}/edit`);
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).not.toBe("my own draft");
      expect((screen.getByDisplayValue("my own draft") as HTMLInputElement).value).toBe("my own draft");
      expect(alerts()).toEqual([]); // no error banner for the dropped answer
      const save = screen.getByRole("button", { name: T.common.action.save }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      // Saving again goes out under the new session and lands normally.
      fireEvent.click(save);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}`));
      expect(s.requests.filter((r) => r.method === "PATCH").at(-1)?.headers["x-csrf-token"]).toBe("n".repeat(43));
    });

    it("a language save retried after a 409 is never written for the identity that replaced A", async () => {
      const s = server(lang);
      renderApp("/my-work", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      const other = lang === "en" ? "ar" : "en";
      const names = { en: "English", ar: "العربية" } as const;
      fireEvent.click(
        screen.getByRole("button", { name: T.common.language.switchTo.replace("{{language}}", names[other]) }),
      );
      await waitFor(() => expect(s.requests.filter(isMe).length).toBeGreaterThanOrEqual(2)); // the 409's fresh /me
      await wait(200);
      expect(s.requests.filter((r) => r.method === "PUT")).toHaveLength(1); // no second PUT under B's session
    });

    it("sanity: a write in flight that finishes under the SAME identity still updates the cache and navigates", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "A renamed" } });
      const releasePatch = s.hold((_u, m) => m === "PATCH");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(s.requests.some((r) => r.method === "PATCH")).toBe(true));
      // A refocus /me in between that returns the SAME identity changes nothing.
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      releasePatch();
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}`));
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).toBe("A renamed");
      expect(await screen.findAllByText("A renamed")).not.toHaveLength(0);
    });
  });

  describe(`F-DG2-530 X6: refocus and reconnect revalidate GET /me first (${lang})`, () => {
    it("after B signs in elsewhere, a refocus within /me's staleTime shows B's header with B's data, never A's", async () => {
      const s = server(lang);
      const { queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      // Production defaults: page queries are stale after 15 s, GET /me (60 s) is still fresh 20 s later.
      queryClient.setDefaultOptions({ queries: { ...QUERY_DEFAULTS, retry: false } });
      await screen.findByText("TR-A-SECRET");
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20_000);
      s.state.user = "B";
      const releaseMe = s.hold((url) => url === "/api/v1/me");
      const from = s.requests.length;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await wait(100);
      // While /me is unanswered, no page query has been sent with the new cookie.
      expect(s.requests.slice(from).map((r) => `${r.method} ${r.url.split("?")[0]}`)).toEqual(["GET /api/v1/me"]);
      expect(screen.getByText("Synthetic User A")).toBeTruthy();
      expect(screen.queryByText("TR-B-OWN")).toBeNull();
      releaseMe();
      await screen.findByText("TR-B-OWN");
      expect(screen.getByText("Synthetic User B")).toBeTruthy();
      expect(screen.queryByText("Synthetic User A")).toBeNull();
      expect(screen.queryByText("TR-A-SECRET")).toBeNull();
      expect(s.requests.slice(from).filter(isMe)).toHaveLength(1);
    });

    it("the same identity: a refocus refetches /me once, then the stale page queries; nothing when all is fresh", async () => {
      const s = server(lang);
      const { queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      queryClient.setDefaultOptions({ queries: { ...QUERY_DEFAULTS, retry: false } });
      await screen.findByText("TR-A-SECRET");
      // All fresh: a refocus sends nothing (no /me storm).
      let from = s.requests.length;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await wait(100);
      expect(s.requests.slice(from)).toEqual([]);
      // Stale: three focus events in a row and a reconnect share ONE /me, which goes first.
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20_000);
      from = s.requests.length;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });
      await wait(200);
      const sent = s.requests.slice(from);
      expect(sent.filter(isMe)).toHaveLength(1);
      expect(isMe(sent[0]!)).toBe(true);
      expect(sent.some((r) => r.url.startsWith("/api/v1/transformations?"))).toBe(true);
      expect(screen.getByText("TR-A-SECRET")).toBeTruthy();
      expect(screen.getByText("Synthetic User A")).toBeTruthy();
    });

    it("a refocus whose /me finds the session ended navigates once to sign-in and refetches no page data", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      await screen.findByText("TR-A-SECRET");
      queryClient.setDefaultOptions({ queries: { ...QUERY_DEFAULTS, retry: false } });
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20_000);
      s.state.user = null;
      const from = s.requests.length;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      const sent = s.requests.slice(from);
      expect(isMe(sent[0]!)).toBe(true);
      expect(sent.filter((r) => r.url.startsWith("/api/v1/transformations"))).toEqual([]);
      expect(router.state.location.search).toContain("error=session_expired");
    });
  });
}

describe("F-DG2-530 the API client's session generation", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
    });

  /** Every fetch is held until `answer(response)` releases the oldest one. */
  function heldFetch() {
    const waiters: (() => void)[] = [];
    const answers: Response[] = [];
    vi.stubGlobal("fetch", async () => {
      await new Promise<void>((r) => waiters.push(r));
      return answers.shift()!;
    });
    return {
      answer: (r: Response) => {
        answers.push(r);
        waiters.shift()!();
      },
    };
  }

  beforeEach(() => {
    resetSessionStateForTests();
    noteSessionIdentity(`${ORG_ID}\u0000A\u0000${"a".repeat(43)}`);
    markSessionActive();
  });

  it("an answer that arrives after an identity change is a SessionChangedError, with nothing logged at error level", async () => {
    const f = heldFetch();
    const errors = vi.spyOn(console, "error");
    const pending = apiRequest("/api/v1/transformations/x", { method: "PATCH", body: {} });
    noteSessionIdentity(`${ORG_ID}\u0000B\u0000${"b".repeat(43)}`);
    f.answer(json(200, { secret: "A" }));
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionChangedError);
    expect(isSessionChangedError(err)).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("an answer after a session end or a sign-out here is a SessionChangedError too", async () => {
    const f = heldFetch();
    const first = apiRequest("/api/v1/organizations");
    const second = apiRequest("/api/v1/users");
    const third = apiRequest("/api/v1/business-units");
    f.answer(json(200, { items: [] })); // first: still the same generation -> data
    await expect(first).resolves.toMatchObject({ status: 200 });
    f.answer(json(401, unauthenticated().body)); // second: the session ends
    await expect(second).rejects.toMatchObject({ status: 401 });
    expect(getSessionPhase()).toBe("ended");
    f.answer(json(200, { items: ["A"] })); // third: sent before the end, answered after it
    await expect(third).rejects.toBeInstanceOf(SessionChangedError);

    markSessionActive();
    const afterSignOut = apiRequest("/api/v1/organizations");
    markSignedOut();
    f.answer(json(200, { items: ["A"] }));
    await expect(afterSignOut).rejects.toBeInstanceOf(SessionChangedError);
  });

  it("a 401 for a request sent under the previous identity never ends the identity that replaced it", async () => {
    const f = heldFetch();
    const resets: SessionResetReason[] = [];
    const old = apiRequest("/api/v1/transformations");
    registerSessionReset((reason) => resets.push(reason));
    noteSessionIdentity(`${ORG_ID}\u0000B\u0000${"b".repeat(43)}`);
    const generation = getSessionGeneration();
    f.answer(json(401, unauthenticated().body));
    await expect(old).rejects.toBeInstanceOf(SessionChangedError);
    expect(getSessionPhase()).toBe("active");
    expect(getSessionGeneration()).toBe(generation);
    expect(resets).toEqual(["identity-changed"]); // the identity change only, no "ended"
  });

  it("a network failure of a request sent under the previous identity is a SessionChangedError (silent)", async () => {
    let reject: (e: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise((_, rj) => {
          reject = rj;
        }),
    );
    const pending = apiRequest("/api/v1/transformations");
    noteSessionIdentity(`${ORG_ID}\u0000B\u0000${"b".repeat(43)}`);
    reject(new TypeError("Failed to fetch"));
    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  });
});
