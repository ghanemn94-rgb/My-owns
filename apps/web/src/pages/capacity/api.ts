// Capacity (T-DG3-FE-B; REQ-PB-059, REQ-S09-004; ADR-0023 §6). The API is BE-E's, built in parallel: these hooks
// follow docs/api/openapi.yaml (getCapacityPlan, listResourceDemands, commit/release) and are unit-tested with stubbed
// responses until BE-E's routes land. FTE values are exact decimal strings (contract `Fte`), never JSON numbers.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { fetchAllPages, p3Keys, shouldRetry } from "../../api/queries.ts";

/** Contract `ResourceRole`. */
export interface ResourceRole {
  readonly id: string;
  readonly code: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly status: "active" | "archived";
  readonly version: number;
}

/** Contract `CapacityPlanCell`. availableFte null = Unknown (no capacity row), never 0. */
export interface CapacityPlanCell {
  readonly resourceRoleId: string;
  readonly periodMonth: string;
  readonly availableFte: string | null;
  readonly demandFte: string;
  readonly committedDemandFte: string;
  readonly shortfallFte: string | null;
  readonly flag: "capacity.over_allocated" | "capacity.unknown" | null;
}

/** Contract `CapacityPlan`: the role × month grid. */
export interface CapacityPlan {
  readonly transformationId: string;
  readonly roles: readonly ResourceRole[];
  readonly cells: readonly CapacityPlanCell[];
}

/** Contract `ResourceDemand`. */
export interface ResourceDemand {
  readonly id: string;
  readonly transformationId: string;
  readonly initiativeId: string;
  readonly resourceRoleId: string;
  readonly periodMonth: string;
  readonly demandFte: string;
  readonly ownerUserId: string | null;
  readonly note: string | null;
  readonly status: "planned" | "committed" | "released" | "archived";
  readonly committedBy: string | null;
  readonly committedAt: string | null;
  readonly version: number;
}

export function useCapacityPlan(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.capacity(tid), "plan"] as const,
    queryFn: () => api.get<CapacityPlan>(`/api/v1/transformations/${tid}/capacity-plan`),
    retry: shouldRetry,
  });
}

export function useResourceDemands(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.capacity(tid), "demands"] as const,
    queryFn: () => fetchAllPages<ResourceDemand>("/api/v1/resource-demands", { transformationId: tid }),
    retry: shouldRetry,
  });
}

export const capacityUrls = {
  commit: (id: string) => `/api/v1/resource-demands/${id}/commit`,
  release: (id: string) => `/api/v1/resource-demands/${id}/release`,
};
