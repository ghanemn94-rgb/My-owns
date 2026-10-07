// API process entry point: `node dist/main.js` (package.json "start"). Loads and validates configuration (exits
// non-zero with a clear message on any problem, including AUTH_MODE=dev with NODE_ENV=production), connects as the
// app role (mth_app), builds the server and listens. SIGTERM/SIGINT close the server and the pool gracefully.
// T-DG2-BE16 shutdown policy (docs/operations/health-readiness.md "Shutdown"): app.close() stops accepting, closes idle
// keep-alive connections at once, gives in-flight requests DEFAULT_SHUTDOWN_GRACE_MS (5 s) and then destroys what is
// left (platform/connection-hygiene.ts). A backstop exits non-zero if the close still has not finished 5 s later.
import { ConfigError, loadConfig } from "@mth/config";
import { createPool } from "@mth/db";
import { DEFAULT_SHUTDOWN_GRACE_MS } from "./modules/platform/index.ts";
import { buildServer } from "./server.ts";

const SHUTDOWN_BACKSTOP_MS = DEFAULT_SHUTDOWN_GRACE_MS + 5_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig("api");
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }
  const pool = createPool(config.databaseUrl!, { applicationName: "mth-api", max: 20 });
  const { app, db } = await buildServer({ config, pool });
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    setTimeout(() => {
      app.log.error({ signal, backstopMs: SHUTDOWN_BACKSTOP_MS }, "shutdown did not finish in time; exiting");
      process.exit(1);
    }, SHUTDOWN_BACKSTOP_MS).unref();
    await app.close();
    await db.destroy();
    app.log.info({ signal }, "shut down");
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info({ authMode: config.authMode, oidc: config.oidc !== null }, "mth-api listening");
}

main().catch((err: unknown) => {
  console.error("mth-api failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
