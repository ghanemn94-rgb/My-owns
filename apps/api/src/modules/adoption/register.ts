// The T13 Stakeholder & Adoption Plan as a native register, champions, impacted-team involvement and champion
// constraints (P4 slice F; ADR-0033 §7, §9, §10; T-DG4-BE-H; REQ-PB-070, REQ-PB-073, REQ-S11-001, REQ-S16-020
// StakeholderGroup):
//   GET   /transformations/{t}/stakeholder-groups                          T13 rows (transformation.read)
//   POST  /transformations/{t}/stakeholder-groups                          add a row, SG-nn (adoption.edit)
//   GET   /transformations/{t}/stakeholder-groups/{g}                      one row with its counts
//   PATCH /transformations/{t}/stakeholder-groups/{g}                      update (If-Match)
//   POST  /transformations/{t}/stakeholder-groups/{g}/archive              archive with a reason; final (If-Match)
//   GET   /transformations/{t}/adoption-plan                               Template 13: the seven B0107 columns + counts
//   GET   /transformations/{t}/stakeholder-groups/{g}/champions            champions, active and removed
//   POST  /transformations/{t}/stakeholder-groups/{g}/champions            name a champion (adoption.edit)
//   POST  /transformations/{t}/stakeholder-groups/{g}/champions/{c}/remove remove; final (If-Match)
//   GET   /transformations/{t}/stakeholder-involvements                    involvement in workshops / T04 decisions
//   POST  /transformations/{t}/stakeholder-involvements                    record one (adoption.edit; append-only)
//   POST  /transformations/{t}/stakeholder-involvements/{i}/withdraw       append a withdrawal (adoption.edit)
//   GET   /transformations/{t}/champion-constraints                        constraints; ?decisionId= "on that decision"
//   POST  /transformations/{t}/champion-constraints                        raise one, in person, as an active champion
//   POST  /transformations/{t}/champion-constraints/{k}/resolve            address (decision.edit) or withdraw (its
//                                                                          champion); final (If-Match)
//
// The T13 value lists are closed (B0107): a stance of 'Hostile' is 400 stakeholder_group.stance_invalid at
// /currentStance, before any write. Refusals are exactly ADR-0033 §10 (S-11). Every mutation: the read gate first (an
// ADM-only caller or an outsider gets 404, ADR-0006 non-disclosure), the write permission re-checked at commit time
// on the reloaded grants (AUD 403), validation, If-Match on updates (428/409; creates are version 1), one audit event
// in the same transaction, and no remote I/O inside it (S-4). Stakeholder groups describe impacted populations and
// grant nothing; nothing here is a G1-G6 business approval or touches DG0-DG7.
import {
  diffFields,
  sql,
  type ChampionConstraintTable,
  type DbOrTx,
  type StakeholderChampionTable,
  type StakeholderGroupTable,
  type StakeholderInvolvementTable,
  type Tx,
} from "@mth/db";
import type { FieldError, Permission } from "@mth/shared";
import {
  adoptionReason,
  championConstraintCreate,
  championConstraintResolve,
  STAKEHOLDER_IMPACT_INVALID_CODE,
  STAKEHOLDER_INTERVENTION_INVALID_CODE,
  STAKEHOLDER_STANCE_INVALID_CODE,
  stakeholderChampionCreate,
  stakeholderGroupCreate,
  stakeholderGroupUpdate,
  stakeholderInvolvementCreate,
  type AdoptionPlan,
  type ChampionConstraint,
  type StakeholderChampion,
  type StakeholderGroup,
  type StakeholderInvolvement,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
import { assertActiveUsers, openWrite, type WriteContext } from "../transformations/index.ts";

export type StakeholderGroupRow = Selectable<StakeholderGroupTable>;
type ChampionRow = Selectable<StakeholderChampionTable>;
type InvolvementRow = Selectable<StakeholderInvolvementTable>;
type ConstraintRow = Selectable<ChampionConstraintTable>;

export const T_BASE = "/api/v1/transformations/:transformationId";
export const STAKEHOLDER_GROUPS = `${T_BASE}/stakeholder-groups`;
export const STAKEHOLDER_GROUP = `${STAKEHOLDER_GROUPS}/:stakeholderGroupId`;
export const STAKEHOLDER_GROUP_ARCHIVE = `${STAKEHOLDER_GROUP}/archive`;
export const ADOPTION_PLAN = `${T_BASE}/adoption-plan`;
export const STAKEHOLDER_CHAMPIONS = `${STAKEHOLDER_GROUP}/champions`;
export const STAKEHOLDER_CHAMPION_REMOVE = `${STAKEHOLDER_CHAMPIONS}/:stakeholderChampionId/remove`;
export const STAKEHOLDER_INVOLVEMENTS = `${T_BASE}/stakeholder-involvements`;
export const STAKEHOLDER_INVOLVEMENT_WITHDRAW = `${STAKEHOLDER_INVOLVEMENTS}/:stakeholderInvolvementId/withdraw`;
export const CHAMPION_CONSTRAINTS = `${T_BASE}/champion-constraints`;
export const CHAMPION_CONSTRAINT_RESOLVE = `${CHAMPION_CONSTRAINTS}/:championConstraintId/resolve`;

export const JSON_BODY = ["application/json"] as const;
export const ADOPTION_EDIT = "adoption.edit" as const;
export const CHAMPION_CONSTRAINT_RAISE = "champion_constraint.raise" as const;
export const DECISION_EDIT = "decision.edit" as const;

// ------------------------------------------------------------------------------------------------ problems (§10)

/** A 422 business rule with one error at `pointer` (code = i18n key, detail = the exact English text). */
export const adoptionRule = (code: string, detail: string, pointer = "") =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

const adoptionForbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

export const GROUP_ARCHIVED = () =>
  adoptionRule("stakeholder_group.archived", "This stakeholder group is archived and can no longer be changed.");
const NAME_TAKEN = () =>
  problems.duplicate(
    "stakeholder_group.name_taken",
    "A stakeholder group with this name already exists in this transformation.",
  );
const KPI_INVALID = () =>
  adoptionRule(
    "stakeholder_group.kpi_invalid",
    "The adoption KPI must be a KPI of this transformation.",
    "/adoptionKpiDefinitionId",
  );
const CHAMPION_EXISTS = () =>
  problems.duplicate("stakeholder_champion.exists", "This person is already a champion of this group.");
const TARGET_INVALID = (pointer: string) =>
  adoptionRule(
    "stakeholder_involvement.target_invalid",
    "Involvement is recorded on a design workshop or a T04 design decision of this transformation.",
    pointer,
  );
const ALREADY_WITHDRAWN = () =>
  adoptionRule("stakeholder_involvement.already_withdrawn", "This involvement record is already withdrawn.");
const NOT_CHAMPION = () =>
  adoptionForbidden(
    "champion_constraint.not_champion",
    "Only an active champion of this group can raise a constraint.",
  );
const DECISION_INVALID = () =>
  adoptionRule(
    "champion_constraint.decision_invalid",
    "A constraint links to a T04 design decision of this transformation.",
    "/decisionId",
  );
const CONSTRAINT_FINAL = (status: string) =>
  adoptionRule("champion_constraint.final", `This constraint is ${status} and can no longer be changed.`);
const NOT_RESOLVABLE = () =>
  adoptionForbidden(
    "champion_constraint.not_resolvable_by_caller",
    "Only a decision editor can address this constraint, and only its champion can withdraw it.",
  );

/** The exact ADR-0033 §10 text of a closed-list error the shared enums flag by code (S-11). */
function t13FieldError(e: FieldError): FieldError {
  if (e.message === STAKEHOLDER_STANCE_INVALID_CODE)
    return {
      pointer: e.pointer,
      code: STAKEHOLDER_STANCE_INVALID_CODE,
      message: "Current stance must be Support, Neutral or Resist.",
    };
  if (e.message === STAKEHOLDER_IMPACT_INVALID_CODE)
    return {
      pointer: e.pointer,
      code: STAKEHOLDER_IMPACT_INVALID_CODE,
      message: `${e.pointer === "/influence" ? "Influence" : "Impact"} must be H, M or L.`,
    };
  if (e.message === STAKEHOLDER_INTERVENTION_INVALID_CODE)
    return {
      pointer: e.pointer,
      code: STAKEHOLDER_INTERVENTION_INVALID_CODE,
      message: "Intervention must be Comms, Training, Involvement or Incentive.",
    };
  return e;
}

/**
 * A T13 body (400 with pointers): a value outside the closed B0107 lists is its ADR-0033 §10 code with the exact text
 * (e.g. a 'Hostile' stance is `stakeholder_group.stance_invalid` at `/currentStance`), before any write.
 */
export function parseT13Body<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  try {
    return parseBody(schema, body);
  } catch (err) {
    if (!(err instanceof HttpProblem) || err.status !== 400 || err.errors === undefined) throw err;
    throw problems.validation(err.errors.map(t13FieldError));
  }
}

// ------------------------------------------------------------------------------------------------ write gate

/**
 * The write gate of a slice F mutation. First the read gate on the request's principal: a caller who cannot read the
 * transformation (an ADM-only user, an outsider) gets 404 (ADR-0006; ADR-0033 §9). Then `permission`, re-checked at
 * commit time on the reloaded grants (S-4): AUD, or a right revoked meanwhile, is 403.
 */
export async function openAdoptionWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission = ADOPTION_EDIT,
): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });
}

/** SG-01 / AI-01 from record_code_counter; a concurrent allocation serialises on the counter row. */
export async function nextAdoptionCode(tx: Tx, transformationId: string, prefix: "SG" | "AI"): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, ${prefix}, 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `${prefix}-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/**
 * A stakeholder group named in a request body, locked FOR SHARE (a concurrent archive waits): 422 validation.reference
 * at `pointer` when it is not a group of the transformation, 422 stakeholder_group.archived when archived.
 */
export async function lockActiveGroupRef(
  tx: Tx,
  transformationId: string,
  groupId: string,
  pointer: string,
): Promise<StakeholderGroupRow> {
  const group = await tx
    .selectFrom("stakeholder_group")
    .selectAll()
    .where("id", "=", groupId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!group)
    throw adoptionRule("validation.reference", "The linked record does not exist in this transformation.", pointer);
  if (group.status === "archived") throw GROUP_ARCHIVED();
  return group;
}

// ------------------------------------------------------------------------------------------------ params

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const groupParams = z.strictObject({ transformationId: z.uuid(), stakeholderGroupId: z.uuid() });
const championParams = z.strictObject({
  transformationId: z.uuid(),
  stakeholderGroupId: z.uuid(),
  stakeholderChampionId: z.uuid(),
});
const involvementParams = z.strictObject({ transformationId: z.uuid(), stakeholderInvolvementId: z.uuid() });
const constraintParams = z.strictObject({ transformationId: z.uuid(), championConstraintId: z.uuid() });

export function parseTransformationParam(params: unknown): string {
  return parse(transformationParams, params, "params").transformationId;
}

// ------------------------------------------------------------------------------------------------ presentation

const OPEN_INTERVENTION = ["planned", "in_progress"] as const;

interface GroupCounts {
  readonly championCount: number;
  readonly openInterventionCount: number;
  readonly openChampionConstraintCount: number;
}

/** Active champions, open interventions and open constraints per group (one query each). */
async function countsOf(db: DbOrTx, groupIds: readonly string[]): Promise<Map<string, GroupCounts>> {
  const out = new Map<string, GroupCounts>(
    groupIds.map((id) => [id, { championCount: 0, openInterventionCount: 0, openChampionConstraintCount: 0 }]),
  );
  if (groupIds.length === 0) return out;
  const ids = [...groupIds];
  const champions = await db
    .selectFrom("stakeholder_champion")
    .select((eb) => ["stakeholder_group_id", eb.fn.countAll<string>().as("n")])
    .where("stakeholder_group_id", "in", ids)
    .where("status", "=", "active")
    .groupBy("stakeholder_group_id")
    .execute();
  const interventions = await db
    .selectFrom("adoption_intervention")
    .select((eb) => ["stakeholder_group_id", eb.fn.countAll<string>().as("n")])
    .where("stakeholder_group_id", "in", ids)
    .where("status", "in", [...OPEN_INTERVENTION])
    .groupBy("stakeholder_group_id")
    .execute();
  const constraints = await db
    .selectFrom("champion_constraint")
    .select((eb) => ["stakeholder_group_id", eb.fn.countAll<string>().as("n")])
    .where("stakeholder_group_id", "in", ids)
    .where("status", "=", "open")
    .groupBy("stakeholder_group_id")
    .execute();
  const n = (rows: readonly { stakeholder_group_id: string | null; n: string }[], id: string) =>
    Number(rows.find((r) => r.stakeholder_group_id === id)?.n ?? 0);
  for (const id of groupIds)
    out.set(id, {
      championCount: n(champions, id),
      openInterventionCount: n(interventions, id),
      openChampionConstraintCount: n(constraints, id),
    });
  return out;
}

function toStakeholderGroup(r: StakeholderGroupRow, c: GroupCounts): StakeholderGroup {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    name: r.name,
    description: r.description,
    influence: r.influence as StakeholderGroup["influence"],
    impact: r.impact as StakeholderGroup["impact"],
    currentStance: r.current_stance as StakeholderGroup["currentStance"],
    requiredBehavior: r.required_behavior,
    interventionTypes: r.intervention_types as StakeholderGroup["interventionTypes"],
    interventionPlan: r.intervention_plan,
    ownerUserId: r.owner_user_id,
    adoptionKpiDefinitionId: r.adoption_kpi_definition_id,
    headcount: r.headcount,
    championCount: c.championCount,
    openInterventionCount: c.openInterventionCount,
    status: r.status as StakeholderGroup["status"],
    archivedAt: isoOrNull(r.archived_at),
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export async function presentGroups(db: DbOrTx, rows: readonly StakeholderGroupRow[]): Promise<StakeholderGroup[]> {
  const counts = await countsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toStakeholderGroup(r, counts.get(r.id)!));
}

async function presentGroup(db: DbOrTx, transformationId: string, id: string): Promise<StakeholderGroup> {
  const row = await db
    .selectFrom("stakeholder_group")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return (await presentGroups(db, [row]))[0]!;
}

function toChampion(r: ChampionRow): StakeholderChampion {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    stakeholderGroupId: r.stakeholder_group_id,
    userId: r.user_id,
    note: r.note,
    status: r.status as StakeholderChampion["status"],
    removedAt: isoOrNull(r.removed_at),
    removedBy: r.removed_by,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** `withdrawn`: a withdrawal row names this original, or the row is itself a withdrawal. */
async function presentInvolvements(db: DbOrTx, rows: readonly InvolvementRow[]): Promise<StakeholderInvolvement[]> {
  const originals = rows.filter((r) => r.withdraws_involvement_id === null).map((r) => r.id);
  const withdrawn = new Set(
    originals.length === 0
      ? []
      : (
          await db
            .selectFrom("stakeholder_involvement")
            .select("withdraws_involvement_id")
            .where("withdraws_involvement_id", "in", originals)
            .execute()
        ).map((r) => r.withdraws_involvement_id!),
  );
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    stakeholderGroupId: r.stakeholder_group_id,
    involvementKind: r.involvement_kind as StakeholderInvolvement["involvementKind"],
    workshopId: r.workshop_id,
    decisionId: r.decision_id,
    note: r.note,
    withdrawsInvolvementId: r.withdraws_involvement_id,
    withdrawn: r.withdraws_involvement_id !== null || withdrawn.has(r.id),
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  }));
}

async function presentConstraints(db: DbOrTx, rows: readonly ConstraintRow[]): Promise<ChampionConstraint[]> {
  const decisionIds = [...new Set(rows.map((r) => r.decision_id))];
  const codes = new Map(
    decisionIds.length === 0
      ? []
      : (await db.selectFrom("decision").select(["id", "code"]).where("id", "in", decisionIds).execute()).map(
          (d) => [d.id, d.code] as const,
        ),
  );
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    championId: r.champion_id,
    stakeholderGroupId: r.stakeholder_group_id,
    decisionId: r.decision_id,
    decisionCode: codes.get(r.decision_id) ?? "",
    constraintText: r.constraint_text,
    status: r.status as ChampionConstraint["status"],
    responseText: r.response_text,
    resolvedAt: isoOrNull(r.resolved_at),
    resolvedBy: r.resolved_by,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  }));
}

// ------------------------------------------------------------------------------------------------ stakeholder groups

export const STAKEHOLDER_GROUP_AUDIT_FIELDS = [
  "code",
  "name",
  "description",
  "influence",
  "impact",
  "current_stance",
  "required_behavior",
  "intervention_types",
  "intervention_plan",
  "owner_user_id",
  "adoption_kpi_definition_id",
  "headcount",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof StakeholderGroupRow & string)[];

/** The T13 "Adoption KPI" must be a KPI of the same transformation (422 stakeholder_group.kpi_invalid). */
async function assertGroupKpi(tx: Tx, transformationId: string, kpiId: string | null | undefined): Promise<void> {
  if (kpiId === undefined || kpiId === null) return;
  const kpi = await tx
    .selectFrom("kpi_definition")
    .select("id")
    .where("id", "=", kpiId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!kpi) throw KPI_INVALID();
}

/** One active group per name in a transformation (case-insensitive; the unique index is the last line). */
async function assertNameFree(tx: Tx, transformationId: string, name: string, exceptId: string | null): Promise<void> {
  let q = tx
    .selectFrom("stakeholder_group")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .where(sql<boolean>`lower(name) = lower(${name})`);
  if (exceptId !== null) q = q.where("id", "<>", exceptId);
  if (await q.executeTakeFirst()) throw NAME_TAKEN();
}

async function createGroup(tx: Tx, request: FastifyRequest): Promise<StakeholderGroupRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const body = parseT13Body(stakeholderGroupCreate, request.body);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await assertGroupKpi(tx, transformationId, body.adoptionKpiDefinitionId);
  await assertNameFree(tx, transformationId, body.name, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("stakeholder_group")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextAdoptionCode(tx, transformationId, "SG"),
      name: body.name,
      description: body.description ?? null,
      influence: body.influence ?? null,
      impact: body.impact,
      current_stance: body.currentStance,
      required_behavior: body.requiredBehavior,
      intervention_types: body.interventionTypes,
      intervention_plan: body.interventionPlan ?? null,
      owner_user_id: body.ownerUserId,
      adoption_kpi_definition_id: body.adoptionKpiDefinitionId ?? null,
      headcount: body.headcount ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_group.create",
    recordType: "stakeholder_group",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as StakeholderGroupRow, row, [...STAKEHOLDER_GROUP_AUDIT_FIELDS]),
  });
  return row;
}

async function lockGroup(tx: Tx, transformationId: string, id: string): Promise<StakeholderGroupRow> {
  const row = await tx
    .selectFrom("stakeholder_group")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function updateGroup(tx: Tx, request: FastifyRequest): Promise<StakeholderGroupRow> {
  const { transformationId, stakeholderGroupId } = parse(groupParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const current = await lockGroup(tx, transformationId, stakeholderGroupId);
  const body = parseT13Body(stakeholderGroupUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw GROUP_ARCHIVED();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await assertGroupKpi(tx, transformationId, body.adoptionKpiDefinitionId);
  if (body.name !== undefined) await assertNameFree(tx, transformationId, body.name, current.id);
  const updated = await tx
    .updateTable("stakeholder_group")
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.influence !== undefined ? { influence: body.influence } : {}),
      ...(body.impact !== undefined ? { impact: body.impact } : {}),
      ...(body.currentStance !== undefined ? { current_stance: body.currentStance } : {}),
      ...(body.requiredBehavior !== undefined ? { required_behavior: body.requiredBehavior } : {}),
      ...(body.interventionTypes !== undefined ? { intervention_types: body.interventionTypes } : {}),
      ...(body.interventionPlan !== undefined ? { intervention_plan: body.interventionPlan } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.adoptionKpiDefinitionId !== undefined
        ? { adoption_kpi_definition_id: body.adoptionKpiDefinitionId }
        : {}),
      ...(body.headcount !== undefined ? { headcount: body.headcount } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_group.update",
    recordType: "stakeholder_group",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...STAKEHOLDER_GROUP_AUDIT_FIELDS]),
  });
  return updated;
}

async function archiveGroup(tx: Tx, request: FastifyRequest): Promise<StakeholderGroupRow> {
  const { transformationId, stakeholderGroupId } = parse(groupParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const current = await lockGroup(tx, transformationId, stakeholderGroupId);
  const { reason } = parseBody(adoptionReason, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw GROUP_ARCHIVED();
  const updated = await tx
    .updateTable("stakeholder_group")
    .set({
      status: "archived",
      archived_at: sql<Date>`now()`,
      archived_by: ctx.userId,
      archive_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_group.archive",
    recordType: "stakeholder_group",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...STAKEHOLDER_GROUP_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ champions

const CHAMPION_AUDIT_FIELDS = [
  "stakeholder_group_id",
  "user_id",
  "note",
  "status",
] as const satisfies readonly (keyof ChampionRow & string)[];

async function addChampion(tx: Tx, request: FastifyRequest): Promise<ChampionRow> {
  const { transformationId, stakeholderGroupId } = parse(groupParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const group = await tx
    .selectFrom("stakeholder_group")
    .select(["id", "status"])
    .where("id", "=", stakeholderGroupId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!group) throw problems.notFound();
  const body = parseBody(stakeholderChampionCreate, request.body);
  if (group.status === "archived") throw GROUP_ARCHIVED();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.userId, pointer: "/userId" }]);
  const existing = await tx
    .selectFrom("stakeholder_champion")
    .select("id")
    .where("stakeholder_group_id", "=", group.id)
    .where("user_id", "=", body.userId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) throw CHAMPION_EXISTS();
  const id = uuidv7();
  const row = await tx
    .insertInto("stakeholder_champion")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      stakeholder_group_id: group.id,
      user_id: body.userId,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_champion.create",
    recordType: "stakeholder_champion",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as ChampionRow, row, [...CHAMPION_AUDIT_FIELDS]),
  });
  return row;
}

async function removeChampion(tx: Tx, request: FastifyRequest): Promise<ChampionRow> {
  const { transformationId, stakeholderGroupId, stakeholderChampionId } = parse(
    championParams,
    request.params,
    "params",
  );
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const current = await tx
    .selectFrom("stakeholder_champion")
    .selectAll()
    .where("id", "=", stakeholderChampionId)
    .where("stakeholder_group_id", "=", stakeholderGroupId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "removed") throw problems.invalidTransition("This champion is already removed.");
  const updated = await tx
    .updateTable("stakeholder_champion")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_champion.remove",
    recordType: "stakeholder_champion",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...CHAMPION_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ involvement

const INVOLVEMENT_AUDIT_FIELDS = [
  "stakeholder_group_id",
  "involvement_kind",
  "workshop_id",
  "decision_id",
  "note",
  "withdraws_involvement_id",
] as const satisfies readonly (keyof InvolvementRow & string)[];

async function createInvolvement(tx: Tx, request: FastifyRequest): Promise<InvolvementRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const body = parseBody(stakeholderInvolvementCreate, request.body);
  const group = await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId");
  if (body.workshopId === undefined && body.decisionId === undefined) throw TARGET_INVALID("");
  if (body.workshopId !== undefined && body.decisionId !== undefined) throw TARGET_INVALID("/decisionId");
  if (body.workshopId !== undefined) {
    const ws = await tx
      .selectFrom("tom_workshop")
      .select("id")
      .where("id", "=", body.workshopId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!ws) throw TARGET_INVALID("/workshopId");
  } else {
    const d = await tx
      .selectFrom("decision")
      .select("id")
      .where("id", "=", body.decisionId!)
      .where("transformation_id", "=", transformationId)
      .where("kind", "=", "design")
      .executeTakeFirst();
    if (!d) throw TARGET_INVALID("/decisionId");
  }
  const id = uuidv7();
  const row = await tx
    .insertInto("stakeholder_involvement")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      stakeholder_group_id: group.id,
      involvement_kind: body.workshopId !== undefined ? "workshop" : "decision",
      workshop_id: body.workshopId ?? null,
      decision_id: body.decisionId ?? null,
      note: body.note ?? null,
      created_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_involvement.create",
    recordType: "stakeholder_involvement",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    changes: diffFields({} as InvolvementRow, row, [...INVOLVEMENT_AUDIT_FIELDS]),
  });
  return row;
}

/**
 * Appends the withdrawal of an involvement row (the table is append-only; ADR-0033 §7). One withdrawal per original:
 * checked here, and held by the unique index stakeholder_involvement_withdraws_key under concurrency.
 */
async function withdrawInvolvement(tx: Tx, request: FastifyRequest): Promise<InvolvementRow> {
  const { transformationId, stakeholderInvolvementId } = parse(involvementParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const original = await tx
    .selectFrom("stakeholder_involvement")
    .selectAll()
    .where("id", "=", stakeholderInvolvementId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!original) throw problems.notFound();
  const { reason } = parseBody(adoptionReason, request.body);
  if (original.withdraws_involvement_id !== null)
    throw problems.invalidTransition("A withdrawal record cannot itself be withdrawn.");
  const prior = await tx
    .selectFrom("stakeholder_involvement")
    .select("id")
    .where("withdraws_involvement_id", "=", original.id)
    .executeTakeFirst();
  if (prior) throw ALREADY_WITHDRAWN();
  const id = uuidv7();
  const row = await tx
    .insertInto("stakeholder_involvement")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      stakeholder_group_id: original.stakeholder_group_id,
      involvement_kind: original.involvement_kind,
      workshop_id: original.workshop_id,
      decision_id: original.decision_id,
      note: reason,
      withdraws_involvement_id: original.id,
      created_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "stakeholder_involvement.withdraw",
    recordType: "stakeholder_involvement",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    reason,
    changes: diffFields({} as InvolvementRow, row, [...INVOLVEMENT_AUDIT_FIELDS]),
  });
  return row;
}

// ------------------------------------------------------------------------------------------------ champion constraints

const CONSTRAINT_AUDIT_FIELDS = [
  "champion_id",
  "stakeholder_group_id",
  "decision_id",
  "constraint_text",
  "status",
  "response_text",
] as const satisfies readonly (keyof ConstraintRow & string)[];

/**
 * Raise a constraint (B0116; REQ-PB-073): champion_constraint.raise (commit time), then the caller must be the active
 * champion named (403 champion_constraint.not_champion; raised in person), then a T04 design decision of the same
 * transformation (422 champion_constraint.decision_invalid).
 */
async function createConstraint(tx: Tx, request: FastifyRequest): Promise<ConstraintRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId, CHAMPION_CONSTRAINT_RAISE);
  const body = parseBody(championConstraintCreate, request.body);
  const champion = await tx
    .selectFrom("stakeholder_champion")
    .select(["id", "user_id", "status", "stakeholder_group_id"])
    .where("id", "=", body.championId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!champion || champion.status !== "active" || champion.user_id !== ctx.userId) throw NOT_CHAMPION();
  const group = await tx
    .selectFrom("stakeholder_group")
    .select(["id", "status"])
    .where("id", "=", champion.stakeholder_group_id)
    .forShare()
    .executeTakeFirstOrThrow();
  if (group.status === "archived") throw GROUP_ARCHIVED();
  const decision = await tx
    .selectFrom("decision")
    .select("id")
    .where("id", "=", body.decisionId)
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "design")
    .executeTakeFirst();
  if (!decision) throw DECISION_INVALID();
  const id = uuidv7();
  const row = await tx
    .insertInto("champion_constraint")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      champion_id: champion.id,
      stakeholder_group_id: group.id,
      decision_id: decision.id,
      constraint_text: body.constraintText,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "champion_constraint.create",
    recordType: "champion_constraint",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as ConstraintRow, row, [...CONSTRAINT_AUDIT_FIELDS]),
  });
  return row;
}

/**
 * Address (decision.edit, the DG2 code for T04 decisions) or withdraw (the raising champion, who still holds
 * champion_constraint.raise) an open constraint; final afterwards. Anyone else: 403
 * champion_constraint.not_resolvable_by_caller. The rule is checked at commit time on the reloaded grants (S-4).
 */
async function resolveConstraint(tx: Tx, request: FastifyRequest): Promise<ConstraintRow> {
  const { transformationId, championConstraintId } = parse(constraintParams, request.params, "params");
  await requireTransformationRead(tx, principalOf(request), transformationId);
  const current = await tx
    .selectFrom("champion_constraint")
    .selectAll()
    .where("id", "=", championConstraintId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const body = parseBody(championConstraintResolve, request.body);
  let ctx: WriteContext;
  try {
    ctx = await openWrite(
      tx,
      request,
      transformationId,
      [{ permission: body.outcome === "addressed" ? DECISION_EDIT : CHAMPION_CONSTRAINT_RAISE }],
      null,
      { atCommit: true },
    );
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 403)
      throw err.denial === undefined ? NOT_RESOLVABLE() : NOT_RESOLVABLE().withDenial(err.denial);
    throw err;
  }
  if (body.outcome === "withdrawn" && current.created_by !== ctx.userId) throw NOT_RESOLVABLE();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "open") throw CONSTRAINT_FINAL(current.status);
  const updated = await tx
    .updateTable("champion_constraint")
    .set({
      status: body.outcome,
      response_text: body.outcome === "addressed" ? body.responseText! : null,
      resolved_at: sql<Date>`now()`,
      resolved_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: body.outcome === "addressed" ? "champion_constraint.address" : "champion_constraint.withdraw",
    recordType: "champion_constraint",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...CONSTRAINT_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const groupListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["active", "archived"]).optional(),
});
const involvementQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  stakeholderGroupId: z.uuid().optional(),
  decisionId: z.uuid().optional(),
});
const constraintQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  decisionId: z.uuid().optional(),
  stakeholderGroupId: z.uuid().optional(),
  status: z.enum(["open", "addressed", "withdrawn"]).optional(),
});

/** The group of a champions path, or 404 (never another transformation's group). */
async function requireGroup(db: DbOrTx, transformationId: string, groupId: string): Promise<void> {
  const g = await db
    .selectFrom("stakeholder_group")
    .select("id")
    .where("id", "=", groupId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!g) throw problems.notFound();
}

export function registerAdoptionRegisterRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: ADOPTION_EDIT }, consumes: JSON_BODY };
  const bodiless = { access: { permission: ADOPTION_EDIT } };
  const raise = { access: { permission: CHAMPION_CONSTRAINT_RAISE }, consumes: JSON_BODY };

  // ---- stakeholder groups (T13 rows)
  app.get(STAKEHOLDER_GROUPS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(groupListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "stakeholder_group", transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("stakeholder_group").selectAll().where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentGroups(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(STAKEHOLDER_GROUPS, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await createGroup(tx, request);
      return (await presentGroups(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(STAKEHOLDER_GROUP, { config: read }, async (request, reply) => {
    const { transformationId, stakeholderGroupId } = parse(groupParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentGroup(db, transformationId, stakeholderGroupId));
  });

  app.patch(STAKEHOLDER_GROUP, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await updateGroup(tx, request);
      return (await presentGroups(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(STAKEHOLDER_GROUP_ARCHIVE, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await archiveGroup(tx, request);
      return (await presentGroups(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 200, body);
  });

  // ---- Template 13 (B0106, B0107): the seven columns per active group, plus influence and counts.
  app.get(ADOPTION_PLAN, { config: read }, async (request): Promise<AdoptionPlan> => {
    const transformationId = parseTransformationParam(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const rows = await db
      .selectFrom("stakeholder_group as g")
      .leftJoin("kpi_definition as k", "k.id", "g.adoption_kpi_definition_id")
      .selectAll("g")
      .select("k.name as kpi_name")
      .where("g.transformation_id", "=", transformationId)
      .where("g.status", "=", "active")
      .orderBy("g.code")
      .execute();
    const counts = await countsOf(
      db,
      rows.map((r) => r.id),
    );
    return {
      transformationId,
      rows: rows.map((r) => {
        const c = counts.get(r.id)!;
        return {
          stakeholderGroupId: r.id,
          code: r.code,
          stakeholder: r.name,
          impact: r.impact as AdoptionPlan["rows"][number]["impact"],
          influence: r.influence as AdoptionPlan["rows"][number]["influence"],
          currentStance: r.current_stance as AdoptionPlan["rows"][number]["currentStance"],
          requiredBehavior: r.required_behavior,
          intervention: r.intervention_types as AdoptionPlan["rows"][number]["intervention"],
          ownerUserId: r.owner_user_id,
          adoptionKpiDefinitionId: r.adoption_kpi_definition_id,
          adoptionKpiName: r.kpi_name ?? null,
          championCount: c.championCount,
          openInterventionCount: c.openInterventionCount,
          openChampionConstraintCount: c.openChampionConstraintCount,
        };
      }),
    };
  });

  // ---- champions
  app.get(STAKEHOLDER_CHAMPIONS, { config: read }, async (request) => {
    const { transformationId, stakeholderGroupId } = parse(groupParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await requireGroup(db, transformationId, stakeholderGroupId);
    const hash = filterHash({ table: "stakeholder_champion", transformationId, stakeholderGroupId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("stakeholder_champion")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("stakeholder_group_id", "=", stakeholderGroupId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toChampion), nextCursor: page.nextCursor };
  });

  app.post(STAKEHOLDER_CHAMPIONS, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => addChampion(tx, request));
    return sendVersioned(reply, 201, toChampion(row), `${request.url.split("?")[0]!}/${row.id}`);
  });

  app.post(STAKEHOLDER_CHAMPION_REMOVE, { config: bodiless }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => removeChampion(tx, request));
    return sendVersioned(reply, 200, toChampion(row));
  });

  // ---- involvement in design (B0116)
  app.get(STAKEHOLDER_INVOLVEMENTS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(involvementQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "stakeholder_involvement",
      transformationId,
      stakeholderGroupId: query.stakeholderGroupId ?? null,
      decisionId: query.decisionId ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("stakeholder_involvement").selectAll().where("transformation_id", "=", transformationId);
    if (query.stakeholderGroupId !== undefined) q = q.where("stakeholder_group_id", "=", query.stakeholderGroupId);
    if (query.decisionId !== undefined) q = q.where("decision_id", "=", query.decisionId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentInvolvements(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(STAKEHOLDER_INVOLVEMENTS, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await createInvolvement(tx, request);
      return (await presentInvolvements(tx, [row]))[0]!;
    });
    return reply
      .code(201)
      .header("Location", `${request.url.split("?")[0]!}/${body.id}`)
      .send(body);
  });

  app.post(STAKEHOLDER_INVOLVEMENT_WITHDRAW, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await withdrawInvolvement(tx, request);
      return (await presentInvolvements(tx, [row]))[0]!;
    });
    return reply.code(201).send(body);
  });

  // ---- champion constraints (REQ-PB-073: "visible on that decision" through ?decisionId=)
  app.get(CHAMPION_CONSTRAINTS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(constraintQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "champion_constraint",
      transformationId,
      decisionId: query.decisionId ?? null,
      stakeholderGroupId: query.stakeholderGroupId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("champion_constraint").selectAll().where("transformation_id", "=", transformationId);
    if (query.decisionId !== undefined) q = q.where("decision_id", "=", query.decisionId);
    if (query.stakeholderGroupId !== undefined) q = q.where("stakeholder_group_id", "=", query.stakeholderGroupId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentConstraints(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(CHAMPION_CONSTRAINTS, { config: raise }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await createConstraint(tx, request);
      return (await presentConstraints(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.post(CHAMPION_CONSTRAINT_RESOLVE, { config: raise }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await resolveConstraint(tx, request);
      return (await presentConstraints(tx, [row]))[0]!;
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${STAKEHOLDER_GROUPS}`,
    `POST ${STAKEHOLDER_GROUPS}`,
    `GET ${STAKEHOLDER_GROUP}`,
    `PATCH ${STAKEHOLDER_GROUP}`,
    `POST ${STAKEHOLDER_GROUP_ARCHIVE}`,
    `GET ${ADOPTION_PLAN}`,
    `GET ${STAKEHOLDER_CHAMPIONS}`,
    `POST ${STAKEHOLDER_CHAMPIONS}`,
    `POST ${STAKEHOLDER_CHAMPION_REMOVE}`,
    `GET ${STAKEHOLDER_INVOLVEMENTS}`,
    `POST ${STAKEHOLDER_INVOLVEMENTS}`,
    `POST ${STAKEHOLDER_INVOLVEMENT_WITHDRAW}`,
    `GET ${CHAMPION_CONSTRAINTS}`,
    `POST ${CHAMPION_CONSTRAINTS}`,
    `POST ${CHAMPION_CONSTRAINT_RESOLVE}`,
  ];
}
