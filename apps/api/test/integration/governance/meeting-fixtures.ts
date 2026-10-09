// Fixtures for the slice D forum, meeting-series and meeting tests and contract exercises (backend-workflow-engineer,
// T-DG4-BE-F; ADR-0032 §1-§3.1). All data is SYNTHETIC. A meeting world is BE-B's approval world (TL lead and WL
// contributor at the transformation, org-level TO office and AUD auditor, SP sponsor, two BOs and FIN, the organization's
// default business calendar, SP and BO mapped to named people) on a transformation created through POST
// /transformations, so p4_instantiate_transformation has already copied the five B0093 forums. TL and WL are mapped too,
// so the Transformation Review and Workstream Review chairs resolve to people. A second, calendar-less organization
// gives the Unknown cases. Nothing here grants a real business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import {
  call,
  createBu,
  createOrg,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { mapParty, setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";

export type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res>;

export type ForumKey =
  | "executive_steerco"
  | "transformation_review"
  | "workstream_review"
  | "rapid_response"
  | "value_review";

export interface MeetingWorld extends ApprovalWorld {
  readonly admin: Session;
  /** Forum ids by template key. */
  readonly forums: Readonly<Record<ForumKey, string>>;
}

export async function setupMeetingWorld(api: TestApi, w: World, sender?: Caller): Promise<MeetingWorld> {
  const send: Caller = sender ?? ((m, u, o) => call(api.app, m, u, o));
  const p = await setupApprovalWorld(api, w, send);
  await mapParty(send, p, "TL", p.lead.id);
  await mapParty(send, p, "WL", p.contributor.id);
  const rows = await api.db
    .selectFrom("forum")
    .select(["id", "template_key"])
    .where("transformation_id", "=", p.transformationId)
    .execute();
  const forums = Object.fromEntries(rows.filter((r) => r.template_key !== null).map((r) => [r.template_key!, r.id]));
  expect(Object.keys(forums).sort()).toEqual([
    "executive_steerco",
    "rapid_response",
    "transformation_review",
    "value_review",
    "workstream_review",
  ]);
  return { ...p, admin: await signIn(api.app, w.admin.subject), forums: forums as Record<ForumKey, string> };
}

/** A transformation in a NEW organization without a business calendar, with a TO at it (the Unknown cases). */
export async function calendarlessWorld(api: TestApi): Promise<{
  transformationId: string;
  organizationId: string;
  to: { id: string; session: Session };
  forums: Record<ForumKey, string>;
}> {
  const org = await createOrg(api.db);
  const bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const to = await createUser(api.db, org.id);
  const transformationId = await createTransformationRow(api.db, org.id, bu, to.id);
  await sql`SELECT p4_instantiate_transformation(${transformationId}::uuid, ${to.id}::uuid, 'test:calendarless', 'api')`.execute(
    api.db,
  );
  await grant(api.db, grantor.id, to.id, "TO", { type: "transformation", id: transformationId }, org.id);
  const rows = await api.db
    .selectFrom("forum")
    .select(["id", "template_key"])
    .where("transformation_id", "=", transformationId)
    .execute();
  return {
    transformationId,
    organizationId: org.id,
    to: { id: to.id, session: await signIn(api.app, to.subject) },
    forums: Object.fromEntries(rows.map((r) => [r.template_key!, r.id])) as Record<ForumKey, string>,
  };
}

/** Today's business date in a timezone, from the database clock (the guards' p4_business_date). */
export async function businessToday(api: TestApi, tz = "Asia/Riyadh"): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), ${tz})::text AS d`.execute(api.db);
  return r.rows[0]!.d;
}

/** `date` plus `days` calendar days. */
export function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a business date. */
export function isoWeekday(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The meeting's organization and transformation. */
async function scopeOf(tx: Tx, meetingId: string) {
  return tx
    .selectFrom("meeting")
    .select(["organization_id", "transformation_id"])
    .where("id", "=", meetingId)
    .executeTakeFirstOrThrow();
}

const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: "test:meeting-fixture", source: "api" }) as const;

/**
 * Adds a test-only attendance row to a meeting with its audit event (meeting content, so a regeneration keeps the
 * meeting; synthetic). BE-F2 owns the attendance API; this fixture writes the row the way that API will.
 */
export async function addAttendance(api: TestApi, meetingId: string, userId: string): Promise<void> {
  await api.db.transaction().execute(async (tx) => {
    const m = await scopeOf(tx, meetingId);
    const id = uuidv7();
    await tx
      .insertInto("meeting_attendance")
      .values({
        id,
        organization_id: m.organization_id,
        transformation_id: m.transformation_id,
        meeting_id: meetingId,
        user_id: userId,
        attendance: "present",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await insertAuditEvent(tx, actor(userId), {
      action: "meeting_attendance.create",
      recordType: "meeting_attendance",
      recordId: id,
      organizationId: m.organization_id,
      transformationId: m.transformation_id,
      newVersion: 1,
    });
  });
}

/**
 * Adds a test-only `discussion` agenda item (draft, or published with its stamps), each version with its audit event
 * (synthetic). BE-F2 owns the agenda API; this fixture lets publishMeetingAgenda be tested before it lands.
 */
export async function addAgendaItem(
  api: TestApi,
  meetingId: string,
  userId: string,
  status: "draft" | "published",
  ordinal = 1,
): Promise<string> {
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    const m = await scopeOf(tx, meetingId);
    await tx
      .insertInto("agenda_item")
      .values({
        id,
        organization_id: m.organization_id,
        transformation_id: m.transformation_id,
        meeting_id: meetingId,
        ordinal,
        item_kind: "discussion",
        title: "Synthetic agenda item",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    const scope = { organizationId: m.organization_id, transformationId: m.transformation_id };
    await insertAuditEvent(tx, actor(userId), {
      action: "agenda_item.create",
      recordType: "agenda_item",
      recordId: id,
      ...scope,
      newVersion: 1,
    });
    if (status === "published") {
      await tx
        .updateTable("agenda_item")
        .set({ status: "published", published_at: new Date(), published_by: userId, version: 2 })
        .where("id", "=", id)
        .execute();
      await insertAuditEvent(tx, actor(userId), {
        action: "agenda_item.publish",
        recordType: "agenda_item",
        recordId: id,
        ...scope,
        priorVersion: 1,
        newVersion: 2,
      });
    }
  });
  return id;
}
