// Methodology migrations of a pinned transformation (OpenAPI tag "methodology-migrations"; ADR-0040 §1-§4, §6, §8;
// REQ-S06-008, REQ-S06-010; D-142 Q9; p5-work-split §A.5; T-DG5-BE-C):
//   GET  /transformations/{id}/methodology-migrations                       listMethodologyMigrations    (methodology.read)
//   POST /transformations/{id}/methodology-migrations                       createMethodologyMigration   (methodology_migration.plan)
//   GET  /transformations/{id}/methodology-migrations/{migrationId}         getMethodologyMigration      (methodology.read)
//   POST .../{migrationId}/preview                                           previewMethodologyMigration  (methodology_migration.plan)
//   POST .../{migrationId}/submit                                            submitMethodologyMigration   (methodology_migration.plan)
//   POST .../{migrationId}/decision                                          decideMethodologyMigration   (methodology_migration.approve)
//   POST .../{migrationId}/execute                                           executeMethodologyMigration  (methodology_migration.execute)
//   POST .../{migrationId}/withdraw                                          withdrawMethodologyMigration (methodology_migration.plan)
//   GET  /transformations/{id}/gate-reapprovals                              listGateReapprovals          (reapproval.ts)
//
// Publishing a version moves no pin (ADR-0039 §3): an existing transformation keeps the version its pin names until a
// deliberate migration is planned (plan revision 1 at create; a new revision per preview, migration-plan.ts), submitted
// (a canonical approval of type `methodology_migration`, routed to the transformation's SP party by default; SoD
// requester_excluded), decided by a PERSON holding `methodology_migration.approve` (never the requester nor the
// submitter: 403 methodology_migration.self_approval), and executed (`methodology_migration.execute`, lock class
// `methodologyMigration` on the transformation): the pin moves (version + 1, last_migration_id, one history row),
// each `reapproval` item becomes a gate re-approval with its tasks (reapproval.ts), and the migration becomes
// `executed`. Execution
// updates no business record, submission, snapshot or decision, and no row of another transformation.
//
// Every write: commit-time authorization (grants reloaded inside the transaction), Zod validation, If-Match on the
// migration (428 missing, 409 stale; a create is version 1), one audit event per row written in the same
// transaction, no remote I/O. The API refuses first with the ADR-0040 §8 codes; the 0063 guards refuse the same.
// `methodology` imports no business module: the approval service and the work-item services come through ports the
// composition root wires (`wireMethodologyMigrations`, the sustainment/kpi precedent); unwired, a write fails closed.
// Approving a migration is a BUSINESS approval inside the product, made by a person; nothing relates to DG0-DG7.
import { sql, type ApprovalRow, type DbOrTx, type MethodologyMigrationTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  methodologyMigrationCreate,
  methodologyMigrationDecision,
  methodologyMigrationPreviewRequest,
  truncateText,
  type ConfigKind,
  type MethodologyMigration,
  type MethodologyMigrationItem,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  authorize,
  auditContextOf,
  denialOf,
  principalOf,
  refreshPrincipal,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { loadPin, resolvePinnedVersion } from "./config-resolver.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { buildMigrationPlan, inputKeysOf, type Plan, type PlanItem } from "./migration-plan.ts";
import { createGateReapprovals, registerGateReapprovalRoutes, type ReapprovalTaskPorts } from "./reapproval.ts";

type MigrationRow = Selectable<MethodologyMigrationTable>;

export const METHODOLOGY_MIGRATION_APPROVAL_TYPE = "methodology_migration";
/** The party a migration approval is routed to by default (ADR-0040 §4; D-143 point 2). */
export const MIGRATION_APPROVER_PARTY = "SP";
const JSON_BODY = ["application/json"] as const;
const MIGRATIONS = "/api/v1/transformations/:transformationId/methodology-migrations";
const ONE = `${MIGRATIONS}/:migrationId`;
const OPEN = ["draft", "submitted", "changes_requested", "approved"] as const;
const WITHDRAW_REASON = "The methodology migration was withdrawn.";

// ------------------------------------------------------------------------------------------------ refusals (§8)

/** The ADR-0040 §8 refusals with their exact English texts (p5-work-split §2 rule 15). */
export const migrationRefusals = {
  openExists: () =>
    problems.duplicate(
      "methodology_migration.open_exists",
      "This transformation already has an open migration for this configuration.",
    ),
  targetInvalid: () =>
    problems.businessRule(
      "methodology_migration.target_invalid",
      "The target must be a published version of the same configuration, other than the pinned one.",
    ),
  inputsRequired: () =>
    problems.businessRule(
      "methodology_migration.inputs_required",
      "Provide a value or mapping for every new required field before submitting.",
    ),
  selfApproval: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "methodology_migration.self_approval",
      title: "Forbidden",
      detail: "You cannot approve a migration you requested.",
    }),
  notApproved: () =>
    problems.businessRule("methodology_migration.not_approved", "Only an approved migration can be executed."),
  pinMoved: (currentVersion: number) =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "methodology_migration.pin_moved",
      title: "Version conflict",
      detail: "The transformation's pinned version changed after this migration was planned. Plan it again.",
      currentVersion,
    }),
  notOpen: () => problems.businessRule("methodology_migration.not_open", "This migration is no longer open."),
} as const;

// ------------------------------------------------------------------------------------------------ ports

/** The approval request as workflows' `requestApprovalInTx` takes it (methodology cannot import workflows). */
export interface MigrationApprovalRequest {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly scope: ResolvedTarget & { transformationId: string };
  readonly approvalType: string;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly title: string;
  readonly requestNote: string | null;
  readonly assigneePartyCode: string;
  readonly decisionRightId: string | null;
  readonly slaType: null;
  readonly urgentReason: null;
  readonly due: null;
}

/** workflows' in-transaction approval services, handed over at subject registration (`bindServices`). */
export interface MigrationApprovalServices {
  readonly resubmit: (
    tx: Tx,
    audit: AuditContext,
    input: { readonly approvalId: string; readonly subjectVersion: number; readonly requestNote?: string | null },
  ) => Promise<ApprovalRow>;
  readonly withdraw: (
    tx: Tx,
    audit: AuditContext,
    input: { readonly approvalId: string; readonly reason: string },
  ) => Promise<ApprovalRow>;
  readonly decide: (
    tx: Tx,
    audit: AuditContext,
    input: {
      readonly approvalId: string;
      readonly principal: Principal;
      readonly outcome: "approve" | "reject" | "request_changes";
      readonly rationale: string;
      readonly subjectVersion: number;
    },
  ) => Promise<ApprovalRow>;
}

/** The subject provider this module registers for its approval type (workflows' ApprovalSubjectProvider shape). */
export interface MigrationApprovalSubject {
  readonly resubmitThroughSubject: true;
  readonly decideThroughSubject: true;
  readonly bindServices: (services: MigrationApprovalServices) => void;
}

export interface MethodologyMigrationPorts extends ReapprovalTaskPorts {
  readonly requestApproval: (tx: Tx, audit: AuditContext, input: MigrationApprovalRequest) => Promise<ApprovalRow>;
  readonly registerSubject: (approvalType: string, provider: MigrationApprovalSubject) => void;
}

let wired: {
  requestApproval: MethodologyMigrationPorts["requestApproval"];
  tasks: ReapprovalTaskPorts;
} | null = null;
let services: MigrationApprovalServices | null = null;

// The subject version of a migration's approval is the migration row's `version` (the 0031 default,
// p4_approval_subject_version, which the database re-checks at request and decision time): the approval names the
// migration as submitted, the plan is frozen while it is submitted (0063 methodology_migration_plan_frozen), and any
// later change of the row makes an undecided approval stale. `approval_id` is therefore linked by the deciding (or
// withdrawing) update, and until then read from the approval itself (`approvalOf`).

/**
 * Wired once by the composition root (server.ts) with workflows' approval service and tasks' work-item services. It
 * registers the `methodology_migration` subject: decided and resubmitted through this module's own routes
 * (`decideThroughSubject`, `resubmitThroughSubject`), so the generic approval routes refuse it and write nothing.
 */
export function wireMethodologyMigrations(ports: MethodologyMigrationPorts): void {
  wired = {
    requestApproval: ports.requestApproval,
    tasks: { createWorkItem: ports.createWorkItem, closeWorkItems: ports.closeWorkItems },
  };
  ports.registerSubject(METHODOLOGY_MIGRATION_APPROVAL_TYPE, {
    resubmitThroughSubject: true,
    decideThroughSubject: true,
    bindServices: (s) => {
      services = s;
    },
  });
}

function ports() {
  if (wired === null || services === null) throw problems.internal();
  return { ...wired, services };
}

// ------------------------------------------------------------------------------------------------ authorization

/** An ORGANIZATION-level grant of `permission` in the organization (ADM_METHOD's; it does not inherit downward). */
function orgLevel(principal: Principal, permission: Permission, organizationId: string): boolean {
  return principal.grants.some(
    (g) =>
      g.permissions.has(permission) &&
      g.scopeType === "organization" &&
      g.scopeId === organizationId &&
      g.organizationId === organizationId,
  );
}

/**
 * The scope check of a migration operation on a transformation (ADR-0040 §6; A.10 item 1: per transformation): the
 * permission on the transformation, or an organization-level grant of it in the transformation's organization
 * (ADM_METHOD; D-143 point 6). A caller who cannot see the transformation gets 404 (existence never disclosed); one
 * who can (e.g. AUD, TL) but lacks the permission gets 403 with its denial.
 */
async function requireMigrationPermission(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  permission: Permission,
): Promise<ResolvedTarget & { transformationId: string }> {
  const d = await authorize(db, principal, permission, { type: "transformation", id: transformationId });
  if (d.target === null) throw problems.notFound();
  const target = { ...d.target, transformationId };
  if (d.allowed || orgLevel(principal, permission, d.target.organizationId)) return target;
  const visible =
    (await authorize(db, principal, "transformation.read", d.target)).allowed ||
    orgLevel(principal, "methodology.read", d.target.organizationId);
  if (!visible) throw problems.notFound().withDenial(denialOf(permission, d.target));
  throw problems.forbidden().withDenial(denialOf(permission, d.target));
}

/** Commit-time authorization of a write: the grants are reloaded inside the write transaction. */
async function requireMigrationWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission,
): Promise<{
  principal: Principal;
  userId: string;
  target: ResolvedTarget & { transformationId: string };
}> {
  principalOf(request);
  const principal = await refreshPrincipal(tx, request);
  const target = await requireMigrationPermission(tx, principal, transformationId, permission);
  if (principal.userId === null) throw problems.forbidden();
  return { principal, userId: principal.userId, target };
}

// ------------------------------------------------------------------------------------------------ presenter

async function itemsOf(db: DbOrTx, migrationId: string, planRevision: number): Promise<MethodologyMigrationItem[]> {
  const rows = await db
    .selectFrom("methodology_migration_item")
    .selectAll()
    .where("migration_id", "=", migrationId)
    .where("plan_revision", "=", planRevision)
    .orderBy("ordinal")
    .execute();
  return rows.map((r) => ({
    planRevision: r.plan_revision,
    ordinal: r.ordinal,
    itemKind: r.item_kind as MethodologyMigrationItem["itemKind"],
    elementType: r.element_type,
    stableKey: r.stable_key,
    recordType: r.record_type,
    recordId: r.record_id,
    gateCode: r.gate_code,
    resolution: r.resolution as MethodologyMigrationItem["resolution"],
    detail: r.detail as Record<string, unknown>,
  }));
}

/** The migration's approval: the linked one, else the newest approval requested for it (null before submission). */
async function approvalOf(db: DbOrTx, r: Pick<MigrationRow, "id" | "approval_id">): Promise<string | null> {
  if (r.approval_id !== null) return r.approval_id;
  const a = await db
    .selectFrom("approval")
    .select("id")
    .where("approval_type", "=", METHODOLOGY_MIGRATION_APPROVAL_TYPE)
    .where("subject_id", "=", r.id)
    .orderBy("id", "desc")
    .executeTakeFirst();
  return a?.id ?? null;
}

export async function toMethodologyMigration(db: DbOrTx, r: MigrationRow): Promise<MethodologyMigration> {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    configKind: r.config_kind as ConfigKind,
    fromVersionId: r.from_version_id,
    toVersionId: r.to_version_id,
    status: r.status as MethodologyMigration["status"],
    reason: r.reason,
    planRevision: r.plan_revision,
    planSha256: r.plan_sha256,
    planReady: r.plan_ready,
    items: await itemsOf(db, r.id, r.plan_revision),
    requestedBy: r.requested_by,
    submittedBy: r.submitted_by,
    submittedAt: isoOrNull(r.submitted_at),
    approvalId: await approvalOf(db, r),
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    executedBy: r.executed_by,
    executedAt: isoOrNull(r.executed_at),
    withdrawnAt: isoOrNull(r.withdrawn_at),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ helpers

/** Lock class `methodologyMigration` (ADVISORY_LOCK_CLASSES) on the transformation id (ADR-0016 §6 registry; ADR-0040 §4). */
async function lockTransformationMigrations(tx: Tx, transformationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.methodologyMigration}::int4, hashtext(${transformationId}::text))`.execute(
    tx,
  );
}

async function versionRow(db: DbOrTx, id: string): Promise<MethodologyVersionRow | undefined> {
  return db.selectFrom("methodology_version").selectAll().where("id", "=", id).executeTakeFirst();
}

/** The migration of the transformation, locked, with its If-Match checked; 404 when it belongs to another one. */
async function lockedMigration(
  tx: Tx,
  transformationId: string,
  migrationId: string,
  expected: number,
): Promise<MigrationRow> {
  const row = await tx
    .selectFrom("methodology_migration")
    .selectAll()
    .where("id", "=", migrationId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  if (row.version !== expected) throw problems.versionConflict(row.version);
  return row;
}

/** The pin must still name the migration's `from` version (else 409 pin_moved). Returns the pin's version. */
async function assertPinUnmoved(tx: Tx, m: MigrationRow): Promise<void> {
  const pin = await loadPin(tx, m.transformation_id, m.config_kind as ConfigKind);
  if (pin === undefined || pin.versionId !== m.from_version_id) throw migrationRefusals.pinMoved(pin?.version ?? 1);
}

/** Writes the items of one plan revision (append-only rows; the migration's audit event covers them). */
async function insertPlanItems(
  tx: Tx,
  m: { id: string; organization_id: string; transformation_id: string },
  revision: number,
  plan: Plan,
  by: string,
) {
  for (const [n, i] of plan.items.entries())
    await tx
      .insertInto("methodology_migration_item")
      .values({
        id: uuidv7(),
        organization_id: m.organization_id,
        transformation_id: m.transformation_id,
        migration_id: m.id,
        plan_revision: revision,
        ordinal: n + 1,
        item_kind: i.itemKind,
        element_type: i.elementType,
        stable_key: i.stableKey,
        record_type: i.recordType,
        record_id: i.recordId,
        gate_code: i.gateCode,
        resolution: i.resolution,
        detail: JSON.stringify(i.detail),
        created_by: by,
      })
      .execute();
}

/** The provided input values of a revision's items (carried into the next revision unless replaced). */
async function providedInputs(db: DbOrTx, m: MigrationRow): Promise<Map<string, unknown>> {
  const rows = await itemsOf(db, m.id, m.plan_revision);
  const out = new Map<string, unknown>();
  for (const r of rows) {
    if (r.itemKind !== "new_required_field" || r.resolution !== "provided" || r.stableKey === null) continue;
    out.set(r.stableKey, new Map(Object.entries(r.detail)).get("providedValue") ?? null);
  }
  return out;
}

/** Builds the next plan revision with `inputs`, writes its items and the migration row (version + 1), audited. */
async function replan(
  tx: Tx,
  audit: AuditContext,
  m: MigrationRow,
  inputs: ReadonlyMap<string, unknown>,
  by: string,
  action: string,
): Promise<{ row: MigrationRow; plan: Plan }> {
  const [from, to] = await Promise.all([versionRow(tx, m.from_version_id), versionRow(tx, m.to_version_id)]);
  if (from === undefined || to === undefined) throw problems.internal();
  const plan = await buildMigrationPlan(tx, { transformationId: m.transformation_id, from, to, inputs });
  const revision = m.plan_revision + 1;
  await insertPlanItems(tx, m, revision, plan, by);
  const row = await tx
    .updateTable("methodology_migration")
    .set({
      plan_revision: revision,
      plan_sha256: plan.sha256,
      plan_ready: plan.ready,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: by,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action,
    recordType: "methodology_migration",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId: m.transformation_id,
    priorVersion: m.version,
    newVersion: row.version,
    changes: {
      plan_revision: { from: m.plan_revision, to: revision },
      plan_sha256: { from: m.plan_sha256, to: plan.sha256 },
      plan_ready: { from: m.plan_ready, to: plan.ready },
      item_count: { from: null, to: plan.items.length },
    },
  });
  return { row, plan };
}

// ------------------------------------------------------------------------------------------------ writes

async function createMigration(tx: Tx, request: FastifyRequest, transformationId: string): Promise<MigrationRow> {
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.plan");
  const body = parseBody(methodologyMigrationCreate, request.body);
  await lockTransformationMigrations(tx, transformationId);
  const audit = auditContextOf(request);
  const kind = body.configKind;
  // The version the transformation uses now: its pin, else version 1 of the kind's default key (ADR-0039 §3).
  const current = await resolvePinnedVersion(tx, transformationId, kind);
  const to = await versionRow(tx, body.toVersionId);
  const from = current === null ? undefined : await versionRow(tx, current.versionId);
  if (
    from === undefined ||
    to === undefined ||
    to.config_kind !== kind ||
    to.key !== from.key ||
    to.status !== "published" ||
    to.id === from.id
  )
    throw migrationRefusals.targetInvalid();
  const open = await tx
    .selectFrom("methodology_migration")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("config_kind", "=", kind)
    .where("status", "in", [...OPEN])
    .executeTakeFirst();
  if (open !== undefined) throw migrationRefusals.openExists();
  const organizationId = actor.target.organizationId;
  // A kind without a pin resolves to version 1 of its default key; the migration moves a pin, so that resolution is
  // recorded as the transformation's pin first (pinning to the version it already uses changes nothing it reads).
  if ((await loadPin(tx, transformationId, kind)) === undefined) {
    const pinId = uuidv7();
    await tx
      .insertInto("transformation_config_pin")
      .values({
        id: pinId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kind,
        methodology_version_id: from.id,
        pinned_by: actor.userId,
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "transformation_config_pin.create",
      recordType: "transformation_config_pin",
      recordId: pinId,
      organizationId,
      transformationId,
      newVersion: 1,
      changes: { kind: { from: null, to: kind }, methodology_version_id: { from: null, to: from.id } },
    });
  }
  const plan = await buildMigrationPlan(tx, { transformationId, from, to, inputs: new Map() });
  const id = uuidv7();
  const row = await tx
    .insertInto("methodology_migration")
    .values({
      id,
      organization_id: organizationId,
      transformation_id: transformationId,
      config_kind: kind,
      from_version_id: from.id,
      to_version_id: to.id,
      reason: body.reason,
      plan_revision: 1,
      plan_sha256: plan.sha256,
      plan_ready: plan.ready,
      requested_by: actor.userId,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((err: unknown) => {
      const c = (err as { constraint?: string } | null)?.constraint;
      if (c === "methodology_migration_one_open_key") throw migrationRefusals.openExists();
      throw err;
    });
  await insertPlanItems(tx, row, 1, plan, actor.userId);
  await record(tx, audit, {
    action: "methodology_migration.create",
    recordType: "methodology_migration",
    recordId: id,
    organizationId,
    transformationId,
    newVersion: 1,
    reason: body.reason,
    changes: {
      config_kind: { from: null, to: kind },
      from_version_id: { from: null, to: from.id },
      to_version_id: { from: null, to: to.id },
      plan_revision: { from: null, to: 1 },
      plan_sha256: { from: null, to: plan.sha256 },
      plan_ready: { from: null, to: plan.ready },
      item_count: { from: null, to: plan.items.length },
    },
  });
  return row;
}

async function previewMigration(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  migrationId: string,
): Promise<MigrationRow> {
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.plan");
  const body = parseBody(methodologyMigrationPreviewRequest, request.body);
  const expected = requireIfMatch(request);
  await lockTransformationMigrations(tx, transformationId);
  const m = await lockedMigration(tx, transformationId, migrationId, expected);
  if (m.status !== "draft" && m.status !== "changes_requested") throw migrationRefusals.notOpen();
  await assertPinUnmoved(tx, m);
  // Every input names a new required field of the plan (400 otherwise; nothing written).
  const keys = inputKeysOf((await itemsOf(tx, m.id, m.plan_revision)) as unknown as PlanItem[]);
  const unknown = body.inputs.findIndex((i) => !keys.has(i.stableKey));
  if (unknown >= 0)
    throw problems.validation([
      {
        pointer: `/inputs/${unknown}/stableKey`,
        code: "validation.reference",
        message: "This input names no new required field of the plan.",
      },
    ]);
  const inputs = await providedInputs(tx, m);
  for (const i of body.inputs) inputs.set(i.stableKey, i.value ?? null);
  const { row } = await replan(tx, auditContextOf(request), m, inputs, actor.userId, "methodology_migration.preview");
  return row;
}

async function submitMigration(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  migrationId: string,
): Promise<MigrationRow> {
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.plan");
  const expected = requireIfMatch(request);
  const p = ports();
  await lockTransformationMigrations(tx, transformationId);
  const m = await lockedMigration(tx, transformationId, migrationId, expected);
  if (m.status !== "draft" && m.status !== "changes_requested") throw migrationRefusals.notOpen();
  await assertPinUnmoved(tx, m);
  const audit = auditContextOf(request);
  if (!m.plan_ready) throw migrationRefusals.inputsRequired();
  const updated = await tx
    .updateTable("methodology_migration")
    .set({
      status: "submitted",
      submitted_by: actor.userId,
      submitted_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_migration.submit",
    recordType: "methodology_migration",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: m.version,
    newVersion: updated.version,
    changes: { status: { from: m.status, to: "submitted" }, plan_revision: { from: null, to: m.plan_revision } },
  });
  if (m.status === "changes_requested" && m.approval_id !== null) {
    // Resubmission (ADR-0026 amendment A2): the same approval, round + 1, for the migration as submitted now.
    await p.services.resubmit(tx, audit, { approvalId: m.approval_id, subjectVersion: updated.version });
  } else {
    const [from, to] = await Promise.all([versionRow(tx, m.from_version_id), versionRow(tx, m.to_version_id)]);
    await p.requestApproval(tx, audit, {
      organizationId: m.organization_id,
      transformationId,
      scope: actor.target,
      approvalType: METHODOLOGY_MIGRATION_APPROVAL_TYPE,
      subjectId: m.id,
      subjectVersion: updated.version,
      title: truncateText(
        `Methodology migration (${m.config_kind}): version ${from?.version_no ?? "?"} to version ${to?.version_no ?? "?"}`,
        200,
      ),
      requestNote: truncateText(m.reason, 4000),
      assigneePartyCode: MIGRATION_APPROVER_PARTY,
      decisionRightId: null,
      slaType: null,
      urgentReason: null,
      due: null,
    });
  }
  return updated;
}

const DECIDED_STATUS = new Map([
  ["approve", "approved"],
  ["reject", "rejected"],
  ["request_changes", "changes_requested"],
] as const);

async function decideMigration(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  migrationId: string,
): Promise<MigrationRow> {
  // A business approval: the person holds methodology_migration.approve on the transformation (SP by default).
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.approve");
  const body = parseBody(methodologyMigrationDecision, request.body);
  const expected = requireIfMatch(request);
  const p = ports();
  await lockTransformationMigrations(tx, transformationId);
  const m = await lockedMigration(tx, transformationId, migrationId, expected);
  // Separation of duties (ADR-0040 §1, §4): never the requester nor the submitter (0063 CHECK; the approval's SoD).
  if (actor.userId === m.requested_by || actor.userId === m.submitted_by)
    throw migrationRefusals.selfApproval().withDenial(denialOf("methodology_migration.approve", actor.target));
  const approvalId = await approvalOf(tx, m);
  if (m.status !== "submitted" || approvalId === null) throw migrationRefusals.notOpen();
  const audit = auditContextOf(request);
  // The canonical approval decision first (the 0063 guard needs the person's matching approval_decision), for the
  // migration exactly as submitted (its row version; the database re-checks it).
  await p.services.decide(tx, audit, {
    approvalId,
    principal: actor.principal,
    outcome: body.outcome,
    rationale: body.rationale,
    subjectVersion: m.version,
  });
  const status = DECIDED_STATUS.get(body.outcome)!;
  const final = status !== "changes_requested";
  const updated = await tx
    .updateTable("methodology_migration")
    .set({
      status,
      approval_id: approvalId,
      ...(final ? { decided_by: actor.userId, decided_at: sql<Date>`now()` } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_migration.decide",
    recordType: "methodology_migration",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: m.version,
    newVersion: updated.version,
    reason: body.rationale,
    changes: {
      status: { from: m.status, to: status },
      approval_id: { from: m.approval_id, to: approvalId },
      ...(final ? { decided_by: { from: null, to: actor.userId } } : {}),
    },
  });
  return updated;
}

async function executeMigration(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  migrationId: string,
): Promise<MigrationRow> {
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.execute");
  const expected = requireIfMatch(request);
  const p = ports();
  await lockTransformationMigrations(tx, transformationId);
  const m = await lockedMigration(tx, transformationId, migrationId, expected);
  if (m.status !== "approved") throw migrationRefusals.notApproved();
  const pin = await tx
    .selectFrom("transformation_config_pin")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", m.config_kind)
    .forUpdate()
    .executeTakeFirst();
  if (pin === undefined || pin.methodology_version_id !== m.from_version_id)
    throw migrationRefusals.pinMoved(pin?.version ?? 1);
  const audit = auditContextOf(request);
  const by = actor.userId;
  // The pin moves (version + 1, last_migration_id) with its history row at the new version (0063 guards).
  const historyId = uuidv7();
  await tx
    .insertInto("transformation_config_pin_history")
    .values({
      id: historyId,
      organization_id: m.organization_id,
      transformation_id: transformationId,
      pin_id: pin.id,
      pin_version: pin.version + 1,
      kind: m.config_kind,
      from_version_id: m.from_version_id,
      to_version_id: m.to_version_id,
      migration_id: m.id,
      created_by: by,
    })
    .execute();
  const moved = await tx
    .updateTable("transformation_config_pin")
    .set({
      methodology_version_id: m.to_version_id,
      last_migration_id: m.id,
      pinned_at: sql<Date>`now()`,
      pinned_by: by,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: by,
    })
    .where("id", "=", pin.id)
    .where("version", "=", pin.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "transformation_config_pin.migrate",
    recordType: "transformation_config_pin",
    recordId: pin.id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: pin.version,
    newVersion: moved.version,
    changes: {
      methodology_version_id: { from: m.from_version_id, to: m.to_version_id },
      last_migration_id: { from: pin.last_migration_id, to: m.id },
      history_id: { from: null, to: historyId },
    },
  });
  // Each `reapproval` item of the approved plan becomes a gate re-approval with its tasks (reapproval.ts).
  const items = await itemsOf(tx, m.id, m.plan_revision);
  await createGateReapprovals(tx, audit, p.tasks, {
    organizationId: m.organization_id,
    transformationId,
    migrationId: m.id,
    target: actor.target,
    items: items
      .filter((i) => i.itemKind === "reapproval" && i.gateCode !== null)
      .map((i) => ({ gateCode: i.gateCode!, detail: i.detail })),
  });
  const updated = await tx
    .updateTable("methodology_migration")
    .set({
      status: "executed",
      executed_by: by,
      executed_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: by,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_migration.execute",
    recordType: "methodology_migration",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: m.version,
    newVersion: updated.version,
    changes: {
      status: { from: "approved", to: "executed" },
      pin_version: { from: pin.version, to: moved.version },
    },
  });
  return updated;
}

async function withdrawMigration(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  migrationId: string,
): Promise<MigrationRow> {
  const actor = await requireMigrationWrite(tx, request, transformationId, "methodology_migration.plan");
  const expected = requireIfMatch(request);
  await lockTransformationMigrations(tx, transformationId);
  const m = await lockedMigration(tx, transformationId, migrationId, expected);
  if (!(OPEN as readonly string[]).includes(m.status)) throw migrationRefusals.notOpen();
  const audit = auditContextOf(request);
  // An open approval is withdrawn too (its requester's action; an approved one is final and stays in history).
  const approvalId = m.status === "draft" ? null : await approvalOf(tx, m);
  if (approvalId !== null && (m.status === "submitted" || m.status === "changes_requested"))
    await ports().services.withdraw(tx, audit, { approvalId, reason: WITHDRAW_REASON });
  const updated = await tx
    .updateTable("methodology_migration")
    .set({
      status: "withdrawn",
      approval_id: approvalId,
      withdrawn_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_migration.withdraw",
    recordType: "methodology_migration",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: m.version,
    newVersion: updated.version,
    changes: { status: { from: m.status, to: "withdrawn" } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const tParams = z.strictObject({ transformationId: z.uuid() });
const mParams = z.strictObject({ transformationId: z.uuid(), migrationId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes (and listGateReapprovals) and returns them as "METHOD /path". */
export function registerMethodologyMigrationRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "methodology.read" as const } };
  const plan = { access: { permission: "methodology_migration.plan" as const } };
  const approve = { access: { permission: "methodology_migration.approve" as const } };
  const execute = { access: { permission: "methodology_migration.execute" as const } };
  const send = async (reply: FastifyReply, status: number, row: MigrationRow, location?: string) =>
    sendVersioned(reply, status, await toMethodologyMigration(db, row), location);

  app.get(MIGRATIONS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireMigrationPermission(db, principalOf(request), transformationId, "methodology.read");
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first: ids are UUIDv7 (time-ordered).
    let q = db.selectFrom("methodology_migration").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const items: MethodologyMigration[] = [];
    for (const r of page.items) items.push(await toMethodologyMigration(db, r));
    return { items, nextCursor: page.nextCursor };
  });

  app.post(MIGRATIONS, { config: { ...plan, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const row = await db.transaction().execute((tx) => createMigration(tx, request, transformationId));
    return send(reply, 201, row, `/api/v1/transformations/${transformationId}/methodology-migrations/${row.id}`);
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, migrationId } = parse(mParams, request.params, "params");
    await requireMigrationPermission(db, principalOf(request), transformationId, "methodology.read");
    const row = await db
      .selectFrom("methodology_migration")
      .selectAll()
      .where("id", "=", migrationId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (row === undefined) throw problems.notFound();
    return send(reply, 200, row);
  });

  const action = (
    suffix: string,
    config: { access: { permission: Permission } },
    consumes: boolean,
    fn: (tx: Tx, request: FastifyRequest, t: string, m: string) => Promise<MigrationRow>,
  ) => {
    app.post(
      `${ONE}/${suffix}`,
      { config: consumes ? { ...config, consumes: JSON_BODY } : config },
      async (request, reply) => {
        const { transformationId, migrationId } = parse(mParams, request.params, "params");
        const row = await db.transaction().execute((tx) => fn(tx, request, transformationId, migrationId));
        return send(reply, 200, row);
      },
    );
    return `POST ${ONE}/${suffix}`;
  };

  return [
    `GET ${MIGRATIONS}`,
    `POST ${MIGRATIONS}`,
    `GET ${ONE}`,
    action("preview", plan, true, previewMigration),
    action("submit", plan, false, submitMigration),
    action("decision", approve, true, decideMigration),
    action("execute", execute, false, executeMigration),
    action("withdraw", plan, false, withdrawMigration),
    ...registerGateReapprovalRoutes(app, deps),
  ];
}
