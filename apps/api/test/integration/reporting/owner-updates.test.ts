// Structured owner updates, update tasks and the executive pack (T-DG5-KBE-D; ADR-0045 §6, §9, §11; REQ-S09-011;
// p5-work-split §F.3). Proves, against the run's disposable PostgreSQL:
//  - REQ-S09-011: a WL submits the update of their workstream for the open period; the generated executive pack's
//    workstream section contains the submitted text and the workstream's current metrics (the same values as the DG4
//    workstream dashboard for that period), with no manual edit; a workstream without an update shows
//    `no_update_submitted` ("No update submitted"), never a blank or an older text; one without a lead shows `no_owner`;
//  - the refusals with their exact ADR-0045 §11 texts: a non-lead WL -> 403 owner_update.not_owner; a closed period ->
//    422 owner_update.period_not_open; an empty submit -> 422 owner_update.empty; editing a submitted update -> 422
//    owner_update.not_draft; reopen needs a reason (400 without; 422 owner_update.not_submitted on a draft); a second
//    update of the same subject and period -> 409 owner_update.exists;
//  - the task job (worker reports.owner_update_tasks) run twice creates one task per owner and period; a submitted
//    update completes its subject's tasks and gets none again;
//  - every write: AUD 403, If-Match 428/409, one audit event per mutation, commit-time re-authorization.
// All data is SYNTHETIC. Submitting an update or issuing a pack approves nothing; product gates G1-G6 are business
// approvals inside the product, and nothing here touches the engineering gates DG0-DG7.
import { OWNER_UPDATE_REFUSALS } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOwnerUpdateTasks } from "../../../../worker/src/handlers/reports.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let office: Session;
let wlB: { id: string; session: Session };
let ws1: Body; // lead: p.contributor (WL)
let ws2: Body; // lead: wlB (WL)
let ws3: Body; // no lead
let openPeriod: Body;
let closedPeriod: Body;
let taskPeriod: Body;

async function person(role: string): Promise<{ id: string; subject: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: p.transformationId }, w.orgA.id);
  return { ...u, session: await signIn(api.app, u.subject) };
}

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};
const refused = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect([res.status, res.body.code], JSON.stringify(res.body).slice(0, 600)).toEqual([status, code]);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};

const U = () => `${T}/updates`;
const create = (body: Record<string, unknown>, session: Session) => call<Body>(api.app, "POST", U(), { session, body });
const patch = (id: string, version: number | null, body: Record<string, unknown>, session: Session) =>
  call<Body>(api.app, "PATCH", `${U()}/${id}`, { session, headers: version === null ? {} : ifm(version), body });
const submit = (id: string, version: number | null, session: Session) =>
  call<Body>(api.app, "POST", `${U()}/${id}/submit`, { session, headers: version === null ? {} : ifm(version) });
const reopen = (id: string, version: number | null, body: Record<string, unknown>, session: Session) =>
  call<Body>(api.app, "POST", `${U()}/${id}/reopen`, {
    session,
    headers: version === null ? {} : ifm(version),
    body,
  });
const updateCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("owner_update")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("transformation_id", "=", p.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

async function period(label: string, start: string, end: string, state: "open" | "closed", due: string): Promise<Body> {
  const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const created = ok(
    await call<Body>(api.app, "POST", base, {
      session: office,
      body: { frequency: "monthly", periodLabel: label, periodStart: start, periodEnd: end, updateDueDate: due },
    }),
    201,
    "createReportingPeriod",
  );
  let row = ok(
    await call<Body>(api.app, "POST", `${base}/${created.id}/open`, { session: office, headers: ifm(1) }),
    200,
    "openReportingPeriod",
  );
  if (state === "closed")
    row = ok(
      await call<Body>(api.app, "POST", `${base}/${created.id}/close`, { session: office, headers: ifm(2) }),
      200,
      "closeReportingPeriod",
    );
  return row;
}

async function closePeriod(id: string, version: number): Promise<void> {
  ok(
    await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/reporting-periods/${id}/close`, {
      session: office,
      headers: ifm(version),
    }),
    200,
    "closeReportingPeriod",
  );
}

const workstream = async (name: string, leadUserId: string | null) =>
  ok(
    await call<Body>(api.app, "POST", `${T}/workstreams`, { session: p.lead.session, body: { name, leadUserId } }),
    201,
    "createWorkstream",
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  office = await signIn(api.app, w.office.subject);
  wlB = await person("WL");
  ws1 = await workstream("Synthetic roaming bundles", p.contributor.id);
  ws2 = await workstream("Synthetic digital channels", wlB.id);
  ws3 = await workstream("Synthetic workstream without a lead", null);
  openPeriod = await period("2041-01", "2041-01-01", "2041-01-31", "open", "2041-02-10");
  closedPeriod = await period("2040-12", "2040-12-01", "2040-12-31", "closed", "2041-01-10");
  taskPeriod = await period("2041-02", "2041-02-01", "2041-02-28", "open", "2041-03-10");
}, 120_000);
afterAll(() => api.close());

describe("REQ-S09-011: a WL's submitted update feeds the executive pack (ADR-0045 §6)", () => {
  let updateId: string;
  const achievements = "Synthetic: launched the roaming day-pass pilot in two regions.";
  const asks = "Synthetic: SteerCo to confirm the partner-tariff budget.";

  it("the workstream lead creates, edits and submits the update for the open period; each write audited once", async () => {
    const created = await call<Body>(api.app, "POST", U(), {
      session: p.contributor.session,
      body: { subjectType: "workstream", subjectId: ws1.id, reportingPeriodId: openPeriod.id, achievements },
    });
    const c = ok(created, 201, "createOwnerUpdate");
    expect(created.headers.location).toBe(`${U()}/${c.id}`);
    expect(created.headers.etag).toBe('"1"');
    expect(c).toMatchObject({
      transformationId: p.transformationId,
      subjectType: "workstream",
      subjectId: ws1.id,
      reportingPeriodId: openPeriod.id,
      periodLabel: "2041-01",
      ownerUserId: p.contributor.id,
      achievements,
      nextSteps: null,
      status: "draft",
      revisionNo: 0,
      submittedAt: null,
      version: 1,
    });
    updateId = c.id;
    const edited = ok(
      await patch(updateId, 1, { asks, risks: "Synthetic: partner delay." }, p.contributor.session),
      200,
      "update",
    );
    expect([edited.version, edited.asks, edited.achievements]).toEqual([2, asks, achievements]);
    const cleared = ok(await patch(updateId, 2, { risks: null }, p.contributor.session), 200, "clear");
    expect([cleared.version, cleared.risks]).toEqual([3, null]);
    const s = ok(await submit(updateId, 3, p.contributor.session), 200, "submit");
    expect(s).toMatchObject({ status: "submitted", revisionNo: 1, submittedBy: p.contributor.id, version: 4 });
    expect(s.submittedAt).not.toBeNull();
    const revs = ok(
      await call<Body>(api.app, "GET", `${U()}/${updateId}/revisions`, { session: p.auditor.session }),
      200,
      "revisions",
    );
    expect(revs.items).toHaveLength(1);
    expect(revs.items[0]).toMatchObject({
      revisionNo: 1,
      achievements,
      asks,
      risks: null,
      submittedBy: p.contributor.id,
    });
    expect((await auditOf(api.db, updateId)).map((a) => a.action)).toEqual([
      "owner_update.create",
      "owner_update.update",
      "owner_update.update",
      "owner_update.submit",
    ]);
    // Reads (AUD reads through transformation.read).
    const one = await call<Body>(api.app, "GET", `${U()}/${updateId}`, { session: p.auditor.session });
    expect([one.status, one.headers.etag, one.body.status]).toEqual([200, '"4"', "submitted"]);
    const list = ok(
      await call<Body>(
        api.app,
        "GET",
        `${U()}?reportingPeriodId=${openPeriod.id}&subjectType=workstream&status=submitted`,
        {
          session: p.auditor.session,
        },
      ),
      200,
      "list",
    );
    expect(list.items.map((i: Body) => i.id)).toEqual([updateId]);
  });

  it("the generated executive pack's workstream section holds the submitted text and the current metrics, unedited", async () => {
    const gen = ok(
      await call<Body>(api.app, "POST", `${T}/reports/executive_pack/generate`, {
        session: p.lead.session,
        body: { reportingPeriodId: openPeriod.id },
      }),
      201,
      "generate executive_pack",
    );
    const body = gen.content;
    const sections = body.sections as Body[];
    expect(body.transformation.id).toBe(p.transformationId);
    expect(body.period.id).toBe(openPeriod.id);
    expect(body.approvalState).toBe("not_applicable");
    const field = (sectionKey: string, key: string) =>
      (sections.find((s) => s.key === sectionKey)?.fields as Body[] | undefined)?.find((f) => f.key === key)?.value;
    const slug = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const k1 = slug(ws1.code);
    // (a) the submitted update, verbatim, with its revision.
    expect(field(`update_${k1}`, "update_state")).toMatchObject({ value: "submitted" });
    expect(field(`update_${k1}`, "achievements")).toMatchObject({
      type: "text",
      value: achievements,
      authored: "user",
    });
    expect(field(`update_${k1}`, "asks")).toMatchObject({ value: asks });
    expect(field(`update_${k1}`, "risks")).toMatchObject({ value: null, validation: "not_applicable" });
    expect(field(`update_${k1}`, "revision_no")).toMatchObject({ type: "count", value: 1 });
    // (b) the metrics equal the DG4 workstream dashboard for the same period (one engine, no copy).
    const dash = ok(
      await call<Body>(api.app, "GET", `${T}/workstreams/${ws1.id}/dashboard?periodId=${openPeriod.id}`, {
        session: p.lead.session,
      }),
      200,
      "workstream dashboard",
    );
    for (const a of dash.areas as Body[]) {
      const v = field(`metrics_${k1}`, `rag_${a.code}`);
      if (a.rag.status === "unknown" || a.rag.status === "stale")
        expect(v, a.code).toMatchObject({ value: null, validation: a.rag.status });
      else expect(v, a.code).toMatchObject({ value: a.rag.status });
    }
    const headlines = (dash.areas as Body[]).flatMap((a) => a.headlines as Body[]);
    const metricFields = (sections.find((s) => s.key === `metrics_${k1}`)!.fields as Body[]).filter(
      (f) => !f.key.startsWith("rag_") && !f.key.startsWith("open_raid_"),
    );
    expect(metricFields.map((f) => f.labelKey)).toEqual(headlines.map((h) => h.labelKey));
    for (const t of ["risk", "assumption", "issue", "dependency"])
      expect(field(`metrics_${k1}`, `open_raid_${t}`)).toMatchObject({ type: "count", value: 0 });
    // A workstream without an update: "No update submitted", none of the eight fields, never an older text.
    const k2 = slug(ws2.code);
    expect(field(`update_${k2}`, "update_state")).toMatchObject({ value: "no_update_submitted" });
    expect(field(`update_${k2}`, "achievements")).toBeUndefined();
    // A workstream without a lead: "No owner".
    expect(field(`update_${slug(ws3.code)}`, "owner")).toMatchObject({ type: "code", value: "no_owner" });
    // The transformation section comes first; no TL update yet.
    expect(sections[0].key).toBe("update_transformation");
    expect(field("update_transformation", "update_state")).toMatchObject({ value: "no_update_submitted" });
    // The snapshot cites the update row at its version and the revision it used.
    const sources = ok(
      await call<Body>(api.app, "GET", `${T}/report-snapshots/${gen.id}/sources?limit=100`, {
        session: p.lead.session,
      }),
      200,
      "sources",
    );
    expect(sources.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordType: "owner_update", recordId: updateId, recordVersion: 4 }),
        expect.objectContaining({ recordType: "owner_update_revision", recordVersion: 1 }),
        expect.objectContaining({ recordType: "workstream", recordId: ws1.id }),
      ]),
    );
    // The live view is the same assembly.
    const live = ok(
      await call<Body>(api.app, "GET", `${T}/reports/executive_pack/live?reportingPeriodId=${openPeriod.id}`, {
        session: p.auditor.session,
      }),
      200,
      "live",
    );
    const liveField = (live.document.sections as Body[])
      .find((s) => s.key === `update_${k1}`)!
      .fields.find((f: Body) => f.key === "achievements");
    expect(liveField.value.value).toBe(achievements);
  });

  it("refusals: not_draft on a submitted update, reopen with a reason, then a second revision", async () => {
    refused(
      await patch(updateId, 4, { asks: "Synthetic change" }, p.contributor.session),
      422,
      "owner_update.not_draft",
      OWNER_UPDATE_REFUSALS["owner_update.not_draft"],
    );
    refused(await submit(updateId, 4, p.contributor.session), 422, "owner_update.not_draft");
    expect((await reopen(updateId, 4, {}, p.contributor.session)).status).toBe(400);
    expect((await reopen(updateId, 4, { reason: "x" }, p.contributor.session)).status).toBe(400);
    expect((await reopen(updateId, 4, { reason: "   " }, p.contributor.session)).status).toBe(400);
    refused(await reopen(updateId, 4, { reason: "Synthetic correction" }, wlB.session), 403, "owner_update.not_owner");
    expect((await reopen(updateId, null, { reason: "Synthetic correction" }, p.contributor.session)).status).toBe(428);
    expect((await reopen(updateId, 9, { reason: "Synthetic correction" }, p.contributor.session)).status).toBe(409);
    const r = ok(await reopen(updateId, 4, { reason: "Synthetic correction" }, p.contributor.session), 200, "reopen");
    expect(r).toMatchObject({ status: "draft", revisionNo: 1, reopenReason: "Synthetic correction", version: 5 });
    refused(
      await reopen(updateId, 5, { reason: "Synthetic again" }, p.contributor.session),
      422,
      "owner_update.not_submitted",
      OWNER_UPDATE_REFUSALS["owner_update.not_submitted"],
    );
    ok(await patch(updateId, 5, { nextSteps: "Synthetic: scale to all regions." }, p.contributor.session), 200, "edit");
    const s2 = ok(await submit(updateId, 6, p.contributor.session), 200, "resubmit");
    expect([s2.revisionNo, s2.version]).toEqual([2, 7]);
    const revs = ok(
      await call<Body>(api.app, "GET", `${U()}/${updateId}/revisions?limit=1`, { session: p.auditor.session }),
      200,
      "revisions page 1",
    );
    expect(revs.items.map((x: Body) => x.revisionNo)).toEqual([2]);
    expect(revs.nextCursor).not.toBeNull();
    const page2 = ok(
      await call<Body>(
        api.app,
        "GET",
        `${U()}/${updateId}/revisions?limit=1&cursor=${encodeURIComponent(revs.nextCursor)}`,
        {
          session: p.auditor.session,
        },
      ),
      200,
      "revisions page 2",
    );
    expect(page2.items.map((x: Body) => x.revisionNo)).toEqual([1]);
    const reopenEvent = (await auditOf(api.db, updateId)).find((a) => a.action === "owner_update.reopen");
    expect(reopenEvent?.reason).toBe("Synthetic correction");
  });

  it("refusals: a non-lead WL -> 403 not_owner; AUD -> 403; the same subject and period twice -> 409 exists", async () => {
    const before = await updateCount();
    const body = { subjectType: "workstream", subjectId: ws1.id, reportingPeriodId: openPeriod.id, asks: "Synthetic" };
    refused(
      await create(body, wlB.session),
      403,
      "owner_update.not_owner",
      OWNER_UPDATE_REFUSALS["owner_update.not_owner"],
    );
    // The TL holds the permission but is not this workstream's lead.
    refused(await create(body, p.lead.session), 403, "owner_update.not_owner");
    refused(await create(body, p.auditor.session), 403, "forbidden");
    // AUD gets 403 whatever it sends (authorization before validation).
    expect((await create({ nope: 1 }, p.auditor.session)).status).toBe(403);
    refused(await patch(updateId, 7, { asks: "x" }, p.auditor.session), 403, "forbidden");
    refused(await submit(updateId, 7, p.auditor.session), 403, "forbidden");
    refused(await reopen(updateId, 7, { reason: "Synthetic reason" }, p.auditor.session), 403, "forbidden");
    refused(
      await create(body, p.contributor.session),
      409,
      "owner_update.exists",
      OWNER_UPDATE_REFUSALS["owner_update.exists"],
    );
    // A WL is not the transformation's owner (TL only).
    refused(
      await create(
        { subjectType: "transformation", subjectId: p.transformationId, reportingPeriodId: openPeriod.id },
        p.contributor.session,
      ),
      403,
      "owner_update.not_owner",
    );
    // References that do not exist in this transformation.
    refused(
      await create({ ...body, reportingPeriodId: crypto.randomUUID() }, p.contributor.session),
      422,
      "validation.reference",
    );
    refused(
      await create({ ...body, subjectId: crypto.randomUUID() }, p.contributor.session),
      422,
      "validation.reference",
    );
    refused(
      await create(
        { subjectType: "transformation", subjectId: ws1.id, reportingPeriodId: openPeriod.id },
        p.lead.session,
      ),
      422,
      "validation.reference",
    );
    // Validation: blank text, an unknown member, an empty patch.
    expect((await create({ ...body, achievements: "   " }, wlB.session)).status).toBe(400);
    expect((await create({ ...body, extra: 1 }, p.contributor.session)).status).toBe(400);
    expect((await patch(updateId, 7, {}, p.contributor.session)).status).toBe(400);
    expect(await updateCount()).toBe(before);
    // Outside the caller's scope: 404.
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await create(body, nobody)).status).toBe(404);
    expect((await call(api.app, "GET", U(), { session: nobody })).status).toBe(404);
    expect((await call(api.app, "GET", `${U()}/${crypto.randomUUID()}`, { session: p.auditor.session })).status).toBe(
      404,
    );
  });

  it("the TL writes the transformation's update; an empty submit -> 422 owner_update.empty; a closed period -> 422", async () => {
    const t = ok(
      await create(
        { subjectType: "transformation", subjectId: p.transformationId, reportingPeriodId: openPeriod.id },
        p.lead.session,
      ),
      201,
      "TL create",
    );
    refused(
      await submit(t.id, 1, p.lead.session),
      422,
      "owner_update.empty",
      OWNER_UPDATE_REFUSALS["owner_update.empty"],
    );
    refused(
      await create(
        { subjectType: "workstream", subjectId: ws2.id, reportingPeriodId: closedPeriod.id, asks: "Synthetic" },
        wlB.session,
      ),
      422,
      "owner_update.period_not_open",
      OWNER_UPDATE_REFUSALS["owner_update.period_not_open"],
    );
    // A draft whose period closes afterwards can no longer change.
    const late = await period("2041-04", "2041-04-01", "2041-04-30", "open", "2041-05-10");
    const d = ok(
      await create(
        { subjectType: "workstream", subjectId: ws2.id, reportingPeriodId: late.id, asks: "Synthetic" },
        wlB.session,
      ),
      201,
      "draft",
    );
    await closePeriod(late.id, late.version);
    refused(await patch(d.id, 1, { asks: "Synthetic later" }, wlB.session), 422, "owner_update.period_not_open");
    refused(await submit(d.id, 1, wlB.session), 422, "owner_update.period_not_open");
    expect((await auditOf(api.db, d.id)).map((a) => a.action)).toEqual(["owner_update.create"]);
  });

  it("commit-time authorization: owner_update.submit revoked while the request waits -> 403; nothing written", async () => {
    const lead = await person("WL");
    const ws = await workstream("Synthetic commit-time workstream", lead.id);
    const before = await updateCount();
    const res = await afterIdentity(
      api,
      lead.id,
      () =>
        call(api.app, "POST", U(), {
          session: lead.session,
          body: { subjectType: "workstream", subjectId: ws.id, reportingPeriodId: openPeriod.id, asks: "Synthetic" },
        }),
      () => revokeAll(api, w.grantor.id, lead.id),
    );
    expect(res.status).toBe(403);
    expect(await updateCount()).toBe(before);
  });
});

describe("the update task job (reports.owner_update_tasks; ADR-0045 §6)", () => {
  const tasks = () =>
    api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "subject_type", "subject_id", "status", "dedupe_key", "message_key", "period_label"])
      .where("transformation_id", "=", p.transformationId)
      .where("kind", "=", "owner_update_due")
      .where("period_label", "=", "2041-02")
      .orderBy("dedupe_key")
      .execute();

  it("run twice creates one task per owner and period; a submitted update completes its tasks and gets none again", async () => {
    const first = await createOwnerUpdateTasks(api.db, { organizationId: w.orgA.id }, "job:test-owner-update-1");
    const after1 = await tasks();
    expect(first.created).toBeGreaterThanOrEqual(3);
    const second = await createOwnerUpdateTasks(api.db, { organizationId: w.orgA.id }, "job:test-owner-update-2");
    expect(second.created).toBe(0);
    const after2 = await tasks();
    expect(after2).toEqual(after1);
    // One per owner, subject and period.
    const pairs = after2.map((t) => `${t.assignee_user_id}:${t.subject_type}:${t.subject_id}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toEqual(
      expect.arrayContaining([
        `${p.contributor.id}:workstream:${ws1.id}`,
        `${wlB.id}:workstream:${ws2.id}`,
        `${p.lead.id}:transformation:${p.transformationId}`,
      ]),
    );
    // No lead, no task.
    expect(after2.some((t) => t.subject_id === ws3.id)).toBe(false);
    expect(after2.every((t) => t.message_key === "reports.task.owner_update_due" && t.status === "open")).toBe(true);
    // Submitting the workstream's update completes its task (audited) and the next run creates none for it.
    const u = ok(
      await create(
        { subjectType: "workstream", subjectId: ws1.id, reportingPeriodId: taskPeriod.id, achievements: "Synthetic" },
        p.contributor.session,
      ),
      201,
      "create",
    );
    ok(await submit(u.id, 1, p.contributor.session), 200, "submit");
    const ws1Task = (await tasks()).find((t) => t.subject_id === ws1.id)!;
    expect(ws1Task.status).toBe("done");
    const third = await createOwnerUpdateTasks(api.db, { organizationId: w.orgA.id }, "job:test-owner-update-3");
    expect(third.created).toBe(0);
    expect((await tasks()).filter((t) => t.subject_id === ws1.id)).toHaveLength(1);
    // The task appears in the owner's My Work under Missing updates while open.
    const work = ok(await call<Body>(api.app, "GET", "/api/v1/me/work", { session: wlB.session }), 200, "my work");
    const missing = (work.sections as Body[]).find((s) => s.section === "missing_updates");
    expect((missing.items as Body[]).some((i) => i.kind === "owner_update_due")).toBe(true);
  });
});
