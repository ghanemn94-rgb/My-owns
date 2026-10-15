// Unit tests of the pure rules of the KBE-C2 assemblers (T-DG5-KBE-C2; ADR-0045 §3, §5; p5-work-split §F.2), with
// worked fixtures. The database behaviour is proved by test/integration/reporting/kbe-c2-assemblers.test.ts.
// All data is SYNTHETIC.
import { describe, expect, it } from "vitest";
import { assembledCodes, assemblerOf, decimalValue } from "../assembler.ts";
import { NOT_APPLICABLE, PROVISIONAL, VALIDATED } from "../provisional.ts";
import { lineAmountState, lineFormulaFact, presentState, totalState } from "./business-cases.ts";
import { criterionDetail, criterionState, snapshotEvidence } from "./gate-pack.ts";

const formula = (status: string, current: { validationStatus: string } | null) => ({
  id: "f",
  code: "BF-01",
  status,
  current: current === null ? null : { id: "v", versionNo: 1, ...current },
});

describe("registry (p5-work-split §F.2)", () => {
  it("registers the five KBE-C2 assemblers next to KBE-C's, each under its own code", () => {
    for (const code of ["diagnostic", "tom", "business_cases", "roadmap", "gate_pack"] as const)
      expect(assemblerOf(code)?.code).toBe(code);
    expect(assembledCodes()).toEqual(
      expect.arrayContaining(["charter", "registers", "diagnostic", "tom", "business_cases", "roadmap", "gate_pack"]),
    );
  });

  it("the five take no settings: an empty object passes, anything else is report.parameters_invalid", () => {
    for (const code of ["diagnostic", "tom", "business_cases", "roadmap", "gate_pack"] as const) {
      const a = assemblerOf(code)!;
      expect(a.parseParameters({})).toEqual({});
      expect(a.parseParameters(undefined)).toEqual({});
      expect(() => a.parseParameters({ register: "raid" })).toThrow(
        expect.objectContaining({ code: "report.parameters_invalid" }),
      );
    }
  });
});

describe("business_cases: ADR-0045 §5 rule 2 (the DG3 G4 formula rule)", () => {
  it("only the current version's `validated` counts; no formula, no current version or archived is not validated", () => {
    const m = new Map([
      ["ok", formula("active", { validationStatus: "validated" })],
      ["open", formula("active", { validationStatus: "unvalidated" })],
      ["rej", formula("active", { validationStatus: "rejected" })],
      ["none", formula("active", null)],
      ["arch", formula("archived", { validationStatus: "validated" })],
    ]);
    expect(lineFormulaFact("ok", m)).toBe("validated");
    expect(lineFormulaFact("open", m)).toBe("unvalidated");
    expect(lineFormulaFact("rej", m)).toBe("rejected");
    expect(lineFormulaFact("none", m)).toBe("no_current_version");
    expect(lineFormulaFact("arch", m)).toBe("formula_archived");
    expect(lineFormulaFact(null, m)).toBe("no_formula");
    expect(lineFormulaFact("missing", m)).toBe("no_formula");
  });

  it("a financial benefit line is validated only with a validated formula; investment and non-financial lines are n/a", () => {
    expect(lineAmountState("benefit", "revenue_uplift", "validated")).toBe(VALIDATED);
    for (const f of ["unvalidated", "rejected", "no_formula", "no_current_version", "formula_archived"] as const)
      expect(lineAmountState("benefit", "cash_saving", f)).toBe(PROVISIONAL);
    expect(lineAmountState("investment", "cash", "no_formula")).toBe(NOT_APPLICABLE);
    expect(lineAmountState("benefit", "non_financial", "no_formula")).toBe(NOT_APPLICABLE);
  });

  it("a total is provisional when any of its lines is, validated only when all are", () => {
    expect(totalState([VALIDATED, VALIDATED])).toBe(VALIDATED);
    expect(totalState([VALIDATED, PROVISIONAL])).toBe(PROVISIONAL);
    expect(totalState([])).toBe(NOT_APPLICABLE);
    expect(totalState([NOT_APPLICABLE, VALIDATED])).toBe(NOT_APPLICABLE);
  });

  it("worked fixture: Δ attach × customers × ARPU line (unvalidated) is provisional; a missing amount is Unknown, never 0", () => {
    // Synthetic B0087 revenue example: 0.02 Δ attach × 500,000 customers × 10 SAR ARPU = 100,000 SAR (the line's amount
    // as entered; the report shows it, it never recomputes it).
    const attach = decimalValue("100000.0000", {
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "planned",
      ...presentState("100000.0000", lineAmountState("benefit", "revenue_uplift", "unvalidated")),
    });
    expect(attach).toMatchObject({ value: "100000.0000", validation: "provisional", reason: null });
    // Synthetic volume × Δ unit cost: 1,000,000 transactions × 0.025 SAR = 25,000 SAR, formula validated.
    const unitCost = decimalValue("25000.0000", {
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "planned",
      ...presentState("25000.0000", lineAmountState("benefit", "cash_saving", "validated")),
    });
    expect(unitCost).toMatchObject({ value: "25000.0000", validation: "validated" });
    // An investment line without an amount: Unknown (missing), not n/a and never 0.
    const missing = decimalValue(null, {
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "planned",
      ...presentState(null, lineAmountState("investment", "cash", "no_formula")),
    });
    expect(missing).toMatchObject({ value: null, validation: "unknown", reason: "missing" });
  });
});

describe("gate_pack: the recorded evaluator output", () => {
  it("reads the stored criterion detail (jsonb object or text); malformed members read as empty", () => {
    const d = { missing: [{ code: "g1.charter.missing", message: "x" }], unverifiedEvidenceIds: ["e1"] };
    expect(criterionDetail(d)).toEqual({
      missing: [{ code: "g1.charter.missing", message: "x" }],
      unverifiedEvidenceIds: ["e1"],
    });
    expect(criterionDetail(JSON.stringify(d))).toEqual(criterionDetail(d));
    expect(criterionDetail(null)).toEqual({ missing: [], unverifiedEvidenceIds: [] });
    expect(criterionDetail("{not json")).toEqual({ missing: [], unverifiedEvidenceIds: [] });
    expect(criterionDetail({ missing: [1, { message: "no code" }], unverifiedEvidenceIds: [2, "e"] })).toEqual({
      missing: [],
      unverifiedEvidenceIds: ["e"],
    });
  });

  it("states: complete; covered by an accepted exception (mandatory only); otherwise incomplete", () => {
    expect(criterionState({ completeness: "complete", mandatory: true, gateExceptionId: null })).toBe("complete");
    expect(criterionState({ completeness: "incomplete", mandatory: true, gateExceptionId: "x" })).toBe(
      "covered_by_exception",
    );
    expect(criterionState({ completeness: "incomplete", mandatory: false, gateExceptionId: "x" })).toBe("incomplete");
    expect(criterionState({ completeness: "incomplete", mandatory: true, gateExceptionId: null })).toBe("incomplete");
  });

  it("the submission snapshot's evidence list: in order, deduplicated, record type split off, verified as recorded", () => {
    const snapshot = {
      evidence: [
        { evidenceId: "e1", record: "diagnostic_item:abc", verified: true },
        { evidenceId: "e2", record: "baseline:def", verified: false },
        { evidenceId: "e1", record: "baseline:def", verified: true },
        { record: "no id" },
      ],
    };
    expect(snapshotEvidence(snapshot)).toEqual([
      { evidenceId: "e1", recordType: "diagnostic_item", verified: true },
      { evidenceId: "e2", recordType: "baseline", verified: false },
    ]);
    expect(snapshotEvidence(null)).toEqual([]);
    expect(snapshotEvidence({ evidence: "x" })).toEqual([]);
  });
});
