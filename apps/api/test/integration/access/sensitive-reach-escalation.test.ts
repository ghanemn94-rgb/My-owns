// A sensitive benefit's title through the corrective case and the blocker escalation (T-DG6-BE-Z5; F-DG6-280; ADR-0051
// §2 and its 2026-11-04 amendment; REQ-S10-002 "a sensitive benefit is hidden from a workstream member without the
// grant"; M0188), against the run's disposable PostgreSQL, through the API and the worker's REAL consumers
// (`handleBenefitVariance`, `handleBlockerEscalation`). Every value is SYNTHETIC. Marking a record sensitive or
// granting access is an access decision, never a business approval (G1-G6); an executive ask created by the job
// decides nothing, and nothing here touches DG0-DG7.
//
// Ported from the domain probe dom-r4-sensitive-escalation.test.ts (round 4), which failed (TL and AUD read the
// benefit's title through the ask, its list and the owner's inbox; TL recorded blocker statuses naming the restricted
// case, 201). Here:
//   - the corrective consumer titles the case of a benefit that is ALREADY sensitive by the case's own code;
//   - a case created BEFORE the benefit was marked still carries the benefit's title (DG4 behaviour; the case itself
//     is hidden), and that worst case is the one escalated;
//   - negative: TL (no grant) gets 422 `blocker_status.record_not_found` naming that case, byte-identical to an unknown
//     id apart from the request id (existence not disclosed), and the same on an executive ask linked to it; TL's list
//     of blocker statuses leaves out the TO's statuses naming the case;
//   - the admitted TO records the case red in two cycles; the consumer creates ONE ask titled by the case code only only;
//     TL, AUD and SP (the ask's owner, not admitted) never read the benefit's title in the ask list, the ask item or
//     their inbox;
//   - positive: the TO still reads the case with the benefit's title, and the statuses it recorded.
import { insertAuditEvent } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleBlockerEscalation } from "../../../../worker/src/handlers/escalations.ts";
import { handleBenefitVariance } from "../../../../worker/src/handlers/raid.ts";
import { ensureDefaultCalendar } from "../approvals/approval-world.ts";
import {
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";
import { businessToday, plusDays } from "../governance/meeting-fixtures.ts";
import { envelopeOf } from "../governance/t16-fixtures.ts";
import { call, seedWorld, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
const TITLE = "Synthetic CONFIDENTIAL BE-Z5 churn reduction";
const S = { benefitId: "", code: "", earlyCaseId: "", earlyCaseCode: "", lateCaseId: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};

const variance = (key: string, month: string) => ({
  outboxEventId: randomUUID(),
  eventType: "benefit.variance_evaluated",
  schemaVersion: 1,
  idempotencyKey: `benefit.variance_evaluated:be-z5-${key}-${randomUUID()}`,
  organizationId: c.b.organizationId,
  payload: {
    benefitId: S.benefitId,
    measurementId: randomUUID(),
    periodStart: `2026-${month}-01`,
    periodEnd: `2026-${month}-28`,
    plannedAmount: "100000.0000",
    measuredAmount: "80000.0000",
    variance: "-20000.0000",
    offTrack: true,
  },
});

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  await ensureDefaultCalendar(api, w, (m, u, o) => call(api.app, m, u, o));
  const ini = await launchedInitiative(api.db, c.b);
  const ben = await pendingBenefit(api, c, ini);
  S.benefitId = ben.id;
  S.code = ben.code;
  const cur = ok(await send("GET", `${c.b.base}/benefits/${ben.id}`, { session: c.b.s.bo }));
  ok(
    await send("PATCH", `${c.b.base}/benefits/${ben.id}`, {
      session: c.b.s.bo,
      headers: ifm(cur.version),
      body: { title: TITLE },
    }),
  );
  // Before marking: the consumer opens a case titled with the benefit's title (DG4 behaviour, REQ-PB-085).
  const early = await handleBenefitVariance(api.db, variance("early", "09"), "be-z5-early");
  expect(early.signal).toMatchObject({ outcome: "case_created" });
  const e = await api.db
    .selectFrom("corrective_case")
    .select(["id", "code", "title"])
    .where("benefit_id", "=", ben.id)
    .executeTakeFirstOrThrow();
  expect(e.title).toBe(TITLE);
  S.earlyCaseId = e.id;
  S.earlyCaseCode = e.code;
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${ben.id}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

/** Closes a case through the API as its owner (BO, a named party of the benefit), so the consumer opens a new one. */
async function closeCase(id: string): Promise<void> {
  const cur = ok(await send("GET", `${c.b.base}/corrective-actions/${id}`, { session: c.b.s.bo }));
  ok(
    await send("POST", `${c.b.base}/corrective-actions/${id}/close`, {
      session: c.b.s.bo,
      headers: ifm(cur.version),
      body: { closureNote: "Synthetic closure before the next evaluation" },
    }),
  );
}

let meetings: string[] = [];

describe("ADR-0051 §2: a sensitive benefit's title never reaches an executive ask (F-DG6-280)", () => {
  it("control: TL and AUD get 404 on the benefit and on its case; the TO reads both", async () => {
    for (const s of [c.b.s.tl, c.b.s.auditor]) {
      expect((await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s })).status).toBe(404);
      expect((await send("GET", `${c.b.base}/corrective-actions/${S.earlyCaseId}`, { session: s })).status).toBe(404);
    }
    const item = ok(await send("GET", `${c.b.base}/corrective-actions/${S.earlyCaseId}`, { session: c.s.to.session }));
    expect(JSON.stringify(item)).toContain(TITLE);
  });

  it("the corrective consumer titles the case of a benefit that is sensitive now by the case's own code", async () => {
    const before = await api.db
      .selectFrom("corrective_case")
      .select(["id", "status"])
      .where("benefit_id", "=", S.benefitId)
      .execute();
    expect(before.map((b) => b.status)).toEqual(["open"]);
    // One open case per source: close the early case, then the next off-track evaluation opens a new one.
    await closeCase(S.earlyCaseId);
    const late = await handleBenefitVariance(api.db, variance("late", "10"), "be-z5-late");
    expect(late.signal).toMatchObject({ outcome: "case_created" });
    const row = await api.db
      .selectFrom("corrective_case")
      .select(["id", "code", "title"])
      .where("benefit_id", "=", S.benefitId)
      .where("status", "=", "open")
      .executeTakeFirstOrThrow();
    S.lateCaseId = row.id;
    expect(row.title).toBe(row.code);
    expect(row.title).not.toContain(TITLE);
    expect(row.title).not.toContain(S.code);
  });

  it("negative: TL cannot record a blocker status or link an ask naming the restricted case (as an unknown id)", async () => {
    const today = await businessToday(api);
    const forum = ok(
      await send("POST", `${c.b.base}/forums`, {
        session: c.s.to.session,
        body: {
          nameEn: "Synthetic review BE-Z5",
          nameAr: "منتدى اصطناعي",
          cadenceLabel: "Weekly",
          purpose: "Synthetic",
          participantsLabel: "Synthetic",
          outputsLabel: "RAID",
          outputKinds: ["raid"],
        },
      }),
      201,
    );
    meetings = [];
    for (const d of [1, 8]) {
      const m = ok(
        await send("POST", `${c.b.base}/meetings`, {
          session: c.b.s.tl,
          body: { forumId: forum.id, scheduledDate: plusDays(today, d), startTime: "09:00", durationMinutes: 60 },
        }),
        201,
      );
      ok(await send("POST", `${c.b.base}/meetings/${m.id}/start`, { session: c.b.s.tl, headers: ifm(1) }));
      meetings.push(m.id);
    }
    const named = await send("POST", `${c.b.base}/meetings/${meetings[0]}/blocker-statuses`, {
      session: c.b.s.tl,
      body: { sourceRecordType: "corrective_case", sourceRecordId: S.earlyCaseId, rag: "red" },
    });
    const unknown = await send("POST", `${c.b.base}/meetings/${meetings[0]}/blocker-statuses`, {
      session: c.b.s.tl,
      body: { sourceRecordType: "corrective_case", sourceRecordId: randomUUID(), rag: "red" },
    });
    expect(named.status).toBe(422);
    expect(named.body.code).toBe("blocker_status.record_not_found");
    const strip = (b: Body) => JSON.stringify({ ...b, requestId: undefined, instance: undefined });
    expect(strip(named.body)).toBe(strip(unknown.body));
    // An executive ask linked to the case (createExecutiveDecision's blocker link) is refused too (the 422 above when
    // TL may create asks, otherwise the 403 first): never created, and the refusal names nothing of the benefit.
    const ask = await send("POST", `${c.b.base}/executive-decisions`, {
      session: c.b.s.tl,
      body: {
        title: "Synthetic linked ask",
        blockerRecordType: "corrective_case",
        blockerRecordId: S.earlyCaseId,
      },
      contract: false,
    });
    expect(ask.status).not.toBe(201);
    expect(JSON.stringify(ask.body)).not.toContain(TITLE);
  });

  it("the admitted TO's red cycles create ONE ask titled by the case code only; TL, AUD and SP never read the title", async () => {
    // The worst case: an open case that carries the benefit's title (as every case did before this fix, and as a case
    // opened before its benefit was marked does). Synthetic setup with its audit event.
    await api.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable("corrective_case")
        .set({ title: TITLE, version: (eb) => eb("version", "+", 1) })
        .where("id", "=", S.lateCaseId)
        .returning(["version"])
        .executeTakeFirstOrThrow();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: c.b.users.bo.id, requestId: `be-z5-retitle-${S.lateCaseId}`, source: "api" },
        {
          action: "corrective_case.update",
          recordType: "corrective_case",
          recordId: S.lateCaseId,
          organizationId: c.b.organizationId,
          transformationId: c.b.transformationId,
          priorVersion: row.version - 1,
          newVersion: row.version,
        },
      );
    });
    const statusIds: string[] = [];
    for (const m of meetings) {
      const r = ok(
        await send("POST", `${c.b.base}/meetings/${m}/blocker-statuses`, {
          session: c.s.to.session,
          body: { sourceRecordType: "corrective_case", sourceRecordId: S.lateCaseId, rag: "red" },
        }),
        201,
      );
      statusIds.push(r.id);
    }
    const outcomes: string[] = [];
    for (const sid of statusIds) {
      const res = (await handleBlockerEscalation(api.db, await envelopeOf(api.db, sid), "be-z5")) as Body;
      outcomes.push(res.outcome ?? JSON.stringify(res));
    }
    expect(outcomes).toContain("ask_created");
    const asks = await api.db
      .selectFrom("decision")
      .select(["id", "code", "title"])
      .where("blocker_record_id", "=", S.lateCaseId)
      .execute();
    expect(asks).toHaveLength(1);
    const lateCode = (
      await api.db.selectFrom("corrective_case").select("code").where("id", "=", S.lateCaseId).executeTakeFirstOrThrow()
    ).code;
    expect(asks[0]!.title).toBe(lateCode);
    const readers: [string, Session][] = [
      ["TL", c.b.s.tl],
      ["AUD", c.b.s.auditor],
      ["SP", c.sp.session],
    ];
    for (const [who, s] of readers) {
      const list = await send("GET", `${c.b.base}/executive-decisions?limit=100`, { session: s });
      expect(list.status, who).toBe(200);
      expect(JSON.stringify(list.body), `${who}: ask list`).not.toContain(TITLE);
      const one = await send("GET", `${c.b.base}/executive-decisions/${asks[0]!.id}`, { session: s });
      expect(one.status, who).toBe(200);
      expect(JSON.stringify(one.body), `${who}: ask item`).not.toContain(TITLE);
      const inbox = ok(await send("GET", "/api/v1/me/inbox?limit=100", { session: s }));
      expect(JSON.stringify(inbox), `${who}: inbox`).not.toContain(TITLE);
      const statuses = ok(await send("GET", `${c.b.base}/meetings/${meetings[1]}/blocker-statuses`, { session: s }));
      expect(
        statuses.items.filter((i: Body) => i.sourceRecordId === S.lateCaseId),
        `${who}: statuses naming the restricted case`,
      ).toEqual([]);
    }
    // The ask is still visible as an ask (its owner must act on it); only the copied title is gone.
    const sp = ok(await send("GET", `${c.b.base}/executive-decisions/${asks[0]!.id}`, { session: c.sp.session }));
    expect(sp.decision).toBe(lateCode);
    // Positive: the TO reads the case with its title and the statuses it recorded.
    const item = ok(await send("GET", `${c.b.base}/corrective-actions/${S.lateCaseId}`, { session: c.s.to.session }));
    expect(JSON.stringify(item)).toContain(TITLE);
    const own = ok(
      await send("GET", `${c.b.base}/meetings/${meetings[1]}/blocker-statuses`, { session: c.s.to.session }),
    );
    expect(own.items.filter((i: Body) => i.sourceRecordId === S.lateCaseId)).toHaveLength(1);
  });
});
