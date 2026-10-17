// Procedure instances (OpenAPI tag `procedures`; ADR-0042 §3-§4, §9-§11; REQ-S06-002, REQ-S16-015 (ProcedureInstance
// create/read); p5-work-split §C.2; T-DG5-BE-F2):
//   GET   /procedure-instances                          listProcedureInstances        (procedure.read, scope-filtered)
//   POST  /procedure-instances                          launchProcedureInstance       (procedure.launch + a launch role; Idempotency-Key)
//   GET   /procedure-instances/{instanceId}             getProcedureInstance          (procedure.read in scope)
//   PATCH /procedure-instances/{instanceId}/inputs      updateProcedureInstanceInputs (procedure.act; If-Match)
//   POST  /procedure-instances/{instanceId}/cancel      cancelProcedureInstance       (procedure.manage; If-Match)
//
// LAUNCH creates, in one transaction, the instance PINNED to the exact published definition row (procedure_definition_id
// + methodology_version_id never change: 0069 procedure_instance_pinned), one step instance per not-removed step, and
// activates the first position (steps.ts `advance`). The definition comes from the transformation's `procedure` pin when
// it has one, else from the newest published version of the `procedures` key; an organization-scope procedure reads the
// newest published version. A later publish never changes a running instance. Exactly once: a user launch may send
// `Idempotency-Key` (ADR-0007); an automation launch (slice E) passes `launchKey` to `launchProcedureInTx`, UNIQUE in the
// database, so a replay creates nothing and answers 409 procedure.launch_replayed.
//
// Every write: commit-time authorization on grants reloaded inside the transaction; Zod validation; If-Match on the
// instance (428/409; a launch creates version 1); the ADR-0042 §10 refusals first; one audit event per row written in
// the same transaction; the procedureInstanceStep lock on the instance; no remote I/O. Nothing here grants a business approval.
import {
  sql,
  type ProcedureDefinitionRow,
  type ProcedureInstanceRow,
  type ProcedureStepDefinitionRow,
  type Tx,
} from "@mth/db";
import { freeText, roleCode, timestamp, uuid } from "@mth/shared/schemas";

const nullableUuid = uuid.nullable();
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  denialOf,
  holdsAnywhere,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
  scopeFilter,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
  idempotencyKeySchema,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  requireIfMatch,
  sendVersioned,
  withIdempotency,
  type ModuleDeps,
} from "../platform/index.ts";
import { loadDefinitions, loadProcedureVersion, newestPublishedProcedures, PROCEDURE_KIND } from "./definitions.ts";
import {
  advance,
  authorizeInstanceWrite,
  bumpInstance,
  businessToday,
  findInstance,
  holdsRoleIn,
  inputsOf,
  instanceTarget,
  loadBundle,
  lockAndLoad,
  OPEN,
  presentInstance,
  refusal,
  reload,
  requireInstanceRead,
  updateStep,
  validateInputs,
  workingDayDue,
  type InstanceBundle,
} from "./steps.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PROCEDURE_CODE = /^[a-z][a-z0-9_]{2,47}$/;
const OUTPUT_TYPES = [
  "transformation",
  "charter",
  "baseline",
  "kpi_actual",
  "tom_canvas_cell",
  "approval",
  "ranking_snapshot",
  "gate_submission",
  "change_request",
  "finance_validation",
  "decision",
  "bau_handover",
  "evidence",
] as const;

/** OpenAPI `ProcedureLaunch`. */
export const procedureLaunch = z.strictObject({
  procedureCode: z.string().regex(PROCEDURE_CODE, "validation.pattern"),
  transformationId: nullableUuid,
  subjectRecordType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/)
    .nullable()
    .optional(),
  subjectRecordId: nullableUuid.optional(),
  inputValues: z.record(z.string(), z.unknown()).optional(),
});
/** OpenAPI `ProcedureInputsUpdate`. */
export const procedureInputsUpdate = z.strictObject({
  inputValues: z
    .record(z.string(), z.unknown())
    .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 50, "validation.size"),
});
/** OpenAPI `ProcedureCancel`. */
export const procedureCancel = z.strictObject({ reason: freeText(3, 2000) });

/** OpenAPI `ProcedureStepInstance`. */
export const procedureStepInstance = z.strictObject({
  stepKey: z.string(),
  ordinal: z.number().int(),
  parallelGroup: z.string().nullable(),
  stepKind: z.enum(["task", "approval"]),
  nameEn: z.string(),
  nameAr: z.string(),
  status: z.enum(["pending", "active", "completed", "skipped", "not_applicable", "cancelled"]),
  assigneeRoleCode: roleCode,
  assigneeUserId: uuid.nullable(),
  dueDate: businessDate.nullable(),
  dueDateUnknownReason: z.string().nullable(),
  overdue: z.boolean().nullable(),
  activatedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  completedBy: uuid.nullable(),
  skipReason: z.string().min(3).max(2000).nullable(),
  approvalId: uuid.nullable(),
  missingInputs: z.array(z.string()),
});
/** OpenAPI `ProcedureInstanceLink`. */
export const procedureInstanceLink = z.strictObject({
  id: uuid,
  stepKey: z.string().nullable(),
  linkKind: z.enum(["output", "evidence"]),
  recordType: z.enum(OUTPUT_TYPES),
  recordId: uuid,
  createdAt: timestamp,
  createdBy: uuid,
});
/** OpenAPI `ProcedureInstance`. */
export const procedureInstance = z.strictObject({
  id: uuid,
  transformationId: uuid.nullable(),
  procedureCode: z.string().regex(PROCEDURE_CODE),
  procedureDefinitionId: uuid,
  methodologyVersionId: uuid,
  versionNo: z.number().int().min(1),
  nameEn: z.string(),
  nameAr: z.string(),
  status: z.enum(["active", "completed", "cancelled"]),
  subjectRecordType: z.string().nullable(),
  subjectRecordId: uuid.nullable(),
  inputValues: z.record(z.string(), z.unknown()),
  dueDate: businessDate.nullable(),
  currentStepKeys: z.array(z.string()),
  missingInputs: z.array(z.strictObject({ key: z.string(), labelEn: z.string(), labelAr: z.string() })),
  nextAction: z.strictObject({
    kind: z.enum(["provide_input", "link_evidence", "complete_step", "await_approval", "none"]),
    stepKey: z.string().nullable(),
    messageKey: z.string(),
    messageParams: z.record(z.string(), z.unknown()),
  }),
  steps: z.array(procedureStepInstance),
  links: z.array(procedureInstanceLink),
  launchedBy: uuid,
  launchedAt: timestamp,
  completedAt: timestamp.nullable(),
  cancelledAt: timestamp.nullable(),
  cancelReason: z.string().min(3).max(2000).nullable(),
  version: z.number().int().min(1),
  updatedAt: timestamp,
});
export const procedureInstancePage = z.strictObject({
  items: z.array(procedureInstance),
  nextCursor: z.string().nullable(),
});
/** OpenAPI `MyProcedureStep` / `MyProcedureStepPage`. */
export const myProcedureStep = z.strictObject({
  instanceId: uuid,
  transformationId: uuid.nullable(),
  procedureCode: z.string().regex(PROCEDURE_CODE),
  procedureNameEn: z.string(),
  procedureNameAr: z.string(),
  step: procedureStepInstance,
});
export const myProcedureStepPage = z.strictObject({
  items: z.array(myProcedureStep),
  nextCursor: z.string().nullable(),
});

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  transformationId: uuid.optional(),
  status: z.enum(["active", "completed", "cancelled"]).optional(),
  procedureCode: z.string().regex(PROCEDURE_CODE, "validation.pattern").optional(),
});
const idParams = z.strictObject({ instanceId: uuid });

// ------------------------------------------------------------------------------------------------ launch

export interface LaunchInput {
  readonly procedureCode: string;
  readonly transformationId: string | null;
  readonly subjectRecordType?: string | null;
  readonly subjectRecordId?: string | null;
  readonly inputValues?: Readonly<Record<string, unknown>>;
  /** An automation launch's key (slice E): UNIQUE, so a replay creates nothing (409 procedure.launch_replayed). */
  readonly launchKey?: string | null;
}

/** The definition a launch uses: the transformation's `procedure` pin, else the newest published `procedures` version. */
async function launchDefinition(
  tx: Tx,
  transformationId: string | null,
  code: string,
): Promise<{ row: ProcedureDefinitionRow; steps: readonly ProcedureStepDefinitionRow[] }> {
  const pin =
    transformationId === null
      ? undefined
      : await tx
          .selectFrom("transformation_config_pin")
          .select("methodology_version_id")
          .where("transformation_id", "=", transformationId)
          .where("kind", "=", PROCEDURE_KIND)
          .executeTakeFirst();
  const v =
    pin === undefined
      ? await newestPublishedProcedures(tx)
      : await loadProcedureVersion(tx, pin.methodology_version_id);
  const [d] = await loadDefinitions(tx, v, { code, includeRemoved: true });
  if (d === undefined) throw problems.notFound();
  // The pinned row must itself be a published, not removed definition (0069 procedure_instance_launch).
  const rowVersion = await tx
    .selectFrom("methodology_version")
    .select("status")
    .where("id", "=", d.row.methodology_version_id)
    .executeTakeFirstOrThrow();
  if (v.status !== "published" || rowVersion.status !== "published" || d.row.removed)
    throw refusal("procedure.not_published");
  return d;
}

/**
 * Launches a procedure in `tx` for `principal` (grants already reloaded inside `tx`): the checks of ADR-0042 §9-§10 in
 * order (404 scope/definition; 403 procedure.launch then procedure.launch_role; 422 not_published, scope_mismatch,
 * input_invalid; 409 launch_replayed), then the instance, its steps and the first position. Returns the bundle.
 */
export async function launchProcedureInTx(
  tx: Tx,
  audit: AuditContext,
  principal: Principal,
  input: LaunchInput,
): Promise<InstanceBundle> {
  const userId = principal.userId;
  if (userId === null) throw problems.forbidden();
  // Scope (404 when the caller cannot read it).
  let target: ResolvedTarget;
  let organizationId: string;
  if (input.transformationId !== null) {
    target = await requireRead(tx, principal, "procedure.read", { type: "transformation", id: input.transformationId });
    organizationId = target.organizationId;
  } else {
    if (principal.organizationId === null) throw problems.forbidden();
    organizationId = principal.organizationId;
    target = await requireRead(tx, principal, "procedure.read", { type: "organization", id: organizationId });
  }
  const d = await launchDefinition(tx, input.transformationId, input.procedureCode);
  await requireAction(tx, principal, "procedure.launch", target);
  principal.tracker.decisions += 1;
  if (!d.row.launch_role_codes.some((r) => holdsRoleIn(principal.grants, r, "procedure.launch", target)))
    throw refusal("procedure.launch_role").withDenial(denialOf("procedure.launch", target));
  if ((d.row.scope_level === "organization") !== (input.transformationId === null))
    throw refusal("procedure.scope_mismatch");
  const values = validateInputs(d.row, input.inputValues ?? {});
  for (const [k, v] of [...values]) if (v === null) values.delete(k);

  const id = uuidv7();
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.procedureInstanceStep}::integer, hashtext(${id}::text))`.execute(
    tx,
  );
  const today = await businessToday(tx, organizationId);
  const due = await workingDayDue(tx, organizationId, today, d.row.sla_working_days);
  const inserted = await tx
    .insertInto("procedure_instance")
    .values({
      id,
      organization_id: organizationId,
      transformation_id: input.transformationId,
      procedure_definition_id: d.row.id,
      methodology_version_id: d.row.methodology_version_id,
      procedure_code: d.row.code,
      subject_record_type: input.subjectRecordType ?? null,
      subject_record_id: input.subjectRecordId ?? null,
      input_values: JSON.stringify(Object.fromEntries(values)),
      due_date: due,
      launch_key: input.launchKey ?? null,
      launched_by: userId,
      created_by: userId,
      updated_by: userId,
    })
    .onConflict((oc) => oc.constraint("procedure_instance_launch_key").doNothing())
    .returningAll()
    .executeTakeFirst();
  if (inserted === undefined) throw refusal("procedure.launch_replayed");
  await record(tx, audit, {
    action: "procedure_instance.launch",
    recordType: "procedure_instance",
    recordId: id,
    organizationId,
    transformationId: input.transformationId,
    newVersion: 1,
    changes: {
      procedure_code: { from: null, to: inserted.procedure_code },
      procedure_definition_id: { from: null, to: inserted.procedure_definition_id },
      methodology_version_id: { from: null, to: inserted.methodology_version_id },
      launch_key: { from: null, to: inserted.launch_key },
      due_date: { from: null, to: inserted.due_date },
    },
  });
  for (const sd of d.steps.filter((s) => !s.removed)) {
    const stepId = uuidv7();
    await tx
      .insertInto("procedure_step_instance")
      .values({
        id: stepId,
        organization_id: organizationId,
        transformation_id: input.transformationId,
        procedure_instance_id: id,
        step_definition_id: sd.id,
        step_key: sd.step_key,
        ordinal: sd.ordinal,
        // An approval step's role is its business approver's; a task step's is its responsible role.
        assignee_role_code:
          sd.step_kind === "approval" ? (sd.approval_role_code ?? sd.responsible_role_code) : sd.responsible_role_code,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await record(tx, audit, {
      action: "procedure_step_instance.create",
      recordType: "procedure_step_instance",
      recordId: stepId,
      organizationId,
      transformationId: input.transformationId,
      newVersion: 1,
      changes: { step_key: { from: null, to: sd.step_key }, ordinal: { from: null, to: sd.ordinal } },
    });
  }
  const advanced = await advance(tx, audit, await loadBundle(tx, inserted));
  return advanced.instance.status === "active" && advanced.steps.every((s) => !OPEN.has(s.status))
    ? reload(tx, advanced).then((b) => finishLaunch(tx, audit, b))
    : advanced;
}

/** A launch whose every step was not applicable completes at once (version 2, audited). */
async function finishLaunch(tx: Tx, audit: AuditContext, b: InstanceBundle): Promise<InstanceBundle> {
  await bumpInstance(tx, audit, b.instance, "complete", { status: "completed", completed: true });
  return reload(tx, b);
}

async function launch(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const body = parseBody(procedureLaunch, request.body);
  // Read gate on request-start grants first (404), then everything on grants reloaded inside the transaction.
  const start = principalOf(request);
  if (body.transformationId !== null)
    await requireRead(tx, start, "procedure.read", { type: "transformation", id: body.transformationId });
  else if (start.organizationId !== null)
    await requireRead(tx, start, "procedure.read", { type: "organization", id: start.organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    return await launchProcedureInTx(tx, auditContextOf(request), fresh, {
      procedureCode: body.procedureCode,
      transformationId: body.transformationId,
      subjectRecordType: body.subjectRecordType ?? null,
      subjectRecordId: body.subjectRecordId ?? null,
      inputValues: body.inputValues ?? {},
    });
  } catch (err) {
    throw commitTimeDenial(err);
  }
}

// ------------------------------------------------------------------------------------------------ inputs, cancel

async function updateInputs(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const { instanceId } = parse(idParams, request.params, "params");
  const body = parseBody(procedureInputsUpdate, request.body);
  const seen = await findInstance(tx, instanceId);
  if (seen === undefined) throw problems.notFound();
  await requireInstanceRead(tx, principalOf(request), seen);
  const i = await lockAndLoad(tx, instanceId);
  const acting = await authorizeInstanceWrite(tx, request, i, "procedure.act");
  const b = await loadBundle(tx, i);
  // The launcher, or the assignee (or a role holder) of an open step.
  acting.principal.tracker.decisions += 1;
  const allowed =
    i.launched_by === acting.userId ||
    b.steps.some(
      (s) =>
        OPEN.has(s.status) &&
        (s.assignee_user_id !== null
          ? s.assignee_user_id === acting.userId
          : holdsRoleIn(acting.principal.grants, s.assignee_role_code, "procedure.act", acting.target)),
    );
  if (!allowed) throw refusal("procedure_step.not_assignee").withDenial(denialOf("procedure.act", acting.target));
  const expected = requireIfMatch(request);
  if (expected !== i.version) throw problems.versionConflict(i.version);
  if (i.status !== "active") throw refusal("procedure.not_active");
  const merged = inputsOf(i);
  for (const [k, v] of validateInputs(b.definition, body.inputValues)) {
    if (v === null) merged.delete(k);
    else merged.set(k, v);
  }
  await bumpInstance(tx, acting.audit, i, "inputs", { inputValues: Object.fromEntries(merged) });
  // D-166 Rule A: an adopted approval step that waited for its party's mapping is routed now (steps.ts `advance`;
  // nothing else changes while a step is active).
  return advance(tx, acting.audit, await reload(tx, b));
}

async function cancel(tx: Tx, request: FastifyRequest): Promise<InstanceBundle> {
  const { instanceId } = parse(idParams, request.params, "params");
  const body = parseBody(procedureCancel, request.body);
  const seen = await findInstance(tx, instanceId);
  if (seen === undefined) throw problems.notFound();
  await requireInstanceRead(tx, principalOf(request), seen);
  const i = await lockAndLoad(tx, instanceId);
  const acting = await authorizeInstanceWrite(tx, request, i, "procedure.manage");
  const expected = requireIfMatch(request);
  if (expected !== i.version) throw problems.versionConflict(i.version);
  if (i.status !== "active") throw refusal("procedure.not_active");
  const b = await loadBundle(tx, i);
  // Open steps are cancelled in the same transaction; outputs already linked stay (append-only).
  for (const s of b.steps.filter((x) => OPEN.has(x.status)))
    await updateStep(tx, acting.audit, s, "cancel", { status: "cancelled" }, body.reason);
  await bumpInstance(
    tx,
    acting.audit,
    i,
    "cancel",
    { status: "cancelled", cancelled_by: acting.userId, cancel_reason: body.reason, cancelled: true },
    body.reason,
  );
  return reload(tx, b);
}

// ------------------------------------------------------------------------------------------------ list

/** Instances in the caller's scope (procedure.read), newest first; 403 when the caller holds procedure.read nowhere. */
async function list(db: ModuleDeps["db"], request: FastifyRequest) {
  const q = parseQuery(listQuery, request.query);
  const principal = principalOf(request);
  principal.tracker.decisions += 1;
  if (!principal.grants.some((g) => g.permissions.has("procedure.read"))) throw problems.forbidden();
  const hash = filterHash({ transformationId: q.transformationId, status: q.status, procedureCode: q.procedureCode });
  const after = decodeCursor(q.cursor, hash, 2);
  let query = db
    .selectFrom("procedure_instance as pi")
    .leftJoin("transformation as t", "t.id", "pi.transformation_id")
    .selectAll("pi")
    .where(
      scopeFilter(principal, "procedure.read", {
        level: sql<string>`CASE WHEN pi.transformation_id IS NULL THEN 'organization' ELSE 'transformation' END`,
        organizationId: sql<string>`pi.organization_id`,
        businessUnitId: sql<string | null>`t.business_unit_id`,
        transformationId: sql<string | null>`pi.transformation_id`,
      }),
    );
  if (q.transformationId !== undefined) query = query.where("pi.transformation_id", "=", q.transformationId);
  if (q.status !== undefined) query = query.where("pi.status", "=", q.status);
  if (q.procedureCode !== undefined) query = query.where("pi.procedure_code", "=", q.procedureCode);
  if (after !== null) {
    const [at, id] = after;
    query = query.where(sql<boolean>`(pi.launched_at, pi.id) < (${String(at)}::timestamptz, ${String(id)}::uuid)`);
  }
  const rows: ProcedureInstanceRow[] = await query
    .orderBy("pi.launched_at", "desc")
    .orderBy("pi.id", "desc")
    .limit(q.limit + 1)
    .execute();
  const page = paginate(rows, q.limit, (r) => [r.launched_at.toISOString(), r.id], hash);
  const items = [];
  for (const r of page.items) items.push(await presentInstance(db, await loadBundle(db, r)));
  return { items, nextCursor: page.nextCursor };
}

// ------------------------------------------------------------------------------------------------ routes

const INSTANCES = "/api/v1/procedure-instances";
const ONE = `${INSTANCES}/:instanceId`;
const JSON_BODY = ["application/json"] as const;
const idempotencyHeader = z.object({ "idempotency-key": idempotencyKeySchema.optional() }).passthrough();

export function registerProcedureInstanceRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "procedure.read" as const } };

  app.get(INSTANCES, { config: read }, async (request) => list(db, request));

  app.post(
    INSTANCES,
    { config: { access: { permission: "procedure.launch" as const }, consumes: JSON_BODY } },
    async (request, reply) => {
      const key = parse(idempotencyHeader, request.headers, "header")["idempotency-key"];
      const principal = principalOf(request);
      // A replayed launch answers from the idempotency record, so the caller's right to launch at all is decided
      // first (403 without procedure.launch anywhere, e.g. AUD); the full checks run inside the launch itself.
      if (!holdsAnywhere(principal, "procedure.launch")) throw problems.forbidden();
      const userId = principal.userId;
      const created = await db.transaction().execute(async (tx) => {
        const run = async () => {
          const b = await launch(tx, request);
          return { status: 201, body: await presentInstance(tx, b) };
        };
        return key === undefined || userId === null
          ? run()
          : withIdempotency(
              tx,
              { userId, key, requestHash: requestHash(request.method, INSTANCES, request.body) },
              run,
            );
      });
      return sendVersioned(reply, created.status, created.body, `${INSTANCES}/${created.body.id}`);
    },
  );

  app.get(ONE, { config: read }, async (request, reply) => {
    const { instanceId } = parse(idParams, request.params, "params");
    const i = await findInstance(db, instanceId);
    if (i === undefined) throw problems.notFound();
    await requireInstanceRead(db, principalOf(request), i);
    return sendVersioned(reply, 200, await presentInstance(db, await loadBundle(db, i)));
  });

  const respond = (run: (tx: Tx, request: FastifyRequest) => Promise<InstanceBundle>) =>
    async function handler(request: FastifyRequest, reply: FastifyReply) {
      const b = await db.transaction().execute((tx) => run(tx, request));
      return sendVersioned(reply, 200, await presentInstance(db, b));
    };
  app.patch(
    `${ONE}/inputs`,
    { config: { access: { permission: "procedure.act" }, consumes: JSON_BODY } },
    respond(updateInputs),
  );
  app.post(
    `${ONE}/cancel`,
    { config: { access: { permission: "procedure.manage" }, consumes: JSON_BODY } },
    respond(cancel),
  );

  return [`GET ${INSTANCES}`, `POST ${INSTANCES}`, `GET ${ONE}`, `PATCH ${ONE}/inputs`, `POST ${ONE}/cancel`];
}

export { instanceTarget };
