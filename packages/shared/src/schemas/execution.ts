// P4 slice E mirrors of execution tracking: budget lines, the per-initiative execution view and the schedule network
// with the critical path (backend-workflow-engineer, T-DG4-BE-E; ADR-0031 §7-§11; OpenAPI 1.3.0-p4 BudgetLine*,
// Execution*, InitiativeExecution, WorkingDaySlip, Schedule*, InitiativeSchedule*). REQ-S09-007, REQ-S09-009.
//
// - Amounts are decimal strings (never JSON numbers) in the line's own currency; null is Unknown, never 0 (S-5). The
//   request shape accepts any OpenAPI `Decimal`; the API then refuses a negative amount or one that does not fit
//   numeric(20,4) with 422 `budget_line.amount_invalid` (ADR-0031 §7, §11), so nothing is rounded silently.
// - `periodMonth` is a business date; a date that is not the first of its month is 422 `budget_line.period_invalid`.
// - A slip, a total or a critical-path claim that cannot be computed is `unknown`/`not_computable` with its reason.
import { z } from "zod";
import { currency, freeText, page, reason, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal } from "./kpi.ts";
import { fte } from "./business-case.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();
const nullableDecimal = decimal.nullable();
const nullableTimestamp = timestamp.nullable();

/** ADR-0031 §11 refusal codes and their exact English texts (S-11). */
export const BUDGET_LINE_REFUSALS = {
  "budget_line.amount_invalid":
    "Amounts must be zero or more, with at most 16 digits before and 4 after the decimal point.",
  "budget_line.period_invalid": "The month must be given as its first day (YYYY-MM-01).",
  "budget_line.archived": "This budget line is archived and can no longer be changed.",
  "budget_line.duplicate": "An active budget line with this label and month already exists for the initiative.",
  "initiative_schedule.exists": "This initiative already has a planned duration; update it instead.",
} as const;

export const BUDGET_LINE_STATUSES = ["active", "archived"] as const;
export const budgetLineStatus = z.enum(BUDGET_LINE_STATUSES);

/** OpenAPI `BudgetLine`. */
export const budgetLine = z.strictObject({
  id: uuid,
  transformationId: uuid,
  initiativeId: uuid,
  label: z.string().min(1).max(200),
  periodMonth: nullableDate,
  currency,
  budgetAmount: nullableDecimal,
  actualAmount: nullableDecimal,
  forecastAmount: nullableDecimal,
  ownerUserId: nullableUuid,
  note: z.string().min(1).max(2000).nullable(),
  status: budgetLineStatus,
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type BudgetLine = z.infer<typeof budgetLine>;
export const budgetLinePage = page(budgetLine);

/** OpenAPI `BudgetLineCreate`. */
export const budgetLineCreate = z.strictObject({
  label: freeText(1, 200),
  periodMonth: nullableDate.optional(),
  budgetAmount: nullableDecimal.optional(),
  actualAmount: nullableDecimal.optional(),
  forecastAmount: nullableDecimal.optional(),
  ownerUserId: nullableUuid.optional(),
  note: freeText(1, 2000).nullable().optional(),
});
export type BudgetLineCreate = z.infer<typeof budgetLineCreate>;

/** OpenAPI `BudgetLineUpdate` (at least one property). */
export const budgetLineUpdate = z
  .strictObject({
    label: freeText(1, 200).optional(),
    periodMonth: nullableDate.optional(),
    budgetAmount: nullableDecimal.optional(),
    actualAmount: nullableDecimal.optional(),
    forecastAmount: nullableDecimal.optional(),
    ownerUserId: nullableUuid.optional(),
    note: freeText(1, 2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type BudgetLineUpdate = z.infer<typeof budgetLineUpdate>;

/** The archive body (OpenAPI `ReasonRequest`). */
export const budgetLineArchive = z.strictObject({ reason });

/** OpenAPI `ExecutionAmount`: known only when every active line of the currency has the operand(s). */
export const executionAmount = z.strictObject({
  status: z.enum(["known", "unknown"]),
  amount: nullableDecimal,
  knownAmount: nullableDecimal,
  missingCount: z.number().int().min(0).nullable(),
  reason: z.string().nullable(),
});
export type ExecutionAmount = z.infer<typeof executionAmount>;

/** OpenAPI `ExecutionBudgetTotal`: one currency, never converted. */
export const executionBudgetTotal = z.strictObject({
  currency,
  budget: executionAmount,
  actual: executionAmount,
  forecast: executionAmount,
  forecastVariance: executionAmount,
  actualVariance: executionAmount,
});
export type ExecutionBudgetTotal = z.infer<typeof executionBudgetTotal>;

export const WORKING_DAY_SLIP_REASONS = [
  "approved_date_missing",
  "forecast_date_missing",
  "calendar_not_configured",
  "range_too_long",
] as const;

/** OpenAPI `WorkingDaySlip`. */
export const workingDaySlip = z.strictObject({
  status: z.enum(["known", "unknown"]),
  value: z.number().int().nullable(),
  reason: z.enum(WORKING_DAY_SLIP_REASONS).nullable(),
});
export type WorkingDaySlip = z.infer<typeof workingDaySlip>;

/** OpenAPI `ExecutionMilestone`. */
export const executionMilestone = z.strictObject({
  milestoneId: uuid,
  title: z.string(),
  approvedDate: nullableDate,
  forecastDate: nullableDate,
  status: z.enum(["planned", "achieved", "missed", "cancelled"]),
  calendarVarianceDays: z.number().int().nullable(),
  slipWorkingDays: workingDaySlip,
});

/** OpenAPI `ExecutionDeliverable`. */
export const executionDeliverable = z.strictObject({
  deliverableId: uuid,
  title: z.string(),
  dueDate: nullableDate,
  acceptanceStatus: z.enum(["pending", "submitted", "accepted", "rejected"]),
});

/** OpenAPI `ExecutionDemand`. */
export const executionDemand = z.strictObject({
  resourceDemandId: uuid,
  resourceRoleId: uuid,
  periodMonth: businessDate,
  demandFte: fte,
  status: z.enum(["planned", "committed", "released", "archived"]),
  availableFte: fte.nullable(),
  capacityStatus: z.enum(["known", "unknown"]),
});

/** OpenAPI `ExecutionDependency`. */
export const executionDependency = z.strictObject({
  dependencyId: uuid,
  code: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  status: z.string(),
  neededBy: nullableDate,
  impact: z.enum(["high", "medium", "low"]).nullable(),
});

/** OpenAPI `ExecutionDecision`. */
export const executionDecision = z.strictObject({
  decisionId: uuid,
  code: z.string(),
  kind: z.enum(["design", "executive", "gate"]),
  status: z.string(),
  title: z.string(),
});

/** OpenAPI `InitiativeExecution` (REQ-S09-007), read from the canonical records. */
export const initiativeExecution = z.strictObject({
  initiativeId: uuid,
  calendarId: nullableUuid,
  milestones: z.array(executionMilestone),
  deliverables: z.array(executionDeliverable),
  budgetLineCount: z.number().int().min(0),
  budgetUnknownReason: z.enum(["no_budget_lines"]).nullable(),
  budgetTotals: z.array(executionBudgetTotal),
  demand: z.array(executionDemand),
  dependencies: z.array(executionDependency),
  decisions: z.array(executionDecision),
  onCriticalPath: z.boolean().nullable(),
});
export type InitiativeExecution = z.infer<typeof initiativeExecution>;

const offset = z.number().int().nullable();

/** OpenAPI `ScheduleNode`. */
export const scheduleNode = z.strictObject({
  initiativeId: uuid,
  code: z.string(),
  name: z.string(),
  durationWorkingDays: z.number().int().nullable(),
  earliestStart: offset,
  earliestFinish: offset,
  latestStart: offset,
  latestFinish: offset,
  totalFloat: offset,
  critical: z.boolean().nullable(),
});

/** OpenAPI `ScheduleEdge`. */
export const scheduleEdge = z.strictObject({
  dependencyId: uuid,
  code: z.string(),
  fromInitiativeId: uuid,
  toInitiativeId: uuid,
  critical: z.boolean().nullable(),
});

/** OpenAPI `ScheduleNetwork` (REQ-S09-009). */
export const scheduleNetwork = z.strictObject({
  transformationId: uuid,
  algorithm: z.enum(["cpm-fs/1"]),
  status: z.enum(["computed", "not_computable"]),
  reason: z.enum(["missing_durations", "no_initiatives", "cycle"]).nullable(),
  projectDurationWorkingDays: z.number().int().nullable(),
  missingDurations: z.array(z.strictObject({ initiativeId: uuid, code: z.string(), name: z.string() })),
  nodes: z.array(scheduleNode),
  edges: z.array(scheduleEdge),
  criticalPaths: z.array(z.array(uuid)).max(20),
  truncated: z.boolean(),
});
export type ScheduleNetwork = z.infer<typeof scheduleNetwork>;

const durationWorkingDays = z.number().int().min(0).max(2600).nullable();

/** OpenAPI `InitiativeSchedule`. */
export const initiativeSchedule = z.strictObject({
  id: uuid,
  initiativeId: uuid,
  durationWorkingDays,
  note: z.string().min(1).max(2000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type InitiativeSchedule = z.infer<typeof initiativeSchedule>;

/** OpenAPI `InitiativeScheduleCreate`. */
export const initiativeScheduleCreate = z.strictObject({
  durationWorkingDays,
  note: freeText(1, 2000).nullable().optional(),
});

/** OpenAPI `InitiativeScheduleUpdate` (at least one property). */
export const initiativeScheduleUpdate = z
  .strictObject({
    durationWorkingDays: durationWorkingDays.optional(),
    note: freeText(1, 2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
