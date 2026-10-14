// The "revision proposed" starter (REQ-S12-018, M0238; ADR-0039 §8, §9; p5-work-split §A.3; T-DG5-BE-B2) against a
// real PostgreSQL:
//  - REQ-S12-018 literal: proposing a formula change (DG3 createBenefitFormulaVersion) records ONE proposal that lists
//    the affected benefits and creates a `config_review` review task for the FIN holder of the transformation; the DG3
//    response still parses with its strict DG3 mirror; a first version (not a revision) proposes nothing;
//  - exactly once: replaying the starter x3 (directly, and through the wrapped port) creates nothing more, while the
//    DG4 port still runs first, unchanged, on every call;
//  - routing: the editor is never tasked even when it holds FIN (SoD); a FIN holder of another transformation is not
//    tasked; FIN holders only (no TL/BO task);
//  - listRevisionProposals: AUD and the transformation's TL see it; a methodology admin without read access to the
//    transformation and another organization's reader do not; nobody 403; filters; 400;
//  - case 1 (configuration revision, the function BE-B3's submitConfigReview calls): validation from the runs of the
//    current hash, routing to TO holders except the requester and author, tasks once, replay creates nothing.
// All data is synthetic. A review task asks a person to review; nothing here approves anything (the DG3 Finance
// validation stays a human decision) or touches the engineering gates DG0-DG7.
import { benefitFormulaVersion } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BenefitFormulaVersionChange, MaterialChangePort } from "../../../src/modules/platform/index.ts";
import {
  createConfigReviewTasks,
  proposeConfigRevision,
  proposeFormulaRevision,
  withRevisionProposals,
} from "../../../src/modules/methodology/revision-impact.ts";
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
import { ifm } from "../../support/p2-fixtures.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";
import { financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let adminId: string;
let admin: Session;
let auditor: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const F = "/api/v1/benefit-formulas";
const PROPOSALS = "/api/v1/admin/revision-proposals";
const VARIABLES = [
  { name: "eligible_customers", kind: "number", period: "none", value: "1000" },
  { name: "uplift", kind: "number", period: "none", value: "2.5" },
];

/** A fresh T09 formula with its version 1 (no proposal: a first version is not a revision). */
async function formulaV1(): Promise<{ id: string; version: number }> {
  const res = await call<Body>(api.app, "POST", F, {
    session: b.s.tl,
    body: {
      transformationId: b.transformationId,
      benefitName: "Synthetic revenue uplift",
      initialVersion: { expression: "eligible_customers * uplift", variables: VARIABLES },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, version: res.body.version };
}
const newVersion = (f: { id: string; version: number }, value: string, s = b.s.tl) =>
  call<Body>(api.app, "POST", `${F}/${f.id}/versions`, {
    session: s,
    headers: ifm(f.version),
    body: {
      expression: "eligible_customers * uplift",
      variables: [VARIABLES[0], { ...VARIABLES[1], value }],
      changeNote: "Synthetic: revised uplift assumption",
    },
  });
const formulaRow = (id: string) =>
  api.db.selectFrom("benefit_formula").select(["id", "version"]).where("id", "=", id).executeTakeFirstOrThrow();
const proposalsOf = (subjectId: string) =>
  api.db.selectFrom("revision_proposal").selectAll().where("subject_id", "=", subjectId).execute();
const reviewItemsOf = (subjectId: string) =>
  api.db
    .selectFrom("work_item")
    .selectAll()
    .where("subject_id", "=", subjectId)
    .where("kind", "=", "config_review")
    .orderBy("assignee_user_id")
    .execute();
async function counts() {
  const n = async (t: "revision_proposal" | "work_item" | "inbox_notification") =>
    Number(
      (
        await api.db
          .selectFrom(t)
          .select((eb) => eb.fn.countAll().as("n"))
          .executeTakeFirstOrThrow()
      ).n,
    );
  return {
    proposals: await n("revision_proposal"),
    items: await n("work_item"),
    notifications: await n("inbox_notification"),
  };
}

describe("formula revision (REQ-S12-018 case 2; ADR-0039 §8)", () => {
  it("proposing a formula change lists the affected benefits and creates one review task for FIN", async () => {
    const f = await formulaV1();
    const benefit = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
      session: b.s.tl,
      body: financialBody(b as never, { benefitFormulaId: f.id }),
    });
    expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
    // A first version is not a revision: nothing was proposed for the formula's version 1.
    const v1 = await api.db
      .selectFrom("benefit_formula_version")
      .select("id")
      .where("formula_id", "=", f.id)
      .executeTakeFirstOrThrow();
    expect(await proposalsOf(v1.id)).toEqual([]);

    const res = await newVersion(await formulaRow(f.id), "3.0");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // The DG3 response is unchanged: it still parses with the strict DG3 mirror (no added member).
    expect(benefitFormulaVersion.safeParse(res.body).success).toBe(true);
    const versionId = res.body.id as string;

    const proposals = await proposalsOf(versionId);
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p).toMatchObject({
      organization_id: b.organizationId,
      transformation_id: b.transformationId,
      subject_type: "benefit_formula_version",
      subject_version: 2,
      validation_result: "pass",
      reviewer_role_code: "FIN",
      review_task_count: 1,
      created_by: b.users.tl.id,
      dedupe_key: `benefit_formula_version:${versionId}:${p.content_sha256}`,
    });
    expect(p.impact).toMatchObject({
      formula: { benefitFormulaId: f.id, fromVersionNo: 1, toVersionNo: 2 },
      affectedTransformations: [{ transformationId: b.transformationId }],
      affectedBenefits: [{ benefitId: benefit.body.id, code: benefit.body.code }],
    });
    expect((p.impact as Body).affectedRecords).toContainEqual({ recordType: "benefit", count: 1 });
    expect(await auditOf(api.db, p.id)).toHaveLength(1);
    expect((await auditOf(api.db, p.id))[0]).toMatchObject({ action: "revision_proposal.create" });

    const items = await reviewItemsOf(versionId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      organization_id: b.organizationId,
      transformation_id: b.transformationId,
      assignee_user_id: b.users.fin.id,
      subject_type: "benefit_formula_version",
      link_path: `/transformations/${b.transformationId}/benefit-formulas/${f.id}`,
      message_key: "methodology.task.formula_revision_review",
      dedupe_key: `config_review:${p.id}:${b.users.fin.id}`,
      due_date: null,
    });
    expect(items[0]!.message_params).toMatchObject({ versionNo: 2, benefitCount: 1 });
    // No automatic change request: the formula is not pinned by an approved G4 snapshot (the DG4 rule, unchanged).
    const crs = await api.db.selectFrom("change_request").select("id").where("subject_id", "=", f.id).execute();
    expect(crs).toEqual([]);
  });

  it("replay x3 creates nothing more; the wrapped port still runs the DG4 behaviour first on every call", async () => {
    const f = await formulaV1();
    const res = await newVersion(await formulaRow(f.id), "4.0");
    expect(res.status).toBe(201);
    const change: BenefitFormulaVersionChange = {
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      benefitFormulaId: f.id,
      benefitFormulaVersionId: res.body.id,
      versionNo: 2,
      editorUserId: b.users.tl.id,
      requestId: `replay-${uuidv7()}`,
      changeNote: null,
    };
    const before = await counts();
    const calls: string[] = [];
    const base = {
      benefitFormulaVersionCreated: async () => {
        calls.push("dg4");
      },
    } as unknown as MaterialChangePort;
    const wrapped = withRevisionProposals(base);
    for (let i = 0; i < 3; i += 1) {
      await api.db.transaction().execute((tx) => proposeFormulaRevision(tx, change));
      await api.db.transaction().execute((tx) => wrapped.benefitFormulaVersionCreated(tx, change));
    }
    expect(calls).toEqual(["dg4", "dg4", "dg4"]);
    expect(await counts()).toEqual(before);
    expect(await proposalsOf(res.body.id)).toHaveLength(1);
    expect(await reviewItemsOf(res.body.id)).toHaveLength(1);
  });

  it("routes to FIN holders of the transformation only, never to the editor (SoD) or another transformation's FIN", async () => {
    const other = await seedBenefitWorld(api, w); // its FIN holds FIN on another transformation of the same organization
    const finEditor = await createUser(api.db, b.organizationId);
    const scope = { type: "transformation" as const, id: b.transformationId };
    await grant(api.db, w.grantor.id, finEditor.id, "TL", scope, b.organizationId);
    await grant(api.db, w.grantor.id, finEditor.id, "FIN", scope, b.organizationId);
    const editor = await signIn(api.app, finEditor.subject);
    const f = await formulaV1();
    const res = await newVersion(await formulaRow(f.id), "5.0", editor);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [p] = await proposalsOf(res.body.id);
    const assignees = (await reviewItemsOf(res.body.id)).map((i) => i.assignee_user_id);
    expect(assignees).toEqual([b.users.fin.id]);
    expect(assignees).not.toContain(finEditor.id);
    expect(assignees).not.toContain(other.users.fin.id);
    expect(p).toMatchObject({ review_task_count: 1, created_by: finEditor.id });
  });
});

describe("listRevisionProposals (ADR-0039 §8, §9)", () => {
  it("AUD and the transformation's TL see a formula proposal; readers without access to it do not; 403; 400", async () => {
    const f = await formulaV1();
    const res = await newVersion(await formulaRow(f.id), "6.0");
    expect(res.status).toBe(201);
    const q = `${PROPOSALS}?subjectType=benefit_formula_version&subjectId=${res.body.id}`;
    // The FIN holders at this point of the suite (an earlier test adds one): the count equals the tasks written.
    const tasks = (await reviewItemsOf(res.body.id)).length;
    expect(tasks).toBeGreaterThanOrEqual(1);
    for (const s of [auditor, b.s.tl]) {
      const list = await call<Body>(api.app, "GET", q, { session: s });
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        transformationId: b.transformationId,
        subjectType: "benefit_formula_version",
        subjectId: res.body.id,
        reviewerRoleCode: "FIN",
        reviewTaskCount: tasks,
      });
    }
    // methodology.read alone does not open a transformation's benefits; another organization sees nothing of it.
    expect((await call<Body>(api.app, "GET", q, { session: admin })).body.items).toEqual([]);
    const outsider = await signIn(api.app, w.officeB.subject);
    const foreign = await call<Body>(api.app, "GET", q, { session: outsider });
    // Another organization's reader: either it lacks methodology.read (403) or it sees none of orgA's proposals.
    expect(foreign.status === 403 || (foreign.status === 200 && foreign.body.items.length === 0)).toBe(true);
    expect(
      (await call<Body>(api.app, "GET", PROPOSALS, { session: await signIn(api.app, w.nobody.subject) })).status,
    ).toBe(403);
    expect((await call<Body>(api.app, "GET", `${PROPOSALS}?subjectId=x`, { session: auditor })).status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${PROPOSALS}?other=1`, { session: auditor })).status).toBe(400);
  });
});

describe("configuration revision (REQ-S12-018 case 1; the function submitConfigReview calls)", () => {
  it("records validation, impact and routing once; tasks TO holders except the requester and author; replay adds nothing", async () => {
    const base = await seedStudioBase(api, "methodology");
    const created = await call<Body>(api.app, "POST", "/api/v1/admin/methodology-versions", {
      session: admin,
      body: { basedOnVersionId: base.id },
    });
    expect(created.status).toBe(201);
    const versionId = created.body.id as string;
    const toHolder = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, toHolder.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const audit = { actorUserId: adminId, requestId: `case1-${uuidv7()}` };
    const propose = () =>
      api.db.transaction().execute(async (tx) => {
        const version = await tx
          .selectFrom("methodology_version")
          .selectAll()
          .where("id", "=", versionId)
          .executeTakeFirstOrThrow();
        const r = await proposeConfigRevision(tx, audit, { version, organizationId: w.orgA.id, requestedBy: adminId });
        await createConfigReviewTasks(tx, audit, r.proposal, r.reviewerUserIds, {
          subjectType: "methodology_version",
          subjectId: versionId,
          linkPath: `/admin/studio/versions/${versionId}`,
          messageKey: "methodology.task.config_revision_review",
          messageParams: { versionNo: version.version_no },
        });
        return r;
      });
    const first = await propose();
    expect(first.created).toBe(true);
    expect(first.reviewerUserIds).toContain(toHolder.id);
    expect(first.reviewerUserIds).not.toContain(adminId);
    expect(first.proposal).toMatchObject({
      organization_id: w.orgA.id,
      transformation_id: null,
      subject_type: "methodology_version",
      subject_id: versionId,
      // No preview or compatibility run for this hash yet: the validation fails (never assumed green).
      validation_result: "fail",
      validation_report: { preview: null, compatibility: null },
      reviewer_role_code: "TO",
      review_task_count: first.reviewerUserIds.length,
    });
    expect(first.proposal.impact).toMatchObject({ affectedBenefits: [], affectedBenefitsBasis: "not_applicable" });
    const items = await reviewItemsOf(versionId);
    expect(items.map((i) => i.assignee_user_id).sort()).toEqual([...first.reviewerUserIds].sort());
    expect(items.every((i) => i.dedupe_key === `config_review:${first.proposal.id}:${i.assignee_user_id}`)).toBe(true);

    const before = await counts();
    for (let i = 0; i < 3; i += 1) {
      const again = await propose();
      expect(again).toMatchObject({ created: false, reviewerUserIds: [] });
      expect(again.proposal.id).toBe(first.proposal.id);
    }
    expect(await counts()).toEqual(before);
    const list = await call<Body>(
      api.app,
      "GET",
      `${PROPOSALS}?subjectType=methodology_version&subjectId=${versionId}`,
      {
        session: admin,
      },
    );
    expect(list.body.items.map((p: Body) => p.id)).toEqual([first.proposal.id]);
  });
});
