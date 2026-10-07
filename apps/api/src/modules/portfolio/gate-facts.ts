// STUB created by T-DG3-BE-A (p3-work-split §2): the portfolio part of workflows' GateFactsProvider (ADR-0021 §1, §7).
// Owned and filled in by BE-E (the G4 evaluators). server.ts already wires loadPortfolioGateFacts into the provider.
import type { DbOrTx } from "@mth/db";
import type { PortfolioGateFacts } from "../workflows/index.ts";

/** Portfolio facts for the G4 criteria. STUB: no facts yet (the G4 evaluators fail closed without them). */
export async function loadPortfolioGateFacts(_db: DbOrTx, transformationId: string): Promise<PortfolioGateFacts> {
  return { transformationId };
}
