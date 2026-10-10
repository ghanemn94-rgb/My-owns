// getInitiativeSchedule (T-DG4-BE-R4; ADR-0031 amendment S1) against a real PostgreSQL, through the API only:
//  - after the create: 200 with the created row and `ETag` = the create's version; after an update, the new version;
//  - the read's ETag is accepted as the PATCH's If-Match, and the create's Location now resolves;
//  - a recorded row whose duration is null answers 200 with durationWorkingDays null;
//  - 404 not_found for a readable initiative with no schedule row, for an unknown initiative, outside scope (ADM-only,
//    another organization's officer); 400 for a malformed id; 401 unauthenticated. Every reader role (TL, FIN, BO, AUD)
//    may read. The read writes nothing (no audit event).
// All data is SYNTHETIC. Nothing here is a business approval; nothing touches DG0-DG7.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { insertInitiative, seedExecutionWorld } from "./execution-fixtures.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("getInitiativeSchedule (ADR-0031 amendment S1)", () => {
  it("returns the recorded row with its version as ETag; the ETag drives the PATCH; Location resolves", async () => {
    const x = await seedExecutionWorld(api, w);
    const ini = await insertInitiative(api.db, x, "INI-01");
    const S = `/api/v1/initiatives/${ini}/schedule`;
    const created = await send("POST", S, { session: x.s.tl, body: { durationWorkingDays: 5, note: "Synthetic" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.location).toBe(S);
    const auditBefore = (await auditOf(api.db, created.body.id)).length;
    for (const who of ["tl", "fin", "bo", "auditor"] as const) {
      const r = await send("GET", created.headers.location as string, { session: x.s[who] });
      expect([r.status, r.headers.etag, r.body], who).toEqual([200, '"1"', created.body]);
    }
    const read = await send("GET", S, { session: x.s.wl });
    const changed = await send("PATCH", S, {
      session: x.s.wl,
      headers: { "if-match": read.headers.etag as string },
      body: { durationWorkingDays: 7 },
    });
    expect([changed.status, changed.body.version]).toEqual([200, 2]);
    const after = await send("GET", S, { session: x.s.auditor });
    expect([after.status, after.headers.etag, after.body]).toEqual([200, '"2"', changed.body]);
    expect(after.body).toMatchObject({ initiativeId: ini, durationWorkingDays: 7, note: "Synthetic", version: 2 });
    // A stale read's ETag is refused by the PATCH (409 with the current version).
    const stale = await send("PATCH", S, { session: x.s.wl, headers: ifm(1), body: { durationWorkingDays: 8 } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    // Reads write nothing: only the update's audit event was added.
    expect((await auditOf(api.db, created.body.id)).length).toBe(auditBefore + 1);
  });

  it("a recorded row with a null duration answers 200 with durationWorkingDays null", async () => {
    const x = await seedExecutionWorld(api, w);
    const ini = await insertInitiative(api.db, x, "INI-01");
    const S = `/api/v1/initiatives/${ini}/schedule`;
    const created = await send("POST", S, { session: x.s.tl, body: { durationWorkingDays: null } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const r = await send("GET", S, { session: x.s.auditor });
    expect([r.status, r.headers.etag, r.body.durationWorkingDays, r.body]).toEqual([200, '"1"', null, created.body]);
  });

  it("404 with no row, for an unknown initiative and outside scope; 400 malformed id; 401 unauthenticated", async () => {
    const x = await seedExecutionWorld(api, w);
    const ini = await insertInitiative(api.db, x, "INI-01");
    const S = `/api/v1/initiatives/${ini}/schedule`;
    const none = await send("GET", S, { session: x.s.tl });
    expect([none.status, none.body.type, none.body.code]).toEqual([404, "urn:mth:problem:not-found", "not_found"]);
    const unknown = await send("GET", `/api/v1/initiatives/${uuidv7()}/schedule`, { session: x.s.tl });
    expect([unknown.status, unknown.body]).toEqual([404, { ...none.body, requestId: unknown.body.requestId }]);
    expect((await send("POST", S, { session: x.s.tl, body: { durationWorkingDays: 3 } })).status).toBe(201);
    expect((await send("GET", S, { session: x.s.tl })).status).toBe(200);
    for (const who of ["admin", "outsider"] as const) {
      const r = await send("GET", S, { session: x.s[who] });
      expect([r.status, r.body], who).toEqual([404, { ...none.body, requestId: r.body.requestId }]);
    }
    expect((await send("GET", "/api/v1/initiatives/not-a-uuid/schedule", { session: x.s.tl })).status).toBe(400);
    expect((await send("GET", S)).status).toBe(401);
  });
});
