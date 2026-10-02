// Contract exercises for the P2 kpi-module operations (owned by kpi-benefits-engineer; T-DG2-ARCH-01B seam).
// contract.test.ts (owned by backend-workflow-engineer) calls exerciseKpiOperations once, so kpi operations are
// exercised in the same test file whose coverage assertion counts them, without two agents editing one file.
// Every call must go through `ctx.mirrored` (contract + problem-mirror validation). Validate successful bodies with the
// kpi zod mirrors from @mth/shared/schemas here. Remove each exercised operation from p2-pending-kpi.ts.
import type { Res, RequestOptions, Session, TestApi, World } from "../../support/harness.ts";

export interface KpiContractContext {
  readonly api: TestApi;
  readonly world: World;
  readonly sessions: { readonly admin: Session; readonly office: Session };
  readonly mirrored: (method: string, url: string, opts?: RequestOptions) => Promise<Res<unknown>>;
}

/** P2 scaffold: no kpi operation is routed yet (all are listed in p2-pending-kpi.ts). */
export async function exerciseKpiOperations(_ctx: KpiContractContext): Promise<void> {}
