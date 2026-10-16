// transformations (ADR-0002): transformation records, the P2 registers of Diagnose/Define/Design (T01, findings,
// workstream outputs, outcomes, guardrails, T03, capability heatmap, journeys), the charter and the North Star; the
// register kit other business modules reuse; and the phase advance that only an approved product gate may trigger.
export { GOVERNED_TARGET_STATUSES, isAllowedTransition, registerTransformationRoutes } from "./routes.ts";
export { findTransformation, toTransformation } from "./repository.ts";
export {
  assertActiveUsers,
  assertCatalogueCode,
  assertSameTransformation,
  bumpStamps,
  loose,
  maybeIdempotent,
  openWrite,
  registerRegister,
  registerUpdaterOf, // T-DG5-BE-E2: each kit register's own update function, for the forms bulk edit (ADR-0041 §5)
  sendCreated,
  writableTransformation,
  type LooseRow,
  type RegisterUpdateInput,
  type RegisterUpdater,
  type ParentSpec,
  type RegisterRow,
  type RegisterPresenter,
  type RegisterSpec,
  type RegisterSpecBase,
  type WriteContext,
} from "./register-kit.ts";
export {
  col,
  pick,
  ruleProblem,
  toCapability,
  toDiagnosticFinding,
  toDiagnosticItem,
  toJourney,
  presentOutcomes,
  toOutcome,
  toStrategicGuardrail,
  toTomGap,
} from "./registers.ts";
export { charterView, findCharter, findCurrentNorthStar, hasExclusions, toCharter, toNorthStar } from "./charter.ts";
export { advancePhaseOnGateApproval } from "./phase.ts";
// P5 (T-DG5-BE-D; ADR-0041 §4): the TransformationInitializer port (the forms pin of a new transformation).
export {
  registerTransformationInitializer,
  type TransformationInitContext,
  type TransformationInitializer,
} from "./initializers.ts";
export {
  activityLead,
  evaluateGoodOutcome,
  loadGoodOutcomeEvaluations,
  loadGoodOutcomeFacts,
  type GoodOutcomeCriterionDef,
  type GoodOutcomeEvaluation,
  type GoodOutcomeInputs,
} from "./good-outcome.ts";
// P4 (T-DG4-BE-M2; ADR-0038 §7.3): the read-only facts of the Modular-entry missing-link rule, read by reporting's
// missing-link report and by workflows' Modular G3 precondition (neither imports the other).
export { loadMissingLinkFacts, loadModularEntryFacts, type ModularEntryFacts } from "./missing-links-facts.ts";
