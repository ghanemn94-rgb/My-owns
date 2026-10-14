// T06 default weights and rubric as versioned Studio configuration (REQ-PB-093; ADR-0040 §5; D-142 Q12; migration
// 0065; p5-work-split §A.6; T-DG5-KBE-A).
//
// This suite PUBLISHES new versions of the shared key `scoring-defaults`, which changes the starting weights of every
// transformation created afterwards in the same database. The integration files of one run may execute concurrently
// on the shared run database, so the suite runs on its OWN scratch database (the bu-hierarchy-guard pattern), migrated
// from the same files. Every value is synthetic test data; the Studio defaults approve nothing, and a transformation's
// weight set stays its own record, approved by its Sponsor (DG3). Product gates G1-G6 are business approvals inside
// the product.
//
// Covered (REQ-PB-093's acceptance, literally):
//  - D-142 Q12 regression: while the published defaults equal the source (B0076), the redefined
//    p3_instantiate_transformation() produces exactly the DG3 rows (the DG3 body of 0025, run side by side as a
//    reference function), plus only the new scoring_defaults pin; also after a newer version equal to the source.
//  - the admin changes the Feasibility rubric text and the default weights to 30/20/20/15/15 through the API (the
//    Studio UI's calls; no code change), previews, checks, has it reviewed and publishes; a transformation created
//    afterwards starts with 30/20/20/15/15 (`studio_default`, rationale naming the version) and the new rubric; an
//    existing transformation keeps 25/25/20/15/15 and rubric v1;
//  - publishing defaults that total 95 % (and 105 %) is refused 422 config_version.weights_total;
//  - putScoringDefaultsDraft: AUD/TO/BO 403, If-Match 428/409, commit-time re-authorization, one audit event per row
//    written plus one for the version, a no-op writes nothing, a removed and an added criterion, decimal totals.
import { readFileSync } from "node:fs";
import { defaultMigrationsDir, migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";

let api: TestApi;
let w: World;
let scratchDb: string;
let admin: Session;
let adminId: string;
let reviewer: Session;
let office: Session;
let auditor: Session;
let bo: Session;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ADMIN_READ = "/api/v1/admin/scoring-defaults";
const SCORING_V1 = "01920005-0000-7000-8000-000000000001";
const DG3_RATIONALE =
  "Source default weights (B0076): strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%.";
const CRITERIA = [
  "strategic_fit",
  "financial_value",
  "customer_impact",
  "feasibility",
  "time_to_value",
  "risk_compliance",
];
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code, r.body?.detail];
const NULL_LEVELS = [1, 2, 3, 4, 5].map((score) => ({ score, descriptorEn: null, descriptorAr: null }));
const FEASIBILITY_LEVELS = [1, 2, 3, 4, 5].map((score) => ({
  score,
  descriptorEn: `Synthetic feasibility descriptor ${score}`,
  descriptorAr: `وصف تجريبي لقابلية التنفيذ ${score}`,
}));
const CUSTOMER_LEVELS = [1, 2, 3, 4, 5].map((score) => ({
  score,
  descriptorEn: `Synthetic customer impact descriptor ${score}`,
  descriptorAr: null,
}));
const weightsOf = (...pairs: [string, string][]) =>
  pairs.map(([criterionCode, weightPercent]) => ({ criterionCode, weightPercent }));
const W_30 = weightsOf(
  ["strategic_fit", "30"],
  ["financial_value", "20"],
  ["customer_impact", "20"],
  ["feasibility", "15"],
  ["time_to_value", "15"],
);
const W_SOURCE = weightsOf(
  ["strategic_fit", "25"],
  ["financial_value", "25"],
  ["customer_impact", "20"],
  ["feasibility", "15"],
  ["time_to_value", "15"],
);

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_scoredef");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewer = await signIn(api.app, r.subject);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  const b = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, b.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, b.subject);
}, 120_000);
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

// ------------------------------------------------------------------------------------------------ helpers

const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;

async function newDraft(baseId: string): Promise<string> {
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: baseId } });
  expect([res.status, res.body.code]).toEqual([201, undefined]);
  return res.body.id as string;
}

async function newestPublishedId(): Promise<string> {
  const res = await call<Body>(api.app, "GET", ADMIN_READ, { session: admin });
  expect(res.status).toBe(200);
  return res.body.versionId as string;
}

const putDefaults = async (id: string, body: Body, s = admin, version?: number) =>
  call<Body>(api.app, "PUT", `${V}/${id}/scoring-defaults`, {
    session: s,
    headers: ifm(version ?? (await versionOf(id))),
    body,
  });

/**
 * preview (with a T06 sample unless `withSample` is false), compatibility, submit and the TO approval: the draft ends
 * `approved`. A draft that does not total 100 % cannot score a sample (the DG3 engine refuses it), so such a draft is
 * previewed without samples; its publish is then refused by the 100 % rule.
 */
async function toApproved(id: string, withSample = true): Promise<Body> {
  const sample = {
    kind: "record",
    recordType: "t06_score",
    input: { scores: { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 } },
  };
  const preview = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { samples: withSample ? [sample] : [] },
  });
  expect([preview.status, preview.body.result === "pass" ? "pass" : preview.body.report]).toEqual([201, "pass"]);
  const compat = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: admin,
    headers: ifm(await versionOf(id)),
  });
  expect(compat.status).toBe(201);
  expect(compat.body.result).not.toBe("fail");
  const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: {},
  });
  expect([sub.status, sub.body.code]).toEqual([201, undefined]);
  const d = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
    session: reviewer,
    headers: ifm(1),
    body: { outcome: "approve" },
  });
  expect(d.status).toBe(200);
  return preview.body;
}

const publish = async (id: string) =>
  call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: admin, headers: ifm(await versionOf(id)) });

async function createTransformation(name: string): Promise<string> {
  const res = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: office,
    body: { name, businessUnitId: w.a1, mode: "end_to_end" },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function weightSetOf(transformationId: string) {
  const set = await api.db
    .selectFrom("scoring_weight_set")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const weights = await api.db
    .selectFrom("scoring_weight")
    .select(["criterion_code", "weight_percent"])
    .where("weight_set_id", "=", set.id)
    .execute();
  // The T06 criterion order (UUIDv7 ids are not monotonic within one millisecond, so they give no order).
  weights.sort((a, b) => CRITERIA.indexOf(a.criterion_code) - CRITERIA.indexOf(b.criterion_code));
  return {
    set,
    weights: weights.map((x) => [x.criterion_code, String(x.weight_percent)]),
  };
}

const scoringPinOf = (transformationId: string) =>
  api.db
    .selectFrom("transformation_config_pin")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "scoring_defaults")
    .executeTakeFirst();

// ------------------------------------------------------------------------------------------------ D-142 Q12 regression

/** The DG3 body of p3_instantiate_transformation() (0025, equal to 0024's), installed under another name. */
function dg3ReferenceFunctionSql(): string {
  const text = readFileSync(`${defaultMigrationsDir()}/0025_p3_g1_agreement_guard.sql`, "utf8");
  const start = text.indexOf("CREATE OR REPLACE FUNCTION p3_instantiate_transformation(");
  const end = text.indexOf("END $$;", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text
    .slice(start, end + "END $$;".length)
    .replace("FUNCTION p3_instantiate_transformation(", "FUNCTION dg3_reference_p3_instantiate_transformation(");
}

/** Everything the instantiation wrote for a transformation, without ids, the transformation id and timestamps. */
async function instantiationOutput(transformationId: string) {
  const q = async (text: string) => (await api.owner.query(text, [transformationId])).rows;
  return {
    waves: await q(
      `SELECT code, ordinal, is_source_seeded, source_ref, name_en, name_ar, purpose_en, purpose_ar, horizon_en, horizon_ar,
              entry_criteria_en, entry_criteria_ar, exit_evidence_en, exit_evidence_ar, horizon_from_weeks, horizon_to_weeks,
              created_by, updated_by, version
         FROM roadmap_wave WHERE transformation_id = $1 ORDER BY code`,
    ),
    weightSets: await q(
      `SELECT version_no, status, approval_basis, rationale, approved_by, approved_at, activated_at IS NOT NULL AS activated,
              superseded_at, version, created_by, updated_by
         FROM scoring_weight_set WHERE transformation_id = $1 ORDER BY version_no`,
    ),
    weights: await q(
      `SELECT criterion_code, weight_percent::text AS weight_percent, created_by
         FROM scoring_weight WHERE transformation_id = $1 ORDER BY array_position(ARRAY['strategic_fit','financial_value','customer_impact','feasibility','time_to_value','risk_compliance'], criterion_code)`,
    ),
    audit: await q(
      `SELECT action, record_type, new_version, actor_type, actor_user_id, on_behalf_of_user_id, source, changes
         FROM audit_event WHERE transformation_id = $1 AND record_type <> 'transformation_config_pin' ORDER BY seq`,
    ),
    pins: await q(
      `SELECT p.kind, v.key, v.version_no FROM transformation_config_pin p
         JOIN methodology_version v ON v.id = p.methodology_version_id
        WHERE p.transformation_id = $1 ORDER BY p.kind`,
    ),
  };
}

describe("D-142 Q12: p3_instantiate_transformation() with the source defaults is byte-identical to DG3", () => {
  it("writes exactly the DG3 waves, weight set, weights and audit events, plus only the scoring_defaults pin", async () => {
    expect(await newestPublishedId()).toBe(SCORING_V1);
    await api.owner.query(dg3ReferenceFunctionSql());
    const ref = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const now = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const refCount = (
      await api.owner.query(`SELECT dg3_reference_p3_instantiate_transformation($1, $2, 'req-ref', 'api') AS n`, [
        ref,
        w.office.id,
      ])
    ).rows[0].n as number;
    const nowCount = (
      await api.owner.query(`SELECT p3_instantiate_transformation($1, $2, 'req-now', 'api') AS n`, [now, w.office.id])
    ).rows[0].n as number;
    const a = await instantiationOutput(ref);
    const b = await instantiationOutput(now);
    // Byte-identical DG3 rows (every column except ids, the transformation id and timestamps).
    expect(b.waves).toEqual(a.waves);
    expect(b.weightSets).toEqual(a.weightSets);
    expect(b.weights).toEqual(a.weights);
    expect(b.audit).toEqual(a.audit);
    // The DG3 values themselves (B0076), so the comparison cannot pass on two equally wrong outputs.
    expect(b.weightSets).toEqual([
      expect.objectContaining({ version_no: 1, status: "active", approval_basis: "source_default", approved_by: null }),
    ]);
    expect(b.weightSets[0].rationale).toBe(DG3_RATIONALE);
    expect(b.weights.map((x: Body) => [x.criterion_code, x.weight_percent])).toEqual([
      ["strategic_fit", "25.00"],
      ["financial_value", "25.00"],
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["time_to_value", "15.00"],
    ]);
    // The only addition: the scoring_defaults pin (to the newest published version, v1 here) and its audit event.
    expect(a.pins).toEqual([{ kind: "methodology", key: "playbook", version_no: 1 }]);
    expect(b.pins).toEqual([
      { kind: "methodology", key: "playbook", version_no: 1 },
      { kind: "scoring_defaults", key: "scoring-defaults", version_no: 1 },
    ]);
    const pin = await scoringPinOf(now);
    expect((await auditOf(api.db, pin!.id)).map((e) => e.action)).toEqual(["transformation_config_pin.create"]);
    expect(nowCount).toBe(refCount + 1);
    // Idempotent like DG3: a second call creates nothing.
    expect(
      (
        await api.owner.query(`SELECT p3_instantiate_transformation($1, $2, 'req-again', 'api') AS n`, [
          now,
          w.office.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await instantiationOutput(now)).toEqual(b);
    await api.owner.query(`DROP FUNCTION dg3_reference_p3_instantiate_transformation(uuid, uuid, text, text)`);
  });

  it("a transformation created through the API starts with the DG3 source defaults and is pinned to v1", async () => {
    const t = await createTransformation("Synthetic DG3 defaults");
    const { set, weights } = await weightSetOf(t);
    expect([set.approval_basis, set.rationale, set.approved_by]).toEqual(["source_default", DG3_RATIONALE, null]);
    expect(weights).toEqual([
      ["strategic_fit", "25.00"],
      ["financial_value", "25.00"],
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["time_to_value", "15.00"],
    ]);
    expect((await scoringPinOf(t))!.methodology_version_id).toBe(SCORING_V1);
  });
});

// ------------------------------------------------------------------------------------------------ the PB-093 journey

describe("REQ-PB-093: the admin publishes new default weights and rubric; new transformations start with them", () => {
  let existing: string;
  let bare: string;
  let v2: string;

  it("reads v1: 25/25/20/15/15 (decimal strings, total 100.00), six rubrics with null descriptors (never invented)", async () => {
    existing = await createTransformation("Synthetic existing transformation");
    bare = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id); // no pin of any kind
    const res = await call<Body>(api.app, "GET", ADMIN_READ, { session: auditor });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      versionId: SCORING_V1,
      versionNo: 1,
      status: "published",
      isNewestPublished: true,
      weights: [
        { criterionCode: "strategic_fit", weightPercent: "25.00" },
        { criterionCode: "financial_value", weightPercent: "25.00" },
        { criterionCode: "customer_impact", weightPercent: "20.00" },
        { criterionCode: "feasibility", weightPercent: "15.00" },
        { criterionCode: "time_to_value", weightPercent: "15.00" },
      ],
      weightTotal: "100.00",
      rubrics: [
        "strategic_fit",
        "financial_value",
        "customer_impact",
        "feasibility",
        "time_to_value",
        "risk_compliance",
      ].map((criterionCode) => ({ criterionCode, levels: NULL_LEVELS })),
      version: 1,
    });
    // Every role with transformation scope reads the transformation's defaults; the unpinned row resolves to v1.
    for (const [t, s] of [
      [existing, office],
      [existing, auditor],
      [bare, office],
    ] as const) {
      const r = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/scoring-defaults`, { session: s });
      expect([r.status, r.body.versionId]).toEqual([200, SCORING_V1]);
    }
  });

  it("the admin changes the Feasibility rubric text and the weights to 30/20/20/15/15 in a draft and publishes it", async () => {
    v2 = await newDraft(SCORING_V1);
    const put = await putDefaults(v2, {
      weights: W_30,
      rubrics: [{ criterionCode: "feasibility", levels: FEASIBILITY_LEVELS }],
    });
    expect(put.status).toBe(200);
    expect(put.headers.etag).toBe(`"${put.body.version}"`);
    expect(put.body).toMatchObject({ versionNo: 2, status: "draft", isNewestPublished: false, weightTotal: "100.00" });
    expect(put.body.weights).toEqual(
      weightsOf(
        ["strategic_fit", "30.00"],
        ["financial_value", "20.00"],
        ["customer_impact", "20.00"],
        ["feasibility", "15.00"],
        ["time_to_value", "15.00"],
      ),
    );
    expect(put.body.rubrics.find((r: Body) => r.criterionCode === "feasibility").levels).toEqual(FEASIBILITY_LEVELS);
    expect(put.body.rubrics.find((r: Body) => r.criterionCode === "strategic_fit").levels).toEqual(NULL_LEVELS);
    // Preview scores a T06 sample with the draft's weights through the DG3 engine: (5×30+4×20+3×20+2×15+1×15)/100.
    const preview = await toApproved(v2);
    expect(preview.result).toBe("pass");
    expect(preview.report.samples.results[0]).toMatchObject({ result: "pass", weightedScore: "3.3500" });
    const pub = await publish(v2);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe("published");
    expect((await auditOf(api.db, v2)).map((e) => e.action)).toContain("methodology_version.publish");
    expect(await newestPublishedId()).toBe(v2);
    const old = await call<Body>(api.app, "GET", `${ADMIN_READ}?versionId=${SCORING_V1}`, { session: admin });
    expect([old.status, old.body.isNewestPublished]).toEqual([200, false]);
  });

  it("a transformation created afterwards starts with 30/20/20/15/15 (studio_default, naming v2) and the new rubric", async () => {
    const t = await createTransformation("Synthetic new transformation");
    const { set, weights } = await weightSetOf(t);
    expect(set).toMatchObject({ version_no: 1, status: "active", approval_basis: "studio_default", approved_by: null });
    expect(set.rationale).toBe(
      "Studio default weights (scoring defaults v2): strategic fit 30%, financial value 20%, customer impact 20%, feasibility 15%, time-to-value 15%.",
    );
    expect(weights).toEqual([
      ["strategic_fit", "30.00"],
      ["financial_value", "20.00"],
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["time_to_value", "15.00"],
    ]);
    expect((await scoringPinOf(t))!.methodology_version_id).toBe(v2);
    const audit = (await auditOf(api.db, set.id)).map((e) => [e.action, e.changes]);
    expect(audit).toEqual([
      [
        "scoring_weight_set.create",
        {
          weights: {
            from: null,
            to: {
              strategic_fit: "30.00",
              financial_value: "20.00",
              customer_impact: "20.00",
              feasibility: "15.00",
              time_to_value: "15.00",
            },
          },
        },
      ],
    ]);
    const r = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/scoring-defaults`, { session: office });
    expect([r.status, r.body.versionId, r.body.versionNo]).toEqual([200, v2, 2]);
    expect(r.body.rubrics.find((x: Body) => x.criterionCode === "feasibility").levels).toEqual(FEASIBILITY_LEVELS);
    // The DG3 weight-set read shows the new set as version 1 with the Studio basis (not a business approval).
    const sets = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/prioritization/weight-sets`, {
      session: office,
    });
    expect(sets.status).toBe(200);
    expect(sets.body.items[0]).toMatchObject({ versionNo: 1, approvalBasis: "studio_default", approvedBy: null });
  });

  it("an existing transformation keeps 25/25/20/15/15 and rubric v1 (its pin and weight set are unchanged)", async () => {
    const { set, weights } = await weightSetOf(existing);
    expect([set.approval_basis, set.rationale, set.version]).toEqual(["source_default", DG3_RATIONALE, 1]);
    expect(weights).toEqual([
      ["strategic_fit", "25.00"],
      ["financial_value", "25.00"],
      ["customer_impact", "20.00"],
      ["feasibility", "15.00"],
      ["time_to_value", "15.00"],
    ]);
    expect((await scoringPinOf(existing))!).toMatchObject({ methodology_version_id: SCORING_V1, version: 1 });
    for (const t of [existing, bare]) {
      const r = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/scoring-defaults`, { session: office });
      expect([r.status, r.body.versionId, r.body.weightTotal]).toEqual([200, SCORING_V1, "100.00"]);
      expect(r.body.rubrics.find((x: Body) => x.criterionCode === "feasibility").levels).toEqual(NULL_LEVELS);
    }
    expect(await scoringPinOf(bare)).toBeUndefined();
  });

  it("publishing defaults that total 95% (or 105%) is refused 422 config_version.weights_total; the draft stays a draft", async () => {
    for (const last of ["10", "20"]) {
      const d = await newDraft(v2);
      const put = await putDefaults(d, {
        weights: weightsOf(
          ["strategic_fit", "30"],
          ["financial_value", "20"],
          ["customer_impact", "20"],
          ["feasibility", "15"],
          ["time_to_value", last],
        ),
        rubrics: [],
      });
      // The draft may be saved with another total; the editor shows the exact running total.
      expect([put.status, put.body.weightTotal]).toEqual([200, last === "10" ? "95.00" : "105.00"]);
      await toApproved(d, false);
      expect(codeOf(await publish(d))).toEqual([
        422,
        "config_version.weights_total",
        "Default weights must total exactly 100% over 2 to 6 criteria.",
      ]);
      const after = await call<Body>(api.app, "GET", `${V}/${d}`, { session: admin });
      expect([after.body.status, after.body.draftStage]).toEqual(["draft", "approved"]);
      expect(await newestPublishedId()).toBe(v2);
      const discard = await call<Body>(api.app, "POST", `${V}/${d}/discard`, {
        session: admin,
        headers: ifm(after.body.version),
      });
      expect(discard.status).toBe(200);
    }
  });

  it("a later version equal to the source defaults again gives the DG3 output (source_default, DG3 rationale)", async () => {
    const d = await newDraft(v2);
    expect((await putDefaults(d, { weights: W_SOURCE, rubrics: [] })).status).toBe(200);
    await toApproved(d);
    expect((await publish(d)).status).toBe(200);
    const t = await createTransformation("Synthetic source-equal defaults");
    const { set, weights } = await weightSetOf(t);
    expect([set.approval_basis, set.rationale]).toEqual(["source_default", DG3_RATIONALE]);
    expect(weights.map(([, x]) => x)).toEqual(["25.00", "25.00", "20.00", "15.00", "15.00"]);
    expect((await scoringPinOf(t))!.methodology_version_id).toBe(d);
  });
});

// ------------------------------------------------------------------------------------------------ the draft write

describe("putScoringDefaultsDraft: authorization, validation, If-Match, audit", () => {
  let draft: string;

  it("refuses AUD, TO and BO (403) and writes nothing; 428 without If-Match; 409 stale; 404 for another kind", async () => {
    draft = await newDraft(await newestPublishedId());
    const body = { weights: W_30, rubrics: [] };
    for (const s of [auditor, office, bo]) expect((await putDefaults(draft, body, s, 1)).status).toBe(403);
    const no = await call<Body>(api.app, "PUT", `${V}/${draft}/scoring-defaults`, { session: admin, body });
    expect(no.status).toBe(428);
    expect((await putDefaults(draft, body, admin, 5)).status).toBe(409);
    const { id: playbookId } = await api.db
      .selectFrom("methodology_version")
      .select("id")
      .where("key", "=", "playbook")
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow();
    expect((await putDefaults(playbookId, body, admin, 1)).status).toBe(404);
    expect((await auditOf(api.db, draft)).map((e) => e.action)).toEqual(["methodology_version.create_draft"]);
    expect(await versionOf(draft)).toBe(1);
  });

  it("refuses a weight that is not a two-decimal percent in (0, 100] with 400 validation.weight_percent", async () => {
    for (const bad of ["0", "0.00", "100.01", "12.345", "-5", "1e2", "abc", ""]) {
      const res = await putDefaults(draft, {
        weights: [{ criterionCode: "strategic_fit", weightPercent: bad }, W_30[1]],
        rubrics: [],
      });
      expect(res.status, bad).toBe(400);
    }
    const r = await putDefaults(draft, {
      weights: [{ criterionCode: "feasibility", weightPercent: "12.345" }, W_30[1]],
      rubrics: [],
    });
    expect(JSON.stringify(r.body)).toContain("validation.weight_percent");
    // One criterion, seven criteria, a duplicate, an unknown criterion, a rubric without five ordered levels: 400.
    for (const body of [
      { weights: [W_30[0]], rubrics: [] },
      { weights: [...W_30, W_30[0], W_30[1]], rubrics: [] },
      { weights: [W_30[0], W_30[0]], rubrics: [] },
      { weights: [{ criterionCode: "speed", weightPercent: "50" }, W_30[1]], rubrics: [] },
      { weights: W_30, rubrics: [{ criterionCode: "feasibility", levels: NULL_LEVELS.slice(0, 4) }] },
      { weights: W_30, rubrics: [{ criterionCode: "feasibility", levels: [...NULL_LEVELS].reverse() }] },
      {
        weights: W_30,
        rubrics: [{ criterionCode: "feasibility", levels: NULL_LEVELS.map((l) => ({ ...l, descriptorEn: "" })) }],
      },
      { weights: W_30 },
    ])
      expect((await putDefaults(draft, body)).status, JSON.stringify(body)).toBe(400);
    expect(await versionOf(draft)).toBe(1);
  });

  it("writes one audit event per row written plus one for the version; a no-op writes nothing", async () => {
    const res = await putDefaults(
      draft,
      { weights: W_30, rubrics: [{ criterionCode: "customer_impact", levels: CUSTOMER_LEVELS }] },
      admin,
      1,
    );
    expect([res.status, res.body.version]).toEqual([200, 2]);
    const events = await auditOfRequest(api.db, res.headers["x-request-id"] as string);
    // The base (the newest published version, equal to the source weights) has strategic_fit 25 and financial_value 25
    // and a customer-impact rubric without descriptors: two weight rows, the customer-impact rubric, and the version.
    expect(events.map((e) => e.action).sort()).toEqual(
      [
        "methodology_element.put",
        "methodology_element.put",
        "methodology_element.put",
        "methodology_version.scoring_defaults_put",
      ].sort(),
    );
    const versionEvent = events.find((e) => e.action === "methodology_version.scoring_defaults_put")!;
    expect(versionEvent).toMatchObject({ record_id: draft, prior_version: 1, new_version: 2 });
    // The same body again: 200, nothing written, no version step, no audit event.
    const again = await putDefaults(
      draft,
      { weights: W_30, rubrics: [{ criterionCode: "customer_impact", levels: CUSTOMER_LEVELS }] },
      admin,
      2,
    );
    expect([again.status, again.body.version]).toEqual([200, 2]);
    expect(await auditOfRequest(api.db, again.headers["x-request-id"] as string)).toEqual([]);
  });

  it("removes a criterion left out and adds risk/compliance (B0077) with exact decimal totals", async () => {
    const res = await putDefaults(draft, {
      weights: weightsOf(
        ["strategic_fit", "15"],
        ["financial_value", "25"],
        ["customer_impact", "20"],
        ["feasibility", "12.5"],
        ["risk_compliance", "10.25"],
      ),
      rubrics: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.weights).toEqual(
      weightsOf(
        ["strategic_fit", "15.00"],
        ["financial_value", "25.00"],
        ["customer_impact", "20.00"],
        ["feasibility", "12.50"],
        ["risk_compliance", "10.25"],
      ),
    );
    // 15 + 25 + 20 + 12.5 + 10.25 = 82.75 exactly (decimal, never rounded); time-to-value is recorded as removed.
    expect(res.body.weightTotal).toBe("82.75");
    const ttv = await api.db
      .selectFrom("methodology_element")
      .select(["removed"])
      .where("methodology_version_id", "=", draft)
      .where("element_type", "=", "scoring_weight")
      .where("stable_key", "=", "time_to_value")
      .executeTakeFirstOrThrow();
    expect(ttv.removed).toBe(true);
    // A draft in preview returns to editing on the next content change.
    const preview = await call<Body>(api.app, "POST", `${V}/${draft}/preview`, {
      session: admin,
      headers: ifm(res.body.version),
      body: { samples: [] },
    });
    expect([preview.status, preview.body.result === "pass" ? "pass" : preview.body.report]).toEqual([201, "pass"]);
    const back = await putDefaults(draft, { weights: W_30, rubrics: [] });
    expect(back.status).toBe(200);
    const v = await call<Body>(api.app, "GET", `${V}/${draft}`, { session: admin });
    expect(v.body.draftStage).toBe("editing");
  });

  it("re-checks authorization at commit time: a grant revoked mid-request gives 403 and writes nothing", async () => {
    const u = await methodologyAdmin(api.db, w);
    const s = await signIn(api.app, u.subject);
    const before = await versionOf(draft);
    const res = await afterIdentity(
      api,
      u.id,
      () => putDefaults(draft, { weights: W_SOURCE, rubrics: [] }, s, before),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await versionOf(draft)).toBe(before);
    const discard = await call<Body>(api.app, "POST", `${V}/${draft}/discard`, {
      session: admin,
      headers: ifm(before),
    });
    expect(discard.status).toBe(200);
    expect(adminId).toBeTruthy();
  });

  it("the T06 sample preview reports Incomplete for a missing score and fails a draft that does not total 100%", async () => {
    const d = await newDraft(await newestPublishedId());
    await putDefaults(d, { weights: weightsOf(["strategic_fit", "50"], ["financial_value", "40"]), rubrics: [] });
    const run = async (scores: Record<string, number | null>) =>
      call<Body>(api.app, "POST", `${V}/${d}/preview`, {
        session: admin,
        headers: ifm(await versionOf(d)),
        body: { samples: [{ kind: "record", recordType: "t06_score", input: { scores } }] },
      });
    const failing = await run({ strategic_fit: 5, financial_value: 5 });
    expect([failing.status, failing.body.result]).toEqual([201, "fail"]);
    expect(failing.body.report.samples.results[0].result).toBe("fail");
    await putDefaults(d, { weights: weightsOf(["strategic_fit", "50"], ["financial_value", "50"]), rubrics: [] });
    const incomplete = await run({ strategic_fit: 4, financial_value: null });
    expect(incomplete.body.report.samples.results[0]).toMatchObject({
      result: "pass",
      completeness: "incomplete",
      weightedScore: null,
      missingCriteria: ["financial_value"],
    });
    const other = await call<Body>(api.app, "POST", `${V}/${d}/preview`, {
      session: admin,
      headers: ifm(await versionOf(d)),
      body: { samples: [{ kind: "formula", input: {} }] },
    });
    expect(other.body.report.samples.results[0]).toMatchObject({ result: "fail", code: "preview.not_available" });
    await call<Body>(api.app, "POST", `${V}/${d}/discard`, { session: admin, headers: ifm(await versionOf(d)) });
  });
});
