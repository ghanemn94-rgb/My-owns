// Blocker-red escalation (apps/worker/src/handlers/escalations.ts; ADR-0032 §8.3; REQ-PB-082; B0131; M0233;
// T-DG4-BE-G), driven with the worker's real consumer and scan on the API's database (observations recorded through the
// API's recordBlockerStatus, whose outbox row is the consumer's message). Proves:
//  - REQ-PB-082 A09: a blocker red in two consecutive meetings of a forum (N = 2, the default rule) produces exactly ONE
//    open T16 ask, with a named decision (the blocker's name), owner (SP mapped to an executive) and deadline (10
//    working days after the cycle date on the business calendar); re-running the consumer (a redelivery) and the scan
//    creates no second one;
//  - the ask names the person whose observation triggered it (created_by), with the audit actor `system` on their
//    behalf and the reason "Blocker red for 2 consecutive cycles"; the owner gets the executive_decision_due item; its
//    missing elements are listed (why now, options, recommendation, impact of delay);
//  - an amber cycle, or a cycle without an observation, in between ends the run (an Unknown cycle is never red);
//  - a disabled rule creates nothing; after the ask is decided, a new red run creates a new one.
// All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { addWorkingDays } from "@mth/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import { ifm } from "../../../api/test/support/p2-fixtures.ts";
import {
  businessToday,
  plusDays,
  setupMeetingWorld,
  type MeetingWorld,
} from "../../../api/test/integration/governance/meeting-fixtures.ts";
import {
  createBlockerRisk,
  createForum,
  envelopeOf,
  meetingInSession,
  organizationOf,
  workweekOf,
} from "../../../api/test/integration/governance/t16-fixtures.ts";
import {
  EXECUTIVE_DECISION_DUE_KIND,
  handleBlockerEscalation,
  handleBlockerEscalationScan,
} from "../../src/handlers/escalations.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
let organizationId: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
  organizationId = await organizationOf(api, x.transformationId);
}, 120_000);
afterAll(() => api.close());

const T = () => `/api/v1/transformations/${x.transformationId}`;

/** Records one RAG in a meeting through the API (TL) and returns the observation id. */
async function observe(meetingId: string, risk: string, rag: "red" | "amber" | "green" | "unknown"): Promise<string> {
  const res = await send("POST", `${T()}/meetings/${meetingId}/blocker-statuses`, {
    session: x.lead.session,
    body: { sourceRecordType: "raid_entry", sourceRecordId: risk, rag },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Delivers the observation's outbox message to the consumer (as the relay would). */
const consume = async (statusId: string, job = "blocker-test") =>
  handleBlockerEscalation(api.db, await envelopeOf(api.db, statusId), job);

const asksOf = (risk: string) =>
  api.db
    .selectFrom("decision")
    .selectAll()
    .where("blocker_record_type", "=", "raid_entry")
    .where("blocker_record_id", "=", risk)
    .orderBy("created_at")
    .execute();

describe("REQ-PB-082: a blocker red for N consecutive cycles gets exactly one open executive ask", () => {
  it("N = 2: one ask at the second red cycle, with decision, owner and deadline; the consumer and the scan never duplicate it", async () => {
    const risk = await createBlockerRisk(send, x, "Synthetic blocker: billing data feed");
    const forum = await createForum(send, x, "Synthetic review A");
    const m1 = await meetingInSession(send, x, forum, plusDays(today, 1));
    const m2 = await meetingInSession(send, x, forum, plusDays(today, 8));
    const s1 = await observe(m1, risk, "red");
    expect(await consume(s1)).toEqual({ outcome: "not_red_for_cycles", decisionId: null });
    const s2 = await observe(m2, risk, "red");
    const created = await consume(s2);
    expect(created.outcome).toBe("ask_created");
    const asks = await asksOf(risk);
    expect(asks.length).toBe(1);
    const d = asks[0]!;
    const cal = { workweek: await workweekOf(api.db, organizationId), holidays: [] };
    const deadline = addWorkingDays(plusDays(today, 8), 10, cal).dueDate;
    expect([d.id, d.kind, d.status, d.ask_origin, d.created_source, d.title]).toEqual([
      created.decisionId,
      "executive",
      "open",
      "blocker_escalation",
      "worker",
      "Synthetic blocker: billing data feed",
    ]);
    expect([d.owner_user_id, d.due_date, d.sla_due_date, d.created_by]).toEqual([
      x.sponsor.id,
      deadline,
      deadline,
      x.lead.id,
    ]);
    expect(d.code).toMatch(/^DEC-\d{2,}$/);
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "actor_user_id", "on_behalf_of_user_id", "source", "reason"])
      .where("record_id", "=", d.id)
      .execute();
    expect(audit).toEqual([
      {
        action: "executive_decision.create",
        actor_type: "system",
        actor_user_id: null,
        on_behalf_of_user_id: x.lead.id,
        source: "worker",
        reason: "Blocker red for 2 consecutive cycles",
      },
    ]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "due_date"])
      .where("subject_id", "=", d.id)
      .execute();
    expect(items).toEqual([{ kind: EXECUTIVE_DECISION_DUE_KIND, assignee_user_id: x.sponsor.id, due_date: deadline }]);
    // Redelivery of either message, and the daily scan, create nothing more.
    expect(await consume(s2, "redelivery")).toEqual({ outcome: "duplicate", decisionId: null });
    expect(await consume(s1, "redelivery")).toEqual({ outcome: "duplicate", decisionId: null });
    const scanned = await handleBlockerEscalationScan(api.db, { organizationId }, "scan-1");
    expect(scanned.created).toEqual([]);
    expect((await asksOf(risk)).length).toBe(1);
    // The API lists the gap a person completes before it can go on an agenda.
    const got = await send("GET", `${T()}/executive-decisions/${d.id}`, { session: x.auditor.session });
    expect([got.body.askOrigin, got.body.ownerStatus, got.body.missingElements]).toEqual([
      "blocker_escalation",
      "assigned",
      ["why_now", "options", "recommendation", "impact_of_delay"],
    ]);
  });

  it("an amber cycle, or a cycle without an observation, in between ends the run", async () => {
    const amberRisk = await createBlockerRisk(send, x, "Synthetic blocker: vendor access");
    const fa = await createForum(send, x, "Synthetic review B");
    const a1 = await meetingInSession(send, x, fa, plusDays(today, 1));
    const a2 = await meetingInSession(send, x, fa, plusDays(today, 2));
    const a3 = await meetingInSession(send, x, fa, plusDays(today, 3));
    await observe(a1, amberRisk, "red");
    await observe(a2, amberRisk, "amber");
    expect(await consume(await observe(a3, amberRisk, "red"))).toEqual({
      outcome: "not_red_for_cycles",
      decisionId: null,
    });
    const gapRisk = await createBlockerRisk(send, x, "Synthetic blocker: test environment");
    const fg = await createForum(send, x, "Synthetic review C");
    const g1 = await meetingInSession(send, x, fg, plusDays(today, 1));
    await meetingInSession(send, x, fg, plusDays(today, 2)); // held without an observation of the blocker
    const g3 = await meetingInSession(send, x, fg, plusDays(today, 3));
    await observe(g1, gapRisk, "red");
    expect(await consume(await observe(g3, gapRisk, "red"))).toEqual({
      outcome: "not_red_for_cycles",
      decisionId: null,
    });
    const unknownRisk = await createBlockerRisk(send, x, "Synthetic blocker: unknown status");
    const fu = await createForum(send, x, "Synthetic review D");
    const u1 = await meetingInSession(send, x, fu, plusDays(today, 1));
    const u2 = await meetingInSession(send, x, fu, plusDays(today, 2));
    await observe(u1, unknownRisk, "unknown");
    expect(await consume(await observe(u2, unknownRisk, "red"))).toEqual({
      outcome: "not_red_for_cycles",
      decisionId: null,
    });
    await handleBlockerEscalationScan(api.db, { organizationId }, "scan-2");
    expect((await asksOf(amberRisk)).length + (await asksOf(gapRisk)).length + (await asksOf(unknownRisk)).length).toBe(
      0,
    );
  });

  it("a decided ask lets a new red run create a new one; a disabled rule creates nothing", async () => {
    const risk = await createBlockerRisk(send, x, "Synthetic blocker: recurring outage");
    const forum = await createForum(send, x, "Synthetic review E");
    const m1 = await meetingInSession(send, x, forum, plusDays(today, 1));
    const m2 = await meetingInSession(send, x, forum, plusDays(today, 2));
    await observe(m1, risk, "red");
    const first = await consume(await observe(m2, risk, "red"));
    expect(first.outcome).toBe("ask_created");
    const decided = await send("POST", `${T()}/executive-decisions/${first.decisionId}/outcome`, {
      session: x.sponsor.session,
      headers: ifm(1),
      body: { outcome: "decided", outcomeText: "Synthetic: fund the fix" },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const m3 = await meetingInSession(send, x, forum, plusDays(today, 3));
    const second = await consume(await observe(m3, risk, "red"));
    expect(second.outcome).toBe("ask_created");
    expect((await asksOf(risk)).map((d) => d.status)).toEqual(["decided", "open"]);
    const rule = await send("POST", `${T()}/escalation-rules`, {
      session: x.office.session,
      body: { ruleKind: "blocker_red", enabled: false, redCycles: 2, deadlineWorkingDays: 5, ownerPartyCode: "SP" },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const off = await createBlockerRisk(send, x, "Synthetic blocker: rule disabled");
    const f2 = await createForum(send, x, "Synthetic review F");
    const o1 = await meetingInSession(send, x, f2, plusDays(today, 1));
    const o2 = await meetingInSession(send, x, f2, plusDays(today, 2));
    await observe(o1, off, "red");
    expect(await consume(await observe(o2, off, "red"))).toEqual({ outcome: "rule_disabled", decisionId: null });
    expect(await asksOf(off)).toEqual([]);
  });
});
