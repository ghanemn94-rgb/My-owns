// T-DG7-FE-C, T-I15 (p7-work-split §I.2, §I.4): Administration > Requirement register, in English LTR and Arabic RTL,
// against a scripted API (SYNTHETIC rows only). What is asserted:
//  - REQ-S02-003 "with filters by class, status and area" (and final gate): the four filters map to the
//    listRequirements query parameters, from the URL and from the selects; a value outside the contract's set and any
//    other URL parameter are never sent; changing a filter starts the cursor again (G3).
//  - G4: a 503 `release.register_snapshot_unavailable` shows `register.unavailable`, never the empty text; an empty
//    page shows the empty text.
//  - Notes and every other register field render as plain text (no HTML is interpreted), verbatim with line breaks.
//  - The Arabic view keeps the register text LTR (`dir="ltr" lang="en"`) and shows the English-only note.
//  - Read-only: no request other than GET is sent, and no form posts anything.
//  - The `release` namespace: identical key sets, every Arabic leaf labelled provisional, the §I.3 texts exact, no
//    gate name and no approval or conformity claim.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../../i18n/index.ts";
import { P7_RELEASE_PROVISIONAL_ARABIC } from "../../../i18n/provisional-ar-p7-release.ts";
import { ORG_ID, makeMe, mockApi, problem, renderApp, route, type RecordedRequest } from "../../../test/fixtures.tsx";
import { REQUIREMENT_AREAS, REQUIREMENT_FINAL_GATES, requirementQuery } from "./RequirementsPage.tsx";

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
const meRoute = (permissions: Permission[], locale: Locale) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions }], {
      preferredLocale: locale,
    }),
  }));

const SHA = "0123456789abcdef".repeat(4);
const snapshot = {
  schemaVersion: "mth-register-snapshot/1",
  sourcePath: "docs/delivery/requirements.csv",
  sourceSha256: SHA,
  rowCount: 412,
  generatedAt: "2026-11-13T07:00:00Z",
};
const summary = (reqId: string, overrides: Record<string, unknown> = {}) => ({
  reqId,
  class: "USER",
  area: "S02",
  title: `Synthetic requirement ${reqId}`,
  sourceRef: "M0001",
  finalGate: "DG7",
  status: "IMPLEMENTED",
  increments: "P5;P7",
  hasNotes: false,
  ...overrides,
});
const NOTES = "<b>bold</b><script>window.__x = 1</script>\nsecond line: completes-after-gate: DG7";
const fullRow = {
  ...summary("REQ-S02-003", { status: "BLOCKED", hasNotes: true }),
  sourceHeading: "Synthetic heading",
  templateId: "",
  inputFields: "a; b",
  procedure: "step 1\nstep 2",
  output: "<i>out</i>",
  ownerRoles: "ADM;AUD;TO",
  permissions: "operations.read",
  automation: "none",
  screenApi: "/admin/requirements",
  acceptance: "lists the same row count",
  evidence: "apps/api/test/integration/release/register.test.ts",
  notes: NOTES,
  snapshot,
};

const listUrls = (requests: RecordedRequest[]) =>
  requests.filter((r) => /\/api\/v1\/admin\/requirements(\?|$)/.test(r.url)).map((r) => new URL(r.url, "http://x"));

describe("Requirement register (T-I15; REQ-S02-003)", () => {
  it("maps a URL's filters to exactly the four query parameters, valid values only", () => {
    const q = requirementQuery(
      new URLSearchParams("class=USER&status=BLOCKED&area=S02&finalGate=DG7&bogus=1&limit=5&cursor=abc"),
    );
    expect(q).toEqual({ class: "USER", status: "BLOCKED", area: "S02", finalGate: "DG7" });
    expect(requirementQuery(new URLSearchParams("class=user&status=DONE&area=S22&finalGate=DG8"))).toEqual({});
    expect(REQUIREMENT_AREAS).toHaveLength(23);
    expect(REQUIREMENT_AREAS.every((a) => /^(PB|DLV|S(0[1-9]|1[0-9]|2[01]))$/.test(a))).toBe(true);
    expect(REQUIREMENT_FINAL_GATES).toEqual(["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"]);
  });

  it.each(LOCALES)("%s: filters are sent as query parameters, and a change restarts the cursor", async (locale) => {
    const { requests } = mockApi(
      meRoute(["operations.read"], locale),
      route("GET", /\/api\/v1\/admin\/requirements\?/, (req) => {
        const u = new URL(req.url, "http://x");
        const area = u.searchParams.get("area");
        return {
          status: 200,
          body: {
            items: [summary(area === "S21" ? "REQ-S21-003" : "REQ-S02-003", { status: "BLOCKED", class: "USER" })],
            nextCursor: u.searchParams.get("cursor") ? null : "next-page",
            snapshot,
          },
        };
      }),
    );
    renderApp("/admin/requirements?class=USER&status=BLOCKED&area=S02&finalGate=DG7&bogus=1", {
      i18n: createI18n(locale),
    });
    expect(await screen.findByRole("heading", { level: 1, name: tx(locale, "release.register.title") })).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    await screen.findByText("REQ-S02-003");
    // The register table is there (the selector the 503 test expects to be absent).
    expect(document.querySelector("[data-register='p7-requirements']")).not.toBeNull();
    const first = listUrls(requests)[0]!;
    expect(Object.fromEntries(first.searchParams)).toEqual({
      class: "USER",
      status: "BLOCKED",
      area: "S02",
      finalGate: "DG7",
    });
    // The selects show the URL's filters.
    const areaSelect = screen.getByLabelText(tx(locale, "release.register.filter.area")) as HTMLSelectElement;
    expect(areaSelect.value).toBe("S02");
    expect((screen.getByLabelText(tx(locale, "release.register.filter.status")) as HTMLSelectElement).value).toBe(
      "BLOCKED",
    );
    // The snapshot line: row count and the first 12 hex digits of the SHA-256.
    const line = document.querySelector("[data-state='snapshot']")!;
    expect(line.textContent).toContain(SHA.slice(0, 12));
    expect(line.textContent).not.toContain(SHA.slice(0, 13));
    // The next page sends the cursor with the same filters.
    await waitFor(() => expect(document.querySelector("[data-action='next-page']")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-action='next-page']")!);
    await waitFor(() =>
      expect(listUrls(requests).some((u) => u.searchParams.get("cursor") === "next-page")).toBe(true),
    );
    const paged = listUrls(requests).find((u) => u.searchParams.get("cursor") === "next-page")!;
    expect(paged.searchParams.get("area")).toBe("S02");
    // A filter change: the new value is sent, without the old filter's cursor (G3).
    const before = requests.length;
    fireEvent.change(areaSelect, { target: { value: "S21" } });
    await screen.findByText("REQ-S21-003");
    const after = listUrls(requests.slice(before));
    expect(after.length).toBeGreaterThan(0);
    for (const u of after) {
      expect(u.searchParams.get("area")).toBe("S21");
      expect(u.searchParams.has("cursor")).toBe(false);
    }
    // Read-only.
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(document.querySelectorAll("form").length).toBe(0);
  });

  it.each(LOCALES)("%s: a 503 shows register.unavailable, never the empty text", async (locale) => {
    mockApi(
      meRoute(["operations.read"], locale),
      route("GET", /\/api\/v1\/admin\/requirements/, () =>
        problem(503, "release.register_snapshot_unavailable", { type: "urn:mth:problem:unavailable" }),
      ),
    );
    renderApp("/admin/requirements", { i18n: createI18n(locale), retryDelayMs: 0 });
    expect(await screen.findByText(tx(locale, "release.register.unavailable"))).toBeTruthy();
    expect(screen.getByText(tx(locale, "problems.release__register_snapshot_unavailable"))).toBeTruthy();
    expect(screen.queryByText(tx(locale, "release.register.empty"))).toBeNull();
    expect(document.querySelector("[data-state='register-unavailable']")).not.toBeNull();
    expect(document.querySelector("[data-register='p7-requirements']")).toBeNull();
    expect(document.querySelector("[data-state='snapshot']")).toBeNull();
    cleanup();
    // The detail panel answers the same way.
    renderApp("/admin/requirements/REQ-S02-003", { i18n: createI18n(locale), retryDelayMs: 0 });
    await waitFor(() =>
      expect(document.querySelectorAll("[data-state='register-unavailable']").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("an empty page shows the empty text, not the unavailable text", async () => {
    mockApi(
      meRoute(["operations.read"], "en"),
      route("GET", /\/api\/v1\/admin\/requirements/, () => ({
        status: 200,
        body: { items: [], nextCursor: null, snapshot },
      })),
    );
    renderApp("/admin/requirements?status=PLANNED", { i18n: createI18n("en") });
    expect(await screen.findByText(tx("en", "release.register.empty"))).toBeTruthy();
    expect(screen.queryByText(tx("en", "release.register.unavailable"))).toBeNull();
  });

  it.each(LOCALES)(
    "%s: the detail panel shows every column as plain text, LTR and English, line breaks kept",
    async (locale) => {
      const { requests } = mockApi(
        meRoute(["operations.read"], locale),
        route("GET", /\/api\/v1\/admin\/requirements\/REQ-S02-003$/, () => ({ status: 200, body: fullRow })),
        route("GET", /\/api\/v1\/admin\/requirements(\?|$)/, () => ({
          status: 200,
          body: { items: [summary("REQ-S02-003", { status: "BLOCKED", hasNotes: true })], nextCursor: null, snapshot },
        })),
      );
      renderApp("/admin/requirements/REQ-S02-003?status=BLOCKED", { i18n: createI18n(locale) });
      const panel = (await waitFor(() => {
        const el = document.querySelector("[data-requirement='REQ-S02-003']");
        if (!el) throw new Error("detail not rendered");
        return el;
      })) as HTMLElement;
      // Notes: the text verbatim (tags included as characters), nothing interpreted as HTML.
      const notes = panel.querySelector("[data-field='notes'] [data-register-text]")!;
      expect(notes.textContent).toBe(NOTES);
      expect(notes.querySelector("b, script")).toBeNull();
      expect(panel.querySelector("b, i, script")).toBeNull();
      expect((window as unknown as { __x?: number }).__x).toBeUndefined();
      expect((notes as HTMLElement).style.whiteSpace).toBe("pre-wrap");
      expect(panel.querySelector("[data-field='output'] [data-register-text]")!.textContent).toBe("<i>out</i>");
      expect(panel.querySelector("[data-field='procedure'] [data-register-text]")!.textContent).toBe("step 1\nstep 2");
      // An empty field says so, instead of showing nothing.
      expect(
        within(panel.querySelector("[data-field='templateId']") as HTMLElement).getByText(
          tx(locale, "release.register.detail.emptyField"),
        ),
      ).toBeTruthy();
      // Every register text is LTR English, on both screens.
      const texts = Array.from(document.querySelectorAll("[data-register-text]"));
      expect(texts.length).toBeGreaterThan(10);
      for (const el of texts) {
        expect(el.getAttribute("dir")).toBe("ltr");
        expect(el.getAttribute("lang")).toBe("en");
      }
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      // The Arabic screen says register texts are English; both screens say these are not approvals.
      const englishOnly = screen.queryByText(tx(locale, "release.register.englishOnly"));
      if (locale === "ar") expect(englishOnly).not.toBeNull();
      else expect(englishOnly).toBeNull();
      expect(screen.getByText(tx(locale, "release.register.notEngineeringApproval"))).toBeTruthy();
      // The status is a labelled chip with an icon, never the success colour.
      expect(within(panel).getAllByText(tx(locale, "release.status.BLOCKED")).length).toBeGreaterThan(0);
      expect(document.querySelector(".status-chip--on-track")).toBeNull();
      // Focus moves to the panel heading; closing keeps the filters.
      expect(document.activeElement?.id).toBe("requirement-detail-title");
      const close = screen.getByRole("link", { name: tx(locale, "release.register.detail.close") });
      expect(close.getAttribute("href")).toBe("/admin/requirements?status=BLOCKED");
      expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    },
  );

  it("a caller without operations.read sees the no-permission state from the server's 403", async () => {
    mockApi(
      meRoute(["audit_event.read"], "en"),
      route("GET", /\/api\/v1\/admin\/requirements/, () => problem(403, "forbidden")),
    );
    renderApp("/admin/requirements", { i18n: createI18n("en") });
    await waitFor(() => expect(document.querySelector("[data-state='no-permission']")).not.toBeNull());
    expect(screen.queryByText(tx("en", "release.register.empty"))).toBeNull();
  });
});

describe("the release namespace (p7-work-split §I.3; D-243 Q7)", () => {
  const leaves = (node: Tree, prefix = ""): string[] =>
    Object.entries(node).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
  const en = catalogues.en.release as unknown as Tree;
  const ar = catalogues.ar.release as unknown as Tree;
  const repoRoot = (): string => {
    for (let dir = process.cwd(); ; dir = dirname(dir)) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      if (dirname(dir) === dir) throw new Error("repository root not found");
    }
  };
  const split = readFileSync(join(repoRoot(), "docs", "architecture", "p7-work-split.md"), "utf8");

  it("has identical key sets, and every Arabic leaf is Arabic and labelled provisional exactly once", () => {
    expect(leaves(ar).sort()).toEqual(leaves(en).sort());
    expect(Object.keys(P7_RELEASE_PROVISIONAL_ARABIC).sort()).toEqual(
      leaves(ar)
        .map((k) => `release.${k}`)
        .sort(),
    );
    for (const k of leaves(ar)) expect(tx("ar", `release.${k}`), k).toMatch(/[؀-ۿ]/);
  });

  it("uses the §I.3 screen texts exactly, and marks exactly those as work-split", () => {
    const start = split.indexOf("**Screen texts** (`release.json`");
    const end = split.indexOf("**Release-notes headings**", start);
    expect(start).toBeGreaterThan(0);
    const rows = split
      .slice(start, end)
      .split("\n")
      .filter((l) => /^\| `(register|status|about)\./.test(l))
      .map((l) => l.split("|").map((c) => c.trim()));
    const toI18n = (s: string) => s.replace(/\{(\w+)\}/g, "{{$1}}");
    // The §I.3 key `about.openItems` (the heading) lives at `about.openItems.title`: its children share the JSON tree.
    const jsonKey = (k: string) => (k === "about.openItems" ? "about.openItems.title" : k);
    const pairs = new Map<string, [string, string]>();
    for (const [, keyCell, enCell, arCell] of rows) {
      const keys = keyCell!.replace(/`/g, "").split(" / ");
      const prefix = keys[0]!.replace(/\.[^.]+$/, "");
      const full = keys.map((k, i) =>
        i === 0 ? k : k.startsWith(".") ? `${prefix}${k}` : k.includes(".") ? k : `${prefix}.${k}`,
      );
      const ens = enCell!.split(" / ");
      const ars = arCell!.split(" / ");
      full.forEach((k, i) =>
        pairs.set(jsonKey(k), [
          ens.length === full.length ? ens[i]! : enCell!,
          ars.length === full.length ? ars[i]! : arCell!,
        ]),
      );
    }
    expect(pairs.size).toBe(29);
    for (const [k, [e, a]] of pairs) {
      expect(tx("en", `release.${k}`), k).toBe(toI18n(e));
      expect(tx("ar", `release.${k}`), k).toBe(toI18n(a));
      expect(P7_RELEASE_PROVISIONAL_ARABIC[`release.${k}`], k).toBe("work-split");
    }
    const workSplit = Object.entries(P7_RELEASE_PROVISIONAL_ARABIC)
      .filter(([, v]) => v === "work-split")
      .map(([k]) => k.replace(/^release\./, ""));
    expect(workSplit.sort()).toEqual([...pairs.keys()].sort());
  });

  it("names no delivery gate and claims no approval or conformity", () => {
    for (const locale of LOCALES) {
      const texts = JSON.stringify(catalogues[locale].release);
      expect(texts).not.toMatch(/\bDG[0-7]\b|\bG[1-6]\b/);
      expect(texts).not.toMatch(/certif|complian|conform|is approved|approved\b/i);
    }
  });
});
