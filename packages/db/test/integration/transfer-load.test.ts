// The import load on PostgreSQL (ADR-0064 Amendment 1 §A1.2-A1.5 and Amendment 2 §A2.2-A2.3; p7-work-split §C.12,
// §C.13; REQ-S19-014, REQ-S19-016; T-DG7-BE-R1, T-DG7-BE-R2): T-R1 (E1-E4 measured and their refusals), T-R2 (the
// reservation), T-R13 with T-R4 and T-R3 (the real load: carried events already present in the baseline, never
// inserted twice, recorded and reconstructed; audit_event append-only and both triggers on between the steps), T-R14
// (a shared id that is not the same event refuses), T-R5 (b) (a mismatch rolls everything back). Source: a scratch database seeded with
// the SYNTHETIC demo dataset; targets: scratch databases. Every value is synthetic. Nothing here approves anything (no
// G1-G6, Finance or IT approval) or touches DG0-DG7.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MigrationReserveError, migrate, RESERVE_NEEDS_EMPTY_DATABASE } from "../../src/migrate.ts";
import type { Db, Tx } from "../../src/pool.ts";
import { buildPlan, canonicalManifest, type LoadStep, type MigrationManifest } from "../../src/transfer/index.ts";
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

/** The ids of the source's audit rows that the target's migration baseline also holds (measured, never assumed). */
async function sharedIds(target: Db): Promise<string[]> {
  const ids = (await sql<{ id: string }>`SELECT id::text AS id FROM audit_event`.execute(source.db)).rows.map(
    (r) => r.id,
  );
  return (
    await sql<{ id: string }>`
      SELECT id::text AS id FROM audit_event WHERE id = ANY(${ids}::uuid[]) ORDER BY id::text COLLATE "C"`.execute(
      target,
    )
  ).rows.map((r) => r.id);
}

/** Steps checked by T-R4 (C.12): triggers 'O' and no UPDATE or DELETE on audit_event in the load transaction. */
const T_R4_STEPS: readonly LoadStep[] = ["L0", "L1", "L3", "L5", "L8", "L9", "L12"];

function auditGuardSpy(): { seen: LoadStep[]; onStep: (step: LoadStep, tx: Tx) => Promise<void>; bad: string[] } {
  const seen: LoadStep[] = [];
  const bad: string[] = [];
  return {
    seen,
    bad,
    onStep: async (step, tx) => {
      seen.push(step);
      const st = await sql<{ upd: string; del: string }>`
        SELECT n_tup_upd::text AS upd, n_tup_del::text AS del FROM pg_stat_xact_user_tables
         WHERE relid = 'audit_event'::regclass`.execute(tx);
      const r = st.rows[0] ?? { upd: "0", del: "0" };
      if (r.upd !== "0" || r.del !== "0") bad.push(`${step}: upd ${r.upd} del ${r.del}`);
      const trig = await sql<{ tgname: string; tgenabled: string }>`
        SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_event'::regclass AND NOT tgisinternal
        ORDER BY tgname`.execute(tx);
      const states = Object.fromEntries(trig.rows.map((x) => [x.tgname, x.tgenabled]));
      if (JSON.stringify(states) !== JSON.stringify(AUDIT_TRIGGERS_ENABLED))
        bad.push(`${step}: triggers ${JSON.stringify(states)}`);
    },
  };
}

describe("T-R13 + T-R4 + T-R3: the real load with carried events already present in the baseline (A2.2, A2.3)", () => {
  it("imports (exit 0), never inserts P twice, records P, reconstructs the trail, keeps the triggers on", async () => {
    const target = await ws.reserved("mth_ld_r13", pkg);
    const shared = await sharedIds(target.db);
    // |P| measured (handback): > 0, and every shared copy is a migration row on both sides.
    expect(shared.length).toBeGreaterThan(0);
    const baselineBefore = await baselineCounts(target.db);
    const spy = auditGuardSpy();
    const r = await importInto(target.db, pkg, { onStep: spy.onStep });
    expect(r.err, r.out.join("\n")).toEqual([]);
    expect(r.code).toBe(0);
    for (const s of T_R4_STEPS) expect(spy.seen).toContain(s);
    expect(spy.bad).toEqual([]);
    expect(r.out.at(-1)).toBe(
      `import-migration: audit history: ${shared.length} carried events were already present as identical target ` +
        "migration events (same id and content); their source seq and time are recorded in migration.imported, and " +
        "none was inserted twice",
    );
    const auditFile = manifest.tables.find((t) => t.name === "audit_event")!;
    const carriedRows = BigInt(auditFile.rowCount);
    expect(r.out[1]).toMatch(
      new RegExp(
        `^import-migration: audit history: ${carriedRows - BigInt(shared.length)} carried events \\(seq \\d+-${M}\\) ` +
          `and ${baselineBefore.n} target migration events \\(seq ${M + 1n}-\\d+\\) kept; nothing was renumbered$`,
      ),
    );
    // No P row was inserted: one row per shared id, the baseline's (seq above M).
    const perId = await sql<{ id: string; n: string; seq: string }>`
      SELECT id::text AS id, count(*)::text AS n, min(seq)::text AS seq FROM audit_event
       WHERE id = ANY(${shared}::uuid[]) GROUP BY id`.execute(target.db);
    expect(perId.rows).toHaveLength(shared.length);
    for (const row of perId.rows) {
      expect(row.n).toBe("1");
      expect(BigInt(row.seq)).toBeGreaterThan(M);
    }
    // migration_import, the delta and the event.
    const imp = await target.db.selectFrom("migration_import").selectAll().executeTakeFirstOrThrow();
    expect(imp.audit_already_present_rows).toBe(String(shared.length));
    expect(imp.audit_carried_rows).toBe(String(carriedRows));
    expect(imp.audit_baseline_rows).toBe(baselineBefore.n);
    expect(BigInt(imp.audit_baseline_seq_min!)).toBe(M + 1n);
    const run = await target.db
      .selectFrom("migration_reconciliation")
      .select(["id", "result", "rows_expected", "rows_actual"])
      .where("migration_import_id", "=", imp.id)
      .executeTakeFirstOrThrow();
    expect(run.result).toBe("matched");
    const deltas = await target.db
      .selectFrom("migration_reconciliation_delta")
      .selectAll()
      .where("migration_reconciliation_id", "=", run.id)
      .orderBy("basis")
      .execute();
    expect(deltas.find((d) => d.basis === "audit_already_present")).toMatchObject({
      table_name: "audit_event",
      rows_added: "0",
      rows_changed: String(shared.length),
      rows_missing: "0",
      allowed: true,
    });
    const auditRow = await target.db
      .selectFrom("migration_reconciliation_table")
      .selectAll()
      .where("migration_reconciliation_id", "=", run.id)
      .where("table_name", "=", "audit_event")
      .executeTakeFirstOrThrow();
    expect(auditRow.actual_rows).toBe(String(carriedRows));
    expect(auditRow.actual_digest).toBe(auditFile.contentDigest);
    expect(auditRow.matched).toBe(true);
    const ev = await sql<{
      changes: {
        auditAlreadyPresent: {
          from: null;
          to: { rows: string; entries: { id: string; sourceSeq: string; sourceOccurredAt: string }[] };
        };
      };
    }>`
      SELECT changes FROM audit_event WHERE action = 'migration.imported'`.execute(target.db);
    expect(ev.rows).toHaveLength(1);
    const entries = ev.rows[0]!.changes.auditAlreadyPresent.to.entries;
    expect(ev.rows[0]!.changes.auditAlreadyPresent.to.rows).toBe(String(shared.length));
    expect(entries.map((e) => e.id)).toEqual(shared);
    const pkgLines = new Map(
      readFileSync(join(pkg, auditFile.file), "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => {
          const o = JSON.parse(l) as { id: string; seq: string; occurred_at: string };
          return [o.id, o] as const;
        }),
    );
    for (const e of entries) {
      expect(e.sourceSeq).toBe(pkgLines.get(e.id)!.seq);
      expect(e.sourceOccurredAt).toBe(pkgLines.get(e.id)!.occurred_at);
    }
    // T-R3: every other carried row equals the source's row by row, including id and seq.
    const rowsOf = async (db: Db, where: string) =>
      (
        await sql<{ r: string }>`${sql.raw(
          `SELECT a::text AS r FROM audit_event a WHERE ${where} ORDER BY seq`,
        )}`.execute(db)
      ).rows.map((x) => x.r);
    const notShared = `NOT (id = ANY('{${shared.join(",")}}'::uuid[]))`;
    expect(await rowsOf(target.db, `seq <= ${M} AND ${notShared}`)).toEqual(await rowsOf(source.db, notShared));
    // The baseline (P rows included) is unchanged by the load.
    const after = await sql<{ n: string; lo: string; hi: string }>`
      SELECT count(*)::text AS n, min(seq)::text AS lo, max(seq)::text AS hi FROM audit_event
       WHERE seq > ${M.toString()}::bigint AND seq <= ${imp.audit_baseline_seq_max}::bigint`.execute(target.db);
    expect(after.rows[0]).toEqual({
      n: imp.audit_baseline_rows,
      lo: imp.audit_baseline_seq_min,
      hi: imp.audit_baseline_seq_max,
    });
    // Ranges do not interleave: the import's own events come after the baseline.
    const own = await sql<{ lo: string }>`
      SELECT min(seq)::text AS lo FROM audit_event WHERE seq > ${imp.audit_baseline_seq_max}::bigint`.execute(
      target.db,
    );
    expect(BigInt(own.rows[0]!.lo)).toBeGreaterThan(BigInt(imp.audit_baseline_seq_max!));
    const actions = await sql<{ action: string }>`
      SELECT DISTINCT action FROM audit_event WHERE seq > ${imp.audit_baseline_seq_max}::bigint ORDER BY 1`.execute(
      target.db,
    );
    for (const a of actions.rows)
      expect(["identity.binding_held", "migration.imported", "migration.reconciled"]).toContain(a.action);
    expect((await state(target.db)).triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
    if (manifest.demoChecksum !== null) expect(imp.demo_checksum).toBe(manifest.demoChecksum);
    // Recorded for the handback (|P| measured on this release).
    console.info(`T-R13 measured |P| = ${shared.length}`);
  }, 900_000);

  it("pins A2.1: audit_event has the enumerated columns (17 measured), so E5 compares all but seq and occurred_at", async () => {
    const plan = await buildPlan(source.db);
    const cols = plan.tables.find((t) => t.name === "audit_event")!.columns.map((c) => c.name);
    // A2.1 says "15 columns in total" but enumerates 15 compared names plus seq and occurred_at: the catalogue
    // measures 17 (T-DG7-BE-R2 handback, open question). The pin is on the enumerated list, so any new column fails.
    expect(cols).toHaveLength(17);
    expect(cols.filter((c) => c !== "seq" && c !== "occurred_at")).toEqual(
      [
        "id",
        "organization_id",
        "transformation_id",
        "actor_type",
        "actor_user_id",
        "on_behalf_of_user_id",
        "action",
        "record_type",
        "record_id",
        "prior_version",
        "new_version",
        "reason",
        "request_id",
        "source",
        "changes",
      ].filter((c) => cols.includes(c)),
    );
    expect(cols.filter((c) => c !== "seq" && c !== "occurred_at").sort()).toEqual(
      [
        "id",
        "organization_id",
        "transformation_id",
        "actor_type",
        "actor_user_id",
        "on_behalf_of_user_id",
        "action",
        "record_type",
        "record_id",
        "prior_version",
        "new_version",
        "reason",
        "request_id",
        "source",
        "changes",
      ].sort(),
    );
  });
});

/** A copy of the package whose audit_event line for `id` is rewritten by `edit`, with fileSha256/contentDigest redone. */
function tamperedAuditLine(id: string, edit: (row: Record<string, unknown>) => void): string {
  const dir = ws.copyPackage(pkg);
  const t = manifest.tables.find((x) => x.name === "audit_event")!;
  const path = join(dir, t.file);
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  const out = lines.map((l) => {
    const row = JSON.parse(l) as Record<string, unknown>;
    if (row["id"] !== id) return l;
    edit(row);
    // jsonb text keeps PostgreSQL's spacing; re-encode only the edited text column, keep the changes text verbatim.
    const changesAt = l.indexOf(',"changes":');
    const head = JSON.stringify({ ...row, changes: null }).replace(/,"changes":null\}$/, "");
    return `${head}${l.slice(changesAt)}`;
  });
  const bytes = `${out.join("\n")}\n`;
  writeFileSync(path, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const next = {
    ...manifest,
    tables: manifest.tables.map((x) => (x.name === "audit_event" ? { ...x, fileSha256: sha, contentDigest: sha } : x)),
  };
  writeFileSync(join(dir, "manifest.json"), canonicalManifest(next));
  return dir;
}

describe("T-R14: a shared-id carried event that is not the same event refuses the import (A2.2, A2.7)", () => {
  it("a differing reason, and a source copy that is not a baseline event: exit 1, both lines, nothing changed", async () => {
    const target = await ws.reserved("mth_ld_r14", pkg);
    const shared = await sharedIds(target.db);
    const id = shared[0]!;
    const cases: [string, (row: Record<string, unknown>) => void, string][] = [
      [
        "reason",
        (row) => (row["reason"] = `${String(row["reason"] ?? "")} (synthetic difference)`),
        `import-migration: ${id}: differs in reason`,
      ],
      [
        "source",
        (row) => (row["source"] = "api"),
        `import-migration: ${id}: not a migration baseline event on the source`,
      ],
    ];
    for (const [label, edit, line] of cases) {
      const dir = tamperedAuditLine(id, edit);
      const before = await state(target.db);
      const r = await importInto(target.db, dir);
      expect(r.code, `${label}: ${r.err.join("\n")}`).toBe(1);
      expect(r.err).toEqual([
        "import-migration: failed: 1 carried audit events share their id with a target audit event but are not the " +
          "same event; nothing was imported",
        line,
      ]);
      expect(await state(target.db), label).toEqual(before);
      expect(before.triggers).toEqual(AUDIT_TRIGGERS_ENABLED);
      expect(before.counts["migration_import"]).toBe("0");
    }
  }, 900_000);
});

describe("T-R5 (b): a changed loaded row at L8 makes the reconciliation mismatch and rolls everything back", () => {
  it("exit 4 with the C.5 line; counts, trail and triggers unchanged; no migration_import", async () => {
    const target = await ws.reserved("mth_ld_r5", pkg);
    const before = await state(target.db);
    const onStep = async (step: LoadStep, tx: Tx) => {
      if (step !== "L8") return;
      await sql`UPDATE organization SET name_en = name_en || ' (changed)' WHERE id = (SELECT min(id::text)::uuid FROM organization)`.execute(
        tx,
      );
    };
    const r = await importInto(target.db, pkg, { onStep });
    expect(r.code).toBe(4);
    expect(r.err).toEqual([
      "import-migration: reconciliation mismatch: 1 tables, 0 attachments differ; nothing was imported",
    ]);
    expect(r.out.some((l) => l.startsWith("  organization: expected "))).toBe(true);
    expect(await state(target.db)).toEqual(before);
  }, 900_000);
});
