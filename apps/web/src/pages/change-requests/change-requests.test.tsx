// Change requests (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0036 §1-§5, §10, A1; ADR-0026 amendment E1-E6) with STUBBED
// responses, in English (LTR) and Arabic (RTL). The live journey is e2e/p4-change-phases.spec.ts. SYNTHETIC data; a
// change request is decided in a business approval inside the product, never an engineering gate (DG0-DG7).
//  - REQ-S04-014 / REQ-S07-015 / REQ-S09-010: the form sends `from` exactly as recorded and the subject's version; the
//    impact preview lists the affected records and names the preserved gate approval; a draft is clearly a draft.
//  - The materiality policy is read at version 0 (`ETag: "0"`) and the first save sends `If-Match: "0"` (D-109).
//  - Round 2 after "changes requested"; only the requester submits again or withdraws (403 approval.not_requester).
//  - Every ADR-0036 §10 code has an English and an Arabic text.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { CHANGE_CONTROL_REFUSALS } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { problemKey } from "../../lib/problem.ts";
import { TR_ID, USER_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import type { Handler } from "../../test/fixtures.tsx";
import { OTHER_USER, id, leadGrants } from "../../test/p2fixtures.ts";
import { esc, frameHandlers, initiative, page, problemBody, T, TR } from "../portfolio/p3fixtures.ts";
import { proposedRowsOf } from "./api.ts";
import { buildChangeRequestBody } from "./CreateChangeRequest.tsx";
import { kpiVersionDiff, normalizeDecimal } from "./subjects.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERMS = ["change_request.raise", "change_control.configure"] as Permission[];
const INI = initiative({ id: id(), code: "INI-01", name: "Synthetic onboarding", status: "launched" });
const MILESTONE_ID = id();
const APPROVAL_ID = id();
const CR_ID = id();
const SUBMISSION_ID = id();
const DECISION_ID = id();

function cr(over: Record<string, unknown> = {}) {
  return {
    id: CR_ID,
    transformationId: TR_ID,
    code: "CR-01",
    changeKind: "schedule_rebaseline",
    subjectType: "milestone",
    subjectId: MILESTONE_ID,
    subjectVersion: 3,
    proposedRecordType: null,
    proposedRecordId: null,
    proposedChange: { approvedDate: { from: "2026-11-30", to: "2027-01-29" } },
    reason: "Synthetic: the vendor moved the cut-over.",
    origin: "manual",
    materiality: null,
    materialityBasis: null,
    routePartyCode: null,
    decisionRightId: null,
    approvalId: null,
    status: "draft",
    raisedBy: USER_ID,
    submittedBy: null,
    submittedAt: null,
    currentImpactAssessmentId: null,
    decidedAt: null,
    appliedAt: null,
    appliedRecordType: null,
    appliedRecordId: null,
    appliedVersion: null,
    withdrawnAt: null,
    version: 1,
    createdAt: T,
    createdBy: USER_ID,
    updatedAt: T,
    updatedBy: USER_ID,
    ...over,
  };
}

const PREVIEW = {
  materiality: "material",
  materialityBasis: { rule: "date_shift", shiftWorkingDays: 42, threshold: null, reason: "no_threshold" },
  hiddenItemCount: 0,
  items: [
    {
      ordinal: 1,
      itemType: "initiative",
      recordType: "initiative",
      recordId: INI.id,
      recordCode: "INI-01",
      label: "Synthetic onboarding",
      effect: "value_changes",
      gateSubmissionId: null,
      gateDecisionId: null,
      detail: {},
    },
    {
      ordinal: 2,
      itemType: "gate",
      recordType: "gate_submission",
      recordId: SUBMISSION_ID,
      recordCode: "G4",
      label: "G4 approval (submission 1) is preserved; this change needs reapproval",
      effect: "reapproval_required",
      gateSubmissionId: SUBMISSION_ID,
      gateDecisionId: DECISION_ID,
      detail: { gateCode: "G4", gateStatus: "approved", submissionNo: 1 },
    },
    {
      ordinal: 3,
      itemType: "report",
      recordType: null,
      recordId: null,
      recordCode: null,
      label: "T10 Portfolio area",
      effect: "informational",
      gateSubmissionId: null,
      gateDecisionId: null,
      detail: { area: "T10.portfolio" },
    },
  ],
};

const POLICY_V0 = {
  transformationId: TR_ID,
  materialDateShiftWorkingDays: null,
  materialBudgetChangeRatio: null,
  note: null,
  version: 0,
  updatedAt: null,
  updatedBy: null,
};

function render(locale: "en" | "ar", path: string, extra: Handler[] = []) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(PERMS), { preferredLocale: locale }),
    })),
    ...frameHandlers(locale, "lead", [
      ...extra,
      route("GET", new RegExp(`${esc(TR)}/change-control-policy$`), () => ({
        status: 200,
        body: POLICY_V0,
        headers: { ETag: '"0"' },
      })),
      route("GET", /\/api\/v1\/initiatives\?/, () => page([INI])),
      route("GET", new RegExp(`/api/v1/initiatives/${INI.id}/milestones$`), () => ({
        status: 200,
        body: {
          items: [
            {
              id: MILESTONE_ID,
              initiativeId: INI.id,
              title: "Synthetic cut-over",
              approvedDate: "2026-11-30",
              forecastDate: "2026-12-15",
              version: 3,
            },
          ],
        },
      })),
    ]),
  );
  renderApp(path, { i18n: createI18n(locale) });
  return api;
}

describe("pure helpers", () => {
  it("compares decimals without float conversion and diffs only the changed KPI version fields", () => {
    expect(normalizeDecimal("10.50")).toBe("10.5");
    expect(normalizeDecimal("007")).toBe("7");
    expect(normalizeDecimal("-0.000")).toBe("0");
    const base = { baselineValue: "10.0", targetValue: "12", targetDate: "2027-06-30", formulaExpression: null };
    const diff = kpiVersionDiff(base as never, { ...base, targetValue: "15.5" } as never);
    expect(diff).toEqual({ targetValue: { from: "12", to: "15.5" } });
  });

  it("builds the body with `from` as recorded, the subject version and no effectiveFrom by default", () => {
    const subject = { id: MILESTONE_ID, label: "m", version: 3, values: { approvedDate: "2026-11-30" } };
    const body = buildChangeRequestBody(
      {
        subjectType: "milestone",
        changeKind: "schedule_rebaseline",
        to_approvedDate: "2027-01-29",
        reason: "Synthetic reason",
      },
      subject,
      null,
    );
    expect(body).toEqual({
      changeKind: "schedule_rebaseline",
      subjectType: "milestone",
      subjectId: MILESTONE_ID,
      subjectVersion: 3,
      proposedChange: { approvedDate: { from: "2026-11-30", to: "2027-01-29" } },
      reason: "Synthetic reason",
    });
    // Unknown current budget: `from` is null (Unknown), never "0".
    const cost = buildChangeRequestBody(
      { subjectType: "budget_line", changeKind: "budget_rebaseline", to_budgetAmount: "120000.50", reason: "r" },
      { id: "b", label: "b", version: 2, values: { budgetAmount: null, currency: "SAR" } },
      null,
    );
    expect((cost as { proposedChange: unknown }).proposedChange).toEqual({
      budgetAmount: { from: null, to: "120000.50" },
      currency: "SAR",
    });
    expect(proposedRowsOf({ budgetAmount: { from: null, to: "1" }, currency: "SAR" })).toEqual({
      rows: [{ field: "budgetAmount", from: null, to: "1" }],
      facts: [["currency", "SAR"]],
    });
  });

  it("every ADR-0036 §10 code has an English text and a different, Arabic text", () => {
    const en = createI18n("en").t;
    const ar = createI18n("ar").t;
    for (const code of Object.keys(CHANGE_CONTROL_REFUSALS)) {
      const e = en(problemKey(code), { defaultValue: "" });
      const a = ar(problemKey(code), { defaultValue: "" });
      expect(e, code).not.toBe("");
      expect(a, code).toMatch(/[؀-ۿ]/);
    }
  });
});

describe.each(["en", "ar"] as const)("change requests (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists a draft as a saved draft and an automatic request by its origin; the policy reads 'no threshold'", async () => {
    render(locale, `/transformations/${TR_ID}/change-requests`, [
      route("GET", new RegExp(`${esc(TR)}/change-requests(\\?|$)`), () =>
        page([
          cr(),
          cr({
            id: id(),
            code: "CR-02",
            origin: "automatic",
            changeKind: "benefit_logic",
            subjectType: "benefit_formula",
            status: "submitted",
            materiality: "material",
          }),
        ]),
      ),
    ]);
    const draft = await waitFor(() => {
      const el = document.querySelector("[data-cr-status='draft']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(draft.textContent).toContain(t("changeRequestsP4.status.draft"));
    expect(document.body.textContent).toContain(t("changeRequestsP4.origin.automatic"));
    expect(document.querySelector("[data-materiality='unknown']")).not.toBeNull();
    const policy = document.querySelector("[data-policy-version]")!;
    expect(policy.getAttribute("data-policy-version")).toBe("0");
    expect(policy.textContent).toContain(t("changeRequestsP4.policy.noThreshold"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it('the first policy save sends If-Match "0"; an out-of-range value shows the translated refusal', async () => {
    const { requests } = render(locale, `/transformations/${TR_ID}/change-requests`, [
      route("PUT", new RegExp(`${esc(TR)}/change-control-policy$`), () =>
        problemBody(422, "urn:mth:problem:validation", "change_control.threshold_invalid", "English detail"),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("changeRequestsP4.policy.edit")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-policy-first-save]")).not.toBeNull();
    fireEvent.change(dialog.querySelector("[data-field='days']")!, { target: { value: "300" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("changeRequestsP4.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.change_control__threshold_invalid"));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toEqual({ materialDateShiftWorkingDays: 300, materialBudgetChangeRatio: null, note: null });
  });

  it("raising a schedule rebaseline: the forecast is shown separately, the preview names the preserved G4 approval", async () => {
    const { requests } = render(locale, `/transformations/${TR_ID}/change-requests`, [
      route("POST", new RegExp(`${esc(TR)}/change-requests/impact-preview$`), () => ({ status: 200, body: PREVIEW })),
      route("POST", new RegExp(`${esc(TR)}/change-requests$`), () => ({ status: 201, body: cr() })),
      route("GET", new RegExp(`${esc(TR)}/change-requests/${CR_ID}$`), () => ({ status: 200, body: cr() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("changeRequestsP4.list.raise")) }));
    const dialog = await screen.findByRole("dialog");
    const select = (name: string) => dialog.querySelector(`[data-field='${name}']`) as HTMLSelectElement;
    fireEvent.change(select("subjectType"), { target: { value: "milestone" } });
    await waitFor(() => expect(within(select("initiativeId")).getAllByRole("option").length).toBe(2));
    fireEvent.change(select("initiativeId"), { target: { value: INI.id } });
    await waitFor(() => expect(within(select("subjectId")).getAllByRole("option").length).toBe(2));
    fireEvent.change(select("subjectId"), { target: { value: MILESTONE_ID } });
    fireEvent.change(select("changeKind"), { target: { value: "schedule_rebaseline" } });
    await waitFor(() => expect(dialog.querySelector("[data-forecast-shown]")).not.toBeNull());
    expect(dialog.querySelector("[data-forecast-shown]")!.textContent).toContain("2026-12-15");
    const dateInput = await waitFor(() => {
      const el = dialog.querySelector("input[type='date']");
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(dateInput, { target: { value: "2027-01-29" } });
    fireEvent.change(dialog.querySelector("[data-field='reason']")!, {
      target: { value: "Synthetic: the vendor moved the cut-over." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(t("changeRequestsP4.preview.run")) }));
    const preview = await waitFor(() => {
      const el = dialog.querySelector("[data-impact-preview='draft']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(preview.querySelector("[data-materiality='material']")).not.toBeNull();
    expect(preview.textContent).toContain(t("changeRequestsP4.materiality.noThreshold"));
    const gate = preview.querySelector("[data-gate-item='G4']")!;
    expect(gate.getAttribute("data-preserved")).toBe("true");
    expect(gate.textContent).toContain(t("changeRequestsP4.impact.gatePreserved", { gate: "G4", no: 1 }));
    expect(preview.querySelector("[data-report-area='T10.portfolio']")!.textContent).toBe(
      t("changeRequestsP4.impact.area.T10_portfolio"),
    );
    if (locale === "ar") expect(preview.textContent).not.toContain("is preserved; this change needs reapproval");
    fireEvent.click(within(dialog).getByRole("button", { name: t("changeRequestsP4.form.create") }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/change-requests"))).toBe(true),
    );
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/change-requests"))!;
    expect(post.body).toEqual({
      changeKind: "schedule_rebaseline",
      subjectType: "milestone",
      subjectId: MILESTONE_ID,
      subjectVersion: 3,
      proposedChange: { approvedDate: { from: "2026-11-30", to: "2027-01-29" } },
      reason: "Synthetic: the vendor moved the cut-over.",
    });
    const previewPost = requests.find((r) => r.url.endsWith("/impact-preview"))!;
    expect(previewPost.body).toEqual(post.body);
  });

  it("a KPI target change (REQ-S07-015): the draft version's diff is the change; the preview lists the benefit and the G2 approval", async () => {
    const KPI_ID = id();
    const ACTIVE_ID = id();
    const DRAFT_ID = id();
    const BENEFIT_ID = id();
    const G2_SUBMISSION = id();
    const G2_DECISION = id();
    const version = (over: Record<string, unknown>) => ({
      kpiDefinitionId: KPI_ID,
      baselineValue: "40",
      baselineDate: "2026-01-31",
      targetValue: "55.0",
      targetDate: "2027-06-30",
      formulaExpression: null,
      calculationMethod: "manual",
      aggregationRule: "latest",
      definitionText: "Synthetic share of digital onboarding",
      dataSource: "Synthetic CRM extract",
      polarity: "higher_is_better",
      ...over,
    });
    const kpiPreview = {
      materiality: "material",
      materialityBasis: { rule: "always_material", kind: "target" },
      hiddenItemCount: 1,
      items: [
        {
          ordinal: 1,
          itemType: "benefit",
          recordType: "benefit",
          recordId: BENEFIT_ID,
          recordCode: "B-01",
          label: "Synthetic onboarding cost avoided",
          effect: "value_changes",
          gateSubmissionId: null,
          gateDecisionId: null,
          detail: {},
        },
        {
          ordinal: 2,
          itemType: "gate",
          recordType: "gate_submission",
          recordId: G2_SUBMISSION,
          recordCode: "G2",
          label: "G2 approval (submission 1) is preserved; this change needs reapproval",
          effect: "reapproval_required",
          gateSubmissionId: G2_SUBMISSION,
          gateDecisionId: G2_DECISION,
          detail: { gateCode: "G2", gateStatus: "approved", submissionNo: 1 },
        },
        {
          ordinal: 3,
          itemType: "report",
          recordType: null,
          recordId: null,
          recordCode: null,
          label: "T10 Outcomes area",
          effect: "informational",
          gateSubmissionId: null,
          gateDecisionId: null,
          detail: { area: "T10.outcomes" },
        },
      ],
    };
    const { requests } = render(locale, `/transformations/${TR_ID}/change-requests`, [
      route("GET", new RegExp(`${esc(TR)}/kpi-dictionary(\\?|$)`), () =>
        page([
          {
            definition: { id: KPI_ID, name: "Synthetic digital onboarding share", version: 4 },
            activeVersion: { id: ACTIVE_ID, versionNo: 1 },
            draftVersionId: DRAFT_ID,
          },
        ]),
      ),
      route("GET", new RegExp(`${esc(TR)}/kpi-definitions/${KPI_ID}/versions(\\?|$)`), () =>
        page([
          version({ id: ACTIVE_ID, versionNo: 1, status: "active" }),
          version({ id: DRAFT_ID, versionNo: 2, status: "draft", targetValue: "60" }),
        ]),
      ),
      route("POST", new RegExp(`${esc(TR)}/change-requests/impact-preview$`), () => ({
        status: 200,
        body: kpiPreview,
      })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("changeRequestsP4.list.raise")) }));
    const dialog = await screen.findByRole("dialog");
    const select = (name: string) => dialog.querySelector(`[data-field='${name}']`) as HTMLSelectElement;
    fireEvent.change(select("subjectType"), { target: { value: "kpi_definition" } });
    await waitFor(() => expect(within(select("subjectId")).getAllByRole("option").length).toBe(2));
    fireEvent.change(select("subjectId"), { target: { value: KPI_ID } });
    fireEvent.change(select("changeKind"), { target: { value: "target" } });
    // The change is the draft version's difference from the active one, decimals compared as decimals ("55.0" = "55").
    const diff = await waitFor(() => {
      const el = dialog.querySelector("[data-kpi-diff='1']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(diff.textContent).toContain("55.0");
    expect(diff.textContent).toContain("60");
    fireEvent.change(dialog.querySelector("[data-field='reason']")!, {
      target: { value: "Synthetic: the market moved; raise the target." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(t("changeRequestsP4.preview.run")) }));
    const preview = await waitFor(() => {
      const el = dialog.querySelector("[data-impact-preview='draft']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(preview.querySelector("[data-impact-type='benefit']")!.textContent).toContain(
      "Synthetic onboarding cost avoided",
    );
    const g2 = preview.querySelector("[data-gate-item='G2']")!;
    expect(g2.getAttribute("data-preserved")).toBe("true");
    expect(g2.textContent).toContain(t("changeRequestsP4.impact.gatePreserved", { gate: "G2", no: 1 }));
    // An item the caller cannot read is counted, never shown as "no impact".
    expect(preview.querySelector("[data-hidden-items='1']")).not.toBeNull();
    const body = requests.find((r) => r.url.endsWith("/impact-preview"))!.body as Record<string, unknown>;
    expect(body).toEqual({
      changeKind: "target",
      subjectType: "kpi_definition",
      subjectId: KPI_ID,
      subjectVersion: 4,
      proposedRecordType: "kpi_version",
      proposedRecordId: DRAFT_ID,
      proposedChange: { targetValue: { from: "55.0", to: "60" } },
      reason: "Synthetic: the market moved; raise the target.",
    });
  });

  it("a returned request offers round 2; a non-requester is told so and the 403 is translated", async () => {
    render(locale, `/transformations/${TR_ID}/change-requests/${CR_ID}`, [
      route("GET", new RegExp(`${esc(TR)}/change-requests/${CR_ID}$`), () => ({
        status: 200,
        body: cr({
          status: "changes_requested",
          approvalId: APPROVAL_ID,
          raisedBy: OTHER_USER,
          materiality: "material",
          materialityBasis: {
            rule: "date_shift",
            shiftWorkingDays: null,
            threshold: 5,
            reason: "calendar_not_configured",
          },
          routePartyCode: "SP",
          version: 4,
        }),
      })),
      route("GET", new RegExp(`/api/v1/approvals/${APPROVAL_ID}$`), () => ({
        status: 200,
        body: {
          id: APPROVAL_ID,
          status: "changes_requested",
          roundNo: 1,
          requestedBy: OTHER_USER,
          assignee: { partyCode: "SP", userId: null, groupId: null },
        },
      })),
      route("POST", new RegExp(`${esc(TR)}/change-requests/${CR_ID}/withdraw$`), () =>
        problemBody(403, "urn:mth:problem:forbidden", "approval.not_requester", "English detail"),
      ),
    ]);
    const resubmit = await waitFor(() => {
      const el = document.querySelector("[data-action='resubmit-change-request']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(resubmit.textContent).toContain(t("changeRequestsP4.detail.resubmitRound", { n: 2 }));
    expect(document.querySelector("[data-requester-only]")!.textContent).toContain(
      t("changeRequestsP4.detail.requesterOnly"),
    );
    expect(document.querySelector("[data-state='returned']")).not.toBeNull();
    // Unknown shift: shown as Unknown and material, never "0 working days".
    expect(document.body.textContent).toContain(t("changeRequestsP4.materiality.reason.calendar_not_configured"));
    expect(document.body.textContent).toContain(
      t("changeRequestsP4.materiality.shift", { days: t("common.value.unknown") }),
    );
    fireEvent.click(document.querySelector("[data-action='withdraw-change-request']")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("changeRequestsP4.detail.withdraw") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.approval__not_requester"));
  });

  it("a submitted request shows its frozen assessment with SHA-256 and the preserved original approval", async () => {
    const IA_ID = id();
    render(locale, `/transformations/${TR_ID}/change-requests/${CR_ID}`, [
      route("GET", new RegExp(`${esc(TR)}/change-requests/${CR_ID}$`), () => ({
        status: 200,
        body: cr({
          status: "submitted",
          approvalId: APPROVAL_ID,
          currentImpactAssessmentId: IA_ID,
          routePartyCode: "SP",
          materiality: "material",
          materialityBasis: PREVIEW.materialityBasis,
        }),
      })),
      route("GET", new RegExp(`/api/v1/approvals/${APPROVAL_ID}$`), () => ({
        status: 200,
        body: {
          id: APPROVAL_ID,
          status: "pending",
          roundNo: 1,
          requestedBy: USER_ID,
          assignee: { partyCode: "SP", userId: OTHER_USER, groupId: null },
        },
      })),
      route("GET", new RegExp(`${esc(TR)}/change-requests/${CR_ID}/impact-assessments`), () =>
        page([
          {
            id: IA_ID,
            transformationId: TR_ID,
            changeRequestId: CR_ID,
            changeRequestVersion: 2,
            itemCount: 3,
            contentSha256: "a".repeat(64),
            assessedAt: T,
            assessedBy: USER_ID,
            items: PREVIEW.items,
          },
        ]),
      ),
    ]);
    const ia = await waitFor(() => {
      const el = document.querySelector("[data-assessment-version='2']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(ia.getAttribute("data-current")).toBe("true");
    expect(ia.querySelector("[data-sha256]")!.textContent).toBe("a".repeat(64));
    expect(ia.querySelector("[data-gate-item='G4'][data-preserved='true']")).not.toBeNull();
    expect(document.querySelector("[data-open-approval]")).not.toBeNull();
    expect(document.querySelector("[data-route-party='SP']")!.textContent).toContain(t("changeRequestsP4.party.SP"));
    // In approval: no edit or submit; withdraw stays (the requester withdraws through the request).
    expect(document.querySelector("[data-action='edit-change-request']")).toBeNull();
    expect(document.querySelector("[data-action='submit-change-request']")).toBeNull();
    expect(document.querySelector("[data-action='withdraw-change-request']")).not.toBeNull();
    // The proposed date row: recorded value and proposed value.
    expect(document.querySelector("[data-proposed-field='approvedDate'] [data-from='2026-11-30']")).not.toBeNull();
  });
});
