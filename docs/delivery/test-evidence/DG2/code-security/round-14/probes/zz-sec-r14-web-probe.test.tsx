// code-security-reviewer DG2 round-14 adversarial web probe (T-DG2-REV-SEC-R14). NOT product code: it lives in the
// reviewer's evidence directory and is copied into a disposable probe clone at apps/web/src/auth/ to run with the
// unit-web project. SYNTHETIC data, scripted API (the product's own test fixtures).
//
// W1  returnTo: safeReturnTo refuses every off-origin / scheme / protocol-relative / backslash / whitespace form, and the
//     sign-in page never navigates (via Navigate) or links (OIDC href) off-origin, whatever the query string says.
// W2  403 forbidden and 403 csrf on a mutation are never a session end (phase stays active, shell stays).
// W3  401 with another code (auth.login_failed) is not a session end.
// W4  Request storm: an INCONSISTENT server (GET /me 200 but every other GET 401 unauthenticated, e.g. a misconfigured
//     proxy) - count requests over 2 s; a loop between /login and the page would show up as an unbounded count.
// W5  Cross-user cache: user A's session ends while the sign-in page is mounted (reached in-app with the phase active:
//     the browser Back button to an earlier /login entry); user B then signs in through the development form in the
//     same tab. Does B's first render of /transformations show A's cached rows?
// W5b The same in OIDC mode (development sign-in answers 404): B signs in in another tab and this tab's /me re-probe
//     (window refocus) brings B's identity.
// W6  After a session end landing, the browser Back button to the protected page never renders the stale shell and
//     the redirect stays bounded.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionPhase } from "../api/client.ts";
import { keys } from "../api/queries.ts";
import { createI18n } from "../i18n/index.ts";
import enAuth from "../i18n/en/auth.json";
import { safeReturnTo } from "../pages/LoginPage.tsx";
import {
  BUSINESS_UNIT,
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
});

const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const unauthenticated = () => ({
  status: 401,
  body: { type: "urn:mth:problem:unauthenticated", title: "Sign-in required", status: 401, code: "unauthenticated" },
});
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("W1 returnTo", () => {
  const hostile = [
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "/login?returnTo=//evil.example",
    "",
  ];
  for (const h of hostile)
    it(`refuses ${JSON.stringify(h)}`, () => {
      expect(safeReturnTo(h)).toBe("/");
    });

  it("the sign-in page with hostile returnTo never leaves the origin (Navigate target and OIDC href)", async () => {
    for (const raw of ["%2F%2Fevil.example", "%2F%5Cevil.example", "https%3A%2F%2Fevil.example", "javascript%3Aalert(1)"]) {
      mockApi(
        route("GET", /\/api\/v1\/me$/, () => unauthenticated()),
        route("POST", /\/auth\/dev-login$/, () => problem(404, "not_found")),
      );
      const { router, unmount } = renderApp(`/login?returnTo=${raw}`, { i18n: createI18n("en") });
      const link = await screen.findByRole("link", { name: enAuth.oidcButton });
      const href = link.getAttribute("href")!;
      expect(href.startsWith("/api/v1/auth/login?returnTo=")).toBe(true);
      expect(new URL(href, "https://app.example").searchParams.get("returnTo")).toBe("/");
      expect(router.state.location.pathname).toBe("/login");
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it("signed in + hostile returnTo: the Navigate goes to '/' on the same origin", async () => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("GET", /\/api\/v1\/transformations/, () => page([])),
    );
    const { router } = renderApp("/login?returnTo=%2F%2Fevil.example", { i18n: createI18n("en") });
    await waitFor(() => expect(router.state.location.pathname).not.toBe("/login"));
    expect(router.state.location.pathname.startsWith("//")).toBe(false);
    // safeReturnTo turned the hostile value into "/" (dry run, probe-web-dryrun.log: the app stays on "/", same origin).
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("W2/W3 non-session 4xx are not a session end", () => {
  for (const [label, resp] of [
    ["403 forbidden", problem(403, "forbidden")],
    ["403 csrf", { status: 403, body: { type: "urn:mth:problem:csrf", title: "csrf", status: 403, code: "csrf" } }],
    [
      "401 auth.login_failed",
      { status: 401, body: { type: "urn:mth:problem:x", title: "x", status: 401, code: "auth.login_failed" } },
    ],
  ] as const) {
    it(`${label} on GET keeps the session and the shell`, async () => {
      const { requests } = mockApi(
        route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) })),
        route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
        route("GET", /\/api\/v1\/transformations\?/, () => resp),
      );
      const { router } = renderApp("/transformations", { i18n: createI18n("en") });
      await waitFor(() => expect(requests.some((r) => r.url.startsWith("/api/v1/transformations?"))).toBe(true));
      await wait(300);
      expect(getSessionPhase()).toBe("active");
      expect(router.state.location.pathname).toBe("/transformations");
      expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
    });
  }
});

describe("W4 request storm against an inconsistent server", () => {
  for (const bare of [false, true])
    it(`GET /me 200 but other GETs 401 ${bare ? "(no problem body)" : "unauthenticated"}: request count over 2 s`, async () => {
      const { requests } = mockApi(
        route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) })),
        route("POST", /\/auth\/dev-login$/, () => problem(404, "not_found")),
        (req) => (req.method === "GET" ? (bare ? { status: 401, body: "" } : unauthenticated()) : undefined),
      );
      const { router } = renderApp("/transformations", { i18n: createI18n("en") });
      const landings: string[] = [];
      router.subscribe((s) => landings.push(s.location.pathname));
      await wait(2000);
      const n = requests.length;
      // eslint-disable-next-line no-console
      console.log(`W4 bare=${bare}: ${n} requests in 2 s; ${landings.length} navigations; final ${router.state.location.pathname}`);
      expect(n).toBeLessThanOrEqual(10);
      expect(landings.length).toBeLessThanOrEqual(4);
    });
});

describe("W5 cross-user cache after a session end on the sign-in page", () => {
  it("user B never sees user A's cached transformations", async () => {
    let user: "A" | "B" | null = "A";
    let releaseB: (() => void) | null = null;
    const meA = makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User A" });
    const meB = makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User B" });
    const rowsA = [makeTransformation({ code: "TR-A-SECRET", name: "A only synthetic transformation" })];
    mockApi(
      route("POST", /\/auth\/dev-login$/, (req) => {
        const body = req.body as { username?: string } | undefined;
        if (!body?.username) return problem(400, "validation");
        user = "B";
        return { status: 204 };
      }),
      (req) => (user === null && req.method === "GET" ? unauthenticated() : undefined),
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: user === "A" ? meA : meB })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("GET", /\/api\/v1\/transformations\?/, () => (user === "A" ? page(rowsA) : page([]))),
    );
    // B's list is slow: hold it so the first render after B signs in shows whatever the cache holds.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (user === "B" && url.startsWith("/api/v1/transformations?")) await new Promise<void>((r) => (releaseB = r));
      return realFetch(input, init);
    });
    // History as in the browser: [/login (via the wordmark link) , /transformations].
    const { router, queryClient } = renderApp("/login?returnTo=%2Ftransformations", { i18n: createI18n("en") });
    await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
    expect(await screen.findByText("TR-A-SECRET")).toBeTruthy();
    // A's session expires; A (or the next person at the keyboard) presses Back to the earlier /login entry.
    user = null;
    await act(async () => {
      await router.navigate("/login?returnTo=%2Ftransformations");
    });
    expect(await screen.findByLabelText(enAuth.dev.username)).toBeTruthy();
    await wait(200);
    const cachedAfterEnd = queryClient.getQueryCache().findAll({ queryKey: ["transformations"] }).length;
    const phaseAfterEnd = getSessionPhase();
    // B signs in in the same tab.
    fireEvent.change(screen.getByLabelText(enAuth.dev.username), { target: { value: "dev.b" } });
    fireEvent.click(screen.getByRole("button", { name: enAuth.dev.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
    await screen.findByText("Synthetic User B");
    await wait(100);
    const leaked = screen.queryByText("TR-A-SECRET") !== null;
    // eslint-disable-next-line no-console
    console.log(
      `W5: phase after A's end on /login=${phaseAfterEnd}; transformations queries cached=${cachedAfterEnd}; B sees A's row=${leaked}`,
    );
    (releaseB as (() => void) | null)?.();
    expect(leaked).toBe(false);
  });
});

describe("W5b same, OIDC mode (no development sign-in): the next identity arrives through a /me re-probe", () => {
  it("user B (signed in in another tab) never sees user A's cached transformations in this tab", async () => {
    let user: "A" | "B" | null = "A";
    let releaseB: (() => void) | null = null;
    const meA = makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User A" });
    const meB = makeMe(OFFICE_GRANTS, { preferredLocale: "en", displayName: "Synthetic User B" });
    mockApi(
      route("POST", /\/auth\/dev-login$/, () => problem(404, "not_found")),
      (req) => (user === null && req.method === "GET" ? unauthenticated() : undefined),
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: user === "A" ? meA : meB })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("GET", /\/api\/v1\/transformations\?/, () =>
        user === "A" ? page([makeTransformation({ code: "TR-A-SECRET" })]) : page([]),
      ),
    );
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (user === "B" && url.startsWith("/api/v1/transformations?")) await new Promise<void>((r) => (releaseB = r));
      return realFetch(input, init);
    });
    const { router, queryClient } = renderApp("/transformations", { i18n: createI18n("en") });
    expect(await screen.findByText("TR-A-SECRET")).toBeTruthy();
    // A's session ends; Back to an earlier in-document /login entry (e.g. pushed by the sign-in page's wordmark link).
    user = null;
    await act(async () => {
      await router.navigate("/login?returnTo=%2Ftransformations");
    });
    expect(await screen.findByRole("link", { name: enAuth.oidcButton })).toBeTruthy();
    await wait(200);
    const phaseAfterEnd = getSessionPhase();
    // B signs in through the corporate IdP in ANOTHER tab of the same browser (shared cookie). This tab's window regains
    // focus: the sign-in page's /me query (in error, so stale) is re-probed, as refetchOnWindowFocus does in production.
    user = "B";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/transformations"));
    await screen.findByText("Synthetic User B");
    await wait(100);
    const leaked = screen.queryByText("TR-A-SECRET") !== null;
    // eslint-disable-next-line no-console
    console.log(`W5b: phase after A's end on /login=${phaseAfterEnd}; B sees A's row=${leaked}`);
    (releaseB as (() => void) | null)?.();
    expect(leaked).toBe(false);
  });
});

describe("W6 back button after a session-end landing", () => {
  it("never renders the stale shell and stays bounded", async () => {
    let ended = false;
    const { requests } = mockApi(
      (req) => (ended && req.method === "GET" ? unauthenticated() : undefined),
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: "en" }) })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("GET", /\/api\/v1\/transformations\?/, () => page([makeTransformation()])),
      route("POST", /\/auth\/dev-login$/, () => problem(404, "not_found")),
    );
    const { router, queryClient } = renderApp("/my-work", { i18n: createI18n("en") });
    await screen.findByRole("button", { name: /Sign out/ });
    await act(async () => {
      await router.navigate("/transformations");
    });
    await screen.findByText("TR-0001");
    ended = true;
    // Dry run: navigating to /my-work issued no request (fresh /me), so nothing answered 401. Re-probe /me instead, as
    // a window refocus does.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    const from = requests.length;
    const shells: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await router.navigate(-1);
      });
      shells.push(screen.queryByRole("button", { name: /Sign out/ }) !== null);
      await wait(150);
    }
    await wait(300);
    // eslint-disable-next-line no-console
    console.log(`W6: requests after 3x Back ${requests.length - from}; final ${router.state.location.pathname}; shell seen ${shells}`);
    expect(shells.every((s) => !s)).toBe(true);
    expect(requests.length - from).toBeLessThanOrEqual(12);
  });
});
