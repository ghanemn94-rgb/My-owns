// T-E13 and the run routes (ADR-0067 §4-§6; p7-work-split §E.1, §E.4; REQ-S16-024; T-DG7-BE-G), on a scratch database
// of this run's disposable PostgreSQL cluster ("one run at a time" is installation-wide):
//   - createRetentionRun / createRetentionDryRun: 202 queued with Location and ETag, as_of = the database clock, audit
//     retention_run.requested with the reason, the outbox event retention_run.requested whose idempotency key (the
//     relay's singleton key) is the run id;
//   - T-E13: 422 retention.run_in_progress while a run is queued or running; the same Idempotency-Key replays 200 with
//     the same run;
//   - 403 for every role without retention.run (AUD and ADM_ACCESS included); reads for ADM_TECH, ADM_ACCESS and AUD;
//   - the job then runs it (worker handler), and the action log and archived markers are listed by the read routes,
//     with primary key values only.
// Every value is SYNTHETIC; every IT reference text begins with TEST-ONLY. A run approves nothing (no G1-G6, Finance or
// IT approval) and touches no DG0-DG7 record.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, createPool, migrate, sql, type Db } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { retentionStoreDeps, runRetention } from "../../../../worker/src/handlers/retention/archive.ts";
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

const RUNS = "/api/v1/admin/retention/runs";
const DRY = "/api/v1/admin/retention/dry-runs";
const ARCHIVED = "/api/v1/admin/retention/archived";
const MISSING = "01900000-0000-7000-8000-00000000beef";
const READERS = new Set(["ADM_TECH", "ADM_ACCESS", "AUD"]);
const REF = "TEST-ONLY synthetic change ticket";

let api: TestApi;
let scratch: string;
let owner: Db;
let root: string;
let tech: Session;
const sessions: { role: string; session: Session }[] = [];
let first: string;

const runRows = async () => owner.selectFrom("retention_run").select(["id", "status"]).execute();

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_retention_runs_api");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  owner = createDb(createPool(roleUrl(adminUrl, scratch, "mth_owner"), { max: 3 }));
  api = await startApi({ database: scratch });
  root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "mth-retention-api-"));
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
  if (root) rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("the run request (createRetentionRun, createRetentionDryRun)", () => {
  it("validates the request: 400 without a reason, with a short one, or with an unknown field; nothing written", async () => {
    for (const url of [RUNS, DRY])
      for (const body of [{}, { reason: "x" }, { reason: "Synthetic retention run", extra: true }]) {
        const res = await call<Body>(api.app, "POST", url, { session: tech, body });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      }
    expect(await runRows()).toEqual([]);
  });

  it("202 queued, Location, ETag, as_of = now(), audit retention_run.requested, outbox event keyed by the run id", async () => {
    const key = { "idempotency-key": "synthetic-retention-key-1" };
    const res = await call<Body>(api.app, "POST", DRY, {
      session: tech,
      body: { reason: "Synthetic dry run" },
      headers: key,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ mode: "dry_run", status: "queued", requestedVia: "api", version: 1 });
    expect(res.body.candidateCount).toBeNull();
    expect(res.headers["location"]).toBe(`${RUNS}/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    first = res.body.id;
    expect(Math.abs(Date.parse(res.body.asOf) - Date.now())).toBeLessThan(60_000);
    const audit = await owner
      .selectFrom("audit_event")
      .select(["action", "reason", "actor_user_id"])
      .where("record_id", "=", first)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "retention_run.requested", reason: "Synthetic dry run" });
    expect(audit[0]!.actor_user_id).not.toBeNull();
    const event = await owner
      .selectFrom("outbox_event")
      .selectAll()
      .where("aggregate_id", "=", first)
      .executeTakeFirstOrThrow();
    expect(event).toMatchObject({ event_type: "retention_run.requested", idempotency_key: first });
    const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    expect(payload).toEqual({ retentionRunId: first });

    // T-E13: the same Idempotency-Key replays 200 with the same run; nothing new is written.
    const replay = await call<Body>(api.app, "POST", DRY, {
      session: tech,
      body: { reason: "Synthetic dry run" },
      headers: key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first);
    expect(await runRows()).toHaveLength(1);
  });

  it("T-E13: 422 retention.run_in_progress while a run is queued, for a run and a dry run", async () => {
    for (const url of [RUNS, DRY]) {
      const res = await call<Body>(api.app, "POST", url, { session: tech, body: { reason: "Second synthetic run" } });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "retention.run_in_progress", detail: RETENTION_TEXTS.runInProgress });
    }
    expect(await runRows()).toHaveLength(1);
  });

  it("403 on both requests for every role but ADM_TECH (AUD and ADM_ACCESS included); reads for ADM_TECH, ADM_ACCESS, AUD", async () => {
    for (const { role, session } of sessions) {
      if (role !== "ADM_TECH")
        for (const url of [RUNS, DRY]) {
          const res = await call<Body>(api.app, "POST", url, { session, body: { reason: "Synthetic forbidden run" } });
          expect(res.status, `${role} ${url}`).toBe(403);
        }
      const expected = READERS.has(role) ? 200 : 403;
      for (const url of [RUNS, `${RUNS}/${first}`, `${RUNS}/${first}/actions`, ARCHIVED])
        expect((await call<Body>(api.app, "GET", url, { session })).status, `${role} GET ${url}`).toBe(expected);
    }
    expect(await runRows()).toHaveLength(1);
  });

  it("T-E13: 422 while the run is running; then the job finishes it and a new request is accepted", async () => {
    // The job claims the dry run (queued -> running) and finishes it; with every class `retain` it selects nothing.
    const out = await runRetention(
      api.db,
      first,
      "job-api-1",
      retentionStoreDeps(() => root),
    );
    expect(out).toMatchObject({ outcome: "succeeded", candidates: 0 });
    const got = await call<Body>(api.app, "GET", `${RUNS}/${first}`, { session: tech });
    expect(got.status).toBe(200);
    expect(got.headers["etag"]).toBe('"3"');
    expect(got.body).toMatchObject({ status: "succeeded", candidateCount: 0, archivedCount: 0, archiveSetKey: null });
    // A run held `running` blocks the request too (set by the owner as the job would, with its audit event).
    const res = await call<Body>(api.app, "POST", RUNS, { session: tech, body: { reason: "Synthetic real run" } });
    expect(res.status).toBe(202);
    await owner.transaction().execute(async (tx) => {
      await sql`UPDATE retention_run SET status = 'running', started_at = now(), version = 2 WHERE id = ${res.body.id}`.execute(
        tx,
      );
      await sql`INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
                VALUES (mth_uuid_v7(), 'system', 'retention_run.started', 'retention_run', ${res.body.id}, 1, 2, 'worker')`.execute(
        tx,
      );
    });
    const blocked = await call<Body>(api.app, "POST", DRY, {
      session: tech,
      body: { reason: "Synthetic blocked run" },
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("retention.run_in_progress");
    await owner.transaction().execute(async (tx) => {
      await sql`UPDATE retention_run SET status = 'failed', failure_reason = 'synthetic', finished_at = now(), version = 3 WHERE id = ${res.body.id}`.execute(
        tx,
      );
      await sql`INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source)
                VALUES (mth_uuid_v7(), 'system', 'retention_run.failed', 'retention_run', ${res.body.id}, 2, 3, 'worker')`.execute(
        tx,
      );
    });
  });
});

describe("the read routes (listRetentionRuns, getRetentionRun, listRetentionRunActions, listRetentionArchivedRecords)", () => {
  it("a real run's actions and markers: primary key values only, newest first, filters", async () => {
    await owner.transaction().execute(async (tx) => {
      await sql`INSERT INTO processed_message (consumer, idempotency_key, processed_at, outcome)
                VALUES ('test.retention.api', 'old', now() - interval '40 days', 'done'),
                       ('test.retention.api', 'young', now() - interval '5 days', 'done')`.execute(tx);
    });
    const cls = await call<Body>(api.app, "PUT", "/api/v1/admin/retention/classes/processed_message_log", {
      session: tech,
      headers: { "if-match": '"1"' },
      body: { action: "archive", periodDays: 30, itApprovalReference: REF, reason: "Synthetic retention test" },
    });
    expect(cls.status, JSON.stringify(cls.body)).toBe(200);
    const res = await call<Body>(api.app, "POST", RUNS, { session: tech, body: { reason: "Synthetic real run" } });
    expect(res.status).toBe(202);
    const id = res.body.id as string;
    expect(
      await runRetention(
        api.db,
        id,
        "job-api-2",
        retentionStoreDeps(() => root),
      ),
    ).toMatchObject({
      outcome: "succeeded",
      archived: 1,
    });
    const list = await call<Body>(api.app, "GET", `${RUNS}?limit=2`, { session: tech });
    expect(list.status).toBe(200);
    expect(list.body.items[0].id).toBe(id); // newest first
    expect(list.body.items[0]).toMatchObject({ status: "succeeded", archivedCount: 1 });
    expect(list.body.items[0].archiveSetKey).toBe(`retention/${id}/manifest.json`);
    expect(list.body.items[0].archiveSetBytes).toMatch(/^[1-9][0-9]*$/);
    const acts = await call<Body>(api.app, "GET", `${RUNS}/${id}/actions`, { session: tech });
    expect(acts.status).toBe(200);
    expect(acts.body.items).toHaveLength(1);
    expect(acts.body.items[0]).toMatchObject({
      retentionRunId: id,
      retentionClassCode: "processed_message_log",
      tableName: "processed_message",
      recordKey: { consumer: "test.retention.api", idempotency_key: "old" },
      action: "archived",
      periodDays: 30,
    });
    expect(JSON.stringify(acts.body)).not.toContain('"done"'); // never row content
    const archived = await call<Body>(api.app, "GET", `${ARCHIVED}?table=processed_message&retentionRunId=${id}`, {
      session: tech,
    });
    expect(archived.status).toBe(200);
    expect(archived.body.items).toEqual([
      expect.objectContaining({
        tableName: "processed_message",
        recordKey: { consumer: "test.retention.api", idempotency_key: "old" },
        retentionClassCode: "processed_message_log",
        retentionRunId: id,
        archiveSetKey: `retention/${id}/manifest.json`,
        purgedAt: null,
        purgeRunId: null,
      }),
    ]);
    const none = await call<Body>(api.app, "GET", `${ARCHIVED}?table=job_run`, { session: tech });
    expect(none.body.items).toEqual([]);
    expect((await call<Body>(api.app, "GET", `${ARCHIVED}?table=Bad-Name`, { session: tech })).status).toBe(400);
  });

  it("404 for an unknown run (get, actions); 400 for a malformed id or cursor", async () => {
    expect((await call<Body>(api.app, "GET", `${RUNS}/${MISSING}`, { session: tech })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${RUNS}/${MISSING}/actions`, { session: tech })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${RUNS}/not-a-uuid`, { session: tech })).status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${RUNS}?cursor=not-a-cursor`, { session: tech })).status).toBe(400);
  });
});
