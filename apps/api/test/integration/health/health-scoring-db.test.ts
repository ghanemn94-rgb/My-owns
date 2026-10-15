// The shared health-check functions agree with the database functions of 0086 (ADR-0048 §5, §6, §10; p5-work-split
// §H.3 "The shared functions agree with the database function on 1,000 generated answer sets"; T-DG5-KBE-G):
//  - `healthAssessmentResult` (@mth/shared/calc) = `p5_health_assessment_result(assessment)` on 1,000 generated answer
//    sets over three published schemes: v1 (Yes = 1, No = 0, points), a points scheme with partial credit, and a
//    percent_of_applicable scheme with partial credit and N/A; complete, incomplete and all-N/A sets included;
//  - `healthSchemeProblem` = `p5_health_scheme_problem(version)` on 300 generated schemes (every rule reachable through
//    the element guard).
// Everything runs in ONE owner-role transaction that is rolled back at the end (each set inside its own savepoint), so
// nothing is left in the shared run database and parallel suites see nothing. The generator is seeded (deterministic
// under load, F-DG4-143). All data is synthetic.
import { randomBytes } from "node:crypto";
import { createDb, sql, type Tx } from "@mth/db";
import {
  healthAssessmentResult,
  healthSchemeProblem,
  HEALTH_QUESTION_CODES,
  type HealthBandElement,
  type HealthResponseElement,
  type HealthSchemeInput,
} from "@mth/shared/calc";
import { Decimal } from "decimal.js";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTransformationRow, seedWorld, startApi, uniq, type TestApi, type World } from "../../support/harness.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const V1_ID = "01920005-0860-7000-8000-000000000001";

/** A seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rollback extends Error {}

interface SchemeSpec {
  readonly definition: Record<string, unknown>;
  readonly responses: readonly { key: string; credit: string | null }[];
  readonly bands: readonly { key: string; origin: "source" | "admin"; minScore: string }[];
}

/** Inserts a published scheme version with its elements (inside the rolled-back transaction). */
async function insertScheme(tx: Tx, spec: SchemeSpec): Promise<string> {
  const id = uuidv7();
  await tx
    .insertInto("methodology_version")
    .values({
      id,
      key: `test-health-db-${uniq("k").toLowerCase()}`,
      version_no: 1,
      status: "published",
      title_en: "Synthetic scheme (rolled back)",
      title_ar: "مخطط تجريبي",
      source_document: "synthetic test fixture",
      source_sha256: null,
      definition: JSON.stringify(spec.definition),
      content_sha256: randomBytes(32).toString("hex"),
      published_at: new Date(),
      config_kind: "health_check_scheme",
      origin: "seed",
    })
    .execute();
  let ordinal = 0;
  for (const r of spec.responses)
    await tx
      .insertInto("methodology_element")
      .values({
        id: uuidv7(),
        methodology_version_id: id,
        element_type: "health_response",
        stable_key: r.key,
        origin: "admin",
        ordinal: (ordinal += 1),
        attributes: JSON.stringify({ credit: r.credit }),
      })
      .execute();
  for (const b of spec.bands)
    await tx
      .insertInto("methodology_element")
      .values({
        id: uuidv7(),
        methodology_version_id: id,
        element_type: "health_band",
        stable_key: b.key,
        origin: b.origin,
        ordinal: (ordinal += 1),
        attributes: JSON.stringify({ minScore: b.minScore, rangeLabel: b.key, textEn: "Synthetic", textAr: "تجريبي" }),
      })
      .execute();
  return id;
}

const toInput = (spec: SchemeSpec): HealthSchemeInput => ({
  definition: spec.definition,
  responses: spec.responses.map((r): HealthResponseElement => ({ key: r.key, credit: r.credit })),
  bands: spec.bands.map((b): HealthBandElement => ({ key: b.key, origin: b.origin, minScore: b.minScore })),
});

const V1_SPEC: SchemeSpec = {
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
const PARTIAL_POINTS: SchemeSpec = {
  definition: { scoreBasis: "points", questionCount: 25 },
  responses: [...V1_SPEC.responses, { key: "partial", credit: "0.33" }],
  bands: [
    { key: "top", origin: "admin", minScore: "20.5" },
    { key: "mid", origin: "admin", minScore: "12.25" },
    { key: "low", origin: "admin", minScore: "0" },
  ],
};
const NA_PERCENT: SchemeSpec = {
  definition: { scoreBasis: "percent_of_applicable", questionCount: 25 },
  responses: [...V1_SPEC.responses, { key: "partial", credit: "0.75" }, { key: "na", credit: null }],
  bands: [
    { key: "strong", origin: "admin", minScore: "83.33" },
    { key: "solid", origin: "admin", minScore: "66.67" },
    { key: "risk", origin: "admin", minScore: "40" },
    { key: "reset", origin: "admin", minScore: "0" },
  ],
};

describe("shared health-check functions = the 0086 database functions", () => {
  it("1,000 generated answer sets give the same score, maximum and band as p5_health_assessment_result", async () => {
    const owner = createDb(api.owner);
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const next = rng(20261015);
    let compared = 0;
    let complete = 0;
    await owner
      .transaction()
      .execute(async (tx) => {
        const schemes: [string, SchemeSpec][] = [
          [V1_ID, V1_SPEC],
          [await insertScheme(tx, PARTIAL_POINTS), PARTIAL_POINTS],
          [await insertScheme(tx, NA_PERCENT), NA_PERCENT],
        ];
        for (let i = 0; i < 1000; i += 1) {
          const [schemeId, spec] = schemes[i % 3]!;
          const keys = spec.responses.map((r) => r.key);
          const count = next() < 0.15 ? Math.floor(next() * 25) : 25;
          // Skewed draws reach the band edges and all-N/A sets.
          const bias = next();
          const answers = HEALTH_QUESTION_CODES.slice(0, count).map(
            () => keys[Math.min(keys.length - 1, Math.floor(Math.pow(next(), bias * 3 + 0.2) * keys.length))]!,
          );
          await sql`SAVEPOINT health_set`.execute(tx);
          const assessmentId = uuidv7();
          await tx
            .insertInto("health_assessment")
            .values({
              id: assessmentId,
              organization_id: w.orgA.id,
              transformation_id: t,
              sequence_no: 1,
              scheme_version_id: schemeId,
              assessment_date: "2026-10-15",
              owner_user_id: w.office.id,
              created_by: w.office.id,
              updated_by: w.office.id,
            })
            .execute();
          if (answers.length > 0)
            await tx
              .insertInto("health_assessment_answer")
              .values(
                answers.map((response, q) => ({
                  id: uuidv7(),
                  organization_id: w.orgA.id,
                  transformation_id: t,
                  assessment_id: assessmentId,
                  question_code: HEALTH_QUESTION_CODES[q]!,
                  response,
                  answered_by: w.office.id,
                  created_by: w.office.id,
                  updated_by: w.office.id,
                })),
              )
              .execute();
          const db = await sql<{ score: string | null; score_max: string | null; band_key: string | null }>`
            SELECT score::text AS score, score_max::text AS score_max, band_key
              FROM p5_health_assessment_result(${assessmentId}::uuid)`.execute(tx);
          await sql`ROLLBACK TO SAVEPOINT health_set`.execute(tx);
          const row = db.rows[0]!;
          const mine = healthAssessmentResult(toInput(spec), answers);
          const label = `set ${i} (${schemeId === V1_ID ? "v1" : spec.definition["scoreBasis"]}): ${answers.join(",")}`;
          if (row.score === null) {
            expect([mine.score, mine.scoreMax, mine.bandKey], label).toEqual([null, null, null]);
          } else {
            complete += 1;
            expect(mine.score, label).not.toBeNull();
            expect(new Decimal(mine.score!).equals(row.score), `${label}: ${mine.score} vs ${row.score}`).toBe(true);
            expect(new Decimal(mine.scoreMax!).equals(row.score_max!), label).toBe(true);
            expect(mine.bandKey, label).toBe(row.band_key);
          }
          compared += 1;
        }
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(compared).toBe(1000);
    // The generated sets really exercise both outcomes (scored and incomplete or not computable).
    expect(complete).toBeGreaterThan(600);
    expect(compared - complete).toBeGreaterThan(100);
    const left = await api.db.selectFrom("health_assessment").select("id").where("transformation_id", "=", t).execute();
    expect(left).toEqual([]);
  }, 180_000);

  it("300 generated schemes give the same publish-rule result as p5_health_scheme_problem", async () => {
    const owner = createDb(api.owner);
    const next = rng(73);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    const seen = new Map<string, number>();
    await owner
      .transaction()
      .execute(async (tx) => {
        for (let i = 0; i < 300; i += 1) {
          const definition: Record<string, unknown> =
            next() < 0.1
              ? pick([
                  {},
                  { scoreBasis: "points" },
                  { scoreBasis: "weighted", questionCount: 25 },
                  { scoreBasis: "points", questionCount: 24 },
                ])
              : { scoreBasis: pick(["points", "percent_of_applicable"]), questionCount: pick([25, 25, 25, "25"]) };
          const responses: { key: string; credit: string | null }[] = [];
          if (next() < 0.95) responses.push({ key: "yes", credit: next() < 0.93 ? "1" : pick(["0", "0.5"]) });
          if (next() < 0.95) responses.push({ key: "no", credit: next() < 0.93 ? "0" : pick(["1", "0.25"]) });
          if (next() < 0.5)
            responses.push({ key: "partial", credit: pick(["0.5", "0.25", "0.01", "0.99", "0", "1", "0.00"]) });
          if (next() < 0.45) responses.push({ key: "na", credit: null });
          const bands: { key: string; origin: "source" | "admin"; minScore: string }[] = [];
          if (next() < 0.45) bands.push(...V1_SPEC.bands.map((b) => ({ ...b })));
          const own = Math.floor(next() * 5);
          for (let b = 0; b < own; b += 1)
            bands.push({
              key: `own_${b}`,
              origin: "admin",
              minScore: pick(["0", "0.00", "5", "10", "12.5", "25", "25.01", "50", "50.0", "99.99", "100", "100.5"]),
            });
          const spec: SchemeSpec = { definition, responses, bands };
          await sql`SAVEPOINT health_scheme`.execute(tx);
          const id = await insertScheme(tx, spec);
          const db = await sql<{
            problem: string | null;
          }>`SELECT p5_health_scheme_problem(${id}::uuid) AS problem`.execute(tx);
          await sql`ROLLBACK TO SAVEPOINT health_scheme`.execute(tx);
          const theirs = db.rows[0]!.problem;
          const mine = healthSchemeProblem(toInput(spec));
          expect(mine, JSON.stringify(spec)).toBe(theirs);
          seen.set(theirs ?? "publishable", (seen.get(theirs ?? "publishable") ?? 0) + 1);
        }
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
    // Every outcome of the rule was generated at least once.
    expect([...seen.keys()].sort()).toEqual(
      [
        "health_scheme_bands_invalid",
        "health_scheme_credit",
        "health_scheme_definition",
        "health_scheme_na_needs_percent",
        "health_scheme_own_bands_required",
        "health_scheme_yes_no_required",
        "publishable",
      ].sort(),
    );
  }, 180_000);
});
