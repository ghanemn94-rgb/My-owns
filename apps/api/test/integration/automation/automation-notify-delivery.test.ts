// The automation `notify` action under the notification policy (D-153 a; ADR-0044 §5 "called ... by the notify /
// escalate actions"; ADR-0043 §2; T-DG5-BE-L2) against a real PostgreSQL, driven as the relay would deliver the outbox
// envelope to automation.evaluate:
//  - a rule with a notify action produces exactly ONE policy-governed notification per recipient: a recipient with no
//    preference and no policy gets it delivered at once (DG4 behaviour); a recipient whose quiet hours cover now and
//    whose digest is daily gets it HELD until the next digest time (never dropped, never delivered early), and the
//    digest job then releases it inside one digest;
//  - the same event x3 creates nothing more (one execution, one notify result, one notification per recipient);
//  - the execution log records the outcome (execution succeeded; the notify action result `done`, then nothing new);
//  - opting out of a kind: the P5 policy has no per-kind opt-out (ADR-0044 §5's four settings: business-day timing,
//    quiet hours, digest, urgent escalation), so there is no recipient who "receives none"; the test pins that every
//    planned recipient receives exactly one row. Recorded in the T-DG5-BE-L2 handback as a schema/decision need.
// Synthetic people and data. No rule decides anything: the action creates notifications only.
import { wallClockOf } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTIFY_DELIVERY_KIND } from "../../../../worker/src/automation/actions/notify.ts";
import { runDigestWindow } from "../../../../worker/src/handlers/digests.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let office: Session;
let tx: string;
let plain: { id: string; session: Session };
let quiet: { id: string; session: Session };

const R = "/api/v1/admin/automation-rules";
const PREFS = "/api/v1/me/notification-preferences";
const RIYADH = "Asia/Riyadh";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

async function tl(): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: tx }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  plain = await tl();
  quiet = await tl();
  // Quiet hours two hours either side of the real clock (Asia/Riyadh), digest daily three hours from now.
  const now = wallClockOf(new Date(), RIYADH).minutes;
  const put = await call<Body>(api.app, "PUT", PREFS, {
    session: quiet.session,
    headers: ifm(0),
    body: {
      quietHoursStart: timeOf(now - 120),
      quietHoursEnd: timeOf(now + 120),
      digestMode: "daily",
      digestTime: timeOf(now + 180),
    },
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
}, 60_000);
afterAll(() => api.close());

const gateDecidedPayload = (transformationId: string) => ({
  gateInstanceId: crypto.randomUUID(),
  transformationId,
  gateCode: "G3",
  submissionId: crypto.randomUUID(),
  submissionNo: 1,
  gateDecisionId: crypto.randomUUID(),
  outcome: "approved",
  decidedBy: crypto.randomUUID(),
  nextPhase: null,
  scaleScopeItemIds: [],
  conditionIds: [],
});
const envelope = (payload: Record<string, unknown>) => ({
  outboxEventId: crypto.randomUUID(),
  eventType: "gate.decided",
  schemaVersion: 1,
  idempotencyKey: `gate.decided:${crypto.randomUUID()}`,
  organizationId: w.orgA.id,
  payload,
});
const evaluate = AUTOMATION_HANDLERS.find((h) => h.queue === "automation.evaluate")!;

/** A transformation-scoped admin rule with one notify action to TL, published and enabled through the API. */
async function notifyRule(): Promise<{ id: string; code: string }> {
  const code = `notify.${uniq("n").toLowerCase()}`;
  const created = await call<Body>(api.app, "POST", R, {
    session: admin,
    body: {
      code,
      nameEn: "Synthetic notify rule",
      nameAr: "قاعدة إشعار تجريبية",
      scopeLevel: "transformation",
      organizationId: w.orgA.id,
      transformationId: tx,
      ownerUserId: adminId,
      content: {
        triggerCodes: ["gate.decided"],
        actions: [{ type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } }],
        runAs: "service",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const v1 = `${R}/${id}/versions/1`;
  const run = await call<Body>(api.app, "POST", `${v1}/dry-runs`, {
    session: admin,
    body: { triggerCode: "gate.decided", payload: gateDecidedPayload(tx) },
  });
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  expect((await call(api.app, "POST", `${v1}/submit`, { session: admin, headers: ifm(1) })).status).toBe(200);
  const reviewed = await call(api.app, "POST", `${v1}/review`, {
    session: office,
    headers: ifm(2),
    body: { outcome: "approve" },
  });
  expect(reviewed.status).toBe(200);
  expect((await call(api.app, "POST", `${v1}/publish`, { session: admin, headers: ifm(1) })).status).toBe(200);
  expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(2) })).status).toBe(200);
  return { id, code };
}

const notesOf = (code: string, key: string) =>
  api.db
    .selectFrom("inbox_notification")
    .selectAll()
    .where("dedupe_key", "like", `automation:${code}:${key}:1:%`)
    .orderBy("recipient_user_id")
    .execute();

describe("D-153 (a): the notify action is delivered under the recipient's policy and preferences", () => {
  it("exactly one policy-governed notification per recipient; x3 replays create nothing; the execution log records the outcome", async () => {
    const rule = await notifyRule();
    const ev = envelope(gateDecidedPayload(tx));
    const before = Date.now();
    for (let i = 0; i < 3; i += 1) await evaluate.handle(api.db, ev, `job-notify-${i}`);
    await Promise.all([1, 2].map((i) => evaluate.handle(api.db, ev, `job-notify-c${i}`)));

    // The execution log: one succeeded execution of the rule for this trigger, one notify result `done`.
    const execs = await api.db
      .selectFrom("automation_execution")
      .selectAll()
      .where("automation_rule_id", "=", rule.id)
      .where("trigger_key", "=", ev.idempotencyKey)
      .execute();
    expect(execs.map((e) => e.status)).toEqual(["succeeded"]);
    const results = await api.db
      .selectFrom("automation_action_result")
      .selectAll()
      .where("automation_execution_id", "=", execs[0]!.id)
      .execute();
    expect(results.map((r) => [r.action_type, r.outcome])).toEqual([["notify", "done"]]);

    // Exactly one notification per recipient (the two TLs of this transformation).
    const notes = await notesOf(rule.code, ev.idempotencyKey);
    expect(notes.map((n) => n.recipient_user_id).sort()).toEqual([plain.id, quiet.id].sort());
    const byUser = new Map(notes.map((n) => [n.recipient_user_id, n] as const));
    // No preference and no policy: delivered at once (DG4 behaviour).
    expect(byUser.get(plain.id)).toMatchObject({ delivery_state: "delivered", deliver_after: null, urgency: "normal" });
    // Quiet hours now and a daily digest: held until the next digest time, after the quiet hours end.
    const held = byUser.get(quiet.id)!;
    expect([held.delivery_state, held.urgency]).toEqual(["held", "normal"]);
    expect(held.deliver_after!.getTime()).toBeGreaterThan(before + 60 * 60_000);
    // Audited with the delivery decision.
    const audit = await api.db.selectFrom("audit_event").selectAll().where("record_id", "=", held.id).execute();
    expect(audit.map((e) => e.action)).toEqual(["inbox_notification.create"]);
    expect(JSON.stringify(audit[0]!.changes)).toContain('"delivery_state":{"to":"held"');

    // The held row is not in the recipient's inbox yet; the digest job releases it into one digest.
    const inbox = await call<Body>(api.app, "GET", "/api/v1/me/inbox?limit=100", { session: quiet.session });
    expect((inbox.body.items as Body[]).map((n) => n.id)).not.toContain(held.id);
    const at = new Date(held.deliver_after!.getTime() + 1000);
    const run = await runDigestWindow(api.db, "job:be-l2-notify", at, { userIds: [quiet.id] });
    expect(run.users).toHaveLength(1);
    const after = await api.db
      .selectFrom("inbox_notification")
      .select("delivery_state")
      .where("id", "=", held.id)
      .executeTakeFirstOrThrow();
    expect(after.delivery_state).toBe("digested");
    expect(await notesOf(rule.code, ev.idempotencyKey)).toHaveLength(2);
  });

  it("the notify notification takes the normal urgency of the automation's work-item kind (never urgent-held)", async () => {
    const kind = await api.db
      .selectFrom("work_item_kind")
      .select("urgency")
      .where("code", "=", NOTIFY_DELIVERY_KIND)
      .executeTakeFirstOrThrow();
    expect(kind.urgency).toBe("normal");
  });
});
