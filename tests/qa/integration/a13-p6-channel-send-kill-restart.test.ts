// A13 "Durable automation" on the P6 jobs (T-DG6-QA-C; REQ-S20-013, REQ-DLV-038): kill and restart the worker DURING
// an external channel send (email). Acceptance (master prompt §20 A13): "Retried events, worker restarts and partial
// failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"; the
// assignment's reading for P6: the send resumes or fails cleanly, exactly once, with no partial data.
//
// Derived from docs/api/openapi.yaml (putNotificationChannel: If-Match 0 creates, SMTP settings; runJobNow;
// NotificationDelivery status pending | sent | failed | skipped) and ADR-0054 §3 ("Fan-out after commit, exactly once":
// one delivery per (notification, channel), UNIQUE backstop; the delivery_sweep "sends a pending delivery an
// interrupted run left behind"). SMTP accepts a message only with its 250 reply after DATA; the drill kills the worker
// while the message is on the wire and NOT yet accepted (the window ADR-0054 §3 can make exactly-once; the other
// window, a crash after the 250 and before `sent` is recorded, is at-least-once by the ADR's own statement and is not
// exercised here: see the handback).
//
// The drill, on this file's own scratch database, with a local SMTP double on 127.0.0.1 (tests/qa/support/a13c.ts;
// never a real mail service):
//  1. ADM_TECH enables the email channel for the organization through the API;
//  2. a KPI actual submitted on a review route notifies its reviewer (the in-app inbox notification, DG4);
//  3. the production worker (separate OS process) fans the notification out and starts the send; the SMTP double
//     receives the whole message and does not answer; the worker is SIGKILLed;
//  4. then: one delivery row per notification and channel, still `pending`, nothing accepted by the server, the inbox
//     notification exists exactly once;
//  5. the worker restarts (a new process); the SMTP double answers again; an administrator runs the delivery sweep
//     (runJobNow) until the interrupted send is due (STUCK_PENDING_SECONDS, 120 s, not shortened);
//  6. every delivery is `sent`; the server accepted exactly one message per sent delivery (no duplicate notification),
//     and the reviewer's notification was accepted once, to the reviewer's address.
// pg-boss's job expiry of notifications.fanout is shortened to 5 s in THIS scratch database (disclosed). All data is
// SYNTHETIC; nothing approves anything real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureQueues } from "../../../apps/worker/src/index.ts";
import { QA_QUEUE_POLICY, qaBoss, scratchEnv, type Body, type ScratchEnv } from "../support/a13-durable.ts";
import {
  killHard,
  spawnChild,
  startHangingSmtp,
  stopChild,
  waitFor,
  type Child,
  type HangingSmtp,
} from "../support/a13c.ts";
import { call, signIn, type Session } from "../support/api.ts";
import {
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  seedKpiWorld,
  seedWorld,
  submitActual,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

let env: ScratchEnv;
let w: World;
let k: KpiWorld;
let tech: Session;
let smtp: HangingSmtp;
let child: Child | null = null;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13c_chn");
  const boss = qaBoss(env.appUrl, "qa-a13c-chn-boss");
  await boss.start();
  await ensureQueues(boss, QA_QUEUE_POLICY);
  await env.su.query("UPDATE pgboss.queue SET expire_seconds = 5 WHERE name = 'notifications.fanout'");
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  smtp = await startHangingSmtp();
  w = await seedWorld(env.api.db);
  tech = await signIn(env.api.app, w.admin.subject);
  k = await seedKpiWorld(env.api, w);
  await mapPartyTo(env.api, k, "BO", k.users.bo.id);
}, 180_000);

afterAll(async () => {
  await stopChild(child);
  await smtp?.close();
  await env?.close();
});

const deliveries = () =>
  env.api.db.selectFrom("notification_delivery").selectAll().where("organization_id", "=", w.orgA.id).execute();
const workerEnv = (name: string) => ({
  QA_CHILD_DB_URL: env.appUrl,
  QA_CHILD_APP_NAME: name,
  QA_CHILD_POLICY: JSON.stringify(QA_QUEUE_POLICY),
});

describe("A13 (REQ-S20-013): the worker is killed during a channel send and restarted", () => {
  it(
    "the interrupted send stays pending and unaccepted; after the restart it is sent once, never twice",
    { timeout: 330_000 },
    async () => {
      const channel = await call<Body>(
        env.api.app,
        "PUT",
        `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`,
        {
          session: tech,
          headers: { "if-match": '"0"' },
          body: {
            enabled: true,
            smtp: {
              host: "127.0.0.1",
              port: smtp.port,
              security: "none",
              usernameRef: null,
              passwordRef: null,
              fromAddress: "hub-qa@example.invalid",
            },
            reason: "Synthetic QA A13 channel drill (local SMTP double).",
          },
        },
      );
      expect(channel.status, JSON.stringify(channel.body)).toBe(200);
      expect(channel.body.enabled).toBe(true);

      const kpi = await ownedKpi(env.api, k, REVIEW_FLOW);
      const period = await monthlyPeriod(env.api, w);
      smtp.hang(true);
      child = await spawnChild("a13c-child-worker.ts", workerEnv("qa-a13c-chn-w1"));
      const submitted = await submitActual(env.api, k, kpi.id, { reportingPeriodId: period.id, value: "7" });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      const actualId = submitted.body.actual.id as string;
      const note = await waitFor(
        () =>
          env.api.db
            .selectFrom("inbox_notification")
            .selectAll()
            .where("recipient_user_id", "=", k.users.bo.id)
            .where("link_path", "like", `%${actualId}%`)
            .executeTakeFirst(),
        "the reviewer's inbox notification",
      );

      await waitFor(async () => smtp.dataCompleted() >= 1, "a message on the wire, not yet accepted", 90_000).catch(
        (e) => {
          throw new Error(`${String(e)}\nchild:\n${child?.output()}`);
        },
      );
      await killHard(env.su, child);
      child = null;

      const mid = await deliveries();
      expect(mid.length, "a delivery row exists for the fanned-out notifications").toBeGreaterThanOrEqual(1);
      const midTarget = mid.filter((d) => d.inbox_notification_id === note.id);
      expect(
        midTarget.map((d) => d.status),
        "the reviewer's delivery: one row, not sent",
      ).toEqual(["pending"]);
      expect(smtp.accepted, "the server accepted nothing").toEqual([]);
      const once = await env.api.db.selectFrom("inbox_notification").select("id").where("id", "=", note.id).execute();
      expect(once).toHaveLength(1);

      // Restart: a new worker process; the SMTP double answers again; the administrator runs the delivery sweep.
      smtp.hang(false);
      child = await spawnChild("a13c-child-worker.ts", workerEnv("qa-a13c-chn-w2"));
      await waitFor(
        async () => {
          const ds = await deliveries();
          if (ds.every((d) => d.status !== "pending")) return ds;
          const run = await call<Body>(env.api.app, "POST", "/api/v1/admin/jobs/notifications.delivery_sweep/run", {
            session: tech,
          });
          expect(run.status, JSON.stringify(run.body)).toBe(202);
          await new Promise((r) => setTimeout(r, 5000));
          return null;
        },
        "every delivery leaves pending after the restart",
        260_000,
      ).catch(async (e) => {
        throw new Error(`${String(e)}\n${JSON.stringify(await deliveries())}\nchild:\n${child?.output()}`);
      });

      const after = await deliveries();
      const target = after.filter((d) => d.inbox_notification_id === note.id);
      expect(
        target.map((d) => [d.channel_kind, d.status]),
        "the reviewer's delivery is sent, one row",
      ).toEqual([["email", "sent"]]);
      const sent = after.filter((d) => d.status === "sent");
      expect(
        after.filter((d) => d.status === "failed"),
        JSON.stringify(after),
      ).toEqual([]);
      expect(smtp.accepted.length, "one accepted message per sent delivery: no duplicate").toBe(sent.length);
      const bo = await env.api.db
        .selectFrom("app_user")
        .select("email")
        .where("id", "=", k.users.bo.id)
        .executeTakeFirstOrThrow();
      const toBo = smtp.accepted.filter((m) => m.rcptTo.some((r) => r.includes(String(bo.email))));
      const boNotes = new Set(
        (
          await env.api.db
            .selectFrom("inbox_notification")
            .select("id")
            .where("recipient_user_id", "=", k.users.bo.id)
            .execute()
        ).map((n) => n.id),
      );
      const boSent = sent.filter((d) => boNotes.has(d.inbox_notification_id));
      expect(toBo.length, "the reviewer received exactly one message per sent delivery").toBe(boSent.length);
      expect(boSent.length).toBeGreaterThanOrEqual(1);
    },
  );
});
