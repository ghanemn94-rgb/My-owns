// T-DG5-BE-T5 (D-167; QA-E2 O-1; REQ-S18-002 "pending approval"): the seeded pending approval of the International
// Roaming demo dataset is routed to the demo role user its subject's rules name, so it opens from that user's inbox.
// The T04 design decision D-01 is asked through the T11 row "Target-state design", whose Approve party is BO; the BO
// party is mapped to roaming.user.bo. Against the REAL synthetic dataset (`seedDemo`) in a scratch database with the
// REAL API on it (MTH_ENV=demo):
//   - roaming.user.bo lists it in GET /approvals?role=assignee&status=pending, reads it, and has its approval_decision
//     task and inbox notification linking to it; no other demo role user lists it as assignee; the TL (the requester)
//     lists it as requester;
//   - it is a product record the product can act on: the BO decides it (a synthetic demo decision on demo data that
//     approves nothing real), with the stale-version and requester-excluded refusals of any approval.
// Everything is SYNTHETIC; nothing names the engineering gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { DEMO_PENDING_APPROVAL } from "../../../../../packages/db/src/demo/data/roaming-states.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const A = DEMO_PENDING_APPROVAL;
const ifm = (v: number) => ({ "if-match": `"${v}"` });

let api: TestApi;
let scratch: string | null = null;
const s: Record<string, Session> = {};
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const pendingAsAssignee = async (role: string) => {
  const r = await send("GET", "/api/v1/approvals?role=assignee&status=pending&limit=100", { session: s[role]! });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.items as Body[]).map((i) => i.id);
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_demo_pending_approval");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  for (const u of DEMO_USERS) s[u.role] = await signIn(api.app, u.name);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("QA-E2 O-1: the seeded pending approval is in the demo Business Owner's inbox", () => {
  it("the rules name BO: the T11 row's Approve party is BO and BO is mapped to roaming.user.bo", async () => {
    const bo = DEMO_USERS.find((u) => u.role === "BO")!;
    expect(A.assigneeUserId).toBe(bo.id);
    const right = await api.db
      .selectFrom("transformation_decision_right")
      .select(["template_key", "approve_party_code"])
      .where("id", "=", A.decisionRightId)
      .executeTakeFirstOrThrow();
    expect(right).toEqual({ template_key: "target_state_design", approve_party_code: "BO" });
    const mapping = await api.db
      .selectFrom("role_mapping")
      .select(["party_code", "target_kind", "user_id", "status"])
      .where(
        "transformation_id",
        "=",
        (
          await api.db
            .selectFrom("approval")
            .select("transformation_id")
            .where("id", "=", A.id)
            .executeTakeFirstOrThrow()
        ).transformation_id,
      )
      .execute();
    expect(mapping).toEqual([{ party_code: "BO", target_kind: "user", user_id: bo.id, status: "active" }]);
  });

  it("roaming.user.bo lists it as assignee (pending), reads it, and has its task and inbox notification", async () => {
    expect(await pendingAsAssignee("BO")).toContain(A.id);
    const one = await send("GET", `/api/v1/approvals/${A.id}`, { session: s["BO"]! });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body).toMatchObject({
      id: A.id,
      status: "pending",
      approvalType: "decision_request",
      assignee: { partyCode: "BO", userId: A.assigneeUserId, groupId: null },
    });
    const items = await send("GET", "/api/v1/me/work-items?kind=approval_decision&limit=100", { session: s["BO"]! });
    expect(items.status, JSON.stringify(items.body)).toBe(200);
    const task = (items.body.items as Body[]).find((i) => i.subjectId === A.id);
    expect(task, "the approval_decision task").toMatchObject({
      kind: "approval_decision",
      linkPath: `/my-work/approvals/${A.id}`,
      messageKey: "approvals.task.decide",
    });
    const inbox = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "link_path", "delivery_state"])
      .where("work_item_id", "=", task.id)
      .execute();
    expect(inbox).toEqual([
      { recipient_user_id: A.assigneeUserId, link_path: `/my-work/approvals/${A.id}`, delivery_state: "delivered" },
    ]);
  });

  it("no other demo role user lists it as assignee; the TL (the requester) lists it as requester", async () => {
    for (const u of DEMO_USERS.filter((x) => x.role !== "BO"))
      expect(await pendingAsAssignee(u.role), u.name).not.toContain(A.id);
    const mine = await send("GET", "/api/v1/approvals?role=requester&status=pending&limit=100", { session: s["TL"]! });
    expect(mine.status).toBe(200);
    expect((mine.body.items as Body[]).map((i) => i.id)).toContain(A.id);
  });

  it("the product acts on it: TL (the requester) is refused, a stale version is refused, the BO decides it", async () => {
    const one = (await send("GET", `/api/v1/approvals/${A.id}`, { session: s["BO"]! })).body;
    const body = (subjectVersion: number) => ({
      outcome: "approve",
      rationale: "Synthetic demo decision on demo data; approves nothing real.",
      subjectVersion,
    });
    const byRequester = await send("POST", `/api/v1/approvals/${A.id}/decisions`, {
      session: s["TL"]!,
      headers: ifm(one.version),
      body: body(1),
    });
    expect(byRequester.status, JSON.stringify(byRequester.body)).toBe(403);
    const stale = await send("POST", `/api/v1/approvals/${A.id}/decisions`, {
      session: s["BO"]!,
      headers: ifm(one.version),
      body: body(2),
    });
    expect([stale.status, stale.body.code]).toEqual([409, "approval.stale_version"]);
    const decided = await send("POST", `/api/v1/approvals/${A.id}/decisions`, {
      session: s["BO"]!,
      headers: ifm(one.version),
      body: body(1),
    });
    expect(decided.status, JSON.stringify(decided.body)).toBeLessThan(300);
    expect(await pendingAsAssignee("BO")).not.toContain(A.id);
  });
});
