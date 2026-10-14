// The methodology coverage view (ADR-0042 §6, §9, §11; REQ-S01-003; p5-work-split §C.3; T-DG5-BE-G) against a real
// PostgreSQL. REQ-S01-003 (its A01 clause, judged on its own text at DG5, p5-plan R1): "every seeded methodology element
// shows a linked form or procedure in the coverage view"; launch windows and health questions show Planned (never
// green) until slice H ships their forms; the status is computed live from the registry and the newest published
// `procedures` version; totals are integers. Read-only; every value is synthetic.
import { createDb } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMethodologyCoverage, methodologyCoverage } from "../../../src/modules/procedures/coverage.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const COVERAGE = "/api/v1/admin/coverage";

let api: TestApi;
let w: World;
let admin: Session;
let auditor: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 120_000);
afterAll(() => api.close());

describe("getMethodologyCoverage (REQ-S01-003)", () => {
  it("every one of the 80 source elements shows a linked form or procedure; integer totals add up", async () => {
    const res = await call<Body>(api.app, "GET", COVERAGE, { session: admin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = methodologyCoverage.parse(res.body);
    const inventory = await api.db.selectFrom("source_element").select(["set_code", "stable_key"]).execute();
    expect(view.elements).toHaveLength(80);
    expect(view.elements).toHaveLength(inventory.length);
    expect(new Set(view.elements.map((e) => `${e.setCode}.${e.stableKey}`))).toEqual(
      new Set(inventory.map((e) => `${e.set_code}.${e.stable_key}`)),
    );
    for (const e of view.elements) expect(e.links.length, `${e.setCode}.${e.stableKey}`).toBeGreaterThan(0);
    const t = view.totals;
    expect([t.covered, t.planned, t.notCovered].every(Number.isInteger)).toBe(true);
    expect(t.covered + t.planned + t.notCovered).toBe(t.total);
    expect(t.total).toBe(80);
    // Nothing is uncovered: each element resolves to a working target or (slice H) is Planned.
    expect(t.notCovered).toBe(0);
    // The versions it read: the newest published playbook, procedures and forms versions.
    const newest = async (kind: string, key: string) =>
      (
        await api.db
          .selectFrom("methodology_version")
          .select("id")
          .where("config_kind", "=", kind as never)
          .where("key", "=", key)
          .where("status", "=", "published")
          .orderBy("version_no", "desc")
          .executeTakeFirstOrThrow()
      ).id;
    expect([view.methodologyVersionId, view.proceduresVersionId, view.formSchemaVersionId]).toEqual([
      await newest("methodology", "playbook"),
      await newest("procedure", "procedures"),
      await newest("form_schema", "forms"),
    ]);
  });

  it("launch windows and health questions show Planned (never covered) until slice H ships their forms", async () => {
    const view = methodologyCoverage.parse((await call<Body>(api.app, "GET", COVERAGE, { session: auditor })).body);
    const of = (set: string) => view.elements.filter((e) => e.setCode === set);
    expect(of("launch_window")).toHaveLength(3);
    expect(of("health_question")).toHaveLength(25);
    for (const e of [...of("launch_window"), ...of("health_question")]) {
      expect(e.status, `${e.setCode}.${e.stableKey}`).toBe("planned");
      expect(e.links.every((l) => l.targetKind === "form" && l.featureStatus === "planned" && l.resolved)).toBe(true);
    }
    // Every other element resolves to at least one working target: Covered.
    const rest = view.elements.filter((e) => e.setCode !== "launch_window" && e.setCode !== "health_question");
    expect(rest.every((e) => e.status === "covered")).toBe(true);
    expect([view.totals.covered, view.totals.planned]).toEqual([rest.length, 28]);
    // A planned element never reads covered: the status follows the links, not a stored flag.
    const t10 = view.elements.find((e) => e.setCode === "template" && e.stableKey === "T10");
    expect(t10?.links).toEqual([
      { targetKind: "procedure", targetCode: "kpi_submission", resolved: true, featureStatus: "working" },
    ]);
    const gate = view.elements.find((e) => e.setCode === "gate");
    expect(gate?.links.map((l) => l.targetCode)).toEqual(["gate_review"]);
    expect(gate?.sourceRef).toMatch(/^B\d{4}/);
  });

  it("the status is live: a form whose feature ships reads Covered without any write to the coverage links", async () => {
    // Simulates (in a disposable transaction, rolled back) the slice H migration moving the launch-plan form to working.
    const owner = createDb(api.owner); // the suite's owner pool; the harness ends it
    await owner
      .transaction()
      .execute(async (tx) => {
        const before = await loadMethodologyCoverage(tx, undefined);
        expect(before.elements.filter((e) => e.setCode === "launch_window").map((e) => e.status)).toEqual([
          "planned",
          "planned",
          "planned",
        ]);
        await tx
          .updateTable("form_record_type")
          .set({ feature_status: "working", table_name: "launch_plan" })
          .where("code", "=", "launch_plan")
          .execute();
        const after = await loadMethodologyCoverage(tx, undefined);
        expect(after.elements.filter((e) => e.setCode === "launch_window").map((e) => e.status)).toEqual([
          "covered",
          "covered",
          "covered",
        ]);
        expect(after.totals.planned).toBe(25);
        throw new Error("rollback");
      })
      .catch((err: unknown) => {
        if ((err as Error).message !== "rollback") throw err;
      });
  });

  it("authorization and refusals: methodology.read (AUD and ADM_METHOD read); 403 without it; 400; 404", async () => {
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call<Body>(api.app, "GET", COVERAGE, { session: nobody })).status).toBe(403);
    expect((await call<Body>(api.app, "GET", COVERAGE)).status).toBe(401);
    expect((await call<Body>(api.app, "GET", `${COVERAGE}?versionId=nope`, { session: admin })).status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${COVERAGE}?other=1`, { session: admin })).status).toBe(400);
    expect(
      (await call<Body>(api.app, "GET", `${COVERAGE}?versionId=${crypto.randomUUID()}`, { session: admin })).status,
    ).toBe(404);
    // A named methodology version reads; a version of another configuration kind is not a methodology version: 404.
    const base = await seedStudioBase(api, "methodology");
    const named = await call<Body>(api.app, "GET", `${COVERAGE}?versionId=${base.id}`, { session: admin });
    expect([named.status, named.body.methodologyVersionId]).toEqual([200, base.id]);
    const scoring = await seedStudioBase(api, "scoring_defaults");
    expect((await call<Body>(api.app, "GET", `${COVERAGE}?versionId=${scoring.id}`, { session: admin })).status).toBe(
      404,
    );
  });
});
