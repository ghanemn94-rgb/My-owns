// P4 slice F mirrors of the short native feedback and assessment forms, invitations, assessment records and training
// records (backend-workflow-engineer, T-DG4-BE-H2; ADR-0033 §5, §6, §9, §10; OpenAPI 1.3.0-p4 AssessmentForm*,
// AssessmentInvitation*, AssessmentRecord*, AssessmentReview, TrainingRecord*). REQ-S11-002, REQ-PB-072 (records),
// REQ-S16-020 (Training/AssessmentRecord).
//
// - The form questions are validated form JSON (ADR-0014): request bodies carry them as an object that the API checks
//   with `validateFormSchema` (`@mth/shared/calc`), so a refusal is 400 assessment_form.schema_invalid at the failing
//   pointer; responses are parsed with the typed `assessmentFormSchemaShape`.
// - Answers are checked by the API against the published version (`validateAnswers`); the proficiency result is
//   derived by the API and never sent by the client.
// - Free text goes through the shared `freeText` rules (S-1). Nothing here is a business approval.
import { z } from "zod";
import { assessmentFormSchemaShape, ASSESSMENT_FORM_KINDS } from "../adoption/form-schema.ts";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

export const ASSESSMENT_FORM_STATUSES = ["draft", "published", "retired"] as const;
export const ASSESSMENT_INVITATION_STATUSES = ["open", "responded", "cancelled"] as const;
export const ASSESSMENT_RECORD_KINDS = ["feedback", "proficiency_observation"] as const;
export const ASSESSMENT_RECORD_STATUSES = ["submitted", "reviewed", "withdrawn"] as const;
export const TRAINING_RECORD_STATUSES = ["enrolled", "completed", "no_show", "withdrawn"] as const;

// ------------------------------------------------------------------------------------------------ forms

/** OpenAPI `AssessmentFormVersion`: an append-only question set. */
export const assessmentFormVersion = z.strictObject({
  versionNo: z.number().int().min(1),
  schema: assessmentFormSchemaShape,
  createdAt: timestamp,
  createdBy: uuid,
});
export type AssessmentFormVersion = z.infer<typeof assessmentFormVersion>;

/** OpenAPI `AssessmentForm` (REQ-S11-002). */
export const assessmentForm = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kind: z.enum(ASSESSMENT_FORM_KINDS),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000).nullable(),
  stakeholderGroupId: nullableUuid,
  status: z.enum(ASSESSMENT_FORM_STATUSES),
  currentVersion: assessmentFormVersion,
  publishedVersionNo: z.number().int().min(1).nullable(),
  publishedAt: nullableTimestamp,
  publishedBy: nullableUuid,
  retiredAt: nullableTimestamp,
  retiredBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type AssessmentForm = z.infer<typeof assessmentForm>;
export const assessmentFormPage = page(assessmentForm);

/** The raw form JSON of a request: an object; its members are checked by `validateFormSchema` (400 at the pointer). */
const formSchemaJson = z.record(z.string(), z.unknown());

/** OpenAPI `AssessmentFormCreate`. */
export const assessmentFormCreate = z.strictObject({
  kind: z.enum(ASSESSMENT_FORM_KINDS),
  name: freeText(1, 200),
  description: freeText(1, 2000).nullable().optional(),
  stakeholderGroupId: nullableUuid.optional(),
  schema: formSchemaJson,
});
export type AssessmentFormCreate = z.infer<typeof assessmentFormCreate>;

/** OpenAPI `AssessmentFormUpdate`: every member optional, at least one; a schema inserts the next version. */
export const assessmentFormUpdate = z
  .strictObject({
    name: freeText(1, 200).optional(),
    description: freeText(1, 2000).nullable().optional(),
    stakeholderGroupId: nullableUuid.optional(),
    schema: formSchemaJson.optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type AssessmentFormUpdate = z.infer<typeof assessmentFormUpdate>;

// ------------------------------------------------------------------------------------------------ invitations

/** OpenAPI `AssessmentInvitation`. */
export const assessmentInvitation = z.strictObject({
  id: uuid,
  transformationId: uuid,
  formId: uuid,
  userId: uuid,
  stakeholderGroupId: uuid,
  subjectUserId: nullableUuid,
  dueDate: businessDate.nullable(),
  status: z.enum(ASSESSMENT_INVITATION_STATUSES),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type AssessmentInvitation = z.infer<typeof assessmentInvitation>;
export const assessmentInvitationPage = page(assessmentInvitation);
export const assessmentInvitationList = z.strictObject({ items: z.array(assessmentInvitation) });

/** OpenAPI `AssessmentInvitationCreate`. */
export const assessmentInvitationCreate = z.strictObject({
  userIds: z
    .array(uuid)
    .min(1)
    .max(100)
    .refine((v) => new Set(v).size === v.length, "validation.unique_items"),
  stakeholderGroupId: uuid,
  subjectUserId: nullableUuid.optional(),
  dueDate: businessDate.nullable().optional(),
});
export type AssessmentInvitationCreate = z.infer<typeof assessmentInvitationCreate>;

// ------------------------------------------------------------------------------------------------ records

const answerValue = z.union([z.string(), z.number().int(), z.boolean()]);

/** OpenAPI `AssessmentRecord` (REQ-S16-020 Training/AssessmentRecord, the assessment half). */
export const assessmentRecord = z.strictObject({
  id: uuid,
  transformationId: uuid,
  formId: uuid,
  formVersionNo: z.number().int().min(1),
  invitationId: nullableUuid,
  stakeholderGroupId: uuid,
  kind: z.enum(ASSESSMENT_RECORD_KINDS),
  respondentUserId: uuid,
  subjectUserId: nullableUuid,
  subjectLabel: z.string().min(1).max(200).nullable(),
  observedOn: businessDate,
  answers: z.record(z.string(), answerValue),
  proficiencyResult: z.enum(["proficient", "not_yet_proficient"]).nullable(),
  status: z.enum(ASSESSMENT_RECORD_STATUSES),
  reviewedAt: nullableTimestamp,
  reviewedBy: nullableUuid,
  reviewNote: z.string().min(1).max(2000).nullable(),
  withdrawnAt: nullableTimestamp,
  withdrawnBy: nullableUuid,
  withdrawReason: z.string().min(1).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type AssessmentRecord = z.infer<typeof assessmentRecord>;
export const assessmentRecordPage = page(assessmentRecord);

/**
 * OpenAPI `AssessmentRecordCreate`. The answers are an object of at most 20 members; each value is checked by the API
 * against the published version (`validateAnswers`: 400 assessment_record.answer_invalid / answer_required at
 * `/answers/<key>`).
 */
export const assessmentRecordCreate = z.strictObject({
  formId: uuid,
  invitationId: uuid.optional(),
  stakeholderGroupId: uuid,
  subjectUserId: uuid.optional(),
  subjectLabel: freeText(1, 200).optional(),
  observedOn: businessDate,
  answers: z.record(z.string(), z.unknown()).refine((v) => Object.keys(v).length <= 20, "validation.max_properties"),
});
export type AssessmentRecordCreate = z.infer<typeof assessmentRecordCreate>;

/** OpenAPI `AssessmentReview`: an optional note. */
export const assessmentReview = z.strictObject({ note: freeText(1, 2000).optional() });
export type AssessmentReview = z.infer<typeof assessmentReview>;

// ------------------------------------------------------------------------------------------------ training

/** OpenAPI `TrainingRecord` (REQ-S16-020 Training/AssessmentRecord, the training half). Completion is attendance. */
export const trainingRecord = z.strictObject({
  id: uuid,
  transformationId: uuid,
  stakeholderGroupId: uuid,
  interventionId: nullableUuid,
  participantUserId: nullableUuid,
  participantLabel: z.string().min(1).max(200).nullable(),
  trainingTitle: z.string().min(1).max(300),
  scheduledOn: businessDate.nullable(),
  status: z.enum(TRAINING_RECORD_STATUSES),
  completedOn: businessDate.nullable(),
  recordedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type TrainingRecord = z.infer<typeof trainingRecord>;
export const trainingRecordPage = page(trainingRecord);

/** OpenAPI `TrainingRecordCreate`: exactly one of participantUserId and participantLabel. */
export const trainingRecordCreate = z
  .strictObject({
    stakeholderGroupId: uuid,
    interventionId: uuid.optional(),
    participantUserId: uuid.optional(),
    participantLabel: freeText(1, 200).optional(),
    trainingTitle: freeText(1, 300),
    scheduledOn: businessDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.participantUserId === undefined && v.participantLabel === undefined)
      ctx.addIssue({ code: "custom", path: ["participantUserId"], message: "validation.required" });
    if (v.participantUserId !== undefined && v.participantLabel !== undefined)
      ctx.addIssue({ code: "custom", path: ["participantLabel"], message: "validation.not_applicable" });
  });
export type TrainingRecordCreate = z.infer<typeof trainingRecordCreate>;

/** OpenAPI `TrainingRecordUpdate`: completedOn is required exactly when the status is completed. */
export const trainingRecordUpdate = z
  .strictObject({
    status: z.enum(["completed", "no_show", "withdrawn"]),
    completedOn: businessDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "completed" && v.completedOn === undefined)
      ctx.addIssue({ code: "custom", path: ["completedOn"], message: "validation.required" });
    if (v.status !== "completed" && v.completedOn !== undefined)
      ctx.addIssue({ code: "custom", path: ["completedOn"], message: "validation.not_applicable" });
  });
export type TrainingRecordUpdate = z.infer<typeof trainingRecordUpdate>;
