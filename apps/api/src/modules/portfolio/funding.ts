// STUB created by T-DG3-BE-A (p3-work-split §2): funding decisions (ADR-0023 §7) and the derived funding state.
// Owned and filled in by BE-E; portfolio/index.ts already calls registerFundingRoutes. Until BE-E lands,
// latestFundingState() answers "unfunded" (fail closed: a selected initiative is 'Selected - unfunded' and cannot launch).
// A funding decision is a BUSINESS approval recorded by a person (funding.approve); nothing here approves anything.
import type { DbOrTx } from "@mth/db";
import type { FundingState } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers the funding-decision routes and returns them as "METHOD /path" (none yet). */
export function registerFundingRoutes(_app: FastifyInstance, _deps: ModuleDeps): readonly string[] {
  return [];
}

/**
 * The funding state of an initiative, derived from its latest funding decision (ADR-0023 §7). STUB: always
 * "unfunded" until BE-E replaces it with the read of the latest current funding decision.
 */
export async function latestFundingState(_db: DbOrTx, _initiativeId: string): Promise<FundingState> {
  return "unfunded";
}
