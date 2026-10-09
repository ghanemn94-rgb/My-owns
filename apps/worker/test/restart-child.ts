// Child worker process for the kill-and-restart test (REQ-S16-005 A13; T-DG4-BE-A). Started by
// test/integration/restart.test.ts with `node --conditions=@mth/source`; it runs the real startWorker with the probe
// handler, which hangs inside its transaction and prints IN_JOB, so the parent can SIGKILL it mid-job.
import { createDb, createPool } from "@mth/db";
import { createBoss } from "../src/queues/index.ts";
import { startWorker } from "../src/worker.ts";
import { probeHandler } from "./restart-probe.ts";

const url = process.env["CHILD_DB_URL"];
if (!url) throw new Error("CHILD_DB_URL is required");
const db = createDb(createPool(url, { max: 3, applicationName: "restart-child-db" }));
const boss = createBoss(url, { schedule: false, supervise: false, applicationName: "restart-child-boss" });
boss.on("error", () => undefined);
await boss.start();
await startWorker({
  db,
  boss,
  timeZone: "Asia/Riyadh",
  jobPollingIntervalSeconds: 0.5,
  pollIntervalMs: 200,
  log: { info: () => undefined, error: (o, m) => console.error(m, JSON.stringify(o)) },
  handlers: [
    probeHandler({
      hang: async () => {
        process.stdout.write("IN_JOB\n");
        await new Promise(() => undefined); // never returns: the parent kills this process here
      },
    }),
  ],
});
process.stdout.write("READY\n");
