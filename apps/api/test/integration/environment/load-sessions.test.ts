// The load-run sessions (ADR-0058 §4; D-195 Q9; T-DG6-DO-E) against a real, disposable PostgreSQL:
//  - deploy/load/sessions.mjs mints one session per load virtual user through the API's own createSession, with
//    auth_mode 'oidc' and idp_issuer 'urn:mth:load-harness'; the API's own resolveSession and CSRF check accept them;
//    the absolute expiry is the run's duration plus one hour; the file is written 0600 inside the temporary directory;
//  - it refuses (exit 3, no session written) a database without the load marker, and MTH_ENV other than load;
//    MTH_ENV=load on a non-production build is a configuration error (exit 78).
// Everything here is SYNTHETIC (the smoke profile of deploy/load/generate.mjs); nothing approves anything.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@mth/config";
import { createDb, createPool, migrate } from "@mth/db";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { csrfMatches, resolveSession } from "../../../src/modules/identity/sessions.ts";

// The script loads the workspace modules dynamically; the sources, not a possibly older dist (see its header).
process.env["MTH_LOAD_MODULES"] = "source";
// @ts-expect-error -- plain ES modules without type declarations (deploy/load is outside the TypeScript projects).
const { generate } = await import("../../../../../deploy/load/generate.mjs");
// @ts-expect-error -- as above.
const sessions = await import("../../../../../deploy/load/sessions.mjs");

const adminUrl = inject("mthDb")!.adminUrl;
const script = fileURLToPath(new URL("../../../../../deploy/load/sessions.mjs", import.meta.url));
const dropAtEnd: string[] = [];
afterAll(async () => {
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 60_000);

async function database(prefix: string, generated: boolean): Promise<{ ownerUrl: string; appUrl: string }> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  if (generated) await generate(ownerUrl, { profile: "smoke" });
  return { ownerUrl, appUrl: roleUrl(adminUrl, name, "mth_app") };
}

function loadEnv(appUrl: string): Record<string, string> {
  return {
    NODE_ENV: "production",
    MTH_ENV: "load",
    AUTH_MODE: "oidc",
    APP_BASE_URL: "https://hub.example.invalid",
    DATABASE_URL: appUrl,
    OIDC_ISSUER_URL: "https://idp.example.invalid/realms/mth",
    OIDC_CLIENT_ID: "mth",
    OIDC_CLIENT_SECRET: "synthetic-test-value",
  };
}

async function rows<T extends pg.QueryResultRow>(url: string, text: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(text)).rows;
  } finally {
    await c.end();
  }
}

const tmp = () => mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "load-sessions-"));

describe("deploy/load/sessions.mjs (ADR-0058 §4)", () => {
  // Measured (T-DG6-DO-E, 4-CPU sandbox, a full load generation running beside it): 6.9 s for migrate + smoke
  // generation + minting 10 sessions. 120 s is over 17x that loaded measurement.
  it("mints one session per virtual user through createSession; the API resolves each and accepts its CSRF token", async () => {
    const { ownerUrl, appUrl } = await database("mth_load_sess", true);
    const config = loadConfig("api", loadEnv(appUrl));
    const dir = tmp();
    const outPath = sessions.sessionsOutPath(join(dir, "sessions.json"), dir);
    const content = await sessions.mintLoadSessions({ config, durationMinutes: 30, outPath });
    // The smoke profile's virtual users: TL 3, BO 2, WL 2, KDS 1, FIN 1, AUD 1.
    expect(content.sessions).toHaveLength(10);
    expect(content.cookieName).toBe("__Host-mth_session");
    expect(content.issuer).toBe("urn:mth:load-harness");
    expect(statSync(outPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(outPath, "utf8"))).toEqual(content);
    const db = createDb(createPool(appUrl, { max: 2 }));
    try {
      for (const s of content.sessions) {
        const token = s.cookie.slice("__Host-mth_session=".length);
        const active = await resolveSession(db, token);
        expect(active).not.toBeNull();
        expect(active!.userId).toBe(s.userId);
        expect(active!.authMode).toBe("oidc");
        expect(active!.idpIssuer).toBe("urn:mth:load-harness");
        expect(csrfMatches(s.csrfToken, active!.csrfTokenHash)).toBe(true);
        expect(s.roles.every((r: string) => ["TL", "BO", "WL", "KDS", "FIN", "AUD"].includes(r))).toBe(true);
      }
    } finally {
      await db.destroy();
    }
    // Absolute expiry: duration (30 min) + 1 hour, rounded up to whole hours (createSession's unit): 2 hours.
    const stored = await rows<{ n: string; hours: string; issuers: string }>(
      ownerUrl,
      `SELECT count(*) AS n, round(extract(epoch FROM max(absolute_expires_at - created_at)) / 3600)::text AS hours,
              string_agg(DISTINCT idp_issuer || '/' || auth_mode, ',') AS issuers FROM session`,
    );
    expect(stored[0]).toEqual({ n: "10", hours: "2", issuers: "urn:mth:load-harness/oidc" });
  }, 120_000);

  it("refuses a database without the load marker: exit code 3, no session written", async () => {
    const { ownerUrl, appUrl } = await database("mth_load_nomark", false);
    const dir = tmp();
    const err = await sessions
      .mintLoadSessions({
        config: loadConfig("api", loadEnv(appUrl)),
        durationMinutes: 30,
        outPath: join(dir, "s.json"),
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ exitCode: 3, message: sessions.SESSIONS_REFUSED_DB });
    expect((await rows<{ n: string }>(ownerUrl, "SELECT count(*) AS n FROM session"))[0]!.n).toBe("0");
  }, 120_000);

  it("the output file must lie inside the temporary directory", () => {
    const dir = tmp();
    expect(() => sessions.sessionsOutPath("/etc/mth-load-sessions.json", dir)).toThrow(
      /inside the temporary directory/,
    );
    expect(sessions.sessionsOutPath(undefined, dir)).toBe(join(dir, "mth-load-sessions.json"));
  });

  it("the script refuses MTH_ENV other than load (exit 3) and MTH_ENV=load on a non-production build (exit 78)", () => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("MTH_") && !k.startsWith("OIDC_") && k !== "DATABASE_URL") base[k] = v;
    const env = { ...base, ...loadEnv("postgresql://mth_app@127.0.0.1:1/none"), MTH_LOAD_MODULES: "source" };
    const run = (extra: Record<string, string>) =>
      spawnSync(process.execPath, ["--conditions=@mth/source", script], {
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 60_000,
      });
    const prod = run({ MTH_ENV: "production" });
    expect(prod.status).toBe(3);
    expect(prod.stderr).toContain("mth-load sessions: refused: MTH_ENV must be load (it is production)");
    const dev = run({ NODE_ENV: "test", APP_BASE_URL: "http://localhost:3000" });
    expect(dev.status).toBe(78);
    expect(dev.stderr).toContain("MTH_ENV=load needs NODE_ENV=production");
  }, 120_000);
});
