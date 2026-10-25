// The playbook reader never shows a table block as raw Markdown (T-DG5-FE-RG1, F-DG5-122; REQ-S03-010; ADR-0049 §1),
// EN (LTR) and AR (RTL), with the real source texts of B0003, B0009, B0016 and B0024 (docs/source/playbook.md):
//  R1  the About panel's PMI/Brightline connection (B0024, a one-cell table block) is a table cell, with no "|" or
//      "|---|" in the panel's text;
//  R2  the block list previews show table blocks as text ("·" between cells, ";" between rows) with no "|---|",
//      no leading "|" and no "<br>";
//  R3  a one-cell callout (B0016) on its block page is a callout table (data-block-table="callout") whose one cell
//      holds the whole verbatim sentence; a "<br>" in a cell (B0003) is a <br> element, never the text "<br>";
//  R4  a search snippet cut from a table keeps its marks on the matched words and shows no "|---|" or "|".
// The wrapping at 1280 px, 390 px and 200 % text is measured in the browser (apps/web/e2e/p5-reader-tables.spec.ts).
// The source text is rendered as React text nodes only (no HTML injection). SYNTHETIC session.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { ORG_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { excerpt, plainBlockText, plainSnippetPiece } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = "en" | "ar";
const P = (lang: Lang) => catalogues[lang].playbookP5;
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el;
  });
const VERSION = { versionId: "01995000-0000-7000-8000-0000000000aa", key: "playbook", versionNo: 1 };

// Verbatim from docs/source/playbook.md.
const B0003 = "| 6<br>PHASES | 15+<br>READY TEMPLATES | 1<br>OPERATING SYSTEM |\n|---|---|---|";
const B0009 =
  "| Mode | When to use | How |\n|---|---|---|\n| End-to-End | New enterprise or business-unit transformation | Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear. |\n| Modular | A transformation is already underway | Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits. |";
const B0016_CELL =
  "Rule of thumb  Every transformation deliverable should answer one of four questions: Why change? What must become different? How will we execute? How will we prove value?";
const B0016 = `| ${B0016_CELL} |\n|---|`;
const B0024_CELL =
  "PMI/Brightline connection  The playbook uses the people-centered transformation logic and transformation operating-system thinking associated with PMI/Brightline, while adding a more explicit Target Operating Model and management-consulting-style diagnostic/design layer.";
const B0024 = `| ${B0024_CELL} |\n|---|`;

const block = (ref: string, text: string, extra: Record<string, unknown> = {}) => ({
  blockRef: ref,
  ordinal: Number(ref.slice(1)),
  blockKind: text.startsWith("|") ? "table" : "text",
  isHeading: false,
  sectionBlockRef: null,
  phaseCode: null,
  textEn: text,
  textAr: text,
  arProvisional: true,
  guidanceEn: null,
  guidanceAr: null,
  linkCount: 0,
  methodologyVersion: VERSION,
  ...extra,
});

const routes = (lang: Lang) => [
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(
      [
        {
          scope: { type: "organization" as const, id: ORG_ID },
          inheritsDownward: true,
          permissions: ["organization.read", "transformation.read"],
        },
      ],
      { preferredLocale: lang },
    ),
  })),
  route("GET", /\/api\/v1\/methodology\/provenance/, () => ({
    status: 200,
    body: {
      statement: { blockRef: "B0004", textEn: "Practical synthesis.", textAr: "خلاصة عملية", arProvisional: true },
      connectionNote: { blockRef: "B0024", textEn: B0024, textAr: B0024, arProvisional: true },
      foundations: [],
      customExtensions: [],
      realizeNote: { blockRef: "B0124", textEn: "Realize note.", textAr: "ملاحظة", arProvisional: true },
      note: null,
      methodologyVersion: VERSION,
    },
  })),
  route("GET", /\/api\/v1\/methodology\/blocks\?/, () => ({
    status: 200,
    body: { items: [block("B0003", B0003), block("B0009", B0009), block("B0016", B0016)], nextCursor: null },
  })),
  route("GET", /\/api\/v1\/methodology\/blocks\/B0016(\?|$)/, () => ({ status: 200, body: block("B0016", B0016) })),
  route("GET", /\/api\/v1\/methodology\/blocks\/B0003(\?|$)/, () => ({ status: 200, body: block("B0003", B0003) })),
  route("GET", /\/api\/v1\/methodology\/search\?/, () => ({
    status: 200,
    body: {
      // A window cut inside B0009: "transformation" is marked at its offset in the raw snippet.
      items: [
        {
          blockRef: "B0009",
          phaseCode: null,
          sectionBlockRef: null,
          lang: "en",
          snippet:
            "| Mode | When to use | How |\n|---|---|---|\n| End-to-End | New enterprise or business-unit transformation |",
          highlights: [{ offset: 90, length: 14 }],
        },
      ],
      nextCursor: null,
      methodologyVersion: VERSION,
    },
  })),
  route("GET", /./, () => ({ status: 200, body: { items: [], nextCursor: null, methodologyVersion: VERSION } })),
];

const MARKDOWN = /\|---|^\s*\||\|\s*$|<br\s*\/?>/m;

describe("table text helpers", () => {
  it("a table block as list text: cells joined by ·, rows by ;, <br> as a space; prose unchanged", () => {
    expect(plainBlockText(B0003)).toBe("6 PHASES · 15+ READY TEMPLATES · 1 OPERATING SYSTEM");
    expect(plainBlockText(B0009).startsWith("Mode · When to use · How; End-to-End · New enterprise")).toBe(true);
    expect(plainBlockText(B0016)).toBe(B0016_CELL);
    expect(plainBlockText("Plain | text.")).toBe("Plain | text.");
    expect(excerpt(B0009)).not.toMatch(MARKDOWN);
  });

  it("a snippet piece loses the separator rows and pipes, and keeps its words", () => {
    expect(plainSnippetPiece("| Mode | How |\n|---|---|\n| End-to-End ", true, false)).toBe("Mode · How · End-to-End ");
    expect(plainSnippetPiece(" | ok |", false, true)).toBe(" · ok");
    expect(plainSnippetPiece("no table here", true, true)).toBe("no table here");
  });
});

describe.each(["en", "ar"] as const)("the reader shows tables, not Markdown (%s)", (lang) => {
  it(`R1 + R2: the B0024 panel is a table cell and the block list has no Markdown (${lang})`, async () => {
    mockApi(...routes(lang));
    renderApp("/playbook/reader", { i18n: createI18n(lang) });
    expect(await screen.findByRole("heading", { level: 1, name: P(lang).reader.title })).toBeTruthy();
    const connection = await found("[data-source-text='connection']");
    // Every rendering of B0024 in the panel (the Arabic view adds the English verbatim) is a one-cell callout table.
    const cells = [...connection.querySelectorAll("table[data-block-table='callout'] th")];
    expect(cells.length).toBe(lang === "ar" ? 2 : 1);
    for (const c of cells) expect(c.textContent).toBe(B0024_CELL);
    expect(connection.textContent).not.toMatch(MARKDOWN);
    const list = await found("[data-list='blocks']");
    await waitFor(() => expect(list.querySelectorAll("li").length).toBe(3));
    expect(list.textContent).not.toMatch(/\|---|<br/);
    for (const li of list.querySelectorAll("li")) expect(li.textContent).not.toContain("|");
    expect(list.querySelector("[data-block='B0003']")!.textContent).toContain("6 PHASES · 15+ READY TEMPLATES");
  });

  it(`R3: B0016 is a callout table holding the whole sentence; B0003's <br> is an element (${lang})`, async () => {
    mockApi(...routes(lang));
    renderApp("/playbook/reader/B0016", { i18n: createI18n(lang) });
    const callout = await found("table[data-block-table='callout']");
    expect(callout.classList.contains("table--callout")).toBe(true);
    expect(callout.querySelector("th")!.textContent).toBe(B0016_CELL);
    expect(document.querySelector("main")!.textContent).not.toMatch(/\|---/);
    cleanup();
    mockApi(...routes(lang));
    renderApp("/playbook/reader/B0003", { i18n: createI18n(lang) });
    const table = await found("table[data-block-table='']");
    const first = table.querySelector("th")!;
    expect(first.querySelector("br")).toBeTruthy();
    expect(first.textContent).toBe("6PHASES");
    expect(table.textContent).not.toContain("<br>");
  });

  it(`R4: a snippet from a table shows no Markdown and keeps the mark on the matched word (${lang})`, async () => {
    mockApi(...routes(lang));
    renderApp("/playbook/reader", { i18n: createI18n(lang) });
    const input = await screen.findByLabelText(new RegExp(P(lang).search.query));
    fireEvent.change(input, { target: { value: "transformation" } });
    fireEvent.click(screen.getByRole("button", { name: P(lang).search.submit }));
    const hit = await found("[data-hit='B0009']");
    expect(within(hit).getByText("transformation", { selector: "mark" })).toBeTruthy();
    const snippet = hit.querySelector("[data-snippet]")!;
    expect(snippet.textContent).not.toMatch(/\||<br/);
    expect(snippet.textContent).toContain("Mode · When to use · How");
  });
});
