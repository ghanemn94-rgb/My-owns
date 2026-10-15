// The `health_check_scheme` configuration kind's provider (ADR-0048 §6, §9, §10; ADR-0039 §1-§5; ADR-0040 §2;
// REQ-S14-003; p5-work-split §H.3; T-DG5-KBE-G). Registered into methodology's ConfigKindProvider registry by one line
// in server.ts (methodology imports no P5 module), with default key `health-check` (v1, ADR-0039 §3 "never the
// latest"). The hooks refuse an invalid scheme BEFORE the database does, with the exact §9 codes:
//  - validateElement (Studio putConfigElement): a response key outside yes/no/partial/na, or a source band outside the
//    four B0152 keys -> 422 config_version.unknown_element; Yes other than "1" or No other than "0" -> 422
//    health_scheme.yes_no_required; a partial credit not strictly between 0 and 1, or an N/A with a credit -> 422
//    health_scheme.credit_invalid.
//  - validateRemove: removing Yes or No -> 422 health_scheme.yes_no_required.
//  - preview: the draft's whole scheme runs through the publish rule of `@mth/shared/calc` (`healthSchemeProblem`, the
//    mirror of p5_health_scheme_problem) first; a failing scheme answers 422 with its §9 code (e.g.
//    health_scheme.own_bands_required for N/A with the four source bands), records no passing preview, and so cannot be
//    published (422 config_version.preview_required). Samples `{kind: "record", recordType: "health_assessment",
//    input: {answers: {q01: "yes", ...}}}` are then scored with the draft (completion, score, maximum and band; null
//    while incomplete, never 0).
//  - compatibility: the same rule as a `fail` finding with the §9 code, so a draft previewed without samples (the
//    sandbox calls the preview hook only with samples, preview.ts) still cannot be published
//    (422 config_version.compatibility_failed). The publish guard (0086 health_scheme_publish_guard) is the backstop;
//    its constraint names map to the same §9 codes in platform/db-errors.ts.
//  - affectedRecords: per pinned transformation, the count of its DRAFT health assessments (a submitted assessment
//    keeps its scheme version, score and band forever; a draft keeps its scheme too, ADR-0048 §6).
//  - migrationItems (ADR-0040 §2): one `invalidated_calculation` item per draft assessment of the transformation; it
//    keeps the scheme it was created under (never re-scored), and the item says so.
// Configuration only: publishing a scheme approves nothing in the business and touches no engineering gate DG0-DG7.
import type { DbOrTx } from "@mth/db";
import {
  HEALTH_QUESTION_CODES,
  HEALTH_RESPONSE_KEYS,
  HEALTH_SOURCE_BAND_KEYS,
  healthAssessmentResult,
  healthResponseAllowed,
  healthSchemeProblem,
  type HealthSchemeInput,
} from "@mth/shared/calc";
import { Decimal } from "decimal.js";
import {
  registerConfigKindProvider,
  type AffectedRecordCount,
  type CompatibilityFinding,
  type PreviewOutcome,
} from "../methodology/index.ts";
import { problems } from "../platform/index.ts";
import { HEALTH_CHECK_DEFAULT_KEY, healthSchemeRefusal, loadHealthScheme, type LoadedHealthScheme } from "./schemes.ts";

/** The recordType of a health-check sample in the preview sandbox. */
export const HEALTH_ASSESSMENT_SAMPLE = "health_assessment";

const RESPONSE_KEYS: ReadonlySet<string> = new Set(HEALTH_RESPONSE_KEYS);
const SOURCE_BANDS: ReadonlySet<string> = new Set(HEALTH_SOURCE_BAND_KEYS);
const QUESTION_CODES: ReadonlySet<string> = new Set(HEALTH_QUESTION_CODES);
const PARTIAL_CREDIT = /^0\.[0-9]{1,2}$/;

const unknownElement = () =>
  problems.businessRule("config_version.unknown_element", "This element does not exist in the methodology.");

async function validateElement(
  _db: DbOrTx,
  input: {
    readonly elementType: string;
    readonly stableKey: string;
    readonly origin: "source" | "admin";
    readonly attributes: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const a = new Map(Object.entries(input.attributes));
  if (input.elementType === "health_response") {
    if (!RESPONSE_KEYS.has(input.stableKey)) throw unknownElement();
    const credit = a.has("credit") ? a.get("credit") : undefined;
    if ((input.stableKey === "yes" && credit !== "1") || (input.stableKey === "no" && credit !== "0"))
      throw healthSchemeRefusal("health_scheme_yes_no_required");
    if (
      input.stableKey === "partial" &&
      !(typeof credit === "string" && PARTIAL_CREDIT.test(credit) && new Decimal(credit).greaterThan(0))
    )
      throw healthSchemeRefusal("health_scheme_credit");
    if (input.stableKey === "na" && credit !== null) throw healthSchemeRefusal("health_scheme_credit");
    return;
  }
  if (input.elementType === "health_band" && input.origin === "source" && !SOURCE_BANDS.has(input.stableKey))
    throw unknownElement();
}

async function validateRemove(
  _db: DbOrTx,
  input: { readonly elementType: string; readonly stableKey: string },
): Promise<void> {
  if (input.elementType === "health_response" && (input.stableKey === "yes" || input.stableKey === "no"))
    throw healthSchemeRefusal("health_scheme_yes_no_required");
}

async function compatibility(db: DbOrTx, input: { readonly versionId: string }): Promise<CompatibilityFinding[]> {
  const scheme = await loadHealthScheme(db, input.versionId);
  const problem = scheme === null ? null : healthSchemeProblem(scheme.input);
  if (problem === null) return [];
  return [
    { severity: "fail", code: healthSchemeRefusal(problem).code, elementType: null, stableKey: null, params: {} },
  ];
}

/** The sample's answers ({questionCode: responseKey}), or null when it is not a health-check sample. */
function sampleAnswers(raw: unknown): Map<string, string> | null {
  const s = new Map(Object.entries((raw ?? {}) as Record<string, unknown>));
  if (s.get("kind") !== "record" || s.get("recordType") !== HEALTH_ASSESSMENT_SAMPLE) return null;
  const input = s.get("input");
  if (input === null || typeof input !== "object" || Array.isArray(input)) return new Map([["", ""]]);
  const answers = new Map(Object.entries(input as Record<string, unknown>)).get("answers");
  if (answers === null || typeof answers !== "object" || Array.isArray(answers)) return new Map([["", ""]]);
  const out = new Map<string, string>();
  for (const [q, r] of Object.entries(answers as Record<string, unknown>)) out.set(q, typeof r === "string" ? r : "");
  return out;
}

function scoreSample(scheme: LoadedHealthScheme, input: HealthSchemeInput, answers: Map<string, string>) {
  if ([...answers.keys()].some((q) => !QUESTION_CODES.has(q)))
    return { result: "fail", code: "preview.sample_invalid" };
  if ([...answers.values()].some((r) => !healthResponseAllowed(input, r)))
    return { result: "fail", code: "health_check.response_not_allowed" };
  const r = healthAssessmentResult(input, [...answers.values()]);
  const band =
    r.bandKey === null
      ? null
      : scheme.elements.find((e) => e.elementType === "health_band" && !e.removed && e.stableKey === r.bandKey);
  const a = new Map(Object.entries(band?.attributes ?? {}));
  return {
    result: "pass",
    completion: r.completion,
    computable: r.computable,
    score: r.score,
    scoreMax: r.scoreMax,
    band:
      band === undefined || band === null
        ? null
        : { key: band.stableKey, rangeLabel: a.get("rangeLabel"), textEn: a.get("textEn"), textAr: a.get("textAr") },
  };
}

async function preview(
  db: DbOrTx,
  input: { readonly versionId: string; readonly samples: unknown },
): Promise<PreviewOutcome> {
  const scheme = await loadHealthScheme(db, input.versionId);
  if (scheme === null) throw problems.notFound();
  // The publish rule first: a scheme the database would refuse to publish never records a passing preview.
  const problem = healthSchemeProblem(scheme.input);
  if (problem !== null) throw healthSchemeRefusal(problem);
  const samples = Array.isArray(input.samples) ? (input.samples as unknown[]) : [];
  const results: Record<string, unknown>[] = [];
  for (const [index, raw] of samples.entries()) {
    const kind = new Map(Object.entries((raw ?? {}) as Record<string, unknown>)).get("kind");
    const answers = sampleAnswers(raw);
    if (answers === null) {
      results.push({ index, kind, result: "fail", code: "preview.not_available" });
      continue;
    }
    results.push({ index, kind, recordType: HEALTH_ASSESSMENT_SAMPLE, ...scoreSample(scheme, scheme.input, answers) });
  }
  const failed = results.filter((r) => r["result"] === "fail").length;
  return { result: failed === 0 ? "pass" : "fail", report: { evaluated: results.length, failed, results } };
}

/** Draft assessments per transformation (the only assessments a scheme change could concern; none is re-scored). */
async function draftCounts(db: DbOrTx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("health_assessment")
    .select(["transformation_id", (eb) => eb.fn.countAll<string>().as("n")])
    .where("transformation_id", "in", [...ids])
    .where("status", "=", "draft")
    .groupBy("transformation_id")
    .execute();
  return new Map(rows.map((r) => [r.transformation_id, Number(r.n)]));
}

async function affectedRecords(
  db: DbOrTx,
  input: { readonly transformationIds: readonly string[] },
): Promise<AffectedRecordCount[]> {
  const counts = await draftCounts(db, input.transformationIds);
  return input.transformationIds.map((transformationId) => ({
    transformationId,
    recordType: "health_assessment",
    count: counts.get(transformationId) ?? 0,
    unknownReason: null,
  }));
}

async function migrationItems(
  db: DbOrTx,
  input: { readonly transformationId: string; readonly fromVersionId: string; readonly toVersionId: string },
): Promise<Record<string, unknown>[]> {
  const drafts = await db
    .selectFrom("health_assessment")
    .select(["id", "sequence_no", "scheme_version_id"])
    .where("transformation_id", "=", input.transformationId)
    .where("status", "=", "draft")
    .orderBy("sequence_no")
    .execute();
  return drafts.map((d) => ({
    itemKind: "invalidated_calculation",
    elementType: null,
    stableKey: null,
    recordType: "health_assessment",
    recordId: d.id,
    resolution: "acknowledged",
    detail: {
      assessmentId: d.id,
      sequenceNo: d.sequence_no,
      schemeVersionId: d.scheme_version_id,
      fromVersionId: input.fromVersionId,
      toVersionId: input.toVersionId,
      // ADR-0048 §6: an assessment keeps the scheme it was created under; only later assessments use the new pin.
      keepsScheme: true,
    },
  }));
}

/** Registers the health_check_scheme hooks and its default key (idempotent replacement; one line in server.ts). */
export function registerHealthCheckSchemeProvider(): void {
  registerConfigKindProvider("health_check_scheme", {
    defaultKey: HEALTH_CHECK_DEFAULT_KEY,
    validateElement,
    validateRemove,
    compatibility,
    affectedRecords,
    preview,
    migrationItems,
  });
}
