// Code-security reviewer, DG6 clean re-gate round 3 (T-DG6-REV-CS-RG-R3): migration upgrade probe, NOT product code.
// Copy to packages/db/test/integration/ in a DISPOSABLE clone and run with
//   npx vitest run --project integration packages/db/test/integration/zz-sec-r3-upgrade-0128-0129.test.ts
//
// Question: does 0129 apply as an UPGRADE over a database already at 0128 (an intermediate P6 build), not only on a
// fresh database, and does it leave the same "required" rule as the fresh path (no CHECK left, the two BEFORE INSERT
// row triggers, the 1,000-key shape bound)? Also: 0129 is forward-only and contiguous (0128 then 0129, no gap).
// All data is SYNTHETIC. Nothing here approves anything (G1-G6) or touches DG0-DG7.
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, listMigrationFiles, migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const scratch: string[] = [];
const dirs: string[] = [];

afterAll(async () => {
  for (const name of scratch) await dropScratchDatabase(adminUrl, name);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function catalogue(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const checks = await c.query(
      `SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE 'assistant_%_context_records_required' ORDER BY 1`,
    );
    const triggers = await c.query(
      `SELECT tgname, tgtype::int AS type FROM pg_trigger WHERE tgname LIKE 'assistant_%_context_records_required' ORDER BY 1`,
    );
    const bound = await c.query(
      `SELECT p6_assistant_context_records_valid((SELECT jsonb_agg(jsonb_build_object('recordType','benefit','recordId', gen_random_uuid()::text)) FROM generate_series(1,1000))) AS ok1000,
              p6_assistant_context_records_valid((SELECT jsonb_agg(jsonb_build_object('recordType','benefit','recordId', gen_random_uuid()::text)) FROM generate_series(1,1001))) AS ok1001`,
    );
    return { checks: checks.rows, triggers: triggers.rows, bound: bound.rows[0] };
  } finally {
    await c.end();
  }
}

describe("SEC-R3: 0129 as an upgrade over a 0128 database", () => {
  it("0128 -> 0129 upgrade gives the same rule as the fresh path; ids contiguous", async () => {
    const names = listMigrationFiles().map((f) => f.name);
    const ids = names.map((n) => Number(n.slice(0, 4)));
    console.log("[SEC-R3-UPG] migrations:", names.length, "first", names[0], "last", names.at(-1));
    expect(ids.slice(-2)).toEqual([128, 129]);
    // Run 2: ids strictly increase; the P6 range 0098-0129 is contiguous. The eight ids missing below it (0066, 0067,
    // 0073, 0077-0079, 0083, 0084) are the retired P5 gaps of F-DG5-100 / D-142 (seed.test.ts), not a P6 defect.
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1]!)).toBe(true);
    const p6 = ids.filter((id) => id >= 98);
    console.log("[SEC-R3-UPG] missing ids:", JSON.stringify(Array.from({ length: 129 }, (_, i) => i + 1).filter((i) => !ids.includes(i))));
    expect(p6).toEqual(Array.from({ length: 32 }, (_, i) => 98 + i));

    const dir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "mig-r3-"));
    dirs.push(dir);
    for (const f of readdirSync(defaultMigrationsDir()))
      if (!f.startsWith("0129_")) cpSync(join(defaultMigrationsDir(), f), join(dir, f));

    const up = await createScratchDatabase(adminUrl, "mth_r3up");
    scratch.push(up);
    const upUrl = roleUrl(adminUrl, up, "mth_owner");
    await migrate(upUrl, { dir });
    const at0128 = await catalogue(upUrl);
    console.log("[SEC-R3-UPG] at 0128:", JSON.stringify(at0128));
    expect(at0128.checks.map((r) => r.convalidated)).toEqual([false, false]);
    expect(at0128.bound).toEqual({ ok1000: false, ok1001: false });
    const applied = await migrate(upUrl);
    console.log("[SEC-R3-UPG] upgrade applied:", JSON.stringify(applied));
    const upgraded = await catalogue(upUrl);
    console.log("[SEC-R3-UPG] after upgrade:", JSON.stringify(upgraded));

    const fresh = await createScratchDatabase(adminUrl, "mth_r3fr");
    scratch.push(fresh);
    const freshUrl = roleUrl(adminUrl, fresh, "mth_owner");
    await migrate(freshUrl);
    const freshCat = await catalogue(freshUrl);
    console.log("[SEC-R3-UPG] fresh:", JSON.stringify(freshCat));

    expect(upgraded.checks).toEqual([]);
    expect(upgraded.triggers).toEqual([
      { tgname: "assistant_message_context_records_required", type: 7 },
      { tgname: "assistant_suggestion_context_records_required", type: 7 },
    ]);
    expect(upgraded.bound).toEqual({ ok1000: true, ok1001: false });
    expect(upgraded).toEqual(freshCat);
  });
});
