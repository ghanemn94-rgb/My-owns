// Notification preferences, the organization notification policy and digests (ADR-0044 §5, §9, §10; REQ-S12-025;
// OpenAPI `NotificationSettings`, `NotificationPreferences`, `NotificationPreferencesPut`, `NotificationPolicy`,
// `NotificationPolicyPut`, `NotificationDigestItem`, `NotificationDigest`; p5-work-split §E.3, T-DG5-BE-L).
// Times are `HH:MM` in the user's time zone; quiet hours may span midnight; both null = none. In-app only (D-142 Q11):
// email and messaging are P6 adapters. The pure delivery decision is re-exported here (one import path for the API,
// the worker and the web).
import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

export {
  decideDelivery,
  digestWindowOf,
  hhmm,
  instantOfWallClock,
  minutesOfTime,
  NO_DELIVERY_SETTINGS,
  nextDigestTime,
  quietHoursValid,
  releasesIntoDigest,
  wallClockOf,
  WORKING_DAY_RELEASE_MINUTES,
  type DeliveryDecision,
  type DeliveryInput,
  type DeliverySettings,
  type DigestMode,
  type HoldReason,
  type NotificationUrgency,
  type WorkingDayRule,
} from "../notifications/delivery.ts";

/** `HH:MM`, 00:00-23:59 (the OpenAPI pattern). */
export const clockTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "validation.pattern");
export const digestMode = z.enum(["off", "daily", "twice_daily"]);

export const notificationSettings = z.strictObject({
  quietHoursStart: clockTime.nullable(),
  quietHoursEnd: clockTime.nullable(),
  timezone: z.string(),
  digestMode,
  digestTime: clockTime,
});

export const notificationPreferences = z.strictObject({
  own: notificationSettings.nullable(),
  effective: notificationSettings,
  version: z.number().int().min(0),
});

/**
 * The PUT body. The time zone is checked by the handler (422 `notification_preference.timezone_unknown`), so its
 * schema here is only the OpenAPI `TimeZone` length; quiet start = end is 422 `quiet_hours_invalid` (ADR-0044 §10).
 */
export const notificationPreferencesPut = z.strictObject({
  quietHoursStart: clockTime.nullable(),
  quietHoursEnd: clockTime.nullable(),
  timezone: z.string().min(1).max(64).optional(),
  digestMode,
  digestTime: clockTime.optional(),
});

export const notificationPolicy = z.strictObject({
  organizationId: uuid,
  nonUrgentWorkingDaysOnly: z.boolean(),
  defaultQuietHoursStart: clockTime.nullable(),
  defaultQuietHoursEnd: clockTime.nullable(),
  defaultDigestMode: digestMode,
  urgentDelivery: z.enum(["immediate"]),
  urgentKinds: z.array(z.string()),
  version: z.number().int().min(0),
});

export const notificationPolicyPut = z.strictObject({
  nonUrgentWorkingDaysOnly: z.boolean(),
  defaultQuietHoursStart: clockTime.nullable(),
  defaultQuietHoursEnd: clockTime.nullable(),
  defaultDigestMode: digestMode,
});

export const notificationDigestItem = z.strictObject({
  notificationId: uuid,
  messageKey: z.string(),
  messageParams: z.record(z.string(), z.unknown()),
  linkPath: z.string(),
  createdAt: timestamp,
});

export const notificationDigest = z.strictObject({
  id: uuid,
  windowStart: timestamp,
  windowEnd: timestamp,
  count: z.number().int().min(1),
  items: z.array(notificationDigestItem),
});

export type NotificationSettings = z.infer<typeof notificationSettings>;
export type NotificationPreferences = z.infer<typeof notificationPreferences>;
export type NotificationPreferencesPut = z.infer<typeof notificationPreferencesPut>;
export type NotificationPolicy = z.infer<typeof notificationPolicy>;
export type NotificationPolicyPut = z.infer<typeof notificationPolicyPut>;
export type NotificationDigestItem = z.infer<typeof notificationDigestItem>;
export type NotificationDigest = z.infer<typeof notificationDigest>;
