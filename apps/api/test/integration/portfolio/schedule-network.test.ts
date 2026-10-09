// The schedule network and the critical path (T-DG4-BE-E; ADR-0031 §8-§11; REQ-S09-009 "Critical path is computed by a
// documented algorithm (zero total float) and only shown when inputs are complete"; A05 "for a fixture network the
// computed critical path matches the expected chain; with missing durations no critical path is claimed").
// Proves, against the run's disposable PostgreSQL and through the API only:
//  - the ADR-0031 §8 fixture (INI-01 (5) -> INI-02 (10) -> INI-04 (3); INI-01 -> INI-03 (4) -> INI-04) gives the path
//    INI-01 -> INI-02 -> INI-04 and P = 18, INI-03 with total float 6;
//  - removing one duration gives `not_computable` (missing_durations) listing that initiative, and NO node, edge or path
//    is marked critical; restoring or changing it recomputes on the next read ("Critical dependency slips -> recompute");
//  - nodes exclude cancelled initiatives; an external predecessor adds no edge; an empty network is no_initiatives;
//  - durations: create (409 initiative_schedule.exists the second time, exact text), update (404 when none, If-Match
//    428/409), validation 400, one audit event per change; roadmap.edit holders (TL, WL, TO) may write; AUD, FIN and
//    BO get 403; ADM-only users and outsiders get 404 on every operation; the write authorised again at commit time.
// All data is SYNTHETIC. Nothing here is a business approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  insertInitiative,
  newDependency,
  seedExecutionWorld,
  setDuration,
  type Caller,
  type ExecWorld,
} from "./execution-fixtures.ts";

let api: TestApi;
let w: World;
let send: Caller;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  send = (m, u, o) => call(api.app, m, u, o);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const EXISTS = "This initiative already has a planned duration; update it instead.";
const network = async (x: ExecWorld, session = x.s.tl) => {
  const r = await call(api.app, "GET", `/api/v1/transformations/${x.transformationId}/schedule-network`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const S = (initiativeId: string) => `/api/v1/initiatives/${initiativeId}/schedule`;

describe("the ADR-0031 §8 fixture network", () => {
  let x: ExecWorld;
  let id: Record<string, string>;
  beforeAll(async () => {
    x = await seedExecutionWorld(api, w);
    id = {};
    for (const code of ["INI-01", "INI-02", "INI-03", "INI-04"]) id[code] = await insertInitiative(api.db, x, code);
    await newDependency(send, x, id["INI-01"]!, id["INI-02"]!);
    await newDependency(send, x, id["INI-02"]!, id["INI-04"]!);
    await newDependency(send, x, id["INI-01"]!, id["INI-03"]!);
    await newDependency(send, x, id["INI-03"]!, id["INI-04"]!);
    await setDuration(send, x, id["INI-01"]!, 5);
    await setDuration(send, x, id["INI-02"]!, 10);
    await setDuration(send, x, id["INI-03"]!, 4);
    await setDuration(send, x, id["INI-04"]!, 3);
  });

  it("the computed critical path is INI-01 -> INI-02 -> INI-04, P = 18; INI-03 has total float 6", async () => {
    const n = await network(x, x.s.auditor);
    expect([n.algorithm, n.status, n.reason, n.projectDurationWorkingDays, n.truncated]).toEqual([
      "cpm-fs/1",
      "computed",
      null,
      18,
      false,
    ]);
    expect(n.criticalPaths).toEqual([[id["INI-01"], id["INI-02"], id["INI-04"]]]);
    const by = Object.fromEntries(n.nodes.map((v: { code: string }) => [v.code, v]));
    expect(by["INI-03"]).toMatchObject({
      durationWorkingDays: 4,
      earliestStart: 5,
      latestStart: 11,
      totalFloat: 6,
      critical: false,
    });
    expect(by["INI-02"]).toMatchObject({ earliestStart: 5, earliestFinish: 15, totalFloat: 0, critical: true });
    expect(n.edges.filter((e: { critical: boolean }) => e.critical)).toHaveLength(2);
    expect(n.missingDurations).toEqual([]);
  });

  it("removing INI-03's duration: not_computable, INI-03 listed, nothing marked critical; restoring it recomputes", async () => {
    const before = await call(api.app, "PATCH", S(id["INI-03"]!), {
      session: x.s.wl,
      headers: ifm(1),
      body: { durationWorkingDays: null },
    });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const n = await network(x);
    expect([n.status, n.reason, n.projectDurationWorkingDays, n.criticalPaths]).toEqual([
      "not_computable",
      "missing_durations",
      null,
      [],
    ]);
    expect(n.missingDurations).toEqual([
      { initiativeId: id["INI-03"], code: "INI-03", name: "Synthetic initiative INI-03" },
    ]);
    expect(
      n.nodes.every((v: { critical: unknown; totalFloat: unknown }) => v.critical === null && v.totalFloat === null),
    ).toBe(true);
    expect(n.edges.every((e: { critical: unknown }) => e.critical === null)).toBe(true);
    // The execution view never claims membership either.
    const e = await call(api.app, "GET", `/api/v1/initiatives/${id["INI-02"]}/execution`, { session: x.s.tl });
    expect(e.body.onCriticalPath).toBeNull();

    const slip = await call(api.app, "PATCH", S(id["INI-03"]!), {
      session: x.s.to,
      headers: ifm(2),
      body: { durationWorkingDays: 11 },
    });
    expect(slip.status).toBe(200);
    const again = await network(x);
    expect([again.status, again.projectDurationWorkingDays, again.criticalPaths]).toEqual([
      "computed",
      19,
      [[id["INI-01"], id["INI-03"], id["INI-04"]]],
    ]);
  });

  it("a cancelled initiative is not a node; an external predecessor adds no edge", async () => {
    const before = await network(x);
    await insertInitiative(api.db, x, "INI-09", { status: "cancelled" });
    const ext = await send("POST", "/api/v1/dependencies", {
      session: x.s.tl,
      body: {
        transformationId: x.transformationId,
        description: "Synthetic vendor delivery",
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: id["INI-01"],
        dependencyType: "tech",
      },
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    const after = await network(x);
    expect(after.nodes.map((v: { code: string }) => v.code)).toEqual(["INI-01", "INI-02", "INI-03", "INI-04"]);
    expect(after.edges.length).toBe(before.edges.length);
    expect(after.status).toBe("computed");
  });
});

describe("network edge cases", () => {
  it("a transformation without initiatives: not_computable, no_initiatives", async () => {
    const x = await seedExecutionWorld(api, w);
    const n = await network(x);
    expect([n.status, n.reason, n.nodes, n.edges, n.criticalPaths]).toEqual([
      "not_computable",
      "no_initiatives",
      [],
      [],
      [],
    ]);
  });

  it("AUD reads it; ADM-only users and outsiders get 404", async () => {
    const x = await seedExecutionWorld(api, w);
    await network(x, x.s.auditor);
    for (const s of [x.s.admin, x.s.outsider])
      expect(
        (await call(api.app, "GET", `/api/v1/transformations/${x.transformationId}/schedule-network`, { session: s }))
          .status,
      ).toBe(404);
  });
});

describe("initiative durations (createInitiativeSchedule, updateInitiativeSchedule)", () => {
  let x: ExecWorld;
  beforeAll(async () => {
    x = await seedExecutionWorld(api, w);
  });

  it("create: 201, version 1, ETag, Location, audited; a second create -> 409 initiative_schedule.exists", async () => {
    const ini = await insertInitiative(api.db, x, "INI-01");
    const r = await call(api.app, "POST", S(ini), {
      session: x.s.tl,
      body: { durationWorkingDays: 12, note: "Synthetic estimate" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([
      r.headers.etag,
      r.headers.location,
      r.body.initiativeId,
      r.body.durationWorkingDays,
      r.body.version,
    ]).toEqual(['"1"', S(ini), ini, 12, 1]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["initiative_schedule.create", 1],
    ]);
    const dup = await call(api.app, "POST", S(ini), { session: x.s.wl, body: { durationWorkingDays: 3 } });
    expect([dup.status, dup.body.code, dup.body.detail, dup.body.type]).toEqual([
      409,
      "initiative_schedule.exists",
      EXISTS,
      "urn:mth:problem:duplicate",
    ]);
  });

  it("a duration may be recorded as missing (null); out-of-range, fractional or absent values are 400", async () => {
    const ini = await insertInitiative(api.db, x, "INI-02");
    for (const body of [
      { durationWorkingDays: 2601 },
      { durationWorkingDays: -1 },
      { durationWorkingDays: 1.5 },
      {},
      { durationWorkingDays: "3" },
    ])
      expect((await call(api.app, "POST", S(ini), { session: x.s.tl, body })).status).toBe(400);
    const r = await call(api.app, "POST", S(ini), { session: x.s.tl, body: { durationWorkingDays: null } });
    expect([r.status, r.body.durationWorkingDays]).toEqual([201, null]);
    const max = await insertInitiative(api.db, x, "INI-03");
    expect((await call(api.app, "POST", S(max), { session: x.s.to, body: { durationWorkingDays: 2600 } })).status).toBe(
      201,
    );
  });

  it("update: 404 when none is recorded; If-Match 428/409; changes the duration (audited)", async () => {
    const ini = await insertInitiative(api.db, x, "INI-04");
    expect(
      (await call(api.app, "PATCH", S(ini), { session: x.s.tl, headers: ifm(1), body: { durationWorkingDays: 4 } }))
        .status,
    ).toBe(404);
    const c = await call(api.app, "POST", S(ini), { session: x.s.tl, body: { durationWorkingDays: 4 } });
    expect((await call(api.app, "PATCH", S(ini), { session: x.s.tl, body: { durationWorkingDays: 6 } })).status).toBe(
      428,
    );
    const stale = await call(api.app, "PATCH", S(ini), {
      session: x.s.tl,
      headers: ifm(3),
      body: { durationWorkingDays: 6 },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await call(api.app, "PATCH", S(ini), { session: x.s.tl, headers: ifm(1), body: {} })).status).toBe(400);
    const ok = await call(api.app, "PATCH", S(ini), {
      session: x.s.wl,
      headers: ifm(1),
      body: { durationWorkingDays: 6 },
    });
    expect([ok.status, ok.headers.etag, ok.body.durationWorkingDays, ok.body.updatedBy]).toEqual([
      200,
      '"2"',
      6,
      x.users.wl.id,
    ]);
    const audit = await auditOf(api.db, c.body.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["initiative_schedule.create", null, 1],
      ["initiative_schedule.update", 1, 2],
    ]);
    expect(audit[1]!.changes).toMatchObject({ duration_working_days: { from: 4, to: 6 } });
  });

  it("AUD, FIN and BO get 403; ADM-only users and outsiders get 404; nothing written", async () => {
    const ini = await insertInitiative(api.db, x, "INI-05");
    await setDuration(send, x, ini, 2);
    const fresh = await insertInitiative(api.db, x, "INI-06");
    for (const s of [x.s.auditor, x.s.fin, x.s.bo]) {
      expect((await call(api.app, "POST", S(fresh), { session: s, body: { durationWorkingDays: 1 } })).status).toBe(
        403,
      );
      expect(
        (await call(api.app, "PATCH", S(ini), { session: s, headers: ifm(1), body: { durationWorkingDays: 1 } }))
          .status,
      ).toBe(403);
    }
    for (const s of [x.s.admin, x.s.outsider]) {
      expect((await call(api.app, "POST", S(fresh), { session: s, body: { durationWorkingDays: 1 } })).status).toBe(
        404,
      );
      expect(
        (await call(api.app, "PATCH", S(ini), { session: s, headers: ifm(1), body: { durationWorkingDays: 1 } }))
          .status,
      ).toBe(404);
    }
    const rows = await api.db
      .selectFrom("initiative_schedule")
      .select(["initiative_id", "duration_working_days", "version"])
      .where("initiative_id", "in", [ini, fresh])
      .execute();
    expect(rows).toEqual([{ initiative_id: ini, duration_working_days: 2, version: 1 }]);
  });

  it("roadmap.edit is re-checked at commit time: a grant revoked while the request waits -> 403, nothing written", async () => {
    const ini = await insertInitiative(api.db, x, "INI-07");
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "WL", { type: "transformation", id: x.transformationId }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", S(ini), { session, body: { durationWorkingDays: 3 }, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("initiative_schedule")
      .select("id")
      .where("initiative_id", "=", ini)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
