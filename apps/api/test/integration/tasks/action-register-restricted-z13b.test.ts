// T-DG6-BE-Z13B (D-227 (3); D-218, D-222 (1); ADR-0051 §2, §3; REQ-S10-002 "a sensitive benefit is hidden from a
// workstream member without the grant"): an action on a corrective case of a sensitive benefit. The action register keeps
// the action (sourceKind "corrective_case", correctiveCaseId null, the marker; BE-Z12), but the owner's task and its
// notification (raid/actions.ts: messageParams `{sourceCode: <case code>}`, link `/action-register/<actionId>`) are about
// the case: for an owner who is not admitted, every response that serializes them shows the inbox's `inbox.restricted`
// text with params {}, no subject id, the transformation home as link and `includesRestrictedRecords: true`
// (listMyWorkItems, getWorkItem, the My Work page `/me/work`, listMyInbox). Producers are real: the worker's corrective
// consumer creates the case from a variance event; TL creates the action through createCorrectiveCaseAction.
// Positive: after an explicit grant the owner sees the case code and the action link again; an action on an open
// RAID entry is never redacted. Authorization: the owner cannot open the restricted case (404).
// Every value is SYNTHETIC. Marking a record sensitive or granting access is an access decision, never a business or
// Finance approval (G1-G6), and nothing here touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleBenefitVariance } from "../../../../worker/src/handlers/raid.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ A: marks records and grants
const S = { benefit: "", caseId: "", caseCode: "", actionId: "", workItemId: "", notificationId: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (r: { status: number; body: Body }, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};
const home = () => `/transformations/${b.transformationId}`;

async function grantTo(userId: string) {
  ok(
    await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: S.benefit,
        granteeUserId: userId,
        reason: "Synthetic need to know (BE-Z13B action register)",
      },
    }),
    201,
  );
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const hidden = await benefitAt(api, b, "measure");
  S.benefit = hidden.id;
  // The worker's corrective consumer opens the variance case (real producer).
  const r = await handleBenefitVariance(
    api.db,
    {
      outboxEventId: randomUUID(),
      eventType: "benefit.variance_evaluated",
      schemaVersion: 1,
      idempotencyKey: `benefit.variance_evaluated:z13b-${randomUUID()}`,
      organizationId: b.organizationId,
      payload: {
        benefitId: S.benefit,
        measurementId: randomUUID(),
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        plannedAmount: "100000.0000",
        measuredAmount: "80000.0000",
        variance: "-20000.0000",
        offTrack: true,
      },
    },
    "z13b-variance",
  );
  expect(r.signal).toMatchObject({ outcome: "case_created" });
  const c = await api.db
    .selectFrom("corrective_case")
    .select(["id", "code"])
    .where("benefit_id", "=", S.benefit)
    .executeTakeFirstOrThrow();
  S.caseId = c.id;
  S.caseCode = c.code;
  ok(
    await send("PUT", `${b.base}/records/benefit/${S.benefit}/sensitivity`, {
      session: office,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13B action register)" },
    }),
  );
  // TL is admitted (explicit grant) and creates the action on the case, owned by a second BO (bo2), who is not a party of the benefit and holds no grant.
  await grantTo(b.users.tl.id);
  const action = ok(
    await send("POST", `${b.base}/corrective-actions/${S.caseId}/actions`, {
      session: b.s.tl,
      body: { title: "Synthetic recovery step (BE-Z13B)", ownerUserId: b.users.bo2.id, dueDate: "2027-01-15" },
    }),
    201,
  );
  S.actionId = action.id;
  const item = await api.db
    .selectFrom("work_item")
    .selectAll()
    .where("subject_type", "=", "action_item")
    .where("subject_id", "=", S.actionId)
    .where("assignee_user_id", "=", b.users.bo2.id)
    .executeTakeFirstOrThrow();
  S.workItemId = item.id;
  // The stored task names the case code and the action link (the producer is unchanged; the view is redacted).
  expect(item.message_params).toEqual({ sourceCode: S.caseCode });
  expect(item.link_path).toBe(`${home()}/action-register/${S.actionId}`);
  const n = await api.db
    .selectFrom("inbox_notification")
    .select("id")
    .where("work_item_id", "=", S.workItemId)
    .executeTakeFirstOrThrow();
  S.notificationId = n.id;
}, 180_000);
afterAll(async () => {
  await api?.close();
});

describe("D-227 (3): the task and notification of an action on a restricted corrective case", () => {
  it("control: the owner (bo2) gets 404 on the case; the register row keeps the action without the case id", async () => {
    expect((await send("GET", `${b.base}/corrective-actions/${S.caseId}`, { session: b.s.bo2 })).status).toBe(404);
    const register = ok(await send("GET", `${b.base}/action-register?limit=100`, { session: b.s.bo2 }));
    const row = register.items.find((a: Body) => a.id === S.actionId);
    expect(row).toMatchObject({
      sourceKind: "corrective_case",
      correctiveCaseId: null,
      includesRestrictedRecords: true,
    });
    const one = ok(await send("GET", `${b.base}/action-register/${S.actionId}`, { session: b.s.bo2 }));
    expect(one).toMatchObject({ correctiveCaseId: null, includesRestrictedRecords: true });
    for (const body of [register, one]) {
      expect(JSON.stringify(body)).not.toContain(S.caseId);
      expect(JSON.stringify(body)).not.toContain(S.caseCode);
    }
  });

  it("listMyWorkItems and getWorkItem: inbox.restricted, params {}, no subject id, home link, the marker", async () => {
    const list = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: b.s.bo2 }));
    const item = list.items.find((x: Body) => x.id === S.workItemId);
    expect(item).toMatchObject({
      messageKey: "inbox.restricted",
      messageParams: {},
      subjectType: "action_item",
      subjectId: null,
      linkPath: home(),
      includesRestrictedRecords: true,
    });
    const one = ok(await send("GET", `/api/v1/work-items/${S.workItemId}`, { session: b.s.bo2 }));
    expect(one).toMatchObject({ messageKey: "inbox.restricted", subjectId: null, linkPath: home() });
    for (const body of [list, one]) {
      expect(JSON.stringify(body)).not.toContain(S.caseCode);
      expect(JSON.stringify(body)).not.toContain(S.actionId);
      expect(JSON.stringify(body)).not.toContain("/action-register/");
    }
  });

  it("the My Work page (/me/work): no case code, no record id, the home link, the marker", async () => {
    const page = ok(await send("GET", "/api/v1/me/work", { session: b.s.bo2 }));
    const text = JSON.stringify(page);
    expect(text).toContain('"includesRestrictedRecords":true');
    expect(text).not.toContain(S.caseCode);
    expect(text).not.toContain(S.actionId);
    expect(text).not.toContain("/action-register/");
  });

  it("listMyInbox: the notification of the task is redacted the same way", async () => {
    const inbox = ok(await send("GET", "/api/v1/me/inbox?limit=100", { session: b.s.bo2 }));
    const n = inbox.items.find((x: Body) => x.id === S.notificationId);
    expect(n).toMatchObject({
      messageKey: "inbox.restricted",
      messageParams: {},
      linkPath: home(),
      includesRestrictedRecords: true,
    });
    expect(JSON.stringify(inbox)).not.toContain(S.caseCode);
    expect(JSON.stringify(inbox)).not.toContain("/action-register/");
  });

  it("an action on an open RAID entry is never redacted (negative control)", async () => {
    const raid = ok(
      await send("POST", `${b.base}/raid`, {
        session: b.s.tl,
        body: {
          type: "risk",
          description: "Synthetic open risk (BE-Z13B)",
          impact: "medium",
          probability: "medium",
          ownerUserId: b.users.tl.id,
        },
      }),
      201,
    );
    const action = ok(
      await send("POST", `${b.base}/raid/${raid.id}/actions`, {
        session: b.s.tl,
        body: { title: "Synthetic mitigation (BE-Z13B)", ownerUserId: b.users.bo2.id, dueDate: "2027-01-20" },
      }),
      201,
    );
    const list = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: b.s.bo2 }));
    const item = list.items.find((x: Body) => x.subjectId === action.id);
    expect(item).toMatchObject({ messageParams: { sourceCode: raid.code } });
    expect(item).not.toHaveProperty("includesRestrictedRecords");
  });

  it("after an explicit grant the owner sees the case code and the action link again", async () => {
    await grantTo(b.users.bo2.id);
    const list = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: b.s.bo2 }));
    expect(list.items.find((x: Body) => x.id === S.workItemId)).toMatchObject({
      messageParams: { sourceCode: S.caseCode },
      subjectId: S.actionId,
      linkPath: `${home()}/action-register/${S.actionId}`,
    });
    const inbox = ok(await send("GET", "/api/v1/me/inbox?limit=100", { session: b.s.bo2 }));
    expect(inbox.items.find((x: Body) => x.id === S.notificationId)).not.toHaveProperty("includesRestrictedRecords");
  });
});
