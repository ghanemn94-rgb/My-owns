// Benefit scenarios (P4 slice B; ADR-0029 §10, §11; T-DG4-KBE-D2; REQ-S08-018, REQ-S16-017 "Scenario"):
//   GET   /transformations/{t}/benefit-scenarios                                list with labelled values (transformation.read)
//   POST  /transformations/{t}/benefit-scenarios                                create (benefit_scenario.edit; TL, FIN)
//   GET   /transformations/{t}/benefit-scenarios/{scenarioId}                   one scenario with its labelled values
//   PATCH /transformations/{t}/benefit-scenarios/{scenarioId}                   rename, assumptions, archive (If-Match)
//   POST  /transformations/{t}/benefit-scenarios/{scenarioId}/values            add a value for a benefit and period
//   PATCH /transformations/{t}/benefit-scenario-values/{valueId}                change a value (If-Match)
//
// Scenarios are NEVER actuals (REQ-S08-018, M0174): their values live only in benefit_scenario_value, which neither the
// value-state view benefit_value_line nor benefit_counting reads, so no realized, validated or sustained figure (the
// T14 Realized column, KBE-E's totals) can include them. Every value this file returns carries its `scenarioKind`
// label (base | upside | downside). One active scenario per kind and transformation (409 benefit_scenario.kind_exists).
// A value's currency is copied from its benefit (never converted); a non-financial benefit takes a SAR amount only with
// a Finance-approved valuation method (422 benefit_value.unmonetised, REQ-S08-010); a parent benefit carries no values
// (422 benefit_value.parent_rollup); one value per scenario, benefit and period start (409 benefit_value.period_taken).
// Every mutation: 403 when the permission is held nowhere (AUD, ADM-only, BO), 404 outside the read scope, the write
// gate re-checked at commit time, zod (400), the §11 rules (422/409), If-Match on updates (428/409; creates start at
// version 1) and one audit event in the same transaction. No remote or client I/O inside a transaction.
import {
  diffFields,
  sql,
  type BenefitRow,
  type BenefitScenarioRow,
  type BenefitScenarioValueRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import {
  benefitScenarioCreate,
  benefitScenarioUpdate,
  benefitScenarioValueCreate,
  benefitScenarioValueUpdate,
  MEASURE_COLUMN,
  MONEY_COLUMN,
  periodInOrder,
  toColumnString,
  type BenefitScenario,
  type BenefitScenarioKind,
  type BenefitScenarioValue,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
import {
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import { archivedBenefit, benefitRule, JSON_BODY, openBenefitWrite, parseTransformationParam } from "./register.ts";

export const BENEFIT_SCENARIO_EDIT = "benefit_scenario.edit" as const;
export const SCENARIOS = "/api/v1/transformations/:transformationId/benefit-scenarios";
export const SCENARIO_ITEM = `${SCENARIOS}/:benefitScenarioId`;
export const SCENARIO_VALUES = `${SCENARIO_ITEM}/values`;
export const SCENARIO_VALUE_COLLECTION = "/api/v1/transformations/:transformationId/benefit-scenario-values";
export const SCENARIO_VALUE_ITEM = `${SCENARIO_VALUE_COLLECTION}/:benefitScenarioValueId`;

export const SCENARIO_AUDIT_FIELDS = [
  "kind",
  "title",
  "assumptions",
  "business_case_id",
  "status",
  "archived_at",
  "archived_by",
  "archive_reason",
] as const satisfies readonly (keyof BenefitScenarioRow & string)[];

export const SCENARIO_VALUE_AUDIT_FIELDS = [
  "scenario_id",
  "benefit_id",
  "period_start",
  "period_end",
  "amount",
  "kpi_value",
  "currency",
  "note",
] as const satisfies readonly (keyof BenefitScenarioValueRow & string)[];

// ------------------------------------------------------------------------------------------------ refusals (§11)

export const scenarioRefusals = {
  kindExists: (kind: string) =>
    problems.duplicate("benefit_scenario.kind_exists", `This transformation already has an active ${kind} scenario.`),
  archived: () => problems.businessRule("record.archived", "Archived records are read-only."),
  unmonetised: () =>
    benefitRule(
      "benefit_value.unmonetised",
      "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
      "/amount",
    ),
  parentRollup: (benefitCode: string) =>
    benefitRule(
      "benefit_value.parent_rollup",
      `Benefit ${benefitCode} is a parent: its values come from its children.`,
      "/benefitId",
    ),
  /** {valueKind} = "scenario" (the scenario's kind is the record the caller writes to; "a upside" would not read). */
  periodTaken: (periodStart: string) =>
    problems.duplicate(
      "benefit_value.period_taken",
      `This benefit already has a scenario value for the period starting ${periodStart}.`,
    ),
  /** Additional codes (not in ADR-0029 §11; the database CHECKs behind them would otherwise answer generically). */
  periodRange: () =>
    benefitRule("benefit_value.period_range", "The period end cannot be before the period start.", "/periodEnd"),
  valueRequired: () =>
    benefitRule("benefit_value.value_required", "A scenario value needs an amount or a KPI value.", "/amount"),
} as const;

// ------------------------------------------------------------------------------------------------ presenters

const dateText = (v: string | Date): string => (typeof v === "string" ? v : v.toISOString().slice(0, 10));

export function toScenarioValue(r: BenefitScenarioValueRow, kind: BenefitScenarioKind): BenefitScenarioValue {
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    scenarioKind: kind,
    benefitId: r.benefit_id,
    periodStart: dateText(r.period_start),
    periodEnd: dateText(r.period_end),
    amount: r.amount === null ? null : toColumnString(r.amount, MONEY_COLUMN),
    kpiValue: r.kpi_value === null ? null : toColumnString(r.kpi_value, MEASURE_COLUMN),
    currency: r.currency.trim(),
    note: r.note,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

export async function presentScenarios(db: DbOrTx, rows: readonly BenefitScenarioRow[]): Promise<BenefitScenario[]> {
  if (rows.length === 0) return [];
  const values = await db
    .selectFrom("benefit_scenario_value")
    .selectAll()
    .where(
      "scenario_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("benefit_id")
    .orderBy("period_start")
    .execute();
  return rows.map((s) => {
    const kind = s.kind as BenefitScenarioKind;
    return {
      id: s.id,
      transformationId: s.transformation_id,
      businessCaseId: s.business_case_id,
      kind,
      title: s.title,
      assumptions: s.assumptions,
      values: values.filter((v) => v.scenario_id === s.id).map((v) => toScenarioValue(v, kind)),
      status: s.status as BenefitScenario["status"],
      archivedAt: isoOrNull(s.archived_at),
      archivedBy: s.archived_by,
      archiveReason: s.archive_reason,
      version: s.version,
      createdAt: iso(s.created_at),
      createdBy: s.created_by,
      updatedAt: iso(s.updated_at),
    };
  });
}

// ------------------------------------------------------------------------------------------------ scenario services

async function createScenario(tx: Tx, ctx: WriteContext, body: z.infer<typeof benefitScenarioCreate>) {
  await assertSameTransformation(tx, "business_case", ctx.transformationId, body.businessCaseId, "/businessCaseId");
  const taken = await tx
    .selectFrom("benefit_scenario")
    .select("id")
    .where("transformation_id", "=", ctx.transformationId)
    .where("kind", "=", body.kind)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (taken) throw scenarioRefusals.kindExists(body.kind);
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_scenario")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      business_case_id: body.businessCaseId ?? null,
      kind: body.kind,
      title: body.title,
      assumptions: body.assumptions ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_scenario.create",
    recordType: "benefit_scenario",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitScenarioRow, row, [...SCENARIO_AUDIT_FIELDS]),
  });
  return row;
}

const scenarioParams = z.strictObject({ transformationId: z.uuid(), benefitScenarioId: z.uuid() });
const valueParams = z.strictObject({ transformationId: z.uuid(), benefitScenarioValueId: z.uuid() });

async function lockScenario(tx: Tx, transformationId: string, scenarioId: string, mode: "update" | "share") {
  let q = tx
    .selectFrom("benefit_scenario")
    .selectAll()
    .where("id", "=", scenarioId)
    .where("transformation_id", "=", transformationId);
  q = mode === "update" ? q.forUpdate() : q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function updateScenario(tx: Tx, request: FastifyRequest) {
  const { transformationId, benefitScenarioId } = parse(scenarioParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_SCENARIO_EDIT);
  const body = parseBody(benefitScenarioUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockScenario(tx, transformationId, benefitScenarioId, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw scenarioRefusals.archived();
  const archiving = body.archiveReason !== undefined;
  const updated = await tx
    .updateTable("benefit_scenario")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.assumptions !== undefined ? { assumptions: body.assumptions } : {}),
      ...(archiving
        ? {
            status: "archived",
            archived_at: sql<Date>`now()`,
            archived_by: ctx.userId,
            archive_reason: body.archiveReason!,
          }
        : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: archiving ? "benefit_scenario.archive" : "benefit_scenario.update",
    recordType: "benefit_scenario",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...SCENARIO_AUDIT_FIELDS]),
    ...(archiving ? { reason: body.archiveReason! } : {}),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ value services

/** The merged value a create or update would store, checked before the database (which refuses it again). */
interface ValueFacts {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: string | null;
  readonly kpiValue: string | null;
}

/**
 * The ADR-0029 §10/§11 rules of a scenario value, in order: the benefit is active (422 benefit.archived), not a parent
 * (422 benefit_value.parent_rollup), a SAR amount on a non-financial benefit needs an approved valuation method (422
 * benefit_value.unmonetised), the period is in order and a value is present (422), and the period start is free for
 * this scenario and benefit (409 benefit_value.period_taken).
 */
async function checkValueRules(
  tx: Tx,
  benefit: BenefitRow,
  scenario: BenefitScenarioRow,
  facts: ValueFacts,
  selfId: string | null,
): Promise<void> {
  if (benefit.status !== "active") throw archivedBenefit();
  const child = await tx
    .selectFrom("benefit")
    .select("id")
    .where("parent_benefit_id", "=", benefit.id)
    .executeTakeFirst();
  if (child) throw scenarioRefusals.parentRollup(benefit.code);
  if (facts.amount !== null && benefit.value_class === "non_financial") {
    const approved =
      benefit.valuation_method_id === null
        ? undefined
        : await tx
            .selectFrom("benefit_valuation_method")
            .select("id")
            .where("id", "=", benefit.valuation_method_id)
            .where("status", "=", "approved")
            .executeTakeFirst();
    if (!approved) throw scenarioRefusals.unmonetised();
  }
  if (!periodInOrder(facts.periodStart, facts.periodEnd)) throw scenarioRefusals.periodRange();
  if (facts.amount === null && facts.kpiValue === null) throw scenarioRefusals.valueRequired();
  let q = tx
    .selectFrom("benefit_scenario_value")
    .select("id")
    .where("scenario_id", "=", scenario.id)
    .where("benefit_id", "=", benefit.id)
    .where("period_start", "=", facts.periodStart);
  if (selfId !== null) q = q.where("id", "<>", selfId);
  if (await q.executeTakeFirst()) throw scenarioRefusals.periodTaken(facts.periodStart);
}

/** The benefit of a value, locked FOR SHARE so its class, currency and parent status cannot change under the write. */
async function shareLockBenefit(tx: Tx, transformationId: string, benefitId: string): Promise<BenefitRow | undefined> {
  return tx
    .selectFrom("benefit")
    .selectAll()
    .where("id", "=", benefitId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
}

async function createValue(
  tx: Tx,
  ctx: WriteContext,
  benefitScenarioId: string,
  body: z.infer<typeof benefitScenarioValueCreate>,
) {
  const transformationId = ctx.transformationId;
  const scenario = await lockScenario(tx, transformationId, benefitScenarioId, "share");
  if (scenario.status === "archived") throw scenarioRefusals.archived();
  const benefit = await shareLockBenefit(tx, transformationId, body.benefitId);
  if (!benefit) await assertSameTransformation(tx, "benefit", transformationId, body.benefitId, "/benefitId");
  const facts: ValueFacts = {
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    amount: body.amount ?? null,
    kpiValue: body.kpiValue ?? null,
  };
  await checkValueRules(tx, benefit!, scenario, facts, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_scenario_value")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      scenario_id: scenario.id,
      benefit_id: benefit!.id,
      period_start: facts.periodStart,
      period_end: facts.periodEnd,
      amount: facts.amount,
      kpi_value: facts.kpiValue,
      currency: benefit!.currency,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_scenario_value.create",
    recordType: "benefit_scenario_value",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitScenarioValueRow, row, [...SCENARIO_VALUE_AUDIT_FIELDS]),
  });
  return { status: 201, body: toScenarioValue(row, scenario.kind as BenefitScenarioKind) };
}

async function updateValue(tx: Tx, request: FastifyRequest): Promise<BenefitScenarioValue> {
  const { transformationId, benefitScenarioValueId } = parse(valueParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_SCENARIO_EDIT);
  const body = parseBody(benefitScenarioValueUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("benefit_scenario_value")
    .selectAll()
    .where("id", "=", benefitScenarioValueId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const scenario = await lockScenario(tx, transformationId, current.scenario_id, "share");
  if (scenario.status === "archived") throw scenarioRefusals.archived();
  const benefit = (await shareLockBenefit(tx, transformationId, current.benefit_id))!;
  const facts: ValueFacts = {
    periodStart: body.periodStart ?? dateText(current.period_start),
    periodEnd: body.periodEnd ?? dateText(current.period_end),
    amount: body.amount !== undefined ? body.amount : current.amount,
    kpiValue: body.kpiValue !== undefined ? body.kpiValue : current.kpi_value,
  };
  await checkValueRules(tx, benefit, scenario, facts, current.id);
  const updated = await tx
    .updateTable("benefit_scenario_value")
    .set({
      ...(body.periodStart !== undefined ? { period_start: body.periodStart } : {}),
      ...(body.periodEnd !== undefined ? { period_end: body.periodEnd } : {}),
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.kpiValue !== undefined ? { kpi_value: body.kpiValue } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_scenario_value.update",
    recordType: "benefit_scenario_value",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...SCENARIO_VALUE_AUDIT_FIELDS]),
  });
  return toScenarioValue(updated, scenario.kind as BenefitScenarioKind);
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitScenarioRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: BENEFIT_SCENARIO_EDIT }, consumes: JSON_BODY };

  app.get(SCENARIOS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "benefit_scenario", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit_scenario").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentScenarios(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(SCENARIOS, { config: write }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_SCENARIO_EDIT);
      const body = parseBody(benefitScenarioCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: (await presentScenarios(tx, [await createScenario(tx, ctx, body)]))[0]!,
      }));
    });
    return sendCreated(request, reply, result);
  });

  app.get(SCENARIO_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, benefitScenarioId } = parse(scenarioParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("benefit_scenario")
      .selectAll()
      .where("id", "=", benefitScenarioId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentScenarios(db, [row]))[0]!);
  });

  app.patch(SCENARIO_ITEM, { config: write }, async (request, reply) => {
    const body = await db
      .transaction()
      .execute(async (tx) => (await presentScenarios(tx, [await updateScenario(tx, request)]))[0]!);
    return sendVersioned(reply, 200, body);
  });

  app.post(SCENARIO_VALUES, { config: write }, async (request, reply) => {
    const { transformationId, benefitScenarioId } = parse(scenarioParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_SCENARIO_EDIT);
      const body = parseBody(benefitScenarioValueCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, () => createValue(tx, ctx, benefitScenarioId, body));
    });
    return sendCreated(
      request,
      reply,
      result,
      SCENARIO_VALUE_COLLECTION.replace(":transformationId", transformationId),
    );
  });

  app.patch(SCENARIO_VALUE_ITEM, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute((tx) => updateValue(tx, request));
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${SCENARIOS}`,
    `POST ${SCENARIOS}`,
    `GET ${SCENARIO_ITEM}`,
    `PATCH ${SCENARIO_ITEM}`,
    `POST ${SCENARIO_VALUES}`,
    `PATCH ${SCENARIO_VALUE_ITEM}`,
  ];
}
