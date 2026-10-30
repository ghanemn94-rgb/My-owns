// T-DG6-BE-I2 (ADR-0054 §3; REQ-S12-023): the pure parts of the notification channel jobs, without a database: their
// registration (queues, event routing, handlers, service identities), the inbox_notification.created payload contract,
// the keys, the backoff and the retryable codes, the deep-link target twin, and migration 0120's schedule read as text
// (the seed.test.ts pattern). The database-backed proofs (A21 with no channel, one sent delivery and one message, replay,
// retry and concurrency, failure isolation, held notifications, the restricted text, a narrowed grant) are in
// apps/api/test/integration/tasks/channel-fanout.test.ts against the in-process fake SMTP server.
import { readFileSync } from "node:fs";
import { inboxNotificationCreatedV1, outboxPayloadSchema } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { EMAIL_ERROR_CODES } from "../channels/port.ts";
import { classifySmtpError } from "../channels/email.ts";
import { INBOX_NOTIFICATION_CREATED_EVENT, jobIdentityDeclaration } from "../kit.ts";
import { DOMAIN_QUEUES, QUEUES_FOR_EVENT } from "../queues/index.ts";
import { NOTIFICATIONS_EVENT_QUEUES, NOTIFICATIONS_QUEUES } from "../queues/notifications.ts";
import { DOMAIN_HANDLERS } from "./index.ts";
import {
  CHANNEL_DELIVERY_LOCK,
  deepLinkTargetTwin,
  DELIVERY_SWEEP_QUEUE,
  deliveryLockKey,
  FANOUT_QUEUE,
  fanoutKey,
  MAX_SEND_ATTEMPTS,
  NOTIFICATIONS_HANDLERS,
  RETRYABLE_ERROR_CODES,
  retryDelaySeconds,
} from "./notifications.ts";

const MIGRATION = readFileSync(
  new URL("../../../../packages/db/migrations/0120_p6_notification_fanout_jobs.sql", import.meta.url),
  "utf8",
);
const N = "01920006-0120-7000-8000-0000000000aa";
const U = "01920006-0120-7000-8000-0000000000bb";

describe("notification channel jobs: registration (ADR-0054 §3)", () => {
  it("declares the two queues, each with one handler registered in DOMAIN_HANDLERS and one service identity", () => {
    const queues = [FANOUT_QUEUE, DELIVERY_SWEEP_QUEUE];
    expect(NOTIFICATIONS_QUEUES.map((q) => q.name)).toEqual(queues);
    expect(NOTIFICATIONS_HANDLERS.map((h) => h.queue)).toEqual(queues);
    for (const q of queues) {
      expect(DOMAIN_QUEUES.map((d) => d.name)).toContain(q);
      expect(DOMAIN_HANDLERS.filter((h) => h.queue === q)).toHaveLength(1);
      const declared = jobIdentityDeclaration(q)!;
      expect(declared.permissions).toEqual(["transformation.read", "user.read", "access.read", "operations.read"]);
      expect(declared.sensitiveAccess).toBe("none");
      expect(declared.permissions).not.toContain("notification_channel.configure");
    }
  });

  it("routes inbox_notification.created to notifications.fanout only (no automation trigger)", () => {
    expect(NOTIFICATIONS_EVENT_QUEUES).toEqual({ "inbox_notification.created": FANOUT_QUEUE });
    expect(QUEUES_FOR_EVENT[INBOX_NOTIFICATION_CREATED_EVENT]).toEqual([FANOUT_QUEUE]);
  });

  it("the payload is ids only (v1), strict", () => {
    const schema = outboxPayloadSchema(INBOX_NOTIFICATION_CREATED_EVENT, 1)!;
    expect(schema).toBe(inboxNotificationCreatedV1);
    expect(schema.safeParse({ notificationId: N, recipientUserId: U }).success).toBe(true);
    expect(schema.safeParse({ notificationId: N, recipientUserId: U, email: "x@example.invalid" }).success).toBe(false);
    expect(schema.safeParse({ notificationId: "x", recipientUserId: U }).success).toBe(false);
  });

  it("migration 0120 seeds the sweep schedule every minute in Asia/Riyadh, and no schedule for the event consumer", () => {
    expect(MIGRATION).toMatch(
      /'notifications\.delivery_sweep', 'notifications\.delivery_sweep', '\* \* \* \* \*', 'Asia\/Riyadh'/,
    );
    expect(MIGRATION).not.toMatch(/'notifications\.fanout', '[^']*', '[^']*\*/);
    expect(MIGRATION).not.toMatch(/\b(ALTER|DROP|CREATE)\s+(TABLE|FUNCTION|TRIGGER|INDEX)\b(?!.*TEMPORARY)/i);
  });
});

describe("keys, locks and retries (ADR-0054 §3, ADR-0008 §4, ADR-0016 §6)", () => {
  it("one ledger key per notification and one lock key per (notification, channel), on lock class 730306", () => {
    expect(fanoutKey(N)).toBe(`notification:${N}`);
    expect(deliveryLockKey(N, "email")).toBe(`${N}:email`);
    expect(CHANNEL_DELIVERY_LOCK).toBe(730306);
  });

  it("five attempts with exponential backoff from 10 s", () => {
    expect(MAX_SEND_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4].map(retryDelaySeconds)).toEqual([10, 20, 40, 80]);
  });

  it("the retryable codes are exactly the adapter's retryable classifications", () => {
    for (const code of RETRYABLE_ERROR_CODES) expect(EMAIL_ERROR_CODES).toContain(code);
    const samples: unknown[] = [
      { code: "ECONNECTION" },
      { code: "ETIMEDOUT" },
      { code: "ETLS" },
      { code: "EAUTH", responseCode: 535 },
      { code: "EAUTH", responseCode: 454 },
      { code: "EENVELOPE", responseCode: 550 },
      { code: "EENVELOPE", responseCode: 451 },
      { code: "EMESSAGE", responseCode: 554 },
      { code: "EMESSAGE" },
      { code: "EPROTOCOL" },
      { code: "ECONFIG" },
      {},
    ];
    for (const s of samples) {
      const c = classifySmtpError(s);
      expect(RETRYABLE_ERROR_CODES.has(c.errorCode), JSON.stringify(s)).toBe(c.retryable);
    }
  });
});

describe("deepLinkTargetTwin (the twin of the API's deepLinkTarget, ADR-0051 §3)", () => {
  it("recognizes the three record routes and nothing else", () => {
    const T = "01920006-0120-7000-8000-0000000000CC";
    const R = "01920006-0120-7000-8000-0000000000DD";
    expect(deepLinkTargetTwin(`/transformations/${T}/benefits/${R}`)).toEqual({
      recordType: "benefit",
      recordId: R.toLowerCase(),
      transformationId: T.toLowerCase(),
    });
    expect(deepLinkTargetTwin(`/transformations/${T}/business-cases/${R}?tab=1`)?.recordType).toBe("business_case");
    expect(deepLinkTargetTwin(`/transformations/${T}/evidence/${R}/preview`)?.recordType).toBe("evidence");
    expect(deepLinkTargetTwin(`/transformations/${T}`)).toBeNull();
    expect(deepLinkTargetTwin(`/transformations/${T}/benefitsx/${R}`)).toBeNull();
    expect(deepLinkTargetTwin("/me/inbox")).toBeNull();
  });
});
