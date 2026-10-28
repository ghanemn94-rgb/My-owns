// P6 contract exercises of BE-I (p6-work-split §J/C.10 and §2 rule 16; T-DG6-BE-I): the four Administration >
// Notifications operations, each with a success and every declared refusal it can reach, through the validating client.
// The test send goes to the in-process fake SMTP server (never a real mail service). Every value is synthetic; the
// email channel of the run's organization A is disabled again at the end, so no later exercise depends on it.
import { expect } from "vitest";
import type { z } from "zod";
import {
  notificationChannelPage,
  notificationChannelTestResult,
  notificationChannelView,
} from "../../../src/modules/admin/notification-channels.ts";
import { FakeSmtp } from "../../support/fake-smtp.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_I: Readonly<Record<string, z.ZodType>> = {
  listNotificationChannels: notificationChannelPage,
  getNotificationChannel: notificationChannelView,
  putNotificationChannel: notificationChannelView,
  testNotificationChannel: notificationChannelTestResult,
};

export async function exerciseP6BeIOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const L = "/api/v1/admin/notification-channels";
  const org = `organizationId=${w.orgA.id}`;

  // listNotificationChannels: 200 (ADM_TECH; AUD through operations.read; a page of one); 400; 401; 403; 404.
  const list = await mirrored("GET", `${L}?${org}`, { session: admin });
  expect(list.status).toBe(200);
  expect(list.body.items.map((c: { channelKind: string }) => c.channelKind)).toEqual(["email", "enterprise_messaging"]);
  const first = await mirrored("GET", `${L}?${org}&limit=1`, { session: auditor });
  expect(first.status).toBe(200);
  expect(first.body.nextCursor).not.toBeNull();
  const second = await mirrored("GET", `${L}?${org}&limit=1&cursor=${first.body.nextCursor}`, { session: auditor });
  expect(second.body.items[0].channelKind).toBe("enterprise_messaging");
  expect((await mirrored("GET", `${L}?organizationId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${L}?${org}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?${org}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // getNotificationChannel: 200 (ETag "0" while never configured); 400; 401; 403; 404.
  const E = `${L}/email?${org}`;
  const got = await mirrored("GET", `${L}/enterprise_messaging?${org}`, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.body).toMatchObject({ configured: false, enabled: false, adapterAvailable: false, version: 0 });
  expect(got.headers["etag"]).toBe('"0"');
  expect((await mirrored("GET", `${L}/sms?${org}`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", E)).status).toBe(401);
  expect((await mirrored("GET", E, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}/email?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // putNotificationChannel: 200 create ("0") and update; 400; 401; 403 (AUD); 404; 409; 422 (each reachable code); 428.
  const smtp = new FakeSmtp();
  await smtp.start();
  try {
    const settings = {
      host: "127.0.0.1",
      port: smtp.port,
      security: "none",
      usernameRef: null,
      passwordRef: null,
      fromAddress: "hub-noreply@example.invalid",
    };
    const body = { enabled: true, smtp: settings, reason: "Synthetic contract exercise: enable email" };
    const put = (b: unknown, ifMatch: string | null, session = admin, url = E) =>
      mirrored("PUT", url, { session, body: b, headers: ifMatch === null ? {} : { "if-match": ifMatch } });
    expect((await put(body, null)).status).toBe(428);
    const created = await put(body, '"0"');
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ configured: true, enabled: true, version: 1 });
    expect(created.headers["etag"]).toBe('"1"');
    expect((await put(body, '"0"')).status).toBe(409);
    expect((await put({ ...body, reason: "  " }, '"1"')).body.code).toBe("admin.reason_required");
    expect((await put({ ...body, smtp: null }, '"1"')).body.code).toBe("notification_channel.email_incomplete");
    const asValue = await put({ ...body, smtp: { ...settings, usernameRef: "synthetic-user" } }, '"1"');
    expect([asValue.status, asValue.body.code]).toEqual([422, "storage.secret_ref_invalid"]);
    const messaging = await put(
      { enabled: true, smtp: null, reason: "Synthetic contract exercise" },
      '"0"',
      admin,
      `${L}/enterprise_messaging?${org}`,
    );
    expect([messaging.status, messaging.body.code]).toEqual([422, "notification_channel.adapter_unavailable"]);
    expect((await put({ enabled: "yes", smtp: null, reason: "Synthetic" }, '"1"')).status).toBe(400);
    expect((await mirrored("PUT", E, { body, headers: { "if-match": '"1"' } })).status).toBe(401);
    expect((await put(body, '"1"', auditor)).status).toBe(403);
    expect((await put(body, '"1"', admin, `${L}/email?organizationId=${missing}`)).status).toBe(404);

    // testNotificationChannel: 200 (one message at the fake, to the caller's own address); 400; 401; 403; 404; 422.
    const T = `${L}/email/test?${org}`;
    const sent = await mirrored("POST", T, { session: admin, body: { recipient: "self" } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ outcome: "sent", channelKind: "email", errorCode: null });
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]!.rcptTo).toEqual([`${w.admin.subject}@example.invalid`]);
    expect((await mirrored("POST", T, { session: admin, body: { recipient: "someone" } })).status).toBe(400);
    expect((await mirrored("POST", T, { body: { recipient: "self" } })).status).toBe(401);
    expect((await mirrored("POST", T, { session: auditor, body: { recipient: "self" } })).status).toBe(403);
    const T404 = `${L}/email/test?organizationId=${missing}`;
    expect((await mirrored("POST", T404, { session: admin, body: { recipient: "self" } })).status).toBe(404);
    const notConfigured = await mirrored("POST", `${L}/enterprise_messaging/test?${org}`, {
      session: admin,
      body: { recipient: "self" },
    });
    expect([notConfigured.status, notConfigured.body.code]).toEqual([422, "notification_channel.not_configured"]);

    // Back to in-app only for the rest of the suite.
    const off = await put({ enabled: false, smtp: null, reason: "Synthetic contract exercise: disable" }, '"1"');
    expect(off.body).toMatchObject({ enabled: false, smtp: null, version: 2 });
  } finally {
    await smtp.stop();
  }
}
