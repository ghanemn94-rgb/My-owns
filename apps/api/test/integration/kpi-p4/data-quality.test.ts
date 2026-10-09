// Data-quality findings against a real PostgreSQL (T-DG4-KBE-B; ADR-0027 §9, §11, §13; REQ-S16-014
// DataQualityFinding). Findings have no create operation: calculation runs write them (KBE-C's worker), so the fixture
// writes a synthetic run and open finding directly. Covered here:
//  - list (filters kpiDefinitionId and status; newest first; cursor) and get with ETag;
//  - resolve or dismiss: open -> resolved | dismissed is final (422 data_quality.not_open), a note is required (400
//    validation.blank for a blank note; the database's last line 422 data_quality.note_required), If-Match 428/409,
//    exactly one audit event with the note as its reason;
//  - AUD, an ADM-only user and roles without data_quality.manage get 403; a read outside the scope is 404.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
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
import { afterIdentity, endSessions } from "../calendar/session-lock.ts";
import { createKpi, freshUser, ifMatch, insertFinding } from "./kbe-b-fixtures.ts";

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
const DQ = () => `${k.base}/data-quality-findings`;
const resolve = (id: string, version: number | null, body: object, session = k.s.kds) =>
  call(api.app, "POST", `${DQ()}/${id}/resolve`, {
    session,
    ...(version === null ? {} : { headers: ifMatch(version) }),
    body,
  });

describe("findings: reads", () => {
  it("lists with filters (newest first, cursor) and reads one with its ETag", async () => {
    const a = await createKpi(api, k);
    const b = await createKpi(api, k);
    const f1 = await insertFinding(api.db, k, w.orgA.id, a.id, "stale");
    const f2 = await insertFinding(api.db, k, w.orgA.id, a.id, "out_of_range");
    const f3 = await insertFinding(api.db, k, w.orgA.id, b.id, "missing_actual");
    const forA = await call(api.app, "GET", `${DQ()}?kpiDefinitionId=${a.id}&limit=1`, { session: k.s.auditor });
    expect([forA.status, forA.body.items.map((f: Body) => f.id)]).toEqual([200, [f2]]);
    const next = await call(api.app, "GET", `${DQ()}?kpiDefinitionId=${a.id}&limit=1&cursor=${forA.body.nextCursor}`, {
      session: k.s.auditor,
    });
    expect([next.body.items.map((f: Body) => f.id), next.body.nextCursor]).toEqual([[f1], null]);
    // A cursor of other filters is refused (400).
    expect(
      (
        await call(api.app, "GET", `${DQ()}?kpiDefinitionId=${b.id}&cursor=${forA.body.nextCursor}`, {
          session: k.s.auditor,
        })
      ).status,
    ).toBe(400);
    const one = await call(api.app, "GET", `${DQ()}/${f3}`, { session: k.s.auditor });
    expect([one.status, one.headers.etag]).toEqual([200, '"1"']);
    expect(one.body).toMatchObject({
      id: f3,
      kpiDefinitionId: b.id,
      scopeKind: "transformation",
      scopeId: k.transformationId,
      ruleCode: "missing_actual",
      severity: "warning",
      status: "open",
      detailParams: { periodLabel: "synthetic" },
      resolutionNote: null,
      resolvedBy: null,
      kpiActualId: null,
      valueNo: null,
    });
    expect((await call(api.app, "GET", `${DQ()}/${f3}`, { session: k.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", DQ(), { session: k.s.outsider })).status).toBe(404);
  });
});

describe("findings: resolve or dismiss", () => {
  it("resolve: If-Match, one audit event with the note, final afterwards", async () => {
    const kpi = await createKpi(api, k);
    const id = await insertFinding(api.db, k, w.orgA.id, kpi.id);
    expect((await resolve(id, null, { outcome: "resolved", note: "Backfilled." })).status).toBe(428);
    expect((await resolve(id, 3, { outcome: "resolved", note: "Backfilled." })).status).toBe(409);
    expect((await resolve(id, 1, { outcome: "resolved", note: "   " })).status).toBe(400);
    expect((await resolve(id, 1, { outcome: "fixed", note: "Backfilled." })).status).toBe(400);
    const res = await resolve(id, 1, { outcome: "resolved", note: "The source system backfilled the value." }, k.s.tl);
    expect([
      res.status,
      res.body.status,
      res.body.resolvedBy,
      res.body.resolutionNote,
      res.body.version,
      res.headers.etag,
    ]).toEqual([200, "resolved", k.users.tl.id, "The source system backfilled the value.", 2, '"2"']);
    const audits = await auditOf(api.db, id);
    expect(audits.map((a) => [a.action, a.reason, a.prior_version, a.new_version])).toEqual([
      ["data_quality_finding.resolve", "The source system backfilled the value.", 1, 2],
    ]);
    const again = await resolve(id, 2, { outcome: "dismissed", note: "Second try." });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "data_quality.not_open",
      "Only an open finding can be resolved or dismissed.",
    ]);
    expect((await auditOf(api.db, id)).length).toBe(1);
  });

  it("dismiss is the other final outcome; the database's last line maps note and status refusals", async () => {
    const kpi = await createKpi(api, k);
    const id = await insertFinding(api.db, k, w.orgA.id, kpi.id, "not_comparable");
    const res = await resolve(id, 1, { outcome: "dismissed", note: "Known 4-4-5 calendar change." });
    expect([res.status, res.body.status]).toEqual([200, "dismissed"]);
    expect((await auditOf(api.db, id)).map((a) => a.action)).toEqual(["data_quality_finding.dismiss"]);
    const other = await insertFinding(api.db, k, w.orgA.id, kpi.id, "stale");
    const noNote = await api.db
      .updateTable("data_quality_finding")
      .set({ status: "resolved", resolved_by: k.users.kds.id, resolved_at: new Date(), version: 2 })
      .where("id", "=", other)
      .execute()
      .then(
        () => null,
        (e: unknown) => e,
      );
    const m1 = mapDatabaseGuardError(noNote as { code?: string; constraint?: string });
    expect([m1?.status, m1?.code, m1?.detail]).toEqual([
      422,
      "data_quality.note_required",
      "Resolving or dismissing a finding needs a note.",
    ]);
    const reopen = await api.db
      .updateTable("data_quality_finding")
      .set({ status: "open", resolution_note: null, resolved_by: null, resolved_at: null, version: 3 })
      .where("id", "=", id)
      .execute()
      .then(
        () => null,
        (e: unknown) => e,
      );
    const m2 = mapDatabaseGuardError(reopen as { code?: string; constraint?: string });
    expect([m2?.status, m2?.code]).toEqual([422, "data_quality.not_open"]);
  });

  it("AUD, an ADM-only user and roles without data_quality.manage get 403; nothing written", async () => {
    const kpi = await createKpi(api, k);
    const id = await insertFinding(api.db, k, w.orgA.id, kpi.id);
    for (const session of [k.s.auditor, adm, k.s.sp, k.s.bo, k.s.fin, k.s.to])
      expect((await resolve(id, 1, { outcome: "resolved", note: "No right." }, session)).status).toBe(403);
    expect((await call(api.app, "GET", `${DQ()}/${id}`, { session: k.s.auditor })).body.status).toBe("open");
    expect(await auditOf(api.db, id)).toEqual([]);
  });

  it("authorization is re-checked at commit time: an ended session is 401; the finding stays open", async () => {
    const kpi = await createKpi(api, k);
    const id = await insertFinding(api.db, k, w.orgA.id, kpi.id);
    const kds = await freshUser(api, k, w.orgA.id, w.grantor.id, "KDS");
    const res = await afterIdentity(
      api,
      kds.id,
      () =>
        call(api.app, "POST", `${DQ()}/${id}/resolve`, {
          session: kds.session,
          headers: ifMatch(1),
          body: { outcome: "resolved", note: "Session ends meanwhile." },
          contract: false,
        }),
      (locker) => endSessions(locker, kds.id),
    );
    expect(res.status).toBe(401);
    expect(await auditOf(api.db, id)).toEqual([]);
  });
});
