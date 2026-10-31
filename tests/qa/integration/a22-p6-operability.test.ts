// A22 "Operational readiness", P6 extension (qa-verifier, T-DG6-QA-E): "Health checks, logs, error alerts, admin job
// visibility and production/demo separation are demonstrated" (master prompt §20). The P5 suite
// (a22-operational-readiness.test.ts) covers health, the jobs view and production/demo separation; this file adds what
// P6 delivers and what A22 names but P5 could not show: structured logs with secrets redacted, the post-suite log scan,
// error alerts, the worker heartbeat and operational exceptions, each observable and asserted.
//
// Binding row texts (docs/delivery/requirements.csv, final gate DG6), each tested literally:
//  - REQ-S20-022 (A22) "Health checks, logs, error alerts, admin job visibility and production/demo separation are
//    demonstrated"                                               -> every describe below (+ the P5 suite)
//  - REQ-S16-029 (A12;A22) "a log scan after the test suite finds no secrets or storage URLs; a job's identity cannot
//    read records outside its scope"                             -> "structured logs …", "post-suite log scan …"
//    (the scope half is the A12 suite: a12-p6-scope-isolation.test.ts)
//  - REQ-S12-019 (A17;A22) "a failing test connector produces one exception and the KPI shows Stale with its last value
//    and date"                                                   -> "operational exceptions …" (one exception, one
//    alert; the KPI half is a17-import-and-integration.test.ts)
//
// Environment: the REAL API (Fastify inject) on a scratch database of this run's disposable PostgreSQL, with its log
// lines captured exactly as server.ts writes them (pino + the process-wide redaction set), and the BUILT production
// worker (`node apps/worker/dist/main.js`) as its own OS process with WORKER_HEARTBEAT_SECONDS=1 and its output captured.
// The only test-side manipulation of product state is ageing worker_heartbeat rows (as cluster superuser) to simulate
// elapsed time after the worker stopped; everything else goes through the public API, whose responses are validated
// against docs/api/openapi.yaml. Due connector runs are executed by `connectorRunWatchStep`, the exact step the API
// process runs every 10 s in production (not started under NODE_ENV=test, as in the A17 suite). All data is SYNTHETIC;
// acknowledging an exception approves nothing (G1-G6) and nothing here touches the engineering gates.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectorRunWatchStep } from "../../../apps/api/src/modules/integrations/runs.ts";
import { newTransformation, orgWorld, waitFor, type OrgWorld } from "../support/a13-durable.ts";
import {
  capturedApi,
  HEARTBEAT,
  JOBS,
  logScan,
  OPS_EXCEPTIONS,
  parsed,
  REPO_ROOT,
  startBuiltWorker,
  type CapturedApi,
  type WorkerProcess,
} from "../support/a22-ops.ts";
import { CONNECTORS, enabledConnector, ifm } from "../support/a17.ts";
import { auditOf, call, expectProblem, uniq, type Loose } from "../support/api.ts";

vi.setConfig({ testTimeout: 150_000 });

// Canaries (ADR-0053 §5): values that must never reach a log line. Every value starting with `mth-canary-` in the
// scan's environment is a canary; the worker gets the secret-shaped ones as configuration it reads.
const CANARY = {
  bearer: "mth-canary-qa-a22-bearer-token-000000000001",
  csrf: "mth-canary-qa-a22-csrf-000000000001",
  oidc: "mth-canary-qa-a22-oidc-client-secret-0001",
  s3: "mth-canary-qa-a22-s3-secret-key-0001",
  smtp: "mth-canary-qa-a22-smtp-password-0001",
} as const;
const CANARY_ENV = {
  MTH_CANARY_QA_A22_BEARER: CANARY.bearer,
  MTH_CANARY_QA_A22_CSRF: CANARY.csrf,
  OIDC_CLIENT_SECRET: CANARY.oidc,
  S3_SECRET_ACCESS_KEY: CANARY.s3,
  SMTP_PASSWORD: CANARY.smtp,
};
/** A syntactically valid deep-link token (43 base64url characters) that exists nowhere. */
const LINK_TOKEN = "QaA22SyntheticDeepLinkTokenXyz0123456789abc";

let env: CapturedApi;
let w: OrgWorld;
let worker: WorkerProcess | null = null;
const workerOutputs: string[] = [];

beforeAll(async () => {
  expect(LINK_TOKEN).toHaveLength(43);
  env = await capturedApi("mth_qa_a22p6");
  w = await orgWorld(env.api);
}, 120_000);

afterAll(async () => {
  if (worker) workerOutputs.push(worker.output());
  await worker?.stop().catch(() => undefined);
  await env?.close();
}, 90_000);

async function startWorker(): Promise<WorkerProcess> {
  worker = await startBuiltWorker(env.appUrl, { OIDC_CLIENT_SECRET: CANARY.oidc, S3_SECRET_ACCESS_KEY: CANARY.s3 });
  return worker;
}
async function stopWorker(): Promise<number | null> {
  if (!worker) return null;
  const code = await worker.stop();
  workerOutputs.push(worker.output());
  worker = null;
  return code;
}
const heartbeat = () => call<Loose>(env.api.app, "GET", HEARTBEAT, { session: w.tech.session });
const exceptionsList = (q: string) =>
  call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}?${q}`, { session: w.tech.session });
/**
 * Simulates "more than 90 s pass with no beat" without waiting: as cluster superuser, in one transaction with
 * session_replication_role = replica (which skips the worker_heartbeat forward-only guard trigger, a product invariant
 * for the app role that a clock shift cannot satisfy), every row's times move 10 and 5 minutes into the past.
 */
async function ageHeartbeats(): Promise<void> {
  const c = await env.su.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(
      `UPDATE worker_heartbeat SET started_at = least(started_at, now() - interval '10 minutes'),
              last_beat_at = now() - interval '5 minutes'`,
    );
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
const allWorkerOutput = () => [...workerOutputs, worker?.output() ?? ""].join("\n");

// ------------------------------------------------------------------ structured logs and redaction

describe("A22 logs (REQ-S20-022, REQ-S16-029): every API line is structured JSON; credentials, tokens and deep-link tokens are redacted", () => {
  it("each request is logged as one JSON object with time, level, msg and the requestId the problem response carries", async () => {
    const before = env.lines.length;
    const res = await call<Loose>(env.api.app, "GET", `/api/v1/transformations/${crypto.randomUUID()}`, {
      session: w.tech.session,
    });
    expectProblem(res, 404, res.body.type);
    const mine = parsed(env.lines.slice(before));
    expect(mine.length, "request lines were written").toBeGreaterThan(0);
    for (const l of mine) {
      expect(l.__raw, `a non-JSON log line: ${String(l.__raw)}`).toBeUndefined();
      expect([typeof l.time, typeof l.level, typeof l.msg], JSON.stringify(l)).toEqual(["number", "number", "string"]);
    }
    const correlated = mine.filter((l) => l.requestId === res.body.requestId);
    expect(correlated.length, "the problem's requestId is the log lines' requestId").toBeGreaterThanOrEqual(1);
  });

  it("an Authorization bearer token, the session cookie, the CSRF header and a deep-link token never appear in a log line", async () => {
    const before = env.lines.length;
    await call<Loose>(env.api.app, "GET", "/api/v1/me", {
      headers: {
        authorization: `Bearer ${CANARY.bearer}`,
        cookie: w.tech.session.cookie,
        "x-csrf-token": CANARY.csrf,
      },
      contract: false,
    });
    const link = await call<Loose>(env.api.app, "GET", `/api/v1/links/${LINK_TOKEN}`, { session: w.tech.session });
    expect([401, 403, 404, 410]).toContain(link.status);
    const text = env.lines.slice(before).join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text, "bearer token").not.toContain(CANARY.bearer);
    expect(text, "CSRF header").not.toContain(CANARY.csrf);
    const sessionValue = w.tech.session.cookie.split("=").slice(1).join("=").split(";")[0]!;
    expect(sessionValue.length).toBeGreaterThan(8);
    expect(text, "session cookie value").not.toContain(sessionValue);
    expect(text, "deep-link token").not.toContain(LINK_TOKEN);
    expect(text, "the deep-link path is still logged, its token masked").toContain("/links/[token]");
  });

  it("an OIDC code/state in a query string is masked in the logged URL", async () => {
    const before = env.lines.length;
    const code = "QaA22SyntheticOidcAuthorizationCode0001";
    const state = "QaA22SyntheticOidcState0001";
    await call<Loose>(env.api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, {
      contract: false,
    });
    const text = env.lines.slice(before).join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(code);
    expect(text).not.toContain(state);
  });
});

// ------------------------------------------------------------------ worker heartbeat and the heartbeat alert

describe("A22 worker heartbeat (ADR-0053 §6): unknown before any beat, alive while beating, stale after it stops (never alive); the API raises one heartbeat_missed exception and one alert line, and resolves it when beats resume", () => {
  let exceptionId = "";

  it("no worker ever beat: unknown with no instances (never alive); a non-admin gets 403, an anonymous caller 401", async () => {
    const r = await heartbeat();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "unknown", newestBeatAt: null, instances: [], staleAfterSeconds: 90 });
    const lead = await call<Loose>(env.api.app, "GET", HEARTBEAT, { session: w.lead.session });
    expectProblem(lead, 403, lead.body.type);
    const anon = await call<Loose>(env.api.app, "GET", HEARTBEAT);
    expectProblem(anon, 401, anon.body.type);
  });

  it("the built worker beats: alive, one instance with its app version, queue count and a growing beat count; its log lines are JSON", async () => {
    const wp = await startWorker();
    const started = parsed([wp.output()]).find((l) => l.msg === "mth-worker started");
    expect(started, wp.output()).toBeDefined();
    expect(started.heartbeatSeconds).toBe(1);
    const instanceKey: string = started.instanceKey;
    expect(instanceKey).toMatch(/^worker-[0-9a-f]{24}$/);
    const alive = await waitFor(
      async () => {
        const r = await heartbeat();
        return r.body.status === "alive" && Number(r.body.instances[0]?.beatCount ?? 0) >= 3 ? r.body : null;
      },
      "three beats",
      30_000,
    );
    expect(alive.instances).toHaveLength(1);
    expect(alive.instances[0]).toMatchObject({ instanceKey, status: "alive" });
    expect(alive.instances[0].appVersion).not.toBe("");
    expect(alive.instances[0].queueCount).toBeGreaterThan(0);
    expect(alive.instances[0].beatCount).toMatch(/^[0-9]+$/);
    for (const l of parsed([wp.output()]))
      expect(l.__raw, `a non-JSON worker line: ${String(l.__raw)}`).toBeUndefined();
  });

  it("after the worker stops and >90 s pass (rows aged), status is stale, never alive; the watch opens exactly one heartbeat_missed exception and writes one alert line", async () => {
    expect(await stopWorker(), "the worker shuts down cleanly on SIGTERM").toBe(0);
    await ageHeartbeats();
    const stale = await heartbeat();
    expect(stale.body.status).toBe("stale");
    expect(stale.body.instances.map((i: Loose) => i.status)).toEqual(["stale"]);
    const linesBefore = env.lines.length;
    const opened = await waitFor(
      async () => {
        const r = await exceptionsList(`organizationId=${w.orgId}&sourceKind=worker&limit=100`);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const open = (r.body.items as Loose[]).filter((e) => e.failureClass === "heartbeat_missed");
        return open.length > 0 ? open : null;
      },
      "the API heartbeat watch (every 60 s) to open heartbeat_missed",
      75_000,
    );
    expect(opened, JSON.stringify(opened)).toHaveLength(1);
    const e = opened[0];
    expect(e).toMatchObject({
      sourceKind: "worker",
      failureClass: "heartbeat_missed",
      status: "open",
      organizationId: null,
      occurrenceCount: 1,
      lastErrorCode: "operations.heartbeat_missed",
    });
    exceptionId = e.id;
    const alerts = await waitFor(
      async () => {
        const a = parsed(env.lines).filter((l) => l.alert === true && l.exceptionId === exceptionId);
        return a.length > 0 ? a : null;
      },
      "the alert line",
      5_000,
    );
    expect(alerts, "one alert line per opened exception").toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 50,
      alertCode: "heartbeat_missed",
      errorCode: "operations.heartbeat_missed",
      msg: "operational exception opened",
    });
    expect(env.lines.length).toBeGreaterThan(linesBefore);
  });

  it("when beats resume: alive again with the old instance stale beside the new one; the alert sweep notifies the acknowledgers in-app once; the watch resolves the exception as recovered", async () => {
    expect(exceptionId, "the previous step opened the heartbeat exception").not.toBe("");
    await startWorker();
    const alive = await waitFor(
      async () => {
        const r = await heartbeat();
        return r.body.status === "alive" ? r.body : null;
      },
      "alive again",
      30_000,
    );
    expect(alive.instances.map((i: Loose) => i.status).sort()).toEqual(["alive", "stale"]);

    // Error alert, in-app: the sweep (scheduled every minute in the worker; also run now here) notifies ADM_TECH
    // (operations.acknowledge) of every organization for a platform exception.
    const run = await call<Loose>(env.api.app, "POST", `${JOBS}/operations.exception_alerts/run`, {
      session: w.tech.session,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    const inbox = await waitFor(
      async () => {
        const r = await call<Loose>(env.api.app, "GET", "/api/v1/me/inbox?limit=100", { session: w.tech.session });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const mine = (r.body.items as Loose[]).filter((n) => JSON.stringify(n).includes(exceptionId));
        return mine.length > 0 ? mine : null;
      },
      "the in-app alert of the heartbeat exception (the sweep is scheduled every minute)",
      100_000,
    );
    expect(inbox, JSON.stringify(inbox)).toHaveLength(1);
    expect(inbox[0].messageKey).toBe("operations.exception_opened");
    // The worker writes no second alert line for heartbeat_missed (the API watch already did).
    expect(parsed([allWorkerOutput()]).filter((l) => l.alert === true && l.exceptionId === exceptionId)).toHaveLength(
      0,
    );
    // A non-holder (TL) gets nothing.
    const lead = await call<Loose>(env.api.app, "GET", "/api/v1/me/inbox?limit=100", { session: w.lead.session });
    expect(JSON.stringify(lead.body.items)).not.toContain(exceptionId);

    const resolved = await waitFor(
      async () => {
        const r = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, {
          session: w.tech.session,
        });
        return r.body.status === "resolved" ? r.body : null;
      },
      "the watch to resolve heartbeat_missed as recovered",
      75_000,
    );
    expect(resolved).toMatchObject({ resolution: "recovered", resolvedBy: null });
    expect(resolved.events.map((x: Loose) => x.eventKind)).toEqual(expect.arrayContaining(["opened", "resolved"]));
    // A recovery writes no alert line.
    expect(parsed(env.lines).filter((l) => l.alert === true && l.exceptionId === exceptionId)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ operational exceptions: connector failure, alert, lifecycle

describe("A22 operational exceptions and error alerts (REQ-S12-019, REQ-S20-022): a failing connector opens one visible exception and one alert; acknowledge and resolve are authorized, version-checked and audited", () => {
  let exceptionId = "";
  let connectorId = "";
  let connectorCode = "";

  async function failOnce(): Promise<void> {
    const q = await call<Loose>(env.api.app, "POST", `${CONNECTORS}/${connectorId}/runs`, {
      session: w.tech.session,
      body: {},
    });
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    await waitFor(
      async () => {
        await connectorRunWatchStep(env.api.db, { onlyConnectors: [connectorId] });
        const d = await call<Loose>(env.api.app, "GET", `${CONNECTORS}/${connectorId}/runs/${q.body.id}`, {
          session: w.tech.session,
        });
        return d.body.run?.status === "failed" ? d.body : null;
      },
      "the failed run",
      45_000,
    );
  }

  it("one failing run -> exactly one open connector exception, visible to the technical admin and the auditor, not to a team lead", async () => {
    if (!worker) await startWorker();
    const t = await newTransformation(env.api, w, "qa-a22-connector");
    connectorCode = uniq("qa-a22-fail-").toLowerCase();
    const c = await enabledConnector(env.api, w.tech.session, {
      organizationId: w.orgId,
      code: connectorCode,
      adapterKind: "test_adapter",
      targetTransformationId: t.id,
      adapterSettings: { mode: "failing" },
    });
    connectorId = c.id;
    await failOnce();
    const list = await waitFor(
      async () => {
        const r = await exceptionsList(`organizationId=${w.orgId}&sourceKind=connector&limit=100`);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const mine = (r.body.items as Loose[]).filter((e) => e.sourceCode === connectorCode);
        return mine.length > 0 ? mine : null;
      },
      "the connector's operational exception (worker)",
      60_000,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "open", occurrenceCount: 1, organizationId: w.orgId });
    expect(["connector_run_failed", "connector_unreachable"]).toContain(list[0].failureClass);
    exceptionId = list[0].id;
    const aud = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, {
      session: w.auditor.session,
    });
    expect(aud.status, JSON.stringify(aud.body)).toBe(200);
    const lead = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, { session: w.lead.session });
    expect([403, 404]).toContain(lead.status);
  });

  it("the alert sweep writes exactly one structured alert line (worker) and one in-app alert per acknowledger; a recurrence alerts nothing", async () => {
    const run = await call<Loose>(env.api.app, "POST", `${JOBS}/operations.exception_alerts/run`, {
      session: w.tech.session,
    });
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    const alert = await waitFor(
      async () => {
        const a = parsed([allWorkerOutput()]).filter((l) => l.alert === true && l.exceptionId === exceptionId);
        return a.length > 0 ? a : null;
      },
      "the worker's alert line",
      60_000,
    );
    expect(alert).toHaveLength(1);
    expect(alert[0]).toMatchObject({
      alertCode: expect.stringMatching(/^connector_/),
      organizationId: w.orgId,
      sourceKind: "connector",
      sourceCode: connectorCode,
      msg: "operational exception opened",
    });
    expect(String(alert[0].serviceIdentity)).toMatch(/^job:/);
    const inbox = await call<Loose>(env.api.app, "GET", "/api/v1/me/inbox?limit=100", { session: w.tech.session });
    expect((inbox.body.items as Loose[]).filter((n) => JSON.stringify(n).includes(exceptionId))).toHaveLength(1);

    // Recurrence: a second failing run counts an occurrence on the same exception and alerts nothing new.
    await failOnce();
    const again = await waitFor(
      async () => {
        const r = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, {
          session: w.tech.session,
        });
        return r.body.occurrenceCount >= 2 ? r.body : null;
      },
      "the recurrence",
      60_000,
    );
    expect(again.status).toBe("open");
    const list = await exceptionsList(`organizationId=${w.orgId}&sourceKind=connector&limit=100`);
    expect((list.body.items as Loose[]).filter((e) => e.sourceCode === connectorCode)).toHaveLength(1);
    const rerun = await call<Loose>(env.api.app, "POST", `${JOBS}/operations.exception_alerts/run`, {
      session: w.tech.session,
    });
    expect(rerun.status).toBe(202);
    await new Promise((r) => setTimeout(r, 5_000));
    expect(parsed([allWorkerOutput()]).filter((l) => l.alert === true && l.exceptionId === exceptionId)).toHaveLength(
      1,
    );
  });

  it("acknowledge: 428 without If-Match, 412/409 on a stale version, 403 for the auditor (read only), 422 operations.note_required on a short note; 200 with an audit event", async () => {
    const path = `${OPS_EXCEPTIONS}/${exceptionId}/acknowledge`;
    const cur = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, { session: w.tech.session });
    const v: number = cur.body.version;
    const noIfMatch = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      body: { note: "Synthetic acknowledgement" },
    });
    expectProblem(noIfMatch, 428, noIfMatch.body.type);
    const stale = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v + 7),
      body: { note: "Synthetic acknowledgement" },
    });
    expect([409, 412]).toContain(stale.status);
    const auditor = await call<Loose>(env.api.app, "POST", path, {
      session: w.auditor.session,
      headers: ifm(v),
      body: { note: "Synthetic acknowledgement" },
    });
    expectProblem(auditor, 403, auditor.body.type);
    const short = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v),
      body: { note: "x" },
    });
    // ADR-0053 §2 problem table: a note outside 3-1,000 characters is 422 operations.note_required.
    expectProblem(short, 422, short.body.type);
    expect(short.body.code).toBe("operations.note_required");
    expect((await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, { session: w.tech.session })).body)
      .toMatchObject({ status: "open", version: v });

    const ok = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v),
      body: { note: "Synthetic acknowledgement by QA" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: "acknowledged",
      acknowledgedBy: w.tech.id,
      acknowledgeNote: "Synthetic acknowledgement by QA",
      version: v + 1,
    });
    const audit = (await auditOf(env.api.db, exceptionId)).filter(
      (a) => a.action === "operational_exception.acknowledged",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_user_id).toBe(w.tech.id);
    const twice = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v + 1),
      body: { note: "Synthetic acknowledgement again" },
    });
    expect([409, 422]).toContain(twice.status);
    expect(twice.body.code).toBe("operations.exception_not_open");
  });

  it("resolve: needs a note; 200 resolved (manual) with an audit event; a second resolve is refused 409 operations.exception_resolved", async () => {
    const path = `${OPS_EXCEPTIONS}/${exceptionId}/resolve`;
    const cur = await call<Loose>(env.api.app, "GET", `${OPS_EXCEPTIONS}/${exceptionId}`, { session: w.tech.session });
    const v: number = cur.body.version;
    const noNote = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v),
      body: {},
    });
    expectProblem(noNote, 400, noNote.body.type);
    const ok = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v),
      body: { note: "Synthetic resolution by QA" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: "resolved", resolution: "manual", resolvedBy: w.tech.id, version: v + 1 });
    expect(
      (await auditOf(env.api.db, exceptionId)).filter((a) => a.action === "operational_exception.resolved"),
    ).toHaveLength(1);
    const again = await call<Loose>(env.api.app, "POST", path, {
      session: w.tech.session,
      headers: ifm(v + 1),
      body: { note: "Synthetic resolution again" },
    });
    expect([409, 422]).toContain(again.status);
    expect(again.body.code).toBe("operations.exception_resolved");
    // Resolved exceptions leave the default (open + acknowledged) list.
    const list = await exceptionsList(`organizationId=${w.orgId}&sourceKind=connector&limit=100`);
    expect((list.body.items as Loose[]).filter((e) => e.id === exceptionId)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the post-suite log scan

describe("A22 post-suite log scan (REQ-S16-029 'a log scan after the test suite finds no secrets or storage URLs')", () => {
  let dir = "";
  beforeAll(async () => {
    await stopWorker();
    dir = mkdtempSync(join(tmpdir(), "qa-a22-scan-"));
    cpSync(env.logDir, dir, { recursive: true });
    writeFileSync(join(dir, "worker.log"), allWorkerOutput());
  });

  it("the scan over this suite's API and worker logs, with the canaries set, passes (exit 0)", () => {
    expect(env.lines.length, "the suite wrote API lines").toBeGreaterThan(10);
    expect(allWorkerOutput()).toContain("mth-worker started");
    const r = logScan(["--require-canaries", "--storage-path", env.api.config.evidenceStorage.path, dir], {
      ...CANARY_ENV,
    });
    expect(r.output).toContain("log-scan: PASS");
    expect(r.status, r.output).toBe(0);
  });

  it("negative control: the same logs with one leaked canary fail (exit 1) and the scan never prints the value", () => {
    const bad = mkdtempSync(join(tmpdir(), "qa-a22-scan-bad-"));
    cpSync(dir, bad, { recursive: true });
    writeFileSync(
      join(bad, "leak.log"),
      `${JSON.stringify({ level: 30, time: 1, msg: "synthetic leak", token: CANARY.s3 })}\n`,
    );
    const r = logScan(["--require-canaries", bad], { ...CANARY_ENV });
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("leak.log:1");
    expect(r.output).not.toContain(CANARY.s3);
  });

  it("BLOCKED, never a pass: no canary with --require-canaries, or a docs/delivery path (exit 2)", () => {
    expect(logScan(["--require-canaries", dir], {}).status).toBe(2);
    expect(logScan([join(REPO_ROOT, "docs/delivery")], { ...CANARY_ENV }).status).toBe(2);
  });
});
