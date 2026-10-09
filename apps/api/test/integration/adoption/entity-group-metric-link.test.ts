// REQ-S16-020 entity group, the AdoptionMetricLink case (T-DG4-KBE-F; D-102 item 3; ADR-0033 §11): "an integration test
// creates and reads each one through the API with authorization enforced". BE-H2's entity-group.test.ts covers
// StakeholderGroup, AdoptionIntervention and the training and assessment records; this file covers the link:
//  - create (adoption.edit) and read (list, by target) through the API, with primary key, owner (created_by) and status;
//  - AUD 403 on the write (nothing written);
//  - 404 outside scope: an ADM-only caller and a user of another organization, on the write and on the read.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let admin: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
}, 120_000);
afterAll(async () => {
  await api.close();
});

describe("REQ-S16-020 AdoptionMetricLink: create and read through the API with authorization enforced", () => {
  it("creates and reads a link (key, owner, status); AUD 403 on the write; 404 outside scope", async () => {
    const LINKS = `${b.base}/adoption-metric-links`;
    const body = { templateKey: "observed_proficiency", targetKind: "transformation" };

    const aud = await call(api.app, "POST", LINKS, { session: b.s.auditor, body });
    expect(aud.status).toBe(403);
    for (const session of [admin, b.s.outsider]) {
      expect((await call(api.app, "POST", LINKS, { session, body })).status).toBe(404);
      expect((await call(api.app, "GET", LINKS, { session })).status).toBe(404);
    }
    expect(
      await api.db
        .selectFrom("adoption_metric_link")
        .select("id")
        .where("transformation_id", "=", b.transformationId)
        .execute(),
    ).toHaveLength(0);

    const created = await call(api.app, "POST", LINKS, { session: b.s.tl, body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.location).toBe(`${LINKS}/${created.body.id}`);
    expect(created.body).toMatchObject({
      transformationId: b.transformationId,
      templateKey: "observed_proficiency",
      kpiDefinitionId: null,
      targetKind: "transformation",
      targetId: b.transformationId,
      status: "active",
      createdBy: b.users.tl.id,
      version: 1,
    });

    for (const session of [b.s.auditor, b.s.bo, b.s.tl]) {
      const read = await call(api.app, "GET", `${LINKS}?targetKind=transformation`, { session });
      expect(read.status).toBe(200);
      expect(read.body.items.map((l: { id: string }) => l.id)).toEqual([created.body.id]);
    }
    const row = await api.db
      .selectFrom("adoption_metric_link")
      .select(["id", "created_by", "status"])
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ id: created.body.id, created_by: b.users.tl.id, status: "active" });
  });
});
