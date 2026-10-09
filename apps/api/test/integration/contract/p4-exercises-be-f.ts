// P4 contract exercises of BE-F (T-DG4-BE-F; p4-work-split §D.1, §1 S-10): the 20 slice D operations of forums and
// participants, meeting series and meetings. Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_BE_F. BE-F2 appends its agenda,
// attendance, minutes, output and action exercises to this file after BE-F (no new seam file). All data is synthetic; a
// meeting approves nothing and nothing here touches the engineering gates DG0-DG7.
import {
  forum,
  forumPage,
  forumParticipant,
  forumParticipantPage,
  meeting,
  meetingPage,
  meetingSeries,
  meetingSeriesPage,
  meetingSeriesResult,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  addAgendaItem,
  businessToday,
  isoWeekday,
  plusDays,
  setupMeetingWorld,
} from "../governance/meeting-fixtures.ts";

export const P4_MIRRORS_BE_F: Readonly<Record<string, z.ZodType>> = {
  listForums: forumPage,
  createForum: forum,
  getForum: forum,
  updateForum: forum,
  listForumParticipants: forumParticipantPage,
  addForumParticipant: forumParticipant,
  removeForumParticipant: forumParticipant,
  listMeetingSeries: meetingSeriesPage,
  createMeetingSeries: meetingSeriesResult,
  getMeetingSeries: meetingSeries,
  updateMeetingSeries: meetingSeriesResult,
  endMeetingSeries: meetingSeriesResult,
  listMeetings: meetingPage,
  createMeeting: meeting,
  getMeeting: meeting,
  updateMeeting: meeting,
  publishMeetingAgenda: meeting,
  startMeeting: meeting,
  closeMeeting: meeting,
  cancelMeeting: meeting,
};

export async function exerciseP4BeFOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const x = await setupMeetingWorld(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${x.transformationId}`;
  const office = x.office.session;

  // ------------------------------------------------------------------ forums (ADR-0032 §1)
  const forums = await m("GET", `${T}/forums`, { session: x.auditor.session });
  expect([forums.status, forums.body.items.length]).toEqual([200, 5]);
  expect(forums.body.items[0].source.cadenceEn).toBe("Monthly");
  expect((await m("GET", `${T}/forums`, { session: x.admin })).status).toBe(404);
  const body = {
    nameEn: "Synthetic data council",
    nameAr: "مجلس بيانات اصطناعي",
    cadenceLabel: "Monthly",
    purpose: "Synthetic purpose",
    participantsLabel: "Data owners",
    outputsLabel: "Decisions",
    outputKinds: ["decision"],
  };
  expect((await m("POST", `${T}/forums`, { session: x.auditor.session, body })).status).toBe(403);
  expect((await m("POST", `${T}/forums`, { session: x.admin, body })).status).toBe(404);
  const party = await m("POST", `${T}/forums`, { session: office, body: { ...body, chairPartyCode: "NOPE" } });
  expect([party.status, party.body.code]).toEqual([422, "forum.party_unknown"]);
  const notListed = await m("POST", `${T}/forums`, {
    session: office,
    body: { ...body, publishRequiresAnyOutput: ["forecast"] },
  });
  expect([notListed.status, notListed.body.code]).toEqual([422, "forum.publish_output_not_listed"]);
  const created = await m("POST", `${T}/forums`, { session: office, body });
  expect([created.status, created.headers.etag, created.body.templateKey, created.body.source]).toEqual([
    201,
    '"1"',
    null,
    null,
  ]);
  const F = `${T}/forums/${created.body.id}`;
  expect((await m("GET", F, { session: x.auditor.session })).status).toBe(200);
  expect((await m("PATCH", F, { session: office, body: { quorumMin: 2 } })).status).toBe(428);
  expect((await m("PATCH", F, { session: office, headers: ifm(7), body: { quorumMin: 2 } })).status).toBe(409);
  const configured = await m("PATCH", F, { session: office, headers: ifm(1), body: { quorumMin: 2 } });
  expect([configured.status, configured.body.quorumMin, configured.body.version]).toEqual([200, 2, 2]);

  // ------------------------------------------------------------------ participants
  const P = `${F}/participants`;
  const added = await m("POST", P, { session: office, body: { userId: x.bo.id } });
  expect([added.status, added.body.countsForQuorum]).toEqual([201, true]);
  const dup = await m("POST", P, { session: office, body: { userId: x.bo.id } });
  expect([dup.status, dup.body.code]).toEqual([409, "forum_participant.exists"]);
  const list = await m("GET", P, { session: x.auditor.session });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
  const R = `${P}/${added.body.id}/remove`;
  const removed = await m("POST", R, { session: office, headers: ifm(1) });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
  const again = await m("POST", R, { session: office, headers: ifm(2) });
  expect([again.status, again.body.code]).toEqual([422, "forum_participant.removed"]);

  // ------------------------------------------------------------------ meeting series (ADR-0032 §2)
  const today = await businessToday(ctx.api);
  // A weekday that is a working day (Sunday-Thursday) and lies after today, so the first week has a meeting.
  let first = plusDays(today, 1);
  while ([5, 6].includes(isoWeekday(first))) first = plusDays(first, 1);
  const S = `${T}/meeting-series`;
  const seriesBody = {
    forumId: x.forums.workstream_review,
    frequency: "weekly",
    intervalCount: 1,
    weekdays: [isoWeekday(first)],
    startDate: today,
    startTime: "10:00",
    durationMinutes: 60,
    horizonDays: 28,
  };
  const bad = await m("POST", S, { session: office, body: { ...seriesBody, weekdays: null } });
  expect([bad.status, bad.body.code]).toEqual([400, "meeting_series.rule_invalid"]);
  expect((await m("POST", S, { session: x.auditor.session, body: seriesBody })).status).toBe(403);
  const series = await m("POST", S, { session: office, body: seriesBody });
  expect([series.status, series.headers.etag, series.body.series.ruleVersion]).toEqual([201, '"1"', 1]);
  expect(series.body.createdMeetingIds.length).toBeGreaterThanOrEqual(4);
  const exists = await m("POST", S, { session: office, body: seriesBody });
  expect([exists.status, exists.body.code]).toEqual([409, "meeting_series.exists"]);
  expect((await m("GET", S, { session: x.auditor.session })).status).toBe(200);
  const SI = `${S}/${series.body.series.id}`;
  expect((await m("GET", SI, { session: x.auditor.session })).status).toBe(200);
  const fortnightly = await m("PATCH", SI, { session: office, headers: ifm(1), body: { intervalCount: 2 } });
  expect([fortnightly.status, fortnightly.body.series.ruleVersion]).toEqual([200, 2]);
  expect(fortnightly.body.cancelledMeetingIds.length).toBeGreaterThan(0);

  // ------------------------------------------------------------------ meetings (ADR-0032 §3.1)
  const M = `${T}/meetings`;
  const meetings = await m("GET", `${M}?forumId=${x.forums.workstream_review}`, { session: x.auditor.session });
  expect(meetings.status).toBe(200);
  const adhoc = await m("POST", M, {
    session: x.lead.session,
    body: {
      forumId: x.forums.transformation_review,
      scheduledDate: plusDays(today, 3),
      startTime: "09:30",
      durationMinutes: 45,
    },
  });
  expect([adhoc.status, adhoc.body.chairUserId, adhoc.body.createdSource]).toEqual([201, x.lead.id, "api"]);
  const MI = `${M}/${adhoc.body.id}`;
  expect((await m("GET", MI, { session: x.auditor.session })).body.quorumState).toBe("not_configured");
  const moved = await m("PATCH", MI, {
    session: x.lead.session,
    headers: ifm(1),
    body: { location: "Synthetic room" },
  });
  expect([moved.status, moved.body.location]).toEqual([200, "Synthetic room"]);
  const empty = await m("POST", `${MI}/publish-agenda`, { session: x.lead.session, headers: ifm(2) });
  expect([empty.status, empty.body.code]).toEqual([422, "meeting.agenda_empty"]);
  await addAgendaItem(ctx.api, adhoc.body.id, x.lead.id, "published");
  const notChair = await m("POST", `${MI}/publish-agenda`, { session: office, headers: ifm(2) });
  expect([notChair.status, notChair.body.code]).toEqual([403, "meeting.not_chair"]);
  const published = await m("POST", `${MI}/publish-agenda`, { session: x.lead.session, headers: ifm(2) });
  expect([published.status, published.body.status]).toEqual([200, "agenda_published"]);
  const started = await m("POST", `${MI}/start`, { session: office, headers: ifm(3) });
  expect([started.status, started.body.status]).toEqual([200, "in_session"]);
  const held = await m("POST", `${MI}/close`, { session: office, headers: ifm(4) });
  expect([held.status, held.body.status]).toEqual([200, "held"]);
  const tooLate = await m("POST", `${MI}/cancel`, { session: office, headers: ifm(5), body: { reason: "Synthetic" } });
  expect([tooLate.status, tooLate.body.code]).toEqual([422, "meeting.status_transition"]);

  const other = await m("POST", M, {
    session: office,
    body: { forumId: created.body.id, scheduledDate: plusDays(today, 5), startTime: "11:00", durationMinutes: 30 },
  });
  expect(other.status).toBe(201);
  const cancelled = await m("POST", `${M}/${other.body.id}/cancel`, {
    session: office,
    headers: ifm(1),
    body: { reason: "Synthetic: not needed" },
  });
  expect([cancelled.status, cancelled.body.status, cancelled.body.cancelReason]).toEqual([200, "cancelled", "manual"]);
  const final = await m("PATCH", `${M}/${other.body.id}`, {
    session: office,
    headers: ifm(2),
    body: { location: "X room" },
  });
  expect([final.status, final.body.code]).toEqual([422, "meeting.final"]);

  // ------------------------------------------------------------------ end the series
  const ended = await m("POST", `${SI}/end`, { session: office, headers: ifm(2) });
  expect([ended.status, ended.body.series.status]).toEqual([200, "ended"]);
  const endedAgain = await m("POST", `${SI}/end`, { session: office, headers: ifm(3) });
  expect([endedAgain.status, endedAgain.body.code]).toEqual([422, "meeting_series.ended"]);
}
