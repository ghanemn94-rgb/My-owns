#!/usr/bin/env node
'use strict';
/**
 * Entrypoint of the API container image (ADR-0001: one image, several commands).
 *
 *   api                 HTTP API (dist/main.js) on $PORT (default 4000)
 *   worker              outbox dispatch, schedules and durable jobs (dist/worker.js)
 *   migrate             SQL migrations + post-migrate SQL (RLS, grants, triggers) with DATABASE_MIGRATION_URL
 *                       (OWNER role). Run as a Kubernetes Job / Helm hook, never inside the API pods.
 *   bootstrap           PRODUCTION bootstrap (apps/api/src/cli/bootstrap.ts): migrations, organization, templates,
 *                       platform schedules, optional first administrator bound to an IdP identity. No passwords.
 *   seed-demo           DEMO sandbox seed. Refused by the seed itself when NODE_ENV=production or HUB_MODE!=demo.
 *   openapi [file]      write the OpenAPI 3.1 document (default /tmp/openapi.json)
 *   healthcheck [role]  container health probe; role = api | worker (auto-detected from PID 1 when omitted)
 *
 * api/worker/migrate run IN-PROCESS so SIGTERM from the orchestrator reaches the application directly (no shell,
 * no wrapper process). The image contains no shell-dependent logic; this file needs only Node.js.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const log = (m) => process.stdout.write(`[hub-entrypoint] ${m}\n`);
const fail = (m, code = 2) => {
  process.stderr.write(`[hub-entrypoint] ERROR: ${m}\n`);
  process.exit(code);
};

/** Container layout: /app/{dist,node_modules,hub-entrypoint.cjs}. Repository layout: deploy/docker → apps/api. */
function appRoot() {
  if (process.env.HUB_APP_ROOT) return path.resolve(process.env.HUB_APP_ROOT);
  if (fs.existsSync(path.join(__dirname, 'dist', 'main.js'))) return __dirname;
  return path.resolve(__dirname, '..', '..', 'apps', 'api');
}

function requireFromApp(root, id) {
  return require(require.resolve(id, { paths: [root] }));
}

/** Never print credentials: postgres://user:secret@host/db → postgres://user:***@host/db */
function redact(url) {
  return String(url).replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}

async function migrate(root) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) fail('DATABASE_MIGRATION_URL (owner role connection) is required for "migrate"');
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    fail('DATABASE_MIGRATION_URL must not equal DATABASE_URL (owner and runtime roles are separate)');
  }
  if (process.env.NODE_ENV === 'production' && /hub_dev_only/.test(url)) fail('development password used in production');
  const runtimeRole = process.env.HUB_DB_RUNTIME_ROLE || 'hub_app';
  log(`applying migrations to ${redact(url)} (runtime role: ${runtimeRole})`);
  const { Pool } = requireFromApp(root, 'pg');
  // Pre-flight: the runtime role must exist and must not bypass RLS, otherwise post-migrate grants are skipped or
  // row-level security is ineffective (ADR-0003).
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const r = await pool.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [runtimeRole]);
    if (r.rowCount === 0) fail(`runtime role "${runtimeRole}" does not exist; the DBA must create it before migrating`);
    if (r.rows[0].rolsuper || r.rows[0].rolbypassrls) fail(`runtime role "${runtimeRole}" must be NOSUPERUSER NOBYPASSRLS`);
    const me = await pool.query('select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as b');
    if (me.rows[0].u === runtimeRole) fail('DATABASE_MIGRATION_URL connects as the runtime role; use the owner role');
  } finally {
    await pool.end();
  }
  const { runMigrations } = requireFromApp(root, '@hub/db');
  await runMigrations(url, (m) => log(m));
  log('migrate: done');
}

function detectRole() {
  try {
    const argv = fs.readFileSync('/proc/1/cmdline', 'utf8').split('\0');
    if (argv.includes('worker')) return 'worker';
    if (argv.includes('api')) return 'api';
    if (argv.includes('migrate')) return 'migrate';
  } catch {
    /* not in a container or /proc unavailable */
  }
  return 'api';
}

function httpOk(port, pathName, timeoutMs) {
  return new Promise((resolve) => {
    // Dedicated agent: never routed through HTTP(S)_PROXY, even with NODE_USE_ENV_PROXY=1.
    const req = http.get({ host: '127.0.0.1', port, path: pathName, agent: new http.Agent({ keepAlive: false }), timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function healthcheck(root, role) {
  const r = role || detectRole();
  if (r === 'api') {
    const ok = await httpOk(Number(process.env.PORT || 4000), '/healthz', 3000);
    process.exit(ok ? 0 : 1);
  }
  if (r === 'worker') {
    // Preferred: heartbeat file written by the worker loop (proposed; see docs/deployment/operations.md).
    const hb = process.env.HUB_WORKER_HEARTBEAT_FILE;
    if (hb && fs.existsSync(hb)) {
      const ageMs = Date.now() - fs.statSync(hb).mtimeMs;
      const maxMs = Number(process.env.HUB_WORKER_HEARTBEAT_MAX_AGE_MS || 120000);
      process.exit(ageMs <= maxMs ? 0 : 1);
    }
    // Fallback: the worker's only hard dependency is PostgreSQL.
    const { Client } = requireFromApp(root, 'pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    try {
      await c.connect();
      await c.query('select 1');
      await c.end();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }
  process.exit(0); // one-shot commands (migrate, seed) have no long-running health
}

/**
 * Orchestrators and compose files pass optional settings as EMPTY strings (`HUB_OIDC_ISSUER: ${HUB_OIDC_ISSUER:-}`),
 * while the application reads an unset variable as "not configured" and validates a set one (an empty issuer is an
 * invalid URL and would stop the API from booting). Here an empty HUB_* value means "unset" — it never means anything
 * else — so it is removed before the application starts. Non-empty values are passed through unchanged.
 */
function dropEmptyHubSettings(env = process.env) {
  for (const k of Object.keys(env)) if (k.startsWith('HUB_') && env[k] === '') delete env[k];
}

async function main() {
  const [cmd = 'api', ...rest] = process.argv.slice(2);
  dropEmptyHubSettings();
  const root = appRoot();
  switch (cmd) {
    case 'api':
      require(path.join(root, 'dist', 'main.js'));
      return;
    case 'worker':
      require(path.join(root, 'dist', 'worker.js'));
      return;
    case 'migrate':
      await migrate(root);
      return;
    case 'bootstrap': {
      if (!process.env.DATABASE_MIGRATION_URL) fail('DATABASE_MIGRATION_URL (owner role) is required for bootstrap');
      const { bootstrap } = require(path.join(root, 'dist', 'cli', 'bootstrap.js'));
      await bootstrap(process.env, (m) => log(m));
      return;
    }
    case 'seed-demo': {
      const url = process.env.DATABASE_MIGRATION_URL;
      if (!url) fail('DATABASE_MIGRATION_URL (owner role) is required for seed-demo');
      const { seedDemo } = require(path.join(root, 'dist', 'cli', 'seed-demo.js'));
      await seedDemo({ ownerUrl: url });
      return;
    }
    case 'openapi': {
      const { spawnSync } = require('node:child_process');
      const out = rest[0] || '/tmp/openapi.json';
      const r = spawnSync(process.execPath, [path.join(root, 'dist', 'cli', 'openapi.js'), out], { stdio: 'inherit' });
      process.exit(r.status ?? 1);
      return;
    }
    case 'healthcheck':
      await healthcheck(root, rest[0]);
      return;
    case '--help':
    case 'help':
      process.stdout.write('usage: hub-entrypoint api | worker | migrate | bootstrap | seed-demo | openapi [file] | healthcheck [api|worker]\n');
      return;
    default:
      fail(`unknown command "${cmd}" (expected api | worker | migrate | bootstrap | seed-demo | openapi | healthcheck)`);
  }
}

main().catch((e) => {
  const c = e && e.cause;
  fail(`${e instanceof Error ? e.message : String(e)}${c && c.message ? ` (cause: ${c.message})` : ''}`, 1);
});
