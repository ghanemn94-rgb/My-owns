// zod mirrors of the P4 slice D committee workflow: agenda items with executive-ask briefs, attendance, minutes, meeting
// outputs and meeting actions (OpenAPI tags "agenda-items", "attendance", "minutes", "meetings"; ADR-0032 §3.2-§5;
// REQ-PB-061, REQ-PB-068, REQ-S10-011, REQ-S16-019; T-DG4-BE-F2). A brief is a draft executive ask: publication moves it
// into the T16 decision and clears it. Nothing here is a G1-G6 business approval or touches DG0-DG7.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { meetingOutputKind } from "./governance-meetings.ts";
import { businessDate } from "./kpi.ts";
import { raidAction } from "./raid.ts";

export const AGENDA_ITEM_KINDS = ["executive_ask", "discussion", "information"] as const;
export const agendaItemKind = z.enum(AGENDA_ITEM_KINDS);
export const agendaItemStatus = z.enum(["draft", "published", "closed", "withdrawn"]);
export const agendaItemOutcomeKind = z.enum(["decided", "deferred", "noted"]);
/** The seven elements an executive ask states (B0102's five plus REQ-S10-012's why now and required date). */
export const AGENDA_ASK_ELEMENTS = [
  "decision_required",
  "why_now",
  "options",
  "recommendation",
  "impact_of_delay",
  "decision_owner",
  "required_date",
] as const;
export const agendaAskElement = z.enum(AGENDA_ASK_ELEMENTS);
export type AgendaAskElement = z.infer<typeof agendaAskElement>;
export const attendanceKind = z.enum(["present", "absent", "apologies"]);
export const meetingMinutesStatus = z.enum(["draft", "approved", "published"]);
export const MEETING_OUTPUT_RECORD_TYPES = [
  "decision",
  "raid_entry",
  "dependency",
  "benefit",
  "milestone",
  "action_item",
  "evidence",
  "benefit_evidence",
  "benefit_measurement",
  "corrective_case",
] as const;
export const meetingOutputRecordType = z.enum(MEETING_OUTPUT_RECORD_TYPES);
export type MeetingOutputRecordType = z.infer<typeof meetingOutputRecordType>;

const itemTitle = freeText(1, 500);
const itemDescription = freeText(1, 8000);
const durationMinutes = z.number().int().min(1).max(480);
const materials = z.array(uuid).max(20);
const askText500 = freeText(1, 500);
const askText4000 = freeText(1, 4000);
const askOptions = z.array(freeText(1, 300)).min(1).max(26);

// ------------------------------------------------------------------------------------------------ agenda items

/** OpenAPI `ExecutiveAskBrief`: the draft ask as stored on the item (every element may still be missing). */
export const executiveAskBrief = z.strictObject({
  decisionRequired: z.string().min(1).max(500).nullable(),
  whyNow: z.string().min(1).max(4000).nullable(),
  options: z.array(z.string().min(1).max(300)).min(1).max(26).nullable(),
  recommendation: z.string().min(1).max(4000).nullable(),
  impactOfDelay: z.string().min(1).max(4000).nullable(),
  ownerUserId: uuid.nullable(),
  requiredDate: businessDate.nullable(),
});
export type ExecutiveAskBrief = z.infer<typeof executiveAskBrief>;

/** OpenAPI `ExecutiveAskBriefInput` (minProperties 1): the elements being set or cleared. */
export const executiveAskBriefInput = z
  .strictObject({
    decisionRequired: askText500.nullable().optional(),
    whyNow: askText4000.nullable().optional(),
    options: askOptions.nullable().optional(),
    recommendation: askText4000.nullable().optional(),
    impactOfDelay: askText4000.nullable().optional(),
    ownerUserId: uuid.nullable().optional(),
    requiredDate: businessDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type ExecutiveAskBriefInput = z.infer<typeof executiveAskBriefInput>;

export const agendaItem = z.strictObject({
  id: uuid,
  meetingId: uuid,
  ordinal: z.number().int().min(1).max(999),
  itemKind: agendaItemKind,
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(8000).nullable(),
  presenterUserId: uuid.nullable(),
  durationMinutes: durationMinutes.nullable(),
  materialsEvidenceIds: materials,
  decisionId: uuid.nullable(),
  brief: executiveAskBrief.nullable(),
  missingElements: z.array(agendaAskElement).max(7),
  late: z.boolean(),
  status: agendaItemStatus,
  publishedAt: timestamp.nullable(),
  publishedBy: uuid.nullable(),
  outcome: agendaItemOutcomeKind.nullable(),
  outcomeQuorumPresent: z.number().int().min(0).nullable(),
  outcomeRecordedAt: timestamp.nullable(),
  outcomeRecordedBy: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type AgendaItem = z.infer<typeof agendaItem>;
export const agendaItemPage = page(agendaItem);

export const agendaItemCreate = z.strictObject({
  itemKind: agendaItemKind,
  title: itemTitle,
  description: itemDescription.nullable().optional(),
  presenterUserId: uuid.nullable().optional(),
  durationMinutes: durationMinutes.nullable().optional(),
  materialsEvidenceIds: materials.optional(),
  decisionId: uuid.optional(),
  brief: executiveAskBriefInput.optional(),
});
export type AgendaItemCreate = z.infer<typeof agendaItemCreate>;

export const agendaItemUpdate = z
  .strictObject({
    title: itemTitle.optional(),
    description: itemDescription.nullable().optional(),
    presenterUserId: uuid.nullable().optional(),
    durationMinutes: durationMinutes.nullable().optional(),
    materialsEvidenceIds: materials.optional(),
    ordinal: z.number().int().min(1).max(999).optional(),
    decisionId: uuid.nullable().optional(),
    brief: executiveAskBriefInput.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type AgendaItemUpdate = z.infer<typeof agendaItemUpdate>;

export const agendaItemOutcome = z.strictObject({
  outcome: agendaItemOutcomeKind,
  chosenOptionLabel: z
    .string()
    .regex(/^[A-Z]$/, "validation.option_label")
    .optional(),
  outcomeText: freeText(1, 8000).optional(),
  decisionVersion: z.number().int().min(1).optional(),
});
export type AgendaItemOutcome = z.infer<typeof agendaItemOutcome>;

// ------------------------------------------------------------------------------------------------ attendance

export const meetingAttendance = z.strictObject({
  id: uuid,
  meetingId: uuid,
  userId: uuid,
  attendance: attendanceKind,
  countsForQuorum: z.boolean(),
  onBehalfOfUserId: uuid.nullable(),
  note: z.string().min(1).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type MeetingAttendance = z.infer<typeof meetingAttendance>;
export const meetingAttendancePage = page(meetingAttendance);

export const meetingAttendanceCreate = z.strictObject({
  userId: uuid,
  attendance: attendanceKind,
  onBehalfOfUserId: uuid.nullable().optional(),
  note: freeText(1, 1000).nullable().optional(),
});
export type MeetingAttendanceCreate = z.infer<typeof meetingAttendanceCreate>;

export const meetingAttendanceUpdate = z
  .strictObject({
    attendance: attendanceKind.optional(),
    onBehalfOfUserId: uuid.nullable().optional(),
    note: freeText(1, 1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type MeetingAttendanceUpdate = z.infer<typeof meetingAttendanceUpdate>;

// ------------------------------------------------------------------------------------------------ minutes

export const meetingMinutes = z.strictObject({
  id: uuid,
  meetingId: uuid,
  body: z.string().min(1).max(50000),
  status: meetingMinutesStatus,
  approvedAt: timestamp.nullable(),
  approvedBy: uuid.nullable(),
  publishedAt: timestamp.nullable(),
  publishedBy: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type MeetingMinutes = z.infer<typeof meetingMinutes>;

export const meetingMinutesCreate = z.strictObject({ body: freeText(1, 50000) });
export type MeetingMinutesCreate = z.infer<typeof meetingMinutesCreate>;

export const meetingMinutesUpdate = z
  .strictObject({
    body: freeText(1, 50000).optional(),
    status: z.literal("draft").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type MeetingMinutesUpdate = z.infer<typeof meetingMinutesUpdate>;

// ------------------------------------------------------------------------------------------------ outputs

export const meetingOutput = z.strictObject({
  id: uuid,
  meetingId: uuid,
  agendaItemId: uuid.nullable(),
  outputKind: meetingOutputKind,
  recordType: meetingOutputRecordType.nullable(),
  recordId: uuid.nullable(),
  note: z.string().min(1).max(4000).nullable(),
  createdAt: timestamp,
  createdBy: uuid,
});
export type MeetingOutput = z.infer<typeof meetingOutput>;
export const meetingOutputPage = page(meetingOutput);

export const meetingOutputCreate = z.strictObject({
  outputKind: meetingOutputKind,
  agendaItemId: uuid.optional(),
  recordType: meetingOutputRecordType.optional(),
  recordId: uuid.optional(),
  note: freeText(1, 4000).optional(),
});
export type MeetingOutputCreate = z.infer<typeof meetingOutputCreate>;

// ------------------------------------------------------------------------------------------------ actions

export const meetingAction = z.strictObject({
  id: uuid,
  meetingId: uuid,
  agendaItemId: uuid.nullable(),
  actionItemId: uuid,
  linkKind: z.enum(["assigned", "reviewed"]),
  overdue: z.boolean(),
  action: raidAction,
  createdAt: timestamp,
  createdBy: uuid,
});
export type MeetingAction = z.infer<typeof meetingAction>;
export const meetingActionPage = page(meetingAction);

export const meetingActionCreate = z.strictObject({
  agendaItemId: uuid.optional(),
  title: freeText(1, 500),
  description: freeText(1, 4000).nullable().optional(),
  ownerUserId: uuid,
  dueDate: businessDate.nullable().optional(),
});
export type MeetingActionCreate = z.infer<typeof meetingActionCreate>;
