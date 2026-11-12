// T-E10…T-E12 (ADR-0067 §1, §2, §7; p7-work-split §E.1, §E.4, §E.5; REQ-S16-024; T-DG7-BE-G): the retention-class
// routes on a scratch database of this run's disposable PostgreSQL cluster (a class is installation-wide):
//   T-E10  the list shows every class and every public base table exactly once; a class with no period shows
//          `periodDays: null` (never 0);
//   T-E11  updateRetentionClass: each 422 code of E.5 (retain-only, not-archivable, period, reference, run in progress);
//          409 on a stale If-Match; 428 without one; 400 on a malformed body; 404; audit retention_class.updated with
//          before/after of action, period and reference, and the reason;
//   T-E12  403 for every role without retention.configure (AUD and ADM_ACCESS included), nothing written; reads for
//          ADM_TECH, ADM_ACCESS and AUD only.
// Every IT reference text begins with TEST-ONLY: no agent or test writes a real IT reference. Saving a reference approves
// nothing (no G1-G6, Finance or IT approval) and nothing here touches DG0-DG7.
import { createDb, createPool, migrate, sql, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { RETENTION_TEXTS } from "../../../src/modules/retention/classes/service.ts";
import {
  call,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const BASE = "/api/v1/admin/retention/classes";
const REF = "TEST-ONLY synthetic change ticket CHG-0000";
const READERS = new Set(["ADM_TECH", "ADM_ACCESS", "AUD"]);

let api: TestApi;
let scratch: string;
let owner: Db;
let tech: Session;
const sessions: { role: string; session: Session }[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_retention_classes_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 3 }));
  api = await startApi({ database: scratch });
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  for (const { code } of await api.db.selectFrom("role").select("code").orderBy("code").execute()) {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, code, { type: "organization", id: org.id }, org.id);
    const session = await signIn(api.app, u.subject);
    sessions.push({ role: code, session });
    if (code === "ADM_TECH") tech = session;
  }
  const nobody = await createUser(api.db, org.id);
  sessions.push({ role: "(no grant)", session: await signIn(api.app, nobody.subject) });
}, 240_000);

afterAll(async () => {
  await api?.close();
  await owner?.destroy();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const put = (code: string, body: object, version: number | null, session = tech) =>
  call<Body>(api.app, "PUT", `${BASE}/${code}`, {
    session,
    body,
    ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }),
  });

const updates = async () =>
  (await owner.selectFrom("audit_event").select(["action"]).where("action", "=", "retention_class.updated").execute())
    .length;

describe("T-E10: the class list covers every class and every table exactly once", () => {
  it("lists the 12 classes by code, every public base table once, and null (never 0) for an unset period", async () => {
    const res = await call<Body>(api.app, "GET", `${BASE}?limit=100`, { session: tech });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const classes = res.body.items as Body[];
    expect(classes).toHaveLength(12);
    expect(classes.map((c) => c.code)).toEqual([...classes.map((c) => c.code)].sort());
    for (const c of classes) {
      expect(c.periodDays).toBeNull();
      expect(c.action).toBe("retain");
      expect(c.itApprovalReference).toBeNull();
    }
    const listed = classes.flatMap((c) => (c.tables as Body[]).map((t) => t.tableName as string));
    expect(new Set(listed).size).toBe(listed.length);
    const catalogue = await sql<{ name: string }>`SELECT c.relname::text AS name FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind IN ('r', 'p')`.execute(
      owner,
    );
    expect([...listed].sort()).toEqual(catalogue.rows.map((r) => r.name).sort());
    const processed = classes.find((c) => c.code === "processed_message_log");
    expect(processed.tables).toEqual([
      { tableName: "processed_message", ageColumn: "processed_at", purgeEligible: true },
    ]);
  });

  it("pages by code with a cursor, and getRetentionClass returns one class with its ETag", async () => {
    const first = await call<Body>(api.app, "GET", `${BASE}?limit=5`, { session: tech });
    expect(first.body.items).toHaveLength(5);
    const next = await call<Body>(api.app, "GET", `${BASE}?limit=100&cursor=${first.body.nextCursor}`, {
      session: tech,
    });
    expect(next.body.items).toHaveLength(7);
    const one = await call<Body>(api.app, "GET", `${BASE}/job_history`, { session: tech });
    expect(one.status).toBe(200);
    expect(one.headers["etag"]).toBe('"1"');
    expect(one.body).toMatchObject({ code: "job_history", category: "operational", periodDays: null, version: 1 });
    expect((await call<Body>(api.app, "GET", `${BASE}/no_such_class`, { session: tech })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${BASE}/X`, { session: tech })).status).toBe(400);
  });
});

describe("T-E11: updateRetentionClass", () => {
  const enable = { action: "archive", periodDays: 30, itApprovalReference: REF, reason: "Synthetic retention test" };

  it("428 without If-Match, 400 on a malformed body, 404 for an unknown class; nothing written", async () => {
    expect((await put("processed_message_log", enable, null)).status).toBe(428);
    for (const body of [
      { ...enable, periodDays: 0 },
      { ...enable, action: "delete" },
      { ...enable, itApprovalReference: "   " },
      { ...enable, reason: "x" },
      { ...enable, extra: true },
    ])
      expect((await put("processed_message_log", body, 1)).status, JSON.stringify(body)).toBe(400);
    expect((await put("no_such_class", enable, 1)).status).toBe(404);
    expect(await updates()).toBe(0);
  });

  it("each E.5 422 code, with its exact text", async () => {
    const cases: [string, object, string, string][] = [
      ["business_record", enable, "retention.class_retain_only", RETENTION_TEXTS.classRetainOnly],
      ["audit_trail", enable, "retention.class_retain_only", RETENTION_TEXTS.classRetainOnly],
      ["report_snapshot", enable, "retention.class_retain_only", RETENTION_TEXTS.classRetainOnly],
      ["expiring_credential", enable, "retention.class_retain_only", RETENTION_TEXTS.classRetainOnly],
      [
        "job_history",
        { ...enable, action: "archive_then_purge" },
        "retention.class_not_archivable",
        RETENTION_TEXTS.classNotArchivable,
      ],
      [
        "processed_message_log",
        { ...enable, periodDays: null },
        "retention.class_period_required",
        RETENTION_TEXTS.classPeriodRequired,
      ],
      [
        "processed_message_log",
        { ...enable, itApprovalReference: null },
        "retention.class_reference_required",
        RETENTION_TEXTS.classReferenceRequired,
      ],
    ];
    for (const [code, body, problem, detail] of cases) {
      const res = await put(code, body, 1);
      expect(res.status, `${code} ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body).toMatchObject({ code: problem, detail });
    }
    expect(await updates()).toBe(0);
  });

  it("422 retention.run_in_progress while a run is queued", async () => {
    const userId = (await owner.selectFrom("app_user").select("id").limit(1).executeTakeFirstOrThrow()).id;
    const c = await owner.transaction().execute(async (tx) => {
      const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
      await sql`INSERT INTO retention_run (id, mode, requested_via, as_of, created_by) VALUES (${id}, 'dry_run', 'api', now(), ${userId})`.execute(
        tx,
      );
      await sql`INSERT INTO audit_event (id, actor_type, action, record_type, record_id, new_version, source)
                VALUES (mth_uuid_v7(), 'system', 'retention_run.requested', 'retention_run', ${id}, 1, 'cli')`.execute(
        tx,
      );
      return id;
    });
    const res = await put("processed_message_log", enable, 1);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "retention.run_in_progress", detail: RETENTION_TEXTS.runInProgress });
    await owner.transaction().execute(async (tx) => {
      await sql`UPDATE retention_run SET status = 'failed', failure_reason = 'synthetic', finished_at = now(), version = 2 WHERE id = ${c}`.execute(
        tx,
      );
      await sql`INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
                VALUES (mth_uuid_v7(), 'system', 'retention_run.failed', 'retention_run', ${c}, 1, 2, 'cli')`.execute(
        tx,
      );
    });
    expect(await updates()).toBe(0);
  });

  it("200 with the new version and ETag; audit with before/after and the reason; then 409 on the stale If-Match", async () => {
    const res = await put("processed_message_log", enable, 1);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect(res.body).toMatchObject({ action: "archive", periodDays: 30, itApprovalReference: REF, version: 2 });
    const audit = await owner
      .selectFrom("audit_event")
      .selectAll()
      .where("action", "=", "retention_class.updated")
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ record_type: "retention_class", prior_version: 1, new_version: 2 });
    expect(audit.reason).toBe("Synthetic retention test");
    expect(audit.changes).toEqual({
      action: { from: "retain", to: "archive" },
      period_days: { from: null, to: 30 },
      it_approval_reference: { from: null, to: REF },
    });
    const stale = await put("processed_message_log", { ...enable, periodDays: 60 }, 1);
    expect(stale.status).toBe(409);
    // back to retain (period and reference may stay as text)
    const back = await put("processed_message_log", { ...enable, action: "retain" }, 2);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ action: "retain", version: 3 });
    expect(await updates()).toBe(2);
  });
});

describe("T-E12: authorization", () => {
  it("403 on updateRetentionClass for every role but ADM_TECH (AUD and ADM_ACCESS included); nothing written", async () => {
    expect(sessions.map((s) => s.role)).toEqual(expect.arrayContaining(["AUD", "ADM_ACCESS", "ADM_TECH"]));
    const before = await updates();
    for (const { role, session } of sessions) {
      if (role === "ADM_TECH") continue;
      const res = await put(
        "processed_message_log",
        { action: "retain", periodDays: null, itApprovalReference: null, reason: "Synthetic forbidden change" },
        3,
        session,
      );
      expect(res.status, role).toBe(403);
    }
    expect(await updates()).toBe(before);
  });

  it("reads for ADM_TECH, ADM_ACCESS and AUD only; 403 for every other role and a user without grants", async () => {
    for (const { role, session } of sessions) {
      const expected = READERS.has(role) ? 200 : 403;
      expect((await call<Body>(api.app, "GET", BASE, { session })).status, `${role} list`).toBe(expected);
      expect((await call<Body>(api.app, "GET", `${BASE}/job_history`, { session })).status, `${role} get`).toBe(
        expected,
      );
    }
  });
});
