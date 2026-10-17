// The demo role users on a NEW transformation of the demo business unit (T-DG5-BE-T3; D-165), against the REAL
// synthetic demo dataset (`seedDemo`, International Roaming) in a scratch database of this run's disposable cluster,
// with the REAL API on it (MTH_ENV=demo, AUTH_MODE=dev of the harness):
//   - D-165: seeded with the dev-issuer binding (what `mth-db seed-demo` does with AUTH_MODE=dev), every demo user
//     signs in through the dev sign-in (`POST /auth/dev-login`) as roaming.user.<role>;
//   - D-QA-E-1 (ADR-0050 §7 step 1): the demo TL creates a transformation in the demo business unit (and the demo TO
//     can too and reads it, TO inherits downward); the other role users cannot create one; the TL staffs WL, KDS and CM
//     natively (team view); the demo access administrator assigns the approver roles (SP, BO, FIN) natively and holds
//     no business-record right itself;
//   - QA-E O-2 (procedures v2, migration 0095): the new transformation's baseline_validation instance assigns
//     record_baseline to TL, and TL completes it end to end (the baseline recorded natively, Finance validates it, the
//     validated baseline is linked); the BO, no longer the assignee, is refused; procedures v1 is unchanged.
// Everything is SYNTHETIC. The Finance validation here is a synthetic in-product decision on test data that approves
// nothing real; nothing names the engineering gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN, DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const BU = DEMO_ANCHORS.businessUnitId;
const SEEDED_T = DEMO_ANCHORS.transformationId;
const PROCEDURES_V1 = "01920005-0300-7000-8000-000000000001";
const PROCEDURES_V2 = "01920005-0300-7000-8000-000000000002";
const REASON = "Synthetic demonstration role for the walkthrough (approves nothing real)";

let api: TestApi;
let scratch: string | null = null;
const s: Record<string, Session> = {};
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const user = (role: string) => DEMO_USERS.find((u) => u.role === role)!;
let created = "";

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_demo_users_new_t");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("D-165: the demo users sign in through the dev sign-in of a dev-mode stack", () => {
  it("every demo user (eight role users and the access administrator) signs in as roaming.user.<role>", async () => {
    for (const u of [...DEMO_USERS, DEMO_ACCESS_ADMIN]) {
      const session = await signIn(api.app, u.name);
      s[u.role] = session;
      const me = await send("GET", "/api/v1/me", { session });
      expect([me.status, me.body.user.id], u.name).toEqual([200, u.id]);
    }
    // An unknown subject is refused (negative).
    const stranger = await send("POST", "/api/v1/auth/dev-login", { body: { username: "roaming.user.nobody" } });
    expect(stranger.status).toBe(401);
  });
});

describe("D-QA-E-1: the demo role users act on a new transformation of the demo business unit", () => {
  it("the demo TL creates it (201) and holds TL there; the walkthrough's step 1 is complete for it", async () => {
    const res = await send("POST", "/api/v1/transformations", {
      session: s["TL"]!,
      body: { businessUnitId: BU, name: "Synthetic demo walkthrough transformation", mode: "end_to_end" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created = res.body.id;
    const team = await send("GET", `/api/v1/transformations/${created}/scoped-assignments?limit=100`, {
      session: s["TL"]!,
    });
    expect(team.status, JSON.stringify(team.body)).toBe(200);
    const members = team.body.items.map((a: Body) => [a.assignment.userId, a.assignment.roleCode, a.inherited]);
    expect(members).toContainEqual([user("TL").id, "TL", false]);
    // The demo TO holds TO here through its business-unit grant (inherited downward).
    expect(members).toContainEqual([user("TO").id, "TO", true]);
    const w = await send("GET", `/api/v1/demo/walkthrough?transformationId=${created}`, { session: s["TL"]! });
    expect(w.status).toBe(200);
    expect(w.body.steps.find((x: Body) => x.code === "create_transformation").completed).toBe(true);
  });

  it("the demo TO reads it (TO inherits downward from the business unit) and can also create one", async () => {
    expect((await send("GET", `/api/v1/transformations/${created}`, { session: s["TO"]! })).status).toBe(200);
    const res = await send("POST", "/api/v1/transformations", {
      session: s["TO"]!,
      body: { businessUnitId: BU, name: "Synthetic demo TO transformation", mode: "end_to_end" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("the other role users and the access administrator cannot create one, nor read the new one unassigned", async () => {
    for (const role of ["SP", "BO", "FIN", "KDS", "WL", "CM", "ADM_ACCESS"]) {
      const res = await send("POST", "/api/v1/transformations", {
        session: s[role]!,
        body: { businessUnitId: BU, name: "Synthetic refused transformation", mode: "end_to_end" },
      });
      expect([403, 404], `${role}: ${res.status}`).toContain(res.status);
      if (role !== "ADM_ACCESS")
        expect((await send("GET", `/api/v1/transformations/${created}`, { session: s[role]! })).status, role).toBe(404);
    }
    // They keep their roles on the seeded roaming transformation.
    for (const role of ["SP", "BO", "FIN", "KDS", "WL", "CM"])
      expect((await send("GET", `/api/v1/transformations/${SEEDED_T}`, { session: s[role]! })).status, role).toBe(200);
  });

  it("the TL staffs WL, KDS and CM natively; the access administrator assigns SP, BO and FIN natively", async () => {
    for (const role of ["WL", "KDS", "CM"]) {
      const res = await send("POST", `/api/v1/transformations/${created}/scoped-assignments`, {
        session: s["TL"]!,
        body: { userId: user(role).id, roleCode: role, reason: REASON },
      });
      expect(res.status, `${role}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    // The TL cannot assign an approver role through the team view (negative; the team schema admits WL, KDS, TD, CM
    // and SEC only).
    const tlSp = await send("POST", `/api/v1/transformations/${created}/scoped-assignments`, {
      session: s["TL"]!,
      body: { userId: user("SP").id, roleCode: "SP", reason: REASON },
    });
    expect([tlSp.status, tlSp.body.code]).toEqual([400, "validation"]);
    for (const role of ["SP", "BO", "FIN"]) {
      const res = await send("POST", "/api/v1/role-assignments", {
        session: s["ADM_ACCESS"]!,
        body: { userId: user(role).id, roleCode: role, scope: { type: "transformation", id: created }, reason: REASON },
      });
      expect(res.status, `${role}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    for (const role of ["SP", "BO", "FIN", "KDS", "WL", "CM"])
      expect((await send("GET", `/api/v1/transformations/${created}`, { session: s[role]! })).status, role).toBe(200);
    // The access administrator cannot grant itself a role (negative) and reads no business record.
    const self = await send("POST", "/api/v1/role-assignments", {
      session: s["ADM_ACCESS"]!,
      body: {
        userId: DEMO_ACCESS_ADMIN.id,
        roleCode: "SP",
        scope: { type: "transformation", id: created },
        reason: REASON,
      },
    });
    expect([self.status, self.body.code]).toEqual([422, "access.self_grant"]);
    expect([403, 404]).toContain(
      (await send("GET", `/api/v1/transformations/${created}`, { session: s["ADM_ACCESS"]! })).status,
    );
  });
});

describe("QA-E O-2: procedures v2 assigns record_baseline to TL (migration 0095)", () => {
  it("v2 is the newest published procedures version, based on v1; v1 is unchanged (BO)", async () => {
    const versions = await api.db
      .selectFrom("methodology_version")
      .select(["id", "version_no", "status", "origin", "based_on_version_id"])
      .where("config_kind", "=", "procedure")
      .where("key", "=", "procedures")
      .orderBy("version_no")
      .execute();
    expect(versions).toEqual([
      { id: PROCEDURES_V1, version_no: 1, status: "published", origin: "seed", based_on_version_id: null },
      { id: PROCEDURES_V2, version_no: 2, status: "published", origin: "seed", based_on_version_id: PROCEDURES_V1 },
    ]);
    const roleOf = async (versionId: string) =>
      (
        await api.db
          .selectFrom("procedure_step_definition as s")
          .innerJoin("procedure_definition as d", "d.id", "s.procedure_definition_id")
          .select(["s.responsible_role_code"])
          .where("d.methodology_version_id", "=", versionId)
          .where("d.code", "=", "baseline_validation")
          .where("s.step_key", "=", "record_baseline")
          .executeTakeFirstOrThrow()
      ).responsible_role_code;
    expect([await roleOf(PROCEDURES_V1), await roleOf(PROCEDURES_V2)]).toEqual(["BO", "TL"]);
    // Every other step of v2 equals v1's (31 steps, ten definitions).
    const steps = async (versionId: string) =>
      (
        await api.db
          .selectFrom("procedure_step_definition as s")
          .innerJoin("procedure_definition as d", "d.id", "s.procedure_definition_id")
          .select([
            "d.code",
            "s.step_key",
            "s.ordinal",
            "s.step_kind",
            "s.responsible_role_code",
            "s.approval_role_code",
          ])
          .where("d.methodology_version_id", "=", versionId)
          .orderBy("d.code")
          .orderBy("s.step_key")
          .execute()
      ).map((r) => ({ ...r, responsible_role_code: r.step_key === "record_baseline" ? "-" : r.responsible_role_code }));
    expect(await steps(PROCEDURES_V2)).toEqual(await steps(PROCEDURES_V1));
    expect(await steps(PROCEDURES_V2)).toHaveLength(31);
  });

  it("a new transformation's baseline_validation assigns record_baseline to TL, who completes it end to end", async () => {
    const T = `/api/v1/transformations/${created}`;
    const launched = await send("POST", "/api/v1/procedure-instances", {
      session: s["TL"]!,
      body: {
        procedureCode: "baseline_validation",
        transformationId: created,
        inputValues: {
          metric: "Synthetic roaming attach rate",
          value: "12.50",
          unit: "%",
          baselineDate: "2026-08-31",
          source: "Synthetic billing extract",
        },
      },
    });
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    const I = `/api/v1/procedure-instances/${launched.body.id}`;
    expect(launched.body.methodologyVersionId).toBe(PROCEDURES_V2);
    expect(launched.body.currentStepKeys).toEqual(["record_baseline"]);
    const current = launched.body.steps.find((x: Body) => x.stepKey === "record_baseline");
    expect([current.status, current.assigneeRoleCode]).toEqual(["active", "TL"]);
    // The BO is not the assignee any more (negative): 403 procedure_step.not_assignee.
    const byBo = await send("POST", `${I}/steps/record_baseline/complete`, {
      session: s["BO"]!,
      headers: ifm(launched.body.version),
      body: { note: "Synthetic" },
    });
    expect([byBo.status, byBo.body.code]).toEqual([403, "procedure_step.not_assignee"]);
    // The TL records the baseline natively (baseline.edit), links the evidence and completes the step with it.
    const ev = await send("POST", `${T}/evidence`, {
      session: s["TL"]!,
      body: { kind: "note", title: "Synthetic baseline extract", noteBody: "Synthetic", ownerUserId: user("TL").id },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const linked = await send("POST", `${I}/steps/record_baseline/evidence`, {
      session: s["TL"]!,
      headers: ifm(launched.body.version),
      body: { evidenceId: ev.body.id },
    });
    expect([200, 201], JSON.stringify(linked.body)).toContain(linked.status);
    const b = await send("POST", `${T}/baselines`, {
      session: s["TL"]!,
      body: {
        metric: "Synthetic roaming attach rate",
        unit: "%",
        scope: "customer",
        value: "12.50",
        source: "Synthetic billing extract",
        baselineDate: "2026-08-31",
      },
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const done1 = await send("POST", `${I}/steps/record_baseline/complete`, {
      session: s["TL"]!,
      headers: ifm(linked.body.version),
      body: { note: "Synthetic", outputRecordId: b.body.id },
    });
    expect(done1.status, JSON.stringify(done1.body)).toBe(200);
    expect(done1.body.currentStepKeys).toEqual(["validate_baseline"]);
    // Finance validates it (DG2 validation; a synthetic in-product decision) and completes its step.
    const v = await send("POST", `${T}/baselines/${b.body.id}/validation`, {
      session: s["FIN"]!,
      headers: ifm(b.body.version),
      body: { result: "validated", note: "Synthetic: matches the extract." },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const done2 = await send("POST", `${I}/steps/validate_baseline/complete`, {
      session: s["FIN"]!,
      headers: ifm(done1.body.version),
      body: { note: "Synthetic" },
    });
    expect(done2.status, JSON.stringify(done2.body)).toBe(200);
    expect(done2.body.status).toBe("completed");
    expect(
      done2.body.links.filter((l: Body) => l.linkKind === "output").map((l: Body) => [l.recordType, l.recordId]),
    ).toContainEqual(["baseline", b.body.id]);
    const stored = await api.db
      .selectFrom("baseline")
      .select(["validation_status"])
      .where("id", "=", b.body.id)
      .executeTakeFirstOrThrow();
    expect(stored.validation_status).toBe("validated");
  });
});
