// P5 contract exercises of BE-L (p5-work-split §E.3 and §2 rule 14; T-DG5-BE-L): the five notification operations,
// each with a success and every declared refusal it can reach, through the validating client. The digest comes from
// the real worker job (apps/worker/src/handlers/digests.ts) run for this one user after a reminder was held in quiet
// hours set around the real clock. Every value is synthetic; nothing here approves anything.
//
// Contract note (handback): getMyNotificationPreferences and getNotificationPolicy answer ETag "0" while nothing is
// stored (the ETagOrZero rule), but their 200 responses declare `ETag` (>= 1). The validating client therefore reads
// them here only once a row exists (version >= 1); the version-0 reads are tested in
// test/integration/tasks/notification-delivery.test.ts.
import { notificationDigest, notificationPolicy, notificationPreferences, wallClockOf } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { runDigestWindow } from "../../../../worker/src/handlers/digests.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { createUser, grant, signIn, uniq, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_L: Readonly<Record<string, z.ZodType>> = {
  getMyNotificationPreferences: notificationPreferences,
  putMyNotificationPreferences: notificationPreferences,
  getMyNotificationDigest: notificationDigest,
  getNotificationPolicy: notificationPolicy,
  putNotificationPolicy: notificationPolicy,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

export async function exerciseP5BeLOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const PREFS = "/api/v1/me/notification-preferences";
  const POLICY = "/api/v1/admin/notification-policy";
  const DIGEST = "/api/v1/me/notification-digests";
  const ifm = (v: number) => ({ "if-match": `"${v}"` });
  const auditor = await signIn(api.app, w.auditor.subject);
  const tech = await signIn(api.app, w.admin.subject);
  const office = await signIn(api.app, w.office.subject);
  const user = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const member = await signIn(api.app, user.subject);

  // putMyNotificationPreferences: 400; 428; 403 (AUD); 422 quiet_hours_invalid; 422 timezone_unknown; 200 (If-Match
  // "0" creates); 409 ("0" once a row exists).
  const now = Math.floor(wallClockOf(new Date(), "Asia/Riyadh").minutes);
  const prefs = {
    quietHoursStart: timeOf(now - 120),
    quietHoursEnd: timeOf(now + 120),
    digestMode: "daily",
    digestTime: timeOf(now + 180),
  };
  expect((await mirrored("PUT", PREFS, { session: member, headers: ifm(0), body: { digestMode: "off" } })).status).toBe(
    400,
  );
  expect((await mirrored("PUT", PREFS, { session: member, body: prefs })).status).toBe(428);
  expect((await mirrored("PUT", PREFS, { session: auditor, headers: ifm(0), body: prefs })).status).toBe(403);
  const same = await mirrored("PUT", PREFS, {
    session: member,
    headers: ifm(0),
    body: { ...prefs, quietHoursEnd: prefs.quietHoursStart },
  });
  expect([same.status, (same.body as Body).code]).toEqual([422, "notification_preference.quiet_hours_invalid"]);
  const zone = await mirrored("PUT", PREFS, {
    session: member,
    headers: ifm(0),
    body: { ...prefs, timezone: "Nowhere/Synthetic" },
  });
  expect([zone.status, (zone.body as Body).code]).toEqual([422, "notification_preference.timezone_unknown"]);
  const created = await mirrored("PUT", PREFS, { session: member, headers: ifm(0), body: prefs });
  expect([created.status, (created.body as Body).version]).toEqual([200, 1]);
  expect((await mirrored("PUT", PREFS, { session: member, headers: ifm(0), body: prefs })).status).toBe(409);

  // getMyNotificationPreferences: 200 (version 1); 400 (unknown query).
  const read = await mirrored("GET", PREFS, { session: member });
  expect([read.status, (read.body as Body).own.digestMode]).toEqual([200, "daily"]);
  expect((await mirrored("GET", `${PREFS}?x=1`, { session: member })).status).toBe(400);

  // getMyNotificationDigest: a reminder held in the quiet hours, digested by the job after its release; 200; 400; 404
  // (an unknown id, and another user's digest).
  const dedupeKey = uniq("contract.be-l:");
  await api.db.transaction().execute((tx) =>
    createWorkItemOnce(
      tx,
      { actorType: "service", actorUserId: null, requestId: "job:contract-be-l", source: "worker" },
      {
        organizationId: w.orgA.id,
        kind: "kpi_update_due",
        assigneeUserId: user.id,
        subjectType: "kpi_definition",
        subjectId: crypto.randomUUID(),
        linkPath: "/kpi/synthetic",
        messageKey: "tasks.kpi_update_due",
        messageParams: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
        dedupeKey,
      },
    ),
  );
  const held = await api.db
    .selectFrom("inbox_notification")
    .select(["delivery_state", "deliver_after"])
    .where("dedupe_key", "=", dedupeKey)
    .executeTakeFirstOrThrow();
  expect(held.delivery_state).toBe("held");
  const run = await runDigestWindow(api.db, "job:contract-be-l", new Date(held.deliver_after!.getTime() + 60_000), {
    userIds: [user.id],
  });
  const digestId = run.users[0]!.digestId!;
  const digest = await mirrored("GET", `${DIGEST}/${digestId}`, { session: member });
  expect([digest.status, (digest.body as Body).count]).toEqual([200, 1]);
  expect((await mirrored("GET", `${DIGEST}/not-a-uuid`, { session: member })).status).toBe(400);
  expect((await mirrored("GET", `${DIGEST}/${crypto.randomUUID()}`, { session: member })).status).toBe(404);
  expect((await mirrored("GET", `${DIGEST}/${digestId}`, { session: office })).status).toBe(404);

  // putNotificationPolicy: 400; 428; 403 (AUD, TO); 422 quiet_hours_invalid; 200; 409.
  const policy = {
    nonUrgentWorkingDaysOnly: false,
    defaultQuietHoursStart: null,
    defaultQuietHoursEnd: null,
    defaultDigestMode: "off",
  };
  const current =
    (
      await api.db
        .selectFrom("notification_policy")
        .select("version")
        .where("organization_id", "=", w.orgA.id)
        .executeTakeFirst()
    )?.version ?? 0;
  expect((await mirrored("PUT", POLICY, { session: tech, headers: ifm(current), body: {} })).status).toBe(400);
  expect((await mirrored("PUT", POLICY, { session: tech, body: policy })).status).toBe(428);
  expect((await mirrored("PUT", POLICY, { session: auditor, headers: ifm(current), body: policy })).status).toBe(403);
  expect((await mirrored("PUT", POLICY, { session: office, headers: ifm(current), body: policy })).status).toBe(403);
  const invalid = await mirrored("PUT", POLICY, {
    session: tech,
    headers: ifm(current),
    body: { ...policy, defaultQuietHoursStart: "23:00", defaultQuietHoursEnd: null },
  });
  expect([invalid.status, (invalid.body as Body).code]).toEqual([422, "notification_preference.quiet_hours_invalid"]);
  const saved = await mirrored("PUT", POLICY, { session: tech, headers: ifm(current), body: policy });
  expect([saved.status, (saved.body as Body).version]).toEqual([200, current + 1]);
  expect((await mirrored("PUT", POLICY, { session: tech, headers: ifm(current), body: policy })).status).toBe(409);

  // getNotificationPolicy: 200 (a row exists); 400; 403 (AUD).
  const got = await mirrored("GET", POLICY, { session: tech });
  expect([got.status, (got.body as Body).urgentDelivery]).toEqual([200, "immediate"]);
  expect((await mirrored("GET", `${POLICY}?x=1`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", POLICY, { session: auditor })).status).toBe(403);
}
