// workflows module suite (REQ-S16-003 / A12 "the six modules exist with separate test suites"; ADR-0015). Unit level:
// module mapping and boundary, the routes it registers (each declaring access), and the PURE G1-G3 criterion
// evaluators over synthetic facts - including REQ-S13-012: evidence that is only a filename or an inaccessible link
// is unverified and leaves a criterion incomplete. Behaviour against PostgreSQL: test/integration/gates.test.ts etc.
import { join } from "node:path";
import type { GateDefinition } from "@mth/shared/schemas";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  AST_TEST_TIMEOUT_MS,
  fileViolations,
  moduleFiles,
  moduleViolations,
  MODULES_DIR,
} from "../../architecture.testkit.ts";
import { API_MODULES, P1_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";

describe("workflows module (P2)", () => {
  it("is mapped with its declared dependency direction (reads kpi and evidence for the gate criteria)", () => {
    expect(P1_MODULES).toContain("workflows");
    // P4 (T-DG4-BE-A, modules.ts): + organization (working-day due dates) and tasks (approval work items).
    expect([...API_MODULES.workflows.dependsOn].sort()).toEqual([
      "access",
      "audit",
      "evidence",
      "kpi",
      "methodology",
      "organization",
      "platform",
      "tasks",
      "transformations",
    ]);
  });

  it("has a public index.ts exposing the product gates, the evaluators and its wiring hook", () => {
    expect(moduleFiles("workflows")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "CLOSURE_GATE",
      "EVALUATORS",
      "PRODUCT_GATES",
      "evaluateGate",
      // P3 (T-DG3-BE-A): a waiver is granted by the waived gate's configured approver (portfolio dispensations).
      "isGateApprover",
      "loadGateFacts",
      // P4 (T-DG4-BE-B's approval service, exported for governance by T-DG4-BE-C): subject providers, in-transaction
      // requests, the T11 router seam and the approval read model.
      "registerApprovalSubject",
      "registerWorkflowsModule",
      "requestApprovalInTx",
      "setDecisionRightRouter",
      "toApprovals",
    ]);
  });

  it("names the product gates G1-G6 (business approvals), never the engineering gates DG0-DG7", () => {
    expect(mod.PRODUCT_GATES).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    expect(mod.PRODUCT_GATES.some((g) => g.startsWith("DG"))).toBe(false);
    expect(mod.CLOSURE_GATE).toBe("G6");
  });

  it("registers its routes, each declaring access; every mutation declares a write permission", async () => {
    const app = Fastify({ logger: false });
    const routes: { key: string; access: unknown }[] = [];
    app.addHook("onRoute", (r) => {
      if (r.method !== "HEAD") routes.push({ key: `${String(r.method)} ${r.url}`, access: r.config?.access });
    });
    const registration = mod.registerWorkflowsModule(app, { db: {}, config: {} } as unknown as ModuleDeps);
    await app.ready();
    expect(registration).toMatchObject({ module: "workflows", status: "active", deliversIn: "P2" });
    expect(routes.map((r) => r.key).sort()).toEqual([...registration.routes].sort());
    for (const r of routes) {
      const permission = (r.access as { permission?: string }).permission;
      // GET /api/v1/dependency-types and GET /api/v1/phases are the global catalogue reads: the contract declares no 403
      // on them, so they are "authenticated" (T-DG3-BE-C handback 7.1; T-DG4-BE-L2 handback; integrated by the
      // orchestrator, D-108).
      if (r.key.startsWith("GET"))
        expect(permission, r.key).toBe(
          ["GET /api/v1/dependency-types", "GET /api/v1/phases"].includes(r.key)
            ? "authenticated"
            : "transformation.read",
        );
      else expect(permission, r.key).not.toMatch(/\.read$/);
    }
    expect(routes.find((r) => r.key.endsWith("/decision"))?.access).toEqual({ permission: "gate.decide" });
    expect(routes.find((r) => r.key.endsWith("/decide"))?.access).toEqual({ permission: "decision.decide" });
    await app.close();
  });

  it(
    "its declared boundary holds, and an undeclared dependency would be caught",
    () => {
      expect(moduleViolations("workflows")).toEqual([]);
      const plant = (source: string) =>
        fileViolations("workflows", join(MODULES_DIR, "workflows", "planted.ts"), source).join("\n");
      expect(plant(`import { decide } from "../access/rules.ts";`)).toContain("only access/index.ts is public");
      expect(plant(`import { x } from "../reporting/index.ts";`)).toContain(
        "module workflows may not import module reporting",
      );
    },
    AST_TEST_TIMEOUT_MS,
  ); // F-DG2-143: AST walk of the module sources gets explicit headroom.
});

// ------------------------------------------------------------------------------------------------ evaluators

const criterion = (key: string, ordinal: number, requiresVerifiedEvidence = false) => ({
  id: "01920002-0005-7000-8000-000000000001",
  gateDefinitionId: "01920002-0004-7000-8000-000000000001",
  key,
  ordinal,
  labelEn: key,
  labelAr: key,
  descriptionEn: key,
  descriptionAr: key,
  mandatory: true,
  requiresVerifiedEvidence,
  sourceRef: "B0023",
  version: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  createdBy: null,
  updatedAt: "2026-10-02T00:00:00.000Z",
  updatedBy: null,
});
const gate = (code: string, criteria: ReturnType<typeof criterion>[]) =>
  ({ code, criteria }) as unknown as GateDefinition;

const DIMS = ["financial", "customer", "process", "people_org", "technology", "data"];
type Facts = Parameters<typeof mod.evaluateGate>[1];
function completeFacts(): Facts {
  return {
    seededDiagnosticItems: DIMS.map((d, i) => ({
      id: `00000000-0000-7000-8000-00000000000${i}`,
      dimensionCode: d,
      hasCurrentState: true,
      hasRootCause: true,
      hasImpact: true,
      hasConfidence: true,
      baselineId: null,
    })),
    findings: [{ id: "f1", kind: "root_cause", status: "confirmed" }],
    kpi: {
      baselines: [
        { id: "b1", hasValue: true, hasSource: true, hasDate: true, validationStatus: "validated", status: "active" },
      ],
      valuePools: [{ id: "v1", quantificationStatus: "unquantified", materiality: "material", status: "active" }],
      outcomeKpis: [
        {
          id: "k1",
          outcomeId: "o1",
          kpiDefinitionId: "d1",
          hasTarget: true,
          targetDate: "2027-12-31",
          trajectoryStatus: "approved",
          status: "active",
        },
      ],
      kpiDefinitions: [{ id: "d1", status: "active", hasUnit: true, polarity: "higher_is_better", ownerUserId: "u1" }],
    },
    charter: {
      id: "c1",
      version: 1,
      hasCaseForChange: true,
      hasName: true,
      hasSponsor: true,
      hasLead: true,
      hasInScope: true,
      hasOutOfScope: true,
      hasBaselineDate: true,
      thesisMissing: [],
    },
    northStar: { id: "n1", version: 1 },
    topOutcomes: [{ id: "o1" }],
    outcomes: [{ id: "o1", statement: "Raise digital NPS", isTopOutcome: true, goodOutcomePass: true, notPassing: [] }],
    activeGuardrails: 1,
    canvasCells: Array.from({ length: 10 }, (_, i) => ({ dimensionCode: `d${i}`, status: "ready" })),
    tomGaps: [{ id: "g1", status: "open", hasOwner: true }],
    capabilities: [{ id: "cap", currentLevel: 2, targetLevel: 4 }],
    futureJourneys: 1,
    openDesignDecisions: [{ id: "x", code: "D-01", hasOwner: true }],
    evidence: [
      ...DIMS.map((_, i) => ({
        evidenceId: `e${i}`,
        recordType: "diagnostic_item",
        recordId: `00000000-0000-7000-8000-00000000000${i}`,
        kind: "note",
        verified: true,
      })),
      { evidenceId: "eb", recordType: "baseline", recordId: "b1", kind: "file", verified: true },
    ],
  };
}

const ALL_KEYS = {
  G1: ["g1.diagnostic", "g1.baseline", "g1.root_causes", "g1.value_pools", "g1.case_for_change", "g1.initial_charter"],
  G2: ["g2.north_star", "g2.outcome_tree", "g2.kpi_definitions", "g2.target_trajectory", "g2.guardrails"],
  G3: ["g3.target_operating_model", "g3.gap_matrix", "g3.capability_gaps", "g3.future_journeys", "g3.design_decisions"],
};
const ALL = new Map<"G1" | "G2" | "G3", readonly string[]>([
  ["G1", ALL_KEYS.G1],
  ["G2", ALL_KEYS.G2],
  ["G3", ALL_KEYS.G3],
]);
const keysOf = (code: "G1" | "G2" | "G3") => ALL.get(code)!;
const defOf = (code: "G1" | "G2" | "G3") =>
  gate(
    code,
    keysOf(code).map((k, i) => criterion(k, i + 1, k === "g1.diagnostic" || k === "g1.baseline")),
  );
const completeness = (code: "G1" | "G2" | "G3", facts: Facts) =>
  Object.fromEntries(mod.evaluateGate(defOf(code), facts).map((c) => [c.key, c.completeness]));

describe("G1-G3 criterion evaluators (ADR-0015 §2)", () => {
  it("has exactly one evaluator per seeded G1-G6 criterion (16 + the eight g4.* of 0024, T-DG3-BE-E + the eight g5.*/g6.* of 0051, T-DG4-BE-K)", () => {
    const g4 = [
      "g4.initiative_cards",
      "g4.business_cases",
      "g4.finance_validation",
      "g4.prioritization",
      "g4.roadmap",
      "g4.owners",
      "g4.funding",
      "g4.capacity",
    ];
    // T-DG4-BE-K (ADR-0035 §2): the G5/G6 evaluators of workflows/g5.ts and workflows/g6.ts.
    const g5g6 = [
      "g5.performance_evidence",
      "g5.adoption",
      "g5.risk_closure",
      "g5.decision_log",
      "g6.benefits_evidence",
      "g6.ownership_transfer",
      "g6.controls",
      "g6.improvement_backlog",
    ];
    expect([...mod.EVALUATORS.keys()].sort()).toEqual(
      [...ALL_KEYS.G1, ...ALL_KEYS.G2, ...ALL_KEYS.G3, ...g4, ...g5g6].sort(),
    );
  });

  it("complete facts make every criterion complete", () => {
    for (const code of ["G1", "G2", "G3"] as const)
      expect(Object.values(completeness(code, completeFacts())), code).toEqual(keysOf(code).map(() => "complete"));
  });

  it("REQ-PB-030 (F-DG2-203): a thesis with an empty part (or no charter) leaves g2.outcome_tree incomplete", () => {
    const f = completeFacts();
    const g2 = (facts: Facts) => mod.evaluateGate(defOf("G2"), facts).find((c) => c.key === "g2.outcome_tree")!;
    const partial = { ...f, charter: { ...f.charter!, thesisMissing: ["thesisBenefits", "thesisBecause"] } };
    expect(g2(partial).completeness).toBe("incomplete");
    expect(g2(partial).missing.map((m) => [m.code, m.pointer])).toEqual([
      ["g2.outcome_tree.thesis_incomplete", "/charter/thesisBenefits"],
      ["g2.outcome_tree.thesis_incomplete", "/charter/thesisBecause"],
    ]);
    const none = g2({ ...f, charter: null });
    expect(none.missing.map((m) => m.code)).toContain("g2.outcome_tree.thesis_incomplete");
    expect(g2(f).completeness).toBe("complete");
  });

  it("REQ-S13-012: evidence that is only a filename (never verifiable) leaves g1.diagnostic incomplete", () => {
    const f = completeFacts();
    const filenameOnly = f.seededDiagnosticItems.map((i, n) => ({
      evidenceId: `fn${n}`,
      recordType: "diagnostic_item",
      recordId: i.id,
      kind: "file_reference",
      verified: false,
    }));
    const facts = { ...f, evidence: [...filenameOnly, ...f.evidence.filter((e) => e.recordType === "baseline")] };
    const [diag] = mod.evaluateGate(defOf("G1"), facts);
    expect(diag!.completeness).toBe("incomplete");
    expect(diag!.unverifiedEvidenceIds.sort()).toEqual(filenameOnly.map((e) => e.evidenceId).sort());
    expect(diag!.missing.map((m) => m.code)).toContain("g1.diagnostic.verified_evidence_missing");
  });

  it("an inaccessible / unreviewed link on the baseline leaves g1.baseline incomplete; a linked baseline backs T01", () => {
    const f = completeFacts();
    const facts = {
      ...f,
      seededDiagnosticItems: f.seededDiagnosticItems.map((i) => ({ ...i, baselineId: "b1" })),
      evidence: [
        { evidenceId: "link", recordType: "baseline", recordId: "b1", kind: "external_link", verified: false },
      ],
    };
    const c = completeness("G1", facts);
    expect(c["g1.diagnostic"]).toBe("complete"); // backed by a linked baseline
    expect(c["g1.baseline"]).toBe("incomplete"); // only unverified evidence
  });

  it("missing data is never complete: no charter, no value pool, no T02 row, no gap, unready box", () => {
    const f = completeFacts();
    const empty: Facts = {
      ...f,
      charter: null,
      kpi: { baselines: [], valuePools: [], outcomeKpis: [], kpiDefinitions: [] },
      northStar: null,
      topOutcomes: [],
      activeGuardrails: 0,
      canvasCells: f.canvasCells.map((c, i) => (i === 0 ? { ...c, status: "draft" } : c)),
      tomGaps: [],
      capabilities: [{ id: "c", currentLevel: 3, targetLevel: 3 }],
      futureJourneys: 0,
    };
    expect(completeness("G1", empty)).toMatchObject({
      "g1.initial_charter": "incomplete",
      "g1.case_for_change": "incomplete",
      "g1.value_pools": "incomplete",
      "g1.baseline": "incomplete",
    });
    expect(Object.values(completeness("G2", empty)).every((v) => v === "incomplete")).toBe(true);
    expect(completeness("G3", empty)).toMatchObject({
      "g3.target_operating_model": "incomplete",
      "g3.gap_matrix": "incomplete",
      "g3.capability_gaps": "incomplete",
      "g3.future_journeys": "incomplete",
      "g3.design_decisions": "complete", // a prohibition: no open decision without an owner
    });
  });

  it("an unapproved or stale trajectory, an inactive KPI definition and an unowned open gap are incomplete", () => {
    const f = completeFacts();
    const facts: Facts = {
      ...f,
      kpi: {
        ...f.kpi,
        outcomeKpis: f.kpi.outcomeKpis.map((k) => ({ ...k, trajectoryStatus: "stale" })),
        kpiDefinitions: f.kpi.kpiDefinitions.map((d) => ({ ...d, status: "draft" })),
      },
      tomGaps: [{ id: "g", status: "open", hasOwner: false }],
      openDesignDecisions: [{ id: "x", code: "D-02", hasOwner: false }],
    };
    expect(completeness("G2", facts)).toMatchObject({
      "g2.target_trajectory": "incomplete",
      "g2.kpi_definitions": "incomplete",
    });
    expect(completeness("G3", facts)).toMatchObject({
      "g3.gap_matrix": "incomplete",
      "g3.design_decisions": "incomplete",
    });
  });

  it("REQ-PB-036: G2 lists every outcome whose good outcome test is not passing (ids + criteria)", () => {
    const f = completeFacts();
    const facts: Facts = {
      ...f,
      outcomes: [
        ...f.outcomes,
        {
          id: "o2",
          statement: "Launch new app",
          isTopOutcome: false,
          goodOutcomePass: false,
          notPassing: [
            { criterionCode: "specific", result: "fail", reason: "activity" },
            { criterionCode: "measurable", result: "fail", reason: "No KPI linked" },
            { criterionCode: "causal_chain", result: "unknown", reason: "not recorded" },
          ],
        },
      ],
    };
    const tree = mod.evaluateGate(defOf("G2"), facts).find((c) => c.key === "g2.outcome_tree")!;
    expect(tree.completeness).toBe("incomplete");
    expect(tree.missing).toEqual([
      {
        code: "g2.outcome_tree.good_outcome_test_not_passing",
        message:
          'Outcome "Launch new app" does not pass the good outcome test: specific (fail), measurable (fail), causal_chain (unknown).',
        pointer: "/outcomes/o2",
      },
    ]);
    // A passing outcome is not listed; the other G2 criteria are unaffected.
    expect(completeness("G2", facts)["g2.guardrails"]).toBe("complete");
  });

  it("a criterion without an evaluator fails closed", () => {
    const [c] = mod.evaluateGate(gate("G4", [criterion("g4.portfolio", 1)]), completeFacts());
    expect(c!.completeness).toBe("incomplete");
    expect(c!.missing[0]!.code).toBe("gate.criterion_not_evaluable");
  });
});
