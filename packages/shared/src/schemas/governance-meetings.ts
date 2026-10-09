// zod mirrors of the P4 slice D forums, forum participants, meeting series and meetings (OpenAPI tags "forums",
// "meeting-series", "meetings"; ADR-0032 §1-§3.1; REQ-PB-060, REQ-S10-005, REQ-S16-019; T-DG4-BE-F). The five seeded
// forums carry the B0093 row verbatim (English) with PROVISIONAL Arabic. A meeting is a governance event inside the
// product; nothing here relates to the engineering gates DG0-DG7, and no meeting approves anything.
import { z } from "zod";
import { freeText, timeZone, timestamp, uuid, version } from "./common.ts";
import { weekday } from "./calendar.ts";
import { partyCode } from "./groups.ts";
import { businessDate } from "./kpi.ts";

/** The outputs of the five operating-system layers (B0093 "Outputs"), one code per named output. */
export const MEETING_OUTPUT_KINDS = [
  "decision",
  "unblocker",
  "benefit_view",
  "integrated_status",
  "decision_log",
  "milestone",
  "action",
  "raid",
  "test",
  "evidence",
  "recommendation",
  "benefit_evidence",
  "forecast",
  "corrective_action",
] as const;
export const meetingOutputKind = z.enum(MEETING_OUTPUT_KINDS);
export type MeetingOutputKind = z.infer<typeof meetingOutputKind>;
export const MEETING_STATUSES = [
  "scheduled",
  "agenda_published",
  "in_session",
  "held",
  "minutes_published",
  "cancelled",
] as const;
export const meetingStatus = z.enum(MEETING_STATUSES);
export type MeetingStatus = z.infer<typeof meetingStatus>;
export const FORUM_TEMPLATE_KEYS = [
  "executive_steerco",
  "transformation_review",
  "workstream_review",
  "rapid_response",
  "value_review",
] as const;
export const forumTemplateKey = z.enum(FORUM_TEMPLATE_KEYS);
export const forumStatus = z.enum(["active", "archived"]);
export const lateItemsRule = z.enum(["flag", "refuse"]);
export const meetingFrequency = z.enum(["daily", "weekly", "monthly"]);
export const nonWorkingDayRule = z.enum(["next_working_day", "skip", "keep"]);
export const meetingSeriesStatus = z.enum(["active", "ended"]);
export const cutoffUnknownReason = z.enum(["calendar_not_configured"]);
/** Local wall-clock time HH:MM (24 h). */
export const localTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "validation.local_time");

const forumName = freeText(1, 200);
const forumPurpose = freeText(1, 2000);
const forumLabel500 = freeText(1, 500);
const location = freeText(1, 300);
const partyList = z.array(partyCode).max(18);
const outputKinds = z.array(meetingOutputKind).min(1).max(14);
const publishOutputs = z.array(meetingOutputKind).max(14);
const quorum = z.number().int().min(1).max(100);
const cutoffWorkingDays = z.number().int().min(0).max(20);
const agendaMax = z.number().int().min(1).max(50);
const weekdays = z
  .array(weekday)
  .min(1)
  .max(7)
  .refine((v) => new Set(v).size === v.length, "validation.unique_items");
const intervalCount = z.number().int().min(1).max(12);
const monthDay = z.number().int().min(1).max(28);
const durationMinutes = z.number().int().min(15).max(480);
const horizonDays = z.number().int().min(7).max(366);

// ------------------------------------------------------------------------------------------------ forums

export const forumSourceTexts = z.strictObject({
  layerEn: z.string(),
  cadenceEn: z.string(),
  purposeEn: z.string(),
  participantsEn: z.string(),
  outputsEn: z.string(),
  layerAr: z.string(),
  cadenceAr: z.string(),
  purposeAr: z.string(),
  participantsAr: z.string(),
  outputsAr: z.string(),
  arProvisional: z.boolean(),
  sourceRef: z.string(),
});
export type ForumSourceTexts = z.infer<typeof forumSourceTexts>;

export const forum = z.strictObject({
  id: uuid,
  transformationId: uuid,
  templateKey: forumTemplateKey.nullable(),
  source: forumSourceTexts.nullable(),
  ordinal: z.number().int().min(1).max(999),
  nameEn: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  cadenceLabel: z.string().min(1).max(200),
  purpose: z.string().min(1).max(2000),
  participantsLabel: z.string().min(1).max(500),
  outputsLabel: z.string().min(1).max(500),
  chairPartyCode: partyCode.nullable(),
  secretaryUserId: uuid.nullable(),
  participantParties: z.array(partyCode).max(18),
  outputKinds,
  publishRequiresAnyOutput: publishOutputs,
  executiveAsksOnly: z.boolean(),
  quorumMin: quorum.nullable(),
  cutoffWorkingDays,
  agendaMaxItems: agendaMax.nullable(),
  lateItemsRule,
  status: forumStatus,
  activeSeriesId: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type Forum = z.infer<typeof forum>;
export const forumPage = z.strictObject({ items: z.array(forum), nextCursor: z.string().nullable() });

export const forumCreate = z.strictObject({
  nameEn: forumName,
  nameAr: forumName,
  cadenceLabel: forumName,
  purpose: forumPurpose,
  participantsLabel: forumLabel500,
  outputsLabel: forumLabel500,
  chairPartyCode: partyCode.nullable().optional(),
  secretaryUserId: uuid.nullable().optional(),
  participantParties: partyList.optional(),
  outputKinds,
  publishRequiresAnyOutput: publishOutputs.optional(),
  executiveAsksOnly: z.boolean().optional(),
  quorumMin: quorum.nullable().optional(),
  cutoffWorkingDays: cutoffWorkingDays.optional(),
  agendaMaxItems: agendaMax.nullable().optional(),
  lateItemsRule: lateItemsRule.optional(),
});
export type ForumCreate = z.infer<typeof forumCreate>;

export const forumUpdate = z
  .strictObject({
    nameEn: forumName.optional(),
    nameAr: forumName.optional(),
    cadenceLabel: forumName.optional(),
    purpose: forumPurpose.optional(),
    participantsLabel: forumLabel500.optional(),
    outputsLabel: forumLabel500.optional(),
    chairPartyCode: partyCode.nullable().optional(),
    secretaryUserId: uuid.nullable().optional(),
    participantParties: partyList.optional(),
    outputKinds: outputKinds.optional(),
    publishRequiresAnyOutput: publishOutputs.optional(),
    executiveAsksOnly: z.boolean().optional(),
    quorumMin: quorum.nullable().optional(),
    cutoffWorkingDays: cutoffWorkingDays.optional(),
    agendaMaxItems: agendaMax.nullable().optional(),
    lateItemsRule: lateItemsRule.optional(),
    /** Archiving is final. */
    status: z.literal("archived").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type ForumUpdate = z.infer<typeof forumUpdate>;

export const forumListQuery = z.strictObject({ status: forumStatus.optional() });

export const forumParticipant = z.strictObject({
  id: uuid,
  forumId: uuid,
  userId: uuid.nullable(),
  groupId: uuid.nullable(),
  countsForQuorum: z.boolean(),
  status: z.enum(["active", "removed"]),
  removedAt: timestamp.nullable(),
  removedBy: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type ForumParticipant = z.infer<typeof forumParticipant>;
export const forumParticipantPage = z.strictObject({
  items: z.array(forumParticipant),
  nextCursor: z.string().nullable(),
});

/** Exactly one of userId and groupId (OpenAPI oneOf). */
export const forumParticipantCreate = z.union([
  z.strictObject({ userId: uuid, countsForQuorum: z.boolean().optional() }),
  z.strictObject({ groupId: uuid, countsForQuorum: z.boolean().optional() }),
]);
export type ForumParticipantCreate = z.infer<typeof forumParticipantCreate>;

// ------------------------------------------------------------------------------------------------ meeting series

export const meetingSeries = z.strictObject({
  id: uuid,
  transformationId: uuid,
  forumId: uuid,
  frequency: meetingFrequency,
  intervalCount,
  weekdays: weekdays.nullable(),
  monthDay: monthDay.nullable(),
  startDate: businessDate,
  endDate: businessDate.nullable(),
  startTime: localTime,
  durationMinutes,
  timezone: z.string().min(1).max(64),
  nonWorkingDayRule,
  horizonDays,
  location: z.string().min(1).max(300).nullable(),
  ruleVersion: z.number().int().min(1),
  generatedThrough: businessDate.nullable(),
  status: meetingSeriesStatus,
  endedAt: timestamp.nullable(),
  endedBy: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid.nullable(),
});
export type MeetingSeries = z.infer<typeof meetingSeries>;
export const meetingSeriesPage = z.strictObject({ items: z.array(meetingSeries), nextCursor: z.string().nullable() });

export const meetingSeriesCreate = z.strictObject({
  forumId: uuid,
  frequency: meetingFrequency,
  intervalCount,
  weekdays: weekdays.nullable().optional(),
  monthDay: monthDay.nullable().optional(),
  startDate: businessDate,
  endDate: businessDate.nullable().optional(),
  startTime: localTime,
  durationMinutes,
  timezone: timeZone.optional(),
  nonWorkingDayRule: nonWorkingDayRule.optional(),
  horizonDays: horizonDays.optional(),
  location: location.nullable().optional(),
});
export type MeetingSeriesCreate = z.infer<typeof meetingSeriesCreate>;

export const meetingSeriesUpdate = z
  .strictObject({
    frequency: meetingFrequency.optional(),
    intervalCount: intervalCount.optional(),
    weekdays: weekdays.nullable().optional(),
    monthDay: monthDay.nullable().optional(),
    startDate: businessDate.optional(),
    endDate: businessDate.nullable().optional(),
    startTime: localTime.optional(),
    durationMinutes: durationMinutes.optional(),
    timezone: timeZone.optional(),
    nonWorkingDayRule: nonWorkingDayRule.optional(),
    horizonDays: horizonDays.optional(),
    location: location.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type MeetingSeriesUpdate = z.infer<typeof meetingSeriesUpdate>;

export const meetingSeriesListQuery = z.strictObject({
  forumId: uuid.optional(),
  status: meetingSeriesStatus.optional(),
});

export const meetingSeriesResult = z.strictObject({
  series: meetingSeries,
  createdMeetingIds: z.array(uuid).max(400),
  cancelledMeetingIds: z.array(uuid).max(400),
  keptMeetingIds: z.array(uuid).max(400),
  generationUnknownReason: cutoffUnknownReason.nullable(),
});
export type MeetingSeriesResult = z.infer<typeof meetingSeriesResult>;

// ------------------------------------------------------------------------------------------------ meetings

export const meeting = z.strictObject({
  id: uuid,
  transformationId: uuid,
  forumId: uuid,
  seriesId: uuid.nullable(),
  seriesRuleVersion: z.number().int().min(1).nullable(),
  occurrenceDate: businessDate.nullable(),
  scheduledDate: businessDate,
  startsAt: timestamp,
  endsAt: timestamp,
  timezone: z.string(),
  location: z.string().min(1).max(300).nullable(),
  chairUserId: uuid.nullable(),
  secretaryUserId: uuid.nullable(),
  quorumMin: quorum.nullable(),
  presentCount: z.number().int().min(0),
  quorumState: z.enum(["not_configured", "met", "not_met"]),
  cutoffDate: businessDate.nullable(),
  cutoffUnknownReason: cutoffUnknownReason.nullable(),
  status: meetingStatus,
  cancelReason: z.enum(["series_regenerated", "series_ended", "manual"]).nullable(),
  cancelNote: z.string().min(3).max(2000).nullable(),
  cancelledAt: timestamp.nullable(),
  cancelledBy: uuid.nullable(),
  startedAt: timestamp.nullable(),
  heldAt: timestamp.nullable(),
  createdSource: z.enum(["api", "worker"]),
  version,
  createdAt: timestamp,
  createdBy: uuid.nullable(),
  updatedAt: timestamp,
  updatedBy: uuid.nullable(),
});
export type Meeting = z.infer<typeof meeting>;
export const meetingPage = z.strictObject({ items: z.array(meeting), nextCursor: z.string().nullable() });

export const meetingCreate = z.strictObject({
  forumId: uuid,
  scheduledDate: businessDate,
  startTime: localTime,
  durationMinutes,
  location: location.nullable().optional(),
  chairUserId: uuid.nullable().optional(),
  secretaryUserId: uuid.nullable().optional(),
});
export type MeetingCreate = z.infer<typeof meetingCreate>;

export const meetingUpdate = z
  .strictObject({
    scheduledDate: businessDate.optional(),
    startTime: localTime.optional(),
    durationMinutes: durationMinutes.optional(),
    location: location.nullable().optional(),
    chairUserId: uuid.nullable().optional(),
    secretaryUserId: uuid.nullable().optional(),
    quorumMin: quorum.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_patch");
export type MeetingUpdate = z.infer<typeof meetingUpdate>;

export const meetingListQuery = z.strictObject({
  forumId: uuid.optional(),
  status: meetingStatus.optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
});
