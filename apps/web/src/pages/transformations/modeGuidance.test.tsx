// REQ-PB-003 (P2 increment): the New transformation screen shows the playbook's "When to use" and "How" guidance for
// the selected mode. The English copy is the playbook's mode table text VERBATIM: this test reads the B0009 table from
// docs/source/playbook.md, so any drift between the catalogue and the source fails here. Modular requires an entry
// phase (client-side with the shared schema, and a server field error lands on the field). English LTR and Arabic RTL.
// SYNTHETIC data only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { BU_ID, BUSINESS_UNIT, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The B0009 mode table of the playbook: mode -> { whenToUse, how }. */
function playbookModeTable(): Record<string, { whenToUse: string; how: string }> {
  const md = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "source", "playbook.md"),
    "utf8",
  );
  const start = md.indexOf("<!-- B0009 table -->");
  expect(start).toBeGreaterThan(0);
  const rows: Record<string, { whenToUse: string; how: string }> = {};
  for (const line of md.slice(start).split("\n").slice(1)) {
    if (!line.startsWith("|")) {
      if (Object.keys(rows).length > 0) break;
      continue;
    }
    const [mode, whenToUse, how] = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (!mode || mode === "Mode" || /^-+$/.test(mode)) continue;
    rows[mode] = { whenToUse: whenToUse!, how: how! };
  }
  return rows;
}

const SOURCE_MODE = { end_to_end: "End-to-End", modular: "Modular" } as const;
const en = catalogues.en.transformations.form.modeGuidance;
const ar = catalogues.ar.transformations.form.modeGuidance;

const CREATOR = [
  {
    scope: { type: "business_unit" as const, id: BU_ID },
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "transformation.read",
      "transformation.create",
    ] as Permission[],
  },
];

function renderCreate(locale: "en" | "ar", extra: Parameters<typeof mockApi> = []) {
  const api = mockApi(
    ...extra,
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(CREATOR, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => ({ status: 200, body: { items: [BUSINESS_UNIT], nextCursor: null } })),
  );
  renderApp("/transformations/new", { i18n: createI18n(locale) });
  return api;
}

describe("the English guidance is the playbook text verbatim (B0009)", () => {
  it("matches the source table for both modes, character for character", () => {
    const source = playbookModeTable();
    expect(Object.keys(source).sort()).toEqual(["End-to-End", "Modular"]);
    for (const [mode, sourceMode] of Object.entries(SOURCE_MODE)) {
      const m = mode as keyof typeof SOURCE_MODE;
      expect(en[m].whenToUse).toBe(source[sourceMode]!.whenToUse);
      expect(en[m].how).toBe(source[sourceMode]!.how);
    }
    // The acceptance phrases (REQ-PB-003 A01;A03).
    expect(en.end_to_end.how.startsWith("Run Phases 1-6 sequentially")).toBe(true);
    expect(en.modular.how.startsWith("Enter at the relevant phase")).toBe(true);
  });
});

describe("New transformation: mode guidance (English LTR)", () => {
  it("shows When to use and How for the selected mode and switches with the mode", async () => {
    renderCreate("en");
    const e2e = await screen.findByRole("region", { name: "Guidance for the End-to-End mode" });
    expect(within(e2e).getByText("When to use")).toBeTruthy();
    expect(within(e2e).getByText("How")).toBeTruthy();
    expect(e2e.querySelector("[data-guidance='whenToUse']")!.textContent).toBe(
      "New enterprise or business-unit transformation",
    );
    expect(e2e.querySelector("[data-guidance='how']")!.textContent).toBe(
      "Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear.",
    );
    expect(e2e.getAttribute("aria-live")).toBe("polite");
    expect(e2e.textContent).toContain("B0009");
    // English is the source itself: no separate "original" line.
    expect(e2e.querySelector("[data-guidance-source]")).toBeNull();
    // Each mode option states its "When to use".
    expect(
      screen.getByRole("radio", { name: "End-to-End When to use: New enterprise or business-unit transformation" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Modular When to use: A transformation is already underway" }));
    const modular = await screen.findByRole("region", { name: "Guidance for the Modular mode" });
    expect(modular.querySelector("[data-guidance='whenToUse']")!.textContent).toBe(
      "A transformation is already underway",
    );
    expect(modular.querySelector("[data-guidance='how']")!.textContent).toBe(
      "Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits.",
    );
    expect(screen.queryByRole("region", { name: "Guidance for the End-to-End mode" })).toBeNull();
  });

  it("Modular requires an entry phase before anything is sent", async () => {
    const { requests } = renderCreate("en");
    const unit = (await screen.findByLabelText(/^Business unit/)) as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: BU_ID } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Synthetic modular" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Modular/ }));
    const phase = (await screen.findByLabelText(/^Entry phase/)) as HTMLSelectElement;
    expect(phase.getAttribute("aria-required")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Create transformation" }));
    await waitFor(() => expect(phase.getAttribute("aria-invalid")).toBe("true"));
    const errorId = phase
      .getAttribute("aria-describedby")!
      .split(" ")
      .find((id) => id.endsWith("-error"))!;
    expect(document.getElementById(errorId)!.textContent).toContain("This field is required.");
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("a server validation error on the entry phase is shown on that field", async () => {
    const { requests } = renderCreate("en", [
      route("POST", /\/api\/v1\/transformations$/, () =>
        problem(400, "validation", {
          errors: [{ pointer: "/entryPhase", code: "validation.required", message: "entryPhase is required" }],
        }),
      ),
    ]);
    const unit = (await screen.findByLabelText(/^Business unit/)) as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: BU_ID } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Synthetic modular" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Modular/ }));
    const phase = (await screen.findByLabelText(/^Entry phase/)) as HTMLSelectElement;
    fireEvent.change(phase, { target: { value: "design" } });
    fireEvent.click(screen.getByRole("button", { name: "Create transformation" }));
    await waitFor(() => expect(phase.getAttribute("aria-invalid")).toBe("true"));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ mode: "modular", entryPhase: "design" });
    const errorId = phase
      .getAttribute("aria-describedby")!
      .split(" ")
      .find((id) => id.endsWith("-error"))!;
    expect(document.getElementById(errorId)!.textContent).toContain("This field is required.");
  });
});

describe("New transformation: mode guidance (Arabic RTL)", () => {
  it("shows the Arabic rendering, marked provisional, with the English source text alongside", async () => {
    renderCreate("ar");
    const title = ar.title.replace("{{mode}}", catalogues.ar.transformations.mode.end_to_end);
    const region = await screen.findByRole("region", { name: title });
    expect(document.documentElement.dir).toBe("rtl");
    expect(region.querySelector("[data-guidance='whenToUse']")!.textContent).toBe(ar.end_to_end.whenToUse);
    expect(region.querySelector("[data-guidance='how']")!.textContent).toBe(ar.end_to_end.how);
    expect(region.textContent).toContain("ترجمة مؤقتة");
    // The verbatim English source is shown too, marked lang="en" dir="ltr".
    const original = region.querySelector("[data-guidance-source='how'] bdi")!;
    expect(original.getAttribute("lang")).toBe("en");
    expect(original.getAttribute("dir")).toBe("ltr");
    expect(original.textContent).toBe(en.end_to_end.how);

    fireEvent.click(
      screen.getByRole("radio", {
        name: new RegExp(`^${catalogues.ar.transformations.mode.modular.replace(/[()]/g, "\\$&")}`),
      }),
    );
    const modular = await screen.findByRole("region", {
      name: ar.title.replace("{{mode}}", catalogues.ar.transformations.mode.modular),
    });
    expect(modular.querySelector("[data-guidance='how']")!.textContent).toBe(ar.modular.how);
    expect(modular.querySelector("[data-guidance-source='how'] bdi")!.textContent).toBe(en.modular.how);
  });
});
