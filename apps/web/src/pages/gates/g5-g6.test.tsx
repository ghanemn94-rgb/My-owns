// G5/G6 views, the per-criterion review table, gate exceptions, the G5 scale scope and the Modular G3 waiver lines
// (T-DG4-FE-F; p4-work-split §H H.6; ADR-0035 §2-§5, §11; ADR-0038 amendment B1) with STUBBED responses, in English
// (LTR) and Arabic (RTL). The live journeys are in e2e/p4-gates-closure.spec.ts. SYNTHETIC data; every decision is a
// business approval inside the product (G1-G6), never an engineering gate (DG0-DG7).
//  - REQ-PB-020: a G5 refusal lists 'Risk closure' by its translated label; a G5 missing item names the risk code.
//  - REQ-S04-012/013: exceptions are listed with reason, scope, compensating action and owner, expiry and approver; an
//    accepted exception after its expiry reads "expired", never "covers"; a submission shows its frozen exception lines.
//  - REQ-S04-009/010: the review table has the nine fields; an unreviewed row reads "Not reviewed", never "Meets"; the
//    gate's Under Review status is shown.
//  - REQ-S04-007: a G5 approval needs the scale scope; nothing is sent without one; the scope is sent with the decision.
//  - REQ-PB-005: a Modular G3 submission shows its missing-links items and the waiver used; the approval refusals
//    gate.modular_waiver_revoked / _expired are translated.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import type { GateView } from "../../api/types.ts";
import { createI18n } from "../../i18n/index.ts";
import { BU_ID, TR_ID, USER_ID, makeMe, makeTransformation, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import type { Handler } from "../../test/fixtures.tsx";
import { METHODOLOGY, OTHER_USER, gateViews, id, leadGrants } from "../../test/p2fixtures.ts";
import { esc, initiative, P3_LEAD, page, problemBody, T, TR } from "../portfolio/p3fixtures.ts";
import { p4ItemSubject, p4RefusedCriterion, scaleScopeBody } from "./GateP4.tsx";
import { modularLinksOf, snapshotExceptionsOf } from "./p4api.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const G5_CRITERIA = [
  ["g5.performance_evidence", "Performance evidence", "أدلة الأداء"],
  ["g5.adoption", "Adoption", "التبنّي"],
  ["g5.risk_closure", "Risk closure", "إغلاق المخاطر"],
  ["g5.decision_log", "Decision log", "سجل القرارات"],
] as const;

/** The pinned catalogue with the four real G5 criteria (labels verbatim from B0023, ADR-0035 §2). */
const CATALOGUE = {
  ...METHODOLOGY,
  gateDefinitions: METHODOLOGY.gateDefinitions.map((g) =>
    g.code !== "G5"
      ? g
      : {
          ...g,
          submissionEnabled: true,
          criteria: G5_CRITERIA.map(([key, labelEn, labelAr], i) => ({
            ...g.criteria[0]!,
            id: id(),
            key,
            ordinal: i + 1,
            labelEn,
            labelAr,
          })),
        },
  ),
};

const PERMS: Permission[] = [
  ...P3_LEAD,
  "gate_exception.request",
  "gate_exception.decide",
  "gate.review",
] as Permission[];

function handlers(locale: "en" | "ar", extra: Handler[], mode: "end_to_end" | "modular" = "end_to_end"): Handler[] {
  return [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(PERMS), { preferredLocale: locale }),
    })),
    ...extra,
    route("GET", /\/business-units/, () =>
      page([
        {
          id: BU_ID,
          organizationId: makeTransformation().organizationId,
          parentBusinessUnitId: null,
          code: "SYN-RET",
          nameEn: "Synthetic Retail",
          nameAr: "التجزئة (اصطناعي)",
          status: "active",
          version: 1,
          createdAt: T,
          updatedAt: T,
        },
      ]),
    ),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation({ mode }) })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: CATALOGUE })),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
}

const RISK_ID = id();

function g5View(over: { pending?: boolean; canDecide?: boolean; status?: GateView["gate"]["status"] } = {}): GateView {
  const base = gateViews({ pending: true })[0]!;
  const g5 = gateViews()[4]!;
  const def = CATALOGUE.gateDefinitions[4]!;
  return {
    ...g5,
    definition: def as GateView["definition"],
    gate: {
      ...g5.gate,
      gateCode: "G5",
      status: over.status ?? (over.pending ? "submitted" : "draft"),
      latestSubmissionNo: over.pending ? 1 : 0,
      version: 4,
    },
    criteria: G5_CRITERIA.map(([key, labelEn, labelAr], i) => ({
      key,
      ordinal: i + 1,
      labelEn,
      labelAr,
      mandatory: true,
      requiresVerifiedEvidence: false,
      completeness: key === "g5.risk_closure" ? ("incomplete" as const) : ("complete" as const),
      missing:
        key === "g5.risk_closure"
          ? [
              {
                code: "g5.risk_open",
                message: "Risk closure: R-01 has High impact and is neither closed nor dispositioned.",
                pointer: `/raid/${RISK_ID}`,
              },
            ]
          : [],
      unverifiedEvidenceIds: [],
    })),
    currentSubmission: over.pending ? { ...base.currentSubmission!, gateCode: "G5" } : null,
    submissionEnabled: true,
    canSubmit: !over.pending,
    canDecide: over.canDecide ?? false,
  } as GateView;
}

function exception(over: Record<string, unknown> = {}) {
  return {
    id: id(),
    transformationId: TR_ID,
    gateInstanceId: id(),
    gateCode: "G5",
    criterionKey: "g5.risk_closure",
    reason: "Synthetic: the residual risk is owned by the BAU owner.",
    scope: "Synthetic: R-01 only",
    compensatingAction: "Synthetic: weekly risk review",
    compensatingOwnerUserId: USER_ID,
    expiresOn: "2026-12-31",
    status: "accepted",
    covering: true,
    requestedBy: OTHER_USER,
    requestedAt: T,
    decidedBy: USER_ID,
    decidedOnBehalfOf: null,
    decidedAt: T,
    decisionNote: "Synthetic demo decision.",
    revokedBy: null,
    revokedAt: null,
    revokeReason: null,
    expiryNotifiedAt: null,
    version: 2,
    createdAt: T,
    createdBy: OTHER_USER,
    updatedAt: T,
    updatedBy: USER_ID,
    ...over,
  };
}

function render(locale: "en" | "ar", view: GateView, extra: Handler[] = [], mode?: "end_to_end" | "modular") {
  const code = view.definition.code;
  const api = mockApi(
    ...handlers(
      locale,
      [...extra, route("GET", new RegExp(`${esc(TR)}/gates/${code}$`), () => ({ status: 200, body: view }))],
      mode,
    ),
  );
  renderApp(`/transformations/${TR_ID}/gates/${code}`, { i18n: createI18n(locale) });
  return api;
}

describe("pure helpers", () => {
  it("reads the frozen exception lines and the Modular-links member defensively", () => {
    const snap = {
      criteria: [
        { key: "g5.adoption", completeness: "complete" },
        {
          key: "g5.risk_closure",
          completeness: "incomplete",
          exception: {
            id: "e1",
            reason: "r",
            scope: "s",
            compensatingAction: "c",
            compensatingOwnerUserId: "u",
            expiresOn: "2026-12-31",
            decidedBy: "d",
            decidedAt: T,
          },
        },
      ],
      modularLinks: {
        missing: ["baseline_missing", "outcome_link_missing"],
        waiver: { dispensationId: "w1", expiresOn: "2026-11-30", reason: "why", decidedBy: "sp" },
      },
    };
    expect(snapshotExceptionsOf(snap)).toEqual([
      expect.objectContaining({ criterionKey: "g5.risk_closure", id: "e1", expiresOn: "2026-12-31" }),
    ]);
    expect(modularLinksOf(snap)).toEqual({
      missing: ["baseline_missing", "outcome_link_missing"],
      waiver: { dispensationId: "w1", expiresOn: "2026-11-30", reason: "why", decidedBy: "sp" },
    });
    expect(modularLinksOf({})).toBeNull();
    expect(snapshotExceptionsOf({ criteria: "x" })).toEqual([]);
  });

  it("names only a G5/G6 item's record code, never its English sentence", () => {
    expect(p4ItemSubject({ code: "g5.risk_open", message: "Risk closure: R-01 has High impact" })).toBe("R-01");
    expect(p4ItemSubject({ code: "g6.handover_not_accepted", message: "Ownership transfer: PA-02 Name has" })).toBe(
      "PA-02",
    );
    expect(p4ItemSubject({ code: "g5.decision_log_empty", message: "Decision log: the T16 decision log" })).toBeNull();
    expect(p4ItemSubject({ code: "g4.owner_missing", message: "Owners: INI-01 X" })).toBeNull();
    expect(p4RefusedCriterion("/criteria/g5.risk_closure")).toBe("g5.risk_closure");
    expect(p4RefusedCriterion("/criteria/g4.owners")).toBeNull();
  });

  it("a scale scope is never unrestricted: each item needs an initiative and a business unit, pairs unique", () => {
    const a = id();
    expect(scaleScopeBody({ items: [{ initiativeId: "", businessUnitId: "", note: "" }], conditions: [] })).toEqual({
      ok: false,
      code: "gates.scale.itemIncomplete",
    });
    expect(scaleScopeBody({ items: [{ initiativeId: a, businessUnitId: "", note: "" }], conditions: [] }).ok).toBe(
      false,
    );
    const dup = scaleScopeBody({
      items: [
        { initiativeId: a, businessUnitId: BU_ID, note: "" },
        { initiativeId: a, businessUnitId: BU_ID, note: "" },
      ],
      conditions: [],
    });
    expect(dup).toEqual({ ok: false, code: "gates.scale.duplicate" });
    expect(
      scaleScopeBody({
        items: [{ initiativeId: a, businessUnitId: BU_ID, note: "" }],
        conditions: [{ text: "x", ownerUserId: "", dueDate: "" }],
      }),
    ).toEqual({ ok: false, code: "gates.scale.conditionIncomplete" });
    expect(scaleScopeBody({ items: [{ initiativeId: a, businessUnitId: BU_ID, note: "" }], conditions: [] })).toEqual({
      ok: true,
      value: { items: [{ initiativeId: a, businessUnitId: BU_ID }] },
    });
  });
});

describe.each(["en", "ar"] as const)("G5 view (%s)", (locale) => {
  const t = createI18n(locale).t;
  const label = (key: string) => {
    const c = G5_CRITERIA.find(([k]) => k === key)!;
    return locale === "en" ? c[1] : c[2];
  };

  it("lists the G5 missing item translated with the risk code, and the exceptions with expiry and coverage", async () => {
    render(locale, g5View(), [
      route("GET", new RegExp(`${esc(TR)}/gate-exceptions\\?`), () =>
        page([
          exception(),
          exception({
            id: id(),
            criterionKey: "g5.adoption",
            covering: false,
            expiresOn: "2026-10-01",
            requestedAt: "2026-09-01T09:00:00Z",
          }),
          exception({
            id: id(),
            criterionKey: "g5.decision_log",
            status: "pending",
            covering: false,
            decidedBy: null,
            decidedAt: null,
            decisionNote: null,
            requestedAt: "2026-09-02T09:00:00Z",
          }),
        ]),
      ),
    ]);
    const item = await waitFor(() => {
      const li = document.querySelector("[data-missing='g5.risk_open']");
      expect(li).not.toBeNull();
      return li!;
    });
    expect(item.textContent).toContain(t("gates.missingItems.g5__risk_open"));
    expect(item.textContent).toContain("R-01");
    if (locale === "ar") expect(item.textContent).not.toContain("High impact");
    const covering = await waitFor(() => {
      const row = document.querySelector("[data-exception='g5.risk_closure']");
      expect(row).not.toBeNull();
      return row!;
    });
    expect(covering.querySelector("[data-state='covering']")).not.toBeNull();
    expect(covering.textContent).toContain(label("g5.risk_closure"));
    expect(covering.textContent).toContain("Synthetic: R-01 only");
    expect(covering.textContent).toContain("Synthetic: weekly risk review");
    const expired = document.querySelector("[data-exception='g5.adoption']")!;
    expect(expired.querySelector("[data-state='expired']")).not.toBeNull();
    expect(expired.querySelector("[data-state='covering']")).toBeNull();
    expect(expired.getAttribute("data-exception-id")).toBeTruthy();
    expect(expired.querySelector("[data-covering]")!.getAttribute("data-covering")).toBe("false");
    // A pending exception requested by someone else can be decided by this approver; an accepted one can be revoked.
    const pending = document.querySelector("[data-exception='g5.decision_log']")!;
    expect(pending.textContent).toContain(t("gates.exception.status.pending"));
    expect(
      within(pending as HTMLElement).getByRole("button", { name: new RegExp(t("gates.exception.decide")) }),
    ).toBeTruthy();
    expect(
      within(covering as HTMLElement).getByRole("button", { name: new RegExp(t("gates.exception.revoke")) }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("requests an exception with all five REQ-S04-013 fields; a missing expiry is refused before sending", async () => {
    const { requests } = render(locale, g5View(), [
      route("POST", new RegExp(`${esc(TR)}/gate-exceptions$`), () => ({ status: 201, body: exception() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.exception.request")) }));
    const dialog = await screen.findByRole("dialog");
    const set = (name: string, value: string) => {
      const el = dialog.querySelector<HTMLInputElement>(`[data-field='${name}']`);
      expect(el, name).not.toBeNull();
      fireEvent.change(el!, { target: { value } });
    };
    set("criterionKey", "g5.risk_closure");
    set("reason", "Synthetic reason");
    set("scope", "Synthetic scope");
    set("compensatingAction", "Synthetic compensating action");
    set("compensatingOwnerUserId", USER_ID);
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.exception.requestSubmit") }));
    await waitFor(() => expect(dialog.querySelector("[aria-invalid='true']")).not.toBeNull());
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    set("expiresOn", "2026-12-31");
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.exception.requestSubmit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      gateCode: "G5",
      criterionKey: "g5.risk_closure",
      reason: "Synthetic reason",
      scope: "Synthetic scope",
      compensatingAction: "Synthetic compensating action",
      compensatingOwnerUserId: USER_ID,
      expiresOn: "2026-12-31",
    });
  });

  it("a refused G5 submission lists 'Risk closure' by its translated label, never the English detail", async () => {
    render(locale, g5View(), [
      route("POST", new RegExp(`${esc(TR)}/gates/G5/submissions$`), () =>
        problemBody(
          422,
          "urn:mth:problem:validation",
          "gate_criteria_incomplete",
          "Mandatory required outputs are incomplete: Risk closure.",
          [
            {
              pointer: "/criteria/g5.risk_closure",
              code: "gate.criterion_incomplete",
              message: "Risk closure: R-01 has High impact and is neither closed nor dispositioned.",
            },
          ],
        ),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.submit.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    const line = alert.querySelector("[data-refused-criterion='g5.risk_closure']")!;
    expect(line.textContent).toContain(label("g5.risk_closure"));
    expect(alert.textContent).not.toContain("Mandatory required outputs");
  });

  it("a G5 approval needs the scale scope: nothing is sent without one; the scope goes with the decision", async () => {
    const INI = initiative({ id: id(), code: "INI-01", name: "Synthetic onboarding", status: "launched" });
    const { requests } = render(locale, g5View({ pending: true, canDecide: true }), [
      route("GET", /\/api\/v1\/initiatives\?/, () => page([INI])),
      route("POST", new RegExp(`${esc(TR)}/gates/G5/decision$`), () => ({ status: 201, body: {} })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: t("gates.decision.action") }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-scale-scope-editor]")).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: t("gates.outcome.approved") }));
    expect(dialog.querySelector("[data-scale-scope-editor]")).not.toBeNull();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("gates.decision.rationale")}`)), {
      target: { value: "Synthetic demo approval (approves nothing real)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    expect(await within(dialog).findByText(t("gates.scale.itemIncomplete"))).toBeTruthy();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    await waitFor(() =>
      expect(dialog.querySelector(`[data-scope-initiative='0'] option[value='${INI.id}']`)).not.toBeNull(),
    );
    fireEvent.change(dialog.querySelector("[data-scope-initiative='0']")!, { target: { value: INI.id } });
    fireEvent.change(dialog.querySelector("[data-scope-unit='0']")!, { target: { value: BU_ID } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toMatchObject({
      outcome: "approved",
      scaleScope: { items: [{ initiativeId: INI.id, businessUnitId: BU_ID }] },
    });
  });

  it("a frozen submission shows its exception lines and the nine-field review table, Under review", async () => {
    const view = g5View({ pending: true, status: "under_review" });
    const sub = {
      ...view.currentSubmission!,
      submittedBy: OTHER_USER,
      snapshot: {
        criteria: [
          {
            key: "g5.risk_closure",
            completeness: "incomplete",
            exception: {
              id: "ex-1",
              reason: "Synthetic frozen reason",
              scope: "Synthetic frozen scope",
              compensatingAction: "Synthetic frozen compensating action",
              compensatingOwnerUserId: USER_ID,
              expiresOn: "2026-12-31",
              decidedBy: USER_ID,
              decidedAt: T,
            },
          },
        ],
      },
    };
    const row = (key: string, reviewed: boolean) => {
      const c = G5_CRITERIA.find(([k]) => k === key)!;
      return {
        criterionKey: key,
        ordinal: G5_CRITERIA.indexOf(c) + 1,
        mandatory: true,
        criterionLabelEn: c[1],
        criterionLabelAr: c[2],
        requiredEvidenceEn: "Synthetic required evidence",
        requiredEvidenceAr: "أدلة مطلوبة اصطناعية",
        completeness: key === "g5.risk_closure" ? "incomplete" : "complete",
        reviewerUserId: reviewed ? USER_ID : null,
        finding: reviewed ? "Synthetic finding" : null,
        openCondition: reviewed ? "Synthetic open condition" : null,
        risk: reviewed ? { note: "Synthetic risk note", raidEntryId: null } : null,
        decision: reviewed ? "meets_with_conditions" : null,
        rationale: reviewed ? "Synthetic rationale" : null,
        reviewCount: reviewed ? 1 : 0,
        exception: key === "g5.risk_closure" ? exception() : null,
      };
    };
    render(locale, view, [
      route("GET", new RegExp(`${esc(TR)}/gates/G5/submissions\\?|${esc(TR)}/gates/G5/submissions$`), () =>
        page([sub]),
      ),
      route("GET", new RegExp(`${esc(TR)}/gates/G5/submissions/1$`), () => ({
        status: 200,
        body: { submission: sub, criteria: [], decision: null },
      })),
      route("GET", new RegExp(`${esc(TR)}/gates/G5/submissions/1/criteria$`), () => ({
        status: 200,
        body: {
          gateCode: "G5",
          submissionNo: 1,
          snapshotSha256: "a".repeat(64),
          gateStatus: "under_review",
          items: [row("g5.performance_evidence", false), row("g5.risk_closure", true)],
        },
      })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.history.view")) }));
    const table = await waitFor(() => {
      const el = document.querySelector("[data-review-table='1'] table");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(table.querySelectorAll("thead th")).toHaveLength(10);
    const unreviewed = table.querySelector("[data-review-row='g5.performance_evidence']")!;
    expect(unreviewed.querySelector("[data-recommendation='none']")!.textContent).toContain(
      t("gates.review.notReviewed"),
    );
    expect(unreviewed.textContent).not.toContain(t("gates.review.recommendation.meets"));
    const reviewed = table.querySelector("[data-review-row='g5.risk_closure']")!;
    for (const text of ["Synthetic finding", "Synthetic open condition", "Synthetic risk note", "Synthetic rationale"])
      expect(reviewed.textContent).toContain(text);
    expect(reviewed.textContent).toContain(t("gates.review.recommendation.meets_with_conditions"));
    expect(reviewed.querySelector("[data-covered-by-exception]")).not.toBeNull();
    expect(document.querySelector("[data-review-gate-status='under_review']")!.textContent).toContain(
      t("gates.status.under_review"),
    );
    // The reviewer is not the submitter, so each row offers "Record review".
    expect(
      within(table as HTMLElement).getAllByRole("button", { name: new RegExp(t("gates.review.action")) }),
    ).toHaveLength(2);
    const frozen = document.querySelector("[data-frozen-exception='g5.risk_closure']")!;
    for (const text of ["Synthetic frozen reason", "Synthetic frozen scope", "Synthetic frozen compensating action"])
      expect(frozen.textContent).toContain(text);
    expect(frozen.textContent).toContain(label("g5.risk_closure"));
  });
});

describe.each(["en", "ar"] as const)("Modular G3 waiver on the gate page (%s)", (locale) => {
  const t = createI18n(locale).t;

  function g3View(): GateView {
    const views = gateViews({ pending: true, canDecide: true });
    const g1 = views[0]!;
    const g3 = views[2]!;
    return {
      ...g3,
      gate: { ...g3.gate, status: "submitted", latestSubmissionNo: 1 },
      currentSubmission: {
        ...g1.currentSubmission!,
        gateCode: "G3",
        snapshot: {
          modularLinks: {
            missing: ["baseline_missing", "outcome_link_missing"],
            waiver: {
              dispensationId: id(),
              expiresOn: "2026-11-30",
              reason: "Synthetic waiver reason",
              decidedBy: USER_ID,
            },
          },
        },
      },
      canDecide: true,
    } as GateView;
  }

  it("the submission shows the missing-links items and the waiver used; a revoked waiver's refusal is translated", async () => {
    const view = g3View();
    render(
      locale,
      view,
      [
        route("GET", new RegExp(`${esc(TR)}/gates/G3/submissions(\\?.*)?$`), () => page([view.currentSubmission])),
        route("GET", new RegExp(`${esc(TR)}/gates/G3/submissions/1$`), () => ({
          status: 200,
          body: { submission: view.currentSubmission, criteria: [], decision: null },
        })),
        route("POST", new RegExp(`${esc(TR)}/gates/G3/decision$`), () =>
          problemBody(
            422,
            "urn:mth:problem:validation",
            "gate.modular_waiver_revoked",
            "The waiver of the missing baseline and outcome links was revoked on 2026-10-09; …",
          ),
        ),
      ],
      "modular",
    );
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.history.view")) }));
    const block = await waitFor(() => {
      const el = document.querySelector("[data-modular-links]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(block.querySelector("[data-missing-link='baseline_missing']")!.textContent).toContain(
      t("problems.baseline_missing"),
    );
    expect(block.querySelector("[data-missing-link='outcome_link_missing']")!.textContent).toContain(
      t("problems.outcome_link_missing"),
    );
    expect(block.querySelector("[data-modular-waiver]")!.textContent).toContain("Synthetic waiver reason");
    fireEvent.click(screen.getByRole("button", { name: t("gates.decision.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("gates.outcome.approved") }));
    expect(dialog.querySelector("[data-scale-scope-editor]")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("gates.decision.rationale")}`)), {
      target: { value: "Synthetic rationale" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.gate__modular_waiver_revoked"));
    expect(alert.textContent).not.toContain("2026-10-09; …");
  });

  it("a G3 submission refused for missing links lists each item translated", async () => {
    const views = gateViews();
    const g3 = { ...views[2]!, canSubmit: true, submissionEnabled: true } as GateView;
    render(
      locale,
      g3,
      [
        route("POST", new RegExp(`${esc(TR)}/gates/G3/submissions$`), () =>
          problemBody(422, "urn:mth:problem:validation", "gate.modular_links_missing", "English detail", [
            { pointer: "/baseline", code: "baseline_missing", message: "No active baseline with a value is recorded." },
            { pointer: "/outcomes", code: "outcome_link_missing", message: "No active outcome has an active KPI." },
          ]),
        ),
      ],
      "modular",
    );
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.submit.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.gate__modular_links_missing"));
    expect(alert.querySelector("[data-missing-link='baseline_missing']")!.textContent).toContain(
      t("problems.baseline_missing"),
    );
    if (locale === "ar") expect(alert.textContent).not.toContain("No active baseline");
  });
});

// ------------------------------------------------------------------------------------------------ T-DG4-FE-F2
// Scale transitions and risk dispositions on the G5 page (ADR-0035 §5, §6, §11; REQ-S03-004, REQ-S04-007, REQ-PB-020),
// with STUBBED responses. The live journey is e2e/p4-change-phases.spec.ts. SYNTHETIC data only.
const SCALE_PERMS: Permission[] = [...PERMS, "scale.transition", "risk_disposition.propose"] as Permission[];

function renderScale(locale: "en" | "ar", extra: Handler[] = []) {
  const view = g5View();
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(SCALE_PERMS), { preferredLocale: locale }),
    })),
    ...handlers(locale, [
      ...extra,
      route("GET", new RegExp(`${esc(TR)}/gates/G5$`), () => ({ status: 200, body: view })),
    ]).slice(1),
  );
  renderApp(`/transformations/${TR_ID}/gates/G5`, { i18n: createI18n(locale) });
  return api;
}

const OPEN_RISK = {
  id: RISK_ID,
  transformationId: TR_ID,
  type: "risk",
  code: "R-01",
  description: "Synthetic: the billing migration may slip.",
  impact: "high",
  probability: "medium",
  ownerUserId: USER_ID,
  dueDate: null,
  mitigation: null,
  status: "open",
  recordStatus: "active",
  recordTable: "raid_entry",
  initiativeId: null,
  closedAt: null,
};

describe.each(["en", "ar"] as const)("G5 scale transitions and risk dispositions (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("scaling before G5 is approved shows the translated invalid-transition that names G5", async () => {
    const INI = initiative({ id: id(), code: "INI-01", name: "Synthetic onboarding", status: "launched" });
    const { requests } = renderScale(locale, [
      route("GET", /\/api\/v1\/initiatives\?/, () => page([INI])),
      route("POST", new RegExp(`${esc(TR)}/scale-transitions$`), () =>
        problemBody(
          422,
          "urn:mth:problem:invalid-transition",
          "gate.g5_not_approved",
          "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation.",
        ),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("gates.scaleTransition.create")) }));
    const dialog = await screen.findByRole("dialog");
    const selects = within(dialog).getAllByRole("combobox");
    await waitFor(() => expect(within(selects[0]!).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(selects[0]!, { target: { value: INI.id } });
    fireEvent.change(selects[1]!, { target: { value: BU_ID } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.scaleTransition.submit") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.gate__g5_not_approved"));
    expect(alert.textContent).toContain("G5");
    if (locale === "ar") expect(alert.textContent).not.toContain("Scaling requires");
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/scale-transitions"))!;
    expect(post.body).toEqual({ initiativeId: INI.id, businessUnitId: BU_ID });
  });

  it("an open High-impact risk without a disposition is flagged; proposing one sends the four fields", async () => {
    const { requests } = renderScale(locale, [
      route("GET", new RegExp(`${esc(TR)}/raid\\?`), () => page([OPEN_RISK])),
      route("GET", new RegExp(`${esc(TR)}/risk-dispositions`), () => page([])),
      route("POST", new RegExp(`${esc(TR)}/risk-dispositions$`), () => ({ status: 201, body: {} })),
    ]);
    const row = await waitFor(() => {
      const r = document.querySelector("[data-risk='R-01']");
      expect(r).not.toBeNull();
      return r!;
    });
    expect(row.getAttribute("data-risk-dispositioned")).toBe("false");
    expect(row.textContent).toContain(t("gates.riskDisposition.material"));
    expect(row.querySelector("[data-disposition='none']")!.textContent).toContain(t("gates.riskDisposition.none"));
    fireEvent.click(row.querySelector("[data-action='propose-disposition']")!);
    const dialog = await screen.findByRole("dialog");
    const [kind, owner] = within(dialog).getAllByRole("combobox");
    fireEvent.change(kind!, { target: { value: "carry_into_bau" } });
    await waitFor(() => expect(within(owner!).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(owner!, { target: { value: USER_ID } });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Synthetic: BAU owns the residual risk." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.riskDisposition.submit") }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/risk-dispositions"))).toBe(true),
    );
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/risk-dispositions"))!;
    expect(post.body).toEqual({
      raidEntryId: RISK_ID,
      disposition: "carry_into_bau",
      residualOwnerUserId: USER_ID,
      rationale: "Synthetic: BAU owns the residual risk.",
    });
  });

  it("a pending disposition is shown as pending, not as closed; an approved one completes the row", async () => {
    const disp = (status: string) => ({
      id: id(),
      transformationId: TR_ID,
      raidEntryId: RISK_ID,
      disposition: "accept",
      rationale: "Synthetic rationale",
      residualOwnerUserId: USER_ID,
      approvalId: id(),
      approvalStatus: status,
      version: 1,
      createdAt: T,
      createdBy: OTHER_USER,
    });
    renderScale(locale, [
      route("GET", new RegExp(`${esc(TR)}/raid\\?`), () => page([OPEN_RISK])),
      route("GET", new RegExp(`${esc(TR)}/risk-dispositions`), () => page([disp("pending")])),
    ]);
    const row = await waitFor(() => {
      const r = document.querySelector("[data-risk='R-01'] [data-approval-status='pending']");
      expect(r).not.toBeNull();
      return r!.closest("tr")!;
    });
    expect(row.getAttribute("data-risk-dispositioned")).toBe("false");
    expect(row.textContent).toContain(t("gates.riskDisposition.approval.pending"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });
});
