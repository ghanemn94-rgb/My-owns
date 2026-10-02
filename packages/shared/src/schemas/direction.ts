// P2 direction mirrors (backend-workflow-engineer; ADR-0017): North Star (one sentence, exactly one current),
// strategic guardrails and the outcome tree. Mirrors docs/api/openapi.yaml NorthStar*, StrategicGuardrail*, Outcome*,
// GoodOutcomeResult.
import { z } from "zod";
import { reason, timestamp, uuid, version } from "./common.ts";

const text = (min: number, max: number) => z.string().min(min).max(max);
const nullableUuid = uuid.nullable();
const minOne = <T extends z.ZodRawShape>(shape: T) =>
  z
    .strictObject(shape)
    .partial()
    .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

/** Identity, archive and version fields every P2 register row carries. */
export const p2RecordStamps = {
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
};
export const p2ArchiveFields = {
  archivedAt: timestamp.nullable(),
  archivedBy: nullableUuid,
  archiveReason: reason.nullable(),
};

// ------------------------------------------------------------------------------------------------ North Star

/** One sentence: 1-300 characters, no line break, at most one sentence terminator (ADR-0017 §3). */
export const northStarStatement = text(1, 300)
  .regex(/^[^\r\n]+$/, "validation.single_line")
  .refine((s) => (s.trim().match(/[.!?؟。](?=\s|$)/g) ?? []).length <= 1, "validation.single_sentence");

export const northStar = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  statement: text(1, 300),
  status: z.enum(["current", "superseded"]),
  supersededAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type NorthStar = z.infer<typeof northStar>;
export const northStarWrite = z.strictObject({ statement: northStarStatement });
export const northStarPage = z.strictObject({ items: z.array(northStar), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ guardrails

export const GUARDRAIL_CATEGORIES = ["regulatory", "cx", "capex", "risk", "brand", "other"] as const;
const guardrailFields = {
  title: text(1, 200),
  category: z.enum(GUARDRAIL_CATEGORIES),
  statement: text(1, 4000),
  ownerUserId: nullableUuid,
};
export const strategicGuardrail = z.strictObject({
  ...p2RecordStamps,
  ...guardrailFields,
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type StrategicGuardrail = z.infer<typeof strategicGuardrail>;
export const strategicGuardrailCreate = z.strictObject({ ...guardrailFields, ownerUserId: nullableUuid.optional() });
export const strategicGuardrailUpdate = minOne(guardrailFields);
export const strategicGuardrailPage = z.strictObject({
  items: z.array(strategicGuardrail),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ outcomes

const outcomeFields = {
  parentOutcomeId: nullableUuid,
  statement: text(1, 500),
  description: text(1, 4000).nullable(),
  ownerUserId: nullableUuid,
  isTopOutcome: z.boolean(),
  topRank: z.number().int().min(1).max(99).nullable(),
  specificConfirmed: z.boolean().nullable(),
  strategicallyRelevantConfirmed: z.boolean().nullable(),
  causalChain: text(1, 4000).nullable(),
};
/** One evaluated good-outcome-test criterion (B0051, REQ-PB-036); computed server-side, never written by a client. */
export const GOOD_OUTCOME_RESULTS = ["pass", "fail", "unknown"] as const;
export const goodOutcomeResult = z.strictObject({
  criterionCode: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  ordinal: z.number().int().min(1).max(5),
  result: z.enum(GOOD_OUTCOME_RESULTS),
  reason: text(1, 500).nullable(),
});
export type GoodOutcomeResult = z.infer<typeof goodOutcomeResult>;

export const outcome = z.strictObject({
  ...p2RecordStamps,
  ...outcomeFields,
  // Computed read fields (not in OutcomeCreate/OutcomeUpdate): true only when no criterion fails and none is unknown.
  goodOutcomeTest: z.array(goodOutcomeResult),
  goodOutcomePass: z.boolean(),
  status: z.enum(["draft", "active", "archived"]),
  ...p2ArchiveFields,
});
export type Outcome = z.infer<typeof outcome>;
export const outcomeCreate = z
  .strictObject(outcomeFields)
  .partial()
  .required({ statement: true })
  .refine((o) => o.topRank === undefined || o.topRank === null || o.isTopOutcome === true, {
    message: "validation.top_rank_requires_top_outcome",
    path: ["topRank"],
  });
export const outcomeUpdate = minOne(outcomeFields);
export const outcomePage = z.strictObject({ items: z.array(outcome), nextCursor: z.string().nullable() });
