// Worker process entry point: `node dist/main.js`. A separate OS process from the API that shares only PostgreSQL
// (ADR-0002). Connects as mth_app; pg-boss starts with migrate=false and refuses to run on a missing/outdated schema.
import { ConfigError, loadConfig } from "@mth/config";
import { createDb, createPool } from "@mth/db";
import { createBoss } from "./queues.ts";
import { startWorker } from "./worker.ts";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig("worker");
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(78);
    }
    throw err;
  }
  const pool = createPool(config.databaseUrl!, { applicationName: "mth-worker", max: 5 });
  const db = createDb(pool);
  const boss = createBoss(config.databaseUrl!);
  let stopping = false;
  // After shutdown begins, pg-boss's in-flight maintenance ticks can fail against its closed pool; that is not an error.
  boss.on("error", (err) => {
    if (!stopping) console.error(JSON.stringify({ level: "error", msg: "pg-boss error", err: err.message }));
  });
  await boss.start();
  const worker = await startWorker({ db, boss, timeZone: config.defaultTimezone });
  console.log(JSON.stringify({ level: "info", msg: "mth-worker started", timeZone: config.defaultTimezone }));

  const shutdown = async (signal: string) => {
    stopping = true;
    console.log(JSON.stringify({ level: "info", msg: "mth-worker shutting down", signal }));
    await worker.stop();
    await boss.stop({ graceful: true, wait: true, timeout: 20_000 });
    await db.destroy();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("mth-worker failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
