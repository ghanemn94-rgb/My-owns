// Procedure definitions and the `procedure` kind provider (ADR-0042 §1-§2, §9-§10; REQ-S06-001, REQ-S16-015 (the
// ProcedureDefinition create/read); p5-work-split §C.1; T-DG5-BE-F) against a real PostgreSQL:
//  - REQ-S06-001 literal: a definition with a conditional and a parallel step validates, is saved in a draft, previewed,
//    reviewed (TO) and published through the slice A pipeline (the launch half is BE-F2's, ADR-0042 §3);
//  - a definition missing a trigger -> 422 procedure_definition.trigger_required; missing a completion condition ->
//    422 procedure_definition.completion_required; ADM_METHOD as a responsible role -> 422 role_not_allowed; removing a
//    seeded procedure -> 422 source_protected; editing a published version -> 409 config_version.not_editable;
//  - every mutation: AUD 403; If-Match 428/409 on the draft; one audit event per row written; authorization re-checked
//    at commit time (403, nothing written);
//  - the lineage rows: a draft holds its base's ten procedures before any edit, and its first edit copies them;
//    the content hash covers the procedure rows (an edit after preview invalidates the run).
// Each test seeds its own synthetic procedures key (test/support/procedures-fixtures.ts), so parallel suites never share
// a draft. All data is synthetic; a configuration review or publish approves nothing in the business, an approval step
// only NAMES the business role that decides through the canonical approval, and nothing touches DG0-DG7.
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
import { seedProceduresVersion, syntheticDefinitionBody } from "../../support/procedures-fixtures.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let reviewer: Session;
let auditor: Session;
let bo: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reviewer = await signIn(api.app, r.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  const b = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, b.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, b.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const D = "/api/v1/procedure-definitions";
const A = (versionId: string, code: string) => `/api/v1/admin/procedure-definitions/${versionId}/${code}`;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;

async function freshDraft(): Promise<{ id: string; baseId: string; key: string }> {
  const base = await seedProceduresVersion(api);
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, baseId: base.id, key: base.key };
}
const put = async (draftId: string, code: string, body: Body, s = admin, version?: number) =>
  call<Body>(api.app, "PUT", A(draftId, code), {
    session: s,
    headers: ifm(version ?? (await versionOf(draftId))),
    body,
  });
const rowsOf = (versionId: string) =>
  api.db
    .selectFrom("procedure_definition")
    .select(["id", "code", "removed", "origin"])
    .where("methodology_version_id", "=", versionId)
    .execute();

describe("putProcedureDefinition and the slice A pipeline (REQ-S06-001)", () => {
  it("a definition with a conditional and a parallel step validates, is saved in a draft, previewed, reviewed (TO) and published", async () => {
    const d = await freshDraft();
    const body = syntheticDefinitionBody();

    // Validates (every finding; none here).
    const valid = await call<Body>(api.app, "POST", `${D}/validate`, { session: admin, body });
    expect([valid.status, valid.body]).toEqual([200, { valid: true, findings: [] }]);

    // Saved in the draft: the ten procedures of the base are copied first (one audited insert per row), then the new one.
    expect(await rowsOf(d.id)).toHaveLength(0);
    const saved = await put(d.id, "vendor_onboarding", body, admin, 1);
    expect(saved.status).toBe(200);
    expect(saved.headers["etag"]).toBe('"2"');
    expect(saved.body).toMatchObject({
      code: "vendor_onboarding",
      methodologyVersionId: d.id,
      versionStatus: "draft",
      origin: "admin",
      productDefaults: false,
      trigger: { kind: "manual", event: null },
      approval: { mode: "any", roleCodes: ["SP"] },
      completion: { rule: "all_steps_closed" },
      version: 1,
    });
    expect(
      saved.body.steps.map((s: Body) => [s.stepKey, s.ordinal, s.parallelGroup, s.condition?.operator ?? null]),
    ).toEqual([
      ["collect", 1, null, null],
      ["finance_check", 2, "reviews", "gte"],
      ["legal_check", 2, "reviews", "eq"],
      ["sponsor_approval", 3, null, null],
    ]);
    const rows = await rowsOf(d.id);
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.origin === "source")).toHaveLength(10);
    const steps = await api.db
      .selectFrom("procedure_step_definition as s")
      .innerJoin("procedure_definition as p", "p.id", "s.procedure_definition_id")
      .select("s.id")
      .where("p.methodology_version_id", "=", d.id)
      .execute();
    expect(steps).toHaveLength(31 + 4);
    // One audit event per row written: 41 copies, the definition, its 4 steps and the draft's version step.
    const created = rows.find((r) => r.code === "vendor_onboarding");
    expect((await auditOf(api.db, created?.id ?? "")).map((e) => e.action)).toEqual(["procedure_definition.put"]);
    for (const r of rows.filter((x) => x.origin === "source"))
      expect((await auditOf(api.db, r.id)).map((e) => e.action)).toEqual(["procedure_definition.copy"]);
    for (const s of steps) expect(await auditOf(api.db, s.id)).toHaveLength(1);
    const draftEvents = (await auditOf(api.db, d.id)).map((e) => e.action);
    expect(draftEvents).toEqual(["methodology_version.create_draft", "methodology_version.procedure_put"]);

    // Read back in the draft (methodology.read) and listed with the ten seeded procedures.
    const got = await call<Body>(api.app, "GET", `${D}/vendor_onboarding?versionId=${d.id}`, { session: auditor });
    expect([got.status, got.body.code, got.headers["etag"]]).toEqual([200, "vendor_onboarding", '"1"']);
    const list = await call<Body>(api.app, "GET", `${D}?versionId=${d.id}&limit=5`, { session: auditor });
    expect([list.status, list.body.items.length, typeof list.body.nextCursor]).toEqual([200, 5, "string"]);
    const rest = await call<Body>(api.app, "GET", `${D}?versionId=${d.id}&cursor=${list.body.nextCursor}`, {
      session: auditor,
    });
    expect(rest.body.items.map((x: Body) => x.code)).toContain("vendor_onboarding");
    expect(list.body.items.length + rest.body.items.length).toBe(11);
    // A business role without methodology.read never sees a draft.
    expect((await call(api.app, "GET", `${D}?versionId=${d.id}`, { session: bo })).status).toBe(404);

    // Previewed: the sample's conditions are evaluated with decimals (finance check not applicable below 1,000,000).
    const pv = await call<Body>(api.app, "POST", `${V}/${d.id}/preview`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
      body: {
        samples: [
          {
            kind: "record",
            recordType: "vendor_onboarding",
            input: {
              inputValues: {
                vendorName: "Synthetic Co",
                contractValue: { amount: "999999.99", currencyCode: "SAR" },
                legalReview: "yes",
              },
            },
          },
        ],
      },
    });
    expect([pv.status, pv.body.result]).toEqual([201, "pass"]);
    const sample = pv.body.report.samples.results[0];
    expect(sample.steps.map((s: Body) => [s.stepKey, s.status])).toEqual([
      ["collect", "applicable"],
      ["finance_check", "not_applicable"],
      ["legal_check", "applicable"],
      ["sponsor_approval", "applicable"],
    ]);
    // The diff shows the added procedure and its steps.
    const diff = await call<Body>(api.app, "GET", `${V}/${d.id}/diff`, { session: admin });
    expect(diff.status).toBe(200);
    expect(
      diff.body.entries.filter((e: Body) => e.change === "added").map((e: Body) => `${e.elementType}:${e.stableKey}`),
    ).toEqual([
      "procedure:vendor_onboarding",
      "procedure_step:vendor_onboarding.collect",
      "procedure_step:vendor_onboarding.finance_check",
      "procedure_step:vendor_onboarding.legal_check",
      "procedure_step:vendor_onboarding.sponsor_approval",
    ]);
    const compat = await call<Body>(api.app, "POST", `${V}/${d.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
    });
    expect([compat.status, compat.body.result]).toEqual([201, "pass"]);

    // Reviewed by TO (the configured reviewer) and published by ADM_METHOD.
    const sub = await call<Body>(api.app, "POST", `${V}/${d.id}/submit-review`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
      body: {},
    });
    expect([sub.status, sub.body.reviewerRoleCode]).toEqual([201, "TO"]);
    const dec = await call<Body>(api.app, "POST", `${V}/${d.id}/reviews/${sub.body.id}/decision`, {
      session: reviewer,
      headers: ifm(1),
      body: { outcome: "approve" },
    });
    expect(dec.status).toBe(200);
    const pub = await call<Body>(api.app, "POST", `${V}/${d.id}/publish`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
    });
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
    const after = await call<Body>(api.app, "GET", `${D}/vendor_onboarding?versionId=${d.id}`, { session: bo });
    expect([after.status, after.body.versionStatus, after.body.steps.length]).toEqual([200, "published", 4]);

    // Editing the published version -> 409 config_version.not_editable (nothing written).
    expect(codeOf(await put(d.id, "vendor_onboarding", body))).toEqual([409, "config_version.not_editable"]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${A(d.id, "vendor_onboarding")}/remove`, {
          session: admin,
          headers: ifm(await versionOf(d.id)),
        }),
      ),
    ).toEqual([409, "config_version.not_editable"]);

    // A new draft of the published version holds its eleven procedures before any edit (lineage rows).
    const next = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: d.id } });
    expect(next.status).toBe(201);
    const inNext = await call<Body>(api.app, "GET", `${D}?versionId=${next.body.id}`, { session: auditor });
    expect(inNext.body.items).toHaveLength(11);
    expect(await rowsOf(next.body.id)).toHaveLength(0);
    await call(api.app, "POST", `${V}/${next.body.id}/discard`, { session: admin, headers: ifm(1) });
  });

  it("an edit after preview returns the draft to editing with a new hash (the procedure rows are hashed)", async () => {
    const d = await freshDraft();
    expect((await put(d.id, "vendor_onboarding", syntheticDefinitionBody(), admin, 1)).status).toBe(200);
    const pv = await call<Body>(api.app, "POST", `${V}/${d.id}/preview`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
      body: { samples: [] },
    });
    expect([pv.status, pv.body.result]).toEqual([201, "pass"]);
    const before = (await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin })).body;
    expect(before.draftStage).toBe("preview");
    const edited = syntheticDefinitionBody();
    (edited["steps"] as Body[])[0].slaWorkingDays = 4; // a step edit only
    expect((await put(d.id, "vendor_onboarding", edited)).status).toBe(200);
    const after = (await call<Body>(api.app, "GET", `${V}/${d.id}`, { session: admin })).body;
    expect(after.draftStage).toBe("editing");
    expect(after.contentSha256).not.toBe(before.contentSha256);
    expect(after.latestChecks.preview).toBeNull();
  });
});

describe("the ADR-0042 §10 refusals", () => {
  it("missing trigger -> trigger_required; missing completion -> completion_required; validate reports every finding", async () => {
    const d = await freshDraft();
    const { trigger: _t, completion: _c, ...neither } = syntheticDefinitionBody();
    const { trigger: _t2, ...noTrigger } = syntheticDefinitionBody();
    const { completion: _c2, ...noCompletion } = syntheticDefinitionBody();
    expect(codeOf(await put(d.id, "no_trigger", noTrigger, admin, 1))).toEqual([
      422,
      "procedure_definition.trigger_required",
    ]);
    const r = await put(d.id, "no_completion", noCompletion, admin, 1);
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "procedure_definition.completion_required",
      "A procedure needs a completion condition.",
    ]);
    const v = await call<Body>(api.app, "POST", `${D}/validate`, {
      session: admin,
      body: { ...neither, responsibleRoleCodes: ["ADM_METHOD"], steps: [] },
    });
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(false);
    expect(v.body.findings.map((f: Body) => [f.code, f.pointer])).toEqual([
      ["procedure_definition.trigger_required", "/trigger"],
      ["procedure_definition.completion_required", "/completion"],
      ["procedure_definition.steps_required", "/steps"],
      ["procedure_definition.role_not_allowed", "/responsibleRoleCodes/0"],
    ]);
    // Nothing was written by the refused puts (no copy, no version step).
    expect(await rowsOf(d.id)).toHaveLength(0);
    expect(await versionOf(d.id)).toBe(1);
  });

  it("ADM_METHOD or AUD as a responsible role -> role_not_allowed; the other builder rules", async () => {
    const d = await freshDraft();
    const steps = syntheticDefinitionBody()["steps"] as Body[];
    const cases: [Record<string, unknown>, string][] = [
      [{ responsibleRoleCodes: ["ADM_METHOD"] }, "procedure_definition.role_not_allowed"],
      [{ steps: [{ ...steps[0], responsibleRoleCode: "AUD" }] }, "procedure_definition.role_not_allowed"],
      [{ steps: [] }, "procedure_definition.steps_required"],
      [
        { steps: [steps[0], { ...steps[1], parallelGroup: null }, steps[2]] },
        "procedure_definition.parallel_group_invalid",
      ],
      [
        { steps: [{ ...steps[1], ordinal: 1, condition: { inputKey: "nope", operator: "eq", value: "x" } }] },
        "procedure_definition.condition_invalid",
      ],
      [
        { steps: [{ ...steps[1], condition: { inputKey: "vendorName", operator: "gt", value: "1" } }] },
        "procedure_definition.condition_invalid",
      ],
      [{ steps: [{ ...steps[0], requiredInputKeys: ["undeclared"] }] }, "procedure_definition.input_unknown"],
      [
        { inputSchema: [{ key: "x", fieldType: "choice", labelEn: "X", labelAr: "س", required: true }] },
        "procedure_definition.input_schema_invalid",
      ],
      [{ steps: [{ ...steps[3], skippable: true }] }, "procedure_definition.approval_step_invalid"],
      [{ steps: [{ ...steps[3], approvalRoleCode: null }] }, "procedure_definition.approval_step_invalid"],
      [{ trigger: { kind: "event", descriptionEn: "e", descriptionAr: "ح" } }, "procedure_definition.trigger_required"],
    ];
    for (const [override, code] of cases)
      expect(codeOf(await put(d.id, "rules_case", syntheticDefinitionBody(override), admin, 1)), code).toEqual([
        422,
        code,
      ]);
    expect(codeOf(await put(d.id, "Bad-Code", syntheticDefinitionBody(), admin, 1))).toEqual([
      422,
      "procedure_definition.code_invalid",
    ]);
    // A shape error is a 400 (duplicate step keys).
    expect((await put(d.id, "dup", syntheticDefinitionBody({ steps: [steps[0], steps[0]] }), admin, 1)).status).toBe(
      400,
    );
    expect(await versionOf(d.id)).toBe(1);
  });

  it("removing a seeded procedure -> 422 source_protected; an admin-authored one is marked removed", async () => {
    const d = await freshDraft();
    const seeded = await call<Body>(api.app, "POST", `${A(d.id, "baseline_validation")}/remove`, {
      session: admin,
      headers: ifm(1),
    });
    expect([seeded.status, seeded.body.code, seeded.body.detail]).toEqual([
      422,
      "procedure_definition.source_protected",
      "Seeded procedures can be edited but not deleted.",
    ]);
    // A seeded procedure is editable (its labels) in a draft.
    const current = await call<Body>(api.app, "GET", `${D}/baseline_validation?versionId=${d.baseId}`, {
      session: admin,
    });
    const {
      id: _i,
      code: _c,
      methodologyVersionId: _m,
      versionNo: _n,
      versionStatus: _s,
      origin: _o,
      removed: _r,
      productDefaults: _p,
      sourceRef: _sr,
      version: _v,
      createdAt: _ca,
      updatedAt: _ua,
      steps,
      ...rest
    } = current.body;
    const edited = await put(
      d.id,
      "baseline_validation",
      {
        ...rest,
        nameEn: "Baseline validation (edited, synthetic)",
        steps: steps.map(({ removed: _x, ...s }: Body) => s),
      },
      admin,
      1,
    );
    expect([edited.status, edited.body.origin, edited.body.productDefaults]).toEqual([200, "source", true]);
    expect((await put(d.id, "vendor_onboarding", syntheticDefinitionBody())).status).toBe(200);
    const removed = await call<Body>(api.app, "POST", `${A(d.id, "vendor_onboarding")}/remove`, {
      session: admin,
      headers: ifm(await versionOf(d.id)),
    });
    expect([removed.status, removed.body.configKind, removed.body.draftStage]).toEqual([200, "procedure", "editing"]);
    expect(removed.headers["etag"]).toBe(`"${removed.body.version}"`);
    const listed = await call<Body>(api.app, "GET", `${D}?versionId=${d.id}`, { session: admin });
    expect(listed.body.items.map((x: Body) => x.code)).not.toContain("vendor_onboarding");
    const all = await call<Body>(api.app, "GET", `${D}?versionId=${d.id}&includeRemoved=true`, { session: admin });
    expect(all.body.items.find((x: Body) => x.code === "vendor_onboarding")?.removed).toBe(true);
    const row = (await rowsOf(d.id)).find((r) => r.code === "vendor_onboarding");
    expect((await auditOf(api.db, row?.id ?? "")).map((e) => e.action)).toEqual([
      "procedure_definition.put",
      "procedure_definition.remove",
    ]);
    // Unknown code -> 404.
    expect(
      (
        await call(api.app, "POST", `${A(d.id, "no_such_procedure")}/remove`, {
          session: admin,
          headers: ifm(await versionOf(d.id)),
        })
      ).status,
    ).toBe(404);
  });
});

describe("authorization and concurrency of the definition writes", () => {
  it("AUD and a business role get 403 on every write; If-Match 428 and 409; 404 for an unknown or non-procedure version", async () => {
    const d = await freshDraft();
    const body = syntheticDefinitionBody();
    for (const s of [auditor, bo]) {
      expect((await call(api.app, "PUT", A(d.id, "x_code"), { session: s, headers: ifm(1), body })).status).toBe(403);
      expect((await call(api.app, "POST", `${A(d.id, "x_code")}/remove`, { session: s, headers: ifm(1) })).status).toBe(
        403,
      );
      expect((await call(api.app, "POST", `${D}/validate`, { session: s, body })).status).toBe(403);
    }
    expect((await call(api.app, "PUT", A(d.id, "x_code"), { session: admin, body })).status).toBe(428);
    expect(
      codeOf(await call<Body>(api.app, "PUT", A(d.id, "x_code"), { session: admin, headers: ifm(7), body }))[0],
    ).toBe(409);
    expect((await call(api.app, "POST", `${A(d.id, "x_code")}/remove`, { session: admin })).status).toBe(428);
    expect(
      (await call(api.app, "PUT", A(crypto.randomUUID(), "x_code"), { session: admin, headers: ifm(1), body })).status,
    ).toBe(404);
    // A version of another kind is not a procedures version.
    const meth = await call<Body>(api.app, "GET", `${V}?kind=methodology&limit=1`, { session: admin });
    expect(
      (await call(api.app, "PUT", A(meth.body.items[0].id, "x_code"), { session: admin, headers: ifm(1), body }))
        .status,
    ).toBe(404);
    expect(await versionOf(d.id)).toBe(1);
    expect(await rowsOf(d.id)).toHaveLength(0);
    // Reads: AUD and every business role read published definitions; nobody without procedure.read gets 403.
    expect((await call(api.app, "GET", D, { session: auditor })).status).toBe(200);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", D, { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", `${D}/baseline_validation`, { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", `${D}/no_such_procedure`, { session: bo })).status).toBe(404);
  });

  it("commit-time authorization: methodology.configure revoked while the request waits -> 403; nothing written", async () => {
    const d = await freshDraft();
    const u = await methodologyAdmin(api.db, w);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PUT", A(d.id, "vendor_onboarding"), {
          session: s,
          headers: ifm(1),
          body: syntheticDefinitionBody(),
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await rowsOf(d.id)).toHaveLength(0);
    expect(await versionOf(d.id)).toBe(1);
    expect(adminId).not.toBe(u.id);
  });

  it("the default read is the newest published `procedures` version: the ten seeded procedures in the M0153 order", async () => {
    const res = await call<Body>(api.app, "GET", `${D}?limit=100`, { session: bo });
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: Body) => x.code).slice(0, 10)).toEqual([
      "new_transformation_intake",
      "baseline_validation",
      "kpi_submission",
      "tom_approval",
      "initiative_prioritization",
      "gate_review",
      "scope_target_change",
      "benefit_validation",
      "executive_escalation",
      "bau_handover",
    ]);
    const one = res.body.items[1];
    expect(one).toMatchObject({ productDefaults: true, origin: "source", versionStatus: "published" });
    expect(one.steps.map((s: Body) => s.stepKey)).toEqual(["record_baseline", "validate_baseline"]);
  });
});
