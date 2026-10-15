// The 25 Transformation Health Check questions (P5 slice H; ADR-0048 §5, §7; REQ-PB-091; p5-work-split §H.3;
// T-DG5-KBE-G):
//   GET /health-check-questions   listHealthCheckQuestions   (any signed-in user)
//
// The questions are the `source_element` rows of set `health_question` (0064), keys q01-q25 in B0150 order, rendered
// verbatim (D-142 Q5), e.g. "Are 3-5 business outcomes measurable?" with the source's hyphen. The Arabic texts are
// provisional translations. A scheme changes scoring, never the questions (ADR-0048 alternative 2). Read-only.
import type { DbOrTx } from "@mth/db";
import type { HealthCheckQuestion, HealthCheckQuestionList } from "@mth/shared/calc";
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

export const HEALTH_CHECK_QUESTIONS = "/api/v1/health-check-questions";
/** The source_element set of the 25 questions (0064). */
export const HEALTH_QUESTION_SET = "health_question";

/** The 25 questions in B0150 order. */
export async function loadHealthCheckQuestions(db: DbOrTx): Promise<HealthCheckQuestion[]> {
  const rows = await db
    .selectFrom("source_element")
    .select(["stable_key", "ordinal", "source_label_en", "label_ar", "source_ref"])
    .where("set_code", "=", HEALTH_QUESTION_SET)
    .orderBy("ordinal")
    .execute();
  return rows.map((r) => ({
    code: r.stable_key,
    ordinal: r.ordinal,
    textEn: r.source_label_en,
    textAr: r.label_ar,
    sourceRef: r.source_ref,
  }));
}

/** Registers the questions read and returns it as "METHOD /path". */
export function registerHealthQuestionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    HEALTH_CHECK_QUESTIONS,
    { config: { access: { permission: "authenticated" } } },
    async (): Promise<HealthCheckQuestionList> => ({ items: await loadHealthCheckQuestions(db) }),
  );
  return [`GET ${HEALTH_CHECK_QUESTIONS}`];
}
