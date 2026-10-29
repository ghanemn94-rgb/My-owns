// Operational exceptions (ADR-0053 §2, §6, §9; REQ-S12-019 "create a visible operational exception and retain last
// known values with freshness labels"; T-DG6-BE-K). The routes are in routes.ts.
//
// One ACTIVE (open or acknowledged) exception per (organization, source kind, source code, failure class): the raising
// code takes advisory lock `operationalExceptionUpsert` on "<organizationId or 'platform'>:<dedupKey>", then recurs the active row or inserts
// a new one, with one audit event, in the transaction of the failure it reports (`raiseOperationalException`). A source
// that succeeds again resolves its active exception `recovered` (`recoverOperationalException`, no user). A resolved
// exception is final; a new failure opens a new row (0101 operational_exception_guard). The worker has its own twin of
// both services in apps/worker/src/kit.ts (ADR-0002 rule 5: the worker imports no API code); the integration test
// compares the rows the two write.
//
// Authorization (0103; permissions matrix §25; ADR-0053 §9):
//   - read: `operations.read`. An organization-level holder sees the organization's exceptions and the platform ones;
//     a holder at a narrower scope (a KDS assigned to one transformation) sees only the organization's exceptions that
//     are linked to a KPI of a transformation in that scope. Anything else answers 404 (existence not disclosed).
//   - acknowledge and resolve: `operations.acknowledge` under the same scope rule (403 when the read passes but the
//     acknowledge right does not), re-checked at commit time on the reloaded grants after the row lock.
// Acknowledging or resolving approves nothing: it is not a business approval (G1-G6), never touches DG0-DG7, and never
// changes a KPI value or its freshness label (the linked KPIs are read here, never written).
import { sql, type DbOrTx, type OperationalExceptionTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { withReadTimeStaleness, type KpiReasonCode, type KpiValueStatus } from "@mth/shared/calc";
import { canonicalDecimal, reason as noteRule } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  organizationsWith,
  refreshPrincipal,
  scopeFilter,
  type Principal,
} from "../access/index.ts";
import { record as audit, type AuditContext } from "../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, isoOrNull, problems } from "../platform/index.ts";

export const OPERATIONS_READ: Permission = "operations.read";
export const OPERATIONS_ACKNOWLEDGE: Permission = "operations.acknowledge";
/** ADR-0016 §6 registry (platform/advisory-locks.ts `operationalExceptionUpsert`). */
export const OPERATIONAL_EXCEPTION_LOCK = ADVISORY_LOCK_CLASSES.operationalExceptionUpsert;

export const EXCEPTION_STATUSES = ["open", "acknowledged", "resolved"] as const;
export const EXCEPTION_SOURCE_KINDS = ["job", "connector", "data_freshness", "worker"] as const;
export const EXCEPTION_FAILURE_CLASSES = [
  "job_failed",
  "connector_run_failed",
  "connector_unreachable",
  "connector_credentials_rejected",
  "data_stale",
  "heartbeat_missed",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
export type ExceptionSourceKind = (typeof EXCEPTION_SOURCE_KINDS)[number];
export type ExceptionFailureClass = (typeof EXCEPTION_FAILURE_CLASSES)[number];
const ACTIVE: readonly ExceptionStatus[] = ["open", "acknowledged"];

export type OperationalExceptionRow = Selectable<OperationalExceptionTable>;

/** The contract's OperationalException body. */
export interface OperationalExceptionBody {
  readonly id: string;
  readonly organizationId: string | null;
  readonly sourceKind: ExceptionSourceKind;
  readonly sourceCode: string;
  readonly failureClass: ExceptionFailureClass;
  readonly dedupKey: string;
  readonly status: ExceptionStatus;
  readonly occurrenceCount: number;
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly lastErrorCode: string;
  readonly lastErrorMessage: string;
  readonly serviceIdentityId: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgeNote: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolution: "manual" | "recovered" | null;
  readonly resolutionNote: string | null;
  readonly linkedKpiCount: number;
  readonly version: number;
}

export interface LinkedKpiBody {
  readonly kpiDefinitionId: string;
  readonly transformationId: string;
  readonly name: string;
  readonly unitKind: string;
  /** DG4's freshness label (ADR-0028 read-time rule, @mth/shared/calc); never forced or invented here. */
  readonly freshness: "fresh" | "stale" | "unknown";
  /** The last known value as a decimal string; null = Unknown (never 0). */
  readonly lastValue: string | null;
  /** The start of the value's data-as-of business date in the organization's time zone; null when Unknown. */
  readonly lastValueAt: string | null;
}

export interface ExceptionEventBody {
  readonly recordVersion: number;
  readonly eventKind: "opened" | "recurred" | "acknowledged" | "resolved" | "updated";
  readonly status: ExceptionStatus;
  readonly occurrenceCount: number;
  readonly errorCode: string;
  readonly actorUserId: string | null;
  readonly note: string | null;
  readonly occurredAt: string;
}

export interface OperationalExceptionDetailBody extends OperationalExceptionBody {
  readonly linkedKpis: LinkedKpiBody[];
  readonly hiddenKpiCount: number;
  readonly events: ExceptionEventBody[];
}

const noteText = "Enter a note of 3 to 1,000 characters.";

/** The exact refusals of ADR-0053 §2 (codes are i18n keys under `problems.`). */
export const exceptionRefusals = {
  notOpen: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "operations.exception_not_open",
      title: "Invalid transition",
      detail: "Only an open operational exception can be acknowledged.",
    }),
  resolved: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "operations.exception_resolved",
      title: "Invalid transition",
      detail: "This operational exception is already resolved.",
    }),
  noteRequired: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "operations.note_required",
      title: "Business rule violated",
      detail: noteText,
      errors: [{ pointer: "/note", code: "operations.note_required", message: noteText }],
    }),
} as const;

/** A note: the shared rule (trimmed 3-1000 characters, not blank, no invalid character), else 422. */
export function checkedNote(value: string): string {
  const r = noteRule.safeParse(value);
  if (!r.success) throw exceptionRefusals.noteRequired();
  return r.data;
}

export function toOperationalException(r: OperationalExceptionRow, linkedKpiCount: number): OperationalExceptionBody {
  return {
    id: r.id,
    organizationId: r.organization_id,
    sourceKind: r.source_kind as ExceptionSourceKind,
    sourceCode: r.source_code,
    failureClass: r.failure_class as ExceptionFailureClass,
    dedupKey: r.dedup_key,
    status: r.status as ExceptionStatus,
    occurrenceCount: r.occurrence_count,
    firstOccurredAt: iso(r.first_occurred_at),
    lastOccurredAt: iso(r.last_occurred_at),
    lastErrorCode: r.last_error_code,
    lastErrorMessage: r.last_error_message,
    serviceIdentityId: r.service_identity_id,
    acknowledgedAt: isoOrNull(r.acknowledged_at),
    acknowledgedBy: r.acknowledged_by,
    acknowledgeNote: r.acknowledge_note,
    resolvedAt: isoOrNull(r.resolved_at),
    resolvedBy: r.resolved_by,
    resolution: r.resolution as OperationalExceptionBody["resolution"],
    resolutionNote: r.resolution_note,
    linkedKpiCount,
    version: r.version,
  };
}

// ------------------------------------------------------------------------------------------------ authorization

async function linkedTransformations(db: DbOrTx, exceptionId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("operational_exception_kpi")
    .select("transformation_id")
    .distinct()
    .where("operational_exception_id", "=", exceptionId)
    .orderBy("transformation_id")
    .execute();
  return rows.map((r) => r.transformation_id);
}

/**
 * ADR-0053 §9: does the principal hold `permission` for the exception? Organization exceptions: at organization level
 * in its organization, or at the scope of a transformation one of its linked KPIs belongs to. Platform exceptions: at
 * organization level in any organization. Always consults the policy at least once (fail-closed tracker).
 */
export async function holdsForException(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  row: Pick<OperationalExceptionRow, "id" | "organization_id">,
): Promise<boolean> {
  if (row.organization_id === null) {
    principal.tracker.decisions += 1;
    for (const organizationId of organizationsWith(principal, permission))
      if ((await authorize(db, principal, permission, { type: "organization", id: organizationId })).allowed)
        return true;
    return false;
  }
  if ((await authorize(db, principal, permission, { type: "organization", id: row.organization_id })).allowed)
    return true;
  for (const transformationId of await linkedTransformations(db, row.id))
    if ((await authorize(db, principal, permission, { type: "transformation", id: transformationId })).allowed)
      return true;
  return false;
}

export async function findException(
  db: DbOrTx,
  id: string,
  lock = false,
): Promise<OperationalExceptionRow | undefined> {
  let q = db.selectFrom("operational_exception").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The exception if the principal may read it; 404 otherwise (missing and unreadable are indistinguishable). */
export async function visibleException(db: DbOrTx, principal: Principal, id: string): Promise<OperationalExceptionRow> {
  const row = await findException(db, id);
  if (!row) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  if (!(await holdsForException(db, principal, OPERATIONS_READ, row))) throw problems.notFound();
  return row;
}

/** The read and acknowledge gates of a change, before the transaction (404, then 403). */
export async function requireExceptionChange(
  db: DbOrTx,
  principal: Principal,
  id: string,
): Promise<OperationalExceptionRow> {
  const row = await visibleException(db, principal, id);
  if (!(await holdsForException(db, principal, OPERATIONS_ACKNOWLEDGE, row))) throw problems.forbidden();
  return row;
}

// ------------------------------------------------------------------------------------------------ reads

export interface ExceptionListQuery {
  readonly organizationId: string;
  readonly status?: readonly ExceptionStatus[];
  readonly sourceKind?: ExceptionSourceKind;
  readonly failureClass?: ExceptionFailureClass;
  /** Exclusive bound (last_occurred_at ISO, id) of the page (decoded cursor); newest occurrence first. */
  readonly after?: readonly [string, string] | null;
  readonly limit: number;
}

export type ListedException = OperationalExceptionRow & { linked_kpi_count: number };

/**
 * listOperationalExceptions: 404 for an unknown organization, 403 when the caller holds `operations.read` nowhere in
 * it. An organization-level holder gets the organization's and the platform exceptions; a narrower holder only the
 * organization's exceptions linked to a KPI of a transformation in scope (filtered in SQL). Default status filter:
 * open and acknowledged.
 */
export async function listOperationalExceptions(
  db: DbOrTx,
  principal: Principal,
  query: ExceptionListQuery,
): Promise<ListedException[]> {
  const decision = await authorize(db, principal, OPERATIONS_READ, { type: "organization", id: query.organizationId });
  if (!decision.target) throw problems.notFound();
  const orgLevel = decision.allowed;
  if (!orgLevel && !organizationsWith(principal, OPERATIONS_READ).includes(query.organizationId))
    throw problems.forbidden();
  const linkedInScope = scopeFilter(principal, OPERATIONS_READ, {
    level: "transformation",
    organizationId: sql.ref("l.organization_id"),
    businessUnitId: sql.ref("t.business_unit_id"),
    transformationId: sql.ref("l.transformation_id"),
  });
  let q = db
    .selectFrom("operational_exception as e")
    .selectAll("e")
    .select(
      sql<number>`(SELECT count(*)::int FROM operational_exception_kpi k WHERE k.operational_exception_id = e.id)`.as(
        "linked_kpi_count",
      ),
    )
    .where("e.status", "in", [...(query.status && query.status.length > 0 ? query.status : ACTIVE)]);
  q = orgLevel
    ? q.where((eb) => eb.or([eb("e.organization_id", "=", query.organizationId), eb("e.organization_id", "is", null)]))
    : q.where("e.organization_id", "=", query.organizationId).where(
        sql<boolean>`EXISTS (SELECT 1 FROM operational_exception_kpi l JOIN transformation t ON t.id = l.transformation_id
            WHERE l.operational_exception_id = e.id AND ${linkedInScope})`,
      );
  if (query.sourceKind) q = q.where("e.source_kind", "=", query.sourceKind);
  if (query.failureClass) q = q.where("e.failure_class", "=", query.failureClass);
  if (query.after)
    q = q.where(sql<boolean>`(e.last_occurred_at, e.id) < (${query.after[0]}::timestamptz, ${query.after[1]}::uuid)`);
  return q
    .orderBy("e.last_occurred_at", "desc")
    .orderBy("e.id", "desc")
    .limit(query.limit + 1)
    .execute();
}

/** The organization's business date (the DG4 `businessDateOf` rule: default calendar, else organization zone). */
async function businessDateOf(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** The start of a business date in the organization's zone (the instant the contract's lastValueAt carries). */
async function startOfBusinessDate(db: DbOrTx, organizationId: string, date: string): Promise<string> {
  const r = await sql<{ t: Date }>`
    SELECT (${date}::date)::timestamp AT TIME ZONE coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)) AS t`.execute(db);
  return iso(r.rows[0]!.t);
}

/**
 * One linked KPI as the DG4 panel shows it at transformation scope for its current reporting period (ADR-0028 §6):
 * the latest period evaluation with the read-time staleness rule of @mth/shared/calc, the same function and the same
 * reads as kpi/kpi-status.ts `statusOf` (operations may not import kpi, ADR-0002; the integration test compares the
 * two). Nothing is written; a missing evaluation is Unknown with a null value, never 0.
 */
async function linkedKpiStatus(
  db: DbOrTx,
  link: { kpi_definition_id: string; transformation_id: string; organization_id: string },
  businessDate: string,
): Promise<LinkedKpiBody | null> {
  const def = await db
    .selectFrom("kpi_definition")
    .select(["id", "name", "unit_kind", "frequency"])
    .where("id", "=", link.kpi_definition_id)
    .executeTakeFirst();
  if (!def) return null;
  const base = {
    kpiDefinitionId: def.id,
    transformationId: link.transformation_id,
    name: def.name,
    unitKind: def.unit_kind,
  };
  const unknown: LinkedKpiBody = { ...base, freshness: "unknown", lastValue: null, lastValueAt: null };
  const version = await db
    .selectFrom("kpi_version")
    .select("dq_stale_after_days")
    .where("kpi_definition_id", "=", def.id)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!version) return unknown;
  const period = await db
    .selectFrom("reporting_period")
    .select("id")
    .where("organization_id", "=", link.organization_id)
    .where("frequency", "=", def.frequency)
    .where("status", "in", ["open", "closed"])
    .orderBy("period_end", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!period) return unknown;
  const evaluation = await db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .select(["e.value", "e.value_status", "e.value_reason", "e.calculated_rag", "e.explanation_key", "e.data_as_of"])
    .where("e.kpi_definition_id", "=", def.id)
    .where("e.scope_kind", "=", "transformation")
    .where("e.scope_id", "=", link.transformation_id)
    .where("e.reporting_period_id", "=", period.id)
    .where("e.value_basis", "=", "period")
    .orderBy("r.seq", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!evaluation) return unknown;
  const read = withReadTimeStaleness(
    {
      value: evaluation.value,
      valueStatus: evaluation.value_status as KpiValueStatus,
      valueReason: evaluation.value_reason as KpiReasonCode | null,
      calculatedRag: evaluation.calculated_rag as never,
      explanationKey: evaluation.explanation_key as never,
      dataAsOf: evaluation.data_as_of,
    },
    version.dq_stale_after_days ?? 45,
    businessDate,
  );
  const status = read.freshness.status === "stale" ? "stale" : read.freshness.status === "fresh" ? "fresh" : "unknown";
  return {
    ...base,
    freshness: status,
    lastValue: read.value === null ? null : canonicalDecimal(read.value),
    lastValueAt:
      read.freshness.dataAsOf === null
        ? null
        : await startOfBusinessDate(db, link.organization_id, read.freshness.dataAsOf),
  };
}

/**
 * getOperationalException's body: the exception, its event history (by record version) and its linked KPIs. A linked
 * KPI the caller cannot read (`transformation.read` at its transformation, the KPI panel's own gate) is only counted in
 * hiddenKpiCount, never named.
 */
export async function exceptionDetail(
  db: DbOrTx,
  principal: Principal,
  row: OperationalExceptionRow,
): Promise<OperationalExceptionDetailBody> {
  const events = await db
    .selectFrom("operational_exception_event")
    .selectAll()
    .where("operational_exception_id", "=", row.id)
    .orderBy("record_version")
    .execute();
  const links = await db
    .selectFrom("operational_exception_kpi")
    .select(["kpi_definition_id", "transformation_id", "organization_id"])
    .where("operational_exception_id", "=", row.id)
    .orderBy("transformation_id")
    .orderBy("kpi_definition_id")
    .execute();
  const linkedKpis: LinkedKpiBody[] = [];
  let hidden = 0;
  const readable = new Map<string, boolean>();
  const dates = new Map<string, string>();
  for (const link of links) {
    let may = readable.get(link.transformation_id);
    if (may === undefined) {
      may = (
        await authorize(db, principal, "transformation.read", { type: "transformation", id: link.transformation_id })
      ).allowed;
      readable.set(link.transformation_id, may);
    }
    if (!may) {
      hidden += 1;
      continue;
    }
    let date = dates.get(link.organization_id);
    if (date === undefined) {
      date = await businessDateOf(db, link.organization_id);
      dates.set(link.organization_id, date);
    }
    const status = await linkedKpiStatus(db, link, date);
    if (status === null) hidden += 1;
    else linkedKpis.push(status);
  }
  return {
    ...toOperationalException(row, links.length),
    linkedKpis,
    hiddenKpiCount: hidden,
    events: events.map((e) => ({
      recordVersion: e.record_version,
      eventKind: e.event_kind as ExceptionEventBody["eventKind"],
      status: e.status as ExceptionStatus,
      occurrenceCount: e.occurrence_count,
      errorCode: e.error_code,
      actorUserId: e.actor_user_id,
      note: e.note,
      occurredAt: iso(e.occurred_at),
    })),
  };
}

// ------------------------------------------------------------------------------------------------ mutations

/** Commit-time re-check (F-DG2-440): read gate, then the acknowledge gate, on the reloaded grants. */
async function recheckAtCommit(tx: Tx, request: FastifyRequest, locked: OperationalExceptionRow): Promise<string> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    if (!(await holdsForException(tx, fresh, OPERATIONS_READ, locked))) throw problems.notFound();
    if (!(await holdsForException(tx, fresh, OPERATIONS_ACKNOWLEDGE, locked))) throw problems.forbidden();
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  return fresh.userId!;
}

/**
 * acknowledgeOperationalException (ADR-0053 §2): open -> acknowledged, with an optional note, once. Under the row lock:
 * authorization re-checked, 409 version, 409 operations.exception_resolved / exception_not_open, then the update and
 * its audit event (prior and new version) in the same transaction.
 */
export async function acknowledgeException(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  note: string | null,
): Promise<OperationalExceptionRow> {
  const locked = await findException(tx, id, true);
  if (!locked) throw problems.notFound();
  const me = await recheckAtCommit(tx, request, locked);
  if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
  if (locked.status === "resolved") throw exceptionRefusals.resolved();
  if (locked.status !== "open") throw exceptionRefusals.notOpen();
  const updated = await tx
    .updateTable("operational_exception")
    .set({
      status: "acknowledged",
      acknowledged_at: sql<Date>`now()`,
      acknowledged_by: me,
      acknowledge_note: note,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "operational_exception.acknowledged",
    recordType: "operational_exception",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    ...(note !== null ? { reason: note } : {}),
    changes: {
      status: { from: locked.status, to: "acknowledged" },
      acknowledge_note: { from: null, to: note },
    },
  });
  return updated;
}

/**
 * resolveOperationalException (ADR-0053 §2): open | acknowledged -> resolved (`manual`, with the resolver and a note).
 * Final. Never changes a KPI value or freshness label.
 */
export async function resolveException(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  note: string,
): Promise<OperationalExceptionRow> {
  const locked = await findException(tx, id, true);
  if (!locked) throw problems.notFound();
  const me = await recheckAtCommit(tx, request, locked);
  if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
  if (locked.status === "resolved") throw exceptionRefusals.resolved();
  const updated = await tx
    .updateTable("operational_exception")
    .set({
      status: "resolved",
      resolved_at: sql<Date>`now()`,
      resolved_by: me,
      resolution: "manual",
      resolution_note: note,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "operational_exception.resolved",
    recordType: "operational_exception",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    reason: note,
    changes: {
      status: { from: locked.status, to: "resolved" },
      resolution: { from: null, to: "manual" },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ raise / recover

export interface RaiseExceptionInput {
  readonly organizationId: string | null;
  readonly sourceKind: ExceptionSourceKind;
  readonly sourceCode: string;
  readonly failureClass: ExceptionFailureClass;
  readonly errorCode: string;
  /** Already redacted by the caller (ADR-0053 §4); truncated to 2,000 characters here. */
  readonly errorMessage: string;
  readonly serviceIdentityId?: string | null;
  readonly operationalFailureId?: string | null;
  /** The KPIs the failure makes stale (same organization); linked once each. */
  readonly kpiLinks?: readonly { readonly kpiDefinitionId: string; readonly transformationId: string }[];
}

export interface RaiseResult {
  readonly exceptionId: string;
  /** `opened` writes the alert (ADR-0053 §6, BE-K2); a recurrence never does. */
  readonly outcome: "opened" | "recurred";
}

export const dedupKeyOf = (i: Pick<RaiseExceptionInput, "sourceKind" | "sourceCode" | "failureClass">): string =>
  `${i.sourceKind}:${i.sourceCode}:${i.failureClass}`;
export const exceptionLockKey = (organizationId: string | null, dedupKey: string): string =>
  `${organizationId ?? "platform"}:${dedupKey}`;

const clip = (s: string, n: number): string => {
  const t = s.trim().length > 0 ? s : "error";
  return t.length > n ? t.slice(0, n) : t;
};

async function lockException(tx: Tx, organizationId: string | null, dedupKey: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${OPERATIONAL_EXCEPTION_LOCK}::int4, hashtext(${exceptionLockKey(organizationId, dedupKey)}::text))`.execute(
    tx,
  );
}

async function activeException(tx: Tx, organizationId: string | null, dedupKey: string) {
  return tx
    .selectFrom("operational_exception")
    .selectAll()
    .where(sql<boolean>`organization_id IS NOT DISTINCT FROM ${organizationId}::uuid`)
    .where("dedup_key", "=", dedupKey)
    .where("status", "in", [...ACTIVE])
    .forUpdate()
    .executeTakeFirst();
}

/**
 * ADR-0053 §2: open, or recur, the active exception of one source and failure class, under lock `operationalExceptionUpsert`, in the caller's
 * transaction (the one that records the failure), with one audit event (`operational_exception.opened` or
 * `.recurred`, actor `ctx`). Never inserts blindly: the unique index operational_exception_one_active_key is only the
 * backstop.
 */
export async function raiseOperationalException(
  tx: Tx,
  ctx: AuditContext,
  input: RaiseExceptionInput,
): Promise<RaiseResult> {
  const dedupKey = dedupKeyOf(input);
  await lockException(tx, input.organizationId, dedupKey);
  const message = clip(input.errorMessage, 2000);
  const current = await activeException(tx, input.organizationId, dedupKey);
  let result: RaiseResult;
  if (current === undefined) {
    const idRow = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
    const id = idRow.rows[0]!.id;
    const row = await tx
      .insertInto("operational_exception")
      .values({
        id,
        organization_id: input.organizationId,
        source_kind: input.sourceKind,
        source_code: input.sourceCode,
        failure_class: input.failureClass,
        dedup_key: dedupKey,
        service_identity_id: input.serviceIdentityId ?? null,
        operational_failure_id: input.operationalFailureId ?? null,
        first_occurred_at: sql<Date>`now()`,
        last_occurred_at: sql<Date>`now()`,
        last_error_code: input.errorCode,
        last_error_message: message,
        created_by: ctx.actorUserId,
        updated_by: ctx.actorUserId,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: "operational_exception.opened",
      recordType: "operational_exception",
      recordId: row.id,
      organizationId: input.organizationId,
      newVersion: row.version,
      changes: {
        dedup_key: { from: null, to: dedupKey },
        status: { from: null, to: "open" },
        last_error_code: { from: null, to: input.errorCode },
        ...(input.kpiLinks && input.kpiLinks.length > 0
          ? { kpi_definition_ids: { from: null, to: input.kpiLinks.map((k) => k.kpiDefinitionId) } }
          : {}),
      },
    });
    result = { exceptionId: row.id, outcome: "opened" };
  } else {
    const updated = await tx
      .updateTable("operational_exception")
      .set({
        occurrence_count: current.occurrence_count + 1,
        last_occurred_at: sql<Date>`greatest(now(), ${current.last_occurred_at}::timestamptz)`,
        last_error_code: input.errorCode,
        last_error_message: message,
        ...(input.operationalFailureId ? { operational_failure_id: input.operationalFailureId } : {}),
        version: current.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.actorUserId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: "operational_exception.recurred",
      recordType: "operational_exception",
      recordId: current.id,
      organizationId: current.organization_id,
      priorVersion: current.version,
      newVersion: updated.version,
      changes: {
        occurrence_count: { from: current.occurrence_count, to: current.occurrence_count + 1 },
        last_error_code: { from: current.last_error_code, to: input.errorCode },
      },
    });
    result = { exceptionId: current.id, outcome: "recurred" };
  }
  if (input.organizationId !== null)
    for (const k of input.kpiLinks ?? []) {
      const linkId = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
      await tx
        .insertInto("operational_exception_kpi")
        .values({
          id: linkId.rows[0]!.id,
          operational_exception_id: result.exceptionId,
          organization_id: input.organizationId,
          transformation_id: k.transformationId,
          kpi_definition_id: k.kpiDefinitionId,
        })
        .onConflict((oc) => oc.columns(["operational_exception_id", "kpi_definition_id"]).doNothing())
        .execute();
    }
  return result;
}

/**
 * ADR-0053 §2 automatic recovery: the source succeeded again, so its active exception (if any) is resolved `recovered`
 * (no user, no note), under the same lock, with its audit event. Returns the resolved id, or null when none was active.
 */
export async function recoverOperationalException(
  tx: Tx,
  ctx: AuditContext,
  key: Pick<RaiseExceptionInput, "organizationId" | "sourceKind" | "sourceCode" | "failureClass">,
): Promise<string | null> {
  const dedupKey = dedupKeyOf(key);
  await lockException(tx, key.organizationId, dedupKey);
  const current = await activeException(tx, key.organizationId, dedupKey);
  if (current === undefined) return null;
  const updated = await tx
    .updateTable("operational_exception")
    .set({
      status: "resolved",
      resolved_at: sql<Date>`now()`,
      resolution: "recovered",
      version: current.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: null,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: "operational_exception.resolved",
    recordType: "operational_exception",
    recordId: current.id,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { status: { from: current.status, to: "resolved" }, resolution: { from: null, to: "recovered" } },
  });
  return current.id;
}
