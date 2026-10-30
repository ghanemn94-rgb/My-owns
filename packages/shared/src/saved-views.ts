// The saved-view list registry (P6 slice H; ADR-0057 §4, §5; REQ-S15-010 "saved views", REQ-S15-013 "persist column
// choices in saved views"; T-DG6-BE-Q, p6-work-split §H/G.3). Imported by the API (validation of a view's keys) and
// the web client (the columns, filter chips and sorts a list offers) through the `@mth/shared` root (re-exported by
// index.ts; dependency-free, so no new package subpath).
//
// Per list key (the closed set of `saved_view.list_key`, 0108):
//   - columns: the column keys a view may show, exactly the properties of the list operation's item schema in
//     docs/api/openapi.yaml (for `search`, the SearchHit properties);
//   - filters: the filter keys with their value format, exactly the operation's query parameters other than cursor,
//     limit and sort (ADR-0057 §5); `multiple` where the parameter is a repeatable array;
//   - sorts: the sort keys (the direction travels separately as asc|desc). For listInitiatives and
//     listTransformations exactly the ADR-0057 §5 enum without its "-" prefix; for the 9 register-kit lists the keys
//     the contract's RegisterSort pattern leaves to `RegisterSpec.sortColumns` (BE-R implements exactly these);
//     `search` offers none (relevance order).
// The registry test (apps/api/test/integration/search/saved-views.test.ts) reads the contract and asserts the columns
// and filters, and the sorts of the two enumerated lists.
//
// A view grants no data: applying it only sets the list's own query parameters, which the list then filters by its
// own read rules (ADR-0057 §4). Filter values are strings; a date or a decimal travels as a string and is parsed by
// the list's own rules (ADR-0057 §11), never as a binary float. Nothing here approves anything (G1-G6) or touches
// DG0-DG7.

export const SAVED_VIEW_LIST_KEYS = [
  "transformations",
  "initiatives",
  "strategic_guardrails",
  "outcomes",
  "diagnostic_items",
  "diagnostic_findings",
  "workstream_outputs",
  "tom_gaps",
  "capability_heatmap",
  "journeys",
  "journey_pain_points",
  "search",
] as const;
export type SavedViewListKey = (typeof SAVED_VIEW_LIST_KEYS)[number];

/** The value format of a filter (each value is a string of 1-200 characters, ADR-0057 §4). */
export type SavedViewFilterFormat =
  | { readonly kind: "uuid" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "text"; readonly maxLength: number }
  | { readonly kind: "boolean" }
  | { readonly kind: "isoDate" }
  | { readonly kind: "decimal" };

export interface SavedViewFilterSpec {
  readonly key: string;
  readonly format: SavedViewFilterFormat;
  /** The list parameter is repeatable: the view may hold an array of values (1-20). */
  readonly multiple: boolean;
}

export interface SavedViewListSpec {
  readonly listKey: SavedViewListKey;
  /** The contract operation the view's parameters apply to. */
  readonly operationId: string;
  /** True when the list lives inside one transformation (its path carries transformationId). */
  readonly transformationScoped: boolean;
  readonly columns: readonly string[];
  readonly filters: readonly SavedViewFilterSpec[];
  readonly sorts: readonly string[];
}

const UUID: SavedViewFilterFormat = { kind: "uuid" };
const BOOLEAN: SavedViewFilterFormat = { kind: "boolean" };
const TEXT: SavedViewFilterFormat = { kind: "text", maxLength: 200 };
const one = (key: string, format: SavedViewFilterFormat): SavedViewFilterSpec => ({ key, format, multiple: false });
const many = (key: string, format: SavedViewFilterFormat): SavedViewFilterSpec => ({ key, format, multiple: true });

/** The archive stamps every register-kit row carries, after its own columns. */
const REGISTER_TAIL = [
  "status",
  "archivedAt",
  "archivedBy",
  "archiveReason",
  "version",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;
const REGISTER_HEAD = ["id", "organizationId", "transformationId"] as const;
const register = (cols: readonly string[]): readonly string[] => [...REGISTER_HEAD, ...cols, ...REGISTER_TAIL];
/** The 9 register-kit lists: q (the spec's searchColumns), includeArchived where the list offers it. */
const REGISTER_FILTERS = [one("includeArchived", BOOLEAN), one("q", TEXT)] as const;
const REGISTER_SORT_TAIL = ["status", "createdAt", "updatedAt"] as const;

const TRANSFORMATION_STATUSES = ["draft", "active", "on_hold", "closed"] as const;
const TRANSFORMATION_MODES = ["end_to_end", "modular"] as const;
const PHASES = ["diagnose", "define", "design", "mobilize", "transform", "realize"] as const;
const INITIATIVE_STATUSES = [
  "draft",
  "submitted",
  "ranked",
  "selected",
  "funded",
  "launched",
  "completed",
  "cancelled",
] as const;
const SEARCH_RECORD_TYPES = [
  "transformation",
  "initiative",
  "kpi_definition",
  "benefit",
  "raid_entry",
  "dependency",
  "decision",
  "deliverable",
  "evidence",
  "business_case",
  "lesson",
  "change_request",
] as const;

const SPECS: readonly SavedViewListSpec[] = [
  {
    listKey: "transformations",
    operationId: "listTransformations",
    transformationScoped: false,
    columns: [
      "id",
      "organizationId",
      "businessUnitId",
      "code",
      "name",
      "description",
      "mode",
      "entryPhase",
      "standaloneDeliverableType",
      "status",
      "currentPhase",
      "sponsorUserId",
      "leadUserId",
      "timezone",
      "currency",
      "archivedAt",
      "archiveReason",
      "version",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy",
    ],
    filters: [
      one("organizationId", UUID),
      one("businessUnitId", UUID),
      many("status", { kind: "enum", values: TRANSFORMATION_STATUSES }),
      one("mode", { kind: "enum", values: TRANSFORMATION_MODES }),
      one("phase", { kind: "enum", values: PHASES }),
      one("q", TEXT),
      one("includeArchived", BOOLEAN),
    ],
    sorts: ["updatedAt", "code"],
  },
  {
    listKey: "initiatives",
    operationId: "listInitiatives",
    transformationScoped: false,
    columns: [
      "id",
      "organizationId",
      "transformationId",
      "code",
      "name",
      "executiveOwnerUserId",
      "workstreamLeadUserId",
      "problemStatement",
      "objective",
      "scopeIn",
      "scopeOut",
      "financialBenefitSummary",
      "customerBenefitSummary",
      "risksSummary",
      "waveId",
      "plannedStart",
      "plannedEnd",
      "status",
      "fundingState",
      "displayStatus",
      "launchedAt",
      "launchedBy",
      "cancelledAt",
      "cancelledBy",
      "cancelReason",
      "warnings",
      "flags",
      "version",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy",
    ],
    filters: [
      one("transformationId", UUID),
      one("status", { kind: "enum", values: INITIATIVE_STATUSES }),
      one("waveId", UUID),
      one("q", TEXT),
      one("executiveOwnerUserId", UUID),
      one("workstreamLeadUserId", UUID),
    ],
    sorts: ["updatedAt", "code", "name", "plannedEnd"],
  },
  {
    listKey: "strategic_guardrails",
    operationId: "listStrategicGuardrails",
    transformationScoped: true,
    columns: register(["title", "category", "statement", "ownerUserId"]),
    filters: REGISTER_FILTERS,
    sorts: ["title", "category", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "outcomes",
    operationId: "listOutcomes",
    transformationScoped: true,
    columns: register([
      "parentOutcomeId",
      "statement",
      "description",
      "ownerUserId",
      "isTopOutcome",
      "topRank",
      "specificConfirmed",
      "strategicallyRelevantConfirmed",
      "causalChain",
      "goodOutcomeTest",
      "goodOutcomePass",
    ]),
    filters: REGISTER_FILTERS,
    sorts: ["statement", "topRank", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "diagnostic_items",
    operationId: "listDiagnosticItems",
    transformationScoped: true,
    columns: register([
      "dimensionCode",
      "isSeeded",
      "currentState",
      "evidenceBaseline",
      "baselineId",
      "rootCause",
      "impactText",
      "impactAmount",
      "impactCurrency",
      "impactKpiDefinitionId",
      "confidence",
      "ownerUserId",
    ]),
    filters: REGISTER_FILTERS,
    sorts: ["dimensionCode", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "diagnostic_findings",
    operationId: "listDiagnosticFindings",
    transformationScoped: true,
    columns: register([
      "workstreamCode",
      "diagnosticItemId",
      "kind",
      "statement",
      "detail",
      "confidence",
      "ownerUserId",
    ]),
    filters: REGISTER_FILTERS,
    sorts: ["workstreamCode", "kind", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "workstream_outputs",
    operationId: "listWorkstreamOutputs",
    transformationScoped: true,
    columns: register(["workstreamCode", "title", "outputKind", "recordType", "recordId", "evidenceId", "note"]),
    filters: REGISTER_FILTERS,
    sorts: ["workstreamCode", "title", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "tom_gaps",
    operationId: "listTomGaps",
    transformationScoped: true,
    columns: register(["dimensionCode", "currentState", "targetState", "gap", "designDecisionId", "ownerUserId"]),
    filters: REGISTER_FILTERS,
    sorts: ["dimensionCode", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "capability_heatmap",
    operationId: "listCapabilityHeatmapEntries",
    transformationScoped: true,
    columns: register([
      "name",
      "description",
      "dimensionCode",
      "currentLevel",
      "targetLevel",
      "sourcingNeed",
      "ownerUserId",
      "tomGapId",
    ]),
    filters: REGISTER_FILTERS,
    sorts: ["name", "dimensionCode", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "journeys",
    operationId: "listJourneies",
    transformationScoped: true,
    columns: register([
      "name",
      "kind",
      "state",
      "description",
      "dimensionCode",
      "steps",
      "cycleTimeValue",
      "cycleTimeUnit",
      "failureDemand",
      "ownerUserId",
    ]),
    filters: REGISTER_FILTERS,
    sorts: ["name", "kind", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "journey_pain_points",
    operationId: "listJourneyPainPoints",
    transformationScoped: true,
    columns: register(["journeyId", "stepKey", "description", "diagnosticItemId"]),
    // listJourneyPainPoints has no includeArchived parameter (the contract): q only.
    filters: [one("q", TEXT)],
    sorts: ["stepKey", ...REGISTER_SORT_TAIL],
  },
  {
    listKey: "search",
    operationId: "searchRecords",
    transformationScoped: false,
    columns: [
      "recordType",
      "recordId",
      "recordVersion",
      "transformationId",
      "transformationCode",
      "transformationName",
      "code",
      "title",
      "summary",
      "recordStatus",
      "isArchived",
    ],
    filters: [
      one("q", TEXT),
      many("recordType", { kind: "enum", values: SEARCH_RECORD_TYPES }),
      one("transformationId", UUID),
      one("includeArchived", BOOLEAN),
    ],
    sorts: [],
  },
];

/** The registry, by list key (frozen). */
export const SAVED_VIEW_LISTS: Readonly<Record<SavedViewListKey, SavedViewListSpec>> = Object.freeze(
  Object.fromEntries(SPECS.map((s) => [s.listKey, Object.freeze(s)])) as Record<SavedViewListKey, SavedViewListSpec>,
);

export function isSavedViewListKey(value: unknown): value is SavedViewListKey {
  return typeof value === "string" && (SAVED_VIEW_LIST_KEYS as readonly string[]).includes(value);
}

/** A view's configurable parts (as stored in `saved_view`). */
export interface SavedViewConfig {
  readonly columns: readonly string[];
  readonly filters: Readonly<Record<string, string | readonly string[]>>;
  readonly sort: readonly { readonly key: string; readonly direction: "asc" | "desc" }[];
}

/** A key the list does not offer, with its JSON pointer into the request body. */
export interface SavedViewUnknownKey {
  readonly key: string;
  readonly pointer: string;
}

/**
 * The first column, filter or sort key of `config` that the list does not offer (ADR-0057 §4: 422
 * `saved_view.unknown_key` naming the key), or null when every key is offered. Columns first, then filters, then sorts.
 */
export function savedViewUnknownKey(listKey: SavedViewListKey, config: SavedViewConfig): SavedViewUnknownKey | null {
  const spec = SAVED_VIEW_LISTS[listKey];
  const columns = new Set(spec.columns);
  for (const [i, key] of config.columns.entries()) if (!columns.has(key)) return { key, pointer: `/columns/${i}` };
  const filters = new Set(spec.filters.map((f) => f.key));
  for (const key of Object.keys(config.filters)) if (!filters.has(key)) return { key, pointer: `/filters/${key}` };
  const sorts = new Set(spec.sorts);
  for (const [i, s] of config.sort.entries()) if (!sorts.has(s.key)) return { key: s.key, pointer: `/sort/${i}/key` };
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,10})?$/;

function valueFits(format: SavedViewFilterFormat, value: string): boolean {
  switch (format.kind) {
    case "uuid":
      return UUID_PATTERN.test(value);
    case "enum":
      return format.values.includes(value);
    case "text":
      return value.trim().length > 0 && [...value].length <= format.maxLength;
    case "boolean":
      return value === "true" || value === "false";
    case "isoDate":
      return ISO_DATE_PATTERN.test(value);
    case "decimal":
      return DECIMAL_PATTERN.test(value);
  }
}

/** A filter value that does not fit its key's format, with its JSON pointer into the request body. */
export interface SavedViewFilterValueError {
  readonly key: string;
  readonly pointer: string;
  readonly expected: SavedViewFilterFormat["kind"] | "single";
}

/**
 * The first filter value of `filters` that does not fit its (offered) key's value format, or an array for a key that
 * is not repeatable; null when every value fits. Call it after `savedViewUnknownKey` returned null.
 */
export function savedViewFilterValueError(
  listKey: SavedViewListKey,
  filters: SavedViewConfig["filters"],
): SavedViewFilterValueError | null {
  const byKey = new Map(SAVED_VIEW_LISTS[listKey].filters.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(filters)) {
    const spec = byKey.get(key);
    if (spec === undefined) continue;
    if (typeof value === "string") {
      if (!valueFits(spec.format, value)) return { key, pointer: `/filters/${key}`, expected: spec.format.kind };
      continue;
    }
    if (!spec.multiple) return { key, pointer: `/filters/${key}`, expected: "single" };
    for (const [i, v] of value.entries())
      if (!valueFits(spec.format, v)) return { key, pointer: `/filters/${key}/${i}`, expected: spec.format.kind };
  }
  return null;
}
