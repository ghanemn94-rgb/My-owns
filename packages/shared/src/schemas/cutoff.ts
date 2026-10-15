// The meeting cut-off draft agenda and pack (ADR-0044 §6; REQ-S12-015, M0235 "Meeting cut-off reached | Generate a
// draft agenda and pack from current data with a review step before publication"; OpenAPI `MeetingCutoffPack`,
// `MeetingCutoffPackReview`; p5-work-split §E.4, T-DG5-BE-L2). The pack is generated once per meeting by the
// `governance.meeting_cutoff_scan` job; the chair or the secretary marks it reviewed, and only then can its draft agenda
// items be published (the DG4 per-item publish by the chair). A review is a human action; no job reviews a pack.
import { z } from "zod";
import { freeText, timestamp, uuid } from "./common.ts";
import { businessDate } from "./kpi.ts";

/**
 * One open executive ask as it stood at the cut-off (the `open_asks` snapshot; never changes, MP05). `agendaItemId`
 * is the draft agenda item generated for it, or null when the forum's agenda limit left no room for it.
 */
export const meetingCutoffOpenAsk = z.strictObject({
  decisionId: uuid,
  code: z.string(),
  title: z.string(),
  status: z.enum(["open", "deferred"]),
  ownerUserId: uuid.nullable(),
  dueDate: businessDate.nullable(),
  agendaItemId: uuid.nullable(),
});
export type MeetingCutoffOpenAsk = z.infer<typeof meetingCutoffOpenAsk>;

export const meetingCutoffPack = z.strictObject({
  id: uuid,
  meetingId: uuid,
  cutoffDate: businessDate,
  asOf: timestamp,
  openAsks: z.array(meetingCutoffOpenAsk).max(200),
  agendaItemIds: z.array(uuid).max(200),
  status: z.enum(["draft", "reviewed"]),
  reviewedBy: uuid.nullable(),
  reviewedAt: timestamp.nullable(),
  reviewNote: z.string().nullable(),
  /** False when the meeting has neither a chair nor a secretary: the pack shows "No reviewer assigned". */
  reviewerAssigned: z.boolean(),
  version: z.number().int().min(1),
  updatedAt: timestamp,
});
export type MeetingCutoffPack = z.infer<typeof meetingCutoffPack>;

/** POST …/cutoff-pack/review body: an optional review note (3-2000 characters, the shared free-text rules). */
export const meetingCutoffPackReview = z.strictObject({
  note: freeText(3, 2000).optional(),
});
export type MeetingCutoffPackReview = z.infer<typeof meetingCutoffPackReview>;
