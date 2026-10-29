// The load dataset generator's determinism and guards (ADR-0058 §2, §8; p6-work-split §H/G.7; T-DG6-DO-E).
// Runs in the Vitest `integration` project (it needs the run's disposable PostgreSQL): it is imported by
// packages/db/test/integration/load-dataset.test.ts, because the project's include list names packages/*/test/**.
//  - two runs with one seed into two fresh databases -> identical row hashes (every generated table, the generator's
//    own audit events, the per-action audit counts and the marker);
//  - the marker holds exactly the stored counts, and audit_event holds exactly the marker's count;
//  - a second run into the now populated database is refused by the 0108 guard and changes nothing;
//  - a different seed gives different rows;
//  - the generator imports nothing from the demo seed.
// The `smoke` profile keeps this inside the integration budget; the full `default` profile's two-run comparison is
// recorded in the DO-E handback evidence (measured, with its timings).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../packages/db/test/helpers.ts";
import { datasetRowHashes, generate, plannedCounts, readCounts } from "./generate.mjs";

// `pg` is @mth/db's dependency (deploy/ has no node_modules of its own), resolved as generate.mjs resolves it.
const pg = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");

const { adminUrl } = testDatabase();
const dropAtEnd = [];
// Dropping a scratch database waits for other backends to leave (up to 10 s each); three of them here.
afterAll(async () => {
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 120_000);

async function freshDatabase(prefix) {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  return ownerUrl;
}

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe("deploy/load/generate.mjs (ADR-0058 §2)", () => {
  let firstUrl;
  let firstHashes;

  // Measured (T-DG6-DO-E, 4-CPU sandbox, two full load generations running beside it): 18.6 s for both databases'
  // migrate + smoke generation. 120 s is over 6x that loaded measurement.
  it("two runs with one seed give identical row hashes", async () => {
    firstUrl = await freshDatabase("mth_load_a");
    const secondUrl = await freshDatabase("mth_load_b");
    const a = await generate(firstUrl, { profile: "smoke", seed: 20261027 });
    const b = await generate(secondUrl, { profile: "smoke", seed: 20261027 });
    firstHashes = await withClient(firstUrl, datasetRowHashes);
    const secondHashes = await withClient(secondUrl, datasetRowHashes);
    expect(secondHashes).toEqual(firstHashes);
    expect(Object.keys(firstHashes).length).toBeGreaterThanOrEqual(16);
    expect(a.actual).toEqual(b.actual);
  }, 120_000);

  it("the marker records exactly the stored counts, and audit_event holds exactly the marker's count", async () => {
    const planned = plannedCounts("smoke");
    await withClient(firstUrl, async (c) => {
      const counts = await readCounts(c);
      const marker = (await c.query("SELECT * FROM load_dataset_marker")).rows;
      expect(marker).toHaveLength(1);
      expect(marker[0]).toMatchObject({
        dataset_code: "mth_load_v1",
        generator_version: "1.0.0",
        random_seed: "20261027",
        transformations: counts.transformations,
        initiatives: counts.initiatives,
        kpi_actuals: counts.kpiActuals,
        audit_events: counts.auditEvents,
        users: counts.users,
      });
      expect(counts).toMatchObject(planned);
      // Synthetic labels: every user, transformation and initiative name starts with LOAD (en) or تجريبي (ar).
      const unlabelled = await c.query(
        `SELECT 'app_user' AS t, display_name AS v FROM app_user WHERE display_name !~ '^(LOAD |تجريبي )'
         UNION ALL SELECT 'transformation', name FROM transformation WHERE name !~ '^(LOAD |تجريبي )'
         UNION ALL SELECT 'initiative', name FROM initiative WHERE name !~ '^(LOAD |تجريبي )'
         UNION ALL SELECT 'email', email FROM app_user WHERE email !~ '@example\\.invalid$'`,
      );
      expect(unlabelled.rows).toEqual([]);
      // No production or demo marker; KPI values are decimal strings in numeric columns; statuses are mixed.
      expect((await c.query("SELECT count(*)::int AS n FROM deployment_environment")).rows[0].n).toBe(0);
      const statuses = await c.query("SELECT DISTINCT status FROM kpi_actual ORDER BY 1");
      expect(statuses.rows.map((r) => r.status).every((s) => ["accepted", "rejected", "submitted"].includes(s))).toBe(
        true,
      );
      const value = await c.query("SELECT value FROM kpi_actual_value ORDER BY id LIMIT 1");
      // A decimal string from a numeric column (pg returns numeric as text, never a binary double).
      expect(typeof value.rows[0].value).toBe("string");
      expect(value.rows[0].value).toMatch(/^[0-9]+\.[0-9]+$/);
    });
  });

  it("a second run into the populated database is refused by the 0108 guard and changes nothing", async () => {
    const before = await withClient(firstUrl, datasetRowHashes);
    const err = await generate(firstUrl, { profile: "smoke" }).catch((e) => e);
    expect(err).toMatchObject({ constraint: "load_dataset_marker_empty_database" });
    expect(await withClient(firstUrl, datasetRowHashes)).toEqual(before);
  }, 60_000);

  it("a different seed gives different rows", async () => {
    const otherUrl = await freshDatabase("mth_load_c");
    await generate(otherUrl, { profile: "smoke", seed: 7 });
    const other = await withClient(otherUrl, datasetRowHashes);
    expect(other.initiative).not.toBe(firstHashes.initiative);
    expect(other.load_dataset_marker).not.toBe(firstHashes.load_dataset_marker);
  }, 120_000);

  it("imports nothing from the demo seed (D-195 seam 25)", () => {
    const source = readFileSync(new URL("./generate.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*demo/);
    expect(source).not.toMatch(/import\(["'][^"']*demo/);
  });
});
