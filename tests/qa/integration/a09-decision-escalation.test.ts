// A09 "Decision escalation" (master prompt §20): "A working-day SLA expiration produces the correct escalation and linked
// executive ask without duplicate actions."
//
// Black-box acceptance suite (qa-verifier, T-DG4-QA-B) through the REAL API (Fastify inject; every request and response
// validated against docs/api/openapi.yaml) on the run's disposable PostgreSQL, plus the worker's REAL job functions
// (handleDecisionSlaScan, scanOverdueApprovals, handleBlockerEscalation, handleBlockerEscalationScan) driven directly
// on the same database, never by sleeping - as the KBE and BE worker tests do. Each `it` names the requirement rows
// (docs/delivery/requirements.csv) whose A09 text it proves.
//
// The worlds are built natively (tests/qa/support/gates-native.ts): a transformation created through the API, people
// granted through the access API, parties mapped, calendars and holidays configured by the technical administrator
// through the calendar API. Disclosed TEST CLOCKS (the API cannot inject the server clock and refuses past dates):
//  - an executive ask's decision/SLA date moved into the past (moveAskDates, version + 1 with its audit event);
//  - an approval's due date moved into the past (makeOverdue, version + 1 with its audit event).
// Expected working-day dates are computed by an INDEPENDENT oracle in this file (workingDaysAfter), never by the
// product's own calendar code.
// All data is SYNTHETIC. No job decides anything; every decision recorded here is a synthetic in-product business
// decision by a test person. Nothing touches the engineering gates DG0-DG7.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOverdue } from "../../../apps/api/test/integration/approvals/approval-world.ts";
import { envelopeOf, moveAskDates } from "../../../apps/api/test/integration/governance/t16-fixtures.ts";
import { scanOverdueApprovals } from "../../../apps/worker/src/handlers/approvals.ts";
import {
  handleBlockerEscalation,
  handleBlockerEscalationScan,
  handleDecisionSlaScan,
} from "../../../apps/worker/src/handlers/escalations.ts";
import { sql } from "../../../packages/db/src/index.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  ifm,
  nativePerson,
  plusDays,
  seedNativeGateWorld,
  type Body,
  type NativeGateWorld,
  type Person,
} from "../support/gates-native.ts";
import {
  dashboardWorld,
  DIRECT_FLOW,
  openPeriod,
  ownedKpi,
  runRecalculation,
  seedWorld,
  submitActual,
  type World,
} from "../support/p4.ts";

let api: TestApi;
let w: World;
let admin: Session;
let today: string;
let defaultCalendar: { id: string; version: number };
const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call<Body>(api.app, method, url, opts);

// ------------------------------------------------------------------------------------------------ independent oracle

/** ISO weekday (1 = Monday ... 7 = Sunday) of a business date. */
const isoWeekday = (date: string): number => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
/** The n-th working day strictly after `from`, skipping non-workweek days and the listed holiday dates. */
function workingDaysAfter(from: string, n: number, workweek: readonly number[], holidays: readonly string[] = []) {
  let d = from;
  let left = n;
  const skipped: { date: string; reason: string }[] = [];
  while (left > 0) {
    d = plusDays(d, 1);
    if (!workweek.includes(isoWeekday(d))) skipped.push({ date: d, reason: "weekend" });
    else if (holidays.includes(d)) skipped.push({ date: d, reason: "holiday" });
    else left -= 1;
  }
  return { dueDate: d, skipped };
}
const SUN_THU = [7, 1, 2, 3, 4];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

// ------------------------------------------------------------------------------------------------ worlds

interface GovWorld extends NativeGateWorld {
  readonly fin: Person;
}
async function govWorld(label: string): Promise<GovWorld> {
  const g = await seedNativeGateWorld(api, w, label);
  const fin = await nativePerson(api, w, admin, g.transformationId, "FIN");
  for (const [partyCode, userId] of [
    ["TL", g.tl.id],
    ["WL", g.wl.id],
  ] as const) {
    const r = await send("POST", `${g.base}/role-mappings`, {
      session: g.tl.session,
      body: { partyCode, targetKind: "user", userId },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  return { ...g, fin };
}

const askBody = (ownerUserId: string, requiredDate: string, extra: Record<string, unknown> = {}) => ({
  title: "Synthetic QA: approve the vendor switch",
  whyNow: "Synthetic QA: the renewal window closes this month",
  options: [{ title: "Switch vendor" }, { title: "Renew the current contract", description: "Synthetic QA" }],
  recommendation: "A",
  impactOfDelay: "Synthetic QA: a further quarter on the current terms (about 1.2 M SAR)",
  ownerUserId,
  requiredDate,
  ...extra,
});
async function raiseAsk(g: GovWorld, requiredDate = plusDays(today, 30), extra: Record<string, unknown> = {}) {
  const r = await send("POST", `${g.base}/executive-decisions`, {
    session: g.tl.session,
    body: askBody(g.bo.id, requiredDate, extra),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
const getAsk = async (g: GovWorld, id: string) =>
  (await send("GET", `${g.base}/executive-decisions/${id}`, { session: g.auditor.session })).body;
const escalationsOf = async (g: GovWorld, decisionId: string) =>
  ((await send("GET", `${g.base}/escalations?limit=100`, { session: g.auditor.session })).body.items as Body[]).filter(
    (e) => e.decisionId === decisionId,
  );
const workItems = async (p: Person, g: GovWorld, kind: string) =>
  (
    (
      await send("GET", `/api/v1/me/work-items?transformationId=${g.transformationId}&kind=${kind}&limit=100`, {
        session: p.session,
      })
    ).body.items as Body[]
  ).filter((i) => i.status === "open");
const scanDecisions = (job: string) => handleDecisionSlaScan(api.db, { organizationId: w.orgA.id }, job);
const scanApprovals = (job: string) => scanOverdueApprovals(api.db, { organizationId: w.orgA.id }, job);

async function setDefaultWorkweek(workweek: readonly number[]) {
  const r = await send("PATCH", `/api/v1/calendars/${defaultCalendar.id}`, {
    session: admin,
    headers: ifm(defaultCalendar.version),
    body: { workweek },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  defaultCalendar = { id: r.body.id, version: r.body.version };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  today = (await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db)).rows[0]!
    .d;
  // The organization's default business calendar, configured by the technical administrator: Asia/Riyadh, Sunday to
  // Thursday (Friday and Saturday are the configured weekend days), no holiday yet.
  const cal = await send("POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
    session: admin,
    body: {
      code: "QAA09DEF",
      nameEn: "Synthetic QA default calendar",
      nameAr: "تقويم اختبار افتراضي اصطناعي",
      timezone: "Asia/Riyadh",
      workweek: SUN_THU,
      isDefault: true,
    },
  });
  expect(cal.status, JSON.stringify(cal.body)).toBe(201);
  defaultCalendar = { id: cal.body.id, version: cal.body.version };
}, 60_000);
afterAll(() => api?.close());

// ================================================================================================ working days

describe("A09 working-day SLAs on a configured business calendar (REQ-PB-066, REQ-S10-006)", () => {
  let calId: string;
  beforeAll(async () => {
    const cal = await send("POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
      session: admin,
      body: {
        code: "QAA09WD",
        nameEn: "Synthetic QA working-day calendar",
        nameAr: "تقويم أيام عمل اصطناعي",
        timezone: "Asia/Riyadh",
        workweek: SUN_THU,
      },
    });
    expect(cal.status, JSON.stringify(cal.body)).toBe(201);
    calId = cal.body.id;
  });
  const due = async (from: string, n = 5) => {
    const r = await send("GET", `/api/v1/calendars/${calId}/working-days?from=${from}&workingDays=${n}`, {
      session: admin,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };

  it("REQ-S10-006: the default calendar is Asia/Riyadh with the configured workweek, and no holiday exists until configured", async () => {
    const c = await send("GET", `/api/v1/calendars/${defaultCalendar.id}`, { session: admin });
    expect([c.body.timezone, [...c.body.workweek].sort(), c.body.isDefault]).toEqual([
      "Asia/Riyadh",
      [...SUN_THU].sort(),
      true,
    ]);
    for (const id of [defaultCalendar.id, calId]) {
      const h = await send("GET", `/api/v1/calendars/${id}/holidays`, { session: admin });
      expect(h.status, JSON.stringify(h.body)).toBe(200);
      expect(h.body.items).toEqual([]);
    }
    // 2026-09-23 (Saudi National Day, a Wednesday) is NOT skipped while it is not configured.
    const r = await due("2026-09-22");
    expect(r.dueDate).toBe(workingDaysAfter("2026-09-22", 5, SUN_THU).dueDate);
    expect(r.dueDate).toBe("2026-09-29");
    expect(r.skippedDates.map((s: Body) => s.reason)).toEqual(["weekend", "weekend"]);
  });

  it("REQ-PB-066: 5 working days from a Thursday skip the configured weekend days (never elapsed days)", async () => {
    expect(isoWeekday("2026-10-15")).toBe(4);
    const r = await due("2026-10-15");
    expect(r.dueDate).toBe("2026-10-22");
    expect(r.dueDate).toBe(workingDaysAfter("2026-10-15", 5, SUN_THU).dueDate);
    expect(r.dueDate).not.toBe(plusDays("2026-10-15", 5));
    expect(r.skippedDates.map((s: Body) => [s.date, s.reason])).toEqual([
      ["2026-10-16", "weekend"],
      ["2026-10-17", "weekend"],
    ]);
    expect([r.workingDays, r.unknownReason]).toEqual([5, null]);
  });

  it("REQ-S10-006, REQ-PB-066: 5 working days from the day before a configured holiday skip the holiday and the weekend days", async () => {
    const before = await due("2026-10-18");
    expect(before.dueDate).toBe("2026-10-25");
    const h = await send("POST", `/api/v1/calendars/${calId}/holidays`, {
      session: admin,
      body: { dateFrom: "2026-10-19", dateTo: "2026-10-19", nameEn: "Synthetic QA holiday", nameAr: "عطلة اصطناعية" },
    });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const after = await due("2026-10-18");
    expect(after.dueDate).toBe(workingDaysAfter("2026-10-18", 5, SUN_THU, ["2026-10-19"]).dueDate);
    expect(after.dueDate).toBe("2026-10-26");
    expect(after.skippedDates.map((s: Body) => [s.date, s.reason])).toEqual([
      ["2026-10-19", "holiday"],
      ["2026-10-23", "weekend"],
      ["2026-10-24", "weekend"],
    ]);
    // Once configured, the public holiday of the first case is skipped too.
    const nd = await send("POST", `/api/v1/calendars/${calId}/holidays`, {
      session: admin,
      body: {
        dateFrom: "2026-09-23",
        dateTo: "2026-09-23",
        nameEn: "Synthetic QA national day",
        nameAr: "اليوم الوطني",
      },
    });
    expect(nd.status, JSON.stringify(nd.body)).toBe(201);
    expect((await due("2026-09-22")).dueDate).toBe("2026-09-30");
  });

  it("REQ-PB-066: a Business scope change approval gets a due date 5 working days after it is raised on the default calendar (weekend and configured holiday skipped)", async () => {
    const g = await govWorld("A09 scope change SLA");
    // A configured holiday on the second working day after today, so the SLA window crosses it.
    const holiday = workingDaysAfter(today, 2, SUN_THU).dueDate;
    const h = await send("POST", `/api/v1/calendars/${defaultCalendar.id}/holidays`, {
      session: admin,
      body: { dateFrom: holiday, dateTo: holiday, nameEn: "Synthetic QA SLA holiday", nameAr: "عطلة اصطناعية" },
    });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const rights = await send("GET", `${g.base}/decision-rights`, { session: g.auditor.session });
    const scope = (rights.body.items as Body[]).find((r) => r.templateKey === "business_scope_change");
    expect([scope.slaType, scope.slaWorkingDays, scope.approvePartyCode]).toEqual(["working_days", 5, "SP"]);
    const d = await send("POST", "/api/v1/decisions", {
      session: g.tl.session,
      body: { transformationId: g.transformationId, title: "Synthetic QA scope change" },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const a = await send("POST", `${g.base}/approvals`, {
      session: g.tl.session,
      body: {
        approvalType: "decision_request",
        subjectId: d.body.id,
        subjectVersion: 1,
        decisionRightId: scope.id,
        title: "Synthetic QA business scope change",
      },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const expected = workingDaysAfter(a.body.requestBusinessDate, 5, SUN_THU, [holiday]);
    expect(expected.skipped.map((s) => s.date)).toContain(holiday);
    expect([a.body.slaType, a.body.dueDate, a.body.dueUnknownReason, a.body.calendarId]).toEqual([
      "working_days",
      expected.dueDate,
      null,
      defaultCalendar.id,
    ]);
    expect(a.body.dueDate).not.toBe(plusDays(a.body.requestBusinessDate, 5));
    // Remove the holiday again so the later scans run on a calendar without it.
    const removed = await send("PATCH", `/api/v1/calendars/${defaultCalendar.id}/holidays/${h.body.id}`, {
      session: admin,
      headers: ifm(h.body.version),
      body: { status: "removed" },
    });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
  });
});

// ================================================================================================ SLA escalation

describe("A09 decision-SLA expiry escalates once to the next authority (REQ-S12-011, REQ-S20-009)", () => {
  let g: GovWorld;
  beforeAll(async () => {
    g = await govWorld("A09 SLA");
    // Every day is a working day, so "today" is a working day whatever the real weekday is (deterministic).
    await setDefaultWorkweek(ALL_DAYS);
  }, 120_000);

  it("REQ-S12-011, REQ-S20-009: an ask whose SLA expired on a working day is escalated once to SP, linked to the ask, with the delay-impact text; re-running creates nothing", async () => {
    const ask = await raiseAsk(g);
    const yesterday = plusDays(today, -1);
    await moveAskDates(api.db, ask.id, yesterday, yesterday);
    // A second ask whose SLA is today has not expired yet.
    const fresh = await raiseAsk(g);
    await moveAskDates(api.db, fresh.id, today, today);
    const before = await getAsk(g, ask.id);
    await scanDecisions("qa-a09-sla-1");
    await scanDecisions("qa-a09-sla-2");
    await Promise.all([scanDecisions("qa-a09-sla-c1"), scanDecisions("qa-a09-sla-c2")]);
    const esc = await escalationsOf(g, ask.id);
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({
      decisionId: ask.id,
      decisionCode: ask.code,
      level: 1,
      partyCode: "SP",
      targetUserId: g.sp.id,
      routingError: null,
      slaDueDate: yesterday,
      delayImpact: "Synthetic QA: a further quarter on the current terms (about 1.2 M SAR)",
    });
    // The ask stays open and undecided; only its escalation level moved.
    const after = await getAsk(g, ask.id);
    expect([after.status, after.outcome, after.decidedAt, after.escalationLevel]).toEqual(["open", null, null, 1]);
    expect([after.decision, after.whyNow, after.impactOfDelay]).toEqual([
      before.decision,
      before.whyNow,
      before.impactOfDelay,
    ]);
    // Exactly one action for the next authority, none duplicated by the re-runs.
    const items = (await workItems(g.sp, g, "executive_decision_escalated")).filter((i) => i.subjectId === ask.id);
    expect(items).toHaveLength(1);
    expect(await escalationsOf(g, fresh.id)).toEqual([]);
    expect((await getAsk(g, fresh.id)).escalationLevel).toBe(0);
  });

  it("REQ-S12-011, REQ-S15-008 (escalation event): the escalation keeps the SLA date, the Asia/Riyadh business date of the scan and a UTC event timestamp", async () => {
    const ask = await raiseAsk(g);
    const yesterday = plusDays(today, -1);
    await moveAskDates(api.db, ask.id, yesterday, yesterday);
    await scanDecisions("qa-a09-sla-tz");
    const [e] = await escalationsOf(g, ask.id);
    expect(e.escalatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const riyadh = await sql<{
      d: string;
    }>`SELECT p4_business_date(${e.escalatedAt}::timestamptz, 'Asia/Riyadh')::text AS d`.execute(api.db);
    expect([e.slaDueDate, e.businessDate]).toEqual([yesterday, riyadh.rows[0]!.d]);
    // The business date is the Riyadh date of the event, not the UTC date when they differ.
    expect(e.businessDate).toBe(today);
  });

  it("REQ-S12-011: nothing is escalated on a non-working day; the first working-day scan escalates once", async () => {
    const ask = await raiseAsk(g);
    const yesterday = plusDays(today, -1);
    await moveAskDates(api.db, ask.id, yesterday, yesterday);
    // Today's weekday is made a non-working day (the configured weekend).
    await setDefaultWorkweek(ALL_DAYS.filter((d) => d !== isoWeekday(today)));
    await scanDecisions("qa-a09-sla-weekend");
    expect(await escalationsOf(g, ask.id)).toEqual([]);
    await setDefaultWorkweek(ALL_DAYS);
    await scanDecisions("qa-a09-sla-workday");
    await scanDecisions("qa-a09-sla-workday-retry");
    expect(await escalationsOf(g, ask.id)).toHaveLength(1);
  });
});

// ================================================================================================ approval timers

describe("A09 approval timers escalate but never approve (REQ-S10-019)", () => {
  it("after the due date plus retries the approval is escalated exactly once and remains undecided", async () => {
    const g = await govWorld("A09 approval timer");
    await setDefaultWorkweek(ALL_DAYS);
    const rights = await send("GET", `${g.base}/decision-rights`, { session: g.auditor.session });
    const tsd = (rights.body.items as Body[]).find((r) => r.templateKey === "target_state_design");
    const d = await send("POST", "/api/v1/decisions", {
      session: g.tl.session,
      body: { transformationId: g.transformationId, title: "Synthetic QA target state" },
    });
    const a = await send("POST", `${g.base}/approvals`, {
      session: g.tl.session,
      body: {
        approvalType: "decision_request",
        subjectId: d.body.id,
        subjectVersion: 1,
        decisionRightId: tsd.id,
        title: "Synthetic QA target-state design",
      },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.assignee.userId).toBe(g.bo.id);
    // Not yet overdue: never escalated.
    await scanApprovals("qa-a09-appr-early");
    expect(
      (await send("GET", `/api/v1/approvals/${a.body.id}`, { session: g.auditor.session })).body.escalationLevel,
    ).toBe(0);
    await makeOverdue(api, a.body.id, plusDays(today, -3));
    for (const job of ["qa-a09-appr-1", "qa-a09-appr-retry-1", "qa-a09-appr-retry-2"]) await scanApprovals(job);
    await Promise.all([scanApprovals("qa-a09-appr-c1"), scanApprovals("qa-a09-appr-c2")]);
    const after = await send("GET", `/api/v1/approvals/${a.body.id}`, { session: g.auditor.session });
    expect(after.body.status).toBe("pending");
    expect([after.body.decidedBy, after.body.decidedAt, after.body.decisions]).toEqual([null, null, []]);
    expect(after.body.escalationLevel).toBe(1);
    expect(after.body.escalations).toHaveLength(1);
    expect(after.body.escalatedTo).toMatchObject({ partyCode: "SP", userId: g.sp.id });
    const items = (await workItems(g.sp, g, "approval_escalated")).filter((i) => i.subjectId === a.body.id);
    expect(items).toHaveLength(1);
    const decisions = await api.db
      .selectFrom("approval_decision")
      .select("id")
      .where("approval_id", "=", a.body.id)
      .execute();
    expect(decisions).toEqual([]);
  });
});

// ================================================================================================ blocker red

describe("A09 a blocker red for N cycles gets exactly one executive ask (REQ-PB-082)", () => {
  it("N = 2: two consecutive red cycles produce exactly one open T16 ask with decision, owner and deadline; re-running creates none", async () => {
    const g = await govWorld("A09 blocker");
    const rules = await send("GET", `${g.base}/escalation-rules`, { session: g.auditor.session });
    expect(rules.status, JSON.stringify(rules.body)).toBe(200);
    const blocker = (rules.body.items as Body[]).find((r) => r.ruleKind === "blocker_red");
    expect([blocker.enabled, blocker.redCycles]).toEqual([true, 2]);
    const risk = await send("POST", `${g.base}/raid`, {
      session: g.tl.session,
      body: {
        type: "risk",
        description: "Synthetic QA blocker: billing data feed",
        impact: "high",
        probability: "medium",
        ownerUserId: g.tl.id,
        dueDate: "2026-12-31",
        mitigation: "Synthetic QA mitigation",
      },
    });
    expect(risk.status, JSON.stringify(risk.body)).toBe(201);
    const forum = await send("POST", `${g.base}/forums`, {
      session: g.to.session,
      body: {
        nameEn: "Synthetic QA review forum",
        nameAr: "منتدى مراجعة اصطناعي",
        cadenceLabel: "Weekly",
        purpose: "Synthetic QA",
        participantsLabel: "Synthetic QA",
        outputsLabel: "RAID",
        outputKinds: ["raid"],
      },
    });
    expect(forum.status, JSON.stringify(forum.body)).toBe(201);
    const meeting = async (date: string) => {
      const m = await send("POST", `${g.base}/meetings`, {
        session: g.tl.session,
        body: { forumId: forum.body.id, scheduledDate: date, startTime: "09:00", durationMinutes: 60 },
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const s = await send("POST", `${g.base}/meetings/${m.body.id}/start`, { session: g.tl.session, headers: ifm(1) });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      return m.body.id as string;
    };
    const observe = async (meetingId: string) => {
      const r = await send("POST", `${g.base}/meetings/${meetingId}/blocker-statuses`, {
        session: g.tl.session,
        body: { sourceRecordType: "raid_entry", sourceRecordId: risk.body.id, rag: "red" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    const asks = async () =>
      (
        (
          await send("GET", `${g.base}/executive-decisions?origin=blocker_escalation&limit=100`, {
            session: g.auditor.session,
          })
        ).body.items as Body[]
      ).filter((d) => d.blockerRecordId === risk.body.id);
    const m1 = await meeting(plusDays(today, 1));
    const m2 = await meeting(plusDays(today, 8));
    const s1 = await observe(m1);
    await handleBlockerEscalation(api.db, await envelopeOf(api.db, s1), "qa-a09-blocker-1");
    expect(await asks()).toEqual([]);
    const s2 = await observe(m2);
    await handleBlockerEscalation(api.db, await envelopeOf(api.db, s2), "qa-a09-blocker-2");
    const created = await asks();
    expect(created).toHaveLength(1);
    const ask = created[0];
    expect(ask).toMatchObject({
      status: "open",
      askOrigin: "blocker_escalation",
      blockerRecordType: "raid_entry",
      decision: "Synthetic QA blocker: billing data feed",
      ownerStatus: "assigned",
    });
    expect(ask.ownerUserId).toBeTruthy();
    expect(ask.decisionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Re-running the consumer for both observations (redeliveries) and the daily scan creates no second ask.
    await handleBlockerEscalation(api.db, await envelopeOf(api.db, s2), "qa-a09-blocker-2-redelivery");
    await handleBlockerEscalation(api.db, await envelopeOf(api.db, s1), "qa-a09-blocker-1-redelivery");
    await handleBlockerEscalationScan(api.db, { organizationId: w.orgA.id }, "qa-a09-blocker-scan-1");
    await handleBlockerEscalationScan(api.db, { organizationId: w.orgA.id }, "qa-a09-blocker-scan-2");
    const again = await asks();
    expect(again.map((d) => d.id)).toEqual([ask.id]);
    expect(again.filter((d) => d.status === "open")).toHaveLength(1);
  });
});

// ================================================================================================ T16 and Decisions area

describe("A09 Executive Decision Log and the Decisions area (REQ-PB-081, REQ-PB-064, REQ-S10-012, REQ-PB-068)", () => {
  let g: GovWorld;
  beforeAll(async () => {
    g = await govWorld("A09 T16");
  }, 120_000);

  it("REQ-S10-012: an ask without 'why now' is rejected by the API (400 executive_decision.field_required at /whyNow); nothing is written", async () => {
    const body: Record<string, unknown> = askBody(g.bo.id, plusDays(today, 30));
    delete body["whyNow"];
    const before = (await send("GET", `${g.base}/executive-decisions?limit=100`, { session: g.auditor.session })).body
      .items.length;
    const r = await send("POST", `${g.base}/executive-decisions`, { session: g.tl.session, body });
    expect(r.status).toBe(400);
    expect(String(r.headers["content-type"])).toContain("application/problem+json");
    expect(JSON.stringify(r.body)).toContain("/whyNow");
    const blank = await send("POST", `${g.base}/executive-decisions`, {
      session: g.tl.session,
      body: { ...body, whyNow: "   " },
    });
    expect([400, 422]).toContain(blank.status);
    const after = (await send("GET", `${g.base}/executive-decisions?limit=100`, { session: g.auditor.session })).body
      .items.length;
    expect(after).toBe(before);
  });

  it("REQ-PB-081: T16 persists all 9 columns (ID, Decision, Why now, Options, Rec., Owner, Decision date, Impact if delayed, Outcome)", async () => {
    const ask = await raiseAsk(g, plusDays(today, 20));
    const got = await getAsk(g, ask.id);
    expect(got.code).toMatch(/^DEC-\d{2,6}$/);
    expect(got).toMatchObject({
      decision: "Synthetic QA: approve the vendor switch",
      whyNow: "Synthetic QA: the renewal window closes this month",
      recommendationOptionLabel: "A",
      ownerUserId: g.bo.id,
      decisionDate: plusDays(today, 20),
      impactOfDelay: "Synthetic QA: a further quarter on the current terms (about 1.2 M SAR)",
      outcome: null,
      status: "open",
    });
    expect((got.options as Body[]).map((o) => [o.label, o.title])).toEqual([
      ["A", "Switch vendor"],
      ["B", "Renew the current contract"],
    ]);
    // Persisted in the canonical decision table (read straight from the database).
    const row = await api.db.selectFrom("decision").selectAll().where("id", "=", ask.id).executeTakeFirstOrThrow();
    expect([row.code, row.kind, row.status]).toEqual([got.code, "executive", "open"]);
  });

  it("REQ-PB-064, REQ-PB-081: an open T16 decision due yesterday (Asia/Riyadh) makes the Decisions area Red and is listed; once its Outcome is recorded it is closed and no longer counts", async () => {
    const ask = await raiseAsk(g);
    const yesterday = plusDays(today, -1);
    await moveAskDates(api.db, ask.id, yesterday, yesterday);
    const area = async () => {
      const r = await send("GET", `${g.base}/dashboard`, { session: g.auditor.session });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body.areas as Body[]).find((a) => a.code === "decisions");
    };
    const red = await area();
    expect(red.rag.status).toBe("red");
    const item = (red.items as Body[]).find((i) => i.recordId === ask.id);
    expect(item).toMatchObject({ rag: "red", dueDate: yesterday });
    expect(item.flags).toContain("overdue");
    const overview = await send(
      "GET",
      `/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${g.transformationId}`,
      {
        session: g.auditor.session,
      },
    );
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect((overview.body.areas as Body[]).find((a) => a.code === "decisions").rag.status).toBe("red");
    const overdue = async () =>
      (
        (await send("GET", `${g.base}/executive-decisions?overdue=true&limit=100`, { session: g.auditor.session })).body
          .items as Body[]
      ).map((d) => d.id);
    expect(await overdue()).toContain(ask.id);
    expect((await getAsk(g, ask.id)).overdue).toBe(true);
    // The decision owner records the Outcome (a synthetic business decision by a person).
    const current = await getAsk(g, ask.id);
    const decided = await send("POST", `${g.base}/executive-decisions/${ask.id}/outcome`, {
      session: g.bo.session,
      headers: ifm(current.version),
      body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic QA: switch vendor in Q1." },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body).toMatchObject({
      status: "decided",
      outcome: "Synthetic QA: switch vendor in Q1.",
      chosenOptionLabel: "A",
      decidedBy: g.bo.id,
      overdue: false,
    });
    expect(await overdue()).not.toContain(ask.id);
    const after = await area();
    expect((after.items as Body[]).map((i) => i.recordId)).not.toContain(ask.id);
    expect(after.rag.status).not.toBe("red");
  });

  it("REQ-PB-068, REQ-S10-012: publishing an executive-ask agenda item missing 'Impact of delay' is rejected by the API; a complete one publishes and creates its T16 ask", async () => {
    const m = await send("POST", `${g.base}/meetings`, {
      session: g.tl.session,
      body: {
        forumId: (
          (await send("GET", `${g.base}/forums?limit=100`, { session: g.auditor.session })).body.items as Body[]
        ).find((f) => f.templateKey === "executive_steerco").id,
        scheduledDate: plusDays(today, 40),
        startTime: "10:00",
        durationMinutes: 60,
        chairUserId: g.tl.id,
      },
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const A = `${g.base}/meetings/${m.body.id}/agenda-items`;
    const brief = {
      decisionRequired: "Synthetic QA: fund the data platform",
      whyNow: "Synthetic QA: the vendor quote expires",
      options: ["Fund now", "Defer to next year"],
      recommendation: "A",
      ownerUserId: g.bo.id,
      requiredDate: plusDays(today, 45),
    };
    const incomplete = await send("POST", A, {
      session: g.tl.session,
      body: { itemKind: "executive_ask", title: "Synthetic QA ask without impact", brief },
    });
    expect(incomplete.status, JSON.stringify(incomplete.body)).toBe(201);
    expect(incomplete.body.missingElements).toEqual(["impact_of_delay"]);
    const refused = await send("POST", `${A}/${incomplete.body.id}/publish`, {
      session: g.tl.session,
      headers: ifm(incomplete.body.version),
    });
    expect([refused.status, refused.body.code]).toEqual([422, "agenda_item.executive_ask_incomplete"]);
    expect(JSON.stringify(refused.body)).toMatch(/impact/i);
    const stillDraft = ((await send("GET", A, { session: g.auditor.session })).body.items as Body[]).find(
      (i) => i.id === incomplete.body.id,
    );
    expect([stillDraft.status, stillDraft.decisionId]).toEqual(["draft", null]);
    const complete = await send("POST", A, {
      session: g.tl.session,
      body: {
        itemKind: "executive_ask",
        title: "Synthetic QA complete ask",
        brief: { ...brief, impactOfDelay: "Synthetic QA: the quote rises 8%" },
      },
    });
    expect(complete.status, JSON.stringify(complete.body)).toBe(201);
    expect(complete.body.missingElements).toEqual([]);
    const published = await send("POST", `${A}/${complete.body.id}/publish`, {
      session: g.tl.session,
      headers: ifm(complete.body.version),
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.status).toBe("published");
    expect(published.body.decisionId).toBeTruthy();
    const t16 = await getAsk(g, published.body.decisionId);
    expect(t16).toMatchObject({ impactOfDelay: "Synthetic QA: the quote rises 8%", status: "open" });
  });
});

// ================================================================================================ committee workflow

describe("A09 committee workflow: quorum, immutable minutes, actions in My Work (REQ-S10-011)", () => {
  it("no decision below quorum; published minutes are immutable; actions appear in the owners' My Work", async () => {
    const g = await govWorld("A09 committee");
    const forum = await send("POST", `${g.base}/forums`, {
      session: g.to.session,
      body: {
        nameEn: "Synthetic QA decision forum",
        nameAr: "منتدى قرارات اصطناعي",
        cadenceLabel: "Monthly",
        purpose: "Synthetic QA",
        participantsLabel: "Synthetic QA",
        outputsLabel: "Decisions",
        outputKinds: ["decision"],
        quorumMin: 2,
      },
    });
    expect(forum.status, JSON.stringify(forum.body)).toBe(201);
    // The forum's quorum members: BO and SP (a present non-participant never counts).
    for (const p of [g.bo, g.sp]) {
      const r = await send("POST", `${g.base}/forums/${forum.body.id}/participants`, {
        session: g.to.session,
        body: { userId: p.id, countsForQuorum: true },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const ask = await raiseAsk(g, plusDays(today, 60));
    const m = await send("POST", `${g.base}/meetings`, {
      session: g.tl.session,
      body: {
        forumId: forum.body.id,
        scheduledDate: plusDays(today, 30),
        startTime: "10:00",
        durationMinutes: 60,
        chairUserId: g.tl.id,
      },
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const M = `${g.base}/meetings/${m.body.id}`;
    const item = await send("POST", `${M}/agenda-items`, {
      session: g.tl.session,
      body: { itemKind: "executive_ask", title: "Synthetic QA vendor switch", decisionId: ask.id },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const pub = await send("POST", `${M}/agenda-items/${item.body.id}/publish`, {
      session: g.tl.session,
      headers: ifm(item.body.version),
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const started = await send("POST", `${M}/start`, {
      session: g.tl.session,
      headers: ifm((await send("GET", M, { session: g.tl.session })).body.version),
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const attend = async (p: Person) => {
      const r = await send("POST", `${M}/attendance`, {
        session: g.tl.session,
        body: { userId: p.id, attendance: "present" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    };
    await attend(g.bo);
    await attend(g.wl);
    const outcome = async () => {
      const current = (
        (await send("GET", `${M}/agenda-items`, { session: g.auditor.session })).body.items as Body[]
      ).find((i) => i.id === item.body.id);
      return send("POST", `${M}/agenda-items/${item.body.id}/outcome`, {
        session: g.bo.session,
        headers: ifm(current.version),
        body: {
          outcome: "decided",
          chosenOptionLabel: "A",
          outcomeText: "Synthetic QA: switch vendor.",
          decisionVersion: (await getAsk(g, ask.id)).version,
        },
      });
    };
    const below = await outcome();
    expect([below.status, below.body.code]).toEqual([422, "meeting.quorum_not_met"]);
    expect(String(below.body.detail)).toContain("1 of 2");
    expect((await getAsk(g, ask.id)).status).toBe("open");
    await attend(g.sp);
    const met = await outcome();
    expect(met.status, JSON.stringify(met.body)).toBe(200);
    // The two forum participants were counted (the present non-participant WL was not).
    expect(met.body.outcomeQuorumPresent).toBe(2);
    expect(await getAsk(g, ask.id)).toMatchObject({ status: "decided", outcome: "Synthetic QA: switch vendor." });
    // An action assigned in the meeting appears in its owner's My Work (and nobody else's).
    const action = await send("POST", `${M}/actions`, {
      session: g.tl.session,
      body: { title: "Synthetic QA: notify the vendor", ownerUserId: g.wl.id, dueDate: plusDays(today, 10) },
    });
    expect(action.status, JSON.stringify(action.body)).toBe(201);
    const myWork = async (p: Person) => {
      const r = await send("GET", "/api/v1/me/work", { session: p.session });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return JSON.stringify(r.body);
    };
    expect(await myWork(g.wl)).toContain(action.body.actionItemId);
    expect(await myWork(g.bo)).not.toContain(action.body.actionItemId);
    // Minutes: drafted, approved by the chair, published once the meeting is held; then immutable.
    const closed = await send("POST", `${M}/close`, {
      session: g.tl.session,
      headers: ifm((await send("GET", M, { session: g.tl.session })).body.version),
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const drafted = await send("POST", `${M}/minutes`, {
      session: g.tl.session,
      body: { body: "Synthetic QA minutes: vendor switch decided (option A)." },
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const approved = await send("POST", `${M}/minutes/approve`, {
      session: g.tl.session,
      headers: ifm(drafted.body.version),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const published = await send("POST", `${M}/minutes/publish`, {
      session: g.tl.session,
      headers: ifm(approved.body.version),
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.status).toBe("published");
    const edit = await send("PATCH", `${M}/minutes`, {
      session: g.tl.session,
      headers: ifm(published.body.version),
      body: { body: "Synthetic QA: rewritten after publication" },
    });
    expect([edit.status, edit.body.code]).toEqual([422, "meeting_minutes.published"]);
    const back = await send("PATCH", `${M}/minutes`, {
      session: g.tl.session,
      headers: ifm(published.body.version),
      body: { status: "draft" },
    });
    expect([400, 409, 422]).toContain(back.status);
    const read = await send("GET", `${M}/minutes`, { session: g.auditor.session });
    expect([read.body.status, read.body.body, read.body.version]).toEqual([
      "published",
      "Synthetic QA minutes: vendor switch decided (option A).",
      published.body.version,
    ]);
  });
});

// ================================================================================================ entity groups

// The row's "an integration test creates and reads each one through the API with authorization enforced" is covered by
// the backend's own entity-group tests (apps/api/test/integration/raid/entity-group.test.ts, BE-D2, and
// apps/api/test/integration/governance/entity-group.test.ts, BE-F2), which this task checked exist, cover every listed
// entity and pass (see the handback). They leave the row's "ERD and migrations contain every entity listed with primary
// keys, owner and status where applicable" unchecked; only that clause is checked here.
describe("A09 entity groups: ERD and migrations (REQ-S16-018, REQ-S16-019)", () => {
  it("every listed entity is in the ERD and has a table with a primary key, and owner and status columns where applicable", async () => {
    // Entity -> [table, owner column or null, status column or null]. Risk, Assumption and Issue share raid_entry.
    const entities: Record<string, [string, string | null, string | null]> = {
      Risk: ["raid_entry", "owner_user_id", "status"],
      Assumption: ["raid_entry", "owner_user_id", "status"],
      Issue: ["raid_entry", "owner_user_id", "status"],
      Action: ["action_item", "owner_user_id", "status"],
      Decision: ["decision", "owner_user_id", "status"],
      ChangeRequest: ["change_request", "raised_by", "status"],
      Approval: ["approval", null, "status"],
      Forum: ["forum", null, "status"],
      Meeting: ["meeting", null, "status"],
      AgendaItem: ["agenda_item", null, "status"],
      Attendance: ["meeting_attendance", "user_id", null],
      Minutes: ["meeting_minutes", null, "status"],
      MeetingActionLink: ["meeting_action_link", null, null],
    };
    const erd = readFileSync(fileURLToPath(new URL("../../../docs/architecture/erd.md", import.meta.url)), "utf8");
    for (const [entity, [table, owner, status]] of Object.entries(entities)) {
      expect(new RegExp(`\\b${table}\\b`).test(erd), `${entity}: ${table} is in the ERD`).toBe(true);
      const cols = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`.execute(
        api.db,
      );
      const names = cols.rows.map((r) => r.column_name);
      expect(names.length, `${entity}: table ${table} exists`).toBeGreaterThan(0);
      const pk = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = ${table}::regclass AND contype = 'p'`.execute(
        api.db,
      );
      expect(pk.rows[0]!.n, `${entity}: primary key on ${table}`).toBe(1);
      if (owner) expect(names, `${entity}: owner column`).toContain(owner);
      if (status) expect(names, `${entity}: status column`).toContain(status);
    }
  });
});

// ================================================================================================ time and currency

describe("A09 time semantics and default currency (REQ-S15-008)", () => {
  /** Independent oracle: the Asia/Riyadh calendar date of an instant (Intl, not the product's business-date code). */
  const riyadhDate = (instant: string | Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(instant));

  it("REQ-S15-008: a KPI actual for period 2026-10 keeps observation period 2026-10, the Asia/Riyadh business date of its entry and a UTC event timestamp", async () => {
    const k = await dashboardWorld(api, w);
    const oct = await openPeriod(api, w, "monthly", "2026-10", "2026-10-01", "2026-10-31");
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const r = await submitActual(api, k, kpi.id, { reportingPeriodId: oct.id, value: "3", dataAsOf: "2026-10-31" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await runRecalculation(api, r.body.actual.id);
    const a = r.body.actual;
    // Observation period: the period the value is FOR, whatever the day it was entered.
    expect([a.periodLabel, a.periodStart, a.periodEnd]).toEqual(["2026-10", "2026-10-01", "2026-10-31"]);
    const v = a.values[0];
    // UTC event timestamp, and the business date is that instant's Asia/Riyadh calendar date.
    expect(v.enteredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/);
    expect(v.businessDate).toBe(riyadhDate(v.enteredAt));
    // The row's example: entered 2026-11-02 23:30 Asia/Riyadh (= 20:30 UTC) is business date 2026-11-02; one hour
    // later (00:30 Riyadh, still 2026-11-02 in UTC) it is 2026-11-03. The database's business-date function agrees
    // with the oracle (the API cannot be given a past entry instant, so the example is checked at this boundary).
    expect([riyadhDate("2026-11-02T20:30:00Z"), riyadhDate("2026-11-02T21:30:00Z")]).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    const db = await sql<{ d: string; n: string }>`
      SELECT p4_business_date('2026-11-02T20:30:00Z'::timestamptz, 'Asia/Riyadh')::text AS d,
             p4_business_date('2026-11-02T21:30:00Z'::timestamptz, 'Asia/Riyadh')::text AS n`.execute(api.db);
    expect([db.rows[0]!.d, db.rows[0]!.n]).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("REQ-S15-008: changing the organization's default currency affects only new records (an existing transformation keeps SAR)", async () => {
    const org = `/api/v1/organizations/${w.orgA.id}`;
    const tl = await signIn(api.app, w.leadA1.subject);
    const create = async (label: string) => {
      const r = await send("POST", "/api/v1/transformations", {
        session: tl,
        body: { businessUnitId: w.a1, name: `Synthetic QA currency ${label}`, mode: "end_to_end" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body;
    };
    const o0 = await send("GET", org, { session: admin });
    expect(o0.status, JSON.stringify(o0.body)).toBe(200);
    expect(o0.body.defaultCurrency).toBe("SAR");
    const before = await create("before the change");
    expect(before.currency).toBe("SAR");
    const changed = await send("PATCH", org, {
      session: admin,
      headers: ifm(o0.body.version),
      body: { defaultCurrency: "USD" },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    try {
      expect(changed.body.defaultCurrency).toBe("USD");
      const after = await create("after the change");
      expect(after.currency).toBe("USD");
      // The existing record is unchanged, through the API and in its version.
      const old = await send("GET", `/api/v1/transformations/${before.id}`, { session: tl });
      expect([old.body.currency, old.body.version]).toEqual(["SAR", before.version]);
    } finally {
      const restored = await send("PATCH", org, {
        session: admin,
        headers: ifm(changed.body.version),
        body: { defaultCurrency: "SAR" },
      });
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    }
  });
});
