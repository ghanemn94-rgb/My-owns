// A13 "Durable automation" on the P6 jobs (T-DG6-QA-C; REQ-S20-013, REQ-DLV-038): kill the API process DURING an
// import commit and restart it. Acceptance (master prompt §20 A13): "Retried events, worker restarts and partial
// failures do not duplicate approvals, measurements or notifications; failed jobs remain recoverable"; the
// assignment's reading for P6: the commit resumes or fails cleanly, exactly once, with no partial data.
//
// Derived from docs/api/openapi.yaml (createImport 201 staged; commitImport with If-Match; the batch's rowsCommitted
// null = Unknown) and ADR-0056 §6 ("In one transaction, for each valid row ... the batch becomes committed"; a commit
// of a batch that is not staged is refused). A commit is a request, so the process killed here is the API composition
// (tests/qa/support/a13c-child-api.ts) that executes it.
//
// The drill, on this file's own scratch database:
//  1. a KDS stages a 3-row CSV of KPI actuals (shipped template kpi_actual.v1) for a real KPI and three periods;
//  2. a separate API process starts the commit and is SIGKILLed inside its transaction, after the first KPI actual was
//     written in it (the disclosed blocking trigger on import_row_commit, tests/qa/support/a13c.ts);
//  3. then: the batch is still `staged` at its version with rowsCommitted Unknown, no lineage row, no KPI actual of
//     the KPI and every row still waiting (no partial commit, no measurement);
//  4. a new API process retries the SAME request (same If-Match): 200 `committed`, 3 lineage rows, 3 KPI actuals, once;
//  5. a replay of the commit is refused (409) and writes nothing: still 3 lineage rows and 3 actuals.
// All data is SYNTHETIC. A commit submits KPI actuals through the DG4 path and approves nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KPI_ACTUAL_IMPORT_COLUMNS } from "../../../apps/api/src/modules/kpi/import-target.ts";
import { scratchEnv, type Body, type ScratchEnv } from "../support/a13-durable.ts";
import {
  holdBlockLock,
  installBlock,
  killHard,
  setBlock,
  spawnChild,
  stopChild,
  waitBlocked,
  waitFor,
  type Child,
} from "../support/a13c.ts";
import { call, type Session } from "../support/api.ts";
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

let env: ScratchEnv;
let w: World;
let k: KpiWorld;
let kds: Session;
let kpiId: string;
let child: Child | null = null;
const csvRows: Record<string, string>[] = [];

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13c_imp");
  w = await seedWorld(env.api.db);
  k = await seedKpiWorld(env.api, w);
  kds = k.s.kds;
  await mapPartyTo(env.api, k, "BO", k.users.bo.id);
  kpiId = (await ownedKpi(env.api, k, DIRECT_FLOW)).id;
  for (const [i, value] of ["5", "6.5", "7.125"].entries()) {
    const period = await monthlyPeriod(env.api, w);
    const r: Record<string, string> = Object.fromEntries(KPI_ACTUAL_IMPORT_COLUMNS.map((c) => [c.key, ""]));
    Object.assign(r, {
      source_record_id: `SYN-IMP-${i + 1}`,
      kpi_id: kpiId,
      scope_kind: "transformation",
      scope_id: k.transformationId,
      period_label: period.label,
      value,
      data_as_of: "2041-01-31",
    });
    csvRows.push(r);
  }
  await installBlock(env.su, "imp", "import_row_commit");
}, 180_000);

afterAll(async () => {
  await stopChild(child);
  await env?.close();
});

const header = KPI_ACTUAL_IMPORT_COLUMNS.map((c) => c.key);
const csv = () =>
  Buffer.from([header.join(","), ...csvRows.map((r) => header.map((h) => r[h] ?? "").join(","))].join("\r\n") + "\r\n");
const imports = () => `${k.base}/imports`;
const count = async (q: string, args: unknown[]) => Number((await env.su.query(q, args)).rows[0].n);
const lineage = (batchId: string) =>
  count("SELECT count(*)::int AS n FROM import_row_commit WHERE import_batch_id = $1", [batchId]);
const actuals = () => count("SELECT count(*)::int AS n FROM kpi_actual WHERE kpi_definition_id = $1", [kpiId]);
const childCommit = (name: string, batchId: string, version: number) =>
  spawnChild("a13c-child-api.ts", {
    QA_CHILD_DB_URL: env.appUrl,
    QA_CHILD_APP_NAME: name,
    QA_CHILD_MODE: "request",
    QA_CHILD_METHOD: "POST",
    QA_CHILD_URL: `${imports()}/${batchId}/commit`,
    QA_CHILD_COOKIE: kds.cookie,
    QA_CHILD_CSRF: kds.csrf,
    QA_CHILD_HEADERS: JSON.stringify({ "if-match": `"${version}"` }),
    QA_CHILD_BODY: JSON.stringify({ note: null }),
  });
const responseOf = (c: Child) => {
  const m = /RESPONSE (\d{3}) (.*)/.exec(c.output());
  return m ? { status: Number(m[1]), body: JSON.parse(m[2]!) as Body } : null;
};

describe("A13 (REQ-S20-013): the API process is killed during an import commit and restarted", () => {
  it(
    "the killed commit leaves the batch staged with nothing written; the retried commit commits once; a replay is refused",
    { timeout: 240_000 },
    async () => {
      const staged = await call<Body>(env.api.app, "POST", `${imports()}?template=kpi_actual.v1`, {
        session: kds,
        headers: { "content-type": "text/csv", "x-file-name": "synthetic-qa-a13c.csv" },
        body: csv(),
      });
      expect(staged.status, JSON.stringify(staged.body)).toBe(201);
      expect([staged.body.status, staged.body.rowsTotal, staged.body.rowsValid]).toEqual(["staged", 3, 3]);
      const batchId = staged.body.id as string;
      const version = staged.body.version as number;
      expect(await actuals(), "no KPI actual before the commit").toBe(0);

      const lock = await holdBlockLock(env.su);
      try {
        await setBlock(env.su, "imp", true);
        child = await childCommit("qa-a13c-imp-api1", batchId, version);
        await waitBlocked(env.su, child, "the API process blocked inside the commit transaction");
        await killHard(env.su, child);
        expect(responseOf(child), "the killed process never answered").toBeNull();
        child = null;
      } finally {
        await setBlock(env.su, "imp", false);
        await lock.release();
      }

      const mid = await call<Body>(env.api.app, "GET", `${imports()}/${batchId}`, { session: kds });
      expect(mid.status).toBe(200);
      expect(
        [mid.body.status, mid.body.version, mid.body.rowsCommitted],
        "still staged, Unknown committed count",
      ).toEqual(["staged", version, null]);
      expect(await lineage(batchId), "no lineage from the killed commit").toBe(0);
      expect(await actuals(), "no KPI actual (measurement) from the killed commit").toBe(0);
      const rows = await call<Body>(env.api.app, "GET", `${imports()}/${batchId}/rows?limit=100`, { session: kds });
      expect(rows.status).toBe(200);
      expect(
        (rows.body.items as Body[]).map((r) => r.lineage),
        "no row carries lineage",
      ).toEqual([null, null, null]);

      // Restart: a new API process; the user retries the same commit with the same If-Match.
      child = await childCommit("qa-a13c-imp-api2", batchId, version);
      const res = await waitFor(async () => responseOf(child!), "the restarted process answers the commit", 90_000);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect([res.body.status, res.body.rowsCommitted]).toEqual(["committed", 3]);
      expect(await lineage(batchId), "exactly 3 lineage rows").toBe(3);
      expect(await actuals(), "exactly 3 KPI actuals: no duplicate measurement").toBe(3);

      // A replay of the commit is refused and writes nothing.
      const replay = await call<Body>(env.api.app, "POST", `${imports()}/${batchId}/commit`, {
        session: kds,
        headers: { "if-match": `"${res.body.version}"` },
        body: { note: null },
      });
      expect(replay.status, JSON.stringify(replay.body)).toBe(409);
      expect(replay.body.code).toBe("import.not_staged");
      expect(await lineage(batchId)).toBe(3);
      expect(await actuals()).toBe(3);
    },
  );
});
