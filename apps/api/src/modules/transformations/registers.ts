// The transformations module's P2 registers (ADR-0016 §1, ADR-0017; p2-work-split §2), each a typed table with its
// source-faithful columns and validation rule, served through the register kit:
//   strategic guardrails (B0035), outcomes (B0048), T01 Current-State Diagnostic (B0031), diagnostic findings and
//   workstream outputs (B0029), T03 TOM Gap Matrix (B0058), capability heatmap, journeys/processes and pain points.
import type {
  CapabilityTable,
  DiagnosticFindingTable,
  DiagnosticItemTable,
  DiagnosticWorkstreamOutputTable,
  JourneyPainPointTable,
  JourneyTable,
  OutcomeTable,
  StrategicGuardrailTable,
  TomGapTable,
} from "@mth/db";
import {
  capabilityHeatmapEntryCreate,
  capabilityHeatmapEntryUpdate,
  diagnosticFindingCreate,
  diagnosticFindingUpdate,
  diagnosticItemCreate,
  diagnosticItemUpdate,
  journeyCreate,
  journeyPainPointCreate,
  journeyPainPointUpdate,
  journeyUpdate,
  outcomeCreate,
  outcomeUpdate,
  strategicGuardrailCreate,
  strategicGuardrailUpdate,
  tomGapCreate,
  tomGapUpdate,
  workstreamOutputCreate,
  workstreamOutputUpdate,
  type CapabilityHeatmapEntry,
  type DiagnosticFinding,
  type DiagnosticItem,
  type Journey,
  type JourneyPainPoint,
  type JourneyStep,
  type Outcome,
  type StrategicGuardrail,
  type TomGap,
  type WorkstreamOutput,
} from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import type { z } from "zod";
import { HttpProblem, iso, isoOrNull } from "../platform/index.ts";
import {
  assertActiveUsers,
  assertCatalogueCode,
  assertSameTransformation,
  loose,
  type LooseRow,
  type RegisterSpec,
} from "./register-kit.ts";

const T = "/api/v1/transformations/:transformationId";

/** A 422 business-rule problem with one field pointer. */
export function ruleProblem(code: string, detail: string, pointer: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code: `validation.${code}`, message: detail }],
  });
}

/** Copies the body properties that are present into columns (`undefined` = not sent = unchanged). */
export function pick(
  body: object,
  map: ReadonlyArray<readonly [string, string]>,
  transform?: ReadonlyMap<string, (v: unknown) => unknown>,
): LooseRow {
  const present = new Map(Object.entries(body));
  const out: [string, unknown][] = [];
  for (const [field, column] of map) {
    if (!present.has(field)) continue;
    const value = present.get(field);
    if (value === undefined) continue;
    const fn = transform?.get(field);
    out.push([column, fn ? fn(value) : value]);
  }
  return Object.fromEntries(out);
}

/** Merged-row reader without computed member access (F-DG1-124). */
export const col = (row: LooseRow, column: string): unknown => new Map(Object.entries(row)).get(column);

const stamps = (r: {
  id: string;
  organization_id: string;
  transformation_id: string;
  version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}) => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});
const archiveOf = (r: { archived_at: Date | null; archived_by: string | null; archive_reason: string | null }) => ({
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
});

// ------------------------------------------------------------------------------------------------ guardrails

type GuardrailRow = Selectable<StrategicGuardrailTable>;
const GUARDRAIL_COLS = [
  ["title", "title"],
  ["category", "category"],
  ["statement", "statement"],
  ["ownerUserId", "owner_user_id"],
] as const;
export const toStrategicGuardrail = (r: GuardrailRow): StrategicGuardrail => ({
  ...stamps(r),
  title: r.title,
  category: r.category as StrategicGuardrail["category"],
  statement: r.statement,
  ownerUserId: r.owner_user_id,
  status: r.status as StrategicGuardrail["status"],
  ...archiveOf(r),
});
export const strategicGuardrailRegister: RegisterSpec<GuardrailRow, StrategicGuardrail> = {
  table: "strategic_guardrail",
  path: `${T}/strategic-guardrails`,
  idParam: "strategicGuardrailId",
  writeRules: [{ permission: "charter.edit" }],
  createSchema: strategicGuardrailCreate,
  updateSchema: strategicGuardrailUpdate,
  toApi: toStrategicGuardrail,
  insertValues: (b: z.infer<typeof strategicGuardrailCreate>) => pick(b, GUARDRAIL_COLS),
  updateValues: (b: z.infer<typeof strategicGuardrailUpdate>) => pick(b, GUARDRAIL_COLS),
  check: (m, ctx) =>
    assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]),
  auditFields: ["title", "category", "statement", "owner_user_id", "status"],
  archive: {},
};

// ------------------------------------------------------------------------------------------------ outcomes

type OutcomeRow = Selectable<OutcomeTable>;
const OUTCOME_COLS = [
  ["parentOutcomeId", "parent_outcome_id"],
  ["statement", "statement"],
  ["description", "description"],
  ["ownerUserId", "owner_user_id"],
  ["isTopOutcome", "is_top_outcome"],
  ["topRank", "top_rank"],
  ["specificConfirmed", "specific_confirmed"],
  ["strategicallyRelevantConfirmed", "strategically_relevant_confirmed"],
  ["causalChain", "causal_chain"],
] as const;
export const toOutcome = (r: OutcomeRow): Outcome => ({
  ...stamps(r),
  parentOutcomeId: r.parent_outcome_id,
  statement: r.statement,
  description: r.description,
  ownerUserId: r.owner_user_id,
  isTopOutcome: r.is_top_outcome,
  topRank: r.top_rank,
  specificConfirmed: r.specific_confirmed,
  strategicallyRelevantConfirmed: r.strategically_relevant_confirmed,
  causalChain: r.causal_chain,
  status: r.status as Outcome["status"],
  ...archiveOf(r),
});
export const outcomeRegister: RegisterSpec<OutcomeRow, Outcome> = {
  table: "outcome",
  path: `${T}/outcomes`,
  idParam: "outcomeId",
  writeRules: [{ permission: "outcome.edit" }],
  createSchema: outcomeCreate,
  updateSchema: outcomeUpdate,
  toApi: toOutcome,
  insertValues: (b: z.infer<typeof outcomeCreate>) => pick(b, OUTCOME_COLS),
  updateValues: (b: z.infer<typeof outcomeUpdate>) => pick(b, OUTCOME_COLS),
  check: async (m, ctx, current) => {
    const parent = col(m, "parent_outcome_id");
    if (current !== null && parent === current.id)
      throw ruleProblem("outcome.cycle", "An outcome cannot be its own parent.", "/parentOutcomeId");
    await assertSameTransformation(ctx.tx, "outcome", ctx.transformationId, parent, "/parentOutcomeId");
    if (col(m, "top_rank") !== null && col(m, "top_rank") !== undefined && col(m, "is_top_outcome") !== true)
      throw ruleProblem("outcome.rank_only_top", "Only a top outcome has a rank.", "/topRank");
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  auditFields: [...OUTCOME_COLS.map(([, c]) => c), "status"],
  archive: {},
};

// ------------------------------------------------------------------------------------------------ T01

type DiagnosticItemRow = Selectable<DiagnosticItemTable>;
const DIAGNOSTIC_ITEM_COLS = [
  ["currentState", "current_state"],
  ["evidenceBaseline", "evidence_baseline"],
  ["baselineId", "baseline_id"],
  ["rootCause", "root_cause"],
  ["impactText", "impact_text"],
  ["impactAmount", "impact_amount"],
  ["impactCurrency", "impact_currency"],
  ["impactKpiDefinitionId", "impact_kpi_definition_id"],
  ["confidence", "confidence"],
  ["ownerUserId", "owner_user_id"],
] as const;
export const toDiagnosticItem = (r: DiagnosticItemRow): DiagnosticItem => ({
  ...stamps(r),
  dimensionCode: r.dimension_code,
  isSeeded: r.is_seeded,
  currentState: r.current_state,
  evidenceBaseline: r.evidence_baseline,
  baselineId: r.baseline_id,
  rootCause: r.root_cause,
  impactText: r.impact_text,
  // Unknown impact stays null (never 0); amounts are exact decimal strings (ADR-0019).
  impactAmount: r.impact_amount,
  impactCurrency: r.impact_currency,
  impactKpiDefinitionId: r.impact_kpi_definition_id,
  confidence: r.confidence as DiagnosticItem["confidence"],
  ownerUserId: r.owner_user_id,
  status: r.status as DiagnosticItem["status"],
  ...archiveOf(r),
});
export const diagnosticItemRegister: RegisterSpec<DiagnosticItemRow, DiagnosticItem> = {
  table: "diagnostic_item",
  path: `${T}/diagnostic-items`,
  idParam: "diagnosticItemId",
  writeRules: [{ permission: "diagnostic.edit" }, { permission: "diagnostic.contribute", scope: "own" }],
  createSchema: diagnosticItemCreate,
  updateSchema: diagnosticItemUpdate,
  toApi: toDiagnosticItem,
  insertValues: (b: z.infer<typeof diagnosticItemCreate>) => ({
    dimension_code: b.dimensionCode,
    is_seeded: false,
    ...pick(b, DIAGNOSTIC_ITEM_COLS),
  }),
  updateValues: (b: z.infer<typeof diagnosticItemUpdate>) => pick(b, DIAGNOSTIC_ITEM_COLS),
  check: async (m, ctx) => {
    await assertCatalogueCode(ctx.tx, "diagnostic_dimension", col(m, "dimension_code"), "/dimensionCode");
    if ((col(m, "impact_amount") ?? null) !== null && (col(m, "impact_currency") ?? null) === null)
      throw ruleProblem(
        "t01.impact_currency_required",
        "An impact amount needs its currency (SAR).",
        "/impactCurrency",
      );
    if ((col(m, "impact_amount") ?? null) === null && (col(m, "impact_currency") ?? null) !== null)
      throw ruleProblem("t01.impact_amount_required", "A currency needs an impact amount.", "/impactAmount");
    await assertSameTransformation(ctx.tx, "baseline", ctx.transformationId, col(m, "baseline_id"), "/baselineId");
    await assertSameTransformation(
      ctx.tx,
      "kpi_definition",
      ctx.transformationId,
      col(m, "impact_kpi_definition_id"),
      "/impactKpiDefinitionId",
    );
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  auditFields: ["dimension_code", ...DIAGNOSTIC_ITEM_COLS.map(([, c]) => c), "status"],
  archive: {
    // The six seeded T01 rows exist for the life of the transformation (diagnostic_item_seeded_not_archived).
    refuse: (r) =>
      r.is_seeded
        ? ruleProblem("t01.seeded_not_archivable", "The six seeded T01 dimension rows cannot be archived.", "")
        : null,
  },
};

// ------------------------------------------------------------------------------------------------ findings

type FindingRow = Selectable<DiagnosticFindingTable>;
const FINDING_COLS = [
  ["workstreamCode", "workstream_code"],
  ["diagnosticItemId", "diagnostic_item_id"],
  ["kind", "kind"],
  ["statement", "statement"],
  ["detail", "detail"],
  ["confidence", "confidence"],
  ["ownerUserId", "owner_user_id"],
  ["status", "status"],
] as const;
export const toDiagnosticFinding = (r: FindingRow): DiagnosticFinding => ({
  ...stamps(r),
  workstreamCode: r.workstream_code,
  diagnosticItemId: r.diagnostic_item_id,
  kind: r.kind as DiagnosticFinding["kind"],
  statement: r.statement,
  detail: r.detail,
  confidence: r.confidence as DiagnosticFinding["confidence"],
  ownerUserId: r.owner_user_id,
  status: r.status as DiagnosticFinding["status"],
  ...archiveOf(r),
});
export const diagnosticFindingRegister: RegisterSpec<FindingRow, DiagnosticFinding> = {
  table: "diagnostic_finding",
  path: `${T}/diagnostic-findings`,
  idParam: "diagnosticFindingId",
  writeRules: [{ permission: "diagnostic.edit" }, { permission: "diagnostic.contribute", scope: "own" }],
  createSchema: diagnosticFindingCreate,
  updateSchema: diagnosticFindingUpdate,
  toApi: toDiagnosticFinding,
  insertValues: (b: z.infer<typeof diagnosticFindingCreate>) => pick(b, FINDING_COLS),
  updateValues: (b: z.infer<typeof diagnosticFindingUpdate>) => pick(b, FINDING_COLS),
  check: async (m, ctx, current) => {
    if (current === null && col(m, "status") === "archived")
      throw ruleProblem("record.archive_on_create", "A new finding cannot be archived.", "/status");
    await assertCatalogueCode(ctx.tx, "diagnostic_workstream", col(m, "workstream_code"), "/workstreamCode");
    await assertSameTransformation(
      ctx.tx,
      "diagnostic_item",
      ctx.transformationId,
      col(m, "diagnostic_item_id"),
      "/diagnosticItemId",
    );
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  transitions: new Map([
    ["draft", ["confirmed", "rejected"]],
    ["confirmed", ["draft", "rejected"]],
    ["rejected", ["draft"]],
  ]),
  auditFields: FINDING_COLS.map(([, c]) => c),
  archive: {},
};

// ------------------------------------------------------------------------------------------------ workstream outputs

type OutputRow = Selectable<DiagnosticWorkstreamOutputTable>;
const OUTPUT_COLS = [
  ["workstreamCode", "workstream_code"],
  ["title", "title"],
  ["outputKind", "output_kind"],
  ["recordType", "record_type"],
  ["recordId", "record_id"],
  ["evidenceId", "evidence_id"],
  ["note", "note"],
] as const;
export const toWorkstreamOutput = (r: OutputRow): WorkstreamOutput => ({
  ...stamps(r),
  workstreamCode: r.workstream_code,
  title: r.title,
  outputKind: r.output_kind,
  recordType: r.record_type as WorkstreamOutput["recordType"],
  recordId: r.record_id,
  evidenceId: r.evidence_id,
  note: r.note,
  status: r.status as WorkstreamOutput["status"],
  ...archiveOf(r),
});
export const workstreamOutputRegister: RegisterSpec<OutputRow, WorkstreamOutput> = {
  table: "diagnostic_workstream_output",
  path: `${T}/workstream-outputs`,
  idParam: "diagnosticWorkstreamOutputId",
  writeRules: [{ permission: "diagnostic.edit" }, { permission: "diagnostic.contribute", scope: "own" }],
  createSchema: workstreamOutputCreate,
  updateSchema: workstreamOutputUpdate,
  toApi: toWorkstreamOutput,
  insertValues: (b: z.infer<typeof workstreamOutputCreate>) => pick(b, OUTPUT_COLS),
  updateValues: (b: z.infer<typeof workstreamOutputUpdate>) => pick(b, OUTPUT_COLS),
  check: async (m, ctx) => {
    await assertCatalogueCode(ctx.tx, "diagnostic_workstream", col(m, "workstream_code"), "/workstreamCode");
    const recordType = (col(m, "record_type") ?? null) as string | null;
    const recordId = col(m, "record_id") ?? null;
    if ((recordType === null) !== (recordId === null))
      throw ruleProblem(
        "workstream_output.record_pair",
        "A linked record needs both its type and its id.",
        "/recordId",
      );
    if (recordId === null && (col(m, "evidence_id") ?? null) === null)
      throw ruleProblem(
        "workstream_output.target_required",
        "An output links a record, evidence, or both.",
        "/recordId",
      );
    if (recordType !== null)
      await assertSameTransformation(ctx.tx, recordType, ctx.transformationId, recordId, "/recordId");
    await assertSameTransformation(ctx.tx, "evidence", ctx.transformationId, col(m, "evidence_id"), "/evidenceId");
  },
  auditFields: [...OUTPUT_COLS.map(([, c]) => c), "status"],
  archive: {},
};

// ------------------------------------------------------------------------------------------------ T03

type TomGapRow = Selectable<TomGapTable>;
const TOM_GAP_COLS = [
  ["dimensionCode", "dimension_code"],
  ["currentState", "current_state"],
  ["targetState", "target_state"],
  ["gap", "gap"],
  ["designDecisionId", "design_decision_id"],
  ["ownerUserId", "owner_user_id"],
  ["status", "status"],
] as const;
export const toTomGap = (r: TomGapRow): TomGap => ({
  ...stamps(r),
  dimensionCode: r.dimension_code,
  currentState: r.current_state,
  targetState: r.target_state,
  gap: r.gap,
  designDecisionId: r.design_decision_id,
  ownerUserId: r.owner_user_id,
  status: r.status as TomGap["status"],
  ...archiveOf(r),
});
/** T03: a row without a TOM dimension is a 422 template violation (B0058), checked here and by NOT NULL. */
const tomGapCreateLenient = tomGapCreate.partial({ dimensionCode: true });
export const tomGapRegister: RegisterSpec<TomGapRow, TomGap> = {
  table: "tom_gap",
  path: `${T}/tom-gaps`,
  idParam: "tomGapId",
  writeRules: [{ permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }],
  createSchema: tomGapCreateLenient,
  updateSchema: tomGapUpdate,
  toApi: toTomGap,
  insertValues: (b: z.infer<typeof tomGapCreateLenient>) => ({ dimension_code: null, ...pick(b, TOM_GAP_COLS) }),
  updateValues: (b: z.infer<typeof tomGapUpdate>) => pick(b, TOM_GAP_COLS),
  check: async (m, ctx) => {
    if ((col(m, "dimension_code") ?? null) === null)
      throw ruleProblem("t03.dimension_required", "A T03 gap row needs its TOM dimension.", "/dimensionCode");
    await assertCatalogueCode(ctx.tx, "tom_dimension", col(m, "dimension_code"), "/dimensionCode");
    const decisionId = col(m, "design_decision_id") ?? null;
    if (decisionId !== null) {
      const d = await loose(ctx.tx)
        .selectFrom("decision")
        .select(["kind"])
        .where("id", "=", String(decisionId))
        .where("transformation_id", "=", ctx.transformationId)
        .executeTakeFirst();
      if (!d || d.kind !== "design")
        throw ruleProblem(
          "t03.design_decision",
          "The design decision must be a T04 design decision of this transformation.",
          "/designDecisionId",
        );
    }
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  transitions: new Map([
    ["open", ["resolved"]],
    ["resolved", ["open"]],
  ]),
  auditFields: TOM_GAP_COLS.map(([, c]) => c),
  archive: {},
};

// ------------------------------------------------------------------------------------------------ capability heatmap

type CapabilityRow = Selectable<CapabilityTable>;
const CAPABILITY_COLS = [
  ["name", "name"],
  ["description", "description"],
  ["dimensionCode", "dimension_code"],
  ["currentLevel", "current_level"],
  ["targetLevel", "target_level"],
  ["sourcingNeed", "sourcing_need"],
  ["ownerUserId", "owner_user_id"],
  ["tomGapId", "tom_gap_id"],
] as const;
export const toCapability = (r: CapabilityRow): CapabilityHeatmapEntry => ({
  ...stamps(r),
  name: r.name,
  description: r.description,
  dimensionCode: r.dimension_code,
  currentLevel: r.current_level,
  targetLevel: r.target_level,
  sourcingNeed: r.sourcing_need as CapabilityHeatmapEntry["sourcingNeed"],
  ownerUserId: r.owner_user_id,
  tomGapId: r.tom_gap_id,
  status: r.status as CapabilityHeatmapEntry["status"],
  ...archiveOf(r),
});
export const capabilityRegister: RegisterSpec<CapabilityRow, CapabilityHeatmapEntry> = {
  table: "capability",
  path: `${T}/capability-heatmap`,
  idParam: "capabilityId",
  writeRules: [{ permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }],
  createSchema: capabilityHeatmapEntryCreate,
  updateSchema: capabilityHeatmapEntryUpdate,
  toApi: toCapability,
  insertValues: (b: z.infer<typeof capabilityHeatmapEntryCreate>) => pick(b, CAPABILITY_COLS),
  updateValues: (b: z.infer<typeof capabilityHeatmapEntryUpdate>) => pick(b, CAPABILITY_COLS),
  check: async (m, ctx) => {
    await assertCatalogueCode(ctx.tx, "tom_dimension", col(m, "dimension_code"), "/dimensionCode");
    await assertSameTransformation(ctx.tx, "tom_gap", ctx.transformationId, col(m, "tom_gap_id"), "/tomGapId");
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  auditFields: [...CAPABILITY_COLS.map(([, c]) => c), "status"],
  archive: {},
};

// ------------------------------------------------------------------------------------------------ journeys

type JourneyRow = Selectable<JourneyTable>;
const JOURNEY_COLS = [
  ["name", "name"],
  ["kind", "kind"],
  ["state", "state"],
  ["description", "description"],
  ["dimensionCode", "dimension_code"],
  ["steps", "steps"],
  ["cycleTimeValue", "cycle_time_value"],
  ["cycleTimeUnit", "cycle_time_unit"],
  ["failureDemand", "failure_demand"],
  ["ownerUserId", "owner_user_id"],
  ["status", "status"],
] as const;
const JOURNEY_TRANSFORMS: ReadonlyMap<string, (v: unknown) => unknown> = new Map([
  ["steps", (v: unknown) => JSON.stringify(v)],
]);
export const toJourney = (r: JourneyRow): Journey => ({
  ...stamps(r),
  name: r.name,
  kind: r.kind as Journey["kind"],
  state: r.state as Journey["state"],
  description: r.description,
  dimensionCode: r.dimension_code,
  steps: (r.steps ?? []) as JourneyStep[],
  cycleTimeValue: r.cycle_time_value,
  cycleTimeUnit: r.cycle_time_unit as Journey["cycleTimeUnit"],
  failureDemand: r.failure_demand,
  ownerUserId: r.owner_user_id,
  status: r.status as Journey["status"],
  ...archiveOf(r),
});
export const journeyRegister: RegisterSpec<JourneyRow, Journey> = {
  table: "journey",
  path: `${T}/journeys`,
  idParam: "journeyId",
  writeRules: [{ permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }],
  createSchema: journeyCreate,
  updateSchema: journeyUpdate,
  toApi: toJourney,
  insertValues: (b: z.infer<typeof journeyCreate>) => pick(b, JOURNEY_COLS, JOURNEY_TRANSFORMS),
  updateValues: (b: z.infer<typeof journeyUpdate>) => pick(b, JOURNEY_COLS, JOURNEY_TRANSFORMS),
  check: async (m, ctx, current) => {
    if (current === null && col(m, "status") === "archived")
      throw ruleProblem("record.archive_on_create", "A new journey cannot be archived.", "/status");
    if (((col(m, "cycle_time_value") ?? null) === null) !== ((col(m, "cycle_time_unit") ?? null) === null))
      throw ruleProblem("journey.cycle_time_pair", "A cycle time needs both its value and its unit.", "/cycleTimeUnit");
    await assertCatalogueCode(ctx.tx, "tom_dimension", col(m, "dimension_code"), "/dimensionCode");
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  transitions: new Map([
    ["draft", ["active"]],
    ["active", ["draft"]],
  ]),
  auditFields: JOURNEY_COLS.map(([, c]) => c),
  archive: {},
};

type PainPointRow = Selectable<JourneyPainPointTable>;
const PAIN_POINT_COLS = [
  ["stepKey", "step_key"],
  ["description", "description"],
  ["diagnosticItemId", "diagnostic_item_id"],
] as const;
export const toJourneyPainPoint = (r: PainPointRow): JourneyPainPoint => ({
  ...stamps(r),
  journeyId: r.journey_id,
  stepKey: r.step_key,
  description: r.description,
  diagnosticItemId: r.diagnostic_item_id,
  status: r.status as JourneyPainPoint["status"],
  ...archiveOf(r),
});
export const journeyPainPointRegister: RegisterSpec<PainPointRow, JourneyPainPoint> = {
  table: "journey_pain_point",
  path: `${T}/journeys/:journeyId/pain-points`,
  idParam: "painPointId",
  parent: { param: "journeyId", column: "journey_id", table: "journey", archivable: true },
  writeRules: [{ permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }],
  createSchema: journeyPainPointCreate,
  updateSchema: journeyPainPointUpdate,
  toApi: toJourneyPainPoint,
  insertValues: (b: z.infer<typeof journeyPainPointCreate>) => pick(b, PAIN_POINT_COLS),
  updateValues: (b: z.infer<typeof journeyPainPointUpdate>) => pick(b, PAIN_POINT_COLS),
  check: async (m, ctx) => {
    const stepKey = col(m, "step_key") ?? null;
    if (stepKey !== null) {
      const j = await ctx.tx
        .selectFrom("journey")
        .select("steps")
        .where("id", "=", String(col(m, "journey_id")))
        .executeTakeFirst();
      const steps = ((j?.steps ?? []) as JourneyStep[]).map((s) => s.key);
      if (!steps.includes(String(stepKey)))
        throw ruleProblem("pain_point.step_unknown", "The step is not a step of this journey.", "/stepKey");
    }
    await assertSameTransformation(
      ctx.tx,
      "diagnostic_item",
      ctx.transformationId,
      col(m, "diagnostic_item_id"),
      "/diagnosticItemId",
    );
  },
  auditFields: [...PAIN_POINT_COLS.map(([, c]) => c), "status"],
  archive: {},
  ops: { get: false },
};

/** Every register of the transformations module, in registration order. */
export const TRANSFORMATION_REGISTERS = [
  strategicGuardrailRegister,
  outcomeRegister,
  diagnosticItemRegister,
  diagnosticFindingRegister,
  workstreamOutputRegister,
  tomGapRegister,
  capabilityRegister,
  journeyRegister,
  journeyPainPointRegister,
] as const;
