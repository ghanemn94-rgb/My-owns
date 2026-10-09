// My Work items and the in-app inbox (ADR-0025 §4; REQ-S12-005 kit part, REQ-S16-005; T-DG4-BE-A) against a real
// PostgreSQL:
//  - createWorkItemOnce creates one task and one reminder per dedupe key, with their audit events; a second call (a
//    retry or redelivery) creates nothing and returns `existing`; concurrent calls create exactly one;
//  - the worker kit's twin (apps/worker/src/kit.ts) writes the same rows as the API service;
//  - only the assignee sees and completes an item (others 404/403); system-managed kinds refuse manual completion;
//  - the inbox lists the caller's own reminders newest first with an unread count; read is once;
//  - every mutation: If-Match 428/409, one audit event, the session re-resolved at commit time (401 when it ended);
//  - T-DG4-BE-R1 (D-102, D-105): rescheduleWorkItemsOfSubject moves the open items' due date, reassignWorkItemOfSubject
//    moves the open item to a new assignee (A -> B -> A leaves exactly one open item, for A); both idempotent and
//    audited; the worker kit's twins write the same rows (parity).
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import type { Tx } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorkItemOnce as workerCreateWorkItemOnce,
  reassignWorkItemOfSubject as workerReassign,
  rescheduleWorkItemsOfSubject as workerReschedule,
} from "../../../../worker/src/kit.ts";
import {
  closeWorkItemsOfSubject,
  createWorkItemOnce,
  reassignWorkItemOfSubject,
  rescheduleWorkItemsOfSubject,
  type WorkItemInput,
} from "../../../src/modules/tasks/index.ts";
import {
  auditOf,
  call,
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
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, endSessions } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let office: Session;
let auditor: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:test", source: "worker" } as const;
const input = (over: Partial<WorkItemInput> = {}): WorkItemInput => ({
  organizationId: w.orgA.id,
  kind: "kpi_update_due",
  assigneeUserId: w.office.id,
  subjectType: "kpi_definition",
  subjectId: crypto.randomUUID(),
  linkPath: "/kpi/synthetic",
  messageKey: "tasks.kpi_update_due",
  messageParams: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
  periodLabel: "2026-10",
  dedupeKey: uniq("kpi.period_open:"),
  ...over,
});
const create = (i: WorkItemInput, actor = WORKER, impl = createWorkItemOnce) =>
  api.db.transaction().execute((tx) => impl(tx, actor, i));

describe("createWorkItemOnce (ADR-0025 §3-§4)", () => {
  it("one task and one reminder per dedupe key, audited as the service actor; a repeat creates nothing", async () => {
    const i = input();
    const first = await create(i);
    expect(first.outcome).toBe("created");
    const again = await create({ ...i, subjectId: crypto.randomUUID() });
    expect(again).toEqual({ outcome: "existing", workItemId: first.workItemId });
    const items = await api.db.selectFrom("work_item").selectAll().where("dedupe_key", "=", i.dedupeKey).execute();
    const notes = await api.db
      .selectFrom("inbox_notification")
      .selectAll()
      .where("dedupe_key", "=", i.dedupeKey)
      .execute();
    expect([items.length, notes.length]).toEqual([1, 1]);
    expect(items[0]).toMatchObject({
      status: "open",
      created_source: "worker",
      message_key: "tasks.kpi_update_due",
      message_params: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
      link_path: "/kpi/synthetic",
      period_label: "2026-10",
      due_date: null,
    });
    expect(notes[0]).toMatchObject({ work_item_id: first.workItemId, recipient_user_id: w.office.id, read_at: null });
    const audit = [...(await auditOf(api.db, first.workItemId)), ...(await auditOf(api.db, notes[0]!.id))];
    expect(audit.map((a) => [a.action, a.actor_type, a.source, a.actor_user_id])).toEqual([
      ["work_item.create", "service", "worker", null],
      ["inbox_notification.create", "service", "worker", null],
    ]);
  });

  it("concurrent creations with the same key: exactly one task and one reminder", async () => {
    const i = input();
    const results = await Promise.all(Array.from({ length: 6 }, () => create(i)));
    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(new Set(results.map((r) => r.workItemId)).size).toBe(1);
    const n = await api.db
      .selectFrom("inbox_notification")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("dedupe_key", "=", i.dedupeKey)
      .executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it("the worker kit's twin writes the same rows as the API service (ADR-0002: the worker imports no API code)", async () => {
    const shape = async (dedupeKey: string) => {
      const item = await api.db
        .selectFrom("work_item")
        .select([
          "kind",
          "assignee_user_id",
          "subject_type",
          "link_path",
          "message_key",
          "message_params",
          "due_date",
          "period_label",
          "status",
          "created_source",
          "version",
        ])
        .where("dedupe_key", "=", dedupeKey)
        .executeTakeFirstOrThrow();
      const note = await api.db
        .selectFrom("inbox_notification as n")
        .innerJoin("work_item as i", "i.id", "n.work_item_id")
        .select(["n.link_path", "n.message_key", "n.message_params", "n.read_at", "n.version"])
        .where("n.dedupe_key", "=", dedupeKey)
        .executeTakeFirstOrThrow();
      const audit = await api.db
        .selectFrom("audit_event as a")
        .innerJoin("work_item as i", "i.id", "a.record_id")
        .select(["a.action", "a.actor_type", "a.source", "a.changes"])
        .where("i.dedupe_key", "=", dedupeKey)
        .execute();
      return { item, note, audit: audit.map((a) => ({ ...a, changes: Object.keys(a.changes as object).sort() })) };
    };
    const subjectId = crypto.randomUUID();
    const a = input({ subjectId, dueDate: "2026-10-22" });
    const b = { ...a, dedupeKey: uniq("kpi.period_open:") };
    expect((await create(a)).outcome).toBe("created");
    expect((await create(b, WORKER, workerCreateWorkItemOnce)).outcome).toBe("created");
    expect((await create(b, WORKER, workerCreateWorkItemOnce)).outcome).toBe("existing");
    expect(await shape(b.dedupeKey)).toEqual(await shape(a.dedupeKey));
  });

  it("refuses an absolute link (the database CHECK backs it up)", async () => {
    await expect(create(input({ linkPath: "https://example.invalid/x" }))).rejects.toThrow(/relative/);
  });

  it("closeWorkItemsOfSubject closes the open items of a subject, audited", async () => {
    const subjectId = crypto.randomUUID();
    const r = await create(input({ subjectId, kind: "approval_decision", subjectType: "approval" }));
    const closed = await api.db
      .transaction()
      .execute((tx) =>
        closeWorkItemsOfSubject(
          tx,
          WORKER,
          { organizationId: w.orgA.id, subjectType: "approval", subjectId },
          "cancelled",
        ),
      );
    expect(closed).toBe(1);
    const row = await api.db
      .selectFrom("work_item")
      .select(["status", "version"])
      .where("id", "=", r.workItemId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "cancelled", version: 2 });
    expect((await auditOf(api.db, r.workItemId)).map((a) => a.action)).toEqual([
      "work_item.create",
      "work_item.cancel",
    ]);
  });
});

describe("My Work items (S-4)", () => {
  it("the assignee lists, reads and completes; nobody else sees or completes it", async () => {
    const r = await create(input());
    const W = `/api/v1/work-items/${r.workItemId}`;
    const list = await call<Body>(api.app, "GET", "/api/v1/me/work-items?status=open&kind=kpi_update_due", {
      session: office,
    });
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(r.workItemId);
    const auditorList = await call<Body>(api.app, "GET", "/api/v1/me/work-items", { session: auditor });
    expect(auditorList.body.items.map((i: { id: string }) => i.id)).not.toContain(r.workItemId);
    expect((await call<Body>(api.app, "GET", W, { session: auditor })).status).toBe(404);
    const got = await call<Body>(api.app, "GET", W, { session: office });
    expect([got.status, got.headers.etag, got.body.messageKey]).toEqual([200, '"1"', "tasks.kpi_update_due"]);
    // AUD (same organization) is 403 work_item.not_assignee; a user of another organization is 404.
    const denied = await call<Body>(api.app, "POST", `${W}/complete`, { session: auditor, headers: ifm(1) });
    expect([denied.status, denied.body.code, denied.body.detail]).toEqual([
      403,
      "work_item.not_assignee",
      "Only the person this task is assigned to can complete it.",
    ]);
    const officeB = await signIn(api.app, w.officeB.subject);
    expect((await call<Body>(api.app, "POST", `${W}/complete`, { session: officeB, headers: ifm(1) })).status).toBe(
      404,
    );
    expect((await call<Body>(api.app, "POST", `${W}/complete`, { session: office })).status).toBe(428);
    expect((await call<Body>(api.app, "POST", `${W}/complete`, { session: office, headers: ifm(5) })).status).toBe(409);
    const done = await call<Body>(api.app, "POST", `${W}/complete`, { session: office, headers: ifm(1) });
    expect([done.status, done.body.status, done.body.completedBy, done.body.version]).toEqual([
      200,
      "done",
      w.office.id,
      2,
    ]);
    const again = await call<Body>(api.app, "POST", `${W}/complete`, { session: office, headers: ifm(2) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "work_item.closed",
      "This task is already closed.",
    ]);
    expect((await auditOf(api.db, r.workItemId)).map((a) => [a.action, a.actor_user_id])).toEqual([
      ["work_item.create", null],
      ["work_item.complete", w.office.id],
    ]);
  });

  it("an approval task is system managed: 422 work_item.system_managed, nothing written", async () => {
    const r = await create(input({ kind: "approval_decision", subjectType: "approval" }));
    const res = await call<Body>(api.app, "POST", `/api/v1/work-items/${r.workItemId}/complete`, {
      session: office,
      headers: ifm(1),
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "work_item.system_managed",
      "This task closes automatically when its approval is decided.",
    ]);
    expect((await auditOf(api.db, r.workItemId)).map((a) => a.action)).toEqual(["work_item.create"]);
  });

  it("list order and pagination: open first by due date (no due date last); cursor pages are disjoint", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const mk = (dueDate: string | null) => create(input({ assigneeUserId: user.id, dueDate }));
    const late = await mk("2026-12-01");
    const none = await mk(null);
    const soon = await mk("2026-10-20");
    const closed = await mk("2026-10-01");
    await call(api.app, "POST", `/api/v1/work-items/${closed.workItemId}/complete`, { session: s, headers: ifm(1) });
    const p1 = await call<Body>(api.app, "GET", "/api/v1/me/work-items?limit=2", { session: s });
    const p2 = await call<Body>(
      api.app,
      "GET",
      `/api/v1/me/work-items?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      {
        session: s,
      },
    );
    expect([...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id)).toEqual([
      soon.workItemId,
      late.workItemId,
      none.workItemId,
      closed.workItemId,
    ]);
    expect(p2.body.nextCursor).toBeNull();
    // A cursor reused with other filters is 400.
    expect(
      (
        await call<Body>(
          api.app,
          "GET",
          `/api/v1/me/work-items?status=open&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
          { session: s },
        )
      ).status,
    ).toBe(400);
    expect((await call<Body>(api.app, "GET", "/api/v1/me/work-items?kind=Not-A-Kind", { session: s })).status).toBe(
      400,
    );
  });

  it("commit-time: a session that ended while the completion waited is 401; nothing written", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const r = await create(input({ assigneeUserId: user.id }));
    const res = await afterIdentity(
      api,
      user.id,
      () =>
        call<Body>(api.app, "POST", `/api/v1/work-items/${r.workItemId}/complete`, {
          session: s,
          headers: ifm(1),
          contract: false,
        }),
      (locker) => endSessions(locker, user.id),
    );
    expect(res.status).toBe(401);
    const row = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("id", "=", r.workItemId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("open");
  });
});

describe("the in-app inbox (S-4)", () => {
  it("lists the caller's reminders newest first with the unread count; read is once; others get 404", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const a = await create(input({ assigneeUserId: user.id }));
    const b = await create(input({ assigneeUserId: user.id }));
    const inbox = await call<Body>(api.app, "GET", "/api/v1/me/inbox", { session: s });
    expect(inbox.body.unreadCount).toBe(2);
    expect(inbox.body.items.map((n: { workItemId: string }) => n.workItemId)).toEqual([b.workItemId, a.workItemId]);
    const page1 = await call<Body>(api.app, "GET", "/api/v1/me/inbox?limit=1", { session: s });
    const page2 = await call<Body>(
      api.app,
      "GET",
      `/api/v1/me/inbox?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      {
        session: s,
      },
    );
    expect([page1.body.items[0].workItemId, page2.body.items[0].workItemId]).toEqual([b.workItemId, a.workItemId]);
    const note = inbox.body.items[1];
    const N = `/api/v1/me/inbox/${note.id}/read`;
    expect((await call<Body>(api.app, "POST", N, { session: office, headers: ifm(1) })).status).toBe(404);
    expect((await call<Body>(api.app, "POST", N, { session: auditor, headers: ifm(1) })).status).toBe(404);
    expect((await call<Body>(api.app, "POST", N, { session: s })).status).toBe(428);
    expect((await call<Body>(api.app, "POST", N, { session: s, headers: ifm(4) })).status).toBe(409);
    const read = await call<Body>(api.app, "POST", N, { session: s, headers: ifm(1) });
    expect([read.status, read.body.version, typeof read.body.readAt]).toEqual([200, 2, "string"]);
    const twice = await call<Body>(api.app, "POST", N, { session: s, headers: ifm(2) });
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      422,
      "inbox.already_read",
      "This reminder is already marked as read.",
    ]);
    const unread = await call<Body>(api.app, "GET", "/api/v1/me/inbox?unreadOnly=true", { session: s });
    expect([unread.body.unreadCount, unread.body.items.map((n: { id: string }) => n.id)]).toEqual([
      1,
      [inbox.body.items[0].id],
    ]);
    expect((await auditOf(api.db, note.id)).map((x) => [x.action, x.actor_user_id])).toEqual([
      ["inbox_notification.create", null],
      ["inbox_notification.read", user.id],
    ]);
    expect((await call<Body>(api.app, "GET", "/api/v1/me/inbox?unreadOnly=yes", { session: s })).status).toBe(400);
  });

  it("commit-time: a session that ended while marking a reminder read waited is 401; nothing written", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const r = await create(input({ assigneeUserId: user.id }));
    const note = await api.db
      .selectFrom("inbox_notification")
      .select("id")
      .where("work_item_id", "=", r.workItemId)
      .executeTakeFirstOrThrow();
    const res = await afterIdentity(
      api,
      user.id,
      () =>
        call<Body>(api.app, "POST", `/api/v1/me/inbox/${note.id}/read`, {
          session: s,
          headers: ifm(1),
          contract: false,
        }),
      (locker) => endSessions(locker, user.id),
    );
    expect(res.status).toBe(401);
    const row = await api.db
      .selectFrom("inbox_notification")
      .select("read_at")
      .where("id", "=", note.id)
      .executeTakeFirstOrThrow();
    expect(row.read_at).toBeNull();
  });

  it("anonymous callers get 401 on every task and inbox operation", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/me/work-items"],
      ["GET", "/api/v1/me/inbox"],
      ["GET", `/api/v1/work-items/${crypto.randomUUID()}`],
    ] as const)
      expect((await call<Body>(api.app, method, url)).status, url).toBe(401);
  });
});

describe("work items follow their source (T-DG4-BE-R1; D-102, D-105)", () => {
  const ACTION_KIND = "raid_action_due";
  const sourceInput = (subjectId: string, assigneeUserId: string, dueDate: string | null): WorkItemInput => ({
    organizationId: w.orgA.id,
    kind: ACTION_KIND,
    assigneeUserId,
    subjectType: "action_item",
    subjectId,
    linkPath: "/synthetic/action",
    messageKey: "raid.task.action_due",
    messageParams: {},
    dueDate,
    dedupeKey: `raid.action:${subjectId}:${assigneeUserId}`,
  });
  const ref = (subjectId: string) => ({
    organizationId: w.orgA.id,
    subjectType: "action_item",
    subjectId,
    kinds: [ACTION_KIND],
  });
  const itemsOf = (subjectId: string) =>
    api.db
      .selectFrom("work_item")
      .selectAll()
      .where("subject_id", "=", subjectId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
  type Impl = {
    create: typeof createWorkItemOnce;
    reschedule: typeof rescheduleWorkItemsOfSubject;
    reassign: typeof reassignWorkItemOfSubject;
  };
  const API_IMPL: Impl = {
    create: createWorkItemOnce,
    reschedule: rescheduleWorkItemsOfSubject,
    reassign: reassignWorkItemOfSubject,
  };
  const WORKER_IMPL: Impl = {
    create: workerCreateWorkItemOnce,
    reschedule: workerReschedule,
    reassign: workerReassign,
  };
  const run = <T>(fn: (t: Tx) => Promise<T>) => api.db.transaction().execute(fn);

  /** The same scenario through one implementation: create, reschedule (twice), A -> B (twice) -> A, reschedule. */
  async function scenario(impl: Impl, subjectId: string, a: string, b2: string) {
    await run((t) => impl.create(t, WORKER, sourceInput(subjectId, a, "2026-11-01")));
    const moved = await run((t) => impl.reschedule(t, WORKER, ref(subjectId), "2026-11-15"));
    const again = await run((t) => impl.reschedule(t, WORKER, ref(subjectId), "2026-11-15"));
    const toB = await run((t) => impl.reassign(t, WORKER, sourceInput(subjectId, b2, "2026-11-15")));
    const toBAgain = await run((t) => impl.reassign(t, WORKER, sourceInput(subjectId, b2, "2026-11-15")));
    const toA = await run((t) => impl.reassign(t, WORKER, sourceInput(subjectId, a, "2026-11-15")));
    const cleared = await run((t) => impl.reschedule(t, WORKER, ref(subjectId), null));
    return { moved, again, toB, toBAgain, toA, cleared };
  }

  it("reschedule moves the open item's due date once (audited); a repeat writes nothing", async () => {
    const subjectId = crypto.randomUUID();
    const r = await create(sourceInput(subjectId, w.office.id, "2026-11-01"));
    expect(await run((t) => rescheduleWorkItemsOfSubject(t, WORKER, ref(subjectId), "2026-11-20"))).toBe(1);
    expect(await run((t) => rescheduleWorkItemsOfSubject(t, WORKER, ref(subjectId), "2026-11-20"))).toBe(0);
    const [item] = await itemsOf(subjectId);
    expect([item!.due_date, item!.version, item!.status]).toEqual(["2026-11-20", 2, "open"]);
    expect(
      (await auditOf(api.db, r.workItemId)).map((a) => [a.action, a.prior_version, a.new_version, a.changes]),
    ).toEqual([
      ["work_item.create", null, 1, expect.anything()],
      ["work_item.reschedule", 1, 2, { due_date: { from: "2026-11-01", to: "2026-11-20" } }],
    ]);
    // A closed item never moves; other kinds of the same subject are left alone.
    await run((t) =>
      closeWorkItemsOfSubject(t, WORKER, { organizationId: w.orgA.id, subjectType: "action_item", subjectId }, "done"),
    );
    expect(await run((t) => rescheduleWorkItemsOfSubject(t, WORKER, ref(subjectId), "2026-12-01"))).toBe(0);
    await expect(
      run((t) => rescheduleWorkItemsOfSubject(t, WORKER, { ...ref(subjectId), kinds: [] }, "2026-12-01")),
    ).rejects.toThrow(/kinds/);
  });

  it("reassign A -> B -> A: exactly one open item, for A, under a fresh key; repeats are unchanged", async () => {
    const subjectId = crypto.randomUUID();
    const userB = await createUser(api.db, w.orgA.id);
    const r = await scenario(API_IMPL, subjectId, w.office.id, userB.id);
    expect([r.moved, r.again, r.cleared]).toEqual([1, 0, 1]);
    expect([r.toB.outcome, r.toB.cancelled, r.toBAgain.outcome, r.toBAgain.cancelled]).toEqual([
      "reassigned",
      1,
      "unchanged",
      0,
    ]);
    expect(r.toBAgain.workItemId).toBe(r.toB.workItemId);
    expect([r.toA.outcome, r.toA.cancelled]).toEqual(["reassigned", 1]);
    const items = await itemsOf(subjectId);
    expect(items.map((i) => [i.assignee_user_id, i.status, i.due_date, i.dedupe_key])).toEqual([
      [w.office.id, "cancelled", "2026-11-15", `raid.action:${subjectId}:${w.office.id}`],
      [userB.id, "cancelled", "2026-11-15", `raid.action:${subjectId}:${userB.id}`],
      [w.office.id, "open", null, `raid.action:${subjectId}:${w.office.id}#2`],
    ]);
    expect(items.filter((i) => i.status === "open").map((i) => i.id)).toEqual([r.toA.workItemId]);
    // Each new item got its in-app reminder; each cancellation is audited with the reason.
    const notes = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "dedupe_key"])
      .where(
        "work_item_id",
        "in",
        items.map((i) => i.id),
      )
      .orderBy("created_at")
      .execute();
    expect(notes.map((n) => n.recipient_user_id)).toEqual([w.office.id, userB.id, w.office.id]);
    const cancel = (await auditOf(api.db, items[1]!.id)).find((a) => a.action === "work_item.cancel")!;
    expect([cancel.reason, cancel.changes]).toEqual(["reassigned", { status: { from: "open", to: "cancelled" } }]);
  });

  it("parity (D-102): the worker kit's twins write the same rows and audit events as the API services", async () => {
    const userB = await createUser(api.db, w.orgA.id);
    const apiSubject = crypto.randomUUID();
    const workerSubject = crypto.randomUUID();
    const apiRun = await scenario(API_IMPL, apiSubject, w.office.id, userB.id);
    const workerRun = await scenario(WORKER_IMPL, workerSubject, w.office.id, userB.id);
    const strip = <T extends { workItemId: string }>(x: T) => ({ ...x, workItemId: "<id>" });
    expect({
      ...workerRun,
      toB: strip(workerRun.toB),
      toBAgain: strip(workerRun.toBAgain),
      toA: strip(workerRun.toA),
    }).toEqual({ ...apiRun, toB: strip(apiRun.toB), toBAgain: strip(apiRun.toBAgain), toA: strip(apiRun.toA) });
    const shape = async (subjectId: string) => {
      const items = await itemsOf(subjectId);
      const audit = await api.db
        .selectFrom("audit_event")
        .select(["record_id", "action", "actor_type", "source", "prior_version", "new_version", "reason", "changes"])
        .where(
          "record_id",
          "in",
          items.map((i) => i.id),
        )
        .orderBy("seq")
        .execute();
      const index = new Map(items.map((i, n) => [i.id, n]));
      return {
        items: items.map((i) => ({
          kind: i.kind,
          assignee: i.assignee_user_id,
          status: i.status,
          due: i.due_date,
          key: i.dedupe_key.replace(subjectId, "<subject>"),
          version: i.version,
          source: i.created_source,
        })),
        audit: audit.map((a) => {
          const changes = JSON.parse(JSON.stringify(a.changes ?? {}).replaceAll(subjectId, "<subject>"));
          return { ...a, record_id: index.get(a.record_id), changes };
        }),
      };
    };
    expect(await shape(workerSubject)).toEqual(await shape(apiSubject));
  });
});
