// code-security-reviewer, DG6 round 8 (T-DG6-REV-CS-R8). NOT part of the candidate: copied into a disposable clone's
// tests/qa/integration by checks.sh repro and removed afterwards. Demo data is SYNTHETIC (illustrative, not Mobily
// actual performance). Marking a record sensitive is an access decision, never a business approval (G1-G6); nothing
// here touches DG0-DG7.
//
// Question (D-225 open question 1): is there a column, response or write path that references a sensitive record and
// that the BE-Z12 inventory does not classify, or classifies wrongly? The inventory's catalog test only enumerates
// fk, uuid, uuid[] and json/jsonb columns, so TEXT columns that hold ids (link paths, polymorphic text ids) are out of
// its scope. This probe:
//   P1 inbox: a work item and its inbox notification for tl2 (a TL scoped to the transformation, no grant, never a
//      named party) about a Finance validation of a benefit that is then marked sensitive, created with the shape of
//      the real producer (apps/worker/src/handlers/benefits.ts:250-258: subject finance_validation, linkPath
//      /transformations/{t}/finance-validations/{id}, messageKey benefits.task.finance_validation_review, messageParams
//      {benefitCode, periodStart, periodEnd}) through the API's createWorkItemOnce service. Then tl2 reads
//      GET /me/work-items (control: BE-Z12B redaction), GET /me/inbox, and POST /me/inbox/{id}/read.
//   P2 text scan: every text/varchar column of every public base table is searched for the hidden benefit's id and
//      the ids of its child rows; each hit is logged as table.column (count) for manual classification.
// Assertions are at the end and are EXPECTED to fail if a leak exists (the log names each one).
import { DEV_ISSUER, insertAuditEvent, migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../../../apps/api/test/support/harness.ts";
import { createWorkItemOnce } from "../../../apps/api/src/modules/tasks/index.ts";
import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const grantor = DEMO_ANCHORS.users.sp;
const t = `/api/v1/transformations/${T}`;
let api: TestApi;
let scratch: string | null = null;
let to: Session;
let tl2: Session;
let tl2Id = "";
const S = { hidden: "", code: "", fv: "", periodStart: "", periodEnd: "", workItemId: "", noteId: "", childIds: [] as string[] };
const log = (...a: unknown[]) => console.log("[CS-R8-INBOX]", ...a);
const get = (path: string, session: Session) => call<Body>(api.app, "GET", path, { session, contract: false });

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r8_inbox");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const mk = async (role: string, s: { type: "organization" | "transformation"; id: string }) => {
    const u = await createUser(api.db, ORG);
    await grant(api.db, grantor, u.id, role, s, ORG);
    return u;
  };
  to = await signIn(api.app, (await mk("TO", { type: "organization", id: ORG })).subject);
  const u2 = await mk("TL", { type: "transformation", id: T });
  tl2Id = u2.id;
  tl2 = await signIn(api.app, u2.subject);
  // A benefit of the demo transformation with a Finance validation row (the producer's subject).
  const fv = await sql<{ fv: string; benefit: string; code: string; ps: string; pe: string }>`
    SELECT f.id::text AS fv, b.id::text AS benefit, b.code, m.period_start::text AS ps, m.period_end::text AS pe
      FROM finance_validation f JOIN benefit b ON b.id = f.benefit_id
      LEFT JOIN benefit_measurement m ON m.id = f.benefit_measurement_id
     WHERE b.transformation_id = ${T}::uuid ORDER BY f.id LIMIT 1`.execute(api.db).catch(async (e: Error) => {
    log(`finance_validation join failed (${e.message.slice(0, 200)}); falling back to benefit_id only`);
    return sql<{ fv: string; benefit: string; code: string; ps: string; pe: string }>`
      SELECT f.id::text AS fv, b.id::text AS benefit, b.code, '2026-01-01' AS ps, '2026-03-31' AS pe
        FROM finance_validation f JOIN benefit b ON b.id = f.benefit_id
       WHERE b.transformation_id = ${T}::uuid ORDER BY f.id LIMIT 1`.execute(api.db);
  });
  const row = fv.rows[0];
  expect(row, "the demo has a Finance validation").toBeDefined();
  S.hidden = row!.benefit;
  S.code = row!.code;
  S.fv = row!.fv;
  S.periodStart = row!.ps ?? "2026-01-01";
  S.periodEnd = row!.pe ?? "2026-03-31";
  log(`hidden benefit ${S.code} ${S.hidden}; finance validation ${S.fv}`);
  // The producer's work item and notification (benefits.ts:250-258 shape), for tl2.
  const actor = { actorType: "service" as const, actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" as const };
  const out = await api.db.transaction().execute((tx) =>
    createWorkItemOnce(tx, actor, {
      organizationId: ORG,
      transformationId: T,
      kind: "finance_validation_review",
      assigneeUserId: tl2Id,
      subjectType: "finance_validation",
      subjectId: S.fv,
      linkPath: `/transformations/${T}/finance-validations/${S.fv}`,
      messageKey: "benefits.task.finance_validation_review",
      messageParams: { benefitCode: S.code, periodStart: S.periodStart, periodEnd: S.periodEnd },
      dedupeKey: `finance_validation:${S.fv}:${tl2Id}`,
    } as Body),
  );
  S.workItemId = out.workItemId;
  // Release a held notification as the delivery job would (audited), exactly as the in-tree registers test does.
  await api.db.transaction().execute(async (tx) => {
    const n = await tx.selectFrom("inbox_notification").select(["id", "version", "delivery_state"]).where("work_item_id", "=", out.workItemId).executeTakeFirstOrThrow();
    S.noteId = n.id;
    if (n.delivery_state === "delivered") return;
    await tx.updateTable("inbox_notification").set({ delivery_state: "delivered", version: sql<number>`version + 1` }).where("id", "=", n.id).execute();
    await insertAuditEvent(tx, actor, { action: "inbox_notification.delivered", recordType: "inbox_notification", recordId: n.id, organizationId: ORG, transformationId: T, priorVersion: n.version, newVersion: n.version + 1 });
  });
  // The TO marks the benefit sensitive (after the notification was issued, as in production).
  const m = await call<Body>(api.app, "PUT", `${t}/records/benefit/${S.hidden}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R8-INBOX)" },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  for (const table of ["benefit_measurement", "benefit_plan_value", "finance_validation", "corrective_case", "transition_decision", "benefit_lifecycle_event", "benefit_enabler", "benefit_allocation"]) {
    const ids = await sql<{ id: string }>`SELECT id::text AS id FROM ${sql.table(table)} WHERE benefit_id = ${S.hidden}::uuid`.execute(api.db).catch(() => ({ rows: [] as { id: string }[] }));
    S.childIds.push(...ids.rows.map((r) => r.id));
  }
  log(`child ids of the hidden benefit: ${S.childIds.length}`);
}, 900_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const ids = () => [S.hidden, ...S.childIds];
const named = (body: unknown) => {
  const text = JSON.stringify(body);
  return ids().filter((x) => text.includes(x));
};

describe("CS-R8 P1: inbox notification about a restricted record", () => {
  it("tl2 gets 404 on the benefit and the Finance validation (control)", async () => {
    const b = await get(`${t}/benefits/${S.hidden}`, tl2);
    const f = await get(`${t}/finance-validations/${S.fv}`, tl2);
    const fTo = await get(`${t}/finance-validations/${S.fv}`, to);
    log(`tl2 GET benefit ${b.status}; tl2 GET finance validation ${f.status} ${f.body?.code ?? ""}; TO GET finance validation ${fTo.status}`);
    expect(b.status).toBe(404);
    expect([403, 404]).toContain(f.status);
  });

  it("work item (BE-Z12B control), inbox list and mark-read never name a hidden id or the restricted record's code", async () => {
    const leaks: string[] = [];
    const items = await get(`/api/v1/me/work-items?limit=100`, tl2);
    const wi = (items.body.items ?? []).find((x: Body) => x.id === S.workItemId);
    log(`GET /me/work-items ${items.status}: subjectType=${wi?.subjectType} subjectId=${wi?.subjectId} linkPath=${wi?.linkPath} key=${wi?.messageKey} params=${JSON.stringify(wi?.messageParams)} marker=${wi?.includesRestrictedRecords}`);
    if (named(items.body).length > 0) leaks.push(`listMyWorkItems names ${named(items.body).join(",")}`);
    const inbox = await get(`/api/v1/me/inbox?limit=100`, tl2);
    const n = (inbox.body.items ?? []).find((x: Body) => x.id === S.noteId);
    log(`GET /me/inbox ${inbox.status}: key=${n?.messageKey} params=${JSON.stringify(n?.messageParams)} linkPath=${n?.linkPath} keys=${Object.keys(n ?? {}).join(",")}`);
    if (named(inbox.body).length > 0) leaks.push(`listMyInbox names ${named(inbox.body).join(",")} (linkPath ${n?.linkPath})`);
    const work = await get(`/api/v1/me/work?limit=100`, tl2);
    if (named(work.body).length > 0) leaks.push(`getMyWork names ${named(work.body).join(",")}`);
    log(`GET /me/work ${work.status}: names=${JSON.stringify(named(work.body))}`);
    const read = await call<Body>(api.app, "POST", `/api/v1/me/inbox/${S.noteId}/read`, {
      session: tl2,
      headers: { "if-match": `"${n?.version}"` },
      contract: false,
    });
    log(`POST /me/inbox/{id}/read ${read.status}: key=${read.body?.messageKey} params=${JSON.stringify(read.body?.messageParams)} linkPath=${read.body?.linkPath}`);
    if (named(read.body).length > 0) leaks.push(`markInboxNotificationRead names ${named(read.body).join(",")}`);
    if (JSON.stringify(read.body?.messageParams ?? {}).includes(S.code)) leaks.push(`markInboxNotificationRead returns messageParams with the restricted benefit's code ${S.code}`);
    const after = await get(`/api/v1/me/inbox?limit=100`, tl2);
    const n2 = (after.body.items ?? []).find((x: Body) => x.id === S.noteId);
    log(`GET /me/inbox after read: key=${n2?.messageKey} params=${JSON.stringify(n2?.messageParams)} linkPath=${n2?.linkPath}`);
    // Positive control: the admitted TO is not the recipient; nothing to compare. The code is in the benefit (TO 200).
    const toB = await get(`${t}/benefits/${S.hidden}`, to);
    log(`TO GET benefit ${toB.status} code=${toB.body?.code}`);
    log(`P1 leaks (${leaks.length}):\n${leaks.join("\n")}`);
    expect(wi?.subjectId ?? null).toBeNull();
    expect(leaks).toEqual([]);
  });
});

describe("CS-R8 P1b: benefit-overlap notification through the real producer (API POST /benefit-overlaps)", () => {
  it("a Finance recipient not admitted to the sensitive benefit gets neither its code nor the overlap id", async () => {
    const tl = await signIn(api.app, (await (async () => {
      const u = await createUser(api.db, ORG);
      await grant(api.db, grantor, u.id, "TL", { type: "transformation", id: T }, ORG);
      return u;
    })()).subject);
    const mkBenefit = async (title: string) => {
      const r = await call<Body>(api.app, "POST", `${t}/benefits`, {
        session: tl,
        body: { title, description: "Synthetic.", benefitType: "cost", valueClass: "avoided_cost", ownerUserId: grantor, currency: "SAR", financialStatementLine: "Opex" },
        contract: false,
      });
      log(`P1b TL POST benefit ${title} -> ${r.status} ${r.status === 201 ? r.body.code : JSON.stringify(r.body).slice(0, 300)}`);
      expect(r.status).toBe(201);
      return r.body as Body;
    };
    const h = await mkBenefit("Synthetic CONFIDENTIAL CS-R8 overlap benefit");
    const x = await mkBenefit("Synthetic open CS-R8 overlap benefit");
    const ov = await call<Body>(api.app, "POST", `${t}/benefit-overlaps`, {
      session: tl,
      body: { benefitAId: h.id, benefitBId: x.id, dimensions: ["driver"] },
      contract: false,
    });
    log(`P1b TL POST benefit-overlaps -> ${ov.status} ${ov.status === 201 ? ov.body.id : JSON.stringify(ov.body).slice(0, 300)}`);
    expect(ov.status).toBe(201);
    const items = await sql<{ wi: string; assignee: string; note: string | null; state: string | null }>`
      SELECT w.id::text AS wi, w.assignee_user_id::text AS assignee, n.id::text AS note, n.delivery_state AS state
        FROM work_item w LEFT JOIN inbox_notification n ON n.work_item_id = w.id
       WHERE w.subject_type = 'benefit_overlap' AND w.subject_id = ${ov.body.id}`.execute(api.db);
    log(`P1b overlap work items: ${JSON.stringify(items.rows)}`);
    expect(items.rows.length, "the producer created at least one Finance task").toBeGreaterThan(0);
    const mk = await call<Body>(api.app, "PUT", `${t}/records/benefit/${h.id}/sensitivity`, {
      session: to,
      headers: { "if-match": '"0"' },
      body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R8-INBOX P1b)" },
    });
    expect(mk.status, JSON.stringify(mk.body)).toBe(200);
    const leaks: string[] = [];
    for (const row of items.rows) {
      const subject = `cs-r8-${row.assignee.slice(-6)}-${Math.random().toString(16).slice(2, 8)}`;
      await api.db.insertInto("user_identity").values({ id: randomUUID(), user_id: row.assignee, issuer: DEV_ISSUER, subject } as Body).execute().catch(async () => {
        const iss = await sql<{ issuer: string }>`SELECT issuer FROM user_identity LIMIT 1`.execute(api.db);
        await api.db.insertInto("user_identity").values({ id: randomUUID(), user_id: row.assignee, issuer: iss.rows[0]!.issuer, subject } as Body).execute();
      });
      const s = await signIn(api.app, subject);
      const hb = await get(`${t}/benefits/${h.id}`, s);
      const ob = await get(`${t}/benefit-overlaps/${ov.body.id}`, s);
      if (row.state !== null && row.state !== "delivered") {
        await api.db.transaction().execute(async (tx) => {
          const n = await tx.selectFrom("inbox_notification").select(["id", "version"]).where("id", "=", row.note!).executeTakeFirstOrThrow();
          await tx.updateTable("inbox_notification").set({ delivery_state: "delivered", version: sql<number>`version + 1` }).where("id", "=", n.id).execute();
          await insertAuditEvent(tx, { actorType: "service", actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" }, { action: "inbox_notification.delivered", recordType: "inbox_notification", recordId: n.id, organizationId: ORG, transformationId: T, priorVersion: n.version, newVersion: n.version + 1 });
        });
      }
      const wis = await get(`/api/v1/me/work-items?limit=100`, s);
      const wi = (wis.body.items ?? []).find((y: Body) => y.id === row.wi);
      const inbox = await get(`/api/v1/me/inbox?limit=100`, s);
      const n = (inbox.body.items ?? []).find((y: Body) => y.id === row.note);
      log(`P1b recipient ${row.assignee}: GET sensitive benefit ${hb.status}; GET overlap ${ob.status}; work item subjectId=${wi?.subjectId} key=${wi?.messageKey} marker=${wi?.includesRestrictedRecords}; inbox key=${n?.messageKey} params=${JSON.stringify(n?.messageParams)} linkPath=${n?.linkPath}`);
      if (hb.status === 404) {
        const text = JSON.stringify(n ?? {});
        if (text.includes(ov.body.id)) leaks.push(`recipient ${row.assignee} (404 on the benefit): listMyInbox linkPath names the overlap id ${ov.body.id}`);
        if (text.includes(h.code)) leaks.push(`recipient ${row.assignee} (404 on the benefit): listMyInbox messageParams carry the sensitive benefit's code ${h.code}`);
      }
    }
    log(`P1b leaks (${leaks.length}):\n${leaks.join("\n")}`);
    expect(leaks).toEqual([]);
  });
});

describe("CS-R8 P1c: mark-read of a notification the inbox list DOES redact (corrective case, raid.ts:416-429 shape)", () => {
  it("POST /me/inbox/{id}/read returns the same redaction as GET /me/inbox", async () => {
    const cc = await sql<{ id: string; code: string; benefit: string }>`SELECT id::text AS id, code, benefit_id::text AS benefit
      FROM corrective_case WHERE transformation_id = ${T}::uuid ORDER BY (benefit_id = ${S.hidden}::uuid) DESC, id LIMIT 1`.execute(api.db);
    // The demo has no corrective case (attempt 3): fall back to a notification whose link is the hidden benefit's own
    // web route (deep-links.ts ROUTES, which listMyInbox does redact), subject benefit, params {benefitCode}.
    const fallback = cc.rows[0] === undefined;
    if (fallback) log("P1c: the demo has no corrective case; using a benefit-route notification (ROUTES) instead");
    const c = cc.rows[0] ?? { id: S.hidden, code: S.code, benefit: S.hidden };
    if (c.benefit !== S.hidden) {
      const mk = await call<Body>(api.app, "PUT", `${t}/records/benefit/${c.benefit}/sensitivity`, {
        session: to,
        headers: { "if-match": '"0"' },
        body: { isSensitive: true, reason: "Synthetic sensitive benefit (CS-R8-INBOX P1c)" },
      });
      log(`P1c TO marks the case's benefit ${c.benefit} -> ${mk.status}`);
    }
    const actor = { actorType: "service" as const, actorUserId: null, requestId: `job:${randomUUID()}`, source: "worker" as const };
    const out = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(tx, actor, {
        organizationId: ORG,
        transformationId: T,
        kind: "corrective_case_follow_up",
        assigneeUserId: tl2Id,
        subjectType: fallback ? "benefit" : "corrective_case",
        subjectId: c.id,
        linkPath: fallback ? `/transformations/${T}/benefits/${c.id}` : `/transformations/${T}/corrective-actions/${c.id}`,
        messageKey: fallback ? "benefits.task.synthetic_cs_r8" : "raid.task.corrective_follow_up",
        messageParams: fallback ? { benefitCode: c.code } : { caseCode: c.code },
        dueDate: "2031-01-15",
        dedupeKey: `cs-r8.p1c:${c.id}:${tl2Id}`,
      } as Body),
    );
    const note = await api.db.selectFrom("inbox_notification").select(["id", "version", "delivery_state"]).where("work_item_id", "=", out.workItemId).executeTakeFirstOrThrow();
    if (note.delivery_state !== "delivered")
      await api.db.transaction().execute(async (tx) => {
        await tx.updateTable("inbox_notification").set({ delivery_state: "delivered", version: sql<number>`version + 1` }).where("id", "=", note.id).execute();
        await insertAuditEvent(tx, actor, { action: "inbox_notification.delivered", recordType: "inbox_notification", recordId: note.id, organizationId: ORG, transformationId: T, priorVersion: note.version, newVersion: note.version + 1 });
      });
    const caseGet = await get(fallback ? `${t}/benefits/${c.id}` : `${t}/corrective-actions/${c.id}`, tl2);
    const inbox = await get(`/api/v1/me/inbox?limit=100`, tl2);
    const n = (inbox.body.items ?? []).find((y: Body) => y.id === note.id);
    log(`P1c tl2 GET case ${caseGet.status}; GET /me/inbox key=${n?.messageKey} params=${JSON.stringify(n?.messageParams)} linkPath=${n?.linkPath}`);
    const read = await call<Body>(api.app, "POST", `/api/v1/me/inbox/${note.id}/read`, { session: tl2, headers: { "if-match": `"${n?.version}"` }, contract: false });
    log(`P1c POST /me/inbox/{id}/read ${read.status}: key=${read.body?.messageKey} params=${JSON.stringify(read.body?.messageParams)} linkPath=${read.body?.linkPath}`);
    expect(n?.messageKey).toBe("inbox.restricted");
    expect({ key: read.body?.messageKey, params: read.body?.messageParams }).toEqual({ key: "inbox.restricted", params: {} });
  });
});

describe("CS-R8 P2: text columns that hold a hidden id (outside the inventory's fk/uuid/array/json catalog)", () => {
  it("lists every text/varchar column holding the hidden benefit's id or a child id", async () => {
    const cols = await sql<{ t: string; c: string }>`
      SELECT c.table_name AS t, c.column_name AS c FROM information_schema.columns c
        JOIN information_schema.tables x ON x.table_schema = 'public' AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'character')
       ORDER BY 1, 2`.execute(api.db);
    const want = ids();
    const hits: string[] = [];
    for (const { t: table, c } of cols.rows) {
      const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(table)} WHERE ${sql.ref(c)} IS NOT NULL
        AND ${sql.ref(c)} ~* ${want.join("|")}`.execute(api.db);
      if (Number(r.rows[0]!.n) > 0) hits.push(`${table}.${c} (${r.rows[0]!.n})`);
    }
    log(`text/varchar columns scanned: ${cols.rows.length}; columns holding a hidden id (${hits.length}):\n${hits.join("\n")}`);
    expect(cols.rows.length).toBeGreaterThan(100);
  });
});
