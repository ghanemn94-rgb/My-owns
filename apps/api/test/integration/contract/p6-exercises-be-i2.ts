// P6 contract exercises of BE-I2 (p6-work-split §J/C.11 and §2 rule 16; T-DG6-BE-I2): listNotificationDeliveries,
// with a success and every declared refusal it can reach, through the validating client. Two SYNTHETIC notifications of
// the run's organization A are written through createWorkItemOnce and given one `skipped` email delivery each, written
// directly (the fan-out itself is proven in test/integration/tasks/channel-fanout.test.ts); no message is sent and no
// channel row is changed, so no later exercise depends on this one.
import { randomUUID } from "node:crypto";
import { insertAuditEvent } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { notificationDeliveryPage } from "../../../src/modules/admin/notification-channels.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/service.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_I2: Readonly<Record<string, z.ZodType>> = {
  listNotificationDeliveries: notificationDeliveryPage,
};

export async function exerciseP6BeI2Operations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const deliveryIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const subjectId = randomUUID();
    const deliveryId = uuidv7(); // UUIDv7, as the worker writes: the list is newest first by id
    await api.db.transaction().execute(async (tx) => {
      await createWorkItemOnce(
        tx,
        { actorType: "user", actorUserId: w.admin.id, requestId: `be-i2-${subjectId}`, source: "api" },
        {
          organizationId: w.orgA.id,
          kind: "kpi_update_due",
          assigneeUserId: w.office.id,
          subjectType: "kpi_definition",
          subjectId,
          linkPath: "/me/inbox",
          messageKey: "tasks.kpi_update_due",
          dedupeKey: `be-i2-contract:${subjectId}`,
        },
      );
      const n = await tx
        .selectFrom("inbox_notification")
        .select("id")
        .where("organization_id", "=", w.orgA.id)
        .where("dedupe_key", "=", `be-i2-contract:${subjectId}`)
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("notification_delivery")
        .values({
          id: deliveryId,
          organization_id: w.orgA.id,
          inbox_notification_id: n.id,
          channel_kind: "email",
          status: "skipped",
          skip_reason: "no_address",
          created_by: null,
          updated_by: null,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "service", actorUserId: null, requestId: `be-i2-${subjectId}`, source: "worker" },
        {
          action: "notification_delivery.skipped",
          recordType: "notification_delivery",
          recordId: deliveryId,
          organizationId: w.orgA.id,
          newVersion: 1,
          changes: { status: { from: null, to: "skipped" }, skip_reason: { from: null, to: "no_address" } },
        },
      );
    });
    deliveryIds.push(deliveryId);
  }
  const D = "/api/v1/admin/notification-deliveries";
  const org = `organizationId=${w.orgA.id}`;

  // 200: ADM_TECH (notification_channel.configure) and AUD (operations.read); filters; newest first; a page of one.
  const all = await mirrored("GET", `${D}?${org}&status=skipped&channelKind=email`, { session: admin });
  expect(all.status).toBe(200);
  const ids = all.body.items.map((d: { id: string }) => d.id);
  for (const id of deliveryIds) expect(ids).toContain(id);
  expect(ids.indexOf(deliveryIds[1])).toBeLessThan(ids.indexOf(deliveryIds[0]));
  expect(JSON.stringify(all.body)).not.toContain("@example.invalid");
  const first = await mirrored("GET", `${D}?${org}&limit=1`, { session: auditor });
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(first.body.nextCursor).not.toBeNull();
  const next = await mirrored("GET", `${D}?${org}&limit=1&cursor=${first.body.nextCursor}`, { session: auditor });
  expect(next.status).toBe(200);
  expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
  const none = await mirrored("GET", `${D}?${org}&status=sent&channelKind=enterprise_messaging`, { session: admin });
  expect(none.body).toEqual({ items: [], nextCursor: null });
  // 400: an unknown status, a malformed organization id, a cursor of other filters.
  expect((await mirrored("GET", `${D}?${org}&status=bounced`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${D}?organizationId=x`, { session: admin })).status).toBe(400);
  const otherFilters = await mirrored("GET", `${D}?${org}&status=failed&cursor=${first.body.nextCursor}`, {
    session: admin,
  });
  expect(otherFilters.status).toBe(400); // the declared ValidationError (validation.cursor through the route)
  expect(String(otherFilters.body.code)).toMatch(/^validation/);
  // 401, 403 (no configure or operations.read), 404 (unknown organization).
  expect((await mirrored("GET", `${D}?${org}`)).status).toBe(401);
  expect((await mirrored("GET", `${D}?${org}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${D}?organizationId=${randomUUID()}`, { session: admin })).status).toBe(404);
}
