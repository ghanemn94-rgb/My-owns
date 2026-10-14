// Unit tests of the procedure-definition builder rules (ADR-0042 §1-§2, §10, §11; REQ-S06-001; T-DG5-BE-F): every
// finding is reported with its exact §10 code and English text, and step conditions compare decimals with decimal.js
// (never floats; a missing input is never defaulted). Pure: no database. All data is synthetic.
import {
  conditionShapeValid,
  evaluateStepCondition,
  procedureDefinitionInput,
  procedureDefinitionMessage,
  type ProcedureDefinitionCode,
} from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { inputFieldAttributes, validateDefinitionBody } from "./definitions.ts";

const step = (over: Record<string, unknown> = {}) => ({
  stepKey: "first",
  ordinal: 1,
  stepKind: "task",
  nameEn: "First",
  nameAr: "الأول",
  responsibleRoleCode: "TL",
  slaWorkingDays: 2,
  ...over,
});
const body = (over: Record<string, unknown> = {}) =>
  procedureDefinitionInput.parse({
    nameEn: "Synthetic",
    nameAr: "تجريبي",
    purposeEn: "Purpose",
    purposeAr: "الغرض",
    trigger: { kind: "manual", descriptionEn: "Manual", descriptionAr: "يدوي" },
    scope: { level: "transformation", descriptionEn: "One", descriptionAr: "واحد" },
    inputSchema: [
      { key: "amount", fieldType: "number", labelEn: "Amount", labelAr: "المبلغ", required: true },
      { key: "flag", fieldType: "choice", labelEn: "Flag", labelAr: "علم", required: false, options: ["yes", "no"] },
    ],
    launchRoleCodes: ["TL"],
    responsibleRoleCodes: ["TL"],
    slaWorkingDays: 5,
    validationRulesEn: "Rules",
    validationRulesAr: "قواعد",
    approval: { mode: "none", roleCodes: [] },
    expectedOutputsEn: "Outputs",
    expectedOutputsAr: "مخرجات",
    completion: { rule: "all_steps_closed", descriptionEn: "Done", descriptionAr: "تم" },
    effectiveFrom: "2026-10-14",
    steps: [step()],
    ...over,
  });
const codes = (b: ReturnType<typeof body>) => validateDefinitionBody(b).map((f) => f.code);

describe("validateDefinitionBody (ADR-0042 §1-§2)", () => {
  it("a complete definition with a conditional and a parallel step has no finding", () => {
    expect(
      codes(
        body({
          steps: [
            step(),
            step({ stepKey: "aa", ordinal: 2, parallelGroup: "g" }),
            step({
              stepKey: "bb",
              ordinal: 2,
              parallelGroup: "g",
              condition: { inputKey: "amount", operator: "gt", value: "10.5" },
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("reports every finding with its exact English text", () => {
    const { trigger: _t, completion: _c, ...rest } = body();
    const findings = validateDefinitionBody({ ...rest, steps: [], launchRoleCodes: ["AUD"] });
    expect(findings.map((f) => [f.code, f.pointer])).toEqual([
      ["procedure_definition.trigger_required", "/trigger"],
      ["procedure_definition.completion_required", "/completion"],
      ["procedure_definition.steps_required", "/steps"],
      ["procedure_definition.role_not_allowed", "/launchRoleCodes/0"],
    ]);
    for (const f of findings) expect(f.message).toBe(procedureDefinitionMessage(f.code as ProcedureDefinitionCode));
    expect(procedureDefinitionMessage("procedure_definition.trigger_required")).toBe("A procedure needs a trigger.");
  });

  it("refuses administrator roles anywhere, an incomplete approval path, approval steps without approver or skippable", () => {
    expect(codes(body({ escalation: { roleCode: "ADM_TECH", afterWorkingDays: 2 } }))).toEqual([
      "procedure_definition.role_not_allowed",
    ]);
    expect(codes(body({ approval: { mode: "any", roleCodes: [] } }))).toEqual([
      "procedure_definition.approval_step_invalid",
    ]);
    expect(codes(body({ steps: [step({ stepKind: "approval" })] }))).toEqual([
      "procedure_definition.approval_step_invalid",
    ]);
    expect(codes(body({ steps: [step({ stepKind: "approval", approvalRoleCode: "SP", skippable: true })] }))).toEqual([
      "procedure_definition.approval_step_invalid",
    ]);
    expect(codes(body({ steps: [step({ approvalRoleCode: "SP" })] }))).toEqual([
      "procedure_definition.approval_step_invalid",
    ]);
    expect(codes(body({ steps: [step({ stepKind: "approval", approvalRoleCode: "ADM_ACCESS" })] }))).toEqual([
      "procedure_definition.role_not_allowed",
    ]);
  });

  it("parallel steps share one ordinal and one group; conditions use a declared input and a valid operator", () => {
    expect(codes(body({ steps: [step(), step({ stepKey: "bb" })] }))).toEqual([
      "procedure_definition.parallel_group_invalid",
      "procedure_definition.parallel_group_invalid",
    ]);
    expect(
      codes(body({ steps: [step({ parallelGroup: "g" }), step({ stepKey: "bb", ordinal: 2, parallelGroup: "g" })] })),
    ).toEqual(["procedure_definition.parallel_group_invalid"]);
    expect(codes(body({ steps: [step({ condition: { inputKey: "nope", operator: "present" } })] }))).toEqual([
      "procedure_definition.condition_invalid",
    ]);
    // A float or a non-numeric input is never compared as a number.
    expect(codes(body({ steps: [step({ condition: { inputKey: "amount", operator: "gt", value: 10 } })] }))).toEqual([
      "procedure_definition.condition_invalid",
    ]);
    expect(codes(body({ steps: [step({ condition: { inputKey: "flag", operator: "lt", value: "1" } })] }))).toEqual([
      "procedure_definition.condition_invalid",
    ]);
    expect(codes(body({ steps: [step({ requiredInputKeys: ["missing"] })] }))).toEqual([
      "procedure_definition.input_unknown",
    ]);
  });

  it("validates each input with the ADR-0041 §3 field-type schemas", () => {
    expect(
      codes(body({ inputSchema: [{ key: "c", fieldType: "choice", labelEn: "C", labelAr: "ج", required: true }] })),
    ).toEqual(["procedure_definition.input_schema_invalid"]);
    expect(
      codes(
        body({
          inputSchema: [{ key: "t", fieldType: "text", labelEn: "T", labelAr: "ت", required: true, options: ["x"] }],
        }),
      ),
    ).toEqual(["procedure_definition.input_schema_invalid"]);
    expect(
      inputFieldAttributes({
        key: "f",
        fieldType: "choice",
        labelEn: "F",
        labelAr: "ف",
        required: false,
        options: ["yes"],
        settings: { multiple: false },
      }),
    ).toEqual({ multiple: false, options: [{ value: "yes", labelEn: "yes", labelAr: "yes" }] });
  });
});

describe("evaluateStepCondition (ADR-0042 §2, §11)", () => {
  it("compares decimal strings exactly (no float rounding)", () => {
    const c = { inputKey: "x", operator: "gt" as const, value: "0.3" };
    expect(evaluateStepCondition(c, { x: "0.30000000000000000001" })).toBe(true);
    expect(evaluateStepCondition(c, { x: "0.3" })).toBe(false);
    expect(evaluateStepCondition({ ...c, operator: "gte" }, { x: "0.3" })).toBe(true);
    expect(evaluateStepCondition({ ...c, operator: "lte", value: "1000000" }, { x: { amount: "999999.99" } })).toBe(
      true,
    );
  });

  it("a missing input is never defaulted: only `absent` holds", () => {
    for (const operator of ["eq", "neq", "in", "gt", "gte", "lt", "lte", "present"] as const)
      expect(evaluateStepCondition({ inputKey: "x", operator, value: operator === "in" ? ["0"] : "0" }, {})).toBe(
        false,
      );
    expect(evaluateStepCondition({ inputKey: "x", operator: "absent" }, {})).toBe(true);
    expect(evaluateStepCondition({ inputKey: "x", operator: "absent" }, { x: null })).toBe(true);
  });

  it("eq, neq and in on choice values", () => {
    expect(evaluateStepCondition({ inputKey: "f", operator: "eq", value: "yes" }, { f: "yes" })).toBe(true);
    expect(evaluateStepCondition({ inputKey: "f", operator: "neq", value: "yes" }, { f: "no" })).toBe(true);
    expect(evaluateStepCondition({ inputKey: "f", operator: "in", value: ["a", "b"] }, { f: "b" })).toBe(true);
    expect(conditionShapeValid({ inputKey: "f", operator: "in", value: [] }, "choice")).toBe(false);
    expect(conditionShapeValid({ inputKey: "f", operator: "present", value: "x" }, "choice")).toBe(false);
  });
});
