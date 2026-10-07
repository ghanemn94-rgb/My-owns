// T-DG2-FE11 (REQ-S15-007): a language switch whose save is refused keeps the language the user chose in this browser
// (behaviour (a)), and the "not saved" notice speaks that language: the notice text, <html lang dir> and the live
// region's lang all follow the displayed language, the notice is announced once in a polite live region, and nothing
// flips the page back to the previous language. Both directions (EN→AR and AR→EN), under <StrictMode> as in
// production. SYNTHETIC data, scripted API.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../api/types.ts";
import { keys } from "../api/queries.ts";
import arCommon from "../i18n/ar/common.json";
import enCommon from "../i18n/en/common.json";
import { createI18n } from "../i18n/index.ts";
import { ADMIN_GRANTS, makeMe, mockApi, problem, renderApp, route } from "../test/fixtures.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = "ar" | "en";
const TEXT = {
  en: { common: enCommon, dir: "ltr", name: "English" },
  ar: { common: arCommon, dir: "rtl", name: "العربية" },
} as const;
const other = (l: Lang): Lang => (l === "ar" ? "en" : "ar");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signed in with `from` persisted; every PUT /me/preferences answers `refusal`. */
function setup(from: Lang, refusal: { status: number; body?: unknown }) {
  const me = makeMe(ADMIN_GRANTS, { preferredLocale: from });
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me })),
    route("PUT", /\/api\/v1\/me\/preferences$/, () => refusal),
  );
  localStorage.setItem("mth.locale", from);
  const rendered = renderApp("/my-work", { i18n: createI18n(from), strict: true });
  const changes: string[] = [];
  rendered.i18n.on("languageChanged", (lng: string) => changes.push(lng));
  return { ...rendered, ...api, me, changes };
}

async function switchTo(to: Lang, from: Lang) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: TEXT[from].common.language.switchTo.replace("{{language}}", TEXT[to].name),
    }),
  );
}

describe.each([
  { from: "en" as Lang, refusal: problem(403, "csrf"), label: "403 csrf" },
  { from: "ar" as Lang, refusal: problem(403, "csrf"), label: "403 csrf" },
  { from: "en" as Lang, refusal: problem(403, "forbidden"), label: "403 forbidden" },
  { from: "ar" as Lang, refusal: { status: 503, body: { status: 503, code: "unavailable" } }, label: "503" },
])("a refused language save, $from → other ($label)", ({ from, refusal }) => {
  const to = other(from);

  it(`keeps ${to} on screen and says, in ${to}, that it was not saved`, async () => {
    const { requests, i18n, queryClient, changes } = setup(from, refusal);
    await switchTo(to, from);

    const notice = await screen.findByTestId("language-not-saved");
    // The text is exactly the chosen language's notice, never the previous language's.
    expect(notice.textContent).toBe(TEXT[to].common.language.notSaved);
    expect(notice.textContent).not.toBe(TEXT[from].common.language.notSaved);
    // dir and lang follow the displayed language.
    expect(i18n.language).toBe(to);
    expect(document.documentElement.lang).toBe(to);
    expect(document.documentElement.dir).toBe(TEXT[to].dir);
    // The notice sits in one polite, atomic live region whose lang is the displayed language.
    const live = notice.parentElement!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(live.getAttribute("lang")).toBe(to);
    expect(document.querySelectorAll('[aria-live="polite"].language-switch__live')).toHaveLength(1);
    expect(screen.getAllByTestId("language-not-saved")).toHaveLength(1);

    // Nothing flips the page back afterwards, and the notice stays in the chosen language.
    await act(() => sleep(300));
    expect(changes).toEqual([to]);
    expect(i18n.language).toBe(to);
    expect(document.documentElement.dir).toBe(TEXT[to].dir);
    expect(screen.getByTestId("language-not-saved").textContent).toBe(TEXT[to].common.language.notSaved);
    // The switch now offers the previous language again.
    expect(
      screen.getByRole("button", { name: TEXT[to].common.language.switchTo.replace("{{language}}", TEXT[from].name) }),
    ).toBeTruthy();
    // Exactly one save was attempted, the browser remembers the chosen language, the profile still holds the old one.
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    expect(localStorage.getItem("mth.locale")).toBe(to);
    expect(queryClient.getQueryData<Me>(keys.me)?.user.preferredLocale).toBe(from);
  });
});

describe("the live region and the persisted preference", () => {
  it("switching back clears the notice; the region stays in the DOM, empty", async () => {
    setup("en", problem(403, "csrf"));
    await switchTo("ar", "en");
    await screen.findByTestId("language-not-saved");
    await switchTo("en", "ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    // The second save is refused too, so a fresh notice appears in English (the language now shown).
    expect((await screen.findByTestId("language-not-saved")).textContent).toBe(enCommon.language.notSaved);
    expect(screen.getAllByTestId("language-not-saved")).toHaveLength(1);
  });

  it("a successful save never flips back to the previous language while the PUT is in flight", async () => {
    const me = makeMe(ADMIN_GRANTS, { preferredLocale: "en" });
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me })),
      route("PUT", /\/api\/v1\/me\/preferences$/, () => ({
        status: 200,
        body: { ...me.user, preferredLocale: "ar", version: 4 },
      })),
    );
    const { i18n, queryClient } = renderApp("/my-work", { i18n: createI18n("en"), strict: true });
    const changes: string[] = [];
    i18n.on("languageChanged", (lng: string) => changes.push(lng));
    await switchTo("ar", "en");
    await waitFor(() => expect(queryClient.getQueryData<Me>(keys.me)?.user.preferredLocale).toBe("ar"));
    await act(() => sleep(100));
    expect(changes).toEqual(["ar"]);
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.queryByTestId("language-not-saved")).toBeNull();
  });

  it("if the persisted preference changes later and is re-applied, the notice says so in that language", async () => {
    const { queryClient, me } = setup("en", problem(403, "csrf"));
    await switchTo("ar", "en");
    expect((await screen.findByTestId("language-not-saved")).textContent).toBe(arCommon.language.notSaved);
    // Another tab saved Arabic and then English; this tab's /me refetches see both.
    await act(async () => {
      queryClient.setQueryData<Me>(keys.me, { ...me, user: { ...me.user, preferredLocale: "ar", version: 4 } });
      await sleep(30);
    });
    expect(screen.getByTestId("language-not-saved").textContent).toBe(arCommon.language.notSaved);
    await act(async () => {
      queryClient.setQueryData<Me>(keys.me, { ...me, user: { ...me.user, preferredLocale: "en", version: 5 } });
      await sleep(30);
    });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    const notice = screen.getByTestId("language-not-saved");
    expect(notice.textContent).toBe(enCommon.language.notSavedReverted);
    expect(notice.parentElement!.getAttribute("lang")).toBe("en");
  });

  it("the signed-out sign-in page has no live region (and so no competing status)", async () => {
    mockApi(route("GET", /\/api\/v1\/me$/, () => ({ status: 401, body: { status: 401, code: "unauthenticated" } })));
    renderApp("/login", { i18n: createI18n("en") });
    await screen.findByRole("button", { name: enCommon.language.switchTo.replace("{{language}}", "العربية") });
    expect(document.querySelector(".language-switch__live")).toBeNull();
  });
});
