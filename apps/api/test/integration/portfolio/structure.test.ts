// Portfolios and workstreams against the run's disposable PostgreSQL (T-DG4-BE-M3; ADR-0038 §9-§12; REQ-S03-001
// "a transformation belongs to one organization and one or more business units and can sit in a portfolio; workstreams
// group initiatives"). Proves:
//  - a transformation in two portfolios → 422 portfolio.transformation_already_placed (exact text), also under two
//    concurrent placements; an initiative in two workstreams → 422 workstream.initiative_already_assigned;
//  - workstream codes WS-01, WS-02, WS-03 in creation order (record_code_counter prefix WS);
//  - an archived portfolio or workstream is read-only (422 portfolio.archived / workstream.archived on every write,
//    memberships included) and still readable; a removed membership is kept (never deleted) and cannot be removed twice
//    (422 membership.not_active); re-adding creates a new row;
//  - AUD 403 on every write (and BO, and a business-unit-scoped TO on the organization-level portfolio writes); another
//    organization 404; If-Match 428/409 on every change; creates are version 1; one audit event per mutation;
//    commit-time re-authorisation; validation 400s; the db-errors backstop of the 0055 unique keys.
// All data is SYNTHETIC; a portfolio or workstream grants no access and approves nothing, and nothing here touches the
// engineering gates DG0-DG7.
import { portfolio, portfolioTransformation, workstream, workstreamInitiative } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../../../src/modules/platform/db-errors.ts";
import {
  auditOf,
  call,
  createTransformationRow,
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
import { ifm } from "../../support/p2-fixtures.ts";
import { insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session;
let buOffice: Session;
let P: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TO", { type: "business_unit", id: w.a1 }, w.orgA.id);
  buOffice = await signIn(api.app, u.subject);
  P = `/api/v1/organizations/${w.orgA.id}/portfolios`;
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

async function newPortfolio(name = "Synthetic portfolio"): Promise<{ id: string; url: string; code: string }> {
  const code = uniq("PF");
  const r = await send("POST", P, { session: office, body: { code, name } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id, url: `/api/v1/portfolios/${r.body.id}`, code };
}

async function newTransformation(bu = w.a1): Promise<string> {
  return createTransformationRow(api.db, w.orgA.id, bu, w.office.id);
}

async function newWorkstream(name = "Synthetic workstream"): Promise<{ id: string; url: string; code: string }> {
  const r = await send("POST", `${b.base}/workstreams`, { session: b.s.tl, body: { name } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id, url: `${b.base}/workstreams/${r.body.id}`, code: r.body.code };
}

const actions = async (id: string) => (await auditOf(api.db, id)).map((a) => a.action);

describe("portfolios (ADR-0038 §9)", () => {
  it("create: 201 version 1 with ETag and Location, one audit event; the mirror parses it", async () => {
    const code = uniq("PF");
    const r = await send("POST", P, {
      session: office,
      body: { code, name: "Synthetic customer portfolio", description: "Synthetic.", ownerUserId: w.office.id },
    });
    expect([r.status, r.body.version, r.body.status, r.body.code], JSON.stringify(r.body)).toEqual([
      201,
      1,
      "active",
      code,
    ]);
    expect(portfolio.safeParse(r.body).success).toBe(true);
    expect(r.headers.etag).toBe('"1"');
    expect(r.headers.location).toBe(`/api/v1/portfolios/${r.body.id}`);
    expect(await actions(r.body.id)).toEqual(["portfolio.create"]);
    const got = await send("GET", `/api/v1/portfolios/${r.body.id}`, { session: b.s.auditor });
    expect([got.status, got.body.name]).toEqual([200, "Synthetic customer portfolio"]);
  });

  it("AUD, BO and a business-unit-scoped TO get 403 on every write; another organization 404; nothing written", async () => {
    const p = await newPortfolio();
    const t = await newTransformation();
    for (const session of [b.s.auditor, b.s.bo, buOffice]) {
      expect((await send("POST", P, { session, body: { code: uniq("PF"), name: "Denied" } })).status).toBe(403);
      expect((await send("PATCH", p.url, { session, headers: ifm(1), body: { name: "Denied" } })).status).toBe(403);
      expect((await send("POST", `${p.url}/transformations`, { session, body: { transformationId: t } })).status).toBe(
        403,
      );
    }
    const placed = await send("POST", `${p.url}/transformations`, { session: office, body: { transformationId: t } });
    expect(placed.status).toBe(201);
    for (const session of [b.s.auditor, b.s.bo, buOffice])
      expect(
        (
          await send("POST", `${p.url}/transformations/${placed.body.id}/remove`, {
            session,
            headers: ifm(1),
            body: { reason: "Synthetic: denied" },
          })
        ).status,
      ).toBe(403);
    expect((await send("POST", P, { session: b.s.outsider, body: { code: uniq("PF"), name: "X" } })).status).toBe(404);
    expect((await send("GET", p.url, { session: b.s.outsider })).status).toBe(404);
    expect((await send("GET", P, { session: b.s.outsider })).status).toBe(404);
    expect(await actions(p.id)).toEqual(["portfolio.create"]);
    expect(await actions(placed.body.id)).toEqual(["portfolio_transformation.create"]);
  });

  it("validation: code pattern, blank name, archive without a reason, a reason without the archive, empty patch", async () => {
    const p = await newPortfolio();
    const bad = async (method: string, url: string, body: unknown, headers = {}) => {
      const r = await send(method, url, { session: office, body, headers });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      return r.body as { errors: { pointer: string; code: string }[] };
    };
    await bad("POST", P, { code: "lower", name: "X" });
    await bad("POST", P, { code: uniq("PF"), name: "   " });
    await bad("POST", P, { code: uniq("PF"), name: "Bad\u0000name" });
    const noReason = await bad("PATCH", p.url, { status: "archived" }, ifm(1));
    expect(noReason.errors).toContainEqual(
      expect.objectContaining({ pointer: "/archiveReason", code: "validation.required" }),
    );
    const stray = await bad("PATCH", p.url, { archiveReason: "Synthetic: stray" }, ifm(1));
    expect(stray.errors).toContainEqual(
      expect.objectContaining({ pointer: "/archiveReason", code: "validation.not_applicable" }),
    );
    await bad("PATCH", p.url, {}, ifm(1));
    const owner = await send("POST", P, {
      session: office,
      body: { code: uniq("PF"), name: "X", ownerUserId: w.officeB.id },
    });
    expect([owner.status, owner.body.code]).toEqual([422, "validation.user_invalid"]);
  });

  it("409 portfolio.code_taken on create and on a code change (exact text)", async () => {
    const p1 = await newPortfolio();
    const p2 = await newPortfolio();
    const dup = await send("POST", P, { session: office, body: { code: p1.code, name: "Again" } });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "portfolio.code_taken",
      "Another portfolio of this organization uses this code.",
    ]);
    const change = await send("PATCH", p2.url, { session: office, headers: ifm(1), body: { code: p1.code } });
    expect([change.status, change.body.code]).toEqual([409, "portfolio.code_taken"]);
  });

  it("If-Match: 428 when missing, 409 when stale, then 200 with version + 1 and one audit event each", async () => {
    const p = await newPortfolio();
    expect((await send("PATCH", p.url, { session: office, body: { name: "N" } })).status).toBe(428);
    const stale = await send("PATCH", p.url, { session: office, headers: ifm(3), body: { name: "N" } });
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    const ok = await send("PATCH", p.url, { session: office, headers: ifm(1), body: { name: "Synthetic renamed" } });
    expect([ok.status, ok.body.version, ok.headers.etag]).toEqual([200, 2, '"2"']);
    expect(await actions(p.id)).toEqual(["portfolio.create", "portfolio.update"]);
  });

  it("a transformation in two portfolios → 422 portfolio.transformation_already_placed; removal keeps the row; re-add", async () => {
    const p1 = await newPortfolio();
    const p2 = await newPortfolio();
    const t = await newTransformation();
    const first = await send("POST", `${p1.url}/transformations`, { session: office, body: { transformationId: t } });
    expect([first.status, first.body.version, first.body.status]).toEqual([201, 1, "active"]);
    expect(portfolioTransformation.safeParse(first.body).success).toBe(true);
    const second = await send("POST", `${p2.url}/transformations`, { session: office, body: { transformationId: t } });
    expect([second.status, second.body.code, second.body.detail]).toEqual([
      422,
      "portfolio.transformation_already_placed",
      "This transformation already sits in a portfolio.",
    ]);
    const R = `${p1.url}/transformations/${first.body.id}/remove`;
    expect((await send("POST", R, { session: office, body: { reason: "Synthetic: moved" } })).status).toBe(428);
    expect((await send("POST", R, { session: office, headers: ifm(4), body: { reason: "Synthetic" } })).status).toBe(
      409,
    );
    const removed = await send("POST", R, { session: office, headers: ifm(1), body: { reason: "Synthetic: moved" } });
    expect([removed.status, removed.body.status, removed.body.removeReason, removed.body.version]).toEqual([
      200,
      "removed",
      "Synthetic: moved",
      2,
    ]);
    const twice = await send("POST", R, { session: office, headers: ifm(2), body: { reason: "Synthetic: again" } });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "membership.not_active",
      "This membership has already been removed.",
    ]);
    // The removed row is kept (listed with includeRemoved), and the transformation can now sit in p2.
    const active = await send("GET", `${p1.url}/transformations`, { session: office });
    expect(active.body.items).toEqual([]);
    const all = await send("GET", `${p1.url}/transformations?includeRemoved=true`, { session: office });
    expect(all.body.items.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [first.body.id, "removed"],
    ]);
    const moved = await send("POST", `${p2.url}/transformations`, { session: office, body: { transformationId: t } });
    expect(moved.status).toBe(201);
    expect(await actions(first.body.id)).toEqual([
      "portfolio_transformation.create",
      "portfolio_transformation.remove",
    ]);
    expect(
      Number(
        (
          await api.db
            .selectFrom("portfolio_transformation")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("transformation_id", "=", t)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    ).toBe(2);
  });

  it("two concurrent placements of one transformation: exactly one commits, the other is 422 already_placed", async () => {
    const p1 = await newPortfolio();
    const p2 = await newPortfolio();
    const t = await newTransformation();
    const results = await Promise.all(
      [p1, p2].map((p) => send("POST", `${p.url}/transformations`, { session: office, body: { transformationId: t } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)!.body.code).toBe("portfolio.transformation_already_placed");
  });

  it("an unreadable or unknown transformation cannot be placed (404); an archived transformation is read-only", async () => {
    const p = await newPortfolio();
    const foreign = await createTransformationRow(api.db, w.orgB.id, w.b1, w.officeB.id);
    const M = `${p.url}/transformations`;
    expect((await send("POST", M, { session: office, body: { transformationId: foreign } })).status).toBe(404);
    expect((await send("POST", M, { session: office, body: { transformationId: uuidv7() } })).status).toBe(404);
    const archived = await newTransformation();
    await api.owner.query(
      "update transformation set archived_at = now(), archived_by = $2, archive_reason = 'Synthetic: archived' where id = $1",
      [archived, w.office.id],
    );
    const r = await send("POST", M, { session: office, body: { transformationId: archived } });
    expect([r.status, r.body.code]).toEqual([422, "transformation.archived"]);
  });

  it("an archived portfolio is read-only: every later write is 422 portfolio.archived; it stays readable", async () => {
    const p = await newPortfolio();
    const t = await newTransformation();
    const placed = await send("POST", `${p.url}/transformations`, { session: office, body: { transformationId: t } });
    const archived = await send("PATCH", p.url, {
      session: office,
      headers: ifm(1),
      body: { status: "archived", archiveReason: "Synthetic: programme closed" },
    });
    expect([archived.status, archived.body.status, archived.body.archiveReason, archived.body.version]).toEqual([
      200,
      "archived",
      "Synthetic: programme closed",
      2,
    ]);
    expect(archived.body.archivedBy).toBe(w.office.id);
    const refused = (r: { status: number; body: { code: string; detail: string } }) =>
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "portfolio.archived",
        "This portfolio is archived.",
      ]);
    refused(await send("PATCH", p.url, { session: office, headers: ifm(2), body: { name: "Again" } }));
    refused(
      await send("POST", `${p.url}/transformations`, {
        session: office,
        body: { transformationId: await newTransformation() },
      }),
    );
    refused(
      await send("POST", `${p.url}/transformations/${placed.body.id}/remove`, {
        session: office,
        headers: ifm(1),
        body: { reason: "Synthetic: late" },
      }),
    );
    expect((await send("GET", p.url, { session: b.s.auditor })).body.status).toBe("archived");
    const listed = await send("GET", P, { session: office });
    expect(listed.body.items.some((i: { id: string }) => i.id === p.id)).toBe(false);
    const withArchived = await send("GET", `${P}?includeArchived=true`, { session: office });
    expect(withArchived.body.items.some((i: { id: string }) => i.id === p.id)).toBe(true);
    expect(await actions(p.id)).toEqual(["portfolio.create", "portfolio.archive"]);
  });

  it("commit-time re-authorisation: a TO whose grant is revoked while the request waits gets 403; nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    const code = uniq("PF");
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", P, { session, body: { code, name: "Synthetic late" }, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db.selectFrom("portfolio").select("id").where("code", "=", code).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("db-errors backstop: the 0055 unique keys map to the ADR-0038 §12 codes", async () => {
    const p1 = await newPortfolio();
    const p2 = await newPortfolio();
    const t = await newTransformation();
    await send("POST", `${p1.url}/transformations`, { session: office, body: { transformationId: t } });
    const err = await api.owner
      .query(
        `insert into portfolio_transformation (id, organization_id, transformation_id, portfolio_id, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $5)`,
        [uuidv7(), w.orgA.id, t, p2.id, w.office.id],
      )
      .then(
        () => null,
        (e: unknown) => e as { code?: string; constraint?: string },
      );
    expect(err?.constraint).toBe("portfolio_transformation_one_active_key");
    const mapped = mapDatabaseGuardError(err!);
    expect([mapped?.status, mapped?.code]).toEqual([422, "portfolio.transformation_already_placed"]);
    const code = mapDatabaseGuardError({ code: "23505", constraint: "portfolio_org_code_key" });
    expect([code?.status, code?.code, code?.detail]).toEqual([
      409,
      "portfolio.code_taken",
      "Another portfolio of this organization uses this code.",
    ]);
    const ws = mapDatabaseGuardError({ code: "23505", constraint: "workstream_initiative_one_active_key" });
    expect([ws?.status, ws?.code]).toEqual([422, "workstream.initiative_already_assigned"]);
  });
});

describe("workstreams (ADR-0038 §9)", () => {
  it("codes WS-01, WS-02, WS-03 in creation order; version 1; one audit event; listed in order", async () => {
    const bw = await seedBenefitWorld(api, w);
    const codes: string[] = [];
    for (const name of ["Synthetic channels", "Synthetic operations", "Synthetic data"]) {
      const r = await send("POST", `${bw.base}/workstreams`, { session: bw.s.tl, body: { name } });
      expect([r.status, r.body.version], JSON.stringify(r.body)).toEqual([201, 1]);
      expect(workstream.safeParse(r.body).success).toBe(true);
      expect(r.headers.location).toBe(`${bw.base}/workstreams/${r.body.id}`);
      expect(await actions(r.body.id)).toEqual(["workstream.create"]);
      codes.push(r.body.code);
    }
    expect(codes).toEqual(["WS-01", "WS-02", "WS-03"]);
    const list = await send("GET", `${bw.base}/workstreams`, { session: bw.s.auditor });
    expect(list.body.items.map((i: { code: string }) => i.code)).toEqual(["WS-01", "WS-02", "WS-03"]);
  });

  it("AUD and BO get 403 on every write; another organization 404; nothing written", async () => {
    const ws = await newWorkstream();
    const ini = await insertInitiative(api.db, b);
    const added = await send("POST", `${ws.url}/initiatives`, { session: b.s.tl, body: { initiativeId: ini } });
    expect(added.status).toBe(201);
    for (const session of [b.s.auditor, b.s.bo]) {
      expect((await send("POST", `${b.base}/workstreams`, { session, body: { name: "Denied" } })).status).toBe(403);
      expect((await send("PATCH", ws.url, { session, headers: ifm(1), body: { name: "Denied" } })).status).toBe(403);
      expect(
        (
          await send("POST", `${ws.url}/initiatives`, {
            session,
            body: { initiativeId: await insertInitiative(api.db, b) },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await send("POST", `${ws.url}/initiatives/${added.body.id}/remove`, {
            session,
            headers: ifm(1),
            body: { reason: "Synthetic: denied" },
          })
        ).status,
      ).toBe(403);
    }
    expect((await send("GET", ws.url, { session: b.s.outsider })).status).toBe(404);
    expect((await send("POST", `${b.base}/workstreams`, { session: b.s.outsider, body: { name: "X" } })).status).toBe(
      404,
    );
    expect(
      (await send("PATCH", ws.url, { session: b.s.outsider, headers: ifm(1), body: { name: "Outsider" } })).status,
    ).toBe(404);
    expect(
      (
        await send("POST", `${ws.url}/initiatives/${added.body.id}/remove`, {
          session: b.s.outsider,
          headers: ifm(1),
          body: { reason: "Synthetic: outsider" },
        })
      ).status,
    ).toBe(404);
    expect(await actions(ws.id)).toEqual(["workstream.create"]);
    expect(await actions(added.body.id)).toEqual(["workstream_initiative.create"]);
  });

  it("If-Match 428/409 on edit and removal; validation 400s; an unknown lead 422", async () => {
    const ws = await newWorkstream();
    expect((await send("PATCH", ws.url, { session: b.s.tl, body: { name: "N" } })).status).toBe(428);
    expect((await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(2), body: { name: "N" } })).status).toBe(409);
    expect((await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(1), body: { name: "" } })).status).toBe(400);
    expect((await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(1), body: { code: "WS-09" } })).status).toBe(
      400,
    );
    expect(
      (await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(1), body: { status: "archived" } })).status,
    ).toBe(400);
    const lead = await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(1), body: { leadUserId: w.officeB.id } });
    expect([lead.status, lead.body.code]).toEqual([422, "validation.user_invalid"]);
    const ok = await send("PATCH", ws.url, {
      session: b.s.tl,
      headers: ifm(1),
      body: { name: "Synthetic renamed", leadUserId: b.users.tl.id },
    });
    expect([ok.status, ok.body.version, ok.body.leadUserId, ok.body.code]).toEqual([200, 2, b.users.tl.id, ws.code]);
    expect(await actions(ws.id)).toEqual(["workstream.create", "workstream.update"]);
  });

  it("an initiative in two workstreams → 422 workstream.initiative_already_assigned; removal keeps the row; re-add", async () => {
    const ws1 = await newWorkstream();
    const ws2 = await newWorkstream();
    const ini = await insertInitiative(api.db, b);
    const first = await send("POST", `${ws1.url}/initiatives`, { session: b.s.tl, body: { initiativeId: ini } });
    expect([first.status, first.body.version, first.body.initiativeId]).toEqual([201, 1, ini]);
    expect(workstreamInitiative.safeParse(first.body).success).toBe(true);
    for (const target of [ws2, ws1]) {
      const again = await send("POST", `${target.url}/initiatives`, { session: b.s.tl, body: { initiativeId: ini } });
      expect([again.status, again.body.code, again.body.detail]).toEqual([
        422,
        "workstream.initiative_already_assigned",
        "This initiative already belongs to a workstream.",
      ]);
    }
    const R = `${ws1.url}/initiatives/${first.body.id}/remove`;
    expect((await send("POST", R, { session: b.s.tl, body: { reason: "Synthetic: regrouped" } })).status).toBe(428);
    expect((await send("POST", R, { session: b.s.tl, headers: ifm(3), body: { reason: "Synthetic" } })).status).toBe(
      409,
    );
    const removed = await send("POST", R, {
      session: b.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic: regrouped" },
    });
    expect([removed.status, removed.body.status, removed.body.version]).toEqual([200, "removed", 2]);
    const twice = await send("POST", R, { session: b.s.tl, headers: ifm(2), body: { reason: "Synthetic: again" } });
    expect([twice.status, twice.body.code]).toEqual([422, "membership.not_active"]);
    expect((await send("GET", `${ws1.url}/initiatives`, { session: b.s.auditor })).body.items).toEqual([]);
    const kept = await send("GET", `${ws1.url}/initiatives?includeRemoved=true`, { session: b.s.auditor });
    expect(kept.body.items.map((i: { id: string }) => i.id)).toEqual([first.body.id]);
    expect(
      (await send("POST", `${ws2.url}/initiatives`, { session: b.s.tl, body: { initiativeId: ini } })).status,
    ).toBe(201);
    expect(await actions(first.body.id)).toEqual(["workstream_initiative.create", "workstream_initiative.remove"]);
  });

  it("an initiative of another transformation or unknown → 422 validation.reference; a foreign workstream 404", async () => {
    const ws = await newWorkstream();
    const other = await seedBenefitWorld(api, w);
    const foreignIni = await insertInitiative(api.db, other);
    const r = await send("POST", `${ws.url}/initiatives`, { session: b.s.tl, body: { initiativeId: foreignIni } });
    expect([r.status, r.body.code, r.body.errors?.[0]?.pointer]).toEqual([
      422,
      "validation.reference",
      "/initiativeId",
    ]);
    expect(
      (await send("POST", `${ws.url}/initiatives`, { session: b.s.tl, body: { initiativeId: uuidv7() } })).status,
    ).toBe(422);
    // The workstream of b, addressed under the other transformation: 404 (never 403, never disclosed).
    const otherWs = await send("POST", `${other.base}/workstreams`, { session: other.s.tl, body: { name: "Other" } });
    expect((await send("GET", `${b.base}/workstreams/${otherWs.body.id}`, { session: b.s.tl })).status).toBe(404);
  });

  it("an archived workstream is read-only: every later write is 422 workstream.archived; it stays readable", async () => {
    const ws = await newWorkstream();
    const ini = await insertInitiative(api.db, b);
    const added = await send("POST", `${ws.url}/initiatives`, { session: b.s.tl, body: { initiativeId: ini } });
    const archived = await send("PATCH", ws.url, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "archived", archiveReason: "Synthetic: merged" },
    });
    expect([archived.status, archived.body.status, archived.body.archiveReason]).toEqual([
      200,
      "archived",
      "Synthetic: merged",
    ]);
    const refused = (r: { status: number; body: { code: string; detail: string } }) =>
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "workstream.archived",
        "This workstream is archived.",
      ]);
    refused(await send("PATCH", ws.url, { session: b.s.tl, headers: ifm(2), body: { name: "Again" } }));
    refused(
      await send("POST", `${ws.url}/initiatives`, {
        session: b.s.tl,
        body: { initiativeId: await insertInitiative(api.db, b) },
      }),
    );
    refused(
      await send("POST", `${ws.url}/initiatives/${added.body.id}/remove`, {
        session: b.s.tl,
        headers: ifm(1),
        body: { reason: "Synthetic: late" },
      }),
    );
    expect((await send("GET", ws.url, { session: b.s.auditor })).body.status).toBe("archived");
    const listed = await send("GET", `${b.base}/workstreams`, { session: b.s.auditor });
    expect(listed.body.items.some((i: { id: string }) => i.id === ws.id)).toBe(false);
    const all = await send("GET", `${b.base}/workstreams?includeArchived=true`, { session: b.s.auditor });
    expect(all.body.items.some((i: { id: string }) => i.id === ws.id)).toBe(true);
    expect(await actions(ws.id)).toEqual(["workstream.create", "workstream.archive"]);
  });

  it("commit-time re-authorisation: a TL whose grant is revoked while the request waits gets 403; nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${b.base}/workstreams`, {
          session,
          body: { name: "Synthetic late workstream" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("workstream")
      .select("id")
      .where("name", "=", "Synthetic late workstream")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
