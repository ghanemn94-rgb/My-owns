// T-DG6-ARCH-02: generates the "P6 tables, slices J and C" section of docs/architecture/data-dictionary.md from the
// catalogue of a freshly migrated DISPOSABLE database, so the dictionary matches the migrations exactly (the
// T-DG6-ARCH-01 generator with the slice J/C table list).
//   QA_PG_PORT=<23700-23749> tests/qa/support/with-pg.sh \
//     node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/gen-dictionary.ts > <out.md>
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
const J = "0101_p6_operations_service_identities.sql";
const C = "0102_p6_storage_notification_channels.sql";
const T: Record<string, Meta> = {
  service_identity: { migration: J, module: "operations (access)", purpose: "The constrained service identity of one job queue or connector: the declared permission ceiling, the effective grant, the scope and sensitive access (REQ-S16-029; ADR-0053 §1).", writers: "job rows: a migration only (owner check); connector rows: the connector's creation (ADR-0055); the grant: `service_identity.configure` (ADM_TECH) through putServiceIdentity (column-level UPDATE)", lifecycle: "one per code; declaration fixed outside migrations; grant narrowed or restored; versioned and audited" },
  service_identity_change: { migration: J, module: "operations (access)", purpose: "Append-only history of every version of a service identity (ADR-0053 §1).", writers: "the SECURITY DEFINER trigger `service_identity_history` only", lifecycle: "append-only; one row per service_identity version" },
  operational_exception: { migration: J, module: "operations", purpose: "One visible operational exception per source and failure class while active (REQ-S12-019, M0239; ADR-0053 §2).", writers: "the worker failure hook, the connector run, the freshness scan and the API heartbeat watch (actor service; lock 730305); acknowledge and resolve: `operations.acknowledge` (ADM_TECH, KDS)", lifecycle: "open -> acknowledged | resolved; acknowledged -> resolved; resolved is final; one active row per (organization, dedup key); versioned and audited" },
  operational_exception_event: { migration: J, module: "operations", purpose: "Append-only event history of an operational exception: opened, recurred, acknowledged, resolved, updated (ADR-0053 §2).", writers: "the SECURITY DEFINER trigger `operational_exception_history` only", lifecycle: "append-only; one row per operational_exception version" },
  operational_exception_kpi: { migration: J, module: "operations", purpose: "Which KPI definitions an operational exception makes stale (same organization and transformation; ADR-0053 §2).", writers: "the exception's raising code, in its open or recur transaction (whose audit event lists the KPI ids)", lifecycle: "append-only; at most one link per exception and KPI" },
  worker_heartbeat: { migration: J, module: "operations", purpose: "The liveness beat of one worker process (A22; ADR-0053 §6). Telemetry, not a business record.", writers: "the worker every WORKER_HEARTBEAT_SECONDS (default 30)", lifecycle: "one per worker instance key; each beat advances beat_count by exactly 1; version-stepped, NOT audited" },
  storage_setting: { migration: C, module: "evidence (admin)", purpose: "The installation's evidence-storage setting: driver and, for s3, endpoint, region, bucket, prefix and credential references (REQ-S16-006; ADR-0054 §2). No row = the environment default.", writers: "`storage.configure` (ADM_TECH) through putStorageSetting (after a passing testStorageSetting; lock 730307)", lifecycle: "at most one row (singleton); created by If-Match \"0\"; versioned and audited" },
  storage_setting_change: { migration: C, module: "evidence (admin)", purpose: "Append-only history of every version of the storage setting (ADR-0054 §2).", writers: "the SECURITY DEFINER trigger `storage_setting_history` only", lifecycle: "append-only; one row per storage_setting version" },
  notification_channel: { migration: C, module: "tasks (channels)", purpose: "One optional external notification channel of an organization: email (SMTP with credential references) or enterprise messaging (port only, never enabled in P6) (REQ-S12-023; ADR-0054 §3). No row = in-app only.", writers: "`notification_channel.configure` (ADM_TECH) through putNotificationChannel", lifecycle: "one per (organization, channel kind); created by If-Match \"0\"; kind never changes; versioned and audited" },
  notification_channel_change: { migration: C, module: "tasks (channels)", purpose: "Append-only history of every version of a notification channel (ADR-0054 §3).", writers: "the SECURITY DEFINER trigger `notification_channel_history` only", lifecycle: "append-only; one row per notification_channel version" },
  notification_delivery: { migration: C, module: "tasks (channels)", purpose: "One external delivery of one inbox notification on one channel: the idempotency backstop of the fan-out (ADR-0054 §3). No message text or address is stored.", writers: "the worker fan-out handler (actor service; lock 730306)", lifecycle: "pending -> sent | failed | skipped; failed -> pending (retry); sent and skipped are final; one per (notification, channel); versioned and audited" },
};
const ORDER = Object.keys(T);
async function main(): Promise<void> {
  const c0 = new pg.Client({ connectionString: admin });
  await c0.connect();
  await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
  await c0.query(`CREATE DATABASE dict_p6ef OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await c0.end();
  const u = new URL(admin);
  u.pathname = "/dict_p6ef";
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
