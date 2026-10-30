// Health-check scoring schemes (P5 slice H; ADR-0048 §5, §6, §9, §10; REQ-S14-003; p5-work-split §H.3; T-DG5-KBE-G):
//   GET /admin/health-check-schemes                     listHealthCheckSchemes  (any signed-in user)
//   GET /admin/health-check-schemes/{schemeVersionId}   getHealthCheckScheme    (any signed-in user)
//
// A scheme is a PUBLISHED configuration version of kind `health_check_scheme` (ADR-0039): its definition (score basis,
// question count, the implementation-assumption flag) and its non-removed `health_response` and `health_band`
// elements. Drafts are authored, previewed, reviewed and published through the Studio operations (the provider in
// provider.ts refuses an invalid scheme first, with the §9 codes); a draft, retired or discarded version, or a version
// of another kind, is 404 here. Scheme v1 (key `health-check`, Yes = 1, No = 0, out of 25, the four B0152 bands
// verbatim) is an implementation assumption (M0262, D-010) and says so (`implementationAssumption: true`).
// Read-only; nothing here writes. A scoring scheme is configuration, not a business approval.
import type { DbOrTx } from "@mth/db";
import {
  healthSchemeProblem,
  isYesNoPointsScheme,
  type HealthBandElement,
  type HealthCheckBand,
  type HealthCheckResponseOption,
  type HealthCheckScheme,
  type HealthCheckSchemeList,
  type HealthResponseElement,
  type HealthSchemeInput,
  type HealthSchemeProblem,
} from "@mth/shared/calc";
import { Decimal } from "decimal.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  iso,
  keysetPage,
  pageQueryFields,
  parse,
  parseQuery,
  problems,
  type HttpProblem,
  type ModuleDeps,
  type PageRequest,
  type SortKey,
} from "../platform/index.ts";

export const HEALTH_CHECK_SCHEMES = "/api/v1/admin/health-check-schemes";
export const HEALTH_CHECK_SCHEME_KIND = "health_check_scheme";
/** The key whose version 1 an unpinned transformation's assessment uses (ADR-0048 §5; ADR-0039 §3). */
export const HEALTH_CHECK_DEFAULT_KEY = "health-check";

const schemeParams = z.strictObject({ schemeVersionId: z.uuid() });
const schemeListQuery = z.strictObject({ ...pageQueryFields });
/** The schemes' page sort (T-DG6-BE-V): key, version number, then the version id. */
const SCHEME_SORT: readonly SortKey[] = [
  { name: "key", type: "text" },
  { name: "version_no", type: "integer" },
  { name: "id", type: "uuid" },
];

/**
 * The ADR-0048 §9 refusal of each `p5_health_scheme_problem` result (exact codes and English texts).
 * `health_scheme_definition` has no §9 row; its code and text are proposed in the KBE-G handback (shared rule 15).
 */
export const HEALTH_SCHEME_REFUSALS: ReadonlyMap<HealthSchemeProblem, readonly [string, string]> = new Map<
  HealthSchemeProblem,
  readonly [string, string]
>([
  [
    "health_scheme_definition",
    [
      "health_scheme.definition_invalid",
      "A scheme's definition needs a score basis (points or percent of the applicable questions) and 25 questions.",
    ],
  ],
  ["health_scheme_yes_no_required", ["health_scheme.yes_no_required", "A scheme keeps Yes = 1 and No = 0."]],
  [
    "health_scheme_credit",
    ["health_scheme.credit_invalid", "Partial credit is a decimal between 0 and 1; N/A has no credit."],
  ],
  [
    "health_scheme_na_needs_percent",
    ["health_scheme.na_needs_percent", "A scheme with N/A scores as a percentage of the applicable questions."],
  ],
  [
    "health_scheme_bands_invalid",
    [
      "health_scheme.bands_invalid",
      "Bands need one band starting at 0 and distinct starting scores within the maximum score.",
    ],
  ],
  [
    "health_scheme_own_bands_required",
    [
      "health_scheme.own_bands_required",
      "A scheme with partial credit or N/A needs its own interpretation bands; the four source bands cannot be reused.",
    ],
  ],
]);

/** The 422 of a scheme publish-rule result. */
export function healthSchemeRefusal(problem: HealthSchemeProblem): HttpProblem {
  const refusal = HEALTH_SCHEME_REFUSALS.get(problem);
  if (refusal === undefined) return problems.internal();
  return problems.businessRule(refusal[0], refusal[1]);
}

/** One stored element of a scheme version (removed rows included; the shared rules ignore them). */
export interface SchemeElementRow {
  readonly elementType: string;
  readonly stableKey: string;
  readonly origin: "source" | "admin";
  readonly removed: boolean;
  readonly ordinal: number | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** A scheme version with its elements, as the shared rules and the reads need it. */
export interface LoadedHealthScheme {
  readonly id: string;
  readonly key: string;
  readonly versionNo: number;
  readonly status: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly definition: unknown;
  readonly publishedAt: Date | null;
  readonly elements: readonly SchemeElementRow[];
  /** The shared-function input (responses and bands of the stored rows). */
  readonly input: HealthSchemeInput;
}

const attributesOf = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The shared-function input of a version's element rows. */
export function schemeInputOf(definition: unknown, elements: readonly SchemeElementRow[]): HealthSchemeInput {
  const responses: HealthResponseElement[] = [];
  const bands: HealthBandElement[] = [];
  for (const e of elements) {
    const a = new Map(Object.entries(e.attributes));
    if (e.elementType === "health_response")
      responses.push({ key: e.stableKey, credit: a.has("credit") ? a.get("credit") : undefined, removed: e.removed });
    else if (e.elementType === "health_band")
      bands.push({ key: e.stableKey, origin: e.origin, minScore: a.get("minScore"), removed: e.removed });
  }
  return { definition, responses, bands };
}

/** The publish-rule result of a version (null when it may be published), from its stored rows. */
export async function schemeProblemOf(db: DbOrTx, versionId: string): Promise<HealthSchemeProblem | null> {
  const scheme = await loadHealthScheme(db, versionId);
  return scheme === null ? null : healthSchemeProblem(scheme.input);
}

/** A version of kind health_check_scheme with every element row, or null (any status; callers filter). */
export async function loadHealthScheme(db: DbOrTx, versionId: string): Promise<LoadedHealthScheme | null> {
  const v = await db
    .selectFrom("methodology_version")
    .select(["id", "key", "version_no", "status", "title_en", "title_ar", "definition", "published_at"])
    .where("id", "=", versionId)
    .where("config_kind", "=", HEALTH_CHECK_SCHEME_KIND)
    .executeTakeFirst();
  if (v === undefined) return null;
  const rows = await db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "origin", "removed", "ordinal", "attributes"])
    .where("methodology_version_id", "=", versionId)
    .where("element_type", "in", ["health_response", "health_band"])
    .execute();
  const elements = rows.map(
    (r): SchemeElementRow => ({
      elementType: r.element_type,
      stableKey: r.stable_key,
      origin: r.origin === "source" ? "source" : "admin",
      removed: r.removed,
      ordinal: r.ordinal,
      attributes: attributesOf(r.attributes),
    }),
  );
  return {
    id: v.id,
    key: v.key,
    versionNo: v.version_no,
    status: v.status,
    titleEn: v.title_en,
    titleAr: v.title_ar,
    definition: v.definition,
    publishedAt: v.published_at,
    elements,
    input: schemeInputOf(v.definition, elements),
  };
}

const RESPONSE_ORDER = new Map(["yes", "no", "partial", "na"].map((k, i) => [k, i]));
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A stored minScore as a decimal for ordering (the element guard makes it a decimal string; anything else sorts as 0). */
const decimalOf = (v: unknown): Decimal =>
  typeof v === "string" && /^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(v) ? new Decimal(v) : new Decimal(0);

/** The API body of a published scheme (decimals as strings; responses in yes/no/partial/na order). */
export function toHealthCheckScheme(s: LoadedHealthScheme): HealthCheckScheme {
  const active = s.elements.filter((e) => !e.removed);
  const responses = active
    .filter((e) => e.elementType === "health_response")
    .sort((a, b) => (RESPONSE_ORDER.get(a.stableKey) ?? 9) - (RESPONSE_ORDER.get(b.stableKey) ?? 9))
    .map((e): HealthCheckResponseOption => {
      const a = new Map(Object.entries(e.attributes));
      return {
        key: e.stableKey as HealthCheckResponseOption["key"],
        credit: str(a.get("credit")),
        labelEn: str(a.get("labelEn")),
        labelAr: str(a.get("labelAr")),
      };
    });
  const bands = active
    .filter((e) => e.elementType === "health_band")
    .map((e) => ({ e, a: new Map(Object.entries(e.attributes)) }))
    .sort((x, y) => decimalOf(y.a.get("minScore")).comparedTo(decimalOf(x.a.get("minScore"))))
    .map(
      ({ e, a }): HealthCheckBand => ({
        key: e.stableKey,
        minScore: str(a.get("minScore")) ?? "0",
        rangeLabel: str(a.get("rangeLabel")) ?? "",
        textEn: str(a.get("textEn")) ?? "",
        textAr: str(a.get("textAr")) ?? "",
        origin: e.origin,
      }),
    );
  const d = new Map(Object.entries(attributesOf(s.definition)));
  const basis = d.get("scoreBasis") === "percent_of_applicable" ? "percent_of_applicable" : "points";
  return {
    versionId: s.id,
    key: s.key,
    versionNo: s.versionNo,
    titleEn: s.titleEn,
    titleAr: s.titleAr,
    scoreBasis: basis,
    questionCount: Number(d.get("questionCount") ?? 25),
    // Every scoring method is an implementation choice: the playbook gives checkboxes and a total only (M0262).
    implementationAssumption: d.get("implementationAssumption") === true || isYesNoPointsScheme(s.input),
    responses,
    bands,
    publishedAt: iso(s.publishedAt ?? new Date(0)),
  };
}

/** One page of the published schemes, by key then version number (cursor-paged: ADR-0007 §4a, T-DG6-BE-V). */
export async function listPublishedHealthSchemes(db: DbOrTx, page: PageRequest): Promise<HealthCheckSchemeList> {
  const q = db
    .selectFrom("methodology_version")
    .select("id")
    .where("config_kind", "=", HEALTH_CHECK_SCHEME_KIND)
    .where("status", "=", "published");
  const ids = await keysetPage(q, SCHEME_SORT, page, { list: "health-check-schemes" });
  const items: HealthCheckScheme[] = [];
  for (const { id } of ids.items) {
    const s = await loadHealthScheme(db, id);
    if (s !== null) items.push(toHealthCheckScheme(s));
  }
  return { items, nextCursor: ids.nextCursor };
}

/** Registers the two scheme reads and returns them as "METHOD /path". */
export function registerHealthSchemeRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const session = { access: { permission: "authenticated" as const } };
  app.get(HEALTH_CHECK_SCHEMES, { config: session }, async (request) =>
    listPublishedHealthSchemes(db, parseQuery(schemeListQuery, request.query)),
  );
  app.get(`${HEALTH_CHECK_SCHEMES}/:schemeVersionId`, { config: session }, async (request) => {
    const { schemeVersionId } = parse(schemeParams, request.params, "params");
    const s = await loadHealthScheme(db, schemeVersionId);
    if (s === null || s.status !== "published") throw problems.notFound();
    return toHealthCheckScheme(s);
  });
  return [`GET ${HEALTH_CHECK_SCHEMES}`, `GET ${HEALTH_CHECK_SCHEMES}/:schemeVersionId`];
}
