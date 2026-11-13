// The recheck of an imported target on PostgreSQL (ADR-0064 A1.9 with Amendment 2 §A2.3, §A2.6; p7-work-split §C.12,
// §C.13; REQ-S19-014, REQ-S19-017; T-DG7-BE-R2): T-R6 (mode 1 after the import and a rebind), T-R7 and T-R15 (mode 2
// with tables, audited and the allowance refusals), T-R8 (the attachment report rules of the recheck), T-R17 (the
// table digest). Source: a scratch database seeded with the SYNTHETIC demo dataset; target: a scratch database
// prepared with the reservation and loaded by import-migration. Every value is synthetic. Nothing here approves
// anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/pool.ts";
import {
  ALLOWANCE_SCHEMA_VERSION,
  applyRebind,
  MAPPING_HEADER,
  pinEncoderSettings,
  runReconcileMigrationCommand,
  runTableDigestCommand,
  tableDigest,
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
let dir: string;
let audited: string;
let auditedId: string;
let actor: string;
let other: string;

async function recheck(
  opts: { afterUse?: boolean; allow?: unknown; attachmentsReport?: string } = {},
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  let allow: string | undefined;
  if (opts.allow !== undefined) {
    allow = join(dir, `allow-${uuidv7()}.json`);
    writeFileSync(allow, typeof opts.allow === "string" ? opts.allow : JSON.stringify(opts.allow));
  }
  const code = await runReconcileMigrationCommand(
    target.db,
    {
      operator: "Synthetic IT operator",
      ...(opts.afterUse === true ? { afterUse: true, from: pkg, allow } : {}),
      ...(opts.attachmentsReport !== undefined ? { attachmentsReport: opts.attachmentsReport } : {}),
    },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  return { code, out, err };
}

const allowance = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ALLOWANCE_SCHEMA_VERSION,
  actors: [],
  tables: [],
  audited: [],
  children: [],
  operational: [],
  ...over,
});

const lastDeltas = async (db: Db) => {
  const run = await db
    .selectFrom("migration_reconciliation")
    .select(["id", "run_kind", "result"])
    .orderBy("run_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirstOrThrow();
  const deltas = await db
    .selectFrom("migration_reconciliation_delta")
    .selectAll()
    .where("migration_reconciliation_id", "=", run.id)
    .orderBy("table_name")
    .orderBy("basis")
    .execute();
  return { run, deltas };
};

/** An audited change of one row of `audited` by `by`, with its audit event (the p2_audit_required rule). */
async function auditedChange(by: string): Promise<void> {
  await target.db.transaction().execute(async (tx) => {
    const v = (
      await sql<{ version: number; organization_id: string | null }>`${sql.raw(
        `UPDATE ${audited} SET version = version + 1 WHERE id = '${auditedId}' RETURNING version, ` + "organization_id",
      )}`.execute(tx)
    ).rows[0]!;
    await tx
      .insertInto("audit_event")
      .values({
        id: uuidv7(),
        actor_type: "user",
        actor_user_id: by,
        organization_id: v.organization_id,
        action: `${audited}.update`,
        record_type: audited,
        record_id: auditedId,
        prior_version: v.version - 1,
        new_version: v.version,
        source: "api",
      })
      .execute();
  });
}

beforeAll(async () => {
  source = await ws.demoSource("mth_rc_source");
  const exported = await ws.exportPackage(source.db);
  pkg = exported.dir;
  manifest = exported.result.manifest;
  dir = ws.tempDir("mth-recheck-");
  target = await ws.reserved("mth_rc_target", pkg);
  const r = await importInto(target.db, pkg);
  if (r.code !== 0) throw new Error(`import failed: ${r.err.join("\n")}`);
  // An audited table (its p2_audit_required trigger, 0010) with version and organization_id: benefit (0037), measured.
  const trig = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM pg_trigger WHERE tgname = 'benefit_audit_required' AND tgenabled = 'O'`.execute(
    target.db,
  );
  if (trig.rows[0]!.n !== "1") throw new Error("benefit_audit_required is not an enabled trigger");
  audited = "benefit";
  auditedId = (await sql<{ id: string }>`${sql.raw(`SELECT min(id::text) AS id FROM ${audited}`)}`.execute(target.db))
    .rows[0]!.id;
  const users = await target.db.selectFrom("app_user").select("id").orderBy("id").limit(2).execute();
  actor = users[0]!.id;
  other = users[1]!.id;
}, 900_000);

afterAll(async () => {
  await ws.close();
}, 120_000);

describe("T-R17: tableDigest equals the export's contentDigest", () => {
  it("for exported tables; --rows hashes each line; a non-exported table is refused with its line", async () => {
    for (const name of ["organization", "app_user", "audit_event"]) {
      const d = await source.db.transaction().execute(async (tx) => {
        await pinEncoderSettings(tx);
        return tableDigest(tx, name, { rows: true });
      });
      const m = manifest.tables.find((t) => t.name === name)!;
      expect(d.digest, name).toBe(m.contentDigest);
      expect(d.rows).toBe(m.rowCount);
      expect(d.lines).toHaveLength(Number(m.rowCount));
      for (const l of d.lines!) expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    expect(await runTableDigestCommand(source.db, { tables: ["organization"], rows: false }, io)).toBe(0);
    const parsed = JSON.parse(out[0]!) as { schemaVersion: string; tables: { digest: string }[] };
    expect(parsed.schemaVersion).toBe("mth-table-digest/1");
    expect(parsed.tables[0]!.digest).toBe(manifest.tables.find((t) => t.name === "organization")!.contentDigest);
    expect(await runTableDigestCommand(source.db, { tables: ["session"], rows: false }, io)).toBe(2);
    expect(err).toEqual(["table-digest: refused: session is not an exported table"]);
  }, 300_000);
});

describe("T-R6: mode 1 after the import and a rebind", () => {
  it("matched with audit_baseline, audit_already_present, audit_additions and rebind deltas, all allowed", async () => {
    const mapping = `${MAPPING_HEADER}\n${actor},rebind,https://idp.example.test/synthetic,synthetic-subject-1\n`;
    await applyRebind(target.db, new TextEncoder().encode(mapping), "Synthetic IT operator");
    const r = await recheck();
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toBe("reconcile-migration: matched");
    expect(r.out.some((l) => /^ {2}audit_event: \d+ migration\.reconciled added since the import$/.test(l))).toBe(true);
    const { run, deltas } = await lastDeltas(target.db);
    expect(run).toMatchObject({ run_kind: "recheck", result: "matched" });
    const bases = deltas.map((d) => `${d.table_name}:${d.basis}:${String(d.allowed)}`);
    expect(bases).toEqual(
      expect.arrayContaining([
        "audit_event:audit_baseline:true",
        "audit_event:audit_already_present:true",
        "audit_event:audit_additions:true",
        "user_identity:rebind:true",
      ]),
    );
    expect(deltas.find((d) => d.basis === "rebind")!.rows_changed).toBe("1");
  }, 300_000);

  it("a further edit of the rebound identity's pair is unexplained (exit 4)", async () => {
    await target.db.transaction().execute(async (tx) => {
      await sql`ALTER TABLE user_identity DISABLE TRIGGER USER`.execute(tx);
      await sql`UPDATE user_identity SET subject = 'synthetic-subject-2' WHERE subject = 'synthetic-subject-1'`.execute(
        tx,
      );
      await sql`ALTER TABLE user_identity ENABLE TRIGGER USER`.execute(tx);
    });
    const r = await recheck();
    expect(r.code).toBe(4);
    expect(r.out.at(-1)).toMatch(/^reconcile-migration: mismatch: 1 tables, 0 attachments differ$/);
    expect((await lastDeltas(target.db)).deltas.find((d) => d.table_name === "user_identity")!.basis).toBe(
      "unexplained",
    );
    await target.db.transaction().execute(async (tx) => {
      await sql`ALTER TABLE user_identity DISABLE TRIGGER USER`.execute(tx);
      await sql`UPDATE user_identity SET subject = 'synthetic-subject-1' WHERE subject = 'synthetic-subject-2'`.execute(
        tx,
      );
      await sql`ALTER TABLE user_identity ENABLE TRIGGER USER`.execute(tx);
    });
    expect((await recheck()).code).toBe(0);
  }, 300_000);

  it("an owner UPDATE of one non-audit row: exit 4 naming the table", async () => {
    await auditedChange(actor);
    const r = await recheck();
    expect(r.code).toBe(4);
    expect(r.out.some((l) => l.startsWith(`  ${audited}: expected `))).toBe(true);
  }, 300_000);
});

describe("T-R7 + T-R15: mode 2 (--after-use) with mth-recheck-allowance/2", () => {
  // State here: the rebind of `actor`, and one audited change of `audited` row `auditedId` by `actor`.
  const changedKey = () => [[auditedId]];

  it("audited: the change by a listed actor is explained (exit 0 and the line); by another actor it is not", async () => {
    let r = await recheck({
      afterUse: true,
      allow: allowance({
        actors: [actor],
        audited: [{ name: audited, mustInclude: { added: [], changed: changedKey() } }],
      }),
    });
    expect(r.err, r.out.join("\n")).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toMatch(
      /^reconcile-migration: matched after use: \d+ tables unchanged, 2 tables with allowed differences, \d+ audit events added since the import$/,
    );
    const { run, deltas } = await lastDeltas(target.db);
    expect(run).toMatchObject({ run_kind: "recheck_after_use", result: "matched" });
    expect(deltas.find((d) => d.table_name === audited)).toMatchObject({
      basis: "audit_explained",
      rows_changed: "1",
      allowed: true,
    });
    r = await recheck({
      afterUse: true,
      allow: allowance({
        actors: [other],
        audited: [{ name: audited, mustInclude: { added: [], changed: [] } }],
      }),
    });
    expect(r.code).toBe(4);
    expect(r.out).toContain(`  ${audited}: 0 added, 1 changed, 0 missing (audit_explained)`);
    expect(r.out).toContain(`    unexplained changed ${JSON.stringify([auditedId])}`);
  }, 300_000);

  it("audited mustInclude: a key not changed gives 'expected but not'", async () => {
    const r = await recheck({
      afterUse: true,
      allow: allowance({
        actors: [actor],
        audited: [{ name: audited, mustInclude: { added: [[uuidv7()]], changed: changedKey() } }],
      }),
    });
    expect(r.code).toBe(4);
    expect(r.out.some((l) => l.startsWith("    expected but not added "))).toBe(true);
  }, 300_000);

  it("tables (exact_ids): exactly the keys pass; a missing listing is unexpected; an extra listing is expected but not", async () => {
    let r = await recheck({
      afterUse: true,
      allow: allowance({ tables: [{ name: audited, added: [], changed: changedKey() }] }),
    });
    expect(r.code, r.out.join("\n")).toBe(0);
    r = await recheck({ afterUse: true, allow: allowance({ tables: [{ name: audited, added: [], changed: [] }] }) });
    expect(r.code).toBe(4);
    expect(r.out).toContain(`    unexpected changed ${JSON.stringify([auditedId])}`);
    const ghost = uuidv7();
    r = await recheck({
      afterUse: true,
      allow: allowance({ tables: [{ name: audited, added: [[ghost]], changed: changedKey() }] }),
    });
    expect(r.code).toBe(4);
    expect(r.out).toContain(`    expected but not added ${JSON.stringify([ghost])}`);
  }, 300_000);

  it("a table not listed is unexplained (exit 4 with the per-table line)", async () => {
    const r = await recheck({ afterUse: true, allow: allowance() });
    expect(r.code).toBe(4);
    expect(r.out).toContain(`  ${audited}: 0 added, 1 changed, 0 missing (unexplained)`);
  }, 300_000);

  it("every allowance refusal exits 2 with its line (A1.9 rule 7, A2.6 rule 6)", async () => {
    const refused = async (allow: unknown, reason: string) => {
      const r = await recheck({ afterUse: true, allow });
      expect(r.code, reason).toBe(2);
      expect(r.err, reason).toEqual([`reconcile-migration: refused: invalid allowance file: ${reason}`]);
    };
    await refused(
      { ...allowance(), schemaVersion: "mth-recheck-allowance/1" },
      "unsupported schema version 'mth-recheck-allowance/1'",
    );
    const { operational: _o, ...noOperational } = allowance();
    await refused(noOperational, "missing key 'operational'");
    const ghost = uuidv7();
    await refused(allowance({ actors: [ghost] }), `unknown actor ${ghost}`);
    await refused(
      allowance({ audited: [{ name: audited, mustInclude: { added: [], changed: [] } }] }),
      "actors is empty but audited is not",
    );
    await refused(
      allowance({
        tables: [{ name: audited, added: [], changed: [] }],
        audited: [{ name: audited, mustInclude: { added: [], changed: [] } }],
        actors: [actor],
      }),
      `${audited} is listed more than once`,
    );
    await refused(allowance({ operational: ["organization"] }), "organization is not an operational table");
    await refused(
      allowance({ tables: [{ name: "job_run", added: [], changed: [] }], operational: ["job_run"] }),
      "job_run is listed both in tables and in operational",
    );
    await refused(
      allowance({ tables: [{ name: "nosuch_table", added: [], changed: [] }] }),
      "unknown table nosuch_table",
    );
    await refused(allowance({ tables: [{ name: "session", added: [], changed: [] }] }), "excluded table session");
    await refused(
      allowance({ tables: [{ name: audited, added: [[1]], changed: [] }] }),
      `malformed key tuple in ${audited}`,
    );
    await refused(
      allowance({ tables: [{ name: audited, added: [["a", "b"]], changed: [] }] }),
      `malformed key tuple in ${audited}`,
    );
    await refused(
      allowance({ children: [{ name: "benefit", parent: "benefit", fkey: "no_such_fkey" }] }),
      "child table benefit has an _audit_required trigger; list it under audited",
    );
  }, 300_000);
});
