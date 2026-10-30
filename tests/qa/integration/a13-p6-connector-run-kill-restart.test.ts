// A13 "Durable automation" on the P6 jobs (T-DG6-QA-C; REQ-S20-013, REQ-DLV-038, REQ-S16-022 IntegrationRun): kill and
// restart the process that executes a connector run, DURING the run. Acceptance (master prompt §20 A13): "Retried
// events, worker restarts and partial failures do not duplicate approvals, measurements or notifications; failed jobs
// remain recoverable"; the assignment's reading for P6: the run resumes or fails cleanly, exactly once, with no
// partial data.
//
// Derived from docs/api/openapi.yaml (runConnector 202, getIntegrationRun; IntegrationRun counts are null = Unknown)
// and ADR-0055 §2 ("a crash between start and finish": a `running` run is taken over by the stale-run recovery;
// "Exactly once: ... A replay of the job creates nothing"). Per ADR-0055 §2 as built (apps/api integrations/runs.ts
// header), the due runs are executed by the API process's run watch, so the process killed here is the API
// composition (tests/qa/support/a13c-child-api.ts), the "worker" of a connector run.
//
// The drill, on this file's own scratch database:
//  1. an enabled test-adapter connector (healthy; a 3-row fixture in the shipped kpi_actual.v1 template, for a real
//     KPI and three reporting periods) targets a synthetic transformation; ADM_TECH queues a manual run;
//  2. the API process running the watch is SIGKILLed inside the transaction that stages the run's rows (the disclosed
//     blocking trigger on import_batch, tests/qa/support/a13c.ts);
//  3. then: the run is `running` with every count Unknown (null), and no staged batch or row exists (no partial data);
//  4. a new API process starts the watch again; once the run's start is older than the recovery threshold (120 s,
//     STALE_RUNNING_SECONDS: the contract's stated recovery, not shortened here) it takes the run over and finishes it:
//     the SAME run `succeeded`, exactly one staged batch with its 3 rows (3 valid), rows read = staged = 3, the
//     reconciliation `matched` on the row count and the decimal control total, no retry run and no second run.
// All data is SYNTHETIC. A run stages and never commits; nothing here approves anything real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchEnv, waitFor, type Body, type ScratchEnv } from "../support/a13-durable.ts";
import {
  holdBlockLock,
  installBlock,
  killHard,
  setBlock,
  spawnChild,
  stopChild,
  waitBlocked,
  type Child,
} from "../support/a13c.ts";
import { call, signIn, uniq, type Session } from "../support/api.ts";
import { KPI_ACTUAL_IMPORT_COLUMNS } from "../../../apps/api/src/modules/kpi/import-target.ts";
import {
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  seedKpiWorld,
  seedWorld,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

const L = "/api/v1/admin/connectors";
let env: ScratchEnv;
let w: World;
let k: KpiWorld;
let tech: Session;
let child: Child | null = null;
let connectorId: string;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13c_con");
  w = await seedWorld(env.api.db);
  k = await seedKpiWorld(env.api, w);
  tech = await signIn(env.api.app, w.admin.subject);
  await mapPartyTo(env.api, k, "BO", k.users.bo.id);
  const kpi = await ownedKpi(env.api, k, DIRECT_FLOW);
  // The source rows: every column of the shipped kpi_actual.v1 template (text cells; the empty optional ones as ""),
  // for a real KPI and three real reporting periods, so the staged rows are valid KPI actuals.
  const values = ["10.5", "11", "12.25"];
  const rows: Record<string, string>[] = [];
  for (const [i, value] of values.entries()) {
    const period = await monthlyPeriod(env.api, w);
    const r: Record<string, string> = Object.fromEntries(KPI_ACTUAL_IMPORT_COLUMNS.map((c) => [c.key, ""]));
    Object.assign(r, {
      source_record_id: `SYN-QA-${i + 1}`,
      kpi_id: kpi.id,
      scope_kind: "transformation",
      scope_id: k.transformationId,
      period_label: period.label,
      value,
      data_as_of: "2041-01-31",
    });
    rows.push(r);
  }
  const created = await call<Body>(env.api.app, "POST", L, {
    session: tech,
    body: {
      organizationId: w.orgA.id,
      code: uniq("qa-a13c-").toLowerCase(),
      nameEn: "Synthetic QA A13 connector",
      nameAr: "موصل اختبار اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: "synthetic.kpi-source:qa-a13c",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: k.transformationId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "row_count_and_total",
        adapterSettings: { mode: "healthy", fixture: { rows, controlColumn: "value" } },
        reason: "Synthetic connector for the QA A13 kill-and-restart drill.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  connectorId = created.body.id as string;
  const enabled = await call<Body>(env.api.app, "POST", `${L}/${connectorId}/enable`, {
    session: tech,
    headers: { "if-match": String(created.headers["etag"]) },
    body: { reason: "Synthetic enable for the QA drill." },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  await installBlock(env.su, "con", "import_batch", "NEW.integration_run_id IS NOT NULL");
}, 180_000);

afterAll(async () => {
  await stopChild(child);
  await env?.close();
});

const runsOf = () =>
  env.api.db.selectFrom("integration_run").selectAll().where("connector_id", "=", connectorId).execute();
const batchesOf = (runId: string) =>
  env.api.db.selectFrom("import_batch").selectAll().where("integration_run_id", "=", runId).execute();
const importRowsOf = async (runId: string) =>
  Number(
    (
      await env.su.query(
        "SELECT count(*)::int AS n FROM import_row r JOIN import_batch b ON b.id = r.import_batch_id WHERE b.integration_run_id = $1",
        [runId],
      )
    ).rows[0].n,
  );
const childEnv = (name: string) => ({
  QA_CHILD_DB_URL: env.appUrl,
  QA_CHILD_APP_NAME: name,
  QA_CHILD_MODE: "watch",
  QA_CHILD_CONNECTORS: connectorId,
});

describe("A13 (REQ-S20-013): the process executing a connector run is killed mid-run and restarted", () => {
  it(
    "the killed run stages nothing and stays `running` with Unknown counts; the restarted watch finishes it once",
    { timeout: 330_000 },
    async () => {
      const queued = await call<Body>(env.api.app, "POST", `${L}/${connectorId}/runs`, { session: tech, body: {} });
      expect(queued.status, JSON.stringify(queued.body)).toBe(202);
      const runId = queued.body.id as string;

      const lock = await holdBlockLock(env.su);
      try {
        await setBlock(env.su, "con", true);
        child = await spawnChild("a13c-child-api.ts", childEnv("qa-a13c-con-api1"));
        await waitBlocked(env.su, child, "the API process blocked inside the run's staging transaction").catch(
          async (e) => {
            throw new Error(`${String(e)}\nruns: ${JSON.stringify(await runsOf())}`);
          },
        );
        await killHard(env.su, child);
        child = null;
      } finally {
        await setBlock(env.su, "con", false);
        await lock.release();
      }

      const mid = await call<Body>(env.api.app, "GET", `${L}/${connectorId}/runs/${runId}`, { session: tech });
      expect(mid.status, JSON.stringify(mid.body)).toBe(200);
      expect(mid.body.run.status, "the killed run is still running (not falsely succeeded)").toBe("running");
      for (const c of ["rowsRead", "rowsStaged", "rowsCommitted", "rowsRejected", "rowsDuplicate"])
        expect(mid.body.run[c], `${c} is Unknown (null), never 0`).toBeNull();
      expect(await batchesOf(runId), "no staged batch from the killed attempt").toEqual([]);
      expect(await importRowsOf(runId), "no staged row from the killed attempt").toBe(0);

      // Restart: a new API process with the run watch. The recovery takes the run over once it is stale.
      child = await spawnChild("a13c-child-api.ts", childEnv("qa-a13c-con-api2"));
      await waitFor(
        async () => {
          const r = await runsOf();
          return r.find((x) => x.id === runId && ["succeeded", "failed", "cancelled"].includes(x.status));
        },
        "the restarted watch finishes the run",
        240_000,
      ).catch(async (e) => {
        throw new Error(`${String(e)}\n${JSON.stringify(await runsOf())}\nchild:\n${child?.output()}`);
      });

      const after = await call<Body>(env.api.app, "GET", `${L}/${connectorId}/runs/${runId}`, { session: tech });
      expect(after.status).toBe(200);
      expect(after.body.run.status, JSON.stringify(after.body.run)).toBe("succeeded");
      expect([after.body.run.rowsRead, after.body.run.rowsStaged], "3 read, 3 staged, once").toEqual([3, 3]);
      expect(after.body.run.rowsCommitted, "a run never commits (Unknown until a commit)").toBeNull();
      const all = await runsOf();
      expect(
        all.map((r) => r.id),
        "no second run and no retry run for the connector",
      ).toEqual([runId]);
      const batches = await batchesOf(runId);
      expect(batches, "exactly one staged batch").toHaveLength(1);
      expect(batches[0]!.status).toBe("staged");
      expect([batches[0]!.rows_total, batches[0]!.rows_valid]).toEqual([3, 3]);
      expect(await importRowsOf(runId), "exactly the 3 fixture rows, none twice").toBe(3);
      expect(after.body.run.reconciliation, JSON.stringify(after.body.run.reconciliation)).toMatchObject({
        status: "matched",
        sourceRowCount: 3,
      });
      // Decimal strings, never floats: 10.5 + 11 + 12.25 = 33.75 (trailing zeros of the scale are not significant).
      const dec = (t: string) => t.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      expect(dec(after.body.run.reconciliation.sourceControlTotal)).toBe("33.75");
      expect(dec(after.body.run.reconciliation.stagedControlTotal)).toBe("33.75");
    },
  );
});
