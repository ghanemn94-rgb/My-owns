#!/usr/bin/env node
// CI e2e stack (ADR-0012; .github/workflows/ci.yml job `e2e`): starts the BUILT app against the CI PostgreSQL service
// and leaves the API running in the background for `pnpm e2e`.
//   1. connects with TEST_DATABASE_ADMIN_URL (a superuser of the disposable CI service container);
//   2. creates roles mth_owner/mth_app (NOLOGIN; reached through the `role` startup option, so no password is created)
//      and a fresh database owned by mth_owner;
//   3. `mth-db migrate` (owner role), `mth-db seed-dev` (SYNTHETIC dev-login users; test only);
//   4. starts the API with NODE_ENV=test and AUTH_MODE=dev on :3000 (detached; log in $E2E_API_LOG), waits for /readyz.
// Uses `pg` from packages/db (the Playwright container has no psql). Prerequisite: `pnpm -r build`.
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pg = createRequire(join(root, "packages", "db", "package.json"))("pg");
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("BLOCKED: TEST_DATABASE_ADMIN_URL is not set");
  process.exit(3);
}
const port = process.env.E2E_API_PORT ?? "3000";
const database = process.env.E2E_DATABASE ?? "mth_e2e";

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
for (const role of ["mth_owner", "mth_app"]) {
  const { rowCount } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (rowCount === 0) await admin.query(`CREATE ROLE ${role} NOLOGIN`);
}
await admin.query(`DROP DATABASE IF EXISTS ${database}`);
// Explicitly UTF8 (ADR-0003 "Database encoding"; T-DG2-BE9), independent of the service cluster's initdb locale.
await admin.query(
  `CREATE DATABASE ${database} OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
);
await admin.end();

const roleUrl = (role) => {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  u.searchParams.set("options", `-c role=${role}`);
  return u.toString();
};
const env = {
  ...process.env,
  NODE_ENV: "test",
  AUTH_MODE: "dev",
  PORT: port,
  APP_BASE_URL: `http://localhost:${port}`,
  DATABASE_OWNER_URL: roleUrl("mth_owner"),
  DATABASE_URL: roleUrl("mth_app"),
  LOG_LEVEL: "warn",
  // The journeys sign in many times per minute; production defaults are unchanged.
  AUTH_RATE_LIMIT_PER_MINUTE: "1000",
  RATE_LIMIT_PER_MINUTE: "10000",
};
for (const cmd of ["migrate", "seed-dev"]) {
  const r = spawnSync("node", [join(root, "packages/db/dist/cli.js"), cmd], { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const log = process.env.E2E_API_LOG ?? join(root, "test-results", "e2e-api.log");
spawnSync("mkdir", ["-p", dirname(log)]);
const fd = openSync(log, "a");
const api = spawn("node", [join(root, "apps/api/dist/main.js")], { env, detached: true, stdio: ["ignore", fd, fd] });
api.unref();

const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/readyz`);
    if (r.ok) {
      console.log(`e2e stack ready: API pid ${api.pid} on :${port}, database ${database}; ${await r.text()}`);
      process.exit(0);
    }
  } catch {
    /* not listening yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.error(`API not ready within 60 s; see ${log}`);
process.exit(1);
