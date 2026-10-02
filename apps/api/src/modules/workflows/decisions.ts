// THE canonical decision register (ADR-0015 §1; REQ-PB-043, B0065 T04 Design Decision Log):
//   GET   /decisions?transformationId=&kind=&status=&tomDimensionCode=     list (?kind=design is T04)
//   POST  /decisions                                                       create a design decision (decision.edit)
//   GET   /decisions/{id}                                                  one decision with its options
//   PATCH /decisions/{id}                                                  edit an open/deferred design decision
//   POST  /decisions/{id}/options, PATCH /decisions/{id}/options/{optId}   options A/B/C... (decision If-Match)
//   POST  /decisions/{id}/decide                                           the OWNER (or a delegate) records the choice
// decision.decide is a `write` permission restricted to the decision's named owner (ADR-0020): the owner's design choice
// as the playbook names it, not a gate or Finance approval. Gate decisions (kind gate) are created only by the gate
// decision operation and are immutable here.
import { diffFields, sql, type Db, type DbOrTx, type DecisionOptionTable, type DecisionRow, type Tx } from "@mth/db";
import {
  decisionCreate,
  decisionDecide,
  decisionListQuery,
  decisionOptionCreate,
  decisionOptionUpdate,
  decisionUpdate,
  type Decision,
  type DecisionOption,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { actsOnBehalfOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
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
} from "../platform/index.ts";
import {
  assertActiveUsers,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  pick,
  ruleProblem,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import { nextCode } from "./codes.ts";

const BASE = "/api/v1/decisions";
const idParams = z.strictObject({ decisionId: z.uuid() });
const optionParams = z.strictObject({ decisionId: z.uuid(), optionId: z.uuid() });
const EDIT = [{ permission: "decision.edit" as const }];
const DECISION_AUDIT = [
  "title",
  "context",
  "owner_user_id",
  "due_date",
  "status",
  "recommendation_option_id",
  "recommendation_text",
  "chosen_option_id",
  "outcome_text",
  "decided_by",
  "tom_dimension_code",
] as const;

type OptionRow = Selectable<DecisionOptionTable>;

export function toDecisionOption(o: OptionRow): DecisionOption {
  return {
    id: o.id,
    organizationId: o.organization_id,
    transformationId: o.transformation_id,
    decisionId: o.decision_id,
    label: o.label,
    title: o.title,
    description: o.description,
    ordinal: o.ordinal,
    status: o.status as DecisionOption["status"],
    version: o.version,
    createdAt: iso(o.created_at),
    createdBy: o.created_by,
    updatedAt: iso(o.updated_at),
    updatedBy: o.updated_by,
  };
}

export function toDecision(d: DecisionRow, options: readonly OptionRow[]): Decision {
  return {
    id: d.id,
    organizationId: d.organization_id,
    transformationId: d.transformation_id,
    kind: d.kind as Decision["kind"],
    code: d.code,
    title: d.title,
    context: d.context,
    ownerUserId: d.owner_user_id,
    dueDate: d.due_date,
    status: d.status as Decision["status"],
    recommendationOptionId: d.recommendation_option_id,
    recommendationText: d.recommendation_text,
    chosenOptionId: d.chosen_option_id,
    outcomeText: d.outcome_text,
    decidedBy: d.decided_by,
    decidedAt: isoOrNull(d.decided_at),
    tomDimensionCode: d.tom_dimension_code,
    sourceWorkshopItemId: d.source_workshop_item_id,
    version: d.version,
    createdAt: iso(d.created_at),
    createdBy: d.created_by,
    updatedAt: iso(d.updated_at),
    updatedBy: d.updated_by,
    options: options.filter((o) => o.decision_id === d.id).map(toDecisionOption),
  };
}

/** Decisions with their options, in one round trip for the options. */
export async function decisionsWithOptions(db: DbOrTx, rows: readonly DecisionRow[]): Promise<Decision[]> {
  if (rows.length === 0) return [];
  const options = await db
    .selectFrom("decision_option")
    .selectAll()
    .where(
      "decision_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("ordinal")
    .execute();
  return rows.map((r) => toDecision(r, options));
}

async function loadDecision(db: DbOrTx, id: string): Promise<Decision> {
  const row = await db.selectFrom("decision").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return (await decisionsWithOptions(db, [row]))[0]!;
}

/**
 * Creates a design decision (status open, code D-nn) with inline options A, B, C... and one audit event per row.
 * Used by POST /decisions and by the workshop conversion (one transaction with the item's conversion).
 */
export async function insertDesignDecision(
  tx: Tx,
  ctx: Pick<WriteContext, "organizationId" | "transformationId" | "userId" | "audit">,
  input: {
    title: string;
    context?: string | null | undefined;
    ownerUserId?: string | null | undefined;
    dueDate?: string | null | undefined;
    tomDimensionCode?: string | null | undefined;
    recommendationText?: string | null | undefined;
    sourceWorkshopItemId?: string | null | undefined;
    options?: ReadonlyArray<{ title: string; description?: string | null | undefined }> | undefined;
  },
): Promise<DecisionRow> {
  const id = uuidv7();
  const code = await nextCode(tx, ctx.transformationId, "D");
  const row = await tx
    .insertInto("decision")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kind: "design",
      code,
      title: input.title,
      context: input.context ?? null,
      owner_user_id: input.ownerUserId ?? null,
      due_date: input.dueDate ?? null,
      tom_dimension_code: input.tomDimensionCode ?? null,
      recommendation_text: input.recommendationText ?? null,
      source_workshop_item_id: input.sourceWorkshopItemId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "decision.create",
    recordType: "decision",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: diffFields({} as Record<string, unknown>, row as unknown as Record<string, unknown>, [
      "kind",
      "code",
      ...DECISION_AUDIT,
    ]),
  });
  let ordinal = 0;
  for (const o of input.options ?? []) {
    ordinal += 1;
    await insertOption(tx, ctx, id, ordinal, o);
  }
  return row;
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function insertOption(
  tx: Tx,
  ctx: Pick<WriteContext, "organizationId" | "transformationId" | "userId" | "audit">,
  decisionId: string,
  ordinal: number,
  o: { title: string; description?: string | null | undefined },
): Promise<void> {
  const id = uuidv7();
  const label = LABELS.charAt(ordinal - 1);
  await tx
    .insertInto("decision_option")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      decision_id: decisionId,
      label,
      title: o.title,
      description: o.description ?? null,
      ordinal,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "decision_option.create",
    recordType: "decision_option",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: { label: { from: null, to: label }, title: { from: null, to: o.title } },
  });
}

/** Read gate of a decision through its transformation; 404 when missing or unreadable. */
async function readableDecision(db: DbOrTx, request: FastifyRequest, decisionId: string) {
  const d = await db.selectFrom("decision").selectAll().where("id", "=", decisionId).executeTakeFirst();
  if (!d) throw problems.notFound();
  const target = await requireTransformationRead(db, principalOf(request), d.transformation_id);
  return { decision: d, target };
}

/** If-Match + lock of a design decision in one of `statuses` (after the read and write gates). */
async function finishDecisionLock(tx: Tx, request: FastifyRequest, decisionId: string, statuses: readonly string[]) {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("decision")
    .selectAll()
    .where("id", "=", decisionId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.kind !== "design")
    throw problems.businessRule(
      "decision.not_design",
      "Only design decisions are edited here; gate decisions are final.",
    );
  if (!statuses.includes(current.status))
    throw problems.invalidTransition(`A ${current.status} decision cannot be changed this way.`);
  return { current };
}

async function bumpDecision(
  tx: Tx,
  ctx: WriteContext,
  current: DecisionRow,
  changes: Record<string, unknown>,
  action: string,
) {
  const updated = await tx
    .updateTable("decision")
    .set({ ...changes, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action,
    recordType: "decision",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...DECISION_AUDIT]),
  });
  return updated;
}

const DECISION_STATUS_TRANSITIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["open", ["deferred", "cancelled"]],
  ["deferred", ["open", "cancelled"]],
]);

export function registerDecisionRoutes(app: FastifyInstance, db: Db): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "decision.edit" as const } };
  const listQuery = z.strictObject({ ...decisionListQuery.shape, cursor: cursorSchema, limit: limitSchema });

  app.get(BASE, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({ ...query });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("decision").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.kind) q = q.where("kind", "=", query.kind);
    if (query.status) q = q.where("status", "=", query.status);
    if (query.tomDimensionCode) q = q.where("tom_dimension_code", "=", query.tomDimensionCode);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await decisionsWithOptions(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BASE, { config: edit }, async (request, reply) => {
    // The transformation comes from the body; read it leniently first so authorization precedes validation.
    const raw = (request.body ?? {}) as { transformationId?: unknown };
    const transformationId = parse(z.uuid(), raw.transformationId, "body");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, EDIT, null);
      const body = parseBody(decisionCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
        const row = await insertDesignDecision(tx, ctx, body);
        return { status: 201, body: await loadDecision(tx, row.id) };
      });
    });
    return sendCreated(request, reply, result, BASE);
  });

  app.get(`${BASE}/:decisionId`, { config: read }, async (request, reply) => {
    const { decisionId } = parse(idParams, request.params, "params");
    await readableDecision(db, request, decisionId);
    return sendVersioned(reply, 200, await loadDecision(db, decisionId));
  });

  app.patch(`${BASE}/:decisionId`, { config: edit }, async (request, reply) => {
    const { decisionId } = parse(idParams, request.params, "params");
    const decision = await db.transaction().execute(async (tx) => {
      const { decision: seen } = await readableDecision(tx, request, decisionId);
      const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null);
      const body = parseBody(decisionUpdate, request.body);
      const { current } = await finishDecisionLock(tx, request, decisionId, ["open", "deferred"]);
      const changes = pick(body, [
        ["title", "title"],
        ["context", "context"],
        ["ownerUserId", "owner_user_id"],
        ["dueDate", "due_date"],
        ["tomDimensionCode", "tom_dimension_code"],
        ["recommendationOptionId", "recommendation_option_id"],
        ["recommendationText", "recommendation_text"],
        ["status", "status"],
      ]);
      if (body.status !== undefined && body.status !== current.status) {
        if (!(DECISION_STATUS_TRANSITIONS.get(current.status) ?? []).includes(body.status))
          throw problems.invalidTransition(`A decision cannot move from ${current.status} to ${body.status}.`);
      }
      if (body.recommendationOptionId) {
        const option = await tx
          .selectFrom("decision_option")
          .select(["status"])
          .where("id", "=", body.recommendationOptionId)
          .where("decision_id", "=", decisionId)
          .executeTakeFirst();
        if (!option || option.status !== "active")
          throw ruleProblem(
            "decision.option_unknown",
            "Recommend an active option of this decision.",
            "/recommendationOptionId",
          );
      }
      await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
      await bumpDecision(tx, ctx, current, changes, "decision.update");
      return loadDecision(tx, decisionId);
    });
    return sendVersioned(reply, 200, decision);
  });

  app.post(`${BASE}/:decisionId/options`, { config: edit }, async (request, reply) => {
    const { decisionId } = parse(idParams, request.params, "params");
    const decision = await db.transaction().execute(async (tx) => {
      const { decision: seen } = await readableDecision(tx, request, decisionId);
      const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null);
      const body = parseBody(decisionOptionCreate, request.body);
      const { current } = await finishDecisionLock(tx, request, decisionId, ["open"]);
      const last = await tx
        .selectFrom("decision_option")
        .select((eb) => eb.fn.max<number>("ordinal").as("n"))
        .where("decision_id", "=", decisionId)
        .executeTakeFirst();
      const ordinal = (last?.n ?? 0) + 1;
      if (ordinal > 26) throw ruleProblem("decision.too_many_options", "A decision has at most 26 options (A-Z).", "");
      await insertOption(tx, ctx, decisionId, ordinal, body);
      await bumpDecision(tx, ctx, current, {}, "decision.add_option");
      return loadDecision(tx, decisionId);
    });
    return sendVersioned(reply, 200, decision);
  });

  app.patch(`${BASE}/:decisionId/options/:optionId`, { config: edit }, async (request, reply) => {
    const { decisionId, optionId } = parse(optionParams, request.params, "params");
    const decision = await db.transaction().execute(async (tx) => {
      const { decision: seen } = await readableDecision(tx, request, decisionId);
      const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null);
      const body = parseBody(decisionOptionUpdate, request.body);
      const { current } = await finishDecisionLock(tx, request, decisionId, ["open"]);
      const option = await tx
        .selectFrom("decision_option")
        .selectAll()
        .where("id", "=", optionId)
        .where("decision_id", "=", decisionId)
        .forUpdate()
        .executeTakeFirst();
      if (!option) throw problems.notFound();
      const changes = pick(body, [
        ["title", "title"],
        ["description", "description"],
        ["status", "status"],
      ]);
      const updated = await tx
        .updateTable("decision_option")
        .set({ ...changes, ...bumpStamps(ctx.userId) })
        .where("id", "=", optionId)
        .where("version", "=", option.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "decision_option.update",
        recordType: "decision_option",
        recordId: optionId,
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        priorVersion: option.version,
        newVersion: updated.version,
        changes: diffFields(option, updated, ["title", "description", "status"]),
      });
      // A withdrawn option can no longer be the recommendation.
      const decisionChanges =
        body.status === "withdrawn" && current.recommendation_option_id === optionId
          ? { recommendation_option_id: null }
          : {};
      await bumpDecision(tx, ctx, current, decisionChanges, "decision.update_option");
      return loadDecision(tx, decisionId);
    });
    return sendVersioned(reply, 200, decision);
  });

  app.post(
    `${BASE}/:decisionId/decide`,
    { config: { access: { permission: "decision.decide" } } },
    async (request, reply) => {
      const { decisionId } = parse(idParams, request.params, "params");
      const decision = await db.transaction().execute(async (tx) => {
        const { decision: seen, target } = await readableDecision(tx, request, decisionId);
        // decision.decide through the policy function first (403 for e.g. a read-only auditor), before the body.
        const ctx = await openWrite(tx, request, seen.transformation_id, [{ permission: "decision.decide" }], null);
        const body = parseBody(decisionDecide, request.body);
        const owner = seen.owner_user_id;
        // Record-level rule (ADR-0015 §1, ADR-0020 §3): only the named owner, or a delegate acting on their behalf.
        const isOwner = owner !== null && owner === ctx.userId && body.onBehalfOfUserId === undefined;
        const isDelegate =
          owner !== null &&
          body.onBehalfOfUserId === owner &&
          (await actsOnBehalfOf(tx, ctx.principal, owner, "decision", target));
        if (!isOwner && !isDelegate)
          throw new HttpProblem({
            status: 403,
            type: "urn:mth:problem:forbidden",
            code: "decision.not_owner",
            title: "Forbidden",
            detail: "Only the decision's owner, or a delegate acting on the owner's behalf, records the decision.",
          });
        const { current } = await finishDecisionLock(tx, request, decisionId, ["open"]);
        const option = await tx
          .selectFrom("decision_option")
          .select(["status"])
          .where("id", "=", body.chosenOptionId)
          .where("decision_id", "=", decisionId)
          .executeTakeFirst();
        if (!option || option.status !== "active")
          throw ruleProblem("decision.option_unknown", "Choose an active option of this decision.", "/chosenOptionId");
        const audit: AuditContext = isDelegate ? { ...ctx.audit, onBehalfOfUserId: owner } : ctx.audit;
        await bumpDecision(
          tx,
          { ...ctx, audit },
          current,
          {
            status: "decided",
            chosen_option_id: body.chosenOptionId,
            outcome_text: body.outcomeText,
            decided_by: ctx.userId,
            decided_at: sql<Date>`now()`,
          },
          "decision.decide",
        );
        return loadDecision(tx, decisionId);
      });
      return sendVersioned(reply, 200, decision);
    },
  );

  return [
    `GET ${BASE}`,
    `POST ${BASE}`,
    `GET ${BASE}/:decisionId`,
    `PATCH ${BASE}/:decisionId`,
    `POST ${BASE}/:decisionId/options`,
    `PATCH ${BASE}/:decisionId/options/:optionId`,
    `POST ${BASE}/:decisionId/decide`,
  ];
}
