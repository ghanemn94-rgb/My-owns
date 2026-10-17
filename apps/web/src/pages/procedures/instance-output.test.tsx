// T-DG5-FE-D4 (D-166; REQ-S06-002, REQ-S06-003, REQ-S18-004): a procedure step's output record chosen in the UI, with
// STUBBED responses, in English (LTR) and Arabic (RTL). One block per output kind:
//  - create (baseline_validation.record_baseline): the eligible baselines of the instance's transformation are read
//    through the baselines' own list operation (only active ones produced since the launch); the native Diagnose
//    screen is linked; completing sends `outputRecordId` with If-Match; with none chosen, the server's 422
//    procedure_step.output_required is shown by its code in en/ar.
//  - link (tom_approval.complete_canvas): only "ready" TOM canvas cells are offered; the choice is sent.
//  - link in an organization-scope instance (new_transformation_intake.draft_charter): the charter is read in the
//    transformation the intake's first step produced.
//  - advance (baseline_validation.validate_baseline): the note-only form; no selector and no `outputRecordId`.
// The live path against the real API is e2e/p5-procedure-outputs.spec.ts. SYNTHETIC data; nothing here is a business
// approval, and nothing touches DG0-DG7.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, makeMe, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { chosenOutputOf, completeBody, eligibleRecords, scopeTransformationOf } from "./outputs.ts";
import type { ProcedureInstance, ProcedureStepInstance } from "./api.ts";
import type { ProcedureDefinition } from "@mth/shared/schemas";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INSTANCE_ID = "01920000-0000-7000-b200-000000000001";
const LAUNCHED = "2026-10-16T08:00:00Z";
const meRoute = (locale: "en" | "ar") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(
      [
        {
          scope: { type: "organization" as const, id: ORG_ID },
          inheritsDownward: true,
          permissions: ["organization.read", "procedure.read", "procedure.act", "transformation.read"] as Permission[],
        },
      ],
      { preferredLocale: locale },
    ),
  }));
const ok = (body: unknown) => () => ({ status: 200, body });
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el as HTMLElement;
  });

type Output = { recordType: string; mode: "create" | "advance" | "link" } | null;

function stepDef(stepKey: string, ordinal: number, output: Output) {
  return {
    stepKey,
    ordinal,
    parallelGroup: null,
    stepKind: "task",
    nameEn: `Synthetic ${stepKey}`,
    nameAr: `خطوة ${stepKey} (اصطناعية)`,
    instructionsEn: null,
    instructionsAr: null,
    responsibleRoleCode: "TL",
    approvalRoleCode: null,
    slaWorkingDays: 5,
    condition: null,
    requiredInputKeys: [],
    evidenceRequired: false,
    output,
    skippable: false,
    removed: false,
  };
}

function definition(code: string, steps: ReturnType<typeof stepDef>[]) {
  return { id: "01920000-0000-7000-b200-000000000002", code, inputSchema: [], steps } as unknown as ProcedureDefinition;
}

function stepInstance(
  stepKey: string,
  ordinal: number,
  status: ProcedureStepInstance["status"],
): ProcedureStepInstance {
  return {
    stepKey,
    ordinal,
    parallelGroup: null,
    stepKind: "task",
    nameEn: `Synthetic ${stepKey}`,
    nameAr: `خطوة ${stepKey} (اصطناعية)`,
    status,
    assigneeRoleCode: "TL",
    assigneeUserId: null,
    dueDate: "2026-10-23",
    dueDateUnknownReason: null,
    overdue: false,
    activatedAt: status === "active" ? LAUNCHED : null,
    completedAt: null,
    completedBy: null,
    skipReason: null,
    approvalId: null,
    missingInputs: [],
  };
}

function instance(
  code: string,
  steps: ProcedureStepInstance[],
  overrides: Partial<ProcedureInstance> = {},
): ProcedureInstance {
  const active = steps.filter((s) => s.status === "active").map((s) => s.stepKey);
  return {
    id: INSTANCE_ID,
    transformationId: TR_ID,
    procedureCode: code,
    procedureDefinitionId: "01920000-0000-7000-b200-000000000002",
    methodologyVersionId: "01920000-0000-7000-b200-000000000003",
    versionNo: 2,
    nameEn: "Synthetic procedure",
    nameAr: "إجراء اصطناعي",
    status: "active",
    subjectRecordType: null,
    subjectRecordId: null,
    inputValues: {},
    dueDate: null,
    currentStepKeys: active,
    missingInputs: [],
    nextAction: {
      kind: "complete_step",
      stepKey: active[0] ?? null,
      messageKey: "procedure.next.complete_step",
      messageParams: {},
    },
    steps,
    links: [],
    launchedBy: USER_ID,
    launchedAt: LAUNCHED,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: 7,
    updatedAt: LAUNCHED,
    ...overrides,
  };
}

const BASELINE_NEW = "01920000-0000-7000-b300-000000000001";
const BASELINE_OLD = "01920000-0000-7000-b300-000000000002";
const BASELINE_ARCHIVED = "01920000-0000-7000-b300-000000000003";
const baseline = (id: string, metric: string, createdAt: string, status: string) => ({
  id,
  organizationId: ORG_ID,
  transformationId: TR_ID,
  metric,
  value: "42.5",
  unit: "%",
  baselineDate: "2026-10-01",
  status,
  validationStatus: "unvalidated",
  createdAt,
});
const BASELINES = [
  baseline(BASELINE_NEW, "Synthetic churn rate", "2026-10-16T09:00:00Z", "active"),
  baseline(BASELINE_OLD, "Synthetic older baseline", "2026-10-15T09:00:00Z", "active"),
  baseline(BASELINE_ARCHIVED, "Synthetic archived baseline", "2026-10-16T10:00:00Z", "archived"),
];
const BASELINE_DEF = definition("baseline_validation", [
  stepDef("record_baseline", 1, { recordType: "baseline", mode: "create" }),
  stepDef("validate_baseline", 2, { recordType: "baseline", mode: "advance" }),
]);

describe("create output (record_baseline): choose the baseline produced natively", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: lists only eligible baselines, links the native screen, sends outputRecordId with If-Match`, async () => {
      const { requests } = mockApi(
        meRoute(locale),
        route(
          "GET",
          /\/procedure-instances\/[^/]+$/,
          ok(
            instance("baseline_validation", [
              stepInstance("record_baseline", 1, "active"),
              stepInstance("validate_baseline", 2, "pending"),
            ]),
          ),
        ),
        route("GET", /\/procedure-definitions\/baseline_validation/, ok(BASELINE_DEF)),
        route("GET", /\/transformations\/[^/]+\/baselines(\?|$)/, ok({ items: BASELINES, nextCursor: null })),
        route("POST", /\/steps\/record_baseline\/complete$/, () => ({ status: 200, body: {} })),
      );
      renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n(locale) });
      const c = catalogues[locale].workflowsP5;
      // The output form replaces the note-only form once the definition is read.
      const form = await found("[data-form='complete-record_baseline'][data-output-mode]");
      expect(form.dataset["outputMode"]).toBe("create");
      const select = (await found("[data-output-select='baseline']:not([disabled])")) as HTMLSelectElement;
      const values = [...select.options].map((o) => o.value).filter(Boolean);
      expect(values).toEqual([BASELINE_NEW]);
      expect(select.textContent).toContain("Synthetic churn rate");
      const native = form.querySelector("[data-output-native='baseline']") as HTMLAnchorElement;
      expect(native.getAttribute("href")).toBe(`/transformations/${TR_ID}/diagnose#baselines`);
      expect(native.textContent).toContain(c.recordType.baseline);
      expect(form.textContent).toContain(c.procedureOutput.title.replace("{{type}}", c.recordType.baseline));
      fireEvent.change(select, { target: { value: BASELINE_NEW } });
      fireEvent.click(screen.getByRole("button", { name: c.procedures.complete }));
      await waitFor(() => expect(requests.some((r) => r.url.endsWith("/record_baseline/complete"))).toBe(true));
      const sent = requests.find((r) => r.url.endsWith("/record_baseline/complete"))!;
      expect(sent.body).toEqual({ outputRecordId: BASELINE_NEW });
      expect(sent.headers["if-match"]).toBe('"7"');
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });

    it(`${locale}: no eligible baseline yet: says so, offers the native screen; the server's 422 output_required is shown by code`, async () => {
      const { requests } = mockApi(
        meRoute(locale),
        route(
          "GET",
          /\/procedure-instances\/[^/]+$/,
          ok(
            instance("baseline_validation", [
              stepInstance("record_baseline", 1, "active"),
              stepInstance("validate_baseline", 2, "pending"),
            ]),
          ),
        ),
        route("GET", /\/procedure-definitions\/baseline_validation/, ok(BASELINE_DEF)),
        route("GET", /\/transformations\/[^/]+\/baselines(\?|$)/, ok({ items: [BASELINES[1]], nextCursor: null })),
        route("POST", /\/steps\/record_baseline\/complete$/, () => problem(422, "procedure_step.output_required")),
      );
      renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n(locale) });
      const c = catalogues[locale].workflowsP5;
      const state = await found("[data-output-state='empty']");
      expect(state.textContent).toContain(c.procedureOutput.none.replace("{{type}}", c.recordType.baseline));
      expect(state.querySelector("[data-output-native='baseline']")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: c.procedures.complete }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(catalogues[locale].problems.procedure_step__output_required);
      expect(requests.find((r) => r.url.endsWith("/complete"))!.body).toEqual({});
    });
  }

  it("a list the user cannot read is shown with its translated reason, never as an empty choice", async () => {
    mockApi(
      meRoute("en"),
      route(
        "GET",
        /\/procedure-instances\/[^/]+$/,
        ok(instance("baseline_validation", [stepInstance("record_baseline", 1, "active")])),
      ),
      route("GET", /\/procedure-definitions\/baseline_validation/, ok(BASELINE_DEF)),
      route("GET", /\/transformations\/[^/]+\/baselines(\?|$)/, () => problem(403, "forbidden")),
    );
    renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n("en") });
    const state = await found("[data-output-state='error']");
    expect(state.textContent).toContain(catalogues.en.workflowsP5.procedureOutput.loadFailed);
    expect(state.textContent).not.toContain(
      catalogues.en.workflowsP5.procedureOutput.none.split("(")[0]!.trim() + " (",
    );
  });
});

describe("link output", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: complete_canvas offers only ready TOM canvas cells and sends the chosen one`, async () => {
      const cell = (id: string, dimensionCode: string, status: string) => ({
        id,
        organizationId: ORG_ID,
        transformationId: TR_ID,
        dimensionCode,
        status,
        createdAt: "2026-09-01T08:00:00Z",
      });
      const READY = "01920000-0000-7000-b400-000000000001";
      const { requests } = mockApi(
        meRoute(locale),
        route(
          "GET",
          /\/procedure-instances\/[^/]+$/,
          ok(instance("tom_approval", [stepInstance("complete_canvas", 1, "active")])),
        ),
        route(
          "GET",
          /\/procedure-definitions\/tom_approval/,
          ok(
            definition("tom_approval", [
              stepDef("complete_canvas", 1, { recordType: "tom_canvas_cell", mode: "link" }),
            ]),
          ),
        ),
        route(
          "GET",
          /\/transformations\/[^/]+\/tom-canvas$/,
          ok({
            cells: [cell(READY, "process", "ready"), cell("01920000-0000-7000-b400-000000000002", "people", "draft")],
          }),
        ),
        route("POST", /\/steps\/complete_canvas\/complete$/, () => ({ status: 200, body: {} })),
      );
      renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n(locale) });
      const c = catalogues[locale].workflowsP5;
      const form = await found("[data-form='complete-complete_canvas'][data-output-mode='link']");
      const select = (await found("[data-output-select='tom_canvas_cell']:not([disabled])")) as HTMLSelectElement;
      expect([...select.options].map((o) => o.value).filter(Boolean)).toEqual([READY]);
      expect(form.querySelector("[data-output-native='tom_canvas_cell']")!.getAttribute("href")).toBe(
        `/transformations/${TR_ID}/design`,
      );
      fireEvent.change(select, { target: { value: READY } });
      fireEvent.change(form.querySelector("textarea")!, { target: { value: "Synthetic note" } });
      fireEvent.click(screen.getByRole("button", { name: c.procedures.complete }));
      await waitFor(() => expect(requests.some((r) => r.url.endsWith("/complete"))).toBe(true));
      expect(requests.find((r) => r.url.endsWith("/complete"))!.body).toEqual({
        note: "Synthetic note",
        outputRecordId: READY,
      });
    });
  }

  it("an organization-scope intake reads the charter in the transformation its first step produced", async () => {
    const CHARTER = "01920000-0000-7000-b500-000000000001";
    const { requests } = mockApi(
      meRoute("en"),
      route(
        "GET",
        /\/procedure-instances\/[^/]+$/,
        ok(
          instance(
            "new_transformation_intake",
            [stepInstance("capture_intake", 1, "completed"), stepInstance("draft_charter", 2, "active")],
            {
              transformationId: null,
              links: [
                {
                  id: "01920000-0000-7000-b600-000000000001",
                  stepKey: "capture_intake",
                  linkKind: "output",
                  recordType: "transformation",
                  recordId: TR_ID,
                  createdAt: LAUNCHED,
                  createdBy: USER_ID,
                },
              ],
            },
          ),
        ),
      ),
      route(
        "GET",
        /\/procedure-definitions\/new_transformation_intake/,
        ok(
          definition("new_transformation_intake", [
            stepDef("capture_intake", 1, { recordType: "transformation", mode: "create" }),
            stepDef("draft_charter", 2, { recordType: "charter", mode: "link" }),
          ]),
        ),
      ),
      route(
        "GET",
        new RegExp(`/transformations/${TR_ID}/charter$`),
        ok({ charter: { id: CHARTER, transformationName: "Synthetic intake", version: 3 } }),
      ),
      route("POST", /\/steps\/draft_charter\/complete$/, () => ({ status: 200, body: {} })),
    );
    renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n("en") });
    const select = (await found("[data-output-select='charter']:not([disabled])")) as HTMLSelectElement;
    expect(select.textContent).toContain("Synthetic intake · v3");
    fireEvent.change(select, { target: { value: CHARTER } });
    fireEvent.click(screen.getByRole("button", { name: catalogues.en.workflowsP5.procedures.complete }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/complete"))).toBe(true));
    expect(requests.find((r) => r.url.endsWith("/complete"))!.body).toEqual({ outputRecordId: CHARTER });
  });
});

describe("advance output (validate_baseline): the note-only form", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: no selector; completing sends no outputRecordId`, async () => {
      const { requests } = mockApi(
        meRoute(locale),
        route(
          "GET",
          /\/procedure-instances\/[^/]+$/,
          ok(
            instance("baseline_validation", [
              stepInstance("record_baseline", 1, "completed"),
              stepInstance("validate_baseline", 2, "active"),
            ]),
          ),
        ),
        route(
          "GET",
          /\/procedure-definitions\/baseline_validation/,
          ok({
            ...BASELINE_DEF,
            inputSchema: [{ key: "metric", fieldType: "text", labelEn: "Metric", labelAr: "المقياس", required: true }],
          }),
        ),
        route("POST", /\/steps\/validate_baseline\/complete$/, () => ({ status: 200, body: {} })),
      );
      renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n(locale) });
      // The inputs form renders only from the read definition: once it shows, the step form is final.
      await found("[data-form='procedure-inputs']");
      const form = await found("[data-form='complete-validate_baseline']");
      expect(form.dataset["outputMode"]).toBeUndefined();
      expect(document.querySelector("[data-output-select]")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: catalogues[locale].workflowsP5.procedures.complete }));
      await waitFor(() => expect(requests.some((r) => r.url.endsWith("/complete"))).toBe(true));
      expect(requests.find((r) => r.url.endsWith("/complete"))!.body).toEqual({});
      expect(requests.some((r) => r.url.includes("/baselines"))).toBe(false);
    });
  }
});

describe("the output table (pure)", () => {
  it("chosenOutputOf: create and link are chosen; advance, approval and no output are not", () => {
    const def = definition("x", [
      stepDef("a", 1, { recordType: "baseline", mode: "create" }),
      stepDef("b", 2, { recordType: "evidence", mode: "link" }),
      stepDef("c", 3, { recordType: "baseline", mode: "advance" }),
      stepDef("d", 4, { recordType: "approval", mode: "create" }),
      stepDef("e", 5, null),
    ]);
    expect(chosenOutputOf(def, "a")).toEqual({ recordType: "baseline", mode: "create" });
    expect(chosenOutputOf(def, "b")).toEqual({ recordType: "evidence", mode: "link" });
    expect(chosenOutputOf(def, "c")).toBeNull();
    expect(chosenOutputOf(def, "d")).toBeNull();
    expect(chosenOutputOf(def, "e")).toBeNull();
    expect(chosenOutputOf(null, "a")).toBeNull();
  });

  it("eligibleRecords (create): produced since the launch, in the created state, not already this instance's output", () => {
    const i = { launchedAt: LAUNCHED, links: [] as ProcedureInstance["links"] };
    expect(eligibleRecords(BASELINES, "baseline", "create", i).map((r) => r["id"])).toEqual([BASELINE_NEW]);
    const taken = {
      launchedAt: LAUNCHED,
      links: [
        {
          id: "l",
          stepKey: "x",
          linkKind: "output",
          recordType: "baseline",
          recordId: BASELINE_NEW,
          createdAt: LAUNCHED,
          createdBy: USER_ID,
        },
      ] as ProcedureInstance["links"],
    };
    expect(eligibleRecords(BASELINES, "baseline", "create", taken)).toEqual([]);
    // A KPI actual is produced when submitted (an unsubmitted draft has no submittedAt).
    const actuals = [
      { id: "1", status: "submitted", submittedAt: "2026-10-16T09:00:00Z" },
      { id: "2", status: "draft", submittedAt: null },
    ];
    expect(eligibleRecords(actuals, "kpi_actual", "create", i).map((r) => r["id"])).toEqual(["1"]);
  });

  it("eligibleRecords (link): the link state rule only; scope and body helpers", () => {
    const ev = [
      { id: "1", status: "active", createdAt: "2020-01-01T00:00:00Z" },
      { id: "2", status: "archived", createdAt: "2026-10-16T09:00:00Z" },
    ];
    expect(eligibleRecords(ev, "evidence", "link", { launchedAt: LAUNCHED, links: [] }).map((r) => r["id"])).toEqual([
      "1",
    ]);
    expect(completeBody("", null)).toEqual({});
    expect(completeBody("n", "r")).toEqual({ note: "n", outputRecordId: "r" });
    expect(scopeTransformationOf(instance("x", [], { transformationId: null }))).toBeNull();
  });
});
