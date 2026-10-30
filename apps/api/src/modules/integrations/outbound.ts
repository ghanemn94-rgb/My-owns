// Guarded outbound writes (ADR-0055 §5, §8, §9, §10; REQ-S17-006 "Outbound writes require a specific permission, carry
// an idempotency key and are marked done only on a confirmed response"; p6-work-split §B/A.7; T-DG6-BE-N2). The routes
// are in routes.ts (outbound-write block).
//
// Authorization (0107; permissions matrix §26; ADR-0055 §9): reading is `outbound_write.read` (TD, KDS, TO, AUD) in the
// write's transformation through `ReadScope` (ADR-0051 §1): a caller who cannot read the transformation gets 404
// (existence never disclosed); one who can read it but lacks the code gets 403. Executing and re-checking the
// confirmation is `outbound_write.execute` (TD only by default, implied by no other code): KDS, ADM_TECH and AUD get
// 403. The configuring administrator (ADM_TECH) never executes a write by default (SoD). `outbound_write.execute` is a
// write code, never a business-approval or Finance-validation code: a downstream write approves nothing (G1-G6) and
// never touches DG0-DG7.
//
// The flow (ADR-0055 §5 steps 1-5):
//   transaction 1 under the outboundWrite advisory lock (key `<connectorId>:<idempotencyKey>`): commit-time
//     re-authorization on the reloaded grants; a write with the key that asks for the same thing (transformation,
//     deliverable, action and payload SHA-256) is returned as it is (REPLAY: 200, no new row, NO dispatch); a different
//     request under the key is 409 `outbound_write.idempotency_key_reused`. Otherwise the connector must be enabled
//     (409 `connector.disabled`) and its CURRENT configuration must list the action (422
//     `outbound_write.action_not_allowed`), and the write is inserted `requested` (version 1) acting as the connector's
//     own service identity, with its audit event `outbound_write.requested`.
//   OUTSIDE any transaction: the credential references resolved (SecretProvider), then the adapter's
//     `dispatch(action, payload, idempotencyKey)` with the SAME key (the downstream deduplicates by key; the local test
//     adapter counts one effect per key, the A13 proof), under a timeout.
//   transaction 2 under the same lock: `confirmed` ONLY on an adapter outcome `confirmed` with a reference; `failed` on a
//     definitive rejection; otherwise (`accepted_unconfirmed`, `no_response`, an adapter error, a timeout) the write
//     becomes or stays `pending_confirmation`. A crash between the steps leaves it `requested`; `confirmOutboundWrite`
//     re-dispatches a `requested` write with the same key, so the downstream effect stays one.
//   confirmOutboundWrite asks the adapter for the outcome of the key (no new effect) and applies the same rule. There is
//     NO manual "mark confirmed": a write is done only on a confirmed response (M0335, ADR-0055 Alternative 4).
// `confirmed` and `failed` never change (0104 outbound_write_guard; 409 `outbound_write.final`). Transaction 2 records
// what the downstream answered; it does not re-authorize (the dispatch already happened under the transaction-1 check,
// and an answer that is not recorded would be lost), and it acts as the requesting user for the history and the audit.
//
// The deliverable connector confirmation of REQ-S01-005 (ADR-0055 §6) is written by the portfolio module (BE-O). It is
// called through the port below, registered at composition, inside transaction 2 when a `deliverable_status_push`
// becomes `confirmed`; integrations imports no portfolio code. With no port registered nothing else happens.
//
// Nothing here is "live" or "connected to Mobily": the local test adapter is the only downstream exercised in this
// release (D-195 Q14, p6-plan R3; the 0104 guard allows outbound actions on test-adapter connectors only).
import { createHash } from "node:crypto";
import { sql, type Db, type DbOrTx, type OutboundWriteTable, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { hasInvalidCharacter, uuid } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  denialOf,
  holdsAnywhere,
  readScopeFor,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record as audit, type AuditContext } from "../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, isoOrNull, problems } from "../platform/index.ts";
import {
  ConnectorAdapterError,
  connectorAdapters,
  type ConnectorAdapterKind,
  type ConnectorAdapterRegistry,
  type ConnectorDispatchOutcome,
} from "./adapters/port.ts";
import {
  adapterConfigOf,
  connectorRefusals,
  findConnector,
  jsonbTextBytes,
  type ConnectorConfigRow,
  type ConnectorRow,
} from "./connectors.ts";
import { runRefusals } from "./runs.ts";
import { resolveCredentials } from "./secret-refs.ts";

export const OUTBOUND_WRITE_READ: Permission = "outbound_write.read";
export const OUTBOUND_WRITE_EXECUTE: Permission = "outbound_write.execute";
export const OUTBOUND_ACTIONS = ["deliverable_status_push"] as const;
export type OutboundAction = (typeof OUTBOUND_ACTIONS)[number];
export const OUTBOUND_STATUSES = ["requested", "pending_confirmation", "confirmed", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];
export type OutboundWriteRow = Selectable<OutboundWriteTable>;

/** How long a dispatch or an outcome query waits for the adapter before the write stays pending_confirmation. */
export const OUTBOUND_ADAPTER_TIMEOUT_MS = 30_000;
/** The 0104 CHECK on outbound_write.payload: the jsonb text is at most 16 KiB. */
export const MAX_PAYLOAD_BYTES = 16_384;
/** The 0104 CHECK on outbound_write.attempt_count. */
const MAX_ATTEMPTS = 10;
/** A payload key named like a secret (the connector settings rule of ADR-0055 §1, applied at every depth). */
const SECRET_LIKE_KEY = /(secret|password|passwd|token|apikey|api_key|credential)/;
/** The 0104 CHECK on outbound_write.failure_code. */
const FAILURE_CODE = /^[a-z][a-z0-9_.]{0,99}$/;
/** The code recorded for a definitive rejection whose own code does not fit the column. */
const DEFAULT_FAILURE_CODE = "outbound_write.rejected";

// ------------------------------------------------------------------------------------------------ request bodies

/** OutboundWriteExecute (the contract; the payload's size, secret keys and characters are checked below). */
export const outboundWriteExecute = z.strictObject({
  connectorId: uuid,
  actionCode: z.enum(OUTBOUND_ACTIONS),
  deliverableId: uuid,
  idempotencyKey: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  payload: z.record(z.string(), z.unknown()),
});
export type OutboundWriteExecuteBody = z.infer<typeof outboundWriteExecute>;
/** OutboundWriteConfirm: an empty object. */
export const outboundWriteConfirm = z.strictObject({});

// ------------------------------------------------------------------------------------------------ refusals

const conflict409 = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.invalidTransition, code, title: "Conflict", detail });

/** The outbound-write refusals of ADR-0055 §9 (English verbatim; codes are i18n keys under `problems.`). */
export const outboundRefusals = {
  idempotencyKeyReused: () =>
    conflict409(
      "outbound_write.idempotency_key_reused",
      "This idempotency key was already used for a different request.",
    ),
  actionNotAllowed: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "outbound_write.action_not_allowed",
      title: "Business rule violated",
      detail: "The connector's current configuration does not allow this action.",
      errors: [
        {
          pointer: "/actionCode",
          code: "outbound_write.action_not_allowed",
          message: "The connector's current configuration does not allow this action.",
        },
      ],
    }),
  final: () => conflict409("outbound_write.final", "This write is already confirmed or failed and cannot change."),
  disabled: runRefusals.disabled,
} as const;

// ------------------------------------------------------------------------------------------------ payload

/**
 * The payload rules before any database work (ADR-0055 §5 "an object ≤ 16 KiB; never a secret"): the jsonb text at
 * most 16 KiB (400 validation.too_big); no key named like a secret at any depth (422 connector.secret_value_refused, the
 * ADR-0055 §9 text for "a secret, not a reference"); every string key and value free of the characters the shared
 * free-text rule refuses (400 validation.invalid_character).
 */
export function checkPayload(payload: Readonly<Record<string, unknown>>): void {
  if (jsonbTextBytes(payload) > MAX_PAYLOAD_BYTES)
    throw problems.badRequest("validation.too_big", "The payload is larger than 16 KiB.", "/payload");
  const walk = (value: unknown, pointer: string): void => {
    if (typeof value === "string") {
      if (hasInvalidCharacter(value))
        throw problems.badRequest("validation.invalid_character", "Remove the unsupported character.", pointer);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${pointer}/${i}`));
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const at = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (hasInvalidCharacter(key))
        throw problems.badRequest("validation.invalid_character", "Remove the unsupported character.", at);
      if (SECRET_LIKE_KEY.test(key.toLowerCase())) throw connectorRefusals.secretValueRefused(at);
      walk(v, at);
    }
  };
  walk(payload, "/payload");
}

/** Canonical JSON (object keys sorted at every depth): the same payload in any key order has the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The payload's SHA-256 (hex) over its canonical JSON. */
export function payloadSha256(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

// ------------------------------------------------------------------------------------------------ authorization

/**
 * The read gate of a transformation's outbound writes: 404 without `transformation.read`, then the
 * `outbound_write.read` decision through the principal's ReadScope (403 when it does not admit the transformation).
 */
export async function requireOutboundRead(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
): Promise<ResolvedTarget> {
  const target = await requireTransformationRead(db, principal, transformationId);
  const scope = await readScopeFor(db, principal, OUTBOUND_WRITE_READ);
  if (!scope.admits({ recordType: null, recordId: transformationId, target, partyUserIds: [] }))
    throw problems.forbidden().withDenial(denialOf(OUTBOUND_WRITE_READ, target));
  return target;
}

/**
 * The mutation gate: 403 for a caller who holds `outbound_write.execute` nowhere (the same answer for every
 * transformation, so it discloses nothing; KDS, ADM_TECH and AUD hold it nowhere by default, and ADM_TECH cannot read
 * transformations at all), then the transformation read gate (404), then `outbound_write.execute` there (403).
 */
export async function requireOutboundExecute(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
): Promise<ResolvedTarget> {
  if (!holdsAnywhere(principal, OUTBOUND_WRITE_EXECUTE)) throw problems.forbidden();
  const target = await requireTransformationRead(db, principal, transformationId);
  await requireAction(db, principal, OUTBOUND_WRITE_EXECUTE, target);
  return target;
}

/** Inside a transaction, after the lock: the caller's grants reloaded (a right lost meanwhile is 403, F-DG2-440). */
async function recheckExecute(tx: Tx, request: FastifyRequest, transformationId: string): Promise<string> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireOutboundExecute(tx, fresh, transformationId);
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404 && !err.denial)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  return fresh.userId!;
}

const lockOutboundWrite = (tx: Tx, connectorId: string, idempotencyKey: string) =>
  sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.outboundWrite}::int4, hashtext(${`${connectorId}:${idempotencyKey}`}::text))`.execute(
    tx,
  );

// ------------------------------------------------------------------------------------------------ the confirmation port

/** What the connector-confirmation port receives when a write becomes `confirmed` (ADR-0055 §6; BE-O). */
export interface OutboundConfirmedWrite {
  readonly write: OutboundWriteRow;
  readonly connector: Pick<ConnectorRow, "id" | "organization_id">;
  readonly sourceSystemId: string;
}

/**
 * The port through which a confirmed `deliverable_status_push` records the deliverable's connector confirmation
 * (REQ-S01-005). It runs inside transaction 2, so the confirmation and the write commit together; a throw rolls both
 * back (the write stays as it was and the next confirm asks again). Registered at composition by the portfolio module.
 */
export interface OutboundConfirmationPort {
  onConfirmed(tx: Tx, ctx: AuditContext, confirmed: OutboundConfirmedWrite): Promise<void>;
}

let confirmationPort: OutboundConfirmationPort | null = null;

/** Registers the connector-confirmation port (composition) and returns the previous one (tests restore it). */
export function setOutboundConfirmationPort(port: OutboundConfirmationPort | null): OutboundConfirmationPort | null {
  const previous = confirmationPort;
  confirmationPort = port;
  return previous;
}

// ------------------------------------------------------------------------------------------------ reads

/** One write of the transformation; 404 when it does not exist there. */
export async function findOutboundWrite(
  db: DbOrTx,
  transformationId: string,
  writeId: string,
): Promise<OutboundWriteRow> {
  const row = await db
    .selectFrom("outbound_write")
    .selectAll()
    .where("id", "=", writeId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

export interface OutboundListQuery {
  readonly status?: OutboundStatus;
  readonly deliverableId?: string;
  /** Exclusive bound (created_at ISO, id) of the page, newest first (decoded cursor). */
  readonly after: readonly [string, string] | null;
  readonly limit: number;
}

/** The writes of a transformation the caller may read (the caller passed requireOutboundRead), newest first. */
export async function listOutboundWrites(
  db: DbOrTx,
  transformationId: string,
  query: OutboundListQuery,
): Promise<OutboundWriteRow[]> {
  let q = db.selectFrom("outbound_write").selectAll().where("transformation_id", "=", transformationId);
  if (query.status) q = q.where("status", "=", query.status);
  if (query.deliverableId) q = q.where("deliverable_id", "=", query.deliverableId);
  if (query.after)
    q = q.where(sql<boolean>`(created_at, id) < (${query.after[0]}::timestamptz, ${query.after[1]}::uuid)`);
  return q
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(query.limit + 1)
    .execute();
}

/** The contract's OutboundWrite. `requested` and `pending_confirmation` are pending, never done (ADR-0055 §10). */
export function toOutboundWrite(r: OutboundWriteRow) {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    connectorId: r.connector_id,
    configVersionNo: r.config_version_no,
    actionCode: r.action_code as OutboundAction,
    deliverableId: r.deliverable_id,
    idempotencyKey: r.idempotency_key,
    payload: r.payload as Record<string, unknown>,
    payloadSha256: r.payload_sha256,
    status: r.status as OutboundStatus,
    attemptCount: r.attempt_count,
    lastAttemptAt: isoOrNull(r.last_attempt_at),
    externalReference: r.external_reference,
    confirmedAt: isoOrNull(r.confirmed_at),
    failureCode: r.failure_code,
    failureMessage: r.failure_message,
    requestedBy: r.requested_by,
    createdAt: iso(r.created_at),
    version: r.version,
  };
}

/** The contract's OutboundWriteDetail: the write and its trigger-written status history, oldest first. */
export async function toOutboundWriteDetail(db: DbOrTx, r: OutboundWriteRow) {
  const events = await db
    .selectFrom("outbound_write_event")
    .selectAll()
    .where("outbound_write_id", "=", r.id)
    .orderBy("record_version")
    .execute();
  return {
    write: toOutboundWrite(r),
    events: events.map((e) => ({
      recordVersion: e.record_version,
      status: e.status as OutboundStatus,
      attemptCount: e.attempt_count,
      externalReference: e.external_reference,
      failureCode: e.failure_code,
      actorUserId: e.actor_user_id,
      occurredAt: iso(e.occurred_at),
    })),
  };
}

// ------------------------------------------------------------------------------------------------ the adapter call

export interface OutboundOptions {
  /** The adapters (default: this process's registry). */
  readonly adapters?: ConnectorAdapterRegistry;
  readonly adapterTimeoutMs?: number;
  /**
   * Test hook (the A13 crash between steps, QA-C): called after the adapter call and before transaction 2; a throw
   * stops there and leaves the write as transaction 1 left it.
   */
  readonly beforeRecord?: (writeId: string) => void | Promise<void>;
}

let crashHook: ((writeId: string) => void | Promise<void>) | null = null;

/**
 * Test seam (the A13 crash between steps through the API; QA-C): a hook run after every adapter call and before
 * transaction 2 when the call passes no `beforeRecord`. A throw stops the request there (500), leaving the write as
 * transaction 1 left it. Returns the previous hook; never set outside tests.
 */
export function setOutboundCrashHook(
  hook: ((writeId: string) => void | Promise<void>) | null,
): ((writeId: string) => void | Promise<void>) | null {
  const previous = crashHook;
  crashHook = hook;
  return previous;
}

const beforeRecord = async (options: OutboundOptions, writeId: string): Promise<void> => {
  const hook = options.beforeRecord ?? crashHook;
  if (hook) await hook(writeId);
};

/** What transaction 2 records: the adapter's answer, and whether this call dispatched (an attempt) or only asked. */
interface AdapterAnswer {
  readonly outcome: ConnectorDispatchOutcome;
  readonly dispatched: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorAdapterError("connector.source_unavailable")), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** An answer only counts as confirmed with a reference that fits the column; anything else is no answer. */
function normalizeOutcome(raw: unknown): ConnectorDispatchOutcome {
  if (raw === null || typeof raw !== "object") return { outcome: "no_response" };
  const o = raw as { outcome?: unknown; externalReference?: unknown; failureCode?: unknown };
  if (o.outcome === "confirmed")
    return typeof o.externalReference === "string" &&
      o.externalReference.length >= 1 &&
      o.externalReference.length <= 200 &&
      !hasInvalidCharacter(o.externalReference)
      ? { outcome: "confirmed", externalReference: o.externalReference }
      : { outcome: "no_response" };
  if (o.outcome === "rejected")
    return {
      outcome: "rejected",
      failureCode:
        typeof o.failureCode === "string" && FAILURE_CODE.test(o.failureCode) ? o.failureCode : DEFAULT_FAILURE_CODE,
    };
  if (o.outcome === "accepted_unconfirmed") return { outcome: "accepted_unconfirmed" };
  return { outcome: "no_response" };
}

/**
 * Outside any transaction: dispatch the write with its key (a `requested` write) or ask for the key's outcome (a
 * `pending_confirmation` write). An adapter error, an unresolvable secret or a timeout is no answer: the write stays
 * pending (the reason is not stored; it could carry a downstream's response text).
 */
async function callAdapter(
  connector: ConnectorRow,
  config: ConnectorConfigRow,
  write: OutboundWriteRow,
  dispatch: boolean,
  options: OutboundOptions,
): Promise<AdapterAnswer> {
  const adapter = (options.adapters ?? connectorAdapters()).get(connector.adapter_kind as ConnectorAdapterKind);
  if (!adapter) return { outcome: { outcome: "no_response" }, dispatched: false };
  const adapterConfig = adapterConfigOf(connector, config);
  const ms = options.adapterTimeoutMs ?? OUTBOUND_ADAPTER_TIMEOUT_MS;
  let credentials;
  try {
    credentials = await resolveCredentials(config.credential_refs);
  } catch {
    // Nothing was sent: no attempt is counted.
    return { outcome: { outcome: "no_response" }, dispatched: false };
  }
  try {
    const raw = dispatch
      ? await withTimeout(
          adapter.dispatch(
            adapterConfig,
            {
              action: write.action_code as OutboundAction,
              payload: write.payload as Record<string, unknown>,
              idempotencyKey: write.idempotency_key,
            },
            { credentials, since: null },
          ),
          ms,
        )
      : await withTimeout(adapter.outcome(adapterConfig, write.idempotency_key, { credentials, since: null }), ms);
    return { outcome: normalizeOutcome(raw), dispatched: dispatch };
  } catch {
    return { outcome: { outcome: "no_response" }, dispatched: dispatch };
  }
}

// ------------------------------------------------------------------------------------------------ transaction 2

/** The status an answer leads to from a non-final status (ADR-0055 §5 step 4). */
function nextStatus(current: OutboundStatus, answer: AdapterAnswer): OutboundStatus {
  if (answer.outcome.outcome === "confirmed") return "confirmed";
  if (answer.outcome.outcome === "rejected") return "failed";
  // No confirmation: a dispatched write is pending; one never dispatched stays as it is (requested).
  return current === "requested" && !answer.dispatched ? "requested" : "pending_confirmation";
}

/**
 * Records an answer on a write (under the lock, the row locked). A final write is returned unchanged; an answer that
 * changes nothing (a pending write still unconfirmed) writes nothing and audits nothing. Otherwise the write steps one
 * version with its audit event, and a `confirmed` write calls the connector-confirmation port in the same transaction.
 */
async function recordAnswer(
  tx: Tx,
  ctx: AuditContext,
  locked: OutboundWriteRow,
  answer: AdapterAnswer,
): Promise<OutboundWriteRow> {
  const from = locked.status as OutboundStatus;
  if (from === "confirmed" || from === "failed") return locked;
  const to = nextStatus(from, answer);
  const attempt = answer.dispatched && locked.attempt_count < MAX_ATTEMPTS;
  if (to === from && !attempt) return locked;
  const confirmed = answer.outcome.outcome === "confirmed" ? answer.outcome.externalReference : null;
  const failureCode = answer.outcome.outcome === "rejected" ? answer.outcome.failureCode : null;
  const updated = await tx
    .updateTable("outbound_write")
    .set({
      status: to,
      attempt_count: attempt ? locked.attempt_count + 1 : locked.attempt_count,
      ...(attempt ? { last_attempt_at: sql<Date>`now()` } : {}),
      ...(confirmed !== null ? { external_reference: confirmed, confirmed_at: sql<Date>`now()` } : {}),
      ...(failureCode !== null ? { failure_code: failureCode } : {}),
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.actorUserId,
    })
    .where("id", "=", locked.id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: `outbound_write.${to}`,
    recordType: "outbound_write",
    recordId: locked.id,
    organizationId: locked.organization_id,
    transformationId: locked.transformation_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    changes: {
      ...(to !== from ? { status: { from, to } } : {}),
      ...(attempt ? { attempt_count: { from: locked.attempt_count, to: updated.attempt_count } } : {}),
      ...(confirmed !== null ? { external_reference: { from: null, to: confirmed } } : {}),
      ...(failureCode !== null ? { failure_code: { from: null, to: failureCode } } : {}),
    },
  });
  if (to === "confirmed" && confirmationPort !== null) {
    const connector = (await findConnector(tx, updated.connector_id))!;
    const config = await configOf(tx, updated.connector_id, updated.config_version_no);
    await confirmationPort.onConfirmed(tx, ctx, {
      write: updated,
      connector: { id: connector.id, organization_id: connector.organization_id },
      sourceSystemId: config.source_system_id,
    });
  }
  return updated;
}

async function configOf(db: DbOrTx, connectorId: string, versionNo: number): Promise<ConnectorConfigRow> {
  return db
    .selectFrom("connector_config_version")
    .selectAll()
    .where("connector_id", "=", connectorId)
    .where("version_no", "=", versionNo)
    .executeTakeFirstOrThrow();
}

async function lockedWrite(tx: Tx, id: string): Promise<OutboundWriteRow> {
  return tx.selectFrom("outbound_write").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
}

// ------------------------------------------------------------------------------------------------ execute

export interface ExecuteResult {
  readonly write: OutboundWriteRow;
  /** True when the key named an existing write: nothing was inserted or dispatched (200). */
  readonly replay: boolean;
}

/**
 * The connector and the deliverable a request names, before the transaction: both must exist in the transformation's
 * organization (the connector) and in the transformation itself (the deliverable); otherwise 404.
 */
export async function requireExecuteSubjects(
  db: DbOrTx,
  target: ResolvedTarget,
  transformationId: string,
  body: Pick<OutboundWriteExecuteBody, "connectorId" | "deliverableId">,
): Promise<void> {
  const [connector, deliverable] = await Promise.all([
    findConnector(db, body.connectorId),
    db
      .selectFrom("deliverable")
      .select("id")
      .where("id", "=", body.deliverableId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst(),
  ]);
  if (!connector || connector.organization_id !== target.organizationId || !deliverable) throw problems.notFound();
}

/**
 * executeOutboundWrite (ADR-0055 §5 steps 1-4): 201 with the write after its dispatch (confirmed, pending_confirmation
 * or failed); 200 with the existing write for the same key and request (no new row, no dispatch). The caller passed
 * requireOutboundExecute and requireExecuteSubjects and checked the payload.
 */
export async function executeOutboundWrite(
  db: Db,
  request: FastifyRequest,
  transformationId: string,
  body: OutboundWriteExecuteBody,
  options: OutboundOptions = {},
): Promise<ExecuteResult> {
  const hash = payloadSha256(body.payload);
  const ctx = auditContextOf(request);

  // Transaction 1: replay, or the `requested` row with its audit event.
  const first = await db.transaction().execute(async (tx) => {
    await lockOutboundWrite(tx, body.connectorId, body.idempotencyKey);
    const me = await recheckExecute(tx, request, transformationId);
    const existing = await tx
      .selectFrom("outbound_write")
      .selectAll()
      .where("connector_id", "=", body.connectorId)
      .where("idempotency_key", "=", body.idempotencyKey)
      .executeTakeFirst();
    if (existing) {
      const same =
        existing.payload_sha256 === hash &&
        existing.transformation_id === transformationId &&
        existing.deliverable_id === body.deliverableId &&
        existing.action_code === body.actionCode;
      if (!same) throw outboundRefusals.idempotencyKeyReused();
      return { kind: "replay" as const, write: existing };
    }
    const connector = await tx
      .selectFrom("connector")
      .selectAll()
      .where("id", "=", body.connectorId)
      .forShare()
      .executeTakeFirst();
    if (!connector) throw problems.notFound();
    if (connector.status !== "enabled") throw outboundRefusals.disabled();
    const config = await configOf(tx, connector.id, connector.config_version_no);
    if (!config.outbound_actions.includes(body.actionCode)) throw outboundRefusals.actionNotAllowed();
    const identity = await tx
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", connector.id)
      .where("subject_kind", "=", "connector")
      .executeTakeFirstOrThrow();
    const id = uuidv7();
    const write = await tx
      .insertInto("outbound_write")
      .values({
        id,
        organization_id: connector.organization_id,
        transformation_id: transformationId,
        connector_id: connector.id,
        config_version_no: connector.config_version_no,
        action_code: body.actionCode,
        deliverable_id: body.deliverableId,
        idempotency_key: body.idempotencyKey,
        payload: JSON.stringify(body.payload),
        payload_sha256: hash,
        requested_by: me,
        service_identity_id: identity.id,
        created_by: me,
        updated_by: me,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: "outbound_write.requested",
      recordType: "outbound_write",
      recordId: id,
      organizationId: connector.organization_id,
      transformationId,
      newVersion: 1,
      changes: {
        connector_id: { from: null, to: connector.id },
        config_version_no: { from: null, to: connector.config_version_no },
        action_code: { from: null, to: body.actionCode },
        deliverable_id: { from: null, to: body.deliverableId },
        idempotency_key: { from: null, to: body.idempotencyKey },
        payload_sha256: { from: null, to: hash },
        status: { from: null, to: "requested" },
      },
    });
    return { kind: "new" as const, write, connector, config };
  });
  if (first.kind === "replay") return { write: first.write, replay: true };

  // Outside any transaction: the dispatch with the same key.
  const answer = await callAdapter(first.connector, first.config, first.write, true, options);
  await beforeRecord(options, first.write.id);

  // Transaction 2: the answer.
  const write = await db.transaction().execute(async (tx) => {
    await lockOutboundWrite(tx, first.write.connector_id, first.write.idempotency_key);
    return recordAnswer(tx, ctx, await lockedWrite(tx, first.write.id), answer);
  });
  return { write, replay: false };
}

// ------------------------------------------------------------------------------------------------ confirm

/**
 * confirmOutboundWrite (ADR-0055 §5 step 5): 409 outbound_write.final for a confirmed or failed write; 409 for a stale
 * If-Match. A `requested` write (a crash between the steps) is re-dispatched with its same key, payload and
 * configuration version (the downstream deduplicates: one effect); a `pending_confirmation` write is only asked about
 * (no new effect). The answer is recorded as in executeOutboundWrite; an unchanged pending write is returned as it is.
 * A concurrent confirm that recorded first makes this one 409 (its re-dispatch was deduplicated by key).
 */
export async function confirmOutboundWrite(
  db: Db,
  request: FastifyRequest,
  transformationId: string,
  writeId: string,
  expectedVersion: number,
  options: OutboundOptions = {},
): Promise<OutboundWriteRow> {
  const ctx = auditContextOf(request);
  const head = await findOutboundWrite(db, transformationId, writeId);

  // Transaction 1: the commit-time re-check, the final and version checks, the configuration the write used.
  const first = await db.transaction().execute(async (tx) => {
    await lockOutboundWrite(tx, head.connector_id, head.idempotency_key);
    await recheckExecute(tx, request, transformationId);
    const locked = await lockedWrite(tx, writeId);
    if (locked.status === "confirmed" || locked.status === "failed") throw outboundRefusals.final();
    if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
    const connector = (await findConnector(tx, locked.connector_id))!;
    const config = await configOf(tx, locked.connector_id, locked.config_version_no);
    return { locked, connector, config };
  });

  // Outside any transaction: re-dispatch a `requested` write, else ask for the key's outcome.
  const answer = await callAdapter(
    first.connector,
    first.config,
    first.locked,
    first.locked.status === "requested",
    options,
  );
  await beforeRecord(options, writeId);

  // Transaction 2: the answer, if nobody recorded one meanwhile.
  return db.transaction().execute(async (tx) => {
    await lockOutboundWrite(tx, head.connector_id, head.idempotency_key);
    const locked = await lockedWrite(tx, writeId);
    if (locked.version !== first.locked.version) {
      if (locked.status === "confirmed" || locked.status === "failed") throw outboundRefusals.final();
      throw problems.versionConflict(locked.version);
    }
    return recordAnswer(tx, ctx, locked, answer);
  });
}
