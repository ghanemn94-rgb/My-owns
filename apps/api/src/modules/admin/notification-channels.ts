// P6 slice C (T-DG6-BE-I; ADR-0054 §3, §4, §5; REQ-S12-023): Administration > Notifications, the notification channel
// settings of an organization.
//   GET  /api/v1/admin/notification-channels                    listNotificationChannels   (configure or operations.read)
//   GET  /api/v1/admin/notification-channels/{channelKind}      getNotificationChannel     (ETag "0" = never configured)
//   PUT  /api/v1/admin/notification-channels/{channelKind}      putNotificationChannel     (IfMatchOrZero; reason)
//   POST /api/v1/admin/notification-channels/{channelKind}/test testNotificationChannel    (to the caller's own address)
//   GET  /api/v1/admin/notification-deliveries                  listNotificationDeliveries (configure or operations.read;
//                                                               T-DG6-BE-I2: status, attempts, error code; never the
//                                                               message text or the recipient address)
// The rules:
//  - The in-app inbox is always on and is not a channel row. No row, or a disabled row, = in-app only (A21): nothing in
//    this file is on the path of any workflow; a channel's absence or failure never blocks one.
//  - Authorization (ADR-0054 §5): `notification_channel.configure` at the organization's scope (ADM_TECH) reads,
//    changes and tests; `operations.read` at that scope (AUD, ADM_TECH) reads only, so AUD gets 403 on PUT and test.
//    An unknown organization is 404. A write re-checks the grant at commit time, inside the transaction, after the row
//    lock (§2 rule 4).
//  - Credentials are SecretRefs ({provider, name}), never values; a string or any other shape is 422
//    `storage.secret_ref_invalid`, and so is a provider this process has not registered. Both references or neither.
//  - `enterprise_messaging` has the port only (no adapter ships in P6): enabling it or giving it SMTP settings is 422
//    `notification_channel.adapter_unavailable`. `none` security is 422 `notification_channel.insecure_transport` when
//    NODE_ENV=production.
//  - Every PUT writes one audit event `notification_channel.changed` with the prior and new version (and the reason),
//    in the same transaction; the history row is written by the 0102 trigger. If-Match is required (428), stale is 409,
//    `"0"` creates the row (a concurrent create of the same kind is 409 through ON CONFLICT DO NOTHING).
//  - The test send runs OUTSIDE any transaction (no remote I/O inside one); its audit event `notification_channel.tested`
//    (outcome and error code only, never the address or the text) is written afterwards.
// Problem codes and English texts are ADR-0054 §4's, exactly. Nothing here is a business approval, and nothing reads or
// writes DG0-DG7. The live mail service is a residual: the adapter is proven against the in-process fake SMTP only.
import { reason as reasonRule, uuid } from "@mth/shared/schemas";
import { sql, type DbOrTx, type NotificationChannelTable } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  resolveTarget,
  type Principal,
} from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
  type SecretProviderRegistry,
} from "../platform/index.ts";
import { createBrandingReadPort } from "./branding-port.ts";

// ------------------------------------------------------------------------------------------------ the channel port
// admin may not import tasks (ADR-0002; modules.ts): the composition root (server.ts) hands this file the email adapter
// and the test-message renderer of tasks/channels/** through NotificationChannelRouteOptions. The shapes below are the
// structural subset of tasks/channels/port.ts this file needs (TypeScript checks the injection at server.ts).

const CHANNEL_KINDS = ["email", "enterprise_messaging"] as const;
type ChannelKind = (typeof CHANNEL_KINDS)[number];
const SMTP_SECURITY_MODES = ["starttls", "tls", "none"] as const;
/** P6 ships an adapter for email only; enterprise messaging has the port only (ADR-0054 §3). */
const adapterAvailable = (kind: ChannelKind): boolean => kind === "email";

interface ChannelSecretRef {
  readonly provider: string;
  readonly name: string;
}
interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: (typeof SMTP_SECURITY_MODES)[number];
  readonly usernameRef: ChannelSecretRef | null;
  readonly passwordRef: ChannelSecretRef | null;
  readonly fromAddress: string;
}
interface ChannelMessageLike {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly locale: "en" | "ar";
  readonly subject: string;
  readonly text: string;
  readonly deepLinkUrl: string;
}
type SendResult = { readonly ok: true } | { readonly ok: false; errorCode: string; retryable: boolean };

/** What server.ts injects from tasks/channels/** (createEmailChannel, renderTestMessage). */
export interface NotificationChannelPort {
  createEmailChannel(options: {
    readonly settings: SmtpSettings;
    readonly resolveSecret: (ref: ChannelSecretRef) => Promise<{ reveal(): string } | undefined>;
    readonly refuseInsecure: boolean;
  }): { send(message: ChannelMessageLike, address: string): Promise<SendResult> };
  renderTestMessage(input: {
    readonly recipientUserId: string;
    readonly locale: "en" | "ar";
    readonly linkUrl: string;
    readonly productName?: string;
  }): ChannelMessageLike;
}

const CONFIGURE: Permission = "notification_channel.configure";
const READ: Permission = "operations.read";
const JSON_BODY = ["application/json"] as const;

const LIST = "/api/v1/admin/notification-channels";
const ITEM = "/api/v1/admin/notification-channels/:channelKind";
const TEST = "/api/v1/admin/notification-channels/:channelKind/test";
const DELIVERIES = "/api/v1/admin/notification-deliveries"; // T-DG6-BE-I2

// ------------------------------------------------------------------------------------------------ schemas (the mirrors)

/** SecretRef (ADR-0052 §5), the contract's pattern. */
export const notificationSecretRef = z.strictObject({
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/),
});
export const notificationChannelKind = z.enum(CHANNEL_KINDS);
export const smtpSettingsView = z.strictObject({
  host: z.string().max(253),
  port: z.number().int().min(1).max(65535),
  security: z.enum(SMTP_SECURITY_MODES),
  usernameRef: notificationSecretRef.nullable(),
  passwordRef: notificationSecretRef.nullable(),
  fromAddress: z.string().max(254),
});
/** Response mirror of `NotificationChannel` (docs/api/openapi.yaml). */
export const notificationChannelView = z.strictObject({
  organizationId: uuid,
  channelKind: notificationChannelKind,
  configured: z.boolean(),
  enabled: z.boolean(),
  adapterAvailable: z.boolean(),
  smtp: smtpSettingsView.nullable(),
  reason: z.string().nullable(),
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});
export const notificationChannelPage = z.strictObject({
  items: z.array(notificationChannelView),
  nextCursor: z.string().nullable(),
});
export const notificationChannelTestResult = z.strictObject({
  outcome: z.enum(["sent", "failed"]),
  channelKind: notificationChannelKind,
  errorCode: z.string().nullable(),
  testedAt: z.string(),
});
export type NotificationChannelView = z.infer<typeof notificationChannelView>;

// T-DG6-BE-I2 (ADR-0054 §3): the deliveries list. Status, attempts, timestamps and the stable error code only: the
// message is never stored and the recipient's address is never returned.
export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export const NOTIFICATION_DELIVERY_SKIP_REASONS = [
  "no_address",
  "recipient_restricted",
  "channel_disabled",
  "recipient_disabled",
] as const;
/** Response mirror of `NotificationDelivery` (docs/api/openapi.yaml). */
export const notificationDeliveryView = z.strictObject({
  id: uuid,
  notificationId: uuid,
  channelKind: notificationChannelKind,
  status: z.enum(NOTIFICATION_DELIVERY_STATUSES),
  attempts: z.number().int().min(0).max(20),
  lastAttemptAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  skipReason: z.enum(NOTIFICATION_DELIVERY_SKIP_REASONS).nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int().min(1),
});
export const notificationDeliveryPage = z.strictObject({
  items: z.array(notificationDeliveryView),
  nextCursor: z.string().nullable(),
});
export type NotificationDeliveryView = z.infer<typeof notificationDeliveryView>;

/** The SMTP host and sender rules of 0102 (checked here so a malformed value is a 400, never a database error). */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const FROM = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

const smtpInput = z.strictObject({
  host: z.string().max(253).regex(HOST, "validation.smtp_host"),
  port: z.number().int().min(1).max(65535),
  security: z.enum(SMTP_SECURITY_MODES),
  // The reference shape is checked after parsing, so a secret value given in its place is the ADR-0054 §4 refusal.
  usernameRef: z.unknown(),
  passwordRef: z.unknown(),
  fromAddress: z.string().max(254).regex(FROM, "validation.email"),
});
export const notificationChannelUpdate = z.strictObject({
  enabled: z.boolean(),
  smtp: smtpInput.nullable(),
  // The contract's string (400 otherwise); the reason rule is the 422 admin.reason_required below.
  reason: z.string(),
});
const channelParams = z.strictObject({ channelKind: notificationChannelKind });
const orgQuery = z.strictObject({ organizationId: uuid });
const listQuery = z.strictObject({ organizationId: uuid, cursor: cursorSchema, limit: limitSchema });
const deliveriesQuery = z.strictObject({
  organizationId: uuid,
  status: z.enum(NOTIFICATION_DELIVERY_STATUSES).optional(),
  channelKind: notificationChannelKind.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const testBody = z.strictObject({ recipient: z.literal("self") });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0054 §4)

const rule = (code: string, detail: string, pointer?: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    ...(pointer === undefined ? {} : { errors: [{ pointer, code, message: detail }] }),
  });

/** The exact refusals of ADR-0054 §4 used by this file (codes are i18n keys under `problems.`). */
export const notificationChannelRefusals = {
  emailIncomplete: (pointer?: string) =>
    rule(
      "notification_channel.email_incomplete",
      "Email needs an SMTP host, a port, a security mode and a sender address.",
      pointer,
    ),
  adapterUnavailable: () =>
    rule(
      "notification_channel.adapter_unavailable",
      "No adapter is installed for this channel. In-app notifications continue to work.",
    ),
  insecureTransport: () =>
    rule("notification_channel.insecure_transport", "Unencrypted SMTP is not allowed in production.", "/smtp/security"),
  notConfigured: () =>
    rule("notification_channel.not_configured", "Configure and enable this channel before sending a test."),
  noRecipientAddress: () =>
    rule("notification_channel.no_recipient_address", "Your account has no email address to send the test to."),
  secretRefInvalid: (pointer: string) =>
    rule(
      "storage.secret_ref_invalid",
      "A credential must be a reference to a secret (provider and name), never the secret itself.",
      pointer,
    ),
  reasonRequired: () => rule("admin.reason_required", "Enter a reason of 3 to 1,000 characters.", "/reason"),
} as const;

// ------------------------------------------------------------------------------------------------ helpers

type ChannelRow = Selectable<NotificationChannelTable>;

function asRef(value: unknown): ChannelSecretRef | null {
  if (value === null || value === undefined) return null;
  return value as ChannelSecretRef;
}

function smtpOf(row: ChannelRow): SmtpSettings | null {
  if (row.smtp_host === null || row.smtp_port === null || row.smtp_security === null || row.from_address === null)
    return null;
  return {
    host: row.smtp_host,
    port: row.smtp_port,
    security: row.smtp_security as SmtpSettings["security"],
    usernameRef: asRef(row.smtp_username_ref),
    passwordRef: asRef(row.smtp_password_ref),
    fromAddress: row.from_address,
  };
}

/** The contract view; a kind never configured is version 0, disabled, with no settings ("Not configured"). */
export function toChannelView(
  organizationId: string,
  kind: ChannelKind,
  row: ChannelRow | undefined,
): NotificationChannelView {
  const smtp = row ? smtpOf(row) : null;
  return {
    organizationId,
    channelKind: kind,
    configured: row !== undefined,
    enabled: row?.enabled ?? false,
    adapterAvailable: adapterAvailable(kind),
    smtp,
    reason: row?.reason ?? null,
    version: row?.version ?? 0,
    updatedAt: row ? iso(row.updated_at) : null,
  };
}

async function loadRow(db: DbOrTx, organizationId: string, kind: ChannelKind, lock = false) {
  let q = db
    .selectFrom("notification_channel")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("channel_kind", "=", kind);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The organization target: 404 when it does not exist (the contract declares 404). */
async function organizationTarget(db: DbOrTx, principal: Principal, organizationId: string) {
  const target = await resolveTarget(db, { type: "organization", id: organizationId });
  if (!target) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  return target;
}

/** Reads: `notification_channel.configure` or `operations.read` at the organization (403 otherwise). */
async function requireRead(db: DbOrTx, principal: Principal, organizationId: string): Promise<void> {
  const target = await organizationTarget(db, principal, organizationId);
  if ((await authorize(db, principal, CONFIGURE, target)).allowed) return;
  await requireAction(db, principal, READ, target);
}

async function requireConfigure(db: DbOrTx, principal: Principal, organizationId: string): Promise<void> {
  const target = await organizationTarget(db, principal, organizationId);
  await requireAction(db, principal, CONFIGURE, target);
}

/** If-Match of a defaulted record: `"0"` names "never configured" (IfMatchOrZero). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

/** ETagOrZero: `"0"` for a kind never configured, else the row version. */
function sendChannel(reply: FastifyReply, view: NotificationChannelView) {
  reply.header("ETag", view.version >= 1 ? etag(view.version) : '"0"');
  return reply.code(200).send(view);
}

function versionConflict(current: ChannelRow | undefined): HttpProblem {
  if (current) return problems.versionConflict(current.version);
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

/** The validated settings of a PUT body (the ADR-0054 §4 business rules). */
export function checkedChannelUpdate(
  kind: ChannelKind,
  body: z.infer<typeof notificationChannelUpdate>,
  deps: { production: boolean; providers: readonly string[] },
): { enabled: boolean; smtp: SmtpSettings | null; reason: string } {
  // The shared reason rule (trimmed 3-1000 characters, not blank, no invalid character; §2 rule 1).
  const reason = reasonRule.safeParse(body.reason);
  if (!reason.success) throw notificationChannelRefusals.reasonRequired();
  if (kind === "enterprise_messaging") {
    if (body.enabled || body.smtp !== null) throw notificationChannelRefusals.adapterUnavailable();
    return { enabled: false, smtp: null, reason: reason.data };
  }
  if (body.smtp === null) {
    if (body.enabled) throw notificationChannelRefusals.emailIncomplete("/smtp");
    return { enabled: false, smtp: null, reason: reason.data };
  }
  const refs: (ChannelSecretRef | null)[] = [];
  const given = [
    ["usernameRef", body.smtp.usernameRef],
    ["passwordRef", body.smtp.passwordRef],
  ] as const;
  for (const [field, value] of given) {
    if (value === null) {
      refs.push(null);
      continue;
    }
    const ref = notificationSecretRef.safeParse(value);
    if (!ref.success || !deps.providers.includes(ref.data.provider))
      throw notificationChannelRefusals.secretRefInvalid(`/smtp/${field}`);
    refs.push(ref.data);
  }
  if ((refs[0] === null) !== (refs[1] === null))
    throw notificationChannelRefusals.emailIncomplete(refs[0] === null ? "/smtp/usernameRef" : "/smtp/passwordRef");
  if (body.smtp.security === "none" && deps.production) throw notificationChannelRefusals.insecureTransport();
  return {
    enabled: body.enabled,
    smtp: {
      host: body.smtp.host,
      port: body.smtp.port,
      security: body.smtp.security,
      usernameRef: refs[0]!,
      passwordRef: refs[1]!,
      fromAddress: body.smtp.fromAddress,
    },
    reason: reason.data,
  };
}

const refText = (r: ChannelSecretRef | null | undefined) => (r ? `${r.provider}:${r.name}` : null);

/** The audit `changes` of a PUT: each changed setting, before (null on create) and after. Never a secret value. */
function changesOf(before: ChannelRow | undefined, after: ChannelRow) {
  const pick = (r: ChannelRow | undefined) => ({
    enabled: r ? r.enabled : null,
    smtp_host: r?.smtp_host ?? null,
    smtp_port: r?.smtp_port ?? null,
    smtp_security: r?.smtp_security ?? null,
    // The two references as one field (provider:name, never a value); audit field names never name a password.
    smtp_credential_refs: r?.smtp_username_ref
      ? `${refText(asRef(r.smtp_username_ref))} ${refText(asRef(r.smtp_password_ref))}`
      : null,
    from_address: r?.from_address ?? null,
    reason: r?.reason ?? null,
  });
  const from = new Map<string, unknown>(Object.entries(pick(before)));
  return Object.fromEntries(
    Object.entries(pick(after))
      .filter(([k, to]) => before === undefined || from.get(k) !== to)
      .map(([k, to]) => [k, { from: from.get(k) ?? null, to }]),
  );
}

export interface NotificationChannelRouteOptions {
  /** The process's SecretProvider registry (server.ts creates it after the route lines; read at request time). */
  readonly secrets: () => SecretProviderRegistry;
  /** The email adapter and the test-message renderer of tasks/channels/** (ADR-0054 §3). */
  readonly channels: NotificationChannelPort;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerNotificationChannelRoutes(
  app: FastifyInstance,
  { db, config }: ModuleDeps,
  options: NotificationChannelRouteOptions,
): string[] {
  const production = config.nodeEnv === "production";
  const providers = () => options.secrets().ids();
  const branding = createBrandingReadPort({ primaryColour: "#0078FF", secondaryColour: "#003B73" });

  // listNotificationChannels: both kinds, configured or not, in the fixed order email, enterprise_messaging.
  app.get(LIST, { config: { access: { permission: CONFIGURE } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    await requireRead(db, principal, query.organizationId);
    const hash = filterHash({ organizationId: query.organizationId });
    const after = decodeCursor(query.cursor, hash, 1);
    const start = after ? CHANNEL_KINDS.indexOf(after[0] as ChannelKind) + 1 : 0;
    if (after && start === 0)
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );
    const rows = await db
      .selectFrom("notification_channel")
      .selectAll()
      .where("organization_id", "=", query.organizationId)
      .execute();
    const byKind = new Map(rows.map((r) => [r.channel_kind, r]));
    const views = CHANNEL_KINDS.slice(start)
      .slice(0, query.limit + 1)
      .map((kind) => toChannelView(query.organizationId, kind, byKind.get(kind)));
    return paginate(views, query.limit, (v) => [v.channelKind], hash);
  });

  // getNotificationChannel: ETag "0" when never configured.
  app.get(ITEM, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    const { channelKind } = parse(channelParams, request.params, "params");
    const { organizationId } = parseQuery(orgQuery, request.query);
    const principal = principalOf(request);
    await requireRead(db, principal, organizationId);
    return sendChannel(
      reply,
      toChannelView(organizationId, channelKind, await loadRow(db, organizationId, channelKind)),
    );
  });

  // putNotificationChannel: configure, enable or disable with a reason (IfMatchOrZero).
  app.put(ITEM, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { channelKind } = parse(channelParams, request.params, "params");
    const { organizationId } = parseQuery(orgQuery, request.query);
    const principal = principalOf(request);
    // Request-start gate (404/403), then validation and If-Match, then the commit-time re-check.
    await requireConfigure(db, principal, organizationId);
    const body = parseBody(notificationChannelUpdate, request.body);
    const update = checkedChannelUpdate(channelKind, body, { production, providers: providers() });
    const expected = ifMatchOrZero(request);
    const view = await db.transaction().execute(async (tx) => {
      const current = await loadRow(tx, organizationId, channelKind, true);
      const fresh = await refreshPrincipal(tx, request);
      try {
        await requireConfigure(tx, fresh, organizationId);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if ((current?.version ?? 0) !== expected) throw versionConflict(current);
      const me = fresh.userId!;
      const values = {
        enabled: update.enabled,
        smtp_host: update.smtp?.host ?? null,
        smtp_port: update.smtp?.port ?? null,
        smtp_security: update.smtp?.security ?? null,
        smtp_username_ref: update.smtp?.usernameRef ? JSON.stringify(update.smtp.usernameRef) : null,
        smtp_password_ref: update.smtp?.passwordRef ? JSON.stringify(update.smtp.passwordRef) : null,
        from_address: update.smtp?.fromAddress ?? null,
        reason: update.reason,
      };
      let row: ChannelRow | undefined;
      if (current) {
        row = await tx
          .updateTable("notification_channel")
          .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: me })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        row = await tx
          .insertInto("notification_channel")
          .values({
            id: uuidv7(),
            organization_id: organizationId,
            channel_kind: channelKind,
            ...values,
            created_by: me,
            updated_by: me,
          })
          .onConflict((oc) => oc.constraint("notification_channel_kind_key").doNothing())
          .returningAll()
          .executeTakeFirst();
        // A concurrent create of the same kind won: this request's "0" is stale.
        if (!row) throw versionConflict(await loadRow(tx, organizationId, channelKind));
      }
      await audit(tx, auditContextOf(request), {
        action: "notification_channel.changed",
        recordType: "notification_channel",
        recordId: row.id,
        organizationId,
        priorVersion: current?.version ?? null,
        newVersion: row.version,
        reason: update.reason,
        changes: { channel_kind: { from: current ? channelKind : null, to: channelKind }, ...changesOf(current, row) },
      });
      return toChannelView(organizationId, channelKind, row);
    });
    reply.header("ETag", etag(view.version));
    return reply.code(200).send(view);
  });

  // testNotificationChannel: one test message to the caller's own address, outside any transaction.
  app.post(TEST, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request) => {
    const { channelKind } = parse(channelParams, request.params, "params");
    const { organizationId } = parseQuery(orgQuery, request.query);
    const principal = principalOf(request);
    await requireConfigure(db, principal, organizationId);
    parseBody(testBody, request.body);
    const row = await loadRow(db, organizationId, channelKind);
    const smtp = row ? smtpOf(row) : null;
    if (!row || !row.enabled || channelKind !== "email" || smtp === null)
      throw notificationChannelRefusals.notConfigured();
    const me = await db
      .selectFrom("app_user")
      .select(["id", "email", "preferred_locale"])
      .where("id", "=", principal.userId!)
      .executeTakeFirst();
    const address = me?.email?.trim() ?? "";
    if (!me || address === "") throw notificationChannelRefusals.noRecipientAddress();
    const locale = me.preferred_locale === "ar" ? "ar" : "en";
    const brand = await branding.current(db, organizationId);
    const message = options.channels.renderTestMessage({
      recipientUserId: me.id,
      locale,
      linkUrl: config.appBaseUrl ? new URL("/", config.appBaseUrl).toString() : "/",
      productName: locale === "ar" ? brand.productNameAr : brand.productNameEn,
    });
    // Remote I/O: no transaction is open here.
    const secrets = options.secrets();
    const channel = options.channels.createEmailChannel({
      settings: smtp,
      resolveSecret: (ref) => secrets.resolve(ref),
      refuseInsecure: production,
    });
    const result = await channel.send(message, address);
    const testedAt = new Date();
    const outcome = result.ok ? ("sent" as const) : ("failed" as const);
    const errorCode = result.ok ? null : result.errorCode;
    await db.transaction().execute((tx) =>
      audit(tx, auditContextOf(request), {
        action: "notification_channel.tested",
        recordType: "notification_channel",
        recordId: row.id,
        organizationId,
        changes: { outcome: { from: null, to: outcome }, error_code: { from: null, to: errorCode } },
      }),
    );
    return { outcome, channelKind, errorCode, testedAt: testedAt.toISOString() };
  });

  // listNotificationDeliveries (T-DG6-BE-I2): newest first (UUIDv7 id descending), optional status and channel filters.
  app.get(DELIVERIES, { config: { access: { permission: CONFIGURE } } }, async (request) => {
    const query = parseQuery(deliveriesQuery, request.query);
    const principal = principalOf(request);
    await requireRead(db, principal, query.organizationId);
    const hash = filterHash({
      organizationId: query.organizationId,
      status: query.status,
      channelKind: query.channelKind,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    if (after && (typeof after[0] !== "string" || !uuid.safeParse(after[0]).success))
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );
    let q = db.selectFrom("notification_delivery").selectAll().where("organization_id", "=", query.organizationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.channelKind !== undefined) q = q.where("channel_kind", "=", query.channelKind);
    if (after) q = q.where("id", "<", after[0] as string);
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const views: NotificationDeliveryView[] = rows.map((r) => ({
      id: r.id,
      notificationId: r.inbox_notification_id,
      channelKind: r.channel_kind as ChannelKind,
      status: r.status as NotificationDeliveryView["status"],
      attempts: r.attempts,
      lastAttemptAt: r.last_attempt_at ? iso(r.last_attempt_at) : null,
      sentAt: r.sent_at ? iso(r.sent_at) : null,
      skipReason: r.skip_reason as NotificationDeliveryView["skipReason"],
      errorCode: r.error_code,
      createdAt: iso(r.created_at),
      version: r.version,
    }));
    return paginate(views, query.limit, (v) => [v.id], hash);
  });

  return [`GET ${LIST}`, `GET ${ITEM}`, `PUT ${ITEM}`, `POST ${TEST}`, `GET ${DELIVERIES}`];
}
