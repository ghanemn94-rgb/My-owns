// Resource roles, capacity, resource demand and the capacity plan (ADR-0023 §6; REQ-PB-059, REQ-S09-004,
// REQ-S16-016; T-DG3-BE-E) against a real PostgreSQL:
//  - THE CONFLICT RULE: demand (planned + committed of initiatives not cancelled/completed) > available ->
//    capacity.over_allocated with the decimal shortfall; no capacity row -> capacity.unknown (available and shortfall
//    null, never 0, never "no conflict"); FTE is a decimal string end to end;
//  - the flags reach the initiative representation and the prioritization view;
//  - every mutation: validation (400), AUD 403, positive and negative authorization (capacity.edit / capacity.commit),
//    authorization re-checked at commit (BE18A), If-Match 428/409, one audit event; the demand transitions and their 422s;
//  - a cancelled initiative's demand is read-only (422 initiative.read_only).
// All data is SYNTHETIC. Committing demand is a resourcing commitment, not a business approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";
import { selectedInitiative } from "../contract/p3-exercises-be-e.ts";
import { cancelInitiative } from "../contract/p3-exercises-be-d.ts";
import { revokedAfterIdentity } from "./be18a.ts";
import { setGateStatus } from "./fixtures.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 600)}`).toBe(status);
  return res.body;
};
const actions = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);

const T = (p: P2World) => `/api/v1/transformations/${p.transformationId}`;

async function role(p: P2World, code: string, labelEn = `Synthetic ${code}`) {
  return ok(
    await send("POST", `${T(p)}/resource-roles`, { session: p.lead.session, body: { code, labelEn, labelAr: "دور" } }),
    201,
    "role",
  );
}
async function capacityRow(p: P2World, resourceRoleId: string, periodMonth: string, availableFte: string) {
  return ok(
    await send("POST", "/api/v1/capacity", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, resourceRoleId, periodMonth, availableFte },
    }),
    201,
    "capacity",
  );
}
async function demand(
  p: P2World,
  initiativeId: string,
  resourceRoleId: string,
  periodMonth: string,
  demandFte: string,
) {
  return ok(
    await send("POST", "/api/v1/resource-demands", {
      session: p.lead.session,
      body: { initiativeId, resourceRoleId, periodMonth, demandFte },
    }),
    201,
    "demand",
  );
}
async function commit(p: P2World, id: string, v: number, session: Session = p.office.session) {
  return send("POST", `/api/v1/resource-demands/${id}/commit`, { session, headers: ifm(v), body: {} });
}

describe("the conflict rule (ADR-0023 §6)", () => {
  it("over-allocated with the decimal shortfall; Unknown without a capacity row; a cancelled initiative's demand does not count", async () => {
    const p = await setupP2World(api, w);
    const r = await role(p, "data_engineer", "Data engineer");
    const a = await createInitiative(send, p, { name: "Synthetic A" });
    const b = await createInitiative(send, p, { name: "Synthetic B" });
    const c = await createInitiative(send, p, { name: "Synthetic C" });
    await capacityRow(p, r.id, "2027-01-01", "2.00");
    await capacityRow(p, r.id, "2027-03-01", "1.00");
    await demand(p, a.id, r.id, "2027-01-01", "1.50");
    const dB = await demand(p, b.id, r.id, "2027-01-01", "1.00");
    ok(await commit(p, dB.id, 1), 200, "commit B");
    await demand(p, a.id, r.id, "2027-02-01", "0.75"); // no capacity row in February
    await demand(p, c.id, r.id, "2027-03-01", "5.00"); // C is cancelled below: does not count
    await cancelInitiative(api, c.id, p.lead.id);

    const plan = ok(await send("GET", `${T(p)}/capacity-plan`, { session: p.auditor.session }), 200, "plan");
    expect(plan.roles.map((x: Body) => x.code)).toEqual(["data_engineer"]);
    expect(plan.cells).toEqual([
      {
        resourceRoleId: r.id,
        periodMonth: "2027-01-01",
        availableFte: "2.00",
        demandFte: "2.50",
        committedDemandFte: "1.00",
        shortfallFte: "0.50",
        flag: "capacity.over_allocated",
      },
      {
        resourceRoleId: r.id,
        periodMonth: "2027-02-01",
        availableFte: null,
        demandFte: "0.75",
        committedDemandFte: "0.00",
        shortfallFte: null,
        flag: "capacity.unknown",
      },
      {
        resourceRoleId: r.id,
        periodMonth: "2027-03-01",
        availableFte: "1.00",
        demandFte: "0.00",
        committedDemandFte: "0.00",
        shortfallFte: "0.00",
        flag: null,
      },
    ]);
    // from/to bound the months (a date selects its month).
    const feb = ok(
      await send("GET", `${T(p)}/capacity-plan?from=2027-02-15&to=2027-02-28`, { session: p.lead.session }),
      200,
      "range",
    );
    expect(feb.cells.map((x: Body) => [x.periodMonth, x.flag])).toEqual([["2027-02-01", "capacity.unknown"]]);
    expect((await send("GET", `${T(p)}/capacity-plan?from=2027-02-30`, { session: p.lead.session })).status).toBe(400);

    // The flags reach the initiative representation (one presenter) - warnings, never rejections.
    const iniA = ok(await send("GET", `/api/v1/initiatives/${a.id}`, { session: p.lead.session }), 200, "A");
    expect(iniA.flags).toEqual([
      {
        code: "capacity.over_allocated",
        message:
          "Capacity over-allocated: Data engineer 2027-01 (demand 2.50 FTE, available 2.00 FTE, shortfall 0.50 FTE)",
        initiativeId: a.id,
      },
      {
        code: "capacity.unknown",
        message: "Capacity unknown: Data engineer 2027-02 (no capacity recorded)",
        initiativeId: a.id,
      },
    ]);
    // Raising the capacity clears the over-allocation; Unknown stays Unknown.
    const jan = ok(
      await send("GET", `/api/v1/capacity?transformationId=${p.transformationId}&resourceRoleId=${r.id}`, {
        session: p.lead.session,
      }),
      200,
      "list",
    ).items[0];
    ok(
      await send("PATCH", `/api/v1/capacity/${jan.id}`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { availableFte: "2.50" },
      }),
      200,
      "raise",
    );
    const after = ok(await send("GET", `/api/v1/initiatives/${a.id}`, { session: p.lead.session }), 200, "A2");
    expect(after.flags.map((f: Body) => f.code)).toEqual(["capacity.unknown"]);
  });

  it("the prioritization view carries the capacity flags (DEFAULT_FLAG_SOURCES wired), on the item and its initiative", async () => {
    const p = await setupP2World(api, w);
    await setGateStatus(api, p, "G1", "approved");
    const r = await role(p, "analyst", "Analyst");
    const id = await selectedInitiative(api, send, p);
    await demand(p, id, r.id, "2027-05-01", "1.00"); // no capacity row: Unknown
    const view = ok(await send("GET", `${T(p)}/prioritization`, { session: p.auditor.session }), 200, "view");
    const item = view.items.find((i: Body) => i.initiative.id === id);
    const expected = [
      {
        code: "capacity.unknown",
        message: "Capacity unknown: Analyst 2027-05 (no capacity recorded)",
        initiativeId: id,
      },
    ];
    expect(item.flags).toEqual(expected);
    expect(item.initiative.flags).toEqual(expected);
    // The one presenter: the i18n key, never English text (p3-work-split §9 item 13).
    expect(item.initiative.displayStatus).toBe("initiative.status.selected_unfunded");
    const filtered = ok(
      await send("GET", `${T(p)}/prioritization?flag=capacity.unknown`, { session: p.auditor.session }),
      200,
      "filtered",
    );
    expect(filtered.items.map((i: Body) => i.initiative.id)).toEqual([id]);
  });
});

describe("validation, authorization, If-Match and audit of every capacity mutation", () => {
  it("roles: create/update with 400, 403 (AUD, no capacity.edit), 409 duplicate code, 428/409 If-Match, audit", async () => {
    const p = await setupP2World(api, w);
    const R = `${T(p)}/resource-roles`;
    expect(
      (await send("POST", R, { session: p.lead.session, body: { code: "Bad Code", labelEn: "x", labelAr: "x" } }))
        .status,
    ).toBe(400);
    expect(
      (await send("POST", R, { session: p.lead.session, body: { code: "ok", labelEn: "   ", labelAr: "x" } })).status,
    ).toBe(400);
    for (const s of [p.auditor.session, p.sponsor.session])
      expect((await send("POST", R, { session: s, body: { code: "x", labelEn: "X", labelAr: "س" } })).status).toBe(403);
    const created = await send("POST", R, {
      session: p.contributor.session,
      body: { code: "pm", labelEn: "PM", labelAr: "مدير" },
    });
    ok(created, 201, "WL holds capacity.edit");
    expect(await actions(created)).toEqual(["resource_role.create"]);
    const dup = await send("POST", R, {
      session: p.lead.session,
      body: { code: "pm", labelEn: "PM", labelAr: "مدير" },
    });
    expect([dup.status, dup.body.code]).toEqual([409, "resource_role.code_taken"]);
    const item = `${R}/${created.body.id}`;
    expect((await send("PATCH", item, { session: p.lead.session, body: { status: "archived" } })).status).toBe(428);
    expect(
      (await send("PATCH", item, { session: p.lead.session, headers: ifm(7), body: { status: "archived" } })).status,
    ).toBe(409);
    expect(
      (await send("PATCH", item, { session: p.auditor.session, headers: ifm(1), body: { status: "archived" } })).status,
    ).toBe(403);
    expect((await send("PATCH", item, { session: p.lead.session, headers: ifm(1), body: {} })).status).toBe(400);
    const archived = await send("PATCH", item, {
      session: p.lead.session,
      headers: ifm(1),
      body: { status: "archived" },
    });
    expect([archived.status, archived.body.status, archived.body.version]).toEqual([200, "archived", 2]);
    expect(await actions(archived)).toEqual(["resource_role.archive"]);
    // An archived role takes no new capacity.
    const refused = await send("POST", "/api/v1/capacity", {
      session: p.lead.session,
      body: {
        transformationId: p.transformationId,
        resourceRoleId: created.body.id,
        periodMonth: "2027-01-01",
        availableFte: "1",
      },
    });
    expect([refused.status, refused.body.code]).toEqual([422, "resource_role.archived"]);
  });

  it("capacity: FTE is a decimal string (numbers, 3 decimals, negatives -> 400), month is YYYY-MM-01, one active row per role and month", async () => {
    const p = await setupP2World(api, w);
    const r = await role(p, "architect");
    const base = { transformationId: p.transformationId, resourceRoleId: r.id, periodMonth: "2027-01-01" };
    for (const availableFte of [1.5, "1.505", "-1", "1e2", "10000"])
      expect(
        (await send("POST", "/api/v1/capacity", { session: p.lead.session, body: { ...base, availableFte } })).status,
        String(availableFte),
      ).toBe(400);
    expect(
      (
        await send("POST", "/api/v1/capacity", {
          session: p.lead.session,
          body: { ...base, periodMonth: "2027-01-15", availableFte: "1" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/v1/capacity", { session: p.auditor.session, body: { ...base, availableFte: "1" } }))
        .status,
    ).toBe(403);
    const created = await send("POST", "/api/v1/capacity", {
      session: p.lead.session,
      body: { ...base, availableFte: "1.5" },
    });
    ok(created, 201, "capacity");
    expect([created.body.availableFte, created.body.version, created.headers["etag"]]).toEqual(["1.50", 1, '"1"']);
    expect(await actions(created)).toEqual(["capacity.create"]);
    const dup = await send("POST", "/api/v1/capacity", {
      session: p.lead.session,
      body: { ...base, availableFte: "2" },
    });
    expect([dup.status, dup.body.code]).toEqual([409, "capacity.duplicate"]);
    const C = `/api/v1/capacity/${created.body.id}`;
    expect((await send("PATCH", C, { session: p.lead.session, body: { availableFte: "3" } })).status).toBe(428);
    expect(
      (await send("PATCH", C, { session: p.lead.session, headers: ifm(2), body: { availableFte: "3" } })).status,
    ).toBe(409);
    expect(
      (await send("PATCH", C, { session: p.auditor.session, headers: ifm(1), body: { availableFte: "3" } })).status,
    ).toBe(403);
    const upd = await send("PATCH", C, { session: p.lead.session, headers: ifm(1), body: { availableFte: "3" } });
    expect([upd.status, upd.body.availableFte]).toEqual([200, "3.00"]);
    const ev = (await auditOf(api.db, created.body.id)).map((e) => [e.action, e.changes]);
    expect(ev.at(-1)).toEqual(["capacity.update", { available_fte: { from: "1.50", to: "3.00" } }]);
    // Unreadable capacity is 404 (existence never disclosed).
    const other = await setupP2World(api, w);
    expect((await send("GET", C, { session: other.lead.session })).status).toBe(404);
  });

  it("demand: planned -> committed -> released; 422s for the wrong state; commit needs capacity.commit (TL 403, TO 200); audit", async () => {
    const p = await setupP2World(api, w);
    const r = await role(p, "tester");
    const ini = await createInitiative(send, p);
    const body = { initiativeId: ini.id, resourceRoleId: r.id, periodMonth: "2027-04-01", demandFte: "0.5" };
    expect((await send("POST", "/api/v1/resource-demands", { session: p.auditor.session, body })).status).toBe(403);
    expect(
      (await send("POST", "/api/v1/resource-demands", { session: p.lead.session, body: { ...body, demandFte: "0" } }))
        .status,
    ).toBe(422);
    expect(
      (await send("POST", "/api/v1/resource-demands", { session: p.lead.session, body: { ...body, demandFte: 0.5 } }))
        .status,
    ).toBe(400);
    const created = await send("POST", "/api/v1/resource-demands", { session: p.lead.session, body });
    ok(created, 201, "demand");
    expect([created.body.status, created.body.demandFte, created.body.committedBy]).toEqual(["planned", "0.50", null]);
    expect(await actions(created)).toEqual(["resource_demand.create"]);
    const D = `/api/v1/resource-demands/${created.body.id}`;
    expect(
      (
        await send("POST", `${D}/release`, {
          session: p.office.session,
          headers: ifm(1),
          body: { reason: "Synthetic." },
        })
      ).body.code,
    ).toBe("resource_demand.not_committed");
    expect((await send("POST", `${D}/commit`, { session: p.office.session, body: {} })).status).toBe(428);
    expect((await commit(p, created.body.id, 9)).status).toBe(409);
    for (const s of [p.lead.session, p.auditor.session, p.sponsor.session])
      expect((await commit(p, created.body.id, 1, s)).status).toBe(403);
    const committed = await commit(p, created.body.id, 1);
    expect([committed.status, committed.body.status, committed.body.committedBy]).toEqual([
      200,
      "committed",
      p.office.id,
    ]);
    expect(committed.body.committedAt).toEqual(expect.any(String));
    expect(await actions(committed)).toEqual(["resource_demand.commit"]);
    const again = await commit(p, created.body.id, 2);
    expect([again.status, again.body.type, again.body.code, again.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "resource_demand.not_planned",
      "Only a planned resource demand can be changed or committed",
    ]);
    const edit = await send("PATCH", D, { session: p.lead.session, headers: ifm(2), body: { demandFte: "1" } });
    expect([edit.status, edit.body.code]).toEqual([422, "resource_demand.not_planned"]);
    const archive = await send("PATCH", D, { session: p.lead.session, headers: ifm(2), body: { status: "archived" } });
    expect([archive.status, archive.body.code]).toEqual([422, "resource_demand.release_first"]);
    expect((await send("POST", `${D}/release`, { session: p.office.session, headers: ifm(2), body: {} })).status).toBe(
      400,
    );
    const released = await send("POST", `${D}/release`, {
      session: p.office.session,
      headers: ifm(2),
      body: { reason: "Synthetic: reprioritised." },
    });
    expect([released.status, released.body.status, released.body.version]).toEqual([200, "released", 3]);
    expect(await actions(released)).toEqual(["resource_demand.release"]);
    const archived = await send("PATCH", D, { session: p.lead.session, headers: ifm(3), body: { status: "archived" } });
    expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
    const list = ok(
      await send("GET", `/api/v1/resource-demands?transformationId=${p.transformationId}`, {
        session: p.auditor.session,
      }),
      200,
      "list",
    );
    expect(list.items.map((x: Body) => x.status)).toEqual(["archived"]);
  });

  it("a cancelled initiative's demand is read-only: create, update, commit and release -> 422 initiative.read_only", async () => {
    const p = await setupP2World(api, w);
    const r = await role(p, "ops");
    const ini = await createInitiative(send, p);
    const planned = await demand(p, ini.id, r.id, "2027-06-01", "1");
    const toRelease = await demand(p, ini.id, r.id, "2027-07-01", "1");
    ok(await commit(p, toRelease.id, 1), 200, "commit");
    await cancelInitiative(api, ini.id, p.lead.id);
    const results = [
      await send("POST", "/api/v1/resource-demands", {
        session: p.lead.session,
        body: { initiativeId: ini.id, resourceRoleId: r.id, periodMonth: "2027-08-01", demandFte: "1" },
      }),
      await send("PATCH", `/api/v1/resource-demands/${planned.id}`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { demandFte: "2" },
      }),
      await commit(p, planned.id, 1),
      await send("POST", `/api/v1/resource-demands/${toRelease.id}/release`, {
        session: p.office.session,
        headers: ifm(2),
        body: { reason: "Synthetic." },
      }),
    ];
    for (const res of results) {
      expect([res.status, res.body.code]).toEqual([422, "initiative.read_only"]);
      expect(await actions(res)).toEqual([]);
    }
  });

  it("BE18A: every capacity mutation re-authorises at commit - a grant revoked while the request waits is 403, nothing written", async () => {
    const p = await setupP2World(api, w);
    const r = await role(p, "be18a");
    const ini = await createInitiative(send, p);
    const cap = await capacityRow(p, r.id, "2027-01-01", "1");
    const d = await demand(p, ini.id, r.id, "2027-01-01", "1");
    const cases: [string, "POST" | "PATCH", string, unknown, Record<string, string>][] = [
      ["TL", "POST", `${T(p)}/resource-roles`, { code: "late", labelEn: "Late", labelAr: "متأخر" }, {}],
      ["TL", "PATCH", `${T(p)}/resource-roles/${r.id}`, { labelEn: "Changed" }, ifm(1)],
      [
        "TL",
        "POST",
        "/api/v1/capacity",
        { transformationId: p.transformationId, resourceRoleId: r.id, periodMonth: "2027-09-01", availableFte: "1" },
        {},
      ],
      ["TL", "PATCH", `/api/v1/capacity/${cap.id}`, { availableFte: "9" }, ifm(1)],
      [
        "TL",
        "POST",
        "/api/v1/resource-demands",
        { initiativeId: ini.id, resourceRoleId: r.id, periodMonth: "2027-09-01", demandFte: "1" },
        {},
      ],
      ["TL", "PATCH", `/api/v1/resource-demands/${d.id}`, { demandFte: "2" }, ifm(1)],
      ["TO", "POST", `/api/v1/resource-demands/${d.id}/commit`, {}, ifm(1)],
    ];
    for (const [roleCode, method, url, body, headers] of cases) {
      const res = await revokedAfterIdentity(api, w, p.transformationId, roleCode, method, url, body, headers);
      expect([url, res.status]).toEqual([url, 403]);
    }
    const unchanged = ok(await send("GET", `/api/v1/resource-demands/${d.id}`, { session: p.lead.session }), 200, "d");
    expect([unchanged.version, unchanged.status, unchanged.demandFte]).toEqual([1, "planned", "1.00"]);
    expect(
      ok(await send("GET", `/api/v1/capacity/${cap.id}`, { session: p.lead.session }), 200, "c").availableFte,
    ).toBe("1.00");
  }, 60_000);
});
