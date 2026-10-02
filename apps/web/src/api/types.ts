// Response types of the P1 and P2 contracts (docs/api/openapi.yaml), taken from the shared zod mirrors so the web and the
// API agree on one definition (ADR-0007).
import type { z } from "zod";
import type {
  AuditEvent,
  BusinessUnit,
  Me,
  Organization,
  Role,
  RoleAssignment,
  Transformation,
  User,
  permissionEntry,
  baseline,
  capabilityHeatmapEntry,
  charter,
  charterVersion,
  charterView,
  decision,
  decisionOption,
  dependency,
  diagnosticFinding,
  diagnosticItem,
  evidence,
  evidenceLink,
  gateCriterionEvaluation,
  gateDecision,
  gateSubmission,
  gateSubmissionView,
  gateView,
  journey,
  journeyPainPoint,
  kpiDefinition,
  methodologyCatalogue,
  northStar,
  outcome,
  outcomeKpi,
  strategicGuardrail,
  teamAssignment,
  tomCanvasCellView,
  tomGap,
  tomWorkshop,
  tomWorkshopItem,
  valuePool,
  workstreamOutput,
  actionItem,
} from "@mth/shared/schemas";

export type { AuditEvent, BusinessUnit, Me, Organization, Role, RoleAssignment, Transformation, User };
export type PermissionEntry = z.infer<typeof permissionEntry>;

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export type TransformationSort =
  | "updatedAt:desc"
  | "updatedAt:asc"
  | "name:asc"
  | "name:desc"
  | "code:asc"
  | "code:desc";

// ------------------------------------------------------------------------------------------------ P2 (DG2)
// Response types of the P2 contract, inferred from the shared zod mirrors (BE + KBE; docs/api/openapi.yaml).

export type MethodologyCatalogue = z.infer<typeof methodologyCatalogue>;
export type DiagnosticDimension = MethodologyCatalogue["diagnosticDimensions"][number];
export type DiagnosticWorkstream = MethodologyCatalogue["diagnosticWorkstreams"][number];
export type TomDimension = MethodologyCatalogue["tomDimensions"][number];
export type GateDefinition = MethodologyCatalogue["gateDefinitions"][number];
export type CharterScopeCheckDefinition = MethodologyCatalogue["charterScopeChecks"][number];
export type GoodOutcomeCriterion = MethodologyCatalogue["goodOutcomeCriteria"][number];
export type DiagnosticItem = z.infer<typeof diagnosticItem>;
export type DiagnosticFinding = z.infer<typeof diagnosticFinding>;
export type WorkstreamOutput = z.infer<typeof workstreamOutput>;
export type Baseline = z.infer<typeof baseline>;
export type ValuePool = z.infer<typeof valuePool>;
export type KpiDefinition = z.infer<typeof kpiDefinition>;
export type OutcomeKpi = z.infer<typeof outcomeKpi>;
export type Charter = z.infer<typeof charter>;
export type CharterVersion = z.infer<typeof charterVersion>;
export type CharterView = z.infer<typeof charterView>;
export type NorthStar = z.infer<typeof northStar>;
export type Outcome = z.infer<typeof outcome>;
export type StrategicGuardrail = z.infer<typeof strategicGuardrail>;
export type TomGap = z.infer<typeof tomGap>;
export type CapabilityHeatmapEntry = z.infer<typeof capabilityHeatmapEntry>;
export type Journey = z.infer<typeof journey>;
export type JourneyPainPoint = z.infer<typeof journeyPainPoint>;
export type TomCanvasCellView = z.infer<typeof tomCanvasCellView>;
export type TomWorkshop = z.infer<typeof tomWorkshop>;
export type TomWorkshopItem = z.infer<typeof tomWorkshopItem>;
export type Dependency = z.infer<typeof dependency>;
export type ActionItem = z.infer<typeof actionItem>;
export type Decision = z.infer<typeof decision>;
export type DecisionOption = z.infer<typeof decisionOption>;
export type GateView = z.infer<typeof gateView>;
export type GateCriterionEvaluation = z.infer<typeof gateCriterionEvaluation>;
export type GateSubmission = z.infer<typeof gateSubmission>;
export type GateSubmissionView = z.infer<typeof gateSubmissionView>;
export type GateDecision = z.infer<typeof gateDecision>;
export type Evidence = z.infer<typeof evidence>;
export type EvidenceLink = z.infer<typeof evidenceLink>;
export type TeamAssignment = z.infer<typeof teamAssignment>;
