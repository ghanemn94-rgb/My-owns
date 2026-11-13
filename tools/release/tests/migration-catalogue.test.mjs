// T-E34…T-E36 (ADR-0068 §3; p7-work-split E.4): the irreversible-migration catalogue.
//   node --test tools/release/tests/*.test.mjs
// Fixture roots are created under $TMPDIR and removed; nothing is written to the repository.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  buildCatalogue,
  CatalogueInputError,
  classifySql,
  OUT_GUIDE,
  OUT_JSON,
  OVERRIDES,
  parseOverrides,
  RECOVERY_IRREVERSIBLE,
  renderJson,
  TABLE_BEGIN,
  TABLE_END,
} from "../migration-catalogue.mjs";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "migration-catalogue.mjs");
const MIGRATIONS = join(REPO, "packages", "db", "migrations");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A fixture root with the given migration files, an optional overrides document and a guide with the markers. */
function fixtureRoot(files, overrides) {
  const root = tmp("catalogue");
  roots.push(root);
  mkdirSync(join(root, "packages", "db", "migrations"), { recursive: true });
  mkdirSync(join(root, "docs", "handover"), { recursive: true });
  mkdirSync(join(root, "tools", "release"), { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(root, "packages", "db", "migrations", name), sql);
  if (overrides !== undefined) writeFileSync(join(root, OVERRIDES), JSON.stringify(overrides));
  writeFileSync(join(root, OUT_GUIDE), `# Upgrades\n\n${TABLE_BEGIN}\n${TABLE_END}\n\nAfter.\n`);
  return root;
}

const cls = (sql, earlier) => classifySql(sql, earlier).class;

describe("T-E34: every migration file has exactly one entry; the committed output equals a fresh generation", () => {
  it("one entry per file 0001–last, in order, with its id and SHA-256 (computed independently here)", () => {
    const committed = JSON.parse(readFileSync(join(REPO, OUT_JSON), "utf8"));
    const names = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    assert.equal(committed.schemaVersion, "mth-migration-catalogue/1");
    assert.equal(committed.count, names.length);
    assert.deepEqual(
      committed.entries.map((e) => e.name),
      names,
    );
    for (const e of committed.entries) {
      assert.equal(e.id, e.name.slice(0, 4));
      const sha = createHash("sha256")
        .update(readFileSync(join(MIGRATIONS, e.name)))
        .digest("hex");
      assert.equal(e.sha256, sha, `${e.name}: sha256`);
      assert.ok(["additive", "data_rewrite", "destructive"].includes(e.class));
      assert.equal(e.irreversible, e.class !== "additive");
      if (e.irreversible) {
        assert.ok(e.reasons.length > 0, `${e.name}: an irreversible entry names its reasons`);
        assert.ok(e.recovery.startsWith(RECOVERY_IRREVERSIBLE), `${e.name}: recovery`);
      }
      assert.match(e.stage, /^p\d+$/);
    }
    assert.equal(committed.entries[0].name, names[0]);
    assert.equal(committed.entries.at(-1).name, names.at(-1));
  });

  it("--check exits 0 on the repository (the JSON and the guide's table are a fresh generation)", () => {
    const r = runNode([TOOL, "--check"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^PASS: migration catalogue up to date: \d+ migrations/);
  });

  it("--check exits 1 when a file has no entry, an entry names no file, or a SHA-256 differs; 0 after regeneration", () => {
    const root = fixtureRoot({ "0001_a.sql": "CREATE TABLE a (id int);\n", "0002_p2_b.sql": "UPDATE a SET id = 1;\n" });
    assert.equal(runNode([TOOL, "--root", root]).code, 0);
    assert.equal(runNode([TOOL, "--check", "--root", root]).code, 0);
    const doc = JSON.parse(readFileSync(join(root, OUT_JSON), "utf8"));
    assert.deepEqual(
      doc.entries.map((e) => [e.id, e.stage, e.class]),
      [
        ["0001", "p1", "additive"],
        ["0002", "p2", "data_rewrite"],
      ],
    );
    // a new file without an entry
    writeFileSync(join(root, "packages", "db", "migrations", "0003_p3_c.sql"), "CREATE TABLE c (id int);\n");
    let r = runNode([TOOL, "--check", "--root", root]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^FAIL: migration catalogue: docs\/handover\/migration-catalogue\.json and docs\/handover\/upgrades\.md differ/);
    assert.equal(runNode([TOOL, "--root", root]).code, 0);
    // an entry that names no file
    const extra = JSON.parse(readFileSync(join(root, OUT_JSON), "utf8"));
    extra.entries.push({ ...extra.entries[0], id: "0999", name: "0999_ghost.sql" });
    writeFileSync(join(root, OUT_JSON), renderJson(extra));
    assert.equal(runNode([TOOL, "--check", "--root", root]).code, 1);
    assert.equal(runNode([TOOL, "--root", root]).code, 0);
    // a changed file (same name, other bytes)
    writeFileSync(join(root, "packages", "db", "migrations", "0001_a.sql"), "CREATE TABLE a (id bigint);\n");
    r = runNode([TOOL, "--check", "--root", root]);
    assert.equal(r.code, 1);
    assert.equal(runNode([TOOL, "--root", root]).code, 0);
    assert.equal(runNode([TOOL, "--check", "--root", root]).code, 0);
    // the guide keeps its text around the generated block
    const guide = readFileSync(join(root, OUT_GUIDE), "utf8");
    assert.ok(guide.startsWith("# Upgrades\n\n"));
    assert.ok(guide.endsWith(`${TABLE_END}\n\nAfter.\n`));
  });

  it("BLOCKED (exit 2) on a file name that is not NNNN_snake_case.sql, on missing guide markers, and on a usage error", () => {
    const bad = fixtureRoot({ "0001_A.sql": "SELECT 1;\n" });
    let r = runNode([TOOL, "--check", "--root", bad]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^BLOCKED: packages\/db\/migrations\/0001_A\.sql: name does not match/);
    const noMarkers = fixtureRoot({ "0001_a.sql": "SELECT 1;\n" });
    writeFileSync(join(noMarkers, OUT_GUIDE), "# Upgrades\n");
    r = runNode([TOOL, "--root", noMarkers]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /markers are missing/);
    assert.equal(runNode([TOOL, "--bogus"]).code, 2);
  });
});

describe("T-E35: the scanner classifies each pattern, and ignores the bodies of functions", () => {
  const destructive = {
    "DROP TABLE": "DROP TABLE old_thing;",
    "DROP COLUMN": "ALTER TABLE t DROP COLUMN c;",
    "DROP FUNCTION": "DROP FUNCTION IF EXISTS f(integer);",
    "DROP TRIGGER": "DROP TRIGGER t_guard ON t;",
    "DROP CONSTRAINT": "ALTER TABLE t DROP CONSTRAINT t_check;",
    "DROP NOT NULL": "ALTER TABLE t ALTER COLUMN c DROP NOT NULL;",
    TRUNCATE: "TRUNCATE t;",
    "ALTER … TYPE": "ALTER TABLE t ALTER COLUMN c TYPE bigint;",
    "ALTER … SET DATA TYPE": "ALTER TABLE t ALTER COLUMN c SET DATA TYPE numeric(20, 4);",
    RENAME: "ALTER TABLE t RENAME COLUMN a TO b;",
    "REVOKE (existing object)": "REVOKE UPDATE ON t FROM mth_app;",
    "DROP in a DO block": "DO $$ BEGIN DROP TABLE t; END $$;",
  };
  for (const [label, sql] of Object.entries(destructive))
    it(`destructive: ${label}`, () => assert.equal(cls(sql), "destructive"));

  const rewrite = {
    UPDATE: "UPDATE gate_definition SET submission_enabled = true WHERE code = 'G4';",
    "UPDATE ONLY": "UPDATE ONLY t SET a = 1;",
    "DELETE FROM": "DELETE FROM oidc_login_state WHERE expires_at < now();",
    "INSERT … SELECT": "INSERT INTO audit_event (id) SELECT id FROM t;",
    "INSERT (cols) … SELECT": "INSERT INTO a(x, y) SELECT x, y FROM b;",
    "WITH … UPDATE": "WITH x AS (UPDATE t SET a = 1 RETURNING id) SELECT count(*) FROM x;",
    "backfill: SELECT f(…) FROM t": "SELECT p2_instantiate_transformation(x.id, NULL) FROM transformation x ORDER BY x.id;",
    "UPDATE in a DO block (runs at migration time)": "DO $$ BEGIN UPDATE t SET a = 1 WHERE a IS NULL; END $$;",
    "dynamic SQL in a DO block": "DO $$ BEGIN EXECUTE format('UPDATE %I SET a = 1', 't'); END $$;",
  };
  for (const [label, sql] of Object.entries(rewrite))
    it(`data_rewrite: ${label}`, () => assert.equal(cls(sql), "data_rewrite"));

  it("data_rewrite: CREATE OR REPLACE FUNCTION of a function an earlier file created; additive when it is new", () => {
    const earlier = new Set();
    assert.equal(cls("CREATE FUNCTION g() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;", earlier), "additive");
    const r = classifySql("CREATE OR REPLACE FUNCTION public.g() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;", earlier);
    assert.equal(r.class, "data_rewrite");
    assert.deepEqual(r.reasons, ["replaces function g"]);
    assert.equal(cls("CREATE OR REPLACE FUNCTION brand_new() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;", earlier), "additive");
  });

  const additive = {
    "CREATE TABLE with ON DELETE/ON UPDATE": "CREATE TABLE t (id uuid PRIMARY KEY, p uuid REFERENCES p (id) ON DELETE RESTRICT ON UPDATE RESTRICT);",
    "CREATE INDEX": "CREATE INDEX t_idx ON t (a);",
    "GRANT SELECT, UPDATE": "GRANT SELECT, INSERT, UPDATE ON t TO mth_app;",
    "seed INSERT … VALUES": "INSERT INTO role (code) VALUES ('ADM_TECH'), ('AUD');",
    "ALTER TABLE ADD COLUMN": "ALTER TABLE t ADD COLUMN c text NULL;",
    "UPDATE inside a $$ function body": `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE other SET touched = true WHERE id = NEW.id;
  DELETE FROM queue WHERE id = OLD.id;
  DROP TABLE nothing;
  RETURN NEW;
END $$;`,
    "UPDATE inside a tagged $body$ body": "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $body$ UPDATE t SET a = 1 $body$;",
    "UPDATE in a line comment": "-- UPDATE t SET a = 1; DROP TABLE t;\nCREATE TABLE z (id int);",
    "DROP in a block comment": "/* DROP TABLE t; /* nested */ TRUNCATE t; */ CREATE TABLE z (id int);",
    "keywords in a string literal": "COMMENT ON TABLE t IS 'never UPDATE or DROP TABLE this; it''s TRUNCATE-safe';",
    "a read-only DO guard": "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM t) THEN RAISE EXCEPTION 'missing'; END IF; END $$;",
    "REVOKE on a function the same file creates":
      "CREATE FUNCTION h() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\nREVOKE ALL ON FUNCTION h() FROM PUBLIC;",
    "SELECT helper call without FROM": "SELECT p2_attach_guards('t');",
    "CREATE TRIGGER (new)": "CREATE TRIGGER t_guard BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f();",
  };
  for (const [label, sql] of Object.entries(additive)) it(`additive: ${label}`, () => assert.equal(cls(sql), "additive"));

  it("the strongest class wins and every reason is listed once", () => {
    const r = classifySql("UPDATE t SET a = 1;\nUPDATE t SET a = 2;\nALTER TABLE t DROP CONSTRAINT k;");
    assert.equal(r.class, "destructive");
    assert.deepEqual(r.reasons, ["UPDATE t", "DROP CONSTRAINT"]);
  });
});

describe("T-E36: overrides have a reason of at least 20 characters and never lower a class", () => {
  it("the committed overrides file is valid: schema version, known ids, classes, reasons ≥ 20 characters", () => {
    const text = readFileSync(join(REPO, OVERRIDES), "utf8");
    const ids = new Set(readdirSync(MIGRATIONS).map((f) => f.slice(0, 4)));
    const parsed = parseOverrides(text, ids);
    for (const o of parsed.values()) assert.ok(o.reason.trim().length >= 20);
    // and buildCatalogue accepted every one of them (none lowers a class): the committed catalogue was built with it
    assert.doesNotThrow(() => buildCatalogue(REPO));
  });

  const base = { schemaVersion: "mth-migration-catalogue-overrides/1" };
  const known = new Set(["0001", "0002"]);
  const refuse = (overrides, pattern) =>
    assert.throws(
      () => parseOverrides(JSON.stringify({ ...base, overrides }), known),
      (e) => e instanceof CatalogueInputError && pattern.test(e.message),
    );

  it("refuses a reason shorter than 20 characters, or none", () => {
    refuse([{ id: "0001", class: "destructive", reason: "too short" }], /reason of at least 20 characters/);
    refuse([{ id: "0001", class: "destructive" }], /reason of at least 20 characters/);
    refuse([{ id: "0001", class: "destructive", reason: "                         " }], /at least 20/);
  });

  it("refuses an unknown class, a stale id, a duplicate and an unknown key", () => {
    refuse([{ id: "0001", class: "harmless", reason: "a reason that is long enough" }], /unknown class/);
    refuse([{ id: "0042", class: "destructive", reason: "a reason that is long enough" }], /names no migration file/);
    refuse(
      [
        { id: "0001", class: "destructive", reason: "a reason that is long enough" },
        { id: "0001", class: "destructive", reason: "a reason that is long enough" },
      ],
      /two overrides/,
    );
    refuse([{ id: "0001", class: "destructive", reason: "a reason that is long enough", lower: true }], /unknown key/);
  });

  it("an override never lowers a class (BLOCKED, exit 2), and may raise one with a recovery note", () => {
    const files = { "0001_a.sql": "CREATE TABLE a (id int);\n", "0002_b.sql": "DROP TABLE a;\n" };
    const lowering = fixtureRoot(files, {
      ...base,
      overrides: [{ id: "0002", class: "additive", reason: "the dropped table was always empty here" }],
    });
    const r = runNode([TOOL, "--root", lowering]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /override 0002 would lower the class from destructive to additive/);

    const raising = fixtureRoot(files, {
      ...base,
      overrides: [
        {
          id: "0001",
          class: "data_rewrite",
          reason: "the table replaces data kept elsewhere until this release",
          recoveryNote: "Re-run the export of the previous release.",
        },
      ],
    });
    assert.equal(runNode([TOOL, "--root", raising]).code, 0);
    const doc = JSON.parse(readFileSync(join(raising, OUT_JSON), "utf8"));
    const e = doc.entries[0];
    assert.equal(e.class, "data_rewrite");
    assert.equal(e.irreversible, true);
    assert.deepEqual(e.reasons, ["override: the table replaces data kept elsewhere until this release"]);
    assert.equal(e.recovery, `${RECOVERY_IRREVERSIBLE} Re-run the export of the previous release.`);
  });
});

describe("the catalogue of the shipped migrations (spot checks a reviewer can repeat)", () => {
  it("names the known data rewrites and destructive files with their reasons", () => {
    const doc = JSON.parse(readFileSync(join(REPO, OUT_JSON), "utf8"));
    const by = Object.fromEntries(doc.entries.map((e) => [e.id, e]));
    assert.equal(by["0026"].class, "data_rewrite");
    assert.ok(by["0026"].reasons.includes("UPDATE gate_definition"));
    assert.equal(by["0018"].class, "data_rewrite");
    assert.equal(by["0096"].class, "destructive");
    assert.ok(by["0096"].reasons.includes("DROP TRIGGER"));
    assert.equal(by["0124"].class, "destructive");
    assert.equal(by["0144"].class, "additive");
    // a fixture copy of the real files gives the same document (the generator reads nothing else)
    const root = fixtureRoot({});
    cpSync(MIGRATIONS, join(root, "packages", "db", "migrations"), { recursive: true });
    cpSync(join(REPO, OVERRIDES), join(root, OVERRIDES));
    assert.equal(renderJson(buildCatalogue(root)), readFileSync(join(REPO, OUT_JSON), "utf8"));
  });
});
