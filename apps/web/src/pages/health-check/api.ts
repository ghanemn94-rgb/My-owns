// Health-check web seams (T-DG5-FE-F; slice H: ADR-0048 §5-§11): the request paths of the 10 operations of the tag
// `health-checks` (operationId in the comment), their query keys under ["p5", "fef", …], and the read hooks. The shapes
// are the @mth/shared mirrors (health.ts KBE-G2, health/contract.ts KBE-G). The OpenAPI file is the source of truth.
//
// Incomplete is never zero: while any question is unanswered the score, its maximum and the band are null (REQ-S14-002).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HealthCheckQuestion, HealthCheckScheme } from "@mth/shared/calc";
import type { HealthCheck, HealthCheckSummary } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { HealthCheck, HealthCheckQuestion, HealthCheckScheme, HealthCheckSummary };

const v1 = "/api/v1";
const hBase = (tid: string) => `${v1}/transformations/${tid}/health-checks`;

export const healthPaths = {
  questions: `${v1}/health-check-questions`, // listHealthCheckQuestions
  schemes: `${v1}/admin/health-check-schemes`, // listHealthCheckSchemes
  scheme: (versionId: string) => `${v1}/admin/health-check-schemes/${versionId}`, // getHealthCheckScheme
  checks: (tid: string) => hBase(tid), // listHealthChecks, createHealthCheck
  check: (tid: string, id: string) => `${hBase(tid)}/${id}`, // getHealthCheck, updateHealthCheck
  answer: (tid: string, id: string, questionCode: string) =>
    `${hBase(tid)}/${id}/answers/${encodeURIComponent(questionCode)}`, // putHealthCheckAnswer
  actions: (tid: string, id: string) => `${hBase(tid)}/${id}/actions`, // putHealthCheckActions
  submit: (tid: string, id: string) => `${hBase(tid)}/${id}/submit`, // submitHealthCheck
};

export const healthKeys = {
  questions: ["p5", "fef", "health-questions"] as const,
  schemes: ["p5", "fef", "health-schemes"] as const,
  scheme: (versionId: string) => ["p5", "fef", "health-schemes", versionId] as const,
  all: (tid: string) => ["p5", "fef", "health", tid] as const,
  check: (tid: string, id: string) => ["p5", "fef", "health", tid, id] as const,
};

export function useHealthQuestions() {
  return useQuery({
    queryKey: healthKeys.questions,
    queryFn: async () => (await api.get<{ items: HealthCheckQuestion[] }>(healthPaths.questions)).items,
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useHealthSchemes() {
  return useQuery({
    queryKey: healthKeys.schemes,
    queryFn: () => fetchAllPages<HealthCheckScheme>(healthPaths.schemes),
    retry: shouldRetry,
  });
}

export function useHealthScheme(versionId: string | null | undefined) {
  return useQuery({
    queryKey: healthKeys.scheme(versionId ?? ""),
    queryFn: () => api.get<HealthCheckScheme>(healthPaths.scheme(versionId ?? "")),
    enabled: Boolean(versionId),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useHealthChecks(tid: string) {
  return useQuery({
    queryKey: [...healthKeys.all(tid), "list"],
    queryFn: () => fetchAllPages<HealthCheckSummary>(healthPaths.checks(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useHealthCheck(tid: string, id: string | null) {
  return useQuery({
    queryKey: healthKeys.check(tid, id ?? ""),
    queryFn: () => api.get<HealthCheck>(healthPaths.check(tid, id ?? "")),
    enabled: Boolean(tid && id),
    retry: shouldRetry,
  });
}

export function useHealthRefresh(tid: string): () => Promise<unknown> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: healthKeys.all(tid) });
}
