// Service identities (ADR-0053 §1; REQ-S16-029 "a job's identity cannot read records outside its scope"; D-195 Q13;
// T-DG6-BE-J), against the run's disposable PostgreSQL:
//  1. the seed (0114): one job identity per queue, each with its audit event;
//  2. the out-of-scope proof: two organizations; for every job identity that reads business records, its scoped reads
//     for organization A admit no row of organization B (the predicate selects 0 rows of B) and requireServiceRead of
//     an organization-B record throws `service_identity.out_of_scope`; sensitive records stay out of per-record reads
//     (and enter aggregates only for an `aggregate_only` identity);
//  3. the worker twin (apps/worker/src/service-scope.ts) equals the API ReadScope (access/read-scope.ts) for the same
//     principal, row by row, in SQL and in memory;
//  4. a job reads with its GRANT (a narrowed grant refuses), and a missing identity fails the run with
//     `service_identity.missing` (the failure-queue row carries the code);
//  5. putServiceIdentity: narrow, restore, 422 grant_exceeds_declaration, 422 reason_required, 409, 428, AUD 403, a
//     caller without operations.read 404, authorization re-checked at commit, the audit event and the history row.
// Every value is SYNTHETIC. A service identity never holds a business-approval or Finance-validation right; nothing
// here touches DG0-DG7.
import { sql, type Expression, type SqlBool } from "@mth/db";
import type { Permission } from "@mth/shared";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureJobFailure,
  defineJob,
  JOB_SERVICE_IDENTITIES,
  loadServiceIdentity,
  requireServiceRead,
  servicePrincipal,
  serviceReadScopeFor,
  ServiceScopeViolation,
  type ServicePrincipal,
  type ServiceReadScope,
  type ServiceReadUse,
} from "../../../../worker/src/kit.ts";
import { apiGrantEquivalent } from "../../../../worker/src/service-scope.ts";
import {
  putServiceIdentity,
  readScopeFor,
  resolveTarget,
  type Principal,
  type ReadScope,
} from "../../../src/modules/access/index.ts";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const TR: Permission = "transformation.read";
const L = "/api/v1/admin/service-identities";

interface OrgFixture {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly sensitiveEvidenceId: string;
  readonly plainEvidenceId: string;
}

let api: TestApi;
let w: World;
let A: OrgFixture;
let B: OrgFixture;
let admin: Session;
let auditor: Session;
let nobody: Session;

/** A transformation with a TL, two evidence notes, one of them marked sensitive by the organization's TO. */
async function seedOrg(organizationId: string, businessUnitId: string, marker: Session): Promise<OrgFixture> {
  const transformationId = await createTransformationRow(api.db, organizationId, businessUnitId, w.grantor.id);
  const tl = await createUser(api.db, organizationId);
  await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: transformationId }, organizationId);
  const tlS = await signIn(api.app, tl.subject);
  const base = `/api/v1/transformations/${transformationId}`;
  const note = async (title: string) => {
    const res = await call<Body>(api.app, "POST", `${base}/evidence`, {
      session: tlS,
      body: { kind: "note", title, noteBody: "Synthetic", ownerUserId: tl.id },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  const sensitiveEvidenceId = await note("Synthetic service-scope note S");
  const plainEvidenceId = await note("Synthetic service-scope note N");
  const marked = await call<Body>(api.app, "PUT", `${base}/records/evidence/${sensitiveEvidenceId}/sensitivity`, {
    session: marker,
    headers: ifm(0),
    body: { isSensitive: true, reason: "Synthetic service-scope fixture" },
  });
  expect(marked.status, JSON.stringify(marked.body)).toBe(200);
  return { organizationId, transformationId, sensitiveEvidenceId, plainEvidenceId };
}

/** The ids among `ids` that a predicate selects on the transformation table (a type that cannot be sensitive). */
async function transformationsSelected(
  predicate: (cols: { recordId: Expression<string>; organizationId: Expression<string> }) => Expression<SqlBool>,
  ids: string[],
): Promise<Set<string>> {
  const rows = await api.db
    .selectFrom("transformation as r")
    .select("r.id")
    .where("r.id", "in", ids)
    .where(predicate({ recordId: sql.ref("r.id"), organizationId: sql.ref("r.organization_id") }))
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** The ids among `ids` that a predicate selects on the evidence table (a sensitive type). */
async function evidenceSelected(
  predicate: (cols: {
    recordId: Expression<string>;
    organizationId: Expression<string>;
    transformationId: Expression<string | null>;
  }) => Expression<SqlBool>,
  ids: string[],
): Promise<Set<string>> {
  const rows = await api.db
    .selectFrom("evidence as r")
    .select("r.id")
    .where("r.id", "in", ids)
    .where(
      predicate({
        recordId: sql.ref("r.id"),
        organizationId: sql.ref("r.organization_id"),
        transformationId: sql.ref("r.transformation_id"),
      }),
    )
    .execute();
  return new Set(rows.map((r) => r.id));
}

const serviceTr = (scope: ServiceReadScope, use?: ServiceReadUse) =>
  transformationsSelected(
    (c) => scope.predicate({ recordType: null, ...c }, use),
    [A.transformationId, B.transformationId],
  );
const serviceEv = (scope: ServiceReadScope, use?: ServiceReadUse) =>
  evidenceSelected(
    (c) => scope.predicate({ recordType: "evidence", recordId: c.recordId, organizationId: c.organizationId }, use),
    allEvidence(),
  );
const allEvidence = () => [A.sensitiveEvidenceId, A.plainEvidenceId, B.sensitiveEvidenceId, B.plainEvidenceId];

/** The API principal equivalent to a service principal (one organization grant that applies downward). */
function apiPrincipalOf(p: ServicePrincipal): Principal {
  const g = apiGrantEquivalent(p);
  return {
    kind: "service",
    userId: null,
    organizationId: p.organizationId,
    grants: [{ ...g, permissions: g.permissions as ReadonlySet<Permission> }],
    tracker: { decisions: 0 },
  };
}

async function identityRow(code: string) {
  return api.db.selectFrom("service_identity").selectAll().where("code", "=", code).executeTakeFirstOrThrow();
}

async function setGrant(session: Session, code: string, granted: string[], reason: string) {
  const row = await identityRow(code);
  const res = await call<Body>(api.app, "PUT", `${L}/${row.id}`, {
    session,
    headers: ifm(row.version),
    body: { grantedPermissionCodes: granted, reason },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const office = await signIn(api.app, w.office.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  A = await seedOrg(w.orgA.id, w.a1, office);
  B = await seedOrg(w.orgB.id, w.b1, officeB);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe("the 0114 seed (ADR-0053 §1)", () => {
  it("has one platform job identity per declaration, granted = declared, each with its audit event", async () => {
    const rows = await api.db.selectFrom("service_identity").selectAll().where("subject_kind", "=", "job").execute();
    const byCode = new Map(rows.map((r) => [r.code, r]));
    for (const d of JOB_SERVICE_IDENTITIES) {
      const r = byCode.get(`job:${d.queue}`);
      expect(r, d.queue).toBeDefined();
      expect(r!.scope_level).toBe("platform");
      expect(r!.organization_id).toBeNull();
      expect([...r!.declared_permission_codes]).toEqual([...d.permissions]);
      expect(r!.sensitive_access).toBe(d.sensitiveAccess);
      const events = await auditOf(api.db, r!.id);
      expect(events[0]).toMatchObject({ action: "service_identity.create", actor_type: "system", source: "migration" });
    }
    expect(JOB_SERVICE_IDENTITIES.every((d) => byCode.has(`job:${d.queue}`))).toBe(true);
  });
});

describe("a job's identity cannot read records outside its scope (REQ-S16-029; A12)", () => {
  it("for every business-record job identity, organization A's reads admit no row of organization B", async () => {
    const readers = JOB_SERVICE_IDENTITIES.filter((d) => d.permissions.includes(TR));
    expect(readers.length).toBeGreaterThan(25);
    for (const d of readers) {
      const p = await servicePrincipal(api.db, d.queue, A.organizationId);
      const scope = await serviceReadScopeFor(api.db, p, TR);
      // SQL: 0 rows of B; A's non-sensitive rows in; A's sensitive evidence only in an aggregate_only aggregate.
      expect(await serviceTr(scope), d.queue).toEqual(new Set([A.transformationId]));
      expect(await serviceEv(scope, "record"), d.queue).toEqual(new Set([A.plainEvidenceId]));
      expect(await serviceEv(scope, "aggregate"), d.queue).toEqual(
        new Set(
          d.sensitiveAccess === "aggregate_only" ? [A.plainEvidenceId, A.sensitiveEvidenceId] : [A.plainEvidenceId],
        ),
      );
      // A single-record read of an organization-B record (and of A's sensitive record) is refused.
      for (const record of [
        { recordType: null, recordId: B.transformationId, organizationId: B.organizationId },
        { recordType: "evidence" as const, recordId: B.plainEvidenceId, organizationId: B.organizationId },
        { recordType: "evidence" as const, recordId: A.sensitiveEvidenceId, organizationId: A.organizationId },
      ]) {
        let caught: unknown;
        try {
          requireServiceRead(scope, record);
        } catch (err) {
          caught = err;
        }
        expect(caught, `${d.queue} ${record.recordId}`).toBeInstanceOf(ServiceScopeViolation);
        expect((caught as ServiceScopeViolation).code).toBe("service_identity.out_of_scope");
      }
      requireServiceRead(scope, { recordType: null, recordId: A.transformationId, organizationId: A.organizationId });
      requireServiceRead(scope, {
        recordType: "evidence",
        recordId: A.plainEvidenceId,
        organizationId: A.organizationId,
      });
    }
    console.log(`service-identity scope: ${readers.length} job identities, 0 rows of organization B admitted`);
  });

  it("a code the identity does not hold admits nothing (no widening beyond the grant)", async () => {
    const p = await servicePrincipal(api.db, "kpi.recalculate", A.organizationId);
    const scope = await serviceReadScopeFor(api.db, p, "audit.read");
    expect(await serviceTr(scope)).toEqual(new Set());
    expect(() =>
      requireServiceRead(scope, { recordType: null, recordId: A.transformationId, organizationId: A.organizationId }),
    ).toThrow(ServiceScopeViolation);
  });
});

describe("the worker twin equals the API ReadScope (ADR-0053 §1 parity; ADR-0051 §1)", () => {
  it("selects the same rows and admits the same records, for every identity in both organizations", async () => {
    let pairs = 0;
    const targets = new Map<string, Awaited<ReturnType<typeof resolveTarget>>>();
    for (const t of [A, B])
      targets.set(t.transformationId, await resolveTarget(api.db, { type: "transformation", id: t.transformationId }));
    const evidenceOrg = new Map([
      [A.sensitiveEvidenceId, A],
      [A.plainEvidenceId, A],
      [B.sensitiveEvidenceId, B],
      [B.plainEvidenceId, B],
    ]);
    for (const d of JOB_SERVICE_IDENTITIES)
      for (const org of [A, B])
        for (const permission of [TR, "access.read", "audit.read"] as Permission[]) {
          const p = await servicePrincipal(api.db, d.queue, org.organizationId);
          const twin = await serviceReadScopeFor(api.db, p, permission);
          const ref: ReadScope = await readScopeFor(api.db, apiPrincipalOf(p), permission);
          expect(await serviceTr(twin), d.queue).toEqual(
            await transformationsSelected(
              (c) => ref.predicate({ recordType: null, ...c, transformationId: c.recordId }),
              [A.transformationId, B.transformationId],
            ),
          );
          expect(await serviceEv(twin, "record"), d.queue).toEqual(
            await evidenceSelected((c) => ref.predicate({ recordType: "evidence", ...c }), allEvidence()),
          );
          for (const [id, owner] of evidenceOrg) {
            const target = targets.get(owner.transformationId)!;
            expect(
              twin.admits({ recordType: "evidence", recordId: id, organizationId: owner.organizationId }),
              `${d.queue} ${permission} ${id}`,
            ).toBe(ref.admits({ recordType: "evidence", recordId: id, target: target!, partyUserIds: [] }));
            pairs += 1;
          }
        }
    console.log(`service-scope parity: ${pairs} (identity, organization, permission, record) pairs, 0 mismatches`);
  });
});

describe("a job reads with its grant; a missing identity fails the run (ADR-0053 §1)", () => {
  it("defineJob passes the loaded identity; a narrowed grant refuses with service_identity.out_of_scope", async () => {
    const code = "job:launch.day_ninety_tests";
    const declared = [...(await identityRow(code)).declared_permission_codes];
    const job = defineJob({
      queue: "launch.day_ninety_tests",
      handle: async (db, _data, _jobId, _attempt, run) => {
        const scope = await serviceReadScopeFor(db, run.principal(A.organizationId), TR);
        requireServiceRead(scope, { recordType: null, recordId: A.transformationId, organizationId: A.organizationId });
        return "read";
      },
    });
    expect(await job.handle(api.db, {}, "be-j-job-1")).toBe("read");
    await setGrant(admin, code, [], "Synthetic test: narrow the grant to nothing.");
    try {
      await expect(job.handle(api.db, {}, "be-j-job-2")).rejects.toMatchObject({
        code: "service_identity.out_of_scope",
      });
    } finally {
      await setGrant(admin, code, declared, "Synthetic test: restore the declared grant.");
    }
    expect(await job.handle(api.db, {}, "be-j-job-3")).toBe("read");
  });

  it("a missing identity row fails with service_identity.missing, and the failure queue records that code", async () => {
    await expect(loadServiceIdentity(api.db, "job:test_be_j.no_identity")).rejects.toMatchObject({
      code: "service_identity.missing",
      message: "The job has no service identity, so it did not run.",
    });
    let error: unknown;
    try {
      await servicePrincipal(api.db, "test_be_j.no_identity", A.organizationId);
    } catch (err) {
      error = err;
    }
    const captured = await captureJobFailure(api.db, {
      queue: "test_be_j.no_identity",
      jobId: `be-j-${crypto.randomUUID()}`,
      data: {},
      attempts: 1,
      error,
    });
    const row = await api.db
      .selectFrom("operational_failure")
      .selectAll()
      .where("id", "=", captured.failureId)
      .executeTakeFirstOrThrow();
    expect(row.error_code).toBe("service_identity.missing");
    expect(row.error_message).toBe("The job has no service identity, so it did not run.");
  });
});

describe("putServiceIdentity (ADR-0053 §1, §9)", () => {
  const code = "job:sustainment.review_scan";

  it("narrows and restores the grant, with one audit event per change and the history row", async () => {
    const before = await identityRow(code);
    const narrowed = await setGrant(admin, code, [], "Synthetic test: narrow.");
    expect(narrowed).toMatchObject({
      grantedPermissionCodes: [],
      version: before.version + 1,
      reason: "Synthetic test: narrow.",
    });
    expect(narrowed.declaredPermissionCodes).toEqual([...before.declared_permission_codes]);
    const restored = await setGrant(admin, code, [...before.declared_permission_codes], "Synthetic test: restore.");
    expect(restored.grantedPermissionCodes).toEqual([...before.declared_permission_codes]);
    expect(restored.version).toBe(before.version + 2);
    const events = (await auditOf(api.db, before.id)).filter((e) => e.action === "service_identity.grant_changed");
    expect(events.slice(-2).map((e) => [e.prior_version, e.new_version, e.actor_user_id])).toEqual([
      [before.version, before.version + 1, w.admin.id],
      [before.version + 1, before.version + 2, w.admin.id],
    ]);
    const history = await api.db
      .selectFrom("service_identity_change")
      .select(["record_version", "granted_permission_codes", "changed_by"])
      .where("service_identity_id", "=", before.id)
      .orderBy("record_version")
      .execute();
    expect(history.slice(-2)).toEqual([
      { record_version: before.version + 1, granted_permission_codes: [], changed_by: w.admin.id },
      {
        record_version: before.version + 2,
        granted_permission_codes: [...before.declared_permission_codes],
        changed_by: w.admin.id,
      },
    ]);
  });

  it("refuses a grant beyond the declaration, a blank reason, a stale or missing If-Match, AUD and outsiders", async () => {
    const row = await identityRow(code);
    const auditsBefore = (await auditOf(api.db, row.id)).length;
    const url = `${L}/${row.id}`;
    const body = { grantedPermissionCodes: [...row.declared_permission_codes], reason: "Synthetic test reason." };
    const put = (session: Session | null, b: unknown, headers?: Record<string, string>) =>
      call<Body>(api.app, "PUT", url, { session, body: b, ...(headers ? { headers } : {}) });
    const wider = await put(
      admin,
      { ...body, grantedPermissionCodes: [...body.grantedPermissionCodes, "user.read"] },
      ifm(row.version),
    );
    expect([wider.status, wider.body.code]).toEqual([422, "service_identity.grant_exceeds_declaration"]);
    expect(wider.body.detail).toBe(
      "A service identity can be granted only permissions that its job or connector declares.",
    );
    const configure = await put(
      admin,
      { ...body, grantedPermissionCodes: ["service_identity.configure"] },
      ifm(row.version),
    );
    expect([configure.status, configure.body.code]).toEqual([422, "service_identity.grant_exceeds_declaration"]);
    const blank = await put(admin, { ...body, reason: "    " }, ifm(row.version));
    expect([blank.status, blank.body.code, blank.body.detail]).toEqual([
      422,
      "service_identity.reason_required",
      "Enter a reason of 3 to 1,000 characters.",
    ]);
    expect((await put(admin, body, ifm(row.version + 7))).status).toBe(409);
    expect((await put(admin, body)).status).toBe(428);
    const aud = await put(auditor, body, ifm(row.version));
    expect([aud.status, aud.body.code]).toEqual([403, "forbidden"]);
    expect((await put(nobody, body, ifm(row.version))).status).toBe(404);
    expect((await put(null, body, ifm(row.version))).status).toBe(401);
    // Nothing changed: same version, no new audit event.
    const after = await identityRow(code);
    expect(after.version).toBe(row.version);
    expect((await auditOf(api.db, row.id)).length).toBe(auditsBefore);
  });

  it("re-checks authorization at commit on the reloaded grants (a right lost meanwhile is 403; nothing written)", async () => {
    const row = await identityRow(code);
    const auditsBefore = (await auditOf(api.db, row.id)).length;
    const request = {
      id: "be-j-commit-time",
      principal: { kind: "user", userId: w.admin.id, organizationId: w.orgA.id, grants: [], tracker: { decisions: 0 } },
      reauthenticate: async () => ({
        kind: "user",
        userId: w.admin.id,
        organizationId: w.orgA.id,
        grants: [],
        tracker: { decisions: 0 },
      }),
    } as unknown as FastifyRequest;
    let caught: unknown;
    try {
      await api.db
        .transaction()
        .execute((tx) =>
          putServiceIdentity(tx, request, row.id, row.version, { grantedPermissionCodes: [], reason: "Synthetic." }),
        );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpProblem);
    expect((caught as HttpProblem).status).toBe(403);
    expect((await identityRow(code)).version).toBe(row.version);
    expect((await auditOf(api.db, row.id)).length).toBe(auditsBefore);
  });

  it("lists and reads: the platform identities for an organization-level reader; AUD reads; outsiders refused", async () => {
    const listed = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgB.id}&limit=100`, { session: admin });
    expect(listed.status).toBe(403); // admin holds operations.read in organization A only
    const own = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&subjectKind=job&limit=100`, {
      session: auditor,
    });
    expect(own.status).toBe(200);
    expect(own.body.items).toHaveLength(JOB_SERVICE_IDENTITIES.length);
    expect(own.body.nextCursor).toBeNull();
    const connectors = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&subjectKind=connector`, {
      session: auditor,
    });
    expect(connectors.status).toBe(200);
    expect(connectors.body.items.every((i: Body) => i.organizationId === w.orgA.id)).toBe(true);
    const row = await identityRow(code);
    expect((await call<Body>(api.app, "GET", `${L}/${row.id}`, { session: auditor })).status).toBe(200);
    expect((await call<Body>(api.app, "GET", `${L}/${row.id}`, { session: nobody })).status).toBe(404);
  });
});
