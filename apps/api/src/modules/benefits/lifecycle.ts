// The six-step benefits lifecycle and its enablers (P4 slice B; ADR-0029 §2, §3, §11; T-DG4-KBE-D; REQ-PB-074,
// REQ-S08-002):
//   GET  /transformations/{t}/benefits/{benefitId}/lifecycle          the six B0121 steps (question and output, en and
//                                                                     provisional ar), preconditions met per step,
//                                                                     the step history (transformation.read)
//   POST /transformations/{t}/benefits/{benefitId}/lifecycle          move one step (benefit.advance; BO; If-Match on
//                                                                     the benefit)
//   GET  /transformations/{t}/benefits/{benefitId}/enablers           the benefit dependency chain with `delivered`
//   POST /transformations/{t}/benefits/{benefitId}/enablers           link an initiative, optionally its deliverable or
//                                                                     a capability (benefit.edit)
//   POST /transformations/{t}/benefit-enablers/{benefitEnablerId}/remove  remove a link with a reason (benefit.edit;
//                                                                     If-Match on the link; final)
//
// - The source output of each step is a precondition (ADR-0029 §2): Enable and later need the Plan outputs (baseline,
//   formula — not for non_financial —, target, owner); Measure also needs at least one active enabler; Correct needs a
//   recovery plan; Sustain needs a BAU owner and a control cadence. Allowed moves: identify→plan→enable→measure,
//   measure↔correct, measure→sustain. The API returns the exact ADR-0029 §11 code before the database refuses.
// - REQ-S08-002: an enabler has no amount. A delivered enabler (accepted deliverable, or completed initiative without a
//   deliverable) only marks the benefit `enabled_not_yet_measured`; it never creates realized or validated value.
// - History rows are written by the database trigger benefit_lifecycle_history (actor = updated_by), so they cannot
//   diverge from the benefit row; the advance itself writes one `benefit.lifecycle_advanced` audit event.
import { diffFields, sql, type BenefitEnablerRow, type DbOrTx, type Tx } from "@mth/db";
import {
  benefitEnablerCreate,
  benefitLifecycleAdvance,
  isAllowedLifecycleMove,
  missingFor,
  planOutputsText,
  reasonRequest,
  type BenefitEnabler,
  type BenefitLifecycle,
  type BenefitLifecycleStep,
  type BenefitValueClass,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
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
import { assertSameTransformation, bumpStamps, maybeIdempotent, sendCreated } from "../transformations/index.ts";
import {
  archivedBenefit,
  BENEFIT_AUDIT_FIELDS,
  BENEFIT_EDIT,
  BENEFIT_ITEM,
  benefitRule,
  checkBenefitVersion,
  enablerFacts,
  JSON_BODY,
  lockBenefit,
  openBenefitWrite,
  parseBenefitParams,
  planOutputsMissing,
  presentBenefit,
  readBenefitRow,
} from "./register.ts";

export const BENEFIT_ADVANCE = "benefit.advance" as const;
export const LIFECYCLE = `${BENEFIT_ITEM}/lifecycle`;
export const ENABLERS = `${BENEFIT_ITEM}/enablers`;
export const ENABLER_REMOVE = "/api/v1/transformations/:transformationId/benefit-enablers/:benefitEnablerId/remove";

// ------------------------------------------------------------------------------------------------ lifecycle

/** The facts the step preconditions read, from a benefit row and its active enabler count. */
function factsOf(
  b: {
    value_class: string;
    owner_user_id: string;
    baseline_value: string | null;
    baseline_id: string | null;
    benefit_formula_id: string | null;
    target_value: string | null;
    recovery_plan: string | null;
    bau_owner_user_id: string | null;
    control_cadence: string | null;
  },
  activeEnablers: number,
) {
  return {
    valueClass: b.value_class as BenefitValueClass,
    ownerUserId: b.owner_user_id,
    baselineValue: b.baseline_value,
    baselineId: b.baseline_id,
    benefitFormulaId: b.benefit_formula_id,
    targetValue: b.target_value,
    recoveryPlan: b.recovery_plan,
    bauOwnerUserId: b.bau_owner_user_id,
    controlCadence: b.control_cadence,
    activeEnablers,
  };
}

async function presentLifecycle(
  db: DbOrTx,
  benefit: Parameters<typeof factsOf>[0] & { id: string; lifecycle_step: string },
): Promise<BenefitLifecycle> {
  const defs = await db.selectFrom("benefit_lifecycle_step_definition").selectAll().orderBy("ordinal").execute();
  const history = await db
    .selectFrom("benefit_lifecycle_event")
    .selectAll()
    .where("benefit_id", "=", benefit.id)
    .orderBy("benefit_version")
    .execute();
  const active = (await enablerFacts(db, [benefit.id])).get(benefit.id)?.active ?? 0;
  const facts = factsOf(benefit, active);
  return {
    benefitId: benefit.id,
    currentStep: benefit.lifecycle_step as BenefitLifecycleStep,
    steps: defs.map((d) => {
      const missing = missingFor(d.code as BenefitLifecycleStep, facts);
      return {
        code: d.code as BenefitLifecycleStep,
        ordinal: d.ordinal,
        stepEn: d.step_en,
        questionEn: d.question_en,
        outputEn: d.output_en,
        stepAr: d.step_ar,
        questionAr: d.question_ar,
        outputAr: d.output_ar,
        arIsProvisional: d.ar_is_provisional,
        preconditionsMet: missing.length === 0,
        missing,
      };
    }),
    history: history.map((h) => ({
      fromStep: h.from_step as BenefitLifecycleStep | null,
      toStep: h.to_step as BenefitLifecycleStep,
      benefitVersion: h.benefit_version,
      occurredAt: iso(h.occurred_at),
      actorUserId: h.actor_user_id,
    })),
  };
}

async function advanceLifecycle(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_ADVANCE);
  const body = parseBody(benefitLifecycleAdvance, request.body);
  const expected = requireIfMatch(request);
  const current = await lockBenefit(tx, transformationId, benefitId);
  checkBenefitVersion(current, expected);
  const from = current.lifecycle_step as BenefitLifecycleStep;
  if (!isAllowedLifecycleMove(from, body.toStep))
    throw benefitRule(
      "benefit.lifecycle_step",
      "A benefit moves Identify → Plan → Enable → Measure, between Measure and Correct, and from Measure to Sustain, one step at a time.",
      "/toStep",
    );
  const active = (await enablerFacts(tx, [benefitId])).get(benefitId)?.active ?? 0;
  const missing = missingFor(body.toStep, factsOf(current, active));
  const planText = planOutputsText(missing);
  if (planText !== "") throw planOutputsMissing(planText);
  if (missing.includes("enablers"))
    throw benefitRule(
      "benefit.enablers_missing",
      "The Enable output is missing: link at least one enabling initiative, deliverable or capability before Measure.",
    );
  if (missing.includes("recovery_plan"))
    throw benefitRule("benefit.recovery_plan_required", "The Correct step needs a recovery plan.");
  if (missing.includes("bau_owner") || missing.includes("control_cadence"))
    throw benefitRule("benefit.sustain_outputs_missing", "The Sustain step needs a BAU owner and a control cadence.");
  const updated = await tx
    .updateTable("benefit")
    .set({ lifecycle_step: body.toStep, ...bumpStamps(ctx.userId) })
    .where("id", "=", benefitId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit.lifecycle_advanced",
    recordType: "benefit",
    recordId: benefitId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: diffFields(current, updated, [...BENEFIT_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ enablers

export const ENABLER_AUDIT_FIELDS = [
  "benefit_id",
  "initiative_id",
  "deliverable_id",
  "capability_id",
  "note",
  "status",
  "remove_reason",
] as const satisfies readonly (keyof BenefitEnablerRow & string)[];

/** API enablers with their `delivered` flag (one query for the flags). */
export async function presentEnablers(db: DbOrTx, rows: readonly BenefitEnablerRow[]): Promise<BenefitEnabler[]> {
  if (rows.length === 0) return [];
  const flags = await db
    .selectFrom("benefit_enabler as e")
    .innerJoin("initiative as i", "i.id", "e.initiative_id")
    .leftJoin("deliverable as d", "d.id", "e.deliverable_id")
    .select(["e.id", "e.deliverable_id", "d.acceptance_status", "i.status as initiative_status"])
    .where(
      "e.id",
      "in",
      rows.map((r) => r.id),
    )
    .execute();
  return rows.map((r) => {
    const f = flags.find((x) => x.id === r.id);
    const delivered =
      f === undefined
        ? false
        : f.deliverable_id !== null
          ? f.acceptance_status === "accepted"
          : f.initiative_status === "completed";
    return {
      id: r.id,
      benefitId: r.benefit_id,
      initiativeId: r.initiative_id,
      deliverableId: r.deliverable_id,
      capabilityId: r.capability_id,
      note: r.note,
      delivered,
      status: r.status as BenefitEnabler["status"],
      removedAt: isoOrNull(r.removed_at),
      removedBy: r.removed_by,
      removeReason: r.remove_reason,
      version: r.version,
      createdAt: iso(r.created_at),
      createdBy: r.created_by,
      updatedAt: iso(r.updated_at),
    };
  });
}

async function createEnabler(tx: Tx, request: FastifyRequest, transformationId: string, benefitId: string) {
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
  const body = parseBody(benefitEnablerCreate, request.body);
  return maybeIdempotent(tx, request, ctx.userId, body, async () => {
    // FOR SHARE: a concurrent lifecycle advance (FOR UPDATE) sees the enabler or waits for it.
    const benefit = await lockBenefit(tx, transformationId, benefitId, "share");
    if (benefit.status === "archived") throw archivedBenefit();
    await assertSameTransformation(tx, "initiative", transformationId, body.initiativeId, "/initiativeId");
    await assertSameTransformation(tx, "capability", transformationId, body.capabilityId ?? null, "/capabilityId");
    if (body.deliverableId !== undefined && body.deliverableId !== null) {
      await assertSameTransformation(tx, "deliverable", transformationId, body.deliverableId, "/deliverableId");
      const d = await tx
        .selectFrom("deliverable")
        .select("initiative_id")
        .where("id", "=", body.deliverableId)
        .executeTakeFirstOrThrow();
      if (d.initiative_id !== body.initiativeId)
        throw benefitRule(
          "benefit_enabler.deliverable_initiative",
          "The deliverable must belong to the enabling initiative.",
          "/deliverableId",
        );
    }
    let dup = tx
      .selectFrom("benefit_enabler")
      .select("id")
      .where("benefit_id", "=", benefitId)
      .where("initiative_id", "=", body.initiativeId)
      .where("status", "=", "active");
    dup = body.deliverableId
      ? dup.where("deliverable_id", "=", body.deliverableId)
      : dup.where("deliverable_id", "is", null);
    dup = body.capabilityId
      ? dup.where("capability_id", "=", body.capabilityId)
      : dup.where("capability_id", "is", null);
    if (await dup.executeTakeFirst())
      throw problems.duplicate("benefit_enabler.exists", "This enabler is already linked to the benefit.");
    const id = uuidv7();
    const row = await tx
      .insertInto("benefit_enabler")
      .values({
        id,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        benefit_id: benefitId,
        initiative_id: body.initiativeId,
        deliverable_id: body.deliverableId ?? null,
        capability_id: body.capabilityId ?? null,
        note: body.note ?? null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "benefit_enabler.create",
      recordType: "benefit_enabler",
      recordId: id,
      organizationId: ctx.organizationId,
      transformationId,
      newVersion: row.version,
      changes: diffFields({} as BenefitEnablerRow, row, [...ENABLER_AUDIT_FIELDS]),
    });
    return { status: 201, body: (await presentEnablers(tx, [row]))[0]! };
  });
}

const enablerParams = z.strictObject({ transformationId: z.uuid(), benefitEnablerId: z.uuid() });

async function removeEnabler(tx: Tx, request: FastifyRequest) {
  const { transformationId, benefitEnablerId } = parse(enablerParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
  const { reason } = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const seen = await tx
    .selectFrom("benefit_enabler")
    .select("benefit_id")
    .where("id", "=", benefitEnablerId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!seen) throw problems.notFound();
  const benefit = await lockBenefit(tx, transformationId, seen.benefit_id, "share");
  if (benefit.status === "archived") throw archivedBenefit();
  const current = await tx
    .selectFrom("benefit_enabler")
    .selectAll()
    .where("id", "=", benefitEnablerId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "removed") throw benefitRule("benefit_enabler.removed", "This enabler link is removed.");
  const updated = await tx
    .updateTable("benefit_enabler")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: ctx.userId,
      remove_reason: reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", benefitEnablerId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_enabler.remove",
    recordType: "benefit_enabler",
    recordId: benefitEnablerId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...ENABLER_AUDIT_FIELDS]),
  });
  return (await presentEnablers(tx, [updated]))[0]!;
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitLifecycleRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(LIFECYCLE, { config: read }, async (request, reply) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const row = await readBenefitRow(db, request, transformationId, benefitId);
    reply.header("ETag", `"${row.version}"`);
    return presentLifecycle(db, row);
  });

  app.post(
    LIFECYCLE,
    { config: { access: { permission: BENEFIT_ADVANCE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, benefitId } = parseBenefitParams(request.params);
      const body = await db
        .transaction()
        .execute(async (tx) => presentBenefit(tx, await advanceLifecycle(tx, request, transformationId, benefitId)));
      return sendVersioned(reply, 200, body);
    },
  );

  app.get(ENABLERS, { config: read }, async (request) => {
    const { transformationId, benefitId } = parseBenefitParams(request.params);
    const query = parseQuery(pageQuery, request.query);
    await readBenefitRow(db, request, transformationId, benefitId);
    const hash = filterHash({ table: "benefit_enabler", benefitId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit_enabler").selectAll().where("benefit_id", "=", benefitId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentEnablers(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(
    ENABLERS,
    { config: { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, benefitId } = parseBenefitParams(request.params);
      const result = await db.transaction().execute((tx) => createEnabler(tx, request, transformationId, benefitId));
      return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/benefit-enablers`);
    },
  );

  app.post(
    ENABLER_REMOVE,
    { config: { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const body = await db.transaction().execute((tx) => removeEnabler(tx, request));
      return sendVersioned(reply, 200, body);
    },
  );

  return [`GET ${LIFECYCLE}`, `POST ${LIFECYCLE}`, `GET ${ENABLERS}`, `POST ${ENABLERS}`, `POST ${ENABLER_REMOVE}`];
}
