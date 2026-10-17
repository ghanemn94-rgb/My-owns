// A13 "Durable automation", REQ-S12-012 black-box (qa-verifier, T-DG5-QA-F2). Binding row text, tested literally:
//   "A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic".
// "The logic" is Rule B of D-166 (M0232 "recompute forecast impacts using defined scheduling logic"; ADR-0044 §7):
//   forwardFinish(S) = own + max(0, required - S.planned_start), where own = ADR-0023 §5 predecessor finish of S
//   (latest forecast, else approved, date of its non-cancelled milestones; else planned end), and required = the latest,
//   over S's predecessors P, of the first date ADR-0023 §5 lets S start after forwardFinish(P). ADR-0023 §5 flags only
//   `planned_start < predecessor finish` (schedule.before_predecessor), so the first allowed start IS that finish.
//   A dependent with a predecessor but no planned_start is Unknown (null), never 0 nor its unshifted date.
//   The slip's `affected` records forwardFinish before and after for every initiative reachable from the slip.
//
// Everything is built through the PUBLIC API (inject, every response validated against docs/api/openapi.yaml): the
// transformation, five initiatives with owners and planned dates, dated milestones, T08 dependencies and the slipping
// PATCH of a milestone forecast. The REAL worker (startWorker: relay + every handler) delivers `dependency.slipped` to
// starter 9. The fixed network (all dates synthetic, in 2041, independent of today):
//
//   P (finish 2041-04-01) --[needed by 2041-04-03]--> S1 (start 2041-04-01, finish 2041-05-01; owner O2)
//   S1 --> S2 (start 2041-05-01 = S1's finish: NO slack; finish 2041-06-01; owner O2)
//   S1 --> S3 (start 2041-05-20: 19 days of slack; finish 2041-06-10; owner O3)
//   S1 --> S4 (NO planned start; finish 2041-06-15; owner O3)
//
// P's milestone moves 2041-04-01 -> 2041-04-06 (5 days): the needed-by date of P -> S1 is breached, so it is critical.
// Expected by Rule B: S1 05-01 -> 05-06 (no slack, moves 5); S2 06-01 -> 06-06 (transitively, no slack, moves 5);
// S3 06-10 -> 06-10 (slack absorbs it); S4 Unknown -> Unknown. Distinct affected owners: O2 and O3, each notified once,
// also after the event is replayed three times. All data is SYNTHETIC; nothing approves anything real, and nothing
// here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import {
  inProcessWorker,
  orgWorld,
  qaBoss,
  scratchEnv,
  waitFor,
  type Body,
  type OrgWorld,
  type Person,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import { addDays, daysBetween, drainedEvent, outboxByPayload, replayEvent } from "../support/a13-replay.ts";
import { call, createUser, grant, signIn, uniq } from "../support/api.ts";

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker;
let w: OrgWorld;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13b");
  boss = qaBoss(env.appUrl, "qa-a13b-boss");
  await boss.start();
  worker = await inProcessWorker(env, boss);
  w = await orgWorld(env.api);
}, 120_000);
afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await env?.close();
});

const ok = (r: { status: number; body: Body }, status: number, what: string) =>
  expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBe(status);

interface Net {
  tId: string;
  owners: { o1: Person; o2: Person; o3: Person };
  ini: Record<"P" | "S1" | "S2" | "S3" | "S4", { id: string; code: string }>;
  pMilestone: { id: string; version: number };
  depPS1: string;
}

/** Builds the fixed network above through the API as the transformation's lead. Returns ids. */
async function buildNetwork(label: string): Promise<Net> {
  const app = env.api.app;
  const tl = w.lead.session;
  const created = await call<Body>(app, "POST", "/api/v1/transformations", {
    session: tl,
    body: { businessUnitId: w.bu, name: `Synthetic QA A13 S12-012 ${label} ${uniq("")}`, mode: "end_to_end" },
  });
  ok(created, 201, "create transformation");
  const tId = created.body.id as string;
  // Three synthetic executive owners (BO of this transformation).
  const owner = async (): Promise<Person> => {
    const u = await createUser(env.api.db, w.orgId);
    await grant(env.api.db, w.grantorId, u.id, "BO", { type: "transformation", id: tId } as never, w.orgId);
    return { id: u.id, session: await signIn(env.api.app, u.subject) };
  };
  const owners = { o1: await owner(), o2: await owner(), o3: await owner() };
  const spec: Record<
    keyof Net["ini"],
    { owner: Person; plannedStart: string | null; plannedEnd: string; milestone: string }
  > = {
    P: { owner: owners.o1, plannedStart: "2041-03-01", plannedEnd: "2041-04-01", milestone: "2041-04-01" },
    S1: { owner: owners.o2, plannedStart: "2041-04-01", plannedEnd: "2041-05-01", milestone: "2041-05-01" },
    S2: { owner: owners.o2, plannedStart: "2041-05-01", plannedEnd: "2041-06-01", milestone: "2041-06-01" },
    S3: { owner: owners.o3, plannedStart: "2041-05-20", plannedEnd: "2041-06-10", milestone: "2041-06-10" },
    S4: { owner: owners.o3, plannedStart: null, plannedEnd: "2041-06-15", milestone: "2041-06-15" },
  };
  const ini = {} as Net["ini"];
  let pMilestone = { id: "", version: 0 };
  for (const [key, s] of Object.entries(spec) as [keyof Net["ini"], (typeof spec)["P"]][]) {
    const r = await call<Body>(app, "POST", "/api/v1/initiatives", {
      session: tl,
      body: {
        transformationId: tId,
        name: `Synthetic QA slip ${key}`,
        executiveOwnerUserId: s.owner.id,
        plannedStart: s.plannedStart,
        plannedEnd: s.plannedEnd,
      },
    });
    ok(r, 201, `create initiative ${key}`);
    ini[key] = { id: r.body.id, code: r.body.code };
    const m = await call<Body>(app, "POST", `/api/v1/initiatives/${r.body.id}/milestones`, {
      session: tl,
      body: { title: `Synthetic QA ${key} go-live`, forecastDate: s.milestone },
    });
    ok(m, 201, `create milestone of ${key}`);
    if (key === "P") pMilestone = { id: m.body.id, version: m.body.version };
  }
  const dep = async (from: keyof Net["ini"], to: keyof Net["ini"], neededBy: string | null) => {
    const r = await call<Body>(app, "POST", "/api/v1/dependencies", {
      session: tl,
      body: {
        transformationId: tId,
        description: `Synthetic QA: ${from} must deliver before ${to}`,
        from: { kind: "initiative", initiativeId: ini[from].id },
        toInitiativeId: ini[to].id,
        dependencyType: "tech",
        neededBy,
      },
    });
    ok(r, 201, `create dependency ${from} -> ${to}`);
    return r.body.id as string;
  };
  const depPS1 = await dep("P", "S1", "2041-04-03");
  await dep("S1", "S2", null);
  await dep("S1", "S3", null);
  await dep("S1", "S4", null);
  return { tId, owners, ini, pMilestone, depPS1 };
}

async function slipsOf(tId: string, session = w.lead.session): Promise<Body[]> {
  const r = await call<Body>(env.api.app, "GET", `/api/v1/transformations/${tId}/dependency-slips?limit=100`, {
    session,
  });
  ok(r, 200, "list dependency slips");
  return r.body.items as Body[];
}

/** One owner's view of their own My Work slip items and the inbox reminders linked to them (public API only). */
async function ownerView(p: Person, tId: string) {
  const items = await call<Body>(
    env.api.app,
    "GET",
    `/api/v1/me/work-items?kind=dependency_slip&transformationId=${tId}&limit=100`,
    { session: p.session },
  );
  ok(items, 200, "my work items");
  const inbox = await call<Body>(env.api.app, "GET", `/api/v1/me/inbox?limit=100`, { session: p.session });
  ok(inbox, 200, "my inbox");
  const mine = (items.body.items as Body[]).filter((i) => i.kind === "dependency_slip");
  const ids = new Set(mine.map((i) => i.id as string));
  const notes = (inbox.body.items as Body[]).filter((n) => n.workItemId !== null && ids.has(n.workItemId));
  return { items: mine, notes };
}

describe("REQ-S12-012: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic (Rule B)", () => {
  let net: Net;
  let slip: Body;

  it(
    "the 5-day slip of a predecessor whose needed-by date is breached records ONE critical slip of 5 days",
    { timeout: 120_000 },
    async () => {
      net = await buildNetwork("rule-b");
      expect(await slipsOf(net.tId), "no slip before the change").toEqual([]);
      const moved = await call<Body>(env.api.app, "PATCH", `/api/v1/milestones/${net.pMilestone.id}`, {
        session: w.lead.session,
        headers: { "if-match": `"${net.pMilestone.version}"` },
        body: { forecastDate: addDays("2041-04-01", 5) },
      });
      ok(moved, 200, "move P's forecast by 5 days");
      expect(moved.body.forecastDate).toBe("2041-04-06");
      const slips = await slipsOf(net.tId);
      expect(slips.length, JSON.stringify(slips)).toBe(1);
      slip = slips[0];
      expect(slip).toMatchObject({
        dependencyId: net.depPS1,
        predecessorFinishBefore: "2041-04-01",
        predecessorFinishAfter: "2041-04-06",
        slipDays: 5,
        neededBy: "2041-04-03",
        criticalReason: "needed_by_breached",
      });
    },
  );

  it("the affected list: every initiative reachable from the slip, with its owner", () => {
    expect(slip, "the slip of the first test").toBeDefined();
    const byId = new Map((slip.affected as Body[]).map((a) => [a.initiativeId as string, a]));
    expect([...byId.keys()].sort()).toEqual([net.ini.S1.id, net.ini.S2.id, net.ini.S3.id, net.ini.S4.id].sort());
    expect(byId.has(net.ini.P.id), "the slipped predecessor itself is not 'affected'").toBe(false);
    const ownerOf = (k: "S1" | "S2" | "S3" | "S4") => byId.get(net.ini[k].id).ownerUserId;
    expect([ownerOf("S1"), ownerOf("S2"), ownerOf("S3"), ownerOf("S4")]).toEqual([
      net.owners.o2.id,
      net.owners.o2.id,
      net.owners.o3.id,
      net.owners.o3.id,
    ]);
  });

  it("Rule B: a dependent with no slack moves by the slip (5 days), directly and transitively", () => {
    expect(slip, "the slip of the first test").toBeDefined();
    const at = (k: "S1" | "S2") => (slip.affected as Body[]).find((a) => a.initiativeId === net.ini[k].id);
    const s1 = at("S1");
    const s2 = at("S2");
    expect([s1.forecastFinishBefore, s1.forecastFinishAfter], "S1 (starts on P's finish)").toEqual([
      "2041-05-01",
      "2041-05-06",
    ]);
    expect([s2.forecastFinishBefore, s2.forecastFinishAfter], "S2 (starts on S1's finish)").toEqual([
      "2041-06-01",
      "2041-06-06",
    ]);
    expect(daysBetween(s1.forecastFinishBefore, s1.forecastFinishAfter)).toBe(5);
    expect(daysBetween(s2.forecastFinishBefore, s2.forecastFinishAfter)).toBe(5);
  });

  it("Rule B: a dependent with enough slack does not move", () => {
    expect(slip, "the slip of the first test").toBeDefined();
    const s3 = (slip.affected as Body[]).find((a) => a.initiativeId === net.ini.S3.id);
    expect([s3.forecastFinishBefore, s3.forecastFinishAfter]).toEqual(["2041-06-10", "2041-06-10"]);
  });

  it("Rule B: a dependent without planned_start is Unknown (null) before and after, never 0 nor its own date", () => {
    expect(slip, "the slip of the first test").toBeDefined();
    const s4 = (slip.affected as Body[]).find((a) => a.initiativeId === net.ini.S4.id);
    expect([s4.forecastFinishBefore, s4.forecastFinishAfter]).toEqual([null, null]);
  });

  it(
    "each distinct affected owner is notified ONCE (one dependency_slip work item and one reminder); the predecessor's owner is not",
    { timeout: 120_000 },
    async () => {
      expect(slip, "the slip of the first test").toBeDefined();
      const [event] = await outboxByPayload(env, "dependency.slipped", "slipId", slip.id);
      expect(event, "the dependency.slipped outbox event").toBeDefined();
      expect((await outboxByPayload(env, "dependency.slipped", "slipId", slip.id)).length).toBe(1);
      // The relay publishes the event and starter 9 (portfolio.dependency_slip) consumes it.
      await waitFor(
        async () =>
          (
            await env.su.query(
              "SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'outboxEventId' = $1 AND name = 'portfolio.dependency_slip'",
              [event.id],
            )
          ).rows[0].n > 0,
        "the dependency.slipped job",
        60_000,
      ).catch(async (e) => {
        const o = await env.su.query(
          "SELECT event_type, publish_attempts, last_error FROM outbox_event WHERE published_at IS NULL ORDER BY seq",
        );
        const j = await env.su.query(
          "SELECT name, state, data->>'eventType' AS t FROM pgboss.job WHERE data->>'outboxEventId' = $1",
          [event.id],
        );
        throw new Error(`${String(e)}; outbox ${JSON.stringify(o.rows)}; jobs ${JSON.stringify(j.rows)}`);
      });
      await drainedEvent(env, event.id);
      const jobs = await env.su.query(
        "SELECT name, state, retry_count, output FROM pgboss.job WHERE data->>'outboxEventId' = $1",
        [event.id],
      );
      const items = await env.su.query(
        "SELECT assignee_user_id, dedupe_key FROM work_item WHERE kind = 'dependency_slip' AND transformation_id = $1",
        [net.tId],
      );
      const diag = JSON.stringify({ jobs: jobs.rows, items: items.rows });
      expect(
        jobs.rows.every((j) => j.state === "completed"),
        `starter 9's job completed: ${diag}`,
      ).toBe(true);
      const check = async (when: string) => {
        for (const [name, p] of [
          ["O2 (S1, S2)", net.owners.o2],
          ["O3 (S3, S4)", net.owners.o3],
        ] as const) {
          const v = await ownerView(p, net.tId);
          expect(v.items.length, `${when}: ${name} has one dependency_slip task`).toBe(1);
          expect(v.items[0]).toMatchObject({ assigneeUserId: p.id, transformationId: net.tId, status: "open" });
          expect(v.notes.length, `${when}: ${name} has one reminder for it`).toBe(1);
        }
        const o1 = await ownerView(net.owners.o1, net.tId);
        expect(o1.items.length, `${when}: the predecessor's owner is not an affected owner`).toBe(0);
        // Database check, independent of the API paging: one slip work item per distinct owner, nothing else.
        const rows = await env.su.query(
          "SELECT assignee_user_id, count(*)::int AS n FROM work_item WHERE kind = 'dependency_slip' AND transformation_id = $1 GROUP BY 1 ORDER BY 1",
          [net.tId],
        );
        expect(
          rows.rows.map((r) => [r.assignee_user_id, r.n]),
          when,
        ).toEqual(
          [
            [net.owners.o2.id, 1],
            [net.owners.o3.id, 1],
          ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        );
      };
      await check("after the first delivery");
      // A13: the same event retried three times (relay re-send + re-delivery to every consumer) adds nothing.
      await replayEvent(env, boss, event, 3);
      await check("after three replays");
      // The starter recorded one execution for the occurrence (REQ-S12-001), succeeded.
      const ex = await env.su.query(
        `SELECT e.status, e.trigger_code FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
          WHERE r.code = 'starter.dependency_slip' AND e.trigger_key = $1`,
        [event.idempotency_key],
      );
      expect(ex.rows.map((r) => [r.trigger_code, r.status])).toEqual([["dependency.slipped", "succeeded"]]);
    },
  );

  it("nothing but the slip evidence is stored: the dependents' milestones and planned dates are unchanged", async () => {
    expect(net, "the network of the first test").toBeDefined();
    for (const [k, date] of [
      ["S1", "2041-05-01"],
      ["S2", "2041-06-01"],
      ["S3", "2041-06-10"],
      ["S4", "2041-06-15"],
    ] as const) {
      const m = await call<Body>(env.api.app, "GET", `/api/v1/initiatives/${net.ini[k].id}/milestones`, {
        session: w.auditor.session,
      });
      ok(m, 200, `milestones of ${k}`);
      const list = (m.body.items ?? m.body) as Body[];
      expect(
        list.map((x) => x.forecastDate),
        `${k}'s stored forecast is not overwritten`,
      ).toEqual([date]);
    }
  });

  it("the slip list is readable with transformation.read (AUD) and refused without it (another org's TL: 404/403)", async () => {
    expect(net, "the network of the first test").toBeDefined();
    expect((await slipsOf(net.tId, w.auditor.session)).length).toBe(1);
    const other = await orgWorld(env.api);
    const r = await call<Body>(env.api.app, "GET", `/api/v1/transformations/${net.tId}/dependency-slips`, {
      session: other.lead.session,
    });
    expect([403, 404]).toContain(r.status);
  });
});
