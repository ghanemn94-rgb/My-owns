// The decision-SLA escalation job `governance.decision_sla_scan` (apps/worker/src/handlers/escalations.ts; ADR-0032 §7;
// REQ-S12-011; T-DG4-BE-G), driven with the worker's real handler on the API's database (the API harness builds the
// world through the API; the worker imports no API code, ADR-0002 rule 5). Proves:
//  - REQ-S12-011 A09: an ask whose SLA date is a working day is escalated ONCE by the first working-day scan after it,
//    to the next party of the chain (SP by default), with the delay impact shown; a second scan creates nothing;
//  - the scan never changes the decision (no column, no version step) and never decides;
//  - the target gets an `executive_decision_escalated` My Work item; the owner and the creator get a notice naming the
//    delay impact; an unmapped next party is a `party_unmapped` row plus the owner's notice (never a silent skip); an
//    exhausted chain is `no_next_authority`; a mapped owner is skipped to the next party;
//  - nothing on a non-working day of the business calendar, and an Unknown SLA date (sla_due_date NULL) is never
//    escalated.
// Today's real weekday is outside the test's control, so the calendar's workweek is set explicitly (a test clock with
// its audit event) and restored at the end. All data is SYNTHETIC; nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import { ifm } from "../../../api/test/support/p2-fixtures.ts";
import {
  businessToday,
  isoWeekday,
  plusDays,
  setupMeetingWorld,
  type MeetingWorld,
} from "../../../api/test/integration/governance/meeting-fixtures.ts";
import {
  moveAskDates,
  organizationOf,
  raiseAsk,
  setWorkweek,
  workweekOf,
} from "../../../api/test/integration/governance/t16-fixtures.ts";
import {
  DECISION_SLA_SCAN_CONSUMER,
  ESCALATION_NOTICE,
  EXECUTIVE_DECISION_ESCALATED_KIND,
  handleDecisionSlaScan,
} from "../../src/handlers/escalations.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
let organizationId: string;
let workweek: number[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const scan = (job = "sla-test") => handleDecisionSlaScan(api.db, { organizationId }, job);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
  organizationId = await organizationOf(api, x.transformationId);
  workweek = await workweekOf(api.db, organizationId);
  await setWorkweek(api.db, organizationId, [1, 2, 3, 4, 5, 6, 7]);
}, 120_000);
afterAll(async () => {
  await setWorkweek(api.db, organizationId, workweek);
  await api.close();
});

const T = () => `/api/v1/transformations/${x.transformationId}`;
const escalationsOf = (decisionId: string) =>
  api.db.selectFrom("decision_escalation").selectAll().where("decision_id", "=", decisionId).orderBy("level").execute();
const decisionRow = (id: string) =>
  api.db.selectFrom("decision").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("REQ-S12-011: an SLA expiring on a working day escalates once to the next authority with the delay impact", () => {
  it("the first working-day scan after the SLA date escalates to SP; a second scan creates nothing; the decision is untouched", async () => {
    const a = await raiseAsk(send, x, x.bo.id, today);
    const sla = plusDays(today, -1); // every day is a working day in this calendar
    await moveAskDates(api.db, a.id, sla, sla);
    const before = await decisionRow(a.id);
    const first = await scan("sla-1");
    expect(first.organizationsScanned).toBe(1);
    expect(first.asks.filter((r) => r.decisionId === a.id)).toEqual([
      { decisionId: a.id, outcome: "escalated", level: 1, routingError: null },
    ]);
    const rows = await escalationsOf(a.id);
    expect(
      rows.map((r) => [r.level, r.party_code, r.target_user_id, r.routing_error, r.sla_due_date, r.business_date]),
    ).toEqual([[1, "SP", x.sponsor.id, null, sla, today]]);
    expect(rows[0]!.delay_impact).toBe("Synthetic: a further quarter on the current terms");
    const second = await scan("sla-2");
    expect(second.asks.filter((r) => r.decisionId === a.id)).toEqual([
      { decisionId: a.id, outcome: "duplicate", level: null, routingError: null },
    ]);
    expect((await escalationsOf(a.id)).length).toBe(1);
    // The scan never decides and never changes the decision.
    expect(await decisionRow(a.id)).toEqual(before);
    // The target's task; the owner's and the creator's notices naming the delay impact.
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "message_params"])
      .where("subject_id", "=", a.id)
      .where("kind", "=", EXECUTIVE_DECISION_ESCALATED_KIND)
      .execute();
    expect(tasks.map((t) => t.assignee_user_id)).toEqual([x.sponsor.id]);
    const notices = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "message_key", "message_params"])
      .where("dedupe_key", "like", `t16.escalation_notice:${a.id}:%`)
      .orderBy("recipient_user_id")
      .execute();
    expect(notices.map((n) => n.recipient_user_id).sort()).toEqual([x.bo.id, x.lead.id].sort());
    for (const n of notices) {
      expect(n.message_key).toBe(ESCALATION_NOTICE);
      const params = typeof n.message_params === "string" ? JSON.parse(n.message_params) : n.message_params;
      expect(params.delayImpact).toBe("Synthetic: a further quarter on the current terms");
    }
    // The API shows the escalation with its target and the delay impact.
    const got = await send("GET", `${T()}/executive-decisions/${a.id}`, { session: x.auditor.session });
    expect(got.body.escalationLevel).toBe(1);
    const listed = await send("GET", `${T()}/escalations?decisionId=${a.id}`, { session: x.auditor.session });
    expect(listed.body.items.map((e: Body) => [e.decisionCode, e.partyCode, e.targetUserId, e.delayImpact])).toEqual([
      [a.code, "SP", x.sponsor.id, "Synthetic: a further quarter on the current terms"],
    ]);
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["actor_type", "source"])
      .where("record_id", "=", rows[0]!.id)
      .execute();
    expect(audit).toEqual([{ actor_type: "service", source: "worker" }]);
    const ledger = await api.db
      .selectFrom("processed_message")
      .select("idempotency_key")
      .where("consumer", "=", DECISION_SLA_SCAN_CONSUMER)
      .where("idempotency_key", "=", `decision.escalate:${a.id}:${sla}`)
      .execute();
    expect(ledger.length).toBe(1);
  });

  it("a new SLA date (as after a deferral) allows one more escalation, to the next party: the default chain [SP] is then exhausted", async () => {
    const a = await raiseAsk(send, x, x.fin.id, today);
    await moveAskDates(api.db, a.id, plusDays(today, -1), plusDays(today, -1));
    await scan("sla-3");
    await moveAskDates(api.db, a.id, plusDays(today, -2), plusDays(today, -2));
    await scan("sla-4");
    expect((await escalationsOf(a.id)).map((r) => [r.level, r.party_code, r.routing_error])).toEqual([
      [1, "SP", null],
      [2, null, "no_next_authority"],
    ]);
  });

  it("an unmapped next party is a party_unmapped row with the owner's notice; a mapped owner is skipped", async () => {
    const rule = await send("POST", `${T()}/escalation-rules`, {
      session: x.office.session,
      body: { ruleKind: "decision_sla", escalationChain: ["BO", "FIN"] },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    // BO is mapped to the owner (skipped); FIN is not mapped in this world.
    const a = await raiseAsk(send, x, x.bo.id, today);
    await moveAskDates(api.db, a.id, plusDays(today, -1), plusDays(today, -1));
    const r = await scan("sla-5");
    expect(r.asks.filter((o) => o.decisionId === a.id)).toEqual([
      { decisionId: a.id, outcome: "routing_error", level: 1, routingError: "party_unmapped" },
    ]);
    const rows = await escalationsOf(a.id);
    expect(rows.map((e) => [e.party_code, e.target_user_id, e.target_group_id, e.routing_error])).toEqual([
      ["FIN", null, null, "party_unmapped"],
    ]);
    const notice = await api.db
      .selectFrom("inbox_notification")
      .select("message_params")
      .where("dedupe_key", "=", `t16.escalation_notice:${a.id}:${plusDays(today, -1)}:${x.bo.id}`)
      .executeTakeFirstOrThrow();
    const params =
      typeof notice.message_params === "string" ? JSON.parse(notice.message_params) : notice.message_params;
    expect([params.routingError, params.partyCode]).toEqual(["party_unmapped", "FIN"]);
    // A mapped person who is not the owner is the target (SP), when the chain names it after the owner.
    await send("PATCH", `${T()}/escalation-rules/decision_sla`, {
      session: x.office.session,
      headers: ifm(1),
      body: { escalationChain: ["BO", "SP"] },
    });
    const b = await raiseAsk(send, x, x.bo.id, today);
    await moveAskDates(api.db, b.id, plusDays(today, -1), plusDays(today, -1));
    await scan("sla-6");
    expect((await escalationsOf(b.id)).map((e) => [e.party_code, e.target_user_id])).toEqual([["SP", x.sponsor.id]]);
  });

  it("nothing on a non-working day; an Unknown SLA date is never escalated", async () => {
    const a = await raiseAsk(send, x, x.bo.id, today);
    await moveAskDates(api.db, a.id, plusDays(today, -1), plusDays(today, -1));
    const others = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== isoWeekday(today));
    await setWorkweek(api.db, organizationId, others);
    const off = await scan("sla-7");
    expect([off.organizationsScanned, off.organizationsSkipped, off.asks]).toEqual([0, 1, []]);
    expect(await escalationsOf(a.id)).toEqual([]);
    await setWorkweek(api.db, organizationId, [1, 2, 3, 4, 5, 6, 7]);
    // An ask whose SLA date is Unknown (a T11 row without a scheduled SteerCo) is not selected.
    const steerco = await api.db
      .selectFrom("transformation_decision_right")
      .select("id")
      .where("transformation_id", "=", x.transformationId)
      .where("sla_type", "=", "next_steerco_or_urgent")
      .executeTakeFirst();
    if (steerco) {
      const u = await raiseAsk(send, x, x.bo.id, plusDays(today, 1), { decisionRightId: steerco.id });
      const row = await decisionRow(u.id);
      expect([row.sla_due_date, row.sla_unknown_reason]).toEqual([null, "no_steerco_scheduled"]);
      const r = await scan("sla-8");
      expect(r.asks.map((o) => o.decisionId)).not.toContain(u.id);
      expect(await escalationsOf(u.id)).toEqual([]);
    }
  });
});
