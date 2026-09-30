// A12 (REQ-S20-012 first cases; REQ-S10-001/002, REQ-S16-030): cross-scope read/write of a transformation is DENIED by
// the policy function, and the in-scope case succeeds.
//
// Derived from the acceptance criterion and docs/api/openapi.yaml "Authorization (ADR-0006)":
//   - a caller who may not read a record gets 404 (existence is not disclosed);
//   - a caller who may read but not change it gets 403;
//   - lists are scope-filtered (transformation.read);
//   - a denied write changes nothing (version, fields, audit trail of the record).
// Each principal is scoped at ONE level (organization / business unit / transformation) to "A" and probed against
// every "B" outside that scope. All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize, loadGrants, type Principal } from "../../../apps/api/src/modules/access/index.ts";
import {
  auditOf,
  call,
  createBu,
  createOrg,
  createTransformation,
  createTransformationRow,
  createUser,
  disclosureShape,
  expectProblem,
  grant,
  patchTransformation,
  signIn,
  startApi,
  unknownId,
  type Session,
  type TestApi,
} from "../support/api.ts";

let api: TestApi;

interface Probe {
  readonly label: string;
  readonly subject: string;
  readonly userId: string;
  readonly inScope: readonly string[];
  readonly outOfScope: readonly string[];
  session?: Session;
}

const w = {} as {
  orgA: string;
  orgB: string;
  buA1: string;
  buA2: string;
  buB: string;
  tA1: string;
  tA1b: string;
  tA2: string;
  tB: string;
  names: Record<string, string>;
};
const probes: Probe[] = [];

async function row(id: string) {
  return api.db
    .selectFrom("transformation")
    .select(["version", "name", "description", "status", "archived_at", "updated_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  api = await startApi();
  const db = api.db;
  const orgA = await createOrg(db);
  const orgB = await createOrg(db);
  w.orgA = orgA.id;
  w.orgB = orgB.id;
  w.buA1 = await createBu(db, orgA.id);
  w.buA2 = await createBu(db, orgA.id);
  w.buB = await createBu(db, orgB.id);
  const creator = await createUser(db, orgA.id);
  const creatorB = await createUser(db, orgB.id);
  w.tA1 = await createTransformationRow(db, orgA.id, w.buA1, creator.id);
  w.tA1b = await createTransformationRow(db, orgA.id, w.buA1, creator.id);
  w.tA2 = await createTransformationRow(db, orgA.id, w.buA2, creator.id);
  w.tB = await createTransformationRow(db, orgB.id, w.buB, creatorB.id);
  w.names = {};
  for (const id of [w.tA1, w.tA1b, w.tA2, w.tB]) w.names[id] = (await row(id)).name;

  const grantor = await createUser(db, orgA.id);
  const uOrg = await createUser(db, orgA.id);
  const uBu = await createUser(db, orgA.id);
  const uTx = await createUser(db, orgA.id);
  // Transformation Office inherits downward; Transformation Lead does not (packages/shared permissions matrix).
  await grant(db, grantor.id, uOrg.id, "TO", { type: "organization", id: orgA.id }, orgA.id);
  await grant(db, grantor.id, uBu.id, "TO", { type: "business_unit", id: w.buA1 }, orgA.id);
  await grant(db, grantor.id, uTx.id, "TL", { type: "transformation", id: w.tA1 }, orgA.id);

  probes.push(
    {
      label: "organization scope (TO @ org A)",
      subject: uOrg.subject,
      userId: uOrg.id,
      inScope: [w.tA1, w.tA2],
      outOfScope: [w.tB],
    },
    {
      label: "business-unit scope (TO @ BU A1)",
      subject: uBu.subject,
      userId: uBu.id,
      inScope: [w.tA1, w.tA1b],
      outOfScope: [w.tA2, w.tB],
    },
    {
      label: "transformation scope (TL @ transformation A1)",
      subject: uTx.subject,
      userId: uTx.id,
      inScope: [w.tA1],
      outOfScope: [w.tA1b, w.tA2, w.tB],
    },
  );
  for (const p of probes) p.session = await signIn(api.app, p.subject);
});

afterAll(async () => {
  await api?.close();
});

describe("A12 cross-scope read is denied (404, existence not disclosed); in-scope read succeeds", () => {
  it.each([0, 1, 2])("probe %i: reads exactly its scope", async (i) => {
    const p = probes[i]!;
    for (const id of p.inScope) {
      const r = await call(api.app, "GET", `/api/v1/transformations/${id}`, { session: p.session! });
      expect(r.status, `${p.label}: GET in-scope ${id}`).toBe(200);
      expect(r.body.id).toBe(id);
      expect(r.headers["etag"]).toMatch(/^"[1-9][0-9]*"$/);
    }
    for (const id of p.outOfScope) {
      const r = await call(api.app, "GET", `/api/v1/transformations/${id}`, { session: p.session! });
      expectProblem(r, 404, "urn:mth:problem:not-found");
      // Nothing about the foreign record leaks in the problem body.
      expect(JSON.stringify(r.body), `${p.label}: problem body leaks the record`).not.toContain(w.names[id]!);
      // Indistinguishable from an id that does not exist at all.
      const ghost = await call(api.app, "GET", `/api/v1/transformations/${unknownId()}`, { session: p.session! });
      expect(disclosureShape(r)).toEqual(disclosureShape(ghost));
      // The audit trail of a foreign record is not readable either.
      const trail = await call(api.app, "GET", `/api/v1/transformations/${id}/audit`, { session: p.session! });
      expectProblem(trail, 404, "urn:mth:problem:not-found");
    }
  });

  it.each([0, 1, 2])(
    "probe %i: the list is scope-filtered (no foreign record, even when filtering for it)",
    async (i) => {
      const p = probes[i]!;
      const all = await call(api.app, "GET", "/api/v1/transformations?limit=100", { session: p.session! });
      expect(all.status).toBe(200);
      const ids = (all.body.items as { id: string }[]).map((t) => t.id);
      for (const id of p.inScope) expect(ids, `${p.label}: list misses in-scope ${id}`).toContain(id);
      for (const id of p.outOfScope) expect(ids, `${p.label}: list shows out-of-scope ${id}`).not.toContain(id);

      const foreignOrg = await call(api.app, "GET", `/api/v1/transformations?organizationId=${w.orgB}&limit=100`, {
        session: p.session!,
      });
      expect(foreignOrg.status).toBe(200);
      expect(foreignOrg.body.items).toEqual([]);
      const byName = await call(
        api.app,
        "GET",
        `/api/v1/transformations?q=${encodeURIComponent(w.names[w.tB]!)}&includeArchived=true&limit=100`,
        { session: p.session! },
      );
      expect(byName.status).toBe(200);
      expect((byName.body.items as { id: string }[]).map((t) => t.id)).not.toContain(w.tB);
    },
  );
});

describe("A12 cross-scope write is denied and writes nothing; in-scope write succeeds", () => {
  it.each([0, 1, 2])("probe %i: PATCH and archive outside the scope are 404 and change nothing", async (i) => {
    const p = probes[i]!;
    for (const id of p.outOfScope) {
      const before = await row(id);
      const trailBefore = (await auditOf(api.db, id)).filter((e) => e.action.startsWith("transformation."));
      const etag = `"${before.version}"`;

      const upd = await patchTransformation(api.app, p.session!, id, { name: "QA cross-scope overwrite" }, etag);
      expectProblem(upd, 404, "urn:mth:problem:not-found");
      const ghostUpd = await patchTransformation(api.app, p.session!, unknownId(), { name: "QA ghost" }, '"1"');
      expect(disclosureShape(upd)).toEqual(disclosureShape(ghostUpd));

      const arch = await call(api.app, "POST", `/api/v1/transformations/${id}/archive`, {
        session: p.session!,
        body: { reason: "QA cross-scope archive attempt" },
        headers: { "if-match": etag },
      });
      expectProblem(arch, 404, "urn:mth:problem:not-found");

      // Missing If-Match must not turn into an existence oracle either.
      const noIfMatch = await patchTransformation(api.app, p.session!, id, { name: "QA no precondition" }, null);
      const noIfMatchGhost = await patchTransformation(api.app, p.session!, unknownId(), { name: "QA ghost" }, null);
      expect(disclosureShape(noIfMatch)).toEqual(disclosureShape(noIfMatchGhost));
      expect(noIfMatch.status).toBeGreaterThanOrEqual(400);

      const after = await row(id);
      expect(after, `${p.label}: ${id} changed after denied writes`).toEqual(before);
      const trailAfter = (await auditOf(api.db, id)).filter((e) => e.action.startsWith("transformation."));
      expect(trailAfter.map((e) => e.action)).toEqual(trailBefore.map((e) => e.action));
    }
  });

  it.each([0, 1, 2])("probe %i: PATCH inside the scope succeeds and bumps the version", async (i) => {
    const p = probes[i]!;
    const id = p.inScope[0]!;
    const cur = await call(api.app, "GET", `/api/v1/transformations/${id}`, { session: p.session! });
    expect(cur.status).toBe(200);
    const name = `QA in-scope update ${i}`;
    const upd = await patchTransformation(api.app, p.session!, id, { name }, String(cur.headers["etag"]));
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe(name);
    expect(upd.body.version).toBe(cur.body.version + 1);
    expect((await row(id)).name).toBe(name);
  });

  it("create is denied outside the caller's scope (no row), allowed inside it", async () => {
    const [pOrg, pBu, pTx] = probes as [Probe, Probe, Probe];
    const count = async () =>
      Number(
        (
          await api.db
            .selectFrom("transformation")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      );
    const body = (bu: string, name: string) => ({ businessUnitId: bu, name, mode: "end_to_end" });

    const n0 = await count();
    for (const [p, bu] of [
      [pOrg, w.buB],
      [pBu, w.buA2],
      [pBu, w.buB],
      [pTx, w.buA1], // a transformation-scope grant does not cover its business unit
      [pTx, w.buB],
    ] as const) {
      const r = await createTransformation(api.app, p.session!, body(bu, "QA denied create"));
      expect([403, 404], `${p.label}: create in ${bu} -> ${r.status}`).toContain(r.status);
      expect(String(r.headers["content-type"])).toContain("application/problem+json");
    }
    expect(await count(), "a denied create wrote a row").toBe(n0);

    const ok = await createTransformation(api.app, pBu.session!, body(w.buA1, "QA allowed create"));
    expect(ok.status).toBe(201);
    expect(ok.body.businessUnitId).toBe(w.buA1);
    expect(await count()).toBe(n0 + 1);
  });
});

describe("A12 the policy function itself decides the same way", () => {
  it("authorize() allows read/update in scope and denies them out of scope, per scope level", async () => {
    for (const p of probes) {
      const principal: Principal = {
        kind: "user",
        userId: p.userId,
        organizationId: w.orgA,
        grants: await loadGrants(api.db, p.userId),
        tracker: { decisions: 0 },
      };
      for (const permission of ["transformation.read", "transformation.update", "transformation.archive"] as const) {
        for (const id of p.inScope) {
          const d = await authorize(api.db, principal, permission, { type: "transformation", id });
          expect(d.allowed, `${p.label}: ${permission} on in-scope ${id}`).toBe(true);
        }
        for (const id of p.outOfScope) {
          const d = await authorize(api.db, principal, permission, { type: "transformation", id });
          expect(d.allowed, `${p.label}: ${permission} on out-of-scope ${id}`).toBe(false);
        }
      }
      expect(principal.tracker.decisions).toBeGreaterThan(0);
    }
  });
});
