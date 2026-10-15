// Meeting cut-off draft agenda and pack (OpenAPI tag "meetings"; ADR-0044 §6, §9, §10; REQ-S12-015, M0235 "Meeting
// cut-off reached | Generate a draft agenda and pack from current data with a review step before publication";
// p5-work-split §E.4, T-DG5-BE-L2). Fills BE-A's stub:
//   GET  /transformations/{id}/meetings/{meetingId}/cutoff-pack          the pack (transformation.read; AUD reads)
//   POST /transformations/{id}/meetings/{meetingId}/cutoff-pack/review   mark it reviewed (the meeting's chair with
//                                                                        meeting.chair or its secretary with
//                                                                        meeting.prepare; If-Match; AUD 403)
// plus `assertCutoffPackReviewed`, the check the DG4 per-item publish calls (governance/agenda.ts, one named line):
// an agenda item generated into a draft pack is refused 422 agenda_item.pack_not_reviewed before any write (the
// database refuses it too: trigger agenda_item_cutoff_review, MP04). Items outside packs (every DG4 item) are
// unaffected.
//
// `generateCutoffPackInTx` is the generation service, the twin of the worker's `governance.meeting_cutoff_scan`
// (apps/worker handlers/meetings.ts; the worker imports no API code, ADR-0002 rule 5; parity test in
// apps/api/test/integration/governance/cutoff-pack.test.ts). The open asks are the DG4 agenda's linkable asks (the
// predicate of agenda.ts `checkLinkable`, which is not exported: an executive decision of the transformation with an
// ask origin, status open or deferred) minus those already on this meeting's agenda.
//
// Reviewing a pack is a human action recorded with who, when and an optional note; no job reviews or publishes, and
// a pack review is not a G1-G6 business approval. Nothing here touches the engineering gates DG0-DG7.
import type { AuditActor, DbOrTx, MeetingCutoffPackRow, MeetingRow, Tx } from "@mth/db";
import { insertAuditEvent, sql } from "@mth/db";
import {
  meetingCutoffPackReview,
  truncateText,
  uuid,
  type MeetingCutoffOpenAsk,
  type MeetingCutoffPack,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireTransformationRead,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  iso,
  isoOrNull,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";

const JSON_BODY = ["application/json"] as const;
const params = z.strictObject({ transformationId: uuid, meetingId: uuid });

export const MEETING_PACK_REVIEW_KIND = "meeting_pack_review";
export const MEETING_PACK_REVIEW_MESSAGE = "governance.task.meeting_pack_review";
export const CUTOFF_PACK_MAX_ASKS = 200;
const AGENDA_MAX_ORDINAL = 999;

// ------------------------------------------------------------------------------------------------ refusals (ADR-0044 §10)

export const cutoffRefusals = {
  alreadyReviewed: () =>
    problems.businessRule("meeting_cutoff_pack.already_reviewed", "This pack is already reviewed."),
  notReviewer: () =>
    new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "meeting_cutoff_pack.not_reviewer",
      title: "Forbidden",
      detail: "Only the meeting's chair or secretary can review its pack.",
    }),
  packNotReviewed: () =>
    problems.businessRule(
      "agenda_item.pack_not_reviewed",
      "Review the meeting's cut-off pack before publishing its items.",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ mapping

const dateText = (d: unknown): string => String(d).slice(0, 10);

export function toMeetingCutoffPack(
  r: MeetingCutoffPackRow,
  m: Pick<MeetingRow, "chair_user_id" | "secretary_user_id">,
) {
  const body: MeetingCutoffPack = {
    id: r.id,
    meetingId: r.meeting_id,
    cutoffDate: dateText(r.cutoff_date),
    asOf: iso(r.as_of),
    openAsks: (typeof r.open_asks === "string" ? JSON.parse(r.open_asks) : r.open_asks) as MeetingCutoffOpenAsk[],
    agendaItemIds: r.agenda_item_ids,
    status: r.status as MeetingCutoffPack["status"],
    reviewedBy: r.reviewed_by,
    reviewedAt: isoOrNull(r.reviewed_at),
    reviewNote: r.review_note,
    reviewerAssigned: m.chair_user_id !== null || m.secretary_user_id !== null,
    version: r.version,
    updatedAt: iso(r.updated_at),
  };
  return body;
}

// ------------------------------------------------------------------------------------------------ the publish check

/**
 * 422 agenda_item.pack_not_reviewed when `agendaItemId` was generated into a cut-off pack of the meeting that is still
 * a draft (ADR-0044 §6 "Review before publication"). Called by the DG4 publish before its write.
 */
export async function assertCutoffPackReviewed(tx: DbOrTx, meetingId: string, agendaItemId: string): Promise<void> {
  const draft = await tx
    .selectFrom("meeting_cutoff_pack")
    .select("id")
    .where("meeting_id", "=", meetingId)
    .where("status", "=", "draft")
    .where(sql<boolean>`${agendaItemId}::uuid = ANY (agenda_item_ids)`)
    .executeTakeFirst();
  if (draft) throw cutoffRefusals.packNotReviewed();
}

// ------------------------------------------------------------------------------------------------ the generation service

/** Thrown inside the generating transaction when the meeting is not (or no longer) due; the caller rolls back. */
export class CutoffNotDue extends Error {}

/**
 * Generates one meeting's draft agenda and pack inside `tx` (ADR-0044 §6 steps 1-3). The twin of the worker's
 * `generateCutoffPackInTx`: same reads, same rows, same audit events; `actor` is the audit actor of the pack and the
 * work item, and the agenda items are audited on behalf of the meeting's owner of record (agenda_item.created_by is
 * NOT NULL, 0044). Throws CutoffNotDue when the meeting is not scheduled, its cut-off is Unknown or in the future, its
 * date has passed, or it already has a pack.
 */
export async function generateCutoffPackInTx(
  tx: Tx,
  actor: AuditActor,
  meetingId: string,
): Promise<{ packId: string; agendaItemIds: string[] }> {
  const m = await tx.selectFrom("meeting").selectAll().where("id", "=", meetingId).forUpdate().executeTakeFirst();
  if (!m) throw new CutoffNotDue();
  const today = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${m.timezone})::text AS d`.execute(tx))
    .rows[0]!.d;
  const cutoff = m.cutoff_date === null ? null : dateText(m.cutoff_date);
  const scheduled = dateText(m.scheduled_date);
  const existing = await tx
    .selectFrom("meeting_cutoff_pack")
    .select("id")
    .where("meeting_id", "=", m.id)
    .executeTakeFirst();
  if (m.status !== "scheduled" || cutoff === null || cutoff > today || scheduled < today || existing)
    throw new CutoffNotDue();
  const forum = await tx
    .selectFrom("forum")
    .select(["name_en", "name_ar", "agenda_max_items"])
    .where("id", "=", m.forum_id)
    .executeTakeFirstOrThrow();
  const series =
    m.series_id === null
      ? null
      : await tx.selectFrom("meeting_series").select("created_by").where("id", "=", m.series_id).executeTakeFirst();
  const owner = m.created_by ?? series?.created_by ?? null;
  if (owner === null) throw new Error(`generateCutoffPackInTx: meeting ${m.id} has no owner of record`);
  const asks = await tx
    .selectFrom("decision as d")
    .select([
      "d.id",
      "d.code",
      "d.title",
      "d.status",
      "d.owner_user_id",
      sql<string | null>`d.due_date::text`.as("due"),
    ])
    .where("d.transformation_id", "=", m.transformation_id)
    .where("d.kind", "=", "executive")
    .where("d.ask_origin", "is not", null)
    .where("d.status", "in", ["open", "deferred"])
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("agenda_item as a")
            .select("a.id")
            .whereRef("a.decision_id", "=", "d.id")
            .where("a.meeting_id", "=", m.id)
            .where("a.status", "<>", "withdrawn"),
        ),
      ),
    )
    .orderBy(sql`d.due_date NULLS LAST`)
    .orderBy("d.code")
    .orderBy("d.id")
    .limit(CUTOFF_PACK_MAX_ASKS)
    .execute();
  const counts = await tx
    .selectFrom("agenda_item")
    .select([
      sql<number>`count(*) FILTER (WHERE status <> 'withdrawn')::integer`.as("n"),
      sql<number>`coalesce(max(ordinal), 0)::integer`.as("maxOrdinal"),
    ])
    .where("meeting_id", "=", m.id)
    .executeTakeFirstOrThrow();
  const room = Math.max(
    0,
    Math.min(
      forum.agenda_max_items === null ? CUTOFF_PACK_MAX_ASKS : forum.agenda_max_items - counts.n,
      AGENDA_MAX_ORDINAL - counts.maxOrdinal,
    ),
  );
  const ownerActor: AuditActor = { ...actor, onBehalfOfUserId: owner };
  const late = today > cutoff;
  const scope = { organizationId: m.organization_id, transformationId: m.transformation_id };
  const snapshot: MeetingCutoffOpenAsk[] = [];
  const itemIds: string[] = [];
  for (const a of asks) {
    let itemId: string | null = null;
    if (itemIds.length < room) {
      itemId = uuidv7();
      const ordinal = counts.maxOrdinal + itemIds.length + 1;
      const title = truncateText(a.title, 500);
      await tx
        .insertInto("agenda_item")
        .values({
          id: itemId,
          organization_id: m.organization_id,
          transformation_id: m.transformation_id,
          meeting_id: m.id,
          ordinal,
          item_kind: "executive_ask",
          title,
          decision_id: a.id,
          late,
          created_by: owner,
          updated_by: owner,
        })
        .execute();
      await insertAuditEvent(tx, ownerActor, {
        action: "agenda_item.create",
        recordType: "agenda_item",
        recordId: itemId,
        ...scope,
        newVersion: 1,
        changes: {
          meeting_id: { from: null, to: m.id },
          ordinal: { from: null, to: ordinal },
          item_kind: { from: null, to: "executive_ask" },
          title: { from: null, to: title },
          decision_id: { from: null, to: a.id },
          late: { from: null, to: late },
          status: { from: null, to: "draft" },
        },
      });
      itemIds.push(itemId);
    }
    snapshot.push({
      decisionId: a.id,
      code: a.code,
      title: a.title,
      status: a.status as MeetingCutoffOpenAsk["status"],
      ownerUserId: a.owner_user_id,
      dueDate: a.due,
      agendaItemId: itemId,
    });
  }
  const packId = uuidv7();
  await tx
    .insertInto("meeting_cutoff_pack")
    .values({
      id: packId,
      organization_id: m.organization_id,
      transformation_id: m.transformation_id,
      meeting_id: m.id,
      cutoff_date: cutoff,
      as_of: sql<Date>`now()`,
      open_asks: JSON.stringify(snapshot),
      agenda_item_ids: itemIds,
      created_by: null,
      updated_by: null,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "meeting_cutoff_pack.create",
    recordType: "meeting_cutoff_pack",
    recordId: packId,
    ...scope,
    newVersion: 1,
    changes: {
      meeting_id: { from: null, to: m.id },
      cutoff_date: { from: null, to: cutoff },
      open_asks: { from: null, to: snapshot.map((a) => a.decisionId) },
      agenda_item_ids: { from: null, to: itemIds },
      status: { from: null, to: "draft" },
    },
  });
  const reviewer = m.chair_user_id ?? m.secretary_user_id;
  if (reviewer !== null)
    await createWorkItemOnce(tx, actor, {
      organizationId: m.organization_id,
      transformationId: m.transformation_id,
      kind: MEETING_PACK_REVIEW_KIND,
      assigneeUserId: reviewer,
      subjectType: "meeting_cutoff_pack",
      subjectId: packId,
      linkPath: `/transformations/${m.transformation_id}/meetings/${m.id}`,
      messageKey: MEETING_PACK_REVIEW_MESSAGE,
      messageParams: {
        forum: forum.name_en,
        forumAr: forum.name_ar,
        meetingDate: scheduled,
        askCount: snapshot.length,
      },
      dueDate: scheduled,
      dedupeKey: `meeting_cutoff_pack:${packId}:${reviewer}`,
    });
  return { packId, agendaItemIds: itemIds };
}

// ------------------------------------------------------------------------------------------------ routes

async function packOf(db: DbOrTx, meetingId: string, forUpdate: boolean): Promise<MeetingCutoffPackRow> {
  let q = db.selectFrom("meeting_cutoff_pack").selectAll().where("meeting_id", "=", meetingId);
  if (forUpdate) q = q.forUpdate();
  const p = await q.executeTakeFirst();
  if (!p) throw problems.notFound();
  return p;
}

async function meetingOf(db: DbOrTx, transformationId: string, meetingId: string, forUpdate: boolean) {
  let q = db
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  const m = await q.executeTakeFirst();
  if (!m) throw problems.notFound();
  return m;
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerCutOffRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const PACK = "/api/v1/transformations/:transformationId/meetings/:meetingId/cutoff-pack";
  const REVIEW = `${PACK}/review`;

  app.get(PACK, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(params, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const m = await meetingOf(db, transformationId, meetingId, false);
    const p = await packOf(db, meetingId, false);
    return sendVersioned(reply, 200, toMeetingCutoffPack(p, m));
  });

  // The route declares meeting.prepare; the handler decides the record-level rule (chair with meeting.chair, or
  // secretary with meeting.prepare) on grants reloaded inside the transaction (commit-time re-check).
  app.post(
    REVIEW,
    { config: { access: { permission: "meeting.prepare" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, meetingId } = parse(params, request.params, "params");
      const body = parseBody(meetingCutoffPackReview, request.body);
      const result = await db.transaction().execute(async (tx) => {
        const target = await requireTransformationRead(tx, principalOf(request), transformationId);
        const fresh = await refreshPrincipal(tx, request);
        try {
          await requireTransformationRead(tx, fresh, transformationId);
        } catch (err) {
          throw commitTimeDenial(err);
        }
        const userId = fresh.userId!;
        const m = await meetingOf(tx, transformationId, meetingId, true);
        const current = await packOf(tx, meetingId, true);
        const expected = requireIfMatch(request);
        const asChair =
          m.chair_user_id === userId && (await authorize(tx, fresh, "meeting.chair", target)).allowed === true;
        const asSecretary =
          m.secretary_user_id === userId && (await authorize(tx, fresh, "meeting.prepare", target)).allowed === true;
        if (!asChair && !asSecretary) throw cutoffRefusals.notReviewer();
        if (current.version !== expected) throw problems.versionConflict(current.version);
        if (current.status !== "draft") throw cutoffRefusals.alreadyReviewed();
        const note = body.note ?? null;
        const updated = await tx
          .updateTable("meeting_cutoff_pack")
          .set({
            status: "reviewed",
            reviewed_by: userId,
            reviewed_at: sql<Date>`now()`,
            review_note: note,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: userId,
          })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirst();
        if (!updated) throw problems.versionConflict(current.version + 1);
        const audit = auditContextOf(request);
        await record(tx, audit, {
          action: "meeting_cutoff_pack.review",
          recordType: "meeting_cutoff_pack",
          recordId: current.id,
          organizationId: current.organization_id,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: {
            status: { from: current.status, to: "reviewed" },
            reviewed_by: { from: null, to: userId },
            review_note: { from: null, to: note },
            reviewed_as: { from: null, to: asChair ? "chair" : "secretary" },
          },
        });
        await closeWorkItemsOfSubject(
          tx,
          { actorType: "user", actorUserId: userId, requestId: audit.requestId, source: "api" },
          {
            organizationId: current.organization_id,
            subjectType: "meeting_cutoff_pack",
            subjectId: current.id,
            kinds: [MEETING_PACK_REVIEW_KIND],
          },
          "done",
        );
        return { row: updated, meeting: m };
      });
      return sendVersioned(reply, 200, toMeetingCutoffPack(result.row, result.meeting));
    },
  );

  return [`GET ${PACK}`, `POST ${REVIEW}`];
}
