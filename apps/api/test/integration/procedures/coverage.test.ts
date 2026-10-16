// The methodology coverage view (ADR-0042 §6, §9, §11; REQ-S01-003; p5-work-split §C.3; T-DG5-BE-G) against a real
// PostgreSQL. REQ-S01-003 (its A01 clause, judged on its own text at DG5, p5-plan R1): "every seeded methodology element
// shows a linked form or procedure in the coverage view". Slice H has shipped (0088; T-DG5-BE-P, BE-P2, KBE-G, KBE-G2):
// the launch windows and health questions are covered by their own modules (the launch plan and the health check),
// not by a form-framework record type, and no element shows Planned (T-DG5-BE-G2, D-160 c). A module-owned element
// whose feature had not shipped would still show Planned, never green. The status is computed live from the registry,
// the source inventory and the newest published `procedures` version; totals are integers. Read-only; every value is
// synthetic.
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
    // Nothing is uncovered and, with slice H shipped, nothing is Planned: every element resolves to a working target.
    expect(t.notCovered).toBe(0);
    expect(t.planned).toBe(0);
    expect(t.covered).toBe(80);
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

  it("launch windows and health questions are covered by their own modules, not by a form-framework record type", async () => {
    const view = methodologyCoverage.parse((await call<Body>(api.app, "GET", COVERAGE, { session: auditor })).body);
    const of = (set: string) => view.elements.filter((e) => e.setCode === set);
    expect(of("launch_window")).toHaveLength(3);
    expect(of("health_question")).toHaveLength(25);
    for (const e of of("launch_window")) {
      expect(e.status, `${e.setCode}.${e.stableKey}`).toBe("covered");
      expect(e.links).toEqual([
        { targetKind: "form", targetCode: "launch_plan", resolved: true, featureStatus: "working" },
      ]);
    }
    for (const e of of("health_question")) {
      expect(e.status, `${e.setCode}.${e.stableKey}`).toBe("covered");
      expect(e.links).toEqual([
        { targetKind: "form", targetCode: "health_assessment", resolved: true, featureStatus: "working" },
      ]);
    }
    // The form framework does not own them: their registry rows stay planned with no table (the form framework keeps
    // refusing them), so the Covered status above comes from the modules, not from the form registry.
    const registry = await api.db
      .selectFrom("form_record_type")
      .select(["code", "feature_status", "table_name"])
      .where("code", "in", ["launch_plan", "health_assessment"])
      .orderBy("code")
      .execute();
    expect(registry).toEqual([
      { code: "health_assessment", feature_status: "planned", table_name: null },
      { code: "launch_plan", feature_status: "planned", table_name: null },
    ]);
    // Every element is Covered; no element shows Planned.
    expect(view.elements.every((e) => e.status === "covered")).toBe(true);
    expect([view.totals.covered, view.totals.planned, view.totals.notCovered]).toEqual([80, 0, 0]);
    const t10 = view.elements.find((e) => e.setCode === "template" && e.stableKey === "T10");
    expect(t10?.links).toEqual([
      { targetKind: "procedure", targetCode: "kpi_submission", resolved: true, featureStatus: "working" },
    ]);
    const gate = view.elements.find((e) => e.setCode === "gate");
    expect(gate?.links.map((l) => l.targetCode)).toEqual(["gate_review"]);
    expect(gate?.sourceRef).toMatch(/^B\d{4}/);
  });

  it("the status is live: a module-owned element whose feature is not shipped reads Planned (never green)", async () => {
    // Simulates (in a disposable transaction, rolled back) the source inventory before 0088 moved slice H to working.
    const owner = createDb(api.owner); // the suite's owner pool; the harness ends it
    await owner
      .transaction()
      .execute(async (tx) => {
        const before = await loadMethodologyCoverage(tx, undefined);
        expect(before.totals.planned).toBe(0);
        await tx
          .updateTable("source_element")
          .set({ feature_status: "planned" })
          .where("set_code", "=", "launch_window")
          .execute();
        const after = await loadMethodologyCoverage(tx, undefined);
        const windows = after.elements.filter((e) => e.setCode === "launch_window");
        expect(windows.map((e) => e.status)).toEqual(["planned", "planned", "planned"]);
        for (const e of windows)
          expect(e.links).toEqual([
            { targetKind: "form", targetCode: "launch_plan", resolved: true, featureStatus: "planned" },
          ]);
        // Only those three moved: the health questions stay Covered by the health-check module.
        expect([after.totals.covered, after.totals.planned, after.totals.notCovered]).toEqual([77, 3, 0]);
        // A form-framework target still follows the registry: a planned registry row makes its element Planned.
        await tx
          .updateTable("form_record_type")
          .set({ feature_status: "planned", table_name: null, custom_fields_allowed: false })
          .where("code", "=", "T15")
          .execute();
        const t15 = (await loadMethodologyCoverage(tx, undefined)).elements.find(
          (e) => e.setCode === "template" && e.stableKey === "T15",
        );
        expect(t15?.status).toBe("planned");
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
