// Procedure web seams (T-DG5-FE-D; ADR-0042 §1–§7; REQ-S06-001, REQ-S06-002, REQ-S01-003): typed hooks over FE-A's
// `api/p5.ts` read hooks and paths. The definition shapes are the @mth/shared mirrors (BE-F); the instance shapes
// mirror docs/api/openapi.yaml `ProcedureInstance`, `ProcedureStepInstance`, `MyProcedureStep` and
// `MethodologyCoverage` (no shared mirror exists for them; the OpenAPI file is the source of truth).
//
// Unknown is data: a due date the business calendar cannot compute is null with its reason, and is shown as Unknown,
// never as a guessed date; `overdue: null` is Unknown, never "on time".
import type { ProcedureDefinition, ProcedureValidationReport } from "@mth/shared/schemas";
import {
  useMethodologyCoverage,
  useMyProcedureSteps,
  useProcedureDefinition,
  useProcedureDefinitions,
  useProcedureInstance,
  useProcedureInstances,
  type P5Query,
} from "../../api/p5.ts";

export type { ProcedureDefinition, ProcedureValidationReport };

export type ProcedureStepStatus = "pending" | "active" | "completed" | "skipped" | "not_applicable" | "cancelled";
export type ProcedureInstanceStatus = "active" | "completed" | "cancelled";
export type NextActionKind = "provide_input" | "link_evidence" | "complete_step" | "await_approval" | "none";

export interface ProcedureStepInstance {
  readonly stepKey: string;
  readonly ordinal: number;
  readonly parallelGroup: string | null;
  readonly stepKind: "task" | "approval";
  readonly nameEn: string;
  readonly nameAr: string;
  readonly status: ProcedureStepStatus;
  readonly assigneeRoleCode: string;
  readonly assigneeUserId: string | null;
  readonly dueDate: string | null;
  readonly dueDateUnknownReason: string | null;
  readonly overdue: boolean | null;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly skipReason: string | null;
  readonly approvalId: string | null;
  readonly missingInputs: readonly string[];
}

export interface ProcedureInstanceLink {
  readonly id: string;
  readonly stepKey: string | null;
  readonly linkKind: "output" | "evidence";
  readonly recordType: string;
  readonly recordId: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ProcedureInstance {
  readonly id: string;
  readonly transformationId: string | null;
  readonly procedureCode: string;
  readonly procedureDefinitionId: string;
  readonly methodologyVersionId: string;
  readonly versionNo: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly status: ProcedureInstanceStatus;
  readonly subjectRecordType: string | null;
  readonly subjectRecordId: string | null;
  readonly inputValues: Readonly<Record<string, unknown>>;
  readonly dueDate: string | null;
  readonly currentStepKeys: readonly string[];
  readonly missingInputs: readonly { key: string; labelEn: string; labelAr: string }[];
  readonly nextAction: {
    kind: NextActionKind;
    stepKey: string | null;
    messageKey: string;
    messageParams: Record<string, unknown>;
  };
  readonly steps: readonly ProcedureStepInstance[];
  readonly links: readonly ProcedureInstanceLink[];
  readonly launchedBy: string;
  readonly launchedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface MyProcedureStep {
  readonly instanceId: string;
  readonly transformationId: string | null;
  readonly procedureCode: string;
  readonly procedureNameEn: string;
  readonly procedureNameAr: string;
  readonly step: ProcedureStepInstance;
}

export interface MethodologyCoverageElement {
  readonly setCode: string;
  readonly stableKey: string;
  readonly sourceLabelEn: string;
  readonly labelAr: string;
  readonly sourceRef: string;
  readonly status: "covered" | "planned" | "not_covered";
  readonly links: readonly {
    targetKind: "form" | "procedure";
    targetCode: string;
    resolved: boolean;
    featureStatus: "working" | "planned";
  }[];
}

export interface MethodologyCoverage {
  readonly methodologyVersionId: string;
  readonly proceduresVersionId: string;
  readonly formSchemaVersionId: string;
  readonly totals: { covered: number; planned: number; notCovered: number; total: number };
  readonly elements: readonly MethodologyCoverageElement[];
}

export const useDefinitions = (query: P5Query = {}, enabled = true) =>
  useProcedureDefinitions<ProcedureDefinition>(query, enabled);
export const useDefinition = (code: string | undefined, versionId: string | null = null) =>
  useProcedureDefinition<ProcedureDefinition>(code, versionId);
export const useInstances = (query: P5Query = {}, enabled = true) =>
  useProcedureInstances<ProcedureInstance>(query, enabled);
export const useInstance = (instanceId: string | undefined) => useProcedureInstance<ProcedureInstance>(instanceId);
export const useMySteps = () => useMyProcedureSteps<MyProcedureStep>();
export const useCoverage = (versionId: string | null = null, enabled = true) =>
  useMethodologyCoverage<MethodologyCoverage>(versionId, enabled);

/** Step status → chip tone and icon (a pending step is waiting, never "done"; not applicable is neutral). */
export const STEP_STATUS_CHIP = {
  pending: ["neutral", "clock"],
  active: ["warn", "dot"],
  completed: ["good", "check"],
  skipped: ["closed", "archive"],
  not_applicable: ["closed", "archive"],
  cancelled: ["closed", "stop"],
} as const;

export const INSTANCE_STATUS_CHIP = {
  active: ["warn", "dot"],
  completed: ["good", "check"],
  cancelled: ["closed", "stop"],
} as const;
