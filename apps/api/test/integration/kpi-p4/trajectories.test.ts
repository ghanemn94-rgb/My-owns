// Target trajectories against a real PostgreSQL (T-DG4-KBE-B; ADR-0027 §5, §11, §13; REQ-S07-007 trajectory half,
// REQ-S16-014 TargetTrajectory):
//  - a draft with fixed points (append-only) per KPI, scope and version; the scope must be part of the transformation
//    (422 kpi.scope_invalid); one draft per KPI and scope (409 target_trajectory.draft_exists);
//  - import from a DG2 T02 outcome-KPI row (sourceOutcomeKpiId) into a NEW draft; the T02 row is unchanged;
//  - approval is an in-product business approval by kpi_target.approve (SP, BO), never by the creator (403
//    target_trajectory.approver_is_author); approving supersedes the previously approved trajectory of the KPI and scope
//    (one audit event each) and writes one kpi.trajectory_approved event (key <event>:<id>:<versionNo>);
//  - withdraw a draft; approved trajectories are immutable (422 target_trajectory.not_draft); If-Match 428/409;
//  - AUD, an ADM-only user and roles without the permission get 403; the database's last line maps to the ADR codes.
// All data is synthetic (the SP and BO approvals are synthetic in-product decisions by seeded users, not real ones);
// nothing here touches the engineering gates DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { createKpi, freshUser, ifMatch } from "./kbe-b-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let adm: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  adm = await signIn(api.app, w.admin.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(code);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};
const TJ = (kpiId: string) => `${k.base}/kpi-definitions/${kpiId}/trajectories`;
const ITEM = (id: string) => `${k.base}/target-trajectories/${id}`;
const scope = () => ({ scopeKind: "transformation", scopeId: k.transformationId });
const points = [
  { pointDate: "2026-12-31", expectedValue: "300" },
  { pointDate: "2026-10-31", expectedValue: "100.25" },
];
const create = (kpiId: string, body: object, session = k.s.kds) => call(api.app, "POST", TJ(kpiId), { session, body });
const approve = (id: string, version: number, session = k.s.sp) =>
  call(api.app, "POST", `${ITEM(id)}/approve`, {
    session,
    headers: ifMatch(version),
    body: { comment: "Synthetic approval." },
  });

describe("drafts", () => {
  it("creates a draft with its points (sorted, decimal strings), version 1 per KPI and scope", async () => {
    const kpi = await createKpi(api, k);
    const res = await create(kpi.id, { ...scope(), basis: "cumulative", interpolation: "step", points });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.location).toBe(
      `/api/v1/transformations/${k.transformationId}/target-trajectories/${res.body.id}`,
    );
    expect(res.body).toMatchObject({
      status: "draft",
      versionNo: 1,
      basis: "cumulative",
      interpolation: "step",
      source: "api",
      sourceOutcomeKpiId: null,
      createdBy: k.users.kds.id,
      points: [
        { pointDate: "2026-10-31", expectedValue: "100.25" },
        { pointDate: "2026-12-31", expectedValue: "300" },
      ],
    });
    const audits = await auditOf(api.db, res.body.id);
    expect(audits.map((a) => a.action)).toEqual(["target_trajectory.create"]);
    // A business-unit scope of the organization is another scope: its own version 1.
    const bu = await create(kpi.id, { scopeKind: "business_unit", scopeId: w.a2, points });
    expect([bu.status, bu.body.versionNo]).toEqual([201, 1]);
    const listed = await call(api.app, "GET", `${TJ(kpi.id)}?scopeKind=business_unit&scopeId=${w.a2}`, {
      session: k.s.auditor,
    });
    expect([listed.status, listed.body.items.map((t: Body) => t.id)]).toEqual([200, [bu.body.id]]);
  });

  it("refuses a scope outside the transformation, a second draft, and malformed bodies; nothing written", async () => {
    const kpi = await createKpi(api, k);
    problem(
      await create(kpi.id, { scopeKind: "business_unit", scopeId: w.b1, points }),
      422,
      "kpi.scope_invalid",
      `The scope business_unit ${w.b1} is not part of this transformation.`,
    );
    problem(await create(kpi.id, { scopeKind: "transformation", scopeId: uuidv7(), points }), 422, "kpi.scope_invalid");
    problem(await create(kpi.id, { scopeKind: "initiative", scopeId: uuidv7(), points }), 422, "kpi.scope_invalid");
    expect((await create(kpi.id, scope())).status).toBe(400);
    expect((await create(kpi.id, { ...scope(), points, sourceOutcomeKpiId: uuidv7() })).status).toBe(400);
    expect((await create(kpi.id, { ...scope(), points: [points[0], points[0]] })).status).toBe(400);
    expect(
      (await create(kpi.id, { ...scope(), points: [{ pointDate: "2026-02-30", expectedValue: "1" }] })).status,
    ).toBe(400);
    expect((await create(kpi.id, { ...scope(), points: [{ pointDate: "2026-02-28", expectedValue: 1 }] })).status).toBe(
      400,
    );
    const none = await api.db
      .selectFrom("target_trajectory")
      .select("id")
      .where("kpi_definition_id", "=", kpi.id)
      .execute();
    expect(none).toEqual([]);
    expect((await create(kpi.id, { ...scope(), points })).status).toBe(201);
    problem(
      await create(kpi.id, { ...scope(), points }),
      409,
      "target_trajectory.draft_exists",
      "This KPI already has a draft trajectory for this scope. Approve or withdraw it first.",
    );
  });

  it("imports the points of a DG2 T02 outcome-KPI row into a new draft; the T02 row is unchanged", async () => {
    const kpi = await createKpi(api, k);
    const okpi = await call(api.app, "POST", `${k.base}/outcome-kpis`, {
      session: k.s.kds,
      body: {
        outcomeId: k.outcomeId,
        kpiDefinitionId: kpi.id,
        targetDate: "2027-12-31",
        targetValue: "900",
        trajectoryPoints: [
          { date: "2027-06-30", value: "450" },
          { date: "2027-12-31", value: "900" },
        ],
      },
    });
    expect(okpi.status, JSON.stringify(okpi.body)).toBe(201);
    const imported = await create(kpi.id, { ...scope(), sourceOutcomeKpiId: okpi.body.id });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(imported.body).toMatchObject({
      source: "outcome_kpi_import",
      sourceOutcomeKpiId: okpi.body.id,
      status: "draft",
      points: [
        { pointDate: "2027-06-30", expectedValue: "450" },
        { pointDate: "2027-12-31", expectedValue: "900" },
      ],
    });
    const after = await call(api.app, "GET", `${k.base}/outcome-kpis/${okpi.body.id}`, { session: k.s.kds });
    expect([after.body.version, after.body.trajectoryPoints]).toEqual([okpi.body.version, okpi.body.trajectoryPoints]);
    // An outcome-KPI row of another KPI is not a source for this one.
    const other = await createKpi(api, k);
    problem(await create(other.id, { ...scope(), sourceOutcomeKpiId: okpi.body.id }), 422, "validation.reference");
  });
});

describe("approval (in-product business approval)", () => {
  it("never by the creator; SP approves; the next approved version supersedes it; one kpi.trajectory_approved event each", async () => {
    const kpi = await createKpi(api, k);
    const first = await create(kpi.id, { ...scope(), points }, k.s.tl);
    problem(await approve(first.body.id, 1, k.s.kds), 403, "forbidden");
    // SP holds kpi_target.approve but not target_trajectory.edit (403). A trajectory that an approver created is
    // refused by the separation-of-duties rule (exact text).
    expect((await create(kpi.id, { scopeKind: "business_unit", scopeId: w.a2, points }, k.s.sp)).status).toBe(403);
    const ownDraft = await api.db.transaction().execute(async (tx) => {
      // A draft authored by SP, written directly (with its audit event) to probe the SoD refusal of the approve route.
      const id = uuidv7();
      await tx
        .insertInto("target_trajectory")
        .values({
          id,
          organization_id: w.orgA.id,
          transformation_id: k.transformationId,
          kpi_definition_id: kpi.id,
          scope_kind: "business_unit",
          scope_id: w.a2,
          version_no: 1,
          created_by: k.users.sp.id,
          updated_by: k.users.sp.id,
        })
        .execute();
      await tx
        .insertInto("target_trajectory_point")
        .values({
          id: uuidv7(),
          organization_id: w.orgA.id,
          transformation_id: k.transformationId,
          target_trajectory_id: id,
          point_date: "2026-12-31",
          expected_value: "1",
          created_by: k.users.sp.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: k.users.sp.id, requestId: `fixture-${id}`, source: "api" },
        {
          action: "target_trajectory.create",
          recordType: "target_trajectory",
          recordId: id,
          organizationId: w.orgA.id,
          transformationId: k.transformationId,
          newVersion: 1,
        },
      );
      return id;
    });
    problem(
      await approve(ownDraft, 1, k.s.sp),
      403,
      "target_trajectory.approver_is_author",
      "The person who created this trajectory cannot approve it.",
    );

    expect((await call(api.app, "POST", `${ITEM(first.body.id)}/approve`, { session: k.s.sp, body: {} })).status).toBe(
      428,
    );
    expect((await approve(first.body.id, 4)).status).toBe(409);
    const a1 = await approve(first.body.id, 1);
    expect([a1.status, a1.body.status, a1.body.approvedBy, a1.body.version]).toEqual([
      200,
      "approved",
      k.users.sp.id,
      2,
    ]);
    problem(
      await approve(first.body.id, 2, k.s.bo),
      422,
      "target_trajectory.not_draft",
      "Only a draft trajectory can be approved or withdrawn.",
    );
    const second = await create(
      kpi.id,
      { ...scope(), points: [{ pointDate: "2026-12-31", expectedValue: "320" }] },
      k.s.kds,
    );
    expect(second.body.versionNo).toBe(2);
    const a2 = await approve(second.body.id, 1, k.s.bo);
    expect([a2.status, a2.body.status]).toEqual([200, "approved"]);
    const old = await call(api.app, "GET", ITEM(first.body.id), { session: k.s.auditor });
    expect([old.body.status, old.body.supersededAt === null]).toEqual(["superseded", false]);
    expect((await auditOf(api.db, first.body.id)).map((a) => a.action)).toEqual([
      "target_trajectory.create",
      "target_trajectory.approve",
      "target_trajectory.supersede",
    ]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["aggregate_id", "idempotency_key", "payload"])
      .where("event_type", "=", "kpi.trajectory_approved")
      .where("aggregate_id", "in", [first.body.id, second.body.id])
      .execute();
    expect(events.map((e) => e.idempotency_key).sort()).toEqual(
      [`kpi.trajectory_approved:${first.body.id}:1`, `kpi.trajectory_approved:${second.body.id}:2`].sort(),
    );
    const entry = await call(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/dictionary-entry`, {
      session: k.s.auditor,
    });
    expect(entry.body.missingForUse).not.toContain("approved_trajectory");
  });

  it("withdraws a draft; an approved trajectory cannot be withdrawn; points are append-only", async () => {
    const kpi = await createKpi(api, k);
    const d = await create(kpi.id, { ...scope(), points });
    expect(
      (await call(api.app, "POST", `${ITEM(d.body.id)}/withdraw`, { session: k.s.kds, body: { reason: "Replan." } }))
        .status,
    ).toBe(428);
    const wd = await call(api.app, "POST", `${ITEM(d.body.id)}/withdraw`, {
      session: k.s.kds,
      headers: ifMatch(1),
      body: { reason: "Replanned." },
    });
    expect([wd.status, wd.body.status, wd.body.withdrawReason, wd.body.points.length]).toEqual([
      200,
      "withdrawn",
      "Replanned.",
      2,
    ]);
    const d2 = await create(kpi.id, { ...scope(), points });
    expect(d2.body.versionNo).toBe(2);
    await approve(d2.body.id, 1);
    problem(
      await call(api.app, "POST", `${ITEM(d2.body.id)}/withdraw`, {
        session: k.s.kds,
        headers: ifMatch(2),
        body: { reason: "Too late." },
      }),
      422,
      "target_trajectory.not_draft",
    );
    await expect(
      api.db
        .insertInto("target_trajectory_point")
        .values({
          id: uuidv7(),
          organization_id: w.orgA.id,
          transformation_id: k.transformationId,
          target_trajectory_id: d2.body.id,
          point_date: "2027-01-31",
          expected_value: "1",
          created_by: k.users.kds.id,
        })
        .execute(),
    ).rejects.toThrow(/points are added only while the trajectory is a draft/);
  });

  it("the database's last line maps to the ADR codes (approver = creator, scope, one draft)", async () => {
    const kpi = await createKpi(api, k);
    const d = await create(kpi.id, { ...scope(), points });
    const err = await api.db
      .updateTable("target_trajectory")
      .set({
        status: "approved",
        approved_by: k.users.kds.id,
        approved_at: new Date(),
        approved_record_version: 1,
        version: 2,
      })
      .where("id", "=", d.body.id)
      .execute()
      .then(
        () => null,
        (e: unknown) => e,
      );
    const mapped = mapDatabaseGuardError(err as { code?: string; constraint?: string; message?: string });
    expect([mapped?.status, mapped?.code]).toEqual([403, "target_trajectory.approver_is_author"]);
  });
});

describe("authorization", () => {
  it("AUD and an ADM-only user get 403 on create, approve and withdraw; AUD reads", async () => {
    const kpi = await createKpi(api, k);
    const d = await create(kpi.id, { ...scope(), points });
    for (const session of [k.s.auditor, adm]) {
      expect((await create(kpi.id, { ...scope(), points }, session)).status).toBe(403);
      expect((await approve(d.body.id, 1, session)).status).toBe(403);
      expect(
        (
          await call(api.app, "POST", `${ITEM(d.body.id)}/withdraw`, {
            session,
            headers: ifMatch(1),
            body: { reason: "No right." },
          })
        ).status,
      ).toBe(403);
    }
    // FIN and TO hold neither target_trajectory.edit nor kpi_target.approve.
    expect((await create(kpi.id, { scopeKind: "business_unit", scopeId: w.a1, points }, k.s.fin)).status).toBe(403);
    expect((await approve(d.body.id, 1, k.s.fin)).status).toBe(403);
    expect((await call(api.app, "GET", ITEM(d.body.id), { session: k.s.auditor })).status).toBe(200);
    expect((await call(api.app, "GET", ITEM(d.body.id), { session: k.s.outsider })).status).toBe(404);
    expect((await auditOf(api.db, d.body.id)).map((a) => a.action)).toEqual(["target_trajectory.create"]);
  });

  it("authorization is re-checked at commit time: an approver whose grant is revoked meanwhile gets 403; still a draft", async () => {
    const kpi = await createKpi(api, k);
    const d = await create(kpi.id, { ...scope(), points });
    const sp = await freshUser(api, k, w.orgA.id, w.grantor.id, "SP");
    const res = await afterIdentity(
      api,
      sp.id,
      () => approve(d.body.id, 1, sp.session),
      () => revokeAll(api, w.grantor.id, sp.id),
    );
    expect(res.status).toBe(403);
    expect((await call(api.app, "GET", ITEM(d.body.id), { session: k.s.kds })).body.status).toBe("draft");
  });
});
