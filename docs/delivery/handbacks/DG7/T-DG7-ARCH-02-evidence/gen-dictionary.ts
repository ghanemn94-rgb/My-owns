// T-DG7-ARCH-02: generates the "P7 tables, slices C and D" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG6-ARCH-02 generator with the slice C/D table list).
//   QA_PG_PORT=<24700-24749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG7/T-DG7-ARCH-02-evidence/gen-dictionary.ts > <out.md>
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const pg = createRequire(new URL("../../../../../packages/db/package.json", import.meta.url))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const migrationsDir = new URL("../../../../../packages/db/migrations", import.meta.url).pathname;

interface Meta {
  migration: string;
  purpose: string;
  module: string;
  writers: string;
  lifecycle: string;
}
const C = "0133_p7_transfer_migration_manifest.sql";
const D = "0134_p7_config_bundles.sql";
const CLI = "the migration CLI only (`mth-db import-migration` / `reconcile-migration`, as mth_owner; lock 730403)";
const T: Record<string, Meta> = {
  transfer_table_rule: { migration: C, module: "transfer", purpose: "The tables a migration package never carries, each with its rule and reason (ADR-0064 §3; D-243 Q16). Every other public base table is exported.", writers: "migrations only (`mth_app` reads)", lifecycle: "append-only; a migration adding a table that must not travel adds its row" },
  transfer_column_rule: { migration: C, module: "transfer", purpose: "The SecretRef columns whose provider the export rewrites to `unbound` (ADR-0064 §4).", writers: "migrations only (`mth_app` reads)", lifecycle: "append-only; the catalogue test fails when a SecretRef column has no row" },
  migration_export: { migration: C, module: "transfer (export)", purpose: "One whole-installation migration export request, its counts, the manifest and attachment-manifest SHA-256, the source environment marker and, for a demo source only, the ADR-0050 demo checksum (REQ-S19-016; ADR-0064 §7; D-244 O2).", writers: "`migration.export` (ADM_TECH) through createMigrationExport; the worker job `transfer.export` (lock 730402); the CLI `mth-db export-migration` (requested_via cli). Column-level UPDATE of the status, results and version columns only", lifecycle: "queued -> running | failed; running -> succeeded | failed; succeeded and failed are immutable; versioned and audited" },
  migration_import: { migration: C, module: "transfer (import)", purpose: "The one import of a migration package into this (formerly empty) installation: the manifest it loaded, its checksums, environment marker, demo checksum and counts (REQ-S19-014, REQ-S19-016; ADR-0064 §6).", writers: CLI, lifecycle: "written once at the end of a matched load, in its transaction; append-only; audited (migration.imported)" },
  migration_reconciliation: { migration: C, module: "transfer (import)", purpose: "One reconciliation run of an import: at import, or a re-check; totals and result (REQ-S19-014; ADR-0064 §6 step 8).", writers: CLI, lifecycle: "append-only; one `import` run per import; audited (migration.reconciled)" },
  migration_reconciliation_table: { migration: C, module: "transfer (import)", purpose: "Per manifest table: expected and actual row counts and content digests of one reconciliation run.", writers: CLI, lifecycle: "append-only; one row per (run, table)" },
  migration_reconciliation_attachment: { migration: C, module: "transfer (import)", purpose: "Each evidence object that was missing or whose size or SHA-256 differed in one reconciliation run (no bytes, no record id).", writers: CLI, lifecycle: "append-only; only mismatches are recorded" },
  identity_binding_hold: { migration: C, module: "transfer (identity)", purpose: "The identity binding of a user carried by an import: unbound users cannot sign in until IT applies a mapping line (master prompt l.562; ADR-0064 §8).", writers: "the import (one unbound row per user) and `mth-db rebind-identity` (lock 730404), as mth_owner; `mth_app` reads (the sign-in check)", lifecycle: "unbound -> rebound | retained; both final; versioned and audited" },
  identity_rebind_event: { migration: C, module: "transfer (identity)", purpose: "The append-only history of every applied mapping line: the old and new issuer and subject and the mapping file's SHA-256.", writers: "`mth-db rebind-identity` only (mth_owner)", lifecycle: "append-only; one row per hold" },
  config_bundle_export: { migration: D, module: "transfer (config-bundle)", purpose: "One exported configuration bundle of an organization: kinds, item count, size and SHA-256; the bytes are an EvidenceStore object (REQ-S19-008; ADR-0065 §3).", writers: "`config_bundle.export` (ADM_TECH, ADM_METHOD) through createConfigBundleExport", lifecycle: "written once; append-only; audited" },
  config_bundle_import: { migration: D, module: "transfer (config-bundle)", purpose: "One uploaded configuration bundle into an organization, its validation counts and commit (REQ-S19-008; ADR-0065 §4). An unknown bundleSchemaVersion is refused and never stored.", writers: "`config_bundle.import` (ADM_TECH, ADM_METHOD) through upload, validate and commit (lock 730405). Column-level UPDATE of the status, counts, validation and commit columns only", lifecycle: "uploaded -> validated | invalid; validated -> validated | invalid | committed; invalid and committed are final; versioned and audited" },
  config_bundle_import_item: { migration: D, module: "transfer (config-bundle)", purpose: "One bundle item of one validation run with its planned action (create_draft, new_draft, identical, conflict, refused) and problem code (ADR-0065 §4).", writers: "validateConfigBundleImport", lifecycle: "append-only; one set per validation run" },
  config_bundle_import_commit: { migration: D, module: "transfer (config-bundle)", purpose: "The record a committed bundle item created: a draft for the seven drafting kinds, the kind's own change for the five others (ADR-0065 §5).", writers: "commitConfigBundleImport", lifecycle: "append-only; only create_draft and new_draft items (trigger)" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p7cd OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p7cd";
  u.searchParams.set("options", "-c role=mth_owner");
  await migrate(u.toString(), { dir: migrationsDir });
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const out: string[] = [];
  for (const t of ORDER) {
    const m = T[t]!;
    const priv = await c.query(
      `SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants
       WHERE grantee = 'mth_app' AND table_schema = 'public' AND table_name = $1`, [t]);
    out.push(`## ${t}`, "");
    out.push(`- **Purpose:** ${m.purpose}`);
    out.push(`- **Migration:** \`${m.migration}\`. **API module:** \`${m.module}\`. **Who writes:** ${m.writers}. **Lifecycle:** ${m.lifecycle}.`);
    out.push(`- **\`mth_app\` privileges:** ${priv.rows[0].p ?? "none"}.`, "");
    const cols = await c.query(
      `SELECT a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t]);
    const cons = await c.query(
      `SELECT conname, contype, conkey, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`, [t]);
    const colCons = new Map<number, string[]>();
    const tableCons: string[] = [];
    const kind: Record<string, string> = { c: "CHECK", u: "UNIQUE", f: "FK", p: "PK", x: "EXCLUDE" };
    for (const k of cons.rows) {
      if (k.contype === "t") continue; // constraint triggers are listed under Triggers
      k.def = k.def.replaceAll("::text", "");
      const single = k.conkey && k.conkey.length === 1;
      let text: string | null = null;
      if (single && k.contype === "p") text = "PK";
      else if (single && k.contype === "f") {
        const m2 = /REFERENCES (\w+)\((\w+)\)/.exec(k.def);
        text = m2 ? `FK → ${m2[1]}(${m2[2]})` : null;
      } else if (single && k.contype === "c" && k.conname.endsWith("_check")) text = `\`${k.def}\``;
      if (text) {
        const arr = colCons.get(k.conkey[0]) ?? [];
        arr.push(text);
        colCons.set(k.conkey[0], arr);
      } else tableCons.push(`- \`${k.conname}\` (${kind[k.contype] ?? k.contype}): \`${k.def}\``);
    }
    out.push("| Column | Type | Null | Default | Column constraints |", "|---|---|---|---|---|");
    for (const col of cols.rows)
      out.push(`| ${col.name} | ${col.type} | ${col.nn ? "NOT NULL" : "NULL"} | ${col.def ? `\`${String(col.def).replaceAll("::text", "")}\`` : ""} | ${(colCons.get(col.attnum) ?? []).join("; ")} |`);
    out.push("");
    if (tableCons.length) out.push("**Table constraints:**", "", ...tableCons, "");
    const idx = await c.query(
      `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS def FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = $1::regclass AND NOT x.indisprimary
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = x.indexrelid) ORDER BY 1`, [t]);
    if (idx.rowCount) {
      out.push("**Indexes:**", "");
      for (const r of idx.rows) {
        const uniq = /CREATE UNIQUE INDEX/.test(r.def) ? "UNIQUE " : "";
        out.push(`- \`${r.name}\`: \`${uniq}${r.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING btree /, "").replaceAll("::text", "")}\``);
      }
      out.push("");
    }
    const trg = await c.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`, [t]);
    if (trg.rowCount) {
      out.push("**Triggers:**", "");
      for (const r of trg.rows) {
        const d = r.def
          .replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, (_m: string, ct: string | undefined) => (ct ? "CONSTRAINT " : ""))
          .replace(/ ON public\.\S+/, "")
          .replace(/ EXECUTE FUNCTION (\S+)$/, " → `$1`");
        out.push(`- \`${r.tgname}\`: ${d}`);
      }
      out.push("");
    }
  }
  console.log(out.join("\n"));
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
