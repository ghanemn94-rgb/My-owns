// D-165 (T-DG5-BE-T3): `mth-db seed-demo` in a dev-mode stack also binds each demo user to the dev issuer, so the dev
// sign-in (`POST /auth/dev-login`, AUTH_MODE=dev) can choose them; in every other mode nothing changes. Run through the
// REAL CLI (`packages/db/src/cli.ts`) in a child process, on scratch databases of this run's disposable cluster:
//   - AUTH_MODE=dev (NODE_ENV=development): one DEV_ISSUER identity per demo user (subject roaming.user.<role>);
//   - NODE_ENV=production with AUTH_MODE=dev, and AUTH_MODE=oidc: no dev-issuer identity at all;
//   - in every mode the demo IdP identities are exactly as before (one per demo user, DEMO_IDP_ISSUER);
//   - no secret or password is stored (user_identity holds issuer and subject only).
// Plus the pure rule `demoDevIssuerBindingAllowed`. Everything is SYNTHETIC; nothing here approves anything.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { DEV_ISSUER } from "../../src/constants.ts";
import { DEMO_IDP_ISSUER, DEMO_SIGN_IN_USERS } from "../../src/demo/data/roaming.ts";
import { demoDevIssuerBindingAllowed } from "../../src/demo/guard.ts";
import { migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const dropAtEnd: string[] = [];
afterAll(async () => {
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
});

async function migratedScratch(prefix: string): Promise<string> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  return ownerUrl;
}

/** `mth-db seed-demo` with exactly the given NODE_ENV/AUTH_MODE (MTH_* and AUTH_MODE of the runner are dropped). */
function seedDemoCli(ownerUrl: string, env: Record<string, string>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL" && k !== "AUTH_MODE" && k !== "NODE_ENV")
      base[k] = v;
  return spawnSync(process.execPath, ["--conditions=@mth/source", cli, "seed-demo"], {
    env: { ...base, DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo", ...env },
    encoding: "utf8",
    timeout: 240_000,
  });
}

async function identities(ownerUrl: string): Promise<{ issuer: string; subject: string; user_id: string }[]> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    return (
      await c.query<{ issuer: string; subject: string; user_id: string }>(
        "SELECT issuer, subject, user_id::text FROM user_identity ORDER BY issuer, subject",
      )
    ).rows;
  } finally {
    await c.end();
  }
}

const demoIdp = DEMO_SIGN_IN_USERS.map((u) => ({ issuer: DEMO_IDP_ISSUER, subject: u.name, user_id: u.id })).sort(
  (a, b) => (a.subject < b.subject ? -1 : 1),
);

describe("D-165: the dev-issuer binding rule", () => {
  it("binds only with AUTH_MODE=dev and never with NODE_ENV=production", () => {
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: "development", AUTH_MODE: "dev" })).toBe(true);
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: "test", AUTH_MODE: "dev" })).toBe(true);
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: "production", AUTH_MODE: "dev" })).toBe(false);
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: "development", AUTH_MODE: "oidc" })).toBe(false);
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: "development", AUTH_MODE: undefined })).toBe(false);
    expect(demoDevIssuerBindingAllowed({ NODE_ENV: undefined, AUTH_MODE: "DEV" })).toBe(false);
  });
});

describe("D-165: mth-db seed-demo and the dev issuer (the real CLI)", () => {
  it("AUTH_MODE=dev binds every demo user to the dev issuer too; the demo IdP identities are unchanged", async () => {
    const ownerUrl = await migratedScratch("mth_demo_devbind_dev");
    const r = seedDemoCli(ownerUrl, { NODE_ENV: "development", AUTH_MODE: "dev" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const all = await identities(ownerUrl);
    expect(all.filter((i) => i.issuer === DEMO_IDP_ISSUER)).toEqual(demoIdp);
    expect(all.filter((i) => i.issuer === DEV_ISSUER)).toEqual(demoIdp.map((i) => ({ ...i, issuer: DEV_ISSUER })));
    expect(all).toHaveLength(2 * DEMO_SIGN_IN_USERS.length);
    expect(r.stdout).toContain(`count  user_identity\t${2 * DEMO_SIGN_IN_USERS.length}`);
  }, 300_000);

  it("NODE_ENV=production (even with AUTH_MODE=dev) creates no dev-issuer identity", async () => {
    const ownerUrl = await migratedScratch("mth_demo_devbind_prod");
    const r = seedDemoCli(ownerUrl, { NODE_ENV: "production", AUTH_MODE: "dev" });
    // The seed itself may run (MTH_ENV=demo on an empty database) or be refused by the configuration; in neither case
    // is a dev-issuer identity written.
    const all = await identities(ownerUrl);
    expect(
      all.filter((i) => i.issuer === DEV_ISSUER),
      `${r.stdout}\n${r.stderr}`,
    ).toEqual([]);
    if (r.status === 0) expect(all).toEqual(demoIdp);
  }, 300_000);

  it("a non-dev auth mode (AUTH_MODE=oidc) creates no dev-issuer identity; the demo IdP identities are unchanged", async () => {
    const ownerUrl = await migratedScratch("mth_demo_devbind_oidc");
    const r = seedDemoCli(ownerUrl, { NODE_ENV: "development", AUTH_MODE: "oidc" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(await identities(ownerUrl)).toEqual(demoIdp);
    expect(r.stdout).toContain(`count  user_identity\t${DEMO_SIGN_IN_USERS.length}`);
  }, 300_000);
});
