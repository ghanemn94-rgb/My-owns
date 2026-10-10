// Slice H change-control web seams (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0036; BE-L, BE-R2): the change-control
// policy (version 0 before it is configured, ADR-0036 A1), change requests, the live impact preview and the frozen
// impact assessments. Query keys live under FE-A's `p4Keys.area("change-requests", tid, …)`, so `useP4Refresh(tid)`
// refreshes every one of them after a mutation. SYNTHETIC data only in tests and demos.
//
// A change request is decided by a person through the canonical business approval (`/my-work/approvals/{id}`), routed
// by T11 (ADR-0036 §4). Nothing here approves anything, and nothing touches the engineering gates DG0-DG7.
import { useQuery } from "@tanstack/react-query";
import type {
  ChangeControlPolicy,
  ChangeKind,
  ChangeRequest,
  ChangeSubjectType,
  ImpactAssessment,
  ImpactItem,
  ImpactPreview,
} from "@mth/shared/schemas";
import { api, apiRequest } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  ChangeControlPolicy,
  ChangeKind,
  ChangeRequest,
  ChangeSubjectType,
  ImpactAssessment,
  ImpactItem,
  ImpactPreview,
};

const tBase = (tid: string) => `/api/v1/transformations/${tid}`;

/** The paths of the change-control operations the screens call (operationId in the comment). */
export const changePaths = {
  policy: (tid: string) => `${tBase(tid)}/change-control-policy`, // getChangeControlPolicy / putChangeControlPolicy
  list: (tid: string) => `${tBase(tid)}/change-requests`, // listChangeRequests / createChangeRequest
  preview: (tid: string) => `${tBase(tid)}/change-requests/impact-preview`, // previewChangeImpact
  one: (tid: string, id: string) => `${tBase(tid)}/change-requests/${id}`, // getChangeRequest / updateChangeRequest
  submit: (tid: string, id: string) => `${tBase(tid)}/change-requests/${id}/submit`, // submitChangeRequest
  withdraw: (tid: string, id: string) => `${tBase(tid)}/change-requests/${id}/withdraw`, // withdrawChangeRequest
  savedPreview: (tid: string, id: string) => `${tBase(tid)}/change-requests/${id}/impact-preview`, // getChangeRequestImpactPreview
  assessments: (tid: string, id: string) => `${tBase(tid)}/change-requests/${id}/impact-assessments`, // listImpactAssessments
  assessment: (tid: string, id: string) => `${tBase(tid)}/impact-assessments/${id}`, // getImpactAssessment
} as const;

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;

/** The policy with its ETag version: 0 (`ETag: "0"`) while none is configured; the first PUT sends `If-Match: "0"`. */
export interface PolicyRead {
  readonly policy: ChangeControlPolicy;
  readonly etagVersion: number;
}

/** Parses a strong ETag `"n"` (n ≥ 0); null when absent or malformed. */
export function etagVersionOf(etag: string | null): number | null {
  if (!etag) return null;
  const m = /^"(0|[1-9][0-9]{0,9})"$/.exec(etag);
  return m ? Number(m[1]) : null;
}

export function useChangeControlPolicy(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("change-requests", tid, "policy"),
    queryFn: async (): Promise<PolicyRead> => {
      const r = await apiRequest<ChangeControlPolicy>(changePaths.policy(tid));
      return { policy: r.data, etagVersion: etagVersionOf(r.etag) ?? r.data.version };
    },
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useChangeRequests(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("change-requests", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ChangeRequest>(changePaths.list(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useChangeRequest(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("change-requests", tid, "one", id),
    queryFn: () => api.get<ChangeRequest>(changePaths.one(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

/** The live preview of a saved request (computed now; nothing is frozen until submit). */
export function useSavedImpactPreview(tid: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: p4Keys.area("change-requests", tid, "preview", id),
    queryFn: () => api.get<ImpactPreview>(changePaths.savedPreview(tid, id)),
    enabled: Boolean(tid && id && enabled),
    ...opts,
  });
}

/** The frozen impact assessments of a request: one per submitted version, append-only. */
export function useImpactAssessments(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("change-requests", tid, "assessments", id),
    queryFn: () => fetchAllPages<ImpactAssessment>(changePaths.assessments(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

/** The routed party of each kind when no T11 row applies (ADR-0036 §4; shown before submit, the server decides). */
export const KIND_T11_ROW: Readonly<Record<ChangeKind, string | null>> = {
  business_scope: "business_scope_change",
  cost: "funding_reallocation",
  budget_rebaseline: "funding_reallocation",
  tom: "target_state_design",
  baseline: null,
  target: null,
  kpi_definition: null,
  benefit_logic: null,
  schedule_rebaseline: null,
};

/** The materiality basis as the screen shows it (ADR-0036 §3); unknown members stay null, never 0. */
export interface MaterialityBasisView {
  readonly rule: string | null;
  readonly shiftWorkingDays: number | null;
  readonly ratio: string | null;
  readonly threshold: string | null;
  readonly reason: string | null;
}

export function materialityBasisOf(basis: Record<string, unknown> | null | undefined): MaterialityBasisView {
  const b = basis ?? {};
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null);
  const threshold = b["threshold"];
  return {
    rule: str("rule"),
    shiftWorkingDays: typeof b["shiftWorkingDays"] === "number" ? (b["shiftWorkingDays"] as number) : null,
    ratio: str("ratio"),
    threshold: typeof threshold === "number" ? String(threshold) : typeof threshold === "string" ? threshold : null,
    reason: str("reason"),
  };
}

/** One `{field, from, to}` row of a proposed change; non-`{from,to}` members (currency, versions) are kept as facts. */
export interface ProposedRow {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

export function proposedRowsOf(change: Record<string, unknown>): {
  rows: ProposedRow[];
  facts: [string, unknown][];
} {
  const rows: ProposedRow[] = [];
  const facts: [string, unknown][] = [];
  for (const [field, v] of Object.entries(change)) {
    if (typeof v === "object" && v !== null && "to" in v) {
      const x = v as { from?: unknown; to?: unknown };
      rows.push({ field, from: x.from ?? null, to: x.to ?? null });
    } else facts.push([field, v]);
  }
  return { rows, facts };
}
