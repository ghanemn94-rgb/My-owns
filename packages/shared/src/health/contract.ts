// The zod mirrors of the three slice H read bodies KBE-G serves (docs/api/openapi.yaml `HealthCheckQuestionList`,
// `HealthCheckScheme`, `HealthCheckSchemeList`; ADR-0048 §5-§6; p5-work-split §H.3; T-DG5-KBE-G). They live beside the
// scoring functions because `packages/shared/src/schemas/health.ts` is KBE-G2's file (p5-work-split §H.4), which may
// re-export them from there. Decimals are strings, never floats (ADR-0048 §10).
import { z } from "zod";
import { timestamp, uuid } from "../schemas/common.ts";
import { DECIMAL_PATTERN } from "../value.ts";
import { HEALTH_RESPONSE_KEYS, HEALTH_SCORE_BASES } from "./scoring.ts";

const decimal = z.string().regex(DECIMAL_PATTERN, "validation.decimal");

/** One of the 25 B0150 questions, verbatim (the Arabic text is a provisional translation). */
export const healthCheckQuestion = z.strictObject({
  code: z.string(),
  ordinal: z.number().int(),
  textEn: z.string(),
  textAr: z.string(),
  sourceRef: z.string(),
});
export type HealthCheckQuestion = z.infer<typeof healthCheckQuestion>;
export const healthCheckQuestionList = z.strictObject({ items: z.array(healthCheckQuestion) });
export type HealthCheckQuestionList = z.infer<typeof healthCheckQuestionList>;

export const healthCheckResponseOption = z.strictObject({
  key: z.enum(HEALTH_RESPONSE_KEYS),
  credit: decimal.nullable(),
  labelEn: z.string().nullable(),
  labelAr: z.string().nullable(),
});
export type HealthCheckResponseOption = z.infer<typeof healthCheckResponseOption>;

export const healthCheckBand = z.strictObject({
  key: z.string(),
  minScore: decimal,
  rangeLabel: z.string(),
  textEn: z.string(),
  textAr: z.string(),
  origin: z.enum(["source", "admin"]),
});
export type HealthCheckBand = z.infer<typeof healthCheckBand>;

export const healthCheckScheme = z.strictObject({
  versionId: uuid,
  key: z.string(),
  versionNo: z.number().int(),
  titleEn: z.string(),
  titleAr: z.string(),
  scoreBasis: z.enum(HEALTH_SCORE_BASES),
  questionCount: z.number().int(),
  implementationAssumption: z.boolean(),
  responses: z.array(healthCheckResponseOption).max(4),
  bands: z.array(healthCheckBand).max(20),
  publishedAt: timestamp,
});
export type HealthCheckScheme = z.infer<typeof healthCheckScheme>;
export const healthCheckSchemeList = z.strictObject({ items: z.array(healthCheckScheme) });
export type HealthCheckSchemeList = z.infer<typeof healthCheckSchemeList>;
