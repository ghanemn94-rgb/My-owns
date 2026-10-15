// The notification digest job (ADR-0044 §5, §8; REQ-S12-025, M0241; D-142 Q11; p5-work-split §E.3, T-DG5-BE-L).
// Schedule `notification.digest` (0075; every 15 minutes, Asia/Riyadh). For each user with held notifications that are
// due (`deliver_after` <= now), in one transaction per user under pg_advisory_xact_lock(730261,
// hashtext('<userId>:<windowStartIso>')) (`digestWindow`, ADR-0016 §6) and the UNIQUE backstop
// notification_digest_window_key (recipient_user_id, window_start):
//  - the user's digest is on (own row, else the organization default): ONE digest notification (`is_digest`, message
//    key `notifications.digest`, params {count}, link `/me/notification-digests/<id>`) and its notification_digest row;
//    the due held rows move held -> digested (NP06), each audited. A window that already has the user's digest creates
//    nothing more (its rows wait for the next window), so running the job twice in a window creates one digest;
//  - the digest is off (quiet hours only, or the preference changed): the due held rows move held -> delivered.
// In-app only: the digest is one inbox notification per user and window; email and messaging are P6 adapters.
// Urgent notifications are never held (the database refuses it), so nothing urgent waits for this job. A job never
// approves anything; its audit actor is the service (`jobActor`).
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { digestWindowOf, releasesIntoDigest } from "@mth/shared/schemas";
import { effectiveDeliverySettings, jobActor } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const DIGEST_QUEUE = "notification.digest";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `digestWindow` (the worker imports no API code). */
export const DIGEST_WINDOW_LOCK = 730261;
export const DIGEST_MESSAGE_KEY = "notifications.digest";
/** The 0075 CHECK bound of notification_digest.notification_count. */
const MAX_DIGEST_ITEMS = 10_000;

export const digestLinkPath = (digestId: string) => `/me/notification-digests/${digestId}`;

export interface DigestUserOutcome {
  readonly userId: string;
  readonly outcome: "digested" | "delivered" | "window_taken" | "nothing_due";
  readonly digestId: string | null;
  readonly count: number;
}

export interface DigestRunResult {
  readonly windowStart: string;
  readonly users: readonly DigestUserOutcome[];
}

async function uuidv7(tx: Tx): Promise<string> {
  return (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
}

/** One user's due held notifications, in one transaction under the window lock. */
async function digestUser(tx: Tx, jobId: string, userId: string, now: Date): Promise<DigestUserOutcome> {
  const window = digestWindowOf(now);
  const windowStart = window.start.toISOString();
  await sql`SELECT pg_advisory_xact_lock(${DIGEST_WINDOW_LOCK}::integer, hashtext(${`${userId}:${windowStart}`}::text))`.execute(
    tx,
  );
  const due = await tx
    .selectFrom("inbox_notification")
    .selectAll()
    .where("recipient_user_id", "=", userId)
    .where("delivery_state", "=", "held")
    .where("deliver_after", "<=", now)
    .orderBy("created_at")
    .orderBy("id")
    .limit(MAX_DIGEST_ITEMS)
    .forUpdate()
    .execute();
  if (due.length === 0) return { userId, outcome: "nothing_due", digestId: null, count: 0 };
  const actor = jobActor(jobId);
  const settings = await effectiveDeliverySettings(tx, userId);
  const release = async (state: "digested" | "delivered", digestId: string | null): Promise<void> => {
    for (const n of due) {
      const updated = await tx
        .updateTable("inbox_notification")
        .set({
          delivery_state: state,
          digest_id: digestId,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: null,
        })
        .where("id", "=", n.id)
        .where("version", "=", n.version)
        .returning("version")
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, actor, {
        action: state === "digested" ? "inbox_notification.digest" : "inbox_notification.deliver",
        recordType: "inbox_notification",
        recordId: n.id,
        organizationId: n.organization_id,
        transformationId: n.transformation_id,
        priorVersion: n.version,
        newVersion: updated.version,
        changes: {
          delivery_state: { from: "held", to: state },
          ...(digestId !== null ? { digest_id: { from: null, to: digestId } } : {}),
        },
      });
    }
  };
  if (!releasesIntoDigest(settings.effective)) {
    await release("delivered", null);
    return { userId, outcome: "delivered", digestId: null, count: due.length };
  }
  const taken = await tx
    .selectFrom("notification_digest")
    .select("id")
    .where("recipient_user_id", "=", userId)
    .where("window_start", "=", window.start)
    .executeTakeFirst();
  if (taken) return { userId, outcome: "window_taken", digestId: taken.id, count: 0 };
  const organizationId = due[0]!.organization_id;
  const digestId = await uuidv7(tx);
  const notificationId = await uuidv7(tx);
  const linkPath = digestLinkPath(digestId);
  const dedupeKey = `notification.digest:${userId}:${windowStart}`;
  await tx
    .insertInto("inbox_notification")
    .values({
      id: notificationId,
      organization_id: organizationId,
      transformation_id: null,
      recipient_user_id: userId,
      work_item_id: null,
      link_path: linkPath,
      message_key: DIGEST_MESSAGE_KEY,
      message_params: JSON.stringify({ count: due.length }),
      dedupe_key: dedupeKey,
      is_digest: true,
      created_by: null,
      updated_by: null,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "inbox_notification.create",
    recordType: "inbox_notification",
    recordId: notificationId,
    organizationId,
    transformationId: null,
    newVersion: 1,
    changes: {
      recipient_user_id: { from: null, to: userId },
      is_digest: { from: null, to: true },
      dedupe_key: { from: null, to: dedupeKey },
    },
  });
  await tx
    .insertInto("notification_digest")
    .values({
      id: digestId,
      organization_id: organizationId,
      recipient_user_id: userId,
      window_start: window.start,
      window_end: window.end,
      notification_count: due.length,
      inbox_notification_id: notificationId,
      created_by: null,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "notification_digest.create",
    recordType: "notification_digest",
    recordId: digestId,
    organizationId,
    transformationId: null,
    newVersion: 1,
    changes: {
      recipient_user_id: { from: null, to: userId },
      window_start: { from: null, to: windowStart },
      notification_count: { from: null, to: due.length },
    },
  });
  await release("digested", digestId);
  return { userId, outcome: "digested", digestId, count: due.length };
}

/**
 * Runs the digest window containing `now` (the handler passes the clock; tests pass a fixed instant and may limit the
 * run to some recipients). Each user is one transaction; a failure rolls back that user only and is rethrown after the
 * others ran, so pg-boss retries the job (a replay re-finds only what is still held).
 */
export async function runDigestWindow(
  db: Db,
  jobId: string,
  now: Date,
  scope: { readonly userIds?: readonly string[] } = {},
): Promise<DigestRunResult> {
  let q = db
    .selectFrom("inbox_notification")
    .select("recipient_user_id")
    .distinct()
    .where("delivery_state", "=", "held")
    .where("deliver_after", "<=", now);
  if (scope.userIds !== undefined) {
    if (scope.userIds.length === 0) return { windowStart: digestWindowOf(now).start.toISOString(), users: [] };
    q = q.where("recipient_user_id", "in", [...scope.userIds]);
  }
  const recipients = await q.orderBy("recipient_user_id").execute();
  const users: DigestUserOutcome[] = [];
  let failure: unknown = null;
  for (const r of recipients) {
    try {
      users.push(await db.transaction().execute((tx) => digestUser(tx, jobId, r.recipient_user_id, now)));
    } catch (err) {
      failure ??= err;
    }
  }
  if (failure !== null) throw failure;
  return { windowStart: digestWindowOf(now).start.toISOString(), users };
}

export async function handleNotificationDigest(db: Db, _data: unknown, jobId: string): Promise<DigestRunResult> {
  return runDigestWindow(db, jobId, new Date());
}

export const DIGESTS_HANDLERS: readonly JobHandler[] = [{ queue: DIGEST_QUEUE, handle: handleNotificationDigest }];
