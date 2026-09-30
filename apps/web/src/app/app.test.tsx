// Shell and journeys against a scripted API (the real contract shapes; SYNTHETIC data):
//  - Arabic RTL by default; the switch changes <html lang dir> and persists with PUT /me/preferences + If-Match;
//  - the provisional text wordmark; 14 navigation areas for an administrator, no Administration for a Workstream Lead;
//  - sign-in: the dev form appears only when the server's dev-login route exists;
//  - transformations: list/detail render; edit handles a 409 conflict with compare + re-apply on the new version.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCreatePayload } from "../pages/transformations/TransformationCreatePage.tsx";
import { changedFields, formValuesOf } from "../pages/transformations/TransformationEditPage.tsx";
import { safeReturnTo } from "../pages/LoginPage.tsx";
import {
  ADMIN_GRANTS,
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  WL_GRANTS,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
} from "../test/fixtures.tsx";
import { NAV_AREAS } from "./nav.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const meRoute = (me: ReturnType<typeof makeMe>) => route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me }));
const buRoute = route("GET", /\/business-units/, () => ({
  status: 200,
  body: { items: [BUSINESS_UNIT], nextCursor: null },
}));

describe("bilingual shell", () => {
  it("renders Arabic RTL by default with the provisional wordmark", async () => {
    mockApi(meRoute(makeMe(ADMIN_GRANTS)));
    renderApp("/my-work");
    const wordmark = await screen.findByTestId("wordmark");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(within(wordmark).getByTestId("provisional-badge").textContent).toBe("مؤقت");
    expect(wordmark.querySelector("img, svg")).toBeNull(); // text only, never a logo image
  });

  it("switches to English LTR and persists the preference with If-Match", async () => {
    const me = makeMe(ADMIN_GRANTS);
    const { requests } = mockApi(
      meRoute(me),
      route("PUT", /\/api\/v1\/me\/preferences$/, (req) => ({
        status: 200,
        body: { ...me.user, preferredLocale: (req.body as { preferredLocale: string }).preferredLocale, version: 4 },
      })),
    );
    renderApp("/my-work");
    fireEvent.click(await screen.findByRole("button", { name: /English/ }));
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("mth.locale")).toBe("en");
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.body).toEqual({ preferredLocale: "en" });
    expect(put.headers["if-match"]).toBe('"3"');
    expect(put.headers["x-csrf-token"]).toBe(me.csrfToken);
    expect(within(screen.getByTestId("wordmark")).getByTestId("provisional-badge").textContent).toBe("Provisional");
  });

  it("shows all fourteen areas to an administrator", async () => {
    mockApi(meRoute(makeMe(ADMIN_GRANTS, { preferredLocale: "en" })));
    renderApp("/my-work");
    const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
    const links = within(nav)
      .getAllByRole("link")
      .filter((a) => a.hasAttribute("data-area"));
    expect(links).toHaveLength(14);
    expect(NAV_AREAS).toHaveLength(14);
    expect(within(nav).getByRole("link", { name: /Administration/ })).toBeTruthy();
    expect(
      within(nav)
        .getByRole("link", { name: /My Work/ })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("hides Administration from a Workstream Lead, and the admin route shows no-permission", async () => {
    mockApi(meRoute(makeMe(WL_GRANTS, { preferredLocale: "en" })));
    renderApp("/admin");
    const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .filter((a) => a.hasAttribute("data-area")),
    ).toHaveLength(13);
    expect(within(nav).queryByRole("link", { name: /Administration/ })).toBeNull();
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("no-permission");
  });

  it("marks planned areas as planned instead of pretending they work", async () => {
    mockApi(meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "en" })));
    renderApp("/governance");
    expect(await screen.findByRole("heading", { level: 1, name: "Governance" })).toBeTruthy();
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
  });

  it("redirects to sign-in when there is no session", async () => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => problem(401, "unauthenticated")),
      route("POST", /dev-login/, () => problem(404, "not_found")),
    );
    const { router } = renderApp("/transformations?status=draft");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toContain(encodeURIComponent("/transformations?status=draft"));
  });
});

describe("sign-in", () => {
  it("shows the development form only when the server has the dev-login route (400 on an empty probe)", async () => {
    const { requests } = mockApi(
      route("GET", /\/api\/v1\/me$/, () => problem(401, "unauthenticated")),
      route("POST", /dev-login/, (req) =>
        req.body && Object.keys(req.body as object).length === 0 ? problem(400, "validation") : undefined,
      ),
    );
    renderApp("/login");
    expect(await screen.findByLabelText(/اسم المستخدم الاصطناعي/)).toBeTruthy();
    const probe = requests.find((r) => r.method === "POST")!;
    expect(probe.body).toEqual({});
    expect(screen.getByRole("link", { name: /الحساب المؤسسي/ }).getAttribute("href")).toBe(
      "/api/v1/auth/login?returnTo=%2F",
    );
  });

  it("hides the development form when the route answers 404 (OIDC mode)", async () => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => problem(401, "unauthenticated")),
      route("POST", /dev-login/, () => problem(404, "not_found")),
    );
    renderApp("/login?error=not_provisioned");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(/اسم المستخدم الاصطناعي/)).toBeNull());
  });

  it("only follows same-origin relative return paths", () => {
    expect(safeReturnTo("/transformations")).toBe("/transformations");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("/login")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});

describe("transformations", () => {
  it("lists transformations with a sortable code column and removable filter chips", async () => {
    const tr = makeTransformation();
    const { requests } = mockApi(
      meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "en" })),
      buRoute,
      route("GET", /\/api\/v1\/transformations\?/, () => ({ status: 200, body: { items: [tr], nextCursor: "c2" } })),
    );
    renderApp("/transformations?status=draft");
    expect(await screen.findByText("TR-0001")).toBeTruthy();
    const listCall = requests.find((r) => r.url.startsWith("/api/v1/transformations?"))!;
    expect(listCall.url).toContain("status=draft");
    expect(listCall.url).toContain("sort=updatedAt%3Adesc");
    expect(screen.getByRole("button", { name: /Status: Draft/ })).toBeTruthy();
    const codeHeader = screen.getByRole("columnheader", { name: /Code/ });
    expect(codeHeader.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(codeHeader).getByRole("button"));
    await waitFor(() => expect(requests.some((r) => r.url.includes("sort=code%3Aasc"))).toBe(true));
    // Cursor pagination.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(requests.some((r) => r.url.includes("cursor=c2"))).toBe(true));
  });

  it("shows the empty state (not zero rows) when nothing is visible", async () => {
    mockApi(
      meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "en" })),
      buRoute,
      route("GET", /\/api\/v1\/transformations\?/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    );
    renderApp("/transformations");
    expect(await screen.findByText("No transformations yet")).toBeTruthy();
  });

  it("detail shows the workspace header with Unknown for data from later stages", async () => {
    mockApi(
      meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "en" })),
      buRoute,
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: makeTransformation() })),
      route("GET", /\/audit/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    );
    renderApp(`/transformations/${makeTransformation().id}`);
    expect(await screen.findByText("Workspace summary")).toBeTruthy();
    for (const label of [
      "Gate readiness",
      "North Star",
      "Owners",
      "Outcome health",
      "Benefits",
      "Key decisions",
      "Next required action",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(6);
    const current = document.querySelector("[aria-current='step']")!;
    expect(current.textContent).toContain("Design");
    expect(screen.getByRole("button", { name: /Archive/ })).toBeTruthy();
  });

  it("detail shows the no-permission state for a 404", async () => {
    mockApi(meRoute(makeMe(WL_GRANTS, { preferredLocale: "en" })), buRoute);
    renderApp("/transformations/01920000-0000-7000-9000-00000000ffff");
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("no-permission");
  });

  it("edit: a 409 writes nothing, shows compare, and re-applies on the current version", async () => {
    const loaded = makeTransformation({ version: 1, name: "Original" });
    const theirs = makeTransformation({ version: 2, name: "Changed by someone else", description: "Theirs" });
    let patches = 0;
    const { requests } = mockApi(
      meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: "en" })),
      buRoute,
      route("PATCH", /\/api\/v1\/transformations\//, (req) => {
        patches++;
        if (req.headers["if-match"] === '"1"') return problem(409, "version_conflict", { currentVersion: 2 });
        return { status: 200, body: { ...theirs, name: (req.body as { name: string }).name, version: 3 } };
      }),
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({
        status: 200,
        body: patches === 0 ? loaded : theirs,
      })),
      route("GET", /\/audit/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
    );
    const { router } = renderApp(`/transformations/${loaded.id}/edit`);
    const name = await screen.findByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "My new name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const panel = await screen.findByRole("alert");
    expect(panel.dataset["state"]).toBe("conflict");
    expect(within(panel).getByText("My new name")).toBeTruthy();
    expect(within(panel).getByText("Changed by someone else")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /Re-apply/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${loaded.id}`));
    const patchCalls = requests.filter((r) => r.method === "PATCH");
    expect(patchCalls.map((r) => r.headers["if-match"])).toEqual(['"1"', '"2"']);
    expect(patchCalls[1]!.body).toEqual({ name: "My new name" }); // only the user's change; theirs is kept
  });

  it("builds the create payload for both modes", () => {
    const base = {
      businessUnitId: BUSINESS_UNIT.id,
      name: "  New  ",
      code: "tr-9",
      description: "",
      entryPhase: "design",
      standaloneDeliverableType: "benefits_register",
      sponsorUserId: "",
      leadUserId: "",
      timezone: "",
      currency: "sar",
    };
    expect(toCreatePayload({ ...base, mode: "end_to_end" })).toEqual({
      businessUnitId: BUSINESS_UNIT.id,
      name: "New",
      code: "TR-9",
      mode: "end_to_end",
      currency: "SAR",
    });
    expect(toCreatePayload({ ...base, mode: "modular" })).toMatchObject({
      entryPhase: "design",
      standaloneDeliverableType: "benefits_register",
    });
  });

  it("sends only changed fields, with null for cleared optional values", () => {
    const tr = makeTransformation({ description: "Old", leadUserId: BUSINESS_UNIT.id });
    const values = { ...formValuesOf(tr), description: "  ", leadUserId: "" };
    expect(changedFields(formValuesOf(tr), values)).toEqual({ description: null, leadUserId: null });
  });
});
