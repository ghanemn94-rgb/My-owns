// A sensitive benefit's corrective case, transition decision, performance-area link and enabler link (T-DG6-BE-Z4;
// F-DG6-220; ADR-0051 §2 and its 2026-11-04 amendment; REQ-S10-002 "a sensitive benefit is hidden from a workstream
// member without the grant"; M0188), against the run's disposable PostgreSQL. Every value is SYNTHETIC. Marking a
// record sensitive or granting access is an access decision, never a business approval (G1-G6), and nothing here
// touches the engineering gates DG0-DG7.
//
// Ported from the domain reviewer's round-3 probe (docs/delivery/test-evidence/DG6/domain/round-3/probes/
// dom-r3-sensitive-registers.test.ts.txt) onto the product fixtures, then widened to every route and read path of the
// four `benefitChild` types the registers expose:
//   - negative (TL, AUD and BO2: no grant, not a named party of the benefit): 404 on the benefit; the case, the
//     decision and the benefit link are absent from their lists (every cursor page; the rows of a plain benefit are still
//     listed, so nothing else is hidden); every item, signals, actions, close, edit, submit and remove route that names
//     one answers 404; a create that names the benefit answers the 422 of an unknown id; the inbox notification about
//     the case or decision says `inbox.restricted`; the work item, the My Work item and the workspace header's next
//     action say it too and (T-DG6-BE-Z12B, D-222, superseding BE-Z4's kept ids) carry no subject or record id, link to
//     the transformation home and carry `includesRestrictedRecords: true`, and the assignee still completes the item;
//     the deep link answers the one 403; and no refused write changed a row;
//   - positive: the TO (sensitive_record.grant) and BO (the owner, a named party) see everything, and BO2 and TL after
//     an explicit grant see the rows and texts again on the next request.
// It fails on the round-3 candidate (every row is listed and every item answers 200) and passes with the list filters
// and the correctiveCaseId / transitionDecisionId / performanceAreaLinkId / benefitEnablerId reach parameters.
import { insertAuditEvent, sql } from "@mth/db";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkItemOnce, issueDeepLink } from "../../../src/modules/tasks/index.ts";
import { call, seedWorld, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let c: ClosureWorld;
/** The benefit that is marked sensitive, and its four children. */
const S = { benefitId: "", caseId: "", decisionId: "", areaId: "", linkId: "", enablerId: "" };
/** A plain benefit's rows (stay listed to everyone). */
const P = { benefitId: "", caseId: "", decisionId: "", linkId: "" };
/** The work items and notifications about the sensitive case and decision (assigned to BO2). */
const N = { caseItemId: "", caseNoteId: "", decisionItemId: "", decisionNoteId: "" };
const CASE_TITLE = "Synthetic CONFIDENTIAL tariff uplift variance";
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};

/** Every page of a list (limit 1, so the filter is exercised across cursor pages). */
async function all(s: Session, url: string): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i += 1) {
    const q: string = cursor === null ? "limit=1" : `limit=1&cursor=${encodeURIComponent(cursor)}`;
    const page = ok(await send("GET", `${url}${url.includes("?") ? "&" : "?"}${q}`, { session: s }));
    out.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return out;
  }
  throw new Error(`more than 200 pages: ${url}`);
}
const ids = (rows: Body[]) => rows.map((r) => r.id as string);
/** Every My Work item of the caller (every section, and the upcoming deadlines). */
async function myWork(s: Session): Promise<Body[]> {
  const body = ok(await send("GET", "/api/v1/me/work?limit=100", { session: s }));
  return [...body.sections.flatMap((x: Body) => x.items), ...body.upcomingDeadlines];
}

/** A worker-style benefit_variance corrective case naming the benefit (as the corrective consumer writes it). */
async function varianceCase(benefitId: string, ownerUserId: string): Promise<string> {
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("corrective_case")
      .values({
        id,
        organization_id: c.b.organizationId,
        transformation_id: c.b.transformationId,
        code: `CA-9${String(Math.floor(Math.random() * 90000) + 10000)}`,
        source_kind: "benefit_variance",
        source_scope_key: benefitId,
        benefit_id: benefitId,
        source_record_type: null,
        source_record_id: null,
        title: CASE_TITLE,
        recovery_plan: "Synthetic CONFIDENTIAL recovery: reprice the enterprise bundle",
        owner_user_id: ownerUserId,
        follow_up_date: "2030-01-15",
        consecutive_off_track: 2,
        signal_count: 2,
        created_source: "worker",
        created_by: null,
        updated_by: null,
      })
      .execute();
    await insertAuditEvent(
      tx,
      {
        actorType: "service",
        actorUserId: null,
        onBehalfOfUserId: null,
        requestId: `job:${randomUUID()}`,
        source: "worker",
      },
      {
        action: "corrective_case.created",
        recordType: "corrective_case",
        recordId: id,
        organizationId: c.b.organizationId,
        transformationId: c.b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A worker-created work item (and its notification, made `delivered`) for BO2 about a case or decision. */
async function itemFor(subjectType: string, subjectId: string, path: string, kind: string, key: string) {
  const out = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(
      tx,
      { actorType: "service", actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" },
      {
        organizationId: c.b.organizationId,
        transformationId: c.b.transformationId,
        kind,
        assigneeUserId: c.b.users.bo2.id,
        subjectType,
        subjectId,
        linkPath: `/transformations/${c.b.transformationId}/${path}/${subjectId}`,
        messageKey: key,
        messageParams: { caseCode: "CA-SYNTH" },
        dueDate: "2030-01-15",
        dedupeKey: `test.z4:${subjectId}:${c.b.users.bo2.id}`,
      },
    ),
  );
  // Quiet hours or a digest may hold the notification (ADR-0044 §5); release it as the delivery job would (audited).
  const note = await api.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom("inbox_notification")
      .select(["id", "version", "delivery_state"])
      .where("work_item_id", "=", out.workItemId)
      .executeTakeFirstOrThrow();
    if (row.delivery_state === "delivered") return row;
    await tx
      .updateTable("inbox_notification")
      .set({ delivery_state: "delivered", version: sql<number>`version + 1` })
      .where("id", "=", row.id)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "service", actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" },
      {
        action: "inbox_notification.delivered",
        recordType: "inbox_notification",
        recordId: row.id,
        organizationId: c.b.organizationId,
        transformationId: c.b.transformationId,
        priorVersion: row.version,
        newVersion: row.version + 1,
      },
    );
    return row;
  });
  return { workItemId: out.workItemId, notificationId: note.id };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  S.benefitId = (await pendingBenefit(api, c, ini)).id;
  P.benefitId = (await pendingBenefit(api, c, ini)).id;
  S.decisionId = (await draftDecision(send, c, S.benefitId)).id;
  P.decisionId = (await draftDecision(send, c, P.benefitId)).id;
  S.areaId = ok(
    await send("POST", c.s.areas, { session: c.s.to.session, body: { name: "Synthetic enterprise value area" } }),
    201,
  ).id;
  const link = (benefitId: string) =>
    send("POST", `${c.s.areas}/${S.areaId}/links`, { session: c.b.s.bo, body: { linkKind: "benefit", benefitId } });
  S.linkId = ok(await link(S.benefitId), 201).id;
  P.linkId = ok(await link(P.benefitId), 201).id;
  S.caseId = await varianceCase(S.benefitId, c.b.users.bo2.id);
  P.caseId = await varianceCase(P.benefitId, c.b.users.bo2.id);
  const enablers = ok(await send("GET", `${c.b.base}/benefits/${S.benefitId}/enablers`, { session: c.b.s.bo }));
  S.enablerId = enablers.items[0].id;
  const ci = await itemFor(
    "corrective_case",
    S.caseId,
    "corrective-actions",
    "corrective_case_follow_up",
    "raid.task.corrective_follow_up",
  );
  N.caseItemId = ci.workItemId;
  N.caseNoteId = ci.notificationId;
  const di = await itemFor(
    "sustainment_review",
    S.decisionId,
    "transition-decisions",
    "benefit_monitoring_due",
    "sustainment.task.benefit_monitoring_due",
  );
  N.decisionItemId = di.workItemId;
  N.decisionNoteId = di.notificationId;
  // The TO marks the benefit sensitive (an access decision, not an approval).
  ok(
    await send("PUT", `${c.b.base}/records/benefit/${S.benefitId}/sensitivity`, {
      session: c.s.to.session,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

const caseList = () => `${c.b.base}/corrective-actions`;
const caseItem = (id: string) => `${c.b.base}/corrective-actions/${id}`;
const links = () => `${c.s.areas}/${S.areaId}/links`;

/** What a reader can list and read of the sensitive benefit's rows. */
async function observe(s: Session) {
  return {
    benefit: (await send("GET", `${c.b.base}/benefits/${S.benefitId}`, { session: s })).status,
    cases: ids(await all(s, caseList())),
    decisions: ids(await all(s, c.transitions)),
    decisionsOfBenefit: ids(await all(s, `${c.transitions}?benefitId=${S.benefitId}`)),
    links: ids(await all(s, links())),
    caseItem: (await send("GET", caseItem(S.caseId), { session: s })).status,
    caseSignals: (await send("GET", `${caseItem(S.caseId)}/signals`, { session: s })).status,
    caseActions: (await send("GET", `${caseItem(S.caseId)}/actions`, { session: s })).status,
    decisionItem: (await send("GET", `${c.transitions}/${S.decisionId}`, { session: s })).status,
  };
}

const sessions = () =>
  [
    ["TL", c.b.s.tl],
    ["AUD", c.b.s.auditor],
    ["BO2", c.b.s.bo2],
  ] as const;

describe("ADR-0051 §2: a sensitive benefit's register rows (F-DG6-220)", () => {
  it("negative: TL, AUD and BO2 get 404 on the benefit; its case, decision and link are absent and 404", async () => {
    for (const [who, s] of sessions()) {
      const o = await observe(s);
      expect(o.benefit, who).toBe(404);
      expect(o.cases, who).not.toContain(S.caseId);
      expect(o.decisions, who).not.toContain(S.decisionId);
      expect(o.decisionsOfBenefit, who).toEqual([]);
      expect(o.links, who).not.toContain(S.linkId);
      // Nothing else is hidden: the plain benefit's rows are still listed.
      expect(o.cases, who).toContain(P.caseId);
      expect(o.decisions, who).toContain(P.decisionId);
      expect(o.links, who).toContain(P.linkId);
      expect(
        { case: o.caseItem, signals: o.caseSignals, actions: o.caseActions, decision: o.decisionItem },
        who,
      ).toEqual({ case: 404, signals: 404, actions: 404, decision: 404 });
      // The plain benefit's item routes still answer.
      expect((await send("GET", caseItem(P.caseId), { session: s })).status, who).toBe(200);
      expect((await send("GET", `${c.transitions}/${P.decisionId}`, { session: s })).status, who).toBe(200);
    }
  });

  it("negative: BO2 (holds every write permission) gets 404 on each write naming a child, and nothing changes", async () => {
    const before = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("action", "<>", "authorization.denied")
      .executeTakeFirstOrThrow();
    const versions = async () => ({
      case: (
        await api.db
          .selectFrom("corrective_case")
          .select("version")
          .where("id", "=", S.caseId)
          .executeTakeFirstOrThrow()
      ).version,
      decision: (
        await api.db
          .selectFrom("transition_decision")
          .select("version")
          .where("id", "=", S.decisionId)
          .executeTakeFirstOrThrow()
      ).version,
      link: await api.db
        .selectFrom("performance_area_link")
        .select(["version", "status"])
        .where("id", "=", S.linkId)
        .executeTakeFirstOrThrow(),
      enabler: await api.db
        .selectFrom("benefit_enabler")
        .select(["version", "status"])
        .where("id", "=", S.enablerId)
        .executeTakeFirstOrThrow(),
    });
    const prior = await versions();
    const s = c.b.s.bo2;
    const writes: [string, string, Body][] = [
      ["PATCH", caseItem(S.caseId), { recoveryPlan: "Synthetic overwrite" }],
      ["POST", `${caseItem(S.caseId)}/close`, { closingNote: "Synthetic close" }],
      ["POST", `${caseItem(S.caseId)}/actions`, { title: "Synthetic action", ownerUserId: c.b.users.bo2.id }],
      ["PATCH", `${c.transitions}/${S.decisionId}`, { rationale: "Synthetic overwrite" }],
      ["POST", `${c.transitions}/${S.decisionId}/submit`, undefined],
      ["POST", `${links()}/${S.linkId}/remove`, undefined],
      ["POST", `${c.b.base}/benefit-enablers/${S.enablerId}/remove`, { reason: "Synthetic removal" }],
    ];
    for (const [method, url, body] of writes) {
      const r = await send(method, url, { session: s, headers: ifm(1), ...(body === undefined ? {} : { body }) });
      expect(r.status, `${method} ${url} ${JSON.stringify(r.body)}`).toBe(404);
    }
    // A create naming the sensitive benefit answers as for an unknown id (existence not disclosed; an admitted
    // proposer would get the 'decision in progress' / 'already linked' rule instead).
    const draft = await send("POST", c.transitions, {
      session: s,
      body: {
        benefitId: S.benefitId,
        residualOwnerUserId: c.b.users.bo2.id,
        rationale: "Synthetic",
        expectedRealizationEnd: "2031-12-31",
        monitoringFrequency: "monthly",
        firstMonitoringDate: "2030-01-15",
      },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(422);
    expect(draft.body.code).toBe("validation.reference");
    const relink = await send("POST", links(), { session: s, body: { linkKind: "benefit", benefitId: S.benefitId } });
    expect(relink.status, JSON.stringify(relink.body)).toBe(422);
    expect(relink.body.code).toBe("validation.reference");
    // The same calls from the owner get the business rule (the benefit exists for an admitted reader).
    const ownerRelink = await send("POST", links(), {
      session: c.b.s.bo,
      body: { linkKind: "benefit", benefitId: S.benefitId },
    });
    expect(ownerRelink.status, JSON.stringify(ownerRelink.body)).toBe(409);
    expect(await versions()).toEqual(prior);
    const after = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("action", "<>", "authorization.denied")
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it("negative: BO2's work items, inbox, My Work and deep links about the case and decision say inbox.restricted", async () => {
    const s = c.b.s.bo2;
    const items = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: s })).items as Body[];
    for (const id of [N.caseItemId, N.decisionItemId]) {
      const it1 = items.find((x) => x.id === id);
      expect(it1, id).toBeDefined();
      expect({ key: it1.messageKey, params: it1.messageParams }).toEqual({ key: "inbox.restricted", params: {} });
      const one = ok(await send("GET", `/api/v1/work-items/${id}`, { session: s }));
      expect({ key: one.messageKey, params: one.messageParams }).toEqual({ key: "inbox.restricted", params: {} });
    }
    const inbox = ok(await send("GET", "/api/v1/me/inbox?limit=100", { session: s })).items as Body[];
    for (const id of [N.caseNoteId, N.decisionNoteId]) {
      const n = inbox.find((x) => x.id === id);
      expect(n, id).toBeDefined();
      expect({ key: n.messageKey, params: n.messageParams }).toEqual({ key: "inbox.restricted", params: {} });
    }
    // My Work items about the case and decision (T-DG6-BE-Z12B: recordId null, so found by their redaction).
    const mine = (await myWork(s)).filter((x) => x.includesRestrictedRecords === true);
    expect(mine.length).toBeGreaterThan(0);
    for (const m of mine)
      expect({ key: m.messageKey, params: m.messageParams, code: m.code }).toEqual({
        key: "inbox.restricted",
        params: {},
        code: null,
      });
    for (const id of [N.caseNoteId, N.decisionNoteId]) {
      const { token } = await issueDeepLink(api.db, id, {
        actorUserId: null,
        actorType: "service",
        requestId: `job:${randomUUID()}`,
      });
      const r = await send("GET", `/api/v1/links/${token}`, { session: s });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.code).toBe("deep_link.forbidden");
      expect(ok(await send("GET", `/api/v1/links/${token}`, { session: c.s.to.session })).linkPath).toContain(
        id === N.caseNoteId ? S.caseId : S.decisionId,
      );
    }
  });

  it("D-222 work item ids: BO2's restricted work items, My Work items and next actions name no record id", async () => {
    // T-DG6-BE-Z12B (F-DG6-480; D-218, D-222; ADR-0051 §2): the assignee too gets no subject or record id, a link to the
    // transformation home and the marker; the type, the item's own id, status and version stay.
    const s = c.b.s.bo2;
    const home = `/transformations/${c.b.transformationId}`;
    const hidden = [S.caseId, S.decisionId, S.benefitId];
    const leaks = (body: unknown) => hidden.filter((id) => JSON.stringify(body).includes(id));
    const list = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: s }));
    for (const id of [N.caseItemId, N.decisionItemId]) {
      const one = ok(await send("GET", `/api/v1/work-items/${id}`, { session: s }));
      const listed = list.items.find((x: Body) => x.id === id);
      for (const item of [listed, one])
        expect({
          subjectId: item.subjectId,
          linkPath: item.linkPath,
          marker: item.includesRestrictedRecords,
          key: item.messageKey,
          periodLabel: item.periodLabel,
        }).toEqual({ subjectId: null, linkPath: home, marker: true, key: "inbox.restricted", periodLabel: null });
      expect(one.subjectType).toBe(id === N.caseItemId ? "corrective_case" : "sustainment_review");
      expect(leaks(one), `work item ${id}`).toEqual([]);
    }
    expect(leaks(list), "work-item list").toEqual([]);
    // My Work: every section, the upcoming deadlines, and every cursor page of each section (limit 1).
    const work = ok(await send("GET", "/api/v1/me/work?limit=100", { session: s }));
    expect(leaks(work), "My Work").toEqual([]);
    const mine = await myWork(s);
    const restricted = mine.filter((x) => x.includesRestrictedRecords === true);
    expect(restricted.length).toBeGreaterThanOrEqual(2);
    for (const m of restricted)
      expect({ recordId: m.recordId, href: m.href, key: m.messageKey, code: m.code }).toEqual({
        recordId: null,
        href: home,
        key: "inbox.restricted",
        code: null,
      });
    for (const section of work.sections.filter((x: Body) => x.total > 0).map((x: Body) => x.section as string)) {
      let cursor: string | null = null;
      for (let i = 0; i < 100; i += 1) {
        const q: string = `section=${section}&limit=1${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
        const page = ok(await send("GET", `/api/v1/me/work?${q}`, { session: s }));
        expect(leaks(page), `My Work ${section} page ${i}`).toEqual([]);
        cursor = page.sections[0].nextCursor;
        if (cursor !== null)
          expect(leaks(Buffer.from(cursor, "base64url").toString("utf8")), `${section} cursor`).toEqual([]);
        if (cursor === null) break;
      }
    }
    // The workspace header's next actions (the same My Work items).
    const header = ok(await send("GET", `${c.b.base}/summary`, { session: s }));
    expect(leaks(header.nextActions), "workspace header next actions").toEqual([]);
    for (const n of header.nextActions.items.filter((x: Body) => x.includesRestrictedRecords === true))
      expect({ recordId: n.recordId, href: n.href }).toEqual({ recordId: null, href: home });
    // The assignee completes a restricted item (the decision follow-up is not system managed); the answer is redacted.
    const cur = ok(await send("GET", `/api/v1/work-items/${N.decisionItemId}`, { session: s }));
    const done = ok(
      await send("POST", `/api/v1/work-items/${N.decisionItemId}/complete`, { session: s, headers: ifm(cur.version) }),
    );
    expect({ status: done.status, subjectId: done.subjectId, marker: done.includesRestrictedRecords }).toEqual({
      status: "done",
      subjectId: null,
      marker: true,
    });
    expect(done.version).toBe(cur.version + 1);
    expect(leaks(done), "completion response").toEqual([]);
    const stored = await api.db
      .selectFrom("work_item")
      .select(["status", "subject_id"])
      .where("id", "=", N.decisionItemId)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ status: "done", subject_id: S.decisionId });
    const audit = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("record_id", "=", N.decisionItemId)
      .where("action", "=", "work_item.complete")
      .execute();
    expect(audit).toHaveLength(1);
    // Positive: the admitted TO is not the assignee (404 as for anyone else's item); BO, a named party, is not either.
    expect((await send("GET", `/api/v1/work-items/${N.caseItemId}`, { session: c.s.to.session })).status).toBe(404);
  });

  it("positive: the TO (sensitive_record.grant) and BO (the owner) list and read every row", async () => {
    for (const [who, s] of [
      ["TO", c.s.to.session],
      ["BO", c.b.s.bo],
    ] as const) {
      const o = await observe(s);
      expect(o, who).toMatchObject({
        benefit: 200,
        caseItem: 200,
        caseSignals: 200,
        caseActions: 200,
        decisionItem: 200,
      });
      expect(o.cases, who).toContain(S.caseId);
      expect(o.decisions, who).toContain(S.decisionId);
      expect(o.decisionsOfBenefit, who).toEqual([S.decisionId]);
      expect(o.links, who).toContain(S.linkId);
    }
    const body = ok(await send("GET", caseItem(S.caseId), { session: c.s.to.session }));
    expect({ benefitId: body.benefitId, title: body.title }).toEqual({ benefitId: S.benefitId, title: CASE_TITLE });
  });

  it("positive: BO2 and TL with an explicit grant see the rows and texts again (next request); AUD still does not", async () => {
    for (const grantee of [c.b.users.bo2.id, c.b.users.tl.id])
      ok(
        await send("POST", "/api/v1/admin/sensitive-grants", {
          session: c.s.to.session,
          body: {
            transformationId: c.b.transformationId,
            recordType: "benefit",
            recordId: S.benefitId,
            granteeUserId: grantee,
            reason: "Synthetic need to know",
          },
        }),
        201,
      );
    for (const [who, s] of [
      ["BO2", c.b.s.bo2],
      ["TL", c.b.s.tl],
    ] as const) {
      const o = await observe(s);
      expect(o, who).toMatchObject({
        benefit: 200,
        caseItem: 200,
        caseSignals: 200,
        caseActions: 200,
        decisionItem: 200,
      });
      expect(o.cases, who).toContain(S.caseId);
      expect(o.decisions, who).toContain(S.decisionId);
      expect(o.links, who).toContain(S.linkId);
    }
    const items = ok(await send("GET", "/api/v1/me/work-items?limit=100", { session: c.b.s.bo2 })).items as Body[];
    expect(items.find((x) => x.id === N.caseItemId).messageKey).toBe("raid.task.corrective_follow_up");
    const inbox = ok(await send("GET", "/api/v1/me/inbox?limit=100", { session: c.b.s.bo2 })).items as Body[];
    expect(inbox.find((x) => x.id === N.decisionNoteId).messageKey).toBe("sustainment.task.benefit_monitoring_due");
    const mine = await myWork(c.b.s.bo2);
    expect(mine.find((x) => x.recordId === S.caseId).messageKey).toBe("raid.task.corrective_follow_up");
    // T-DG6-BE-Z12B: admitted now, the ids and the record link are back.
    const one = ok(await send("GET", `/api/v1/work-items/${N.caseItemId}`, { session: c.b.s.bo2 }));
    expect({ subjectId: one.subjectId, marker: one.includesRestrictedRecords }).toEqual({
      subjectId: S.caseId,
      marker: undefined,
    });
    expect(one.linkPath).toContain(S.caseId);
    expect(mine.find((x) => x.recordId === S.caseId).href).toContain(S.caseId);
    const aud = await observe(c.b.s.auditor);
    expect(aud.cases).not.toContain(S.caseId);
    expect(aud.caseItem).toBe(404);
  });
});
