// The product-gate engine (ADR-0015 §2; REQ-PB-016/017/018, REQ-S04-003/004/005, REQ-S13-012, REQ-DLV-034):
//   GET   /transformations/{id}/gates                                  the six gates with live readiness
//   GET   /transformations/{id}/gates/{gateCode}                       one gate, LIVE evaluation of every criterion
//   PATCH /transformations/{id}/gates/{gateCode}                       configure the approver (gate.configure)
//   GET   .../gates/{gateCode}/submissions[/{submissionNo}]            submission history / one frozen submission
//   POST  .../gates/{gateCode}/submissions                             submit (gate.submit): submission N+1, frozen
//   POST  .../gates/{gateCode}/decision                                the BUSINESS decision by the configured approver
//
// G1-G6 are business approvals inside the product, made by people. Nothing here reads or writes the engineering
// delivery gates DG0-DG7, and no product gate implies one (G6 never implies DG7). The API never approves by itself:
// a decision is always a named person's request with a rationale. Checks are enforced again in the database
// (gate_decision_guard: submitter never decides, only the current pending submission; criterion CHECK on submit).
// P3 (T-DG3-BE-A, ADR-0021 §8; REQ-PB-022, B0032): approving G1 needs the three leadership agreement confirmations
// (problem, baseline, material value pools), stored as gate_decision_agreement rows in the approving transaction and
// enforced at COMMIT by migration 0025; G4 submissions add the G4 snapshot built by g4.ts (GateFactsProvider).
import { createHash } from "node:crypto";
import {
  sql,
  type Db,
  type DbOrTx,
  type GateDecisionRow,
  type GateInstanceRow,
  type GateSubmissionRow,
  type Tx,
} from "@mth/db";
import { PHASES, type Phase, type Permission } from "@mth/shared";
import {
  GATE_AGREEMENT_CODES,
  gateApproverConfig,
  gateDecisionCreate,
  gateSubmissionCreate,
  type GateAgreementRecord,
  type GateCriterionEvaluation,
  type GateDecision,
  type GateDefinition,
  type GateInheritedApproval,
  type GateInstance,
  type GateSubmission,
  truncateText,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsOnBehalfOf,
  auditContextOf,
  authorize,
  denialOf,
  grantApplies,
  holds,
  loadGrants,
  principalOf,
  requireTransformationRead,
  technicalAdminRefusal,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { loadGateDefinitions } from "../methodology/index.ts";
import {
  canonicalJson,
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
  advancePhaseOnGateApproval,
  assertActiveUsers,
  bumpStamps,
  openWrite,
  ruleProblem,
  writableTransformation,
} from "../transformations/index.ts";
import { nextCode } from "./codes.ts";
import { evaluateGate, loadGateFacts, type GateFacts } from "./criteria.ts";
import { buildG4Snapshot, type GateFactsProvider, type InheritedApprovalFact } from "./g4.ts";

const G = "/api/v1/transformations/:transformationId/gates";
const tParams = z.strictObject({ transformationId: z.uuid() });
const gParams = z.strictObject({ transformationId: z.uuid(), gateCode: z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]) });
const sParams = gParams.extend({ submissionNo: z.coerce.number().int().min(1) });

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

// ------------------------------------------------------------------------------------------------ shapes

const newestFirst = (a: string, b: string) => (a === b ? 0 : a < b ? 1 : -1);

/**
 * The inherited-approval annotation of one gate (ADR-0021 §5; F-DG3-120), from the transformation's inherited-approval
 * dispensations: the one that counts, else the newest pending one, else the newest; null when there is none. `pending`
 * is shown as pending_verification. It never touches the gate's status: the gate stays as recorded (e.g. draft).
 */
export function inheritedApprovalOf(
  facts: readonly InheritedApprovalFact[],
  gateCode: string,
): GateInheritedApproval | null {
  const mine = facts
    .filter((f) => f.gateCode === gateCode)
    .sort((a, b) => newestFirst(a.createdAt, b.createdAt) || newestFirst(a.dispensationId, b.dispensationId));
  const shown = mine.find((f) => f.counts) ?? mine.find((f) => f.status === "pending") ?? mine[0];
  if (shown === undefined) return null;
  return {
    dispensationId: shown.dispensationId,
    status: shown.status === "pending" ? "pending_verification" : shown.status,
    counts: shown.counts,
    approvingBody: shown.approvingBody,
    approvedOn: shown.approvedOn,
  };
}

export const toGateInstance = (
  r: GateInstanceRow,
  inheritedApproval: GateInheritedApproval | null = null,
): GateInstance => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  gateCode: r.gate_code,
  status: r.status as GateInstance["status"],
  approverRoleCode: r.approver_role_code,
  approverUserId: r.approver_user_id,
  currentSubmissionId: r.current_submission_id,
  latestSubmissionNo: r.latest_submission_no,
  approvedAt: isoOrNull(r.approved_at),
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
  inheritedApproval,
});

export const toGateSubmission = (r: GateSubmissionRow): GateSubmission => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  gateInstanceId: r.gate_instance_id,
  gateCode: r.gate_code,
  submissionNo: r.submission_no,
  status: r.status as GateSubmission["status"],
  submittedBy: r.submitted_by,
  submittedAt: iso(r.submitted_at),
  submissionNote: r.submission_note,
  approverRoleCode: r.approver_role_code,
  approverUserId: r.approver_user_id,
  dueDate: r.due_date,
  charterId: r.charter_id,
  charterVersionNo: r.charter_version_no,
  snapshot: r.snapshot as Record<string, unknown>,
  snapshotSha256: r.snapshot_sha256,
  supersededAt: isoOrNull(r.superseded_at),
  supersededBySubmissionId: r.superseded_by_submission_id,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** The B0032 confirmations of a gate decision (ADR-0021 §8): three rows for an approved G1 decision, none otherwise. */
async function agreementsOf(db: DbOrTx, gateDecisionId: string): Promise<GateAgreementRecord[]> {
  const rows = await db
    .selectFrom("gate_decision_agreement")
    .select(["agreement_code", "confirmed_by", "confirmed_at"])
    .where("gate_decision_id", "=", gateDecisionId)
    .execute();
  return GATE_AGREEMENT_CODES.flatMap((code) =>
    rows
      .filter((r) => r.agreement_code === code)
      .map((r) => ({ agreementCode: code, confirmedBy: r.confirmed_by, confirmedAt: iso(r.confirmed_at) })),
  );
}

export const toGateDecision = (r: GateDecisionRow, agreements: readonly GateAgreementRecord[] = []): GateDecision => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  gateSubmissionId: r.gate_submission_id,
  decisionId: r.decision_id,
  decisionKind: "gate",
  gateCode: r.gate_code,
  submissionNo: r.submission_no,
  outcome: r.outcome as GateDecision["outcome"],
  rationale: r.rationale,
  comments: r.comments,
  decidedBy: r.decided_by,
  onBehalfOfUserId: r.on_behalf_of_user_id,
  decidedAt: iso(r.decided_at),
  approverBasis: r.approver_basis as GateDecision["approverBasis"],
  approverRoleCode: r.approver_role_code,
  agreements: [...agreements],
});

// ------------------------------------------------------------------------------------------------ approver rules

/** The approver a submission resolves to (ADR-0015 §2 step 1). */
interface Approver {
  readonly roleCode: string;
  readonly userId: string | null;
  readonly basis: "configured_user" | "configured_role" | "default_role";
}
function approverOf(
  instance: { approver_role_code: string; approver_user_id: string | null },
  def: GateDefinition,
): Approver {
  if (instance.approver_user_id !== null)
    return { roleCode: instance.approver_role_code, userId: instance.approver_user_id, basis: "configured_user" };
  return {
    roleCode: instance.approver_role_code,
    userId: null,
    basis: instance.approver_role_code === def.defaultApproverRoleCode ? "default_role" : "configured_role",
  };
}

/** Does `userGrants` hold the approver role WITH gate.decide on the transformation? (no title ever implies it) */
function holdsApproverRole(
  grants: readonly Parameters<typeof grantApplies>[0][],
  roleCode: string,
  target: ResolvedTarget,
): boolean {
  return grants.some((g) => g.roleCode === roleCode && grantApplies(g, "gate.decide", target));
}

/**
 * Is `principal` (or the person they act for) the configured approver? Decided through the policy function: the
 * caller (or the delegator) must hold gate.decide on the transformation (an auditor or technical admin never does),
 * and be the named approver or hold the approver role there.
 */
async function isApprover(
  db: DbOrTx,
  principal: Principal,
  approver: Approver,
  target: ResolvedTarget,
  onBehalfOf: string | undefined,
): Promise<boolean> {
  if (onBehalfOf !== undefined) {
    if (!(await actsOnBehalfOf(db, principal, onBehalfOf, "gate", target))) return false;
    const grants = await loadGrants(db, onBehalfOf);
    const canDecide = grants.some((g) => grantApplies(g, "gate.decide", target));
    if (!canDecide) return false;
    return approver.userId !== null
      ? approver.userId === onBehalfOf
      : holdsApproverRole(grants, approver.roleCode, target);
  }
  const d = await authorize(db, principal, "gate.decide", target);
  if (!d.allowed) return false;
  return approver.userId !== null
    ? approver.userId === principal.userId
    : holdsApproverRole(principal.grants, approver.roleCode, target);
}

/**
 * Is `principal` the configured approver of the transformation's gate (named user, or a holder of the approver role
 * with gate.decide there)? Used by gate dispensations (ADR-0021 §5: a waiver is granted by the waived gate's approver).
 * In person only: delegation is not considered here.
 */
export async function isGateApprover(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  gateCode: string,
  target: ResolvedTarget,
): Promise<boolean> {
  const def = (await loadGateDefinitions(db)).find((d) => d.code === gateCode);
  if (!def) return false;
  const instance = await db
    .selectFrom("gate_instance")
    .select(["approver_role_code", "approver_user_id"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirst();
  if (!instance) return false;
  return isApprover(db, principal, approverOf(instance, def), target, undefined);
}

// ------------------------------------------------------------------------------------------------ views

async function instanceOf(db: DbOrTx, transformationId: string, gateCode: string, forUpdate = false) {
  let q = db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function gateView(
  db: DbOrTx,
  principal: Principal,
  target: ResolvedTarget,
  instance: GateInstanceRow,
  def: GateDefinition,
  facts: GateFacts,
  defs: readonly GateDefinition[],
  inherited: readonly InheritedApprovalFact[],
) {
  const criteria: GateCriterionEvaluation[] = evaluateGate(def, facts);
  const current = instance.current_submission_id
    ? await db
        .selectFrom("gate_submission")
        .selectAll()
        .where("id", "=", instance.current_submission_id)
        .executeTakeFirst()
    : undefined;
  const pending = current?.status === "pending" ? current : undefined;
  const allComplete = criteria.every((c) => !c.mandatory || c.completeness === "complete");
  const canSubmit =
    def.submissionEnabled &&
    instance.status !== "approved" &&
    allComplete &&
    (await sequenceProblem(db, instance.transformation_id, def, defs)) === null &&
    (await holds(db, principal, "gate.submit", target));
  const canDecide =
    pending !== undefined &&
    pending.submitted_by !== principal.userId &&
    (await isApprover(db, principal, approverOf(pending, def), target, undefined));
  return {
    gate: toGateInstance(instance, inheritedApprovalOf(inherited, instance.gate_code)),
    definition: def,
    criteria,
    currentSubmission: current ? toGateSubmission(current) : null,
    submissionEnabled: def.submissionEnabled,
    canSubmit,
    canDecide,
  };
}

/**
 * Sequence integrity (B0009 "Run Phases 1-6 sequentially", B0023; F-DG2-205, REQ-S04-005): a gate can be submitted or
 * approved only after the PRECEDING gate is approved and once the transformation has reached the gate's own phase.
 * A Modular transformation starts at its entry phase, so gates closing phases before it are not required. Returns the
 * 422 problem, or null when the gate is in sequence.
 */
async function sequenceProblem(
  db: DbOrTx,
  transformationId: string,
  def: GateDefinition,
  defs: readonly GateDefinition[],
): Promise<HttpProblem | null> {
  const t = await db
    .selectFrom("transformation")
    .select(["mode", "entry_phase", "current_phase"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) return problems.notFound();
  const entryIdx = t.mode === "modular" && t.entry_phase !== null ? PHASES.indexOf(t.entry_phase as Phase) : 0;
  const previous = defs.find((d) => d.ordinal === def.ordinal - 1);
  if (previous && PHASES.indexOf(previous.phase) >= entryIdx) {
    const prev = await db
      .selectFrom("gate_instance")
      .select("status")
      .where("transformation_id", "=", transformationId)
      .where("gate_code", "=", previous.code)
      .executeTakeFirst();
    if (prev?.status !== "approved")
      return problems.businessRule(
        "gate.out_of_sequence",
        `${def.code} follows ${previous.code}: ${previous.code} must be approved first (phases run in sequence).`,
      );
  }
  if (PHASES.indexOf(t.current_phase as Phase) < PHASES.indexOf(def.phase))
    return problems.businessRule(
      "gate.out_of_sequence",
      `${def.code} closes the ${def.phase} phase; the transformation is still in ${t.current_phase}.`,
    );
  return null;
}

function definitionOf(defs: readonly GateDefinition[], gateCode: string): GateDefinition {
  const def = defs.find((d) => d.code === gateCode);
  if (!def) throw problems.notFound();
  return def;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerGateRoutes(app: FastifyInstance, db: Db, gateFacts: GateFactsProvider): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(G, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const principal = principalOf(request);
    const target = await requireTransformationRead(db, principal, transformationId);
    const defs = await loadGateDefinitions(db);
    const instances = await db
      .selectFrom("gate_instance")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .execute();
    const facts = await loadGateFacts(db, transformationId, gateFacts);
    const inherited = await gateFacts.inheritedApprovals(db, transformationId);
    const items = [];
    for (const def of defs) {
      const instance = instances.find((i) => i.gate_code === def.code);
      if (!instance) throw problems.notFound();
      items.push(await gateView(db, principal, target, instance, def, facts, defs, inherited));
    }
    return { items };
  });

  app.get(`${G}/:gateCode`, { config: read }, async (request, reply) => {
    const { transformationId, gateCode } = parse(gParams, request.params, "params");
    const principal = principalOf(request);
    const target = await requireTransformationRead(db, principal, transformationId);
    const defs = await loadGateDefinitions(db);
    const def = definitionOf(defs, gateCode);
    const instance = await instanceOf(db, transformationId, gateCode);
    const view = await gateView(
      db,
      principal,
      target,
      instance,
      def,
      await loadGateFacts(db, transformationId, gateFacts),
      defs,
      await gateFacts.inheritedApprovals(db, transformationId),
    );
    reply.header("ETag", `"${instance.version}"`);
    return view;
  });

  app.patch(`${G}/:gateCode`, { config: { access: { permission: "gate.configure" } } }, async (request, reply) => {
    const { transformationId, gateCode } = parse(gParams, request.params, "params");
    const instance = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate.configure" }], null);
      const body = parseBody(gateApproverConfig, request.body);
      const def = definitionOf(await loadGateDefinitions(tx), gateCode);
      const expected = requireIfMatch(request);
      const current = await instanceOf(tx, transformationId, gateCode, true);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const pending = await tx
        .selectFrom("gate_submission")
        .select("id")
        .where("gate_instance_id", "=", current.id)
        .where("status", "=", "pending")
        .executeTakeFirst();
      if (pending)
        throw problems.businessRule(
          "gate.submission_pending",
          "The approver cannot change while a submission is pending a decision.",
        );
      if (!def.allowedApproverRoleCodes.includes(body.approverRoleCode))
        throw ruleProblem(
          "gate.approver_role_not_allowed",
          "This role is not an allowed approver for the gate.",
          "/approverRoleCode",
        );
      const named = body.approverUserId ?? null;
      if (named !== null) {
        await assertActiveUsers(tx, ctx.organizationId, [{ id: named, pointer: "/approverUserId" }]);
        // A named approver must hold the approver role, with gate.decide, on this transformation.
        if (!holdsApproverRole(await loadGrants(tx, named), body.approverRoleCode, ctx.target))
          throw ruleProblem(
            "gate.approver_not_role_holder",
            "The named approver must hold the approver role on this transformation.",
            "/approverUserId",
          );
      }
      const updated = await tx
        .updateTable("gate_instance")
        .set({ approver_role_code: body.approverRoleCode, approver_user_id: named, ...bumpStamps(ctx.userId) })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "gate_instance.configure",
        recordType: "gate_instance",
        recordId: current.id,
        organizationId: ctx.organizationId,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: {
          approverRoleCode: { from: current.approver_role_code, to: updated.approver_role_code },
          approverUserId: { from: current.approver_user_id, to: updated.approver_user_id },
        },
      });
      return updated;
    });
    const principal = principalOf(request);
    const target = await requireTransformationRead(db, principal, transformationId);
    const defs = await loadGateDefinitions(db);
    const def = definitionOf(defs, gateCode);
    reply.header("ETag", `"${instance.version}"`);
    return gateView(
      db,
      principal,
      target,
      instance,
      def,
      await loadGateFacts(db, transformationId, gateFacts),
      defs,
      await gateFacts.inheritedApprovals(db, transformationId),
    );
  });

  app.get(`${G}/:gateCode/submissions`, { config: read }, async (request) => {
    const { transformationId, gateCode } = parse(gParams, request.params, "params");
    const query = parseQuery(z.strictObject({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const instance = await instanceOf(db, transformationId, gateCode);
    const hash = filterHash({ gate: instance.id });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("gate_submission").selectAll().where("gate_instance_id", "=", instance.id);
    if (after) q = q.where("submission_no", "<", Number(after[0]));
    const rows = await q
      .orderBy("submission_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.submission_no], hash);
    return { items: page.items.map(toGateSubmission), nextCursor: page.nextCursor };
  });

  app.get(`${G}/:gateCode/submissions/:submissionNo`, { config: read }, async (request) => {
    const { transformationId, gateCode, submissionNo } = parse(sParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const instance = await instanceOf(db, transformationId, gateCode);
    const submission = await db
      .selectFrom("gate_submission")
      .selectAll()
      .where("gate_instance_id", "=", instance.id)
      .where("submission_no", "=", submissionNo)
      .executeTakeFirst();
    if (!submission) throw problems.notFound();
    const criteria = await db
      .selectFrom("gate_submission_criterion")
      .selectAll()
      .where("gate_submission_id", "=", submission.id)
      .orderBy("ordinal")
      .execute();
    const decision = await db
      .selectFrom("gate_decision")
      .selectAll()
      .where("gate_submission_id", "=", submission.id)
      .executeTakeFirst();
    return {
      submission: toGateSubmission(submission),
      criteria: criteria.map((c) => ({
        id: c.id,
        organizationId: c.organization_id,
        transformationId: c.transformation_id,
        gateSubmissionId: c.gate_submission_id,
        criterionKey: c.criterion_key,
        ordinal: c.ordinal,
        mandatory: c.mandatory,
        completeness: c.completeness as "complete" | "incomplete",
        detail: c.detail as Record<string, unknown>,
        evaluatedAt: iso(c.evaluated_at),
      })),
      decision: decision ? toGateDecision(decision, await agreementsOf(db, decision.id)) : null,
    };
  });

  app.post(
    `${G}/:gateCode/submissions`,
    { config: { access: { permission: "gate.submit" } } },
    async (request, reply) => {
      const { transformationId, gateCode } = parse(gParams, request.params, "params");
      const submission = await db
        .transaction()
        .execute((tx) => submitGate(tx, request, transformationId, gateCode, gateFacts));
      return sendVersioned(
        reply,
        201,
        toGateSubmission(submission),
        `/api/v1/transformations/${transformationId}/gates/${gateCode}/submissions/${submission.submission_no}`,
      );
    },
  );

  app.post(`${G}/:gateCode/decision`, { config: { access: { permission: "gate.decide" } } }, async (request, reply) => {
    const { transformationId, gateCode } = parse(gParams, request.params, "params");
    const { row, agreements } = await db
      .transaction()
      .execute((tx) => decideGate(tx, request, transformationId, gateCode));
    reply.header(
      "Location",
      `/api/v1/transformations/${transformationId}/gates/${gateCode}/submissions/${row.submission_no}`,
    );
    return reply.code(201).send(toGateDecision(row, agreements));
  });

  return [
    `GET ${G}`,
    `GET ${G}/:gateCode`,
    `PATCH ${G}/:gateCode`,
    `GET ${G}/:gateCode/submissions`,
    `POST ${G}/:gateCode/submissions`,
    `GET ${G}/:gateCode/submissions/:submissionNo`,
    `POST ${G}/:gateCode/decision`,
  ];
}

// ------------------------------------------------------------------------------------------------ submit

async function submitGate(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  gateCode: string,
  gateFacts: GateFactsProvider,
) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate.submit" }], null);
  const body = parseBody(gateSubmissionCreate, request.body);
  const def = definitionOf(await loadGateDefinitions(tx), gateCode);
  if (!def.submissionEnabled)
    throw problems.businessRule("gate_not_enabled", `${gateCode} cannot be submitted in this release.`);
  const expected = requireIfMatch(request);
  const instance = await instanceOf(tx, transformationId, gateCode, true);
  if (instance.version !== expected) throw problems.versionConflict(instance.version);
  if (instance.status === "approved")
    throw problems.businessRule("gate.already_approved", "This gate is already approved; it cannot be resubmitted.");
  const outOfSequence = await sequenceProblem(tx, transformationId, def, await loadGateDefinitions(tx));
  if (outOfSequence) throw outOfSequence;

  // Re-evaluate every criterion INSIDE this transaction and freeze the result (ADR-0015 §2 step 2).
  const facts = await loadGateFacts(tx, transformationId, gateFacts);
  const criteria = evaluateGate(def, facts);
  const incomplete = criteria.filter((c) => c.mandatory && c.completeness === "incomplete");
  if (incomplete.length > 0)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "gate_criteria_incomplete",
      title: "Business rule violated",
      detail: `Mandatory required outputs are incomplete: ${incomplete.map((c) => c.key).join(", ")}.`,
      errors: incomplete.map((c) => ({
        pointer: `/criteria/${c.key}`,
        code: c.missing[0]?.code ?? "gate.criterion_incomplete",
        message: c.missing.map((m) => m.message).join(" "),
      })),
    });

  const transformation = await tx
    .selectFrom("transformation")
    .select(["id", "code", "name", "current_phase", "version"])
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const approver = approverOf(instance, def);
  const submissionNo = instance.latest_submission_no + 1;
  const id = uuidv7();
  // P3 (ADR-0021 §7): the G4 snapshot (in-scope initiatives, ranking, weight set, cases, formulas, funding, demand,
  // waves) built by g4.ts through the GateFactsProvider. Only G4 calls it, so G1-G3 snapshots stay byte-stable.
  const g4 = gateCode === "G4" ? await buildG4Snapshot(tx, gateFacts, transformationId) : null;
  const snapshot = {
    schema: "mth.gate-submission/1",
    gateCode,
    submissionNo,
    transformation: {
      id: transformation.id,
      code: transformation.code,
      name: transformation.name,
      currentPhase: transformation.current_phase,
      version: transformation.version,
    },
    charter: facts.charter ? { id: facts.charter.id, versionNo: facts.charter.version } : null,
    northStar: facts.northStar,
    approver,
    criteria: criteria.map((c) => ({
      key: c.key,
      completeness: c.completeness,
      missing: c.missing,
      unverifiedEvidenceIds: c.unverifiedEvidenceIds,
    })),
    evidence: facts.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      record: `${e.recordType}:${e.recordId}`,
      verified: e.verified,
    })),
    ...(g4 !== null ? { g4 } : {}),
    note: "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7.",
  };
  const snapshotJson = canonicalJson(snapshot);
  const sha = createHash("sha256").update(snapshotJson).digest("hex");
  const pending = await tx
    .selectFrom("gate_submission")
    .selectAll()
    .where("gate_instance_id", "=", instance.id)
    .where("status", "=", "pending")
    .executeTakeFirst();

  // One statement supersedes the pending submission AND inserts N+1, so the one-pending index and the
  // superseded_by foreign key both hold at the end of the statement.
  // Every value is cast: inside INSERT ... SELECT FROM (VALUES ...) untyped parameters would resolve to text.
  const values = sql`(${id}::uuid, ${ctx.organizationId}::uuid, ${transformationId}::uuid, ${instance.id}::uuid,
      ${gateCode}::text, ${submissionNo}::integer, ${ctx.userId}::uuid, ${body.submissionNote ?? null}::text,
      ${approver.roleCode}::text, ${approver.userId}::uuid, ${body.dueDate ?? null}::date,
      ${facts.charter?.id ?? null}::uuid, ${facts.charter?.version ?? null}::integer, ${snapshotJson}::jsonb,
      ${sha}::char(64), ${ctx.userId}::uuid, ${ctx.userId}::uuid)`;
  const columns = sql`(id, organization_id, transformation_id, gate_instance_id, gate_code, submission_no, submitted_by,
      submission_note, approver_role_code, approver_user_id, due_date, charter_id, charter_version_no, snapshot,
      snapshot_sha256, created_by, updated_by)`;
  if (pending) {
    await sql`WITH superseded AS (
        UPDATE gate_submission SET status = 'superseded', superseded_at = now(), superseded_by_submission_id = ${id}::uuid,
               version = version + 1, updated_at = now(), updated_by = ${ctx.userId}::uuid
         WHERE id = ${pending.id}::uuid AND status = 'pending' RETURNING id)
      INSERT INTO gate_submission ${columns} SELECT * FROM (VALUES ${values}) v WHERE EXISTS (SELECT 1 FROM superseded)`.execute(
      tx,
    );
    await record(tx, ctx.audit, {
      action: "gate_submission.supersede",
      recordType: "gate_submission",
      recordId: pending.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: pending.version,
      newVersion: pending.version + 1,
      changes: {
        status: { from: "pending", to: "superseded" },
        supersededBySubmissionNo: { from: null, to: submissionNo },
      },
    });
  } else {
    await sql`INSERT INTO gate_submission ${columns} VALUES ${values}`.execute(tx);
  }
  const submission = await tx.selectFrom("gate_submission").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_submission.create",
    recordType: "gate_submission",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      gateCode: { from: null, to: gateCode },
      submissionNo: { from: null, to: submissionNo },
      snapshotSha256: { from: null, to: sha },
      charterVersionNo: { from: null, to: facts.charter?.version ?? null },
    },
  });
  for (const c of criteria) {
    await tx
      .insertInto("gate_submission_criterion")
      .values({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        gate_submission_id: id,
        criterion_key: c.key,
        ordinal: c.ordinal,
        mandatory: c.mandatory,
        completeness: c.completeness,
        detail: JSON.stringify({ missing: c.missing, unverifiedEvidenceIds: c.unverifiedEvidenceIds }),
      })
      .execute();
  }
  const updated = await tx
    .updateTable("gate_instance")
    .set({
      status: "submitted",
      current_submission_id: id,
      latest_submission_no: submissionNo,
      approved_at: null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", instance.id)
    .where("version", "=", instance.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_instance.submit",
    recordType: "gate_instance",
    recordId: instance.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: instance.version,
    newVersion: updated.version,
    changes: {
      status: { from: instance.status, to: "submitted" },
      latestSubmissionNo: { from: instance.latest_submission_no, to: submissionNo },
    },
  });
  return submission;
}

// ------------------------------------------------------------------------------------------------ decide

async function decideGate(tx: Tx, request: FastifyRequest, transformationId: string, gateCode: string) {
  const principal = principalOf(request);
  // 1. The caller can read the transformation (404 otherwise; REQ-S10-003/D-094: 403 for a technical-admin-only caller).
  let target: ResolvedTarget;
  try {
    target = await requireTransformationRead(tx, principal, transformationId);
  } catch (err) {
    throw technicalAdminRefusal(principal, err, "gate.decide");
  }
  const defs = await loadGateDefinitions(tx);
  const def = definitionOf(defs, gateCode);
  const instance = await instanceOf(tx, transformationId, gateCode, true);
  const pending = await tx
    .selectFrom("gate_submission")
    .selectAll()
    .where("gate_instance_id", "=", instance.id)
    .where("status", "=", "pending")
    .forUpdate()
    .executeTakeFirst();
  const raw = (request.body ?? {}) as { onBehalfOfUserId?: unknown };
  const onBehalfOf = typeof raw.onBehalfOfUserId === "string" ? raw.onBehalfOfUserId : undefined;
  // 2. Only the configured approver (named user, or a holder of the approver role with gate.decide), or their
  //    delegate. Technical admins and read-only auditors never hold gate.decide.
  const approver = approverOf(pending ?? instance, def);
  if (!(await isApprover(tx, principal, approver, target, onBehalfOf)))
    throw forbidden("gate.not_approver", "Only the configured approver of this gate can decide it.").withDenial(
      denialOf("gate.decide", target),
    );
  // 3. Separation of duties: the submitter (or someone acting for them) never decides (also gate_decision_guard).
  if (pending && (pending.submitted_by === principal.userId || pending.submitted_by === onBehalfOf))
    throw forbidden(
      "gate.submitter_cannot_decide",
      "The person who submitted the gate cannot decide it (separation of duties).",
    ).withDenial(denialOf("gate.decide", target));
  const body = parseBody(decisionRequest, request.body);
  // 4. Only the current PENDING submission can be decided; nothing is written otherwise.
  if (!pending || pending.submission_no !== body.submissionNo)
    throw new HttpProblem({
      status: 409,
      type: "urn:mth:problem:version-conflict",
      code: "gate.submission_superseded",
      title: "Version conflict",
      detail: pending
        ? `Submission ${body.submissionNo} is not the current pending submission (${pending.submission_no}).`
        : "There is no pending submission to decide.",
      currentVersion: pending?.submission_no ?? Math.max(instance.latest_submission_no, 1),
    });
  // 4a. P3 (ADR-0021 §8; REQ-PB-022, B0032): after checks 1-4, the G1 leadership agreements. Nothing is written.
  const agreed = agreementRule(gateCode, body);
  // 5. Sequence: an approval never skips a phase or a preceding gate (F-DG2-205); nothing is written otherwise.
  if (body.outcome === "approved") {
    const outOfSequence = await sequenceProblem(tx, transformationId, def, defs);
    if (outOfSequence) throw outOfSequence;
  }
  const t = await writableTransformation(tx, transformationId);
  const audit: AuditContext = { ...auditContextOf(request), ...(onBehalfOf ? { onBehalfOfUserId: onBehalfOf } : {}) };
  const userId = principal.userId!;

  // The canonical decision row (kind gate, GD-nn) behind the gate decision (one decision model, ADR-0015 §1).
  const decisionId = uuidv7();
  const code = await nextCode(tx, transformationId, "GD");
  await tx
    .insertInto("decision")
    .values({
      id: decisionId,
      organization_id: t.organization_id,
      transformation_id: transformationId,
      kind: "gate",
      code,
      title: `${def.sourceNameEn}: submission ${pending.submission_no}`,
      context: pending.submission_note,
      owner_user_id: onBehalfOf ?? userId,
      status: "decided",
      // F-DG2-260: cut on a code-point boundary (a rationale of up to 8000 characters plus the outcome prefix).
      outcome_text: truncateText(`${body.outcome}: ${body.rationale}`, 8000),
      decided_by: userId,
      decided_at: sql<Date>`now()`,
      created_by: userId,
      updated_by: userId,
    })
    .execute();
  await record(tx, audit, {
    action: "decision.create",
    recordType: "decision",
    recordId: decisionId,
    organizationId: t.organization_id,
    transformationId,
    newVersion: 1,
    reason: body.rationale,
    changes: {
      kind: { from: null, to: "gate" },
      code: { from: null, to: code },
      outcome: { from: null, to: body.outcome },
    },
  });
  const gateDecisionId = uuidv7();
  const row = await tx
    .insertInto("gate_decision")
    .values({
      id: gateDecisionId,
      organization_id: t.organization_id,
      transformation_id: transformationId,
      gate_submission_id: pending.id,
      decision_id: decisionId,
      gate_code: gateCode,
      submission_no: pending.submission_no,
      outcome: body.outcome,
      rationale: body.rationale,
      comments: body.comments ?? null,
      decided_by: userId,
      on_behalf_of_user_id: onBehalfOf ?? null,
      approver_basis: approver.basis,
      approver_role_code: approver.roleCode,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "gate_decision.create",
    recordType: "gate_decision",
    recordId: gateDecisionId,
    organizationId: t.organization_id,
    transformationId,
    reason: body.rationale,
    changes: {
      gateCode: { from: null, to: gateCode },
      submissionNo: { from: null, to: pending.submission_no },
      outcome: { from: null, to: body.outcome },
      approverBasis: { from: null, to: approver.basis },
      ...(agreed ? { agreements: { from: null, to: [...GATE_AGREEMENT_CODES] } } : {}),
    },
  });
  // The three B0032 confirmations of an approved G1 decision, confirmed by the decider (0024 guard), in THIS
  // transaction; the deferred 0025 guard refuses the COMMIT of an approved G1 decision without exactly these three.
  if (agreed)
    for (const code of GATE_AGREEMENT_CODES)
      await tx
        .insertInto("gate_decision_agreement")
        .values({
          id: uuidv7(),
          organization_id: t.organization_id,
          transformation_id: transformationId,
          gate_decision_id: gateDecisionId,
          agreement_code: code,
          confirmed_by: userId,
        })
        .execute();
  await tx
    .updateTable("gate_submission")
    .set({ status: "decided", ...bumpStamps(userId) })
    .where("id", "=", pending.id)
    .where("version", "=", pending.version)
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "gate_submission.decide",
    recordType: "gate_submission",
    recordId: pending.id,
    organizationId: t.organization_id,
    transformationId,
    priorVersion: pending.version,
    newVersion: pending.version + 1,
    changes: { status: { from: "pending", to: "decided" } },
  });
  const updated = await tx
    .updateTable("gate_instance")
    .set({
      status: body.outcome,
      approved_at: body.outcome === "approved" ? sql<Date>`now()` : null,
      ...bumpStamps(userId),
    })
    .where("id", "=", instance.id)
    .where("version", "=", instance.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "gate_instance.decide",
    recordType: "gate_instance",
    recordId: instance.id,
    organizationId: t.organization_id,
    transformationId,
    priorVersion: instance.version,
    newVersion: updated.version,
    reason: body.rationale,
    changes: { status: { from: instance.status, to: body.outcome } },
  });
  // Approval advances the phase by exactly one step (G1 diagnose -> define, G2 define -> design, G3 design ->
  // mobilize): the only phase-advance path.
  if (body.outcome === "approved" && def.nextPhase !== null)
    await advancePhaseOnGateApproval(tx, audit, {
      transformationId,
      gatePhase: def.phase,
      nextPhase: def.nextPhase as Phase,
      gateCode,
      decisionId,
    });
  return { row, agreements: agreed ? await agreementsOf(tx, gateDecisionId) : [] };
}

/**
 * The decision body as the API reads it: the contract's GateDecisionCreate, except that `agreements` confirmations may
 * be missing or false here so that the rule below answers 422 (not 400) for them, as ADR-0021 §8 requires. Unknown
 * properties and non-boolean confirmations stay 400.
 */
const decisionRequest = gateDecisionCreate.extend({
  agreements: z
    .strictObject({ problem: z.boolean(), baseline: z.boolean(), materialValuePools: z.boolean() })
    .partial()
    .optional(),
});

/**
 * ADR-0021 §8: G1 approved needs all three confirmations true (422 gate.g1_agreements_required, one pointer per
 * missing one); any other gate or outcome must not send them (422 gate.agreements_not_applicable). Returns whether
 * the three agreement rows are to be written.
 */
export function agreementRule(gateCode: string, body: z.infer<typeof decisionRequest>): boolean {
  if (gateCode === "G1" && body.outcome === "approved") {
    const a = body.agreements;
    const confirmed = {
      problem: a?.problem === true,
      baseline: a?.baseline === true,
      materialValuePools: a?.materialValuePools === true,
    };
    const missing = Object.entries(confirmed)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    if (missing.length > 0) {
      const detail =
        "G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032)";
      throw new HttpProblem({
        status: 422,
        type: "urn:mth:problem:validation",
        code: "gate.g1_agreements_required",
        title: "Business rule violated",
        detail,
        errors: missing.map((k) => ({
          pointer: `/agreements/${k}`,
          code: "gate.g1_agreements_required",
          message: detail,
        })),
      });
    }
    return true;
  }
  if (body.agreements !== undefined)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "gate.agreements_not_applicable",
      title: "Business rule violated",
      detail: "Leadership agreement confirmations apply only to approving G1; send them only with a G1 approval.",
      errors: [
        {
          pointer: "/agreements",
          code: "gate.agreements_not_applicable",
          message: "Leadership agreement confirmations apply only to approving G1.",
        },
      ],
    });
  return false;
}

/** Permissions a gate route declares (for the generated AUD write-deny sweep and documentation). */
export const GATE_WRITE_PERMISSIONS: readonly Permission[] = ["gate.configure", "gate.submit", "gate.decide"];
