// Unit tests of the P3 roadmap / T08 / capacity mirrors and the FormulaRounding mirror (T-DG3-ARCH-04). All values are
// synthetic.
import { describe, expect, it } from "vitest";
import {
  benefitCalculation,
  capacityPlanCell,
  dependencyType,
  formulaRounding,
  periodMonth,
  resourceDemand,
  roadmapView,
} from "./index.ts";

const ID = "01920099-0000-7000-8000-0000000000a1";
const AT = "2026-10-08T00:00:00.000Z";

describe("capacity mirrors: FTE as decimal strings, Unknown as null (ADR-0023 §6)", () => {
  const cell = {
    resourceRoleId: ID,
    periodMonth: "2026-11-01",
    availableFte: null,
    demandFte: "1.50",
    committedDemandFte: "1.50",
    shortfallFte: null,
    flag: "capacity.unknown",
  };
  it("accepts an Unknown cell and refuses a number or a non-first-of-month period", () => {
    expect(capacityPlanCell.safeParse(cell).success).toBe(true);
    expect(capacityPlanCell.safeParse({ ...cell, demandFte: 1.5 }).success).toBe(false);
    expect(capacityPlanCell.safeParse({ ...cell, flag: "capacity.fine" }).success).toBe(false);
    expect(periodMonth.safeParse("2026-11-02").success).toBe(false);
  });
  it("ResourceDemand is strict (an unknown key is refused)", () => {
    const demand = {
      id: ID,
      organizationId: ID,
      transformationId: ID,
      initiativeId: ID,
      resourceRoleId: ID,
      periodMonth: "2026-11-01",
      demandFte: "0.50",
      ownerUserId: null,
      note: null,
      status: "committed",
      committedBy: ID,
      committedAt: AT,
      version: 2,
      createdAt: AT,
      createdBy: ID,
      updatedAt: AT,
      updatedBy: ID,
    };
    expect(resourceDemand.safeParse(demand).success).toBe(true);
    expect(resourceDemand.safeParse({ ...demand, extra: 1 }).success).toBe(false);
  });
});

describe("roadmap and dependency-type mirrors", () => {
  it("an empty RoadmapView parses; a missing array does not", () => {
    const view = {
      transformationId: ID,
      waves: [],
      initiatives: [],
      milestones: [],
      deliverables: [],
      dependencies: [],
    };
    expect(roadmapView.safeParse(view).success).toBe(true);
    const { dependencies: _omitted, ...partial } = view;
    expect(roadmapView.safeParse(partial).success).toBe(false);
  });
  it("DependencyType codes follow DependencyTypeCode", () => {
    const t = {
      id: ID,
      code: "data",
      labelEn: "Data",
      labelAr: "بيانات",
      isSystem: true,
      sourceRef: "B0081",
      ordinal: 1,
      status: "active",
      version: 1,
    };
    expect(dependencyType.safeParse(t).success).toBe(true);
    expect(dependencyType.safeParse({ ...t, code: "Data" }).success).toBe(false);
  });
});

describe("FormulaRounding on BenefitCalculation (ADR-0024 §6 item 11, §10)", () => {
  const rounding = {
    column: "numeric(24,6)",
    scale: 6,
    mode: "ROUND_HALF_UP",
    precision: 80,
    exact: "100000",
    stored: "100000.000000",
    rounded: false,
    inexactIntermediate: false,
  };
  it("accepts the engine record and its Unknown form; refuses another column or a short stored value", () => {
    expect(formulaRounding.safeParse(rounding).success).toBe(true);
    expect(formulaRounding.safeParse({ ...rounding, exact: null, stored: null }).success).toBe(true);
    expect(formulaRounding.safeParse({ ...rounding, column: "numeric(20,4)" }).success).toBe(false);
    expect(formulaRounding.safeParse({ ...rounding, stored: "100000" }).success).toBe(false);
    expect(formulaRounding.safeParse({ ...rounding, extra: true }).success).toBe(false);
  });
  it("BenefitCalculation requires the key; null is allowed only as the pre-0027 value", () => {
    const shape = benefitCalculation.shape;
    expect(shape.rounding.safeParse(null).success).toBe(true);
    expect(shape.rounding.safeParse(undefined).success).toBe(false);
  });
});
