// Export jobs, CSV and XLSX (T-DG5-BE-M; ADR-0046 §2-§6, §8-§9; p5-work-split §F.5). Proves, against the run's
// disposable PostgreSQL, through the API and the worker's export runner (apps/worker reports.export):
//  - REQ-S13-005: an XLSX export of the RAID register with a filter contains exactly the filtered rows, cell by cell
//    against the DG4 list route; a CSV export is UTF-8 with a BOM and CRLF; progress moves forward and ends `done`;
//    the same Idempotency-Key gives one job (200 on the repeat); a killed worker mid-export completes once;
//  - REQ-S13-006: a RAID description `=HYPERLINK("http://x","y")` is an inline string with quotePrefix in XLSX and
//    `'=HYPERLINK(...)` in CSV;
//  - authorization: another user's getExport/downloadExport -> 404; a requester who lost transformation.read -> 404 on
//    download (and the worker fails a queued job with export.source_unavailable); AUD 403 on POST /exports;
//  - refusals: cancel of a succeeded job -> 422 export.not_cancellable; download before success -> 409
//    export.not_ready; a failed job's download -> 422 export.failed; If-Match 428/409; format and discarded refusals;
//  - one audit event per job transition; commit-time re-authorization; retries and the failure on the last attempt.
// All data is SYNTHETIC; an export approves nothing, and nothing here touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../../../../../packages/reporting/src/model.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { readXlsx, type ReadCell } from "../../../../../packages/reporting/src/xlsx/read.ts";
import { runExport, type ExportRunnerDeps } from "../../../../worker/src/reports/export-runner.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  testEvidenceDir,
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
const store = () => new FilesystemExportStore(testEvidenceDir());
const HYPERLINK = '=HYPERLINK("http://x","y")';
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};
const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
const key = () => `it-${crypto.randomUUID()}`;

/** The relay's envelope of the job's outbox event (what pg-boss delivers to reports.export). */
async function envelopeOf(exportJobId: string): Promise<{ id: string; envelope: Body }> {
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${exportJobId}`)
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    envelope: {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    },
  };
}

/** One delivery of the job to the worker's handler (attempt `retryCount` of 5). */
async function work(exportJobId: string, retryCount = 0, deps: Partial<ExportRunnerDeps> = {}) {
  const { id, envelope } = await envelopeOf(exportJobId);
  return runExport(api.db, envelope, id, { retryCount, retryLimit: 5 }, { store: store(), ...deps });
}

async function createRaid(type: string, description: string, probability: string | null): Promise<Body> {
  return ok(
    await call<Body>(api.app, "POST", `${T}/raid`, {
      session: p.lead.session,
      body: {
        type,
        description,
        impact: "medium",
        ...(probability === null ? {} : { probability }),
        ownerUserId: p.lead.id,
      },
    }),
    201,
    "createRaidEntry",
  );
}

async function registersSnapshot(filters: Record<string, unknown>, session: Session = p.lead.session): Promise<Body> {
  return ok(
    await call<Body>(api.app, "POST", `${T}/reports/registers/generate`, {
      session,
      body: { parameters: { register: "raid", filters } },
    }),
    201,
    "generate registers",
  );
}

async function exportOf(body: Record<string, unknown>, session: Session, idem?: string) {
  return call<Body>(api.app, "POST", "/api/v1/exports", {
    session,
    body,
    ...(idem === undefined ? {} : { headers: { "idempotency-key": idem } }),
  });
}

/** GET …/download through the contract-asserting client; the raw bytes are kept for the format checks. */
async function download(id: string, session: Session) {
  const r = await call<Body>(api.app, "GET", `/api/v1/exports/${id}/download`, { session });
  return { statusCode: r.status, headers: r.headers, rawPayload: r.raw.rawPayload, json: () => r.body };
}

const auditActions = async (id: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select(["action"])
      .where("record_id", "=", id)
      .orderBy("occurred_at")
      .orderBy("id")
      .execute()
  ).map((r) => r.action);

let riskSnapshot: Body;
let riskRows: Body[];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  await createRaid("risk", HYPERLINK, "high");
  await createRaid("risk", "Synthetic risk, with a comma", "low");
  await createRaid("issue", "Synthetic issue (not exported by the risk filter)", null);
  riskSnapshot = await registersSnapshot({ type: "risk" });
  riskRows = ok(
    await call<Body>(api.app, "GET", `${T}/raid?type=risk&limit=100`, { session: p.lead.session }),
    200,
    "list",
  ).items;
}, 120_000);
afterAll(() => api.close());

describe("REQ-S13-005 / REQ-S13-006: XLSX and CSV of the filtered RAID register", () => {
  it("XLSX contains exactly the filtered rows, cell by cell against GET /raid?type=risk; =HYPERLINK is quotePrefixed text", async () => {
    const created = await exportOf({ snapshotId: riskSnapshot.id, format: "xlsx", language: "en" }, p.lead.session);
    const job = ok(created, 202, "createExport");
    expect(job).toMatchObject({ status: "queued", stage: "queued", percent: 0, attemptCount: 0, fileName: null });
    expect(created.headers["etag"]).toBe('"1"');
    const before = await download(job.id, p.lead.session);
    expect([before.statusCode, before.json().code]).toEqual([409, "export.not_ready"]);

    expect(await work(job.id)).toEqual({ exportJobId: job.id, outcome: "succeeded" });
    const done = ok(
      await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
      200,
      "get",
    );
    expect(done).toMatchObject({
      status: "succeeded",
      stage: "done",
      percent: 100,
      attemptCount: 1,
      contentType: XLSX_TYPE,
    });
    expect(done.fileName).toMatch(/^[A-Za-z0-9_.-]+\.xlsx$/);

    const res = await download(job.id, p.lead.session);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(XLSX_TYPE);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${done.fileName}"`);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["etag"]).toBe(`"${done.fileSha256}"`);
    expect(res.rawPayload.byteLength).toBe(done.fileSizeBytes);

    const wb = await readXlsx(new Uint8Array(res.rawPayload));
    const sheet = wb.sheets[1]!;
    // Title row, column header row, then the data rows; D-163 (T-DG5-BE-N2): every sheet then ends with a blank row and
    // the B0004 provenance statement, which are not data rows.
    const end = sheet.rows.findIndex((r, i) => i >= 2 && r.length === 0);
    const rows = sheet.rows.slice(2, end === -1 ? undefined : end);
    const header = sheet.rows[1]!.map((c) => c.text);
    const col = (k: string) => header.indexOf(k);
    expect(header).toEqual([
      "Code",
      "Type",
      "Description",
      "Impact",
      "Probability",
      "Owner",
      "Due date",
      "Mitigation",
      "Status",
    ]);
    expect(rows.length).toBe(riskRows.length);
    expect(riskRows.length).toBe(2);
    const at = (r: ReadCell[], k: string) => r.find((c) => c.ref.startsWith(String.fromCharCode(65 + col(k))))!;
    riskRows.forEach((listed: Body, i: number) => {
      const r = rows[i]!;
      expect(at(r, "Code").text).toBe(listed.code);
      expect(at(r, "Type").text).toBe(listed.type);
      expect(at(r, "Description").text).toBe(listed.description);
      expect(at(r, "Impact").text).toBe(listed.impact);
      expect(at(r, "Probability").text).toBe(listed.probability);
      expect(at(r, "Status").text).toBe(listed.status);
    });
    const injected = rows.flat().find((c) => c.text === HYPERLINK)!;
    expect([injected.type, injected.formula, wb.quotePrefix[injected.style]]).toEqual(["inlineStr", null, true]);
    expect(sheet.rows.flat().some((c) => c.formula !== null)).toBe(false);
    expect(await auditActions(job.id)).toEqual(["export_job.create", "export_job.start", "export_job.succeed"]);
  });

  it("CSV is UTF-8 with a BOM and CRLF, and =HYPERLINK(...) is written '=HYPERLINK(...)", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "ar" }, p.lead.session),
      202,
      "csv",
    );
    expect((await work(job.id)).outcome).toBe("succeeded");
    const res = await download(job.id, p.lead.session);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    const bytes = res.rawPayload;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(text).toContain("مسودة — ليس تقريراً صادراً");
    for (const r of riskRows) expect(text).toContain(r.code);
    expect(text).not.toContain("Synthetic issue (not exported by the risk filter)");
  });

  it("progress moves forward only and ends done", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "xlsx", language: "en" }, p.lead.session),
      202,
      "x",
    );
    const seen: [string, number, number][] = [];
    const look = async () => {
      const g = ok(
        await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
        200,
        "g",
      );
      seen.push([g.stage, g.percent, g.sectionsDone]);
    };
    await look();
    await work(job.id, 0, { afterSection: look });
    await look();
    const order = ["queued", "loading", "rendering", "storing", "done"];
    for (let i = 1; i < seen.length; i++) {
      expect(order.indexOf(seen[i]![0])).toBeGreaterThanOrEqual(order.indexOf(seen[i - 1]![0]));
      expect(seen[i]![1]).toBeGreaterThanOrEqual(seen[i - 1]![1]);
      expect(seen[i]![2]).toBeGreaterThanOrEqual(seen[i - 1]![2]);
    }
    expect(seen.at(0)).toEqual(["queued", 0, 0]);
    expect(seen.some((s) => s[0] === "rendering")).toBe(true);
    expect(seen.at(-1)).toEqual(["done", 100, riskSnapshot.content.sections.length]);
  });
});

describe("exactly once: idempotency, a killed worker, retries", () => {
  it("the same Idempotency-Key gives one job (202, then 200 with the same job); another request with it -> 422", async () => {
    const k = key();
    const body = { snapshotId: riskSnapshot.id, format: "csv", language: "en" };
    const first = ok(await exportOf(body, p.lead.session, k), 202, "first");
    const again = ok(await exportOf(body, p.lead.session, k), 200, "repeat");
    expect(again.id).toBe(first.id);
    const n = await api.db
      .selectFrom("export_job")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("idempotency_key", "=", k)
      .executeTakeFirstOrThrow();
    expect(n.n).toBe(1);
    expect(code(await exportOf({ ...body, language: "ar" }, p.lead.session, k))).toEqual([
      422,
      "idempotency.key_reused",
    ]);
    // Another user may use the same key: keys are per requester.
    const sponsorKey = ok(await exportOf(body, p.sponsor.session, k), 202, "sponsor");
    expect(sponsorKey.id).not.toBe(first.id);
    expect((await exportOf(body, p.lead.session, "bad key!")).status).toBe(400);
  });

  it("a worker killed mid-export leaves the job running; the redelivery completes it once, a replay does nothing", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "xlsx", language: "en" }, p.lead.session),
      202,
      "k",
    );
    // Attempt 1 starts (audited), renders its first section and then never returns: the worker died or hangs.
    let kill!: (e: Error) => void;
    const hung = new Promise<never>((_, reject) => {
      kill = reject;
    });
    const zombie = work(job.id, 0, { afterSection: () => hung });
    let mid: Body = null;
    for (let i = 0; i < 400; i++) {
      mid = ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }), 200, "g");
      if (mid.stage === "rendering") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mid).toMatchObject({ status: "running", attemptCount: 1, stage: "rendering", sectionsDone: 1 });
    // A half-written temporary file of the dead attempt is left in the store.
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    const dir = `${testEvidenceDir()}/exports/${w.orgA.id}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${job.id}-a1.xlsx.part`, "half");

    // pg-boss redelivers the job (its lease expired): it is restarted as attempt 2 and completes.
    expect(await work(job.id, 1)).toEqual({ exportJobId: job.id, outcome: "succeeded" });
    // A replayed delivery does nothing; the dead attempt, if it ever wakes up, records nothing and removes its own file.
    expect(await work(job.id, 1)).toEqual({ exportJobId: job.id, outcome: "already_finished" });
    kill(new Error("synthetic: the killed worker's attempt"));
    expect(await zombie).toEqual({ exportJobId: job.id, outcome: "already_finished" });

    const done = ok(
      await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
      200,
      "g",
    );
    expect(done).toMatchObject({ status: "succeeded", attemptCount: 2, stage: "done", percent: 100 });
    expect(await auditActions(job.id)).toEqual([
      "export_job.create",
      "export_job.start",
      "export_job.retry",
      "export_job.start",
      "export_job.succeed",
    ]);
    const files = (await readdir(dir)).filter((f) => f.startsWith(job.id));
    expect(files).toEqual([`${job.id}-a2.xlsx`]);
    expect((await download(job.id, p.lead.session)).statusCode).toBe(200);
  });

  it("a transient failure before the last attempt requeues (audited) and rethrows; the retry succeeds once", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.lead.session),
      202,
      "t",
    );
    const boom = () => {
      throw new Error("synthetic transient failure");
    };
    await expect(work(job.id, 0, { afterSection: boom })).rejects.toThrow("synthetic transient failure");
    const mid = ok(
      await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
      200,
      "g",
    );
    expect(mid).toMatchObject({ status: "queued", attemptCount: 1, errorCode: null });
    expect((await work(job.id, 1)).outcome).toBe("succeeded");
    expect(await auditActions(job.id)).toEqual([
      "export_job.create",
      "export_job.start",
      "export_job.retry",
      "export_job.start",
      "export_job.succeed",
    ]);
  });

  it("the last attempt fails the job with export.retries_exhausted and rethrows (the worker captures it); download -> 422", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.lead.session),
      202,
      "l",
    );
    const boom = () => {
      throw new Error("synthetic persistent failure");
    };
    await expect(work(job.id, 5, { afterSection: boom })).rejects.toThrow("synthetic persistent failure");
    const failed = ok(
      await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
      200,
      "g",
    );
    expect(failed).toMatchObject({ status: "failed", errorCode: "export.retries_exhausted", fileName: null });
    expect(failed.finishedAt).not.toBeNull();
    const res = await download(job.id, p.lead.session);
    expect([res.statusCode, res.json().code]).toEqual([422, "export.failed"]);
    expect(
      code(
        await call<Body>(api.app, "POST", `/api/v1/exports/${job.id}/cancel`, {
          session: p.lead.session,
          headers: ifm(failed.version),
        }),
      ),
    ).toEqual([422, "export.not_cancellable"]);
  });

  it("a renderer's own validation error fails the job at once with export.render_failed (never retried)", async () => {
    // Every format has a renderer since T-DG5-BE-N; the renderer's own error (RenderError) is raised through the
    // runner's per-section seam, exactly where a renderer raises it.
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "pdf", language: "en" }, p.lead.session),
      202,
      "pdf",
    );
    const invalid = () => {
      throw new RenderError("synthetic renderer validation error");
    };
    expect(await work(job.id, 0, { afterSection: invalid })).toEqual({
      exportJobId: job.id,
      outcome: "failed",
      errorCode: "export.render_failed",
    });
    expect(
      ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }), 200, "g"),
    ).toMatchObject({
      status: "failed",
      errorCode: "export.render_failed",
      attemptCount: 1,
    });
  });
});

describe("authorization: exports are authorized like the records", () => {
  it("another user's getExport and downloadExport -> 404; the list shows only the caller's own jobs", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.lead.session),
      202,
      "o",
    );
    await work(job.id);
    for (const s of [p.sponsor.session, p.auditor.session, p.contributor.session]) {
      expect((await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: s })).status).toBe(404);
      expect((await download(job.id, s)).statusCode).toBe(404);
      expect(
        (await call<Body>(api.app, "POST", `/api/v1/exports/${job.id}/cancel`, { session: s, headers: ifm(1) })).status,
      ).not.toBe(200);
    }
    const mine = ok(
      await call<Body>(api.app, "GET", "/api/v1/exports?limit=100", { session: p.lead.session }),
      200,
      "list",
    );
    expect(mine.items.some((j: Body) => j.id === job.id)).toBe(true);
    const theirs = ok(
      await call<Body>(api.app, "GET", "/api/v1/exports?limit=100", { session: p.auditor.session }),
      200,
      "aud list",
    );
    expect(theirs.items).toEqual([]);
    const succeeded = ok(
      await call<Body>(api.app, "GET", "/api/v1/exports?status=succeeded&limit=100", { session: p.lead.session }),
      200,
      "f",
    );
    expect(succeeded.items.every((j: Body) => j.status === "succeeded")).toBe(true);
    expect((await call<Body>(api.app, "GET", "/api/v1/exports?status=done", { session: p.lead.session })).status).toBe(
      400,
    );
  });

  it("a requester who lost transformation.read gets 404 on download; the worker fails their queued job (source_unavailable)", async () => {
    const wl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, wl.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const s = await signIn(api.app, wl.subject);
    const own = await registersSnapshot({}, s);
    const done = ok(await exportOf({ snapshotId: own.id, format: "csv", language: "en" }, s), 202, "wl");
    await work(done.id);
    expect((await download(done.id, s)).statusCode).toBe(200);
    const queued = ok(await exportOf({ snapshotId: own.id, format: "xlsx", language: "en" }, s), 202, "wl2");
    await revokeAll(api, w.grantor.id, wl.id);
    expect((await download(done.id, s)).statusCode).toBe(404);
    expect((await call<Body>(api.app, "GET", `/api/v1/exports/${done.id}`, { session: s })).status).toBe(404);
    expect(ok(await call<Body>(api.app, "GET", "/api/v1/exports", { session: s }), 200, "list").items).toEqual([]);
    expect(await work(queued.id)).toEqual({
      exportJobId: queued.id,
      outcome: "failed",
      errorCode: "export.source_unavailable",
    });
    const row = await api.db
      .selectFrom("export_job")
      .select(["status", "error_code", "attempt_count"])
      .where("id", "=", queued.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "failed", error_code: "export.source_unavailable", attempt_count: 0 });
  });

  it("AUD gets 403 on POST /exports (whatever it sends) and on cancel; a stranger 404; nothing written", async () => {
    const count = async () =>
      (
        await api.db
          .selectFrom("export_job")
          .select(sql<number>`count(*)::int`.as("n"))
          .executeTakeFirstOrThrow()
      ).n;
    const before = await count();
    expect(
      (await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.auditor.session)).status,
    ).toBe(403);
    expect((await exportOf({ nonsense: true }, p.auditor.session)).status).toBe(403);
    expect(
      (
        await call<Body>(api.app, "POST", `/api/v1/exports/${crypto.randomUUID()}/cancel`, {
          session: p.auditor.session,
          headers: ifm(1),
        })
      ).status,
    ).toBe(403);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, nobody)).status).toBe(403);
    const outsider = await createUser(api.db, w.orgA.id);
    await grant(
      api.db,
      w.grantor.id,
      outsider.id,
      "TL",
      { type: "transformation", id: await otherTransformation() },
      w.orgA.id,
    );
    const os = await signIn(api.app, outsider.subject);
    expect((await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, os)).status).toBe(404);
    expect(await count()).toBe(before);
  });

  it("commit-time authorization: export.create revoked while the request waits -> 403; nothing written", async () => {
    const tl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const s = await signIn(api.app, tl.subject);
    const before = await api.db
      .selectFrom("export_job")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("requested_by", "=", tl.id)
      .executeTakeFirstOrThrow();
    const res = await afterIdentity(
      api,
      tl.id,
      () => exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, s),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect([403, 404]).toContain(res.status);
    const after = await api.db
      .selectFrom("export_job")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("requested_by", "=", tl.id)
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

async function otherTransformation(): Promise<string> {
  const t = ok(
    await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: p.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic other transformation", mode: "end_to_end" },
    }),
    201,
    "other transformation",
  );
  return t.id;
}

describe("refusals and cancel (ADR-0046 §8)", () => {
  it("cancel: 428 without If-Match, 409 stale, 200 queued -> cancelled (audited), the worker then stores nothing; 422 when finished", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.lead.session),
      202,
      "c",
    );
    const C = `/api/v1/exports/${job.id}/cancel`;
    expect(code(await call<Body>(api.app, "POST", C, { session: p.lead.session }))).toEqual([
      428,
      "precondition_required",
    ]);
    expect(code(await call<Body>(api.app, "POST", C, { session: p.lead.session, headers: ifm(9) }))).toEqual([
      409,
      "version_conflict",
    ]);
    const cancelled = ok(
      await call<Body>(api.app, "POST", C, { session: p.lead.session, headers: ifm(1) }),
      200,
      "cancel",
    );
    expect(cancelled).toMatchObject({ status: "cancelled", version: 2 });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await work(job.id)).toEqual({ exportJobId: job.id, outcome: "already_finished" });
    expect(await auditActions(job.id)).toEqual(["export_job.create", "export_job.cancel"]);
    expect(code(await call<Body>(api.app, "POST", C, { session: p.lead.session, headers: ifm(2) }))).toEqual([
      422,
      "export.not_cancellable",
    ]);
    const res = await download(job.id, p.lead.session);
    expect([res.statusCode, res.json().code]).toEqual([409, "export.not_ready"]);
  });

  it("cancel of a succeeded job -> 422 export.not_cancellable; cancel while running stops the render without a file", async () => {
    const job = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "csv", language: "en" }, p.lead.session),
      202,
      "s",
    );
    await work(job.id);
    const got = ok(
      await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
      200,
      "g",
    );
    expect(
      code(
        await call<Body>(api.app, "POST", `/api/v1/exports/${job.id}/cancel`, {
          session: p.lead.session,
          headers: ifm(got.version),
        }),
      ),
    ).toEqual([422, "export.not_cancellable"]);
    const running = ok(
      await exportOf({ snapshotId: riskSnapshot.id, format: "xlsx", language: "en" }, p.lead.session),
      202,
      "r",
    );
    const outcome = await work(running.id, 0, {
      afterSection: async (done) => {
        if (done !== 1) return;
        const cur = ok(
          await call<Body>(api.app, "GET", `/api/v1/exports/${running.id}`, { session: p.lead.session }),
          200,
          "g",
        );
        ok(
          await call<Body>(api.app, "POST", `/api/v1/exports/${running.id}/cancel`, {
            session: p.lead.session,
            headers: ifm(cur.version),
          }),
          200,
          "cancel running",
        );
      },
    });
    expect(outcome).toEqual({ exportJobId: running.id, outcome: "cancelled" });
    const row = await api.db
      .selectFrom("export_job")
      .select(["status", "storage_key"])
      .where("id", "=", running.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "cancelled", storage_key: null });
  });

  it("format not offered, a discarded snapshot, an unknown snapshot and a bad body", async () => {
    const charter = ok(
      await call<Body>(api.app, "POST", `${T}/reports/charter/generate`, { session: p.lead.session, body: {} }),
      201,
      "charter",
    );
    const defs = ok(
      await call<Body>(api.app, "GET", "/api/v1/report-definitions", { session: p.lead.session }),
      200,
      "defs",
    ).items;
    const charterFormats: string[] = defs.find((d: Body) => d.code === "charter").formats;
    const missingFormat = ["pdf", "docx", "xlsx", "pptx", "csv"].find((f) => !charterFormats.includes(f));
    if (missingFormat !== undefined)
      expect(
        code(await exportOf({ snapshotId: charter.id, format: missingFormat, language: "en" }, p.lead.session)),
      ).toEqual([422, "export.format_not_offered"]);
    const discard = await registersSnapshot({ type: "issue" });
    ok(
      await call<Body>(api.app, "POST", `${T}/report-snapshots/${discard.id}/discard`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { reason: "Synthetic discard" },
      }),
      200,
      "discard",
    );
    expect(code(await exportOf({ snapshotId: discard.id, format: "csv", language: "en" }, p.lead.session))).toEqual([
      422,
      "export.snapshot_discarded",
    ]);
    expect(
      (await exportOf({ snapshotId: crypto.randomUUID(), format: "csv", language: "en" }, p.lead.session)).status,
    ).toBe(404);
    expect((await exportOf({ format: "csv", language: "en" }, p.lead.session)).status).toBe(400);
    expect(
      (
        await exportOf(
          { snapshotId: riskSnapshot.id, report: { definitionCode: "charter" }, format: "csv", language: "en" },
          p.lead.session,
        )
      ).status,
    ).toBe(400);
    expect(
      (await exportOf({ snapshotId: riskSnapshot.id, format: "odt", language: "en" }, p.lead.session)).status,
    ).toBe(400);
  });

  it("a live selection generates its snapshot first, then exports it (202); without a subject -> 422 report.subject_invalid", async () => {
    const live = ok(
      await exportOf(
        {
          report: {
            definitionCode: "registers",
            subjectId: p.transformationId,
            parameters: { register: "raid", filters: { type: "risk" } },
          },
          format: "csv",
          language: "en",
        },
        p.lead.session,
      ),
      202,
      "live",
    );
    const snap = ok(
      await call<Body>(api.app, "GET", `${T}/report-snapshots/${live.snapshotId}`, { session: p.lead.session }),
      200,
      "snap",
    );
    expect(snap).toMatchObject({ status: "generated", definitionCode: "registers" });
    expect((await work(live.id)).outcome).toBe("succeeded");
    expect(
      code(await exportOf({ report: { definitionCode: "registers" }, format: "csv", language: "en" }, p.lead.session)),
    ).toEqual([422, "report.subject_invalid"]);
  });
});
