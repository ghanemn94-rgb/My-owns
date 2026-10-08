// G4 view (REQ-PB-019, REQ-S04-006, REQ-PB-046, REQ-PB-055, REQ-PB-059; ADR-0021 §7) with STUBBED responses: BE-E
// ships the evaluators in parallel, so the live e2e is the next wave. English (LTR) and Arabic (RTL). SYNTHETIC data.
//  - the eight g4.* criteria with their missing items, labelled as the server's English labels say ('Owners',
//    'Finance validation') and translated in Arabic, with the initiative code and name as the server returns them;
//  - a refused submission (422 gate_criteria_incomplete) lists every missing item;
//  - the decision's 403 (not the approver / submitter cannot decide) and 409 (superseded) are translated.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateView } from "../../api/types.ts";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { gateViews, id } from "../../test/p2fixtures.ts";
import { esc, frameHandlers, initiative, page, problemBody, TR } from "../portfolio/p3fixtures.ts";
import { g4CardFields, g4Subject } from "./GateDetailPage.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INI = id();
const CRITERIA: [string, string, string, { code: string; message: string; pointer?: string }[]][] = [
  [
    "g4.initiative_cards",
    "Initiative cards",
    "بطاقات المبادرات",
    [
      {
        code: "g4.initiative_gap_missing",
        message: "Gap link missing: INI-01 Synthetic onboarding",
        pointer: `/initiatives/${INI}`,
      },
    ],
  ],
  [
    "g4.business_cases",
    "Business cases",
    "دراسات الجدوى",
    [{ code: "g4.business_case_missing", message: "Business cases" }],
  ],
  [
    "g4.finance_validation",
    "Finance validation",
    "التحقق المالي",
    [{ code: "g4.finance_validation_missing", message: "Finance validation", pointer: `/business-cases/${id()}` }],
  ],
  ["g4.prioritization", "Prioritization", "الترتيب حسب الأولوية", []],
  ["g4.roadmap", "Roadmap", "خارطة الطريق", []],
  [
    "g4.owners",
    "Owners",
    "المالكون",
    [{ code: "g4.owner_missing", message: "Owners: INI-01 Synthetic onboarding", pointer: `/initiatives/${INI}` }],
  ],
  [
    "g4.funding",
    "Funding",
    "التمويل",
    [
      {
        code: "g4.funding_missing",
        message: "Funding decision missing: INI-01 Synthetic onboarding",
        pointer: `/initiatives/${INI}`,
      },
    ],
  ],
  [
    "g4.capacity",
    "Capacity",
    "السعة",
    [{ code: "g4.capacity_conflict", message: "Capacity conflict: Data engineer 2026-11" }],
  ],
];

function g4View(over: Partial<GateView> = {}): GateView {
  const views = gateViews({ pending: true, canDecide: true });
  const g1 = views[0]!;
  const g4 = views[3]!;
  return {
    ...g4,
    definition: { ...g4.definition, submissionEnabled: true },
    criteria: CRITERIA.map(([key, labelEn, labelAr, missing], i) => ({
      key,
      ordinal: i + 1,
      labelEn,
      labelAr,
      mandatory: true,
      requiresVerifiedEvidence: false,
      completeness: missing.length === 0 ? ("complete" as const) : ("incomplete" as const),
      missing,
      unverifiedEvidenceIds: [],
    })),
    submissionEnabled: true,
    canSubmit: true,
    ...over,
    gate: { ...g4.gate, status: "draft", currentSubmissionId: null, latestSubmissionNo: 0, ...over.gate },
    currentSubmission: over.currentSubmission === undefined ? null : over.currentSubmission,
    ...(over.currentSubmission ? { currentSubmission: { ...g1.currentSubmission!, gateCode: "G4" } } : {}),
  } as GateView;
}

function render(locale: "en" | "ar", view: GateView, extra: Parameters<typeof frameHandlers>[2] = []) {
  const api = mockApi(
    ...frameHandlers(locale, "lead", [
      ...extra,
      route("GET", new RegExp(`${esc(TR)}/gates/G4$`), () => ({ status: 200, body: view })),
      route("GET", new RegExp(`${esc(TR)}/gates/G4/submissions`), () => ({
        status: 200,
        body: { items: [], nextCursor: null },
      })),
    ]),
  );
  renderApp(`/transformations/${TR_ID}/gates/G4`, { i18n: createI18n(locale) });
  return api;
}

describe("g4Subject", () => {
  it("takes the data part of a G4 label and nothing else", () => {
    expect(g4Subject({ code: "g4.owner_missing", message: "Owners: INI-01 Synthetic onboarding" })).toBe(
      "INI-01 Synthetic onboarding",
    );
    expect(g4Subject({ code: "g4.finance_validation_missing", message: "Finance validation" })).toBeNull();
    expect(g4Subject({ code: "g1.baseline.measurable_missing", message: "Something: x" })).toBeNull();
  });

  it("separates a card item's field list from its subject and keeps only known T05 fields", () => {
    const card = {
      code: "g4.initiative_card_incomplete",
      message: "Initiative card incomplete: INI-01 X (objective, scopeIn)",
    };
    expect(g4Subject(card)).toBe("INI-01 X");
    expect(g4CardFields(card)).toEqual(["objective", "scopeIn"]);
    expect(
      g4CardFields({ code: "g4.initiative_card_incomplete", message: "Initiative card incomplete: INI-01 X (beta)" }),
    ).toEqual([]);
    expect(g4CardFields({ code: "g4.owner_missing", message: "Owners: INI-01 X (objective)" })).toEqual([]);
  });
});

// T-DG3-FE-F: the server's G4 refusal has ONE entry per criterion whose message JOINS the English labels of all its
// items (ADR-0021 §7 "The refusal shape"). The dialog never parses it: it lists the items of the refreshed gate view,
// each translated, one per initiative. SYNTHETIC data.
describe.each(["en", "ar"] as const)("G4 refusal item by item (%s)", (locale) => {
  const t = createI18n(locale).t;
  const INI_A = initiative({ id: id(), code: "INI-01", name: "Synthetic onboarding" });
  const INI_B = initiative({ id: id(), code: "INI-02", name: "Synthetic billing" });
  const JOINED_422 = problemBody(422, "urn:mth:problem:validation", "gate_criteria_incomplete", "English detail", [
    {
      pointer: "/criteria/g4.owners",
      code: "g4.owner_missing",
      message: "Owners: INI-01 Synthetic onboarding Owners: INI-02 Synthetic billing",
    },
    {
      pointer: "/criteria/g4.finance_validation",
      code: "g4.finance_validation_missing",
      message: "Finance validation",
    },
  ]);
  const twoOwnersView = () => {
    const v = g4View();
    return {
      ...v,
      criteria: v.criteria.map((c) =>
        c.key === "g4.owners"
          ? {
              ...c,
              missing: [
                {
                  code: "g4.owner_missing",
                  message: "Owners: INI-01 Synthetic onboarding",
                  pointer: `/initiatives/${INI_A.id}`,
                },
                {
                  code: "g4.owner_missing",
                  message: "Owners: INI-02 Synthetic billing",
                  pointer: `/initiatives/${INI_B.id}`,
                },
              ],
            }
          : c,
      ),
    } as GateView;
  };

  async function submitAndRefuse() {
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.submit.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    return within(dialog).findByRole("alert");
  }

  it("two initiatives without owners: two separate translated 'Owners' items, never the joined English message", async () => {
    const { requests } = render(locale, twoOwnersView(), [
      route("POST", new RegExp(`${esc(TR)}/gates/G4/submissions$`), () => JOINED_422),
      route("GET", /\/api\/v1\/initiatives\?/, () => page([INI_A, INI_B])),
    ]);
    const viewReads = () => requests.filter((r) => r.method === "GET" && /\/gates\/G4$/.test(r.url)).length;
    await screen.findByRole("button", { name: new RegExp(t("gates.submit.action")) });
    const before = viewReads();
    const alert = await submitAndRefuse();
    expect(alert.textContent).toContain(t("problems.gate_criteria_incomplete"));
    const owners = await waitFor(() => {
      const li = [...alert.querySelectorAll("[data-missing='g4.owner_missing']")];
      expect(li).toHaveLength(2);
      return li;
    });
    const label = locale === "en" ? "Owners" : "المالكون";
    expect(owners[0]!.textContent).toContain(label);
    expect(owners[0]!.textContent).toContain("INI-01 Synthetic onboarding");
    expect(owners[0]!.textContent).not.toContain("INI-02");
    expect(owners[1]!.textContent).toContain(label);
    expect(owners[1]!.textContent).toContain("INI-02 Synthetic billing");
    expect(owners[1]!.textContent).not.toContain("INI-01");
    const finance = alert.querySelector("[data-missing='g4.finance_validation_missing']")!;
    expect(finance.textContent).toContain(locale === "en" ? "Finance validation" : "التحقق المالي");
    // The joined server message is never shown, in either language.
    expect(alert.textContent).not.toContain("Owners: INI-02");
    expect(alert.textContent).not.toContain("English detail");
    // The view was read again after the 422 (session-bound refresh, no setQueryData).
    expect(viewReads()).toBeGreaterThan(before);
    if (locale === "ar") {
      expect(alert.textContent).not.toMatch(/Owners|Finance validation|Gap link missing/);
      expect(document.body.textContent).not.toMatch(/Owners:|Finance validation|Gap link missing/);
    }
  });

  it("without a usable gate view: one translated line per refused criterion, never the English message", async () => {
    let refused = false;
    render(locale, twoOwnersView(), [
      route("POST", new RegExp(`${esc(TR)}/gates/G4/submissions$`), () => {
        refused = true;
        return JOINED_422;
      }),
      // The refreshed view cannot be loaded (404 is not retried).
      route("GET", new RegExp(`${esc(TR)}/gates/G4$`), () =>
        refused ? problemBody(404, "urn:mth:problem:not-found", "not_found", "English detail") : undefined,
      ),
    ]);
    const alert = await submitAndRefuse();
    const lines = await waitFor(() => {
      const li = [...alert.querySelectorAll("[data-refused-criterion]")];
      expect(alert.querySelector("[data-g4-refusal='criteria']")).not.toBeNull();
      return li;
    });
    expect(lines.map((l) => l.getAttribute("data-refused-criterion"))).toEqual(["g4.owners", "g4.finance_validation"]);
    expect(lines[0]!.textContent).toContain(t("gates.criterionTitle.g4__owners"));
    expect(lines[1]!.textContent).toContain(t("gates.criterionTitle.g4__finance_validation"));
    expect(alert.textContent).not.toContain("INI-02");
    if (locale === "ar") expect(alert.textContent).not.toMatch(/Owners|Finance validation/);
  });
});

describe.each(["en", "ar"] as const)("G4 view (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists the eight G4 criteria with their missing items: 'Owners', 'Finance validation' and the initiative", async () => {
    render(locale, g4View());
    const rows = await waitFor(() => {
      const r = document.querySelectorAll("[data-criterion^='g4.']");
      expect(r).toHaveLength(8);
      return r;
    });
    expect([...rows].map((r) => r.getAttribute("data-criterion"))).toEqual(CRITERIA.map(([k]) => k));
    const owners = document.querySelector("[data-criterion='g4.owners']")!;
    const ownerItem = owners.querySelector("[data-missing='g4.owner_missing']")!;
    expect(ownerItem.textContent).toContain(locale === "en" ? "Owners" : "المالكون");
    expect(ownerItem.textContent).toContain("INI-01 Synthetic onboarding");
    const link = within(ownerItem as HTMLElement).getByRole("link");
    expect(link.getAttribute("href")).toBe(`/transformations/${TR_ID}/initiatives/${INI}`);
    const finance = document.querySelector("[data-missing='g4.finance_validation_missing']")!;
    expect(finance.textContent).toContain(locale === "en" ? "Finance validation" : "التحقق المالي");
    const capacity = document.querySelector("[data-missing='g4.capacity_conflict']")!;
    expect(capacity.textContent).toContain("Data engineer 2026-11");
    if (locale === "ar") {
      // The English labels are never shown to an Arabic user (only the data part: codes, names, periods).
      expect(document.querySelector("main")!.textContent).not.toMatch(
        /Owners|Finance validation|Funding decision missing/,
      );
    }
    expect(screen.getAllByText(new RegExp(t("gates.businessApproval"))).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("a refused submission shows the 422 list with the initiative names, translated", async () => {
    const { requests } = render(locale, g4View(), [
      route("POST", new RegExp(`${esc(TR)}/gates/G4/submissions$`), () =>
        problemBody(422, "urn:mth:problem:validation", "gate_criteria_incomplete", "English detail", [
          { pointer: "/criteria/g4.owners", code: "g4.owner_missing", message: "Owners: INI-01 Synthetic onboarding" },
          {
            pointer: "/criteria/g4.finance_validation",
            code: "g4.finance_validation_missing",
            message: "Finance validation",
          },
        ]),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.submit.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.gate_criteria_incomplete"));
    const items = [...alert.querySelectorAll("[data-missing]")].map((li) => li.textContent);
    expect(items[0]).toContain(locale === "en" ? "Owners" : "المالكون");
    expect(items[0]).toContain("INI-01 Synthetic onboarding");
    expect(items[1]).toContain(locale === "en" ? "Finance validation" : "التحقق المالي");
    expect(alert.textContent).not.toContain("English detail");
    expect(requests.some((r) => r.method === "POST")).toBe(true);
  });

  it.each([
    [403, "urn:mth:problem:forbidden", "gate.not_approver", "problems.gate__not_approver"],
    [403, "urn:mth:problem:forbidden", "gate.submitter_cannot_decide", "problems.gate__submitter_cannot_decide"],
    [409, "urn:mth:problem:version-conflict", "gate.submission_superseded", "problems.gate__submission_superseded"],
  ] as const)("the decision's %i %s is translated", async (status, type, code, key) => {
    const view = g4View({ canDecide: true, currentSubmission: {} as GateView["currentSubmission"] });
    render(locale, { ...view, gate: { ...view.gate, status: "submitted", latestSubmissionNo: 1 } }, [
      route("POST", new RegExp(`${esc(TR)}/gates/G4/decision$`), () =>
        problemBody(status, type, code, "English detail"),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: t("gates.decision.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("gates.outcome.approved") }));
    // G4 asks for no G1 leadership confirmations.
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("gates.decision.rationale")}`)), {
      target: { value: "Synthetic rationale" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t(key));
    expect(alert.textContent).not.toContain("English detail");
  });
});
