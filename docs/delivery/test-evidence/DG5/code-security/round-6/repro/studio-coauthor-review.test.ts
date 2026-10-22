// code-security-reviewer DG5 round 1 reproduction (NOT product code; run only in a disposable clone, copied to
// apps/api/test/integration/methodology/zz-sec-r1-coauthor-review.test.ts). Synthetic data only.
//
// Claim: ADR-0039 §5 / REQ-S06-007 "review where configured" — the reviewer is never the author ("You cannot review a
// configuration change you authored or requested."). The API refusal (methodology/reviews.ts decideReview, line 333)
// and the 0062 trigger (config_review_request_reviewer_not_author) compare the decider with the requester and with
// `methodology_version.created_by` ONLY. Any methodology.configure holder may rewrite another admin's draft
// (PATCH updateConfigDraft, PUT elements). A second methodology admin who also holds the configured reviewer role (TO)
// can therefore write the content of another admin's draft, let the creator submit it, approve the review of the
// content they wrote, and publish it: the content is published with no independent review.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

let api: TestApi;
let w: World;
let creator: Session;
let coAuthor: Session;
let coAuthorId: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  creator = await signIn(api.app, a.subject);
  // The co-author: ADM_METHOD and TO, both at organization scope (no rule forbids holding both).
  const c = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, c.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  coAuthorId = c.id;
  coAuthor = await signIn(api.app, c.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const versionOf = async (id: string): Promise<number> =>
  (await call<Body>(api.app, "GET", `${V}/${id}`, { session: creator })).body.version;

const WEIGHTS = [
  ["strategic_fit", "25"],
  ["financial_value", "25"],
  ["feasibility", "20"],
  ["customer_impact", "15"],
  ["time_to_value", "15"],
];

describe("SEC-R1 repro: a co-author reviews and publishes the content they wrote", () => {
  it("the co-author's approval of their own content should be 403 config_review.self_review", async () => {
    const base = await seedStudioBase(
      api,
      "scoring_defaults",
      WEIGHTS.map(([k, p]) => ({ elementType: "scoring_weight", stableKey: k!, attributes: { weightPercent: p } })),
    );
    const created = await call<Body>(api.app, "POST", V, { session: creator, body: { basedOnVersionId: base.id } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    console.log("draft createdBy is creator:", created.body.createdBy !== coAuthorId);

    // 1. The co-author rewrites the draft's content: two weights moved (still 100 %) and the title.
    const w1 = await call<Body>(api.app, "PUT", `${V}/${id}/elements/scoring_weight/feasibility`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: { attributes: { weightPercent: "30" } },
    });
    const w2 = await call<Body>(api.app, "PUT", `${V}/${id}/elements/scoring_weight/strategic_fit`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: { attributes: { weightPercent: "15" } },
    });
    const edit = await call<Body>(api.app, "PATCH", `${V}/${id}`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
      body: { titleEn: "Co-author rewritten defaults", changeSummary: "content written by the co-author" },
    });
    console.log("co-author PUT/PUT/PATCH", w1.status, w2.status, edit.status, "updatedBy=co-author:", edit.body?.updatedBy === coAuthorId);
    expect([w1.status, w2.status, edit.status]).toEqual([200, 200, 200]);

    // 2. The creator previews, checks compatibility and submits the review (the creator never edits the content).
    const pv = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
      session: creator,
      headers: ifm(await versionOf(id)),
      body: { samples: [] },
    });
    const cc = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
      session: creator,
      headers: ifm(await versionOf(id)),
    });
    const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
      session: creator,
      headers: ifm(await versionOf(id)),
      body: {},
    });
    console.log("creator preview/compat/submit", pv.status, pv.body?.result, cc.status, cc.body?.result, sub.status);
    expect(sub.status).toBe(201);

    // 3. The co-author decides the review of the content they wrote.
    const d = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
      session: coAuthor,
      headers: ifm(1),
      body: { outcome: "approve" },
    });
    console.log("co-author review decision", d.status, d.body?.code ?? d.body?.status);

    // 4. ...and publishes it.
    const pub = await call<Body>(api.app, "POST", `${V}/${id}/publish`, {
      session: coAuthor,
      headers: ifm(await versionOf(id)),
    });
    console.log("co-author publish", pub.status, pub.body?.code ?? pub.body?.status);

    // The SoD rule ("never the author") expects 403 config_review.self_review at step 3.
    expect([d.status, d.body?.code]).toEqual([403, "config_review.self_review"]);
  });
});
