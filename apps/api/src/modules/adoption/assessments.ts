// Short native feedback and assessment forms, invitations and assessment records (P4 slice F; ADR-0033 §5, §6, §9,
// §10, §11; T-DG4-BE-H2; REQ-S11-002 "a proficiency observation submitted via the form links to the stakeholder group",
// REQ-PB-072 records, REQ-S16-020 Training/AssessmentRecord, the assessment half):
//   GET  /transformations/{t}/assessment-forms                        forms (transformation.read)
//   POST /transformations/{t}/assessment-forms                        create a draft with question version 1
//                                                                     (assessment_form.manage; BO, WL)
//   GET  /transformations/{t}/assessment-forms/{f}                    one form with its current version
//   PATCH /transformations/{t}/assessment-forms/{f}                   edit; new questions insert the next version and
//                                                                     step current_version_no in the same transaction
//   POST /transformations/{t}/assessment-forms/{f}/publish            publish the current version (If-Match)
//   POST /transformations/{t}/assessment-forms/{f}/retire             retire a published form; final (If-Match)
//   GET  /transformations/{t}/assessment-forms/{f}/invitations        invitations to a form
//   POST /transformations/{t}/assessment-forms/{f}/invitations        invite respondents; one My Work item each
//   POST /transformations/{t}/assessment-invitations/{i}/cancel       cancel an open invitation; final (If-Match)
//   GET  /transformations/{t}/assessment-records                      responses and observations
//   POST /transformations/{t}/assessment-records                      answer the published version (assessment.respond:
//                                                                     invited, or an assessor holding proficiency.record
//                                                                     for an observation without invitation)
//   GET  /transformations/{t}/assessment-records/{r}                  one record
//   POST /transformations/{t}/assessment-records/{r}/review           mark reviewed (assessment.review; BO; If-Match)
//   POST /transformations/{t}/assessment-records/{r}/withdraw         withdraw with a reason (assessment.review or the
//                                                                     respondent; If-Match); it stops counting
//
// The questions are validated form JSON (ADR-0014): `validateFormSchema` answers 400 assessment_form.schema_invalid at
// the failing pointer before any write, and the database function p4_assessment_form_schema_valid is the last line.
// Answers are checked against the PUBLISHED version (`validateAnswers`), and the proficiency result is derived from the
// proficiency answer by the API (`deriveProficiencyResult`); the client never sends it. A proficiency observation
// names its stakeholder group and counts in the group's observed-proficiency measure from submission until withdrawn
// (the measure itself is KBE-F's, ADR-0033 §6). Training completion never counts as proficiency.
//
// Every mutation: the read gate first (an ADM-only caller or an outsider gets 404, ADR-0006), the write permission
// re-checked at commit time on the reloaded grants (AUD 403), validation, If-Match on changes (428/409; creates start at
// version 1), one audit event per row change in the same transaction, and no remote I/O inside it (S-4). Work items go
// through createWorkItemOnce (S-13). Nothing here is a G1-G6 business approval or touches DG0-DG7.
import {
  diffFields,
  sql,
  type AssessmentFormTable,
  type AssessmentInvitationTable,
  type AssessmentRecordTable,
  type AuditActor,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import type { FieldError } from "@mth/shared";
import {
  deriveProficiencyResult,
  validateAnswers,
  validateFormSchema,
  type AnswerIssue,
  type AssessmentFormKind,
  type AssessmentFormSchemaJson,
} from "@mth/shared/calc";
import {
  adoptionReason,
  assessmentFormCreate,
  assessmentFormUpdate,
  assessmentInvitationCreate,
  assessmentRecordCreate,
  assessmentReview,
  type AssessmentForm,
  type AssessmentInvitation,
  type AssessmentRecord,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { holds, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, openWrite, type WriteContext } from "../transformations/index.ts";
import {
  adoptionRule,
  JSON_BODY,
  lockActiveGroupRef,
  openAdoptionWrite,
  parseTransformationParam,
  T_BASE,
} from "./register.ts";

export type AssessmentFormRow = Selectable<AssessmentFormTable>;
export type AssessmentInvitationRow = Selectable<AssessmentInvitationTable>;
export type AssessmentRecordRow = Selectable<AssessmentRecordTable>;

export const ASSESSMENT_FORMS = `${T_BASE}/assessment-forms`;
export const ASSESSMENT_FORM = `${ASSESSMENT_FORMS}/:assessmentFormId`;
export const ASSESSMENT_FORM_PUBLISH = `${ASSESSMENT_FORM}/publish`;
export const ASSESSMENT_FORM_RETIRE = `${ASSESSMENT_FORM}/retire`;
export const ASSESSMENT_FORM_INVITATIONS = `${ASSESSMENT_FORM}/invitations`;
export const ASSESSMENT_INVITATION_CANCEL = `${T_BASE}/assessment-invitations/:assessmentInvitationId/cancel`;
export const ASSESSMENT_RECORDS = `${T_BASE}/assessment-records`;
export const ASSESSMENT_RECORD = `${ASSESSMENT_RECORDS}/:assessmentRecordId`;
export const ASSESSMENT_RECORD_REVIEW = `${ASSESSMENT_RECORD}/review`;
export const ASSESSMENT_RECORD_WITHDRAW = `${ASSESSMENT_RECORD}/withdraw`;

export const ASSESSMENT_FORM_MANAGE = "assessment_form.manage" as const;
export const ASSESSMENT_RESPOND = "assessment.respond" as const;
export const ASSESSMENT_REVIEW = "assessment.review" as const;
export const PROFICIENCY_RECORD = "proficiency.record" as const;

export const ASSESSMENT_INVITATION_TASK_KIND = "assessment_invitation";
export const ASSESSMENT_REVIEW_TASK_KIND = "assessment_to_review";

const FORM_AUDIT_FIELDS = [
  "kind",
  "name",
  "description",
  "stakeholder_group_id",
  "status",
  "current_version_no",
  "published_version_no",
  "published_by",
  "retired_by",
] as const satisfies readonly (keyof AssessmentFormRow & string)[];
const INVITATION_AUDIT_FIELDS = [
  "form_id",
  "user_id",
  "stakeholder_group_id",
  "subject_user_id",
  "due_date",
  "status",
] as const satisfies readonly (keyof AssessmentInvitationRow & string)[];
const RECORD_AUDIT_FIELDS = [
  "form_id",
  "form_version_id",
  "invitation_id",
  "stakeholder_group_id",
  "kind",
  "respondent_user_id",
  "subject_user_id",
  "subject_label",
  "observed_on",
  "answers",
  "proficiency_result",
  "status",
  "reviewed_by",
  "review_note",
  "withdrawn_by",
  "withdraw_reason",
] as const satisfies readonly (keyof AssessmentRecordRow & string)[];

// ------------------------------------------------------------------------------------------------ problems (§10)

const forbidden403 = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

/** A 400 with an ADR-0033 §10 code at the top and on every field error (S-11). */
const badRequest400 = (code: string, detail: string, errors: readonly FieldError[]) =>
  new HttpProblem({
    status: 400,
    type: "urn:mth:problem:validation",
    code,
    title: "Validation failed",
    detail,
    errors,
  });

const FORM_RETIRED = () =>
  adoptionRule("assessment_form.retired", "This form is retired and can no longer be changed.");
const FORM_NOT_PUBLISHED = () =>
  adoptionRule("assessment_form.not_published", "Only a published form takes invitations and responses.");
const FORM_TRANSITION = (from: string, to: string) =>
  adoptionRule("assessment_form.status_transition", `This form cannot move from ${from} to ${to}.`);
const INVITATION_EXISTS = () =>
  problems.duplicate("assessment_invitation.exists", "This person already has an open invitation to this form.");
const INVITATION_FINAL = (status: string) =>
  adoptionRule("assessment_invitation.final", `This invitation is ${status} and can no longer be changed.`);
const NOT_INVITED = () => forbidden403("assessment_record.not_invited", "You are not invited to answer this form.");
const NOT_WITHDRAWABLE = () =>
  forbidden403(
    "assessment_record.not_withdrawable_by_caller",
    "Only the respondent or a reviewer can withdraw this response.",
  );
const RECORD_TRANSITION = (from: string, to: string) =>
  adoptionRule("assessment_record.status_transition", `This response cannot move from ${from} to ${to}.`);
const RECORD_WITHDRAWN = () =>
  adoptionRule("assessment_record.withdrawn", "This response is withdrawn and can no longer be changed.");
const SUBJECT_REQUIRED = () =>
  badRequest400("assessment_record.subject_required", "A proficiency observation names the person observed.", [
    {
      pointer: "/subjectUserId",
      code: "assessment_record.subject_required",
      message: "A proficiency observation names the person observed.",
    },
  ]);
const REFERENCE = (pointer: string) =>
  adoptionRule("validation.reference", "The linked record does not exist in this transformation.", pointer);
const notApplicable = (pointer: string) =>
  problems.validation([{ pointer, code: "validation.not_applicable", message: "validation.not_applicable" }]);

/** 400 assessment_form.schema_invalid at every failing pointer, under `/schema` of the request body. */
function schemaInvalid(issues: readonly { pointer: string; reason: string }[]): HttpProblem {
  const detail = `The form is not valid: ${issues[0]!.reason}.`;
  return badRequest400(
    "assessment_form.schema_invalid",
    detail,
    issues.map((i) => ({
      pointer: `/schema${i.pointer}`,
      code: "assessment_form.schema_invalid",
      message: `The form is not valid: ${i.reason}.`,
    })),
  );
}

/** The exact ADR-0033 §10 text of an answer refusal. */
const answerText = (code: AnswerIssue["code"]): string =>
  code === "assessment_record.answer_required"
    ? "This question requires an answer."
    : "This answer is not valid for the question.";
const tokenOf = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");

function answersInvalid(issues: readonly AnswerIssue[]): HttpProblem {
  const first = issues[0]!;
  return badRequest400(
    first.code,
    answerText(first.code),
    issues.map((i) => ({ pointer: `/answers/${tokenOf(i.key)}`, code: i.code, message: answerText(i.code) })),
  );
}

// ------------------------------------------------------------------------------------------------ presentation

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

interface VersionRow {
  readonly form_id: string;
  readonly version_no: number;
  readonly schema: unknown;
  readonly created_at: Date;
  readonly created_by: string;
}

function toAssessmentForm(r: AssessmentFormRow, v: VersionRow): AssessmentForm {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kind: r.kind as AssessmentForm["kind"],
    name: r.name,
    description: r.description,
    stakeholderGroupId: r.stakeholder_group_id,
    status: r.status as AssessmentForm["status"],
    currentVersion: {
      versionNo: v.version_no,
      schema: v.schema as AssessmentFormSchemaJson,
      createdAt: iso(v.created_at),
      createdBy: v.created_by,
    },
    publishedVersionNo: r.published_version_no,
    publishedAt: isoOrNull(r.published_at),
    publishedBy: r.published_by,
    retiredAt: isoOrNull(r.retired_at),
    retiredBy: r.retired_by,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** Forms with their current versions (one query for the versions). */
async function presentForms(db: DbOrTx, rows: readonly AssessmentFormRow[]): Promise<AssessmentForm[]> {
  if (rows.length === 0) return [];
  const versions = await db
    .selectFrom("assessment_form_version")
    .select(["form_id", "version_no", "schema", "created_at", "created_by"])
    .where(
      "form_id",
      "in",
      rows.map((r) => r.id),
    )
    .execute();
  return rows.map((r) => {
    const v = versions.find((x) => x.form_id === r.id && x.version_no === r.current_version_no);
    if (!v) throw new Error(`assessment_form ${r.id}: current version ${r.current_version_no} is missing`);
    return toAssessmentForm(r, v as VersionRow);
  });
}

function toAssessmentInvitation(r: AssessmentInvitationRow): AssessmentInvitation {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    formId: r.form_id,
    userId: r.user_id,
    stakeholderGroupId: r.stakeholder_group_id,
    subjectUserId: r.subject_user_id,
    dueDate: dateOrNull(r.due_date),
    status: r.status as AssessmentInvitation["status"],
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

type RecordWithVersion = AssessmentRecordRow & { readonly form_version_no: number };

function toAssessmentRecord(r: RecordWithVersion): AssessmentRecord {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    formId: r.form_id,
    formVersionNo: r.form_version_no,
    invitationId: r.invitation_id,
    stakeholderGroupId: r.stakeholder_group_id,
    kind: r.kind as AssessmentRecord["kind"],
    respondentUserId: r.respondent_user_id,
    subjectUserId: r.subject_user_id,
    subjectLabel: r.subject_label,
    observedOn: String(r.observed_on).slice(0, 10),
    answers: r.answers as AssessmentRecord["answers"],
    proficiencyResult: r.proficiency_result as AssessmentRecord["proficiencyResult"],
    status: r.status as AssessmentRecord["status"],
    reviewedAt: isoOrNull(r.reviewed_at),
    reviewedBy: r.reviewed_by,
    reviewNote: r.review_note,
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawnBy: r.withdrawn_by,
    withdrawReason: r.withdraw_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** A record row with its form version number (records read from a join). */
function recordQuery(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("assessment_record as r")
    .innerJoin("assessment_form_version as v", "v.id", "r.form_version_id")
    .selectAll("r")
    .select("v.version_no as form_version_no")
    .where("r.transformation_id", "=", transformationId);
}

async function withVersionNo(db: DbOrTx, row: AssessmentRecordRow): Promise<RecordWithVersion> {
  const v = await db
    .selectFrom("assessment_form_version")
    .select("version_no")
    .where("id", "=", row.form_version_id)
    .executeTakeFirstOrThrow();
  return { ...row, form_version_no: v.version_no };
}

const userActor = (ctx: WriteContext): AuditActor => ({
  actorType: "user",
  actorUserId: ctx.userId,
  requestId: ctx.audit.requestId,
  source: "api",
});

// ------------------------------------------------------------------------------------------------ params

const formParams = z.strictObject({ transformationId: z.uuid(), assessmentFormId: z.uuid() });
const invitationParams = z.strictObject({ transformationId: z.uuid(), assessmentInvitationId: z.uuid() });
const recordParams = z.strictObject({ transformationId: z.uuid(), assessmentRecordId: z.uuid() });

async function lockForm(tx: Tx, transformationId: string, formId: string): Promise<AssessmentFormRow> {
  const form = await tx
    .selectFrom("assessment_form")
    .selectAll()
    .where("id", "=", formId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!form) throw problems.notFound();
  return form;
}

// ------------------------------------------------------------------------------------------------ forms (writes)

/**
 * Create a draft form with question version 1 (ADR-0033 §5). The form row starts at version 1 without versions (the
 * 0047 guard), the question set is inserted as version 1, and the form's current_version_no steps to 1 in the same
 * transaction: two row states, each with its audit event, so the response carries the form at record version 2 with
 * `currentVersion.versionNo` 1 (the guard design makes the step a separate update).
 */
async function createForm(tx: Tx, request: FastifyRequest): Promise<AssessmentFormRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_FORM_MANAGE);
  const body = parseBody(assessmentFormCreate, request.body);
  const issues = validateFormSchema(body.kind, body.schema);
  if (issues.length > 0) throw schemaInvalid(issues);
  const groupId =
    body.stakeholderGroupId === undefined || body.stakeholderGroupId === null
      ? null
      : (await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId")).id;
  const id = uuidv7();
  const created = await tx
    .insertInto("assessment_form")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kind: body.kind,
      name: body.name,
      description: body.description ?? null,
      stakeholder_group_id: groupId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "assessment_form.create",
    recordType: "assessment_form",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: created.version,
    changes: diffFields({} as AssessmentFormRow, created, [...FORM_AUDIT_FIELDS]),
  });
  return addVersion(tx, ctx, created, body.schema, {});
}

/**
 * Inserts the next question version of `form` (version_no = current_version_no + 1, checked by the 0047 trigger) and
 * steps the form's current_version_no in the same update as `extra` (one form version step, one audit event).
 */
async function addVersion(
  tx: Tx,
  ctx: WriteContext,
  form: AssessmentFormRow,
  schema: Record<string, unknown>,
  extra: Partial<Pick<AssessmentFormRow, "name" | "description" | "stakeholder_group_id">>,
): Promise<AssessmentFormRow> {
  const versionNo = form.current_version_no + 1;
  const versionId = uuidv7();
  await tx
    .insertInto("assessment_form_version")
    .values({
      id: versionId,
      organization_id: form.organization_id,
      transformation_id: form.transformation_id,
      form_id: form.id,
      version_no: versionNo,
      schema: JSON.stringify(schema),
      created_by: ctx.userId,
    })
    .execute();
  // The append-only question set is an audited row of its own (0047 p2_attach_guards; no version column).
  await record(tx, ctx.audit, {
    action: "assessment_form_version.create",
    recordType: "assessment_form_version",
    recordId: versionId,
    organizationId: form.organization_id,
    transformationId: form.transformation_id,
    changes: { form_id: { from: null, to: form.id }, version_no: { from: null, to: versionNo } },
  });
  const updated = await tx
    .updateTable("assessment_form")
    .set({
      ...extra,
      current_version_no: versionNo,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", form.id)
    .where("version", "=", form.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: versionNo === 1 ? "assessment_form.version_create" : "assessment_form.update",
    recordType: "assessment_form",
    recordId: form.id,
    organizationId: form.organization_id,
    transformationId: form.transformation_id,
    priorVersion: form.version,
    newVersion: updated.version,
    changes: diffFields(form, updated, [...FORM_AUDIT_FIELDS]),
  });
  return updated;
}

async function updateForm(tx: Tx, request: FastifyRequest): Promise<AssessmentFormRow> {
  const { transformationId, assessmentFormId } = parse(formParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_FORM_MANAGE);
  const current = await lockForm(tx, transformationId, assessmentFormId);
  const body = parseBody(assessmentFormUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired") throw FORM_RETIRED();
  if (body.schema !== undefined) {
    const issues = validateFormSchema(current.kind as AssessmentFormKind, body.schema);
    if (issues.length > 0) throw schemaInvalid(issues);
  }
  const groupId =
    body.stakeholderGroupId === undefined
      ? undefined
      : body.stakeholderGroupId === null
        ? null
        : (await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId")).id;
  const extra = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(groupId !== undefined ? { stakeholder_group_id: groupId } : {}),
  };
  if (body.schema !== undefined) return addVersion(tx, ctx, current, body.schema, extra);
  const updated = await tx
    .updateTable("assessment_form")
    .set({ ...extra, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "assessment_form.update",
    recordType: "assessment_form",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...FORM_AUDIT_FIELDS]),
  });
  return updated;
}

/**
 * Publish the current version (draft -> published, or a newer version of a published form); retire a published form
 * (final). A retired form: 422 assessment_form.retired on publish; any other illegal move: 422
 * assessment_form.status_transition.
 */
async function moveForm(tx: Tx, request: FastifyRequest, to: "published" | "retired"): Promise<AssessmentFormRow> {
  const { transformationId, assessmentFormId } = parse(formParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_FORM_MANAGE);
  const current = await lockForm(tx, transformationId, assessmentFormId);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (to === "published") {
    if (current.status === "retired") throw FORM_RETIRED();
    // A published form whose current version is already the published one has nothing to publish.
    if (current.status === "published" && current.published_version_no === current.current_version_no)
      throw FORM_TRANSITION(current.status, to);
  } else if (current.status !== "published") throw FORM_TRANSITION(current.status, to);
  const updated = await tx
    .updateTable("assessment_form")
    .set({
      ...(to === "published"
        ? {
            status: "published",
            published_version_no: current.current_version_no,
            published_at: sql<Date>`now()`,
            published_by: ctx.userId,
          }
        : { status: "retired", retired_at: sql<Date>`now()`, retired_by: ctx.userId }),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: to === "published" ? "assessment_form.publish" : "assessment_form.retire",
    recordType: "assessment_form",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...FORM_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ invitations

/**
 * Invite respondents to a published form for a stakeholder group (ADR-0033 §5): one open invitation per form, invitee
 * and subject (409 assessment_invitation.exists; the partial unique index is the backstop), each with one My Work item
 * `assessment_invitation` (dedupe `assessment.invitation:<invitationId>`). A subject (the observed person) is named
 * only for a proficiency assessment.
 */
async function createInvitations(tx: Tx, request: FastifyRequest): Promise<AssessmentInvitationRow[]> {
  const { transformationId, assessmentFormId } = parse(formParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_FORM_MANAGE);
  const form = await tx
    .selectFrom("assessment_form")
    .selectAll()
    .where("id", "=", assessmentFormId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!form) throw problems.notFound();
  const body = parseBody(assessmentInvitationCreate, request.body);
  const subjectUserId = body.subjectUserId ?? null;
  if (subjectUserId !== null && form.kind !== "proficiency_assessment") throw notApplicable("/subjectUserId");
  if (form.status !== "published") throw FORM_NOT_PUBLISHED();
  const group = await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId");
  await assertActiveUsers(tx, ctx.organizationId, [
    ...body.userIds.map((id, i) => ({ id, pointer: `/userIds/${i}` })),
    { id: subjectUserId, pointer: "/subjectUserId" },
  ]);
  const open = await tx
    .selectFrom("assessment_invitation")
    .select("user_id")
    .where("form_id", "=", form.id)
    .where("user_id", "in", body.userIds)
    .where("status", "=", "open")
    .where(sql<boolean>`coalesce(subject_user_id, user_id) = coalesce(${subjectUserId}::uuid, user_id)`)
    .execute();
  if (open.length > 0) throw INVITATION_EXISTS();
  const actor = userActor(ctx);
  const out: AssessmentInvitationRow[] = [];
  for (const userId of body.userIds) {
    const id = uuidv7();
    const row = await tx
      .insertInto("assessment_invitation")
      .values({
        id,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        form_id: form.id,
        user_id: userId,
        stakeholder_group_id: group.id,
        subject_user_id: subjectUserId,
        due_date: body.dueDate ?? null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "assessment_invitation.create",
      recordType: "assessment_invitation",
      recordId: id,
      organizationId: ctx.organizationId,
      transformationId,
      newVersion: row.version,
      changes: diffFields({} as AssessmentInvitationRow, row, [...INVITATION_AUDIT_FIELDS]),
    });
    await createWorkItemOnce(tx, actor, {
      organizationId: ctx.organizationId,
      transformationId,
      kind: ASSESSMENT_INVITATION_TASK_KIND,
      assigneeUserId: userId,
      subjectType: "assessment_invitation",
      subjectId: id,
      linkPath: `/transformations/${transformationId}/assessment-forms/${form.id}`,
      messageKey: "adoption.task.assessment_invitation",
      messageParams: { formName: form.name },
      dueDate: dateOrNull(row.due_date),
      dedupeKey: `assessment.invitation:${id}`,
    });
    out.push(row);
  }
  return out;
}

async function cancelInvitation(tx: Tx, request: FastifyRequest): Promise<AssessmentInvitationRow> {
  const { transformationId, assessmentInvitationId } = parse(invitationParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_FORM_MANAGE);
  const current = await tx
    .selectFrom("assessment_invitation")
    .selectAll()
    .where("id", "=", assessmentInvitationId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "open") throw INVITATION_FINAL(current.status);
  const updated = await closeInvitation(tx, ctx, current, "cancelled");
  return updated;
}

/** open -> responded | cancelled, its audit event, and the invitee's work item closed (done / cancelled). */
async function closeInvitation(
  tx: Tx,
  ctx: WriteContext,
  current: AssessmentInvitationRow,
  to: "responded" | "cancelled",
): Promise<AssessmentInvitationRow> {
  const updated = await tx
    .updateTable("assessment_invitation")
    .set({ status: to, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: to === "responded" ? "assessment_invitation.respond" : "assessment_invitation.cancel",
    recordType: "assessment_invitation",
    recordId: current.id,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...INVITATION_AUDIT_FIELDS]),
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx),
    {
      organizationId: current.organization_id,
      subjectType: "assessment_invitation",
      subjectId: current.id,
      kinds: [ASSESSMENT_INVITATION_TASK_KIND],
    },
    to === "responded" ? "done" : "cancelled",
  );
  return updated;
}

// ------------------------------------------------------------------------------------------------ records

/**
 * Answer the published version of a published form (ADR-0033 §5, §9). The caller holds assessment.respond (commit
 * time) and either answers an open invitation of theirs for this form, group and subject (named, or found), or - for a
 * proficiency observation without invitation - holds proficiency.record as an assessor; anyone else gets 403
 * assessment_record.not_invited. Answers are checked against the published version; the proficiency result is
 * derived from them. The invitation becomes `responded`, and the form's creator gets one `assessment_to_review` item.
 */
async function createRecord(tx: Tx, request: FastifyRequest): Promise<AssessmentRecordRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_RESPOND);
  const body = parseBody(assessmentRecordCreate, request.body);
  const form = await tx
    .selectFrom("assessment_form")
    .selectAll()
    .where("id", "=", body.formId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!form) throw REFERENCE("/formId");
  const observation = form.kind === "proficiency_assessment";
  if (observation) {
    if (body.subjectUserId === undefined && body.subjectLabel === undefined) throw SUBJECT_REQUIRED();
    if (body.subjectUserId !== undefined && body.subjectLabel !== undefined) throw notApplicable("/subjectLabel");
  } else {
    if (body.subjectUserId !== undefined) throw notApplicable("/subjectUserId");
    if (body.subjectLabel !== undefined) throw notApplicable("/subjectLabel");
  }
  if (form.status !== "published" || form.published_version_no === null) throw FORM_NOT_PUBLISHED();
  const subjectUserId = body.subjectUserId ?? null;

  // Invited, or an assessor recording an observation without invitation.
  let invitation: AssessmentInvitationRow | undefined;
  if (body.invitationId !== undefined) {
    invitation = await tx
      .selectFrom("assessment_invitation")
      .selectAll()
      .where("id", "=", body.invitationId)
      .where("transformation_id", "=", transformationId)
      .forUpdate()
      .executeTakeFirst();
    if (!invitation || invitation.user_id !== ctx.userId) throw NOT_INVITED();
    if (invitation.status !== "open") throw INVITATION_FINAL(invitation.status);
    if (
      invitation.form_id !== form.id ||
      invitation.stakeholder_group_id !== body.stakeholderGroupId ||
      invitation.subject_user_id !== subjectUserId
    )
      throw NOT_INVITED();
  } else {
    invitation = await tx
      .selectFrom("assessment_invitation")
      .selectAll()
      .where("form_id", "=", form.id)
      .where("user_id", "=", ctx.userId)
      .where("stakeholder_group_id", "=", body.stakeholderGroupId)
      .where("status", "=", "open")
      .where(
        subjectUserId === null
          ? sql<boolean>`subject_user_id IS NULL`
          : sql<boolean>`subject_user_id = ${subjectUserId}::uuid`,
      )
      .forUpdate()
      .executeTakeFirst();
    if (!invitation && !(observation && (await holds(tx, ctx.principal, PROFICIENCY_RECORD, ctx.target))))
      throw NOT_INVITED();
  }

  const group = await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: subjectUserId, pointer: "/subjectUserId" }]);
  const version = await tx
    .selectFrom("assessment_form_version")
    .select(["id", "schema"])
    .where("form_id", "=", form.id)
    .where("version_no", "=", form.published_version_no)
    .executeTakeFirstOrThrow();
  const schema = version.schema as AssessmentFormSchemaJson;
  const issues = validateAnswers(schema, body.answers);
  if (issues.length > 0) throw answersInvalid(issues);
  const result = deriveProficiencyResult(schema, body.answers);

  const id = uuidv7();
  const row = await tx
    .insertInto("assessment_record")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      form_id: form.id,
      form_version_id: version.id,
      invitation_id: invitation?.id ?? null,
      stakeholder_group_id: group.id,
      kind: observation ? "proficiency_observation" : "feedback",
      respondent_user_id: ctx.userId,
      subject_user_id: subjectUserId,
      subject_label: body.subjectLabel ?? null,
      observed_on: body.observedOn,
      answers: JSON.stringify(body.answers),
      proficiency_result: observation ? result : null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "assessment_record.create",
    recordType: "assessment_record",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as AssessmentRecordRow, row, [...RECORD_AUDIT_FIELDS]),
  });
  if (invitation) await closeInvitation(tx, ctx, invitation, "responded");
  await createWorkItemOnce(tx, userActor(ctx), {
    organizationId: ctx.organizationId,
    transformationId,
    kind: ASSESSMENT_REVIEW_TASK_KIND,
    assigneeUserId: form.created_by,
    subjectType: "assessment_record",
    subjectId: id,
    linkPath: `/transformations/${transformationId}/assessment-records/${id}`,
    messageKey: "adoption.task.assessment_to_review",
    messageParams: { formName: form.name },
    dueDate: null,
    dedupeKey: `assessment.review:${id}`,
  });
  return row;
}

async function lockRecord(tx: Tx, transformationId: string, recordId: string): Promise<AssessmentRecordRow> {
  const row = await tx
    .selectFrom("assessment_record")
    .selectAll()
    .where("id", "=", recordId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function closeReviewTask(tx: Tx, ctx: WriteContext, row: AssessmentRecordRow, status: "done" | "cancelled") {
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx),
    {
      organizationId: row.organization_id,
      subjectType: "assessment_record",
      subjectId: row.id,
      kinds: [ASSESSMENT_REVIEW_TASK_KIND],
    },
    status,
  );
}

/** Mark a submitted record reviewed with an optional note (assessment.review; BO). No SoD is required (§9). */
async function reviewRecord(tx: Tx, request: FastifyRequest): Promise<AssessmentRecordRow> {
  const { transformationId, assessmentRecordId } = parse(recordParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, ASSESSMENT_REVIEW);
  const current = await lockRecord(tx, transformationId, assessmentRecordId);
  const body = parseBody(assessmentReview, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "withdrawn") throw RECORD_WITHDRAWN();
  if (current.status !== "submitted") throw RECORD_TRANSITION(current.status, "reviewed");
  const updated = await tx
    .updateTable("assessment_record")
    .set({
      status: "reviewed",
      reviewed_at: sql<Date>`now()`,
      reviewed_by: ctx.userId,
      review_note: body.note ?? null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "assessment_record.review",
    recordType: "assessment_record",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...RECORD_AUDIT_FIELDS]),
  });
  await closeReviewTask(tx, ctx, updated, "done");
  return updated;
}

/**
 * Withdraw a record with a reason (assessment.review, or the respondent holding assessment.respond on their own
 * record; anyone else 403 assessment_record.not_withdrawable_by_caller, checked at commit time). Final; it stops
 * counting in the measures. A correction is a withdrawal and a new response.
 */
async function withdrawRecord(tx: Tx, request: FastifyRequest): Promise<AssessmentRecordRow> {
  const { transformationId, assessmentRecordId } = parse(recordParams, request.params, "params");
  await requireTransformationRead(tx, principalOf(request), transformationId);
  const current = await lockRecord(tx, transformationId, assessmentRecordId);
  let ctx: WriteContext;
  try {
    ctx = await openWrite(
      tx,
      request,
      transformationId,
      [{ permission: ASSESSMENT_REVIEW }, { permission: ASSESSMENT_RESPOND, scope: "own" }],
      { createdBy: current.created_by },
      { atCommit: true },
    );
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 403)
      throw err.denial === undefined ? NOT_WITHDRAWABLE() : NOT_WITHDRAWABLE().withDenial(err.denial);
    throw err;
  }
  const body = parseBody(adoptionReason, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "withdrawn") throw RECORD_WITHDRAWN();
  const updated = await tx
    .updateTable("assessment_record")
    .set({
      status: "withdrawn",
      withdrawn_at: sql<Date>`now()`,
      withdrawn_by: ctx.userId,
      withdraw_reason: body.reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "assessment_record.withdraw",
    recordType: "assessment_record",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...RECORD_AUDIT_FIELDS]),
  });
  await closeReviewTask(tx, ctx, updated, "cancelled");
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const formListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["draft", "published", "retired"]).optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const recordListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  stakeholderGroupId: z.uuid().optional(),
  assessmentFormId: z.uuid().optional(),
  kind: z.enum(["feedback", "proficiency_observation"]).optional(),
  status: z.enum(["submitted", "reviewed", "withdrawn"]).optional(),
});

export function registerAssessmentRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const manage = { access: { permission: ASSESSMENT_FORM_MANAGE }, consumes: JSON_BODY };
  const manageBodiless = { access: { permission: ASSESSMENT_FORM_MANAGE } };
  const respond = { access: { permission: ASSESSMENT_RESPOND }, consumes: JSON_BODY };
  const review = { access: { permission: ASSESSMENT_REVIEW }, consumes: JSON_BODY };
  // The withdraw rule is "assessment.review, or the respondent's own record": the route declares the respondent's
  // code, and the handler applies the full rule at commit time.
  const withdraw = { access: { permission: ASSESSMENT_RESPOND }, consumes: JSON_BODY };

  // ---- forms
  app.get(ASSESSMENT_FORMS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(formListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "assessment_form", transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("assessment_form").selectAll().where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentForms(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(ASSESSMENT_FORMS, { config: manage }, async (request, reply) => {
    const out = await db.transaction().execute(async (tx) => {
      const row = await createForm(tx, request);
      return (await presentForms(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 201, out, `${request.url.split("?")[0]!}/${out.id}`);
  });

  app.get(ASSESSMENT_FORM, { config: read }, async (request, reply) => {
    const { transformationId, assessmentFormId } = parse(formParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("assessment_form")
      .selectAll()
      .where("id", "=", assessmentFormId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentForms(db, [row]))[0]!);
  });

  app.patch(ASSESSMENT_FORM, { config: manage }, async (request, reply) => {
    const out = await db
      .transaction()
      .execute(async (tx) => (await presentForms(tx, [await updateForm(tx, request)]))[0]!);
    return sendVersioned(reply, 200, out);
  });

  app.post(ASSESSMENT_FORM_PUBLISH, { config: manageBodiless }, async (request, reply) => {
    const out = await db
      .transaction()
      .execute(async (tx) => (await presentForms(tx, [await moveForm(tx, request, "published")]))[0]!);
    return sendVersioned(reply, 200, out);
  });

  app.post(ASSESSMENT_FORM_RETIRE, { config: manageBodiless }, async (request, reply) => {
    const out = await db
      .transaction()
      .execute(async (tx) => (await presentForms(tx, [await moveForm(tx, request, "retired")]))[0]!);
    return sendVersioned(reply, 200, out);
  });

  // ---- invitations
  app.get(ASSESSMENT_FORM_INVITATIONS, { config: read }, async (request) => {
    const { transformationId, assessmentFormId } = parse(formParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const form = await db
      .selectFrom("assessment_form")
      .select("id")
      .where("id", "=", assessmentFormId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!form) throw problems.notFound();
    const hash = filterHash({ table: "assessment_invitation", transformationId, formId: form.id });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("assessment_invitation").selectAll().where("form_id", "=", form.id);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toAssessmentInvitation), nextCursor: page.nextCursor };
  });

  app.post(ASSESSMENT_FORM_INVITATIONS, { config: manage }, async (request, reply) => {
    const rows = await db.transaction().execute((tx) => createInvitations(tx, request));
    return reply.code(201).send({ items: rows.map(toAssessmentInvitation) });
  });

  app.post(ASSESSMENT_INVITATION_CANCEL, { config: manageBodiless }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => cancelInvitation(tx, request));
    return sendVersioned(reply, 200, toAssessmentInvitation(row));
  });

  // ---- records
  app.get(ASSESSMENT_RECORDS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(recordListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "assessment_record",
      transformationId,
      stakeholderGroupId: query.stakeholderGroupId ?? null,
      assessmentFormId: query.assessmentFormId ?? null,
      kind: query.kind ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = recordQuery(db, transformationId);
    if (query.stakeholderGroupId !== undefined) q = q.where("r.stakeholder_group_id", "=", query.stakeholderGroupId);
    if (query.assessmentFormId !== undefined) q = q.where("r.form_id", "=", query.assessmentFormId);
    if (query.kind !== undefined) q = q.where("r.kind", "=", query.kind);
    if (query.status !== undefined) q = q.where("r.status", "=", query.status);
    if (after) q = q.where("r.id", ">", String(after[0]));
    const rows = await q
      .orderBy("r.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toAssessmentRecord), nextCursor: page.nextCursor };
  });

  app.post(ASSESSMENT_RECORDS, { config: respond }, async (request, reply) => {
    const out = await db.transaction().execute(async (tx) => withVersionNo(tx, await createRecord(tx, request)));
    return sendVersioned(reply, 201, toAssessmentRecord(out), `${request.url.split("?")[0]!}/${out.id}`);
  });

  app.get(ASSESSMENT_RECORD, { config: read }, async (request, reply) => {
    const { transformationId, assessmentRecordId } = parse(recordParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await recordQuery(db, transformationId).where("r.id", "=", assessmentRecordId).executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toAssessmentRecord(row));
  });

  app.post(ASSESSMENT_RECORD_REVIEW, { config: review }, async (request, reply) => {
    const out = await db.transaction().execute(async (tx) => withVersionNo(tx, await reviewRecord(tx, request)));
    return sendVersioned(reply, 200, toAssessmentRecord(out));
  });

  app.post(ASSESSMENT_RECORD_WITHDRAW, { config: withdraw }, async (request, reply) => {
    const out = await db.transaction().execute(async (tx) => withVersionNo(tx, await withdrawRecord(tx, request)));
    return sendVersioned(reply, 200, toAssessmentRecord(out));
  });

  return [
    `GET ${ASSESSMENT_FORMS}`,
    `POST ${ASSESSMENT_FORMS}`,
    `GET ${ASSESSMENT_FORM}`,
    `PATCH ${ASSESSMENT_FORM}`,
    `POST ${ASSESSMENT_FORM_PUBLISH}`,
    `POST ${ASSESSMENT_FORM_RETIRE}`,
    `GET ${ASSESSMENT_FORM_INVITATIONS}`,
    `POST ${ASSESSMENT_FORM_INVITATIONS}`,
    `POST ${ASSESSMENT_INVITATION_CANCEL}`,
    `GET ${ASSESSMENT_RECORDS}`,
    `POST ${ASSESSMENT_RECORDS}`,
    `GET ${ASSESSMENT_RECORD}`,
    `POST ${ASSESSMENT_RECORD_REVIEW}`,
    `POST ${ASSESSMENT_RECORD_WITHDRAW}`,
  ];
}
