// T-DG6-BE-Z13 (F-DG6-540; D-218, D-222 (1), D-226; ADR-0051 §2, §3; REQ-S10-002 "a sensitive benefit is hidden from
// a workstream member without the grant"): every response that serializes an in-app notification (listMyInbox AND
// markInboxNotificationRead) applies D-218 when the notification is about a record the recipient is not admitted to,
// directly or through a child that carries a sensitive benefit's values: the text is `inbox.restricted` with params
// {}, the link is the transformation home and the item carries `includesRestrictedRecords: true`. Cases:
//   - a Finance validation of a benefit then marked sensitive (the worker producer's shape, benefits.ts);
//   - a benefit overlap through the REAL producer (POST /benefit-overlaps writes the Finance recipient's notification);
//   - a link to the hidden benefit itself, read and then marked read (the mark-read response);
//   - positive: an admitted recipient (explicit grant) gets the original text and link back; an unrelated reminder is
//     never redacted; the stored rows are never modified; a forwarded deep link to the child route is refused 403.
// Every value is SYNTHETIC. The finance_validation row is inserted as the worker job inserts it, with its audit event
// (synthetic setup); it validates nothing. Marking a record sensitive or granting access is an access decision, never a
// business or Finance approval (G1-G6), and nothing here touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createWorkItemOnce, issueDeepLink } from "../../../src/modules/tasks/index.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import {
  benefitAt,
  financialBody,
  insertSubmittedMeasurement,
  seedBenefitWorld,
  type BenefitWorld,
} from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO: marks records and grants (sensitive_record.grant)
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:inbox-z13", source: "worker" } as const;
const S = { benefit: "", code: "", other: "", fv: "", overlap: "" };
const home = () => `/transformations/${b.transformationId}`;

const mkBenefit = async (title: string) => {
  const r = await send("POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, { title }) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Body;
};
const markSensitive = async (benefitId: string) => {
  const r = await send("PUT", `${b.base}/records/benefit/${benefitId}/sensitivity`, {
    session: office,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit (BE-Z13 inbox)" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};
/** The notification of a work item created as `createWorkItemOnce` producers do; released if it was held. */
async function notify(input: Parameters<typeof createWorkItemOnce>[2]): Promise<string> {
  const out = await api.db.transaction().execute((tx) => createWorkItemOnce(tx, WORKER, input));
  const n = await api.db
    .selectFrom("inbox_notification")
    .select(["id", "delivery_state"])
    .where("work_item_id", "=", out.workItemId)
    .executeTakeFirstOrThrow();
  expect(n.delivery_state).toBe("delivered");
  return n.id;
}
const inboxOf = async (session: Session) => {
  const res = await send("GET", "/api/v1/me/inbox?limit=100", { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Body;
};
const storedRow = (id: string) =>
  api.db.selectFrom("inbox_notification").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const restrictedView = (n: Body) => ({
  messageKey: n.messageKey,
  messageParams: n.messageParams,
  linkPath: n.linkPath,
  marker: n.includesRestrictedRecords,
});
const REDACTED = () => ({ messageKey: "inbox.restricted", messageParams: {}, linkPath: home(), marker: true });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  // At the Measure step, so it can hold a measurement and its Finance validation.
  const hidden = await benefitAt(api, b, "measure");
  S.benefit = hidden.id;
  S.code = hidden.code;
  S.other = (await mkBenefit("Synthetic open benefit (BE-Z13)")).id;
  // A Finance validation of the benefit, inserted as the worker's finance-validation job does (synthetic setup).
  const measurementId = await insertSubmittedMeasurement(api.db, b, S.benefit, "1000.00");
  S.fv = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("finance_validation")
      .values({
        id: S.fv,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        benefit_id: S.benefit,
        benefit_measurement_id: measurementId,
        kind: "validation",
        idempotency_key: uniq("z13-fv:"),
        assignee_user_id: null,
        status: "queued",
        content: JSON.stringify(
          Object.fromEntries(
            ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"].map((k) => [
              k,
              {},
            ]),
          ),
        ),
        measurement_period_start: "2026-09-01",
        measurement_period_end: "2026-09-30",
        created_by: b.users.bo.id,
        updated_by: b.users.bo.id,
      })
      .execute();
    await insertAuditEvent(tx, WORKER, {
      action: "finance_validation.queued",
      recordType: "finance_validation",
      recordId: S.fv,
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      newVersion: 1,
      changes: { status: { from: null, to: "queued" } },
    });
  });
  // The benefit overlap through the real producer: the Finance recipient (FIN) gets a work item and a notification.
  const ov = await send("POST", `${b.base}/benefit-overlaps`, {
    session: b.s.tl,
    body: { benefitAId: S.benefit, benefitBId: S.other, dimensions: ["driver"] },
  });
  expect(ov.status, JSON.stringify(ov.body)).toBe(201);
  S.overlap = ov.body.id;
}, 240_000);
afterAll(() => api?.close());

describe("T-DG6-BE-Z13: inbox notifications about a restricted record (F-DG6-540; D-226)", () => {
  let fvNote = "";
  let benefitNote = "";
  let openNote = "";
  let overlapNote = "";

  beforeAll(async () => {
    // Issued before the benefit is marked (as in production), each for FIN (not admitted once the benefit is marked).
    fvNote = await notify({
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      kind: "finance_validation_review",
      assigneeUserId: b.users.fin.id,
      subjectType: "finance_validation",
      subjectId: S.fv,
      linkPath: `${home()}/finance-validations/${S.fv}`,
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: S.code, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      dedupeKey: `finance_validation:${S.fv}:${b.users.fin.id}`,
    });
    benefitNote = await notify({
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      kind: "kpi_update_due",
      assigneeUserId: b.users.fin.id,
      subjectType: "benefit",
      subjectId: S.benefit,
      linkPath: `${home()}/benefits/${S.benefit}`,
      messageKey: "tasks.kpi_update_due",
      messageParams: { title: S.code },
      dedupeKey: uniq("z13-benefit:"),
    });
    openNote = await notify({
      organizationId: b.organizationId,
      transformationId: b.transformationId,
      kind: "kpi_update_due",
      assigneeUserId: b.users.fin.id,
      subjectType: "benefit",
      subjectId: S.other,
      linkPath: `${home()}/benefits/${S.other}`,
      messageKey: "tasks.kpi_update_due",
      messageParams: { title: "Synthetic open" },
      dedupeKey: uniq("z13-open:"),
    });
    const ov = await api.db
      .selectFrom("inbox_notification as n")
      .innerJoin("work_item as w", "w.id", "n.work_item_id")
      .select(["n.id", "n.link_path", "n.delivery_state"])
      .where("w.subject_type", "=", "benefit_overlap")
      .where("w.subject_id", "=", S.overlap)
      .where("n.recipient_user_id", "=", b.users.fin.id)
      .executeTakeFirstOrThrow();
    expect(ov.delivery_state).toBe("delivered");
    overlapNote = ov.id;
    await markSensitive(S.benefit);
  });

  it("control: FIN gets 404 on the benefit, its Finance validation and the overlap", async () => {
    for (const path of [`/benefits/${S.benefit}`, `/finance-validations/${S.fv}`, `/benefit-overlaps/${S.overlap}`]) {
      const res = await send("GET", `${b.base}${path}`, { session: b.s.fin });
      expect(res.status, path).toBe(404);
    }
  });

  it("listMyInbox: Finance validation, overlap and benefit notifications are redacted; no hidden id or code", async () => {
    const before = await Promise.all([fvNote, overlapNote, benefitNote].map(storedRow));
    const page = await inboxOf(b.s.fin);
    const byId = new Map((page.items as Body[]).map((n) => [n.id, n]));
    for (const id of [fvNote, overlapNote, benefitNote]) {
      const n = byId.get(id);
      expect(restrictedView(n), id).toEqual(REDACTED());
      expect(n.workItemId).not.toBeNull();
    }
    const text = JSON.stringify(page);
    for (const hidden of [S.benefit, S.fv, S.overlap, S.code]) expect(text, hidden).not.toContain(hidden);
    // Negative control: a reminder about an open benefit keeps its text and link and carries no marker.
    expect(restrictedView(byId.get(openNote))).toEqual({
      messageKey: "tasks.kpi_update_due",
      messageParams: { title: "Synthetic open" },
      linkPath: `${home()}/benefits/${S.other}`,
      marker: undefined,
    });
    // The redaction never modifies a stored row.
    expect(await Promise.all([fvNote, overlapNote, benefitNote].map(storedRow))).toEqual(before);
  });

  it("listMyWorkItems: the work item of the Finance validation links home, as its notification does", async () => {
    const res = await send("GET", "/api/v1/me/work-items?limit=100", { session: b.s.fin });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fvNoteRow = await storedRow(fvNote);
    const item = (res.body.items as Body[]).find((x) => x.id === fvNoteRow.work_item_id);
    expect({
      subjectId: item.subjectId,
      linkPath: item.linkPath,
      key: item.messageKey,
      marker: item.includesRestrictedRecords,
    }).toEqual({ subjectId: null, linkPath: home(), key: "inbox.restricted", marker: true });
    for (const hidden of [S.benefit, S.fv, S.overlap, S.code]) expect(JSON.stringify(res.body)).not.toContain(hidden);
  });

  it("markInboxNotificationRead returns the same redaction as the list (each restricted kind)", async () => {
    for (const id of [fvNote, overlapNote, benefitNote]) {
      const row = await storedRow(id);
      const res = await send("POST", `/api/v1/me/inbox/${id}/read`, {
        session: b.s.fin,
        headers: { "if-match": `"${row.version}"` },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(restrictedView(res.body), id).toEqual(REDACTED());
      expect(res.body.readAt).not.toBeNull();
      for (const hidden of [S.benefit, S.fv, S.overlap, S.code]) expect(JSON.stringify(res.body)).not.toContain(hidden);
      // The read was recorded on the stored row (text and link unchanged there).
      const after = await storedRow(id);
      expect(after.read_at).not.toBeNull();
      expect(after.link_path).toBe(row.link_path);
    }
  });

  it("a forwarded deep link to the Finance validation route is refused 403 for FIN", async () => {
    const { token } = await issueDeepLink(api.db, fvNote, WORKER);
    const res = await send("GET", `/api/v1/links/${token}`, { session: b.s.fin });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("deep_link.forbidden");
  });

  it("positive: after an explicit grant FIN gets the original text and link back (list)", async () => {
    const g = await send("POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: b.transformationId,
        recordType: "benefit",
        recordId: S.benefit,
        granteeUserId: b.users.fin.id,
        reason: "Synthetic need to know (Finance)",
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const byId = new Map(((await inboxOf(b.s.fin)).items as Body[]).map((n) => [n.id, n]));
    expect(restrictedView(byId.get(fvNote))).toEqual({
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: S.code, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      linkPath: `${home()}/finance-validations/${S.fv}`,
      marker: undefined,
    });
    expect(byId.get(overlapNote).linkPath).toContain(S.overlap);
    expect(byId.get(benefitNote).linkPath).toBe(`${home()}/benefits/${S.benefit}`);
  });

  it("negative: another user cannot mark FIN's notification read (404, nothing written)", async () => {
    const row = await storedRow(openNote);
    const res = await send("POST", `/api/v1/me/inbox/${openNote}/read`, {
      session: b.s.bo2,
      headers: { "if-match": `"${row.version}"` },
    });
    expect(res.status).toBe(404);
    expect(await storedRow(openNote)).toEqual(row);
    const count = await sql<{
      n: string;
    }>`SELECT count(*)::text AS n FROM inbox_notification WHERE id = ${openNote}::uuid
      AND read_at IS NOT NULL`.execute(api.db);
    expect(count.rows[0]?.n).toBe("0");
  });
});
