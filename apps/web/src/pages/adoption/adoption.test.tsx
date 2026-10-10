// Slice F screens (T-DG4-FE-E; p4-work-split §F+G FG.8) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only.
//  - REQ-PB-070: the seven T13 columns; the closed value lists; a server 400 stance refusal lands on its field.
//  - REQ-S11-001: influence shown separately from impact; an intervention needs an owner and a due date.
//  - REQ-PB-069: a below-trajectory intervention shows "Unassigned" and Unknown due date with its reason.
//  - REQ-PB-071: all seven indicators by name; Arabic marked provisional.
//  - REQ-PB-072: 100 % training completion with no observation shows proficiency Unknown, never 0 / adopted.
//  - REQ-PB-073: a champion's constraint is listed on the T04 decision page through ?decisionId=.
//  - REQ-S11-002: a proficiency observation submitted via the form names its stakeholder group.
//  - S-6/S-11: every ADR-0033 §10 code is translated in both languages. S-7: AUD read-only; no DG0-DG7 label.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentFormVersion, assessmentRecord } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { decision } from "../../test/p2fixtures.ts";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  DECISION_ID,
  FORM_ID,
  GROUP_ID,
  SEVEN_INDICATORS,
  constraint,
  form,
  group,
  groupReport,
  intervention,
  plan,
  templates,
} from "./adoptionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** ADR-0033 §10 codes and A3's `validation.conflict` (S-11). */
export const SLICE_F_CODES = [
  "stakeholder_group.stance_invalid",
  "stakeholder_group.impact_invalid",
  "stakeholder_group.intervention_invalid",
  "stakeholder_group.name_taken",
  "stakeholder_group.archived",
  "stakeholder_group.kpi_invalid",
  "stakeholder_champion.exists",
  "adoption_intervention.status_transition",
  "adoption_intervention.final",
  "adoption_intervention.outcome_required",
  "adoption_intervention.owner_required",
  "adoption_metric_link.kpi_required",
  "adoption_metric_link.kpi_not_applicable",
  "adoption_metric_link.kpi_mismatch",
  "adoption_metric_link.exists",
  "assessment_form.schema_invalid",
  "assessment_form.retired",
  "assessment_form.not_published",
  "assessment_form.status_transition",
  "assessment_invitation.exists",
  "assessment_invitation.final",
  "assessment_record.answer_invalid",
  "assessment_record.answer_required",
  "assessment_record.subject_required",
  "assessment_record.not_invited",
  "assessment_record.not_withdrawable_by_caller",
  "assessment_record.status_transition",
  "assessment_record.withdrawn",
  "training_record.final",
  "training_record.intervention_not_training",
  "stakeholder_involvement.target_invalid",
  "stakeholder_involvement.already_withdrawn",
  "champion_constraint.not_champion",
  "champion_constraint.decision_invalid",
  "champion_constraint.final",
  "champion_constraint.not_resolvable_by_caller",
  "validation.conflict",
  "validation.not_applicable",
];

const NO_DG = /\bDG[0-7]\b/;

describe.each(["en", "ar"] as const)("adoption screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0033 §10 code (and A3's) in both languages", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(SLICE_F_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of SLICE_F_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("T13: the seven columns, influence separate from impact, closed lists, provisional Arabic flag", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["adoption.edit"],
        [
          route("GET", new RegExp(`${esc(TRP)}/adoption-plan$`), () => json(plan())),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    const table = (await screen.findByRole("table", { name: t("adoptionP4.plan.tableTitle") })) as HTMLTableElement;
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const col of [
      "stakeholder",
      "impact",
      "currentStance",
      "requiredBehavior",
      "intervention",
      "owner",
      "adoptionKpi",
      "influence",
    ])
      expect(
        headers.some((h) => h.includes(t(`adoptionP4.col.${col}`))),
        col,
      ).toBe(true);
    const row = (await within(table).findByText("Synthetic store supervisors")).closest("tr")!;
    expect(row.querySelector("[data-stance='resist']")!.textContent).toContain(t("adoptionP4.stance.resist"));
    expect(row.querySelector("[data-level='H']")!.textContent).toBe(t("adoptionP4.level.H"));
    expect(row.querySelector("[data-level='L']")!.textContent).toBe(t("adoptionP4.level.L"));
    expect(row.querySelector("[data-interventions='comms,training']")).toBeTruthy();
    // Provisional Arabic flag only in Arabic.
    expect(document.querySelectorAll("[data-ar-provisional]").length > 0).toBe(locale === "ar");
    // The create form offers only the closed lists.
    fireEvent.click(screen.getByRole("button", { name: t("adoptionP4.groups.create") }));
    const dialog = await screen.findByRole("dialog");
    const stance = dialog.querySelector("[data-field='currentStance']") as HTMLSelectElement;
    expect([...stance.options].map((o) => o.value).filter(Boolean)).toEqual(["support", "neutral", "resist"]);
    const impact = dialog.querySelector("[data-field='impact']") as HTMLSelectElement;
    expect([...impact.options].map((o) => o.value).filter(Boolean)).toEqual(["H", "M", "L"]);
    expect(document.body.textContent).not.toMatch(NO_DG);
  });

  it("a server 400 stakeholder_group.stance_invalid lands on the stance field, translated", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["adoption.edit"],
        [
          route("GET", new RegExp(`${esc(TRP)}/adoption-plan$`), () => json(plan())),
          route("POST", new RegExp(`${esc(TRP)}/stakeholder-groups$`), () =>
            problem(400, "validation", {
              errors: [{ pointer: "/currentStance", code: "stakeholder_group.stance_invalid", message: "x" }],
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("adoptionP4.groups.create") }));
    const dialog = await screen.findByRole("dialog");
    const set = (name: string, value: string) =>
      fireEvent.change(dialog.querySelector(`[data-field='${name}']`)!, { target: { value } });
    set("name", "Synthetic agents");
    set("impact", "M");
    set("currentStance", "neutral");
    set("requiredBehavior", "Synthetic behaviour");
    fireEvent.click(within(dialog).getByLabelText(new RegExp(t("adoptionP4.intervention.comms"))));
    fireEvent.click(within(dialog).getByRole("button", { name: t("adoptionP4.groups.createSubmit") }));
    await waitFor(() =>
      expect(dialog.querySelector("[data-field='currentStance']")!.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(dialog.textContent).toContain(t("problems.stakeholder_group__stance_invalid"));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ currentStance: "neutral", impact: "M", interventionTypes: ["comms"] });
  });

  it("interventions: below-trajectory row shows Unassigned and Unknown due date with its reason", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["adoption.edit"],
        [
          route("GET", new RegExp(`${esc(TRP)}/adoption-interventions\\?`), () => page([intervention()])),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption-interventions`, { i18n: createI18n(locale) });
    const row = (await screen.findByText("Synthetic queue usage KPI")).closest("tr")!;
    expect(row.querySelector("[data-owner='unassigned']")!.textContent).toContain(
      t("adoptionP4.interventions.unassigned"),
    );
    expect(row.querySelector("[data-due='unknown']")!.textContent).toContain(t("common.value.unknown"));
    expect(row.querySelector("[data-due='unknown']")!.textContent).toContain(
      t("myWork.ui.unknownReason.calendar_not_configured"),
    );
    expect(row.querySelector("[data-origin='below_trajectory']")).toBeTruthy();
  });

  it("indicators: all seven by name; a measure without data is Unknown, never 0", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["adoption.edit"],
        [
          route("GET", /\/adoption-indicator-templates$/, () => json({ items: templates() })),
          route("GET", new RegExp(`${esc(TRP)}/adoption-indicators\\?`), () =>
            json({ ...groupReport(), targetKind: "transformation", targetId: TR_ID }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption-indicators`, { i18n: createI18n(locale) });
    const table = await screen.findByRole("table", { name: t("adoptionP4.indicators.templatesTitle") });
    for (const name of SEVEN_INDICATORS) expect(table.textContent, name).toContain(name);
    const prof = await waitFor(() => {
      const el = document.querySelector("#adoption-values [data-measure-row='observed_proficiency']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(prof.querySelector("[data-value-status='unknown']")).toBeTruthy();
    expect(prof.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    expect(prof.textContent).toContain(t("adoptionP4.reason.adoption_no_proficiency_observations"));
  });

  it("training vs proficiency: 100 % completion beside proficiency Unknown (not adopted)", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["proficiency.record"],
        [
          route("GET", /\/adoption-indicator-templates$/, () => json({ items: templates() })),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
          route("GET", new RegExp(`${esc(TRP)}/adoption-indicators\\?`), (req) =>
            req.url.includes(`targetId=${GROUP_ID}`) ? json(groupReport()) : undefined,
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption-training`, { i18n: createI18n(locale) });
    const completion = await waitFor(() => {
      const el = document.querySelector("[data-measure-card='training_completion']");
      expect(el?.querySelector("[data-value-status='ok']")).toBeTruthy();
      return el!;
    });
    expect(completion.textContent).toMatch(/100/);
    const proficiency = document.querySelector("[data-measure-card='observed_proficiency']")!;
    expect(proficiency.querySelector("[data-value-status='unknown']")!.textContent).toContain(
      t("common.value.unknown"),
    );
    expect(proficiency.textContent).not.toMatch(/100|(^|\D)0(\D|$)/);
    expect(proficiency.querySelector("[data-rag='green']")).toBeNull();
  });

  it("T04 decision page lists a champion's constraint through ?decisionId=", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["decision.edit"],
        [
          route("GET", /\/api\/v1\/decisions\?/, () =>
            page([decision({ id: DECISION_ID, code: "D-0001", title: "Synthetic queue design" })]),
          ),
          route("GET", new RegExp(`${esc(TRP)}/champion-constraints\\?`), () => page([constraint()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/decisions`, { i18n: createI18n(locale) });
    const section = await screen.findByRole("region", { name: t("adoptionP4.constraints.title") });
    await waitFor(() =>
      expect(section.querySelector("#constraint-decision option[value]:not([value=''])")).toBeTruthy(),
    );
    fireEvent.change(section.querySelector("#constraint-decision")!, { target: { value: DECISION_ID } });
    await waitFor(() =>
      expect(
        requests.some((r) => r.url.includes("/champion-constraints?") && r.url.includes(`decisionId=${DECISION_ID}`)),
      ).toBe(true),
    );
    expect(await within(section).findByText(/offline mode/)).toBeTruthy();
  });

  it("form: a proficiency observation is submitted with its stakeholder group; the API derives the result", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["proficiency.record", "assessment.respond"],
        [
          route("GET", new RegExp(`${esc(TRP)}/assessment-forms/${FORM_ID}$`), () => json(form())),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
          route("POST", new RegExp(`${esc(TRP)}/assessment-records$`), () => ({ status: 201, body: {} })),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/assessment-forms/${FORM_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("adoptionP4.forms.respond")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(t("adoptionP4.forms.subjectLabel")), {
      target: { value: "Synthetic agent 7" },
    });
    fireEvent.change(dialog.querySelector("[data-answer='uses_queue']")!, { target: { value: "yes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adoptionP4.forms.submitResponse") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const body = requests.find((r) => r.method === "POST")!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      formId: FORM_ID,
      stakeholderGroupId: GROUP_ID,
      subjectLabel: "Synthetic agent 7",
      answers: { uses_queue: true },
    });
    expect(body).not.toHaveProperty("proficiencyResult");
  });

  it("record page: answers are labelled from the version answered (getAssessmentFormVersion), a key the version lacks shows 'Unknown question'", async () => {
    const RECORD_ID = "01920000-0000-7000-b000-0000000000a1";
    // The form moved on to version 2 (relabelled); the record was answered on version 1.
    const v2 = form({
      currentVersion: {
        ...form().currentVersion,
        versionNo: 2,
        schema: {
          questions: [
            { ...form().currentVersion.schema.questions[0]!, label_en: "Relabelled v2", label_ar: "تسمية ٢" },
          ],
        },
      },
    });
    const record = {
      id: RECORD_ID,
      transformationId: TR_ID,
      formId: FORM_ID,
      formVersionNo: 1,
      invitationId: null,
      stakeholderGroupId: GROUP_ID,
      kind: "proficiency_observation",
      respondentUserId: form().createdBy,
      subjectUserId: null,
      subjectLabel: "Synthetic agent 7",
      observedOn: "2026-10-01",
      answers: { uses_queue: true, dropped_key: "Synthetic text" },
      proficiencyResult: "proficient",
      status: "submitted",
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      version: 1,
      createdAt: form().createdAt,
      createdBy: null,
      updatedAt: form().createdAt,
      updatedBy: null,
    };
    expect(assessmentRecord.safeParse(record).success).toBe(true);
    expect(assessmentFormVersion.safeParse(form().currentVersion).success).toBe(true);
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/assessment-records/${RECORD_ID}$`), () => json(record)),
          route("GET", new RegExp(`${esc(TRP)}/assessment-forms/${FORM_ID}$`), () => json(v2)),
          route("GET", new RegExp(`${esc(TRP)}/assessment-forms/${FORM_ID}/versions/1$`), () =>
            json(form().currentVersion),
          ),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/assessment-records/${RECORD_ID}`, { i18n: createI18n(locale) });
    const answers = await waitFor(() => {
      const el = document.querySelector("[data-answers][data-answers-version='1']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(answers.querySelector("[data-question='uses_queue']")!.textContent).toBe(
      locale === "en" ? "Uses the queue screen unaided" : "يستخدم شاشة الطابور دون مساعدة",
    );
    expect(answers.textContent).not.toContain(locale === "en" ? "Relabelled v2" : "تسمية ٢");
    const dropped = answers.querySelector("[data-question='dropped_key']")!;
    expect(dropped.textContent).toContain("dropped_key");
    expect(dropped.querySelector("[data-unknown-question='dropped_key']")!.textContent).toContain(
      t("adoptionP4.records.unknownQuestion"),
    );
    expect(answers.querySelector("[data-answer-value='dropped_key']")!.textContent).toBe("Synthetic text");
    expect(requests.some((r) => r.url.endsWith(`/assessment-forms/${FORM_ID}/versions/1`))).toBe(true);
  });

  it("record page: a version that cannot be read says so; every answer keeps its key and 'Unknown question', never a blank", async () => {
    const RECORD_ID = "01920000-0000-7000-b000-0000000000a2";
    const record = {
      id: RECORD_ID,
      transformationId: TR_ID,
      formId: FORM_ID,
      formVersionNo: 7,
      invitationId: null,
      stakeholderGroupId: GROUP_ID,
      kind: "feedback",
      respondentUserId: form().createdBy,
      subjectUserId: null,
      subjectLabel: null,
      observedOn: "2026-10-01",
      answers: { uses_queue: true },
      proficiencyResult: null,
      status: "submitted",
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawReason: null,
      version: 1,
      createdAt: form().createdAt,
      createdBy: null,
      updatedAt: form().createdAt,
      updatedBy: null,
    };
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/assessment-records/${RECORD_ID}$`), () => json(record)),
          route("GET", new RegExp(`${esc(TRP)}/assessment-forms/${FORM_ID}$`), () => json(form())),
          route("GET", new RegExp(`${esc(TRP)}/assessment-forms/${FORM_ID}/versions/7$`), () =>
            problem(404, "not_found"),
          ),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/assessment-records/${RECORD_ID}`, { i18n: createI18n(locale) });
    const note = await waitFor(() => {
      const el = document.querySelector("[data-state='form-version-error']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(note.textContent).toContain(t("adoptionP4.records.versionUnreadable", { n: 7 }));
    const q = document.querySelector("[data-question='uses_queue']")!;
    expect(q.textContent).toContain("uses_queue");
    expect(q.textContent).toContain(t("adoptionP4.records.unknownQuestion"));
    // the current version (1) is never used to label an answer of version 7
    expect(q.textContent).not.toContain(locale === "en" ? "Uses the queue screen unaided" : "يستخدم شاشة الطابور");
  });

  it("AUD sees the plan read-only (no write control)", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/adoption-plan$`), () => json(plan())),
          route("GET", new RegExp(`${esc(TRP)}/stakeholder-groups\\?`), () => page([group()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/adoption`, { i18n: createI18n(locale) });
    await screen.findByRole("table", { name: t("adoptionP4.plan.tableTitle") });
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("adoptionP4.groups.create") })).toBeNull();
    expect(document.querySelector("[data-edit]")).toBeNull();
  });
});
