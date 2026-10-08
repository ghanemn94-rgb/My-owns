// Unit tests of the P3 database-error mapping (T-DG3-BE-A; p3-work-split §2 BE-A). Pure: no database. The errors are
// shaped exactly as node-postgres reports the P3 guards of migrations 0020-0024 (code, constraint, message, detail).
import { describe, expect, it } from "vitest";
import { cycleOfDatabaseError, DependencyCycleProblem, mapDatabaseGuardError } from "./db-errors.ts";

const ID1 = "01920000-0000-7000-8000-0000000000a1";
const ID2 = "01920000-0000-7000-8000-0000000000a2";
const ID3 = "01920000-0000-7000-8000-0000000000a3";

describe("P3 database guard mapping", { timeout: 5_000 }, () => {
  it("*_version_step of every P3 table -> 409 version-conflict", () => {
    for (const table of ["initiative", "gate_dispensation", "scoring_weight_set", "deliverable", "business_case"]) {
      const p = mapDatabaseGuardError({ code: "23514", constraint: `${table}_version_step` })!;
      expect([p.status, p.type, p.code]).toEqual([409, "urn:mth:problem:version-conflict", "version_conflict"]);
    }
  });

  it("initiative_status_transition -> 422 invalid-transition", () => {
    const p = mapDatabaseGuardError({
      code: "23514",
      constraint: "initiative_status_transition",
      message: "initiative x: draft -> launched is not a legal transition (ADR-0021)",
    })!;
    expect([p.status, p.type, p.code]).toEqual([422, "urn:mth:problem:invalid-transition", "invalid_transition"]);
    // The database message (internal ids) is never echoed.
    expect(p.detail).not.toContain("initiative x");
  });

  it("dependency_acyclic -> 422 dependency.cycle naming the cycle from the database message, with the cycle member", () => {
    const p = mapDatabaseGuardError({
      code: "23514",
      constraint: "dependency_acyclic",
      table: "dependency",
      message: "dependency cycle: INI-01 -> INI-02 -> INI-03 -> INI-01",
      detail: `${ID1},${ID2},${ID3},${ID1}`,
    })!;
    expect(p).toBeInstanceOf(DependencyCycleProblem);
    expect([p.status, p.type, p.code]).toEqual([422, "urn:mth:problem:validation", "dependency.cycle"]);
    expect(p.detail).toBe("Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01");
    expect(p.errors).toEqual([
      {
        pointer: "/toInitiativeId",
        code: "dependency.cycle",
        message: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01",
      },
    ]);
    const body = p.toBody("req-1") as unknown as { cycle: unknown; requestId: string };
    expect(body.requestId).toBe("req-1");
    expect(body.cycle).toEqual([
      { initiativeId: ID1, code: "INI-01" },
      { initiativeId: ID2, code: "INI-02" },
      { initiativeId: ID3, code: "INI-03" },
      { initiativeId: ID1, code: "INI-01" },
    ]);
    // A -> B -> A is reported the same way.
    expect(
      cycleOfDatabaseError({ message: "dependency cycle: INI-01 -> INI-02 -> INI-01", detail: `${ID1},${ID2},${ID1}` }),
    ).toEqual([
      { initiativeId: ID1, code: "INI-01" },
      { initiativeId: ID2, code: "INI-02" },
      { initiativeId: ID1, code: "INI-01" },
    ]);
  });

  it("scoring_weight_set_total -> 422 prioritization.weights_total with the total from the database message", () => {
    const p = mapDatabaseGuardError({
      code: "23514",
      constraint: "scoring_weight_set_total",
      message: `scoring_weight_set ${ID1}: weights must total 100% over 2-6 criteria (got 95.00 over 5)`,
    })!;
    expect([p.status, p.code, p.detail]).toEqual([
      422,
      "prioritization.weights_total",
      "Weights must total 100% (got 95.00%)",
    ]);
    expect(p.errors?.[0]?.pointer).toBe("/weights");
    const unknownTotal = mapDatabaseGuardError({ code: "23514", constraint: "scoring_weight_set_total" })!;
    expect([unknownTotal.status, unknownTotal.detail]).toEqual([422, "Weights must total 100%"]);
  });

  it("the separation-of-duties guards -> 403 with stable codes", () => {
    const cases: [string, string][] = [
      ["business_case_validator_not_author", "finance.validator_is_author"],
      ["benefit_formula_version_validator_not_author", "finance.validator_is_author"],
      ["scoring_weight_set_approver_not_proposer", "approval.approver_is_proposer"],
      ["ranking_override_approver_not_proposer", "approval.approver_is_proposer"],
      ["gate_dispensation_decider_not_recorder", "dispensation.decider_is_recorder"],
      ["deliverable_acceptor_not_submitter", "deliverable.acceptor_is_submitter"],
    ];
    for (const [constraint, code] of cases) {
      const p = mapDatabaseGuardError({ code: "23514", constraint })!;
      expect([p.status, p.type, p.code], constraint).toEqual([403, "urn:mth:problem:forbidden", code]);
    }
  });

  it("named P3 CHECKs -> 422 validation.constraint with the field pointer; NOT NULL -> 422 with the column pointer", () => {
    const cases: [string, string][] = [
      ["initiative_planned_range", "/plannedEnd"],
      ["gate_dispensation_waiver_shape", "/reason"],
      ["gate_dispensation_inherited_shape", "/evidenceId"],
      ["dependency_not_self", "/toInitiativeId"],
      ["initiative_contribution_kpi_matches_outcome", "/outcomeKpiId"],
    ];
    for (const [constraint, pointer] of cases) {
      const p = mapDatabaseGuardError({ code: "23514", constraint, table: "initiative" })!;
      expect([p.status, p.code, p.errors?.[0]?.pointer], constraint).toEqual([422, "validation.constraint", pointer]);
    }
    const nn = mapDatabaseGuardError({
      code: "23502",
      table: "initiative_outcome_contribution",
      column: "outcome_id",
    })!;
    expect([nn.status, nn.code, nn.errors?.[0]?.pointer]).toEqual([422, "validation.required", "/outcomeId"]);
    const col = mapDatabaseGuardError({
      code: "23514",
      table: "gate_dispensation",
      constraint: "gate_dispensation_reason_check",
    })!;
    expect([col.status, col.errors?.[0]?.pointer]).toEqual([422, "/reason"]);
    const date = mapDatabaseGuardError({ code: "22008" })!;
    expect([date.status, date.code]).toEqual([400, "validation"]);
  });

  it("*_audit_required of every P3 table -> 500 (a programming error, never user-facing detail)", () => {
    for (const table of ["initiative", "gate_dispensation", "gate_decision_agreement", "funding_decision"]) {
      const p = mapDatabaseGuardError({ code: "23000", constraint: `${table}_audit_required` })!;
      expect([p.status, p.code, p.detail], table).toEqual([500, "internal", undefined]);
    }
  });
});
