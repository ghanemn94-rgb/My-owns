// The asynchronous live-export assembly (T-DG6-BE-Y5; D-207; F-DG6-147; ADR-0046 §2 as amended; migration 0124), against
// the run's disposable PostgreSQL. Every value is SYNTHETIC. An export approves nothing (product gates G1-G6 are
// business approvals), and nothing here touches the engineering gates DG0-DG7.
//   - createExport for a live selection answers 202 with `snapshotId` null and writes the job with its stored selection,
//     its progress row and its audit event: no snapshot, no outbox event (D-207 (1));
//   - the export assembly watch assembles the snapshot (requester as created_by, service actor on behalf of the
//     requester), counts the attempt first (version 2, audited `export_job.assembly_attempt`, committed on its own;
//     T-DG6-BE-Y6, 0125), assigns it (version 3, audited `export_job.assemble`) and only then writes
//     `export_job.requested`;
//     the REAL worker runner then exports it and the requester downloads it (D-207 (2));
//   - access lost between the start and the assembly gives a failed job with its error code and no snapshot, no outbox
//     event and no file: a revoked grant (`export.source_unavailable`) and a record marked sensitive meanwhile
//     (`export.includes_restricted_records`, D-199 at assembly time);
//   - an idempotent replay compares the STORED selection (200 with the same job, pending and assembled; 422
//     idempotency.key_reused for other parameters) (D-207 (3));
//   - a crash in the middle of a job (after the assembly, before the commit) leaves it pending with nothing written,
//     and the next step (a restarted process) assembles it exactly once; the running watch (timer + kick) does too;
//     unexpected errors are retried a bounded number of times, then the job fails `export.assembly_failed`; the bound
//     is persisted on the job, so it holds across restarts, including a crash that kills the process mid-assembly
//     (F-DG6-sa12-3, 0125);
//   - the 0125 guard: a snapshot of another definition than the stored selection's is refused, and the assembly
//     attempt count only steps by 1 while the job is pending (F-DG6-sa12-1, F-DG6-sa12-3);
//   - two watchers racing (two concurrent steps; and a step while another holds a job) assemble every job exactly once;
//   - a cancelled pending job is never assembled; the AUD user is refused (403) and the 0124 CHECK holds.
// Every API call is validated against docs/api/openapi.yaml (the harness `call`), including the 202 with a null
// snapshotId.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPORT_CONTENT_LABELS } from "../../../../../packages/shared/src/reports/content-labels.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import {
  assembleNextExport,
  exportAssemblyWatchStep,
  EXPORT_ASSEMBLY_MAX_ERRORS,
  startExportAssemblyWatch,
} from "../../../src/modules/reporting/exports/assembly.ts";
import { financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO: marks records sensitive
let member: Session; // WL at the transformation: exports
let memberId: string;
let benefitId: string;

const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Body;
};
const key = () => `it-${crypto.randomUUID()}`;
const raidSelection = (filters: Record<string, unknown> = { type: "risk" }) => ({
  definitionCode: "registers",
  subjectId: b.transformationId,
  parameters: { register: "raid", filters },
});
const benefitsSelection = () => ({
  definitionCode: "registers",
  subjectId: b.transformationId,
  parameters: { register: "benefits", filters: {} },
});
const start = (s: Session, report: Record<string, unknown>, idempotencyKey?: string) =>
  call<Body>(api.app, "POST", "/api/v1/exports", {
    session: s,
    ...(idempotencyKey === undefined ? {} : { headers: { "idempotency-key": idempotencyKey } }),
    body: { report, format: "csv", language: "en" },
  });
const jobRow = (id: string) =>
  api.db.selectFrom("export_job").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const outboxOf = (id: string) =>
  api.db.selectFrom("outbox_event").selectAll().where("idempotency_key", "=", `export_job.requested:${id}`).execute();
const auditsOf = (id: string) =>
  api.db
    .selectFrom("audit_event")
    .select(["action", "actor_type", "actor_user_id", "on_behalf_of_user_id", "prior_version", "new_version"])
    .where("record_type", "=", "export_job")
    .where("record_id", "=", id)
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
const snapshotsBy = (userId: string) =>
  api.db.selectFrom("report_snapshot").select("id").where("created_by", "=", userId).execute();
const step = (ids: readonly string[], concurrency?: number) =>
  exportAssemblyWatchStep(api.db, { onlyJobIds: ids, ...(concurrency === undefined ? {} : { concurrency }) });

/** The REAL worker runner on the job's outbox event (first attempt), as tests/qa/support/a15.ts does. */
async function runWorker(exportJobId: string) {
  const [row] = await outboxOf(exportJobId);
  if (row === undefined) throw new Error(`no outbox event for ${exportJobId}`);
  return runExport(
    api.db,
    {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    },
    row.id,
    { retryCount: 0, retryLimit: 5 },
    { store: new FilesystemExportStore(testEvidenceDir()), labels: REPORT_CONTENT_LABELS },
  );
}

/** A fresh WL member of the transformation, signed in. */
async function newMember(): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "WL", { type: "transformation", id: b.transformationId }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  const m = await newMember();
  member = m.session;
  memberId = m.id;
  benefitId = ok(
    await call<Body>(api.app, "POST", `${b.base}/benefits`, {
      session: b.s.bo,
      body: financialBody(b, { title: "Synthetic assembly-time benefit", valueClass: "margin_uplift" }),
    }),
    201,
  ).id as string;
});

afterAll(async () => {
  await api?.close();
});

describe("D-207 (1): a live selection is accepted with no snapshot", () => {
  it("202 with snapshotId null; the job, its stored selection, progress and audit event; no snapshot, no outbox event", async () => {
    const before = await snapshotsBy(memberId);
    const job = ok(await start(member, raidSelection()), 202);
    expect(job).toMatchObject({
      snapshotId: null,
      status: "queued",
      stage: "queued",
      percent: 0,
      version: 1,
      errorCode: null,
      transformationId: b.transformationId,
    });
    const row = await jobRow(job.id);
    expect(row.snapshot_id).toBeNull();
    expect(row.selection).toEqual(raidSelection());
    expect(await outboxOf(job.id)).toEqual([]);
    expect(await snapshotsBy(memberId)).toEqual(before);
    expect((await auditsOf(job.id)).map((a) => [a.action, a.actor_user_id, a.new_version])).toEqual([
      ["export_job.create", memberId, 1],
    ]);
    // Read back and listed while pending (snapshotId null in both, contract-validated).
    expect(ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: member }))).toMatchObject({
      snapshotId: null,
      status: "queued",
    });
    const list = ok(await call<Body>(api.app, "GET", "/api/v1/exports?status=queued&limit=100", { session: member }));
    expect(list.items.find((i: Body) => i.id === job.id)).toMatchObject({ snapshotId: null });
    // The download of a pending job is 409 export.not_ready (no snapshot, no file).
    const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: member });
    expect([dl.status, dl.body.code]).toEqual([409, "export.not_ready"]);
    await step([job.id]);
  });

  it("the request-time refusals stay synchronous: 422 report.subject_invalid / report.parameters_invalid, 403 for AUD", async () => {
    const noSubject = await start(member, { definitionCode: "registers" });
    expect([noSubject.status, noSubject.body.code]).toEqual([422, "report.subject_invalid"]);
    const badParams = await start(member, { ...raidSelection(), parameters: { register: "nonsense" } });
    expect(badParams.status).toBe(422);
    expect(String(badParams.body.code)).toMatch(/^report\./);
    const aud = await signIn(api.app, w.auditor.subject);
    expect((await start(aud, raidSelection())).status).toBe(403);
  });

  it("the 0124 CHECK: a job without a snapshot cannot be running", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const r = api.owner.query(
      `UPDATE export_job SET status = 'running', attempt_count = 1, started_at = now(), version = version + 1 WHERE id = $1`,
      [job.id],
    );
    await expect(r).rejects.toThrow(/export_job_selection_pending/);
    await step([job.id]);
  });
});

describe("D-207 (2): the watch assembles, then the worker exports", () => {
  it("assembled once (requester's snapshot, service actor on behalf of the requester), outbox event, worker succeeds, download 200", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const before = await snapshotsBy(memberId);
    const out = await step([job.id]);
    expect(out).toEqual([{ outcome: "assembled", exportJobId: job.id, snapshotId: expect.any(String) }]);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: "queued", version: 3, assembly_attempt_count: 1 });
    expect(row.snapshot_id).toBe(out[0]!.outcome === "assembled" ? out[0]!.snapshotId : null);
    const snap = await api.db
      .selectFrom("report_snapshot")
      .selectAll()
      .where("id", "=", row.snapshot_id!)
      .executeTakeFirstOrThrow();
    expect(snap).toMatchObject({ created_by: memberId, definition_code: "registers", status: "generated" });
    expect((await snapshotsBy(memberId)).length).toBe(before.length + 1);
    const snapAudit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "on_behalf_of_user_id"])
      .where("record_id", "=", snap.id)
      .execute();
    expect(snapAudit).toEqual([
      { action: "report_snapshot.generate", actor_type: "service", on_behalf_of_user_id: memberId },
    ]);
    expect((await auditsOf(job.id)).map((a) => [a.action, a.actor_type, a.on_behalf_of_user_id ?? null])).toEqual([
      ["export_job.create", "user", null],
      ["export_job.assembly_attempt", "service", memberId],
      ["export_job.assemble", "service", memberId],
    ]);
    expect(await outboxOf(job.id)).toHaveLength(1);
    // A second step finds nothing to do.
    expect(await step([job.id])).toEqual([]);
    expect((await runWorker(job.id)).outcome).toBe("succeeded");
    const done = ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: member }));
    expect(done).toMatchObject({ status: "succeeded", stage: "done", percent: 100, snapshotId: snap.id });
    const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: member });
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toContain("text/csv");
    // Only the requester: another member of the same transformation gets 404 on the job and the download.
    const other = await newMember();
    for (const suffix of ["", "/download"])
      expect(
        (await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}${suffix}`, { session: other.session })).status,
      ).toBe(404);
  });
});

describe("D-207 (2): access lost between the start and the assembly gives a failed job and no file", () => {
  it("a revoked grant: failed export.source_unavailable, no snapshot, no outbox event, no file", async () => {
    const m = await newMember();
    const job = ok(await start(m.session, raidSelection()), 202);
    await api.owner.query(
      `UPDATE scoped_assignment SET revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic assembly test'
        WHERE user_id = $2 AND revoked_at IS NULL`,
      [w.grantor.id, m.id],
    );
    expect(await step([job.id])).toEqual([
      { outcome: "failed", exportJobId: job.id, errorCode: "export.source_unavailable" },
    ]);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({
      status: "failed",
      error_code: "export.source_unavailable",
      snapshot_id: null,
      storage_key: null,
      version: 3, // 1 created, 2 the counted attempt (0125), 3 the failure
    });
    expect(row.finished_at).not.toBeNull();
    expect(await outboxOf(job.id)).toEqual([]);
    expect(await snapshotsBy(m.id)).toEqual([]);
    expect((await auditsOf(job.id)).map((a) => [a.action, a.actor_type, a.prior_version, a.new_version])).toEqual([
      ["export_job.create", "user", null, 1],
      ["export_job.assembly_attempt", "service", 1, 2],
      ["export_job.fail", "service", 2, 3],
    ]);
  });

  it("a record marked sensitive meanwhile: failed export.includes_restricted_records, no snapshot, no file; an admitted requester still exports", async () => {
    const m = await newMember();
    const job = ok(await start(m.session, benefitsSelection()), 202);
    const tl = ok(await start(b.s.bo, benefitsSelection()), 202);
    ok(
      await call<Body>(api.app, "PUT", `${b.base}/records/benefit/${benefitId}/sensitivity`, {
        session: office,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic commercially sensitive terms" },
      }),
    );
    const out = await step([job.id, tl.id], 1);
    expect(out).toContainEqual({
      outcome: "failed",
      exportJobId: job.id,
      errorCode: "export.includes_restricted_records",
    });
    expect(out).toContainEqual({ outcome: "assembled", exportJobId: tl.id, snapshotId: expect.any(String) });
    expect(await jobRow(job.id)).toMatchObject({
      status: "failed",
      error_code: "export.includes_restricted_records",
      snapshot_id: null,
      storage_key: null,
    });
    expect(await outboxOf(job.id)).toEqual([]);
    expect(await snapshotsBy(m.id)).toEqual([]);
    const failed = ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: m.session }));
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "export.includes_restricted_records",
      snapshotId: null,
    });
    const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: m.session });
    expect([dl.status, dl.body.code]).toEqual([422, "export.failed"]);
    // D-199 in the request is unchanged: now that the benefit is sensitive, a new start by the member is a sync 403.
    const refused = await start(m.session, benefitsSelection());
    expect([refused.status, refused.body.code]).toEqual([403, "export.includes_restricted_records"]);
    // The owner (admitted) exports it.
    expect((await runWorker(tl.id)).outcome).toBe("succeeded");
  });
});

describe("D-207 (3): an idempotent replay compares the stored selection", () => {
  it("same key and selection -> 200 with the same job (pending, then assembled); other parameters -> 422 idempotency.key_reused", async () => {
    const k = key();
    const first = ok(await start(member, raidSelection(), k), 202);
    const again = ok(await start(member, raidSelection(), k), 200);
    expect(again).toMatchObject({ id: first.id, snapshotId: null, version: 1 });
    const other = await start(member, raidSelection({ type: "issue" }), k);
    expect([other.status, other.body.code]).toEqual([422, "idempotency.key_reused"]);
    const bySnapshot = await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: member,
      headers: { "idempotency-key": k },
      body: { snapshotId: crypto.randomUUID(), format: "csv", language: "en" },
    });
    expect([bySnapshot.status, bySnapshot.body.code]).toEqual([422, "idempotency.key_reused"]);
    await step([first.id]);
    const after = ok(await start(member, raidSelection(), k), 200);
    expect(after).toMatchObject({ id: first.id, version: 3 }); // 2: the counted attempt (0125); 3: the assignment
    expect(after.snapshotId).not.toBeNull();
    // Nothing new was written by the replays: one job for the key, one outbox event.
    const jobs = await api.db.selectFrom("export_job").select("id").where("idempotency_key", "=", k).execute();
    expect(jobs).toHaveLength(1);
    expect(await outboxOf(first.id)).toHaveLength(1);
  });
});

describe("durability: a restart in the middle of a job, the running watch, bounded retries", () => {
  it("a crash after the assembly and before the commit leaves the job pending with nothing written; the next step assembles it once", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const before = await snapshotsBy(memberId);
    await expect(
      assembleNextExport(api.db, [job.id], {
        afterAssembly: async () => {
          throw new Error("synthetic process crash in the middle of the job");
        },
      }),
    ).rejects.toThrow(/synthetic process crash/);
    // The attempt was counted and committed before the assembly (0125); nothing else was written.
    expect(await jobRow(job.id)).toMatchObject({
      status: "queued",
      snapshot_id: null,
      version: 2,
      assembly_attempt_count: 1,
    });
    expect(await snapshotsBy(memberId)).toEqual(before);
    expect(await outboxOf(job.id)).toEqual([]);
    // The restarted process (a new step) assembles it, once.
    expect(await step([job.id])).toMatchObject([{ outcome: "assembled", exportJobId: job.id }]);
    expect((await snapshotsBy(memberId)).length).toBe(before.length + 1);
    expect(await outboxOf(job.id)).toHaveLength(1);
    expect((await auditsOf(job.id)).filter((a) => a.action === "export_job.assemble")).toHaveLength(1);
  });

  it("the running watch (as the API process starts it) assembles a pending job on its own, and stops cleanly", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const watch = startExportAssemblyWatch(api.db, { error: () => undefined }, 100);
    try {
      watch.kick();
      const deadline = Date.now() + 20_000;
      while ((await jobRow(job.id)).snapshot_id === null && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
    } finally {
      await watch.stop();
    }
    expect((await jobRow(job.id)).snapshot_id).not.toBeNull();
    expect(await outboxOf(job.id)).toHaveLength(1);
  });

  it(`unexpected errors are retried at most ${EXPORT_ASSEMBLY_MAX_ERRORS} times, then the job fails export.assembly_failed`, async () => {
    const job = ok(await start(member, raidSelection()), 202);
    for (let i = 0; i < EXPORT_ASSEMBLY_MAX_ERRORS; i += 1)
      await expect(
        assembleNextExport(api.db, [job.id], {
          afterAssembly: async () => {
            throw new Error("synthetic transient failure");
          },
        }),
      ).rejects.toThrow(/synthetic transient failure/);
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", snapshot_id: null });
    expect(await step([job.id])).toEqual([
      { outcome: "failed", exportJobId: job.id, errorCode: "export.assembly_failed" },
    ]);
    expect(await jobRow(job.id)).toMatchObject({
      status: "failed",
      error_code: "export.assembly_failed",
      snapshot_id: null,
    });
    expect(await outboxOf(job.id)).toEqual([]);
  });
});

describe("F-DG6-sa12-3: the assembly attempts are counted on the job, so the bound survives restarts (0125)", () => {
  /** A fresh copy of assembly.ts with no in-process state at all: what a restarted API process loads. */
  const restartedProcess = async () => {
    vi.resetModules();
    return import("../../../src/modules/reporting/exports/assembly.ts");
  };

  it(`a job whose assembly kills the process is attempted at most ${EXPORT_ASSEMBLY_MAX_ERRORS} times across restarts, then fails export.assembly_failed`, async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const before = await snapshotsBy(memberId);
    for (let i = 1; i <= EXPORT_ASSEMBLY_MAX_ERRORS; i += 1) {
      // Each "process" dies in the middle of the assembly: its transaction never commits and its memory is lost.
      const fresh = await restartedProcess();
      await expect(
        fresh.assembleNextExport(api.db, [job.id], {
          afterAssembly: async () => {
            throw new Error(`synthetic process kill ${i}`);
          },
        }),
      ).rejects.toThrow(/synthetic process kill/);
      expect(await jobRow(job.id)).toMatchObject({ status: "queued", snapshot_id: null, assembly_attempt_count: i });
    }
    // The next restarted process does not assemble it again: it fails the job (no snapshot, no event, no file).
    const fresh = await restartedProcess();
    expect(await fresh.exportAssemblyWatchStep(api.db, { onlyJobIds: [job.id] })).toEqual([
      { outcome: "failed", exportJobId: job.id, errorCode: "export.assembly_failed" },
    ]);
    expect(await jobRow(job.id)).toMatchObject({
      status: "failed",
      error_code: "export.assembly_failed",
      snapshot_id: null,
      assembly_attempt_count: EXPORT_ASSEMBLY_MAX_ERRORS,
    });
    expect(await snapshotsBy(memberId)).toEqual(before);
    expect(await outboxOf(job.id)).toEqual([]);
    const actions = (await auditsOf(job.id)).map((a) => a.action);
    expect(actions).toEqual([
      "export_job.create",
      ...Array.from({ length: EXPORT_ASSEMBLY_MAX_ERRORS }, () => "export_job.assembly_attempt"),
      "export_job.fail",
    ]);
  });

  it("the attempt is committed before the assembly starts: a kill right after counting leaves it counted, and the next process assembles once", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    await expect(
      assembleNextExport(api.db, [job.id], {
        afterAttemptCounted: async () => {
          // Seen from another connection while the attempt's process is still "alive": committed already.
          expect(await jobRow(job.id)).toMatchObject({ assembly_attempt_count: 1, version: 2 });
          throw new Error("synthetic process kill before the assembly");
        },
      }),
    ).rejects.toThrow(/before the assembly/);
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", snapshot_id: null, assembly_attempt_count: 1 });
    const fresh = await restartedProcess();
    expect(await fresh.exportAssemblyWatchStep(api.db, { onlyJobIds: [job.id] })).toMatchObject([
      { outcome: "assembled", exportJobId: job.id },
    ]);
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", assembly_attempt_count: 2, version: 4 });
    expect(await outboxOf(job.id)).toHaveLength(1);
    expect((await auditsOf(job.id)).filter((a) => a.action === "export_job.assemble")).toHaveLength(1);
  });

  it("a watcher holding a job keeps a second one out between its two transactions (session lock), and releases the lock after the job", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    let release!: () => void;
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const first = assembleNextExport(api.db, [job.id], {
      afterAttemptCounted: () =>
        new Promise<void>((r) => {
          release = r;
          held();
        }),
    });
    await holding;
    // Between the committed attempt and the job's transaction the row is not locked, but the session lock is held.
    expect(await assembleNextExport(api.db, [job.id])).toEqual({ outcome: "none" });
    expect((await jobRow(job.id)).assembly_attempt_count).toBe(1);
    release();
    expect(await first).toMatchObject({ outcome: "assembled", exportJobId: job.id });
    const [lock] = (
      await api.owner.query(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::int4::oid
           AND objid = (hashtext($2) & 4294967295)::bigint::oid`,
        [730264, job.id],
      )
    ).rows as { n: number }[];
    expect(lock?.n).toBe(0);
  });
});

describe("F-DG6-sa12-1 and the attempt step: the 0125 export_job_guard", () => {
  it("refuses a snapshot of another definition than the stored selection's; accepts the selection's own", async () => {
    // registers offers pdf, and so does charter: only the definition differs.
    const job = ok(
      await call<Body>(api.app, "POST", "/api/v1/exports", {
        session: member,
        headers: { "idempotency-key": key() },
        body: { report: raidSelection(), format: "pdf", language: "en" },
      }),
      202,
    );
    const charter = ok(
      await call<Body>(api.app, "POST", `${b.base}/reports/charter/generate`, { session: member, body: {} }),
      201,
    );
    expect(charter.definitionCode).toBe("charter");
    const assign = (snapshotId: string) =>
      api.owner.query(`UPDATE export_job SET snapshot_id = $2, version = version + 1 WHERE id = $1`, [
        job.id,
        snapshotId,
      ]);
    await expect(assign(charter.id as string)).rejects.toMatchObject({ constraint: "export_job_snapshot_selection" });
    expect(await jobRow(job.id)).toMatchObject({ snapshot_id: null, version: 1 });
    // The watch assigns a snapshot of the selection's own definition (the guard accepts it).
    expect(await step([job.id])).toMatchObject([{ outcome: "assembled", exportJobId: job.id }]);
  });

  it("the assembly attempt count is 0 on insert and steps by exactly 1, only while the job is pending", async () => {
    const pending = ok(await start(member, raidSelection()), 202);
    const set = (id: string, sqlSet: string) =>
      api.owner.query(`UPDATE export_job SET ${sqlSet}, version = version + 1 WHERE id = $1`, [id]);
    await expect(set(pending.id, "assembly_attempt_count = 2")).rejects.toMatchObject({
      constraint: "export_job_assembly_attempt_step",
    });
    await expect(set(pending.id, "assembly_attempt_count = -1")).rejects.toMatchObject({
      constraint: "export_job_assembly_attempt_step",
    });
    // A cancelled (no longer pending) job keeps its count.
    ok(await call<Body>(api.app, "POST", `/api/v1/exports/${pending.id}/cancel`, { session: member, headers: ifm(1) }));
    // (a finished job is frozen first; the count rule would refuse it as well)
    await expect(set(pending.id, "assembly_attempt_count = 1")).rejects.toMatchObject({
      constraint: "export_job_finished_frozen",
    });
    // An assembled job (it has a snapshot) keeps its count.
    const assembled = ok(await start(member, raidSelection()), 202);
    await step([assembled.id]);
    await expect(set(assembled.id, "assembly_attempt_count = assembly_attempt_count + 1")).rejects.toMatchObject({
      constraint: "export_job_assembly_attempt_step",
    });
    // A job is never created with an attempt.
    const row = await jobRow(assembled.id);
    await expect(
      api.owner.query(
        `INSERT INTO export_job (id, organization_id, transformation_id, snapshot_id, requested_by, format, language,
           idempotency_key, created_by, assembly_attempt_count)
         VALUES ($1, $2, $3, $4, $5, 'csv', 'en', $6, $5, 1)`,
        [crypto.randomUUID(), row.organization_id, row.transformation_id, row.snapshot_id, memberId, key()],
      ),
    ).rejects.toMatchObject({ constraint: "export_job_created_queued" });
  });
});

describe("exactly once: two watchers race", () => {
  it("two concurrent steps over 6 pending jobs assemble each exactly once (one snapshot, one outbox event, one assemble audit each)", async () => {
    const jobs = [] as string[];
    for (let i = 0; i < 6; i += 1) jobs.push(ok(await start(member, raidSelection()), 202).id as string);
    const before = await snapshotsBy(memberId);
    const [a, c] = await Promise.all([step(jobs, 2), step(jobs, 2)]);
    const assembled = [...a!, ...c!].filter((o) => o.outcome === "assembled").map((o) => o.exportJobId);
    expect([...assembled].sort()).toEqual([...jobs].sort());
    expect((await snapshotsBy(memberId)).length).toBe(before.length + 6);
    for (const id of jobs) {
      expect(await outboxOf(id), id).toHaveLength(1);
      expect(
        (await auditsOf(id)).filter((x) => x.action === "export_job.assemble"),
        id,
      ).toHaveLength(1);
      expect(await jobRow(id), id).toMatchObject({ version: 3, status: "queued", assembly_attempt_count: 1 });
    }
    const snapshotIds = await Promise.all(jobs.map(async (id) => (await jobRow(id)).snapshot_id));
    expect(new Set(snapshotIds).size).toBe(6);
  });

  it("a second watcher skips a job the first one holds (FOR UPDATE SKIP LOCKED), and the job is assembled once", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    let release!: () => void;
    let held!: () => void;
    const holding = new Promise<void>((r) => (held = r));
    const first = assembleNextExport(api.db, [job.id], {
      afterAssembly: () =>
        new Promise<void>((r) => {
          release = r;
          held();
        }),
    });
    await holding;
    expect(await assembleNextExport(api.db, [job.id])).toEqual({ outcome: "none" });
    release();
    expect(await first).toMatchObject({ outcome: "assembled", exportJobId: job.id });
    expect(await outboxOf(job.id)).toHaveLength(1);
  });

  it("a cancelled pending job is never assembled (cancel with If-Match 1)", async () => {
    const job = ok(await start(member, raidSelection()), 202);
    const cancelled = ok(
      await call<Body>(api.app, "POST", `/api/v1/exports/${job.id}/cancel`, { session: member, headers: ifm(1) }),
    );
    expect(cancelled).toMatchObject({ status: "cancelled", snapshotId: null });
    expect(await step([job.id])).toEqual([]);
    expect(await jobRow(job.id)).toMatchObject({ status: "cancelled", snapshot_id: null });
    expect(await outboxOf(job.id)).toEqual([]);
  });
});
