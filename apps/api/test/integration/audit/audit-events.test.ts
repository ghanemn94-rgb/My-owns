// The global audit API (T-DG6-BE-E; ADR-0052 §8; REQ-S16-032), against a real PostgreSQL:
//  - scope ("view:AUD,ADM(scoped)"): an event with a transformation targets that transformation, one without targets its
//    organization at organization level. AUD (inherits downward) sees its organizations, units and transformations;
//    ADM_TECH / ADM_ACCESS (non-inheriting) see organization-level events, and a transformation's events only with an
//    assignment at that transformation; everyone else is 403 on the list and 404 on one event;
//  - a sensitive record's events (ADR-0051 §2) are listed with changes and reason null and redacted true; actor, action,
//    time, record id and versions remain;
//  - filters and cursor pagination, newest first;
//  - append-only: "an UPDATE on the audit table by the application role fails" (also DELETE and TRUNCATE; probe AU01),
//    and no write operation exists.
// The events below are synthetic fixtures written with the API's single audit insert path (insertAuditEvent).
import { insertAuditEvent, type Tx } from "@mth/db";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { openapi } from "../../support/contract.ts";
import {
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

const ACTION = "test_fixture.audit_api";
const L = "/api/v1/audit-events";

let api: TestApi;
let w: World;
let appPool: pg.Pool;
let tA1: string;
let tA2: string;
let tB: string;
let evidenceId: string;
let sensitivityId: string;
const ev: Record<"org" | "t1" | "t2" | "b" | "sensitive" | "plainT1", string> = {
  org: "",
  t1: "",
  t2: "",
  b: "",
  sensitive: "",
  plainT1: "",
};
const s: Record<"admin" | "auditor" | "office" | "nobody" | "officeB" | "audA2" | "admT1", Session> = {} as never;

async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return api.db.transaction().execute(fn);
}
const actor = { actorType: "user" as const, actorUserId: "", requestId: "audit-api-fixture", source: "api" as const };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  appPool = new pg.Pool({ connectionString: inject("mthDb").appUrl, max: 1, application_name: "audit-events-test" });
  tA1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  tA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id);
  tB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.officeB.id);
  // AUD at business unit a2 only (inherits downward within a2); ADM_TECH at organization A plus an assignment at tA1.
  const audA2 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, audA2.id, "AUD", { type: "business_unit", id: w.a2 }, w.orgA.id);
  const admT1 = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, admT1.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, admT1.id, "ADM_TECH", { type: "transformation", id: tA1 }, w.orgA.id);
  const sessions = await Promise.all(
    [w.admin, w.auditor, w.office, w.nobody, w.officeB, audA2, admT1].map((u) => signIn(api.app, u.subject)),
  );
  [s.admin, s.auditor, s.office, s.nobody, s.officeB, s.audA2, s.admT1] = sessions as [
    Session,
    Session,
    Session,
    Session,
    Session,
    Session,
    Session,
  ];

  // A real evidence item on tA1 (the record that becomes sensitive).
  const created = await call(api.app, "POST", `/api/v1/transformations/${tA1}/evidence`, {
    session: s.office,
    body: { kind: "file", title: "Synthetic audit-api evidence", ownerUserId: w.office.id },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  evidenceId = created.body.id;

  const a = { ...actor, actorUserId: w.office.id };
  await inTx(async (tx) => {
    // Oldest first, so seq order is: org, t1, t2, b, plainT1, sensitive.
    ev.org = await insertAuditEvent(tx, a, {
      action: ACTION,
      recordType: "organization",
      recordId: w.orgA.id,
      organizationId: w.orgA.id,
      transformationId: null,
      reason: "Synthetic organization-level reason",
    });
    ev.t1 = await insertAuditEvent(tx, a, {
      action: ACTION,
      recordType: "transformation",
      recordId: tA1,
      organizationId: w.orgA.id,
      transformationId: tA1,
      priorVersion: 1,
      newVersion: 2,
    });
    ev.t2 = await insertAuditEvent(tx, a, {
      action: ACTION,
      recordType: "transformation",
      recordId: tA2,
      organizationId: w.orgA.id,
      transformationId: tA2,
    });
    ev.b = await insertAuditEvent(
      tx,
      { ...actor, actorUserId: w.officeB.id },
      { action: ACTION, recordType: "transformation", recordId: tB, organizationId: w.orgB.id, transformationId: tB },
    );
    ev.plainT1 = await insertAuditEvent(tx, a, {
      action: ACTION,
      recordType: "evidence",
      recordId: uuidv7(),
      organizationId: w.orgA.id,
      transformationId: tA1,
      reason: "Synthetic visible reason",
      changes: { title: { from: "Old", to: "New" } },
      priorVersion: 1,
      newVersion: 2,
    });
    ev.sensitive = await insertAuditEvent(tx, a, {
      action: ACTION,
      recordType: "evidence",
      recordId: evidenceId,
      organizationId: w.orgA.id,
      transformationId: tA1,
      reason: "Synthetic confidential reason",
      changes: { title: { from: "Confidential A", to: "Confidential B" } },
      priorVersion: 1,
      newVersion: 2,
    });
  });
  // Mark the evidence sensitive (ADR-0051 §2), with its own audit event in the same transaction (P2 guard).
  sensitivityId = uuidv7();
  await inTx(async (tx) => {
    await insertAuditEvent(tx, a, {
      action: "record_sensitivity.marked",
      recordType: "record_sensitivity",
      recordId: sensitivityId,
      organizationId: w.orgA.id,
      transformationId: tA1,
      newVersion: 1,
      reason: "Synthetic marking reason",
    });
    await tx
      .insertInto("record_sensitivity")
      .values({
        id: sensitivityId,
        organization_id: w.orgA.id,
        transformation_id: tA1,
        record_type: "evidence",
        record_id: evidenceId,
        is_sensitive: true,
        reason: "Synthetic marking reason",
        created_by: w.office.id,
        updated_by: w.office.id,
      })
      .execute();
  });
});
afterAll(async () => {
  await appPool?.end();
  await api?.close();
});

type Item = { id: string; redacted: boolean; reason: string | null; changes: unknown } & Record<string, unknown>;
const list = (session: Session | undefined, query: string) =>
  call<{ items: Item[]; nextCursor: string | null }>(api.app, "GET", `${L}?${query}`, session ? { session } : {});
const idsOf = async (session: Session, org = w.orgA.id) => {
  const r = await list(session, `organizationId=${org}&action=${ACTION}&limit=100`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.items.map((e) => e.id);
};

describe("listAuditEvents: the audit_event.read scope (ADR-0052 §8)", () => {
  it("AUD at the organization sees every event of the organization, its units and transformations, newest first", async () => {
    expect(await idsOf(s.auditor)).toEqual([ev.sensitive, ev.plainT1, ev.t2, ev.t1, ev.org]);
  });

  it("ADM_TECH/ADM_ACCESS at the organization see organization-level events only", async () => {
    expect(await idsOf(s.admin)).toEqual([ev.org]);
  });

  it("an ADM_TECH with an assignment at a transformation also sees that transformation's events", async () => {
    expect(await idsOf(s.admT1)).toEqual([ev.sensitive, ev.plainT1, ev.t1, ev.org]);
  });

  it("AUD at a business unit sees only the transformations under it, not organization-level events", async () => {
    expect(await idsOf(s.audA2)).toEqual([ev.t2]);
  });

  it("another organization's events never appear, and its organization is 403 to these callers", async () => {
    for (const session of [s.auditor, s.admin, s.admT1]) {
      expect(await idsOf(session)).not.toContain(ev.b);
      expect((await list(session, `organizationId=${w.orgB.id}`)).status).toBe(403);
    }
  });

  it("refuses callers without audit_event.read (403), an unknown organization (404), bad input (400), no session (401)", async () => {
    expect((await list(s.office, `organizationId=${w.orgA.id}`)).status).toBe(403); // TO: no audit_event.read
    expect((await list(s.nobody, `organizationId=${w.orgA.id}`)).status).toBe(403);
    expect((await list(s.officeB, `organizationId=${w.orgA.id}`)).status).toBe(403);
    expect((await list(s.auditor, `organizationId=${uuidv7()}`)).status).toBe(404);
    for (const q of [
      "",
      "organizationId=x",
      `organizationId=${w.orgA.id}&recordType=Bad-Type`,
      `organizationId=${w.orgA.id}&action=nodot`,
      `organizationId=${w.orgA.id}&from=yesterday`,
      `organizationId=${w.orgA.id}&limit=0`,
      `organizationId=${w.orgA.id}&unknown=1`,
      `organizationId=${w.orgA.id}&action=' OR 1=1 --`,
    ]) {
      expect((await list(s.auditor, q)).status, q).toBe(400);
    }
    expect((await list(undefined, `organizationId=${w.orgA.id}`)).status).toBe(401);
  });
});

describe("filters and pagination", () => {
  it("filters by transformation, record, record type, actor and time", async () => {
    const q = (extra: string) => list(s.auditor, `organizationId=${w.orgA.id}&action=${ACTION}&${extra}`);
    expect((await q(`transformationId=${tA2}`)).body.items.map((e) => e.id)).toEqual([ev.t2]);
    expect((await q(`recordId=${tA1}`)).body.items.map((e) => e.id)).toEqual([ev.t1]);
    expect((await q("recordType=organization")).body.items.map((e) => e.id)).toEqual([ev.org]);
    expect((await q(`actorUserId=${w.officeB.id}`)).body.items).toEqual([]);
    expect((await q(`actorUserId=${w.office.id}`)).body.items).toHaveLength(5);
    expect((await q("to=2000-01-01T00:00:00Z")).body.items).toEqual([]);
    expect((await q("from=2000-01-01T00:00:00Z")).body.items).toHaveLength(5);
  });

  it("pages newest first by a cursor bound to the filters", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: Awaited<ReturnType<typeof list>> = await list(
        s.auditor,
        `organizationId=${w.orgA.id}&action=${ACTION}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(r.status).toBe(200);
      seen.push(...r.body.items.map((e) => e.id));
      cursor = r.body.nextCursor;
      if (cursor) {
        // The same cursor with another filter is refused.
        const other = await list(
          s.auditor,
          `organizationId=${w.orgA.id}&action=${ACTION}&recordType=evidence&limit=2&cursor=${encodeURIComponent(cursor)}`,
        );
        expect(other.status).toBe(400);
      }
    } while (cursor);
    expect(seen).toEqual([ev.sensitive, ev.plainT1, ev.t2, ev.t1, ev.org]);
  });

  it("returns the GlobalAuditEvent fields, unredacted for a record that is not sensitive", async () => {
    const r = await call(api.app, "GET", `${L}/${ev.plainT1}`, { session: s.auditor });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id: ev.plainT1,
      organizationId: w.orgA.id,
      transformationId: tA1,
      action: ACTION,
      recordType: "evidence",
      actor: { type: "user", userId: w.office.id },
      priorVersion: 1,
      newVersion: 2,
      reason: "Synthetic visible reason",
      requestId: "audit-api-fixture",
      source: "api",
      changes: { title: { from: "Old", to: "New" } },
      redacted: false,
    });
  });
});

describe("getAuditEvent: the same scope, 404 outside it", () => {
  it("returns an event inside the caller's scope and 404 for one outside it, missing, or malformed", async () => {
    expect((await call(api.app, "GET", `${L}/${ev.t1}`, { session: s.auditor })).status).toBe(200);
    expect((await call(api.app, "GET", `${L}/${ev.org}`, { session: s.admin })).status).toBe(200);
    expect((await call(api.app, "GET", `${L}/${ev.t1}`, { session: s.admin })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/${ev.t1}`, { session: s.admT1 })).status).toBe(200);
    expect((await call(api.app, "GET", `${L}/${ev.t1}`, { session: s.audA2 })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/${ev.b}`, { session: s.auditor })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/${ev.b}`, { session: s.officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/${ev.t1}`, { session: s.office })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/${uuidv7()}`, { session: s.auditor })).status).toBe(404);
    expect((await call(api.app, "GET", `${L}/not-a-uuid`, { session: s.auditor })).status).toBe(400);
    expect((await call(api.app, "GET", `${L}/${ev.t1}`)).status).toBe(401);
  });
});

describe("sensitive records (ADR-0051 §2): redacted, never hidden", () => {
  it("lists a sensitive record's event with changes and reason null and redacted true; the trail fields remain", async () => {
    const r = await list(s.auditor, `organizationId=${w.orgA.id}&action=${ACTION}&recordId=${evidenceId}`);
    expect(r.body.items).toHaveLength(1);
    const e = r.body.items[0]!;
    expect(e).toMatchObject({
      id: ev.sensitive,
      recordType: "evidence",
      recordId: evidenceId,
      action: ACTION,
      actor: { type: "user", userId: w.office.id },
      priorVersion: 1,
      newVersion: 2,
      reason: null,
      changes: null,
      redacted: true,
    });
    expect(JSON.stringify(r.body)).not.toContain("Confidential");
    const one = await call(api.app, "GET", `${L}/${ev.sensitive}`, { session: s.admT1 });
    expect(one.body).toMatchObject({ reason: null, changes: null, redacted: true });
    // A record without a sensitivity row (or not sensitive) is untouched in the same response.
    const all = await list(s.auditor, `organizationId=${w.orgA.id}&action=${ACTION}`);
    expect(all.body.items.filter((i) => i.redacted).map((i) => i.id)).toEqual([ev.sensitive]);
  });

  it("unmarking the record shows its events again", async () => {
    await inTx(async (tx) => {
      await insertAuditEvent(
        tx,
        { ...actor, actorUserId: w.office.id },
        {
          action: "record_sensitivity.unmarked",
          recordType: "record_sensitivity",
          recordId: sensitivityId,
          organizationId: w.orgA.id,
          transformationId: tA1,
          priorVersion: 1,
          newVersion: 2,
          reason: "Synthetic unmarking reason",
        },
      );
      await tx
        .updateTable("record_sensitivity")
        .set({ is_sensitive: false, version: 2, reason: "Synthetic unmarking reason" })
        .where("id", "=", sensitivityId)
        .execute();
    });
    try {
      const one = await call(api.app, "GET", `${L}/${ev.sensitive}`, { session: s.auditor });
      expect(one.body).toMatchObject({
        reason: "Synthetic confidential reason",
        changes: { title: { from: "Confidential A", to: "Confidential B" } },
        redacted: false,
      });
    } finally {
      await inTx(async (tx) => {
        await insertAuditEvent(
          tx,
          { ...actor, actorUserId: w.office.id },
          {
            action: "record_sensitivity.marked",
            recordType: "record_sensitivity",
            recordId: sensitivityId,
            organizationId: w.orgA.id,
            transformationId: tA1,
            priorVersion: 2,
            newVersion: 3,
            reason: "Synthetic marking reason",
          },
        );
        await tx
          .updateTable("record_sensitivity")
          .set({ is_sensitive: true, version: 3, reason: "Synthetic marking reason" })
          .where("id", "=", sensitivityId)
          .execute();
      });
    }
  });

  // PENDING on T-DG6-BE-B (p6-work-split §E/F.7): the admitted caller's view (an active grantee, a named party or a
  // sensitive_record.grant holder sees the reason and changes) needs BE-B's sensitivity clause on the server.ts port
  // line. Until it is wired the redaction is fail-closed (every caller sees a sensitive record's events redacted).
  it.todo("PENDING T-DG6-BE-B: a caller admitted to the sensitive record (grantee, named party) sees it unredacted");
});

describe("append-only audit data (REQ-S16-032; probe AU01)", () => {
  it("an UPDATE on the audit table by the application role fails; so do DELETE and TRUNCATE; the row is unchanged", async () => {
    const before = await api.db.selectFrom("audit_event").selectAll().where("id", "=", ev.t1).executeTakeFirstOrThrow();
    for (const statement of [
      { text: "UPDATE audit_event SET reason = 'tampered' WHERE id = $1", values: [ev.t1] },
      { text: "DELETE FROM audit_event WHERE id = $1", values: [ev.t1] },
      { text: "TRUNCATE audit_event", values: [] },
    ]) {
      const client = await appPool.connect();
      try {
        const role = await client.query<{ current_user: string }>("SELECT current_user");
        expect(role.rows[0]!.current_user).toBe("mth_app");
        await expect(client.query(statement.text, statement.values), statement.text).rejects.toThrow();
      } finally {
        client.release();
      }
    }
    const after = await api.db.selectFrom("audit_event").selectAll().where("id", "=", ev.t1).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });

  it("no write operation exists on the audit API, in the contract or on the server", async () => {
    const paths = openapi["paths"] as Record<string, Record<string, unknown>>;
    for (const p of [L, `${L}/{auditEventId}`]) {
      expect(
        Object.keys(paths[p]!).filter((k) => ["post", "put", "patch", "delete"].includes(k)),
        p,
      ).toEqual([]);
    }
    const writes = api.routes.filter((r) => r.url.startsWith(L) && !["GET", "HEAD"].includes(r.method));
    expect(writes).toEqual([]);
    const post = await call(api.app, "POST", L, { session: s.auditor, body: {}, contract: false });
    expect(post.status).toBe(404);
  });
});
