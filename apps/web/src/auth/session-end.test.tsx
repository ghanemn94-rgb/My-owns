// F-DG2-480 (REQ-S16-030): a session that ends while the app is open lands ONCE on the sign-in page, with the
// localized "session ended" message and the sign-in form, a bounded number of GET /me requests and no stale signed-in
// shell. Triggers: a 401 on navigation (another page's query), a 401 on a mutation inside a dialog (the D-073
// commit-time refusal of an evidence upload), and a sign-out in another tab noticed by the next /me probe. A 403 is
// never a session end. EN (LTR) and AR (RTL). SYNTHETIC data, scripted API.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keys } from "../api/queries.ts";
import { createI18n } from "../i18n/index.ts";
import arAuth from "../i18n/ar/auth.json";
import arEvidence from "../i18n/ar/evidence.json";
import arNav from "../i18n/ar/nav.json";
import enAuth from "../i18n/en/auth.json";
import enEvidence from "../i18n/en/evidence.json";
import enNav from "../i18n/en/nav.json";
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
  type Handler,
  type RecordedRequest,
} from "../test/fixtures.tsx";
import { evidence, leadGrants, METHODOLOGY } from "../test/p2fixtures.ts";

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
  en: { auth: enAuth, evidence: enEvidence, nav: enNav, dir: "ltr" },
  ar: { auth: arAuth, evidence: arEvidence, nav: arNav, dir: "rtl" },
} as const;
type Lang = keyof typeof TEXT;

const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unauthenticated = () => ({
  status: 401,
  body: { type: "urn:mth:problem:unauthenticated", title: "Sign-in required", status: 401, code: "unauthenticated" },
});

/**
 * A scripted server whose session can end mid-test: once `server.ended` is true, every request except the
 * development sign-in answers 401 `unauthenticated`, like the API after a revocation, sign-out elsewhere or expiry.
 * Signing in again (POST /auth/dev-login with a username) starts a new session.
 */
function scriptedServer(lang: Lang, grants: Parameters<typeof makeMe>[0], extra: Handler[] = []) {
  const server = { ended: false };
  const me = makeMe(grants, { preferredLocale: lang });
  const sessionGate: Handler = (req) =>
    server.ended && !/\/auth\/dev-login$/.test(req.url) ? unauthenticated() : undefined;
  const api = mockApi(
    sessionGate,
    ...extra,
    route("POST", /\/auth\/dev-login$/, (req) => {
      const body = req.body as { username?: string } | undefined;
      if (!body || !body.username) return problem(400, "validation");
      server.ended = false;
      return { status: 204 };
    }),
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", /\/api\/v1\/transformations\?/, () => page([makeTransformation()])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({
      status: 200,
      body: makeTransformation({ currentPhase: "diagnose", entryPhase: null }),
    })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    (req) =>
      req.method === "GET" && /\/api\/v1\/transformations\/[^/]+\/[a-z-]+(\?|$)/.test(req.url) ? page([]) : undefined,
  );
  return { server, ...api };
}

const meCount = (requests: RecordedRequest[], from = 0) =>
  requests.slice(from).filter((r) => r.method === "GET" && /\/api\/v1\/me$/.test(r.url)).length;

/** Lands on the sign-in page exactly once, with the message and the form, and stays there (no loop). */
async function expectSessionEndedLanding(
  lang: Lang,
  router: ReturnType<typeof renderApp>["router"],
  requests: RecordedRequest[],
  from: number,
  expectedReturnTo: string,
) {
  const T = TEXT[lang];
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("error")).toBe("session_expired");
  expect(params.get("returnTo")).toBe(expectedReturnTo);
  expect((await screen.findByRole("alert")).textContent).toContain(T.auth.errors.session_expired);
  expect(await screen.findByLabelText(T.auth.dev.username)).toBeTruthy();
  expect(document.documentElement.dir).toBe(T.dir);
  // Give a loop every chance to show itself: the page must stay on sign-in with a bounded /me count.
  const landings: string[] = [];
  const stop = router.subscribe((state) => landings.push(state.location.pathname));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  stop();
  expect(landings).toEqual([]);
  expect(router.state.location.pathname).toBe("/login");
  expect(meCount(requests, from)).toBeLessThanOrEqual(2);
  // No stale signed-in shell: no sign-out button, no user name, no primary navigation.
  expect(screen.queryByRole("button", { name: new RegExp(T.auth.signOut) })).toBeNull();
  expect(screen.queryByText("Synthetic Test User")).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
}

for (const lang of ["en", "ar"] as const) {
  const T = TEXT[lang];

  describe(`session end while the app is open (${lang})`, () => {
    it("a 401 on navigation lands once on sign-in with the message; signing in again returns to the page", async () => {
      const { server, requests } = scriptedServer(lang, OFFICE_GRANTS);
      const { router, queryClient } = renderApp("/my-work", { i18n: createI18n(lang) });
      const link = await screen.findByRole("link", { name: T.nav.areas.transformations.label });
      // Signed out in another tab: the server now refuses this browser's session cookie.
      server.ended = true;
      const from = requests.length;
      // The router's navigation history: exactly one landing on /login after the click.
      const visited: string[] = [];
      const stop = router.subscribe((s) => visited.push(`${s.location.pathname}${s.location.search}`));
      fireEvent.click(link);
      await expectSessionEndedLanding(lang, router, requests, from, "/transformations");
      stop();
      expect(visited.filter((v) => v.startsWith("/login")).length).toBe(1);
      // Every session-scoped query and the cached identity are gone.
      expect(queryClient.getQueryData(keys.me)).toBeUndefined();
      expect(queryClient.getQueryCache().findAll({ queryKey: ["transformations"] })).toEqual([]);
      // Signing in again returns the user to returnTo.
      fireEvent.change(screen.getByLabelText(T.auth.dev.username), { target: { value: "dev.lead" } });
      fireEvent.click(screen.getByRole("button", { name: T.auth.dev.submit }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
      expect(await screen.findByText("TR-0001")).toBeTruthy();
    });

    it("a 401 on a dialog mutation (the commit-time upload refusal) closes the dialog and lands once on sign-in", async () => {
      const ev = evidence({ version: 2 });
      const { server, requests } = scriptedServer(lang, leadGrants(), [
        route("GET", new RegExp(`${esc(TR)}/evidence(\\?|$)`), () => page([ev])),
        route("POST", /\/content$/, () => {
          // The administrator revoked the uploader's access, which ended the session; the commit answers 401.
          server.ended = true;
          return unauthenticated();
        }),
      ]);
      const { router } = renderApp(`/transformations/${TR_ID}/evidence`, { i18n: createI18n(lang) });
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${esc(T.evidence.upload.action)}`) }));
      const dialog = await screen.findByRole("dialog");
      const file = new File(["synthetic\n"], "synthetic.csv", { type: "text/csv" });
      fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${T.evidence.upload.file}`)), {
        target: { files: [file] },
      });
      const from = requests.length;
      fireEvent.click(within(dialog).getByRole("button", { name: T.evidence.upload.confirm }));
      await expectSessionEndedLanding(lang, router, requests, from, `/transformations/${TR_ID}/evidence`);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requests.filter((r) => r.url.endsWith("/content")).length).toBe(1);
    });

    it("a sign-out elsewhere noticed by the next /me probe lands once on sign-in, never on the stale shell", async () => {
      const { server, requests } = scriptedServer(lang, OFFICE_GRANTS, [
        route("POST", /\/auth\/dev-login$/, () => problem(404, "not_found")),
      ]);
      const { router, queryClient } = renderApp("/my-work", { i18n: createI18n(lang) });
      await screen.findByRole("button", { name: new RegExp(T.auth.signOut) });
      server.ended = true;
      const from = requests.length;
      // What a window refocus does: the identity is re-probed and the server answers 401.
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
      });
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      expect(new URLSearchParams(router.state.location.search).get("error")).toBe("session_expired");
      expect((await screen.findByRole("alert")).textContent).toContain(T.auth.errors.session_expired);
      // OIDC mode (the development route answers 404): the corporate sign-in button is the form.
      expect(screen.getByRole("link", { name: T.auth.oidcButton })).toBeTruthy();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      expect(router.state.location.pathname).toBe("/login");
      expect(meCount(requests, from)).toBeLessThanOrEqual(2);
      expect(screen.queryByRole("button", { name: new RegExp(T.auth.signOut) })).toBeNull();
    });

    it("a 403 (forbidden) is never treated as a session end", async () => {
      const { requests } = scriptedServer(lang, OFFICE_GRANTS, [
        route("GET", /\/api\/v1\/transformations\?/, () => problem(403, "forbidden")),
      ]);
      const { router } = renderApp("/my-work", { i18n: createI18n(lang) });
      fireEvent.click(await screen.findByRole("link", { name: T.nav.areas.transformations.label }));
      await waitFor(() => expect(requests.some((r) => r.url.startsWith("/api/v1/transformations?"))).toBe(true));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      expect(router.state.location.pathname).toBe("/transformations");
      expect(screen.getByRole("button", { name: new RegExp(T.auth.signOut) })).toBeTruthy();
    });
  });
}

describe("session end under <StrictMode> (as in production)", () => {
  it("still lands exactly once on sign-in", async () => {
    const { server, requests } = scriptedServer("en", OFFICE_GRANTS);
    const { router } = renderApp("/my-work", { i18n: createI18n("en"), strict: true });
    const link = await screen.findByRole("link", { name: enNav.areas.transformations.label });
    server.ended = true;
    const from = requests.length;
    const visited: string[] = [];
    const stop = router.subscribe((s) => visited.push(s.location.pathname));
    fireEvent.click(link);
    await expectSessionEndedLanding("en", router, requests, from, "/transformations");
    stop();
    expect(visited.filter((v) => v === "/login").length).toBe(1);
  });
});

describe("sign-in page and the cached identity", () => {
  it("decides 'already signed in' only from a fresh /me, never from a stale cache", async () => {
    let signedIn = true;
    const { requests } = mockApi(
      route("GET", /\/api\/v1\/me$/, () =>
        signedIn ? { status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) } : unauthenticated(),
      ),
      route("POST", /\/auth\/dev-login$/, () => problem(400, "validation")),
    );
    const { router } = renderApp("/my-work", { i18n: createI18n("en") });
    await screen.findByRole("button", { name: /Sign out/ });
    signedIn = false;
    const from = requests.length;
    // The cache still holds the last successful /me; the server no longer knows the session.
    await act(async () => {
      await router.navigate("/login?returnTo=%2Fmy-work");
    });
    expect(await screen.findByLabelText(enAuth.dev.username)).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(router.state.location.pathname).toBe("/login");
    expect(meCount(requests, from)).toBeLessThanOrEqual(2);
  });

  it("a signed-in user who opens /login is sent on once /me confirms the session", async () => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) })),
    );
    const { router } = renderApp("/login?returnTo=%2Fabout", { i18n: createI18n("en") });
    await waitFor(() => expect(router.state.location.pathname).toBe("/about"));
  });

  it("signing out here shows 'signed out', not 'session ended', and no /me loop", async () => {
    let signedIn = true;
    const { requests } = mockApi(
      route("POST", /\/auth\/logout$/, () => {
        signedIn = false;
        return { status: 200, body: { endSessionUrl: null } };
      }),
      route("GET", /\/api\/v1\/me$/, () =>
        signedIn ? { status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) } : unauthenticated(),
      ),
      route("POST", /\/auth\/dev-login$/, () => problem(400, "validation")),
    );
    const { router } = renderApp("/my-work", { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(router.state.location.search).toContain("signedOut=1"));
    const from = requests.length;
    expect((await screen.findByRole("status")).textContent).toContain(enAuth.signedOut);
    expect(screen.queryByText(enAuth.errors.session_expired)).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(router.state.location.pathname).toBe("/login");
    expect(meCount(requests, from)).toBeLessThanOrEqual(1);
  });
});
