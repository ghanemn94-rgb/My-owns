// code-security-reviewer DG5 round-1 probe (T-DG5-REV-SEC-R1). NOT part of the candidate: copied at run time into the
// disposable clone as apps/api/test/integration/methodology/zz-sec-probe-coauthor.test.ts and removed afterwards.
// Question: ADR-0039 §5 / REQ-S06-007 "review where configured" - can a user who EDITED a draft (a co-author) decide
// that draft's review, when somebody else created it and somebody else submitted it?
// Setup: admin A (ADM_METHOD) creates the draft; user U (ADM_METHOD + TO) edits the draft's title; A previews and
// submits; U decides. A probe PASSES when it records the behaviour; the assertions print what happened.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
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
  const u = await methodologyAdmin(api.db, w);
  await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bothId = u.id;
  both = await signIn(api.app, u.subject);
  // a second, independent TO so that a review request has more than one possible reviewer
  const r = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, r.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;

describe("SEC-PROBE co-author self-review", () => {
  it("a co-author (edited the draft, did not create or submit it) decides the review", async () => {
    const base = await seedStudioBase(api, "methodology");
    const created = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // U, the co-author, changes the draft's content.
    const edit = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: both,
      headers: ifm(await versionOf(id)),
      body: { titleEn: "Edited by the co-author U" },
    });
    console.log("[probe] co-author edit:", edit.status, edit.body?.updatedBy ?? "", edit.body?.titleEn ?? "");
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
    const dec = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
      session: both,
      headers: ifm(1),
      body: { outcome: "approve", note: "co-author approving own edit (synthetic probe)" },
    });
    console.log("[probe] co-author decision:", dec.status, dec.body?.code ?? dec.body?.status, "decidedBy=", dec.body?.decidedBy, "U=", bothId);
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_user_id"])
      .where("record_id", "=", id)
      .orderBy("occurred_at")
      .execute()
      .catch(() => []);
    console.log("[probe] draft audit trail:", JSON.stringify(audit));
    // Record the observed outcome (the probe is a measurement, not a gate).
    expect([200, 403]).toContain(dec.status);
  });
});
