// The `scoring_defaults` configuration kind's provider hooks (REQ-PB-093; ADR-0040 §2, §5; ADR-0039 §2, §5, §12;
// p5-work-split §A.1 "scoring_defaults ... registered by KBE-A", §A.6; T-DG5-KBE-A).
//  - preview: a sample `{ kind: "record", recordType: "t06_score", input: { scores: { <criterion>: 1..5 } } }` is
//    scored with the draft's weights through the DG3 engine unchanged (weightedScore of @mth/shared/calc: decimal,
//    Σ score × weight / 100). A draft whose weights do not total 100 % over 2-6 criteria cannot score, so such a
//    sample fails with the DG3 problem code (the publish rule itself is 422 config_version.weights_total). Any other
//    sample fails with a reason, never a silent pass.
//  - affectedRecords: a change of the default weights or rubric changes NO existing record: a transformation's T06
//    weight set is its own approved record and is never rewritten (ADR-0040 §5), so each pinned transformation's count
//    of `scoring_weight_set` records touched is exactly 0 (a computed count, not an Unknown).
//  - migrationItems: a scoring_defaults migration reports no new_required_field and no invalidated_calculation
//    (ADR-0040 §2: its elements hold no record fields and no formulas; the transformation's weight set is untouched),
//    so the provider contributes no item (BE-C's generic items still apply).
// The weights and rubric attribute shapes are the Zod schemas of @mth/shared (studio.ts); the API refuses first, the
// 0062 guards back it. Configuration only: nothing here approves a weight set (that stays a Sponsor decision, DG3).
import type { DbOrTx } from "@mth/db";
import { ScoringInputError, weightedScore, type CriterionWeight } from "@mth/shared/calc";
import { SCORING_DEFAULT_CRITERIA } from "@mth/shared/schemas";
import { z } from "zod";
import { registerConfigKindProvider, type AffectedRecordCount, type PreviewOutcome } from "../kinds.ts";

/** The recordType of a T06 scoring sample in the preview sandbox. */
export const T06_SCORE_SAMPLE = "t06_score";

const scoreSample = z.strictObject({
  scores: z.partialRecord(z.enum(SCORING_DEFAULT_CRITERIA), z.number().int().min(1).max(5).nullable()),
});

/** The criterion order of the T06 scorecard (B0076, then B0077's risk/compliance). */
const CANONICAL = new Map<string, number>(SCORING_DEFAULT_CRITERIA.map((c, i) => [c, i]));

/** The version's weights (not removed), in element order: ordinal, then the canonical criterion order. */
export async function versionWeights(db: DbOrTx, versionId: string): Promise<CriterionWeight[]> {
  const rows = await db
    .selectFrom("methodology_element")
    .select(["stable_key", "ordinal", "attributes"])
    .where("methodology_version_id", "=", versionId)
    .where("element_type", "=", "scoring_weight")
    .where("removed", "=", false)
    .execute();
  return rows
    .map((r) => ({
      criterionCode: r.stable_key,
      ordinal: r.ordinal,
      weightPercent: String((r.attributes as { weightPercent?: unknown }).weightPercent ?? ""),
    }))
    .sort(
      (a, b) =>
        (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
        (CANONICAL.get(a.criterionCode) ?? 99) - (CANONICAL.get(b.criterionCode) ?? 99),
    )
    .map(({ criterionCode, weightPercent }) => ({ criterionCode, weightPercent }));
}

async function preview(
  db: DbOrTx,
  input: { readonly versionId: string; readonly samples: unknown },
): Promise<PreviewOutcome> {
  const samples = Array.isArray(input.samples) ? (input.samples as unknown[]) : [];
  const weights = await versionWeights(db, input.versionId);
  const results: Record<string, unknown>[] = [];
  for (const [index, raw] of samples.entries()) {
    const s = new Map(Object.entries((raw ?? {}) as Record<string, unknown>));
    const kind = s.get("kind");
    if (kind !== "record" || s.get("recordType") !== T06_SCORE_SAMPLE) {
      results.push({ index, kind, result: "fail", code: "preview.not_available" });
      continue;
    }
    const parsed = scoreSample.safeParse(s.get("input"));
    if (!parsed.success) {
      results.push({ index, kind, recordType: T06_SCORE_SAMPLE, result: "fail", code: "preview.sample_invalid" });
      continue;
    }
    try {
      const scored = weightedScore(parsed.data.scores, weights);
      results.push({
        index,
        kind,
        recordType: T06_SCORE_SAMPLE,
        result: "pass",
        completeness: scored.completeness,
        weightedScore: scored.weightedScore,
        missingCriteria: [...scored.missingCriteria],
        inputs: { ...scored.inputs },
      });
    } catch (e) {
      if (!(e instanceof ScoringInputError)) throw e;
      results.push({ index, kind, recordType: T06_SCORE_SAMPLE, result: "fail", code: e.code });
    }
  }
  const failed = results.filter((r) => r["result"] === "fail").length;
  return { result: failed === 0 ? "pass" : "fail", report: { evaluated: results.length, failed, results } };
}

function affectedRecords(
  _db: DbOrTx,
  input: { readonly transformationIds: readonly string[] },
): Promise<AffectedRecordCount[]> {
  return Promise.resolve(
    input.transformationIds.map((transformationId) => ({
      transformationId,
      recordType: "scoring_weight_set",
      count: 0,
      unknownReason: null,
    })),
  );
}

function migrationItems(): Promise<Record<string, unknown>[]> {
  return Promise.resolve([]);
}

/** Registers the scoring_defaults kind's hooks (idempotent; called when the scoring-defaults routes register). */
export function registerScoringDefaultsKindProvider(): void {
  registerConfigKindProvider("scoring_defaults", { preview, affectedRecords, migrationItems });
}
