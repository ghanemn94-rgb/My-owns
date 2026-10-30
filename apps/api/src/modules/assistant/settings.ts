// Administration > AI assistant: the installation-wide assistant setting (ADR-0059 §3, §10; REQ-S17-009; T-DG6-BE-T).
//   GET  /api/v1/admin/assistant          getAssistantSetting   (assistant.configure or operations.read; AUD reads)
//   PUT  /api/v1/admin/assistant          putAssistantSetting   (IfMatchOrZero; "0" creates the row DISABLED)
//   POST /api/v1/admin/assistant/enable   enableAssistant       (If-Match; 404 when no row)
//   POST /api/v1/admin/assistant/disable  disableAssistant      (If-Match; 404 when no row)
// The rules:
//  - Disabled by default: 0111 seeds no row and NO ROW = OFF (configured false, enabled false, version 0, ETag "0").
//    A PUT never enables; enabling is its own audited transition, and it needs a provider and a company authorization
//    reference and, for http_endpoint, the endpoint, the API style and the model (422 assistant.enable_incomplete).
//  - While enabled, the provider, endpoint, API style, model, credential reference and authorization reference cannot
//    change (422 assistant.locked_while_enabled); the timeout and the limits can.
//  - NODE_ENV=production refuses the test adapter (422 assistant.test_adapter_not_allowed) and an http:// endpoint
//    (422 assistant.insecure_endpoint), on save and on enable.
//  - The credential is a SecretRef {provider, name}: anything else is 422 assistant.credential_ref_invalid, so no
//    secret value can be stored. The endpoint carries no user information, query or fragment (422
//    assistant.endpoint_invalid), so no key can travel in it.
//  - Authorization: assistant.configure (ADM_TECH) at the caller's organization configures; operations.read reads. A
//    write re-checks assistant.configure at commit time, inside the transaction, under the assistantSetting advisory lock and the row
//    lock (§2 rule 4). One audit event per version (assistant_setting.changed | .enabled | .disabled) with the prior and
//    new version, the changed field NAMES, the reason and the authorization reference; never a credential.
//  - The product records the authorization reference as entered; it does NOT verify it with IT. No task claims that
//    IT approved an endpoint. telemetryEnabled is the constant false: the installation has no telemetry client.
// Nothing here is a business approval (G1-G6), and nothing reads or writes DG0-DG7.
import { freeText, reason as reasonRule } from "@mth/shared/schemas";
import { sql, type DbOrTx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  ADVISORY_LOCK_CLASSES,
  canonicalJson,
  etag,
  HttpProblem,
  iso,
  isoOrNull,
  parseBody,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import type { AssistantSettingRow } from "./provider.ts";

export const CONFIGURE: Permission = "assistant.configure";
const READ: Permission = "operations.read";
const JSON_BODY = ["application/json"] as const;

const SETTING = "/api/v1/admin/assistant";
const ENABLE = "/api/v1/admin/assistant/enable";
const DISABLE = "/api/v1/admin/assistant/disable";

/** Defaults of 0111 (shown while no row exists). */
export const SETTING_DEFAULTS = { requestTimeoutMs: 30_000, maxOutputTokens: 1024, maxContextRecords: 8 } as const;

/** 0111 `assistant_setting_endpoint_url`: http(s), a host, an optional port and path; no user info, query, fragment. */
const ENDPOINT_URL = /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:[0-9]{1,5})?(\/[^?#\s]*)?$/;
/** SecretRef (ADR-0052 §5; 0102 `p6_secret_ref_valid`). */
const SECRET_PROVIDER = /^[a-z][a-z0-9_]{0,31}$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;

// ------------------------------------------------------------------------------------------------ schemas (mirrors)

const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const assistantSecretRef = z.strictObject({
  provider: z.string().regex(SECRET_PROVIDER),
  name: z.string().regex(SECRET_NAME),
});
export const assistantProviderKind = z.enum(["http_endpoint", "test_adapter"]);

/** Response mirror of `AssistantSetting` (docs/api/openapi.yaml). */
export const assistantSettingView = z.strictObject({
  configured: z.boolean(),
  enabled: z.boolean(),
  providerKind: assistantProviderKind.nullable(),
  endpointUrl: z.string().max(2048).nullable(),
  apiStyle: z.literal("openai_chat_completions").nullable(),
  modelName: z.string().max(200).nullable(),
  credentialRef: assistantSecretRef.nullable(),
  authorizationReference: z.string().max(200).nullable(),
  requestTimeoutMs: z.number().int().min(1000).max(120_000),
  maxOutputTokens: z.number().int().min(64).max(8192),
  maxContextRecords: z.number().int().min(1).max(20),
  enabledAt: z.string().nullable(),
  enabledBy: uuidString.nullable(),
  telemetryEnabled: z.literal(false),
  reason: z.string().nullable(),
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});
export type AssistantSettingView = z.infer<typeof assistantSettingView>;

/** Request body `AssistantSettingUpdate`. */
export const assistantSettingUpdate = z.strictObject({
  providerKind: assistantProviderKind.nullable(),
  // The URL and the credential reference are checked after parsing, so a malformed one is the ADR-0059 §10 refusal.
  endpointUrl: z.string().max(2048).nullable(),
  apiStyle: z.literal("openai_chat_completions").nullable(),
  modelName: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/)
    .nullable(),
  credentialRef: z.unknown(),
  authorizationReference: freeText(3, 200).nullable(),
  requestTimeoutMs: z.number().int().min(1000).max(120_000),
  maxOutputTokens: z.number().int().min(64).max(8192),
  maxContextRecords: z.number().int().min(1).max(20),
  // The contract's string (400 otherwise); the reason rule is the 422 admin.reason_required below.
  reason: z.string(),
});
export type AssistantSettingUpdate = z.infer<typeof assistantSettingUpdate>;
const toggleBody = z.strictObject({ reason: z.string() });

// ------------------------------------------------------------------------------------------------ refusals (§10)

const rule = (code: string, detail: string, pointer?: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    ...(pointer === undefined ? {} : { errors: [{ pointer, code, message: detail }] }),
  });

/** The exact refusals of ADR-0059 §10 used by the setting routes (codes are i18n keys under `problems.`). */
export const assistantSettingRefusals = {
  enableIncomplete: () =>
    rule(
      "assistant.enable_incomplete",
      "To turn the assistant on, enter the provider, the company authorization reference and, for an HTTP endpoint, the endpoint, the API style and the model.",
    ),
  lockedWhileEnabled: () =>
    rule(
      "assistant.locked_while_enabled",
      "Turn the assistant off before changing its provider, endpoint, API style, model, credential or authorization reference.",
    ),
  alreadyEnabled: () => rule("assistant.already_enabled", "The assistant is already on."),
  alreadyDisabled: () => rule("assistant.already_disabled", "The assistant is already off."),
  testAdapterNotAllowed: () =>
    rule("assistant.test_adapter_not_allowed", "The test adapter cannot be used in production.", "/providerKind"),
  insecureEndpoint: () =>
    rule("assistant.insecure_endpoint", "The model endpoint must use HTTPS in production.", "/endpointUrl"),
  endpointInvalid: () =>
    rule(
      "assistant.endpoint_invalid",
      "Enter the endpoint as an http or https address without a user name, password, query or fragment.",
      "/endpointUrl",
    ),
  credentialRefInvalid: () =>
    rule(
      "assistant.credential_ref_invalid",
      "A credential must be a reference to a secret (provider and name), never the secret itself.",
      "/credentialRef",
    ),
  /** Not in ADR-0059 §10 (the 0111 CHECK assistant_setting_test_adapter_shape); proposed in the BE-T handback. */
  testAdapterShape: () =>
    rule(
      "assistant.test_adapter_shape",
      "The test adapter takes no endpoint, API style or credential. Clear them, or choose the HTTP endpoint.",
      "/providerKind",
    ),
  reasonRequired: () => rule("admin.reason_required", "Enter a reason of 3 to 1,000 characters.", "/reason"),
} as const;

// ------------------------------------------------------------------------------------------------ helpers

function asRef(value: unknown): { provider: string; name: string } | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const { provider, name } = value as { provider?: unknown; name?: unknown };
  return typeof provider === "string" && typeof name === "string" ? { provider, name } : null;
}

/** The contract view; no row = "Off (not configured)": version 0, disabled, every field at its default. */
export function toSettingView(row: AssistantSettingRow | undefined): AssistantSettingView {
  if (row === undefined)
    return {
      configured: false,
      enabled: false,
      providerKind: null,
      endpointUrl: null,
      apiStyle: null,
      modelName: null,
      credentialRef: null,
      authorizationReference: null,
      ...SETTING_DEFAULTS,
      enabledAt: null,
      enabledBy: null,
      telemetryEnabled: false,
      reason: null,
      version: 0,
      updatedAt: null,
    };
  return {
    configured: true,
    enabled: row.enabled,
    providerKind: (row.provider_kind as AssistantSettingView["providerKind"]) ?? null,
    endpointUrl: row.endpoint_url,
    apiStyle: row.api_style === "openai_chat_completions" ? "openai_chat_completions" : null,
    modelName: row.model_name,
    credentialRef: asRef(row.credential_ref),
    authorizationReference: row.authorization_reference,
    requestTimeoutMs: row.request_timeout_ms,
    maxOutputTokens: row.max_output_tokens,
    maxContextRecords: row.max_context_records,
    enabledAt: isoOrNull(row.enabled_at),
    enabledBy: row.enabled_by,
    telemetryEnabled: false,
    reason: row.reason,
    version: row.version,
    updatedAt: iso(row.updated_at),
  };
}

/** The (at most one) setting row; `lock` takes the row lock. */
export async function loadSetting(db: DbOrTx, lock = false): Promise<AssistantSettingRow | undefined> {
  let q = db.selectFrom("assistant_setting").selectAll().where("singleton", "=", true);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The caller's organization as the authorization target (the setting is installation-wide; grants are per org). */
async function organizationTarget(db: DbOrTx, principal: Principal) {
  const target =
    principal.organizationId === null
      ? undefined
      : await resolveTarget(db, { type: "organization", id: principal.organizationId });
  if (!target) {
    principal.tracker.decisions += 1;
    throw problems.forbidden();
  }
  return target;
}

/** Reads: assistant.configure or operations.read at the caller's organization (403 otherwise). */
async function requireRead(db: DbOrTx, principal: Principal): Promise<void> {
  const target = await organizationTarget(db, principal);
  if ((await authorize(db, principal, CONFIGURE, target)).allowed) return;
  await requireAction(db, principal, READ, target);
}

async function requireConfigure(db: DbOrTx, principal: Principal): Promise<void> {
  await requireAction(db, principal, CONFIGURE, await organizationTarget(db, principal));
}

/** If-Match of a defaulted record: `"0"` names "not configured" (IfMatchOrZero). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function sendSetting(reply: FastifyReply, view: AssistantSettingView) {
  reply.header("ETag", view.version >= 1 ? etag(view.version) : '"0"');
  return reply.code(200).send(view);
}

function versionConflict(current: AssistantSettingRow | undefined): HttpProblem {
  if (current) return problems.versionConflict(current.version);
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

function checkedReason(value: string): string {
  const parsed = reasonRule.safeParse(value);
  if (!parsed.success) throw assistantSettingRefusals.reasonRequired();
  return parsed.data;
}

/** The validated values of a PUT body (ADR-0059 §3, §10). Pure: tested directly. */
export function checkedSettingUpdate(
  body: AssistantSettingUpdate,
  deps: { production: boolean },
): {
  provider_kind: string | null;
  endpoint_url: string | null;
  api_style: string | null;
  model_name: string | null;
  credential_ref: { provider: string; name: string } | null;
  authorization_reference: string | null;
  request_timeout_ms: number;
  max_output_tokens: number;
  max_context_records: number;
  reason: string;
} {
  const reason = checkedReason(body.reason);
  let credentialRef: { provider: string; name: string } | null = null;
  if (body.credentialRef !== null && body.credentialRef !== undefined) {
    const ref = assistantSecretRef.safeParse(body.credentialRef);
    if (!ref.success) throw assistantSettingRefusals.credentialRefInvalid();
    credentialRef = ref.data;
  }
  if (body.endpointUrl !== null && !ENDPOINT_URL.test(body.endpointUrl))
    throw assistantSettingRefusals.endpointInvalid();
  if (deps.production && body.providerKind === "test_adapter") throw assistantSettingRefusals.testAdapterNotAllowed();
  if (deps.production && body.endpointUrl !== null && body.endpointUrl.toLowerCase().startsWith("http://"))
    throw assistantSettingRefusals.insecureEndpoint();
  if (
    body.providerKind === "test_adapter" &&
    (body.endpointUrl !== null || body.apiStyle !== null || credentialRef !== null)
  )
    throw assistantSettingRefusals.testAdapterShape();
  return {
    provider_kind: body.providerKind,
    endpoint_url: body.endpointUrl,
    api_style: body.apiStyle,
    model_name: body.modelName,
    credential_ref: credentialRef,
    authorization_reference: body.authorizationReference,
    request_timeout_ms: body.requestTimeoutMs,
    max_output_tokens: body.maxOutputTokens,
    max_context_records: body.maxContextRecords,
    reason,
  };
}

/** The values of the setting columns a PUT writes (explicit members: no computed key, ADR-0002 module check). */
interface SettingValues {
  readonly provider_kind: string | null;
  readonly endpoint_url: string | null;
  readonly api_style: string | null;
  readonly model_name: string | null;
  readonly credential_ref: unknown;
  readonly authorization_reference: string | null;
  readonly request_timeout_ms: number;
  readonly max_output_tokens: number;
  readonly max_context_records: number;
}

/** The values that cannot change while enabled (0111 assistant_setting_guard), in a fixed order. */
const lockedValues = (v: SettingValues): unknown[] => [
  v.provider_kind,
  v.endpoint_url,
  v.api_style,
  v.model_name,
  v.credential_ref,
  v.authorization_reference,
];

/** The audited fields as [contract name, value] (never a value of the credential: the reference is a name only). */
const auditedValues = (v: SettingValues): [string, unknown][] => [
  ["providerKind", v.provider_kind],
  ["endpointUrl", v.endpoint_url],
  ["apiStyle", v.api_style],
  ["modelName", v.model_name],
  ["credentialRef", v.credential_ref],
  ["authorizationReference", v.authorization_reference],
  ["requestTimeoutMs", v.request_timeout_ms],
  ["maxOutputTokens", v.max_output_tokens],
  ["maxContextRecords", v.max_context_records],
];

/** Value equality that ignores object key order (jsonb returns keys sorted). */
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Whether `row` is complete enough to enable (0111 assistant_setting_enable_complete). */
export function enableComplete(row: AssistantSettingRow): boolean {
  if (row.provider_kind === null || row.authorization_reference === null) return false;
  if (row.provider_kind === "test_adapter") return true;
  return row.endpoint_url !== null && row.api_style !== null && row.model_name !== null;
}

/** Why `row` cannot be enabled now, or null (ADR-0059 §3: completeness, then the production refusals). Pure. */
export function enableRefusal(row: AssistantSettingRow, deps: { production: boolean }): HttpProblem | null {
  if (!enableComplete(row)) return assistantSettingRefusals.enableIncomplete();
  if (deps.production && row.provider_kind === "test_adapter") return assistantSettingRefusals.testAdapterNotAllowed();
  if (deps.production && row.endpoint_url?.toLowerCase().startsWith("http://"))
    return assistantSettingRefusals.insecureEndpoint();
  return null;
}

/** Takes the class-wide setting lock (ADR-0016 §6: ADVISORY_LOCK_CLASSES.assistantSetting, key "assistant"). */
async function lockSetting(tx: DbOrTx): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.assistantSetting}::int4, hashtext(${"assistant"}::text))`.execute(
    tx,
  );
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers the setting routes and returns them as "METHOD /path". */
export function registerAssistantSettingRoutes(app: FastifyInstance, { db, config }: ModuleDeps): string[] {
  const production = config.nodeEnv === "production";

  // getAssistantSetting: no row = Off (not configured), ETag "0".
  app.get(SETTING, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    await requireRead(db, principalOf(request));
    return sendSetting(reply, toSettingView(await loadSetting(db)));
  });

  // putAssistantSetting: save (never enables); "0" creates the row disabled.
  app.put(SETTING, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const principal = principalOf(request);
    await requireConfigure(db, principal);
    const body = parseBody(assistantSettingUpdate, request.body);
    const update = checkedSettingUpdate(body, { production });
    const expected = ifMatchOrZero(request);
    const view = await db.transaction().execute(async (tx) => {
      await lockSetting(tx);
      const current = await loadSetting(tx, true);
      const fresh = await refreshPrincipal(tx, request);
      try {
        await requireConfigure(tx, fresh);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if ((current?.version ?? 0) !== expected) throw versionConflict(current);
      if (current?.enabled && !same(lockedValues(current), lockedValues(update)))
        throw assistantSettingRefusals.lockedWhileEnabled();
      const me = fresh.userId!;
      const values = {
        ...update,
        credential_ref: update.credential_ref === null ? null : JSON.stringify(update.credential_ref),
      };
      let row: AssistantSettingRow | undefined;
      if (current) {
        row = await tx
          .updateTable("assistant_setting")
          .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: me })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirst();
        if (!row) throw versionConflict(await loadSetting(tx));
      } else {
        row = await tx
          .insertInto("assistant_setting")
          .values({ id: uuidv7(), enabled: false, ...values, created_by: me, updated_by: me })
          .onConflict((oc) => oc.constraint("assistant_setting_singleton_key").doNothing())
          .returningAll()
          .executeTakeFirst();
        // A concurrent create won: this request's "0" is stale.
        if (!row) throw versionConflict(await loadSetting(tx));
      }
      // Runtime-keyed lookups go through a Map (F-DG1-124).
      const prior = new Map(current === undefined ? [] : auditedValues(current));
      const changed = auditedValues(row)
        .filter(([name, to]) => current === undefined || !same(prior.get(name), to))
        .map(([name]) => name);
      await audit(tx, auditContextOf(request), {
        action: "assistant_setting.changed",
        recordType: "assistant_setting",
        recordId: row.id,
        organizationId: fresh.organizationId,
        priorVersion: current?.version ?? null,
        newVersion: row.version,
        reason: update.reason,
        changes: {
          changed_fields: { from: null, to: changed },
          authorization_reference: {
            from: current?.authorization_reference ?? null,
            to: row.authorization_reference,
          },
        },
      });
      return toSettingView(row);
    });
    reply.header("ETag", etag(view.version));
    return reply.code(200).send(view);
  });

  // enableAssistant / disableAssistant: the two transitions of the state machine (disabled <-> enabled).
  const toggle = (to: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = principalOf(request);
    await requireConfigure(db, principal);
    const { reason: given } = parseBody(toggleBody, request.body);
    const reason = checkedReason(given);
    const expected = requireIfMatch(request);
    const view = await db.transaction().execute(async (tx) => {
      await lockSetting(tx);
      const current = await loadSetting(tx, true);
      const fresh = await refreshPrincipal(tx, request);
      try {
        await requireConfigure(tx, fresh);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (to && current.enabled) throw assistantSettingRefusals.alreadyEnabled();
      if (!to && !current.enabled) throw assistantSettingRefusals.alreadyDisabled();
      if (to) {
        const refusal = enableRefusal(current, { production });
        if (refusal !== null) throw refusal;
      }
      const me = fresh.userId!;
      const row = await tx
        .updateTable("assistant_setting")
        .set({
          enabled: to,
          enabled_at: to ? sql<Date>`now()` : null,
          enabled_by: to ? me : null,
          reason,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: me,
        })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(tx, auditContextOf(request), {
        action: to ? "assistant_setting.enabled" : "assistant_setting.disabled",
        recordType: "assistant_setting",
        recordId: row.id,
        organizationId: fresh.organizationId,
        priorVersion: current.version,
        newVersion: row.version,
        reason,
        changes: {
          enabled: { from: current.enabled, to: row.enabled },
          provider_kind: { from: current.provider_kind, to: row.provider_kind },
          authorization_reference: { from: current.authorization_reference, to: row.authorization_reference },
        },
      });
      return toSettingView(row);
    });
    reply.header("ETag", etag(view.version));
    return reply.code(200).send(view);
  };
  app.post(ENABLE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, toggle(true));
  app.post(DISABLE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, toggle(false));

  return [`GET ${SETTING}`, `PUT ${SETTING}`, `POST ${ENABLE}`, `POST ${DISABLE}`];
}
