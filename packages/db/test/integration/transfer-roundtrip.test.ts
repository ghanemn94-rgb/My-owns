// The slice C round trip on PostgreSQL (ADR-0064 §3, §6; p7-work-split §C.2, §C.6; REQ-S19-014, REQ-S19-016;
// T-DG7-BE-D). Source: a scratch database seeded with the SYNTHETIC demo dataset plus one synthetic session; its
// package is written by the export's own encoder. Targets: freshly migrated scratch databases.
//
// What runs here:
//   - T-C9  the package scan (no excluded table file, no session hash, no provider but `unbound`, no password column);
//   - T-C10 every refusal of `import-migration` (schema version, file checksum, level, app version, non-empty target)
//           exits with its code and C.5 line and leaves the target unchanged;
//   - T-C12 (refusal paths) audit_event's two triggers stay enabled after every step, and no audit row is written;
//   - the reconciliation (step 8) of the package against its live source matches, and a changed table is reported;
//   - T-R3 (= T-C8) is BLOCKED (T-DG7-BE-R1 handback §4, R1): on a target prepared with the reservation of ADR-0064
//           A1.2, carried audit ids collide with the target's migration baseline (0068, 0069 and 0095 write
//           deterministic ids), so the load stops at L1 (transfer-load.test.ts pins it). This file pins that a plainly
//           migrated target is refused by E3 with the remedy in the line.
// Every value is synthetic. Nothing here approves anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/pool.ts";
import {
  buildReport,
  canonicalManifest,
  parseManifest,
  pinEncoderSettings,
  reconcileLine,
  reconcileTables,
  runReconcileMigrationCommand,
  type MigrationManifest,
} from "../../src/transfer/index.ts";
import { testDatabase } from "../helpers.ts";
import { importInto, RoundtripWorkspace, type RoundtripScratch } from "./transfer-roundtrip.fixture.ts";

const { adminUrl } = testDatabase();
const ws = new RoundtripWorkspace(adminUrl);
let source: RoundtripScratch;
let target: RoundtripScratch;
let pkg: string;
let manifest: MigrationManifest;
const tokenHash = randomBytes(32);
const csrfHash = randomBytes(32);

beforeAll(async () => {
  source = await ws.demoSource("mth_rt_source");
  // One synthetic session of a demo user: its hashes must never reach the package (T-C9).
  const user = await source.db.selectFrom("app_user").select("id").orderBy("id").executeTakeFirstOrThrow();
  await source.db
    .insertInto("session")
    .values({
      id: uuidv7(),
      token_hash: tokenHash,
      csrf_token_hash: csrfHash,
      user_id: user.id,
      auth_mode: "dev",
      idle_expires_at: sql<Date>`now() + interval '1 hour'`,
      absolute_expires_at: sql<Date>`now() + interval '8 hours'`,
    })
    .execute();
  const exported = await ws.exportPackage(source.db);
  pkg = exported.dir;
  manifest = exported.result.manifest;
  target = await ws.migrated("mth_rt_target");
}, 600_000);

afterAll(async () => {
  await ws.close();
}, 120_000);

/** Every table's row count, and audit_event's trigger states: what "unchanged" means for a refusal. */
async function state(db: Db): Promise<{ counts: Record<string, string>; triggers: Record<string, string> }> {
  const tables = await sql<{ t: string }>`
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`.execute(db);
  const counts: Record<string, string> = {};
  for (const { t } of tables.rows)
    counts[t] = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(db)).rows[0]!.n;
  const trig = await sql<{ tgname: string; tgenabled: string }>`
    SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_event'::regclass AND NOT tgisinternal
    ORDER BY tgname`.execute(db);
  return { counts, triggers: Object.fromEntries(trig.rows.map((r) => [r.tgname, r.tgenabled])) };
}

const AUDIT_TRIGGERS_ENABLED = { audit_event_immutable: "O", audit_event_immutable_truncate: "O" };

function rewriteManifest(dir: string, change: (m: MigrationManifest) => MigrationManifest): void {
  writeFileSync(join(dir, "manifest.json"), canonicalManifest(change(manifest)));
}

describe("T-C9: the package scan (ADR-0064 §3)", () => {
  it("has no file of an excluded table, no session hash, no provider but unbound, no password column", async () => {
    const files = readdirSync(join(pkg, "tables"));
    for (const e of manifest.excludedTables) expect(files).not.toContain(`${e.name}.ndjson`);
    expect(manifest.excludedTables.map((e) => e.name)).toEqual(
      expect.arrayContaining(["session", "oidc_login_state", "idempotency_record"]),
    );
    const texts = [
      readFileSync(join(pkg, "manifest.json"), "utf8"),
      readFileSync(join(pkg, "attachments.json"), "utf8"),
      ...files.map((f) => readFileSync(join(pkg, "tables", f), "utf8")),
    ];
    const state = await sql<{ h: string }>`SELECT encode(state_hash, 'hex') AS h FROM oidc_login_state`.execute(
      source.db,
    );
    const secrets = [tokenHash.toString("hex"), csrfHash.toString("hex"), ...state.rows.map((r) => r.h)];
    for (const text of texts) for (const s of secrets) expect(text).not.toContain(s);
    for (const text of texts)
      for (const m of text.matchAll(/"provider":\s*"([^"]*)"/g)) expect(m[1], "SecretRef provider").toBe("unbound");
    const password = await sql<{ c: string }>`
      SELECT table_name || '.' || column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ~* '(password|passwd|pass_hash|pwd)'`.execute(source.db);
    // Outside the SecretRef columns of ADR-0064 §4 (a reference {provider, name}, never a value; rewritten to unbound).
    const secretRefs = new Set(manifest.rewrittenColumns.map((c) => `${c.table}.${c.column}`));
    expect(password.rows.map((r) => r.c).filter((c) => !secretRefs.has(c))).toEqual([]);
  });
});

describe("T-C10 and T-C12 (refusals): each refusal exits with its code and line and changes nothing", () => {
  const refusals: [string, () => Promise<{ code: number; err: string[] }>, number, string | RegExp][] = [
    [
      "schema version",
      async () => {
        const dir = ws.copyPackage(pkg);
        writeFileSync(join(dir, "manifest.json"), '{"schemaVersion":"mth-migration/9"}\n');
        return importInto(target.db, dir);
      },
      2,
      "import-migration: refused: unsupported manifest schema version 'mth-migration/9'",
    ],
    [
      "file checksum",
      async () => {
        const dir = ws.copyPackage(pkg);
        const file = join(dir, "tables", "organization.ndjson");
        writeFileSync(file, readFileSync(file, "utf8").replace(/"t"/, '"f"') + "\n");
        return importInto(target.db, dir);
      },
      2,
      "import-migration: refused: checksum mismatch for tables/organization.ndjson",
    ],
    [
      "manifest SHA-256 given by IT",
      async () => importInto(target.db, pkg, { manifestSha256: "a".repeat(64) }),
      2,
      "import-migration: refused: checksum mismatch for manifest.json",
    ],
    [
      "migration level",
      async () => {
        const dir = ws.copyPackage(pkg);
        rewriteManifest(dir, (m) => ({ ...m, migrationLevel: "0001_identity_access" }));
        return importInto(target.db, dir);
      },
      2,
      /^import-migration: refused: the target is at [0-9]{4}_[a-z0-9_]+, the package at 0001_identity_access$/,
    ],
    [
      "app version",
      async () => importInto(target.db, pkg, { appVersion: "9.9.9-other" }),
      2,
      "import-migration: refused: the target runs 9.9.9-other, the package was written by 0.1.0-roundtrip",
    ],
    [
      "non-empty target (the seeded demo source itself)",
      async () => importInto(source.db, pkg),
      3,
      "import-migration: refused: the target database is not empty",
    ],
  ];

  for (const [name, run, code, line] of refusals)
    it(`${name}: exit ${code}`, async () => {
      const db = name.startsWith("non-empty") ? source.db : target.db;
      const before = await state(db);
      expect(before.triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
      const r = await run();
      expect(r.code).toBe(code);
      // E1/E2 (ADR-0064 A1.3) add one detail line per used table after the C.5 line.
      if (code !== 3) expect(r.err).toHaveLength(1);
      else expect(r.err.slice(1).every((l) => /^import-migration: [a-z_]+ holds [0-9]+ rows/.test(l))).toBe(true);
      if (typeof line === "string") expect(r.err[0]).toBe(line);
      else expect(r.err[0]).toMatch(line);
      const after = await state(db);
      expect(after.triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
      expect(after.counts).toEqual(before.counts);
    }, 120_000);
});

describe("the reconciliation (step 8) of the package against its live source", () => {
  it("matches table for table; a change after the export is reported, never hidden", async () => {
    const run = () =>
      source.db.transaction().execute(async (tx) => {
        await pinEncoderSettings(tx);
        return reconcileTables(tx, manifest.tables);
      });
    // The session added before the export is excluded; nothing else changed since the snapshot.
    const tables = await run();
    expect(tables).toHaveLength(manifest.tables.length);
    expect(tables.filter((t) => !t.matched)).toEqual([]);
    expect(reconcileLine(buildReport(tables, 0, []))).toBe("reconcile-migration: matched");

    await source.db
      .insertInto("audit_event")
      .values({
        id: uuidv7(),
        actor_type: "system",
        action: "synthetic.reconcile_probe",
        record_type: "synthetic",
        record_id: uuidv7(),
        source: "cli",
      })
      .execute();
    const changed = buildReport(await run(), 0, []);
    expect(changed.tables.filter((t) => !t.matched).map((t) => t.tableName)).toEqual(["audit_event"]);
    expect(reconcileLine(changed)).toBe("reconcile-migration: mismatch: 1 tables, 0 attachments differ");
  }, 300_000);

  it("reconcile-migration refuses (exit 2) where no import is recorded, and writes nothing", async () => {
    const before = await state(target.db);
    const err: string[] = [];
    const code = await runReconcileMigrationCommand(
      target.db,
      { operator: "Synthetic IT operator" },
      { out: () => undefined, err: (l) => err.push(l) },
    );
    expect(code).toBe(2);
    expect(err).toEqual(["BLOCKED: reconcile-migration: no migration import is recorded in this database"]);
    expect((await state(target.db)).counts).toEqual(before.counts);
  }, 120_000);
});

describe("E3 (ADR-0064 A1.3): a target migrated without the reservation is refused", () => {
  it("its audit events start at seq 1, at or below the package's M: exit 2 with the remedy; nothing changes", async () => {
    const audit = await sql<{ n: string; first: string }>`
      SELECT count(*)::text AS n, min(seq)::text AS first FROM audit_event`.execute(target.db);
    expect(Number(audit.rows[0]!.n)).toBeGreaterThan(0);
    expect(audit.rows[0]!.first).toBe("1");
    const before = await state(target.db);
    const r = await importInto(target.db, pkg);
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(
      /^import-migration: refused: the target's audit events start at seq 1, at or below the package's highest audit seq [0-9]+; recreate the target with mth-db migrate --reserve-audit-seq-for .+$/,
    );
    const after = await state(target.db);
    expect(after.counts).toEqual(before.counts);
    expect(after.triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
    expect(parseManifest(readFileSync(join(pkg, "manifest.json"), "utf8")).schemaVersion).toBe("mth-migration/1");
  }, 120_000);
});

describe("the CLI lines and the wrappers (p7-work-split §C.5, §2 rule 4), as subprocesses", () => {
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  const tool = (name: string) => fileURLToPath(new URL(`../../../../tools/migration/${name}.mjs`, import.meta.url));
  function env(): Record<string, string> {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL") base[k] = v;
    return {
      ...base,
      NODE_ENV: "test",
      DATABASE_OWNER_URL: target.ownerUrl,
      EVIDENCE_STORAGE_PATH: ws.tempDir("mth-rt-cli-store-"),
    };
  }
  const run = (args: string[]) => spawnSync(process.execPath, args, { env: env(), encoding: "utf8", timeout: 180_000 });

  it("import.mjs passes mth-db's refusal through; reconcile.mjs exits 2; usage errors are 2", async () => {
    const before = await state(target.db);
    // The subprocess runs the real release (@mth/db's version), not the test package's 0.1.0-roundtrip: exit 2.
    const imported = run([tool("import"), "--from", pkg, "--operator", "Synthetic IT operator"]);
    expect(imported.status, imported.stderr).toBe(2);
    expect(imported.stderr.trim().split("\n").at(-1)).toMatch(
      /^import-migration: refused: the target runs [0-9][^ ]*, the package was written by 0\.1\.0-roundtrip$/,
    );
    const usage = run([tool("import"), "--from", pkg]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/^BLOCKED: usage: /);
    const reconciled = run([tool("reconcile"), "--operator", "Synthetic IT operator"]);
    expect(reconciled.status).toBe(2);
    expect(reconciled.stderr).toContain(
      "BLOCKED: reconcile-migration: no migration import is recorded in this database",
    );
    expect((await state(target.db)).counts).toEqual(before.counts);
  }, 300_000);

  it("mth-db rebind-identity refuses an invalid file with exit 2 and one line per problem; nothing changes", async () => {
    const before = await state(target.db);
    const file = join(ws.tempDir("mth-rt-mapping-"), "mapping.csv");
    const ghost = uuidv7();
    writeFileSync(file, `user_id,action,new_issuer,new_subject\n${ghost},rebind,https://idp.invalid,s\n,swap,a,b\n`);
    const r = run([
      "--conditions=@mth/source",
      cli,
      "rebind-identity",
      "--mapping",
      file,
      "--operator",
      "Synthetic IT operator",
    ]);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr.split("\n").filter((l) => l !== "")).toEqual([
      "rebind-identity: refused: 2 invalid lines; nothing was changed",
      `line 2: unknown user ${ghost}`,
      "line 3: unknown user ",
    ]);
    expect((await state(target.db)).counts).toEqual(before.counts);
  }, 300_000);
});
