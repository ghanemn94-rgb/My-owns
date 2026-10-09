// Governance forums and their participants (OpenAPI tag "forums"; ADR-0032 §1, §9, §11; REQ-PB-060, REQ-S10-005,
// REQ-S16-019 "Forum"; T-DG4-BE-F):
//   GET   /transformations/{id}/forums                                    the transformation's forums (transformation.read)
//   POST  /transformations/{id}/forums                                    add a forum (forum.configure; TO)
//   GET   /transformations/{id}/forums/{forumId}                          one forum, with its B0093 source texts
//   PATCH /transformations/{id}/forums/{forumId}                          configure or archive it (If-Match)
//   GET   /transformations/{id}/forums/{forumId}/participants             named participants
//   POST  /transformations/{id}/forums/{forumId}/participants             add a person or a group
//   POST  /transformations/{id}/forums/{forumId}/participants/{pid}/remove   remove one (If-Match; final)
//
// The five operating-system layers of B0093 are copied into every transformation by p4_instantiate_forums (0044,
// called by p4_instantiate_transformation, BE-C's switch); this file never seeds them again. The template's verbatim
// texts are served in `source` and never change; a forum edit changes only the transformation's copy. A participant
// row names who is invited; it grants no permission (ADR-0026 §1). Nothing here approves anything or touches DG0-DG7.
import type { DbOrTx, ForumParticipantRow, ForumRow, ForumTemplateRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  forumCreate,
  forumListQuery,
  forumParticipantCreate,
  forumUpdate,
  uuid,
  type Forum,
  type ForumParticipant,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  type ResolvedTarget,
} from "../access/index.ts";
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

const JSON_BODY = ["application/json"] as const;
const CONFIGURE = "forum.configure" as const;
/** The slice D write permissions (ADR-0032 §9). */
export type GovernanceMeetingPermission = "forum.configure" | "meeting.prepare" | "meeting.chair";

const transformationParams = z.strictObject({ transformationId: uuid });
const forumParams = z.strictObject({ transformationId: uuid, forumId: uuid });
const participantParams = z.strictObject({ transformationId: uuid, forumId: uuid, forumParticipantId: uuid });
const pageQuery = { cursor: cursorSchema, limit: limitSchema };

// ------------------------------------------------------------------------------------------------ refusals (S-11)

const at = (status: 422, code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** ADR-0032 §11, forum and participant lines: exact codes and English texts. */
export const forumRefusals = {
  partyUnknown: (party: string, pointer: string) =>
    at(422, "forum.party_unknown", `${party} is not a known governance role.`, pointer),
  outputKindInvalid: () =>
    at(
      422,
      "forum.output_kind_invalid",
      "Outputs are chosen from: decisions, unblockers, benefit view, integrated status, decision log, milestones, actions, RAID, test, evidence, recommendation, benefit evidence, forecast, corrective action.",
      "/outputKinds",
    ),
  publishOutputNotListed: () =>
    at(
      422,
      "forum.publish_output_not_listed",
      "A required publication output must be one of this forum's outputs.",
      "/publishRequiresAnyOutput",
    ),
  archived: () => problems.businessRule("forum.archived", "This forum is archived and can no longer be changed."),
  participantExists: () =>
    problems.duplicate("forum_participant.exists", "This person or group is already a participant of the forum."),
  participantRemoved: () =>
    problems.businessRule("forum_participant.removed", "This participant was removed and can no longer be changed."),
} as const;

/** A referenced person or group that is not an active member of the transformation's organization (400). */
export const unknownTarget = (pointer: string, what: "user" | "group") =>
  problems.validation(
    [
      {
        pointer,
        code: `validation.${what}_unknown`,
        message:
          what === "user"
            ? "Choose an active user of this transformation's organization."
            : "Choose an active group of this transformation's organization.",
      },
    ],
    "The request is not valid.",
  );

// ------------------------------------------------------------------------------------------------ authorization

/**
 * Read gate first (404 outside scope, ADR-0006), then `permission` decided on grants reloaded inside `tx` (the
 * commit-time re-check of S-4; a denial is 403 and audited). Returns the acting user and the resolved target.
 */
export async function requireGovernanceAction(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: GovernanceMeetingPermission,
): Promise<{ userId: string; target: ResolvedTarget & { transformationId: string } }> {
  const target = await requireTransformationRead(tx, principalOf(request), transformationId);
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireTransformationRead(tx, fresh, transformationId);
    await requireAction(tx, fresh, permission, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return { userId: fresh.userId!, target: { ...target, transformationId } };
}

/** True when `userId` is an active user of the organization. */
export async function isActiveUserOf(db: DbOrTx, organizationId: string, userId: string): Promise<boolean> {
  const u = await db
    .selectFrom("app_user")
    .select("id")
    .where("id", "=", userId)
    .where("organization_id", "=", organizationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return u !== undefined;
}

// ------------------------------------------------------------------------------------------------ mapping

export const toForumSource = (t: ForumTemplateRow): NonNullable<Forum["source"]> => ({
  layerEn: t.source_layer_en,
  cadenceEn: t.source_cadence_en,
  purposeEn: t.source_purpose_en,
  participantsEn: t.source_participants_en,
  outputsEn: t.source_outputs_en,
  layerAr: t.layer_ar,
  cadenceAr: t.cadence_ar,
  purposeAr: t.purpose_ar,
  participantsAr: t.participants_ar,
  outputsAr: t.outputs_ar,
  arProvisional: t.ar_provisional,
  sourceRef: t.source_ref,
});

export const toForum = (r: ForumRow, template: ForumTemplateRow | null, activeSeriesId: string | null): Forum => ({
  id: r.id,
  transformationId: r.transformation_id,
  templateKey: r.template_key as Forum["templateKey"],
  source: template === null ? null : toForumSource(template),
  ordinal: r.ordinal,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  cadenceLabel: r.cadence_label,
  purpose: r.purpose,
  participantsLabel: r.participants_label,
  outputsLabel: r.outputs_label,
  chairPartyCode: r.chair_party_code,
  secretaryUserId: r.secretary_user_id,
  participantParties: r.participant_parties,
  outputKinds: r.output_kinds as Forum["outputKinds"],
  publishRequiresAnyOutput: r.publish_requires_any_output as Forum["publishRequiresAnyOutput"],
  executiveAsksOnly: r.executive_asks_only,
  quorumMin: r.quorum_min,
  cutoffWorkingDays: r.cutoff_working_days,
  agendaMaxItems: r.agenda_max_items,
  lateItemsRule: r.late_items_rule as Forum["lateItemsRule"],
  status: r.status as Forum["status"],
  activeSeriesId,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export const toForumParticipant = (r: ForumParticipantRow): ForumParticipant => ({
  id: r.id,
  forumId: r.forum_id,
  userId: r.user_id,
  groupId: r.group_id,
  countsForQuorum: r.counts_for_quorum,
  status: r.status as ForumParticipant["status"],
  removedAt: isoOrNull(r.removed_at),
  removedBy: r.removed_by,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** Maps forum rows with their templates and active series (two queries, whatever the page size). */
async function toForums(db: DbOrTx, rows: readonly ForumRow[]): Promise<Forum[]> {
  if (rows.length === 0) return [];
  const templates = new Map(
    (await db.selectFrom("forum_template").selectAll().execute()).map((t) => [t.key, t] as const),
  );
  const series = new Map(
    (
      await db
        .selectFrom("meeting_series")
        .select(["id", "forum_id"])
        .where(
          "forum_id",
          "in",
          rows.map((r) => r.id),
        )
        .where("status", "=", "active")
        .execute()
    ).map((s) => [s.forum_id, s.id] as const),
  );
  return rows.map((r) =>
    toForum(r, r.template_key === null ? null : (templates.get(r.template_key) ?? null), series.get(r.id) ?? null),
  );
}

/** The forum of a transformation (404 when it is not there). */
export async function loadForum(db: DbOrTx, transformationId: string, forumId: string): Promise<ForumRow> {
  const row = await db
    .selectFrom("forum")
    .selectAll()
    .where("id", "=", forumId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ validation

interface ForumShape {
  chair_party_code: string | null;
  participant_parties: readonly string[];
  output_kinds: readonly string[];
  publish_requires_any_output: readonly string[];
  secretary_user_id: string | null;
}

/** Known governance parties, a non-empty output set, publication outputs among them, a secretary of the org. */
async function validateForum(db: DbOrTx, organizationId: string, f: ForumShape): Promise<void> {
  const lists: [string, readonly string[]][] = [
    ["/chairPartyCode", f.chair_party_code === null ? [] : [f.chair_party_code]],
    ["/participantParties", f.participant_parties],
  ];
  const all = [...new Set(lists.flatMap(([, codes]) => codes))];
  const known =
    all.length === 0
      ? new Set<string>()
      : new Set(
          (await db.selectFrom("governance_party").select("code").where("code", "in", all).execute()).map(
            (p) => p.code,
          ),
        );
  for (const [pointer, codes] of lists) {
    const bad = codes.find((c) => !known.has(c));
    if (bad !== undefined) throw forumRefusals.partyUnknown(bad, pointer);
  }
  if (f.output_kinds.length === 0) throw forumRefusals.outputKindInvalid();
  if (f.publish_requires_any_output.some((k) => !f.output_kinds.includes(k)))
    throw forumRefusals.publishOutputNotListed();
  if (f.secretary_user_id !== null && !(await isActiveUserOf(db, organizationId, f.secretary_user_id)))
    throw unknownTarget("/secretaryUserId", "user");
}

/** The audited fields of a forum (literal accesses only; F-DG1-124). */
const forumFields = (r: Partial<ForumRow>): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["template_key", r.template_key],
    ["ordinal", r.ordinal],
    ["name_en", r.name_en],
    ["name_ar", r.name_ar],
    ["cadence_label", r.cadence_label],
    ["purpose", r.purpose],
    ["participants_label", r.participants_label],
    ["outputs_label", r.outputs_label],
    ["chair_party_code", r.chair_party_code],
    ["secretary_user_id", r.secretary_user_id],
    ["participant_parties", r.participant_parties],
    ["output_kinds", r.output_kinds],
    ["publish_requires_any_output", r.publish_requires_any_output],
    ["executive_asks_only", r.executive_asks_only],
    ["quorum_min", r.quorum_min],
    ["cutoff_working_days", r.cutoff_working_days],
    ["agenda_max_items", r.agenda_max_items],
    ["late_items_rule", r.late_items_rule],
    ["status", r.status],
  ]);

/** The changed fields between two versions of a row, as `{ field: { from, to } }`. */
export function diffFields(
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: [string, { from: unknown; to: unknown }][] = [];
  for (const [field, value] of after) {
    const from = before.get(field) ?? null;
    const to = value ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push([field, { from, to }]);
  }
  return Object.fromEntries(changes);
}

// ------------------------------------------------------------------------------------------------ routes

export function registerForumRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const FORUMS = "/api/v1/transformations/:transformationId/forums";
  const ONE = `${FORUMS}/:forumId`;
  const PARTICIPANTS = `${ONE}/participants`;
  const REMOVE = `${PARTICIPANTS}/:forumParticipantId/remove`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(FORUMS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(forumListQuery.extend(pageQuery), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("forum").selectAll().where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("ordinal", ">", Number(after[0])),
          eb.and([eb("ordinal", "=", Number(after[0])), eb("id", ">", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("ordinal")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.ordinal, r.id], hash);
    return { items: await toForums(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(FORUMS, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(forumCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const shape: ForumShape = {
        chair_party_code: body.chairPartyCode ?? null,
        participant_parties: body.participantParties ?? [],
        output_kinds: body.outputKinds,
        publish_requires_any_output: body.publishRequiresAnyOutput ?? [],
        secretary_user_id: body.secretaryUserId ?? null,
      };
      await validateForum(tx, target.organizationId, shape);
      // Serialize ordinals per transformation on its row (the instantiation takes the same lock).
      await sql`SELECT 1 FROM transformation WHERE id = ${transformationId}::uuid FOR UPDATE`.execute(tx);
      const max = await tx
        .selectFrom("forum")
        .select(sql<number | null>`max(ordinal)`.as("m"))
        .where("transformation_id", "=", transformationId)
        .executeTakeFirst();
      const id = uuidv7();
      const created = await tx
        .insertInto("forum")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          template_key: null,
          ordinal: Math.min(999, (max?.m ?? 0) + 1),
          name_en: body.nameEn,
          name_ar: body.nameAr,
          cadence_label: body.cadenceLabel,
          purpose: body.purpose,
          participants_label: body.participantsLabel,
          outputs_label: body.outputsLabel,
          chair_party_code: shape.chair_party_code,
          secretary_user_id: shape.secretary_user_id,
          participant_parties: [...shape.participant_parties],
          output_kinds: [...shape.output_kinds],
          publish_requires_any_output: [...shape.publish_requires_any_output],
          executive_asks_only: body.executiveAsksOnly ?? false,
          quorum_min: body.quorumMin ?? null,
          cutoff_working_days: body.cutoffWorkingDays ?? 2,
          agenda_max_items: body.agendaMaxItems ?? null,
          late_items_rule: body.lateItemsRule ?? "flag",
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "forum.create",
        recordType: "forum",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        newVersion: 1,
        changes: diffFields(new Map(), forumFields(created)),
      });
      return created;
    });
    const [out] = await toForums(db, [row]);
    return sendVersioned(reply, 201, out!, `/api/v1/transformations/${transformationId}/forums/${row.id}`);
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, forumId } = parse(forumParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await loadForum(db, transformationId, forumId);
    const [out] = await toForums(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.patch(ONE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, forumId } = parse(forumParams, request.params, "params");
    const body = parseBody(forumUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      const current = await loadForum(tx, transformationId, forumId);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw forumRefusals.archived();
      const outputKinds = body.outputKinds ?? current.output_kinds;
      const shape: ForumShape = {
        chair_party_code: body.chairPartyCode !== undefined ? body.chairPartyCode : current.chair_party_code,
        participant_parties: body.participantParties ?? current.participant_parties,
        output_kinds: outputKinds,
        publish_requires_any_output: body.publishRequiresAnyOutput ?? current.publish_requires_any_output,
        secretary_user_id: body.secretaryUserId !== undefined ? body.secretaryUserId : current.secretary_user_id,
      };
      await validateForum(tx, current.organization_id, shape);
      const updated = await tx
        .updateTable("forum")
        .set({
          ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
          ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
          ...(body.cadenceLabel !== undefined ? { cadence_label: body.cadenceLabel } : {}),
          ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
          ...(body.participantsLabel !== undefined ? { participants_label: body.participantsLabel } : {}),
          ...(body.outputsLabel !== undefined ? { outputs_label: body.outputsLabel } : {}),
          ...(body.executiveAsksOnly !== undefined ? { executive_asks_only: body.executiveAsksOnly } : {}),
          ...(body.quorumMin !== undefined ? { quorum_min: body.quorumMin } : {}),
          ...(body.cutoffWorkingDays !== undefined ? { cutoff_working_days: body.cutoffWorkingDays } : {}),
          ...(body.agendaMaxItems !== undefined ? { agenda_max_items: body.agendaMaxItems } : {}),
          ...(body.lateItemsRule !== undefined ? { late_items_rule: body.lateItemsRule } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          chair_party_code: shape.chair_party_code,
          secretary_user_id: shape.secretary_user_id,
          participant_parties: [...shape.participant_parties],
          output_kinds: [...shape.output_kinds],
          publish_requires_any_output: [...shape.publish_requires_any_output],
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", forumId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: body.status === "archived" ? "forum.archive" : "forum.update",
        recordType: "forum",
        recordId: forumId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(forumFields(current), forumFields(updated)),
      });
      return updated;
    });
    const [out] = await toForums(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.get(PARTICIPANTS, { config: read }, async (request) => {
    const { transformationId, forumId } = parse(forumParams, request.params, "params");
    const query = parseQuery(z.strictObject(pageQuery), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await loadForum(db, transformationId, forumId);
    const hash = filterHash({ forumId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("forum_participant").selectAll().where("forum_id", "=", forumId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toForumParticipant), nextCursor: page.nextCursor };
  });

  app.post(
    PARTICIPANTS,
    { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, forumId } = parse(forumParams, request.params, "params");
      const body = parseBody(forumParticipantCreate, request.body);
      const row = await db.transaction().execute(async (tx) => {
        const { userId } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
        const forum = await loadForum(tx, transformationId, forumId);
        if (forum.status === "archived") throw forumRefusals.archived();
        const targetUser = "userId" in body ? body.userId : null;
        const targetGroup = "groupId" in body ? body.groupId : null;
        if (targetUser !== null && !(await isActiveUserOf(tx, forum.organization_id, targetUser)))
          throw unknownTarget("/userId", "user");
        if (targetGroup !== null) {
          const g = await tx
            .selectFrom("access_group")
            .select("id")
            .where("id", "=", targetGroup)
            .where("organization_id", "=", forum.organization_id)
            .executeTakeFirst();
          if (!g) throw unknownTarget("/groupId", "group");
        }
        const duplicate = await tx
          .selectFrom("forum_participant")
          .select("id")
          .where("forum_id", "=", forumId)
          .where("status", "=", "active")
          .where(targetUser !== null ? "user_id" : "group_id", "=", (targetUser ?? targetGroup)!)
          .executeTakeFirst();
        if (duplicate) throw forumRefusals.participantExists();
        const id = uuidv7();
        const created = await tx
          .insertInto("forum_participant")
          .values({
            id,
            organization_id: forum.organization_id,
            transformation_id: transformationId,
            forum_id: forumId,
            user_id: targetUser,
            group_id: targetGroup,
            counts_for_quorum: body.countsForQuorum ?? true,
            created_by: userId,
            updated_by: userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, auditContextOf(request), {
          action: "forum_participant.create",
          recordType: "forum_participant",
          recordId: id,
          organizationId: forum.organization_id,
          transformationId,
          newVersion: 1,
          changes: {
            forum_id: { from: null, to: forumId },
            user_id: { from: null, to: targetUser },
            group_id: { from: null, to: targetGroup },
            counts_for_quorum: { from: null, to: created.counts_for_quorum },
          },
        });
        return created;
      });
      return sendVersioned(
        reply,
        201,
        toForumParticipant(row),
        `/api/v1/transformations/${transformationId}/forums/${forumId}/participants`,
      );
    },
  );

  // Bodiless action (no config.consumes; the completeWorkItem precedent, S-3).
  app.post(REMOVE, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    const { transformationId, forumId, forumParticipantId } = parse(participantParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceAction(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      await loadForum(tx, transformationId, forumId);
      const current = await tx
        .selectFrom("forum_participant")
        .selectAll()
        .where("id", "=", forumParticipantId)
        .where("forum_id", "=", forumId)
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "removed") throw forumRefusals.participantRemoved();
      const updated = await tx
        .updateTable("forum_participant")
        .set({
          status: "removed",
          removed_at: sql<Date>`now()`,
          removed_by: userId,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", forumParticipantId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "forum_participant.remove",
        recordType: "forum_participant",
        recordId: forumParticipantId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: { status: { from: "active", to: "removed" } },
      });
      return updated;
    });
    return sendVersioned(reply, 200, toForumParticipant(row));
  });

  return [
    `GET ${FORUMS}`,
    `POST ${FORUMS}`,
    `GET ${ONE}`,
    `PATCH ${ONE}`,
    `GET ${PARTICIPANTS}`,
    `POST ${PARTICIPANTS}`,
    `POST ${REMOVE}`,
  ];
}
