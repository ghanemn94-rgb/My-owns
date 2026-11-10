// P6 web seams (T-DG6-FE-A; p6-plan §5.1 row FE-A and §5.3; p6-work-split §E/F.12 and §J/C.13).
//
//  1. `p6Keys`: the query keys of the slice E, F, J and C screens (Administration > Audit, Security, Sensitive grants,
//     Operations, Service identities, Identity, Storage, Notifications; the record sensitivity panel; the deep-link
//     landing), added up front so FE-B only adds hooks in its own `pages/<feature>/api.ts` and never edits `api/**`
//     (a missing key goes into its handback; the orchestrator merges it append-only). Every key starts with ["p6", ...]:
//     the organization-scoped administration reads with ["p6", "admin", <area>, ...], the record sensitivity of one
//     transformation with ["p6", "sensitivity", tid, ...], so `useP6AdminRefresh(area)` and `useP6SensitivityRefresh(tid)`
//     refresh exactly what a mutation can change. The later P6 slices (A, B, D, G, H, I, K) add their own blocks here
//     when their contracts exist (D-195; p6-plan §5.3).
//  2. `p6Paths`: the request path of each of the 30 slice E, F, J and C operations of docs/api/openapi.yaml 1.5.0-p6
//     (ADR-0051 to ADR-0054; tags access, tasks, evidence, security, audit, operations, platform-admin), operationId in
//     the comment. `P6_SLICE_EFJC_OPERATIONS` lists them for the contract-parity test.
//  3. The read hooks of the GET operations. Writes are sent by the screens with `api.send` (If-Match from the record's
//     `version`; `IfMatchOrZero` "0" creates the defaulted row of putRecordSensitivity, putUploadPolicy,
//     putStorageSetting and putNotificationChannel), inside a session guard (auth/sessionBound.ts).
//
// Typing: the zod mirrors of these bodies are stubs at this revision (packages/shared/src/schemas/{sensitivity,
// deep-links,uploads,security,audit-events}.ts, filled by BE-B…BE-E; the J/C mirrors by BE-G…BE-K). Until they exist the
// hooks take the body type as a parameter (default `unknown`), so a screen never assumes a shape the contract has not
// fixed. The one exception is `DeepLinkResolution` (three fields, needed by the shell's deep-link guard below), written
// from the contract. The OpenAPI file is the source of truth.
//
// Unknown is data, never a default: a heartbeat without a beat is `unknown`, a KPI without a value is null, and neither
// is turned into "alive", 0 or green here (ADR-0053 §6, §10; p6-work-split §2 rule 5).
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getSessionGeneration } from "./client.ts";
import { fetchAllPages, shouldRetry } from "./queries.ts";

/** A cursor page of the P6 list operations (the shared `Page` shape: items and nextCursor). */
export interface P6Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** A query-string record; empty values are left out by the caller. */
export type P6Query = Record<string, string>;

/** The record types that can be sensitive (ADR-0051 §2; D-195 Q3). A closed set: another type needs a migration. */
export const SENSITIVE_RECORD_TYPES = ["benefit", "business_case", "evidence"] as const;
export type SensitiveRecordType = (typeof SENSITIVE_RECORD_TYPES)[number];

/** The upload allow-list (ADR-0052 §1; D-195 Q4). Only png, jpeg and gif are ever previewed inline; svg never. */
export const UPLOAD_TYPES = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];
export const INLINE_PREVIEW_TYPES: readonly UploadType[] = ["png", "jpeg", "gif"];

/** The notification channels (ADR-0054 §3). In-app is always on and is not a channel row. */
export const NOTIFICATION_CHANNEL_KINDS = ["email", "enterprise_messaging"] as const;
export type NotificationChannelKind = (typeof NOTIFICATION_CHANNEL_KINDS)[number];

/** `resolveDeepLink` 200 (docs/api/openapi.yaml `DeepLinkResolution`; ADR-0051 §3). */
export interface DeepLinkResolution {
  readonly linkPath: string;
  readonly recordType: string | null;
  readonly recordId: string | null;
}

/** The contract's deep-link token format: 43 base64url characters (32 random bytes; ADR-0051 §3). */
export const DEEP_LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The in-app path a resolved deep link may navigate to, or null. The contract allows only a path of this app
 * (`^/[^/\\]`, at most 500 characters): never a protocol-relative "//host", a backslash form, a scheme, or a control
 * character, so a tampered response can never send the user to another site.
 */
export function safeInternalPath(linkPath: unknown): string | null {
  if (typeof linkPath !== "string" || linkPath.length < 2 || linkPath.length > 500) return null;
  if (!/^\/[^/\\]/.test(linkPath)) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(linkPath)) return null;
  return linkPath;
}

// ------------------------------------------------------------------------------------------------ query keys

/** The organization-scoped administration areas of slices E, F, J and C; FE-B uses one per screen. */
export const P6_ADMIN_AREAS = [
  // slice E (ADR-0051)
  "sensitive-grants",
  // slice F (ADR-0052)
  "upload-policy",
  "security",
  "audit",
  // slice J (ADR-0053)
  "operations",
  "service-identities",
  // slice C (ADR-0054)
  "identity",
  "storage",
  "notification-channels",
  "notification-deliveries",
] as const;
export type P6AdminArea = (typeof P6_ADMIN_AREAS)[number];

export const p6Keys = {
  all: ["p6"] as const,
  /** Everything of one administration area: ["p6", "admin", area, ...rest]. */
  admin: (area: P6AdminArea, ...rest: (string | number)[]) => ["p6", "admin", area, ...rest] as const,
  // slice E
  sensitivity: (tid: string) => ["p6", "sensitivity", tid] as const,
  recordSensitivity: (tid: string, recordType: string, recordId: string) =>
    ["p6", "sensitivity", tid, recordType, recordId] as const,
  sensitiveGrants: (query: P6Query) => ["p6", "admin", "sensitive-grants", "list", query] as const,
  sensitiveGrant: (grantId: string) => ["p6", "admin", "sensitive-grants", "grant", grantId] as const,
  deepLink: (token: string) => ["p6", "deep-link", token] as const,
  // slice F
  uploadPolicy: (organizationId: string) => ["p6", "admin", "upload-policy", organizationId] as const,
  securityRateLimits: (organizationId: string) => ["p6", "admin", "security", "rate-limits", organizationId] as const,
  auditEvents: (query: P6Query) => ["p6", "admin", "audit", "list", query] as const,
  auditEvent: (auditEventId: string) => ["p6", "admin", "audit", "event", auditEventId] as const,
  // slice J
  operationalExceptions: (query: P6Query) => ["p6", "admin", "operations", "exceptions", query] as const,
  operationalException: (exceptionId: string) => ["p6", "admin", "operations", "exception", exceptionId] as const,
  workerHeartbeat: ["p6", "admin", "operations", "heartbeat"] as const,
  serviceIdentities: (query: P6Query) => ["p6", "admin", "service-identities", "list", query] as const,
  serviceIdentity: (serviceIdentityId: string) =>
    ["p6", "admin", "service-identities", "identity", serviceIdentityId] as const,
  // slice C
  identitySettings: ["p6", "admin", "identity"] as const,
  storageSetting: ["p6", "admin", "storage"] as const,
  notificationChannels: (organizationId: string) =>
    ["p6", "admin", "notification-channels", "list", organizationId] as const,
  notificationChannel: (channelKind: string, organizationId: string) =>
    ["p6", "admin", "notification-channels", "channel", channelKind, organizationId] as const,
  notificationDeliveries: (query: P6Query) => ["p6", "admin", "notification-deliveries", query] as const,
};

/** True for every key of one administration area (["p6", "admin", area, ...]). */
export function isP6AdminKeyOf(area: P6AdminArea, key: readonly unknown[]): boolean {
  return key[0] === "p6" && key[1] === "admin" && key[2] === area;
}

/**
 * Refreshes after an administration write: every key of the given areas (e.g. a grant revocation refreshes
 * "sensitive-grants" and "audit"; a channel save refreshes "notification-channels"). Returns false when the session
 * changed meanwhile (the caller then does nothing more).
 */
export function useP6AdminRefresh(...areas: P6AdminArea[]): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all(
      areas.map((area) => queryClient.invalidateQueries({ predicate: (q) => isP6AdminKeyOf(area, q.queryKey) })),
    );
    return getSessionGeneration() === generation;
  };
}

/**
 * Refreshes after a sensitivity mark or a grant change in one transformation: its sensitivity keys, the grants list
 * and the audit view. The record reads of the benefit, business case and evidence pages are refreshed by their own
 * pages (their keys are DG4/DG5's), since a mark never changes those records' versions (ADR-0051 §2; probe G04).
 */
export function useP6SensitivityRefresh(tid: string): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: p6Keys.sensitivity(tid) }),
      queryClient.invalidateQueries({ predicate: (q) => isP6AdminKeyOf("sensitive-grants", q.queryKey) }),
      queryClient.invalidateQueries({ predicate: (q) => isP6AdminKeyOf("audit", q.queryKey) }),
    ]);
    return getSessionGeneration() === generation;
  };
}

// ------------------------------------------------------------------------------------------------ request paths

const v1 = "/api/v1";
const seg = encodeURIComponent;
const tBase = (tid: string) => `${v1}/transformations/${seg(tid)}`;
const grantBase = (grantId: string) => `${v1}/admin/sensitive-grants/${seg(grantId)}`;
const exceptionBase = (exceptionId: string) => `${v1}/admin/operations/exceptions/${seg(exceptionId)}`;
const channelBase = (channelKind: string) => `${v1}/admin/notification-channels/${seg(channelKind)}`;

/** The paths of the 30 slice E, F, J and C operations (operationId in the comment). */
export const p6Paths = {
  // access: record sensitivity and sensitive-record grants (ADR-0051 §2; BE-B)
  recordSensitivity: (tid: string, recordType: string, recordId: string) =>
    `${tBase(tid)}/records/${seg(recordType)}/${seg(recordId)}/sensitivity`, // getRecordSensitivity, putRecordSensitivity
  sensitiveGrants: `${v1}/admin/sensitive-grants`, // listSensitiveGrants, createSensitiveGrant
  sensitiveGrant: (grantId: string) => grantBase(grantId), // getSensitiveGrant
  revokeSensitiveGrant: (grantId: string) => `${grantBase(grantId)}/revoke`, // revokeSensitiveGrant
  // tasks: deep links (ADR-0051 §3; BE-C)
  deepLink: (token: string) => `${v1}/links/${seg(token)}`, // resolveDeepLink
  // evidence: safe preview (ADR-0052 §2; BE-D). Used as an <img> source only: raster types, never an <iframe>/<object>.
  evidencePreview: (tid: string, evidenceId: string) => `${tBase(tid)}/evidence/${seg(evidenceId)}/preview`, // previewEvidenceContent
  // security: upload policy and the rate-limit matrix (ADR-0052 §1, §4; BE-D, BE-E)
  uploadPolicy: `${v1}/admin/upload-policy`, // getUploadPolicy, putUploadPolicy (?organizationId=)
  securityRateLimits: `${v1}/admin/security/rate-limits`, // getSecurityRateLimits (?organizationId=)
  // audit: the global audit API (ADR-0052 §8; BE-E). Read-only: no write operation exists.
  auditEvents: `${v1}/audit-events`, // listAuditEvents
  auditEvent: (auditEventId: string) => `${v1}/audit-events/${seg(auditEventId)}`, // getAuditEvent
  // operations: exceptions and the worker heartbeat (ADR-0053 §2, §6; BE-K)
  operationalExceptions: `${v1}/admin/operations/exceptions`, // listOperationalExceptions
  operationalException: (exceptionId: string) => exceptionBase(exceptionId), // getOperationalException
  acknowledgeOperationalException: (exceptionId: string) => `${exceptionBase(exceptionId)}/acknowledge`, // acknowledgeOperationalException
  resolveOperationalException: (exceptionId: string) => `${exceptionBase(exceptionId)}/resolve`, // resolveOperationalException
  workerHeartbeat: `${v1}/admin/operations/heartbeat`, // getWorkerHeartbeat
  // operations: service identities (ADR-0053 §1; BE-J)
  serviceIdentities: `${v1}/admin/service-identities`, // listServiceIdentities
  serviceIdentity: (serviceIdentityId: string) => `${v1}/admin/service-identities/${seg(serviceIdentityId)}`, // getServiceIdentity, putServiceIdentity
  // platform-admin: identity (ADR-0054 §1; BE-G). Never contains the client secret.
  identitySettings: `${v1}/admin/identity`, // getIdentitySettings
  // platform-admin: evidence storage (ADR-0054 §2; BE-H2). Credentials are references, never values.
  storageSetting: `${v1}/admin/storage`, // getStorageSetting, putStorageSetting
  testStorageSetting: `${v1}/admin/storage/test`, // testStorageSetting
  // platform-admin: notification channels and deliveries (ADR-0054 §3; BE-I, BE-I2)
  notificationChannels: `${v1}/admin/notification-channels`, // listNotificationChannels
  notificationChannel: (channelKind: string) => channelBase(channelKind), // getNotificationChannel, putNotificationChannel
  testNotificationChannel: (channelKind: string) => `${channelBase(channelKind)}/test`, // testNotificationChannel
  notificationDeliveries: `${v1}/admin/notification-deliveries`, // listNotificationDeliveries
};

/**
 * The 30 operations above, as (operationId, method, path template) in the contract's own spelling. The parity test
 * (app/p6-shell.test.tsx) checks this list against docs/api/openapi.yaml and checks that `p6Paths` builds each template.
 */
export const P6_SLICE_EFJC_OPERATIONS: readonly (readonly [string, "GET" | "PUT" | "POST", string])[] = [
  [
    "getRecordSensitivity",
    "GET",
    "/api/v1/transformations/{transformationId}/records/{recordType}/{recordId}/sensitivity",
  ],
  [
    "putRecordSensitivity",
    "PUT",
    "/api/v1/transformations/{transformationId}/records/{recordType}/{recordId}/sensitivity",
  ],
  ["listSensitiveGrants", "GET", "/api/v1/admin/sensitive-grants"],
  ["createSensitiveGrant", "POST", "/api/v1/admin/sensitive-grants"],
  ["getSensitiveGrant", "GET", "/api/v1/admin/sensitive-grants/{grantId}"],
  ["revokeSensitiveGrant", "POST", "/api/v1/admin/sensitive-grants/{grantId}/revoke"],
  ["resolveDeepLink", "GET", "/api/v1/links/{token}"],
  ["previewEvidenceContent", "GET", "/api/v1/transformations/{transformationId}/evidence/{evidenceId}/preview"],
  ["getUploadPolicy", "GET", "/api/v1/admin/upload-policy"],
  ["putUploadPolicy", "PUT", "/api/v1/admin/upload-policy"],
  ["getSecurityRateLimits", "GET", "/api/v1/admin/security/rate-limits"],
  ["listAuditEvents", "GET", "/api/v1/audit-events"],
  ["getAuditEvent", "GET", "/api/v1/audit-events/{auditEventId}"],
  ["listOperationalExceptions", "GET", "/api/v1/admin/operations/exceptions"],
  ["getOperationalException", "GET", "/api/v1/admin/operations/exceptions/{exceptionId}"],
  ["acknowledgeOperationalException", "POST", "/api/v1/admin/operations/exceptions/{exceptionId}/acknowledge"],
  ["resolveOperationalException", "POST", "/api/v1/admin/operations/exceptions/{exceptionId}/resolve"],
  ["getWorkerHeartbeat", "GET", "/api/v1/admin/operations/heartbeat"],
  ["listServiceIdentities", "GET", "/api/v1/admin/service-identities"],
  ["getServiceIdentity", "GET", "/api/v1/admin/service-identities/{serviceIdentityId}"],
  ["putServiceIdentity", "PUT", "/api/v1/admin/service-identities/{serviceIdentityId}"],
  ["getIdentitySettings", "GET", "/api/v1/admin/identity"],
  ["getStorageSetting", "GET", "/api/v1/admin/storage"],
  ["putStorageSetting", "PUT", "/api/v1/admin/storage"],
  ["testStorageSetting", "POST", "/api/v1/admin/storage/test"],
  ["listNotificationChannels", "GET", "/api/v1/admin/notification-channels"],
  ["getNotificationChannel", "GET", "/api/v1/admin/notification-channels/{channelKind}"],
  ["putNotificationChannel", "PUT", "/api/v1/admin/notification-channels/{channelKind}"],
  ["testNotificationChannel", "POST", "/api/v1/admin/notification-channels/{channelKind}/test"],
  ["listNotificationDeliveries", "GET", "/api/v1/admin/notification-deliveries"],
];

// ------------------------------------------------------------------------------------------------ read hooks

const withOrganization = (organizationId: string | undefined): P6Query => (organizationId ? { organizationId } : {});
/** One cursor page (the large lists: grants, audit events, exceptions, deliveries). Never a silent "all pages". */
const onePage = <T>(path: string, query: P6Query, cursor: string | null) =>
  api.get<P6Page<T>>(path, { ...query, ...(cursor ? { cursor } : {}) });

// slice E: record sensitivity (the record must be readable, else 404) and grants (sensitive_record.read)
export function useRecordSensitivity<T = unknown>(tid: string, recordType: SensitiveRecordType, recordId?: string) {
  return useQuery({
    queryKey: p6Keys.recordSensitivity(tid, recordType, recordId ?? ""),
    queryFn: () => api.get<T>(p6Paths.recordSensitivity(tid, recordType, recordId ?? "")),
    enabled: Boolean(tid && recordId),
    retry: shouldRetry,
  });
}
/** `query.transformationId` is required by the contract; the hook stays disabled without it. */
export function useSensitiveGrants<T = unknown>(query: P6Query, cursor: string | null = null) {
  return useQuery({
    queryKey: [...p6Keys.sensitiveGrants(query), cursor ?? ""],
    queryFn: () => onePage<T>(p6Paths.sensitiveGrants, query, cursor),
    enabled: Boolean(query["transformationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useSensitiveGrant<T = unknown>(grantId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.sensitiveGrant(grantId ?? ""),
    queryFn: () => api.get<T>(p6Paths.sensitiveGrant(grantId ?? "")),
    enabled: Boolean(grantId),
    retry: shouldRetry,
  });
}

/**
 * slice E: resolve a deep link (`/l/:token`). A malformed token is never sent (the contract would answer 400); a 403
 * `deep_link.forbidden` carries no title, type or id, and the page shows exactly that text. Never cached across users:
 * the key is session-scoped like every other key (the session reset drops it).
 */
export function useDeepLink(token: string | undefined) {
  const wellFormed = Boolean(token && DEEP_LINK_TOKEN.test(token));
  return useQuery({
    queryKey: p6Keys.deepLink(token ?? ""),
    queryFn: () => api.get<DeepLinkResolution>(p6Paths.deepLink(token ?? "")),
    enabled: wellFormed,
    retry: shouldRetry,
    staleTime: 0,
    gcTime: 0,
  });
}

// slice F: upload policy (security.read or upload_policy.configure), rate limits (security.read), audit (audit_event.read)
export function useUploadPolicy<T = unknown>(organizationId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.uploadPolicy(organizationId ?? ""),
    queryFn: () => api.get<T>(p6Paths.uploadPolicy, withOrganization(organizationId)),
    enabled: Boolean(organizationId),
    retry: shouldRetry,
  });
}
export function useSecurityRateLimits<T = unknown>(organizationId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.securityRateLimits(organizationId ?? ""),
    queryFn: () => api.get<T>(p6Paths.securityRateLimits, withOrganization(organizationId)),
    enabled: Boolean(organizationId),
    retry: shouldRetry,
  });
}
export function useAuditEvents<T = unknown>(query: P6Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p6Keys.auditEvents(query), cursor ?? ""],
    queryFn: () => onePage<T>(p6Paths.auditEvents, query, cursor),
    enabled: enabled && Boolean(query["organizationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useAuditEvent<T = unknown>(auditEventId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.auditEvent(auditEventId ?? ""),
    queryFn: () => api.get<T>(p6Paths.auditEvent(auditEventId ?? "")),
    enabled: Boolean(auditEventId),
    retry: shouldRetry,
  });
}

// slice J: operations (operations.read) and service identities
export function useOperationalExceptions<T = unknown>(query: P6Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p6Keys.operationalExceptions(query), cursor ?? ""],
    queryFn: () => onePage<T>(p6Paths.operationalExceptions, query, cursor),
    enabled: enabled && Boolean(query["organizationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useOperationalException<T = unknown>(exceptionId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.operationalException(exceptionId ?? ""),
    queryFn: () => api.get<T>(p6Paths.operationalException(exceptionId ?? "")),
    enabled: Boolean(exceptionId),
    retry: shouldRetry,
  });
}
/** The heartbeat status is `alive`, `stale` or `unknown`; the screen never shows `unknown` or `stale` as alive. */
export function useWorkerHeartbeat<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p6Keys.workerHeartbeat,
    queryFn: () => api.get<T>(p6Paths.workerHeartbeat),
    enabled,
    retry: shouldRetry,
    refetchInterval: 30_000,
  });
}
/** `query.organizationId` is required by the contract (as for the audit, exception and delivery lists). */
export function useServiceIdentities<T = unknown>(query: P6Query, enabled = true) {
  return useQuery({
    queryKey: p6Keys.serviceIdentities(query),
    queryFn: () => fetchAllPages<T>(p6Paths.serviceIdentities, query),
    enabled: enabled && Boolean(query["organizationId"]),
    retry: shouldRetry,
  });
}
export function useServiceIdentity<T = unknown>(serviceIdentityId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.serviceIdentity(serviceIdentityId ?? ""),
    queryFn: () => api.get<T>(p6Paths.serviceIdentity(serviceIdentityId ?? "")),
    enabled: Boolean(serviceIdentityId),
    retry: shouldRetry,
  });
}

// slice C: identity (identity.read), storage (storage.configure), notification channels (notification_channel.configure)
export function useIdentitySettings<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p6Keys.identitySettings,
    queryFn: () => api.get<T>(p6Paths.identitySettings),
    enabled,
    retry: shouldRetry,
  });
}
export function useStorageSetting<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p6Keys.storageSetting,
    queryFn: () => api.get<T>(p6Paths.storageSetting),
    enabled,
    retry: shouldRetry,
  });
}
export function useNotificationChannels<T = unknown>(organizationId: string | undefined) {
  return useQuery({
    queryKey: p6Keys.notificationChannels(organizationId ?? ""),
    queryFn: () => fetchAllPages<T>(p6Paths.notificationChannels, withOrganization(organizationId)),
    enabled: Boolean(organizationId),
    retry: shouldRetry,
  });
}
export function useNotificationChannel<T = unknown>(
  channelKind: NotificationChannelKind | undefined,
  organizationId: string | undefined,
) {
  return useQuery({
    queryKey: p6Keys.notificationChannel(channelKind ?? "", organizationId ?? ""),
    queryFn: () => api.get<T>(p6Paths.notificationChannel(channelKind ?? ""), withOrganization(organizationId)),
    enabled: Boolean(channelKind && organizationId),
    retry: shouldRetry,
  });
}
export function useNotificationDeliveries<T = unknown>(query: P6Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p6Keys.notificationDeliveries(query), cursor ?? ""],
    queryFn: () => onePage<T>(p6Paths.notificationDeliveries, query, cursor),
    enabled: enabled && Boolean(query["organizationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
