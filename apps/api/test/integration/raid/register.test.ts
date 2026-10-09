// The T15 RAID register (T-DG4-BE-D; ADR-0031 §1, §3, §9-§11; REQ-PB-079, REQ-PB-080, REQ-S16-018 Risk/Assumption/
// Issue). Proves, against the run's disposable PostgreSQL:
//  - REQ-PB-079 A01 "T15 persists all 9 columns": ID, Type, Description, Impact, Probability, Owner, Due, Mitigation /
//    action, Status persist on create and read back unchanged (API and row); codes R-01, A-01, I-01;
//  - REQ-PB-079 A01 "Type outside Risk/Assumption/Issue/Dependency is rejected": 400 raid.type_invalid at /type with the
//    ADR-0031 §3 text; nothing written;
//  - REQ-PB-080 A01 "an Issue with Probability H is rejected; a Risk without Probability is rejected": 422
//    raid.probability_not_applicable / raid.probability_required with the exact §11 texts, on create and on update;
//  - the state machine: Open <-> In progress; Close with a note, final (422 raid.closed); raid.status_transition;
//  - every mutation: AUD 403, a role without raid.edit 403, ADM-only 404 (and on every read), If-Match 428/409, one
//    audit event per change, the write authorised again at commit time;
//  - the integrated RAID + decision log (B0126): open entries and open design decisions from their canonical rows.
// All data is SYNTHETIC; closing an entry is an operational change, never a business approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
type Extra = Awaited<ReturnType<typeof extraUser>>;
let wl: Extra;
let to: Extra;
let R: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  to = await extraUser(api, w, b, "TO");
  R = `${b.base}/raid`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const PROBABILITY_REQUIRED = "A Risk needs a Probability (High, Medium or Low).";
const PROBABILITY_NA = "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty.";
const CLOSED = "This RAID entry is closed and can no longer be changed.";

const riskBody = (extra: Record<string, unknown> = {}) => ({
  type: "risk",
  description: "Synthetic vendor delay on the billing platform",
  impact: "high",
  probability: "medium",
  ownerUserId: wl.id,
  dueDate: "2026-12-15",
  mitigation: "Synthetic: qualify a second supplier",
  ...extra,
});

const create = async (body: Record<string, unknown>, session = b.s.tl) => {
  const r = await call(api.app, "POST", R, { session, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number };
};
const entryCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("raid_entry")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", b.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("T15 RAID register: the nine columns and the Type rule (REQ-PB-079)", () => {
  it("a Risk persists all nine T15 columns on create and read; Status is Open; ID R-nn", async () => {
    const created = await call(api.app, "POST", R, { session: wl.session, body: riskBody() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(created.headers.location).toBe(`${R}/${created.body.id}`);
    const read = await call(api.app, "GET", `${R}/${created.body.id}`, { session: b.s.auditor });
    expect(read.status).toBe(200);
    // ID | Type | Description | Impact | Probability | Owner | Due | Mitigation / action | Status (B0128).
    expect([
      read.body.code,
      read.body.type,
      read.body.description,
      read.body.impact,
      read.body.probability,
      read.body.ownerUserId,
      read.body.dueDate,
      read.body.mitigation,
      read.body.status,
    ]).toEqual([
      expect.stringMatching(/^R-[0-9]{2,6}$/),
      "risk",
      "Synthetic vendor delay on the billing platform",
      "high",
      "medium",
      wl.id,
      "2026-12-15",
      "Synthetic: qualify a second supplier",
      "open",
    ]);
    expect([read.body.recordTable, read.body.recordStatus, read.body.version]).toEqual(["raid_entry", "open", 1]);
    const row = await api.db
      .selectFrom("raid_entry")
      .selectAll()
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect([
      row.code,
      row.entry_type,
      row.description,
      row.impact,
      row.probability,
      row.owner_user_id,
      row.due_date,
      row.mitigation,
      row.status,
    ]).toEqual([
      read.body.code,
      "risk",
      read.body.description,
      "high",
      "medium",
      wl.id,
      "2026-12-15",
      read.body.mitigation,
      "open",
    ]);
    expect((await auditOf(api.db, created.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["raid_entry.create", 1],
    ]);
  });

  it("Assumption and Issue entries get A-nn and I-nn, Probability n/a (null), Status Open", async () => {
    const a = await create({
      type: "assumption",
      description: "Synthetic: the data team stays at 6 FTE",
      impact: "medium",
      ownerUserId: to.id,
    });
    const i = await create({
      type: "issue",
      description: "Synthetic: test rig broken",
      impact: "low",
      ownerUserId: to.id,
    });
    expect(a.code).toMatch(/^A-[0-9]{2,6}$/);
    expect(i.code).toMatch(/^I-[0-9]{2,6}$/);
    for (const id of [a.id, i.id]) {
      const r = await call(api.app, "GET", `${R}/${id}`, { session: b.s.auditor });
      expect([r.body.probability, r.body.status, r.body.dueDate, r.body.mitigation]).toEqual([
        null,
        "open",
        null,
        null,
      ]);
    }
  });

  it("a Type outside Risk/Assumption/Issue/Dependency is 400 raid.type_invalid at /type; nothing written", async () => {
    const before = await entryCount();
    for (const type of ["opportunity", "Risk", "", 7, null]) {
      const r = await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ type }) });
      expect([r.status, r.body.type, r.body.errors]).toEqual([
        400,
        "urn:mth:problem:validation",
        [
          {
            pointer: "/type",
            code: "raid.type_invalid",
            message: "Type must be Risk, Assumption, Issue or Dependency.",
          },
        ],
      ]);
    }
    expect(await entryCount()).toBe(before);
  });

  it("an unknown field, an Impact outside H/M/L or a blank description is 400; endpoints only on a Dependency", async () => {
    expect((await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ extra: 1 }) })).status).toBe(400);
    expect((await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ impact: "critical" }) })).status).toBe(
      400,
    );
    expect((await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ description: "   " }) })).status).toBe(
      400,
    );
    const ep = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: riskBody({ dependencyType: "tech" }),
    });
    expect([ep.status, ep.body.errors[0].pointer, ep.body.errors[0].code]).toEqual([
      400,
      "/dependencyType",
      "validation.not_applicable",
    ]);
  });
});

describe("T15 Probability (REQ-PB-080)", () => {
  it("an Issue (or an Assumption) with Probability H is 422 raid.probability_not_applicable; nothing written", async () => {
    const before = await entryCount();
    for (const type of ["issue", "assumption"]) {
      const r = await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ type, probability: "high" }) });
      expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
        422,
        "raid.probability_not_applicable",
        PROBABILITY_NA,
        "/probability",
      ]);
    }
    expect(await entryCount()).toBe(before);
  });

  it("a Risk without Probability (absent or null) is 422 raid.probability_required; nothing written", async () => {
    const before = await entryCount();
    const { probability: _omit, ...noProbability } = riskBody();
    for (const body of [noProbability, riskBody({ probability: null })]) {
      const r = await call(api.app, "POST", R, { session: b.s.tl, body });
      expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
        422,
        "raid.probability_required",
        PROBABILITY_REQUIRED,
        "/probability",
      ]);
    }
    expect(await entryCount()).toBe(before);
  });

  it("the same rules on update: a Risk cannot lose its Probability, an Issue cannot get one", async () => {
    const risk = await create(riskBody());
    const issue = await create({ type: "issue", description: "Synthetic outage", impact: "high", ownerUserId: wl.id });
    const r1 = await call(api.app, "PATCH", `${R}/${risk.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { probability: null },
    });
    expect([r1.status, r1.body.code]).toEqual([422, "raid.probability_required"]);
    const r2 = await call(api.app, "PATCH", `${R}/${issue.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { probability: "high" },
    });
    expect([r2.status, r2.body.code]).toEqual([422, "raid.probability_not_applicable"]);
    const ok = await call(api.app, "PATCH", `${R}/${risk.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { probability: "low" },
    });
    expect([ok.status, ok.body.probability, ok.body.version]).toEqual([200, "low", 2]);
  });
});

describe("state machine and closure (ADR-0031 §1)", () => {
  it("Open <-> In progress by update; Close with a note is final (422 raid.closed); one audit event per change", async () => {
    const e = await create(riskBody());
    const I = `${R}/${e.id}`;
    const toIp = await call(api.app, "PATCH", I, {
      session: to.session,
      headers: ifm(1),
      body: { status: "in_progress" },
    });
    expect([toIp.status, toIp.body.status, toIp.headers.etag]).toEqual([200, "in_progress", '"2"']);
    const back = await call(api.app, "PATCH", I, { session: to.session, headers: ifm(2), body: { status: "open" } });
    expect([back.status, back.body.status]).toEqual([200, "open"]);
    // Closing is not an update status (400: outside the update enum).
    expect(
      (await call(api.app, "PATCH", I, { session: to.session, headers: ifm(3), body: { status: "closed" } })).status,
    ).toBe(400);
    // A closure note of 3-2000 characters.
    expect(
      (await call(api.app, "POST", `${I}/close`, { session: to.session, headers: ifm(3), body: { closureNote: "ok" } }))
        .status,
    ).toBe(400);
    const closed = await call(api.app, "POST", `${I}/close`, {
      session: to.session,
      headers: ifm(3),
      body: { closureNote: "Synthetic: second supplier qualified" },
    });
    expect([closed.status, closed.body.status, closed.body.closedBy, closed.body.closureNote]).toEqual([
      200,
      "closed",
      to.id,
      "Synthetic: second supplier qualified",
    ]);
    expect(closed.body.closedAt).toEqual(expect.any(String));
    const edit = await call(api.app, "PATCH", I, { session: to.session, headers: ifm(4), body: { impact: "low" } });
    expect([edit.status, edit.body.code, edit.body.detail]).toEqual([422, "raid.closed", CLOSED]);
    const reclose = await call(api.app, "POST", `${I}/close`, {
      session: to.session,
      headers: ifm(4),
      body: { closureNote: "Again" },
    });
    expect([reclose.status, reclose.body.code]).toEqual([422, "raid.closed"]);
    const audit = await auditOf(api.db, e.id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["raid_entry.create", null, 1],
      ["raid_entry.update", 1, 2],
      ["raid_entry.update", 2, 3],
      ["raid_entry.close", 3, 4],
    ]);
    expect(audit[3]!.reason).toBe("Synthetic: second supplier qualified");
  });
});

describe("authorization, concurrency and commit-time checks (S-4; ADR-0031 §9)", () => {
  it("AUD and a role without raid.edit (BO) get 403 on every write whatever the body; nothing written", async () => {
    const e = await create(riskBody());
    const before = await entryCount();
    for (const session of [b.s.auditor, b.s.bo, b.s.fin]) {
      expect((await call(api.app, "POST", R, { session, body: riskBody() })).status).toBe(403);
      expect((await call(api.app, "POST", R, { session, body: { type: "opportunity" } })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${R}/${e.id}`, { session, headers: ifm(1), body: { impact: "low" } })).status,
      ).toBe(403);
      expect(
        (await call(api.app, "POST", `${R}/${e.id}/close`, { session, headers: ifm(1), body: { closureNote: "No" } }))
          .status,
      ).toBe(403);
    }
    expect(await entryCount()).toBe(before);
    expect((await auditOf(api.db, e.id)).length).toBe(1);
  });

  it("an ADM-only user and an outsider get 404 on every RAID operation (non-disclosure)", async () => {
    const e = await create(riskBody());
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "GET", R, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${R}/${e.id}`, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${b.base}/raid-decision-log`, { session })).status).toBe(404);
      expect((await call(api.app, "POST", R, { session, body: riskBody() })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${R}/${e.id}`, { session, headers: ifm(1), body: { impact: "low" } })).status,
      ).toBe(404);
      expect(
        (await call(api.app, "POST", `${R}/${e.id}/close`, { session, headers: ifm(1), body: { closureNote: "No" } }))
          .status,
      ).toBe(404);
    }
  });

  it("If-Match: missing 428, stale 409 with currentVersion; an unknown entry 404", async () => {
    const e = await create(riskBody());
    const I = `${R}/${e.id}`;
    expect((await call(api.app, "PATCH", I, { session: b.s.tl, body: { impact: "low" } })).status).toBe(428);
    const stale = await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(5), body: { impact: "low" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect(
      (await call(api.app, "POST", `${I}/close`, { session: b.s.tl, body: { closureNote: "Synthetic" } })).status,
    ).toBe(428);
    expect(
      (
        await call(api.app, "POST", `${I}/close`, {
          session: b.s.tl,
          headers: ifm(2),
          body: { closureNote: "Synthetic" },
        })
      ).status,
    ).toBe(409);
    const unknown = `${R}/0192aaaa-0000-7000-8000-000000000001`;
    expect((await call(api.app, "GET", unknown, { session: b.s.auditor })).status).toBe(404);
    expect(
      (await call(api.app, "PATCH", unknown, { session: b.s.tl, headers: ifm(1), body: { impact: "low" } })).status,
    ).toBe(404);
  });

  it("an owner who is not an active user of the organization is 422; an initiative of another transformation 422", async () => {
    const r1 = await call(api.app, "POST", R, { session: b.s.tl, body: riskBody({ ownerUserId: w.officeB.id }) });
    expect([r1.status, r1.body.code]).toEqual([422, "validation.user_invalid"]);
    const r2 = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: riskBody({ initiativeId: "0192aaaa-0000-7000-8000-000000000002" }),
    });
    expect([r2.status, r2.body.code]).toEqual([422, "validation.reference"]);
    const ini = await insertInitiative(api.db, b);
    const ok = await create(riskBody({ initiativeId: ini }));
    expect((await call(api.app, "GET", `${R}/${ok.id}`, { session: b.s.auditor })).body.initiativeId).toBe(ini);
  });

  it("commit-time: raid.edit revoked while the create or the update waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, b, "TL");
    const before = await entryCount();
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", R, { session: u.session, body: riskBody(), contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await entryCount()).toBe(before);

    const e = await create(riskBody());
    const u2 = await extraUser(api, w, b, "WL");
    const upd = await afterIdentity(
      api,
      u2.id,
      () =>
        call(api.app, "PATCH", `${R}/${e.id}`, {
          session: u2.session,
          headers: ifm(1),
          body: { impact: "low" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u2.id),
    );
    expect(upd.status).toBe(403);
    const row = await api.db
      .selectFrom("raid_entry")
      .select(["impact", "version"])
      .where("id", "=", e.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ impact: "high", version: 1 });
  });
});

describe("list filters, pagination and the integrated RAID + decision log (REQ-PB-078, B0126)", () => {
  it("filters by type, status and owner; cursor pagination visits every row once", async () => {
    const mine = await extraUser(api, w, b, "WL");
    const e1 = await create(riskBody({ ownerUserId: mine.id }));
    const e2 = await create({ type: "issue", description: "Synthetic", impact: "low", ownerUserId: mine.id });
    await call(api.app, "PATCH", `${R}/${e2.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "in_progress" },
    });
    const byOwner = await call(api.app, "GET", `${R}?ownerUserId=${mine.id}`, { session: b.s.auditor });
    expect(byOwner.body.items.map((x: { id: string }) => x.id).sort()).toEqual([e1.id, e2.id].sort());
    const issues = await call(api.app, "GET", `${R}?ownerUserId=${mine.id}&type=issue&status=in_progress`, {
      session: b.s.auditor,
    });
    expect(issues.body.items.map((x: { id: string }) => x.id)).toEqual([e2.id]);
    expect((await call(api.app, "GET", `${R}?type=opportunity`, { session: b.s.auditor })).status).toBe(400);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor === null ? "limit=2" : `limit=2&cursor=${encodeURIComponent(cursor)}`;
      const p = await call(api.app, "GET", `${R}?${qs}`, { session: b.s.auditor });
      expect(p.status).toBe(200);
      seen.push(...p.body.items.map((x: { id: string }) => x.id));
      cursor = p.body.nextCursor;
    } while (cursor !== null);
    const all = await call(api.app, "GET", `${R}?limit=100`, { session: b.s.auditor });
    expect(seen).toEqual(all.body.items.map((x: { id: string }) => x.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("lists open RAID entries and open design decisions from their canonical rows; closed ones drop out", async () => {
    const open = await create(riskBody({ description: "Synthetic open risk for the log" }));
    const shut = await create(riskBody({ description: "Synthetic closed risk" }));
    await call(api.app, "POST", `${R}/${shut.id}/close`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { closureNote: "Synthetic closure" },
    });
    const decision = await call(api.app, "POST", "/api/v1/decisions", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        title: "Synthetic design decision: billing stack",
        ownerUserId: wl.id,
      },
    });
    expect(decision.status, JSON.stringify(decision.body)).toBe(201);
    const log = await call(api.app, "GET", `${b.base}/raid-decision-log?limit=100`, { session: b.s.auditor });
    expect(log.status).toBe(200);
    const byId = new Map(log.body.items.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(open.id)).toEqual({
      itemKind: "raid_entry",
      id: open.id,
      code: open.code,
      kind: "risk",
      title: "Synthetic open risk for the log",
      ownerUserId: wl.id,
      dueDate: "2026-12-15",
      status: "open",
    });
    expect(byId.has(shut.id)).toBe(false);
    expect(byId.get(decision.body.id)).toMatchObject({
      itemKind: "decision",
      code: decision.body.code,
      kind: "design",
      title: "Synthetic design decision: billing stack",
      status: "open",
    });
  });
});
