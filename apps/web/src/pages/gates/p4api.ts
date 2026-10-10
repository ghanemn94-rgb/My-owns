// Slice H web seams of the gate screens (T-DG4-FE-F; p4-work-split §H H.6; ADR-0035 §3-§5, §11): the per-criterion
// review table of a submission (the nine M0124 fields; BE-K2), the criterion reviews, gate exceptions (request, decide,
// withdraw, revoke) and the approved G5 scale scope. Query keys live under FE-A's `p4Keys.area("gate-exceptions", tid,
// …)`, so `useP4Refresh(tid)` refreshes every one of them; the gate page also refreshes its P2 keys (the live view).
// SYNTHETIC data only in tests and demos. Every gate decision is a business approval inside the product (G1-G6), never
// an engineering delivery gate (DG0-DG7).
import { useQuery } from "@tanstack/react-query";
import type { GateCriterionReview, GateCriterionRowList, GateException, ScaleScope } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  GateCriterionReview,
  GateCriterionRow,
  GateCriterionRowList,
  GateException,
  ScaleScope,
} from "@mth/shared/schemas";

const tBase = (tid: string) => `/api/v1/transformations/${tid}`;

/** The paths of the slice H gate operations the screens call (operationId in the comment). */
export const gateP4Paths = {
  criteria: (tid: string, code: string, no: number) => `${tBase(tid)}/gates/${code}/submissions/${no}/criteria`, // listGateSubmissionCriteria
  reviews: (tid: string, code: string, no: number, key: string) =>
    `${tBase(tid)}/gates/${code}/submissions/${no}/criteria/${key}/reviews`, // listGateCriterionReviews / createGateCriterionReview
  exceptions: (tid: string) => `${tBase(tid)}/gate-exceptions`, // listGateExceptions / createGateException
  exception: (tid: string, id: string) => `${tBase(tid)}/gate-exceptions/${id}`, // getGateException
  exceptionDecision: (tid: string, id: string) => `${tBase(tid)}/gate-exceptions/${id}/decision`, // decideGateException
  exceptionWithdraw: (tid: string, id: string) => `${tBase(tid)}/gate-exceptions/${id}/withdraw`, // withdrawGateException
  exceptionRevoke: (tid: string, id: string) => `${tBase(tid)}/gate-exceptions/${id}/revoke`, // revokeGateException
  scaleScope: (tid: string) => `${tBase(tid)}/scale-scope`, // getScaleScope
} as const;

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;

/** The review table of one frozen submission (all nine fields per criterion; unreviewed fields are null). */
export function useSubmissionCriteria(tid: string, code: string, no: number | null) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "criteria", code, no ?? 0),
    queryFn: () => api.get<GateCriterionRowList>(gateP4Paths.criteria(tid, code, no!)),
    enabled: Boolean(tid && code && no),
    ...opts,
  });
}

/** Every review of one criterion of one submission (append-only; the latest one fills the table row). */
export function useCriterionReviews(tid: string, code: string, no: number, key: string, enabled: boolean) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "reviews", code, no, key),
    queryFn: () => fetchAllPages<GateCriterionReview>(gateP4Paths.reviews(tid, code, no, key)),
    enabled: Boolean(tid && enabled),
    ...opts,
  });
}

/** The gate exceptions of one gate (every status; `covering` is computed for today's business date by the server). */
export function useGateExceptions(tid: string, gateCode: string) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "list", gateCode),
    queryFn: () => fetchAllPages<GateException>(gateP4Paths.exceptions(tid), { gateCode }),
    enabled: Boolean(tid && gateCode),
    ...opts,
  });
}

/** The latest approved G5 scale scope (`approved: false` with empty lists before G5). */
export function useScaleScope(tid: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "scale-scope"),
    queryFn: () => api.get<ScaleScope>(gateP4Paths.scaleScope(tid)),
    enabled: Boolean(tid && enabled),
    ...opts,
  });
}

/** The G3 snapshot member that records the Modular-links waiver a submission relied on (ADR-0038 amendment B1). */
export interface ModularLinksSnapshot {
  readonly missing: readonly string[];
  readonly waiver: { dispensationId: string; expiresOn: string; reason: string; decidedBy: string } | null;
}

/** Reads `snapshot.modularLinks` defensively (the contract types the snapshot as an object); null when absent. */
export function modularLinksOf(snapshot: Record<string, unknown>): ModularLinksSnapshot | null {
  const m = snapshot["modularLinks"];
  if (typeof m !== "object" || m === null) return null;
  const rec = m as Record<string, unknown>;
  const missing = Array.isArray(rec["missing"]) ? rec["missing"].filter((x): x is string => typeof x === "string") : [];
  const w = rec["waiver"];
  let waiver: ModularLinksSnapshot["waiver"] = null;
  if (typeof w === "object" && w !== null) {
    const r = w as Record<string, unknown>;
    if (typeof r["dispensationId"] === "string" && typeof r["expiresOn"] === "string")
      waiver = {
        dispensationId: r["dispensationId"],
        expiresOn: r["expiresOn"],
        reason: typeof r["reason"] === "string" ? r["reason"] : "",
        decidedBy: typeof r["decidedBy"] === "string" ? r["decidedBy"] : "",
      };
  }
  return { missing, waiver };
}

/** The exception recorded on a criterion entry of a frozen snapshot (ADR-0035 §4), or null. */
export interface SnapshotException {
  readonly criterionKey: string;
  readonly id: string;
  readonly reason: string;
  readonly scope: string;
  readonly compensatingAction: string;
  readonly compensatingOwnerUserId: string;
  readonly expiresOn: string;
  readonly decidedBy: string;
}

/** The exception lines frozen into a submission's snapshot (criteria entries with an `exception` member). */
export function snapshotExceptionsOf(snapshot: Record<string, unknown>): SnapshotException[] {
  const criteria = snapshot["criteria"];
  if (!Array.isArray(criteria)) return [];
  const out: SnapshotException[] = [];
  for (const c of criteria) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    const e = rec["exception"];
    if (typeof e !== "object" || e === null) continue;
    const x = e as Record<string, unknown>;
    const str = (k: string) => (typeof x[k] === "string" ? (x[k] as string) : "");
    out.push({
      criterionKey: typeof rec["key"] === "string" ? rec["key"] : str("criterionKey"),
      id: str("id"),
      reason: str("reason"),
      scope: str("scope"),
      compensatingAction: str("compensatingAction"),
      compensatingOwnerUserId: str("compensatingOwnerUserId"),
      expiresOn: str("expiresOn"),
      decidedBy: str("decidedBy"),
    });
  }
  return out;
}
