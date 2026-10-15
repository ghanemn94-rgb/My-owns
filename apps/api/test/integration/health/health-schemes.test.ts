// The health-check questions, the scheme reads and the `health_check_scheme` kind provider against a real PostgreSQL
// (ADR-0048 §5, §6, §9, §10; REQ-S14-003, REQ-PB-091, REQ-PB-092, REQ-S14-001; p5-work-split §H.3; T-DG5-KBE-G):
//  - the 25 questions are returned verbatim (equal to the B0150 cells of docs/source/playbook.md, numbers stripped);
//  - scheme v1 returns implementationAssumption: true, Yes = 1, No = 0, points out of 25 and the four B0152 bands
//    verbatim (equal to the B0152 rows of the playbook);
//  - REQ-S14-003 literal: a draft scheme with `na` that keeps the source bands fails its preview with 422
//    health_scheme.own_bands_required and cannot be published; with its own bands and percent_of_applicable it
//    publishes (through compatibility, the TO review and publish);
//  - the element refusals (yes/no, credits, unknown keys), the compatibility finding, the database publish guard's
//    mapping to the same §9 code, and the provider's affected records and migration items for draft assessments.
// Each test seeds its OWN published base scheme under a unique key (the studio-fixtures pattern: one open draft per
// key), so parallel suites never share a draft. All data is synthetic; publishing a scoring scheme is configuration,
// not a business approval, and never touches the engineering gates DG0-DG7.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb, insertAuditEvent, sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configKindProvider } from "../../../src/modules/methodology/index.ts";
import { mapDatabaseGuardError } from "../../../src/modules/platform/index.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;
let reviewer: Session;
let auditor: Session;
let member: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  admin = await signIn(api.app, a.subject);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewer = await signIn(api.app, r.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  member = await signIn(api.app, w.nobody.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const SCHEMES = "/api/v1/admin/health-check-schemes";
const V1_ID = "01920005-0860-7000-8000-000000000001";
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

/** The playbook source (read-only, D-142 Q5): the B0150 question cells and the B0152 band rows. */
const PLAYBOOK = readFileSync(new URL("../../../../../docs/source/playbook.md", import.meta.url), "utf8");
function b0150Questions(): string[] {
  const table = PLAYBOOK.slice(PLAYBOOK.indexOf("<!-- B0150 table -->"), PLAYBOOK.indexOf("Interpretation <!-- B0151"));
  const found = [...table.matchAll(/☐ (\d+)\. ([^|]+?)\s*\|/g)].map((m) => [Number(m[1]), m[2]!.trim()] as const);
  return found.sort((a, b) => a[0] - b[0]).map(([, text]) => text);
}
function b0152Bands(): [string, string][] {
  const table = PLAYBOOK.slice(PLAYBOOK.indexOf("<!-- B0152 table -->"), PLAYBOOK.indexOf("REFERENCE <!-- B0153"));
  return [...table.matchAll(/^\| (\d+-\d+) \| (.+?) \|$/gm)].map((m) => [m[1]!, m[2]!]);
}

/** A synthetic published copy of scheme v1 under a fresh key (owner role, origin seed, audited as 0086 does). */
async function seedSchemeBase(): Promise<{ id: string; key: string }> {
  const id = uuidv7();
  const key = `test-health-${uniq("k").toLowerCase()}`;
  const v1 = await api.db
    .selectFrom("methodology_version")
    .select("definition")
    .where("id", "=", V1_ID)
    .executeTakeFirstOrThrow();
  const elements = await api.db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "origin", "ordinal", "attributes"])
    .where("methodology_version_id", "=", V1_ID)
    .execute();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_version")
        .values({
          id,
          key,
          version_no: 1,
          status: "published",
          title_en: "Synthetic health-check scheme base",
          title_ar: "أساس تجريبي لتقييم فحص الصحة",
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify(v1.definition),
          content_sha256: randomBytes(32).toString("hex"),
          published_at: new Date(),
          config_kind: "health_check_scheme",
          origin: "seed",
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "methodology_version",
        recordId: id,
        organizationId: null,
        newVersion: 1,
      });
      for (const e of elements) {
        const elementId = uuidv7();
        await tx
          .insertInto("methodology_element")
          .values({
            id: elementId,
            methodology_version_id: id,
            element_type: e.element_type,
            stable_key: e.stable_key,
            origin: e.origin,
            ordinal: e.ordinal,
            attributes: JSON.stringify(e.attributes),
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "methodology_element",
          recordId: elementId,
          organizationId: null,
          newVersion: 1,
        });
      }
    });
  return { id, key };
}

const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;
async function draftOf(baseId: string): Promise<string> {
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: baseId } });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const put = async (id: string, type: string, key: string, attributes: Body, origin: "source" | "admin" = "admin") =>
  call<Body>(api.app, "PUT", `${V}/${id}/elements/${type}/${key}`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { origin, attributes },
  });
const remove = async (id: string, type: string, key: string) =>
  call<Body>(api.app, "POST", `${V}/${id}/elements/${type}/${key}/remove`, {
    session: admin,
    headers: ifm(await versionOf(id)),
  });
const patchDefinition = async (id: string, definition: Body) =>
  call<Body>(api.app, "PATCH", `${V}/${id}`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { definition },
  });
const preview = async (id: string, samples: Body[] = []) =>
  call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: admin,
    headers: ifm(await versionOf(id)),
    body: { samples },
  });
const compatibility = async (id: string) =>
  call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, { session: admin, headers: ifm(await versionOf(id)) });
const publish = async (id: string) =>
  call<Body>(api.app, "POST", `${V}/${id}/publish`, { session: admin, headers: ifm(await versionOf(id)) });

const OWN_BANDS: [string, string, string][] = [
  ["strong", "80", "80-100"],
  ["solid", "60", "60-79.99"],
  ["risk", "40", "40-59.99"],
  ["reset", "0", "0-39.99"],
];
const ownBand = (key: string, minScore: string, rangeLabel: string) => ({
  minScore,
  rangeLabel,
  textEn: `Synthetic band ${key}`,
  textAr: `نطاق تجريبي ${key}`,
});
const SOURCE_BAND_KEYS = ["b0152_21_25", "b0152_16_20", "b0152_10_15", "b0152_0_9"];
const answers = (yes: number, no: number, na: number) => {
  const keys = [...Array<string>(yes).fill("yes"), ...Array<string>(no).fill("no"), ...Array<string>(na).fill("na")];
  return Object.fromEntries(keys.map((k, i) => [`q${String(i + 1).padStart(2, "0")}`, k]));
};

describe("listHealthCheckQuestions (REQ-PB-091: the 25 questions verbatim, B0150)", () => {
  it("returns the 25 questions in order, equal to the playbook cells, to any signed-in user", async () => {
    const source = b0150Questions();
    expect(source).toHaveLength(25);
    const res = await call<Body>(api.app, "GET", "/api/v1/health-check-questions", { session: member });
    expect(res.status).toBe(200);
    expect(res.body.items.map((q: Body) => q.textEn)).toEqual(source);
    expect(res.body.items.map((q: Body) => q.code)).toEqual(source.map((_, i) => `q${String(i + 1).padStart(2, "0")}`));
    expect(res.body.items[3]).toMatchObject({
      code: "q04",
      ordinal: 4,
      textEn: "Are 3-5 business outcomes measurable?",
    });
    expect(res.body.items.every((q: Body) => q.sourceRef === "B0150" && q.textAr.length > 0)).toBe(true);
    expect((await call(api.app, "GET", "/api/v1/health-check-questions")).status).toBe(401);
    expect((await call(api.app, "GET", "/api/v1/health-check-questions", { session: auditor })).status).toBe(200);
  });
});

describe("listHealthCheckSchemes and getHealthCheckScheme (REQ-S14-001, REQ-PB-092, REQ-S14-003)", () => {
  it("scheme v1: implementationAssumption true, Yes = 1, No = 0, points out of 25, the four B0152 bands verbatim", async () => {
    const res = await call<Body>(api.app, "GET", `${SCHEMES}/${V1_ID}`, { session: member });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      versionId: V1_ID,
      key: "health-check",
      versionNo: 1,
      scoreBasis: "points",
      questionCount: 25,
      implementationAssumption: true,
    });
    expect(res.body.responses).toEqual([
      { key: "yes", credit: "1", labelEn: "Yes", labelAr: "نعم" },
      { key: "no", credit: "0", labelEn: "No", labelAr: "لا" },
    ]);
    const bands = res.body.bands as Body[];
    expect(bands.map((b) => [b.rangeLabel, b.textEn])).toEqual(b0152Bands());
    expect(bands.map((b) => [b.key, b.minScore, b.origin])).toEqual([
      ["b0152_21_25", "21", "source"],
      ["b0152_16_20", "16", "source"],
      ["b0152_10_15", "10", "source"],
      ["b0152_0_9", "0", "source"],
    ]);
    const list = await call<Body>(api.app, "GET", SCHEMES, { session: auditor });
    expect(list.status).toBe(200);
    expect(list.body.items.find((s: Body) => s.versionId === V1_ID)).toEqual(res.body);
  });

  it("a draft is not a published scheme: 404; a version of another kind: 404; malformed id 400; 401", async () => {
    const base = await seedSchemeBase();
    const draft = await draftOf(base.id);
    expect((await call(api.app, "GET", `${SCHEMES}/${draft}`, { session: member })).status).toBe(404);
    const list = await call<Body>(api.app, "GET", SCHEMES, { session: member });
    expect(list.body.items.some((s: Body) => s.versionId === draft)).toBe(false);
    expect(list.body.items.some((s: Body) => s.versionId === base.id)).toBe(true);
    const playbook = await api.db
      .selectFrom("methodology_version")
      .select("id")
      .where("config_kind", "=", "methodology")
      .executeTakeFirstOrThrow();
    expect((await call(api.app, "GET", `${SCHEMES}/${playbook.id}`, { session: member })).status).toBe(404);
    expect((await call(api.app, "GET", `${SCHEMES}/nope`, { session: member })).status).toBe(400);
    expect((await call(api.app, "GET", `${SCHEMES}/${V1_ID}`)).status).toBe(401);
  });
});

describe("REQ-S14-003: a scheme with N/A needs its own bands (ADR-0048 §6, §9)", () => {
  it("N/A with the source bands fails its preview with 422 health_scheme.own_bands_required and cannot be published", async () => {
    const base = await seedSchemeBase();
    const id = await draftOf(base.id);
    expect((await patchDefinition(id, { scoreBasis: "percent_of_applicable", questionCount: 25 })).status).toBe(200);
    expect((await put(id, "health_response", "na", { credit: null, labelEn: "N/A", labelAr: "لا ينطبق" })).status).toBe(
      200,
    );
    const failed = await preview(id, [
      { kind: "record", recordType: "health_assessment", input: { answers: answers(17, 8, 0) } },
    ]);
    expect(codeOf(failed)).toEqual([422, "health_scheme.own_bands_required"]);
    expect(failed.body.detail).toBe(
      "A scheme with partial credit or N/A needs its own interpretation bands; the four source bands cannot be reused.",
    );
    // No passing preview was recorded: publish refuses first.
    expect(codeOf(await publish(id))).toEqual([422, "config_version.preview_required"]);
    // A preview without samples (the sandbox does not call the hook) still cannot reach publish: compatibility fails.
    expect((await preview(id)).body.result).toBe("pass");
    const compat = await compatibility(id);
    expect([compat.status, compat.body.result]).toEqual([201, "fail"]);
    expect(compat.body.report.findings).toContainEqual({
      severity: "fail",
      code: "health_scheme.own_bands_required",
      elementType: null,
      stableKey: null,
      params: {},
    });
    expect((await publish(id)).status).toBe(422);
    // The database is the backstop: forcing the status refuses with the publish guard, mapped to the same §9 code.
    const forced = await createDb(api.owner)
      .transaction()
      .execute((tx) =>
        sql`UPDATE methodology_version SET status = 'published', draft_stage = NULL WHERE id = ${id}::uuid`.execute(tx),
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((forced as { constraint?: string }).constraint).toBe("health_scheme_own_bands_required");
    expect(mapDatabaseGuardError(forced as never)?.code).toBe("health_scheme.own_bands_required");
    const status = await api.db
      .selectFrom("methodology_version")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(status.status).toBe("draft");
  });

  it("with its own bands and percent_of_applicable it previews, passes compatibility, is reviewed and publishes", async () => {
    const base = await seedSchemeBase();
    const id = await draftOf(base.id);
    expect((await patchDefinition(id, { scoreBasis: "percent_of_applicable", questionCount: 25 })).status).toBe(200);
    expect((await put(id, "health_response", "na", { credit: null, labelEn: "N/A", labelAr: "لا ينطبق" })).status).toBe(
      200,
    );
    expect(
      (await put(id, "health_response", "partial", { credit: "0.5", labelEn: "Partly", labelAr: "جزئياً" })).status,
    ).toBe(200);
    for (const key of SOURCE_BAND_KEYS) expect((await remove(id, "health_band", key)).status).toBe(200);
    for (const [key, min, label] of OWN_BANDS)
      expect((await put(id, "health_band", key, ownBand(key, min, label))).status).toBe(200);
    const sample = (a: Body) => ({ kind: "record", recordType: "health_assessment", input: { answers: a } });
    const pv = await preview(id, [
      sample(answers(15, 3, 7)), // 100 × 15 / 18 = 83.33 -> strong
      sample(answers(10, 10, 4)), // 24 answers: incomplete, no score, no band
      sample(answers(0, 0, 25)), // all N/A: not computable
      sample({ q01: "maybe" }),
    ]);
    expect([pv.status, pv.body.result]).toEqual([201, "fail"]);
    const results = pv.body.report.samples.results as Body[];
    expect(results[0]).toMatchObject({ result: "pass", score: "83.33", scoreMax: "100", band: { key: "strong" } });
    expect(results[1]).toMatchObject({
      result: "pass",
      completion: { answered: 24, total: 25, complete: false },
      score: null,
      band: null,
    });
    expect(results[2]).toMatchObject({ result: "pass", computable: false, score: null, band: null });
    expect(results[3]).toMatchObject({ result: "fail", code: "health_check.response_not_allowed" });
    const ok = await preview(id, [sample(answers(15, 3, 7))]);
    expect([ok.status, ok.body.result]).toEqual([201, "pass"]);
    expect((await compatibility(id)).body.result).not.toBe("fail");
    const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
      session: admin,
      headers: ifm(await versionOf(id)),
      body: {},
    });
    expect(sub.status).toBe(201);
    const decided = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
      session: reviewer,
      headers: ifm(1),
      body: { outcome: "approve" },
    });
    expect(decided.status).toBe(200);
    const pub = await publish(id);
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
    const read = await call<Body>(api.app, "GET", `${SCHEMES}/${id}`, { session: member });
    expect(read.status).toBe(200);
    expect(read.body.scoreBasis).toBe("percent_of_applicable");
    expect(read.body.responses.map((r: Body) => [r.key, r.credit])).toEqual([
      ["yes", "1"],
      ["no", "0"],
      ["partial", "0.5"],
      ["na", null],
    ]);
    expect(read.body.bands.map((b: Body) => [b.key, b.origin])).toEqual(OWN_BANDS.map(([k]) => [k, "admin"]));
    // The base it was drafted from is unchanged (published versions are immutable).
    const kept = await call<Body>(api.app, "GET", `${SCHEMES}/${base.id}`, { session: member });
    expect(kept.body.bands.map((b: Body) => b.key)).toEqual(SOURCE_BAND_KEYS);
  });

  it("refuses element edits that break the scheme rules first, with the §9 codes", async () => {
    const base = await seedSchemeBase();
    const id = await draftOf(base.id);
    expect(codeOf(await put(id, "health_response", "yes", { credit: "0.5" }, "source"))).toEqual([
      422,
      "health_scheme.yes_no_required",
    ]);
    expect(codeOf(await put(id, "health_response", "no", { credit: "1" }, "source"))).toEqual([
      422,
      "health_scheme.yes_no_required",
    ]);
    expect(codeOf(await remove(id, "health_response", "yes"))).toEqual([422, "health_scheme.yes_no_required"]);
    expect(codeOf(await put(id, "health_response", "partial", { credit: "1" }))).toEqual([
      422,
      "health_scheme.credit_invalid",
    ]);
    expect(codeOf(await put(id, "health_response", "partial", { credit: "0" }))).toEqual([
      422,
      "health_scheme.credit_invalid",
    ]);
    expect(codeOf(await put(id, "health_response", "na", { credit: "0" }))).toEqual([
      422,
      "health_scheme.credit_invalid",
    ]);
    expect((await put(id, "health_response", "maybe", { credit: "0" })).status).toBe(422);
    expect(codeOf(await put(id, "health_band", "b0152_99", ownBand("x", "5", "5-9"), "source"))).toEqual([
      422,
      "config_version.unknown_element",
    ]);
    // N/A on points: the publish rule's order answers na_needs_percent before the bands.
    expect((await put(id, "health_response", "na", { credit: null })).status).toBe(200);
    expect(
      codeOf(await preview(id, [{ kind: "record", recordType: "health_assessment", input: { answers: {} } }])),
    ).toEqual([422, "health_scheme.na_needs_percent"]);
    // AUD and a member without methodology.configure cannot edit a scheme.
    for (const s of [auditor, member]) {
      const res = await call(api.app, "PUT", `${V}/${id}/elements/health_response/partial`, {
        session: s,
        headers: ifm(await versionOf(id)),
        body: { origin: "admin", attributes: { credit: "0.5" } },
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("the provider's affected records and migration items (ADR-0048 §6; ADR-0040 §2)", () => {
  it("counts a transformation's draft assessment, and lists it as an invalidated_calculation item that keeps its scheme", async () => {
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const other = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const assessmentId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("health_assessment")
        .values({
          id: assessmentId,
          organization_id: w.orgA.id,
          transformation_id: t,
          sequence_no: 1,
          scheme_version_id: V1_ID,
          assessment_date: "2026-10-15",
          owner_user_id: w.office.id,
          created_by: w.office.id,
          updated_by: w.office.id,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "health_assessment",
        recordId: assessmentId,
        organizationId: w.orgA.id,
        newVersion: 1,
      });
    });
    const provider = configKindProvider("health_check_scheme");
    expect(provider.defaultKey).toBe("health-check");
    const counts = await provider.affectedRecords!(api.db, {
      versionId: V1_ID,
      baseVersionId: V1_ID,
      changes: [],
      transformationIds: [t, other],
    });
    expect(counts).toEqual([
      { transformationId: t, recordType: "health_assessment", count: 1, unknownReason: null },
      { transformationId: other, recordType: "health_assessment", count: 0, unknownReason: null },
    ]);
    const items = await provider.migrationItems!(api.db, {
      transformationId: t,
      fromVersionId: V1_ID,
      toVersionId: V1_ID,
    });
    expect(items).toEqual([
      {
        itemKind: "invalidated_calculation",
        elementType: null,
        stableKey: null,
        recordType: "health_assessment",
        recordId: assessmentId,
        resolution: "acknowledged",
        detail: {
          assessmentId,
          sequenceNo: 1,
          schemeVersionId: V1_ID,
          fromVersionId: V1_ID,
          toVersionId: V1_ID,
          keepsScheme: true,
        },
      },
    ]);
    expect(
      await provider.migrationItems!(api.db, { transformationId: other, fromVersionId: V1_ID, toVersionId: V1_ID }),
    ).toEqual([]);
  });
});
