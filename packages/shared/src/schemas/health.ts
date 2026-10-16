// The 25-question Transformation Health Check assessments (P5 slice H; ADR-0048 §5, §7, §9-§11; REQ-PB-091, REQ-PB-092,
// REQ-S14-001..003, REQ-S16-021; p5-work-split §H.4; T-DG5-KBE-G2): the zod mirrors of the OpenAPI components
// HealthCheckAnswer, HealthCheckAction, HealthCheckSummary, HealthCheckPage, HealthCheck, HealthCheckCreate,
// HealthCheckUpdate, HealthCheckAnswerPut and HealthCheckActionsPut. The OpenAPI file is the source of truth. The three
// read bodies of KBE-G (questions, schemes) live beside the scoring functions in `../health/contract.ts` and are
// re-exported here, so the web and the contract test find every slice H health body in `@mth/shared/schemas`.
//
// Decimals are strings, never floats (ADR-0048 §10). Incomplete is never zero: while any question is unanswered the
// score, the maximum and the band are null (REQ-S14-002). Scheme v1 (Yes = 1, No = 0) is an implementation assumption
// (M0262, D-010) and every body says so (`scoringAssumption`). A health check is an assessment, not a business approval.
import { z } from "zod";
import {
  healthCheckBand,
  healthCheckQuestion,
  healthCheckQuestionList,
  healthCheckResponseOption,
  healthCheckScheme,
  healthCheckSchemeList,
} from "../health/contract.ts";
import { HEALTH_RESPONSE_KEYS } from "../health/scoring.ts";
import { DECIMAL_PATTERN } from "../value.ts";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

export {
  healthCheckBand,
  healthCheckQuestion,
  healthCheckQuestionList,
  healthCheckResponseOption,
  healthCheckScheme,
  healthCheckSchemeList,
};

const nullableUuid = uuid.nullable();
const nullableDecimal = z.string().regex(DECIMAL_PATTERN, "validation.decimal").nullable();

export const HEALTH_CHECK_STATUSES = ["draft", "submitted"] as const;
/** The question codes of the path parameter `questionCode` (q01-q25, B0150). */
export const HEALTH_QUESTION_CODE_PATTERN = /^q(0[1-9]|1[0-9]|2[0-5])$/;
/** At most three ranked actions (B0150 "Top 3 actions"; M0288). */
export const HEALTH_CHECK_ACTION_RANKS = [1, 2, 3] as const;

export const healthCheckResponseKey = z.enum(HEALTH_RESPONSE_KEYS);
export const healthCheckStatus = z.enum(HEALTH_CHECK_STATUSES);

/** answered of total; complete only when every question is answered (OpenAPI `Completion`). */
export const healthCheckCompletion = z.strictObject({
  answered: z.number().int().min(0),
  total: z.number().int(),
  complete: z.boolean(),
});

export const healthCheckAnswer = z.strictObject({
  questionCode: z.string(),
  response: healthCheckResponseKey,
  evidenceNote: z.string().nullable(),
  evidenceId: nullableUuid,
  ownerUserId: nullableUuid,
  actionNote: z.string().nullable(),
  answeredBy: uuid,
  updatedAt: timestamp,
});
export type HealthCheckAnswer = z.infer<typeof healthCheckAnswer>;

export const healthCheckAction = z.strictObject({
  rank: z.number().int().min(1).max(3),
  actionText: freeText(1, 1000),
  ownerUserId: nullableUuid.optional(),
  dueDate: businessDate.nullable().optional(),
  improvementItemId: nullableUuid.optional(),
});
export type HealthCheckAction = z.infer<typeof healthCheckAction>;

const summaryShape = {
  id: uuid,
  transformationId: uuid,
  sequenceNo: z.number().int(),
  schemeVersionId: uuid,
  schemeVersionNo: z.number().int(),
  assessmentDate: businessDate,
  ownerUserId: uuid,
  status: healthCheckStatus,
  completion: healthCheckCompletion,
  score: nullableDecimal,
  scoreMax: nullableDecimal,
  band: healthCheckBand.nullable(),
  scoringAssumption: z.boolean(),
  previousAssessmentId: nullableUuid,
  submittedAt: timestamp.nullable(),
  submittedBy: nullableUuid,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
};

export const healthCheckSummary = z.strictObject(summaryShape);
export type HealthCheckSummary = z.infer<typeof healthCheckSummary>;
export const healthCheckPage = z.strictObject({
  items: z.array(healthCheckSummary),
  nextCursor: z.string().nullable(),
});
export type HealthCheckPage = z.infer<typeof healthCheckPage>;

export const healthCheck = z.strictObject({
  ...summaryShape,
  answers: z.array(healthCheckAnswer).max(25),
  actions: z.array(healthCheckAction).max(3),
});
export type HealthCheck = z.infer<typeof healthCheck>;

export const healthCheckCreate = z.strictObject({
  assessmentDate: businessDate,
  ownerUserId: nullableUuid.optional(),
});
export type HealthCheckCreate = z.infer<typeof healthCheckCreate>;

export const healthCheckUpdate = z
  .strictObject({
    assessmentDate: businessDate.optional(),
    ownerUserId: uuid.optional(),
  })
  .refine((b) => Object.keys(b).length >= 1, "validation.min_properties");
export type HealthCheckUpdate = z.infer<typeof healthCheckUpdate>;

export const healthCheckAnswerPut = z.strictObject({
  response: healthCheckResponseKey,
  evidenceNote: freeText(1, 2000).nullable().optional(),
  evidenceId: nullableUuid.optional(),
  ownerUserId: nullableUuid.optional(),
  actionNote: freeText(1, 1000).nullable().optional(),
});
export type HealthCheckAnswerPut = z.infer<typeof healthCheckAnswerPut>;

/** One to three actions with distinct ranks (a rank not sent keeps its stored action; nothing is ever deleted). */
export const healthCheckActionsPut = z.strictObject({
  actions: z
    .array(healthCheckAction)
    .min(1)
    .max(3)
    .refine((a) => new Set(a.map((x) => x.rank)).size === a.length, "validation.duplicate_rank"),
});
export type HealthCheckActionsPut = z.infer<typeof healthCheckActionsPut>;
