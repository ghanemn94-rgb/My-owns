// code-security-reviewer DG5 round-1 probe (T-DG5-REV-SEC-R1B). NOT part of the candidate: copied into the disposable
// clone at apps/api/test/integration/methodology/ and run there against a disposable PostgreSQL.
// Question: ADR-0039 §5 "the reviewer is never the requester nor the draft's author". The check is on
// methodology_version.created_by only. Can a user who EDITED the draft (but did not create it or request its review)
// decide its review? The user holds ADM_METHOD + TO (the dual role the shipped test already uses).
// Synthetic data only; a configuration review approves nothing in the business; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

let api: TestApi;
let w: World;
let admin: Session;
let both: Session;
let bothId: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  admin = await signIn(api.app, a.subject);
  const b = await methodologyAdmin(api.db, w);
  await grant(api.db, w.grantor.id, b.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bothId = b.id;
  both = await signIn(api.app, b.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;

describe("SEC probe: co-editor deciding the configuration review", () => {
  it("a user who edited the draft (not its creator, not the requester) decides its review", async () => {
    const base = await seedStudioBase(api, "methodology");
    const created = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // The co-editor changes the draft's content.
    const edit = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: both,
      headers: ifm(await versionOf(id)),
      body: { titleEn: "Edited by the co-editor (synthetic)" },
    });
    console.log("co-editor PATCH", edit.status, edit.body?.code ?? "", "updatedBy", edit.body?.updatedBy);
    expect(edit.status).toBe(200);
    const pv = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
      session: admin,
      headers: ifm(await versionOf(id)),
      body: { samples: [] },
    });
    expect(pv.status).toBe(201);
    const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
      session: admin,
      headers: ifm(await versionOf(id)),
      body: {},
    });
    expect(sub.status).toBe(201);
    const d = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
      session: both,
      headers: ifm(1),
      body: { outcome: "approve", note: "co-editor approves own edit (synthetic)" },
    });
    console.log("co-editor DECISION", d.status, d.body?.code ?? "", "decidedBy", d.body?.decidedBy, "coEditor", bothId);
    // Separation of duties as the reviewer reads ADR-0039 §5: the person who wrote the change must not approve it.
    expect([d.status, d.body?.code]).toEqual([403, "config_review.self_review"]);
  });
});
