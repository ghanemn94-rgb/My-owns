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
 * The funding state of an initiative, derived from its LATEST funding decision (ADR-0023 §7; T-DG3-BE-B owns this
 * function, T-DG3-ARCH-02). funding_decision is append-only and the latest row per initiative (decided_at, then id)
 * decides: `approved` -> "funded"; `revoked` -> "revoked"; `rejected` / `deferred` -> "unfunded"; no decision at all
 * -> "unfunded" (fail closed: a selected initiative stays 'Selected - unfunded' and cannot launch). Read-only.
 */
export async function latestFundingState(db: DbOrTx, initiativeId: string): Promise<FundingState> {
  const latest = await db
    .selectFrom("funding_decision")
    .select("outcome")
    .where("initiative_id", "=", initiativeId)
    .orderBy("decided_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (latest === undefined) return "unfunded";
  if (latest.outcome === "approved") return "funded";
  if (latest.outcome === "revoked") return "revoked";
  return "unfunded";
}
