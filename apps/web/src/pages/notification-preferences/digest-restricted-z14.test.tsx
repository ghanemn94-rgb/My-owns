// T-DG6-BE-Z14 (code-security observation 600; D-226, D-231; ADR-0051 §3): the digest view shows a digested
// notification about a record the reader is not admitted to as the API returns it (`inbox.restricted`, params {}, the
// transformation home as link) with the item-scoped restricted label, in en and ar, as the inbox does. A plain item
// has no label. All data SYNTHETIC; nothing here is a business approval (G1-G6) and nothing touches DG0-DG7.
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { TR_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DIGEST_ID = "01990000-0000-7000-8000-00000000d001";
const digest = {
  id: DIGEST_ID,
  windowStart: "2026-11-09T05:00:00Z",
  windowEnd: "2026-11-09T05:15:00Z",
  count: 2,
  items: [
    {
      notificationId: "01990000-0000-7000-8000-00000000d101",
      messageKey: "inbox.restricted",
      messageParams: {},
      linkPath: `/transformations/${TR_ID}`,
      createdAt: "2026-11-09T05:01:00Z",
      includesRestrictedRecords: true,
    },
    {
      notificationId: "01990000-0000-7000-8000-00000000d102",
      messageKey: "inbox.restricted",
      messageParams: {},
      linkPath: "/my-work",
      createdAt: "2026-11-09T05:02:00Z",
    },
  ],
};

for (const locale of ["en", "ar"] as const) {
  it(`${locale}: a restricted digest item shows the restricted text, the home link and the item label`, async () => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe([], { preferredLocale: locale }) })),
      route("GET", /\/api\/v1\/me\/notification-digests\//, () => ({ status: 200, body: digest })),
    );
    renderApp(`/me/notification-digests/${DIGEST_ID}`, { i18n: createI18n(locale) });
    await screen.findAllByText(catalogues[locale].myWork.message.inbox__restricted);
    const list = document.querySelector("[data-digest-count='2']");
    expect(list).not.toBeNull();
    const [restricted, plain] = [...list!.querySelectorAll("li")];
    expect(restricted!.querySelector("a")?.getAttribute("href")).toBe(`/transformations/${TR_ID}`);
    expect(restricted!.querySelector("a")?.textContent).toBe(catalogues[locale].myWork.message.inbox__restricted);
    const label = restricted!.querySelector("[data-restricted-records='true']");
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain(catalogues[locale].access.includesRestrictedRecords);
    expect(plain!.querySelector("[data-restricted-records]")).toBeNull();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}
