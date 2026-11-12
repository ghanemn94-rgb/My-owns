// T-C1, T-C2, T-C3, T-C4, T-C5 on a real PostgreSQL (ADR-0064 §2-§5; p7-work-split §C.6; T-DG7-BE-C): the export of
// the SYNTHETIC demo dataset (seeded twice, into two scratch databases of this run's disposable cluster), of an
// unmarked and of a production-marked database. Every value here is synthetic; a demo export is labelled synthetic
// (sourceEnvironment demo). Exporting approves nothing (no G1-G6, Finance or IT approval) and touches no DG0-DG7 record.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertAuditEvent } from "../../src/audit.ts";
import { bootstrap } from "../../src/bootstrap.ts";
import { datasetChecksum } from "../../src/demo/checksum.ts";
import { seedDemo } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import {
  buildPlan,
  directorySink,
  encodeTable,
  ENCODER_SETTINGS,
  exportPackage,
  filesystemObjectSource,
  parseAttachmentManifest,
  parseManifest,
  publicBaseTables,
  readSourceEnvironment,
  transferSha256,
  type ExportResult,
  type TransferPlanTable,
} from "../../src/transfer/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const dropAtEnd: string[] = [];
const handles: Db[] = [];
const dirs: string[] = [];

afterAll(async () => {
  for (const db of handles) await db.destroy();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 120_000);

async function scratch(prefix: string): Promise<{ ownerUrl: string; db: Db }> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  const db = createDb(createPool(ownerUrl, { max: 3 }));
  handles.push(db);
  return { ownerUrl, db };
}

async function seededDemo(prefix: string): Promise<Db> {
  const s = await scratch(prefix);
  await seedDemo(s.ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: false,
  });
  return s.db;
}

const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

async function exportTo(db: Db, dir: string): Promise<ExportResult> {
  return exportPackage(db, directorySink(dir), {
    exportId: uuidv7(),
    objects: filesystemObjectSource(tempDir("mth-transfer-store-")),
    appVersion: "0.1.0-test",
  });
}

/** The SYNTHETIC SecretRef fixture: one storage setting (its history row comes from the 0102 trigger). */
const CANARY_PROVIDER = "env";
async function addSecretRefFixture(db: Db): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const user = await tx.selectFrom("app_user").select("id").orderBy("id").limit(1).executeTakeFirstOrThrow();
    const id = uuidv7();
    await tx
      .insertInto("storage_setting")
      .values({
        id,
        driver: "s3",
        s3_endpoint: "https://s3.example.invalid",
        s3_region: "me-central-1",
        s3_bucket: "mth-synthetic",
        s3_access_key_ref: JSON.stringify({ provider: CANARY_PROVIDER, name: "MTH_SYNTHETIC_S3_ACCESS" }),
        s3_secret_key_ref: JSON.stringify({ provider: CANARY_PROVIDER, name: "MTH_SYNTHETIC_S3_SECRET" }),
        reason: "Synthetic transfer fixture",
        created_by: user.id,
        updated_by: user.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, source: "cli" },
      {
        action: "test.transfer_fixture",
        recordType: "storage_setting",
        recordId: id,
        organizationId: null,
        newVersion: 1,
      },
    );
  });
}

let demoA: Db;
let demoB: Db;
let exportA: ExportResult;
let exportB: ExportResult;
let dirA: string;
let dirB: string;

beforeAll(async () => {
  [demoA, demoB] = await Promise.all([seededDemo("mth_transfer_demo_a"), seededDemo("mth_transfer_demo_b")]);
  dirA = tempDir("mth-transfer-pkg-a-");
  dirB = tempDir("mth-transfer-pkg-b-");
  exportB = await exportTo(demoB, dirB);
  await addSecretRefFixture(demoA);
  exportA = await exportTo(demoA, dirA);
}, 600_000);

const readText = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");

describe("T-C1: the catalogue-driven plan of the real schema (ADR-0064 §2.2)", () => {
  it("exports every public base table except exactly the transfer_table_rule rows", async () => {
    const plan = await buildPlan(demoA);
    const all = await publicBaseTables(demoA);
    const exported = plan.tables.map((t) => t.name);
    const excluded = plan.excludedTables.map((t) => t.name);
    expect([...exported, ...excluded].sort()).toEqual([...all].sort());
    expect(new Set(exported).size).toBe(exported.length);
    expect(excluded).toContain("session");
    expect(excluded).toContain("oidc_login_state");
    expect(exported).toContain("audit_event");
    expect(exported).toContain("deployment_environment");
    expect(plan.tables.map((t) => t.loadPhase)).toEqual(plan.tables.map((_, i) => i + 1));
  });

  it("has no cycle without a nullable edge, and every foreign key's referenced table loads first or is deferred", async () => {
    const plan = await buildPlan(demoA);
    const phase = new Map(plan.tables.map((t) => [t.name, t]));
    const fks = await sql<{ name: string; table: string; referenced: string; columns: string[] }>`
      SELECT con.conname AS name, c.relname AS table, rc.relname AS referenced,
             array_agg(a.attname::text ORDER BY k.ord) AS columns
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_class rc ON rc.oid = con.confrelid
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE con.contype = 'f'
       GROUP BY con.oid, c.relname, rc.relname`.execute(demoA);
    let checked = 0;
    for (const fk of fks.rows) {
      const t = phase.get(fk.table);
      const r = phase.get(fk.referenced);
      if (t === undefined || r === undefined || fk.table === fk.referenced) continue;
      checked += 1;
      // Deferred: a nullable column of the key is loaded null (MATCH SIMPLE), or the key is DEFERRABLE and removed.
      const deferred =
        fk.columns.some((c) => t.deferredColumns.includes(c)) || t.deferrableForeignKeys.includes(fk.name);
      expect(r.loadPhase < t.loadPhase || deferred, `${fk.table}(${fk.columns.join(",")}) -> ${fk.referenced}`).toBe(
        true,
      );
    }
    expect(checked).toBeGreaterThan(300);
    // The organization/app_user cycle of 0001 is broken by a nullable audit-stamp column.
    expect(phase.get("organization")!.deferredColumns).toContain("created_by");
    // The only DEFERRABLE key the order relies on today (0104): the connector's current configuration.
    expect(plan.tables.flatMap((t) => t.deferrableForeignKeys.map((n) => `${t.name}.${n}`))).toEqual([
      "connector.connector_current_config_fkey",
    ]);
  });

  it("pins the object-naming columns (ADR-0064 §5) and finds no json column (only jsonb is encoded)", async () => {
    const plan = await buildPlan(demoA);
    expect(plan.objectColumns).toEqual([
      { table: "evidence_content", column: "storage_key" },
      { table: "export_job", column: "storage_key" },
    ]);
    const json = plan.tables.flatMap((t) =>
      t.columns.filter((c) => c.type === "json").map((c) => `${t.name}.${c.name}`),
    );
    expect(json).toEqual([]);
    expect(plan.rewrittenColumns).toHaveLength(15);
  });
});

describe("T-C2: the encoder round-trips every value through jsonb_populate_recordset (ADR-0064 §2.3)", () => {
  it("numeric money (4 decimals) and rates, bigint, timestamptz with microseconds, arrays, bytea, jsonb, NULL", async () => {
    await demoA.transaction().execute(async (tx) => {
      for (const [name, value] of ENCODER_SETTINGS) await sql`SELECT set_config(${name}, ${value}, true)`.execute(tx);
      await sql`CREATE TEMPORARY TABLE tc2_src (
        id uuid PRIMARY KEY, money numeric(20,4), rate numeric, big bigint, at timestamptz, day date, span interval,
        flag boolean, tags text[], nums integer[], blob bytea, doc jsonb, note text) ON COMMIT DROP`.execute(tx);
      await sql`CREATE TEMPORARY TABLE tc2_dst (LIKE tc2_src) ON COMMIT DROP`.execute(tx);
      await sql`INSERT INTO tc2_src VALUES
        ('01920007-0000-7000-8000-000000000001', 1234567890123456.1235, 0.000123456789012345678901234567890,
         9223372036854775807, '2026-11-12 20:00:00.123456+00', '2026-02-28', '1 year 2 mons 3 days 04:05:06.789',
         true, ARRAY['a "b"', 'c,d', NULL, 'تجريبي'], ARRAY[1, -2, NULL], '\\x00ff10',
         '{"amount": 12345678901234567890.123456789, "nested": {"k": [1, "2", null, true]}, "text": "line\\nbreak"}',
         E'two\\nlines'),
        ('01920007-0000-7000-8000-000000000002', NULL, NULL, NULL, NULL, NULL, NULL, false, '{}', NULL, NULL, NULL, NULL),
        ('01920007-0000-7000-8000-000000000003', -0.0001, 1, -9223372036854775808, '-infinity', 'infinity', '-1 day',
         NULL, NULL, '{}', '\\x', '[]', '')`.execute(tx);
      const cols = await sql<{ name: string; type: string }>`
        SELECT a.attname AS name, t.typname AS type FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
         WHERE a.attrelid = 'tc2_src'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`.execute(tx);
      const table: TransferPlanTable = {
        name: "tc2_src",
        loadPhase: 1,
        columns: cols.rows.map((c) => ({ ...c, nullable: true })),
        primaryKey: ["id"],
        deferredColumns: [],
        selfReferences: [],
        deferrableForeignKeys: [],
      };
      const enc = await encodeTable(tx, table, []);
      expect(enc.rowCount).toBe(3);
      const text = Buffer.from(enc.bytes).toString("utf8");
      expect(transferSha256(text)).toBe(enc.contentDigest);
      const lines = text.split("\n").filter((l) => l !== "");
      for (const line of lines) {
        const row = JSON.parse(line) as Record<string, unknown>;
        expect(Object.keys(row)).toEqual(cols.rows.map((c) => c.name));
        for (const [k, v] of Object.entries(row)) {
          if (k === "doc") continue;
          // No column value is a JSON number: text or null only.
          expect(v === null || typeof v === "string", `${k}: ${JSON.stringify(v)}`).toBe(true);
        }
      }
      expect(lines[0]).toContain('"money":"1234567890123456.1235"');
      expect(lines[0]).toContain('"flag":"t"');
      expect(lines[0]).toContain('"at":"2026-11-12 20:00:00.123456+00"');
      expect(lines[0]).toContain('"big":"9223372036854775807"');
      expect(lines[0]).toContain("12345678901234567890.123456789");
      await sql`INSERT INTO tc2_dst SELECT * FROM jsonb_populate_recordset(NULL::tc2_src, ${`[${lines.join(",")}]`}::jsonb)`.execute(
        tx,
      );
      const diff = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM ((SELECT * FROM tc2_src EXCEPT ALL SELECT * FROM tc2_dst)
                                   UNION ALL (SELECT * FROM tc2_dst EXCEPT ALL SELECT * FROM tc2_src)) d`.execute(tx);
      expect(diff.rows[0]!.n).toBe("0");
      // Byte-identical text output too (numeric scale, jsonb numbers, the interval).
      const again = await encodeTable(tx, { ...table, name: "tc2_dst" }, []);
      expect(again.contentDigest).toBe(enc.contentDigest);
    });
  });
});

describe("T-C3: the marker and the demo checksum (ADR-0064 §2.1; D-244 O2)", () => {
  it("a demo source exports sourceEnvironment demo and demoChecksum = datasetChecksum()", async () => {
    expect(await readSourceEnvironment(demoB)).toBe("demo");
    const checksum = await demoB.transaction().execute((tx) => datasetChecksum(tx));
    expect(exportB.sourceEnvironment).toBe("demo");
    expect(exportB.demoChecksum).toBe(checksum);
    const m = parseManifest(readText(dirB, "manifest.json"));
    expect(m.schemaVersion).toBe("mth-migration/1");
    expect(m.demoChecksum).toBe(checksum);
    expect(m.migrationLevel).toMatch(/^0147_p7_transfer_export_job$|^[0-9]{4}_[a-z0-9_]+$/);
  });

  it("an unmarked source exports unmarked and a production source production, both with demoChecksum null", async () => {
    const empty = await scratch("mth_transfer_unmarked");
    expect(await readSourceEnvironment(empty.db)).toBe("unmarked");
    const unmarked = await exportTo(empty.db, tempDir("mth-transfer-pkg-u-"));
    expect([unmarked.sourceEnvironment, unmarked.demoChecksum]).toEqual(["unmarked", null]);
    await bootstrap(empty.db, {
      orgCode: "PRODORG",
      orgNameEn: "Example Production Organization",
      orgNameAr: "مؤسسة إنتاج مثال",
      defaultTimezone: "Asia/Riyadh",
      defaultCurrency: "SAR",
      adminDisplayName: "First Admin",
      adminEmail: null,
      adminIssuer: "https://idp.example.invalid/realms/mth",
      adminSubject: "first-admin",
    });
    const production = await exportTo(empty.db, tempDir("mth-transfer-pkg-p-"));
    expect([production.sourceEnvironment, production.demoChecksum]).toEqual(["production", null]);
  }, 120_000);
});

describe("T-C4: checksums (ADR-0064 §2.3; ADR-0062 residual 2)", () => {
  it("fileSha256 = contentDigest = the SHA-256 of the stored file, for every table", () => {
    const m = parseManifest(readText(dirA, "manifest.json"));
    expect(m.tables.length).toBe(exportA.tableCount);
    for (const t of m.tables) {
      expect(t.fileSha256, t.name).toBe(t.contentDigest);
      expect(transferSha256(readFileSync(join(dirA, t.file))), t.name).toBe(t.fileSha256);
    }
    expect(transferSha256(readFileSync(join(dirA, "manifest.json")))).toBe(exportA.manifestSha256);
    expect(transferSha256(readFileSync(join(dirA, "attachments.json")))).toBe(exportA.attachmentManifestSha256);
    expect(parseAttachmentManifest(readText(dirA, "attachments.json")).items).toEqual([]);
  });

  it("two seedings of the demo export equal demoChecksum and equal contentDigest for every table without a now() column or write-time id", async () => {
    // demoA carries the SecretRef fixture (storage_setting and its history) on top of the seed; demoB does not.
    const fixtureTables = new Set(["storage_setting", "storage_setting_change", "audit_event"]);
    const a = await demoA.transaction().execute((tx) => datasetChecksum(tx));
    expect(a).toBe(exportB.demoChecksum); // the fixture is not a registered demo record
    const clock = await sql<{ table_name: string }>`
      SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_default ~* '(now\\(\\)|current_timestamp|current_date|transaction_timestamp\\(\\))'`.execute(demoA);
    const withClock = new Set(clock.rows.map((r) => r.table_name));
    const ma = parseManifest(readText(dirA, "manifest.json"));
    const mb = parseManifest(readText(dirB, "manifest.json"));
    expect(ma.tables.map((t) => t.name)).toEqual(mb.tables.map((t) => t.name));
    const compared: string[] = [];
    const differing: string[] = [];
    for (const ta of ma.tables) {
      if (withClock.has(ta.name) || fixtureTables.has(ta.name)) continue;
      const tb = mb.tables.find((t) => t.name === ta.name)!;
      expect(ta.rowCount, ta.name).toBe(tb.rowCount);
      if (ta.contentDigest !== tb.contentDigest) differing.push(ta.name);
      compared.push(ta.name);
    }
    // Measured refinement of the ADR's wording: besides the now()-defaulted columns, three tables differ between two
    // seedings because their ids are generated at write time (mth_uuid_v7() in the 0101/0104 history triggers and the
    // 0122 enablement trigger), not because of a clock. Their row counts are equal; everything else is byte-equal.
    expect(differing.sort()).toEqual(["automation_rule_enablement", "connector_change", "service_identity_change"]);
    expect(compared.length).toBeGreaterThanOrEqual(40); // 41 at 0147
  });
});

describe("T-C5: no live SecretRef and no excluded table in the package (ADR-0064 §3, §4)", () => {
  it("every SecretRef in the package has provider unbound and keeps its name", () => {
    const m = parseManifest(readText(dirA, "manifest.json"));
    let refs = 0;
    for (const rule of m.rewrittenColumns) {
      const t = m.tables.find((x) => x.name === rule.table)!;
      for (const line of readText(dirA, t.file)
        .split("\n")
        .filter((l) => l !== "")) {
        const v = (JSON.parse(line) as Record<string, unknown>)[rule.column];
        if (v === null || v === undefined) continue;
        const list =
          rule.rule === "secret_refs_unbind"
            ? Object.values(v as Record<string, unknown>)
            : [v as Record<string, unknown>];
        for (const ref of list as Record<string, unknown>[]) {
          expect(ref["provider"], `${rule.table}.${rule.column}`).toBe("unbound");
          expect(typeof ref["name"]).toBe("string");
          refs += 1;
        }
      }
    }
    // storage_setting (2 references) and its history row (2).
    expect(refs).toBeGreaterThanOrEqual(4);
    const all = readdirSync(join(dirA, "tables")).map((f) => readText(join(dirA, "tables"), f));
    for (const text of all) expect(text).not.toContain(`"provider": "${CANARY_PROVIDER}"`);
    expect(all.join("")).toContain("MTH_SYNTHETIC_S3_SECRET");
  });

  it("no file is named after an excluded table", () => {
    const m = parseManifest(readText(dirA, "manifest.json"));
    const files = readdirSync(join(dirA, "tables"));
    for (const e of m.excludedTables) expect(files, e.name).not.toContain(`${e.name}.ndjson`);
    expect(files.sort()).toEqual(m.tables.map((t) => `${t.name}.ndjson`).sort());
    expect(readdirSync(dirA).sort()).toEqual(["attachments.json", "manifest.json", "tables"]);
  });
});

describe("mth-db export-migration and tools/migration/export.mjs (ADR-0064 §7; p7-work-split §2 rule 4, §C.5)", () => {
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  const wrapper = fileURLToPath(new URL("../../../../tools/migration/export.mjs", import.meta.url));
  function env(ownerUrl: string, store: string): Record<string, string> {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL") base[k] = v;
    return { ...base, NODE_ENV: "test", DATABASE_OWNER_URL: ownerUrl, EVIDENCE_STORAGE_PATH: store };
  }

  it("writes the package with a recorded cli export (requested, started, succeeded); refuses a non-empty --out (2)", async () => {
    const s = await scratch("mth_transfer_cli");
    const store = tempDir("mth-transfer-cli-store-");
    const out = join(tempDir("mth-transfer-cli-out-"), "package");
    const run = spawnSync(
      process.execPath,
      ["--conditions=@mth/source", cli, "export-migration", "--out", out, "--operator", "Synthetic IT operator"],
      { env: env(s.ownerUrl, store), encoding: "utf8", timeout: 180_000 },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^export-migration: wrote export [0-9a-f-]{36} \(unmarked, [0-9]{4}_[a-z0-9_]+\): /);
    const m = parseManifest(readText(out, "manifest.json"));
    const row = await s.db.selectFrom("migration_export").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ id: m.exportId, status: "succeeded", requested_via: "cli", created_by: null });
    expect(row.manifest_sha256).toBe(transferSha256(readFileSync(join(out, "manifest.json"))));
    const actions = await s.db
      .selectFrom("audit_event")
      .select(["action", "source"])
      .where("record_id", "=", row.id)
      .orderBy("seq")
      .execute();
    expect(actions).toEqual([
      { action: "migration_export.requested", source: "cli" },
      { action: "migration_export.started", source: "cli" },
      { action: "migration_export.succeeded", source: "cli" },
    ]);
    // The package of a cli export excludes its own migration_export row (exclude_transfer).
    expect(readdirSync(join(out, "tables"))).not.toContain("migration_export.ndjson");

    // The wrapper: the same command; a non-empty --out is BLOCKED (2) and changes nothing; no operator is 2.
    const again = spawnSync(process.execPath, [wrapper, "--out", out, "--operator", "Synthetic IT operator"], {
      env: env(s.ownerUrl, store),
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(again.status, again.stderr).toBe(2);
    expect(again.stderr).toContain("must be an empty or new directory");
    const noOperator = spawnSync(process.execPath, [wrapper, "--out", join(out, "x")], {
      env: env(s.ownerUrl, store),
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(noOperator.status).toBe(2);
    expect(await s.db.selectFrom("migration_export").select("id").execute()).toHaveLength(1);

    // A failure is exit 1 with the C.5 line: while another export is queued, the request fails and writes nothing.
    const queued = uuidv7();
    await s.db.transaction().execute(async (tx) => {
      await tx.insertInto("migration_export").values({ id: queued, requested_via: "cli" }).execute();
      await insertAuditEvent(
        tx,
        { actorType: "system", actorUserId: null, source: "cli" },
        {
          action: "test.transfer_fixture",
          recordType: "migration_export",
          recordId: queued,
          organizationId: null,
          newVersion: 1,
        },
      );
    });
    const failed = spawnSync(
      process.execPath,
      [wrapper, "--out", join(tempDir("mth-transfer-cli-out2-"), "p"), "--operator", "Synthetic IT operator"],
      { env: env(s.ownerUrl, store), encoding: "utf8", timeout: 180_000 },
    );
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(
      "export-migration: failed: A migration export is already queued or running. Wait for it to finish.",
    );
    expect(await s.db.selectFrom("migration_export").select("id").execute()).toHaveLength(2);
  }, 300_000);
});
