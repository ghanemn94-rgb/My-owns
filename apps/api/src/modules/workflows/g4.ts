// Product gate G4 "Is the portfolio executable and value-backed?" (B0023; ADR-0021 §7). STUB created by T-DG3-BE-A
// (p3-work-split §2); BE-E fills in the eight g4.* evaluators and the G4 snapshot builder.
//
// workflows must not import portfolio (no module cycle, ADR-0021 §1). The G4 evaluators therefore read their facts
// through the GateFactsProvider interface defined HERE, which server.ts wires at start-up with portfolio's
// (portfolio/gate-facts.ts) and kpi's (kpi/p3-gate-facts.ts, KBE-C) loaders - dependency injection, no import.
//
// G4 is a BUSINESS approval inside the product, decided by a person; it never implies an engineering gate DG0-DG7.
import type { DbOrTx } from "@mth/db";

/** Portfolio facts for the G4 criteria (BE-E refines the shape; portfolio/gate-facts.ts loads it). */
export interface PortfolioGateFacts {
  readonly transformationId: string;
  readonly [fact: string]: unknown;
}

/** kpi facts for the G4 criteria: business cases, Finance validation, formula versions (KBE-C refines the shape). */
export interface KpiP3GateFacts {
  readonly transformationId: string;
  readonly [fact: string]: unknown;
}

/** The P3 fact loaders the G4 evaluators read through (wired by server.ts). */
export interface GateFactsProvider {
  readonly portfolio: (db: DbOrTx, transformationId: string) => Promise<PortfolioGateFacts>;
  readonly kpi: (db: DbOrTx, transformationId: string) => Promise<KpiP3GateFacts>;
}

/** The provider before anything is wired: no facts, so every G4 criterion stays incomplete (fail closed). */
export const UNWIRED_GATE_FACTS: GateFactsProvider = Object.freeze({
  portfolio: async (_db: DbOrTx, transformationId: string) => ({ transformationId }),
  kpi: async (_db: DbOrTx, transformationId: string) => ({ transformationId }),
});

/**
 * The G4 part of a gate submission's frozen snapshot (ADR-0021 §7 "Snapshot"), called by gates.ts when G4 is
 * submitted. STUB: null (nothing added) until BE-E builds it; G1-G3 snapshots never call it, so they stay byte-stable.
 */
export async function buildG4Snapshot(
  _db: DbOrTx,
  _provider: GateFactsProvider,
  _transformationId: string,
): Promise<Record<string, unknown> | null> {
  return null;
}
