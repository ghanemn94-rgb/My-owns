// Dependency Map (T08) API hooks (T-DG3-FE-B; ADR-0023 §4-§5). The T08 rows live on the canonical dependency record at
// /api/v1/dependencies (the DG2 paths under /transformations/{id}/dependencies are not used here). Keys: p3Keys.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { fetchAllPages, p3Keys, shouldRetry } from "../../api/queries.ts";
import type { T08Dependency } from "../roadmap/api.ts";

/** Contract `DependencyType` (no shared mirror; typed from docs/api/openapi.yaml). */
export interface DependencyType {
  readonly id: string;
  readonly code: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly isSystem: boolean;
  readonly sourceRef: string | null;
  readonly ordinal: number;
  readonly status: "active" | "retired";
  readonly version: number;
}

/** One node of the 422 dependency.cycle problem's `cycle` extension (first node repeated at the end). */
export interface CycleNode {
  readonly initiativeId: string;
  readonly code: string;
  readonly name?: string;
}

export function useT08Dependencies(tid: string) {
  return useQuery({
    queryKey: p3Keys.dependencies(tid),
    queryFn: () => fetchAllPages<T08Dependency>("/api/v1/dependencies", { transformationId: tid }),
    retry: shouldRetry,
  });
}

export function useDependencyTypes() {
  return useQuery({
    queryKey: p3Keys.dependencyTypes,
    queryFn: async () => (await api.get<{ items: DependencyType[] }>("/api/v1/dependency-types")).items,
    retry: shouldRetry,
  });
}

export const dependencyUrls = {
  collection: "/api/v1/dependencies",
  item: (id: string) => `/api/v1/dependencies/${id}`,
  archive: (id: string) => `/api/v1/dependencies/${id}/archive`,
  types: "/api/v1/dependency-types",
  type: (code: string) => `/api/v1/dependency-types/${code}`,
};
