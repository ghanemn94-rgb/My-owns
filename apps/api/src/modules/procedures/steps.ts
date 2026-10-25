// Procedure steps: the instance engine and the step actions (OpenAPI tag `procedures`; ADR-0042 §2-§4, §7, §9-§11;
// REQ-S06-002; p5-work-split §C.2; T-DG5-BE-F2):
//   POST /procedure-instances/{instanceId}/steps/{stepKey}/complete   completeProcedureStep     (procedure.act; assignee or role holder)
//   POST /procedure-instances/{instanceId}/steps/{stepKey}/skip       skipProcedureStep         (procedure.act; assignee or role holder)
//   POST /procedure-instances/{instanceId}/steps/{stepKey}/assign     assignProcedureStep       (procedure.manage)
//   POST /procedure-instances/{instanceId}/steps/{stepKey}/evidence   linkProcedureStepEvidence (procedure.act; assignee or role holder)
//
// THE ENGINE (`advance`). Steps run in ordinal order: the lowest ordinal with pending steps activates once every lower
// ordinal is closed (completed, skipped, not_applicable, cancelled; the 0069 guard procedure_step_instance_order repeats
// it). Steps sharing an ordinal form one parallel group and activate together. A step with a condition is evaluated at
// activation against the instance inputs (decimal.js on decimal strings; `evaluateStepCondition`): false makes it
// `not_applicable` (never run, never shown as completed), and the engine moves on. When no step is open the instance
// completes, provided its completion rule holds. Every activation computes the step's due date as activation business
// date + `sla_working_days` WORKING days on the organization's business calendar (ADR-0028); no calendar -> Unknown
// (null), never today and never elapsed days. Every activation writes the outbox event `procedure_step.activated`
// (consumer automation.evaluate: the slice E reminders and escalation path; no reminder logic here).
//
// APPROVAL STEPS. An approval step is completed ONLY by an APPROVED canonical approval (ADR-0026) decided by a person
// who holds the business approval right: when the step activates, the engine requests an approval of type
// `procedure_step` (migration 0072) on the step instance, routed to the step's approver party through the
// transformation's party mapping; the requester is the person whose action activated the step, so separation of duties
// keeps them from deciding it. workflows calls back `onOutcome`; on `approved` the step completes with `approval_id`
// (the 0069 guard procedure_step_instance_approval re-checks the approval status) and the engine advances. A step
// instance does not change while its approval is open (the 0031 subject version), so reassigning an active approval
// step is refused. Nothing in this module approves anything; product gates G1-G6 and DG0-DG7 are untouched.
//
// THE INTAKE ADOPTS ITS TRANSFORMATION (D-166 Rule A; migration 0096). An organization-scope instance's steps carry no
// transformation, so no approval of them can be requested. When the `capture_intake` step of an organization-scope
// `new_transformation_intake` instance completes with its output transformation T, every step of the instance that has
// not started adopts T in the same transaction (version + 1 and one audit event each); the instance keeps its
// organization scope. The adopted approval step (`confirm_sponsor`) is requested on T and routed by T's role mappings
// (DG4 resolveParty, never a fallback); until T has a mapped Sponsor it waits, truthfully "awaiting routing", and the
// next action on the instance retries the request.
//
// OUTPUTS are real linked records (ADR-0042 §3). A step's output is produced by an OUTPUT ADAPTER registered per
// `output_record_type` (`registerProcedureOutputAdapter`; BE-G fills the registry in procedures/outputs/**, each adapter
// calling the owning module's exported service with the acting user). Without an adapter: a `link` output links the
// record named by `outputRecordId` (the 0069 guard procedure_instance_link_record_ref checks it exists in scope; else
// 422 output_record_invalid); an approval step whose output is `approval` links its own approval; any other output is
// refused with 422 procedure_step.output_required and nothing is written.
//
// Every write: the advisory-lock class procedureInstanceStep on the instance id; the instance FOR UPDATE; authorization re-checked
// on grants reloaded inside the transaction (commit-time); Zod validation; If-Match on the INSTANCE (428 missing, 409
// stale); the ADR-0042 §10 refusals first (the 0069 guards repeat them); one audit event per row written, in the same
// transaction; the instance's version + 1 once per request; no remote or client I/O inside the transaction.
import {
  sql,
  type ApprovalRow,
  type DbOrTx,
  type ProcedureDefinitionRow,
  type ProcedureInstanceLinkRow,
  type ProcedureInstanceRow,
  type ProcedureStepDefinitionRow,
  type ProcedureStepInstanceRow,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { defineField, validateFieldValue } from "@mth/shared/calc";
import { evaluateStepCondition, freeText, outboxPayloadSchema, uuid } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  denialOf,
  grantApplies,
  loadGrants,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
  resolveTarget,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { computeWorkingDayDueDate } from "../organization/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { inputFieldAttributes, inputSchemaOf } from "./definitions.ts";
import { requireNamedRecordRead, requireOutputRead } from "./outputs/kit.ts";

// ------------------------------------------------------------------------------------------------ refusals (§10)

/** The ADR-0042 §10 instance and step refusals, with their exact English texts (p5-work-split §2 rule 15). */
export const PROCEDURE_INSTANCE_MESSAGES = {
  "procedure.launch_role": "Your role cannot launch this procedure.",
  "procedure.not_published": "Only a published procedure can be launched.",
  "procedure.scope_mismatch": "This procedure cannot be launched in this scope.",
  "procedure.input_invalid": "An input does not match the procedure's input schema.",
  "procedure.not_active": "This procedure instance is completed or cancelled.",
  "procedure.steps_open": "Close every step before completing the procedure.",
  "procedure_step.not_active": "This step is not active.",
  "procedure_step.inputs_missing": "Provide the missing inputs before completing this step.",
  "procedure_step.evidence_required": "Link evidence before completing this step.",
  "procedure_step.output_required": "This step must produce or link its output record.",
  "procedure_step.output_record_invalid": "The linked record is not of the expected type or not in this scope.",
  "procedure_step.decided_through_approval": "An approval step is completed by its business approval decision.",
  "procedure_step.not_skippable": "This step cannot be skipped.",
  "procedure_step.not_assignee": "Only the step's assignee or a holder of its role can act on this step.",
  "procedure.launch_replayed": "This launch was already processed.",
} as const;
export type ProcedureInstanceCode = keyof typeof PROCEDURE_INSTANCE_MESSAGES;
const INSTANCE_MESSAGES: ReadonlyMap<string, string> = new Map(Object.entries(PROCEDURE_INSTANCE_MESSAGES));

/** One §10 refusal: 403 for the two authorization codes, 409 for the replay, else 422. */
export function refusal(code: ProcedureInstanceCode): HttpProblem {
  const detail = INSTANCE_MESSAGES.get(code) ?? code;
  if (code === "procedure.launch_role" || code === "procedure_step.not_assignee")
    return new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });
  if (code === "procedure.launch_replayed") return problems.duplicate(code, detail);
  return problems.businessRule(code, detail);
}

export interface MissingInput {
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
}

/** 422 procedure_step.inputs_missing with the `missingInputs[]` problem extension (ADR-0042 §10: keys and labels). */
export class MissingInputsProblem extends HttpProblem {
  readonly missingInputs: readonly MissingInput[];
  constructor(missingInputs: readonly MissingInput[]) {
    super({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "procedure_step.inputs_missing",
      title: "Business rule violated",
      detail: PROCEDURE_INSTANCE_MESSAGES["procedure_step.inputs_missing"],
    });
    this.missingInputs = missingInputs;
  }
  override toBody(requestId: string, instance?: string) {
    return { ...super.toBody(requestId, instance), missingInputs: this.missingInputs } as ReturnType<
      HttpProblem["toBody"]
    >;
  }
}

// ------------------------------------------------------------------------------------------------ ports

/** What an output adapter receives inside the step-completion transaction (ADR-0042 §3). */
export interface ProcedureOutputContext {
  readonly tx: Tx;
  readonly audit: AuditContext;
  /**
   * The acting person, with grants reloaded inside `tx`; adapters call domain services with it. null when an approval
   * step completes through its business approval decision (the approver acted in workflows; `audit` names them).
   */
  readonly principal: Principal | null;
  readonly instance: ProcedureInstanceRow;
  readonly step: ProcedureStepInstanceRow;
  readonly stepDefinition: ProcedureStepDefinitionRow;
  readonly mode: "create" | "advance" | "link";
  /** The body's `outputRecordId` (link) and `outputInput` (create/advance), as sent. */
  readonly outputRecordId: string | null;
  readonly outputInput: Readonly<Record<string, unknown>> | null;
  /** The output records the instance already linked (an `advance` acts on the record an earlier step produced). */
  readonly links: readonly ProcedureInstanceLinkRow[];
}

/**
 * The output-adapter port (ADR-0042 §3; BE-G fills the registry in procedures/outputs/**): produces or verifies the
 * step's output record through the owning module's existing service and returns its id; the engine links it. A domain
 * refusal surfaces as that domain's problem code, and the whole completion rolls back.
 */
export interface ProcedureOutputAdapter {
  readonly recordType: string;
  readonly produce: (ctx: ProcedureOutputContext) => Promise<{ readonly recordId: string }>;
}

const OUTPUT_ADAPTERS = new Map<string, ProcedureOutputAdapter>();

/** Registers (or replaces) the adapter of one output record type. */
export function registerProcedureOutputAdapter(adapter: ProcedureOutputAdapter): void {
  OUTPUT_ADAPTERS.set(adapter.recordType, adapter);
}

/** Test seam: removes an adapter (a suite that registered a synthetic one restores the registry). */
export function unregisterProcedureOutputAdapter(recordType: string): void {
  OUTPUT_ADAPTERS.delete(recordType);
}

/** The canonical approval type of a procedure approval step (migration 0072). */
export const PROCEDURE_STEP_APPROVAL_TYPE = "procedure_step";

/** The subset of workflows' ApprovalRequestInput this module sends (ADR-0026 §4). */
export interface ProcedureApprovalRequest {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly scope: ResolvedTarget & { transformationId: string };
  readonly approvalType: string;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly title: string;
  readonly requestNote: string | null;
  readonly assigneePartyCode: string;
  readonly decisionRightId: null;
  readonly slaType: null;
  readonly urgentReason: null;
  readonly due: null;
}

/** workflows' ApprovalOutcomeEvent, as this module reads it. */
export interface ProcedureApprovalOutcome {
  readonly approval: ApprovalRow;
  readonly outcome: string;
  readonly actorUserId: string;
  readonly audit: AuditContext;
}

/** The ports the composition root wires (server.ts; procedures imports no workflows code, the BE-C precedent). */
export interface ProcedureApprovalPorts {
  readonly requestApproval: (tx: Tx, audit: AuditContext, input: ProcedureApprovalRequest) => Promise<ApprovalRow>;
  readonly registerSubject: (
    approvalType: string,
    provider: { readonly onOutcome: (tx: Tx, event: ProcedureApprovalOutcome) => Promise<void> },
  ) => void;
}

let approvalPorts: ProcedureApprovalPorts | null = null;

/**
 * Wired once by server.ts with workflows' `requestApprovalInTx` and `registerApprovalSubject`. Registers the
 * `procedure_step` subject: decided through the generic approval route by the business approver; on `approved` the step
 * completes and the instance advances in the deciding transaction. Unwired, activating an approval step fails closed.
 */
export function wireProcedureApprovals(ports: ProcedureApprovalPorts): void {
  approvalPorts = ports;
  ports.registerSubject(PROCEDURE_STEP_APPROVAL_TYPE, { onOutcome: onApprovalOutcome });
}

// ------------------------------------------------------------------------------------------------ loading

export interface InstanceBundle {
  readonly instance: ProcedureInstanceRow;
  readonly definition: ProcedureDefinitionRow;
  /** Step definitions by id (removed ones included: an instance keeps the steps it was launched with). */
  readonly stepDefinitions: ReadonlyMap<string, ProcedureStepDefinitionRow>;
  readonly steps: readonly ProcedureStepInstanceRow[];
  readonly links: readonly ProcedureInstanceLinkRow[];
  /** The newest approval of each approval step (by step instance id). */
  readonly approvals: ReadonlyMap<string, ApprovalRow>;
}

export async function findInstance(
  db: DbOrTx,
  id: string,
  forUpdate = false,
): Promise<ProcedureInstanceRow | undefined> {
  let q = db.selectFrom("procedure_instance").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

const byOrdinal = (a: ProcedureStepInstanceRow, b: ProcedureStepInstanceRow) =>
  a.ordinal - b.ordinal || (a.step_key < b.step_key ? -1 : a.step_key > b.step_key ? 1 : 0);

/** The instance with its pinned definition, steps, links and step approvals. */
export async function loadBundle(db: DbOrTx, instance: ProcedureInstanceRow): Promise<InstanceBundle> {
  const definition = await db
    .selectFrom("procedure_definition")
    .selectAll()
    .where("id", "=", instance.procedure_definition_id)
    .executeTakeFirstOrThrow();
  const stepDefs = await db
    .selectFrom("procedure_step_definition")
    .selectAll()
    .where("procedure_definition_id", "=", definition.id)
    .execute();
  const steps = (
    await db
      .selectFrom("procedure_step_instance")
      .selectAll()
      .where("procedure_instance_id", "=", instance.id)
      .execute()
  ).sort(byOrdinal);
  const links = await db
    .selectFrom("procedure_instance_link")
    .selectAll()
    .where("procedure_instance_id", "=", instance.id)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const approvals = new Map<string, ApprovalRow>();
  if (steps.length > 0) {
    const rows = await db
      .selectFrom("approval")
      .selectAll()
      .where("approval_type", "=", PROCEDURE_STEP_APPROVAL_TYPE)
      .where(
        "subject_id",
        "in",
        steps.map((s) => s.id),
      )
      .orderBy("requested_at")
      .orderBy("id")
      .execute();
    for (const a of rows) approvals.set(a.subject_id, a);
  }
  return {
    instance,
    definition,
    stepDefinitions: new Map(stepDefs.map((s) => [s.id, s])),
    steps,
    links,
    approvals,
  };
}

// ------------------------------------------------------------------------------------------------ dates

/** Today's business date in the organization: its default calendar's timezone, else the organization's (ADR-0025 §2). */
export async function businessToday(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active'),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  const d = r.rows.at(0)?.d;
  if (d === undefined) throw new Error("businessToday: no business date");
  return d;
}

/** activation date + `days` WORKING days on the organization's calendar; null = Unknown (no calendar). */
export async function workingDayDue(
  db: DbOrTx,
  organizationId: string,
  from: string,
  days: number,
): Promise<string | null> {
  return (await computeWorkingDayDueDate(db, organizationId, from, days)).dueDate;
}

// ------------------------------------------------------------------------------------------------ access

export interface Acting {
  readonly principal: Principal;
  readonly userId: string;
  readonly target: ResolvedTarget;
  readonly audit: AuditContext;
}

/** The scope an instance lives in: its transformation, else its organization. */
export async function instanceTarget(
  db: DbOrTx,
  i: Pick<ProcedureInstanceRow, "organization_id" | "transformation_id">,
) {
  const target = await resolveTarget(
    db,
    i.transformation_id === null
      ? { type: "organization", id: i.organization_id }
      : { type: "transformation", id: i.transformation_id },
  );
  if (target === null) throw problems.notFound();
  return target;
}

/** Read gate of an instance (procedure.read in its scope; 404 otherwise, existence never disclosed). */
export async function requireInstanceRead(
  db: DbOrTx,
  principal: Principal,
  i: Pick<ProcedureInstanceRow, "organization_id" | "transformation_id">,
): Promise<ResolvedTarget> {
  return requireRead(db, principal, "procedure.read", await instanceTarget(db, i));
}

/**
 * Commit-time authorization of a write on an instance: the read gate on request-start grants (404), then the read gate
 * and `permission` on grants reloaded inside `tx` (403 audited as a failed mutation).
 */
export async function authorizeInstanceWrite(
  tx: Tx,
  request: FastifyRequest,
  i: ProcedureInstanceRow,
  permission: Permission,
): Promise<Acting> {
  await requireInstanceRead(tx, principalOf(request), i);
  const fresh = await refreshPrincipal(tx, request);
  let target: ResolvedTarget;
  try {
    target = await requireInstanceRead(tx, fresh, i);
    await requireAction(tx, fresh, permission, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  if (fresh.userId === null) throw problems.forbidden();
  return { principal: fresh, userId: fresh.userId, target, audit: auditContextOf(request) };
}

// D-167 (Rule A clarified; REQ-S06-003). A step whose `transformation_id` was adopted (an organization-scope instance's
// step that took the transformation T its `capture_intake` produced, 0096) is read and acted on with T's authorization
// and the step's assignee role: T's Lead acts on `draft_charter` although nobody holds TL at organization scope. Only
// for that step: the instance's other steps, its list and its organization-level reads keep organization scope, and
// every organization-scope actor who could act before keeps that right (the organization scope is tried first).

/** T when `step` adopted its organization-scope instance's transformation (D-166 Rule A), else null. */
export function adoptedTransformationOf(
  i: Pick<ProcedureInstanceRow, "transformation_id">,
  step: Pick<ProcedureStepInstanceRow, "transformation_id">,
): string | null {
  return i.transformation_id === null && step.transformation_id !== null ? step.transformation_id : null;
}

/** The scopes a step is authorized in: its instance's, then (an adopted step) T's. */
export async function stepTargets(
  db: DbOrTx,
  i: Pick<ProcedureInstanceRow, "organization_id" | "transformation_id">,
  step: Pick<ProcedureStepInstanceRow, "transformation_id"> | null,
): Promise<ResolvedTarget[]> {
  const targets = [await instanceTarget(db, i)];
  const t = step === null ? null : adoptedTransformationOf(i, step);
  if (t !== null) {
    const adopted = await resolveTarget(db, { type: "transformation", id: t });
    if (adopted !== null) targets.push(adopted);
  }
  return targets;
}

/** The scope a step's assignee must hold its role in: T for an adopted step, else the instance's scope. */
export async function stepRoleTarget(
  db: DbOrTx,
  i: Pick<ProcedureInstanceRow, "organization_id" | "transformation_id">,
  step: Pick<ProcedureStepInstanceRow, "transformation_id">,
): Promise<ResolvedTarget> {
  const targets = await stepTargets(db, i, step);
  return targets[targets.length - 1]!;
}

export const isNotFound = (err: unknown): boolean => err instanceof HttpProblem && err.status === 404;

/** The read gate on several scopes: the first scope that grants procedure.read (404 when none does). */
export async function requireReadInAny(
  db: DbOrTx,
  principal: Principal,
  targets: readonly ResolvedTarget[],
): Promise<ResolvedTarget> {
  let first: unknown = null;
  for (const t of targets) {
    try {
      return await requireRead(db, principal, "procedure.read", t);
    } catch (err) {
      first ??= err;
    }
  }
  throw first ?? problems.notFound();
}

/**
 * The read of ONE instance (getProcedureInstance; D-167): the instance's scope, else T of one of its adopted steps (the
 * read that acting on that step needs, e.g. the version for If-Match). The instance list keeps the instance's scope.
 */
export async function requireInstanceOrAdoptedRead(
  db: DbOrTx,
  principal: Principal,
  i: Pick<ProcedureInstanceRow, "id" | "organization_id" | "transformation_id">,
): Promise<void> {
  try {
    await requireInstanceRead(db, principal, i);
  } catch (err) {
    if (i.transformation_id !== null || !isNotFound(err)) throw err;
    const adopted = await db
      .selectFrom("procedure_step_instance")
      .select("transformation_id")
      .distinct()
      .where("procedure_instance_id", "=", i.id)
      .where("transformation_id", "is not", null)
      .orderBy("transformation_id")
      .execute();
    for (const a of adopted) {
      const t = await resolveTarget(db, { type: "transformation", id: a.transformation_id! });
      if (t === null) continue;
      try {
        await requireRead(db, principal, "procedure.read", t);
        return;
      } catch {
        // not readable in this T either: try the next one, else the instance's own 404
      }
    }
    throw err;
  }
}

/**
 * Commit-time authorization of a write on ONE step (D-167): `authorizeInstanceWrite` for a step that was not adopted.
 * For an adopted step, each of its scopes (the organization first, then T) is tried with the read gate, `permission`
 * and, when `actorStep` is given, the step-actor rule; the first scope where all hold is the acting scope. When none
 * does, the refusal of a scope the caller can read (403) wins over a 404, as for any other step.
 */
export async function authorizeStepWrite(
  tx: Tx,
  request: FastifyRequest,
  i: ProcedureInstanceRow,
  step: ProcedureStepInstanceRow | null,
  permission: Permission,
  actorStep: ProcedureStepInstanceRow | null,
): Promise<Acting> {
  if (step === null || adoptedTransformationOf(i, step) === null) {
    const acting = await authorizeInstanceWrite(tx, request, i, permission);
    if (actorStep !== null) requireStepActor(acting, actorStep);
    return acting;
  }
  const targets = await stepTargets(tx, i, step);
  await requireReadInAny(tx, principalOf(request), targets);
  const fresh = await refreshPrincipal(tx, request);
  let refused: unknown = null;
  for (const t of targets) {
    try {
      let target: ResolvedTarget;
      try {
        target = await requireRead(tx, fresh, "procedure.read", t);
        await requireAction(tx, fresh, permission, target);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if (fresh.userId === null) throw problems.forbidden();
      const acting: Acting = { principal: fresh, userId: fresh.userId, target, audit: auditContextOf(request) };
      if (actorStep !== null) requireStepActor(acting, actorStep);
      return acting;
    } catch (err) {
      if (refused === null || (isNotFound(refused) && !isNotFound(err))) refused = err;
    }
  }
  throw refused ?? problems.notFound();
}

/** True when some grant of `grants` is of `roleCode` and applies to `target` for `permission`. */
export function holdsRoleIn(
  grants: Principal["grants"],
  roleCode: string,
  permission: Permission,
  target: ResolvedTarget,
): boolean {
  return grants.some((g) => g.roleCode === roleCode && grantApplies(g, permission, target));
}

/** ADR-0042 §9: the step's assignee, or (unassigned) a holder of its role in scope; else 403 not_assignee. */
export function requireStepActor(a: Acting, step: ProcedureStepInstanceRow): void {
  a.principal.tracker.decisions += 1;
  const mine =
    step.assignee_user_id !== null
      ? step.assignee_user_id === a.userId
      : holdsRoleIn(a.principal.grants, step.assignee_role_code, "procedure.act", a.target);
  if (!mine) throw refusal("procedure_step.not_assignee").withDenial(denialOf("procedure.act", a.target));
}

// ------------------------------------------------------------------------------------------------ writes (rows)

async function lockInstance(tx: Tx, instanceId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.procedureInstanceStep}::integer, hashtext(${instanceId}::text))`.execute(
    tx,
  );
}

/** Locks (procedureInstanceStep) and reads the instance FOR UPDATE, or 404. */
export async function lockAndLoad(tx: Tx, instanceId: string): Promise<ProcedureInstanceRow> {
  await lockInstance(tx, instanceId);
  const i = await findInstance(tx, instanceId, true);
  if (i === undefined) throw problems.notFound();
  return i;
}

type StepChange = Partial<
  Pick<
    ProcedureStepInstanceRow,
    | "status"
    | "assignee_user_id"
    | "due_date"
    | "completed_by"
    | "skipped_by"
    | "skip_reason"
    | "completion_note"
    | "approval_id"
  >
> & { readonly activated?: boolean; readonly completed?: boolean };

/** One step update: version + 1 and its audit event (action `procedure_step_instance.<verb>`). */
async function updateStep(
  tx: Tx,
  audit: AuditContext,
  step: ProcedureStepInstanceRow,
  verb: string,
  change: StepChange,
  reason?: string,
): Promise<ProcedureStepInstanceRow> {
  const { activated, completed, ...cols } = change;
  const by = audit.actorUserId ?? step.updated_by;
  const updated = await tx
    .updateTable("procedure_step_instance")
    .set({
      ...cols,
      ...(activated === true ? { activated_at: sql<Date>`now()` } : {}),
      ...(completed === true ? { completed_at: sql<Date>`now()` } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: by,
    })
    .where("id", "=", step.id)
    .where("version", "=", step.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes = new Map<string, { from: unknown; to: unknown }>();
  const before = new Map<string, unknown>(Object.entries(step));
  for (const [k, v] of Object.entries(cols)) changes.set(k, { from: before.get(k) ?? null, to: v ?? null });
  await record(tx, audit, {
    action: `procedure_step_instance.${verb}`,
    recordType: "procedure_step_instance",
    recordId: step.id,
    organizationId: step.organization_id,
    transformationId: step.transformation_id,
    priorVersion: step.version,
    newVersion: updated.version,
    changes: Object.fromEntries(changes),
    ...(reason !== undefined ? { reason } : {}),
  });
  return updated;
}

/** The instance's version + 1 (one per request), with its status/input change and its audit event. */
async function bumpInstance(
  tx: Tx,
  audit: AuditContext,
  i: ProcedureInstanceRow,
  verb: string,
  change: Partial<Pick<ProcedureInstanceRow, "status" | "cancelled_by" | "cancel_reason">> & {
    readonly inputValues?: Record<string, unknown>;
    readonly completed?: boolean;
    readonly cancelled?: boolean;
  } = {},
  reason?: string,
): Promise<ProcedureInstanceRow> {
  const { inputValues, completed, cancelled, ...cols } = change;
  const by = audit.actorUserId ?? i.updated_by;
  const updated = await tx
    .updateTable("procedure_instance")
    .set({
      ...cols,
      ...(inputValues !== undefined ? { input_values: JSON.stringify(inputValues) } : {}),
      ...(completed === true ? { completed_at: sql<Date>`now()` } : {}),
      ...(cancelled === true ? { cancelled_at: sql<Date>`now()` } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: by,
    })
    .where("id", "=", i.id)
    .where("version", "=", i.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes = new Map<string, { from: unknown; to: unknown }>();
  if (cols.status !== undefined) changes.set("status", { from: i.status, to: cols.status });
  if (inputValues !== undefined) changes.set("input_values", { from: i.input_values, to: inputValues });
  if (cols.cancel_reason !== undefined) changes.set("cancel_reason", { from: null, to: cols.cancel_reason });
  await record(tx, audit, {
    action: `procedure_instance.${verb}`,
    recordType: "procedure_instance",
    recordId: i.id,
    organizationId: i.organization_id,
    transformationId: i.transformation_id,
    priorVersion: i.version,
    newVersion: updated.version,
    changes: Object.fromEntries(changes),
    ...(reason !== undefined ? { reason } : {}),
  });
  return updated;
}

/** Appends one link (append-only; the 0069 guard checks the record exists in scope). Returns false when it existed. */
async function insertLink(
  tx: Tx,
  audit: AuditContext,
  i: ProcedureInstanceRow,
  step: ProcedureStepInstanceRow | null,
  kind: "output" | "evidence",
  recordType: string,
  recordId: string,
): Promise<boolean> {
  const by = audit.actorUserId;
  if (by === null) throw new Error("procedures: a person links a record");
  const id = uuidv7();
  const inserted = await tx
    .insertInto("procedure_instance_link")
    .values({
      id,
      organization_id: i.organization_id,
      transformation_id: i.transformation_id,
      procedure_instance_id: i.id,
      step_instance_id: step?.id ?? null,
      link_kind: kind,
      record_type: recordType,
      record_id: recordId,
      created_by: by,
    })
    .onConflict((oc) => oc.constraint("procedure_instance_link_key").doNothing())
    .returning("id")
    .executeTakeFirst()
    .catch((err: unknown) => {
      const c = (err as { constraint?: string } | null)?.constraint;
      if (c === "procedure_instance_link_record_ref") throw refusal("procedure_step.output_record_invalid");
      throw err;
    });
  if (inserted === undefined) return false;
  await record(tx, audit, {
    action: `procedure_instance_link.${kind}`,
    recordType: "procedure_instance_link",
    recordId: id,
    organizationId: i.organization_id,
    transformationId: i.transformation_id,
    newVersion: 1,
    changes: {
      step_key: { from: null, to: step?.step_key ?? null },
      link_kind: { from: null, to: kind },
      record_type: { from: null, to: recordType },
      record_id: { from: null, to: recordId },
    },
  });
  return true;
}

/** The outbox event of one activation (ADR-0042 §7; key `procedure_step.activated:<stepInstanceId>`). */
async function enqueueActivated(tx: Tx, i: ProcedureInstanceRow, s: ProcedureStepInstanceRow, kind: string) {
  const eventType = "procedure_step.activated";
  const schema = outboxPayloadSchema(eventType, 1);
  if (schema === null) throw new Error(`outbox: no schema for ${eventType} v1`);
  const payload = schema.parse({
    instanceId: i.id,
    stepInstanceId: s.id,
    procedureCode: i.procedure_code,
    transformationId: i.transformation_id,
    stepKey: s.step_key,
    stepKind: kind,
    dueDate: s.due_date,
    assigneeUserId: s.assignee_user_id,
    assigneeRoleCode: s.assignee_role_code,
  });
  await tx
    .insertInto("outbox_event")
    .values({
      id: uuidv7(),
      organization_id: i.organization_id,
      aggregate_type: "procedure_step_instance",
      aggregate_id: s.id,
      event_type: eventType,
      schema_version: 1,
      payload: JSON.stringify(payload),
      idempotency_key: `${eventType}:${s.id}`,
    })
    .execute();
}

// ------------------------------------------------------------------------------------------------ the engine

const OPEN: ReadonlySet<string> = new Set(["pending", "active"]);

/** Instance inputs as a Map (module source never reads a runtime key with a computed member). */
export function inputsOf(i: Pick<ProcedureInstanceRow, "input_values">): Map<string, unknown> {
  const raw = i.input_values;
  return new Map(raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : []);
}

const absent = (v: unknown) => v === undefined || v === null;

/** The required keys of a step that are absent or null in the instance inputs. */
export function missingStepInputs(inputs: ReadonlyMap<string, unknown>, sd: ProcedureStepDefinitionRow): string[] {
  return sd.required_input_keys.filter((k) => absent(inputs.get(k)));
}

/** The seeded organization-scope intake and its first step (0069; D-166 Rule A). */
export const INTAKE_PROCEDURE_CODE = "new_transformation_intake";
export const INTAKE_CAPTURE_STEP_KEY = "capture_intake";

/** The DG4 routing refusals (access/role-mappings.ts routingRefusals) an adopted step waits on instead of failing. */
const ROUTING_WAIT_CODES: ReadonlySet<string> = new Set(["routing.role_unmapped", "routing.assignee_not_approver"]);

/** True for a step that adopted its organization-scope instance's transformation (D-166 Rule A). */
function isAdopted(b: InstanceBundle, step: ProcedureStepInstanceRow): boolean {
  return adoptedTransformationOf(b.instance, step) !== null;
}

/**
 * Requests the business approval of an active approval step, on the step's transformation (its instance's, or the one
 * an intake step adopted; D-166 Rule A), routed to the step's approver party by THAT transformation's role mappings
 * (DG4 resolveParty, never a fallback). A step without a transformation has nowhere to route: it stays active and reads
 * "awaiting routing". An ADOPTED step whose party is not mapped (or not an approver) in its transformation yet also
 * waits, truthfully unrouted, instead of failing the action that activated it: the DG4 refusal writes nothing
 * (requestApprovalInTx resolves the party before any insert), and the request is retried by the next action on the
 * instance (`advance`). In a transformation-scope instance the refusal stays the action's 422, as in DG4.
 */
async function requestStepApproval(
  tx: Tx,
  audit: AuditContext,
  b: InstanceBundle,
  step: ProcedureStepInstanceRow,
  sd: ProcedureStepDefinitionRow,
): Promise<void> {
  const transformationId = step.transformation_id;
  if (transformationId === null) return;
  if (approvalPorts === null) throw new Error("procedures: approval ports are not wired (server.ts)");
  if (audit.actorUserId === null) throw new Error("procedures: a person's action requests a business approval");
  const target = await resolveTarget(tx, { type: "transformation", id: transformationId });
  if (target === null || target.transformationId === null) throw problems.notFound();
  const party = sd.approval_role_code ?? step.assignee_role_code;
  try {
    await approvalPorts.requestApproval(tx, audit, {
      organizationId: b.instance.organization_id,
      transformationId,
      scope: { ...target, transformationId },
      approvalType: PROCEDURE_STEP_APPROVAL_TYPE,
      subjectId: step.id,
      subjectVersion: step.version,
      title: `${b.definition.name_en}: ${sd.name_en}`.slice(0, 300),
      requestNote: null,
      assigneePartyCode: party,
      decisionRightId: null,
      slaType: null,
      urgentReason: null,
      due: null,
    });
  } catch (err) {
    if (isAdopted(b, step) && err instanceof HttpProblem && ROUTING_WAIT_CODES.has(err.code)) return;
    throw err;
  }
}

/**
 * Retries the request of every active approval step that ADOPTED a transformation and has never had an approval (it
 * waited unrouted for its party's mapping; D-166 Rule A). Returns true when it requested one.
 */
async function routeWaitingApprovals(tx: Tx, audit: AuditContext, b: InstanceBundle): Promise<boolean> {
  if (audit.actorUserId === null || b.instance.status !== "active") return false;
  let requested = false;
  for (const step of b.steps) {
    if (step.status !== "active" || !isAdopted(b, step) || b.approvals.has(step.id)) continue;
    const sd = b.stepDefinitions.get(step.step_definition_id);
    if (sd?.step_kind !== "approval") continue;
    await requestStepApproval(tx, audit, b, step, sd);
    requested = true;
  }
  return requested;
}

/**
 * D-166 Rule A: when the `capture_intake` step of an organization-scope `new_transformation_intake` instance completed
 * with its output transformation T, every step of the instance that has not started (pending) adopts T, in the same
 * transaction: the P2 version step and one audit event each. The instance keeps its organization scope. The 0096 row
 * guard allows exactly this transition and refuses every other change of `transformation_id`.
 */
async function adoptIntakeTransformation(
  tx: Tx,
  audit: AuditContext,
  b: InstanceBundle,
  transformationId: string,
): Promise<void> {
  const by = audit.actorUserId;
  if (by === null) throw new Error("procedures: a person's action adopts the intake's transformation");
  for (const step of b.steps) {
    if (step.status !== "pending" || step.transformation_id !== null) continue;
    const updated = await tx
      .updateTable("procedure_step_instance")
      .set({
        transformation_id: transformationId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: by,
      })
      .where("id", "=", step.id)
      .where("version", "=", step.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "procedure_step_instance.adopt_transformation",
      recordType: "procedure_step_instance",
      recordId: step.id,
      organizationId: step.organization_id,
      transformationId,
      priorVersion: step.version,
      newVersion: updated.version,
      changes: { transformation_id: { from: null, to: transformationId } },
    });
  }
}

/**
 * Advances the instance: activates the next position (or marks its conditional steps not applicable, then moves on), and
 * completes the instance when no step is open and its completion rule holds. Returns the instance row (unchanged here:
 * the caller bumps its version once per request, or `completeInstance` does).
 */
export async function advance(tx: Tx, audit: AuditContext, start: InstanceBundle): Promise<InstanceBundle> {
  let b = start;
  // An adopted approval step that waited for its party's mapping is routed by the next action (D-166 Rule A).
  if (await routeWaitingApprovals(tx, audit, b)) b = await reload(tx, b);
  for (let guard = 0; guard < 120; guard += 1) {
    const open = b.steps.filter((s) => OPEN.has(s.status));
    if (open.length === 0) return b;
    if (open.some((s) => s.status === "active")) return b;
    const ordinal = Math.min(...open.map((s) => s.ordinal));
    const today = await businessToday(tx, b.instance.organization_id);
    const inputs = Object.fromEntries(inputsOf(b.instance));
    for (const step of open.filter((s) => s.ordinal === ordinal)) {
      const sd = b.stepDefinitions.get(step.step_definition_id);
      if (sd === undefined) throw new Error(`procedures: step definition ${step.step_definition_id} missing`);
      const runs =
        sd.condition_input_key === null || sd.condition_operator === null
          ? true
          : evaluateStepCondition(
              {
                inputKey: sd.condition_input_key,
                operator: sd.condition_operator as Parameters<typeof evaluateStepCondition>[0]["operator"],
                value: sd.condition_value as Parameters<typeof evaluateStepCondition>[0]["value"],
              },
              inputs,
            );
      if (!runs) {
        await updateStep(tx, audit, step, "not_applicable", { status: "not_applicable" });
        continue;
      }
      const due = await workingDayDue(tx, b.instance.organization_id, today, sd.sla_working_days);
      const active = await updateStep(tx, audit, step, "activate", {
        status: "active",
        due_date: due,
        activated: true,
      });
      await enqueueActivated(tx, b.instance, active, sd.step_kind);
      if (sd.step_kind === "approval") await requestStepApproval(tx, audit, await reload(tx, b), active, sd);
    }
    b = await reload(tx, b);
  }
  throw new Error("procedures: the engine did not settle");
}

async function reload(tx: Tx, b: InstanceBundle): Promise<InstanceBundle> {
  const i = await findInstance(tx, b.instance.id);
  if (i === undefined) throw problems.notFound();
  return loadBundle(tx, i);
}

/**
 * Whether the completion rule holds (every step closed; with outputs: each completed output step linked its record, an
 * `advance` step through the instance's link of its record type; the 0069 guard as redefined by 0072).
 */
function completionHolds(b: InstanceBundle): boolean {
  if (b.steps.some((s) => OPEN.has(s.status))) return false;
  if (b.definition.completion_rule !== "all_steps_closed_and_outputs_linked") return true;
  return b.steps
    .filter((s) => s.status === "completed")
    .every((s) => {
      const sd = b.stepDefinitions.get(s.step_definition_id);
      if (sd === undefined || sd.output_record_type === null) return true;
      if (b.links.some((l) => l.step_instance_id === s.id && l.record_type === sd.output_record_type)) return true;
      // 0072: an `advance` step's output is the record an earlier step produced (one link per record).
      return (
        sd.output_mode === "advance" &&
        b.links.some((l) => l.link_kind === "output" && l.record_type === sd.output_record_type)
      );
    });
}

/**
 * Ends a mutating request: the instance's version + 1 (and `completed` when the engine closed every step and the rule
 * holds), with one audit event. Returns the reloaded bundle.
 */
export async function finish(tx: Tx, audit: AuditContext, b: InstanceBundle, verb: string): Promise<InstanceBundle> {
  const done = b.instance.status === "active" && completionHolds(b);
  await bumpInstance(
    tx,
    audit,
    b.instance,
    done ? "complete" : verb,
    done ? { status: "completed", completed: true } : {},
  );
  return reload(tx, b);
}

// ------------------------------------------------------------------------------------------------ read model

export interface ProcedureStepView {
  readonly stepKey: string;
  readonly ordinal: number;
  readonly parallelGroup: string | null;
  readonly stepKind: "task" | "approval";
  readonly nameEn: string;
  readonly nameAr: string;
  readonly status: "pending" | "active" | "completed" | "skipped" | "not_applicable" | "cancelled";
  readonly assigneeRoleCode: string;
  readonly assigneeUserId: string | null;
  readonly dueDate: string | null;
  readonly dueDateUnknownReason: string | null;
  readonly overdue: boolean | null;
  readonly activatedAt: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly skipReason: string | null;
  readonly approvalId: string | null;
  readonly missingInputs: string[];
}

export interface ProcedureInstanceView {
  readonly id: string;
  readonly transformationId: string | null;
  readonly procedureCode: string;
  readonly procedureDefinitionId: string;
  readonly methodologyVersionId: string;
  readonly versionNo: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly status: "active" | "completed" | "cancelled";
  readonly subjectRecordType: string | null;
  readonly subjectRecordId: string | null;
  readonly inputValues: Record<string, unknown>;
  readonly dueDate: string | null;
  readonly currentStepKeys: string[];
  readonly missingInputs: MissingInput[];
  readonly nextAction: {
    readonly kind: "provide_input" | "link_evidence" | "complete_step" | "await_approval" | "none";
    readonly stepKey: string | null;
    readonly messageKey: string;
    readonly messageParams: Record<string, string | number | boolean | null>;
  };
  readonly steps: ProcedureStepView[];
  readonly links: {
    readonly id: string;
    readonly stepKey: string | null;
    readonly linkKind: "output" | "evidence";
    readonly recordType: string;
    readonly recordId: string;
    readonly createdAt: string;
    readonly createdBy: string;
  }[];
  readonly launchedBy: string;
  readonly launchedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

/** One step as the contract's ProcedureStepInstance (`today` = the organization's business date, for overdue). */
export function presentStep(
  b: InstanceBundle,
  s: ProcedureStepInstanceRow,
  today: string,
  inputs: ReadonlyMap<string, unknown>,
): ProcedureStepView {
  const sd = b.stepDefinitions.get(s.step_definition_id);
  if (sd === undefined) throw new Error(`procedures: step definition ${s.step_definition_id} missing`);
  const open = OPEN.has(s.status);
  // Unknown is never today and never "not overdue": no due date -> overdue null.
  const unknownReason =
    s.due_date !== null
      ? null
      : s.status === "active"
        ? "calendar_not_configured"
        : s.status === "pending"
          ? "not_active"
          : null;
  return {
    stepKey: s.step_key,
    ordinal: s.ordinal,
    parallelGroup: sd.parallel_group,
    stepKind: sd.step_kind as ProcedureStepView["stepKind"],
    nameEn: sd.name_en,
    nameAr: sd.name_ar,
    status: s.status as ProcedureStepView["status"],
    assigneeRoleCode: s.assignee_role_code,
    assigneeUserId: s.assignee_user_id,
    dueDate: s.due_date,
    dueDateUnknownReason: unknownReason,
    overdue: s.status === "active" && s.due_date !== null ? s.due_date < today : null,
    activatedAt: isoOrNull(s.activated_at),
    completedAt: isoOrNull(s.completed_at),
    completedBy: s.completed_by,
    skipReason: s.skip_reason,
    approvalId: s.approval_id ?? b.approvals.get(s.id)?.id ?? null,
    missingInputs: open ? missingStepInputs(inputs, sd) : [],
  };
}

const NEXT = "procedures.next_action";

/** The instance as the contract's ProcedureInstance (M0153's six items, ADR-0042 §3). */
export async function presentInstance(db: DbOrTx, b: InstanceBundle): Promise<ProcedureInstanceView> {
  const i = b.instance;
  const today = await businessToday(db, i.organization_id);
  const inputs = inputsOf(i);
  const schema = inputSchemaOf(b.definition);
  const labelOf = new Map(schema.map((f) => [f.key, f]));
  const steps = b.steps.map((s) => presentStep(b, s, today, inputs));
  const openSteps = b.steps.filter((s) => OPEN.has(s.status));
  // Missing inputs: the definition's required inputs and the required inputs of every open step, absent or null.
  const missingKeys = new Set<string>();
  for (const f of schema) if (f.required && absent(inputs.get(f.key))) missingKeys.add(f.key);
  for (const s of openSteps) {
    const sd = b.stepDefinitions.get(s.step_definition_id);
    if (sd !== undefined) for (const k of missingStepInputs(inputs, sd)) missingKeys.add(k);
  }
  const missingInputs = [...missingKeys].map((key) => ({
    key,
    labelEn: labelOf.get(key)?.labelEn ?? key,
    labelAr: labelOf.get(key)?.labelAr ?? key,
  }));
  const active = b.steps.filter((s) => s.status === "active");
  let nextAction: ProcedureInstanceView["nextAction"] = {
    kind: "none",
    stepKey: null,
    messageKey: `${NEXT}.none_${i.status}`,
    messageParams: {},
  };
  const first = active.at(0);
  if (i.status === "active" && first !== undefined) {
    const sd = b.stepDefinitions.get(first.step_definition_id)!;
    const params = { stepKey: first.step_key, stepNameEn: sd.name_en, stepNameAr: sd.name_ar };
    const missing = missingStepInputs(inputs, sd).at(0);
    const evidenceLinked = b.links.some((l) => l.step_instance_id === first.id && l.link_kind === "evidence");
    if (sd.step_kind === "approval") {
      const approval = b.approvals.get(first.id);
      nextAction = {
        kind: "await_approval",
        stepKey: first.step_key,
        messageKey: approval === undefined ? `${NEXT}.await_approval_unrouted` : `${NEXT}.await_approval`,
        messageParams: {
          ...params,
          roleCode: sd.approval_role_code ?? first.assignee_role_code,
          approvalStatus: approval?.status ?? null,
        },
      };
    } else if (missing !== undefined) {
      nextAction = {
        kind: "provide_input",
        stepKey: first.step_key,
        messageKey: `${NEXT}.provide_input`,
        messageParams: {
          ...params,
          inputKey: missing,
          inputLabelEn: labelOf.get(missing)?.labelEn ?? missing,
          inputLabelAr: labelOf.get(missing)?.labelAr ?? missing,
        },
      };
    } else if (sd.evidence_required && !evidenceLinked) {
      nextAction = {
        kind: "link_evidence",
        stepKey: first.step_key,
        messageKey: `${NEXT}.link_evidence`,
        messageParams: params,
      };
    } else {
      nextAction = {
        kind: "complete_step",
        stepKey: first.step_key,
        messageKey: `${NEXT}.complete_step`,
        messageParams: params,
      };
    }
  } else if (i.status === "active") {
    // Every step is closed but the completion rule does not hold yet (an expected output is not linked).
    nextAction = { kind: "none", stepKey: null, messageKey: `${NEXT}.outputs_pending`, messageParams: {} };
  }
  const version = await db
    .selectFrom("methodology_version")
    .select("version_no")
    .where("id", "=", i.methodology_version_id)
    .executeTakeFirstOrThrow();
  const stepKeyOf = new Map(b.steps.map((s) => [s.id, s.step_key]));
  return {
    id: i.id,
    transformationId: i.transformation_id,
    procedureCode: i.procedure_code,
    procedureDefinitionId: i.procedure_definition_id,
    methodologyVersionId: i.methodology_version_id,
    versionNo: version.version_no,
    nameEn: b.definition.name_en,
    nameAr: b.definition.name_ar,
    status: i.status as ProcedureInstanceView["status"],
    subjectRecordType: i.subject_record_type,
    subjectRecordId: i.subject_record_id,
    inputValues: Object.fromEntries(inputs),
    dueDate: i.due_date,
    currentStepKeys: active.map((s) => s.step_key),
    missingInputs,
    nextAction,
    steps,
    links: b.links.map((l) => ({
      id: l.id,
      stepKey: l.step_instance_id === null ? null : (stepKeyOf.get(l.step_instance_id) ?? null),
      linkKind: l.link_kind as "output" | "evidence",
      recordType: l.record_type,
      recordId: l.record_id,
      createdAt: iso(l.created_at),
      createdBy: l.created_by,
    })),
    launchedBy: i.launched_by,
    launchedAt: iso(i.launched_at),
    completedAt: isoOrNull(i.completed_at),
    cancelledAt: isoOrNull(i.cancelled_at),
    cancelReason: i.cancel_reason,
    version: i.version,
    updatedAt: iso(i.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ input validation

/**
 * Validates input values against the pinned input schema (ADR-0041 §3 validators; null clears): an undeclared key or an
 * invalid value -> 422 procedure.input_invalid with the field named. Returns the normalized values (decimal strings,
 * percentage fractions, currency with its code; never floats).
 */
export function validateInputs(
  definition: Pick<ProcedureDefinitionRow, "input_schema">,
  values: Readonly<Record<string, unknown>>,
): Map<string, unknown> {
  const fields = new Map(inputSchemaOf(definition).map((f) => [f.key, f]));
  const out = new Map<string, unknown>();
  const invalid = (key: string, reason: string) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "procedure.input_invalid",
      title: "Business rule violated",
      detail: PROCEDURE_INSTANCE_MESSAGES["procedure.input_invalid"],
      errors: [{ pointer: `/inputValues/${key}`, code: "procedure.input_invalid", message: reason }],
    });
  for (const [key, raw] of Object.entries(values)) {
    const f = fields.get(key);
    if (f === undefined) throw invalid(key, "not_declared");
    if (raw === null) {
      out.set(key, null);
      continue;
    }
    const defined = defineField(f.key, f.fieldType, inputFieldAttributes(f), { required: f.required });
    if (!defined.ok) throw invalid(key, "schema_invalid");
    const r = validateFieldValue(defined.field, raw);
    if (!r.ok) throw invalid(key, r.code);
    out.set(key, r.value);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ step actions

const stepParams = z.strictObject({ instanceId: uuid, stepKey: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/) });
export const procedureStepComplete = z.strictObject({
  note: freeText(1, 4000).nullable().optional(),
  outputRecordId: uuid.nullable().optional(),
  outputInput: z.record(z.string(), z.unknown()).optional(),
});
export const procedureStepSkip = z.strictObject({ reason: freeText(3, 2000) });
export const procedureStepAssign = z.strictObject({ assigneeUserId: uuid });
export const procedureStepEvidence = z.strictObject({ evidenceId: uuid });

interface StepContext {
  readonly acting: Acting;
  readonly bundle: InstanceBundle;
  readonly step: ProcedureStepInstanceRow;
  readonly sd: ProcedureStepDefinitionRow;
}

/** The common opening of a step action: lock, load, authorize, If-Match, the instance active, the step known. */
async function openStep(
  tx: Tx,
  request: FastifyRequest,
  permission: Permission,
  checkActor: boolean,
): Promise<StepContext> {
  const { instanceId, stepKey } = parse(stepParams, request.params, "params");
  const seen = await findInstance(tx, instanceId);
  if (seen === undefined) throw problems.notFound();
  // D-167: an adopted step is read in its instance's scope or in T (the step's transformation).
  const seenStep = await tx
    .selectFrom("procedure_step_instance")
    .select("transformation_id")
    .where("procedure_instance_id", "=", instanceId)
    .where("step_key", "=", stepKey)
    .executeTakeFirst();
  await requireReadInAny(tx, principalOf(request), await stepTargets(tx, seen, seenStep ?? null));
  const i = await lockAndLoad(tx, instanceId);
  const bundle = await loadBundle(tx, i);
  const step = bundle.steps.find((s) => s.step_key === stepKey);
  const sd = step === undefined ? undefined : bundle.stepDefinitions.get(step.step_definition_id);
  // An approval step is acted on by nobody here (its business approver decides the approval): the step's own refusal
  // (decided_through_approval / not_skippable) answers instead of not_assignee.
  const actorStep = checkActor && step !== undefined && sd !== undefined && sd.step_kind !== "approval" ? step : null;
  const acting = await authorizeStepWrite(tx, request, i, step ?? null, permission, actorStep);
  if (step === undefined || sd === undefined) throw problems.notFound();
  const expected = requireIfMatch(request);
  if (expected !== i.version) throw problems.versionConflict(i.version);
  if (i.status !== "active") throw refusal("procedure.not_active");
  return { acting, bundle, step, sd };
}

async function completeStep(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const body = parseBody(procedureStepComplete, request.body ?? {});
  const { acting, bundle, step, sd } = await openStep(tx, request, "procedure.act", true);
  if (step.status !== "active") throw refusal("procedure_step.not_active");
  if (sd.step_kind === "approval") throw refusal("procedure_step.decided_through_approval");
  const inputs = inputsOf(bundle.instance);
  const missing = missingStepInputs(inputs, sd);
  if (missing.length > 0) {
    const labels = new Map(inputSchemaOf(bundle.definition).map((f) => [f.key, f]));
    throw new MissingInputsProblem(
      missing.map((key) => ({
        key,
        labelEn: labels.get(key)?.labelEn ?? key,
        labelAr: labels.get(key)?.labelAr ?? key,
      })),
    );
  }
  if (sd.evidence_required && !bundle.links.some((l) => l.step_instance_id === step.id && l.link_kind === "evidence"))
    throw refusal("procedure_step.evidence_required");
  // The output (ADR-0042 §3): the adapter of its record type, else a generic `link`, else refused.
  let adopted: string | null = null;
  if (sd.output_record_type !== null && sd.output_mode !== null) {
    const adapter = OUTPUT_ADAPTERS.get(sd.output_record_type);
    let recordId: string;
    if (adapter !== undefined) {
      recordId = (
        await adapter.produce({
          tx,
          audit: acting.audit,
          principal: acting.principal,
          instance: bundle.instance,
          step,
          stepDefinition: sd,
          mode: sd.output_mode as ProcedureOutputContext["mode"],
          outputRecordId: body.outputRecordId ?? null,
          outputInput: body.outputInput ?? null,
          links: bundle.links,
        })
      ).recordId;
    } else if (sd.output_mode === "link" && (body.outputRecordId ?? null) !== null) {
      recordId = body.outputRecordId!;
      // F-DG5-101 (D-170): the kit's read rule also holds when no adapter verifies the record.
      await requireNamedRecordRead(tx, acting.principal, sd.output_record_type, recordId);
    } else {
      throw refusal("procedure_step.output_required");
    }
    await insertLink(tx, acting.audit, bundle.instance, step, "output", sd.output_record_type, recordId);
    adopted = sd.output_record_type === "transformation" ? recordId : null;
  }
  await updateStep(tx, acting.audit, step, "complete", {
    status: "completed",
    completed_by: acting.userId,
    completion_note: body.note ?? null,
    completed: true,
  });
  // D-166 Rule A: the intake's later steps adopt the transformation its capture step produced, before they activate.
  if (
    adopted !== null &&
    bundle.instance.transformation_id === null &&
    bundle.instance.procedure_code === INTAKE_PROCEDURE_CODE &&
    step.step_key === INTAKE_CAPTURE_STEP_KEY
  )
    await adoptIntakeTransformation(tx, acting.audit, await reload(tx, bundle), adopted);
  const advanced = await advance(tx, acting.audit, await reload(tx, bundle));
  return finish(tx, acting.audit, advanced, "step_complete");
}

async function skipStep(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const body = parseBody(procedureStepSkip, request.body);
  const { acting, bundle, step, sd } = await openStep(tx, request, "procedure.act", true);
  if (step.status !== "active") throw refusal("procedure_step.not_active");
  if (!sd.skippable || sd.step_kind === "approval") throw refusal("procedure_step.not_skippable");
  await updateStep(
    tx,
    acting.audit,
    step,
    "skip",
    { status: "skipped", skipped_by: acting.userId, skip_reason: body.reason },
    body.reason,
  );
  const advanced = await advance(tx, acting.audit, await reload(tx, bundle));
  return finish(tx, acting.audit, advanced, "step_skip");
}

async function assignStep(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const body = parseBody(procedureStepAssign, request.body);
  const { acting, bundle, step, sd } = await openStep(tx, request, "procedure.manage", false);
  if (!OPEN.has(step.status)) throw refusal("procedure_step.not_active");
  // An active approval step is decided by its business approver (the approval's assignee); the step row stays as
  // requested while the approval is open (the 0031 subject version), so it is not reassigned.
  if (sd.step_kind === "approval" && step.status === "active") throw refusal("procedure_step.decided_through_approval");
  const user = await tx
    .selectFrom("app_user")
    .select(["id", "status", "organization_id"])
    .where("id", "=", body.assigneeUserId)
    .executeTakeFirst();
  const grants = user === undefined ? [] : await loadGrants(tx, user.id);
  if (
    user === undefined ||
    user.status !== "active" ||
    user.organization_id !== bundle.instance.organization_id ||
    !holdsRoleIn(grants, step.assignee_role_code, "procedure.act", await stepRoleTarget(tx, bundle.instance, step))
  )
    throw new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "validation.user_invalid",
      title: "Business rule violated",
      detail: "The assignee must be an active user who holds the step's role in this scope.",
      errors: [
        { pointer: "/assigneeUserId", code: "validation.user_invalid", message: "Does not hold the step's role." },
      ],
    });
  if (step.assignee_user_id === body.assigneeUserId) return finish(tx, acting.audit, bundle, "step_assign");
  await updateStep(tx, acting.audit, step, "assign", { assignee_user_id: body.assigneeUserId });
  return finish(tx, acting.audit, await reload(tx, bundle), "step_assign");
}

async function linkEvidence(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const body = parseBody(procedureStepEvidence, request.body);
  const { acting, bundle, step } = await openStep(tx, request, "procedure.act", true);
  if (step.status !== "active") throw refusal("procedure_step.not_active");
  // D-167: an adopted step's evidence is evidence of T, the step's transformation (the 0069 link guard checks only the
  // organization for an organization-scope instance, so T is checked here).
  const t = bundle.instance.transformation_id ?? step.transformation_id;
  if (t === null) throw refusal("procedure_step.output_record_invalid");
  const ev = await tx
    .selectFrom("evidence")
    .select("transformation_id")
    .where("id", "=", body.evidenceId)
    .executeTakeFirst();
  if (bundle.instance.transformation_id === null && ev?.transformation_id !== t)
    throw refusal("procedure_step.output_record_invalid");
  // F-DG5-101's rule (D-170; T-DG5-BE-V2B): a person never links a record they cannot read. The evidence's own read
  // (transformation.read on its transformation, as the evidence GET checks it), on the grants authorizeStepWrite
  // reloaded in this transaction, after openStep's locks; refused like an unknown evidence record, with the read
  // gate's denial for the failed-mutation audit (`authorization.denied`). An unknown id is left to the link guard.
  if (ev !== undefined) await requireOutputRead(tx, acting.principal, ev.transformation_id);
  await insertLink(tx, acting.audit, bundle.instance, step, "evidence", "evidence", body.evidenceId);
  return finish(tx, acting.audit, await reload(tx, bundle), "step_evidence");
}

// ------------------------------------------------------------------------------------------------ approval outcome

/**
 * workflows' `onOutcome` for `procedure_step` approvals, inside the DECIDING transaction: on `approved` the active step
 * completes with the approval (its `approval` output links the approval itself; another output goes through its
 * adapter when one is registered), and the instance advances. Every other outcome leaves the step active, waiting.
 */
async function onApprovalOutcome(tx: Tx, event: ProcedureApprovalOutcome): Promise<void> {
  if (event.outcome !== "approved") return;
  const step0 = await tx
    .selectFrom("procedure_step_instance")
    .selectAll()
    .where("id", "=", event.approval.subject_id)
    .executeTakeFirst();
  if (step0 === undefined) return;
  const i = await lockAndLoad(tx, step0.procedure_instance_id);
  const bundle = await loadBundle(tx, i);
  const step = bundle.steps.find((s) => s.id === step0.id);
  const sd = step === undefined ? undefined : bundle.stepDefinitions.get(step.step_definition_id);
  if (i.status !== "active" || step === undefined || sd === undefined || step.status !== "active") return;
  const audit = event.audit;
  if (sd.output_record_type === "approval") {
    await insertLink(tx, audit, i, step, "output", "approval", event.approval.id);
  } else if (sd.output_record_type !== null && sd.output_mode !== null) {
    const adapter = OUTPUT_ADAPTERS.get(sd.output_record_type);
    if (adapter !== undefined) {
      const out = await adapter.produce({
        tx,
        audit,
        principal: null,
        instance: i,
        step,
        stepDefinition: sd,
        mode: sd.output_mode as ProcedureOutputContext["mode"],
        outputRecordId: null,
        outputInput: null,
        links: bundle.links,
      });
      await insertLink(tx, audit, i, step, "output", sd.output_record_type, out.recordId);
    }
  }
  await updateStep(tx, audit, step, "complete", {
    status: "completed",
    completed_by: event.actorUserId,
    approval_id: event.approval.id,
    completed: true,
  });
  const advanced = await advance(tx, audit, await reload(tx, bundle));
  await finish(tx, audit, advanced, "step_approved");
}

// ------------------------------------------------------------------------------------------------ routes

const STEP = "/api/v1/procedure-instances/:instanceId/steps/:stepKey";
const JSON_BODY = ["application/json"] as const;

export function registerProcedureStepRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const act = { access: { permission: "procedure.act" as const }, consumes: JSON_BODY };
  const manage = { access: { permission: "procedure.manage" as const }, consumes: JSON_BODY };
  const route = (
    path: string,
    config: typeof act | typeof manage,
    run: (tx: Tx, request: FastifyRequest) => Promise<InstanceBundle>,
  ) =>
    app.post(path, { config }, async (request, reply) => {
      const b = await db.transaction().execute((tx) => run(tx, request));
      return sendVersioned(reply, 200, await presentInstance(db, b));
    });
  route(`${STEP}/complete`, act, completeStep);
  route(`${STEP}/skip`, act, skipStep);
  route(`${STEP}/assign`, manage, assignStep);
  route(`${STEP}/evidence`, act, linkEvidence);
  return [`POST ${STEP}/complete`, `POST ${STEP}/skip`, `POST ${STEP}/assign`, `POST ${STEP}/evidence`];
}

// ------------------------------------------------------------------------------------------------ for instances.ts

export { bumpInstance, insertLink, updateStep, reload, OPEN };
