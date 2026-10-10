// My Work (the personal work dashboard) against a real PostgreSQL (T-DG4-KBE-G2; ADR-0037 §2, §7, §10; REQ-S03-008
// "a KPI owner with a due actual sees it under Missing updates with a link that opens the KPI period entry; another
// user's items never appear"; REQ-S13-001 "personal work"; p4-work-split §J+K JK.5):
//  - the kpi_update_due item is created by slice A's REAL period-open job (worker handlers/kpi.ts openDuePeriods) with
//    the KPI period-entry link, and shows under Missing updates for the KPI owner only, with its due date and overdue
//    flag, and in Upcoming deadlines;
//  - each of the 30 work-item kinds of a migrated database maps to exactly one section (the completeness test fails on
//    an unmapped kind);
//  - drafts list only the caller's own drafts (my_work_draft); an owned action item is listed once (not again when a
//    work item names it); an item of a transformation the caller cannot read is left out;
//  - section paging with a section-bound cursor; 401 without a session; an ADM-only caller gets an empty My Work.
// All data is synthetic.
import { insertAuditEvent, type Tx } from "@mth/db";
import { MY_WORK_SECTIONS } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDuePeriods } from "../../../../worker/src/handlers/kpi.ts";
import { MY_WORK_SECTION_BY_KIND, sectionOfKind } from "../../../src/modules/reporting/my-work.ts";
import { createWorkItemOnce, type WorkItemInput } from "../../../src/modules/tasks/index.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { createKpi } from "../kpi-p4/kbe-b-fixtures.ts";
import { DIRECT_FLOW, ownedKpi } from "../kpi-p4/kbe-c-fixtures.ts";
import { dashboardWorld, riyadhToday, type Body } from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let kpi: { id: string; name: string };
let today: string;
let draftKpiTl: string;
let draftKpiKds: string;
let otherTransformation: string;

const WORKER = { actorType: "service", actorUserId: null, requestId: "job:test-my-work", source: "worker" } as const;
const item = (over: Partial<WorkItemInput>): WorkItemInput => ({
  organizationId: w.orgA.id,
  transformationId: k.transformationId,
  kind: "raid_action_due",
  assigneeUserId: k.users.bo.id,
  subjectType: "action_item",
  subjectId: uuidv7(),
  linkPath: "/synthetic/link",
  messageKey: "tasks.synthetic",
  messageParams: {},
  dedupeKey: `test.my_work:${uuidv7()}`,
  ...over,
});
const create = (i: WorkItemInput) => api.db.transaction().execute((tx: Tx) => createWorkItemOnce(tx, WORKER, i));
const get = (url: string, session: Session) => call<Body>(api.app, "GET", url, { session });
const sectionOf = (body: Body, s: string): Body => (body.sections as Body[]).find((x) => x.section === s);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  today = (await riyadhToday(api)).today;
  k = await dashboardWorld(api, w, w.a1);
  kpi = await ownedKpi(api, k, DIRECT_FLOW); // monthly, owned by KDS
  // A SCHEDULED monthly period whose end has passed: the period-open job opens it and creates the owner's task.
  const office = await signIn(api.app, w.office.subject);
  const created = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/reporting-periods`, {
    session: office,
    body: {
      frequency: "monthly",
      periodLabel: "2026-05",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      updateDueDate: "2026-06-10",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.status).toBe("scheduled");
  const job = await openDuePeriods(api.db, { organizationId: w.orgA.id }, "job:test-my-work-open");
  expect(job.opened).toBeGreaterThanOrEqual(1);
  draftKpiTl = (await createKpi(api, k, {}, { draft: true, session: k.s.tl })).id;
  draftKpiKds = (await createKpi(api, k, {}, { draft: true, session: k.s.kds })).id;
  otherTransformation = await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id);
}, 300_000);
afterAll(() => api.close());

describe("REQ-S03-008: My Work shows the caller's own items", () => {
  it("a KPI owner with a due actual sees the kpi_update_due item under Missing updates, with the period-entry link", async () => {
    const r = await get("/api/v1/me/work", k.s.kds);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.userId, (r.body.sections as Body[]).map((s) => s.section)]).toEqual([
      k.users.kds.id,
      [...MY_WORK_SECTIONS],
    ]);
    const missing = sectionOf(r.body, "missing_updates");
    const due = (missing.items as Body[]).find((i) => i.kind === "kpi_update_due" && i.recordId === kpi.id);
    expect(due, JSON.stringify(missing)).toMatchObject({
      section: "missing_updates",
      source: "work_item",
      recordType: "kpi_definition",
      transformationId: k.transformationId,
      // The KPI period entry (the link slice A's period-open job stores on the item).
      href: `/transformations/${k.transformationId}/kpis/${kpi.id}/actuals`,
      dueDate: "2026-06-10",
      overdue: "2026-06-10" < today,
      code: "2026-05",
      messageKey: "kpi.update_due",
    });
    expect(missing.total).toBeGreaterThanOrEqual(1);
    // Overdue items are in Upcoming deadlines, flagged.
    expect((r.body.upcomingDeadlines as Body[]).some((i) => i.recordId === kpi.id && i.overdue === true)).toBe(true);
  });

  it("another user's items never appear", async () => {
    for (const s of [k.s.tl, k.s.bo, k.s.auditor]) {
      const r = await get("/api/v1/me/work", s);
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.body);
      expect(text.includes(kpi.id), "the KDS task").toBe(false);
      expect(text.includes(draftKpiKds), "the KDS draft").toBe(false);
      for (const sec of r.body.sections as Body[])
        for (const i of sec.items as Body[]) expect(i.kind).not.toBe("kpi_update_due");
    }
  });

  it("drafts list only the caller's own drafts, each with its record path", async () => {
    const tl = sectionOf((await get("/api/v1/me/work", k.s.tl)).body, "drafts");
    expect(tl.items.map((i: Body) => i.recordId)).toContain(draftKpiTl);
    expect(tl.items.map((i: Body) => i.recordId)).not.toContain(draftKpiKds);
    expect(tl.items.find((i: Body) => i.recordId === draftKpiTl)).toMatchObject({
      section: "drafts",
      source: "draft",
      recordType: "kpi_definition",
      href: `/api/v1/transformations/${k.transformationId}/kpi-definitions/${draftKpiTl}`,
      dueDate: null,
      overdue: false,
    });
    const kds = sectionOf((await get("/api/v1/me/work", k.s.kds)).body, "drafts");
    expect(kds.items.map((i: Body) => i.recordId)).toEqual([draftKpiKds]);
    // Drafts are never deadlines.
    const deadlines = (await get("/api/v1/me/work", k.s.tl)).body.upcomingDeadlines as Body[];
    expect(deadlines.some((i) => i.section === "drafts")).toBe(false);
  });

  it("an owned action item is listed once; a work item naming it replaces it; an unreadable transformation's item is left out", async () => {
    const actionId = uuidv7();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("action_item")
        .values({
          id: actionId,
          organization_id: w.orgA.id,
          transformation_id: k.transformationId,
          title: "Synthetic follow-up action",
          owner_user_id: k.users.bo.id,
          due_date: "2026-11-02",
          created_by: k.users.tl.id,
          updated_by: k.users.tl.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: k.users.tl.id, requestId: `fixture-${actionId}`, source: "api" },
        {
          action: "action_item.create",
          recordType: "action_item",
          recordId: actionId,
          organizationId: w.orgA.id,
          transformationId: k.transformationId,
          newVersion: 1,
        },
      );
    });
    const before = sectionOf((await get("/api/v1/me/work", k.s.bo)).body, "assigned_actions");
    expect(before.items.filter((i: Body) => i.recordId === actionId)).toMatchObject([
      { source: "action_item", label: "Synthetic follow-up action", href: `${k.base}/actions/${actionId}` },
    ]);
    await create(item({ subjectId: actionId, dueDate: "2026-11-02" }));
    const after = sectionOf((await get("/api/v1/me/work", k.s.bo)).body, "assigned_actions");
    expect(after.items.filter((i: Body) => i.recordId === actionId)).toMatchObject([
      { source: "work_item", kind: "raid_action_due" },
    ]);
    // An item of a transformation BO cannot read (BU a2, no grant) is left out.
    const hidden = uuidv7();
    await create(item({ transformationId: otherTransformation, subjectId: hidden, kind: "control_check_due" }));
    expect(JSON.stringify((await get("/api/v1/me/work", k.s.bo)).body).includes(hidden)).toBe(false);
  });

  it("pages one section with a section-bound cursor", async () => {
    for (const due of ["2026-12-01", "2026-12-02", "2026-12-03"])
      await create(item({ kind: "approval_outcome", subjectType: "approval", dueDate: due }));
    const p1 = await get("/api/v1/me/work?section=other&limit=2", k.s.bo);
    expect([p1.status, p1.body.sections.length, p1.body.sections[0].items.length], JSON.stringify(p1.body)).toEqual([
      200, 1, 2,
    ]);
    const total = p1.body.sections[0].total as number;
    expect(total).toBeGreaterThanOrEqual(3);
    const cursor = p1.body.sections[0].nextCursor as string;
    expect(cursor).not.toBeNull();
    const seen = [...p1.body.sections[0].items];
    let next: string | null = cursor;
    while (next !== null) {
      const p: { status: number; body: Body } = await get(
        `/api/v1/me/work?section=other&limit=2&cursor=${encodeURIComponent(next)}`,
        k.s.bo,
      );
      expect(p.status).toBe(200);
      seen.push(...p.body.sections[0].items);
      next = p.body.sections[0].nextCursor;
    }
    expect(seen.length).toBe(total);
    expect(new Set(seen.map((i: Body) => i.recordId)).size).toBe(total);
    const dues = seen.map((i: Body) => i.dueDate ?? "9999-12-31");
    expect(dues).toEqual([...dues].sort());
    // A cursor without its section, of another section or of another user is refused.
    expect((await get(`/api/v1/me/work?cursor=${encodeURIComponent(cursor)}`, k.s.bo)).status).toBe(400);
    expect((await get(`/api/v1/me/work?section=reviews&cursor=${encodeURIComponent(cursor)}`, k.s.bo)).status).toBe(
      400,
    );
    expect((await get(`/api/v1/me/work?section=other&cursor=${encodeURIComponent(cursor)}`, k.s.tl)).status).toBe(400);
    expect((await get("/api/v1/me/work?section=nope", k.s.bo)).status).toBe(400);
  });

  it("401 without a session; an ADM-only caller gets an empty My Work", async () => {
    expect((await call(api.app, "GET", "/api/v1/me/work")).status).toBe(401);
    const admin = await signIn(api.app, w.admin.subject);
    const r = await get("/api/v1/me/work", admin);
    expect(r.status).toBe(200);
    expect((r.body.sections as Body[]).every((s) => s.total === 0)).toBe(true);
  });

  it("stores nothing (no audit event and no row from a read)", async () => {
    const n = async () =>
      Number(
        (
          await api.db
            .selectFrom("audit_event")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      );
    const before = await n();
    await get("/api/v1/me/work", k.s.kds);
    expect(await n()).toBe(before);
  });
});

describe("MY_WORK_SECTION_BY_KIND completeness (ADR-0037 §7)", () => {
  it("each of the 30 work-item kinds of the migrated database maps to exactly one section", async () => {
    const kinds = (await api.db.selectFrom("work_item_kind").select("code").orderBy("code").execute()).map(
      (r) => r.code,
    );
    expect(kinds.length).toBe(30);
    const unmapped = kinds.filter((c) => !Object.prototype.hasOwnProperty.call(MY_WORK_SECTION_BY_KIND, c));
    expect(unmapped, "a work_item_kind with no My Work section: add it to MY_WORK_SECTION_BY_KIND").toEqual([]);
    expect(Object.keys(MY_WORK_SECTION_BY_KIND).sort()).toEqual(kinds);
    for (const c of kinds) expect(MY_WORK_SECTIONS).toContain(MY_WORK_SECTION_BY_KIND[c]);
    // An unmapped kind is still shown (under "other"), never hidden.
    expect(sectionOfKind("a_future_kind")).toBe("other");
  });

  it("the mapping of ADR-0037 §7 (section sizes)", () => {
    const size = (s: string) => Object.values(MY_WORK_SECTION_BY_KIND).filter((x) => x === s).length;
    expect(["assigned_actions", "reviews", "approvals", "missing_updates", "other"].map((s) => [s, size(s)])).toEqual([
      ["assigned_actions", 9],
      ["reviews", 5],
      ["approvals", 8],
      ["missing_updates", 5],
      ["other", 3],
    ]);
  });
});
