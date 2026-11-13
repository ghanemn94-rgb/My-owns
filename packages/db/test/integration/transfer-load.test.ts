// The import load on PostgreSQL (ADR-0064 Amendment 1 §A1.2-A1.5; p7-work-split §C.12; REQ-S19-014, REQ-S19-016;
// T-DG7-BE-R1): T-R1 (E1-E4 measured and their refusals), T-R2 (the reservation), T-R4 (audit_event append-only and
// both triggers on between the steps), T-R5 (a mismatch rolls everything back). Source: a scratch database seeded with
// the SYNTHETIC demo dataset; targets: scratch databases. Every value is synthetic. Nothing here approves anything (no
// G1-G6, Finance or IT approval) or touches DG0-DG7.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MigrationReserveError, migrate, RESERVE_NEEDS_EMPTY_DATABASE } from "../../src/migrate.ts";
import type { Db, Tx } from "../../src/pool.ts";
import { buildPlan, type LoadStep, type MigrationManifest } from "../../src/transfer/index.ts";
import { createScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";
import { importInto, RoundtripWorkspace, type RoundtripScratch } from "./transfer-roundtrip.fixture.ts";

const { adminUrl } = testDatabase();
const ws = new RoundtripWorkspace(adminUrl);
let source: RoundtripScratch;
let pkg: string;
let manifest: MigrationManifest;
let M: bigint;

beforeAll(async () => {
  source = await ws.demoSource("mth_ld_source");
  const exported = await ws.exportPackage(source.db);
  pkg = exported.dir;
  manifest = exported.result.manifest;
  M = BigInt((await sql<{ m: string }>`SELECT max(seq)::text AS m FROM audit_event`.execute(source.db)).rows[0]!.m);
}, 600_000);

afterAll(async () => {
  await ws.close();
}, 120_000);

/** Every table's count and digest-relevant state, audit_event's trigger states and its rows: "unchanged". */
async function state(
  db: Db,
): Promise<{ counts: Record<string, string>; triggers: Record<string, string>; audit: string }> {
  const tables = await sql<{ t: string }>`
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`.execute(db);
  const counts: Record<string, string> = {};
  for (const { t } of tables.rows)
    counts[t] = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(db)).rows[0]!.n;
  const trig = await sql<{ tgname: string; tgenabled: string }>`
    SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_event'::regclass AND NOT tgisinternal
    ORDER BY tgname`.execute(db);
  const audit = await sql<{ d: string }>`
    SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY seq), '')) AS d FROM audit_event a`.execute(db);
  return {
    counts,
    triggers: Object.fromEntries(trig.rows.map((r) => [r.tgname, r.tgenabled])),
    audit: audit.rows[0]!.d,
  };
}

const AUDIT_TRIGGERS_ENABLED = { audit_event_immutable: "O", audit_event_immutable_truncate: "O" };

const baselineCounts = async (db: Db) =>
  (
    await sql<{ n: string; lo: string | null; bad: string }>`
      SELECT count(*)::text AS n, min(seq)::text AS lo,
             count(*) FILTER (WHERE NOT (source = 'migration' AND actor_type = 'system' AND actor_user_id IS NULL
               AND on_behalf_of_user_id IS NULL AND organization_id IS NULL AND transformation_id IS NULL))::text AS bad
        FROM audit_event`.execute(db)
  ).rows[0]!;

describe("T-R2: mth-db migrate --reserve-audit-seq-for", () => {
  it("starts the target's audit trail at M + 1, fires once after 0003, and the plan defers no audit column", async () => {
    const fired: string[] = [];
    const target = await ws.reserved("mth_ld_r2", pkg, { onReserved: (f) => fired.push(f) });
    expect(fired).toEqual(["0003_audit_event.sql"]);
    const b = await baselineCounts(target.db);
    expect(BigInt(b.lo!)).toBe(M + 1n);
    expect(b.bad).toBe("0");
    const plan = await buildPlan(target.db);
    expect(plan.tables.find((t) => t.name === "audit_event")!.deferredColumns).toEqual([]);
  }, 300_000);

  it("refuses on a database with an applied migration (exit-2 line), changing nothing", async () => {
    const name = await createScratchDatabase(adminUrl, "mth_ld_r2b");
    const url = roleUrl(adminUrl, name, "mth_owner");
    await migrate(url);
    await expect(migrate(url, { reserveAuditSeqFrom: M + 1n })).rejects.toThrow(RESERVE_NEEDS_EMPTY_DATABASE);
    await expect(migrate(url, { reserveAuditSeqFrom: M + 1n })).rejects.toBeInstanceOf(MigrationReserveError);
  }, 300_000);

  it("the CLI prints the line; a bad package is refused before any connection (unreachable URL)", async () => {
    const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
    const env = (url: string): Record<string, string> => {
      const base: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env))
        if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL") base[k] = v;
      return { ...base, NODE_ENV: "test", DATABASE_OWNER_URL: url };
    };
    const bad = ws.copyPackage(pkg);
    writeFileSync(join(bad, "tables", "audit_event.ndjson"), "{}\n");
    const unreachable = "postgres://mth_owner:x@127.0.0.1:1/none";
    const r = spawnSync(
      process.execPath,
      ["--conditions=@mth/source", cli, "migrate", "--reserve-audit-seq-for", bad],
      { env: env(unreachable), encoding: "utf8", timeout: 120_000 },
    );
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.trim()).toBe(
      `migrate: refused: the package at ${bad} failed its checks: checksum mismatch for tables/audit_event.ndjson`,
    );
    const name = await createScratchDatabase(adminUrl, "mth_ld_r2c");
    const ok = spawnSync(
      process.execPath,
      ["--conditions=@mth/source", cli, "migrate", "--reserve-audit-seq-for", pkg],
      { env: env(roleUrl(adminUrl, name, "mth_owner")), encoding: "utf8", timeout: 300_000 },
    );
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim().split("\n").at(-1)).toBe(
      `migrate: the audit sequence of this target starts at ${M + 1n} (the package's highest audit seq is ${M})`,
    );
  }, 600_000);
});

describe("T-R1: the empty-target rule E1-E4", () => {
  it("a fresh target (with and without the reservation) satisfies E1, E2 and E4, measured", async () => {
    for (const target of [await ws.migrated("mth_ld_r1a"), await ws.reserved("mth_ld_r1b", pkg)]) {
      const b = await baselineCounts(target.db);
      expect(BigInt(b.n)).toBeGreaterThan(0n);
      expect(b.bad).toBe("0");
      for (const t of [
        "organization",
        "app_user",
        "user_identity",
        "transformation",
        "deployment_environment",
        "evidence_content",
        "export_job",
        "migration_import",
        "identity_binding_hold",
        "session",
        "worker_heartbeat",
      ])
        expect(
          (await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(target.db)).rows[0]!.n,
          t,
        ).toBe("0");
      expect((await state(target.db)).triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
    }
  }, 600_000);

  it("a plainly migrated target is refused by E3 (exit 2, exact line), unchanged", async () => {
    const target = await ws.migrated("mth_ld_r1c");
    const before = await state(target.db);
    const r = await importInto(target.db, pkg);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      `import-migration: refused: the target's audit events start at seq 1, at or below the package's highest audit seq ${M}; recreate the target with mth-db migrate --reserve-audit-seq-for ${pkg}`,
    ]);
    expect(await state(target.db)).toEqual(before);
  }, 300_000);

  it("one organization: exit 3 with the detail line; one api audit row as mth_app: exit 3 with the E2 line", async () => {
    const target = await ws.reserved("mth_ld_r1d", pkg);
    const orgId = uuidv7();
    await target.db
      .insertInto("organization")
      .values({ id: orgId, code: "SYN", name_en: "Synthetic", name_ar: "اصطناعية" } as never)
      .execute();
    let before = await state(target.db);
    let r = await importInto(target.db, pkg);
    expect(r).toEqual({
      code: 3,
      out: [],
      err: [
        "import-migration: refused: the target database is not empty",
        "import-migration: organization holds 1 rows",
      ],
    });
    expect(await state(target.db)).toEqual(before);

    const t2 = await ws.reserved("mth_ld_r1e", pkg);
    const app = await import("../../src/pool.ts");
    const appDb = app.createDb(
      app.createPool(roleUrl(adminUrl, t2.ownerUrl.split("/").pop()!.split("?")[0]!, "mth_app"), { max: 1 }),
    );
    try {
      await appDb
        .insertInto("audit_event")
        .values({
          id: uuidv7(),
          actor_type: "system",
          action: "synthetic.probe",
          record_type: "synthetic",
          record_id: uuidv7(),
          source: "api",
        })
        .execute();
    } finally {
      await appDb.destroy();
    }
    before = await state(t2.db);
    r = await importInto(t2.db, pkg);
    expect(r).toEqual({
      code: 3,
      out: [],
      err: [
        "import-migration: refused: the target database is not empty",
        "import-migration: audit_event holds 1 rows not written by migrations",
      ],
    });
    expect(await state(t2.db)).toEqual(before);
  }, 600_000);
});

describe("R1 (BLOCKED; handback §4): carried audit ids collide with the target's baseline", () => {
  it("migrations write deterministic audit ids, so the import stops at L1 (exit 1) and changes nothing", async () => {
    const target = await ws.reserved("mth_ld_r1x", pkg);
    // The measured fact: the baseline holds rows whose id is also a carried id (0068, 0069, 0095 seed them).
    const ids = (await sql<{ id: string }>`SELECT id::text AS id FROM audit_event`.execute(source.db)).rows.map(
      (r) => r.id,
    );
    const shared = (
      await sql<{ n: string; sources: string[] }>`
        SELECT count(*)::text AS n, array_agg(DISTINCT source) AS sources FROM audit_event
         WHERE id = ANY(${ids}::uuid[])`.execute(target.db)
    ).rows[0]!;
    expect(BigInt(shared.n)).toBeGreaterThan(0n);
    expect(shared.sources).toEqual(["migration"]);
    const before = await state(target.db);
    const seen: LoadStep[] = [];
    const onStep = async (step: LoadStep, tx: Tx) => {
      seen.push(step);
      const st = await sql<{ upd: string; del: string }>`
        SELECT n_tup_upd::text AS upd, n_tup_del::text AS del FROM pg_stat_xact_user_tables
         WHERE relid = 'audit_event'::regclass`.execute(tx);
      expect(st.rows[0] ?? { upd: "0", del: "0" }, step).toEqual({ upd: "0", del: "0" });
    };
    const r = await importInto(target.db, pkg, { onStep });
    expect(r.code).toBe(1);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(
      new RegExp(
        `^import-migration: failed: ${shared.n} carried audit events share their id with the target's migration ` +
          "baseline \\(first [0-9a-f-]{36}\\); ADR-0064 Amendment 1 does not provide for this, and no audit row is " +
          "skipped or renumbered$",
      ),
    );
    expect(seen).toEqual(["L0"]);
    expect(await state(target.db)).toEqual(before);
    expect(before.triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
    expect(manifest.tables.some((t) => t.name === "audit_event")).toBe(true);
  }, 600_000);
});
