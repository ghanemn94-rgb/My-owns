// Product gate G4 "Is the portfolio executable and value-backed?" (B0023; ADR-0021 §7; REQ-PB-019, REQ-PB-046,
// REQ-PB-055, REQ-PB-059, REQ-S04-006; T-DG3-BE-E): the eight g4.* evaluators and the G4 snapshot builder.
//
// workflows must not import portfolio (no module cycle, ADR-0021 §1). The G4 evaluators therefore read their facts
// through the GateFactsProvider interface defined HERE, which server.ts wires at start-up with portfolio's
// (portfolio/gate-facts.ts) and kpi's (kpi/p3-gate-facts.ts) loaders - dependency injection, no import.
//
// Fail closed everywhere: facts that were not loaded (an unwired provider) make every criterion incomplete; Unknown
// capacity and an Unknown schedule are conflicts, never "no conflict"; a stale, rejected or missing Finance validation never counts.
// Missing items use the exact English labels of ADR-0021 §7, with the initiative's code and name filled in, so
// 'Owners', 'Finance validation' and the initiative names appear literally in a refused submission (422).
//
// G4 is a BUSINESS approval inside the product, decided by a person through the ADR-0015 decision path; nothing here
// approves anything, and it never implies an engineering gate DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { Warning } from "@mth/shared/schemas";
import type { KpiBenefitLineFact, KpiCaseFact } from "../kpi/index.ts";

// ------------------------------------------------------------------------------------------------ facts

/** One in-scope initiative (status selected, funded or launched) as G4 reads it. */
export interface G4InitiativeFact {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: number;
  readonly status: string;
  /** Empty T05 card fields G4 needs (name, objective, scope in), e.g. ["objective"]; [] when complete. */
  readonly cardMissing: readonly string[];
  readonly activeGapLinks: number;
  /** Active outcome contributions with a KPI (REQ-PB-006). */
  readonly kpiContributions: number;
  readonly waveId: string | null;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  /** Non-cancelled milestones with an approved date. */
  readonly approvedMilestones: number;
  readonly executiveOwnerUserId: string | null;
  readonly workstreamLeadUserId: string | null;
  /** The derived funding state (portfolio latestFundingState; only "funded" counts). */
  readonly fundingState: string;
  /** The latest counted funding decision, if any. */
  readonly fundingDecisionId: string | null;
  readonly committedDemandIds: readonly string[];
}

/** One (role, month) where COMMITTED demand exceeds the available capacity, or no capacity row exists (Unknown). */
export interface G4CapacityConflictFact {
  readonly resourceRoleId: string;
  readonly roleLabel: string;
  readonly periodMonth: string;
  readonly committedFte: string;
  /** null = Unknown (no active capacity row), which is a conflict, never "no conflict". */
  readonly availableFte: string | null;
}

/**
 * An unresolved dependency into an in-scope initiative, without a mitigation, that carries a schedule.ts flag G4
 * lists: a needed-by conflict (scheduleConflicts) or an Unknown schedule (scheduleUnknowns; D-079).
 */
export interface G4ScheduleConflictFact {
  readonly dependencyId: string;
  readonly code: string;
}

/** Portfolio facts for the G4 criteria (portfolio/gate-facts.ts loads them). Absent fields = not loaded (fail closed). */
export interface PortfolioGateFacts {
  readonly transformationId: string;
  readonly initiatives?: readonly G4InitiativeFact[];
  /** The current proposed ranking snapshot, or null. */
  readonly ranking?: {
    readonly snapshotId: string;
    readonly weightSetId: string;
    readonly entries: ReadonlyArray<{ readonly initiativeId: string; readonly completeness: string }>;
  } | null;
  readonly activeWeightSet?: { readonly id: string; readonly versionNo: number } | null;
  readonly scheduleConflicts?: readonly G4ScheduleConflictFact[];
  /** Dependencies flagged schedule.unknown (a date is missing): Unknown is never "no conflict" (D-079). */
  readonly scheduleUnknowns?: readonly G4ScheduleConflictFact[];
  readonly capacityConflicts?: readonly G4CapacityConflictFact[];
  readonly [fact: string]: unknown;
}

/** kpi facts for the G4 criteria (kpi/p3-gate-facts.ts, KBE-C). Absent fields = not loaded (fail closed). */
export interface KpiP3GateFacts {
  readonly transformationId: string;
  readonly transformationCase?: KpiCaseFact | null;
  readonly initiativeCases?: readonly KpiCaseFact[];
  readonly benefitLines?: readonly KpiBenefitLineFact[];
  readonly [fact: string]: unknown;
}

/**
 * One inherited-approval gate dispensation (ADR-0021 §5; F-DG3-120), as the gate list and gate view annotate the gate
 * with it. portfolio/dispensations.ts loads it; `counts` is the sequencing rule's own verdict (hasInheritedApproval:
 * Modular, accepted, evidence verified now). It is evidence of an earlier approval: it never approves the gate.
 */
export interface InheritedApprovalFact {
  readonly dispensationId: string;
  readonly gateCode: string;
  /** The dispensation's own status. */
  readonly status: "pending" | "accepted" | "rejected" | "revoked";
  readonly counts: boolean;
  readonly approvingBody: string;
  /** YYYY-MM-DD. */
  readonly approvedOn: string;
  /** ISO timestamp of the recording, to choose the newest. */
  readonly createdAt: string;
}

/** The P3 fact loaders the G4 evaluators (and the gate annotation) read through (wired by server.ts). */
export interface GateFactsProvider {
  readonly portfolio: (db: DbOrTx, transformationId: string) => Promise<PortfolioGateFacts>;
  readonly kpi: (db: DbOrTx, transformationId: string) => Promise<KpiP3GateFacts>;
  /** Every inherited-approval dispensation of the transformation (portfolio; ADR-0021 §5, F-DG3-120). */
  readonly inheritedApprovals: (db: DbOrTx, transformationId: string) => Promise<readonly InheritedApprovalFact[]>;
}

/**
 * The provider before anything is wired: no facts, so every G4 criterion stays incomplete (fail closed), and no
 * gate carries an inherited-approval annotation (the DG2 shape: nothing is shown that was not read).
 */
export const UNWIRED_GATE_FACTS: GateFactsProvider = Object.freeze({
  portfolio: async (_db: DbOrTx, transformationId: string) => ({ transformationId }),
  kpi: async (_db: DbOrTx, transformationId: string) => ({ transformationId }),
  inheritedApprovals: async () => [],
});

/** Both halves, loaded once per evaluation (inside the submitting transaction on submit). */
export interface G4Facts {
  readonly portfolio: PortfolioGateFacts;
  readonly kpi: KpiP3GateFacts;
}

export async function loadG4Facts(db: DbOrTx, provider: GateFactsProvider, transformationId: string): Promise<G4Facts> {
  return { portfolio: await provider.portfolio(db, transformationId), kpi: await provider.kpi(db, transformationId) };
}

// ------------------------------------------------------------------------------------------------ evaluators

interface G4Outcome {
  readonly missing: Warning[];
}
export type G4Evaluator = (f: G4Facts | undefined) => G4Outcome;

const item = (code: string, message: string, pointer?: string): Warning =>
  pointer === undefined ? { code, message } : { code, message, pointer };
const named = (i: G4InitiativeFact) => `${i.code} ${i.name}`;
const at = (i: G4InitiativeFact) => `/initiatives/${i.id}`;
const NOT_LOADED = (label: string, code: string): G4Outcome => ({
  missing: [item(code, label)],
});

/** The in-scope initiatives, or undefined when the portfolio facts were not loaded. */
const scopeOf = (f: G4Facts | undefined) => f?.portfolio.initiatives;

/** Evaluators keyed by the seeded criterion key (0024), registered in criteria.ts EVALUATORS. */
export const G4_EVALUATORS: ReadonlyArray<readonly [string, G4Evaluator]> = [
  [
    "g4.initiative_cards",
    (f) => {
      const scope = scopeOf(f);
      if (scope === undefined || scope.length === 0)
        return { missing: [item("g4.portfolio_empty", "Initiative cards", "/initiatives")] };
      const missing: Warning[] = [];
      for (const i of scope) {
        if (i.cardMissing.length > 0)
          missing.push(
            item(
              "g4.initiative_card_incomplete",
              `Initiative card incomplete: ${named(i)} (${i.cardMissing.join(", ")})`,
              at(i),
            ),
          );
        if (i.activeGapLinks === 0)
          missing.push(item("g4.initiative_gap_missing", `Gap link missing: ${named(i)}`, at(i)));
        if (i.kpiContributions === 0)
          missing.push(item("g4.initiative_outcome_missing", `Outcome/KPI link missing: ${named(i)}`, at(i)));
      }
      return { missing };
    },
  ],
  [
    "g4.business_cases",
    (f) => {
      const scope = scopeOf(f);
      const kpi = f?.kpi;
      if (scope === undefined || kpi?.initiativeCases === undefined || kpi.transformationCase === undefined)
        return NOT_LOADED("Business cases", "g4.business_case_missing");
      const missing: Warning[] = [];
      const top = kpi.transformationCase;
      if (top === null) missing.push(item("g4.business_case_missing", "Business cases", "/business-cases"));
      else
        for (const s of top.missingSections)
          missing.push(item("g4.business_case_section_missing", `Business case section missing: ${s}`, top.pointer));
      for (const i of scope) {
        const kase = kpi.initiativeCases.find((c) => c.initiativeId === i.id);
        if (kase === undefined) {
          missing.push(item("g4.initiative_case_missing", `Business case missing: ${named(i)}`, at(i)));
          continue;
        }
        for (const s of kase.missingSections)
          missing.push(item("g4.business_case_section_missing", `Business case section missing: ${s}`, kase.pointer));
      }
      return { missing };
    },
  ],
  [
    "g4.finance_validation",
    (f) => {
      const scope = scopeOf(f);
      const kpi = f?.kpi;
      if (
        scope === undefined ||
        kpi?.initiativeCases === undefined ||
        kpi.transformationCase === undefined ||
        kpi.benefitLines === undefined
      )
        return NOT_LOADED("Finance validation", "g4.finance_validation_missing");
      const missing: Warning[] = [];
      const ids = new Set(scope.map((i) => i.id));
      const cases: KpiCaseFact[] = [];
      if (kpi.transformationCase === null)
        missing.push(item("g4.finance_validation_missing", "Finance validation", "/business-cases"));
      else cases.push(kpi.transformationCase);
      cases.push(...kpi.initiativeCases.filter((c) => c.initiativeId !== null && ids.has(c.initiativeId)));
      // Only a CURRENT validated baseline counts: stale, rejected and unvalidated never do (REQ-PB-055).
      for (const c of cases)
        if (c.baselineValidation !== "validated")
          missing.push(item("g4.finance_validation_missing", "Finance validation", c.pointer));
      const caseIds = new Set(cases.map((c) => c.id));
      for (const l of kpi.benefitLines)
        if (caseIds.has(l.businessCaseId) && l.formulaValidation !== "validated")
          missing.push(item("g4.finance_validation_missing", "Finance validation", l.pointer));
      return { missing };
    },
  ],
  [
    "g4.prioritization",
    (f) => {
      const scope = scopeOf(f);
      const p = f?.portfolio;
      if (scope === undefined || p?.ranking === undefined || p.activeWeightSet === undefined)
        return NOT_LOADED("Prioritization", "g4.prioritization_missing");
      if (p.ranking === null || p.activeWeightSet === null || p.ranking.weightSetId !== p.activeWeightSet.id)
        return { missing: [item("g4.prioritization_missing", "Prioritization", "/prioritization")] };
      const complete = new Set(
        p.ranking.entries.filter((e) => e.completeness === "complete").map((e) => e.initiativeId),
      );
      return {
        missing: scope
          .filter((i) => !complete.has(i.id))
          .map((i) => item("g4.score_incomplete", `Score incomplete: ${named(i)}`, at(i))),
      };
    },
  ],
  [
    "g4.roadmap",
    (f) => {
      const scope = scopeOf(f);
      const conflicts = f?.portfolio.scheduleConflicts;
      const unknowns = f?.portfolio.scheduleUnknowns;
      if (scope === undefined || conflicts === undefined || unknowns === undefined)
        return NOT_LOADED("Roadmap", "g4.roadmap_missing");
      const missing: Warning[] = [];
      for (const i of scope)
        if (i.waveId === null || i.plannedStart === null || i.plannedEnd === null || i.approvedMilestones === 0)
          missing.push(item("g4.roadmap_missing", `Roadmap: ${named(i)}`, at(i)));
      // A dependency cycle cannot exist: the dependency_acyclic guard refuses it at write time (ADR-0023 §5).
      for (const c of conflicts)
        missing.push(item("g4.schedule_conflict", `Schedule conflict: ${c.code}`, `/dependencies/${c.dependencyId}`));
      // An Unknown schedule (schedule.unknown) is a missing item too, never "no conflict" (D-079; ADR-0021 §10 rule 6).
      for (const u of unknowns)
        missing.push(item("g4.schedule_unknown", `Schedule unknown: ${u.code}`, `/dependencies/${u.dependencyId}`));
      return { missing };
    },
  ],
  [
    "g4.owners",
    (f) => {
      const scope = scopeOf(f);
      if (scope === undefined) return NOT_LOADED("Owners", "g4.owner_missing");
      return {
        missing: scope
          .filter((i) => i.executiveOwnerUserId === null || i.workstreamLeadUserId === null)
          .map((i) => item("g4.owner_missing", `Owners: ${named(i)}`, at(i))),
      };
    },
  ],
  [
    "g4.funding",
    (f) => {
      const scope = scopeOf(f);
      if (scope === undefined) return NOT_LOADED("Funding", "g4.funding_missing");
      return {
        missing: scope
          .filter((i) => i.fundingState !== "funded")
          .map((i) => item("g4.funding_missing", `Funding decision missing: ${named(i)}`, at(i))),
      };
    },
  ],
  [
    "g4.capacity",
    (f) => {
      const scope = scopeOf(f);
      const conflicts = f?.portfolio.capacityConflicts;
      if (scope === undefined || conflicts === undefined)
        return NOT_LOADED("Capacity", "g4.capacity_commitment_missing");
      const missing: Warning[] = [];
      for (const i of scope)
        if (i.committedDemandIds.length === 0)
          missing.push(item("g4.capacity_commitment_missing", `Capacity commitment missing: ${named(i)}`, at(i)));
      for (const c of conflicts)
        missing.push(
          item(
            "g4.capacity_conflict",
            `Capacity conflict: ${c.roleLabel} ${c.periodMonth.slice(0, 7)}`,
            `/resource-roles/${c.resourceRoleId}`,
          ),
        );
      return { missing };
    },
  ],
];

// ------------------------------------------------------------------------------------------------ snapshot

/**
 * The G4 part of a gate submission's frozen snapshot (ADR-0021 §7 "Snapshot"), called by gates.ts when G4 is
 * submitted (inside the submitting transaction): the in-scope initiative ids and versions with their wave, the ranking
 * snapshot id, the active weight-set version, case ids and versions, formula version ids with their validation state,
 * funding decision ids and committed demand ids. G1-G3 snapshots never call it, so they stay byte-stable.
 */
export async function buildG4Snapshot(
  db: DbOrTx,
  provider: GateFactsProvider,
  transformationId: string,
): Promise<Record<string, unknown> | null> {
  const { portfolio, kpi } = await loadG4Facts(db, provider, transformationId);
  const scope = portfolio.initiatives ?? [];
  const ids = new Set(scope.map((i) => i.id));
  const cases = [
    ...(kpi.transformationCase ? [kpi.transformationCase] : []),
    ...(kpi.initiativeCases ?? []).filter((c) => c.initiativeId !== null && ids.has(c.initiativeId)),
  ];
  const caseIds = new Set(cases.map((c) => c.id));
  return {
    initiatives: scope.map((i) => ({ id: i.id, code: i.code, version: i.version, status: i.status, waveId: i.waveId })),
    rankingSnapshotId: portfolio.ranking?.snapshotId ?? null,
    weightSet: portfolio.activeWeightSet ?? null,
    businessCases: cases.map((c) => ({
      id: c.id,
      code: c.code,
      version: c.version,
      baselineValidation: c.baselineValidation,
    })),
    formulaVersions: (kpi.benefitLines ?? [])
      .filter((l) => caseIds.has(l.businessCaseId))
      .map((l) => ({
        lineId: l.lineId,
        formulaId: l.benefitFormulaId,
        versionId: l.currentVersionId,
        versionNo: l.currentVersionNo,
        validation: l.formulaValidation,
      })),
    fundingDecisionIds: scope.map((i) => i.fundingDecisionId).filter((x): x is string => x !== null),
    committedDemandIds: scope.flatMap((i) => i.committedDemandIds),
  };
}
