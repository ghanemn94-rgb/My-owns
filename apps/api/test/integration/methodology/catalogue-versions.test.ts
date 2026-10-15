// The DG2-DG4 catalogue for methodology versions after v1 (T-DG5-BE-C2; D-155, FE-B's High defect; ADR-0039 §2
// "Resolution", §3) against a real PostgreSQL.
//
// The defect: GET /transformations/{id}/methodology filtered the catalogue rows by the transformation's PINNED version
// id. Those rows exist only for playbook v1 (the stable-identity registry), and a new transformation is pinned to the
// newest published version, so once any version was published every new transformation got empty DG2 catalogues.
//
// This suite PUBLISHES new versions of the shared key `playbook` (through the Studio API: draft, element edit, preview,
// compatibility, source coverage, review by a TO, publish), which changes the pin of every transformation created
// afterwards in the same database. The integration files of one run may execute concurrently on the shared run
// database, so the suite runs on its OWN scratch database migrated from the same files (the scoring-defaults pattern).
//
// Covered (the assignment's tests, literally):
//  1. a v2 that changes only help text; a transformation created afterwards is pinned to v2, and
//     GET /transformations/{id}/methodology returns the same diagnostic dimensions and workstreams, TOM dimensions,
//     gate definitions (with their criteria), charter scope checks and good-outcome criteria as v1, by code/key and count;
//  2. a v3 label override (a TOM dimension, a gate and a gate criterion) is returned for its element, and only for it;
//  3. a transformation pinned to v1 is unchanged: its catalogue response is byte-identical before and after the
//     publishes (the v1 regression suites, v1-readers.test.ts and the DG2-DG4 suites, run unchanged);
//  4. the instantiation path of a v2-pinned transformation: the DG2 Diagnose region (the catalogue's 6 workstreams and
//     its dimensions, the seeded diagnostic items) and the 6 gate instances are complete, as for v1; the good-outcome
//     test of a v2-pinned outcome evaluates all five criteria (the second reader the sweep fixed).
// Every value is synthetic test data. A configuration review approves nothing in the business; product gates G1-G6
// are business approvals inside the product, and nothing here touches the engineering delivery gates DG0-DG7.
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  call,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const COVERAGE_RUNS = "/api/v1/admin/source-coverage/runs";
const PLAYBOOK_V1 = "01920002-0000-7000-8000-000000000001";
const ifm = (v: number) => ({ "if-match": `"${v}"` });

let api: TestApi;
let w: World;
let scratchDb: string;
let admin: Session;
let reviewer: Session;
let auditor: Session;
let lead: Session;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_catver");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewer = await signIn(api.app, r.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  // The transformation lead of business unit A1 (the p2-fixtures grant) creates the transformations and their outcomes.
  const l = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, l.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  lead = await signIn(api.app, l.subject);
}, 120_000);
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

// ------------------------------------------------------------------------------------------------ helpers

const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;

async function createTransformation(name: string): Promise<string> {
  const res = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: lead,
    body: { name, businessUnitId: w.a1, mode: "end_to_end" },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const catalogueOf = async (transformationId: string): Promise<Body> => {
  const res = await call<Body>(api.app, "GET", `/api/v1/transformations/${transformationId}/methodology`, {
    session: auditor,
  });
  expect(res.status).toBe(200);
  return res.body;
};

/** The newest published playbook version through the Studio list (ADR-0039 §1). */
async function newestPlaybook(): Promise<{ id: string; versionNo: number }> {
  const rows = await api.db
    .selectFrom("methodology_version")
    .select(["id", "version_no"])
    .where("config_kind", "=", "methodology")
    .where("key", "=", "playbook")
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .execute();
  return { id: rows[0]!.id, versionNo: rows[0]!.version_no };
}

/**
 * Publishes a new playbook version based on the newest one, with `elements` put through putConfigElement: draft,
 * element edits, preview, compatibility, source coverage, submit, TO approval, publish. Returns the new version's id.
 */
async function publishPlaybook(
  elements: readonly { type: string; key: string; attributes: Record<string, unknown> }[],
): Promise<string> {
  const base = await newestPlaybook();
  const draft = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect([draft.status, draft.body.code]).toEqual([201, undefined]);
  const id = draft.body.id as string;
  for (const e of elements) {
    const put = await call<Body>(api.app, "PUT", `${V}/${id}/elements/${e.type}/${e.key}`, {
      session: admin,
      headers: ifm(await versionOf(id)),
      body: { attributes: e.attributes },
    });
    expect([put.status, put.body.code]).toEqual([200, undefined]);
  }
  const preview = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { samples: [] },
  });
  expect([preview.status, preview.body.result]).toEqual([201, "pass"]);
  const compat = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: admin,
    headers: ifm(await versionOf(id)),
  });
  expect(compat.status).toBe(201);
  expect(compat.body.result).not.toBe("fail");
  const coverage = await call<Body>(api.app, "POST", COVERAGE_RUNS, { session: admin, body: { versionId: id } });
  expect(coverage.status).toBe(201);
  expect(coverage.body.result).not.toBe("fail");
  const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: {},
  });
  expect([sub.status, sub.body.code]).toEqual([201, undefined]);
  const decided = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
    session: reviewer,
    headers: ifm(1),
    body: { outcome: "approve" },
  });
  expect(decided.status).toBe(200);
  const pub = await call<Body>(api.app, "POST", `${V}/${id}/publish`, {
    session: admin,
    headers: ifm(await versionOf(id)),
  });
  expect([pub.status, pub.body.code]).toEqual([200, undefined]);
  expect((await newestPlaybook()).id).toBe(id);
  return id;
}

const pinOf = async (transformationId: string) =>
  (
    await api.db
      .selectFrom("transformation_config_pin")
      .select("methodology_version_id")
      .where("transformation_id", "=", transformationId)
      .where("kind", "=", "methodology")
      .executeTakeFirstOrThrow()
  ).methodology_version_id;

/** The identities of a catalogue response, by code/key in response order (test 1's comparison). */
const identities = (c: Body) => ({
  diagnosticDimensions: c.diagnosticDimensions.map((d: Body) => d.code),
  diagnosticWorkstreams: c.diagnosticWorkstreams.map((d: Body) => d.code),
  tomDimensions: c.tomDimensions.map((d: Body) => d.code),
  gateDefinitions: c.gateDefinitions.map((g: Body) => [g.code, g.criteria.map((k: Body) => k.key)]),
  charterScopeChecks: c.charterScopeChecks.map((d: Body) => d.code),
  goodOutcomeCriteria: c.goodOutcomeCriteria.map((d: Body) => d.code),
});

/** The response without its version header: the catalogue rows proper (identical attributes = identical body). */
const rowsOf = (c: Body) => {
  const { methodologyVersion: _v, ...rest } = c;
  return rest;
};

// ------------------------------------------------------------------------------------------------ the suite

const HELP_G2 = "Synthetic v2 help text for G2 (test fixture).";
const HELP_TOM = "Synthetic v2 help text for the first TOM dimension (test fixture).";
const LABEL_TOM_EN = "Synthetic v3 TOM label";
const LABEL_TOM_AR = "تسمية تجريبية للإصدار 3";
const LABEL_GATE_EN = "Synthetic v3 G3 label";
const LABEL_CRIT_EN = "Synthetic v3 criterion label";

describe("the DG2-DG4 catalogue of methodology versions after v1 (ADR-0039 §2, §3; D-155)", () => {
  let v1Transformation: string;
  let v1Body: Body;
  let v1Raw: string;
  let v2: string;
  let v2Transformation: string;
  let firstTom: string;
  let critKey: string;

  beforeAll(async () => {
    v1Transformation = await createTransformation("Synthetic v1-pinned transformation");
    expect(await pinOf(v1Transformation)).toBe(PLAYBOOK_V1);
    v1Body = await catalogueOf(v1Transformation);
    v1Raw = JSON.stringify(v1Body);
    firstTom = v1Body.tomDimensions[0].code as string;
    critKey = v1Body.gateDefinitions[2].criteria[0].key as string;
  });

  it("v1 is the registry: every catalogue row belongs to playbook v1 and the v1 response holds all of them", async () => {
    // The precondition of the fix (ADR-0039 §2): one registry, globally unique codes, all rows of playbook v1.
    for (const t of [
      "diagnostic_dimension",
      "diagnostic_workstream",
      "tom_dimension",
      "gate_definition",
      "charter_scope_check_definition",
      "good_outcome_criterion",
    ] as const) {
      const rows = await api.db.selectFrom(t).select("methodology_version_id").execute();
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.methodology_version_id))).toEqual(new Set([PLAYBOOK_V1]));
    }
    expect(v1Body.methodologyVersion).toMatchObject({ id: PLAYBOOK_V1, versionNo: 1 });
    expect(v1Body.diagnosticWorkstreams).toHaveLength(6);
    expect(v1Body.tomDimensions).toHaveLength(10);
    expect(v1Body.gateDefinitions).toHaveLength(6);
    expect(v1Body.charterScopeChecks).toHaveLength(5);
    expect(v1Body.goodOutcomeCriteria).toHaveLength(5);
    expect(v1Body.diagnosticDimensions.length).toBeGreaterThan(0);
  });

  it("test 1: a help-text-only v2; a new transformation pinned to v2 gets the same catalogue as v1 by code/key and count", async () => {
    v2 = await publishPlaybook([
      { type: "gate", key: "G2", attributes: { helpEn: HELP_G2 } },
      { type: "tom_dimension", key: firstTom, attributes: { helpEn: HELP_TOM } },
    ]);
    v2Transformation = await createTransformation("Synthetic v2-pinned transformation");
    expect(await pinOf(v2Transformation)).toBe(v2);
    const body = await catalogueOf(v2Transformation);
    expect(body.methodologyVersion).toMatchObject({ id: v2, versionNo: 2, status: "published" });
    expect(identities(body)).toEqual(identities(v1Body));
    for (const k of [
      "diagnosticDimensions",
      "diagnosticWorkstreams",
      "tomDimensions",
      "gateDefinitions",
      "charterScopeChecks",
      "goodOutcomeCriteria",
    ])
      expect([k, body[k].length]).toEqual([k, v1Body[k].length]);
    // Only the help texts differ, exactly where v2 changed them.
    const g2 = body.gateDefinitions.find((g: Body) => g.code === "G2");
    expect(g2.sourceDecisionQuestionEn).toBe(HELP_G2);
    expect(body.tomDimensions[0].sourceDesignQuestionEn).toBe(HELP_TOM);
    const expected = JSON.parse(v1Raw);
    expected.gateDefinitions.find((g: Body) => g.code === "G2").sourceDecisionQuestionEn = HELP_G2;
    expected.tomDimensions[0].sourceDesignQuestionEn = HELP_TOM;
    expect(rowsOf(body)).toEqual(rowsOf(expected));
  });

  it("test 2: a v3 label override is returned for its element, and only for it", async () => {
    const v3 = await publishPlaybook([
      { type: "tom_dimension", key: firstTom, attributes: { labelEn: LABEL_TOM_EN, labelAr: LABEL_TOM_AR } },
      { type: "gate", key: "G3", attributes: { labelEn: LABEL_GATE_EN } },
      { type: "gate_criterion", key: critKey, attributes: { labelEn: LABEL_CRIT_EN } },
    ]);
    const t3 = await createTransformation("Synthetic v3-pinned transformation");
    expect(await pinOf(t3)).toBe(v3);
    const body = await catalogueOf(t3);
    expect(body.methodologyVersion).toMatchObject({ id: v3, versionNo: 3 });
    expect(identities(body)).toEqual(identities(v1Body));
    expect(body.tomDimensions[0]).toMatchObject({ code: firstTom, labelEn: LABEL_TOM_EN, labelAr: LABEL_TOM_AR });
    const g3 = body.gateDefinitions.find((g: Body) => g.code === "G3");
    expect(g3.sourceNameEn).toBe(LABEL_GATE_EN);
    expect(g3.criteria.find((c: Body) => c.key === critKey).labelEn).toBe(LABEL_CRIT_EN);
    // A new draft copies its base's rows (ADR-0039 §2), so v3 keeps v2's G2 help text. A put replaces the element's row
    // (config-resolver.ts: "a full row therefore replaces them"), so the TOM row of v3 holds only its labels and the
    // design question is the catalogue value again.
    expect(body.gateDefinitions.find((g: Body) => g.code === "G2").sourceDecisionQuestionEn).toBe(HELP_G2);
    expect(body.tomDimensions[0].sourceDesignQuestionEn).toBe(v1Body.tomDimensions[0].sourceDesignQuestionEn);
    // Every other element is the catalogue value.
    const expected = JSON.parse(v1Raw);
    expected.gateDefinitions.find((g: Body) => g.code === "G2").sourceDecisionQuestionEn = HELP_G2;
    Object.assign(expected.tomDimensions[0], {
      labelEn: LABEL_TOM_EN,
      labelAr: LABEL_TOM_AR,
    });
    const eg3 = expected.gateDefinitions.find((g: Body) => g.code === "G3");
    eg3.sourceNameEn = LABEL_GATE_EN;
    eg3.criteria.find((c: Body) => c.key === critKey).labelEn = LABEL_CRIT_EN;
    expect(rowsOf(body)).toEqual(rowsOf(expected));
    // The v2-pinned transformation still renders v2 (no label override).
    const still = await catalogueOf(v2Transformation);
    expect(still.tomDimensions[0].labelEn).toBe(v1Body.tomDimensions[0].labelEn);
  });

  it("test 3: the v1-pinned transformation is unchanged, byte for byte, after v2 and v3 are published", async () => {
    expect(await pinOf(v1Transformation)).toBe(PLAYBOOK_V1);
    expect(JSON.stringify(await catalogueOf(v1Transformation))).toBe(v1Raw);
  });

  it("test 4: the instantiation path of a v2-pinned transformation: the Diagnose region and the 6 gates are complete", async () => {
    const count = async (t: "diagnostic_item" | "tom_canvas_cell" | "gate_instance", id: string) =>
      Number(
        (
          await api.db
            .selectFrom(t)
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("transformation_id", "=", id)
            .executeTakeFirstOrThrow()
        ).n,
      );
    // The catalogue of the Diagnose region (DiagnosePage reads its dimensions and workstreams).
    const body = await catalogueOf(v2Transformation);
    expect(body.diagnosticWorkstreams).toHaveLength(6);
    expect(body.diagnosticWorkstreams.map((s: Body) => s.code)).toEqual(
      v1Body.diagnosticWorkstreams.map((s: Body) => s.code),
    );
    // The rows instantiation created (p2_instantiate_transformation and later), equal in number to v1's.
    for (const t of ["diagnostic_item", "tom_canvas_cell", "gate_instance"] as const)
      expect([t, await count(t, v2Transformation)]).toEqual([t, await count(t, v1Transformation)]);
    expect(await count("gate_instance", v2Transformation)).toBe(6);
    const items = await call<Body>(api.app, "GET", `/api/v1/transformations/${v2Transformation}/diagnostic-items`, {
      session: auditor,
    });
    expect(items.status).toBe(200);
    expect(items.body.items.length).toBe(await count("diagnostic_item", v1Transformation));
    // The gates reader of a v2-pinned transformation lists all six gates, with v2's resolved help text.
    const gates = await call<Body>(api.app, "GET", `/api/v1/transformations/${v2Transformation}/gates`, {
      session: auditor,
    });
    expect(gates.status).toBe(200);
    expect(gates.body.items.map((g: Body) => [g.gate.gateCode, g.definition.code])).toEqual(
      ["G1", "G2", "G3", "G4", "G5", "G6"].map((c) => [c, c]),
    );
    expect(gates.body.items[1].definition.sourceDecisionQuestionEn).toBe(HELP_G2);
  });

  it("test 4 (second reader): the good-outcome test of a v2-pinned outcome evaluates all five criteria, as on v1", async () => {
    const results = async (transformationId: string) => {
      const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${transformationId}/outcomes`, {
        session: lead,
        body: { statement: "Launch new app" },
      });
      expect(res.status).toBe(201);
      return (res.body.goodOutcomeTest as Body[]).map((r) => [r.ordinal, r.criterionCode, r.result]);
    };
    const onV1 = await results(v1Transformation);
    expect(onV1).toHaveLength(5);
    expect(await results(v2Transformation)).toEqual(onV1);
  });
});
