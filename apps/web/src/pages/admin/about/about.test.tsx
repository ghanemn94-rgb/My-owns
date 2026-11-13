// T-DG7-FE-C, T-I16 (p7-work-split §I.2, §I.4; ADR-0071 §4): Administration > About this release, in English LTR and
// Arabic RTL, against a scripted API (SYNTHETIC data only). What is asserted:
//  - REQ-S02-005 "in-app 'About' list unfinished items as such": every open item is listed with its status and its
//    missing dependency (the notes, verbatim, LTR); laterClauses are listed under their own heading.
//  - `null` fields show `about.unknown` (the dependency list) or `about.unavailable` (register, counts, open items,
//    later clauses, an `unknown` version); no count is rendered (no 0) when `statusCounts` is `null`; nothing is green.
//  - Only `openItems: []` shows `about.openItems.none`; `null` never does.
//  - Read-only: only GET /admin/about (and the session) is requested.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, renderApp, route } from "../../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCALES = ["en", "ar"] as const;
type Locale = (typeof LOCALES)[number];
type Tree = { [k: string]: string | Tree };
const tx = (locale: Locale, path: string): string => {
  let node: string | Tree = catalogues[locale] as unknown as Tree;
  for (const part of path.split(".")) node = (node as Tree)[part]!;
  return node as string;
};

const SHA = "fedcba9876543210".repeat(4);
const register = {
  schemaVersion: "mth-register-snapshot/1",
  sourcePath: "docs/delivery/requirements.csv",
  sourceSha256: SHA,
  rowCount: 6,
  generatedAt: "2026-11-13T07:00:00Z",
};
const item = (reqId: string, status: string, notes: string) => ({
  reqId,
  title: `Synthetic ${reqId}`,
  status,
  finalGate: "DG7",
  notes,
});
const BLOCKED_NOTES = "Needs the Mobily IdP metadata (external).\nSecond line <b>kept</b>";
const full = {
  appVersion: "1.6.0",
  contractVersion: "1.6.0-p7",
  register,
  statusCounts: { PLANNED: 0, SPECIFIED: 1, IMPLEMENTED: 4, BLOCKED: 1 },
  openItems: [item("REQ-S01-001", "SPECIFIED", "Waits for the screen."), item("REQ-S20-002", "BLOCKED", BLOCKED_NOTES)],
  laterClauses: [item("REQ-DLV-021", "IMPLEMENTED", "completes-after-gate: the user's sign-off")],
  externalDependencies: [
    { key: "idp.metadata", title: "Identity provider metadata", owner: "Mobily IT", status: "blocked" },
  ],
  checkedAt: "2026-11-13T07:30:00Z",
};
const nulls = {
  appVersion: "unknown",
  contractVersion: "1.6.0-p7",
  register: null,
  statusCounts: null,
  openItems: null,
  laterClauses: null,
  externalDependencies: null,
  checkedAt: "2026-11-13T07:30:00Z",
};

function mount(locale: Locale, body: unknown) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(
        [
          {
            scope: { type: "organization" as const, id: ORG_ID },
            inheritsDownward: false,
            permissions: ["operations.read"],
          },
        ],
        { preferredLocale: locale },
      ),
    })),
    route("GET", /\/api\/v1\/admin\/about$/, () => ({ status: 200, body })),
  );
  renderApp("/admin/about", { i18n: createI18n(locale) });
  return api;
}
const section = (id: string) => document.getElementById(id) as HTMLElement;
const loaded = () =>
  waitFor(() => {
    if (!document.getElementById("release-versions")) throw new Error("not loaded");
  });

describe("About this release (T-I16; REQ-S02-005)", () => {
  it.each(LOCALES)(
    "%s: null fields show Unknown or Unavailable, never 0, never 'none', never green",
    async (locale) => {
      const { requests } = mount(locale, nulls);
      expect(await screen.findByRole("heading", { level: 1, name: tx(locale, "release.about.title") })).toBeTruthy();
      await loaded();
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      const unavailable = tx(locale, "release.about.unavailable");
      // An `unknown` application version, the register, counts, open items and later clauses: Unavailable.
      expect(within(section("release-versions")).getAllByText(unavailable).length).toBe(2);
      expect(within(section("release-counts")).getByText(unavailable)).toBeTruthy();
      expect(within(section("release-open-items")).getByText(unavailable)).toBeTruthy();
      expect(within(section("release-later-clauses")).getByText(unavailable)).toBeTruthy();
      // The dependency list: Unknown, never "none".
      expect(
        within(section("release-external-dependencies")).getByText(tx(locale, "release.about.unknown")),
      ).toBeTruthy();
      expect(screen.queryByText(tx(locale, "release.about.externalDependenciesNone"))).toBeNull();
      // `null` open items never say "every requirement is implemented".
      expect(screen.queryByText(tx(locale, "release.about.openItems.none"))).toBeNull();
      expect(screen.queryByText(tx(locale, "release.about.laterClausesNone"))).toBeNull();
      // No count rendered: no counts table, no data-count, no digit zero in the counts section.
      expect(document.querySelector("[data-p7-counts]")).toBeNull();
      expect(document.querySelector("[data-count]")).toBeNull();
      expect(section("release-counts").textContent).not.toMatch(/[0٠]/);
      expect(document.querySelector("[data-state='snapshot']")).toBeNull();
      // Nothing in the success colour; the not-an-approval line is shown.
      expect(document.querySelector(".status-chip--on-track")).toBeNull();
      expect(screen.getByText(tx(locale, "release.register.notEngineeringApproval"))).toBeTruthy();
      // The known contract version is still shown.
      expect(within(section("release-versions")).getByText("1.6.0-p7")).toBeTruthy();
      expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    },
  );

  it.each(LOCALES)("%s: openItems [] alone shows the 'every requirement implemented' text", async (locale) => {
    mount(locale, {
      ...full,
      statusCounts: { PLANNED: 0, SPECIFIED: 0, IMPLEMENTED: 6, BLOCKED: 0 },
      openItems: [],
      laterClauses: [],
      externalDependencies: [],
    });
    await loaded();
    expect(within(section("release-open-items")).getByText(tx(locale, "release.about.openItems.none"))).toBeTruthy();
    expect(document.querySelector("[data-register='p7-open-items']")).toBeNull();
    expect(
      within(section("release-later-clauses")).getByText(tx(locale, "release.about.laterClausesNone")),
    ).toBeTruthy();
    // An empty dependency list is "none listed", not Unknown.
    expect(
      within(section("release-external-dependencies")).getByText(tx(locale, "release.about.externalDependenciesNone")),
    ).toBeTruthy();
    expect(screen.queryByText(tx(locale, "release.about.unknown"))).toBeNull();
    // Known zeros of a known register are real counts.
    expect(document.querySelector("[data-status='PLANNED'] [data-count]")!.getAttribute("data-count")).toBe("0");
  });

  it.each(LOCALES)(
    "%s: lists unfinished items as such, with their missing dependency verbatim and LTR",
    async (locale) => {
      mount(locale, full);
      await loaded();
      // Versions and the snapshot line.
      expect(within(section("release-versions")).getByText("1.6.0")).toBeTruthy();
      const line = document.querySelector("[data-state='snapshot']")!;
      expect(line.textContent).toContain(SHA.slice(0, 12));
      // Counts per status, and their total equals the register's row count.
      const counts = document.querySelector("[data-p7-counts]")!;
      const values = Object.fromEntries(
        Array.from(counts.querySelectorAll("tbody tr")).map((tr) => [
          tr.getAttribute("data-status"),
          tr.querySelector("[data-count]")!.getAttribute("data-count"),
        ]),
      );
      expect(values).toEqual({ PLANNED: "0", SPECIFIED: "1", IMPLEMENTED: "4", BLOCKED: "1" });
      expect(counts.querySelector("tfoot [data-count]")!.getAttribute("data-count")).toBe(String(register.rowCount));
      // Unfinished items: both rows, with their status labels and notes.
      const open = section("release-open-items");
      expect(open.querySelector("[data-register='p7-open-items']")).not.toBeNull();
      expect(within(open).getByText("REQ-S01-001")).toBeTruthy();
      expect(within(open).getByText("REQ-S20-002")).toBeTruthy();
      expect(within(open).getAllByText(tx(locale, "release.status.BLOCKED")).length).toBeGreaterThan(0);
      expect(within(open).getAllByText(tx(locale, "release.status.SPECIFIED")).length).toBeGreaterThan(0);
      expect(within(open).getAllByText(tx(locale, "release.about.openItems.dependency")).length).toBeGreaterThan(0);
      const notes = Array.from(open.querySelectorAll("[data-register-text]")).find(
        (el) => el.textContent === BLOCKED_NOTES,
      )!;
      expect(notes).toBeTruthy();
      expect(notes.getAttribute("dir")).toBe("ltr");
      expect(notes.getAttribute("lang")).toBe("en");
      expect(open.querySelector("b")).toBeNull();
      // "Implemented" is never shown for an open item.
      expect(within(open).queryByText(tx(locale, "release.status.IMPLEMENTED"))).toBeNull();
      // Later clauses and the external dependencies.
      expect(within(section("release-later-clauses")).getByText("REQ-DLV-021")).toBeTruthy();
      const deps = section("release-external-dependencies");
      expect(within(deps).getByText("Mobily IT")).toBeTruthy();
      expect(within(deps).getAllByText(tx(locale, "release.about.dependency.state.blocked")).length).toBeGreaterThan(0);
      expect(screen.queryByText(tx(locale, "release.about.openItems.none"))).toBeNull();
      expect(document.querySelector(".status-chip--on-track")).toBeNull();
      // The Arabic screen says the register text is English.
      if (locale === "ar") expect(screen.getByText(tx("ar", "release.register.englishOnly"))).toBeTruthy();
    },
  );
});
