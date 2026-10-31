// Worker process entry point: `node dist/main.js`. A separate OS process from the API that shares only PostgreSQL
// (ADR-0002). Connects as mth_app; pg-boss starts with migrate=false and refuses to run on a missing/outdated schema.
import { readFileSync } from "node:fs";
import {
  ConfigError,
  installConnectionLog,
  installConsoleRedaction,
  loadConfig,
  withSecretRedaction,
} from "@mth/config";
import { createDb, createPool } from "@mth/db";
import { createBoss } from "./queues/index.ts";
import { startWorker } from "./worker.ts";
// T-DG6-DO-D (ADR-0053 §6): the worker_heartbeat writer and the queue count it reports.
import { DOMAIN_HANDLERS } from "./handlers/index.ts";
import { configureNotificationChannels } from "./handlers/notifications.ts"; // T-DG6-BE-I2
import { startHeartbeat } from "./heartbeat.ts";
import { FAILURE_RETRY_QUEUE } from "./kit.ts";
import { RUN_NOW_QUEUE } from "./job-runs.ts";
import { QUEUES } from "./queues/index.ts";
// D-198 (ADR-0052 §5; T-DG6-BE-J): the worker's SecretProvider registry, the twin of the API's.
import { createSecretProviderRegistry, registerBuiltInSecretProviders } from "./secrets.ts";

// ADR-0053 §4 (T-DG6-DO-D): the worker logs through console; every console line passes the process-wide redaction set
// (configuration secrets, SecretProvider values, storage keys, URLs and paths, tokens) before it is written. Installed
// first, so even a start-up failure line is redacted.
installConsoleRedaction();
// T-DG6-BE-X3 (QA-D-1; ADR-0059 §12 "one call each in apps/api/src/server.ts and apps/worker/src/main.ts"): the A21
// connection log of the worker process, a test instrument. With MTH_CONNECTION_LOG naming a file (and NODE_ENV not
// production: then one warning and nothing written) every outbound connection attempt of this process, from the first
// database connection on, appends one line {at, process: "worker", channel, host, address, port}; unset, it is a no-op.
installConnectionLog("worker");

/** The worker's version (its package.json, one level above both src/ and dist/). */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** The queues this process serves (fixed queues, domain handlers, the retry and run-now dispatchers). */
function queueCount(): number {
  return new Set<string>([
    ...Object.values(QUEUES),
    ...DOMAIN_HANDLERS.map((h) => h.queue),
    FAILURE_RETRY_QUEUE,
    RUN_NOW_QUEUE,
  ]).size;
}

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
  // D-198 (ADR-0052 §5): the built-in providers (env, file). The notification channel sends resolve SMTP
  // credential references through it (T-DG6-BE-I2); a value is never logged, only the provider ids.
  // ADR-0053 §4 item 1 (T-DG6-DO-D): every value a registered provider resolves joins the log redaction set.
  const secrets = withSecretRedaction(createSecretProviderRegistry());
  registerBuiltInSecretProviders(secrets, { secretsDir: config.secretsDir });
  // T-DG6-BE-I2 (ADR-0054 §3): the channel sends resolve credential references through this registry (so a resolved
  // value joins the redaction set), link to APP_BASE_URL when set, and refuse unencrypted SMTP in production.
  configureNotificationChannels({
    resolveSecret: (ref) => secrets.resolve(ref),
    appBaseUrl: config.appBaseUrl,
    refuseInsecure: config.nodeEnv === "production",
  });
  const pool = createPool(config.databaseUrl!, { applicationName: "mth-worker", max: 5 });
  const db = createDb(pool);
  // F-DG4-128: the supervision cadence is always explicit (WORKER_SUPERVISE_INTERVAL_SECONDS, default 60 s, 1-600).
  const boss = createBoss(config.databaseUrl!, { superviseIntervalSeconds: config.worker.superviseIntervalSeconds });
  let stopping = false;
  // After shutdown begins, pg-boss's in-flight maintenance ticks can fail against its closed pool; that is not an error.
  boss.on("error", (err) => {
    if (!stopping) console.error(JSON.stringify({ level: "error", msg: "pg-boss error", err: err.message }));
  });
  await boss.start();
  const worker = await startWorker({ db, boss, timeZone: config.defaultTimezone });
  // ADR-0053 §6 (T-DG6-DO-D): one worker_heartbeat row per process, moved forward every WORKER_HEARTBEAT_SECONDS.
  const heartbeat = startHeartbeat({
    db,
    intervalSeconds: config.worker.heartbeatSeconds,
    appVersion: appVersion(),
    queueCount: queueCount(),
  });
  console.log(
    JSON.stringify({
      level: "info",
      msg: "mth-worker started",
      timeZone: config.defaultTimezone,
      superviseIntervalSeconds: config.worker.superviseIntervalSeconds,
      heartbeatSeconds: config.worker.heartbeatSeconds,
      instanceKey: heartbeat.instanceKey,
      secretProviders: secrets.ids(),
    }),
  );

  const shutdown = async (signal: string) => {
    stopping = true;
    console.log(JSON.stringify({ level: "info", msg: "mth-worker shutting down", signal }));
    await heartbeat.stop();
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
