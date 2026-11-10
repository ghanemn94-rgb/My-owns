// qa-verifier (T-DG6-QA-C): the PRODUCTION worker (startWorker with every registered domain handler, the outbox relay,
// the run-now dispatcher and the failure capture) in its own OS process, so the A13 P6 drills can SIGKILL it during a
// channel send or a search reindex. As apps/worker/src/main.ts does outside production, the channel sends are
// configured with `refuseInsecure: false` (the drills' local SMTP double speaks plain SMTP on 127.0.0.1). The cron
// schedules are not started (`schedule: false`): the drills start jobs through the API's runJobNow, as an
// administrator would. It adds no handler of its own. Prints READY when the worker runs.
import { createDb, createPool } from "../../../packages/db/src/index.ts";
import { createBoss, startWorker } from "../../../apps/worker/src/index.ts";
import { configureNotificationChannels } from "../../../apps/worker/src/handlers/notifications.ts";

const url = process.env["QA_CHILD_DB_URL"];
if (!url) throw new Error("QA_CHILD_DB_URL is required");
const appName = process.env["QA_CHILD_APP_NAME"] ?? "qa-a13c-child-worker";
const policy = JSON.parse(process.env["QA_CHILD_POLICY"] ?? "{}") as Record<string, number | boolean>;
configureNotificationChannels({ refuseInsecure: false, appBaseUrl: new URL("https://hub.example.invalid") });
const db = createDb(createPool(url, { max: 4, applicationName: appName }));
const boss = createBoss(url, {
  schedule: false,
  supervise: true,
  superviseIntervalSeconds: 1,
  monitorIntervalSeconds: 1,
  applicationName: appName,
});
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
