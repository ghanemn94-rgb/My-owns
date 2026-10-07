// T-DG2-FE15 (REQ-S16-030): the header, the data and every effect of a user action belong to ONE identity.
//  - F-DG2-530 / F-DG2-580: a handler that takes its answer under identity A and then awaits further (a list
//    invalidation, the create page's GET /me permission refresh) never navigates, writes the cache or shows anything
//    once the tab has moved to identity B meanwhile (auth/sessionBound.ts). The reviewer's Y1 and Y1c; the same for an
//    edit, an organization create and a user create; router state left in history never renders for another person.
//  - F-DG2-570: every in-app navigation, and any other page GET sent more than SESSION_RECHECK_MS after the last
//    GET /me, revalidates /me FIRST, so a page opened after B signed in elsewhere shows B's header above B's data
//    (N0: no time passed at all, the reviewer's Y5; N1: a record; N2: the list), never A's header above B's data.
//    Bounded: one /me per navigation, shared by its burst; none for other GETs inside the window; writes neither wait
//    for nor trigger it.
//  - the convention: no raw navigate / setQueryData in app code (source scan + the ESLint rule itself).
// EN (LTR) and AR (RTL). SYNTHETIC data, scripted API (the product's own test fixtures).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_RECHECK_MS,
  getSessionGeneration,
  markSessionActive,
  noteSessionIdentity,
  resetSessionStateForTests,
} from "../api/client.ts";
import { keys } from "../api/queries.ts";
import { createI18n } from "../i18n/index.ts";
import arAdmin from "../i18n/ar/admin.json";
import arCommon from "../i18n/ar/common.json";
import arTransformations from "../i18n/ar/transformations.json";
import enAdmin from "../i18n/en/admin.json";
import enCommon from "../i18n/en/common.json";
import enTransformations from "../i18n/en/transformations.json";
import {
  ADMIN_GRANTS,
  BUSINESS_UNIT,
  BU_ID,
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
import { beginSessionGuard, bindToSession } from "./sessionBound.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TEXT = {
  en: { admin: enAdmin, common: enCommon, transformations: enTransformations },
  ar: { admin: arAdmin, common: arCommon, transformations: arTransformations },
} as const;
type Lang = keyof typeof TEXT;

const USER_B_ID = "01920000-0000-7000-9000-0000000002b2";
const NEW_TR_ID = "01920000-0000-7000-9000-0000000003a1";
const NEW_ORG_ID = "01920000-0000-7000-9000-0000000003a2";
const NEW_USER_ID = "01920000-0000-7000-9000-0000000003a3";
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const isMe = (r: RecordedRequest) => r.method === "GET" && /\/api\/v1\/me$/.test(r.url);
const summary = (rs: RecordedRequest[]) => rs.map((r) => `${r.method} ${r.url.split("?")[0]}`);
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

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
const NEW_USER = {
  id: NEW_USER_ID,
  organizationId: ORG_ID,
  displayName: "A-NEW-USER-SECRET",
  email: null,
  preferredLocale: "en",
  timezone: null,
  status: "active",
  identities: [],
  version: 1,
  createdAt: "2026-10-07T08:00:00Z",
  updatedAt: "2026-10-07T08:00:00Z",
};

/**
 * Two synthetic users A and B (another user id AND another session) on one scripted server. `state.user` is whose
 * session the browser's cookie carries. A's records are visible only to A; B gets 404 for them. `hold(pred)` holds the
 * ANSWER of matching requests (they are sent now and answered by the cookie of that moment) until released.
 */
function server(lang: Lang, grants: typeof OFFICE_GRANTS | typeof ADMIN_GRANTS = OFFICE_GRANTS) {
  const state: { user: "A" | "B"; newVisibleToA: boolean } = { user: "A", newVisibleToA: true };
  const meA = {
    ...makeMe(grants, { preferredLocale: lang, displayName: "Synthetic User A" }),
    csrfToken: "a".repeat(43),
  };
  const meB = {
    ...makeMe(grants, { preferredLocale: lang, displayName: "Synthetic User B", id: USER_B_ID }),
    csrfToken: "b".repeat(43),
  };
  const trA = makeTransformation({ code: "TR-A-SECRET", name: "A-ONLY-DETAIL" });
  const createdA = makeTransformation({ id: NEW_TR_ID, code: "TR-A-NEW-SECRET", name: "A-CREATED-SECRET-NAME" });
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: state.user === "A" ? meA : meB })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/users\/[^/?]+$/, () =>
      state.user === "A" ? { status: 200, body: NEW_USER } : problem(404, "not_found"),
    ),
    route("GET", /\/api\/v1\/users/, () => page([])),
    route("GET", /\/audit/, () => page([])),
    route("GET", /\/api\/v1\/organizations\/[^/?]+$/, (req) =>
      req.url.endsWith(NEW_ORG_ID) && state.user === "B" ? problem(404, "not_found") : { status: 200, body: ORG },
    ),
    route("GET", /\/api\/v1\/organizations/, () => page([ORG])),
    route("GET", /\/api\/v1\/transformations\?/, () =>
      state.user === "A" ? page([trA]) : page([makeTransformation({ code: "TR-B-OWN", name: "B own" })]),
    ),
    route("GET", /\/api\/v1\/transformations\/[^/?]+\/[^?]+/, () => page([])),
    route("GET", /\/api\/v1\/transformations\/[^/?]+$/, (req) =>
      state.user === "A" && (state.newVisibleToA || !req.url.endsWith(NEW_TR_ID))
        ? { status: 200, body: req.url.endsWith(NEW_TR_ID) ? createdA : trA }
        : problem(404, "not_found"),
    ),
    route("GET", /\/api\/v1\/decisions/, () => page([])),
    route("POST", /\/api\/v1\/transformations$/, () => ({ status: 201, body: createdA })),
    route("PATCH", /\/api\/v1\/transformations\//, (req) => ({
      status: 200,
      body: { ...trA, name: (req.body as { name: string }).name, version: 2 },
    })),
    route("POST", /\/api\/v1\/organizations$/, () => ({
      status: 201,
      body: { ...ORG, id: NEW_ORG_ID, code: "A-NEW-ORG", nameEn: "A-NEW-ORG-SECRET" },
    })),
    route("POST", /\/api\/v1\/users$/, () => ({ status: 201, body: NEW_USER })),
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
  return { state, hold, createdA, trA, ...api };
}

/**
 * The identity changes BETWEEN the handler's awaits: when the handler awaits its own post-write invalidation of
 * `prefix`, A has signed out and B signed in in another tab, and this tab's GET /me (a refocus, the permission refresh)
 * answers B before that await returns. Exactly the window F-DG2-530's round-16 verification describes.
 */
function identityChangesDuringInvalidation(
  queryClient: QueryClient,
  s: ReturnType<typeof server>,
  prefix: string,
): { fired: () => boolean } {
  const original = queryClient.invalidateQueries.bind(queryClient);
  let fired = false;
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters, options) => {
    if (!fired && filters?.queryKey?.[0] === prefix) {
      fired = true;
      s.state.user = "B";
      await original({ queryKey: keys.me });
    }
    return original(filters, options);
  });
  return { fired: () => fired };
}

/** Records every DOM moment where A's name is in the header while `bOnly()` (B's data) is on the page. */
function observeMixedIdentity(bOnly: () => boolean) {
  const hits: string[] = [];
  const check = () => {
    const header = document.querySelector(".user-box__name")?.textContent?.trim() ?? null;
    if (header === "Synthetic User A" && bOnly()) hits.push(`${location.pathname} | header=${header}`);
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return {
    hits,
    stop: () => observer.disconnect(),
  };
}

/** Moves the clock `ms` ahead (Date.now only: real timers keep running for Testing Library and React). */
function advanceClock(ms: number) {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + ms);
}

async function submitCreate(T: (typeof TEXT)[Lang]) {
  const unit = (await screen.findByLabelText(startsWith(T.transformations.field.businessUnit))) as HTMLSelectElement;
  fireEvent.change(unit, { target: { value: BU_ID } });
  fireEvent.change(screen.getByLabelText(startsWith(T.transformations.field.name)), {
    target: { value: "A-CREATED-SECRET-NAME" },
  });
  fireEvent.click(screen.getByRole("button", { name: T.transformations.form.create }));
}

for (const lang of ["en", "ar"] as const) {
  const T = TEXT[lang];

  describe(`F-DG2-530/580 no effect of A's action after a further await once the tab is B's (${lang})`, () => {
    it("Y1: a create whose post-create GET /me returns B: B is not navigated and never sees A's code or name", async () => {
      const s = server(lang);
      const { router } = renderApp("/transformations/new", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      const releasePost = s.hold((_u, m) => m === "POST");
      await submitCreate(T);
      await waitFor(() => expect(s.requests.some((r) => r.method === "POST")).toBe(true));
      const generation = getSessionGeneration();
      // While A's POST is in flight, A signs out and B signs in in another tab; this tab has not noticed yet, so the
      // 201 is returned under A's generation. The create's own permission refresh (GET /me) is the first to see B.
      s.state.user = "B";
      const errors = vi.spyOn(console, "error");
      const seen = observeMixedIdentity(
        () => (document.body.textContent ?? "").match(/TR-A-NEW-SECRET|A-CREATED-SECRET-NAME/) !== null,
      );
      releasePost();
      await screen.findByText("Synthetic User B");
      await wait(400);
      seen.stop();
      const body = document.body.textContent ?? "";
      expect(getSessionGeneration()).toBeGreaterThan(generation);
      expect(router.state.location.pathname).toBe("/transformations/new"); // not /transformations/<A's new id>
      expect(router.state.location.state).toBeNull(); // no router state carrying A's code and name
      expect(body).not.toContain("TR-A-NEW-SECRET");
      expect(body).not.toContain("A-CREATED-SECRET-NAME");
      expect(document.querySelector('[data-state="created-not-visible"]')).toBeNull();
      expect(screen.queryAllByDisplayValue("A-CREATED-SECRET-NAME")).toEqual([]); // A's typed form went with A's tree
      expect(screen.queryAllByRole("alert")).toEqual([]); // silent: no error banner
      expect(seen.hits).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
    });

    it("Y1c: the same create under one identity still lands on the created record", async () => {
      const s = server(lang);
      const { router } = renderApp("/transformations/new", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      await submitCreate(T);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_TR_ID}`));
      expect(await screen.findByText(T.transformations.created)).toBeTruthy();
      expect((await screen.findAllByText("A-CREATED-SECRET-NAME")).length).toBeGreaterThan(0);
      // Bounded: the create's own permission refresh (F-DG1-210) and the navigation's identity confirmation (F-DG2-570).
      const afterPost = s.requests.slice(s.requests.findIndex((r) => r.method === "POST"));
      expect(afterPost.filter(isMe)).toHaveLength(2);
    });

    it("Y1c (not visible to the creator): the creator still gets 'created, but you cannot open it' with the 201's code", async () => {
      const s = server(lang);
      const { router } = renderApp("/transformations/new", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      // The creator's grant covers create at the unit but not reads of the new record (F-DG1-004).
      s.state.newVisibleToA = false;
      await submitCreate(T);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_TR_ID}`));
      const panel = await waitFor(() => {
        const el = document.querySelector('[data-state="created-not-visible"]');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(panel.textContent).toContain("TR-A-NEW-SECRET");
    });

    it("router state left in history (Back/Forward) never shows A's created record to B", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp("/my-work", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      s.state.user = "B";
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await screen.findByText("Synthetic User B");
      // A history entry written by A's create (A's id, code and name, and A as its creator).
      await act(async () => {
        await router.navigate(`/transformations/${NEW_TR_ID}`, {
          state: {
            created: {
              id: NEW_TR_ID,
              code: "TR-A-NEW-SECRET",
              name: "A-CREATED-SECRET-NAME",
              createdBy: { organizationId: ORG_ID, userId: makeMe(OFFICE_GRANTS).user.id },
            },
          },
        });
      });
      await waitFor(() => expect(document.querySelector('[data-state="no-permission"]')).not.toBeNull());
      expect(document.querySelector('[data-state="created-not-visible"]')).toBeNull();
      expect(document.body.textContent).not.toContain("TR-A-NEW-SECRET");
      expect(document.body.textContent).not.toContain("A-CREATED-SECRET-NAME");
    });

    it("an edit whose identity changes between its awaits: B is not navigated to A's record and keeps nothing of A's", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "A-PATCHED-SECRET" } });
      const switched = identityChangesDuringInvalidation(queryClient, s, "transformations");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await screen.findByText("Synthetic User B");
      await wait(300);
      expect(switched.fired()).toBe(true);
      expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}/edit`); // A's navigation was dropped
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).not.toBe("A-PATCHED-SECRET");
      expect(document.body.textContent).not.toContain("A-PATCHED-SECRET");
      expect(screen.queryAllByDisplayValue("A-PATCHED-SECRET")).toEqual([]);
    });

    it("an organization create whose identity changes between its awaits: B is not navigated to A's new organization", async () => {
      const s = server(lang, ADMIN_GRANTS);
      const { router, queryClient } = renderApp("/admin/organizations", { i18n: createI18n(lang) });
      fireEvent.click(await screen.findByRole("button", { name: T.admin.organizations.new }));
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.code)), { target: { value: "A-NEW-ORG" } });
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.nameEn)), {
        target: { value: "A-NEW-ORG-SECRET" },
      });
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.nameAr)), { target: { value: "جهة أ" } });
      const switched = identityChangesDuringInvalidation(queryClient, s, "organizations");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.create }));
      await screen.findByText("Synthetic User B");
      await wait(300);
      expect(switched.fired()).toBe(true);
      expect(s.requests.some((r) => r.method === "POST" && r.url === "/api/v1/organizations")).toBe(true);
      expect(router.state.location.pathname).toBe("/admin/organizations");
      expect(document.body.textContent).not.toContain("A-NEW-ORG-SECRET");
    });

    it("a user create whose identity changes between its awaits: B is not navigated to A's new user", async () => {
      const s = server(lang, ADMIN_GRANTS);
      const { router, queryClient } = renderApp("/admin/users", { i18n: createI18n(lang) });
      fireEvent.click(await screen.findByRole("button", { name: T.admin.users.new }));
      fireEvent.change(screen.getByLabelText(startsWith(T.admin.users.displayName)), {
        target: { value: "A-NEW-USER-SECRET" },
      });
      const switched = identityChangesDuringInvalidation(queryClient, s, "users");
      fireEvent.click(screen.getByRole("button", { name: T.common.action.create }));
      await screen.findByText("Synthetic User B");
      await wait(300);
      expect(switched.fired()).toBe(true);
      expect(s.requests.some((r) => r.method === "POST" && r.url === "/api/v1/users")).toBe(true);
      expect(router.state.location.pathname).toBe("/admin/users");
      expect(document.body.textContent).not.toContain("A-NEW-USER-SECRET");
    });

    it("sanity: the organization and user creates under one identity still navigate to the new record", async () => {
      server(lang, ADMIN_GRANTS);
      const { router } = renderApp("/admin/organizations", { i18n: createI18n(lang) });
      fireEvent.click(await screen.findByRole("button", { name: T.admin.organizations.new }));
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.code)), { target: { value: "A-NEW-ORG" } });
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.nameEn)), { target: { value: "Org A" } });
      fireEvent.change(screen.getByLabelText(startsWith(T.common.field.nameAr)), { target: { value: "جهة أ" } });
      fireEvent.click(screen.getByRole("button", { name: T.common.action.create }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/admin/organizations/${NEW_ORG_ID}`));
      await act(async () => {
        await router.navigate("/admin/users");
      });
      fireEvent.click(await screen.findByRole("button", { name: T.admin.users.new }));
      fireEvent.change(screen.getByLabelText(startsWith(T.admin.users.displayName)), { target: { value: "User A" } });
      fireEvent.click(screen.getByRole("button", { name: T.common.action.create }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/admin/users/${NEW_USER_ID}`));
    });

    it("sanity: an edit under one identity (a same-identity /me between its awaits) still updates the cache and navigates", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      fireEvent.change(name, { target: { value: "A renamed" } });
      const original = queryClient.invalidateQueries.bind(queryClient);
      vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters, options) => {
        if (filters?.queryKey?.[0] === "transformations") await original({ queryKey: keys.me }); // still A
        return original(filters, options);
      });
      const generation = getSessionGeneration();
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}`));
      expect(getSessionGeneration()).toBe(generation);
      expect(s.requests.filter(isMe).length).toBeGreaterThanOrEqual(2);
      expect(queryClient.getQueryData<{ name: string }>(keys.transformation(TR_ID))?.name).toBe("A renamed");
    });
  });

  describe(`F-DG2-570 the header and the data of ONE identity on in-app navigation (${lang})`, () => {
    it("N1: B signed in elsewhere, no focus event: opening A's record asks GET /me first; B's header above B's answer", async () => {
      const s = server(lang);
      const { router } = renderApp("/transformations", { i18n: createI18n(lang) });
      await screen.findByText("TR-A-SECRET");
      s.state.user = "B"; // another tab: A signed out, B signed in
      advanceClock(5_000); // the user keeps working in this tab a few seconds later (domain probe: ~4.5 s after /me)
      const seen = observeMixedIdentity(() => document.querySelector('[data-state="no-permission"]') !== null);
      const from = s.requests.length;
      await act(async () => {
        await router.navigate(`/transformations/${TR_ID}`);
      });
      await screen.findByText("Synthetic User B");
      await waitFor(() => expect(document.querySelector('[data-state="no-permission"]')).not.toBeNull());
      seen.stop();
      const sent = summary(s.requests.slice(from));
      expect(sent[0]).toBe("GET /api/v1/me");
      expect(sent.filter((r) => r === "GET /api/v1/me")).toHaveLength(1);
      expect(screen.queryByText("Synthetic User A")).toBeNull();
      expect(seen.hits).toEqual([]);
    });

    it("N2: opening the list: B's header with B's list and B's permissions, never A's header or A's empty-state", async () => {
      const s = server(lang);
      const { router } = renderApp("/my-work", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      s.state.user = "B";
      advanceClock(16_000); // the domain probe's N2: 16 s later, still inside /me's 60 s staleTime
      const seen = observeMixedIdentity(() => (document.body.textContent ?? "").includes("TR-B-OWN"));
      const from = s.requests.length;
      await act(async () => {
        await router.navigate("/transformations");
      });
      await screen.findByText("TR-B-OWN");
      seen.stop();
      expect(screen.getByText("Synthetic User B")).toBeTruthy();
      expect(screen.queryByText("Synthetic User A")).toBeNull();
      expect(summary(s.requests.slice(from))[0]).toBe("GET /api/v1/me");
      expect(seen.hits).toEqual([]);
    });

    it("N0 (the reviewer's Y5): B signed in a moment ago, no time passes, no focus event: the next page is B's under B's header", async () => {
      const s = server(lang);
      const { router } = renderApp("/my-work", { i18n: createI18n(lang) });
      await screen.findByText("Synthetic User A");
      s.state.user = "B"; // immediately after this tab's last /me: inside every fresh window
      const seen = observeMixedIdentity(() => (document.body.textContent ?? "").includes("TR-B-OWN"));
      const from = s.requests.length;
      await act(async () => {
        await router.navigate("/transformations");
      });
      await screen.findByText("TR-B-OWN");
      seen.stop();
      expect(summary(s.requests.slice(from))[0]).toBe("GET /api/v1/me");
      expect(document.querySelector(".user-box__name")?.textContent?.trim()).toBe("Synthetic User B");
      expect(seen.hits).toEqual([]);
    });

    it("bounded: one GET /me per navigation, shared by the page's burst; other GETs only after the window; same identity kept", async () => {
      const s = server(lang);
      const { router, queryClient } = renderApp("/transformations", { i18n: createI18n(lang) });
      await screen.findByText("TR-A-SECRET");
      const generation = getSessionGeneration();
      // An in-app navigation: ONE /me, sent first, shared by the workspace's burst of page GETs.
      let from = s.requests.length;
      await act(async () => {
        await router.navigate(`/transformations/${TR_ID}`);
      });
      await screen.findAllByText("A-ONLY-DETAIL");
      await wait(100);
      let sent = s.requests.slice(from);
      expect(summary(sent)[0]).toBe("GET /api/v1/me");
      expect(sent.filter(isMe)).toHaveLength(1);
      expect(sent.filter((r) => !isMe(r)).length).toBeGreaterThan(1);
      // A refetch that is not a navigation, inside the window: no /me.
      from = s.requests.length;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.transformation(TR_ID) });
      });
      sent = s.requests.slice(from);
      expect(sent.filter(isMe)).toHaveLength(0);
      expect(sent.length).toBeGreaterThan(0);
      // The same after the window: ONE /me first.
      expect(SESSION_RECHECK_MS).toBeLessThan(3_000);
      advanceClock(3_000);
      from = s.requests.length;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.transformation(TR_ID) });
      });
      sent = s.requests.slice(from);
      expect(summary(sent)[0]).toBe("GET /api/v1/me");
      expect(sent.filter(isMe)).toHaveLength(1);
      expect(getSessionGeneration()).toBe(generation); // the same identity: nothing reset
      expect(document.querySelector(".user-box__name")?.textContent?.trim()).toBe("Synthetic User A");
      expect(screen.getAllByText("A-ONLY-DETAIL").length).toBeGreaterThan(0);
    });

    it("writes neither wait for nor trigger the recheck: the save goes out at once with the user's own CSRF token", async () => {
      const s = server(lang);
      const { router } = renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(lang) });
      const name = await screen.findByDisplayValue("A-ONLY-DETAIL");
      advanceClock(3_000);
      fireEvent.change(name, { target: { value: "A renamed later" } });
      const from = s.requests.length;
      fireEvent.click(screen.getByRole("button", { name: T.common.action.save }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${TR_ID}`));
      const sent = s.requests.slice(from);
      expect(sent[0]?.method).toBe("PATCH");
      expect(sent[0]?.headers["x-csrf-token"]).toBe("a".repeat(43));
    });
  });
}

describe("auth/sessionBound.ts: effects of a previous session generation are dropped", () => {
  it("navigate, setQueryData and run act while the generation is current, and do nothing after it moved", () => {
    resetSessionStateForTests();
    noteSessionIdentity("org\u0000user-a\u0000csrf-a");
    markSessionActive();
    const navigate = vi.fn();
    const queryClient = new QueryClient();
    const action = bindToSession({ navigate, queryClient });
    expect(action.current()).toBe(true);
    expect(action.navigate("/x", { state: { a: 1 } })).toBe(true);
    expect(action.setQueryData(["k"], 1)).toBe(true);
    const effect = vi.fn();
    expect(action.run(effect)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["k"])).toBe(1);
    expect(effect).toHaveBeenCalledTimes(1);

    noteSessionIdentity("org\u0000user-b\u0000csrf-b"); // another identity: the generation moves
    expect(action.current()).toBe(false);
    expect(action.stale()).toBe(true);
    expect(action.navigate("/y")).toBe(false);
    expect(action.setQueryData(["k"], 2)).toBe(false);
    expect(action.run(effect)).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["k"])).toBe(1);
    expect(effect).toHaveBeenCalledTimes(1);
    // An action begun under the new generation acts again.
    expect(bindToSession({ navigate, queryClient }).navigate("/z")).toBe(true);
    expect(beginSessionGuard().stale()).toBe(false);
    resetSessionStateForTests();
  });

  it("the same identity re-probed does not move the generation (a same-identity action keeps its effects)", () => {
    resetSessionStateForTests();
    noteSessionIdentity("org\u0000user-a\u0000csrf-a");
    const guard = beginSessionGuard();
    noteSessionIdentity("org\u0000user-a\u0000csrf-a");
    expect(guard.stale()).toBe(false);
    resetSessionStateForTests();
  });
});

// ------------------------------------------------------------------------------------------------ the convention
/** The repository root: the nearest directory up from the working directory that holds pnpm-workspace.yaml. */
function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
const REPO = repoRoot();
const SRC = join(REPO, "apps", "web", "src");
/** The session transitions: they navigate BECAUSE the generation moved (auth/sessionBound.ts header). */
const TRANSITIONS = ["auth/session.tsx", "app/Shell.tsx", "pages/LoginPage.tsx"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the convention: no raw navigate or cache write in app code (T-DG2-FE15)", () => {
  const files = sourceFiles(SRC).map((p) => ({
    rel: relative(SRC, p).split("\\").join("/"),
    text: readFileSync(p, "utf8"),
  }));

  it("scans the app's source files", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.rel === "pages/transformations/TransformationCreatePage.tsx")).toBe(true);
  });

  it("useNavigate is imported only by the session-bound module and the three session transitions (justified)", () => {
    const users = files.filter((f) => /\buseNavigate\b/.test(f.text)).map((f) => f.rel);
    expect(users.sort()).toEqual(["auth/sessionBound.ts", ...TRANSITIONS].sort());
    for (const rel of TRANSITIONS) {
      const text = files.find((f) => f.rel === rel)!.text;
      expect(text, rel).toMatch(
        /eslint-disable-next-line no-restricted-imports -- session transition: .+\n.*useNavigate/,
      );
    }
  });

  it("the query cache is written and the router navigated only through a session-bound action", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === "auth/sessionBound.ts") continue;
      f.text.split("\n").forEach((line, i) => {
        if (/\.(setQueryData|setQueriesData)\s*[<(]/.test(line) && !/\baction\.setQueryData\s*[<(]/.test(line))
          offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`);
        if (/\.navigate\s*\(/.test(line) && !/\baction\.navigate\s*\(/.test(line))
          offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the ESLint rule refuses a raw navigate, a raw cache write and a useNavigate import in a page", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: REPO });
    const code = [
      'import { useQueryClient } from "@tanstack/react-query";',
      'import { useNavigate } from "react-router";',
      "export function Page() {",
      "  const navigate = useNavigate();",
      "  const queryClient = useQueryClient();",
      "  const router = { navigate: (_to: string) => undefined };",
      "  const save = async () => {",
      "    await Promise.resolve();",
      '    queryClient.setQueryData(["k"], 1);',
      '    router.navigate("/x");',
      '    void navigate("/y");',
      "  };",
      "  return save;",
      "}",
      "",
    ].join("\n");
    const [result] = await eslint.lintText(code, { filePath: join(SRC, "pages", "fe15-convention-probe.tsx") });
    const rules = (result?.messages ?? []).map((m) => `${m.line}:${m.ruleId}`);
    expect(rules).toEqual(
      expect.arrayContaining(["2:no-restricted-imports", "9:no-restricted-syntax", "10:no-restricted-syntax"]),
    );
    // The same code through a session-bound action passes.
    const bound = [
      'import { useSessionBoundAction } from "../auth/sessionBound.ts";',
      "export function Page() {",
      "  const begin = useSessionBoundAction();",
      "  return async () => {",
      "    const action = begin();",
      "    await Promise.resolve();",
      '    action.setQueryData(["k"], 1);',
      '    action.navigate("/x");',
      "  };",
      "}",
      "",
    ].join("\n");
    const [ok] = await eslint.lintText(bound, { filePath: join(SRC, "pages", "fe15-convention-probe.tsx") });
    expect((ok?.messages ?? []).filter((m) => m.severity === 2)).toEqual([]);
  }, 60_000);
});
