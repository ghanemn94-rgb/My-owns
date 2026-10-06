// GET /healthz (liveness: no dependency checks) and GET /readyz (database reachable AND UTF8 AND every migration
// shipped with this build applied with the same checksum). ADR-0007 §1, REQ-S19-010; encoding: ADR-0003, T-DG2-BE9.
//
// Encoding: a non-UTF8 database (e.g. SQL_ASCII, where char_length counts bytes) reports `database: fail`, since the
// contract's Readiness schema has no separate encoding check. The encoding of a database is fixed at CREATE DATABASE,
// so a UTF8 answer is cached for the life of the route (one `SHOW server_encoding` per process); a non-UTF8 answer is
// not cached, so a corrected database is picked up without a restart.
import {
  listMigrationFiles,
  migrationStatus,
  readServerEncoding,
  REQUIRED_SERVER_ENCODING,
  type MigrationFile,
} from "@mth/db";
import type { FastifyInstance } from "fastify";
import type pg from "pg";

export function registerHealthRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  files: readonly MigrationFile[] = listMigrationFiles(),
): void {
  app.get("/healthz", { config: { access: { public: true } } }, async () => ({ status: "ok" as const }));

  let encodingVerified = false;
  app.get("/readyz", { config: { access: { public: true } } }, async (request, reply) => {
    let database: "ok" | "fail" = "fail";
    let migrations: "ok" | "pending" | "fail" = "fail";
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        if (!encodingVerified) {
          const found = await readServerEncoding(client);
          if (found === REQUIRED_SERVER_ENCODING) encodingVerified = true;
          else
            request.log.error(
              { serverEncoding: found },
              `readiness: the database must use ${REQUIRED_SERVER_ENCODING} encoding (found ${found})`,
            );
        }
        // A non-UTF8 database stays `database: fail` (and migrations unchecked, i.e. fail).
        if (encodingVerified) {
          database = "ok";
          const s = await migrationStatus(client, files);
          migrations = s.upToDate
            ? "ok"
            : s.checksumMismatches.length > 0 || s.unknownApplied.length > 0
              ? "fail"
              : "pending";
        }
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
