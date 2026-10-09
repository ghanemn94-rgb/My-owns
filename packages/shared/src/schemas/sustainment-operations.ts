// P4 slice G mirrors of BE-I2 (backend-workflow-engineer, T-DG4-BE-I2; p4-work-split §F+G FG.5; ADR-0034 §6, §8, §9, §12;
// OpenAPI 1.3.0-p4 Control*, ControlCheck*, SustainmentReview*, ImprovementItem*, Lesson*). REQ-S11-004, REQ-S11-008,
// REQ-PB-084, REQ-S03-002 (reviews after closure).
//
// - Controls generate periodic checks (the daily `sustainment.control_check_scan`); a failed check emits
//   `control_check.failed` and slice E opens one recovery case (REQ-S11-008).
// - Recurring reviews are created by the daily `sustainment.review_scan`, which never reads the transformation status
//   (REQ-S11-004, REQ-S03-002).
// - The CI backlog and lessons stay visible and editable after closure (REQ-PB-084); published lessons are searchable
//   from other transformations in the caller's scope (REQ-S11-008).
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";
import { sustainFrequency } from "./sustainment-areas.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const interval = z.number().int().min(1).max(12);

export const CONTROL_STATUSES = ["active", "retired"] as const;
export const CONTROL_CHECK_STATUSES = ["due", "passed", "failed", "cancelled"] as const;
export const SUSTAINMENT_REVIEW_STATUSES = ["due", "done", "cancelled"] as const;
export const PERFORMANCE_SIGNALS = ["on_track", "deteriorating", "unknown"] as const;
export const IMPROVEMENT_ITEM_STATUSES = ["open", "in_progress", "done", "rejected"] as const;
export const IMPROVEMENT_SOURCE_KINDS = ["manual", "lesson", "control_check", "review", "handover"] as const;
export const IMPROVEMENT_PRIORITIES = ["H", "M", "L"] as const;
export const LESSON_STATUSES = ["draft", "published", "archived"] as const;

// ------------------------------------------------------------------------------------------------ controls

/** OpenAPI `Control`. */
export const control = z.strictObject({
  id: uuid,
  transformationId: uuid,
  performanceAreaId: uuid,
  code: z.string().regex(/^CTL-[0-9]{2,6}$/),
  name: z.string().min(1).max(300),
  description: z.string().min(1).max(4000).nullable(),
  ownerUserId: nullableUuid,
  frequency: sustainFrequency,
  frequencyInterval: interval,
  nextCheckDate: businessDate.nullable(),
  status: z.enum(CONTROL_STATUSES),
  retiredAt: nullableTimestamp,
  retireReason: z.string().min(1).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type Control = z.infer<typeof control>;
export const controlPage = page(control);

/** OpenAPI `ControlCreate`. */
export const controlCreate = z.strictObject({
  performanceAreaId: uuid,
  name: freeText(1, 300),
  description: freeText(1, 4000).nullable().optional(),
  ownerUserId: nullableUuid.optional(),
  frequency: sustainFrequency,
  frequencyInterval: interval.optional(),
  nextCheckDate: businessDate.nullable().optional(),
});
export type ControlCreate = z.infer<typeof controlCreate>;

/** OpenAPI `ControlUpdate` (minProperties 1; `status: retired` needs `retireReason`, and only it carries one). */
export const controlUpdate = z
  .strictObject({
    name: freeText(1, 300).optional(),
    description: freeText(1, 4000).nullable().optional(),
    ownerUserId: nullableUuid.optional(),
    frequency: sustainFrequency.optional(),
    frequencyInterval: interval.optional(),
    nextCheckDate: businessDate.nullable().optional(),
    status: z.enum(["retired"]).optional(),
    retireReason: freeText(3, 1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length < 1) ctx.addIssue({ code: "custom", message: "validation.min_properties", path: [] });
    if (v.status === "retired" && v.retireReason === undefined)
      ctx.addIssue({ code: "custom", message: "validation.required", path: ["retireReason"] });
    if (v.status === undefined && v.retireReason !== undefined)
      ctx.addIssue({ code: "custom", message: "validation.not_applicable", path: ["retireReason"] });
  });
export type ControlUpdate = z.infer<typeof controlUpdate>;

// ------------------------------------------------------------------------------------------------ control checks

/** OpenAPI `ControlCheck`. `correctiveCaseId` is slice E's case opened for a failed check (null until it exists). */
export const controlCheck = z.strictObject({
  id: uuid,
  transformationId: uuid,
  controlId: uuid,
  performanceAreaId: uuid,
  dueDate: businessDate,
  assigneeUserId: nullableUuid,
  status: z.enum(CONTROL_CHECK_STATUSES),
  performedAt: nullableTimestamp,
  performedBy: nullableUuid,
  resultNote: z.string().min(1).max(4000).nullable(),
  correctiveCaseId: nullableUuid,
  createdSource: z.enum(["api", "worker"]),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type ControlCheck = z.infer<typeof controlCheck>;
export const controlCheckPage = page(controlCheck);

/**
 * OpenAPI `ControlCheckRecord`. "resultNote is required when result is failed": the service answers that rule with its
 * own 400 `control_check.result_note_required` at /resultNote (ADR-0034 §12), so it is not a schema refinement here.
 */
export const controlCheckRecord = z.strictObject({
  result: z.enum(["passed", "failed"]),
  resultNote: freeText(3, 4000).optional(),
});
export type ControlCheckRecord = z.infer<typeof controlCheckRecord>;

// ------------------------------------------------------------------------------------------------ reviews

/** OpenAPI `SustainmentReview`. */
export const sustainmentReview = z.strictObject({
  id: uuid,
  transformationId: uuid,
  subjectKind: z.enum(["performance_area", "transition_decision"]),
  performanceAreaId: nullableUuid,
  cycleNo: z.number().int().min(1).nullable(),
  transitionDecisionId: nullableUuid,
  dueDate: businessDate,
  assigneeUserId: uuid,
  status: z.enum(SUSTAINMENT_REVIEW_STATUSES),
  completedAt: nullableTimestamp,
  completedBy: nullableUuid,
  outcomeNote: z.string().min(1).max(4000).nullable(),
  performanceSignal: z.enum(PERFORMANCE_SIGNALS).nullable(),
  createdSource: z.enum(["api", "worker"]),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type SustainmentReview = z.infer<typeof sustainmentReview>;
export const sustainmentReviewPage = page(sustainmentReview);

/** OpenAPI `SustainmentReviewComplete`. `unknown` is a valid signal (ADR-0034 §11), never a guessed one. */
export const sustainmentReviewComplete = z.strictObject({
  outcomeNote: freeText(3, 4000),
  performanceSignal: z.enum(PERFORMANCE_SIGNALS),
});
export type SustainmentReviewComplete = z.infer<typeof sustainmentReviewComplete>;

// ------------------------------------------------------------------------------------------------ CI backlog

/** OpenAPI `ImprovementItem`. */
export const improvementItem = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^CI-[0-9]{2,6}$/),
  performanceAreaId: nullableUuid,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(8000).nullable(),
  ownerUserId: nullableUuid,
  priority: z.enum(IMPROVEMENT_PRIORITIES).nullable(),
  targetDate: businessDate.nullable(),
  sourceKind: z.enum(IMPROVEMENT_SOURCE_KINDS),
  sourceId: nullableUuid,
  status: z.enum(IMPROVEMENT_ITEM_STATUSES),
  resolutionNote: z.string().min(1).max(2000).nullable(),
  resolvedAt: nullableTimestamp,
  resolvedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type ImprovementItem = z.infer<typeof improvementItem>;
export const improvementItemPage = page(improvementItem);

/** OpenAPI `ImprovementItemCreate`: `sourceId` names the lesson, check, review or handover; absent for `manual`. */
export const improvementItemCreate = z
  .strictObject({
    performanceAreaId: nullableUuid.optional(),
    title: freeText(1, 300),
    description: freeText(1, 8000).nullable().optional(),
    ownerUserId: nullableUuid.optional(),
    priority: z.enum(IMPROVEMENT_PRIORITIES).nullable().optional(),
    targetDate: businessDate.nullable().optional(),
    sourceKind: z.enum(IMPROVEMENT_SOURCE_KINDS),
    sourceId: uuid.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sourceKind === "manual" && v.sourceId !== undefined)
      ctx.addIssue({ code: "custom", message: "validation.not_applicable", path: ["sourceId"] });
    if (v.sourceKind !== "manual" && v.sourceId === undefined)
      ctx.addIssue({ code: "custom", message: "validation.required", path: ["sourceId"] });
  });
export type ImprovementItemCreate = z.infer<typeof improvementItemCreate>;

/**
 * OpenAPI `ImprovementItemUpdate` (minProperties 1). A missing resolution note for done/rejected is the service's 400
 * `improvement_item.resolution_note_required` (ADR-0034 §12); a note without a closing status is not applicable.
 */
export const improvementItemUpdate = z
  .strictObject({
    performanceAreaId: nullableUuid.optional(),
    title: freeText(1, 300).optional(),
    description: freeText(1, 8000).nullable().optional(),
    ownerUserId: nullableUuid.optional(),
    priority: z.enum(IMPROVEMENT_PRIORITIES).nullable().optional(),
    targetDate: businessDate.nullable().optional(),
    status: z.enum(IMPROVEMENT_ITEM_STATUSES).optional(),
    resolutionNote: freeText(3, 2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length < 1) ctx.addIssue({ code: "custom", message: "validation.min_properties", path: [] });
    if (v.resolutionNote !== undefined && v.status !== "done" && v.status !== "rejected")
      ctx.addIssue({ code: "custom", message: "validation.not_applicable", path: ["resolutionNote"] });
  });
export type ImprovementItemUpdate = z.infer<typeof improvementItemUpdate>;

// ------------------------------------------------------------------------------------------------ lessons

const tags = z
  .array(freeText(1, 50))
  .max(10)
  .refine((t) => new Set(t).size === t.length, "validation.unique_items");

/** OpenAPI `Lesson`. */
export const lesson = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^LL-[0-9]{2,6}$/),
  performanceAreaId: nullableUuid,
  title: z.string().min(1).max(300),
  context: z.string().min(1).max(4000).nullable(),
  lessonText: z.string().min(3).max(8000),
  recommendation: z.string().min(1).max(4000).nullable(),
  tags: z.array(z.string().min(1).max(50)).max(10),
  status: z.enum(LESSON_STATUSES),
  publishedAt: nullableTimestamp,
  publishedBy: nullableUuid,
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type Lesson = z.infer<typeof lesson>;
export const lessonPage = page(lesson);

/** OpenAPI `LessonCreate`. */
export const lessonCreate = z.strictObject({
  performanceAreaId: nullableUuid.optional(),
  title: freeText(1, 300),
  context: freeText(1, 4000).nullable().optional(),
  lessonText: freeText(3, 8000),
  recommendation: freeText(1, 4000).nullable().optional(),
  tags: tags.optional(),
});
export type LessonCreate = z.infer<typeof lessonCreate>;

/** OpenAPI `LessonUpdate` (minProperties 1; `status: archived` archives, final). */
export const lessonUpdate = lessonCreate
  .partial()
  .extend({ status: z.enum(["archived"]).optional() })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type LessonUpdate = z.infer<typeof lessonUpdate>;

/** OpenAPI `LessonSearchHit`: a published lesson found across transformations, with its transformation's name. */
export const lessonSearchHit = z.strictObject({
  lesson,
  transformationCode: z.string(),
  transformationName: z.string(),
});
export type LessonSearchHit = z.infer<typeof lessonSearchHit>;
export const lessonSearchPage = page(lessonSearchHit);
