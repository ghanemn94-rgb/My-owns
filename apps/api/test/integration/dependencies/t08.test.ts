// T08 Dependency Map and dependency types (ADR-0023 §4-§5; REQ-PB-051, REQ-PB-052, REQ-S09-008, REQ-S16-016;
// T-DG3-BE-C) against a real PostgreSQL:
//  - the seven T08 columns round-trip; From `external` with a label is accepted;
//  - an unknown or retired type is 422 dependency.unknown_type; a system type DELETE is 422
//    dependency_type.system_undeletable; custom types are added, relabelled and retired (soft);
//  - A→B→C→A and A→B→A are rejected naming the cycle (the ADR-0023 §5 body); nothing is written;
//  - two connections inserting A→B and B→A concurrently: exactly one commits (API and database guard);
//  - schedule flags: a predecessor finishing after the needed-by date is flagged; Unknown is never "no conflict";
//  - every mutation: AUD 403, If-Match 428/409, an audit event, and authorisation re-checked at commit time;
//  - the DG2 paths stay stable: custom codes are projected as "other"; a DG2 PATCH of the kinds is 422.
// All data is synthetic; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import { DEPENDENCY_TYPE_LOCK_CLASS } from "../../../src/modules/workflows/dependency-types.ts";
import { DEPENDENCY_GRAPH_LOCK_CLASS, findCycle } from "../../../src/modules/workflows/t08-dependencies.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { insertInitiatives, whileBlocked, type SyntheticInitiative } from "../contract/p3-exercises-be-c.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const DEPS = "/api/v1/dependencies";
const TYPES = "/api/v1/dependency-types";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const edge = (p: P2World, from: SyntheticInitiative, to: SyntheticInitiative, over: Record<string, unknown> = {}) => ({
  transformationId: p.transformationId,
  description: `Synthetic: ${to.code} needs ${from.code}`,
  from: { kind: "initiative", initiativeId: from.id },
  toInitiativeId: to.id,
  dependencyType: "tech",
  ...over,
});
const post = (body: unknown, session: Session) => call<Body>(api.app, "POST", DEPS, { session, body });
const rows = async (p: P2World) =>
  (await api.db.selectFrom("dependency").select("id").where("transformation_id", "=", p.transformationId).execute())
    .length;

async function world(n = 3, specs: Parameters<typeof insertInitiatives>[2] = []) {
  const p = await setupP2World(api, w);
  const list = await insertInitiatives(api, p, specs.length > 0 ? specs : Array.from({ length: n }, () => ({})));
  return { p, ini: list };
}

describe("T08 columns, From external, types", () => {
  it("the seven T08 columns round-trip; version 1, ETag and Location; audited; listed and read", async () => {
    const { p, ini } = await world(2);
    const [a, b] = ini;
    const res = await post(
      edge(p, a!, b!, {
        description: "Synthetic: INI-02 needs the customer data platform of INI-01",
        dependencyType: "data",
        neededBy: "2026-06-30",
        ownerUserId: p.lead.id,
        mitigation: "Synthetic: interim extract",
      }),
      p.lead.session,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${DEPS}/${res.body.id}`);
    expect(res.body).toMatchObject({
      code: "DEP-01",
      description: "Synthetic: INI-02 needs the customer data platform of INI-01",
      fromKind: "initiative",
      fromInitiativeId: a!.id,
      fromLabel: null,
      toKind: "initiative",
      toInitiativeId: b!.id,
      dependencyType: "data",
      neededBy: "2026-06-30",
      ownerUserId: p.lead.id,
      status: "open",
      mitigation: "Synthetic: interim extract",
      version: 1,
    });
    const audit = await auditOf(api.db, res.body.id);
    expect(audit.map((e) => [e.action, e.new_version])).toEqual([["dependency.create", 1]]);
    expect(audit[0]!.changes).toMatchObject({ to_initiative_id: { from: null, to: b!.id } });
    const read = await call<Body>(api.app, "GET", `${DEPS}/${res.body.id}`, { session: p.auditor.session });
    expect([read.status, read.body.code, read.headers["etag"]]).toEqual([200, "DEP-01", '"1"']);
    const page = await call<Body>(
      api.app,
      "GET",
      `${DEPS}?transformationId=${p.transformationId}&initiativeId=${a!.id}`,
      {
        session: p.auditor.session,
      },
    );
    expect(page.body.items.map((d: Body) => d.id)).toEqual([res.body.id]);
    // Someone without access to the transformation sees nothing (404, existence not disclosed).
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", `${DEPS}/${res.body.id}`, { session: nobody })).status).toBe(404);
    expect(
      (await call(api.app, "GET", `${DEPS}?transformationId=${p.transformationId}`, { session: nobody })).status,
    ).toBe(404);
  });

  it("From `external` with a label is accepted (no edge); a label-less external From is 400", async () => {
    const { p, ini } = await world(1);
    const res = await post(
      {
        transformationId: p.transformationId,
        description: "Synthetic: vendor contract signed",
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: ini[0]!.id,
        dependencyType: "vendor",
      },
      p.lead.session,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ fromKind: "external", fromLabel: "Synthetic vendor", fromInitiativeId: null });
    // Its schedule is Unknown (an external finish date is not held), never "no conflict".
    expect(res.body.flags.map((f: Body) => f.code)).toEqual(["schedule.unknown"]);
    const bad = await post({ ...edge(p, ini[0]!, ini[0]!), from: { kind: "external" } }, p.lead.session);
    expect(bad.status).toBe(400);
  });

  it("an unknown or retired type is 422 dependency.unknown_type; nothing written", async () => {
    const { p, ini } = await world(2);
    const before = await rows(p);
    const res = await post(edge(p, ini[0]!, ini[1]!, { dependencyType: "no_such_type" }), p.lead.session);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      type: "urn:mth:problem:validation",
      code: "dependency.unknown_type",
      detail: "Unknown dependency type: no_such_type",
      errors: [{ pointer: "/dependencyType", code: "dependency.unknown_type" }],
    });
    // A retired custom type keeps existing rows but is refused for new ones.
    const code = uniq("rt_").toLowerCase();
    const t = await call<Body>(api.app, "POST", TYPES, {
      session: p.methodologyAdmin.session,
      body: { code, labelEn: "Synthetic retiring type", labelAr: "نوع اصطناعي" },
    });
    expect(t.status).toBe(201);
    const kept = await post(edge(p, ini[0]!, ini[1]!, { dependencyType: code }), p.lead.session);
    expect(kept.status).toBe(201);
    const retired = await call<Body>(api.app, "DELETE", `${TYPES}/${code}`, {
      session: p.methodologyAdmin.session,
      headers: ifm(1),
    });
    expect([retired.status, retired.body.status]).toEqual([200, "retired"]);
    const again = await post(edge(p, ini[1]!, ini[0]!, { dependencyType: code }), p.lead.session);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "dependency.unknown_type",
      `Unknown dependency type: ${code}`,
    ]);
    const stillThere = await call<Body>(api.app, "GET", `${DEPS}/${kept.body.id}`, { session: p.lead.session });
    expect(stillThere.body.dependencyType).toBe(code);
    expect(await rows(p)).toBe(before + 1);
  });

  it("a self-dependency is 422; an initiative of another transformation is 422; From initiative needs its id (400)", async () => {
    const { p, ini } = await world(1);
    const other = await world(1);
    const self = await post(edge(p, ini[0]!, ini[0]!), p.lead.session);
    expect([self.status, self.body.code]).toEqual([422, "dependency.self"]);
    const foreign = await post(edge(p, other.ini[0]!, ini[0]!), p.lead.session);
    expect([foreign.status, foreign.body.code, foreign.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/from/initiativeId",
    ]);
    const noId = await post({ ...edge(p, ini[0]!, ini[0]!), from: { kind: "initiative" } }, p.lead.session);
    expect(noId.status).toBe(400);
  });
});

describe("dependency types (REQ-PB-052)", () => {
  it("the five system types are listed; a system type DELETE is 422 and changes nothing", async () => {
    const p = await setupP2World(api, w);
    const list = await call<Body>(api.app, "GET", TYPES, { session: p.auditor.session });
    expect(list.status).toBe(200);
    const system = list.body.items.filter((t: Body) => t.isSystem).map((t: Body) => [t.code, t.labelEn, t.sourceRef]);
    expect(system).toEqual([
      ["decision", "Decision", "B0081"],
      ["tech", "Tech", "B0081"],
      ["data", "Data", "B0081"],
      ["vendor", "Vendor", "B0081"],
      ["other", "Other", "M0136"],
    ]);
    for (const code of ["decision", "tech", "data", "vendor", "other"]) {
      const res = await call<Body>(api.app, "DELETE", `${TYPES}/${code}`, {
        session: p.methodologyAdmin.session,
        headers: ifm(1),
      });
      expect([res.status, res.body.code], code).toEqual([422, "dependency_type.system_undeletable"]);
    }
    const after = await api.db
      .selectFrom("dependency_type")
      .select(["code", "status", "version"])
      .where("is_system", "=", true)
      .execute();
    expect(after.every((t) => t.status === "active" && t.version === 1)).toBe(true);
  });

  it("add, relabel, retire a custom type: configure only (AUD and TL 403), If-Match 428/409, audited, duplicate 409", async () => {
    const p = await setupP2World(api, w);
    const code = uniq("cu_").toLowerCase();
    const body = { code, labelEn: "Synthetic custom", labelAr: "مخصص اصطناعي" };
    expect((await call(api.app, "POST", TYPES, { session: p.auditor.session, body })).status).toBe(403);
    expect((await call(api.app, "POST", TYPES, { session: p.lead.session, body })).status).toBe(403);
    expect(
      (await call(api.app, "POST", TYPES, { session: p.methodologyAdmin.session, body: { ...body, code: "X" } }))
        .status,
    ).toBe(400);
    const created = await call<Body>(api.app, "POST", TYPES, { session: p.methodologyAdmin.session, body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ code, isSystem: false, status: "active", version: 1, sourceRef: null });
    const dup = await call<Body>(api.app, "POST", TYPES, { session: p.methodologyAdmin.session, body });
    expect([dup.status, dup.body.code]).toEqual([409, "dependency_type.duplicate_code"]);
    const U = `${TYPES}/${code}`;
    expect(
      (await call(api.app, "PATCH", U, { session: p.auditor.session, headers: ifm(1), body: { labelEn: "x" } })).status,
    ).toBe(403);
    expect(
      (await call(api.app, "PATCH", U, { session: p.methodologyAdmin.session, body: { labelEn: "x" } })).status,
    ).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", U, {
      session: p.methodologyAdmin.session,
      headers: ifm(7),
      body: { labelEn: "x" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const relabelled = await call<Body>(api.app, "PATCH", U, {
      session: p.methodologyAdmin.session,
      headers: ifm(1),
      body: { labelEn: "Synthetic custom (renamed)", ordinal: 50 },
    });
    expect([relabelled.status, relabelled.body.labelEn, relabelled.body.version]).toEqual([
      200,
      "Synthetic custom (renamed)",
      2,
    ]);
    expect((await call(api.app, "DELETE", U, { session: p.auditor.session, headers: ifm(2) })).status).toBe(403);
    expect((await call(api.app, "DELETE", U, { session: p.methodologyAdmin.session })).status).toBe(428);
    const retired = await call<Body>(api.app, "DELETE", U, { session: p.methodologyAdmin.session, headers: ifm(2) });
    expect([retired.status, retired.body.status, retired.body.version]).toEqual([200, "retired", 3]);
    const again = await call<Body>(api.app, "DELETE", U, { session: p.methodologyAdmin.session, headers: ifm(3) });
    expect([again.status, again.body.code]).toEqual([422, "dependency_type.already_retired"]);
    const audit = await auditOf(api.db, created.body.id);
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["dependency_type.create", null, 1],
      ["dependency_type.update", 1, 2],
      ["dependency_type.retire", 2, 3],
    ]);
    // The row is never deleted.
    expect(await api.db.selectFrom("dependency_type").select("id").where("code", "=", code).execute()).toHaveLength(1);
  });

  it("commit-time authorisation: a configure grant revoked while the write waits is 403 (audited); nothing written", async () => {
    const admin = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, admin.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const session = await signIn(api.app, admin.subject);
    const code = uniq("ca_").toLowerCase();
    const res = await whileBlocked(
      api,
      "select pg_advisory_xact_lock($1::integer, hashtext($2::text))",
      [DEPENDENCY_TYPE_LOCK_CLASS, code],
      () => call<Body>(api.app, "POST", TYPES, { session, body: { code, labelEn: "Synthetic", labelAr: "اصطناعي" } }),
      async () => {
        await api.owner.query(
          "update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE18A' where user_id = $2 and revoked_at is null",
          [w.grantor.id, admin.id],
        );
      },
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("dependency_type").select("id").where("code", "=", code).execute()).toEqual([]);
    const denied = await api.db
      .selectFrom("audit_event")
      .select(["action"])
      .where("actor_user_id", "=", admin.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toHaveLength(1);
  });
});

describe("cycles (REQ-S09-008, REQ-PB-051)", () => {
  it("A→B→C→A is 422 naming the cycle exactly (ADR-0023 §5); nothing written", async () => {
    const { p, ini } = await world(3, [{ name: "Synthetic A" }, { name: "Synthetic B" }, { name: "Synthetic C" }]);
    const [a, b, c] = ini;
    expect((await post(edge(p, b!, c!), p.lead.session)).status).toBe(201);
    expect((await post(edge(p, c!, a!), p.lead.session)).status).toBe(201);
    const before = await rows(p);
    const res = await post(edge(p, a!, b!), p.lead.session);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      type: "urn:mth:problem:validation",
      code: "dependency.cycle",
      detail: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01",
      errors: [
        {
          pointer: "/toInitiativeId",
          code: "dependency.cycle",
          message: "Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01",
        },
      ],
      cycle: [
        { initiativeId: a!.id, code: "INI-01", name: "Synthetic A" },
        { initiativeId: b!.id, code: "INI-02", name: "Synthetic B" },
        { initiativeId: c!.id, code: "INI-03", name: "Synthetic C" },
        { initiativeId: a!.id, code: "INI-01", name: "Synthetic A" },
      ],
    });
    expect(await rows(p)).toBe(before);
  });

  it("A→B→A is reported the same way ('INI-01 → INI-02 → INI-01'); an archived edge no longer counts", async () => {
    const { p, ini } = await world(2);
    const [a, b] = ini;
    const back = await post(edge(p, b!, a!), p.lead.session);
    expect(back.status).toBe(201);
    const res = await post(edge(p, a!, b!), p.lead.session);
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "dependency.cycle",
      "Dependency cycle: INI-01 → INI-02 → INI-01",
    ]);
    expect(res.body.cycle.map((n: Body) => n.code)).toEqual(["INI-01", "INI-02", "INI-01"]);
    const archived = await call<Body>(api.app, "POST", `${DEPS}/${back.body.id}/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: superseded" },
    });
    expect(archived.status).toBe(200);
    expect((await post(edge(p, a!, b!), p.lead.session)).status).toBe(201);
  });

  it("PATCH re-runs the check when an endpoint changes (422, nothing written); other edits pass", async () => {
    const { p, ini } = await world(3);
    const [a, b, c] = ini;
    const ab = await post(edge(p, a!, b!), p.lead.session);
    const bc = await post(edge(p, b!, c!), p.lead.session);
    const ext = await post(
      { ...edge(p, a!, a!), from: { kind: "external", label: "Synthetic regulator" }, toInitiativeId: c!.id },
      p.lead.session,
    );
    expect([ab.status, bc.status, ext.status]).toEqual([201, 201, 201]);
    // Turning the external dependency into C→A closes A→B→C→A.
    const res = await call<Body>(api.app, "PATCH", `${DEPS}/${ext.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { from: { kind: "initiative", initiativeId: c!.id }, toInitiativeId: a!.id },
    });
    expect([res.status, res.body.detail]).toEqual([422, "Dependency cycle: INI-03 → INI-01 → INI-02 → INI-03"]);
    const unchanged = await api.db
      .selectFrom("dependency")
      .select(["version", "from_kind"])
      .where("id", "=", ext.body.id)
      .executeTakeFirstOrThrow();
    expect(unchanged).toEqual({ version: 1, from_kind: "external" });
    const ok = await call<Body>(api.app, "PATCH", `${DEPS}/${ab.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { status: "at_risk", mitigation: "Synthetic mitigation", dependencyType: "decision" },
    });
    expect([ok.status, ok.body.version, ok.body.status, ok.body.dependencyType]).toEqual([
      200,
      2,
      "at_risk",
      "decision",
    ]);
    expect((await auditOf(api.db, ab.body.id)).map((e) => e.action)).toEqual([
      "dependency.create",
      "dependency.update",
    ]);
  });

  it("two API requests A→B and B→A at once: exactly one commits, the other is 422 dependency.cycle", async () => {
    const { p, ini } = await world(2);
    const [a, b] = ini;
    // Hold the graph lock so both requests are in flight together, then let them race for it.
    const [r1, r2] = await whileBlocked(
      api,
      "select pg_advisory_xact_lock($1::integer, hashtext($2::text))",
      [DEPENDENCY_GRAPH_LOCK_CLASS, p.transformationId],
      () => Promise.all([post(edge(p, a!, b!), p.lead.session), post(edge(p, b!, a!), p.contributor.session)]),
      async () => {
        // Both are queued on the lock before it is released.
        for (let i = 0; i < 300; i++) {
          const n = (
            await api.owner.query<{ n: number }>(
              "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and not granted",
              [DEPENDENCY_GRAPH_LOCK_CLASS],
            )
          ).rows[0]!.n;
          if (n >= 2) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("the two requests never queued on the graph lock");
      },
    );
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    const loser = r1.status === 422 ? r1 : r2;
    expect(loser.body.code).toBe("dependency.cycle");
    expect(await rows(p)).toBe(1);
  });

  it("two DATABASE connections inserting A→B and B→A concurrently: exactly one commits (dependency_acyclic)", async () => {
    const { p, ini } = await world(2);
    const [a, b] = ini;
    const org = w.orgA.id;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let firstInserted!: () => void;
    const inserted = new Promise<void>((r) => (firstInserted = r));
    const write = (from: SyntheticInitiative, to: SyntheticInitiative, code: string, hold: boolean) =>
      api.db.transaction().execute(async (tx) => {
        const id = uuidv7();
        await tx
          .insertInto("dependency")
          .values({
            id,
            organization_id: org,
            transformation_id: p.transformationId,
            code,
            description: `Synthetic raw ${code}`,
            from_kind: "initiative",
            from_initiative_id: from.id,
            to_kind: "initiative",
            to_initiative_id: to.id,
            dependency_type: "tech",
            created_by: p.lead.id,
            updated_by: p.lead.id,
          })
          .execute();
        await record(
          tx,
          { actorUserId: p.lead.id, requestId: `race-${id}` },
          {
            action: "dependency.create",
            recordType: "dependency",
            recordId: id,
            organizationId: org,
            transformationId: p.transformationId,
            newVersion: 1,
            changes: { code: { from: null, to: code } },
          },
        );
        if (hold) {
          firstInserted();
          await gate;
        }
        return id;
      });
    const first = write(a!, b!, "DEP-91", true);
    await inserted; // connection 1 holds the graph lock (taken by the guard) with A→B uncommitted
    const second = write(b!, a!, "DEP-92", false).then(
      (id) => ({ ok: true as const, id }),
      (err: { code?: string; constraint?: string; message?: string }) => ({ ok: false as const, err }),
    );
    // Connection 2 waits on the same lock until connection 1 commits.
    for (let i = 0; i < 300; i++) {
      const n = (
        await api.owner.query<{ n: number }>(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1 and not granted",
          [DEPENDENCY_GRAPH_LOCK_CLASS],
        )
      ).rows[0]!.n;
      if (n >= 1) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    release();
    await first;
    const outcome = await second;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err.code).toBe("23514");
      expect(outcome.err.constraint).toBe("dependency_acyclic");
      expect(outcome.err.message).toBe("dependency cycle: INI-02 -> INI-01 -> INI-02");
    }
    expect(await rows(p)).toBe(1);
  });

  it("findCycle (the friendly search) agrees with the database's shortest cycle", () => {
    expect(
      findCycle(
        [
          { from: "b", to: "c" },
          { from: "c", to: "a" },
        ],
        "a",
        "b",
      ),
    ).toEqual(["a", "b", "c", "a"]);
    expect(findCycle([{ from: "b", to: "a" }], "a", "b")).toEqual(["a", "b", "a"]);
    expect(findCycle([{ from: "a", to: "b" }], "a", "c")).toBeNull();
  });
});

describe("authorisation, concurrency and audit of every T08 mutation", () => {
  it("AUD 403 on create, update, archive (audited as authorization.denied); 428/409 on update and archive", async () => {
    const { p, ini } = await world(2);
    const [a, b] = ini;
    const created = await post(edge(p, a!, b!), p.lead.session);
    expect(created.status).toBe(201);
    const U = `${DEPS}/${created.body.id}`;
    expect((await post(edge(p, b!, a!), p.auditor.session)).status).toBe(403);
    expect(
      (await call(api.app, "PATCH", U, { session: p.auditor.session, headers: ifm(1), body: { mitigation: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "POST", `${U}/archive`, {
          session: p.auditor.session,
          headers: ifm(1),
          body: { reason: "xyz" },
        })
      ).status,
    ).toBe(403);
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", p.auditor.id)
      .where("action", "=", "authorization.denied")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(denied.length).toBeGreaterThanOrEqual(3);
    expect(
      (await call(api.app, "PATCH", U, { session: p.lead.session, body: { mitigation: "Synthetic" } })).status,
    ).toBe(428);
    const stale = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(4),
      body: { mitigation: "Synthetic" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect(
      (await call(api.app, "POST", `${U}/archive`, { session: p.lead.session, body: { reason: "Synthetic" } })).status,
    ).toBe(428);
    const archived = await call<Body>(api.app, "POST", `${U}/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: dropped" },
    });
    expect([archived.status, archived.body.status, archived.body.archiveReason]).toEqual([
      200,
      "archived",
      "Synthetic: dropped",
    ]);
    expect((await auditOf(api.db, created.body.id)).map((e) => [e.action, e.reason])).toEqual([
      ["dependency.create", null],
      ["dependency.archive", "Synthetic: dropped"],
    ]);
    // Archived: read-only, and hidden from the default list.
    const after = await call<Body>(api.app, "PATCH", U, {
      session: p.lead.session,
      headers: ifm(2),
      body: { mitigation: "x" },
    });
    expect([after.status, after.body.code]).toEqual([422, "record.archived"]);
    const list = await call<Body>(api.app, "GET", `${DEPS}?transformationId=${p.transformationId}`, {
      session: p.lead.session,
    });
    expect(list.body.items).toEqual([]);
    const all = await call<Body>(
      api.app,
      "GET",
      `${DEPS}?transformationId=${p.transformationId}&includeArchived=true`,
      {
        session: p.lead.session,
      },
    );
    expect(all.body.items).toHaveLength(1);
  });

  it("commit-time authorisation: a grant revoked while the create waits for the graph lock is 403; nothing written", async () => {
    const { p, ini } = await world(2);
    const wl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, wl.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const session = await signIn(api.app, wl.subject);
    const res = await whileBlocked(
      api,
      "select pg_advisory_xact_lock($1::integer, hashtext($2::text))",
      [DEPENDENCY_GRAPH_LOCK_CLASS, p.transformationId],
      () => post(edge(p, ini[0]!, ini[1]!), session),
      async () => {
        await api.owner.query(
          "update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE18A' where user_id = $2 and revoked_at is null",
          [w.grantor.id, wl.id],
        );
      },
    );
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect(await rows(p)).toBe(0);
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", wl.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toHaveLength(1);
  });

  it("commit-time authorisation on update and archive: the row lock wait, then 403 on reloaded grants", async () => {
    const { p, ini } = await world(2);
    const created = await post(edge(p, ini[0]!, ini[1]!), p.lead.session);
    for (const [method, suffix, body] of [
      ["PATCH", "", { mitigation: "Synthetic" }],
      ["POST", "/archive", { reason: "Synthetic" }],
    ] as const) {
      const wl = await createUser(api.db, w.orgA.id);
      await grant(api.db, w.grantor.id, wl.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
      const session = await signIn(api.app, wl.subject);
      const res = await whileBlocked(
        api,
        "select id from dependency where id = $1 for update",
        [created.body.id],
        () => call<Body>(api.app, method, `${DEPS}/${created.body.id}${suffix}`, { session, headers: ifm(1), body }),
        async () => {
          await api.owner.query(
            "update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE18A' where user_id = $2 and revoked_at is null",
            [w.grantor.id, wl.id],
          );
        },
      );
      expect(res.status, `${method} ${suffix}`).toBe(403);
    }
    const row = await api.db
      .selectFrom("dependency")
      .select("version")
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
  });
});

describe("schedule flags on T08 (ADR-0023 §5)", () => {
  it("a predecessor finishing after the needed-by date is flagged; moving its milestone earlier clears it", async () => {
    const { p, ini } = await world(2, [{ plannedEnd: "2026-05-31" }, { plannedStart: "2026-09-01" }]);
    const [a, b] = ini;
    const dep = await post(edge(p, a!, b!, { neededBy: "2026-06-15" }), p.lead.session);
    expect([dep.status, dep.body.flags]).toEqual([201, []]);
    const ms = await call<Body>(api.app, "POST", `/api/v1/initiatives/${a!.id}/milestones`, {
      session: p.lead.session,
      body: { title: "Synthetic go-live", forecastDate: "2026-07-10" },
    });
    expect(ms.status).toBe(201);
    const flagged = await call<Body>(api.app, "GET", `${DEPS}/${dep.body.id}`, { session: p.auditor.session });
    expect(flagged.body.flags).toEqual([
      {
        code: "schedule.needed_by_conflict",
        message: "INI-01 finishes after INI-02 needs it (2026-06-15)",
        dependencyId: dep.body.id,
        initiativeId: b!.id,
      },
    ]);
    const moved = await call<Body>(api.app, "PATCH", `/api/v1/milestones/${ms.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { forecastDate: "2026-06-01" },
    });
    expect(moved.status).toBe(200);
    const cleared = await call<Body>(api.app, "GET", `${DEPS}/${dep.body.id}`, { session: p.auditor.session });
    expect(cleared.body.flags).toEqual([]);
  });

  it("missing dates are schedule.unknown, never an empty (no conflict) list", async () => {
    const { p, ini } = await world(2);
    const dep = await post(edge(p, ini[0]!, ini[1]!), p.lead.session);
    expect(dep.body.flags.map((f: Body) => f.code)).toEqual(["schedule.unknown"]);
  });
});

describe("the DG2 paths stay stable (ADR-0023 §4)", () => {
  it("a custom type is shown as 'other' on the DG2 path; a DG2 PATCH of the kinds is 422 dependency.managed_by_t08", async () => {
    const { p, ini } = await world(2);
    const code = uniq("dg_").toLowerCase();
    expect(
      (
        await call(api.app, "POST", TYPES, {
          session: p.methodologyAdmin.session,
          body: { code, labelEn: "Synthetic DG2 projection", labelAr: "إسقاط اصطناعي" },
        })
      ).status,
    ).toBe(201);
    const dep = await post(edge(p, ini[0]!, ini[1]!, { dependencyType: code }), p.lead.session);
    expect(dep.status).toBe(201);
    const DG2 = `/api/v1/transformations/${p.transformationId}/dependencies/${dep.body.id}`;
    const dg2 = await call<Body>(api.app, "GET", DG2, { session: p.lead.session });
    expect([dg2.status, dg2.body.dependencyType, dg2.body.toKind]).toEqual([200, "other", "initiative"]);
    expect(Object.keys(dg2.body)).not.toContain("toInitiativeId");
    const kinds = await call<Body>(api.app, "PATCH", DG2, {
      session: p.lead.session,
      headers: ifm(1),
      body: { toKind: "external", toLabel: "Synthetic" },
    });
    expect([kinds.status, kinds.body.code, kinds.body.errors[0].pointer]).toEqual([
      422,
      "dependency.managed_by_t08",
      "/toKind",
    ]);
    // Other DG2 edits of the same row still work and keep the T08 endpoints.
    const desc = await call<Body>(api.app, "PATCH", DG2, {
      session: p.lead.session,
      headers: ifm(1),
      body: { description: "Synthetic: edited on the DG2 path" },
    });
    expect([desc.status, desc.body.dependencyType]).toEqual([200, "other"]);
    const t08 = await call<Body>(api.app, "GET", `${DEPS}/${dep.body.id}`, { session: p.lead.session });
    expect([t08.body.dependencyType, t08.body.toInitiativeId, t08.body.version]).toEqual([code, ini[1]!.id, 2]);
  });
});
