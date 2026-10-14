// P5 web seams (T-DG5-FE-A; p5-plan §5.1 row FE-A and §5.3; D-144 item 2).
//
//  1. `p5Keys`: the query keys of the slice A–C screens (Playbook Studio, configuration pins, methodology migrations,
//     form schemas and the common form framework, procedures), added up front so FE-B…FE-D only add hooks in their own
//     `pages/<feature>/api.ts` and never edit `api/**` (missing keys go into their handback; the orchestrator merges
//     them append-only). Keys of one transformation start with ["p5", <area>, tid] so `useP5Refresh(tid)` refreshes all
//     of them after a mutation; the global Studio keys start with ["p5", "studio"], the procedure catalogue and
//     instances with ["p5", "procedures"], personal keys with ["p5", "me"]. Slices D–K add their own clients (D-144).
//  2. `p5Paths`: the request path of each of the 72 slice A–C operations of docs/api/openapi.yaml 1.4.0-p5 (ADR-0039 to
//     ADR-0042; tags studio, config-pins, methodology-migrations, forms, procedures), operationId in the comment.
//  3. The read hooks of the GET operations. Writes are sent by the screens with `api.send` (If-Match from the record's
//     `version`; Idempotency-Key on `launchProcedureInstance`), inside a session guard (auth/sessionBound.ts).
//
// Typing: the bodies mirrored in @mth/shared/schemas today (studio.ts: versions, elements, pins; T-DG5-BE-A) are typed
// here. The other bodies are mirrored by their backend task (studio-checks.ts BE-B, studio-coverage.ts BE-B2,
// studio-review.ts BE-B3, methodology-migrations.ts BE-C, scoring-defaults.ts KBE-A, the forms and procedures mirrors
// BE-D…BE-G); until then their hooks take the body type as a parameter (default `unknown`), so a screen never assumes
// a shape the contract has not fixed. The OpenAPI file is the source of truth.
//
// Unknown is data, never a default: a missing check run stays null here and renders as Unknown, never as passed.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigElement, ConfigPin, ConfigPinHistoryEntry, ConfigVersion } from "@mth/shared/schemas";
import { api, getSessionGeneration } from "./client.ts";
import { fetchAllPages, shouldRetry } from "./queries.ts";

export type { ConfigElement, ConfigPin, ConfigPinHistoryEntry, ConfigVersion };

/** A cursor page of the P5 list operations (the shared `Page` shape: items and nextCursor). */
export interface P5Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** A query-string record; empty values are left out by the caller. */
export type P5Query = Record<string, string>;

// ------------------------------------------------------------------------------------------------ query keys

/** The transformation-scoped P5 areas of slices A–C; each FE task uses the ones of its slice. */
export const P5_TRANSFORMATION_AREAS = [
  // FE-B (slice A)
  "config-pins",
  "scoring-defaults",
  "methodology-migrations",
  "gate-reapprovals",
  // FE-C (slice B)
  "form-schemas",
  "form-records",
  "form-drafts",
  // FE-D (slice C)
  "procedure-instances",
] as const;
export type P5TransformationArea = (typeof P5_TRANSFORMATION_AREAS)[number];

export const p5Keys = {
  all: ["p5"] as const,
  /** Everything of one transformation in one P5 area: ["p5", area, tid, ...rest]. */
  area: (area: P5TransformationArea, tid: string, ...rest: (string | number)[]) => ["p5", area, tid, ...rest] as const,
  // Playbook Studio (global configuration; ADR-0039 §1: versions have no organization).
  studio: ["p5", "studio"] as const,
  configVersions: (query: P5Query = {}) => ["p5", "studio", "versions", query] as const,
  configVersion: (versionId: string) => ["p5", "studio", "version", versionId] as const,
  configElements: (versionId: string, query: P5Query = {}) =>
    ["p5", "studio", "version", versionId, "elements", query] as const,
  configDiff: (versionId: string, against: string | null) =>
    ["p5", "studio", "version", versionId, "diff", against ?? ""] as const,
  configAffectedRecords: (versionId: string) => ["p5", "studio", "version", versionId, "affected-records"] as const,
  configCheckRuns: (versionId: string, query: P5Query = {}) =>
    ["p5", "studio", "version", versionId, "check-runs", query] as const,
  configReviews: (versionId: string) => ["p5", "studio", "version", versionId, "reviews"] as const,
  scoringDefaults: (versionId: string | null) => ["p5", "studio", "scoring-defaults", versionId ?? ""] as const,
  reviewPolicies: ["p5", "studio", "review-policies"] as const,
  revisionProposals: (query: P5Query = {}) => ["p5", "studio", "revision-proposals", query] as const,
  sourceCoverage: (versionId: string | null) => ["p5", "studio", "source-coverage", versionId ?? ""] as const,
  formRecordTypes: (query: P5Query = {}) => ["p5", "studio", "form-schemas", query] as const,
  formSchemaAdmin: (recordType: string, versionId: string | null) =>
    ["p5", "studio", "form-schema", recordType, versionId ?? ""] as const,
  methodologyCoverage: (versionId: string | null) => ["p5", "studio", "coverage", versionId ?? ""] as const,
  // Procedures (definitions are readable with procedure.read; instances by scope).
  procedures: ["p5", "procedures"] as const,
  procedureDefinitions: (query: P5Query = {}) => ["p5", "procedures", "definitions", query] as const,
  procedureDefinition: (code: string, versionId: string | null) =>
    ["p5", "procedures", "definition", code, versionId ?? ""] as const,
  procedureInstances: (query: P5Query = {}) => ["p5", "procedures", "instances", query] as const,
  procedureInstance: (instanceId: string) => ["p5", "procedures", "instance", instanceId] as const,
  // Personal views.
  me: ["p5", "me"] as const,
  myProcedureSteps: (query: P5Query = {}) => ["p5", "me", "procedure-steps", query] as const,
};

/** True for every P5 key of one transformation (["p5", area, tid, ...]). */
export function isP5KeyOf(tid: string, key: readonly unknown[]): boolean {
  return (
    key[0] === "p5" &&
    typeof key[1] === "string" &&
    (P5_TRANSFORMATION_AREAS as readonly string[]).includes(key[1]) &&
    key[2] === tid
  );
}

/**
 * Refreshes after a mutation: every P5 key of the transformation (when given), the procedure views and the personal
 * views (a step completion or a migration changes My Work). Returns false when the session changed meanwhile (the
 * caller then does nothing more).
 */
export function useP5Refresh(tid?: string): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all([
      tid ? queryClient.invalidateQueries({ predicate: (q) => isP5KeyOf(tid, q.queryKey) }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: p5Keys.procedures }),
      queryClient.invalidateQueries({ queryKey: p5Keys.me }),
    ]);
    return getSessionGeneration() === generation;
  };
}

/** Refreshes the Playbook Studio keys after a Studio write (draft, element, check, review, publish, rollback). */
export function useStudioRefresh(): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: p5Keys.studio }),
      queryClient.invalidateQueries({ queryKey: p5Keys.procedures }),
    ]);
    return getSessionGeneration() === generation;
  };
}

// ------------------------------------------------------------------------------------------------ request paths

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;
const seg = encodeURIComponent;
const versionBase = (versionId: string) => `${v1}/admin/methodology-versions/${versionId}`;
const formRecordBase = (tid: string, recordType: string, recordId: string) =>
  `${tBase(tid)}/form-records/${seg(recordType)}/${recordId}`;
const migrationBase = (tid: string, migrationId: string) => `${tBase(tid)}/methodology-migrations/${migrationId}`;
const instanceBase = (instanceId: string) => `${v1}/procedure-instances/${instanceId}`;
const stepBase = (instanceId: string, stepKey: string) => `${instanceBase(instanceId)}/steps/${seg(stepKey)}`;

/** The paths of the 72 slice A–C operations (operationId in the comment). */
export const p5Paths = {
  // studio: configuration versions (ADR-0039 §1, §4)
  configVersions: `${v1}/admin/methodology-versions`, // listConfigVersions, createConfigDraft
  configVersion: (versionId: string) => versionBase(versionId), // getConfigVersion, updateConfigDraft
  discardConfigDraft: (versionId: string) => `${versionBase(versionId)}/discard`, // discardConfigDraft
  configElements: (versionId: string) => `${versionBase(versionId)}/elements`, // listConfigElements
  configElement: (versionId: string, elementType: string, stableKey: string) =>
    `${versionBase(versionId)}/elements/${seg(elementType)}/${seg(stableKey)}`, // putConfigElement
  removeConfigElement: (versionId: string, elementType: string, stableKey: string) =>
    `${versionBase(versionId)}/elements/${seg(elementType)}/${seg(stableKey)}/remove`, // removeConfigElement
  // studio: diff, affected records, checks, preview (ADR-0039 §5, §6)
  configDiff: (versionId: string) => `${versionBase(versionId)}/diff`, // getConfigVersionDiff
  configAffectedRecords: (versionId: string) => `${versionBase(versionId)}/affected-records`, // getConfigAffectedRecords
  configCheckRuns: (versionId: string) => `${versionBase(versionId)}/check-runs`, // listConfigCheckRuns
  compatibilityCheck: (versionId: string) => `${versionBase(versionId)}/compatibility-checks`, // runConfigCompatibilityCheck
  configPreview: (versionId: string) => `${versionBase(versionId)}/preview`, // runConfigPreview
  // studio: review, publish, rollback, review policies (ADR-0039 §7)
  submitConfigReview: (versionId: string) => `${versionBase(versionId)}/submit-review`, // submitConfigReview
  configReviews: (versionId: string) => `${versionBase(versionId)}/reviews`, // listConfigReviews
  decideConfigReview: (versionId: string, reviewId: string) => `${versionBase(versionId)}/reviews/${reviewId}/decision`, // decideConfigReview
  withdrawConfigReview: (versionId: string, reviewId: string) =>
    `${versionBase(versionId)}/reviews/${reviewId}/withdraw`, // withdrawConfigReview
  publishConfigVersion: (versionId: string) => `${versionBase(versionId)}/publish`, // publishConfigVersion
  rollbackConfigVersion: (versionId: string) => `${versionBase(versionId)}/rollback`, // rollbackConfigVersion
  reviewPolicies: `${v1}/admin/config-review-policies`, // listConfigReviewPolicies
  reviewPolicy: (configKind: string) => `${v1}/admin/config-review-policies/${seg(configKind)}`, // updateConfigReviewPolicy
  // studio: revision proposals and source coverage (ADR-0039 §8, §9)
  revisionProposals: `${v1}/admin/revision-proposals`, // listRevisionProposals
  sourceCoverage: `${v1}/admin/source-coverage`, // getSourceCoverage
  sourceCoverageRuns: `${v1}/admin/source-coverage/runs`, // runSourceCoverageCheck
  // studio: T06 scoring defaults (ADR-0040 §5)
  scoringDefaultsDraft: (versionId: string) => `${versionBase(versionId)}/scoring-defaults`, // putScoringDefaultsDraft
  scoringDefaults: `${v1}/admin/scoring-defaults`, // getScoringDefaults
  transformationScoringDefaults: (tid: string) => `${tBase(tid)}/scoring-defaults`, // getTransformationScoringDefaults
  // config-pins (ADR-0039 §3)
  configPins: (tid: string) => `${tBase(tid)}/config-pins`, // listTransformationConfigPins
  configPinHistory: (tid: string) => `${tBase(tid)}/config-pins/history`, // listConfigPinHistory
  // methodology-migrations (ADR-0040 §1-§4)
  methodologyMigrations: (tid: string) => `${tBase(tid)}/methodology-migrations`, // list/createMethodologyMigration
  methodologyMigration: (tid: string, migrationId: string) => migrationBase(tid, migrationId), // getMethodologyMigration
  previewMethodologyMigration: (tid: string, migrationId: string) => `${migrationBase(tid, migrationId)}/preview`, // previewMethodologyMigration
  submitMethodologyMigration: (tid: string, migrationId: string) => `${migrationBase(tid, migrationId)}/submit`, // submitMethodologyMigration
  decideMethodologyMigration: (tid: string, migrationId: string) => `${migrationBase(tid, migrationId)}/decision`, // decideMethodologyMigration
  executeMethodologyMigration: (tid: string, migrationId: string) => `${migrationBase(tid, migrationId)}/execute`, // executeMethodologyMigration
  withdrawMethodologyMigration: (tid: string, migrationId: string) => `${migrationBase(tid, migrationId)}/withdraw`, // withdrawMethodologyMigration
  gateReapprovals: (tid: string) => `${tBase(tid)}/gate-reapprovals`, // listGateReapprovals
  // forms: schemas (ADR-0041 §1-§4)
  formRecordTypes: `${v1}/admin/form-schemas`, // listFormRecordTypes
  formSchemaAdmin: (recordType: string) => `${v1}/admin/form-schemas/${seg(recordType)}`, // getFormSchemaAdmin
  transformationFormSchema: (tid: string, recordType: string) => `${tBase(tid)}/form-schemas/${seg(recordType)}`, // getTransformationFormSchema
  // forms: custom fields and the common form framework (ADR-0041 §5-§8)
  formCustomFields: (tid: string, recordType: string, recordId: string) =>
    `${formRecordBase(tid, recordType, recordId)}/custom-fields`, // get/putFormRecordCustomFields
  formRecordVersions: (tid: string, recordType: string, recordId: string) =>
    `${formRecordBase(tid, recordType, recordId)}/versions`, // listFormRecordVersions
  formRecordComments: (tid: string, recordType: string, recordId: string) =>
    `${formRecordBase(tid, recordType, recordId)}/comments`, // list/createFormRecordComment
  formRecordAttachments: (tid: string, recordType: string, recordId: string) =>
    `${formRecordBase(tid, recordType, recordId)}/attachments`, // listFormRecordAttachments, attachFormRecordEvidence
  removeFormRecordAttachment: (tid: string, recordType: string, recordId: string, attachmentId: string) =>
    `${formRecordBase(tid, recordType, recordId)}/attachments/${attachmentId}/remove`, // removeFormRecordAttachment
  exportFormRecords: (tid: string, recordType: string) => `${tBase(tid)}/form-records/${seg(recordType)}/export`, // exportFormRecords
  bulkUpdateFormRecords: (tid: string, recordType: string) => `${tBase(tid)}/form-records/${seg(recordType)}/bulk`, // bulkUpdateFormRecords
  formDrafts: (tid: string) => `${tBase(tid)}/form-drafts`, // list/createFormDraft
  formDraft: (tid: string, draftId: string) => `${tBase(tid)}/form-drafts/${draftId}`, // get/updateFormDraft
  closeFormDraft: (tid: string, draftId: string) => `${tBase(tid)}/form-drafts/${draftId}/close`, // closeFormDraft
  // procedures: definitions (ADR-0042 §1-§3)
  procedureDefinitions: `${v1}/procedure-definitions`, // listProcedureDefinitions
  validateProcedureDefinition: `${v1}/procedure-definitions/validate`, // validateProcedureDefinition
  procedureDefinition: (code: string) => `${v1}/procedure-definitions/${seg(code)}`, // getProcedureDefinition
  adminProcedureDefinition: (versionId: string, code: string) =>
    `${v1}/admin/procedure-definitions/${versionId}/${seg(code)}`, // putProcedureDefinition
  removeProcedureDefinition: (versionId: string, code: string) =>
    `${v1}/admin/procedure-definitions/${versionId}/${seg(code)}/remove`, // removeProcedureDefinition
  // procedures: instances and steps (ADR-0042 §4-§6)
  procedureInstances: `${v1}/procedure-instances`, // listProcedureInstances, launchProcedureInstance
  procedureInstance: (instanceId: string) => instanceBase(instanceId), // getProcedureInstance
  procedureInstanceInputs: (instanceId: string) => `${instanceBase(instanceId)}/inputs`, // updateProcedureInstanceInputs
  completeProcedureStep: (instanceId: string, stepKey: string) => `${stepBase(instanceId, stepKey)}/complete`, // completeProcedureStep
  skipProcedureStep: (instanceId: string, stepKey: string) => `${stepBase(instanceId, stepKey)}/skip`, // skipProcedureStep
  assignProcedureStep: (instanceId: string, stepKey: string) => `${stepBase(instanceId, stepKey)}/assign`, // assignProcedureStep
  linkProcedureStepEvidence: (instanceId: string, stepKey: string) => `${stepBase(instanceId, stepKey)}/evidence`, // linkProcedureStepEvidence
  cancelProcedureInstance: (instanceId: string) => `${instanceBase(instanceId)}/cancel`, // cancelProcedureInstance
  myProcedureSteps: `${v1}/me/procedure-steps`, // listMyProcedureSteps
  // procedures: the methodology coverage view (ADR-0042 §7)
  methodologyCoverage: `${v1}/admin/coverage`, // getMethodologyCoverage
};

// ------------------------------------------------------------------------------------------------ read hooks

const withVersion = (versionId: string | null): P5Query => (versionId ? { versionId } : {});

// Studio (methodology.read)
export function useConfigVersions(query: P5Query = {}, enabled = true) {
  return useQuery({
    queryKey: p5Keys.configVersions(query),
    queryFn: () => fetchAllPages<ConfigVersion>(p5Paths.configVersions, query),
    enabled,
    retry: shouldRetry,
  });
}
export function useConfigVersion(versionId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.configVersion(versionId ?? ""),
    queryFn: () => api.get<ConfigVersion>(p5Paths.configVersion(versionId ?? "")),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigElements(versionId: string | undefined, query: P5Query = {}) {
  return useQuery({
    queryKey: p5Keys.configElements(versionId ?? "", query),
    queryFn: () => fetchAllPages<ConfigElement>(p5Paths.configElements(versionId ?? ""), query),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigVersionDiff<T = unknown>(versionId: string | undefined, against: string | null = null) {
  return useQuery({
    queryKey: p5Keys.configDiff(versionId ?? "", against),
    queryFn: () => api.get<T>(p5Paths.configDiff(versionId ?? ""), against ? { against } : undefined),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigAffectedRecords<T = unknown>(versionId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.configAffectedRecords(versionId ?? ""),
    queryFn: () => api.get<T>(p5Paths.configAffectedRecords(versionId ?? "")),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigCheckRuns<T = unknown>(versionId: string | undefined, query: P5Query = {}) {
  return useQuery({
    queryKey: p5Keys.configCheckRuns(versionId ?? "", query),
    queryFn: () => fetchAllPages<T>(p5Paths.configCheckRuns(versionId ?? ""), query),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigReviews<T = unknown>(versionId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.configReviews(versionId ?? ""),
    queryFn: () => fetchAllPages<T>(p5Paths.configReviews(versionId ?? "")),
    enabled: Boolean(versionId),
    retry: shouldRetry,
  });
}
export function useConfigReviewPolicies<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: p5Keys.reviewPolicies,
    queryFn: async () => (await api.get<{ items: T[] }>(p5Paths.reviewPolicies)).items,
    enabled,
    retry: shouldRetry,
  });
}
export function useRevisionProposals<T = unknown>(query: P5Query = {}, enabled = true) {
  return useQuery({
    queryKey: p5Keys.revisionProposals(query),
    queryFn: () => fetchAllPages<T>(p5Paths.revisionProposals, query),
    enabled,
    retry: shouldRetry,
  });
}
export function useSourceCoverage<T = unknown>(versionId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: p5Keys.sourceCoverage(versionId),
    queryFn: () => api.get<T>(p5Paths.sourceCoverage, withVersion(versionId)),
    enabled,
    retry: shouldRetry,
  });
}
export function useScoringDefaults<T = unknown>(versionId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: p5Keys.scoringDefaults(versionId),
    queryFn: () => api.get<T>(p5Paths.scoringDefaults, withVersion(versionId)),
    enabled,
    retry: shouldRetry,
  });
}
export function useFormRecordTypes<T = unknown>(query: P5Query = {}, enabled = true) {
  return useQuery({
    queryKey: p5Keys.formRecordTypes(query),
    queryFn: async () => (await api.get<{ items: T[] }>(p5Paths.formRecordTypes, query)).items,
    enabled,
    retry: shouldRetry,
  });
}
export function useFormSchemaAdmin<T = unknown>(recordType: string | undefined, versionId: string | null = null) {
  return useQuery({
    queryKey: p5Keys.formSchemaAdmin(recordType ?? "", versionId),
    queryFn: () => api.get<T>(p5Paths.formSchemaAdmin(recordType ?? ""), withVersion(versionId)),
    enabled: Boolean(recordType),
    retry: shouldRetry,
  });
}
export function useMethodologyCoverage<T = unknown>(versionId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: p5Keys.methodologyCoverage(versionId),
    queryFn: () => api.get<T>(p5Paths.methodologyCoverage, withVersion(versionId)),
    enabled,
    retry: shouldRetry,
  });
}

// Configuration pins, scoring defaults and methodology migrations of one transformation
export function useConfigPins(tid: string) {
  return useQuery({
    queryKey: p5Keys.area("config-pins", tid),
    queryFn: async () => (await api.get<{ items: ConfigPin[] }>(p5Paths.configPins(tid))).items,
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useConfigPinHistory(tid: string) {
  return useQuery({
    queryKey: p5Keys.area("config-pins", tid, "history"),
    queryFn: () => fetchAllPages<ConfigPinHistoryEntry>(p5Paths.configPinHistory(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useTransformationScoringDefaults<T = unknown>(tid: string) {
  return useQuery({
    queryKey: p5Keys.area("scoring-defaults", tid),
    queryFn: () => api.get<T>(p5Paths.transformationScoringDefaults(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useMethodologyMigrations<T = unknown>(tid: string) {
  return useQuery({
    queryKey: p5Keys.area("methodology-migrations", tid),
    queryFn: () => fetchAllPages<T>(p5Paths.methodologyMigrations(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useMethodologyMigration<T = unknown>(tid: string, migrationId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("methodology-migrations", tid, migrationId ?? ""),
    queryFn: () => api.get<T>(p5Paths.methodologyMigration(tid, migrationId ?? "")),
    enabled: Boolean(tid && migrationId),
    retry: shouldRetry,
  });
}
export function useGateReapprovals<T = unknown>(tid: string) {
  return useQuery({
    queryKey: p5Keys.area("gate-reapprovals", tid),
    queryFn: () => fetchAllPages<T>(p5Paths.gateReapprovals(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

// Form schemas and the common form framework of one transformation
export function useTransformationFormSchema<T = unknown>(tid: string, recordType: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("form-schemas", tid, recordType ?? ""),
    queryFn: () => api.get<T>(p5Paths.transformationFormSchema(tid, recordType ?? "")),
    enabled: Boolean(tid && recordType),
    retry: shouldRetry,
  });
}
export function useFormCustomFields<T = unknown>(tid: string, recordType: string, recordId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("form-records", tid, recordType, recordId ?? "", "custom-fields"),
    queryFn: () => api.get<T>(p5Paths.formCustomFields(tid, recordType, recordId ?? "")),
    enabled: Boolean(tid && recordId),
    retry: shouldRetry,
  });
}
export function useFormRecordVersions<T = unknown>(tid: string, recordType: string, recordId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("form-records", tid, recordType, recordId ?? "", "versions"),
    queryFn: () => fetchAllPages<T>(p5Paths.formRecordVersions(tid, recordType, recordId ?? "")),
    enabled: Boolean(tid && recordId),
    retry: shouldRetry,
  });
}
export function useFormRecordComments<T = unknown>(tid: string, recordType: string, recordId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("form-records", tid, recordType, recordId ?? "", "comments"),
    queryFn: () => fetchAllPages<T>(p5Paths.formRecordComments(tid, recordType, recordId ?? "")),
    enabled: Boolean(tid && recordId),
    retry: shouldRetry,
  });
}
export function useFormRecordAttachments<T = unknown>(
  tid: string,
  recordType: string,
  recordId: string | undefined,
  includeRemoved = false,
) {
  const query: P5Query = includeRemoved ? { includeRemoved: "true" } : {};
  return useQuery({
    queryKey: p5Keys.area("form-records", tid, recordType, recordId ?? "", "attachments", includeRemoved ? 1 : 0),
    queryFn: () => fetchAllPages<T>(p5Paths.formRecordAttachments(tid, recordType, recordId ?? ""), query),
    enabled: Boolean(tid && recordId),
    retry: shouldRetry,
  });
}
export function useFormDrafts<T = unknown>(tid: string, query: P5Query = {}) {
  return useQuery({
    queryKey: p5Keys.area("form-drafts", tid, JSON.stringify(query)),
    queryFn: () => fetchAllPages<T>(p5Paths.formDrafts(tid), query),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useFormDraft<T = unknown>(tid: string, draftId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.area("form-drafts", tid, "draft", draftId ?? ""),
    queryFn: () => api.get<T>(p5Paths.formDraft(tid, draftId ?? "")),
    enabled: Boolean(tid && draftId),
    retry: shouldRetry,
  });
}

// Procedures
export function useProcedureDefinitions<T = unknown>(query: P5Query = {}, enabled = true) {
  return useQuery({
    queryKey: p5Keys.procedureDefinitions(query),
    queryFn: () => fetchAllPages<T>(p5Paths.procedureDefinitions, query),
    enabled,
    retry: shouldRetry,
  });
}
export function useProcedureDefinition<T = unknown>(code: string | undefined, versionId: string | null = null) {
  return useQuery({
    queryKey: p5Keys.procedureDefinition(code ?? "", versionId),
    queryFn: () => api.get<T>(p5Paths.procedureDefinition(code ?? ""), withVersion(versionId)),
    enabled: Boolean(code),
    retry: shouldRetry,
  });
}
export function useProcedureInstances<T = unknown>(query: P5Query = {}, enabled = true) {
  return useQuery({
    queryKey: p5Keys.procedureInstances(query),
    queryFn: () => fetchAllPages<T>(p5Paths.procedureInstances, query),
    enabled,
    retry: shouldRetry,
  });
}
export function useProcedureInstance<T = unknown>(instanceId: string | undefined) {
  return useQuery({
    queryKey: p5Keys.procedureInstance(instanceId ?? ""),
    queryFn: () => api.get<T>(p5Paths.procedureInstance(instanceId ?? "")),
    enabled: Boolean(instanceId),
    retry: shouldRetry,
  });
}
export function useMyProcedureSteps<T = unknown>(query: P5Query = {}) {
  return useQuery({
    queryKey: p5Keys.myProcedureSteps(query),
    queryFn: () => fetchAllPages<T>(p5Paths.myProcedureSteps, query),
    retry: shouldRetry,
  });
}
