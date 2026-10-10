// getBenefitPlanValue (T-DG4-KBE-R3; ARCH-R2 item 4; ADR-0030 amendment P1 of 2026-10-10). Proves, against the run's
// disposable PostgreSQL and the real server that `startApi()` builds (src/server.ts's `buildServer`; nothing here
// registers a route or wires a port by hand, D-107):
//  - createBenefitPlanValue's `Location` resolves: GET on it answers 200 with the same record (version, note,
//    valueKind) and `ETag` = the row's version;
//  - the edit flow of P1: the ETag of the read is the `If-Match` updateBenefitPlanValue accepts; after the update the
//    read returns the new version and ETag; a stale ETag is the 409 version conflict and a re-read shows the current
//    version;
//  - transformation.read: AUD reads (200); a user outside the transformation gets 404; an id that is not a
//    benefit_plan_value row of THAT transformation (another transformation's plan value, a benefit id, a random id) is
//    404; a malformed id is 400 validation;
//  - a read writes nothing: no audit event for the record beyond its create and update.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { benefitAt, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import type { Body } from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const PV = (world: BenefitWorld, id: string) => `${world.base}/benefit-plan-values/${id}`;

async function planValue(world: BenefitWorld, periodStart: string, note: string | null = "Synthetic plan") {
  const ben = await benefitAt(api, world, "plan", financialBody(world));
  const r = await call<Body>(api.app, "POST", `${world.base}/benefits/${ben.id}/plan-values`, {
    session: world.s.bo,
    body: {
      valueKind: "forecast",
      periodStart,
      periodEnd: periodStart.replace(/-01$/, "-28"),
      amount: "1250.5",
      ...(note === null ? {} : { note }),
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { benefitId: ben.id, created: r };
}

describe("getBenefitPlanValue (ADR-0030 amendment P1)", () => {
  it("the real server routes it: createBenefitPlanValue's Location resolves to the record with its version and ETag", async () => {
    expect(
      api.routes.some(
        (r) =>
          r.method === "GET" &&
          r.url === "/api/v1/transformations/:transformationId/benefit-plan-values/:benefitPlanValueId",
      ),
    ).toBe(true);
    const { benefitId, created } = await planValue(b, "2036-03-01");
    const location = created.headers.location as string;
    expect(location).toBe(PV(b, created.body.id));
    const r = await call<Body>(api.app, "GET", location, { session: b.s.bo });
    expect([r.status, r.headers.etag]).toEqual([200, '"1"']);
    expect(r.body).toEqual(created.body);
    expect(r.body).toMatchObject({
      id: created.body.id,
      benefitId,
      valueKind: "forecast",
      periodStart: "2036-03-01",
      periodEnd: "2036-03-28",
      amount: "1250.5000",
      kpiValue: null,
      currency: "SAR",
      note: "Synthetic plan",
      version: 1,
    });
  });

  it("the edit flow: the read's ETag is the If-Match of the update; a stale ETag is 409 and a re-read shows the current version", async () => {
    const { created } = await planValue(b, "2036-04-01");
    const url = PV(b, created.body.id);
    const first = await call<Body>(api.app, "GET", url, { session: b.s.tl });
    expect(first.status).toBe(200);
    const u = await call<Body>(api.app, "PATCH", url, {
      session: b.s.bo,
      headers: { "if-match": first.headers.etag as string },
      body: { amount: "1300", note: "Synthetic revised" },
    });
    expect([u.status, u.body.version, u.headers.etag]).toEqual([200, 2, '"2"']);
    const second = await call<Body>(api.app, "GET", url, { session: b.s.auditor });
    expect([second.status, second.headers.etag, second.body.version, second.body.amount, second.body.note]).toEqual([
      200,
      '"2"',
      2,
      "1300.0000",
      "Synthetic revised",
    ]);
    expect(second.body).toEqual(u.body);
    const stale = await call<Body>(api.app, "PATCH", url, {
      session: b.s.bo,
      headers: { "if-match": first.headers.etag as string },
      body: { amount: "1" },
    });
    expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "version_conflict", 2]);
    const third = await call<Body>(api.app, "GET", url, { session: b.s.bo });
    expect([third.headers.etag, third.body.amount]).toEqual(['"2"', "1300.0000"]);
    // A read writes nothing: the record's audit trail is its create and its one update.
    expect((await auditOf(api.db, created.body.id)).map((e) => e.action)).toEqual([
      "benefit_plan_value.create",
      "benefit_plan_value.update",
    ]);
  });

  it("transformation.read: AUD reads; outside the scope, another transformation's id, a benefit id or a random id are 404; a malformed id is 400", async () => {
    const { benefitId, created } = await planValue(b, "2036-05-01", null);
    const url = PV(b, created.body.id);
    const aud = await call<Body>(api.app, "GET", url, { session: b.s.auditor });
    expect([aud.status, aud.body.note]).toEqual([200, null]);
    expect((await call<Body>(api.app, "GET", url, { session: b.s.fin })).status).toBe(200);
    const outsider = await call<Body>(api.app, "GET", url, { session: b.s.outsider });
    expect([outsider.status, outsider.body.code]).toEqual([404, "not_found"]);
    // The same id under another transformation the caller can read: not a plan value of THAT transformation.
    const elsewhere = await call<Body>(api.app, "GET", PV(other, created.body.id), { session: other.s.bo });
    expect([elsewhere.status, elsewhere.body.code]).toEqual([404, "not_found"]);
    // Another transformation's own plan value is readable there, and not here.
    const theirs = await planValue(other, "2036-06-01");
    expect((await call(api.app, "GET", PV(other, theirs.created.body.id), { session: other.s.bo })).status).toBe(200);
    expect((await call(api.app, "GET", PV(b, theirs.created.body.id), { session: b.s.auditor })).status).toBe(404);
    expect((await call(api.app, "GET", PV(b, benefitId), { session: b.s.bo })).status).toBe(404);
    expect(
      (await call(api.app, "GET", PV(b, "0192f000-0000-7000-8000-000000000000"), { session: b.s.bo })).status,
    ).toBe(404);
    const malformed = await call<Body>(api.app, "GET", PV(b, "not-a-uuid"), { session: b.s.bo });
    expect([malformed.status, malformed.body.code]).toEqual([400, "validation"]);
    expect((await call(api.app, "GET", url)).status).toBe(401);
    expect((await auditOf(api.db, created.body.id)).map((e) => e.action)).toEqual(["benefit_plan_value.create"]);
  });
});
