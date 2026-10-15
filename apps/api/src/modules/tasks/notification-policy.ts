// Notification policy and preferences (ADR-0044 §5, §9, §10; REQ-S12-025, M0241; D-142 Q11; p5-work-split §E.3,
// T-DG5-BE-L). Four separate settings: business-day timing (organization), quiet hours and digest (user, else the
// organization defaults), urgent escalation (work_item_kind.urgency; always delivered at once):
//   GET /me/notification-preferences    own settings (null when none), the effective ones, version 0 when none stored
//                                       (authenticated: one's own row only)
//   PUT /me/notification-preferences    set them (notification.preferences; every role except AUD; If-Match "0" creates).
//                                       422 notification_preference.quiet_hours_invalid, notification_preference.timezone_unknown
//   GET /admin/notification-policy      the caller's organization policy, version 0 when none (notification_policy.configure)
//   PUT /admin/notification-policy      set it (notification_policy.configure: ADM_TECH; If-Match "0" creates).
//                                       422 notification_preference.quiet_hours_invalid
//   GET /me/notification-digests/{id}   one of one's own digests (tasks/digests.ts; registered here)
// Every write: commit-time authorization (grants reloaded in the transaction), validation, If-Match (428 missing, 409
// stale; "0" creates and is stale once a row exists), one audit event in the same transaction, no remote I/O.
// With no preference and no policy nothing is held: the DG4 behaviour. In-app only (email and messaging: P6 adapters).
//
// `loadDeliveryInput` is the database half of the delivery decision used by createWorkItemOnce (service.ts); the
// worker kit carries its twin (ADR-0002 rule 5; parity test in test/integration/tasks/notification-delivery.test.ts).
import { sql, type DbOrTx, type NotificationPolicyRow, type NotificationPreferenceRow, type Tx } from "@mth/db";
import { DEFAULTS, PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  hhmm,
  NO_DELIVERY_SETTINGS,
  notificationPolicyPut,
  notificationPreferencesPut,
  quietHoursValid,
  type DeliveryInput,
  type DeliverySettings,
  type DigestMode,
  type NotificationPolicy,
  type NotificationPreferences,
  type NotificationSettings,
} from "@mth/shared/schemas";
import { isKnownTimeZone } from "@mth/shared/time";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  denialOf,
  holdsAnywhere,
  principalOf,
  refreshPrincipal,
  type Principal,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  etag,
  HttpProblem,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { registerDigestRoutes } from "./digests.ts";

export const PREFERENCES_PATH = "/api/v1/me/notification-preferences";
export const POLICY_PATH = "/api/v1/admin/notification-policy";
const PREFERENCES: Permission = "notification.preferences";
const CONFIGURE: Permission = "notification_policy.configure";
const JSON_BODY = ["application/json"] as const;
/** The digest time of a user without a row (the 0075 column default). */
export const DEFAULT_DIGEST_TIME = "08:00";

export const notificationRefusals = {
  quietHoursInvalid: () =>
    problems.businessRule(
      "notification_preference.quiet_hours_invalid",
      "Quiet hours need a start time and a different end time.",
    ),
  timezoneUnknown: () =>
    problems.businessRule("notification_preference.timezone_unknown", "The time zone is not a known time zone."),
} as const;

// ------------------------------------------------------------------------------------------------ settings

const settingsOfPreference = (r: NotificationPreferenceRow): DeliverySettings => ({
  quietHoursStart: r.quiet_hours_start === null ? null : hhmm(r.quiet_hours_start),
  quietHoursEnd: r.quiet_hours_end === null ? null : hhmm(r.quiet_hours_end),
  timezone: r.timezone,
  digestMode: r.digest_mode as DigestMode,
  digestTime: hhmm(r.digest_time),
});

/** The organization defaults as a user's settings (in the user's own time zone). */
const settingsOfPolicy = (p: NotificationPolicyRow, timezone: string): DeliverySettings => ({
  quietHoursStart: p.default_quiet_hours_start === null ? null : hhmm(p.default_quiet_hours_start),
  quietHoursEnd: p.default_quiet_hours_end === null ? null : hhmm(p.default_quiet_hours_end),
  timezone,
  digestMode: p.default_digest_mode as DigestMode,
  digestTime: DEFAULT_DIGEST_TIME,
});

/** A user's time zone: the profile's, else the organization's default, else the product default (Asia/Riyadh). */
async function userTimeZone(db: DbOrTx, userId: string): Promise<{ organizationId: string; timezone: string }> {
  const u = await db
    .selectFrom("app_user as u")
    .innerJoin("organization as o", "o.id", "u.organization_id")
    .select(["u.organization_id", "u.timezone", "o.default_timezone"])
    .where("u.id", "=", userId)
    .executeTakeFirstOrThrow();
  return { organizationId: u.organization_id, timezone: u.timezone ?? u.default_timezone ?? DEFAULTS.timezone };
}

const policyRow = (db: DbOrTx, organizationId: string) =>
  db.selectFrom("notification_policy").selectAll().where("organization_id", "=", organizationId).executeTakeFirst();
const preferenceRow = (db: DbOrTx, userId: string) =>
  db.selectFrom("notification_preference").selectAll().where("user_id", "=", userId).executeTakeFirst();

export interface EffectiveSettings {
  readonly own: DeliverySettings | null;
  readonly effective: DeliverySettings;
  readonly policy: NotificationPolicyRow | undefined;
}

/** Own row, else the organization defaults, else none (ADR-0044 §5). */
export async function effectiveSettingsOf(db: DbOrTx, userId: string): Promise<EffectiveSettings> {
  const { organizationId, timezone } = await userTimeZone(db, userId);
  const own = await preferenceRow(db, userId);
  const policy = await policyRow(db, organizationId);
  const ownSettings = own ? settingsOfPreference(own) : null;
  const effective = ownSettings ?? (policy ? settingsOfPolicy(policy, timezone) : NO_DELIVERY_SETTINGS(timezone));
  return { own: ownSettings, effective, policy };
}

/**
 * The inputs of the delivery decision for one notification of `kind` to `userId` (ADR-0044 §5): the kind's urgency,
 * the effective settings and the organization's business-day rule with its active default calendar. Reads only.
 */
export async function loadDeliveryInput(
  db: DbOrTx,
  input: { readonly organizationId: string; readonly userId: string; readonly kind: string },
): Promise<DeliveryInput> {
  const kind = await db
    .selectFrom("work_item_kind")
    .select("urgency")
    .where("code", "=", input.kind)
    .executeTakeFirst();
  const urgency = kind?.urgency === "urgent" ? "urgent" : "normal";
  const { effective, policy } = await effectiveSettingsOf(db, input.userId);
  const enabled = policy?.non_urgent_working_days_only ?? false;
  const calendar = enabled
    ? await db
        .selectFrom("business_calendar")
        .select(["id", "workweek", "timezone"])
        .where("organization_id", "=", input.organizationId)
        .where("is_default", "=", true)
        .where("status", "=", "active")
        .executeTakeFirst()
    : undefined;
  const holidays = calendar
    ? await db
        .selectFrom("business_calendar_holiday")
        .select([sql<string>`date_from::text`.as("date_from"), sql<string>`date_to::text`.as("date_to")])
        .where("calendar_id", "=", calendar.id)
        .where("status", "=", "active")
        .orderBy("date_from")
        .execute()
    : [];
  return {
    urgency,
    settings: effective,
    workingDays: {
      enabled,
      calendar: calendar
        ? {
            workweek: calendar.workweek.map(Number),
            holidays: holidays.map((h) => ({ dateFrom: h.date_from, dateTo: h.date_to })),
          }
        : null,
      timezone: calendar?.timezone ?? effective.timezone,
    },
  };
}

// ------------------------------------------------------------------------------------------------ views

const toSettings = (s: DeliverySettings): NotificationSettings => ({
  quietHoursStart: s.quietHoursStart,
  quietHoursEnd: s.quietHoursEnd,
  timezone: s.timezone,
  digestMode: s.digestMode,
  digestTime: s.digestTime,
});

async function preferencesView(db: DbOrTx, userId: string): Promise<NotificationPreferences> {
  const s = await effectiveSettingsOf(db, userId);
  const row = await preferenceRow(db, userId);
  return {
    own: s.own === null ? null : toSettings(s.own),
    effective: toSettings(s.effective),
    version: row?.version ?? 0,
  };
}

async function urgentKinds(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .selectFrom("work_item_kind")
    .select("code")
    .where("urgency", "=", "urgent")
    .orderBy("code")
    .execute();
  return rows.map((r) => r.code);
}

async function policyView(db: DbOrTx, organizationId: string): Promise<NotificationPolicy> {
  const p = await policyRow(db, organizationId);
  return {
    organizationId,
    nonUrgentWorkingDaysOnly: p?.non_urgent_working_days_only ?? false,
    defaultQuietHoursStart: p?.default_quiet_hours_start ? hhmm(p.default_quiet_hours_start) : null,
    defaultQuietHoursEnd: p?.default_quiet_hours_end ? hhmm(p.default_quiet_hours_end) : null,
    defaultDigestMode: (p?.default_digest_mode ?? "off") as DigestMode,
    urgentDelivery: "immediate",
    urgentKinds: await urgentKinds(db),
    version: p?.version ?? 0,
  };
}

// ------------------------------------------------------------------------------------------------ access

/** The signed-in user id (401 without a session; a service principal has none). */
function callerOf(request: FastifyRequest): string {
  const principal = principalOf(request);
  if (principal.userId === null) throw problems.unauthenticated();
  return principal.userId;
}

/** 403 naming the caller's organization (the failed-mutation audit records one authorization.denied). */
function denied(permission: Permission, organizationId: string | null): HttpProblem {
  const refusal = problems.forbidden();
  return organizationId === null
    ? refusal
    : refusal.withDenial(
        denialOf(permission, {
          level: "organization",
          organizationId,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

/** `notification.preferences` held anywhere (every role except AUD; ADR-0044 §9). */
function requirePreferenceWriter(principal: Principal): void {
  if (!holdsAnywhere(principal, PREFERENCES)) throw denied(PREFERENCES, principal.organizationId);
}

/** `notification_policy.configure` through a grant of the caller's own organization (ADM_TECH). */
function requirePolicyConfigurer(principal: Principal): string {
  principal.tracker.decisions += 1;
  const organizationId = principal.organizationId;
  if (
    organizationId === null ||
    !principal.grants.some((g) => g.permissions.has(CONFIGURE) && g.organizationId === organizationId)
  )
    throw denied(CONFIGURE, organizationId);
  return organizationId;
}

/** If-Match of a defaulted record: `"0"` names "no row yet" (the putChangeControlPolicy / rag-policy precedent). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function staleAgainst(current: { version: number } | undefined): HttpProblem {
  if (current) return problems.versionConflict(current.version);
  // No row yet (version 0): the Problem schema's currentVersion starts at 1, so it is left out.
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

const toDbTime = (t: string | null): string | null => (t === null ? null : `${t}:00`);
/** The audit `changes` of a write: each changed column with its value before (null on create) and after. */
function changesOf(before: Record<string, unknown>, after: Record<string, unknown>) {
  const prior = new Map(Object.entries(before));
  return Object.fromEntries(
    Object.entries(after)
      .filter(([k, to]) => prior.get(k) !== to)
      .map(([k, to]) => [k, { from: prior.get(k) ?? null, to }]),
  );
}

// ------------------------------------------------------------------------------------------------ writes

async function putPreferences(tx: Tx, request: FastifyRequest): Promise<NotificationPreferences> {
  callerOf(request);
  const fresh = await refreshPrincipal(tx, request); // commit-time: 401 when the session ended meanwhile
  requirePreferenceWriter(fresh);
  const userId = fresh.userId!;
  const body = parseBody(notificationPreferencesPut, request.body);
  const expected = ifMatchOrZero(request);
  const current = await tx
    .selectFrom("notification_preference")
    .selectAll()
    .where("user_id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  if ((current?.version ?? 0) !== expected) throw staleAgainst(current);
  if (!quietHoursValid(body.quietHoursStart, body.quietHoursEnd)) throw notificationRefusals.quietHoursInvalid();
  const { organizationId, timezone: profileZone } = await userTimeZone(tx, userId);
  const timezone = body.timezone ?? current?.timezone ?? profileZone;
  if (!isKnownTimeZone(timezone)) throw notificationRefusals.timezoneUnknown();
  const values = {
    quiet_hours_start: toDbTime(body.quietHoursStart),
    quiet_hours_end: toDbTime(body.quietHoursEnd),
    timezone,
    digest_mode: body.digestMode,
    digest_time: toDbTime(body.digestTime ?? (current ? hhmm(current.digest_time) : DEFAULT_DIGEST_TIME))!,
  };
  const row = current
    ? await tx
        .updateTable("notification_preference")
        .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto("notification_preference")
        .values({
          id: uuidv7(),
          organization_id: organizationId,
          user_id: userId,
          ...values,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
  const view = (r: NotificationPreferenceRow | undefined) =>
    r ? { ...settingsOfPreference(r) } : ({} as Record<string, unknown>);
  await record(tx, auditContextOf(request), {
    action: current ? "notification_preference.update" : "notification_preference.create",
    recordType: "notification_preference",
    recordId: row.id,
    organizationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: changesOf(view(current), view(row)),
  });
  return preferencesView(tx, userId);
}

async function putPolicy(tx: Tx, request: FastifyRequest): Promise<NotificationPolicy> {
  callerOf(request);
  const fresh = await refreshPrincipal(tx, request);
  const organizationId = requirePolicyConfigurer(fresh);
  const userId = fresh.userId!;
  const body = parseBody(notificationPolicyPut, request.body);
  const expected = ifMatchOrZero(request);
  const current = await tx
    .selectFrom("notification_policy")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .forUpdate()
    .executeTakeFirst();
  if ((current?.version ?? 0) !== expected) throw staleAgainst(current);
  if (!quietHoursValid(body.defaultQuietHoursStart, body.defaultQuietHoursEnd))
    throw notificationRefusals.quietHoursInvalid();
  const values = {
    non_urgent_working_days_only: body.nonUrgentWorkingDaysOnly,
    default_quiet_hours_start: toDbTime(body.defaultQuietHoursStart),
    default_quiet_hours_end: toDbTime(body.defaultQuietHoursEnd),
    default_digest_mode: body.defaultDigestMode,
  };
  const row = current
    ? await tx
        .updateTable("notification_policy")
        .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto("notification_policy")
        .values({ id: uuidv7(), organization_id: organizationId, ...values, created_by: userId, updated_by: userId })
        .returningAll()
        .executeTakeFirstOrThrow();
  const view = (r: NotificationPolicyRow | undefined): Record<string, unknown> =>
    r
      ? {
          non_urgent_working_days_only: r.non_urgent_working_days_only,
          default_quiet_hours_start: r.default_quiet_hours_start === null ? null : hhmm(r.default_quiet_hours_start),
          default_quiet_hours_end: r.default_quiet_hours_end === null ? null : hhmm(r.default_quiet_hours_end),
          default_digest_mode: r.default_digest_mode,
        }
      : {};
  await record(tx, auditContextOf(request), {
    action: current ? "notification_policy.update" : "notification_policy.create",
    recordType: "notification_policy",
    recordId: row.id,
    organizationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: changesOf(view(current), view(row)),
  });
  return policyView(tx, organizationId);
}

// ------------------------------------------------------------------------------------------------ routes

/**
 * ETag of a defaulted record (the ARCH-R1 rule `ETagOrZero` / `IfMatchOrZero`): `"0"` while nothing is stored (the
 * value the PUT's If-Match "0" takes), else the row version. Contract note for the orchestrator (handback): the two
 * GET 200 responses declare `ETag` (>= 1) where this rule needs `ETagOrZero`.
 */
function etagOf(reply: FastifyReply, version: number): void {
  reply.header("ETag", version >= 1 ? etag(version) : '"0"');
}

/** Registers this file's routes (and the digest read of digests.ts) and returns them as "METHOD /path". */
export function registerNotificationPolicyRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const session = { access: { permission: "authenticated" } } as const;
  const none = z.strictObject({});

  app.get(PREFERENCES_PATH, { config: session }, async (request, reply) => {
    const userId = callerOf(request);
    parseQuery(none, request.query);
    const view = await preferencesView(db, userId);
    etagOf(reply, view.version);
    return view;
  });

  app.put(
    PREFERENCES_PATH,
    { config: { access: { permission: PREFERENCES }, consumes: JSON_BODY } },
    async (request, reply) => {
      const view = await db.transaction().execute((tx) => putPreferences(tx, request));
      etagOf(reply, view.version);
      return view;
    },
  );

  app.get(POLICY_PATH, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    callerOf(request);
    parseQuery(none, request.query);
    const organizationId = requirePolicyConfigurer(principalOf(request));
    const view = await policyView(db, organizationId);
    etagOf(reply, view.version);
    return view;
  });

  app.put(
    POLICY_PATH,
    { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const view = await db.transaction().execute((tx) => putPolicy(tx, request));
      etagOf(reply, view.version);
      return view;
    },
  );

  return [
    `GET ${PREFERENCES_PATH}`,
    `PUT ${PREFERENCES_PATH}`,
    `GET ${POLICY_PATH}`,
    `PUT ${POLICY_PATH}`,
    ...registerDigestRoutes(app, deps),
  ];
}
