// The notification channel fan-out after commit, exactly once (T-DG6-BE-I2; ADR-0054 §3; REQ-S12-023 "every
// notification is written to the inbox; external channels are sent only when configured"; A21 "with no email adapter
// configured all workflows complete and notifications appear in the inbox"; p6-work-split §J/C.11), against the run's
// disposable PostgreSQL and the in-process fake SMTP server (never a real mail service).
//
// A notification is written by the API's createWorkItemOnce (or the worker's twin) with its inbox_notification.created
// outbox row; the worker's real jobs (notifications.fanout, notifications.delivery_sweep, under their service
// identities) then run with that row's envelope. Proven here:
//  - no channel row, or a disabled one: no delivery row, no ledger row, the notification in the inbox (A21);
//  - email enabled: one notification -> one `sent` delivery and one message at the fake, to the recipient's address,
//    with the deep link and no messageParams value; the deliveries list shows it without the address or the text;
//  - a relay replay, a handler retry, two concurrent consumers and a sweep create no second delivery and send no second
//    message;
//  - a send failure never rolls back the producing workflow (work item and notification stay committed); a final
//    failure opens the queue's `job_failed` operational exception, a retryable one is retried after its backoff;
//  - a held (quiet-hours) notification fans out only when the digest job releases it;
//  - a restricted recipient gets the `inbox.restricted` text; a disabled recipient is skipped.
// Each test uses its own organization (seedWorld), so the files of the run that share the database are untouched.
// Every value is SYNTHETIC; nothing here approves anything (no business approval, G1-G6) or touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  configureNotificationChannels,
  DELIVERY_SWEEP_HANDLER,
  FANOUT_HANDLER,
  FANOUT_QUEUE,
  fanoutKey,
  retryDelaySeconds,
  runDeliverySweep,
  runFanout,
} from "../../../../worker/src/handlers/notifications.ts";
import { DEFAULT_CHANNEL_CATALOGUE } from "../../../../worker/src/channels/render.ts";
import { runDigestWindow } from "../../../../worker/src/handlers/digests.ts";
import { createWorkItemOnce as workerCreateWorkItemOnce, jobActor } from "../../../../worker/src/kit.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/service.ts";
import { decodedBody, FakeSmtp } from "../../support/fake-smtp.ts";
import {
  call,
  createTransformationRow,
  createUser,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let smtp: FakeSmtp;
/** Every synthetic user has the default locale `ar` (0001), so the messages are rendered in Arabic (RTL text). */
const AR = DEFAULT_CHANNEL_CATALOGUE.texts.ar;

const userActor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `be-i2-${randomUUID()}`, source: "api" }) as const;

beforeAll(async () => {
  api = await startApi();
  smtp = new FakeSmtp();
  await smtp.start();
  configureNotificationChannels({ refuseInsecure: false, appBaseUrl: new URL("https://hub.example.invalid") });
});

afterAll(async () => {
  configureNotificationChannels({});
  await smtp?.stop();
  await api?.close();
});

beforeEach(() => {
  smtp.messages.length = 0;
  smtp.configure({});
});

/** One synthetic notification through the API's createWorkItemOnce (its own transaction); returns its ids. */
async function notify(
  w: World,
  assignee: { id: string },
  opts: { transformationId?: string | null; linkPath?: string; worker?: boolean } = {},
) {
  const subjectId = randomUUID();
  const dedupeKey = `be-i2:${subjectId}`;
  const input = {
    organizationId: w.orgA.id,
    transformationId: opts.transformationId ?? null,
    kind: "kpi_update_due",
    assigneeUserId: assignee.id,
    subjectType: "kpi_definition",
    subjectId,
    linkPath: opts.linkPath ?? "/me/inbox",
    messageKey: "tasks.kpi_update_due",
    messageParams: { kpiName: "SYNTHETIC-SECRET-PARAM" },
    dedupeKey,
  };
  const r = await api.db
    .transaction()
    .execute((tx) =>
      opts.worker
        ? workerCreateWorkItemOnce(tx, jobActor(`be-i2-${subjectId}`), input)
        : createWorkItemOnce(tx, userActor(w.admin.id), input),
    );
  const n = await api.db
    .selectFrom("inbox_notification")
    .selectAll()
    .where("organization_id", "=", w.orgA.id)
    .where("dedupe_key", "=", dedupeKey)
    .executeTakeFirstOrThrow();
  return { workItemId: r.workItemId, notification: n };
}

/** The relay's envelope of the notification's outbox row (exactly one per notification). */
async function envelopeOf(notificationId: string) {
  const rows = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_type", "=", "inbox_notification")
    .where("aggregate_id", "=", notificationId)
    .execute();
  expect(rows).toHaveLength(1);
  const e = rows[0]!;
  return {
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: e.schema_version,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: e.payload as Record<string, unknown>,
  };
}

const deliveriesOf = (notificationId: string) =>
  api.db.selectFrom("notification_delivery").selectAll().where("inbox_notification_id", "=", notificationId).execute();

const ledgerOf = async (notificationId: string) =>
  (
    await api.db
      .selectFrom("processed_message")
      .select("consumer")
      .where("consumer", "=", FANOUT_QUEUE)
      .where("idempotency_key", "=", fanoutKey(notificationId))
      .execute()
  ).length;

/** Configures the organization's email channel through the API (ADM_TECH; IfMatchOrZero), pointing at the fake. */
async function putEmail(w: World, enabled: boolean, ifMatch: string) {
  const admin = await signIn(api.app, w.admin.subject);
  const res = await call(api.app, "PUT", `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`, {
    session: admin,
    headers: { "if-match": ifMatch },
    body: {
      enabled,
      smtp: enabled
        ? {
            host: "127.0.0.1",
            port: smtp.port,
            security: "none",
            usernameRef: null,
            passwordRef: null,
            fromAddress: "hub-noreply@example.invalid",
          }
        : null,
      reason: enabled ? "Synthetic BE-I2 test: enable email" : "Synthetic BE-I2 test: disable email",
    },
  });
  expect(res.status).toBe(200);
}

async function emailOf(userId: string): Promise<string> {
  const u = await api.db.selectFrom("app_user").select("email").where("id", "=", userId).executeTakeFirstOrThrow();
  return u.email!;
}

describe("A21: no channel configured (REQ-S12-023)", () => {
  it("writes no delivery and no ledger row; the workflow completes and the notification is in the inbox", async () => {
    const w = await seedWorld(api.db);
    for (const worker of [false, true]) {
      const { workItemId, notification } = await notify(w, w.office, { worker });
      const result = await FANOUT_HANDLER.handle(api.db, await envelopeOf(notification.id), `be-i2-${randomUUID()}`);
      expect(result).toMatchObject({ outcome: "no_channel", created: [], sends: [] });
      expect(await deliveriesOf(notification.id)).toEqual([]);
      expect(await ledgerOf(notification.id)).toBe(0);
      expect(notification.delivery_state).toBe("delivered");
      const item = await api.db
        .selectFrom("work_item")
        .select("status")
        .where("id", "=", workItemId)
        .executeTakeFirst();
      expect(item?.status).toBe("open");
    }
    // The recipient's inbox lists it (the DG4/DG5 route, unchanged).
    const office = await signIn(api.app, w.office.subject);
    const inbox = await call(api.app, "GET", "/api/v1/me/inbox", { session: office });
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.length).toBeGreaterThanOrEqual(2);
    // The sweep finds nothing to do in an organization without an enabled channel.
    const sweep = await DELIVERY_SWEEP_HANDLER.handle(api.db, { organizationId: w.orgA.id }, `be-i2-${randomUUID()}`);
    expect(sweep).toMatchObject({ fannedOut: 0, retried: 0 });
    expect(smtp.messages).toHaveLength(0);
  });

  it("a disabled channel row is in-app only too", async () => {
    const w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
    await putEmail(w, false, '"1"');
    const { notification } = await notify(w, w.office);
    const result = await runFanout(api.db, await envelopeOf(notification.id), `be-i2-${randomUUID()}`);
    expect(result.outcome).toBe("no_channel");
    expect(await deliveriesOf(notification.id)).toEqual([]);
    expect(smtp.messages).toHaveLength(0);
  });
});

describe("email enabled: one notification -> one sent delivery, exactly once", () => {
  let w: World;
  beforeAll(async () => {
    w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
  });

  it("sends one message to the recipient, with the deep link and no messageParams value; audited", async () => {
    const { notification } = await notify(w, w.office);
    const envelope = await envelopeOf(notification.id);
    expect(envelope).toMatchObject({
      eventType: "inbox_notification.created",
      schemaVersion: 1,
      organizationId: w.orgA.id,
      payload: { notificationId: notification.id, recipientUserId: w.office.id },
    });
    const result = await FANOUT_HANDLER.handle(api.db, envelope, `be-i2-${randomUUID()}`);
    expect(result).toMatchObject({ outcome: "fanned_out", sends: ["sent"] });
    const [d] = await deliveriesOf(notification.id);
    expect(d).toMatchObject({
      channel_kind: "email",
      status: "sent",
      attempts: 1,
      error_code: null,
      skip_reason: null,
    });
    expect(d!.sent_at).not.toBeNull();
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]!.rcptTo).toEqual([await emailOf(w.office.id)]);
    const body = decodedBody(smtp.messages[0]!.data);
    const token = (
      await api.db
        .selectFrom("inbox_notification")
        .select("link_token")
        .where("id", "=", notification.id)
        .executeTakeFirstOrThrow()
    ).link_token;
    expect(token).not.toBeNull();
    expect(body).toContain(`https://hub.example.invalid/links/${token}`);
    expect(body).toContain(AR.generic);
    expect(smtp.messages[0]!.data).not.toContain("SYNTHETIC-SECRET-PARAM");
    const actions = (
      await api.db
        .selectFrom("audit_event")
        .select(["action", "actor_type"])
        .where("record_id", "=", d!.id)
        .orderBy("seq")
        .execute()
    ).map((a) => `${a.action}:${a.actor_type}`);
    expect(actions).toEqual(["notification_delivery.created:service", "notification_delivery.sent:service"]);

    // The deliveries list (ADM_TECH) shows it, never the address or the text.
    const admin = await signIn(api.app, w.admin.subject);
    const list = await call(api.app, "GET", `/api/v1/admin/notification-deliveries?organizationId=${w.orgA.id}`, {
      session: admin,
    });
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      id: d!.id,
      notificationId: notification.id,
      status: "sent",
      attempts: 1,
    });
    expect(JSON.stringify(list.body)).not.toContain("@example.invalid");
    expect(JSON.stringify(list.body)).not.toContain(AR.generic);
  });

  it("a relay replay, a handler retry and a sweep create no second delivery and send no second message", async () => {
    const { notification } = await notify(w, w.office);
    const envelope = await envelopeOf(notification.id);
    expect((await runFanout(api.db, envelope, "be-i2-first")).outcome).toBe("fanned_out");
    expect(smtp.messages).toHaveLength(1);
    const replay = await runFanout(api.db, envelope, "be-i2-first"); // the relay delivers the same job again
    expect(replay).toMatchObject({ outcome: "duplicate", created: [], sends: [] });
    const retry = await FANOUT_HANDLER.handle(api.db, envelope, "be-i2-retry", { retryCount: 1, retryLimit: 5 });
    expect(retry).toMatchObject({ outcome: "duplicate", created: [] });
    await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-sweep", new Date(Date.now() + 3_600_000));
    expect(await deliveriesOf(notification.id)).toHaveLength(1);
    expect(await ledgerOf(notification.id)).toBe(1);
    expect(smtp.messages).toHaveLength(1);
  });

  it("two concurrent consumers of the same event send exactly one message", async () => {
    const { notification } = await notify(w, w.office, { worker: true }); // the worker twin writes the same event
    const envelope = await envelopeOf(notification.id);
    const results = await Promise.all([
      runFanout(api.db, envelope, "be-i2-a"),
      runFanout(api.db, envelope, "be-i2-b"),
      runFanout(api.db, envelope, "be-i2-c"),
    ]);
    expect(results.filter((r) => r.outcome === "fanned_out")).toHaveLength(1);
    const deliveries = await deliveriesOf(notification.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(smtp.messages).toHaveLength(1);
  });

  it("a restricted recipient gets the inbox.restricted text; a disabled recipient is skipped without a send", async () => {
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const outsider = await createUser(api.db, w.orgA.id); // no grant reaches the transformation
    const restricted = await notify(w, outsider, { transformationId: t });
    await runFanout(api.db, await envelopeOf(restricted.notification.id), "be-i2-restricted");
    expect(smtp.messages).toHaveLength(1);
    const text = decodedBody(smtp.messages[0]!.data);
    expect(text).toContain(AR.restricted);
    expect(text).not.toContain(AR.generic);

    const readable = await notify(w, w.office, { transformationId: t }); // TO at organization scope reads it
    await runFanout(api.db, await envelopeOf(readable.notification.id), "be-i2-readable");
    expect(decodedBody(smtp.messages[1]!.data)).toContain(AR.generic);

    const disabled = await notify(w, w.disabled);
    const r = await runFanout(api.db, await envelopeOf(disabled.notification.id), "be-i2-disabled");
    expect(r.created).toEqual([expect.objectContaining({ status: "skipped" })]);
    const [d] = await deliveriesOf(disabled.notification.id);
    expect(d).toMatchObject({ status: "skipped", skip_reason: "recipient_disabled", attempts: 0 });
    expect(smtp.messages).toHaveLength(2);
  });
});

describe("a send failure never rolls back or blocks the workflow", () => {
  it("a final failure stays failed, opens the queue's job_failed exception, and the workflow's rows stay committed", async () => {
    const w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
    smtp.configure({ rcptReply: 550 });
    const { workItemId, notification } = await notify(w, w.office);
    const r = await runFanout(api.db, await envelopeOf(notification.id), "be-i2-fail");
    expect(r.sends).toEqual(["failed"]);
    const [d] = await deliveriesOf(notification.id);
    expect(d).toMatchObject({ status: "failed", attempts: 1, error_code: "smtp.recipient_rejected" });
    expect(
      await api.db.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst(),
    ).toBeDefined();
    expect(
      await api.db.selectFrom("inbox_notification").select("id").where("id", "=", notification.id).executeTakeFirst(),
    ).toBeDefined();
    const exceptions = await api.db
      .selectFrom("operational_exception")
      .select(["failure_class", "source_code", "status", "last_error_code"])
      .where("organization_id", "=", w.orgA.id)
      .where("source_code", "=", FANOUT_QUEUE)
      .execute();
    expect(exceptions).toEqual([
      {
        failure_class: "job_failed",
        source_code: FANOUT_QUEUE,
        status: "open",
        last_error_code: "smtp.recipient_rejected",
      },
    ]);
    // Not retryable: the sweep leaves it failed and sends nothing.
    smtp.configure({});
    await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-sweep", new Date(Date.now() + 3_600_000));
    expect((await deliveriesOf(notification.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(smtp.messages).toHaveLength(0);
    // A later successful send resolves the exception `recovered`.
    await runFanout(api.db, await envelopeOf((await notify(w, w.office)).notification.id), "be-i2-ok");
    const after = await api.db
      .selectFrom("operational_exception")
      .select(["status", "resolution"])
      .where("organization_id", "=", w.orgA.id)
      .where("source_code", "=", FANOUT_QUEUE)
      .execute();
    expect(after).toEqual([{ status: "resolved", resolution: "recovered" }]);
  });

  it("a retryable failure is retried by the sweep after its backoff, then sent once", async () => {
    const w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
    smtp.configure({ rcptReply: 451 });
    const { notification } = await notify(w, w.office);
    await runFanout(api.db, await envelopeOf(notification.id), "be-i2-temp");
    const [failed] = await deliveriesOf(notification.id);
    expect(failed).toMatchObject({ status: "failed", attempts: 1, error_code: "smtp.temporary_failure" });
    smtp.configure({});
    // Before the backoff (10 s after the first attempt) nothing is retried.
    const early = await runDeliverySweep(
      api.db,
      { organizationId: w.orgA.id },
      "be-i2-early",
      failed!.last_attempt_at!,
    );
    expect(early.retried).toBe(0);
    const due = new Date(failed!.last_attempt_at!.getTime() + retryDelaySeconds(1) * 1000 + 1000);
    const sweep = await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-due", due);
    expect(sweep.retried).toBe(1);
    expect((await deliveriesOf(notification.id))[0]).toMatchObject({ status: "sent", attempts: 2, error_code: null });
    expect(smtp.messages).toHaveLength(1);
    const again = await runDeliverySweep(
      api.db,
      { organizationId: w.orgA.id },
      "be-i2-again",
      new Date(due.getTime() + 600_000),
    );
    expect(again.retried).toBe(0);
    expect(smtp.messages).toHaveLength(1);
  });
});

describe("the delivery policy is respected (ADR-0044 §5)", () => {
  it("a held (quiet-hours) notification fans out only when the digest job releases it", async () => {
    const w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
    // Quiet hours from one hour ago to one hour ahead, in Asia/Riyadh (digest off: released, not digested).
    const hhmm = (offsetMinutes: number) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(Date.now() + offsetMinutes * 60_000));
    const office = await signIn(api.app, w.office.subject);
    const pref = await call(api.app, "PUT", "/api/v1/me/notification-preferences", {
      session: office,
      headers: { "if-match": '"0"' },
      body: { quietHoursStart: hhmm(-60), quietHoursEnd: hhmm(60), timezone: "Asia/Riyadh", digestMode: "off" },
    });
    expect(pref.status, JSON.stringify(pref.body)).toBe(200);
    const { notification } = await notify(w, w.office);
    expect(notification.delivery_state).toBe("held");
    const held = await runFanout(api.db, await envelopeOf(notification.id), "be-i2-held");
    expect(held).toMatchObject({ outcome: "held", created: [], sends: [] });
    expect(await deliveriesOf(notification.id)).toEqual([]);
    expect(await ledgerOf(notification.id)).toBe(0);
    // Still held: the sweep does not fan it out.
    await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-sweep-held");
    expect(await deliveriesOf(notification.id)).toEqual([]);
    expect(smtp.messages).toHaveLength(0);
    // The digest job releases it at the end of the quiet hours; the next sweep fans it out once.
    const release = new Date(notification.deliver_after!.getTime() + 60_000);
    await runDigestWindow(api.db, "be-i2-digest", release, { userIds: [w.office.id] });
    const state = await api.db
      .selectFrom("inbox_notification")
      .select("delivery_state")
      .where("id", "=", notification.id)
      .executeTakeFirstOrThrow();
    expect(state.delivery_state).toBe("delivered");
    const sweep = await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-sweep-released");
    expect(sweep.fannedOut).toBe(1);
    expect((await deliveriesOf(notification.id))[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(smtp.messages).toHaveLength(1);
    await runDeliverySweep(api.db, { organizationId: w.orgA.id }, "be-i2-sweep-again");
    expect(await deliveriesOf(notification.id)).toHaveLength(1);
    expect(smtp.messages).toHaveLength(1);
  });
});

describe("the job identities (ADR-0053 §1; 0120)", () => {
  it("a narrowed grant fails the run with service_identity.out_of_scope before anything is written", async () => {
    const w = await seedWorld(api.db);
    await putEmail(w, true, '"0"');
    const { notification } = await notify(w, w.office);
    const code = `job:${FANOUT_QUEUE}`;
    const admin = await signIn(api.app, w.admin.subject); // ADM_TECH at organization scope (BE-J's PUT route)
    const setGrant = async (granted: readonly string[], reason: string) => {
      const row = await api.db
        .selectFrom("service_identity")
        .select(["id", "version"])
        .where("code", "=", code)
        .executeTakeFirstOrThrow();
      const res = await call(api.app, "PUT", `/api/v1/admin/service-identities/${row.id}`, {
        session: admin,
        headers: { "if-match": `"${row.version}"` },
        body: { grantedPermissionCodes: granted, reason },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };
    const declared = (
      await api.db
        .selectFrom("service_identity")
        .select("declared_permission_codes")
        .where("code", "=", code)
        .executeTakeFirstOrThrow()
    ).declared_permission_codes;
    await setGrant(["transformation.read"], "Synthetic BE-I2 test: narrow.");
    try {
      await expect(
        FANOUT_HANDLER.handle(api.db, await envelopeOf(notification.id), "be-i2-narrow"),
      ).rejects.toMatchObject({
        code: "service_identity.out_of_scope",
      });
      expect(await deliveriesOf(notification.id)).toEqual([]);
    } finally {
      await setGrant([...declared], "Synthetic BE-I2 test: restore.");
    }
    expect((await runFanout(api.db, await envelopeOf(notification.id), "be-i2-restored")).outcome).toBe("fanned_out");
  });
});
