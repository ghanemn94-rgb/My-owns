// P7 web seams (T-DG7-FE-A; p7-plan §5.1 row FE-A and §5.3; p7-work-split §C.7/C.8, §D.2/D.4, §E.6, §B.1, §I.1/I.2).
//
//  1. `p7Keys`: the query keys of the P7 Administration screens (Data export, Migration status and Identity rebind,
//     Configuration transfer, Retention with its runs, archived records and backup sets, the deployment status, the
//     requirement register and About), added up front so FE-B and FE-C only add hooks or screens in their own
//     `pages/admin/<feature>/**` and never edit `api/**` (a missing key goes into their handback; the orchestrator
//     merges it append-only, p7-plan §5.3). Every key starts with ["p7", "admin", <area>, ...], so
//     `useP7AdminRefresh(area)` refreshes exactly what a write in that area can change.
//  2. `p7Paths`: the request path of each of the 33 P7 operations of docs/api/openapi.yaml 1.6.0-p7 (tags transfer,
//     retention, deployment and release; ADR-0064, ADR-0065, ADR-0066/0067, ADR-0069, ADR-0071), operationId in the
//     comment. `P7_OPERATIONS` lists them with the contract's method and path for the parity test
//     (app/p7-shell.test.tsx), which also checks the list against apps/api/test/support/p7-operations.ts.
//  3. The read hooks of the GET operations. Writes are sent by the screens with `api.send` inside a session guard
//     (auth/sessionBound.ts): `createMigrationExport`, `createRetentionRun` and `createRetentionDryRun` with an
//     Idempotency-Key (`newIdempotencyKey()`); `updateRetentionClass`, `validateConfigBundleImport` and
//     `commitConfigBundleImport` with If-Match from the record's `version`; `uploadConfigBundleImport` with the
//     `X-File-Name` header. No operation of this file starts a migration import or an identity rebind: those are run by
//     IT with the CLI tools only (p7-work-split §C.11), and the screens are read-only for them.
//
// Typing: the hooks take the body type as a parameter (default `unknown`), as in api/p6.ts, so a screen never assumes a
// shape the contract has not fixed. The closed value sets the screens label (statuses, actions, kinds) are copied from
// the contract below and checked against it by the parity test. The OpenAPI file is the source of truth.
//
// Unknown is data, never a default (p7-work-split §I.7: "`null` means unknown"): a `null` count, period, checksum or
// register is shown as Unknown, Unavailable or "Not set", never turned into 0, an empty list or a success colour here.
import { UNPORTABLE_BUNDLE_KINDS } from "@mth/shared/transfer";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getSessionGeneration } from "./client.ts";
import { fetchAllPages, shouldRetry } from "./queries.ts";

/** A cursor page of the P7 list operations (the shared `Page` shape: items and nextCursor). */
export interface P7Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** A query-string record; empty values are left out by the caller. */
export type P7Query = Record<string, string>;

// ------------------------------------------------------------------------------------------------ contract value sets

/** `MigrationExport.status` and `RetentionRun.status` (ADR-0064 §3, ADR-0067 §4). */
export const P7_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type P7JobStatus = (typeof P7_JOB_STATUSES)[number];
/** `TransferSourceEnvironment`: a demo package stays labelled synthetic wherever it is imported (§C.11). */
export const TRANSFER_SOURCE_ENVIRONMENTS = ["production", "demo", "unmarked"] as const;
export type TransferSourceEnvironment = (typeof TRANSFER_SOURCE_ENVIRONMENTS)[number];
/** `IdentityRebind.state` (ADR-0064 §8). `unbound` cannot sign in. */
export const IDENTITY_REBIND_STATES = ["unbound", "rebound", "retained"] as const;
export type IdentityRebindState = (typeof IDENTITY_REBIND_STATES)[number];
/** `MigrationReconciliation.attachmentMismatches[].problem`: reported, never skipped (T-C16). */
export const ATTACHMENT_MISMATCH_PROBLEMS = ["missing", "size_mismatch", "sha256_mismatch"] as const;
/** `ConfigBundleKind` (ADR-0065 §1 order). */
export const CONFIG_BUNDLE_KINDS = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
  "automation_rule",
  "branding",
  "notification_policy",
  "job_schedule",
  "config_review_policy",
  "upload_policy",
] as const;
export type ConfigBundleKind = (typeof CONFIG_BUNDLE_KINDS)[number];
/**
 * The kinds the export screen offers: every `ConfigBundleKind` less `UNPORTABLE_BUNDLE_KINDS` (ADR-0065 Amendment 1,
 * A1.2: `automation_rule` is not carried in this release, and an export naming it is 422
 * `config_bundle.unportable_reference`). The enum keeps all 12 values, so an import item of the kind is still labelled.
 */
export const EXPORTABLE_CONFIG_BUNDLE_KINDS: readonly ConfigBundleKind[] = CONFIG_BUNDLE_KINDS.filter(
  (k) => !UNPORTABLE_BUNDLE_KINDS.has(k),
);
/** The kinds a bundle never carries (shown on the export screen with the reason, never dropped silently). */
export const UNPORTABLE_CONFIG_BUNDLE_KINDS: readonly ConfigBundleKind[] = CONFIG_BUNDLE_KINDS.filter((k) =>
  UNPORTABLE_BUNDLE_KINDS.has(k),
);
/** `ConfigBundleImport.status` (ADR-0065 §4). `invalid` is terminal. */
export const CONFIG_BUNDLE_IMPORT_STATUSES = ["uploaded", "validated", "invalid", "committed"] as const;
export type ConfigBundleImportStatus = (typeof CONFIG_BUNDLE_IMPORT_STATUSES)[number];
/** `ConfigBundleImportItem.action` (ADR-0065 §3). A commit never publishes: drafting kinds end as drafts. */
export const CONFIG_BUNDLE_ITEM_ACTIONS = ["create_draft", "new_draft", "identical", "conflict", "refused"] as const;
export type ConfigBundleItemAction = (typeof CONFIG_BUNDLE_ITEM_ACTIONS)[number];
/** `RetentionAction` (ADR-0067 §2). Every class starts as `retain`. */
export const RETENTION_ACTIONS = ["retain", "archive", "archive_then_purge"] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
/** `RetentionCategory` (ADR-0067 §1). Business, audit and snapshot classes are always kept. */
export const RETENTION_CATEGORIES = ["business", "audit", "snapshot", "system", "derived", "operational"] as const;
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];
/** `RetentionRun.mode`. A dry run changes nothing. */
export const RETENTION_RUN_MODES = ["dry_run", "run"] as const;
/** `RetentionRunAction.action`. */
export const RETENTION_RUN_ACTIONS = [
  "would_archive",
  "would_purge",
  "archived",
  "purged",
  "skipped_referenced",
] as const;
/** `BackupSet.status`: the set IT's backup script reported (ADR-0066 §3). */
export const BACKUP_SET_STATUSES = ["succeeded", "failed"] as const;
/** `DeploymentStatus.storage.status` and `.worker.status` (ADR-0069 §3): `unknown` is never shown as ok or alive. */
export const DEPLOYMENT_STORAGE_STATUSES = ["ok", "fail", "unknown"] as const;
export const DEPLOYMENT_WORKER_STATUSES = ["alive", "stale", "unknown"] as const;
/** `RequirementClass` and `RequirementStatus` (ADR-0071 §3). Engineering delivery states, never business approvals. */
export const REQUIREMENT_CLASSES = ["SOURCE", "USER", "ENGINEERING"] as const;
export const REQUIREMENT_STATUSES = ["PLANNED", "SPECIFIED", "IMPLEMENTED", "BLOCKED"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

// ------------------------------------------------------------------------------------------------ query keys

/** The Administration areas of P7; FE-B and FE-C use one per screen. */
export const P7_ADMIN_AREAS = [
  // slice C (ADR-0064): Data export, Migration status, Identity rebind
  "migration-exports",
  "migration-imports",
  "identity-rebinds",
  // slice D (ADR-0065): Configuration transfer
  "config-bundles",
  // slice E (ADR-0066, ADR-0067): Retention and backup sets
  "retention",
  "backups",
  // slice B (ADR-0069): deployment status
  "deployment",
  // slice I (ADR-0071): requirement register and About
  "requirements",
  "about",
] as const;
export type P7AdminArea = (typeof P7_ADMIN_AREAS)[number];

export const p7Keys = {
  all: ["p7"] as const,
  /** Everything of one administration area: ["p7", "admin", area, ...rest]. */
  admin: (area: P7AdminArea, ...rest: (string | number)[]) => ["p7", "admin", area, ...rest] as const,
  // slice C
  migrationExports: ["p7", "admin", "migration-exports", "list"] as const,
  migrationExport: (id: string) => ["p7", "admin", "migration-exports", "export", id] as const,
  migrationExportManifest: (id: string) => ["p7", "admin", "migration-exports", "manifest", id] as const,
  migrationExportAttachmentManifest: (id: string) =>
    ["p7", "admin", "migration-exports", "attachment-manifest", id] as const,
  migrationImports: ["p7", "admin", "migration-imports", "list"] as const,
  migrationImport: (id: string) => ["p7", "admin", "migration-imports", "import", id] as const,
  migrationReconciliations: (importId: string) =>
    ["p7", "admin", "migration-imports", "reconciliations", importId] as const,
  migrationReconciliation: (importId: string, id: string) =>
    ["p7", "admin", "migration-imports", "reconciliation", importId, id] as const,
  identityRebinds: (query: P7Query) => ["p7", "admin", "identity-rebinds", "list", query] as const,
  // slice D
  configBundleExports: (organizationId: string) =>
    ["p7", "admin", "config-bundles", "exports", organizationId] as const,
  configBundleExport: (id: string) => ["p7", "admin", "config-bundles", "export", id] as const,
  configBundleImports: (organizationId: string) =>
    ["p7", "admin", "config-bundles", "imports", organizationId] as const,
  configBundleImport: (id: string) => ["p7", "admin", "config-bundles", "import", id] as const,
  // slice E
  retentionClasses: ["p7", "admin", "retention", "classes"] as const,
  retentionClass: (code: string) => ["p7", "admin", "retention", "class", code] as const,
  retentionRuns: ["p7", "admin", "retention", "runs"] as const,
  retentionRun: (id: string) => ["p7", "admin", "retention", "run", id] as const,
  retentionRunActions: (id: string) => ["p7", "admin", "retention", "run-actions", id] as const,
  retentionArchived: (query: P7Query) => ["p7", "admin", "retention", "archived", query] as const,
  backupSets: ["p7", "admin", "backups", "list"] as const,
  // slice B
  deploymentStatus: ["p7", "admin", "deployment"] as const,
  // slice I
  requirements: (query: P7Query) => ["p7", "admin", "requirements", "list", query] as const,
  requirement: (reqId: string) => ["p7", "admin", "requirements", "requirement", reqId] as const,
  about: ["p7", "admin", "about"] as const,
};

/** True for every key of one P7 administration area (["p7", "admin", area, ...]). */
export function isP7AdminKeyOf(area: P7AdminArea, key: readonly unknown[]): boolean {
  return key[0] === "p7" && key[1] === "admin" && key[2] === area;
}

/**
 * Refreshes after a P7 write: every key of the given areas (e.g. a retention run refreshes "retention"; a bundle commit
 * refreshes "config-bundles"). Returns false when the session changed meanwhile (the caller then does nothing more).
 */
export function useP7AdminRefresh(...areas: P7AdminArea[]): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all(
      areas.map((area) => queryClient.invalidateQueries({ predicate: (q) => isP7AdminKeyOf(area, q.queryKey) })),
    );
    return getSessionGeneration() === generation;
  };
}

// ------------------------------------------------------------------------------------------------ request paths

const v1 = "/api/v1";
const seg = encodeURIComponent;
const exportBase = (id: string) => `${v1}/admin/migration-exports/${seg(id)}`;
const importBase = (id: string) => `${v1}/admin/migration-imports/${seg(id)}`;
const bundleExportBase = (id: string) => `${v1}/admin/config-bundles/exports/${seg(id)}`;
const bundleImportBase = (id: string) => `${v1}/admin/config-bundles/imports/${seg(id)}`;
const retentionRunBase = (id: string) => `${v1}/admin/retention/runs/${seg(id)}`;

/** The paths of the 33 P7 operations (operationId in the comment). */
export const p7Paths = {
  // transfer, slice C: migration export (migration.export) and the read-only import side (migration_import.read)
  migrationExports: `${v1}/admin/migration-exports`, // listMigrationExports, createMigrationExport (Idempotency-Key)
  migrationExport: (id: string) => exportBase(id), // getMigrationExport
  migrationExportManifest: (id: string) => `${exportBase(id)}/manifest`, // downloadMigrationExportManifest
  migrationExportAttachmentManifest: (id: string) => `${exportBase(id)}/attachment-manifest`, // downloadMigrationExportAttachmentManifest
  migrationImports: `${v1}/admin/migration-imports`, // listMigrationImports
  migrationImport: (id: string) => importBase(id), // getMigrationImport
  migrationReconciliations: (importId: string) => `${importBase(importId)}/reconciliations`, // listMigrationReconciliations
  migrationReconciliation: (importId: string, id: string) => `${importBase(importId)}/reconciliations/${seg(id)}`, // getMigrationReconciliation
  identityRebinds: `${v1}/admin/identity-rebinds`, // listIdentityRebinds (?state=)
  // transfer, slice D: configuration bundles (config_bundle.export, config_bundle.import; ?organizationId= on lists)
  configBundleExports: `${v1}/admin/config-bundles/exports`, // listConfigBundleExports, createConfigBundleExport
  configBundleExport: (id: string) => bundleExportBase(id), // getConfigBundleExport
  configBundleExportDownload: (id: string) => `${bundleExportBase(id)}/download`, // downloadConfigBundleExport
  configBundleImports: `${v1}/admin/config-bundles/imports`, // listConfigBundleImports, uploadConfigBundleImport (X-File-Name)
  configBundleImport: (id: string) => bundleImportBase(id), // getConfigBundleImport
  validateConfigBundleImport: (id: string) => `${bundleImportBase(id)}/validate`, // validateConfigBundleImport (If-Match)
  commitConfigBundleImport: (id: string) => `${bundleImportBase(id)}/commit`, // commitConfigBundleImport (If-Match)
  // retention, slice E: classes, runs, archived records (retention.*) and backup sets (backup.read)
  retentionClasses: `${v1}/admin/retention/classes`, // listRetentionClasses
  retentionClass: (code: string) => `${v1}/admin/retention/classes/${seg(code)}`, // getRetentionClass, updateRetentionClass (If-Match)
  retentionRuns: `${v1}/admin/retention/runs`, // listRetentionRuns, createRetentionRun (Idempotency-Key)
  retentionDryRuns: `${v1}/admin/retention/dry-runs`, // createRetentionDryRun (Idempotency-Key)
  retentionRun: (id: string) => retentionRunBase(id), // getRetentionRun
  retentionRunActions: (id: string) => `${retentionRunBase(id)}/actions`, // listRetentionRunActions
  retentionArchived: `${v1}/admin/retention/archived`, // listRetentionArchivedRecords (?table=&retentionRunId=)
  backupSets: `${v1}/admin/backups`, // listBackupSets (read-only: backups are run by IT with the scripts)
  // deployment, slice B (operations.read)
  deploymentStatus: `${v1}/admin/deployment`, // getDeploymentStatus
  // release, slice I (operations.read; read-only, no write operation exists)
  requirements: `${v1}/admin/requirements`, // listRequirements (?class=&status=&area=&finalGate=)
  requirement: (reqId: string) => `${v1}/admin/requirements/${seg(reqId)}`, // getRequirement
  about: `${v1}/admin/about`, // getReleaseAbout
};

type Method = "GET" | "PUT" | "POST";

/**
 * The 33 operations above, as (operationId, method, path template) in the contract's own spelling. The parity test
 * (app/p7-shell.test.tsx) checks this list against docs/api/openapi.yaml and against the P7 operation set of the API
 * tests, and checks that `p7Paths` builds each template.
 */
export const P7_OPERATIONS: readonly (readonly [string, Method, string])[] = [
  ["listMigrationExports", "GET", "/api/v1/admin/migration-exports"],
  ["createMigrationExport", "POST", "/api/v1/admin/migration-exports"],
  ["getMigrationExport", "GET", "/api/v1/admin/migration-exports/{migrationExportId}"],
  ["downloadMigrationExportManifest", "GET", "/api/v1/admin/migration-exports/{migrationExportId}/manifest"],
  [
    "downloadMigrationExportAttachmentManifest",
    "GET",
    "/api/v1/admin/migration-exports/{migrationExportId}/attachment-manifest",
  ],
  ["listMigrationImports", "GET", "/api/v1/admin/migration-imports"],
  ["getMigrationImport", "GET", "/api/v1/admin/migration-imports/{migrationImportId}"],
  ["listMigrationReconciliations", "GET", "/api/v1/admin/migration-imports/{migrationImportId}/reconciliations"],
  [
    "getMigrationReconciliation",
    "GET",
    "/api/v1/admin/migration-imports/{migrationImportId}/reconciliations/{migrationReconciliationId}",
  ],
  ["listIdentityRebinds", "GET", "/api/v1/admin/identity-rebinds"],
  ["listConfigBundleExports", "GET", "/api/v1/admin/config-bundles/exports"],
  ["createConfigBundleExport", "POST", "/api/v1/admin/config-bundles/exports"],
  ["getConfigBundleExport", "GET", "/api/v1/admin/config-bundles/exports/{configBundleExportId}"],
  ["downloadConfigBundleExport", "GET", "/api/v1/admin/config-bundles/exports/{configBundleExportId}/download"],
  ["listConfigBundleImports", "GET", "/api/v1/admin/config-bundles/imports"],
  ["uploadConfigBundleImport", "POST", "/api/v1/admin/config-bundles/imports"],
  ["getConfigBundleImport", "GET", "/api/v1/admin/config-bundles/imports/{configBundleImportId}"],
  ["validateConfigBundleImport", "POST", "/api/v1/admin/config-bundles/imports/{configBundleImportId}/validate"],
  ["commitConfigBundleImport", "POST", "/api/v1/admin/config-bundles/imports/{configBundleImportId}/commit"],
  ["listRetentionClasses", "GET", "/api/v1/admin/retention/classes"],
  ["getRetentionClass", "GET", "/api/v1/admin/retention/classes/{retentionClassCode}"],
  ["updateRetentionClass", "PUT", "/api/v1/admin/retention/classes/{retentionClassCode}"],
  ["listRetentionRuns", "GET", "/api/v1/admin/retention/runs"],
  ["createRetentionRun", "POST", "/api/v1/admin/retention/runs"],
  ["createRetentionDryRun", "POST", "/api/v1/admin/retention/dry-runs"],
  ["getRetentionRun", "GET", "/api/v1/admin/retention/runs/{retentionRunId}"],
  ["listRetentionRunActions", "GET", "/api/v1/admin/retention/runs/{retentionRunId}/actions"],
  ["listRetentionArchivedRecords", "GET", "/api/v1/admin/retention/archived"],
  ["listBackupSets", "GET", "/api/v1/admin/backups"],
  ["getDeploymentStatus", "GET", "/api/v1/admin/deployment"],
  ["listRequirements", "GET", "/api/v1/admin/requirements"],
  ["getRequirement", "GET", "/api/v1/admin/requirements/{reqId}"],
  ["getReleaseAbout", "GET", "/api/v1/admin/about"],
];

// ------------------------------------------------------------------------------------------------ read hooks

/** One cursor page (the lists a user pages through). Never a silent "all pages". */
const onePage = <T>(path: string, query: P7Query, cursor: string | null) =>
  api.get<P7Page<T>>(path, { ...query, ...(cursor ? { cursor } : {}) });

// slice C: migration exports (migration.export) and the read-only import side (migration_import.read)
export function useMigrationExports<T = unknown>(cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.migrationExports, cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.migrationExports, {}, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useMigrationExport<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.migrationExport(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.migrationExport(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
/** 409 `migration.export_not_ready` until the export succeeded; 422 `migration.export_failed` after a failure. */
export function useMigrationExportManifest<T = unknown>(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: p7Keys.migrationExportManifest(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.migrationExportManifest(id ?? "")),
    enabled: enabled && Boolean(id),
    retry: shouldRetry,
  });
}
export function useMigrationExportAttachmentManifest<T = unknown>(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: p7Keys.migrationExportAttachmentManifest(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.migrationExportAttachmentManifest(id ?? "")),
    enabled: enabled && Boolean(id),
    retry: shouldRetry,
  });
}
export function useMigrationImports<T = unknown>(cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.migrationImports, cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.migrationImports, {}, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useMigrationImport<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.migrationImport(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.migrationImport(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useMigrationReconciliations<T = unknown>(importId: string | undefined) {
  return useQuery({
    queryKey: p7Keys.migrationReconciliations(importId ?? ""),
    queryFn: () => fetchAllPages<T>(p7Paths.migrationReconciliations(importId ?? ""), {}),
    enabled: Boolean(importId),
    retry: shouldRetry,
  });
}
export function useMigrationReconciliation<T = unknown>(importId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.migrationReconciliation(importId ?? "", id ?? ""),
    queryFn: () => api.get<T>(p7Paths.migrationReconciliation(importId ?? "", id ?? "")),
    enabled: Boolean(importId && id),
    retry: shouldRetry,
  });
}
/** `query.state` is optional (`unbound`, `rebound` or `retained`). */
export function useIdentityRebinds<T = unknown>(query: P7Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.identityRebinds(query), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.identityRebinds, query, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}

// slice D: configuration bundles; the lists need `organizationId` (required by the contract)
export function useConfigBundleExports<T = unknown>(organizationId: string | undefined, cursor: string | null = null) {
  return useQuery({
    queryKey: [...p7Keys.configBundleExports(organizationId ?? ""), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.configBundleExports, { organizationId: organizationId ?? "" }, cursor),
    enabled: Boolean(organizationId),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useConfigBundleExport<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.configBundleExport(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.configBundleExport(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useConfigBundleImports<T = unknown>(organizationId: string | undefined, cursor: string | null = null) {
  return useQuery({
    queryKey: [...p7Keys.configBundleImports(organizationId ?? ""), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.configBundleImports, { organizationId: organizationId ?? "" }, cursor),
    enabled: Boolean(organizationId),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useConfigBundleImport<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.configBundleImport(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.configBundleImport(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}

// slice E: retention (retention.read) and backup sets (backup.read)
/** Twelve classes at this release: every page is read, so no class is silently missing from the screen. */
export function useRetentionClasses<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p7Keys.retentionClasses,
    queryFn: () => fetchAllPages<T>(p7Paths.retentionClasses, {}),
    enabled,
    retry: shouldRetry,
  });
}
export function useRetentionClass<T = unknown>(code: string | undefined) {
  return useQuery({
    queryKey: p7Keys.retentionClass(code ?? ""),
    queryFn: () => api.get<T>(p7Paths.retentionClass(code ?? "")),
    enabled: Boolean(code),
    retry: shouldRetry,
  });
}
export function useRetentionRuns<T = unknown>(cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.retentionRuns, cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.retentionRuns, {}, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useRetentionRun<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: p7Keys.retentionRun(id ?? ""),
    queryFn: () => api.get<T>(p7Paths.retentionRun(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useRetentionRunActions<T = unknown>(id: string | undefined, cursor: string | null = null) {
  return useQuery({
    queryKey: [...p7Keys.retentionRunActions(id ?? ""), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.retentionRunActions(id ?? ""), {}, cursor),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
/** `query.table` and `query.retentionRunId` are optional filters. */
export function useRetentionArchivedRecords<T = unknown>(query: P7Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.retentionArchived(query), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.retentionArchived, query, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useBackupSets<T = unknown>(cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.backupSets, cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.backupSets, {}, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}

// slice B: the deployment status (operations.read). `storage: unknown` and `worker: unknown` stay unknown.
export function useDeploymentStatus<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p7Keys.deploymentStatus,
    queryFn: () => api.get<T>(p7Paths.deploymentStatus),
    enabled,
    retry: shouldRetry,
  });
}

// slice I: the requirement register and About (operations.read). A `null` register is "unavailable", never empty.
/** `query` holds the optional filters `class`, `status`, `area` and `finalGate`. */
export function useRequirements<T = unknown>(query: P7Query, cursor: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...p7Keys.requirements(query), cursor ?? ""],
    queryFn: () => onePage<T>(p7Paths.requirements, query, cursor),
    enabled,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useRequirement<T = unknown>(reqId: string | undefined) {
  return useQuery({
    queryKey: p7Keys.requirement(reqId ?? ""),
    queryFn: () => api.get<T>(p7Paths.requirement(reqId ?? "")),
    enabled: Boolean(reqId),
    retry: shouldRetry,
  });
}
export function useReleaseAbout<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p7Keys.about,
    queryFn: () => api.get<T>(p7Paths.about),
    enabled,
    retry: shouldRetry,
  });
}
