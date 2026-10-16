// Unit tests of the health-check assessments (T-DG5-KBE-G2; ADR-0048 §5, §9; p5-work-split §H.4): the registered routes,
// the exact §9 refusal codes and English texts (from the API and from the database guard mapping alike), the zod
// mirrors of the request bodies, and the worked scoring fixtures the submission writes (score, maximum and band from
// the shared decimal functions; incomplete is null, never 0). The database-backed behaviour is in
// test/integration/health/assessments.test.ts and s16-021-group.test.ts. All data is synthetic.
import { healthAssessmentResult, type HealthSchemeInput } from "@mth/shared/calc";
import { healthCheckActionsPut, healthCheckAnswerPut, healthCheckCreate, healthCheckUpdate } from "@mth/shared/schemas";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError, type HttpProblem, type ModuleDeps } from "../platform/index.ts";
import {
  ACTIONS_REQUIRED,
  DRAFT_EXISTS,
  INCOMPLETE,
  NOT_COMPUTABLE,
  NOT_DRAFT,
  RESPONSE_NOT_ALLOWED,
} from "./assessments.ts";
import { registerHealthModule } from "./index.ts";

const T = "/api/v1/transformations/:transformationId/health-checks";

describe("health-check assessment routes (T-DG5-KBE-G2)", () => {
  it("registers the seven assessment operations after KBE-G's three reads", async () => {
    const app = Fastify({ logger: false });
    try {
      expect(registerHealthModule(app, {} as ModuleDeps).routes).toEqual([
        "GET /api/v1/health-check-questions",
        "GET /api/v1/admin/health-check-schemes",
        "GET /api/v1/admin/health-check-schemes/:schemeVersionId",
        `GET ${T}`,
        `POST ${T}`,
        `GET ${T}/:assessmentId`,
        `PATCH ${T}/:assessmentId`,
        `PUT ${T}/:assessmentId/answers/:questionCode`,
        `PUT ${T}/:assessmentId/actions`,
        `POST ${T}/:assessmentId/submit`,
      ]);
    } finally {
      await app.close();
    }
  });
});

const pg = (constraint: string, code = "23514") => ({ code, constraint });
const view = (p: HttpProblem | null) => (p === null ? null : [p.status, p.code, p.detail]);

describe("ADR-0048 §9 health_check refusals: exact codes and English texts", () => {
  const SECTION_9: [() => HttpProblem, number, string, string][] = [
    [DRAFT_EXISTS, 409, "health_check.draft_exists", "This transformation already has a health check in progress."],
    [INCOMPLETE, 422, "health_check.incomplete", "Answer all 25 questions before submitting the health check."],
    [ACTIONS_REQUIRED, 422, "health_check.actions_required", "Submit the health check with its top 3 actions."],
    [NOT_DRAFT, 422, "health_check.not_draft", "Only a health check in progress can be changed or submitted."],
    [
      RESPONSE_NOT_ALLOWED,
      422,
      "health_check.response_not_allowed",
      "This response is not allowed by the health check's scoring scheme.",
    ],
    [NOT_COMPUTABLE, 422, "health_check.not_computable", "No question is applicable, so no score can be computed."],
  ];
  it.each(SECTION_9)("%#: the API refusal", (make, status, code, detail) => {
    expect(view(make())).toEqual([status, code, detail]);
  });

  it("maps the 0086 guards a request can reach to the same codes; the unreachable ones to 500", () => {
    const same = (constraint: string, make: () => HttpProblem, sqlstate?: string) =>
      expect(view(mapDatabaseGuardError(pg(constraint, sqlstate))), constraint).toEqual(view(make()));
    same("health_assessment_one_draft_key", DRAFT_EXISTS, "23505");
    same("health_assessment_sequence_key", DRAFT_EXISTS, "23505");
    same("health_assessment_submitted_final", NOT_DRAFT);
    same("health_assessment_answer_draft_only", NOT_DRAFT);
    same("health_assessment_action_draft_only", NOT_DRAFT);
    same("health_assessment_answer_response_allowed", RESPONSE_NOT_ALLOWED);
    same("health_assessment_three_actions", ACTIONS_REQUIRED);
    same("health_assessment_incomplete", INCOMPLETE);
    for (const c of ["health_assessment_answer_evidence_fkey", "health_assessment_action_improvement_fkey"]) {
      const p = mapDatabaseGuardError(pg(c, "23503"));
      expect([p?.status, p?.code], c).toEqual([422, "validation.reference"]);
    }
    for (const c of [
      "health_assessment_score_matches",
      "health_assessment_scheme_published",
      "health_assessment_previous_submitted",
      "health_assessment_created_draft",
      "health_assessment_scheme_fixed",
      "health_assessment_submitted_complete",
      "health_assessment_answered_count",
      "health_assessment_answer_key",
      "health_assessment_answer_identity_fixed",
      "health_assessment_action_rank_key",
      "health_assessment_action_identity_fixed",
    ])
      expect(mapDatabaseGuardError(pg(c))?.status, c).toBe(500);
  });
});

describe("request bodies (zod mirrors of the OpenAPI components)", () => {
  it("HealthCheckCreate / HealthCheckUpdate: business dates, owner, at least one property", () => {
    expect(healthCheckCreate.safeParse({ assessmentDate: "2026-10-16" }).success).toBe(true);
    expect(healthCheckCreate.safeParse({ assessmentDate: "2026-02-30" }).success).toBe(false);
    expect(healthCheckCreate.safeParse({ assessmentDate: "2026-10-16", extra: 1 }).success).toBe(false);
    expect(healthCheckUpdate.safeParse({}).success).toBe(false);
    expect(healthCheckUpdate.safeParse({ ownerUserId: null }).success).toBe(false);
    expect(healthCheckUpdate.safeParse({ assessmentDate: "2026-10-17" }).success).toBe(true);
  });

  it("HealthCheckAnswerPut: the four response keys only; free text through the shared rules", () => {
    for (const response of ["yes", "no", "partial", "na"])
      expect(healthCheckAnswerPut.safeParse({ response }).success).toBe(true);
    expect(healthCheckAnswerPut.safeParse({ response: "maybe" }).success).toBe(false);
    expect(healthCheckAnswerPut.safeParse({ response: "yes", evidenceNote: "   " }).success).toBe(false);
    expect(healthCheckAnswerPut.safeParse({ response: "yes", actionNote: "x".repeat(1001) }).success).toBe(false);
    expect(healthCheckAnswerPut.safeParse({ response: "yes", evidenceNote: null }).success).toBe(true);
  });

  it("HealthCheckActionsPut: one to three actions, ranks 1-3, distinct", () => {
    const a = (rank: number) => ({ rank, actionText: `Synthetic action ${rank}` });
    expect(healthCheckActionsPut.safeParse({ actions: [a(1), a(2), a(3)] }).success).toBe(true);
    expect(healthCheckActionsPut.safeParse({ actions: [a(3)] }).success).toBe(true);
    expect(healthCheckActionsPut.safeParse({ actions: [] }).success).toBe(false);
    expect(healthCheckActionsPut.safeParse({ actions: [a(1), a(1)] }).success).toBe(false);
    expect(healthCheckActionsPut.safeParse({ actions: [a(4)] }).success).toBe(false);
    expect(healthCheckActionsPut.safeParse({ actions: [a(1), a(2), a(3), a(1)] }).success).toBe(false);
    expect(healthCheckActionsPut.safeParse({ actions: [{ rank: 1, actionText: " " }] }).success).toBe(false);
  });
});

// Worked fixtures of what a submission writes under scheme v1 (Yes = 1, No = 0, the four B0152 bands; ADR-0048 §5).
const V1: HealthSchemeInput = {
  definition: { scoreBasis: "points", questionCount: 25 },
  responses: [
    { key: "yes", credit: "1" },
    { key: "no", credit: "0" },
  ],
  bands: [
    { key: "b0152_21_25", origin: "source", minScore: "21" },
    { key: "b0152_16_20", origin: "source", minScore: "16" },
    { key: "b0152_10_15", origin: "source", minScore: "10" },
    { key: "b0152_0_9", origin: "source", minScore: "0" },
  ],
};
const answers = (yes: number, total = 25) => Array.from({ length: total }, (_, i) => (i < yes ? "yes" : "no"));

describe("worked scoring fixtures (REQ-S14-001, REQ-S14-002, REQ-PB-092)", () => {
  it("17 Yes of 25 -> score 17 out of 25, band 16-20", () => {
    expect(healthAssessmentResult(V1, answers(17))).toMatchObject({
      score: "17",
      scoreMax: "25",
      bandKey: "b0152_16_20",
      completion: { answered: 25, total: 25, complete: true },
    });
  });

  it("24 answers (even 24 Yes) -> incomplete: score, maximum and band null, never 0", () => {
    expect(healthAssessmentResult(V1, answers(24, 24))).toMatchObject({
      score: null,
      scoreMax: null,
      bandKey: null,
      completion: { answered: 24, total: 25, complete: false },
    });
  });

  it.each([
    [21, "b0152_21_25"],
    [16, "b0152_16_20"],
    [10, "b0152_10_15"],
    [9, "b0152_0_9"],
    [25, "b0152_21_25"],
    [0, "b0152_0_9"],
  ])("%i Yes -> band %s", (yes, band) => {
    expect(healthAssessmentResult(V1, answers(yes)).bandKey).toBe(band);
  });
});
