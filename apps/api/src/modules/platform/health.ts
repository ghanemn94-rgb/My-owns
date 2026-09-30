// GET /healthz (liveness: no dependency checks) and GET /readyz (database reachable AND every migration shipped with
// this build applied with the same checksum). ADR-0007 §1, REQ-S19-010.
import { listMigrationFiles, migrationStatus, type MigrationFile } from "@mth/db";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

export function registerHealthRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  files: readonly MigrationFile[] = listMigrationFiles(),
): void {
  app.get("/healthz", { config: { access: { public: true } } }, async () => ({ status: "ok" as const }));

  app.get("/readyz", { config: { access: { public: true } } }, async (request, reply) => {
    let database: "ok" | "fail" = "fail";
    let migrations: "ok" | "pending" | "fail" = "fail";
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        database = "ok";
        const s = await migrationStatus(client, files);
        migrations = s.upToDate
          ? "ok"
          : s.checksumMismatches.length > 0 || s.unknownApplied.length > 0
            ? "fail"
            : "pending";
      } finally {
        client.release();
      }
    } catch (err) {
      request.log.warn({ err }, "readiness check failed");
    }
    const ready = database === "ok" && migrations === "ok";
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? "ready" : "not_ready", checks: { database, migrations } });
  });
}
