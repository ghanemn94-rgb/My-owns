// Unit tests of the output adapters' pure parts and of the coverage status rule (ADR-0042 §3, §6; T-DG5-BE-G). The
// database-backed behaviour (verify-and-link against real records, the refusals, the approval-step advance) is covered
// by test/integration/procedures/seeded-procedures.test.ts against a real PostgreSQL. Synthetic values only.
import type { ProcedureInstanceLinkRow } from "@mth/db";
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../../platform/index.ts";
import { coverageStatusOf, type CoverageLinkFact } from "../coverage.ts";
import type { ProcedureOutputContext } from "../steps.ts";
import { PROCEDURE_OUTPUT_ADAPTERS } from "./index.ts";
import { earlierOutput, inScope, namedRecord, OUTPUT_MESSAGES } from "./kit.ts";

const ORG = "01920000-0000-7000-8000-0000000000a1";
const T1 = "01920000-0000-7000-8000-0000000000b1";
const T2 = "01920000-0000-7000-8000-0000000000b2";
const STEP_1 = "01920000-0000-7000-8000-0000000000c1";
const STEP_2 = "01920000-0000-7000-8000-0000000000c2";
const REC = "01920000-0000-7000-8000-0000000000d1";

function link(stepId: string, recordType: string, recordId: string, kind = "output"): ProcedureInstanceLinkRow {
  return { step_instance_id: stepId, record_type: recordType, record_id: recordId, link_kind: kind } as never;
}

function ctx(over: {
  transformationId?: string | null;
  stepId?: string;
  outputRecordId?: string | null;
  links?: ProcedureInstanceLinkRow[];
}): ProcedureOutputContext {
  return {
    instance: {
      organization_id: ORG,
      transformation_id: over.transformationId === undefined ? T1 : over.transformationId,
    },
    step: { id: over.stepId ?? STEP_2 },
    outputRecordId: over.outputRecordId ?? null,
    links: over.links ?? [],
  } as never;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return (err.toBody("r") as { code?: string }).code;
    throw err;
  }
  return undefined;
}

describe("the output adapters (ADR-0042 §3)", () => {
  it("cover every output record type of the closed set except `approval` (the engine links the step's own approval)", () => {
    const closed = [
      "transformation",
      "charter",
      "baseline",
      "kpi_actual",
      "tom_canvas_cell",
      "approval",
      "ranking_snapshot",
      "gate_submission",
      "change_request",
      "finance_validation",
      "decision",
      "bau_handover",
      "evidence",
    ];
    expect(PROCEDURE_OUTPUT_ADAPTERS.map((a) => a.recordType).sort()).toEqual(
      closed.filter((t) => t !== "approval").sort(),
    );
  });

  it("the kit's refusals are the exact ADR-0042 §10 texts", () => {
    expect(OUTPUT_MESSAGES).toEqual({
      "procedure_step.output_required": "This step must produce or link its output record.",
      "procedure_step.output_record_invalid": "The linked record is not of the expected type or not in this scope.",
    });
  });

  it("a create or link names its record, else 422 output_required", () => {
    expect(codeOf(() => namedRecord(ctx({})))).toBe("procedure_step.output_required");
    expect(namedRecord(ctx({ outputRecordId: REC }))).toBe(REC);
  });

  it("an advance acts on the record an EARLIER step linked, never on its own or an evidence link", () => {
    expect(codeOf(() => earlierOutput(ctx({}), "baseline"))).toBe("procedure_step.output_required");
    expect(codeOf(() => earlierOutput(ctx({ links: [link(STEP_2, "baseline", REC)] }), "baseline"))).toBe(
      "procedure_step.output_required",
    );
    expect(codeOf(() => earlierOutput(ctx({ links: [link(STEP_1, "baseline", REC, "evidence")] }), "baseline"))).toBe(
      "procedure_step.output_required",
    );
    expect(earlierOutput(ctx({ links: [link(STEP_1, "baseline", REC)] }), "baseline")).toBe(REC);
  });

  it("scope: same organization and transformation; an organization-scope instance takes its own transformation", () => {
    const row = { organizationId: ORG, transformationId: T1, createdBy: "u", createdAt: new Date() };
    expect(inScope(ctx({}), row)).toBe(row);
    expect(codeOf(() => inScope(ctx({}), undefined))).toBe("procedure_step.output_record_invalid");
    expect(codeOf(() => inScope(ctx({}), { ...row, transformationId: T2 }))).toBe(
      "procedure_step.output_record_invalid",
    );
    expect(codeOf(() => inScope(ctx({}), { ...row, organizationId: T2 }))).toBe("procedure_step.output_record_invalid");
    // Organization scope: before the intake created its transformation any in the organization; afterwards only it.
    expect(inScope(ctx({ transformationId: null }), { ...row, transformationId: T2 })).toBeTruthy();
    const org = ctx({ transformationId: null, links: [link(STEP_1, "transformation", T1)] });
    expect(inScope(org, row)).toBe(row);
    expect(codeOf(() => inScope(org, { ...row, transformationId: T2 }))).toBe("procedure_step.output_record_invalid");
  });
});

describe("the coverage status (ADR-0042 §6, §11)", () => {
  const form = (resolved: boolean, featureStatus: "working" | "planned"): CoverageLinkFact => ({
    targetKind: "form",
    targetCode: "T03",
    resolved,
    featureStatus,
  });
  const procedure = (resolved: boolean): CoverageLinkFact => ({
    targetKind: "procedure",
    targetCode: "tom_approval",
    resolved,
    featureStatus: "working",
  });

  it("covered when a link resolves to a working target", () => {
    expect(coverageStatusOf([form(true, "working")])).toBe("covered");
    expect(coverageStatusOf([procedure(true)])).toBe("covered");
    expect(coverageStatusOf([form(true, "planned"), procedure(true)])).toBe("covered");
  });

  it("planned (never covered) when only planned targets are linked", () => {
    expect(coverageStatusOf([form(true, "planned")])).toBe("planned");
    expect(coverageStatusOf([form(true, "planned"), procedure(false)])).toBe("planned");
  });

  it("not covered without a resolvable link (a removed procedure, or no link at all)", () => {
    expect(coverageStatusOf([])).toBe("not_covered");
    expect(coverageStatusOf([procedure(false)])).toBe("not_covered");
    expect(coverageStatusOf([form(false, "working")])).toBe("not_covered");
  });
});
