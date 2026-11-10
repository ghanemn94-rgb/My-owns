// T-DG6-BE-Z14 (D-226, D-231; code-security observation 600; ADR-0051 §3, amendment "version-bound automation tokens"
// part C): every response that serializes a notification applies the inbox redaction (`restrictedNotifications`, then
// `restrictedNotificationView`). This guard fails when a new serializer skips it:
//   1. Source sweep: any API module that reads `inbox_notification` (query builder or raw SQL) or builds an
//      `InboxNotification`, `NotificationDigest` or `NotificationDigestItem` must call both helpers, unless it is listed
//      in NOT_A_SERIALIZER with the reason it returns no notification text.
//   2. Contract sweep: the operations whose response schema reaches a notification shape (InboxNotification,
//      InboxPage, NotificationDigest, NotificationDigestItem) are exactly the known, redacted ones. A new operation that
//      returns one fails here until it is added (after its module passes check 1).
//   3. The redacted shape itself.
// Nothing here reads or writes DG0-DG7 or any business approval (G1-G6).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { restrictedNotificationView } from "./deep-links.ts";

const SRC = fileURLToPath(new URL("../../", import.meta.url)); // apps/api/src/
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Modules that touch notifications but return no notification text, each with its reason. */
const NOT_A_SERIALIZER = new Map<string, string>([
  [
    "modules/tasks/deep-links.ts",
    "defines restrictedNotifications/restrictedNotificationView; resolveDeepLink refuses 403 deep_link.forbidden by the same decision and returns only an unrestricted link",
  ],
  ["modules/tasks/service.ts", "writes notifications (insert, outbox event); serializes none"],
  [
    "modules/tasks/channels/port.ts",
    "the channel port interface; the worker renders channel text with its twin decision",
  ],
]);

/** The API operations whose response is (or contains) a notification, each redacted. */
const REDACTED_OPERATIONS = ["getMyNotificationDigest", "listMyInbox", "markInboxNotificationRead"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const READS_NOTIFICATION = [
  /selectFrom\(\s*["']inbox_notification\b/,
  /(?:inner|left|right|full)Join\(\s*["']inbox_notification\b/,
  /\b(?:FROM|JOIN)\s+inbox_notification\b/i,
  /\binbox_notification\b/,
];
const BUILDS_NOTIFICATION = /(?::\s*|<|\bas\s+)(?:InboxNotification|NotificationDigest|NotificationDigestItem)\b/;

describe("T-DG6-BE-Z14: every notification serializer applies the D-226 redaction", () => {
  it("source sweep: a module that reads or builds a notification calls restrictedNotifications and restrictedNotificationView", () => {
    const touching: string[] = [];
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      const text = readFileSync(file, "utf8");
      const reads = READS_NOTIFICATION.some((re) => re.test(text));
      const builds = BUILDS_NOTIFICATION.test(text);
      if (!reads && !builds) continue;
      touching.push(rel);
      if (NOT_A_SERIALIZER.has(rel)) continue;
      const decides = /\brestrictedNotifications\(/.test(text);
      const redacts = /\brestrictedNotificationView\(/.test(text) || /\bnotificationFor\(/.test(text);
      if (!decides || !redacts) missing.push(`${rel} (decision: ${decides}, view: ${redacts})`);
    }
    expect(missing, "notification serializers without the D-226 redaction").toEqual([]);
    // The known serializers are found by the sweep (a sweep that matches nothing would pass vacuously).
    expect(touching).toEqual(expect.arrayContaining(["modules/tasks/routes.ts", "modules/tasks/digests.ts"]));
    // routes.ts serializes through notificationFor, which must be the shared view.
    const routes = readFileSync(join(SRC, "modules/tasks/routes.ts"), "utf8");
    expect(routes).toMatch(/const notificationFor = [\s\S]{0,200}restrictedNotificationView\(/);
    // Every listed exception still exists (a stale list would hide a new serializer under an old name).
    for (const rel of NOT_A_SERIALIZER.keys())
      expect(touching, `${rel} is listed but no longer matched`).toContain(rel);
  });

  it("contract sweep: exactly the redacted operations return a notification shape", () => {
    const yaml = readFileSync(join(REPO, "docs/api/openapi.yaml"), "utf8");
    const NOTIFICATION_SCHEMAS =
      /#\/components\/schemas\/(InboxNotification|InboxPage|NotificationDigest|NotificationDigestItem)"/;
    const paths = yaml.slice(yaml.indexOf("\npaths:"), yaml.indexOf("\ncomponents:"));
    // Split the paths section into operations at each "operationId:". A block runs to the next operationId, so it holds
    // the operation's responses (and only the next operation's tags and parameters, which name no response schema).
    const blocks = paths.split(/\n\s+operationId:\s*/).slice(1);
    expect(blocks.length).toBeGreaterThan(100);
    const returning = blocks
      .filter((b) => NOTIFICATION_SCHEMAS.test(b))
      .map((b) => b.split(/\s/)[0]!)
      .sort();
    expect(returning).toEqual(REDACTED_OPERATIONS);
  });

  it("the redacted view: inbox.restricted, params {}, the transformation home (else My Work), the marker; other fields kept", () => {
    const view = {
      notificationId: "01990000-0000-7000-8000-000000000001",
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: "B01" },
      linkPath: "/transformations/t/finance-validations/f",
      createdAt: "2026-11-09T00:00:00.000Z",
    };
    expect(restrictedNotificationView(view, "01990000-0000-7000-8000-0000000000aa", true)).toEqual({
      notificationId: view.notificationId,
      messageKey: "inbox.restricted",
      messageParams: {},
      linkPath: "/transformations/01990000-0000-7000-8000-0000000000aa",
      createdAt: view.createdAt,
      includesRestrictedRecords: true,
    });
    expect(restrictedNotificationView(view, null, true).linkPath).toBe("/my-work");
    expect(restrictedNotificationView(view, "x", false)).toBe(view);
  });
});
