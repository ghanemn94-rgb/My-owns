#!/usr/bin/env node
// Mints one session per load virtual user for the load run (ADR-0058 §4; D-195 Q9; T-DG6-DO-E).
//
//   NODE_ENV=production MTH_ENV=load AUTH_MODE=oidc APP_BASE_URL=… DATABASE_URL=… OIDC_ISSUER_URL=… OIDC_CLIENT_ID=… \
//   OIDC_CLIENT_SECRET=…  node deploy/load/sessions.mjs [--duration-minutes 60] [--out "$TMPDIR/mth-load-sessions.json"]
//
// The SAME configuration as the API under test (loadConfig("api")): the cookie name follows APP_BASE_URL exactly as the
// API's does. It runs only when MTH_ENV=load (which needs NODE_ENV=production and AUTH_MODE=oidc, packages/config) and
// the database holds the load_dataset_marker row and no deployment_environment row; anything else is refused (exit 3)
// before any write. Each session is created through the API's own createSession (apps/api/src/modules/identity/
// sessions.ts, ADR-0005: the same random token, the same SHA-256 token and CSRF hashes; nothing re-implemented), with
// auth_mode 'oidc' and idp_issuer 'urn:mth:load-harness', so every load session is identifiable as synthetic. The
// absolute expiry is the run's duration plus one hour. No route is added and no login path is changed.
//
// The cookies and CSRF tokens are written ONLY to a file under the run's temporary directory ($TMPDIR), mode 0600,
// never into the repository and never to stdout. They are bearer credentials of synthetic users of a disposable load
// database; delete the file after the run.
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LOAD_ISSUER } from "./generate.mjs";

// The API's own modules: the BUILT ones when present (`pnpm -r build`; the mth-app image ships only these, mounted at
// /app/deploy/load), else the TypeScript sources through Node's type stripping (Node >= 22.18, the engines field).
// MTH_LOAD_MODULES=source forces the sources (the tests: a workspace's dist can lag its sources until the next build).
const root = new URL("../../", import.meta.url);
async function workspaceModule(dist, src) {
  const built = new URL(dist, root);
  const useBuilt = process.env.MTH_LOAD_MODULES !== "source" && existsSync(built);
  return import(useBuilt ? built.href : new URL(src, root).href);
}
const { ConfigError, loadConfig } = await workspaceModule(
  "packages/config/dist/index.js",
  "packages/config/src/index.ts",
);
const { createDb, createPool } = await workspaceModule("packages/db/dist/index.js", "packages/db/src/index.ts");
const { createSession, csrfTokenFor, sessionCookieName } = await workspaceModule(
  "apps/api/dist/modules/identity/sessions.js",
  "apps/api/src/modules/identity/sessions.ts",
);

/** The roles of the 100 load virtual users (ADR-0058 §2); the named owners and approvers hold SP or ADM_ACCESS. */
export const VIRTUAL_USER_ROLES = ["TL", "BO", "WL", "KDS", "FIN", "AUD"];
export const SESSIONS_REFUSED_ENV = "mth-load sessions: refused: MTH_ENV must be load (it is %s)";
export const SESSIONS_REFUSED_DB =
  "mth-load sessions: refused: the database must hold the load dataset marker and no production or demo marker";

/** The output path, which must lie inside the temporary directory (never the repository). */
export function sessionsOutPath(out, tmp = process.env.TMPDIR ?? tmpdir()) {
  const base = resolve(tmp);
  const path = resolve(out ?? join(base, "mth-load-sessions.json"));
  if (!path.startsWith(base + sep)) throw new Error(`--out must be inside the temporary directory ${base}`);
  return path;
}

/** Mints the sessions; returns the file's content (also written to `outPath`). */
export async function mintLoadSessions({ config, durationMinutes, outPath }) {
  const pool = createPool(config.databaseUrl, { max: 2, applicationName: "mth-load sessions" });
  const db = createDb(pool);
  try {
    const guard = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM load_dataset_marker) AS load, EXISTS (SELECT 1 FROM deployment_environment) AS marked`,
    );
    if (guard.rows[0]?.load !== true || guard.rows[0]?.marked !== false) {
      const e = new Error(SESSIONS_REFUSED_DB);
      e.exitCode = 3;
      throw e;
    }
    const users = (
      await pool.query(
        `SELECT u.id, i.subject, array_agg(DISTINCT r.code ORDER BY r.code) AS roles
           FROM app_user u
           JOIN user_identity i ON i.user_id = u.id AND i.issuer = $1
           JOIN scoped_assignment a ON a.user_id = u.id AND a.revoked_at IS NULL AND a.scope_type = 'transformation'
           JOIN role r ON r.id = a.role_id AND r.code = ANY($2::text[])
          WHERE u.status = 'active'
          GROUP BY u.id, i.subject
          ORDER BY i.subject`,
        [LOAD_ISSUER, VIRTUAL_USER_ROLES],
      )
    ).rows;
    const totalMinutes = durationMinutes + 60;
    const minted = await db.transaction().execute(async (tx) => {
      const out = [];
      for (const u of users) {
        const { sessionId, token } = await createSession(tx, {
          userId: u.id,
          authMode: "oidc",
          idpIssuer: LOAD_ISSUER,
          idpSessionId: null,
          userAgent: "mth-load-harness (synthetic)",
          idleMinutes: totalMinutes,
          absoluteHours: Math.ceil(totalMinutes / 60),
        });
        out.push({
          userId: u.id,
          subject: u.subject,
          roles: u.roles,
          sessionId,
          token,
          csrfToken: csrfTokenFor(token),
        });
      }
      return out;
    });
    const cookieName = sessionCookieName(config.appBaseUrl);
    const content = {
      note: "SYNTHETIC load-run sessions (mth_load_v1); bearer credentials of a disposable load database; delete after the run",
      appBaseUrl: config.appBaseUrl.origin,
      cookieName,
      issuer: LOAD_ISSUER,
      expiresAfterMinutes: Math.ceil(totalMinutes / 60) * 60,
      sessions: minted.map((s) => ({
        userId: s.userId,
        subject: s.subject,
        roles: s.roles,
        sessionId: s.sessionId,
        cookie: `${cookieName}=${s.token}`,
        csrfToken: s.csrfToken,
      })),
    };
    writeFileSync(outPath, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
    return content;
  } finally {
    await db.destroy();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { "duration-minutes": { type: "string", default: "60" }, out: { type: "string" } },
    strict: true,
  });
  const durationMinutes = Number(values["duration-minutes"]);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    console.error("mth-load sessions: --duration-minutes must be an integer 1-1440");
    return 64;
  }
  let config;
  try {
    config = loadConfig("api");
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 78;
    }
    throw err;
  }
  if (config.mthEnv !== "load") {
    console.error(SESSIONS_REFUSED_ENV.replace("%s", config.mthEnv));
    return 3;
  }
  const outPath = sessionsOutPath(values.out);
  const content = await mintLoadSessions({ config, durationMinutes, outPath });
  console.log(
    `mth-load sessions: ${content.sessions.length} synthetic load session(s) written to ${outPath} ` +
      `(cookie ${content.cookieName}, expiry ${content.expiresAfterMinutes} min); the file holds bearer credentials`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.exitCode === 3 ? err.message : `mth-load sessions: failed: ${err?.message ?? err}`);
      process.exit(err?.exitCode ?? 1);
    },
  );
}
