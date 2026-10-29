// The synthetic load dataset against a real, disposable PostgreSQL (ADR-0058 §2, §4; T-DG6-DO-E).
//  - The generator suite of deploy/load/generate.test.mjs (determinism, marker counts, the 0108 refusal), imported here
//    because the `integration` project collects packages/*/test/integration/** only. If deploy/load/**/*.test.mjs is
//    ever added to that project's include list, remove this import so the suite does not run twice.
//  - `mth-db bootstrap` and `mth-db seed-demo` refuse a database that holds the load dataset: exit 3, the exact text,
//    nothing changed (the REAL CLI, packages/db/src/cli.ts, in a child process).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ES module without type declarations (deploy/load is outside the TypeScript projects).
import { datasetRowHashes, generate } from "../../../../deploy/load/generate.mjs";
import "../../../../deploy/load/generate.test.mjs";
import { migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const REFUSAL = "This database holds the synthetic load dataset; it cannot be bootstrapped or seeded as a demo.";
const dropAtEnd: string[] = [];
afterAll(async () => {
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 60_000);

function runCli(args: string[], env: Record<string, string>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL") base[k] = v;
  return spawnSync(process.execPath, ["--conditions=@mth/source", cli, ...args], {
    env: { ...base, NODE_ENV: "test", ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
}

async function hashes(url: string): Promise<Record<string, string>> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await datasetRowHashes(c)) as Record<string, string>;
  } finally {
    await c.end();
  }
}

describe("mth-db refuses a load database (ADR-0058 §2)", () => {
  let ownerUrl = "";

  // Measured (T-DG6-DO-E, 4-CPU sandbox, two full load generations running beside it): 9.4 s for migrate + smoke
  // generation + the CLI child. 120 s is over 12x that loaded measurement.
  it("bootstrap: exit 3, the exact refusal, nothing changed", async () => {
    const name = await createScratchDatabase(adminUrl, "mth_load_cli");
    dropAtEnd.push(name);
    ownerUrl = roleUrl(adminUrl, name, "mth_owner");
    await migrate(ownerUrl);
    await generate(ownerUrl, { profile: "smoke" });
    const before = await hashes(ownerUrl);
    const r = runCli(
      [
        "bootstrap",
        "--org-code",
        "PRODORG",
        "--org-name-en",
        "Example Production Organization",
        "--org-name-ar",
        "مؤسسة إنتاج مثال",
        "--admin-name",
        "First Admin",
        "--admin-issuer",
        "https://idp.example.invalid/realms/mth",
        "--admin-subject",
        "first-admin",
      ],
      { DATABASE_OWNER_URL: ownerUrl },
    );
    expect(r.status).toBe(3);
    expect(r.stderr.trim()).toBe(`mth-db bootstrap: refused: ${REFUSAL}`);
    expect(await hashes(ownerUrl)).toEqual(before);
  }, 120_000);

  it("seed-demo: exit 3, the exact refusal, nothing changed (also with MTH_ENV=demo)", async () => {
    const before = await hashes(ownerUrl);
    for (const env of [{}, { MTH_ENV: "demo" }]) {
      const r = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, ...env });
      expect(r.status).toBe(3);
      expect(r.stderr.trim()).toBe(`mth-db seed-demo: refused: ${REFUSAL}`);
    }
    expect(await hashes(ownerUrl)).toEqual(before);
  }, 120_000);

  it("an empty database without the marker is not refused by this rule (bootstrap still works)", async () => {
    const name = await createScratchDatabase(adminUrl, "mth_load_none");
    dropAtEnd.push(name);
    const url = roleUrl(adminUrl, name, "mth_owner");
    await migrate(url);
    const r = runCli(
      [
        "bootstrap",
        "--org-code",
        "PRODORG",
        "--org-name-en",
        "Example Production Organization",
        "--org-name-ar",
        "مؤسسة إنتاج مثال",
        "--admin-name",
        "First Admin",
        "--admin-issuer",
        "https://idp.example.invalid/realms/mth",
        "--admin-subject",
        "first-admin",
      ],
      { DATABASE_OWNER_URL: url },
    );
    expect(r.stderr).not.toContain(REFUSAL);
    expect(r.status).toBe(0);
  }, 120_000);
});
