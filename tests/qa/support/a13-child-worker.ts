// qa-verifier (T-DG5-QA-F): the PRODUCTION worker (startWorker with every registered domain handler, the outbox relay
// and the failure capture) in its own OS process, so the A13 suite can SIGKILL it mid-job. Started by
// tests/qa/support/a13-durable.ts with `node --conditions=@mth/source`. It adds no handler of its own.
import { createDb, createPool } from "../../../packages/db/src/index.ts";
import { createBoss, startWorker } from "../../../apps/worker/src/index.ts";

const url = process.env["QA_CHILD_DB_URL"];
if (!url) throw new Error("QA_CHILD_DB_URL is required");
const policy = JSON.parse(process.env["QA_CHILD_POLICY"] ?? "{}") as Record<string, number | boolean>;
const db = createDb(createPool(url, { max: 4, applicationName: "qa-a13-child-worker" }));
const boss = createBoss(url, { schedule: false, supervise: false, applicationName: "qa-a13-child-worker" });
boss.on("error", () => undefined);
await boss.start();
await startWorker({
  db,
  boss,
  timeZone: "Asia/Riyadh",
  pollIntervalMs: 100,
  jobPollingIntervalSeconds: 0.5,
  queuePolicy: policy,
  log: { info: () => undefined, error: (o, m) => console.error(m, JSON.stringify(o)) },
});
process.stdout.write("READY\n");
