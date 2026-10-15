// One's own notification digest (ADR-0044 §5; REQ-S12-025; p5-work-split §E.3, T-DG5-BE-L):
//   GET /me/notification-digests/{digestId}   the digest with the notifications it delivered, oldest first
//                                             (authenticated; one's own digests only, anyone else's: 404)
// The digest itself is one in-app notification (`is_digest`, message key `notifications.digest`, params {count}, link
// to this read) created by the worker's `notification.digest` job (apps/worker/src/handlers/digests.ts) under the
// `digestWindow` advisory-lock class (platform/advisory-locks.ts) once per user and 15-minute window. Digested
// notifications are not in the inbox list (only `delivered` rows are); they are read here. Reads only; in-app only
// (D-142 Q11).
import { type NotificationDigest } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { iso, parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";

export const DIGEST_PATH = "/api/v1/me/notification-digests/:digestId";
/** The in-app link of a digest notification (relative; 0028 CHECK). */
export const digestLinkPath = (digestId: string) => `/me/notification-digests/${digestId}`;
const digestParams = z.strictObject({ digestId: z.uuid() });

const paramsOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function registerDigestRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(DIGEST_PATH, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const principal = principalOf(request);
    if (principal.userId === null) throw problems.unauthenticated();
    const { digestId } = parse(digestParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const digest = await db
      .selectFrom("notification_digest")
      .selectAll()
      .where("id", "=", digestId)
      .where("recipient_user_id", "=", principal.userId)
      .executeTakeFirst();
    if (!digest) throw problems.notFound();
    const items = await db
      .selectFrom("inbox_notification")
      .select(["id", "message_key", "message_params", "link_path", "created_at"])
      .where("digest_id", "=", digest.id)
      .where("recipient_user_id", "=", principal.userId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    const body: NotificationDigest = {
      id: digest.id,
      windowStart: iso(digest.window_start),
      windowEnd: iso(digest.window_end),
      count: digest.notification_count,
      items: items.map((n) => ({
        notificationId: n.id,
        messageKey: n.message_key,
        messageParams: paramsOf(n.message_params),
        linkPath: n.link_path,
        createdAt: iso(n.created_at),
      })),
    };
    return body;
  });
  return [`GET ${DIGEST_PATH}`];
}
