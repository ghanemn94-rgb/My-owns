// The notification channel fan-out after commit, exactly once (P6 slice C; ADR-0054 §3; REQ-S12-023 "every
// notification is written to the inbox; external channels are sent only when configured"; A21 "with no email adapter
// configured all workflows complete and notifications appear in the inbox"; p6-work-split §J/C.11, T-DG6-BE-I2).
//
// The in-app inbox is always on and is not a channel: every notification is written to `inbox_notification` in its
// producing transaction, exactly as in DG4/DG5, together with the outbox event `inbox_notification.created`
// (apps/api tasks/service.ts createWorkItemOnce and its twin in ../kit.ts). Everything here runs AFTER that commit:
//
// notifications.fanout (consumer of inbox_notification.created; identity job:notifications.fanout, 0121)
//   1. No ENABLED channel row in the notification's organization: nothing is written at all (no delivery row, no
//      ledger row; A21). A held notification (quiet hours or a digest, ADR-0044 §5) is not fanned out yet: the sweep
//      below fans it out when the digest job releases it, never before. A notification folded into a digest is never
//      fanned out on its own; the digest notification is.
//   2. Otherwise, inside runOnce keyed `notification:<notificationId>` (consumer notifications.fanout), one
//      notification_delivery per enabled channel: `pending`, or `skipped` with its reason (`recipient_disabled`,
//      `no_address`), each with one audit event (actor service, source worker). The UNIQUE backstop
//      notification_delivery_once_key (inbox_notification_id, channel_kind) makes a replay create nothing (ND02).
//   3. Then each pending delivery is sent OUTSIDE any transaction (sendDelivery): a session advisory lock 730306
//      (`channelDelivery`, key "<notificationId>:<channelKind>") on one reserved connection, the row re-read and skipped
//      unless it is still `pending`, the message rendered at send time in the recipient's locale (render.ts; the
//      `inbox.restricted` text, without any messageParams value, when the recipient can no longer read the target), the
//      deep link issued lazily (the twin of the API's issueDeepLink), the send, and then one short transaction that
//      records `sent` (sent_at) or `failed` (error_code), counting the attempt exactly once (ND08), with its audit event.
//      A channel disabled meanwhile turns the delivery `skipped` (`channel_disabled`) without a send.
// notifications.delivery_sweep (every minute, 0121; identity job:notifications.delivery_sweep)
//   - fans out the notifications released from hold, and the digest notifications, of the last RELEASE_LOOKBACK_HOURS
//     (the same runOnce key, so the fan-out of a notification still happens once);
//   - retries the failed deliveries whose error is retryable, after an exponential backoff from 10 s, up to 5 attempts
//     (ADR-0008 §4): failed -> pending (audited), then the same send;
//   - sends a pending delivery an interrupted run left behind (older than STUCK_PENDING_SECONDS).
//   A delivery that failed for good (not retryable, or the 5th attempt) stays `failed`, and the queue's operational
//   exception `job_failed` (ADR-0053 §2; source `notifications.fanout`) is opened or recurs, so it is visible in
//   Administration > Operations; the next successful send resolves it `recovered`.
//
// A channel failure never blocks or rolls back the producing workflow: that transaction committed before any of this
// ran, and no producing transaction reads a channel. Exactly once: the runOnce ledger, the UNIQUE backstop, the session
// lock and the `pending` re-read under it. The one window left is a process crash after the SMTP server accepted the
// message and before `sent` is recorded: the row stays `pending` and the sweep sends it again (at least once in that
// window; SMTP has no idempotency key). No message body and no address is stored; error codes are stable codes, never
// server text. A job never approves anything (no business approval, G1-G6) and nothing here reads or writes DG0-DG7.
// Live mail is a residual (D-195 Q7): the adapter is proven against the in-process fake SMTP only.
import { insertAuditEvent, sql, type Db, type DbOrTx, type InboxNotificationRow, type Tx } from "@mth/db";
import { inboxNotificationCreatedV1, outboxEnvelope } from "@mth/shared/schemas";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createEmailChannel } from "../channels/email.ts";
import type {
  ChannelKind,
  ChannelSecretResolver,
  ChannelSendResult,
  NotificationChannel,
  SmtpSettings,
} from "../channels/port.ts";
import { channelLocaleOf, renderNotificationMessage, type ChannelParamValue } from "../channels/render.ts";
import {
  defineJob,
  INBOX_NOTIFICATION_CREATED_EVENT,
  jobActor,
  jobIdentityCode,
  raiseOperationalExceptionTwin,
  recoverOperationalExceptionTwin,
  runOnce,
  type LoadedServiceIdentity,
} from "../kit.ts";
import { ServiceScopeViolation } from "../service-scope.ts";
import type { JobHandler } from "./spec.ts";

export const FANOUT_QUEUE = "notifications.fanout";
export const DELIVERY_SWEEP_QUEUE = "notifications.delivery_sweep";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `channelDelivery` (the worker imports no API code). */
export const CHANNEL_DELIVERY_LOCK = 730306;
/** ADR-0016 §6 `deepLinkIssue` (0098 inbox_notification_deep_link_guard takes the same lock). */
export const DEEP_LINK_ISSUE_LOCK = 730301;
/** ADR-0008 §4: 5 attempts, exponential backoff from 10 s. */
export const MAX_SEND_ATTEMPTS = 5;
export const RETRY_BACKOFF_SECONDS = 10;
/** How far back the sweep looks for released and digest notifications that were not fanned out yet. */
export const RELEASE_LOOKBACK_HOURS = 24;
/** A pending delivery older than this was left by an interrupted run; the sweep sends it. */
export const STUCK_PENDING_SECONDS = 120;
/** The most rows one sweep handles per step; the next minute's run takes the rest. */
export const SWEEP_BATCH = 200;

/** The send error codes after which a retry can succeed (the adapter's `retryable` classification, by code). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "smtp.connection_failed",
  "smtp.timeout",
  "smtp.temporary_failure",
  "smtp.protocol_error",
  "smtp.unknown",
]);

const TR = "transformation.read";
const READS = [TR, "user.read", "access.read", "operations.read"] as const;

export const fanoutKey = (notificationId: string): string => `notification:${notificationId}`;
export const deliveryLockKey = (notificationId: string, kind: string): string => `${notificationId}:${kind}`;
/** Seconds to wait after the n-th failed attempt before the next one (10, 20, 40, 80). */
export const retryDelaySeconds = (attempts: number): number => RETRY_BACKOFF_SECONDS * 2 ** Math.max(0, attempts - 1);

// ------------------------------------------------------------------------------------------------ configuration

export interface NotificationChannelDeps {
  /** Resolves a credential reference (the worker's SecretProvider registry; main.ts). */
  readonly resolveSecret: ChannelSecretResolver;
  /** The application origin of the deep links (APP_BASE_URL); null = a relative `/links/<token>` path. */
  readonly appBaseUrl: URL | null;
  /** Refuse `none` SMTP security (NODE_ENV=production). */
  readonly refuseInsecure: boolean;
  /** The adapter of a channel kind with its settings; null when no adapter ships (enterprise messaging). */
  readonly channelFor: (
    kind: ChannelKind,
    settings: SmtpSettings,
    deps: NotificationChannelDeps,
  ) => NotificationChannel | null;
}

const defaultChannelFor = (
  kind: ChannelKind,
  settings: SmtpSettings,
  deps: NotificationChannelDeps,
): NotificationChannel | null =>
  kind === "email"
    ? createEmailChannel({ settings, resolveSecret: deps.resolveSecret, refuseInsecure: deps.refuseInsecure })
    : null;

const DEFAULT_DEPS: NotificationChannelDeps = Object.freeze({
  resolveSecret: async () => undefined,
  appBaseUrl: null,
  refuseInsecure: true,
  channelFor: defaultChannelFor,
});
let deps: NotificationChannelDeps = DEFAULT_DEPS;

/**
 * Sets what a send needs (main.ts at start-up; tests). Unconfigured, a reference cannot be resolved (credential-less
 * SMTP still works), the link is relative, and `none` security is refused.
 */
export function configureNotificationChannels(next: Partial<NotificationChannelDeps>): void {
  deps = Object.freeze({ ...DEFAULT_DEPS, ...next });
}

// ------------------------------------------------------------------------------------------------ helpers

function requireGrant(identity: LoadedServiceIdentity, codes: readonly string[]): void {
  for (const code of codes) if (!identity.grantedPermissionCodes.includes(code)) throw new ServiceScopeViolation();
}

async function newId(tx: DbOrTx): Promise<string> {
  return (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
}

async function serviceIdentityId(db: DbOrTx, queue: string): Promise<string | null> {
  const row = await db
    .selectFrom("service_identity")
    .select("id")
    .where("code", "=", jobIdentityCode(queue))
    .executeTakeFirst();
  return row?.id ?? null;
}

const enabledChannels = (db: DbOrTx, organizationId: string) =>
  db
    .selectFrom("notification_channel")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("enabled", "=", true)
    .orderBy("channel_kind")
    .execute();

function smtpOf(row: {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: string | null;
  smtp_username_ref: unknown;
  smtp_password_ref: unknown;
  from_address: string | null;
}): SmtpSettings | null {
  if (row.smtp_host === null || row.smtp_port === null || row.smtp_security === null || row.from_address === null)
    return null;
  return {
    host: row.smtp_host,
    port: row.smtp_port,
    security: row.smtp_security as SmtpSettings["security"],
    usernameRef: (row.smtp_username_ref ?? null) as SmtpSettings["usernameRef"],
    passwordRef: (row.smtp_password_ref ?? null) as SmtpSettings["passwordRef"],
    fromAddress: row.from_address,
  };
}

type SkipReason = "no_address" | "recipient_restricted" | "channel_disabled" | "recipient_disabled";

/** Whether the recipient can receive an external message at all (skip reasons decided at fan-out and at send). */
function recipientSkip(user: { status: string; email: string | null } | undefined): SkipReason | null {
  if (!user || user.status !== "active") return "recipient_disabled";
  if (user.email === null || user.email.trim() === "") return "no_address";
  return null;
}

// ------------------------------------------------------------------------------------------------ the read check

type SensitiveType = "benefit" | "business_case" | "evidence";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** The twin of apps/api tasks/deep-links.ts ROUTES (the web routes of the three record types). */
const ROUTES: readonly (readonly [SensitiveType, RegExp])[] = [
  ["benefit", new RegExp(`^/transformations/(${UUID})/benefits/(${UUID})(?:[/?#]|$)`)],
  ["business_case", new RegExp(`^/transformations/(${UUID})/business-cases/(${UUID})(?:[/?#]|$)`)],
  ["evidence", new RegExp(`^/transformations/(${UUID})/evidence/(${UUID})(?:[/?#]|$)`)],
];

/** The twin of apps/api tasks/deep-links.ts `deepLinkTarget` (a pure function; ADR-0051 §3). */
export function deepLinkTargetTwin(
  linkPath: string,
): { recordType: SensitiveType; recordId: string; transformationId: string } | null {
  for (const [recordType, pattern] of ROUTES) {
    const m = pattern.exec(linkPath);
    if (m) return { recordType, recordId: m[2]!.toLowerCase(), transformationId: m[1]!.toLowerCase() };
  }
  return null;
}

/**
 * May the recipient still read the notification's target (ADR-0051 §3)? FAIL-CLOSED restatement of the API's
 * `readableTargets` for one user (the worker imports no API code): an organization-level item is readable; otherwise
 * the user needs an active `transformation.read` grant that reaches the transformation (its organization or one of its
 * business units with a downward-inheriting role, or the transformation itself), and a sensitive record target (and,
 * for evidence, every sensitive benefit or business case it is linked to) needs the user's ACTIVE explicit
 * sensitive-record grant. The ADR-0051 §2 party clause (owner, submitter ...) is not restated, so a party without an
 * explicit grant gets the restricted text here: this can only hide, never reveal. Either way the message carries no
 * record value and the deep link re-authorizes on open.
 */
export async function recipientCanRead(
  db: DbOrTx,
  n: Pick<InboxNotificationRow, "link_path" | "transformation_id" | "target_record_type" | "target_record_id">,
  userId: string,
): Promise<boolean> {
  const path = deepLinkTargetTwin(n.link_path);
  const record =
    n.target_record_type !== null && n.target_record_id !== null
      ? { recordType: n.target_record_type as SensitiveType, recordId: n.target_record_id }
      : path
        ? { recordType: path.recordType, recordId: path.recordId }
        : null;
  const transformationId = n.transformation_id ?? path?.transformationId ?? null;
  if (transformationId === null && record === null) return true;
  if (transformationId === null) return false; // a record target without a transformation: fail closed
  if (path && n.transformation_id !== null && path.transformationId !== n.transformation_id) return false;
  const node = await db
    .selectFrom("scope_node")
    .select(["organization_id", "business_unit_id"])
    .where("scope_type", "=", "transformation")
    .where("scope_id", "=", transformationId)
    .executeTakeFirst();
  if (!node) return false;
  const ancestry = node.business_unit_id
    ? (
        await db
          .selectFrom("business_unit_closure")
          .select("ancestor_id")
          .where("descendant_id", "=", node.business_unit_id)
          .execute()
      ).map((r) => r.ancestor_id)
    : [];
  const grants = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .innerJoin("role_permission as rp", "rp.role_id", "r.id")
    .select(["a.scope_type", "a.scope_id", "r.inherits_downward"])
    .where("a.user_id", "=", userId)
    .where("rp.permission_code", "=", TR)
    .where("a.revoked_at", "is", null)
    .where("a.effective_from", "<=", sql<Date>`now()`)
    .where((eb) => eb.or([eb("a.effective_to", "is", null), eb("a.effective_to", ">", sql<Date>`now()`)]))
    .execute();
  const reaches = grants.some(
    (g) =>
      (g.scope_type === "transformation" && g.scope_id === transformationId) ||
      (g.inherits_downward && g.scope_type === "organization" && g.scope_id === node.organization_id) ||
      (g.inherits_downward && g.scope_type === "business_unit" && ancestry.includes(g.scope_id)),
  );
  if (!reaches) return false;
  if (record === null) return true;
  const refs: { recordType: string; recordId: string }[] = [record];
  if (record.recordType === "evidence") {
    const parents = await sql<{ record_type: string; record_id: string }>`
      SELECT 'benefit' AS record_type, be.benefit_id AS record_id FROM benefit_evidence be WHERE be.evidence_id = ${record.recordId}::uuid
      UNION
      SELECT frt.table_name AS record_type, fa.record_id FROM form_record_attachment fa
        JOIN form_record_type frt ON frt.code = fa.record_type
       WHERE fa.evidence_id = ${record.recordId}::uuid AND frt.table_name IN ('benefit', 'business_case')`.execute(db);
    refs.push(...parents.rows.map((p) => ({ recordType: p.record_type, recordId: p.record_id })));
  }
  for (const ref of refs) {
    const marked = await db
      .selectFrom("record_sensitivity")
      .select("is_sensitive")
      .where("record_type", "=", ref.recordType)
      .where("record_id", "=", ref.recordId)
      .executeTakeFirst();
    if (!marked?.is_sensitive) continue;
    const granted = await db
      .selectFrom("sensitive_record_grant")
      .select("id")
      .where("record_type", "=", ref.recordType)
      .where("record_id", "=", ref.recordId)
      .where("grantee_user_id", "=", userId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!granted) return false;
  }
  return true;
}

/**
 * The twin of apps/api tasks/deep-links.ts `issueDeepLink` (ADR-0051 §3): under the deepLinkIssue lock, set the
 * notification's opaque token once (and its record target when the link path names one), with one audit event
 * `inbox_notification.link_issued`; a token already set is reused and nothing is written.
 */
export async function issueDeepLinkTwin(db: Db, notificationId: string, jobId: string): Promise<string> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${DEEP_LINK_ISSUE_LOCK}::integer, hashtext(${notificationId}::text))`.execute(
      tx,
    );
    const current = await tx
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", notificationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (current.link_token !== null) return current.link_token;
    const token = randomBytes(32).toString("base64url");
    const target = current.target_record_type === null ? deepLinkTargetTwin(current.link_path) : null;
    const updated = await tx
      .updateTable("inbox_notification")
      .set({
        link_token: token,
        ...(target ? { target_record_type: target.recordType, target_record_id: target.recordId } : {}),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", notificationId)
      .where("version", "=", current.version)
      .returning(["version"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: "inbox_notification.link_issued",
      recordType: "inbox_notification",
      recordId: notificationId,
      organizationId: current.organization_id,
      transformationId: current.transformation_id,
      priorVersion: current.version,
      newVersion: updated.version,
      changes: target
        ? { link_issued: { from: false, to: true }, target_record_type: { from: null, to: target.recordType } }
        : { link_issued: { from: false, to: true } },
    });
    return token;
  });
}

// ------------------------------------------------------------------------------------------------ fan-out

export type FanoutOutcome = "not_found" | "no_channel" | "held" | "digested" | "duplicate" | "fanned_out";

export interface FanoutResult {
  readonly outcome: FanoutOutcome;
  /** The deliveries this call created (pending or skipped); empty on a replay. */
  readonly created: readonly { readonly id: string; readonly status: "pending" | "skipped" }[];
}

/**
 * Step 2 of ADR-0054 §3: the delivery rows of one notification, once. Writes nothing when the organization has no
 * enabled channel (A21), when the notification is still held, or when it was folded into a digest.
 */
export async function fanOutNotification(db: Db, notificationId: string, jobId: string): Promise<FanoutResult> {
  const n = await db.selectFrom("inbox_notification").selectAll().where("id", "=", notificationId).executeTakeFirst();
  if (!n) return { outcome: "not_found", created: [] };
  // `delivered` is final for a notification (held -> delivered | digested, 0075), so this check does not race.
  if (n.delivery_state === "held") return { outcome: "held", created: [] };
  if (n.delivery_state === "digested") return { outcome: "digested", created: [] };
  if ((await enabledChannels(db, n.organization_id)).length === 0) return { outcome: "no_channel", created: [] };
  const run = await runOnce(db, FANOUT_QUEUE, fanoutKey(n.id), async (tx) => {
    const channels = await enabledChannels(tx, n.organization_id);
    const user = await tx
      .selectFrom("app_user")
      .select(["status", "email"])
      .where("id", "=", n.recipient_user_id)
      .executeTakeFirst();
    const skip = recipientSkip(user);
    const created: { id: string; status: "pending" | "skipped" }[] = [];
    for (const channel of channels) {
      const status = skip === null ? "pending" : "skipped";
      const id = await newId(tx);
      const row = await tx
        .insertInto("notification_delivery")
        .values({
          id,
          organization_id: n.organization_id,
          inbox_notification_id: n.id,
          channel_kind: channel.channel_kind,
          status,
          skip_reason: skip,
          created_by: null,
          updated_by: null,
        })
        .onConflict((oc) => oc.columns(["inbox_notification_id", "channel_kind"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!row) continue;
      await insertAuditEvent(tx, jobActor(jobId), {
        action: status === "pending" ? "notification_delivery.created" : "notification_delivery.skipped",
        recordType: "notification_delivery",
        recordId: id,
        organizationId: n.organization_id,
        transformationId: n.transformation_id,
        newVersion: 1,
        changes: {
          inbox_notification_id: { from: null, to: n.id },
          channel_kind: { from: null, to: channel.channel_kind },
          status: { from: null, to: status },
          ...(skip !== null ? { skip_reason: { from: null, to: skip } } : {}),
        },
      });
      created.push({ id, status });
    }
    return created;
  });
  if (run.outcome === "duplicate") return { outcome: "duplicate", created: [] };
  return { outcome: "fanned_out", created: run.result };
}

// ------------------------------------------------------------------------------------------------ the send

export type SendOutcome = "sent" | "failed" | "skipped" | "not_pending" | "locked" | "not_found";

interface DeliveryRow {
  id: string;
  organization_id: string;
  inbox_notification_id: string;
  channel_kind: string;
  status: string;
  attempts: number;
  version: number;
}

async function recordSkip(tx: Tx, jobId: string, d: DeliveryRow, reason: SkipReason): Promise<void> {
  const updated = await tx
    .updateTable("notification_delivery")
    .set({ status: "skipped", skip_reason: reason, version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
    .where("id", "=", d.id)
    .where("version", "=", d.version)
    .where("status", "=", "pending")
    .returning("version")
    .executeTakeFirst();
  if (!updated) return;
  await insertAuditEvent(tx, jobActor(jobId), {
    action: "notification_delivery.skipped",
    recordType: "notification_delivery",
    recordId: d.id,
    organizationId: d.organization_id,
    priorVersion: d.version,
    newVersion: updated.version,
    changes: { status: { from: "pending", to: "skipped" }, skip_reason: { from: null, to: reason } },
  });
}

/** The queue's job_failed exception (ADR-0053 §2) for a delivery that failed for good; resolved by the next success. */
const deliveryExceptionKey = (organizationId: string) =>
  ({ organizationId, sourceKind: "job", sourceCode: FANOUT_QUEUE, failureClass: "job_failed" }) as const;

async function recordAttempt(
  tx: Tx,
  jobId: string,
  d: DeliveryRow,
  result: ChannelSendResult,
): Promise<"sent" | "failed" | "not_pending"> {
  const sent = result.ok;
  const errorCode = result.ok ? null : result.errorCode;
  const updated = await tx
    .updateTable("notification_delivery")
    .set({
      status: sent ? "sent" : "failed",
      attempts: d.attempts + 1,
      last_attempt_at: sql<Date>`now()`,
      sent_at: sent ? sql<Date>`now()` : null,
      error_code: errorCode,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", d.id)
    .where("version", "=", d.version)
    .where("status", "=", "pending")
    .returning(["version", "attempts"])
    .executeTakeFirst();
  if (!updated) return "not_pending";
  await insertAuditEvent(tx, jobActor(jobId), {
    action: sent ? "notification_delivery.sent" : "notification_delivery.failed",
    recordType: "notification_delivery",
    recordId: d.id,
    organizationId: d.organization_id,
    priorVersion: d.version,
    newVersion: updated.version,
    changes: {
      status: { from: "pending", to: sent ? "sent" : "failed" },
      attempts: { from: d.attempts, to: updated.attempts },
      ...(errorCode !== null ? { error_code: { from: null, to: errorCode } } : {}),
    },
  });
  if (sent) {
    await recoverOperationalExceptionTwin(tx, jobActor(jobId), deliveryExceptionKey(d.organization_id));
    return "sent";
  }
  const final = !RETRYABLE_ERROR_CODES.has(errorCode!) || updated.attempts >= MAX_SEND_ATTEMPTS;
  if (final)
    await raiseOperationalExceptionTwin(tx, jobActor(jobId), {
      ...deliveryExceptionKey(d.organization_id),
      errorCode: errorCode!,
      errorMessage: `notification delivery ${d.id} (${d.channel_kind}) failed after ${updated.attempts} attempt(s): ${errorCode}`,
      serviceIdentityId: await serviceIdentityId(tx, FANOUT_QUEUE),
    });
  return "failed";
}

/**
 * Step 3 of ADR-0054 §3: one send of one delivery, outside any transaction. A session advisory lock 730306 on one
 * reserved connection serializes the senders of a (notification, channel); the row is re-read under it and only a
 * `pending` row is sent. The lock is released whatever happens (and by PostgreSQL if the process dies).
 */
export async function sendDelivery(db: Db, deliveryId: string, jobId: string): Promise<SendOutcome> {
  const first = await db
    .selectFrom("notification_delivery")
    .select(["inbox_notification_id", "channel_kind"])
    .where("id", "=", deliveryId)
    .executeTakeFirst();
  if (!first) return "not_found";
  const key = deliveryLockKey(first.inbox_notification_id, first.channel_kind);
  return db.connection().execute(async (conn) => {
    const lock = await sql<{ ok: boolean }>`
      SELECT pg_try_advisory_lock(${CHANNEL_DELIVERY_LOCK}::integer, hashtext(${key}::text)) AS ok`.execute(conn);
    if (!lock.rows[0]?.ok) return "locked";
    try {
      const d = await conn
        .selectFrom("notification_delivery")
        .select(["id", "organization_id", "inbox_notification_id", "channel_kind", "status", "attempts", "version"])
        .where("id", "=", deliveryId)
        .executeTakeFirstOrThrow();
      if (d.status !== "pending") return "not_pending";
      const n = await conn
        .selectFrom("inbox_notification")
        .selectAll()
        .where("id", "=", d.inbox_notification_id)
        .executeTakeFirstOrThrow();
      const channel = await conn
        .selectFrom("notification_channel")
        .selectAll()
        .where("organization_id", "=", d.organization_id)
        .where("channel_kind", "=", d.channel_kind)
        .executeTakeFirst();
      const settings = channel?.enabled ? smtpOf(channel) : null;
      const adapter = settings ? deps.channelFor(d.channel_kind as ChannelKind, settings, deps) : null;
      const user = await conn
        .selectFrom("app_user")
        .select(["status", "email", "preferred_locale"])
        .where("id", "=", n.recipient_user_id)
        .executeTakeFirst();
      const skip: SkipReason | null = adapter === null ? "channel_disabled" : recipientSkip(user);
      if (skip !== null) {
        await conn.transaction().execute((tx) => recordSkip(tx, jobId, d, skip));
        return "skipped";
      }
      const restricted = !(await recipientCanRead(conn, n, n.recipient_user_id));
      const token = await issueDeepLinkTwin(conn, n.id, jobId);
      const path = `/links/${token}`;
      const message = renderNotificationMessage({
        notificationId: n.id,
        recipientUserId: n.recipient_user_id,
        locale: channelLocaleOf(user!.preferred_locale),
        messageKey: n.message_key,
        messageParams: (n.message_params ?? {}) as Record<string, ChannelParamValue>,
        restricted,
        deepLinkUrl: deps.appBaseUrl ? new URL(path, deps.appBaseUrl).toString() : path,
      });
      let result: ChannelSendResult;
      try {
        result = await adapter!.send(message, user!.email!);
      } catch {
        result = { ok: false, errorCode: "smtp.unknown", retryable: true };
      }
      return conn.transaction().execute((tx) => recordAttempt(tx, jobId, d, result));
    } finally {
      await sql`SELECT pg_advisory_unlock(${CHANNEL_DELIVERY_LOCK}::integer, hashtext(${key}::text))`.execute(conn);
    }
  });
}

/** The pending deliveries of one notification, sent one by one (after the fan-out committed). */
export async function sendPendingOf(db: Db, notificationId: string, jobId: string): Promise<SendOutcome[]> {
  const pending = await db
    .selectFrom("notification_delivery")
    .select("id")
    .where("inbox_notification_id", "=", notificationId)
    .where("status", "=", "pending")
    .orderBy("channel_kind")
    .execute();
  const out: SendOutcome[] = [];
  for (const p of pending) out.push(await sendDelivery(db, p.id, jobId));
  return out;
}

// ------------------------------------------------------------------------------------------------ the jobs

export interface FanoutJobResult extends FanoutResult {
  readonly sends: readonly SendOutcome[];
}

/** The inbox_notification.created consumer: fan out once, then send what is pending. */
export async function runFanout(db: Db, data: unknown, jobId: string): Promise<FanoutJobResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== INBOX_NOTIFICATION_CREATED_EVENT)
    throw new Error(`${FANOUT_QUEUE}: unexpected event ${envelope.eventType}`);
  const p = inboxNotificationCreatedV1.parse(envelope.payload);
  const owner = await db
    .selectFrom("inbox_notification")
    .select("organization_id")
    .where("id", "=", p.notificationId)
    .executeTakeFirst();
  if (owner && owner.organization_id !== envelope.organizationId)
    throw new Error(`${FANOUT_QUEUE}: the event's organization does not own the notification`);
  const fanout = await fanOutNotification(db, p.notificationId, jobId);
  const sends =
    fanout.outcome === "no_channel" || fanout.outcome === "not_found"
      ? []
      : await sendPendingOf(db, p.notificationId, jobId);
  return { ...fanout, sends };
}

export interface SweepResult {
  readonly fannedOut: number;
  readonly retried: number;
  readonly sends: Readonly<Record<SendOutcome, number>>;
}

const sweepInput = z.object({ organizationId: z.uuid().optional() }).loose();

/**
 * The delivery sweep (every minute): released and digest notifications not fanned out yet, retryable failures past
 * their backoff, and pending deliveries an interrupted run left. `{ organizationId }` limits it to one organization
 * (tests, run-now); a scheduled run passes none.
 */
export async function runDeliverySweep(
  db: Db,
  data: unknown,
  jobId: string,
  now: Date = new Date(),
): Promise<SweepResult> {
  const parsed = sweepInput.safeParse(data ?? {});
  const org = parsed.success ? (parsed.data.organizationId ?? null) : null;
  const sends: Record<SendOutcome, number> = {
    sent: 0,
    failed: 0,
    skipped: 0,
    not_pending: 0,
    locked: 0,
    not_found: 0,
  };
  const count = (o: SendOutcome) => (sends[o] += 1);
  const since = new Date(now.getTime() - RELEASE_LOOKBACK_HOURS * 3_600_000);

  // 1. Released from hold (deliver_after set) or digest notifications, in an organization with an enabled channel,
  //    not fanned out yet (no ledger row).
  let released = db
    .selectFrom("inbox_notification as n")
    .select("n.id")
    .where("n.delivery_state", "=", "delivered")
    .where((eb) =>
      eb.or([
        eb.and([eb("n.deliver_after", "is not", null), eb("n.deliver_after", ">=", since)]),
        eb.and([eb("n.is_digest", "=", true), eb("n.created_at", ">=", since)]),
      ]),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("notification_channel as c")
          .select("c.id")
          .whereRef("c.organization_id", "=", "n.organization_id")
          .where("c.enabled", "=", true),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("processed_message as pm")
            .select("pm.consumer")
            .where("pm.consumer", "=", FANOUT_QUEUE)
            .whereRef("pm.idempotency_key", "=", sql<string>`'notification:' || n.id::text`),
        ),
      ),
    );
  if (org !== null) released = released.where("n.organization_id", "=", org);
  let fannedOut = 0;
  for (const r of await released.orderBy("n.id").limit(SWEEP_BATCH).execute()) {
    const f = await fanOutNotification(db, r.id, jobId);
    if (f.outcome === "fanned_out") fannedOut += 1;
  }

  // 2. Retryable failures past their backoff: failed -> pending (audited), then sent below with the pending ones.
  let failed = db
    .selectFrom("notification_delivery")
    .select(["id", "organization_id", "attempts", "version", "error_code", "last_attempt_at"])
    .where("status", "=", "failed")
    .where("attempts", "<", MAX_SEND_ATTEMPTS)
    .where("error_code", "in", [...RETRYABLE_ERROR_CODES]);
  if (org !== null) failed = failed.where("organization_id", "=", org);
  let retried = 0;
  for (const f of await failed.orderBy("id").limit(SWEEP_BATCH).execute()) {
    const dueAt = f.last_attempt_at!.getTime() + retryDelaySeconds(f.attempts) * 1000;
    if (dueAt > now.getTime()) continue;
    const moved = await db.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable("notification_delivery")
        .set({ status: "pending", version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
        .where("id", "=", f.id)
        .where("version", "=", f.version)
        .where("status", "=", "failed")
        .returning("version")
        .executeTakeFirst();
      if (!updated) return false;
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "notification_delivery.retried",
        recordType: "notification_delivery",
        recordId: f.id,
        organizationId: f.organization_id,
        priorVersion: f.version,
        newVersion: updated.version,
        changes: { status: { from: "failed", to: "pending" } },
      });
      return true;
    });
    if (moved) {
      retried += 1;
      count(await sendDelivery(db, f.id, jobId));
    }
  }

  // 3. Pending deliveries an interrupted run left behind (the fan-out committed; the send did not record).
  let stuck = db
    .selectFrom("notification_delivery")
    .select("id")
    .where("status", "=", "pending")
    .where("updated_at", "<", new Date(now.getTime() - STUCK_PENDING_SECONDS * 1000));
  if (org !== null) stuck = stuck.where("organization_id", "=", org);
  for (const s of await stuck.orderBy("id").limit(SWEEP_BATCH).execute()) count(await sendDelivery(db, s.id, jobId));

  // 4. The deliveries the released notifications of step 1 created.
  if (fannedOut > 0) {
    let fresh = db
      .selectFrom("notification_delivery")
      .select("id")
      .where("status", "=", "pending")
      .where("attempts", "=", 0);
    if (org !== null) fresh = fresh.where("organization_id", "=", org);
    for (const s of await fresh.orderBy("id").limit(SWEEP_BATCH).execute()) count(await sendDelivery(db, s.id, jobId));
  }
  return { fannedOut, retried, sends };
}

export const FANOUT_HANDLER: JobHandler = defineJob({
  queue: FANOUT_QUEUE,
  identity: { permissions: [...READS], scope: "platform", sensitiveAccess: "none" },
  handle: (db, data, jobId, _attempt, run) => {
    requireGrant(run.identity, READS);
    return runFanout(db, data, jobId);
  },
});

export const DELIVERY_SWEEP_HANDLER: JobHandler = defineJob({
  queue: DELIVERY_SWEEP_QUEUE,
  identity: { permissions: [...READS], scope: "platform", sensitiveAccess: "none" },
  handle: (db, data, jobId, _attempt, run) => {
    requireGrant(run.identity, READS);
    return runDeliverySweep(db, data, jobId);
  },
});

export const NOTIFICATIONS_HANDLERS: readonly JobHandler[] = [FANOUT_HANDLER, DELIVERY_SWEEP_HANDLER];
