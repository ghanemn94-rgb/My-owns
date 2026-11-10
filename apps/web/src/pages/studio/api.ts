// Playbook Studio web seams (T-DG5-FE-B; p5-plan §5.1 row FE-B; ADR-0039, ADR-0040 §5): typed hooks over FE-A's
// `api/p5.ts` read hooks and paths, plus the pure helpers the Studio screens share. Writes are sent by the screens with
// `api.send` (If-Match from the record's `version`), inside a session guard (auth/sessionBound.ts).
//
// Unknown is data, never a default: a check that has not run is "Not run", and a run over an older content hash is
// "Stale" — neither is ever shown as passed. A Studio version is configuration, not a business approval: nothing here
// grants or records a G1-G6 decision, and nothing touches the engineering delivery gates DG0-DG7.
import type {
  ConfigAffectedRecords,
  ConfigCheckKind,
  ConfigCheckRun,
  ConfigElement,
  ConfigKind,
  ConfigReviewPolicy,
  ConfigReviewRequest,
  ConfigVersion,
  ConfigVersionDiff,
  RevisionProposal,
  ScoringDefaults,
  SourceCoverageReport,
} from "@mth/shared/schemas";
import {
  useConfigAffectedRecords,
  useConfigCheckRuns,
  useConfigReviewPolicies,
  useConfigReviews,
  useConfigVersionDiff,
  useRevisionProposals,
  useScoringDefaults,
  useSourceCoverage,
  type P5Query,
} from "../../api/p5.ts";

export type {
  ConfigAffectedRecords,
  ConfigCheckKind,
  ConfigCheckRun,
  ConfigElement,
  ConfigKind,
  ConfigReviewPolicy,
  ConfigReviewRequest,
  ConfigVersion,
  ConfigVersionDiff,
  RevisionProposal,
  ScoringDefaults,
  SourceCoverageReport,
};

/** The i18n namespace prefix of every Studio, migration and source-coverage text. */
export const STUDIO_NS = ["studio"] as const;

// ------------------------------------------------------------------------------------------------ typed reads

export const useVersionDiff = (versionId: string | undefined, against: string | null = null) =>
  useConfigVersionDiff<ConfigVersionDiff>(versionId, against);
export const useAffectedRecords = (versionId: string | undefined) =>
  useConfigAffectedRecords<ConfigAffectedRecords>(versionId);
export const useCheckRuns = (versionId: string | undefined, query: P5Query = {}) =>
  useConfigCheckRuns<ConfigCheckRun>(versionId, query);
export const useReviews = (versionId: string | undefined) => useConfigReviews<ConfigReviewRequest>(versionId);
export const useReviewPolicies = (enabled = true) => useConfigReviewPolicies<ConfigReviewPolicy>(enabled);
export const useProposals = (query: P5Query = {}, enabled = true) =>
  useRevisionProposals<RevisionProposal>(query, enabled);
export const useCoverage = (versionId: string | null = null, enabled = true) =>
  useSourceCoverage<SourceCoverageReport>(versionId, enabled);
export const useDefaults = (versionId: string | null = null, enabled = true) =>
  useScoringDefaults<ScoringDefaults>(versionId, enabled);

// ------------------------------------------------------------------------------------------------ version state

/**
 * The one state of a version the screens show: a draft stage (editing, preview, review, approved, discarded), or
 * published / retired. A draft is never presented as published (REQ-S15-011).
 */
export type VersionState =
  | "editing"
  | "preview"
  | "review"
  | "approved"
  | "discarded"
  | "published"
  | "newest_published"
  | "retired";

export function versionState(v: Pick<ConfigVersion, "status" | "draftStage" | "isNewestPublished">): VersionState {
  if (v.status === "published") return v.isNewestPublished ? "newest_published" : "published";
  if (v.status === "retired") return "retired";
  return v.draftStage ?? "editing";
}

/** True while the draft's content can still be changed (editing or preview; ADR-0039 §4). */
export const isEditableDraft = (v: Pick<ConfigVersion, "status" | "draftStage">): boolean =>
  v.status === "draft" && (v.draftStage === "editing" || v.draftStage === "preview");

/** True while the draft is open (not discarded, not published). */
export const isOpenDraft = (v: Pick<ConfigVersion, "status" | "draftStage">): boolean =>
  v.status === "draft" && v.draftStage !== "discarded";

// ------------------------------------------------------------------------------------------------ check status

/** What a check means for the CURRENT content: its result, or that it has not run, or that it ran on older content. */
export type CheckStatus = "pass" | "warn" | "fail" | "not_run" | "stale";

/** The check kinds shown on a version, in the order of the publish pipeline (ADR-0039 §5, §6). */
export const VERSION_CHECKS: readonly ConfigCheckKind[] = ["preview", "compatibility", "source_coverage"];

/**
 * The newest run of `kind` and its status against the version's current content hash. A run over another hash is
 * "stale" (it never satisfies publish, ADR-0039 §5); no run is "not_run". Never "pass" by default.
 */
export function checkStatusOf(
  runs: readonly ConfigCheckRun[] | undefined,
  kind: ConfigCheckKind,
  contentSha256: string,
): { status: CheckStatus; run: ConfigCheckRun | null } {
  const ofKind = (runs ?? []).filter((r) => r.checkKind === kind);
  if (ofKind.length === 0) return { status: "not_run", run: null };
  const newest = ofKind.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  if (newest.contentSha256 !== contentSha256) return { status: "stale", run: newest };
  return { status: newest.result, run: newest };
}

// ------------------------------------------------------------------------------------------------ elements

/** The editable text attributes of every element type (ADR-0039 §2 `common`), plus the long body of a text. */
export const TEXT_ATTRIBUTES = ["labelEn", "labelAr", "helpEn", "helpAr"] as const;
export const BODY_ATTRIBUTES = ["bodyEn", "bodyAr"] as const;

/** A string attribute of an element (version row first, then the catalogue), or "" when none. */
export function attrText(e: Pick<ConfigElement, "attributes" | "catalogueAttributes">, name: string): string {
  const own = e.attributes[name];
  if (typeof own === "string") return own;
  const cat = e.catalogueAttributes[name];
  return typeof cat === "string" ? cat : "";
}

/**
 * The element's label in the reader's language, falling back to the other language, then to its stable key
 * (F-DG5-120, ADR-0061 §9). English: `labelEn`, then the seeded `sourceLabelEn` (the `0062` v1 rows carry only
 * `sourceLabelEn` and `labelAr`), and only then `labelAr`. Arabic: `labelAr` first, then `labelEn`, then `sourceLabelEn`.
 */
export function elementLabel(
  e: Pick<ConfigElement, "attributes" | "catalogueAttributes" | "stableKey">,
  locale: "ar" | "en",
): string {
  const order = locale === "ar" ? ["labelAr", "labelEn", "sourceLabelEn"] : ["labelEn", "sourceLabelEn", "labelAr"];
  for (const name of order) {
    const text = attrText(e, name);
    if (text) return text;
  }
  return e.stableKey;
}

/** A value of a diff row or an attribute, as short readable text ("—" is never used for a missing value). */
export function displayValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // T-DG5-FE-G2: a list of codes (an approver route's ordered roles, a layout's sections) reads in order, "BO · SP".
  if (Array.isArray(value) && value.every((x) => typeof x === "string" || typeof x === "number"))
    return value.length === 0 ? null : value.map(String).join(" · ");
  return JSON.stringify(value);
}

/** One level of a scoring rubric (ADR-0039 §2 `scoring_rubric.levels`): a 1-5 score and its two descriptors. */
export interface RubricLevel {
  readonly score: number;
  readonly descriptorEn: string | null;
  readonly descriptorAr: string | null;
}

/** A rubric level whose descriptors differ from the base version's: before (null: absent) and after. */
export interface RubricLevelChange {
  readonly score: number;
  readonly from: RubricLevel | null;
  readonly to: RubricLevel | null;
}

function rubricLevels(value: unknown): RubricLevel[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: RubricLevel[] = [];
  for (const x of value) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? null : undefined);
    const en = text(o["descriptorEn"]);
    const ar = text(o["descriptorAr"]);
    if (typeof o["score"] !== "number" || en === undefined || ar === undefined) return null;
    out.push({ score: o["score"], descriptorEn: en, descriptorAr: ar });
  }
  return out;
}

/**
 * The levels of a rubric diff field that changed (F-DG5-121, ADR-0061 §9): "changed" means the level's value differs
 * from the base version's, so an unchanged level is not listed. Null when either side is not a list of rubric levels
 * (the caller then shows the value as it is).
 */
export function rubricLevelChanges(from: unknown, to: unknown): RubricLevelChange[] | null {
  const before = rubricLevels(from);
  const after = rubricLevels(to);
  if (before === null || after === null) return null;
  const scores = [...new Set([...before, ...after].map((l) => l.score))].sort((a, b) => a - b);
  const changes: RubricLevelChange[] = [];
  for (const score of scores) {
    const b = before.find((l) => l.score === score) ?? null;
    const a = after.find((l) => l.score === score) ?? null;
    if (b && a && b.descriptorEn === a.descriptorEn && b.descriptorAr === a.descriptorAr) continue;
    changes.push({ score, from: b, to: a });
  }
  return changes;
}

/** The role-code pattern the Studio accepts for an approver (ADR-0039 §2 `roleCodeRef`). */
export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

/** The decimal sum of weight strings with two decimals, computed in hundredths (never floats). Null if any is invalid. */
export function weightTotal(weights: readonly string[]): string | null {
  let hundredths = 0n;
  for (const w of weights) {
    const m = /^([0-9]{1,3})(?:\.([0-9]{1,2}))?$/.exec(w.trim());
    if (!m) return null;
    hundredths += BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  }
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
