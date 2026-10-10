// getAdoptionMetricLink against a real PostgreSQL (T-DG4-KBE-R2; ADR-0033 amendment A2 of 2026-10-09; ARCH-R1 item 2;
// REQ-S16-020 AdoptionMetricLink):
//  - the Location header of createAdoptionMetricLink now resolves: GET on it answers 200 with the created link and
//    its ETag, equal to the create's body;
//  - the read returns an active and a removed link (status, removedAt, removedBy, version and ETag after the removal);
//  - transformation.read: TL, BO and AUD 200; ADM-only and outsiders 404; a link of another transformation 404 under
//    this transformation; an unknown id 404; a malformed id or an unknown query parameter 400;
//  - the read writes nothing (the link's audit trail and version are unchanged).
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
}, 120_000);
afterAll(async () => {
  await api.close();
});

describe("getAdoptionMetricLink (ADR-0033 amendment A2)", () => {
  it("the create's Location resolves to 200 with the same link and ETag; active and removed links are readable", async () => {
    const created = await call(api.app, "POST", `${b.base}/adoption-metric-links`, {
      session: b.s.tl,
      body: { templateKey: "training_completion", targetKind: "transformation" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const location = created.headers.location as string;
    expect(location).toBe(`${b.base}/adoption-metric-links/${created.body.id}`);

    const read = await call(api.app, "GET", location, { session: b.s.tl });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.headers.etag).toBe('"1"');
    expect(read.body).toEqual(created.body);

    for (const session of [b.s.bo, b.s.auditor]) {
      const r = await call(api.app, "GET", location, { session });
      expect([r.status, r.body.id]).toEqual([200, created.body.id]);
    }

    // The read writes nothing.
    const auditBefore = await auditOf(api.db, created.body.id);
    await call(api.app, "GET", location, { session: b.s.auditor });
    expect(await auditOf(api.db, created.body.id)).toEqual(auditBefore);

    // A removed link stays readable, with its new version and ETag.
    const removed = await call(api.app, "POST", `${location}/remove`, { session: b.s.tl, headers: ifm(1) });
    expect([removed.status, removed.body.status], JSON.stringify(removed.body)).toEqual([200, "removed"]);
    const afterRemove = await call(api.app, "GET", location, { session: b.s.auditor });
    expect(afterRemove.status).toBe(200);
    expect(afterRemove.headers.etag).toBe('"2"');
    expect(afterRemove.body).toEqual(removed.body);
    expect(afterRemove.body).toMatchObject({ status: "removed", version: 2, removedBy: b.users.tl.id });
    expect(afterRemove.body.removedAt).not.toBeNull();
  });

  it("ADM-only callers, outsiders, another transformation's path and unknown ids get 404; malformed input 400", async () => {
    const created = await call(api.app, "POST", `${b.base}/adoption-metric-links`, {
      session: b.s.tl,
      body: { templateKey: "observed_proficiency", targetKind: "transformation" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const location = created.headers.location as string;
    for (const session of [b.s.admin, b.s.outsider]) {
      const r = await call(api.app, "GET", location, { session });
      expect([r.status, r.body.code], JSON.stringify(r.body)).toEqual([404, "not_found"]);
    }
    // The other transformation's TL reads that transformation, but the link is not one of its links.
    const cross = await call(api.app, "GET", `${other.base}/adoption-metric-links/${created.body.id}`, {
      session: other.s.tl,
    });
    expect([cross.status, cross.body.code]).toEqual([404, "not_found"]);
    const unknown = await call(api.app, "GET", `${b.base}/adoption-metric-links/00000000-0000-7000-8000-000000000000`, {
      session: b.s.tl,
    });
    expect(unknown.status).toBe(404);
    expect((await call(api.app, "GET", `${b.base}/adoption-metric-links/not-a-uuid`, { session: b.s.tl })).status).toBe(
      400,
    );
    expect((await call(api.app, "GET", `${location}?other=1`, { session: b.s.tl })).status).toBe(400);
    expect((await call(api.app, "GET", location)).status).toBe(401);
  });
});
