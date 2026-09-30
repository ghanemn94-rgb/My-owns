// API process entry point: `node dist/main.js` (package.json "start"). Loads and validates configuration (exits
// non-zero with a clear message on any problem, including AUTH_MODE=dev with NODE_ENV=production), connects as the
// app role (mth_app), builds the server and listens. SIGTERM/SIGINT close the server and the pool gracefully.
import { ConfigError, loadConfig } from "@mth/config";
import { createPool } from "@mth/db";
import { buildServer } from "./server.ts";

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
    await app.close();
    await db.destroy();
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
