// code-security-reviewer drill a26 reproduction (synthetic data only). Copy into apps/api/test/integration/ of a
// DISPOSABLE clone and run with tests/qa/support/with-pg.sh npx vitest run --project integration <file>.
// Expected (secure behaviour): read-only roles (AUD, TO, TL) get 403 on PATCH /api/v1/business-units/:id, nothing
// changes, and an authorization.denied is audited. Only business_unit.manage holders (ADM_TECH) may update.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../support/harness.ts";

let api: TestApi;
let w: World;
let auditor: Session;
let office: Session;
let leadA1: Session;
let admin: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  leadA1 = await signIn(api.app, w.leadA1.subject);
  admin = await signIn(api.app, w.admin.subject);
});
afterAll(() => api.close());

const etagOf = async (s: Session, id: string) =>
  (await call(api.app, "GET", `/api/v1/business-units/${id}`, { session: s })).headers["etag"] as string;

describe("drill a26: business-unit update requires business_unit.manage", () => {
  it("read-only auditor (AUD @ org A) cannot rename or deactivate a business unit", async () => {
    const etag = await etagOf(auditor, w.a1);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1}`, {
      session: auditor,
      headers: { "if-match": etag },
      body: { nameEn: "Renamed by auditor", status: "inactive" },
    });
    expect(res.status).toBe(403);
  });

  it("transformation office (TO, no business_unit.manage) cannot rename a business unit", async () => {
    const etag = await etagOf(office, w.a2);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a2}`, {
      session: office,
      headers: { "if-match": etag },
      body: { nameEn: "Renamed by TO" },
    });
    expect(res.status).toBe(403);
  });

  it("team lead scoped to BU a1 cannot rename its own unit", async () => {
    const etag = await etagOf(leadA1, w.a1);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1}`, {
      session: leadA1,
      headers: { "if-match": etag },
      body: { nameAr: "معدل" },
    });
    expect(res.status).toBe(403);
  });

  it("control: ADM_TECH (business_unit.manage) can update", async () => {
    const etag = await etagOf(admin, w.a1x);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
      session: admin,
      headers: { "if-match": etag },
      body: { nameEn: "Renamed by admin" },
    });
    expect(res.status).toBe(200);
  });
});
