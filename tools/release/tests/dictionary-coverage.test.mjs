// T-F1, T-F2, T-F3 (p7-work-split §F.2; ADR-0070 §1, §1.1): tools/release/dictionary-coverage.mjs against a
// DISPOSABLE PostgreSQL cluster (tests/qa/support/pg-port.sh: a port from the 24000-31999 policy, 127.0.0.1 only, no
// unix socket) and fixture dictionaries. Uses TEST_DATABASE_ADMIN_URL when set (for example under
// tests/qa/support/with-pg.sh); otherwise starts and removes its own cluster. Without PostgreSQL binaries the suite is
// reported as BLOCKED (skipped with that reason; MTH_REQUIRE_PG=1 turns it into a failure): never a silent pass.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "dictionary-coverage.mjs");
const PGBIN =
  process.env.PGBIN ||
  (existsSync("/usr/lib/postgresql")
    ? readdirSync("/usr/lib/postgresql")
        .sort((a, b) => Number(a) - Number(b))
        .map((v) => `/usr/lib/postgresql/${v}/bin`)
        .at(-1)
    : undefined);
const HAVE_PG = !!process.env.TEST_DATABASE_ADMIN_URL || (!!PGBIN && existsSync(join(PGBIN, "initdb")));
const BLOCKED = HAVE_PG ? false : "BLOCKED: PostgreSQL server binaries not found (set PGBIN or TEST_DATABASE_ADMIN_URL)";
if (BLOCKED && process.env.MTH_REQUIRE_PG === "1") throw new Error(BLOCKED);

const MIGRATION_SQL = "-- fixture migration\n";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const DICT = `# Fixture dictionary

## Global rules

Not a table.

## schema_migration

| Column | Type | Constraints |
|---|---|---|
| id | integer | PK |
| name | text | UNIQUE |
| sha256 | character(64) | |

## widget (fixture table; a comment after the name)

| Column | Type | Null | Default | Column constraints |
|---|---|---|---|---|
| id | uuid | NOT NULL |  | PK |
| label | text | NOT NULL |  | \`widget_label_check\` |
| note | text | NULL |  |  |

## widget_view

| Column | Type |
|---|---|
| id | uuid |
`;
const PGBOSS = `# pgboss

## pgboss.job

| Column | Type | Null |
|---|---|---|
| id | uuid | NOT NULL |
| name | text | NULL |
`;
const ERD = `# ERD

## 1. Physical

\`\`\`mermaid
erDiagram
    widget ||--o{ widget_view : "projects"
    widget {
        uuid id PK
    }
\`\`\`

## 2. Conceptual

\`\`\`mermaid
erDiagram
    CONCEPT ||--o{ OTHER : "not checked"
\`\`\`
`;

let cluster = null;
let base = null; // postgresql://postgres@127.0.0.1:<port>
let work = null;

function startCluster() {
  const dir = tmp("dict-pg");
  const script = `
set -euo pipefail
. "${join(REPO, "tests", "qa", "support", "pg-port.sh")}"
as_pg() { if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi; }
chmod 777 "${dir}"
as_pg "${PGBIN}/initdb" -D "${dir}/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
PG_PID=""
mth_pg_start "${PGBIN}" "${dir}/pg" "${dir}/pg.log" "\${DICT_PG_PORT:-24391}" DICT_PG_STRICT_PORT PG_PID >&2
echo "$MTH_PG_PORT $PG_PID"
`;
  const out = execFileSync("bash", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim()
    .split(/\s+/);
  return { dir, port: out[0], pid: Number(out[1]) };
}

async function sql(database, text) {
  const pg = createRequire(join(REPO, "packages", "db", "package.json"))("pg");
  const c = new pg.Client({ connectionString: `${base}/${database}` });
  for (let i = 0; ; i++) {
    try {
      await c.connect();
      break;
    } catch (e) {
      if (i > 40) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    await c.query(text);
  } finally {
    await c.end();
  }
}

describe("dictionary-coverage against a disposable PostgreSQL (T-F1, T-F2, T-F3)", { skip: BLOCKED }, () => {
  const DB = `dict_cov_${process.pid}`;
  before(async () => {
    if (process.env.TEST_DATABASE_ADMIN_URL) {
      base = process.env.TEST_DATABASE_ADMIN_URL.replace(/\/[^/?]*(\?.*)?$/, "");
    } else {
      cluster = startCluster();
      base = `postgresql://postgres@127.0.0.1:${cluster.port}`;
    }
    await sql("postgres", `CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    await sql(
      DB,
      `CREATE TABLE schema_migration (id integer PRIMARY KEY, name text NOT NULL UNIQUE, sha256 char(64) NOT NULL);
       INSERT INTO schema_migration VALUES (1, '0001_base.sql', '${sha(MIGRATION_SQL)}');
       CREATE TABLE widget (id uuid PRIMARY KEY, label text NOT NULL CONSTRAINT widget_label_check CHECK (label <> ''),
                            note text);
       CREATE INDEX widget_note_idx ON widget (note);
       CREATE VIEW widget_view AS SELECT id FROM widget;
       CREATE SCHEMA pgboss;
       CREATE TABLE pgboss.job (id uuid NOT NULL, name text);`,
    );
    work = tmp("dict-fx");
    mkdirSync(join(work, "migrations"));
    writeFileSync(join(work, "migrations", "0001_base.sql"), MIGRATION_SQL);
  });
  after(async () => {
    if (base) await sql("postgres", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => {});
    if (cluster) {
      try {
        process.kill(cluster.pid, "SIGINT");
      } catch {}
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(cluster.pid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          break;
        }
      }
      rmSync(cluster.dir, { recursive: true, force: true });
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  const runWith = ({ dict = DICT, pgboss = PGBOSS, erd = ERD, migrations, url } = {}) => {
    const d = join(work, `case-${Math.random().toString(36).slice(2)}`);
    mkdirSync(d);
    writeFileSync(join(d, "dict.md"), dict);
    writeFileSync(join(d, "pgboss.md"), pgboss);
    writeFileSync(join(d, "erd.md"), erd);
    const out = join(d, "coverage.json");
    const r = runNode([
      TOOL,
      "--database-url",
      url ?? `${base}/${DB}`,
      "--dictionary",
      join(d, "dict.md"),
      "--dictionary",
      join(d, "pgboss.md"),
      "--erd",
      join(d, "erd.md"),
      "--migrations-dir",
      migrations ?? join(work, "migrations"),
      "--out",
      out,
    ]);
    return { ...r, json: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
  };

  it("T-F1: a complete fixture passes; nullability is not compared where a section has no Null column", () => {
    const r = runWith();
    assert.equal(r.code, 0, r.stdout);
    assert.equal(
      r.stdout.trim(),
      "dictionary-coverage: PASS: 4 tables and 9 columns documented (2 schemas); reported only: 4 indexes, 3 constraints, 0 triggers not named; ERD: 1 tables in no section",
    );
    assert.equal(r.json.schemaVersion, "mth-dictionary-coverage/1");
    assert.deepEqual(r.json.gaps, []);
    assert.equal(r.json.reportedOnly.columnsWithoutNullColumn, 4); // schema_migration (3) and widget_view (1)
    assert.deepEqual(r.json.reportedOnly.erdTablesInNoSectionList, ["schema_migration"]);
    assert.equal(r.json.migration.highest, "0001_base.sql");
    assert.equal(r.json.sources.dictionaries.length, 2);
    assert.match(r.json.sources.dictionaries[0].sha256, /^[0-9a-f]{64}$/);
  });

  it("T-F1: a missing table fails and is listed", () => {
    const r = runWith({ dict: DICT.replace(/## widget_view[\s\S]*$/, "") });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /^dictionary-coverage: FAIL: 1 gaps$/m);
    assert.match(r.stdout, /^missing table public\.widget_view$/m);
  });

  it("T-F1: a missing pgboss table fails and is listed", () => {
    const r = runWith({ pgboss: "# pgboss\n" });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^missing table pgboss\.job$/m);
  });

  it("T-F1: a missing column fails with its type", () => {
    const r = runWith({ dict: DICT.replace("| note | text | NULL |  |  |\n", "") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^missing column widget\.note \(text\)$/m);
  });

  it("T-F1: a wrong type fails", () => {
    const r = runWith({ dict: DICT.replace("| label | text |", "| label | character varying |") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^type mismatch widget\.label: documented character varying, database text$/m);
  });

  it("T-F1: a wrong nullability fails where the section has a Null column", () => {
    const r = runWith({ dict: DICT.replace("| note | text | NULL |", "| note | text | NOT NULL |") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^type mismatch widget\.note: documented text NOT NULL, database text NULL$/m);
  });

  it("T-F1: a duplicated heading fails", () => {
    const r = runWith({ dict: `${DICT}\n## widget\n\nAgain.\n` });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^duplicate heading widget$/m);
  });

  it("T-F1: a documented table or column that does not exist fails as stale", () => {
    const extra = DICT.replace("| note | text | NULL |  |  |\n", "| note | text | NULL |  |  |\n| colour | text | NULL |  |  |\n");
    const r = runWith({ dict: `${extra}\n## gizmo\n\n| Column | Type |\n|---|---|\n| id | uuid |\n` });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^stale widget\.colour: documented but not in the database$/m);
    assert.match(r.stdout, /^stale gizmo: documented but not in the database$/m);
    assert.match(r.stdout, /^dictionary-coverage: FAIL: 2 gaps$/m);
  });

  it("T-F2: a database that is not fully migrated is BLOCKED (exit 2) with the F.3 line", () => {
    const m = join(work, "migrations-plus");
    mkdirSync(m, { recursive: true });
    writeFileSync(join(m, "0001_base.sql"), MIGRATION_SQL);
    writeFileSync(join(m, "0002_more.sql"), "-- not applied\n");
    const r = runWith({ migrations: m });
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stdout, /^dictionary-coverage: BLOCKED: the database is not fully migrated \(1 pending\)$/m);
    assert.equal(r.json, null, "no report is written for a BLOCKED run");
  });

  it("T-F2: an unreachable database is BLOCKED (exit 2)", () => {
    const r = runWith({ url: "postgresql://postgres@127.0.0.1:1/none?connect_timeout=2" });
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "dictionary-coverage: BLOCKED: cannot connect to the database");
  });

  it("T-F3: an ERD table name that does not exist fails; a table in no ERD section is reported, not failed", () => {
    const r = runWith({ erd: ERD.replace("widget ||--o{ widget_view", "widget ||--o{ gadget") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^ERD names a table that does not exist: gadget$/m);
    assert.doesNotMatch(r.stdout, /CONCEPT|OTHER/, "the conceptual section (## 2) is not checked");
    assert.doesNotMatch(r.stdout, /schema_migration/, "a table in no ERD section is not a gap");
  });

  it("--write-pgboss renders the queue schema from the catalogue, and the rendering passes coverage", () => {
    const d = join(work, "render");
    mkdirSync(d, { recursive: true });
    const r = runNode([
      TOOL,
      "--database-url",
      `${base}/${DB}`,
      "--migrations-dir",
      join(work, "migrations"),
      "--write-pgboss",
      join(d, "pgboss.md"),
    ]);
    assert.equal(r.code, 0, r.stdout);
    const text = readFileSync(join(d, "pgboss.md"), "utf8");
    assert.match(text, /^## pgboss\.job$/m);
    assert.match(text, /^\| id \| uuid \| NOT NULL \|$/m);
    const again = runWith({ pgboss: text });
    assert.equal(again.code, 0, again.stdout);
  });
});

describe("dictionary-coverage usage", () => {
  it("no --database-url is BLOCKED (exit 2)", () => {
    const r = runNode([TOOL], { env: { ...process.env, MTH_COVERAGE_DATABASE_URL: "" } });
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^dictionary-coverage: BLOCKED: usage/m);
  });
});
