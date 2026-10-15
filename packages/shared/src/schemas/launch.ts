// The 90-day launch plan (P5 slice H; ADR-0048 §1-§3; REQ-PB-086, REQ-S14-004; p5-work-split §H.1; T-DG5-BE-P): the
// zod mirrors of the OpenAPI components LaunchPlanTemplate, LaunchWindow, LaunchTemplateItem, LaunchPlan,
// LaunchPlanCreate, LaunchPlanUpdate, LaunchTaskRef, LaunchTask, LaunchTaskPage, LaunchTaskCreate, LaunchTaskUpdate and
// LaunchTaskPredecessors. The OpenAPI file is the source of truth. Template texts are verbatim B0134/B0135 (D-142 Q5);
// the Arabic texts are provisional translations. Dates are business dates `YYYY-MM-DD`: day d of a plan is the start
// date + d calendar days (D-142 Q6), and a date on a non-working day is flagged (`nonWorkingDay`), never shifted.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();

export const LAUNCH_WINDOW_CODES = ["days_0_30", "days_31_60", "days_61_90"] as const;
export const LAUNCH_TASK_STATUSES = ["not_started", "in_progress", "completed", "cancelled"] as const;
export const LAUNCH_TASK_KINDS = ["action", "output", "day_ninety_test", "custom"] as const;
export const LAUNCH_OUTPUT_RECORD_TYPES = [
  "charter",
  "diagnostic_item",
  "baseline",
  "north_star",
  "kpi_definition",
  "tom_canvas_cell",
  "initiative",
  "business_case",
  "roadmap_wave",
  "benefit",
  "evidence",
  "meeting_series",
] as const;
/** The most predecessors a task may have (OpenAPI `LaunchTaskPredecessors.maxItems`). */
export const LAUNCH_TASK_MAX_PREDECESSORS = 20;

export const launchWindowCode = z.enum(LAUNCH_WINDOW_CODES);
export const launchTaskStatus = z.enum(LAUNCH_TASK_STATUSES);
export const launchOutputRecordType = z.enum(LAUNCH_OUTPUT_RECORD_TYPES);

export const launchTemplateItem = z.strictObject({
  code: z.string(),
  itemKind: z.enum(["action", "output", "day_ninety_test"]),
  ordinal: z.number().int(),
  textEn: z.string(),
  textAr: z.string(),
  outputRecordType: launchOutputRecordType.nullable(),
  startDay: z.number().int(),
  dueDay: z.number().int(),
  sourceRef: z.string(),
});

export const launchWindow = z.strictObject({
  code: launchWindowCode,
  ordinal: z.number().int(),
  labelEn: z.string(),
  labelAr: z.string(),
  objectiveEn: z.string(),
  objectiveAr: z.string(),
  actionsSourceEn: z.string(),
  outputsSourceEn: z.string(),
  startDay: z.number().int(),
  endDay: z.number().int(),
  items: z.array(launchTemplateItem),
});

export const launchPlanTemplate = z.strictObject({
  windows: z.array(launchWindow),
  sourceRef: z.string(),
});

export const launchPlan = z.strictObject({
  id: uuid,
  transformationId: uuid,
  startDate: businessDate,
  templateRef: z.string(),
  generatedVia: z.enum(["request", "automation"]),
  lastShiftDays: z.number().int().nullable(),
  taskCount: z.number().int().min(0),
  completedCount: z.number().int().min(0),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const launchPlanCreate = z.strictObject({ startDate: businessDate });
export const launchPlanUpdate = z.strictObject({ startDate: businessDate });

export const launchTaskRef = z.strictObject({
  taskId: uuid,
  ordinal: z.number().int(),
  title: z.string(),
  status: launchTaskStatus,
});

export const launchTask = z.strictObject({
  id: uuid,
  planId: uuid,
  ordinal: z.number().int(),
  templateItemCode: z.string().nullable(),
  windowCode: launchWindowCode,
  taskKind: z.enum(LAUNCH_TASK_KINDS),
  title: z.string(),
  sourceTextEn: z.string().nullable(),
  notes: z.string().nullable(),
  startDate: businessDate,
  dueDate: businessDate,
  nonWorkingDay: z.boolean(),
  ownerUserId: nullableUuid,
  status: launchTaskStatus,
  completedAt: timestamp.nullable(),
  completedBy: nullableUuid,
  outputRecordType: launchOutputRecordType.nullable(),
  outputRecordId: nullableUuid,
  predecessors: z.array(launchTaskRef).max(LAUNCH_TASK_MAX_PREDECESSORS),
  blockedBy: z.array(launchTaskRef).max(LAUNCH_TASK_MAX_PREDECESSORS),
  version,
  updatedAt: timestamp,
});

export const launchTaskPage = z.strictObject({
  items: z.array(launchTask),
  nextCursor: z.string().nullable(),
});

/** OpenAPI `LaunchTaskCreate`: a custom task in a window. `dueDate >= startDate` is checked by the service (400). */
export const launchTaskCreate = z.strictObject({
  windowCode: launchWindowCode,
  title: freeText(1, 300),
  notes: freeText(1, 4000).nullable().optional(),
  startDate: businessDate,
  dueDate: businessDate,
  ownerUserId: nullableUuid.optional(),
});

/** OpenAPI `LaunchTaskUpdate` (minProperties 1). */
export const launchTaskUpdate = z
  .strictObject({
    title: freeText(1, 300).optional(),
    notes: freeText(1, 4000).nullable().optional(),
    startDate: businessDate.optional(),
    dueDate: businessDate.optional(),
    ownerUserId: nullableUuid.optional(),
    status: launchTaskStatus.optional(),
    outputRecordType: launchOutputRecordType.nullable().optional(),
    outputRecordId: nullableUuid.optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length < 1) ctx.addIssue({ code: "custom", message: "validation.min_properties", path: [] });
  });

/** OpenAPI `LaunchTaskPredecessors`: the task's complete active predecessor set (unique ids, at most 20). */
export const launchTaskPredecessors = z.strictObject({
  predecessorTaskIds: z
    .array(uuid)
    .max(LAUNCH_TASK_MAX_PREDECESSORS)
    .refine((ids) => new Set(ids).size === ids.length, "validation.unique_items"),
});

export type LaunchTemplateItem = z.infer<typeof launchTemplateItem>;
export type LaunchWindow = z.infer<typeof launchWindow>;
export type LaunchPlanTemplate = z.infer<typeof launchPlanTemplate>;
export type LaunchPlan = z.infer<typeof launchPlan>;
export type LaunchPlanCreate = z.infer<typeof launchPlanCreate>;
export type LaunchPlanUpdate = z.infer<typeof launchPlanUpdate>;
export type LaunchTaskRef = z.infer<typeof launchTaskRef>;
export type LaunchTask = z.infer<typeof launchTask>;
export type LaunchTaskPage = z.infer<typeof launchTaskPage>;
export type LaunchTaskCreate = z.infer<typeof launchTaskCreate>;
export type LaunchTaskUpdate = z.infer<typeof launchTaskUpdate>;
export type LaunchTaskPredecessors = z.infer<typeof launchTaskPredecessors>;
export type LaunchTaskStatus = (typeof LAUNCH_TASK_STATUSES)[number];
