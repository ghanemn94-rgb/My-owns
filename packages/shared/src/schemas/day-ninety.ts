// The Day-90 leadership test (P5 slice H; ADR-0048 §4, §7-§9; REQ-PB-087; p5-work-split §H.2): the zod mirrors of the
// OpenAPI components DayNinetyEvidenceSuggestion, DayNinetyResponse, DayNinetyQuestion, Completion, DayNinetyTest and
// DayNinetyResponsePut. The OpenAPI file is the source of truth. Written by T-DG5-BE-P2 in
// apps/api/src/modules/launch/day-ninety.ts and promoted here unchanged by T-DG5-FE-F (D-159 d), so the web finds every
// slice H body in `@mth/shared/schemas`; the API module re-exports them under their original names.
//
// The six questions are verbatim B0136-B0141 (D-142 Q5); the Arabic texts are provisional translations. The test is
// incomplete while any question has no response; evidence suggestions are links to confirm, never answers.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";

/** At most this many evidence suggestions per question (OpenAPI DayNinetyQuestion.evidenceSuggestions.maxItems). */
export const DAY_NINETY_MAX_SUGGESTIONS = 5;

export const dayNinetyAnswer = z.enum(["yes", "no"]);
export const dayNinetyEvidenceSuggestion = z.strictObject({
  recordType: z.string(),
  recordId: uuid,
  label: z.string(),
  state: z.string().nullable(),
});
export const dayNinetyResponse = z.strictObject({
  answer: dayNinetyAnswer,
  comment: z.string().nullable(),
  evidenceId: uuid.nullable(),
  respondedBy: uuid,
  updatedAt: timestamp,
});
export const dayNinetyQuestion = z.strictObject({
  code: z.string(),
  ordinal: z.number().int(),
  textEn: z.string(),
  textAr: z.string(),
  sourceRef: z.string(),
  response: dayNinetyResponse.nullable(),
  evidenceSuggestions: z.array(dayNinetyEvidenceSuggestion).max(DAY_NINETY_MAX_SUGGESTIONS),
});
/** OpenAPI `Completion`: answered of total; complete only when every question is answered. */
export const dayNinetyCompletion = z.strictObject({
  answered: z.number().int().min(0),
  total: z.number().int(),
  complete: z.boolean(),
});
export const dayNinetyTest = z.strictObject({
  id: uuid,
  planId: uuid,
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["open", "completed"]),
  completion: dayNinetyCompletion,
  questions: z.array(dayNinetyQuestion).max(6),
  completedAt: timestamp.nullable(),
  completedBy: uuid.nullable(),
  version,
});
export const dayNinetyResponsePut = z.strictObject({
  answer: dayNinetyAnswer,
  comment: freeText(1, 2000).nullable().optional(),
  evidenceId: uuid.nullable().optional(),
});
export type DayNinetyAnswer = z.infer<typeof dayNinetyAnswer>;
export type DayNinetySuggestion = z.infer<typeof dayNinetyEvidenceSuggestion>;
export type DayNinetyResponse = z.infer<typeof dayNinetyResponse>;
export type DayNinetyQuestion = z.infer<typeof dayNinetyQuestion>;
export type DayNinetyTest = z.infer<typeof dayNinetyTest>;
export type DayNinetyResponsePut = z.infer<typeof dayNinetyResponsePut>;
