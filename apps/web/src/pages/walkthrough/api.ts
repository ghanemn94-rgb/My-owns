// Demo environment and walkthrough web seams (T-DG5-FE-G; slice J: ADR-0050 §6-§7; REQ-S18-001, REQ-S18-004): the
// request paths of `getDemoEnvironmentStatus`, `requestDemoReset` and `getDemoWalkthrough` (getEnvironment is in
// components/demo-label), their query keys under ["p5", "feg", "demo", …], and the read hooks. The bodies have no
// @mth/shared mirror; the shapes below are the OpenAPI components DemoEnvironmentStatus, DemoDatasetRun,
// DemoResetRequest and DemoWalkthrough. The walkthrough guide only explains and links: it writes nothing.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";

export type AreaCode =
  | "my_work"
  | "executive_overview"
  | "transformations"
  | "playbook_procedures"
  | "strategy_kpis"
  | "target_operating_model"
  | "initiatives_roadmaps"
  | "governance"
  | "risks_actions"
  | "benefits_finance"
  | "change_adoption"
  | "evidence_reports"
  | "bau_improvement"
  | "administration";

export interface DemoDatasetRun {
  readonly runNo: number;
  readonly runKind: "seed" | "reset";
  readonly requestedVia: "cli" | "api";
  readonly requestedBy: string | null;
  readonly datasetCode: string;
  readonly datasetVersion: string;
  readonly syntheticClockAt: string;
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly checksumSha256: string;
  readonly coverage: Readonly<Record<string, number>>;
  readonly coverageComplete: boolean;
  readonly completedAt: string;
}

export interface DemoEnvironmentStatus {
  readonly kind: "production" | "demo";
  readonly latestRun: DemoDatasetRun | null;
  readonly resetConfigured: boolean;
  readonly version: number;
}

export interface DemoResetRequest {
  readonly status: "queued";
  readonly requestedAt: string;
  readonly requestedBy: string;
}

export interface DemoWalkthroughStep {
  readonly code: string;
  readonly ordinal: number;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly areaCode: AreaCode;
  readonly route: string;
  readonly completed: boolean;
}

export interface DemoWalkthrough {
  readonly transformationId: string | null;
  readonly steps: readonly DemoWalkthroughStep[];
  readonly completedCount: number;
  readonly total: number;
}

const v1 = "/api/v1";
export const demoPaths = {
  status: `${v1}/admin/environment`, // getDemoEnvironmentStatus
  resets: `${v1}/admin/environment/demo-resets`, // requestDemoReset
  walkthrough: `${v1}/demo/walkthrough`, // getDemoWalkthrough
};

export const demoKeys = {
  all: ["p5", "feg", "demo"] as const,
  status: ["p5", "feg", "demo", "status"] as const,
  walkthrough: (tid: string | null) => ["p5", "feg", "demo", "walkthrough", tid ?? ""] as const,
};

export function useDemoEnvironmentStatus() {
  return useQuery({
    queryKey: demoKeys.status,
    queryFn: () => api.get<DemoEnvironmentStatus>(demoPaths.status),
    retry: shouldRetry,
  });
}

export function useDemoWalkthrough(tid: string | null) {
  return useQuery({
    queryKey: demoKeys.walkthrough(tid),
    queryFn: () => api.get<DemoWalkthrough>(demoPaths.walkthrough, tid ? { transformationId: tid } : {}),
    retry: shouldRetry,
  });
}

/** The web area id (app/nav.ts) of an ADR-0049 §9 area code, for its translated label `nav.areas.<webId>.label`. */
export const AREA_WEB_ID: Readonly<Record<AreaCode, string>> = {
  my_work: "myWork",
  executive_overview: "executive",
  transformations: "transformations",
  playbook_procedures: "playbook",
  strategy_kpis: "strategy",
  target_operating_model: "tom",
  initiatives_roadmaps: "initiatives",
  governance: "governance",
  risks_actions: "risks",
  benefits_finance: "benefits",
  change_adoption: "change",
  evidence_reports: "evidence",
  bau_improvement: "bau",
  administration: "admin",
};
