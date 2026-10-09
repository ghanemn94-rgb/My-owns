// Child worker process for the kpi.reporting_period_open kill-and-restart test (T-DG4-KBE-R1 item 4; REQ-S12-005;
// ADR-0025 §3-§4). Started by test/integration/kpi-period-open-restart.test.ts with `node --conditions=@mth/source`.
// It runs the production startWorker with the REAL period-open handler (handlers/kpi.ts openDuePeriods), unchanged; the
// parent makes it block partway through the job with a database lock and then SIGKILLs it. All data is SYNTHETIC.
import { createDb, createPool } from "@mth/db";
import { KPI_HANDLERS, PERIOD_OPEN_QUEUE } from "../src/handlers/kpi.ts";
import { createBoss } from "../src/queues/index.ts";
import { startWorker } from "../src/worker.ts";

const CHILD_DB_APPLICATION = "kpi-open-child-db";

const url = process.env["CHILD_DB_URL"];
if (!url) throw new Error("CHILD_DB_URL is required");
const db = createDb(createPool(url, { max: 3, applicationName: CHILD_DB_APPLICATION }));
const boss = createBoss(url, { schedule: false, supervise: false, applicationName: "kpi-open-child-boss" });
boss.on("error", () => undefined);
await boss.start();
await startWorker({
  db,
  boss,
  timeZone: "Asia/Riyadh",
  jobPollingIntervalSeconds: 0.5,
  pollIntervalMs: 200,
  log: { info: () => undefined, error: (o, m) => console.error(m, JSON.stringify(o)) },
  handlers: KPI_HANDLERS.filter((h) => h.queue === PERIOD_OPEN_QUEUE),
});
process.stdout.write("READY\n");
