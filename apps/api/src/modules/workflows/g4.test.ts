// Unit tests of the eight G4 evaluators (ADR-0021 §7; T-DG3-BE-E). No database: facts are built in memory.
// Fail closed without facts (an unwired provider), the exact English labels with the initiative's code and name, and
// Unknown capacity as a conflict. G4 is a business approval inside the product; nothing here touches DG0-DG7.
import { describe, expect, it } from "vitest";
import { G4_EVALUATORS, type G4Facts, type PortfolioGateFacts } from "./g4.ts";

const evaluate = (f: G4Facts | undefined) => Object.fromEntries(G4_EVALUATORS.map(([key, ev]) => [key, ev(f).missing]));

type Initiative = NonNullable<PortfolioGateFacts["initiatives"]>[number];
const INI: Initiative = {
  id: "01920000-0000-7000-8000-0000000000a1",
  code: "INI-01",
  name: "Synthetic roaming relaunch",
  version: 3,
  status: "funded",
  cardMissing: [],
  activeGapLinks: 1,
  kpiContributions: 1,
  waveId: "01920000-0000-7000-8000-0000000000e1",
  plannedStart: "2027-01-01",
  plannedEnd: "2027-06-30",
  approvedMilestones: 1,
  executiveOwnerUserId: "01920000-0000-7000-8000-0000000000f1",
  workstreamLeadUserId: "01920000-0000-7000-8000-0000000000f2",
  fundingState: "funded",
  fundingDecisionId: "01920000-0000-7000-8000-0000000000d1",
  committedDemandIds: ["01920000-0000-7000-8000-0000000000d2"],
};
const CASE = {
  code: "BC-01",
  title: "Synthetic",
  version: 2,
  missingSections: [],
  baselineValidation: "validated" as const,
};
const complete = (
  over: { ini?: Partial<Initiative>; portfolio?: Partial<PortfolioGateFacts>; kpi?: object } = {},
): G4Facts => ({
  portfolio: {
    transformationId: "t",
    initiatives: [{ ...INI, ...over.ini }],
    ranking: { snapshotId: "s", weightSetId: "ws", entries: [{ initiativeId: INI.id, completeness: "complete" }] },
    activeWeightSet: { id: "ws", versionNo: 1 },
    scheduleConflicts: [],
    scheduleUnknowns: [],
    capacityConflicts: [],
    ...over.portfolio,
  },
  kpi: {
    transformationId: "t",
    transformationCase: {
      ...CASE,
      id: "c0",
      level: "transformation",
      initiativeId: null,
      pointer: "/business-cases/c0",
    },
    initiativeCases: [
      { ...CASE, id: "c1", code: "BC-02", level: "initiative", initiativeId: INI.id, pointer: "/business-cases/c1" },
    ],
    benefitLines: [],
    ...over.kpi,
  },
});

describe("G4 evaluators", () => {
  it("complete facts -> every criterion complete", () => {
    expect(Object.values(evaluate(complete())).flat()).toEqual([]);
  });

  it("an unwired provider (no facts) fails closed on all eight criteria", () => {
    const out = evaluate({ portfolio: { transformationId: "t" }, kpi: { transformationId: "t" } });
    expect(Object.entries(out).map(([k, m]) => [k, m.length > 0])).toEqual(G4_EVALUATORS.map(([k]) => [k, true]));
    expect(Object.values(evaluate(undefined)).every((m) => m.length > 0)).toBe(true);
  });

  it("the exact English labels name the initiative's code and name", () => {
    const out = evaluate(
      complete({
        ini: {
          activeGapLinks: 0,
          executiveOwnerUserId: null,
          fundingState: "unfunded",
          committedDemandIds: [],
          approvedMilestones: 0,
        },
      }),
    );
    const n = `${INI.code} ${INI.name}`;
    expect(out["g4.initiative_cards"]).toEqual([
      { code: "g4.initiative_gap_missing", message: `Gap link missing: ${n}`, pointer: `/initiatives/${INI.id}` },
    ]);
    expect(out["g4.owners"]).toEqual([
      { code: "g4.owner_missing", message: `Owners: ${n}`, pointer: `/initiatives/${INI.id}` },
    ]);
    expect(out["g4.funding"]![0]!.message).toBe(`Funding decision missing: ${n}`);
    expect(out["g4.capacity"]![0]!.message).toBe(`Capacity commitment missing: ${n}`);
    expect(out["g4.roadmap"]![0]!.message).toBe(`Roadmap: ${n}`);
  });

  it("Finance validation: a stale or unvalidated baseline, or an unvalidated formula version, never counts", () => {
    const stale = evaluate(
      complete({
        kpi: {
          initiativeCases: [
            {
              ...CASE,
              id: "c1",
              code: "BC-02",
              level: "initiative",
              initiativeId: INI.id,
              baselineValidation: "stale",
              pointer: "/business-cases/c1",
            },
          ],
          benefitLines: [
            {
              lineId: "l1",
              businessCaseId: "c1",
              initiativeId: INI.id,
              title: "x",
              benefitClass: "revenue",
              valueBasis: "revenue_uplift",
              benefitFormulaId: "f1",
              formulaCode: "BF-01",
              currentVersionNo: 2,
              currentVersionId: "v2",
              formulaValidation: "unvalidated",
              pointer: "/benefit-formulas/f1/versions/2",
            },
          ],
        },
      }),
    )["g4.finance_validation"];
    expect(stale).toEqual([
      { code: "g4.finance_validation_missing", message: "Finance validation", pointer: "/business-cases/c1" },
      {
        code: "g4.finance_validation_missing",
        message: "Finance validation",
        pointer: "/benefit-formulas/f1/versions/2",
      },
    ]);
  });

  it("an empty portfolio, a ranking under an old weight set, a schedule conflict and a capacity conflict", () => {
    expect(evaluate(complete({ portfolio: { initiatives: [] } }))["g4.initiative_cards"]).toEqual([
      { code: "g4.portfolio_empty", message: "Initiative cards", pointer: "/initiatives" },
    ]);
    expect(
      evaluate(complete({ portfolio: { activeWeightSet: { id: "ws2", versionNo: 2 } } }))["g4.prioritization"]![0]!
        .message,
    ).toBe("Prioritization");
    expect(
      evaluate(complete({ portfolio: { scheduleConflicts: [{ dependencyId: "d", code: "DEP-03" }] } }))["g4.roadmap"],
    ).toEqual([{ code: "g4.schedule_conflict", message: "Schedule conflict: DEP-03", pointer: "/dependencies/d" }]);
    // D-079: an Unknown schedule is a missing item, never "no conflict"; unloaded schedule facts fail closed.
    expect(
      evaluate(complete({ portfolio: { scheduleUnknowns: [{ dependencyId: "u", code: "DEP-04" }] } }))["g4.roadmap"],
    ).toEqual([{ code: "g4.schedule_unknown", message: "Schedule unknown: DEP-04", pointer: "/dependencies/u" }]);
    const { scheduleUnknowns: _notLoaded, ...withoutUnknowns } = complete().portfolio;
    expect(evaluate({ ...complete(), portfolio: withoutUnknowns })["g4.roadmap"]).toEqual([
      { code: "g4.roadmap_missing", message: "Roadmap" },
    ]);
    const unknown = evaluate(
      complete({
        portfolio: {
          capacityConflicts: [
            {
              resourceRoleId: "r",
              roleLabel: "Data engineer",
              periodMonth: "2027-02-01",
              committedFte: "1.00",
              availableFte: null,
            },
          ],
        },
      }),
    )["g4.capacity"];
    expect(unknown).toEqual([
      {
        code: "g4.capacity_conflict",
        message: "Capacity conflict: Data engineer 2027-02",
        pointer: "/resource-roles/r",
      },
    ]);
  });
});
