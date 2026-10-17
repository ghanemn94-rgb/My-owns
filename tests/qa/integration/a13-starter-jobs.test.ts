// A13 "Durable automation" for the P5 starter jobs (qa-verifier, T-DG5-QA-F). Binding row texts, tested literally:
//  - REQ-S12-004 "creating one transformation produces one set of phase checklists and role tasks; a retry creates no
//    duplicates; with the plan flag the 90-day tasks are dated from the start date";
//  - REQ-S12-015 "cut-off creates one draft agenda containing current open asks; it is not published without review"
//    (the cut-off-pack part; see the handback for the open-asks clause).
// Through the REAL API (inject) and the REAL worker (startWorker, every handler) on this file's own scratch database;
// "no duplicate" is asserted on database rows after the event is replayed three times (relay re-send + redelivery to
// every consuming queue), and after the cut-off job is run again. Dates are fixed business dates. All data is
// SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import { QUEUES_FOR_EVENT } from "../../../apps/worker/src/queues/index.ts";
import {
  inProcessWorker,
  orgWorld,
  outboxOf,
  qaBoss,
  scratchEnv,
  waitFor,
  type Body,
  type OrgWorld,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import { call, createUser, grant, uniq } from "../support/api.ts";

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker;
let w: OrgWorld;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13s");
  boss = qaBoss(env.appUrl, "qa-a13s-boss");
  await boss.start();
  worker = await inProcessWorker(env, boss);
  w = await orgWorld(env.api);
}, 120_000);
afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await env?.close();
});

async function drained(eventId: string) {
  await waitFor(async () => {
    const r = await env.su.query(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'outboxEventId' = $1 AND state IN ('created','retry','active')",
      [eventId],
    );
    return r.rows[0].n === 0;
  }, "every job of the event finished");
}

/** Re-relays the event and re-delivers it to every consuming queue, three times. */
async function replay3(event: Body) {
  const envelope = {
    outboxEventId: event.id,
    eventType: event.event_type,
    schemaVersion: event.schema_version,
    idempotencyKey: event.idempotency_key,
    organizationId: event.organization_id,
    payload: typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload,
  };
  const queues = QUEUES_FOR_EVENT[event.event_type] ?? [];
  expect(queues.length, `${event.event_type} has consumers`).toBeGreaterThan(0);
  for (let i = 0; i < 3; i++) {
    await env.su.query("UPDATE outbox_event SET published_at = NULL WHERE id = $1", [event.id]);
    await waitFor(
      async () => {
        const r = await env.su.query("SELECT published_at FROM outbox_event WHERE id = $1", [event.id]);
        return (r.rows[0].published_at ?? null) !== null;
      },
      `re-relay ${i + 1}`,
    );
    for (const q of queues) await boss.send(q, envelope);
    await drained(event.id);
  }
}

const plus = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("REQ-S12-004: one transformation -> one set of phase checklists and role tasks; a retry creates no duplicates; the 90-day tasks are dated from the start date", () => {
  const START = "2026-11-01";
  let tId: string;
  const snapshot = async () => ({
    phaseSteps: (
      await env.api.db
        .selectFrom("phase_step")
        .select(["id", "step_key"])
        .where("transformation_id", "=", tId)
        .orderBy("step_key")
        .execute()
    ).map((r) => `${r.step_key}:${r.id}`),
    roleTasks: (
      await env.api.db
        .selectFrom("work_item")
        .select(["id", "dedupe_key"])
        .where("transformation_id", "=", tId)
        .where("kind", "=", "role_assignment")
        .orderBy("dedupe_key")
        .execute()
    ).map((r) => `${r.dedupe_key}:${r.id}`),
    workItems: Number(
      (await env.su.query("SELECT count(*)::int AS n FROM work_item WHERE transformation_id = $1", [tId])).rows[0].n,
    ),
    plans: Number(
      (await env.su.query("SELECT count(*)::int AS n FROM launch_plan WHERE transformation_id = $1", [tId])).rows[0].n,
    ),
    launchTasks: Number(
      (await env.su.query("SELECT count(*)::int AS n FROM launch_task WHERE transformation_id = $1", [tId])).rows[0].n,
    ),
  });

  it(
    "create with launchPlan.startDate, let the worker run, replay the event x3: nothing is added",
    { timeout: 120_000 },
    async () => {
      const created = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: {
          businessUnitId: w.bu,
          name: `Synthetic QA A13 S12-004 ${uniq("")}`,
          mode: "end_to_end",
          launchPlan: { startDate: START },
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      tId = created.body.id;
      const [event] = await outboxOf(env.api, tId);
      expect(event, "one transformation.created event").toBeDefined();
      expect((await outboxOf(env.api, tId)).length).toBe(1);
      await waitFor(
        async () => (await snapshot()).plans === 1 && (await snapshot()).roleTasks.length > 0,
        "starter 1 ran",
        60_000,
      );
      await drained(event!.id);
      const first = await snapshot();
      expect(first.phaseSteps.length, "a phase checklist exists").toBeGreaterThan(0);
      expect(first.roleTasks.length, "role-assignment tasks exist").toBeGreaterThan(0);
      // One task per role (dedupe key role_assignment:<transformation>:<role>): no role twice.
      const roles = first.roleTasks.map((k) => k.split(":")[2]);
      expect(new Set(roles).size).toBe(roles.length);
      expect(first.plans, "one 90-day plan").toBe(1);
      expect(first.launchTasks).toBeGreaterThan(0);

      await replay3(event);
      expect(await snapshot(), "three replays add no checklist step, task, plan or launch task").toEqual(first);
    },
  );

  it("the 90-day tasks are dated from the start date: Day n = start + n, by window", async () => {
    const plan = await call<Body>(env.api.app, "GET", `/api/v1/transformations/${tId}/launch-plan`, {
      session: w.lead.session,
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(JSON.stringify(plan.body)).toContain(START);
    const tasks = await call<Body>(env.api.app, "GET", `/api/v1/transformations/${tId}/launch-plan/tasks?limit=100`, {
      session: w.lead.session,
    });
    expect(tasks.status, JSON.stringify(tasks.body)).toBe(200);
    const items = tasks.body.items as Body[];
    expect(items.length).toBeGreaterThan(0);
    const windows: Record<string, [string, string]> = {
      days_0_30: [START, plus(START, 30)],
      days_31_60: [plus(START, 31), plus(START, 60)],
      days_61_90: [plus(START, 61), plus(START, 90)],
    };
    for (const t of items) {
      const [lo, hi] = windows[t.windowCode]!;
      expect(
        [t.windowCode, t.dueDate >= lo && t.dueDate <= hi],
        `${t.title}: due ${t.dueDate} in ${lo}..${hi}`,
      ).toEqual([t.windowCode, true]);
    }
    expect(new Set(items.map((t) => t.windowCode))).toEqual(new Set(Object.keys(windows)));
  });

  it("without the plan flag, no plan and no launch task are created", { timeout: 60_000 }, async () => {
    const created = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
      session: w.lead.session,
      body: { businessUnitId: w.bu, name: `Synthetic QA A13 S12-004 no plan ${uniq("")}`, mode: "end_to_end" },
    });
    expect(created.status).toBe(201);
    const [event] = await outboxOf(env.api, created.body.id);
    await waitFor(
      async () =>
        (
          await env.su.query(
            "SELECT count(*)::int AS n FROM work_item WHERE transformation_id = $1 AND kind = 'role_assignment'",
            [created.body.id],
          )
        ).rows[0].n > 0,
      "starter 1 ran",
    );
    await drained(event!.id);
    expect(
      (await env.su.query("SELECT count(*)::int AS n FROM launch_plan WHERE transformation_id = $1", [created.body.id]))
        .rows[0].n,
    ).toBe(0);
  });
});

describe("REQ-S12-015: cut-off creates one draft agenda (pack); it is not published without review", () => {
  it(
    "the cut-off job creates ONE draft pack per meeting, again-runs add none; publishing waits for the chair's review",
    { timeout: 150_000 },
    async () => {
      const created = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: { businessUnitId: w.bu, name: `Synthetic QA A13 S12-015 ${uniq("")}`, mode: "end_to_end" },
      });
      expect(created.status).toBe(201);
      const tId = created.body.id as string;
      const base = `/api/v1/transformations/${tId}`;
      // The organization's default business calendar (a cut-off is counted in working days; without a calendar it is
      // Unknown). Every day a working day, so "N working days before tomorrow" is reached whatever today is.
      let cal: Body = null;
      for (const workweek of [
        [1, 2, 3, 4, 5, 6, 7],
        [0, 1, 2, 3, 4, 5, 6],
      ]) {
        cal = await call<Body>(env.api.app, "POST", `/api/v1/organizations/${w.orgId}/calendars`, {
          session: w.tech.session,
          body: {
            code: "QA-A13-ALLDAYS",
            nameEn: "Synthetic all days",
            nameAr: "كل الأيام (اصطناعي)",
            timezone: "Asia/Riyadh",
            workweek,
            isDefault: true,
          },
        });
        if (cal.status === 201) break;
      }
      expect(cal.status, JSON.stringify(cal.body)).toBe(201);
      const forums = await call<Body>(env.api.app, "GET", `${base}/forums`, { session: w.lead.session });
      expect(forums.status, JSON.stringify(forums.body)).toBe(200);
      const list = (forums.body.items ?? forums.body) as Body[];
      expect(list.length).toBeGreaterThan(0);
      // Tomorrow (Asia/Riyadh): a meeting whose cut-off (working days before it) is today or earlier.
      const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
      const day = plus(today, 1);
      let meeting: Body = null;
      const tried: unknown[] = [];
      for (const f of list) {
        const m = await call<Body>(env.api.app, "POST", `${base}/meetings`, {
          session: w.lead.session,
          body: { forumId: f.id, scheduledDate: day, startTime: "10:00", durationMinutes: 60, chairUserId: w.lead.id },
        });
        tried.push([
          f.templateKey ?? f.nameEn,
          m.status,
          m.body?.cutoffDate ?? m.body?.code,
          m.body?.cutoffUnknownReason,
        ]);
        if (m.status === 201 && m.body.cutoffDate !== null && m.body.cutoffDate <= today) {
          meeting = m.body;
          break;
        }
      }
      expect(
        meeting,
        `a meeting whose cut-off is reached; today ${today}; tried ${JSON.stringify(tried)}`,
      ).not.toBeNull();
      const pack = `${base}/meetings/${meeting.id}/cutoff-pack`;
      // A Business Owner of the transformation: the executive who owns the asks (holds the decision right).
      const bo = await createUser(env.api.db, w.orgId);
      await grant(env.api.db, w.grantorId, bo.id, "BO", { type: "transformation", id: tId } as never, w.orgId);
      // Two current open asks of the transformation (T16 executive decisions, not decided), raised before the cut-off.
      const asks: string[] = [];
      for (const title of ["Synthetic QA A13: switch the roaming partner", "Synthetic QA A13: extend the pilot"]) {
        const a = await call<Body>(env.api.app, "POST", `${base}/executive-decisions`, {
          session: w.lead.session,
          body: {
            title,
            whyNow: "Synthetic QA: the decision is needed before the next forum",
            options: [{ title: "Proceed" }, { title: "Hold", description: "Synthetic QA" }],
            recommendation: "A",
            impactOfDelay: "Synthetic QA: one more cycle on the current terms",
            ownerUserId: bo.id,
            requiredDate: plus(today, 20),
          },
        });
        expect(a.status, JSON.stringify(a.body)).toBe(201);
        asks.push(a.body.id as string);
      }

      const runScan = async () => {
        const r = await call<Body>(env.api.app, "POST", "/api/v1/admin/jobs/governance.meeting_cutoff_scan/run", {
          session: w.tech.session,
        });
        expect(r.status, JSON.stringify(r.body)).toBe(202);
      };
      await runScan();
      const p = await waitFor(
        async () => {
          const r = await call<Body>(env.api.app, "GET", pack, { session: w.lead.session });
          return r.status === 200 ? r : null;
        },
        "the cut-off pack",
        60_000,
      );
      expect(p.body).toMatchObject({ meetingId: meeting.id, status: "draft", cutoffDate: meeting.cutoffDate });
      const packs = async () =>
        Number(
          (await env.su.query("SELECT count(*)::int AS n FROM meeting_cutoff_pack WHERE meeting_id = $1", [meeting.id]))
            .rows[0].n,
        );
      const agenda = async () =>
        Number(
          (await env.su.query("SELECT count(*)::int AS n FROM agenda_item WHERE meeting_id = $1", [meeting.id])).rows[0]
            .n,
        );
      const firstItems = await agenda();
      expect(await packs()).toBe(1);
      expect(firstItems, "one draft agenda item per open ask in the snapshot").toBe((p.body.openAsks as Body[]).length);
      // ... containing the current open asks: both asks are in the snapshot, each as one draft agenda item.
      expect(JSON.stringify(p.body.openAsks)).toContain(asks[0]);
      expect(JSON.stringify(p.body.openAsks)).toContain(asks[1]);
      expect(firstItems, "one draft agenda item per open ask").toBe(2);
      const items = (
        await env.su.query(
          "SELECT id, status, decision_id, version FROM agenda_item WHERE meeting_id = $1 ORDER BY ordinal",
          [meeting.id],
        )
      ).rows;
      expect(items.map((i) => i.status)).toEqual(["draft", "draft"]);
      expect(items.map((i) => i.decision_id).sort()).toEqual([...asks].sort());
      expect([...(p.body.agendaItemIds as string[])].sort()).toEqual(items.map((i) => i.id).sort());
      // Not published without review: the chair's publish of a pack item is refused while the pack is a draft.
      const early = await call<Body>(
        env.api.app,
        "POST",
        `${base}/meetings/${meeting.id}/agenda-items/${items[0].id}/publish`,
        {
          session: w.lead.session,
          headers: { "if-match": `"${items[0].version}"` },
        },
      );
      expect(early.status, JSON.stringify(early.body)).toBe(422);
      expect(early.body.code).toBe("agenda_item.pack_not_reviewed");
      expect((await env.su.query("SELECT status FROM agenda_item WHERE id = $1", [items[0].id])).rows[0].status).toBe(
        "draft",
      );

      // The scan again (a retried or re-run job; run-now is a singleton per minute, so re-deliver the scan's job too).
      const [job] = (
        await env.su.query(
          "SELECT name, data FROM pgboss.job WHERE name = 'governance.meeting_cutoff_scan' ORDER BY created_on DESC LIMIT 1",
        )
      ).rows;
      for (let i = 0; i < 3; i++) await boss.send(job.name, job.data ?? {});
      await waitFor(
        async () => {
          const r = await env.su.query(
            "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'governance.meeting_cutoff_scan' AND state IN ('created','retry','active')",
          );
          return r.rows[0].n === 0;
        },
        "the re-delivered scans finished",
        60_000,
      );
      expect(await packs(), "still one pack").toBe(1);
      expect(await agenda(), "no agenda item added").toBe(firstItems);

      // Not published without review: the pack is a draft and a review by someone else than the chair is refused.
      const asAud = await call<Body>(env.api.app, "POST", `${pack}/review`, {
        session: w.auditor.session,
        headers: { "if-match": `"${p.body.version}"` },
        body: {},
      });
      expect(asAud.status).toBe(403);
      const reviewed = await call<Body>(env.api.app, "POST", `${pack}/review`, {
        session: w.lead.session,
        headers: { "if-match": `"${p.body.version}"` },
        body: {},
      });
      expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
      expect(reviewed.body.status).toBe("reviewed");
      // After the review the chair publishes it (the DG4 per-item publish).
      const cur = (await env.su.query("SELECT version FROM agenda_item WHERE id = $1", [items[0].id])).rows[0];
      const published = await call<Body>(
        env.api.app,
        "POST",
        `${base}/meetings/${meeting.id}/agenda-items/${items[0].id}/publish`,
        {
          session: w.lead.session,
          headers: { "if-match": `"${cur.version}"` },
        },
      );
      expect(published.status, JSON.stringify(published.body)).toBe(200);
    },
  );
});
