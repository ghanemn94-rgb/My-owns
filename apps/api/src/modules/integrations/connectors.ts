// Connectors and their append-only configuration versions, field mappings and the connector service identity
// (ADR-0055 §1, §2, §4, §9; ADR-0053 §1; REQ-S17-001; T-DG6-BE-L). The routes are in routes.ts (connector block).
//
// Authorization (0107; permissions matrix §26; ADR-0055 §9):
//   - read (`connector.read`): an ORGANIZATION-level holder sees every connector of its organization; a holder at a
//     transformation sees, read-only, the connectors whose CURRENT configuration targets that transformation (the
//     ReadScope rule of ADR-0051 §1). An unreadable connector answers 404 (existence is not disclosed).
//   - configure (`connector.configure`, ADM_TECH by default): create, put, mappings, enable, disable and test, at the
//     organization level only. A reader without it gets 403 (AUD, KDS, TD, TO). A configure code, never a business-
//     approval or Finance-validation code: configuring a connector approves nothing (G1-G6) and never touches DG0-DG7.
// Every mutation: validation (400, then the 422 refusals of ADR-0055 §9 before any write), If-Match (428/409) except
// the create and the test, the row lock, authorization re-checked at commit on the reloaded grants, one audit event
// per changed record with prior and new version, and no remote I/O inside a transaction: the SecretProvider (whether
// each credential resolves) and the adapter (the test run) are called between short transactions.
//
// Derived, never stored: `verification` (verified iff a run with trigger `test` succeeded on the CURRENT configuration
// version), `lastSuccessAt` (the newest succeeded run; null = never succeeded, shown "Never succeeded"), `lastRun`, and
// `actionableError` (the newest failed run after the last success, with its why/what-to-do code and the form and
// import fallbacks; REQ-S17-005). A connector is never labelled "live" or "connected to Mobily" (p6-plan R3).
import { sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { name as nameRule, reason as reasonRule, uuid } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import type { ConnectorConfigVersionTable, ConnectorTable, IntegrationRunTable } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  readScopeFor,
  refreshPrincipal,
  type Principal,
} from "../access/index.ts";
import { record as audit } from "../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, isoOrNull, problems } from "../platform/index.ts";
import {
  CONNECTOR_ADAPTER_KINDS,
  CONNECTOR_ERROR_CODES,
  CONNECTOR_ERROR_WHY,
  ConnectorAdapterError,
  connectorAdapters,
  type ConnectorAdapterConfig,
  type ConnectorAdapterKind,
  type ConnectorErrorCode,
  type ConnectorFetchResult,
} from "./adapters/port.ts";
import { checkCredentialRefs, credentialRefViews, resolveCredentials, type CredentialRefView } from "./secret-refs.ts";

export const CONNECTOR_READ: Permission = "connector.read";
export const CONNECTOR_CONFIGURE: Permission = "connector.configure";

export type ConnectorRow = Selectable<ConnectorTable>;
export type ConnectorConfigRow = Selectable<ConnectorConfigVersionTable>;
export type IntegrationRunRow = Selectable<IntegrationRunTable>;

export const CONNECTOR_TARGET_KINDS = ["kpi_actual", "none"] as const;
export type ConnectorTargetKind = (typeof CONNECTOR_TARGET_KINDS)[number];
const CADENCES = ["manual", "hourly", "daily", "weekly"] as const;
const COMMIT_MODES = ["manual", "auto"] as const;
const RECONCILIATION_RULES = ["none", "row_count", "row_count_and_total"] as const;
const TEST_ADAPTER_MODES = ["healthy", "failing", "stopped"] as const;
const TEST_ADAPTER_CONFIRM = ["immediate", "never"] as const;
/** A key named like a secret (the 0104 CHECK p6_settings_without_secret_keys, applied here at every depth). */
const SECRET_LIKE_KEY = /(secret|password|passwd|token|apikey|api_key|credential)/;
const MAX_ADAPTER_SETTINGS_BYTES = 4096;
/** The 0104 CHECK on endpoint_url: https, a host part without userinfo or whitespace. */
const ENDPOINT_URL = /^https:\/\/[^/?#@\s]+/;
/** How long a test run waits for its adapter before it fails with connector.source_unavailable. */
const ADAPTER_TIMEOUT_MS = 30_000;

// ------------------------------------------------------------------------------------------------ request bodies

const sourceSystemId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);

/** ConnectorConfigInput. Credentials, mappings and settings are checked by the business rules below (422s). */
export const connectorConfigInput = z.strictObject({
  sourceSystemId,
  endpointUrl: z
    .string()
    .max(500)
    .regex(/^https:\/\//)
    .nullable(),
  credentialRefs: z.record(z.string(), z.unknown()),
  fieldMappings: z.array(z.unknown()).max(100),
  targetTransformationId: uuid.nullable(),
  cadence: z.enum(CADENCES),
  retryMaxAttempts: z.number().int().min(0).max(5),
  retryBackoffSeconds: z.number().int().min(10).max(3600),
  commitMode: z.enum(COMMIT_MODES),
  commitOnBehalfOf: uuid.nullable(),
  outboundActions: z
    .array(z.enum(["deliverable_status_push"]))
    .max(1)
    .refine((a) => new Set(a).size === a.length, { message: "Each action may appear once." }),
  reconciliationRule: z.enum(RECONCILIATION_RULES),
  adapterSettings: z.record(z.string(), z.unknown()),
  reason: reasonRule,
});
export type ConnectorConfigInput = z.infer<typeof connectorConfigInput>;

export const connectorCreate = z.strictObject({
  organizationId: uuid,
  code: z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  nameEn: nameRule,
  nameAr: nameRule,
  adapterKind: z.enum(CONNECTOR_ADAPTER_KINDS),
  targetKind: z.enum(CONNECTOR_TARGET_KINDS),
  config: connectorConfigInput,
});
export const connectorUpdate = z.strictObject({
  nameEn: nameRule,
  nameAr: nameRule,
  config: connectorConfigInput.nullable(),
});
export const connectorEnable = z.strictObject({ reason: reasonRule.nullable() });
export const connectorDisable = z.strictObject({ reason: reasonRule });
export const connectorTestRequest = z.strictObject({});
export const connectorMappingsUpdate = z.strictObject({
  fieldMappings: z.array(z.unknown()).max(100),
  reason: reasonRule,
});

// ------------------------------------------------------------------------------------------------ refusals

const rule422 = (code: string, detail: string, pointer: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

const conflict409 = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.invalidTransition, code, title: "Conflict", detail });

/** The refusals of ADR-0055 §9 (English verbatim; codes are i18n keys under `problems.`). */
export const connectorRefusals = {
  codeTaken: () =>
    problems.duplicate("connector.code_taken", "A connector with this code already exists in this organization."),
  secretValueRefused: (pointer = "/config/credentialRefs") =>
    rule422(
      "connector.secret_value_refused",
      "Credentials are stored only as references to a secret that IT holds. Enter a secret reference, not the secret itself.",
      pointer,
    ),
  mappingsInvalid: (pointer = "/config/fieldMappings") =>
    rule422(
      "connector.mappings_invalid",
      "The field mappings are invalid: name each target field once, and give every source column a name.",
      pointer,
    ),
  adapterSettingsInvalid: (pointer = "/config/adapterSettings") =>
    rule422("connector.adapter_settings_invalid", "These settings do not fit this connector type.", pointer),
  targetInvalid: (pointer = "/config/targetTransformationId") =>
    rule422("connector.target_invalid", "Choose a transformation of this organization as the import target.", pointer),
  runActive: () =>
    conflict409("connector.run_active", "A run of this connector is already queued or running. Wait for it to finish."),
  /**
   * Not in ADR-0055 §9 (proposed in the T-DG6-BE-L handback): a test needs a pull adapter of the connector's kind in
   * this process; a `webhook` connector has none (its data is pushed), and none is registered before BE-L2.
   */
  adapterUnavailable: () =>
    rule422(
      "connector.adapter_unavailable",
      "This connector type cannot be tested here: no adapter of this type is available.",
      "",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ business checks

export interface FieldMapping {
  readonly source: string;
  readonly target: string;
}

/** Field mappings (ADR-0055 §1; the 0104 CHECK p6_field_mappings_valid): `{source, target}`, each target once. */
export function checkFieldMappings(input: readonly unknown[], pointer = "/config/fieldMappings"): FieldMapping[] {
  const out: FieldMapping[] = [];
  const targets = new Set<string>();
  for (const [i, m] of input.entries()) {
    const ok =
      m !== null &&
      typeof m === "object" &&
      !Array.isArray(m) &&
      Object.keys(m).sort().join(",") === "source,target" &&
      typeof (m as FieldMapping).source === "string" &&
      typeof (m as FieldMapping).target === "string";
    if (!ok) throw connectorRefusals.mappingsInvalid(`${pointer}/${i}`);
    const { source, target } = m as FieldMapping;
    const sourceLength = Array.from(source).length;
    if (sourceLength < 1 || sourceLength > 100 || source.trim() === "" || /[\u0000\p{Cs}]/u.test(source))
      throw connectorRefusals.mappingsInvalid(`${pointer}/${i}/source`);
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(target) || targets.has(target))
      throw connectorRefusals.mappingsInvalid(`${pointer}/${i}/target`);
    targets.add(target);
    out.push({ source, target });
  }
  return out;
}

/** Any key named like a secret, at any depth of the settings. */
function secretLikeKeyPath(value: unknown, path: string): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = secretLikeKeyPath(v, `${path}/${i}`);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_LIKE_KEY.test(k.toLowerCase())) return `${path}/${k}`;
    const hit = secretLikeKeyPath(v, `${path}/${k}`);
    if (hit !== null) return hit;
  }
  return null;
}

/** The byte length of PostgreSQL's jsonb text output (`{"a": 1, "b": [1, 2]}`), which the 0104 CHECK measures. */
export function jsonbTextBytes(value: unknown): number {
  const text = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (Array.isArray(v)) return `[${v.map(text).join(", ")}]`;
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${JSON.stringify(k)}: ${text(x)}`)
      .join(", ")}}`;
  };
  return Buffer.byteLength(text(value), "utf8");
}

/** An endpoint URL that carries a credential (userinfo, or a query parameter named like a secret). */
function urlCarriesSecret(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username !== "" || u.password !== "") return true;
    for (const key of u.searchParams.keys()) if (SECRET_LIKE_KEY.test(key.toLowerCase())) return true;
    return false;
  } catch {
    return /@/.test(url.split(/[/?#]/, 3).slice(0, 3).join("/"));
  }
}

export interface CheckedConfig {
  readonly sourceSystemId: string;
  readonly endpointUrl: string | null;
  readonly credentialRefs: Record<string, { provider: string; name: string }>;
  readonly fieldMappings: FieldMapping[];
  readonly targetTransformationId: string | null;
  readonly cadence: string;
  readonly retryMaxAttempts: number;
  readonly retryBackoffSeconds: number;
  readonly commitMode: string;
  readonly commitOnBehalfOf: string | null;
  readonly outboundActions: string[];
  readonly reconciliationRule: string;
  readonly adapterSettings: Record<string, unknown>;
  readonly reason: string;
}

/**
 * The business rules of a configuration for a connector of `adapterKind`/`targetKind` in `organizationId` (ADR-0055
 * §1; the 0104 trigger connector_config_version_guard re-checks them in the transaction). Order: credentials (a value
 * is refused first), settings, adapter shape, mappings, target, commit mode.
 */
export async function checkConfig(
  db: DbOrTx,
  organizationId: string,
  adapterKind: ConnectorAdapterKind,
  targetKind: ConnectorTargetKind,
  input: ConnectorConfigInput,
): Promise<CheckedConfig> {
  const credentials = checkCredentialRefs(input.credentialRefs);
  if (!credentials.ok) {
    if (credentials.problem.kind === "value")
      throw connectorRefusals.secretValueRefused(`/config/credentialRefs/${credentials.problem.key}`);
    throw problems.validation([
      {
        pointer: "/config/credentialRefs",
        code: "validation.credential_refs",
        message: "Name at most 8 secret references, each {provider, name}.",
      },
    ]);
  }
  const secretKey = secretLikeKeyPath(input.adapterSettings, "/config/adapterSettings");
  if (secretKey !== null) throw connectorRefusals.secretValueRefused(secretKey);
  if (input.endpointUrl !== null && urlCarriesSecret(input.endpointUrl))
    throw connectorRefusals.secretValueRefused("/config/endpointUrl");
  if (jsonbTextBytes(input.adapterSettings) > MAX_ADAPTER_SETTINGS_BYTES)
    throw connectorRefusals.adapterSettingsInvalid();
  if (adapterKind === "test_adapter") {
    const { mode, confirm } = input.adapterSettings;
    if (typeof mode !== "string" || !(TEST_ADAPTER_MODES as readonly string[]).includes(mode))
      throw connectorRefusals.adapterSettingsInvalid("/config/adapterSettings/mode");
    if (confirm !== undefined && !(TEST_ADAPTER_CONFIRM as readonly unknown[]).includes(confirm))
      throw connectorRefusals.adapterSettingsInvalid("/config/adapterSettings/confirm");
  }
  if ((adapterKind === "http_pull") !== (input.endpointUrl !== null))
    throw connectorRefusals.adapterSettingsInvalid("/config/endpointUrl");
  if (input.endpointUrl !== null && !ENDPOINT_URL.test(input.endpointUrl))
    throw connectorRefusals.adapterSettingsInvalid("/config/endpointUrl");
  if (adapterKind !== "test_adapter" && input.outboundActions.length > 0)
    throw connectorRefusals.adapterSettingsInvalid("/config/outboundActions");
  const fieldMappings = checkFieldMappings(input.fieldMappings);
  if ((targetKind === "kpi_actual") !== (input.targetTransformationId !== null))
    throw connectorRefusals.targetInvalid();
  if (targetKind === "none" && (input.commitMode !== "manual" || fieldMappings.length > 0))
    throw connectorRefusals.targetInvalid(
      input.commitMode !== "manual" ? "/config/commitMode" : "/config/fieldMappings",
    );
  if (input.targetTransformationId !== null) {
    const t = await db
      .selectFrom("transformation")
      .select("id")
      .where("id", "=", input.targetTransformationId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
    if (!t) throw connectorRefusals.targetInvalid();
  }
  if ((input.commitMode === "auto") !== (input.commitOnBehalfOf !== null))
    throw problems.validation([
      {
        pointer: "/config/commitOnBehalfOf",
        code: "validation.commit_on_behalf_of",
        message: "Name the user an automatic commit acts on behalf of, exactly when the commit mode is automatic.",
      },
    ]);
  if (input.commitOnBehalfOf !== null) {
    const u = await db
      .selectFrom("app_user")
      .select("id")
      .where("id", "=", input.commitOnBehalfOf)
      .where("organization_id", "=", organizationId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!u)
      throw problems.validation([
        {
          pointer: "/config/commitOnBehalfOf",
          code: "validation.commit_on_behalf_of",
          message: "Choose an active user of this organization.",
        },
      ]);
  }
  return {
    sourceSystemId: input.sourceSystemId,
    endpointUrl: input.endpointUrl,
    credentialRefs: credentials.refs,
    fieldMappings,
    targetTransformationId: input.targetTransformationId,
    cadence: input.cadence,
    retryMaxAttempts: input.retryMaxAttempts,
    retryBackoffSeconds: input.retryBackoffSeconds,
    commitMode: input.commitMode,
    commitOnBehalfOf: input.commitOnBehalfOf,
    outboundActions: [...input.outboundActions],
    reconciliationRule: input.reconciliationRule,
    adapterSettings: input.adapterSettings,
    reason: input.reason,
  };
}

/** A stored configuration as the input of a new version (putConnectorMappings keeps everything but the mappings). */
function configOfRow(c: ConnectorConfigRow): CheckedConfig {
  return {
    sourceSystemId: c.source_system_id,
    endpointUrl: c.endpoint_url,
    credentialRefs: c.credential_refs as Record<string, { provider: string; name: string }>,
    fieldMappings: c.field_mappings as FieldMapping[],
    targetTransformationId: c.target_transformation_id,
    cadence: c.cadence,
    retryMaxAttempts: c.retry_max_attempts,
    retryBackoffSeconds: c.retry_backoff_seconds,
    commitMode: c.commit_mode,
    commitOnBehalfOf: c.commit_on_behalf_of,
    outboundActions: [...c.outbound_actions],
    reconciliationRule: c.reconciliation_rule,
    adapterSettings: c.adapter_settings as Record<string, unknown>,
    reason: c.reason,
  };
}

// ------------------------------------------------------------------------------------------------ loading

export async function findConnector(db: DbOrTx, id: string, lock = false): Promise<ConnectorRow | undefined> {
  let q = db.selectFrom("connector").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function currentConfig(db: DbOrTx, row: ConnectorRow): Promise<ConnectorConfigRow> {
  return db
    .selectFrom("connector_config_version")
    .selectAll()
    .where("connector_id", "=", row.id)
    .where("version_no", "=", row.config_version_no)
    .executeTakeFirstOrThrow();
}

async function holdsAtOrganization(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  organizationId: string,
): Promise<boolean> {
  return (await authorize(db, principal, permission, { type: "organization", id: organizationId })).allowed;
}

/** May the principal read the connector (organization level, or the current configuration's target transformation)? */
async function mayRead(db: DbOrTx, principal: Principal, row: ConnectorRow): Promise<boolean> {
  if (await holdsAtOrganization(db, principal, CONNECTOR_READ, row.organization_id)) return true;
  const target = (await currentConfig(db, row)).target_transformation_id;
  if (target === null) return false;
  return (await authorize(db, principal, CONNECTOR_READ, { type: "transformation", id: target })).allowed;
}

/** The connector if the principal may read it; 404 otherwise (missing and unreadable are indistinguishable). */
export async function visibleConnector(db: DbOrTx, principal: Principal, id: string): Promise<ConnectorRow> {
  const row = await findConnector(db, id);
  if (!row) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  if (!(await mayRead(db, principal, row))) throw problems.notFound();
  return row;
}

/** The read gate (404) and the configure gate (403) of a change, before the transaction. */
export async function requireConnectorChange(db: DbOrTx, principal: Principal, id: string): Promise<ConnectorRow> {
  const row = await visibleConnector(db, principal, id);
  if (!(await holdsAtOrganization(db, principal, CONNECTOR_CONFIGURE, row.organization_id))) throw problems.forbidden();
  return row;
}

/** The commit-time re-check on the reloaded grants (a right lost meanwhile is 403, F-DG2-440). */
async function recheckConfigure(tx: Tx, request: FastifyRequest, row: ConnectorRow): Promise<Principal> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    if (!(await mayRead(tx, fresh, row))) throw problems.notFound();
    if (!(await holdsAtOrganization(tx, fresh, CONNECTOR_CONFIGURE, row.organization_id))) throw problems.forbidden();
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  return fresh;
}

/** Locks the connector row and checks the caller's version (409) after the commit-time re-check. */
async function lockForChange(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
): Promise<{ locked: ConnectorRow; me: string }> {
  const locked = await findConnector(tx, id, true);
  if (!locked) throw problems.notFound();
  const fresh = await recheckConfigure(tx, request, locked);
  if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
  return { locked, me: fresh.userId! };
}

// ------------------------------------------------------------------------------------------------ views

/** The contract's IntegrationRun. Counts not known yet are null ("Unknown"), never 0. */
export interface IntegrationRunBody {
  readonly id: string;
  readonly connectorId: string;
  readonly configVersionNo: number;
  readonly triggerKind: string;
  readonly status: string;
  readonly attemptNo: number;
  readonly retryOfRunId: string | null;
  readonly idempotencyKey: string;
  readonly requestedBy: string | null;
  readonly serviceIdentityId: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly rowsRead: number | null;
  readonly rowsStaged: number | null;
  readonly rowsCommitted: number | null;
  readonly rowsRejected: number | null;
  readonly rowsDuplicate: number | null;
  readonly errorCount: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly reconciliation: {
    readonly status: string;
    readonly sourceRowCount: number | null;
    readonly sourceControlTotal: string | null;
    readonly stagedControlTotal: string | null;
  };
  readonly importBatchId: string | null;
  readonly version: number;
}

/** A numeric(24,6) as the contract's Decimal: trailing fractional zeros dropped ("10.500000" -> "10.5"). */
export function decimalText(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function toIntegrationRun(r: IntegrationRunRow): IntegrationRunBody {
  return {
    id: r.id,
    connectorId: r.connector_id,
    configVersionNo: r.config_version_no,
    triggerKind: r.trigger_kind,
    status: r.status,
    attemptNo: r.attempt_no,
    retryOfRunId: r.retry_of_run_id,
    idempotencyKey: r.idempotency_key,
    requestedBy: r.requested_by,
    serviceIdentityId: r.service_identity_id,
    queuedAt: iso(r.queued_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
    rowsRead: r.rows_read,
    rowsStaged: r.rows_staged,
    rowsCommitted: r.rows_committed,
    rowsRejected: r.rows_rejected,
    rowsDuplicate: r.rows_duplicate,
    errorCount: r.error_count,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    reconciliation: {
      status: r.reconciliation_status,
      sourceRowCount: r.source_row_count,
      sourceControlTotal: decimalText(r.source_control_total),
      stagedControlTotal: decimalText(r.staged_control_total),
    },
    importBatchId: r.import_batch_id,
    version: r.version,
  };
}

export interface ConnectorActionableError {
  readonly runId: string;
  readonly triggerKind: string;
  readonly attemptNo: number;
  readonly finishedAt: string;
  readonly errorCode: ConnectorErrorCode;
  readonly params: Record<string, string>;
  readonly fallbacks: ("kpi_form" | "import_file")[];
}

export interface ConnectorConfigBody {
  readonly versionNo: number;
  readonly sourceSystemId: string;
  readonly endpointUrl: string | null;
  readonly credentialRefs: Record<string, CredentialRefView>;
  readonly fieldMappings: FieldMapping[];
  readonly targetTransformationId: string | null;
  readonly cadence: string;
  readonly retryMaxAttempts: number;
  readonly retryBackoffSeconds: number;
  readonly commitMode: string;
  readonly commitOnBehalfOf: string | null;
  readonly outboundActions: string[];
  readonly reconciliationRule: string;
  readonly adapterSettings: Record<string, unknown>;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ConnectorBody {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly adapterKind: string;
  readonly targetKind: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly config: ConnectorConfigBody;
  readonly verification: "verified" | "not_verified";
  readonly lastSuccessAt: string | null;
  readonly lastRun: IntegrationRunBody | null;
  readonly actionableError: ConnectorActionableError | null;
  readonly serviceIdentityId: string;
  readonly version: number;
  readonly updatedAt: string;
}

/** The facts derived from the runs (read in one statement set; never stored on the connector). */
interface RunFacts {
  readonly verified: boolean;
  readonly lastSuccessAt: Date | null;
  readonly lastRun: IntegrationRunRow | null;
  readonly lastFailure: IntegrationRunRow | null;
}

async function runFacts(db: DbOrTx, row: ConnectorRow): Promise<RunFacts> {
  const [verified, lastSuccess, lastRun] = await Promise.all([
    db
      .selectFrom("integration_run")
      .select("id")
      .where("connector_id", "=", row.id)
      .where("trigger_kind", "=", "test")
      .where("status", "=", "succeeded")
      .where("config_version_no", "=", row.config_version_no)
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("integration_run")
      .select("finished_at")
      .where("connector_id", "=", row.id)
      .where("status", "=", "succeeded")
      .orderBy("finished_at", "desc")
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("integration_run")
      .selectAll()
      .where("connector_id", "=", row.id)
      .orderBy("queued_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);
  const lastSuccessAt = lastSuccess?.finished_at ?? null;
  let failure = db
    .selectFrom("integration_run")
    .selectAll()
    .where("connector_id", "=", row.id)
    .where("status", "=", "failed")
    .where("error_code", "in", [...CONNECTOR_ERROR_CODES]);
  if (lastSuccessAt !== null) failure = failure.where("finished_at", ">", lastSuccessAt);
  const lastFailure = await failure.orderBy("finished_at", "desc").orderBy("id", "desc").limit(1).executeTakeFirst();
  return {
    verified: verified !== undefined,
    lastSuccessAt,
    lastRun: lastRun ?? null,
    lastFailure: lastFailure ?? null,
  };
}

/** The message parameters of an error code's texts, from the run and the configuration it used. */
function errorParams(run: IntegrationRunRow): Record<string, string> {
  const m = /\{(name|column)=([^}]{1,200})\}/g;
  return Object.fromEntries([...(run.error_message ?? "").matchAll(m)].map((hit) => [hit[1]!, hit[2]!]));
}

/** The connector view. Calls the SecretProvider (resolvable), so it runs outside any transaction. */
export async function toConnector(db: DbOrTx, row: ConnectorRow): Promise<ConnectorBody> {
  const [config, facts, identity] = await Promise.all([
    currentConfig(db, row),
    runFacts(db, row),
    db
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", row.id)
      .where("subject_kind", "=", "connector")
      .executeTakeFirstOrThrow(),
  ]);
  const failure = facts.lastFailure;
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    adapterKind: row.adapter_kind,
    targetKind: row.target_kind,
    status: row.status,
    statusReason: row.status_reason,
    config: {
      versionNo: config.version_no,
      sourceSystemId: config.source_system_id,
      endpointUrl: config.endpoint_url,
      credentialRefs: await credentialRefViews(config.credential_refs),
      fieldMappings: config.field_mappings as FieldMapping[],
      targetTransformationId: config.target_transformation_id,
      cadence: config.cadence,
      retryMaxAttempts: config.retry_max_attempts,
      retryBackoffSeconds: config.retry_backoff_seconds,
      commitMode: config.commit_mode,
      commitOnBehalfOf: config.commit_on_behalf_of,
      outboundActions: [...config.outbound_actions],
      reconciliationRule: config.reconciliation_rule,
      adapterSettings: config.adapter_settings as Record<string, unknown>,
      reason: config.reason,
      createdAt: iso(config.created_at),
      createdBy: config.created_by,
    },
    verification: facts.verified ? "verified" : "not_verified",
    lastSuccessAt: isoOrNull(facts.lastSuccessAt),
    lastRun: facts.lastRun ? toIntegrationRun(facts.lastRun) : null,
    actionableError:
      failure === null || failure.finished_at === null
        ? null
        : {
            runId: failure.id,
            triggerKind: failure.trigger_kind,
            attemptNo: failure.attempt_no,
            finishedAt: iso(failure.finished_at),
            errorCode: failure.error_code as ConnectorErrorCode,
            params: errorParams(failure),
            fallbacks: row.target_kind === "kpi_actual" ? ["kpi_form", "import_file"] : [],
          },
    serviceIdentityId: identity.id,
    version: row.version,
    updatedAt: iso(row.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ list

export interface ConnectorListQuery {
  readonly organizationId: string;
  readonly status?: "disabled" | "enabled";
  /** Exclusive lower bound (code, id) of the page (decoded cursor). */
  readonly after: readonly [string, string] | null;
  readonly limit: number;
}

/**
 * The connectors of an organization the principal may read, by code. 404 for an unknown organization; 403 when the
 * caller holds `connector.read` nowhere in it.
 */
export async function listConnectors(
  db: DbOrTx,
  principal: Principal,
  query: ConnectorListQuery,
): Promise<ConnectorRow[]> {
  const decision = await authorize(db, principal, CONNECTOR_READ, { type: "organization", id: query.organizationId });
  if (!decision.target) throw problems.notFound();
  const orgWide = decision.allowed;
  if (
    !orgWide &&
    !principal.grants.some((g) => g.organizationId === query.organizationId && g.permissions.has(CONNECTOR_READ))
  )
    throw problems.forbidden();
  const scope = orgWide ? null : await readScopeFor(db, principal, CONNECTOR_READ);
  let q = db
    .selectFrom("connector as c")
    .innerJoin("connector_config_version as v", (j) =>
      j.onRef("v.connector_id", "=", "c.id").onRef("v.version_no", "=", "c.config_version_no"),
    )
    .selectAll("c")
    .where("c.organization_id", "=", query.organizationId);
  if (scope !== null)
    q = q.where("v.target_transformation_id", "is not", null).where(
      scope.predicate({
        recordType: null,
        recordId: sql<string>`c.id`,
        organizationId: sql<string>`c.organization_id`,
        transformationId: sql<string | null>`v.target_transformation_id`,
      }),
    );
  if (query.status) q = q.where("c.status", "=", query.status);
  if (query.after) q = q.where(sql<boolean>`(c.code, c.id) > (${query.after[0]}, ${query.after[1]}::uuid)`);
  return q
    .orderBy("c.code")
    .orderBy("c.id")
    .limit(query.limit + 1)
    .execute();
}

// ------------------------------------------------------------------------------------------------ mutations

function configValues(config: CheckedConfig) {
  return {
    source_system_id: config.sourceSystemId,
    endpoint_url: config.endpointUrl,
    credential_refs: JSON.stringify(config.credentialRefs),
    field_mappings: JSON.stringify(config.fieldMappings),
    target_transformation_id: config.targetTransformationId,
    cadence: config.cadence,
    retry_max_attempts: config.retryMaxAttempts,
    retry_backoff_seconds: config.retryBackoffSeconds,
    commit_mode: config.commitMode,
    commit_on_behalf_of: config.commitOnBehalfOf,
    outbound_actions: config.outboundActions,
    reconciliation_rule: config.reconciliationRule,
    adapter_settings: JSON.stringify(config.adapterSettings),
    reason: config.reason,
  };
}

/** The audit diff of a configuration version: references by name only, never a value (there is none to record). */
function configAuditChanges(config: CheckedConfig) {
  return {
    source_system_id: { from: null, to: config.sourceSystemId },
    endpoint_url: { from: null, to: config.endpointUrl },
    credential_refs: { from: null, to: config.credentialRefs },
    field_mappings: { from: null, to: config.fieldMappings },
    target_transformation_id: { from: null, to: config.targetTransformationId },
    cadence: { from: null, to: config.cadence },
    commit_mode: { from: null, to: config.commitMode },
    outbound_actions: { from: null, to: config.outboundActions },
    reconciliation_rule: { from: null, to: config.reconciliationRule },
  };
}

async function insertConfigVersion(
  tx: Tx,
  request: FastifyRequest,
  connector: Pick<ConnectorRow, "id" | "organization_id">,
  versionNo: number,
  config: CheckedConfig,
  me: string,
): Promise<void> {
  const id = uuidv7();
  await tx
    .insertInto("connector_config_version")
    .values({
      id,
      organization_id: connector.organization_id,
      connector_id: connector.id,
      version_no: versionNo,
      ...configValues(config),
      created_by: me,
    })
    .execute();
  await audit(tx, auditContextOf(request), {
    action: "connector_config_version.created",
    recordType: "connector_config_version",
    recordId: id,
    organizationId: connector.organization_id,
    newVersion: versionNo,
    reason: config.reason,
    changes: { connector_id: { from: null, to: connector.id }, ...configAuditChanges(config) },
  });
}

export interface CreateConnectorInput {
  readonly organizationId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly adapterKind: ConnectorAdapterKind;
  readonly targetKind: ConnectorTargetKind;
  readonly config: CheckedConfig;
}

/** The configure gate of a create, before the transaction: 404 unknown organization, 403 without the right. */
export async function requireCreate(db: DbOrTx, principal: Principal, organizationId: string): Promise<void> {
  const decision = await authorize(db, principal, CONNECTOR_CONFIGURE, { type: "organization", id: organizationId });
  if (!decision.target) throw problems.notFound();
  if (!decision.allowed) throw problems.forbidden();
}

/**
 * createConnector (ADR-0055 §1): in ONE transaction, the connector (disabled, configuration version 1), its version-1
 * configuration and its service identity (ADR-0053 §1: code `connector:<id>`, organization scope, declared = granted =
 * ['transformation.read']), each with its audit event. 409 connector.code_taken comes from the unique key.
 */
export async function createConnector(
  tx: Tx,
  request: FastifyRequest,
  input: CreateConnectorInput,
): Promise<ConnectorRow> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireCreate(tx, fresh, input.organizationId);
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  const me = fresh.userId!;
  const id = uuidv7();
  const ctx = auditContextOf(request);
  const row = await tx
    .insertInto("connector")
    .values({
      id,
      organization_id: input.organizationId,
      code: input.code,
      name_en: input.nameEn,
      name_ar: input.nameAr,
      adapter_kind: input.adapterKind,
      target_kind: input.targetKind,
      config_version_no: 1,
      created_by: me,
      updated_by: me,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: "connector.created",
    recordType: "connector",
    recordId: id,
    organizationId: input.organizationId,
    newVersion: 1,
    reason: input.config.reason,
    changes: {
      code: { from: null, to: input.code },
      name_en: { from: null, to: input.nameEn },
      name_ar: { from: null, to: input.nameAr },
      adapter_kind: { from: null, to: input.adapterKind },
      target_kind: { from: null, to: input.targetKind },
      status: { from: null, to: "disabled" },
      config_version_no: { from: null, to: 1 },
    },
  });
  await insertConfigVersion(tx, request, row, 1, input.config, me);
  const identityId = uuidv7();
  const identityReason = `The service identity of connector ${input.code}, created with it (ADR-0053 §1, ADR-0055 §1).`;
  await tx
    .insertInto("service_identity")
    .values({
      id: identityId,
      code: `connector:${id}`,
      subject_kind: "connector",
      queue_name: null,
      connector_id: id,
      scope_level: "organization",
      organization_id: input.organizationId,
      declared_permission_codes: ["transformation.read"],
      granted_permission_codes: ["transformation.read"],
      label_en: `Connector ${input.code}`,
      label_ar: `الموصل ${input.code}`,
      reason: identityReason,
      created_by: me,
      updated_by: me,
    })
    .execute();
  await audit(tx, ctx, {
    action: "service_identity.created",
    recordType: "service_identity",
    recordId: identityId,
    organizationId: input.organizationId,
    newVersion: 1,
    reason: identityReason,
    changes: {
      code: { from: null, to: `connector:${id}` },
      connector_id: { from: null, to: id },
      declared_permission_codes: { from: null, to: ["transformation.read"] },
      granted_permission_codes: { from: null, to: ["transformation.read"] },
    },
  });
  return row;
}

/**
 * putConnector: the names, and with a configuration a new configuration version the connector moves to. The caller
 * checked the configuration (checkConfig) before the transaction; the 0104 trigger re-checks it here.
 */
export async function putConnector(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  input: { readonly nameEn: string; readonly nameAr: string; readonly config: CheckedConfig | null },
): Promise<ConnectorRow> {
  const { locked, me } = await lockForChange(tx, request, id, expectedVersion);
  const nextConfig = input.config === null ? locked.config_version_no : locked.config_version_no + 1;
  if (input.config !== null) await insertConfigVersion(tx, request, locked, nextConfig, input.config, me);
  const updated = await tx
    .updateTable("connector")
    .set({
      name_en: input.nameEn,
      name_ar: input.nameAr,
      config_version_no: nextConfig,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "connector.updated",
    recordType: "connector",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    reason: input.config?.reason ?? null,
    changes: {
      name_en: { from: locked.name_en, to: updated.name_en },
      name_ar: { from: locked.name_ar, to: updated.name_ar },
      config_version_no: { from: locked.config_version_no, to: updated.config_version_no },
    },
  });
  return updated;
}

/** putConnectorMappings: a new configuration version equal to the current one but for the mappings and its reason. */
export async function putConnectorMappings(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  input: { readonly fieldMappings: FieldMapping[]; readonly reason: string },
): Promise<ConnectorRow> {
  const { locked, me } = await lockForChange(tx, request, id, expectedVersion);
  if (locked.target_kind === "none" && input.fieldMappings.length > 0)
    throw connectorRefusals.targetInvalid("/fieldMappings");
  const current = await currentConfig(tx, locked);
  const next = { ...configOfRow(current), fieldMappings: input.fieldMappings, reason: input.reason };
  await insertConfigVersion(tx, request, locked, locked.config_version_no + 1, next, me);
  const updated = await tx
    .updateTable("connector")
    .set({
      config_version_no: locked.config_version_no + 1,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "connector.mappings_changed",
    recordType: "connector",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    reason: input.reason,
    changes: {
      config_version_no: { from: locked.config_version_no, to: updated.config_version_no },
      field_mappings: { from: current.field_mappings, to: input.fieldMappings },
    },
  });
  return updated;
}

/**
 * enableConnector / disableConnector (ADR-0055 §1 status machine: disabled <-> enabled, no delete). Enabling verifies
 * nothing. Disabling needs a reason and cancels the connector's queued runs (each with its audit event) under the
 * connector-run advisory lock (connectorRun); a running run finishes on its own. Native forms and imports never read this status.
 */
export async function setConnectorStatus(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  to: "enabled" | "disabled",
  reason: string | null,
): Promise<ConnectorRow> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.connectorRun}::int4, hashtext(${id}::text))`.execute(
    tx,
  );
  const { locked, me } = await lockForChange(tx, request, id, expectedVersion);
  if (locked.status === to)
    throw problems.invalidTransition(
      to === "enabled" ? "Only a disabled connector can be enabled." : "Only an enabled connector can be disabled.",
    );
  const ctx = auditContextOf(request);
  if (to === "disabled") {
    const queued = await tx
      .selectFrom("integration_run")
      .selectAll()
      .where("connector_id", "=", id)
      .where("status", "=", "queued")
      .forUpdate()
      .execute();
    for (const run of queued) {
      const cancelled = await tx
        .updateTable("integration_run")
        .set({ status: "cancelled", version: run.version + 1, updated_at: sql<Date>`now()`, updated_by: me })
        .where("id", "=", run.id)
        .where("version", "=", run.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(tx, ctx, {
        action: "integration_run.cancelled",
        recordType: "integration_run",
        recordId: run.id,
        organizationId: locked.organization_id,
        priorVersion: run.version,
        newVersion: cancelled.version,
        reason,
        changes: { status: { from: "queued", to: "cancelled" } },
      });
    }
  }
  const updated = await tx
    .updateTable("connector")
    .set({
      status: to,
      status_reason: reason,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: to === "enabled" ? "connector.enabled" : "connector.disabled",
    recordType: "connector",
    recordId: id,
    organizationId: locked.organization_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    reason,
    changes: {
      status: { from: locked.status, to },
      status_reason: { from: locked.status_reason, to: reason },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ test run

/** The adapter's view of a configuration version (never a credential value). */
export function adapterConfigOf(row: ConnectorRow, config: ConnectorConfigRow): ConnectorAdapterConfig {
  return {
    connectorId: row.id,
    organizationId: row.organization_id,
    adapterKind: row.adapter_kind as ConnectorAdapterKind,
    configVersionNo: config.version_no,
    sourceSystemId: config.source_system_id,
    endpointUrl: config.endpoint_url,
    fieldMappings: config.field_mappings as FieldMapping[],
    adapterSettings: config.adapter_settings as Record<string, unknown>,
  };
}

/** The outcome of one adapter fetch, classified for the run record. */
type FetchOutcome =
  | { readonly ok: true; readonly result: ConnectorFetchResult }
  | { readonly ok: false; readonly code: ConnectorErrorCode; readonly params: Readonly<Record<string, string>> };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorAdapterError("connector.source_unavailable")), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the credentials and calls the adapter's fetch, OUTSIDE any transaction, then checks what came back: every
 * cell a string (else connector.response_invalid), every mapped source column present in every row (else
 * connector.mapping_mismatch naming the column). A thrown value that is not a ConnectorAdapterError is
 * connector.source_unavailable; its message is never stored.
 */
async function fetchForTest(row: ConnectorRow, config: ConnectorConfigRow): Promise<FetchOutcome> {
  const adapter = connectorAdapters().get(row.adapter_kind as ConnectorAdapterKind);
  if (!adapter) return { ok: false, code: "connector.source_unavailable", params: {} };
  try {
    const credentials = await resolveCredentials(config.credential_refs);
    const result = await withTimeout(
      adapter.fetch(adapterConfigOf(row, config), { credentials, since: null }),
      ADAPTER_TIMEOUT_MS,
    );
    const rows = Array.isArray(result?.rows) ? result.rows : null;
    const countOk =
      result?.sourceRowCount === null ||
      (Number.isSafeInteger(result?.sourceRowCount) && (result?.sourceRowCount ?? -1) >= 0);
    if (rows === null || !countOk) return { ok: false, code: "connector.response_invalid", params: {} };
    for (const r of rows)
      if (r === null || typeof r !== "object" || Object.values(r).some((cell) => typeof cell !== "string"))
        return { ok: false, code: "connector.response_invalid", params: {} };
    for (const m of config.field_mappings as FieldMapping[])
      if (rows.some((r) => !Object.hasOwn(r, m.source)))
        return { ok: false, code: "connector.mapping_mismatch", params: { column: m.source } };
    return { ok: true, result };
  } catch (err) {
    if (err instanceof ConnectorAdapterError) return { ok: false, code: err.code, params: err.params };
    return { ok: false, code: "connector.source_unavailable", params: {} };
  }
}

const ERROR_WHY: ReadonlyMap<string, string> = new Map(Object.entries(CONNECTOR_ERROR_WHY));

/** The stored (redacted by construction) message of a failed run: the code's "why" text and its parameters. */
function failureMessage(code: ConnectorErrorCode, params: Readonly<Record<string, string>>): string {
  const byName = new Map(Object.entries(params));
  const why = (ERROR_WHY.get(code) ?? code).replace(/\{(name|column)\}/g, (_, k: string) => byName.get(k) ?? k);
  const tail = Object.entries(params)
    .filter(([k]) => k === "name" || k === "column")
    .map(([k, v]) => ` {${k}=${v.replace(/[{}]/g, "")}}`)
    .join("");
  return `${why}${tail}`.slice(0, 2000);
}

/**
 * testConnector (ADR-0055 §1-§3): a run with trigger `test` of the CURRENT configuration, nothing staged or committed.
 *   transaction 1 (the connectorRun lock; commit-time re-check): insert `queued`, then `running` (one active run per
 *     connector: 409 connector.run_active from integration_run_one_active);
 *   outside any transaction: resolve the credentials and call the adapter's fetch;
 *   transaction 2 (the connectorRun lock): `succeeded` with the counts (rows read; nothing staged, rejected or duplicated, as a
 *     test stages nothing) and the row-count reconciliation, or `failed` with its error code.
 * A succeeded test makes the connector `verified` for this configuration version. A failed test is not retried and
 * raises no operational exception (the scheduled runs of BE-L2 do both).
 */
export async function testConnector(db: Db, request: FastifyRequest, connectorId: string): Promise<IntegrationRunRow> {
  const lock = (tx: Tx) =>
    sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.connectorRun}::int4, hashtext(${connectorId}::text))`.execute(
      tx,
    );
  const started = await db.transaction().execute(async (tx) => {
    await lock(tx);
    const locked = await findConnector(tx, connectorId, true);
    if (!locked) throw problems.notFound();
    const fresh = await recheckConfigure(tx, request, locked);
    const me = fresh.userId!;
    const identity = await tx
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", connectorId)
      .where("subject_kind", "=", "connector")
      .executeTakeFirstOrThrow();
    const id = uuidv7();
    const ctx = auditContextOf(request);
    await tx
      .insertInto("integration_run")
      .values({
        id,
        organization_id: locked.organization_id,
        connector_id: connectorId,
        config_version_no: locked.config_version_no,
        trigger_kind: "test",
        idempotency_key: `test:${id}`,
        requested_by: me,
        service_identity_id: identity.id,
        queued_at: sql<Date>`now()`,
        created_by: me,
        updated_by: me,
      })
      .execute();
    await audit(tx, ctx, {
      action: "integration_run.queued",
      recordType: "integration_run",
      recordId: id,
      organizationId: locked.organization_id,
      newVersion: 1,
      changes: {
        connector_id: { from: null, to: connectorId },
        trigger_kind: { from: null, to: "test" },
        config_version_no: { from: null, to: locked.config_version_no },
        status: { from: null, to: "queued" },
      },
    });
    const running = await tx
      .updateTable("integration_run")
      .set({
        status: "running",
        started_at: sql<Date>`now()`,
        version: 2,
        updated_at: sql<Date>`now()`,
        updated_by: me,
      })
      .where("id", "=", id)
      .where("version", "=", 1)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: "integration_run.started",
      recordType: "integration_run",
      recordId: id,
      organizationId: locked.organization_id,
      priorVersion: 1,
      newVersion: 2,
      changes: { status: { from: "queued", to: "running" } },
    });
    return { run: running, connector: locked, config: await currentConfig(tx, locked), me };
  });

  const outcome = await fetchForTest(started.connector, started.config);

  return db.transaction().execute(async (tx) => {
    await lock(tx);
    const run = await tx
      .selectFrom("integration_run")
      .selectAll()
      .where("id", "=", started.run.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const ctx = auditContextOf(request);
    let values: Partial<Omit<IntegrationRunRow, "id">>;
    if (outcome.ok) {
      const read = outcome.result.rows.length;
      const sourceRowCount = outcome.result.sourceRowCount;
      const rule = started.config.reconciliation_rule;
      // A test stages nothing, so a control total is never compared here: row_count_and_total is checked on its row
      // count only when the counts differ (mismatched); with equal counts it stays "not checked" (never "matched").
      const reconciliation =
        rule === "none"
          ? { status: "not_applicable", sourceRowCount: null }
          : sourceRowCount === null
            ? { status: "not_checked", sourceRowCount: null }
            : sourceRowCount !== read
              ? { status: "mismatched", sourceRowCount }
              : rule === "row_count"
                ? { status: "matched", sourceRowCount }
                : { status: "not_checked", sourceRowCount: null };
      values = {
        status: "succeeded",
        rows_read: read,
        rows_staged: 0,
        rows_rejected: 0,
        rows_duplicate: 0,
        error_count: 0,
        reconciliation_status: reconciliation.status,
        source_row_count: reconciliation.sourceRowCount,
      };
    } else {
      values = {
        status: "failed",
        error_code: outcome.code,
        error_message: failureMessage(outcome.code, outcome.params),
      };
    }
    const finished = await tx
      .updateTable("integration_run")
      .set({
        ...values,
        finished_at: sql<Date>`now()`,
        version: run.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: started.me,
      })
      .where("id", "=", run.id)
      .where("version", "=", run.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: outcome.ok ? "integration_run.succeeded" : "integration_run.failed",
      recordType: "integration_run",
      recordId: run.id,
      organizationId: run.organization_id,
      priorVersion: run.version,
      newVersion: finished.version,
      changes: {
        status: { from: run.status, to: finished.status },
        rows_read: { from: null, to: finished.rows_read },
        error_code: { from: null, to: finished.error_code },
        reconciliation_status: { from: run.reconciliation_status, to: finished.reconciliation_status },
      },
    });
    return finished;
  });
}

/** Is a pull adapter of the connector's kind available in this process (the test's precondition)? */
export function testAdapterAvailable(row: ConnectorRow): boolean {
  return (
    row.adapter_kind !== "webhook" && connectorAdapters().get(row.adapter_kind as ConnectorAdapterKind) !== undefined
  );
}

// ------------------------------------------------------------------------------------------------ mappings view

/** A target column of the connector's import target (the contract's ImportTemplateColumn). */
export interface TargetColumn {
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly required: boolean;
  readonly kind: "text" | "uuid" | "decimal" | "date" | "boolean" | "enum";
  readonly example: string | null;
}

/**
 * The columns a connector of a target kind can map to: the import template of its target (ADR-0056 §9). The import
 * target registry (BE-M, integrations/imports/targets.ts; KBE-A registers kpi_actual.v1) supplies them through this
 * port at composition; until a target is registered the list is empty (no column is invented here).
 */
let targetColumnsSource: (targetKind: string) => readonly TargetColumn[] = () => [];

export function setConnectorTargetColumnsSource(
  source: (targetKind: string) => readonly TargetColumn[],
): (targetKind: string) => readonly TargetColumn[] {
  const previous = targetColumnsSource;
  targetColumnsSource = source;
  return previous;
}

export async function toConnectorMappings(db: DbOrTx, row: ConnectorRow) {
  const config = await currentConfig(db, row);
  return {
    connectorId: row.id,
    configVersionNo: config.version_no,
    fieldMappings: config.field_mappings as FieldMapping[],
    targetColumns: row.target_kind === "none" ? [] : [...targetColumnsSource(row.target_kind)],
  };
}
