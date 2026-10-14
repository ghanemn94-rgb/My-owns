// The source-completeness gate (ADR-0039 §1, §6, §9, §11-§13; REQ-S02-001; p5-work-split §A.3; T-DG5-BE-B2) against a
// real PostgreSQL:
//  - REQ-S02-001 literal: the report shows 2 modes, 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums,
//    6 lifecycle steps, 3 launch windows, 1 roaming example and 25 questions on v1 (a set whose features are still
//    `planned` in the inventory is `warn`, never green); deleting a template (T13) in a draft methodology makes the
//    check `fail` (the recorded run is what publish needs, MV16; the publish refusal itself is BE-B3's);
//  - a removal through a `source_element` row counts too; an admin-added template never counts; restoring the element
//    gives a new run for the new hash while the failed run stays (append-only);
//  - the run: ADM_METHOD positive; AUD, TO and BO 403; nobody 403 on the report; commit-time re-authorization (403,
//    nothing written); If-Match honoured when sent (409 stale); 409 not_editable on a published or discarded version;
//    404 for an unknown or non-methodology version; one audit event per run, none for a refusal.
// The expected `warn` sets are read from the inventory, because BE-P, BE-T and KBE-G move their rows to `working` when
// their features ship (p5-work-split §A rule A-7). Each test seeds its own synthetic base key (studio-fixtures.ts).
// All data is synthetic; a coverage run tests configuration, approves nothing and never touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
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
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let auditor: Session;
let office: Session;
let bo: Session;
let nobody: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  const boUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, boUser.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, boUser.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const COVERAGE = "/api/v1/admin/source-coverage";
const RUNS = `${COVERAGE}/runs`;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);
const SETS = [
  "mode",
  "phase",
  "gate",
  "template",
  "tom_dimension",
  "forum",
  "benefit_lifecycle_step",
  "launch_window",
  "roaming_example",
  "health_question",
];
/** REQ-S02-001's acceptance counts, in report order. */
const COUNTS = [2, 6, 6, 16, 10, 5, 6, 3, 1, 25];

/** Per set, the inventory keys whose feature is still `planned` (rule A-7 moves them to `working`). */
async function plannedBySet(): Promise<Map<string, string[]>> {
  const rows = await api.db
    .selectFrom("source_element")
    .select(["set_code", "stable_key"])
    .where("feature_status", "=", "planned")
    .orderBy("ordinal")
    .execute();
  const out = new Map<string, string[]>(SETS.map((s) => [s, []]));
  for (const r of rows) out.get(r.set_code)?.push(r.stable_key);
  return out;
}

async function freshDraft(): Promise<{ id: string; baseId: string }> {
  const base = await seedStudioBase(api, "methodology");
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(res.status).toBe(201);
  return { id: res.body.id, baseId: base.id };
}
const getVersion = async (id: string) => (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body;
const report = (versionId?: string, s = admin) =>
  call<Body>(api.app, "GET", versionId === undefined ? COVERAGE : `${COVERAGE}?versionId=${versionId}`, { session: s });
const run = (versionId: string, s = admin, headers: Record<string, string> = {}) =>
  call<Body>(api.app, "POST", RUNS, { session: s, headers, body: { versionId } });
const runsOf = (id: string) =>
  api.db.selectFrom("config_check_run").selectAll().where("methodology_version_id", "=", id).orderBy("id").execute();
const removeEl = (id: string, type: string, key: string, version: number) =>
  call<Body>(api.app, "POST", `${V}/${id}/elements/${type}/${key}/remove`, { session: admin, headers: ifm(version) });
const putEl = (id: string, type: string, key: string, version: number, body: Record<string, unknown>) =>
  call<Body>(api.app, "PUT", `${V}/${id}/elements/${type}/${key}`, { session: admin, headers: ifm(version), body });

describe("getSourceCoverage (REQ-S02-001; ADR-0039 §6)", () => {
  it("v1 shows 2/6/6/16/10/5/6/3/1/25 with nothing removed; sets with planned features are warn, never green", async () => {
    const playbook = await api.db
      .selectFrom("methodology_version")
      .select(["id", "content_sha256"])
      .where("key", "=", "playbook")
      .where("status", "=", "published")
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    const res = await report(undefined, auditor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ versionId: playbook.id, contentSha256: playbook.content_sha256 });
    expect(res.body.sets.map((s: Body) => s.setCode)).toEqual(SETS);
    expect(res.body.sets.map((s: Body) => s.expected)).toEqual(COUNTS);
    expect(res.body.sets.map((s: Body) => s.present)).toEqual(COUNTS);
    const planned = await plannedBySet();
    for (const s of res.body.sets) {
      expect(s.removed, s.setCode).toEqual([]);
      expect(s.plannedFeatures, s.setCode).toEqual(planned.get(s.setCode));
      expect(s.result, s.setCode).toBe(planned.get(s.setCode)!.length > 0 ? "warn" : "pass");
    }
    const anyPlanned = [...planned.values()].some((k) => k.length > 0);
    expect(res.body.result).toBe(anyPlanned ? "warn" : "pass");
    // At this commit the three sets the plan names are planned (ADR-0039 §6); this holds until rule A-7 ships them.
    for (const set of ["launch_window", "roaming_example", "health_question"])
      if (planned.get(set)!.length > 0)
        expect(res.body.sets.find((s: Body) => s.setCode === set).result, set).toBe("warn");
    // Reading writes nothing.
    expect(await runsOf(playbook.id)).toEqual([]);
  });

  it("deleting T13 in a draft makes the report fail (15 of 16 templates), and the run records fail for that hash", async () => {
    const d = await freshDraft();
    const removed = await removeEl(d.id, "template", "T13", 1);
    expect(removed.status).toBe(200);
    const res = await report(d.id);
    expect(res.status).toBe(200);
    const template = res.body.sets.find((s: Body) => s.setCode === "template");
    expect(template).toMatchObject({ expected: 16, present: 15, removed: ["T13"], result: "fail" });
    expect(res.body.result).toBe("fail");
    expect(res.body.contentSha256).toBe(removed.body.contentSha256);

    const r = await run(d.id);
    expect(r.status).toBe(201);
    expect(r.headers["location"]).toBe(`${V}/${d.id}/check-runs`);
    expect(r.body).toMatchObject({
      versionId: d.id,
      checkKind: "source_coverage",
      contentSha256: removed.body.contentSha256,
      result: "fail",
    });
    expect(r.body.report.sets.find((s: Body) => s.setCode === "template").removed).toEqual(["T13"]);
    const rows = await runsOf(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.body.id, check_kind: "source_coverage", result: "fail" });
    expect(await actions(r.body.id)).toEqual(["config_check_run.source_coverage"]);
    // The draft shows the failed run as its latest coverage check for its current hash (what publish reads, MV16).
    expect((await getVersion(d.id)).latestChecks.sourceCoverage).toMatchObject({
      checkRunId: r.body.id,
      result: "fail",
    });
  });

  it("a removal through a source_element row counts; an admin-added template never counts; restoring passes again", async () => {
    const d = await freshDraft();
    expect((await removeEl(d.id, "source_element", "forum.value_review", 1)).status).toBe(200);
    const added = await putEl(d.id, "template", "T99", 2, {
      attributes: { labelEn: "Synthetic admin template", labelAr: "نموذج تجريبي" },
    });
    expect(added.status).toBe(200);
    const res = await report(d.id);
    expect(res.body.sets.find((s: Body) => s.setCode === "forum")).toMatchObject({
      expected: 5,
      present: 4,
      removed: ["value_review"],
      result: "fail",
    });
    expect(res.body.sets.find((s: Body) => s.setCode === "template")).toMatchObject({ present: 16, removed: [] });
    const failed = await run(d.id);
    expect(failed.body.result).toBe("fail");

    const restored = await putEl(d.id, "source_element", "forum.value_review", 3, { attributes: {} });
    expect(restored.status).toBe(200);
    const again = await run(d.id);
    expect(again.status).toBe(201);
    expect(again.body.result).not.toBe("fail");
    expect(again.body.contentSha256).toBe(restored.body.contentSha256);
    expect(again.body.contentSha256).not.toBe(failed.body.contentSha256);
    // Append-only: the failed run stays, for its own (now stale) hash.
    expect((await runsOf(d.id)).map((r) => [r.id, r.result])).toEqual([
      [failed.body.id, "fail"],
      [again.body.id, again.body.result],
    ]);
  });

  it("refuses: 400 bad id; 403 without methodology.read; 404 unknown or non-methodology version", async () => {
    expect((await report("x")).status).toBe(400);
    expect((await report(undefined, nobody)).status).toBe(403);
    expect((await report(crypto.randomUUID())).status).toBe(404);
    const scoring = await seedStudioBase(api, "scoring_defaults");
    expect((await report(scoring.id)).status).toBe(404);
  });
});

describe("runSourceCoverageCheck (ADR-0039 §6, §9, §11)", () => {
  it("only ADM_METHOD runs it: AUD, TO and BO get 403 and nothing is written", async () => {
    const d = await freshDraft();
    for (const s of [auditor, office, bo, nobody]) expect((await run(d.id, s)).status).toBe(403);
    expect(await runsOf(d.id)).toEqual([]);
    expect(await actions(d.id)).toEqual(["methodology_version.create_draft"]);
    expect((await run(d.id)).status).toBe(201);
  });

  it("re-checks authorization at commit time: a grant revoked mid-request gives 403 and writes nothing", async () => {
    const d = await freshDraft();
    const u = await methodologyAdmin(api.db, w);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => run(d.id, s),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await runsOf(d.id)).toEqual([]);
  });

  it("honours an If-Match the client sends (409 when stale) and needs none (the contract declares none)", async () => {
    const d = await freshDraft();
    expect(codeOf(await run(d.id, admin, ifm(7)))).toEqual([409, "version_conflict"]);
    expect(await runsOf(d.id)).toEqual([]);
    expect((await run(d.id, admin, ifm(1))).status).toBe(201);
    expect((await run(d.id)).status).toBe(201);
    expect((await call<Body>(api.app, "POST", RUNS, { session: admin, body: {} })).status).toBe(400);
    expect((await call<Body>(api.app, "POST", RUNS, { session: admin, body: { versionId: d.id, x: 1 } })).status).toBe(
      400,
    );
  });

  it("409 not_editable on a published or discarded version; 404 on an unknown or non-methodology one", async () => {
    const d = await freshDraft();
    expect(codeOf(await run(d.baseId))).toEqual([409, "config_version.not_editable"]);
    const discarded = await call<Body>(api.app, "POST", `${V}/${d.id}/discard`, { session: admin, headers: ifm(1) });
    expect(discarded.status).toBe(200);
    expect(codeOf(await run(d.id))).toEqual([409, "config_version.not_editable"]);
    expect((await run(crypto.randomUUID())).status).toBe(404);
    const scoring = await seedStudioBase(api, "scoring_defaults");
    expect((await run(scoring.id)).status).toBe(404);
    expect(await runsOf(d.id)).toEqual([]);
    expect(await runsOf(d.baseId)).toEqual([]);
  });
});
