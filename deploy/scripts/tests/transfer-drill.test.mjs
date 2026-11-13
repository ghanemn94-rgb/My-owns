// deploy/scripts/tests/transfer-drill.test.mjs: T-B3, T-B9, T-B10, T-B15, T-B16 of the transfer drill
// (p7-work-split §B.4 and §B.6 DO-D2; ADR-0069 §4; ADR-0064 A1.9; T-DG7-DO-D, T-DG7-DO-D2).
//
//   tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs
//
// T-B3, T-B10 and T-B16 need a disposable PostgreSQL cluster: without TEST_DATABASE_ADMIN_URL they FAIL with "BLOCKED: …"
// (never a silent skip, never a pass). T-B9's namespace cases need bwrap; without it they fail the same way.
// Every user, secret and origin here is SYNTHETIC. Nothing here is a business, Finance or IT approval.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { trace, UNDOCUMENTED } from "../drill/config-trace.mjs";
import { startDrillIdp, readUsers, DRILL_IDP_LABEL } from "../drill/fake-idp-server.mjs";
import { runJourney } from "../drill/journey.mjs";
import { tableDigest } from "../drill/job-check.mjs";
import {
  buildAllowance,
  constants,
  D8_TOUCHED_AUDITED,
  D8_TOUCHED_CHILDREN,
  D8_TOUCHED_COUNTERS,
  D8_TOUCHED_LINEAGE,
  A45_REQUIRED_AUDITED,
} from "../drill/allowance.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DRILL = join(REPO, "deploy/scripts/transfer-drill.sh");
const SCAN = join(REPO, "deploy/scripts/drill/origin-scan.mjs");
const ADMIN = process.env.TEST_DATABASE_ADMIN_URL ?? "";
const needPg = () => {
  if (!ADMIN) throw new Error("BLOCKED: TEST_DATABASE_ADMIN_URL is not set (run under tests/qa/support/with-pg.sh)");
};
const hasBwrap = () => spawnSync("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "true"]).status === 0;
const work = mkdtempSync(join(tmpdir(), "mth-transfer-drill-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

function psql(url, sql) {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url, "-f", "-"], {
    input: sql,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`);
  return r.stdout.trim();
}
const dbUrl = (db, user) => {
  const u = new URL(ADMIN);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  return u.toString();
};
const suffix = `${process.pid}_${randomBytes(3).toString("hex")}`;

// --------------------------------------------------------------------------------------------- T-B3 origin scan
describe("T-B3 origin-scan.mjs: the source origin is accepted only in audit_event", () => {
  const db = `mth_td_scan_${suffix}`;
  const origin = "http://localhost:25301";
  before(() => {
    if (!ADMIN) return;
    psql(ADMIN, `CREATE DATABASE ${db} ENCODING 'UTF8' TEMPLATE template0;`);
    psql(
      dbUrl(db),
      `CREATE TABLE audit_event (id int, reason text, changes jsonb);
       CREATE TABLE note (id int, body text, title varchar(80));
       CREATE TABLE setting (id int, value jsonb);
       INSERT INTO note VALUES (1, 'no origin here', 'x'), (2, 'also 100% clean_', 'y');
       INSERT INTO setting VALUES (1, '{"a": "elsewhere"}');
       INSERT INTO audit_event VALUES (1, 'signed in from ${origin}/login', '{}');`,
    );
  });
  after(() => ADMIN && psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`));
  const scan = () => {
    const out = join(work, `scan-${randomBytes(3).toString("hex")}.json`);
    const r = spawnSync("node", [SCAN, "--database-url", dbUrl(db), "--origin", origin, "--out", out], {
      encoding: "utf8",
    });
    return { ...r, report: JSON.parse(readFileSync(out, "utf8")) };
  };

  it("a hit in audit_event only is listed and passes (exit 0)", () => {
    needPg();
    const r = scan();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.report.hits, [{ table: "audit_event", column: "reason", rows: 1, accepted: true }]);
    assert.equal(r.report.result, "PASS");
    assert.equal(r.report.schemaVersion, "mth-origin-scan/1");
  });

  it("the origin in a text column fails with the B.5 line (exit 1)", () => {
    needPg();
    psql(dbUrl(db), `INSERT INTO note VALUES (3, 'open ${origin}/links/abc', 'z');`);
    try {
      const r = scan();
      assert.equal(r.status, 1);
      assert.match(
        r.stderr,
        new RegExp(`^transfer-drill: the source origin ${origin} was found in note\\.body \\(1 rows\\)$`, "m"),
      );
      assert.equal(r.report.result, "FAIL");
    } finally {
      psql(dbUrl(db), "DELETE FROM note WHERE id = 3;");
    }
  });

  it("the origin in a jsonb value fails (exit 1)", () => {
    needPg();
    psql(dbUrl(db), `INSERT INTO setting VALUES (2, '{"link": {"href": "${origin}/x"}}');`);
    try {
      const r = scan();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /was found in setting\.value \(1 rows\)/);
    } finally {
      psql(dbUrl(db), "DELETE FROM setting WHERE id = 2;");
    }
  });

  it("LIKE wildcards in the data are not matches (a plain substring test)", () => {
    needPg();
    const r = scan();
    assert.equal(r.report.hits.filter((h) => h.table === "note").length, 0);
  });
});

// --------------------------------------------------------------------------------------------- T-B9 config trace
describe("T-B9 config-trace.mjs: configuration only from the template and the guide", () => {
  const template = "# c\nNODE_ENV=\nAPP_BASE_URL=\nDATABASE_URL=\n# OPTIONAL_KEY=\n";
  const guide = "# G\n## 1. Domains and TLS {#domains-and-tls}\n## Application settings {#application-settings}\n";
  const map = {
    keys: {
      NODE_ENV: "docs/handover/deployment.md#application-settings",
      APP_BASE_URL: "deployment.md#domains-and-tls",
      DATABASE_URL: "service-accounts",
    },
  };

  it("documented keys pass, each citing its guide section; a secret is written as <KEY>_FILE and never shown", () => {
    const r = trace({
      template,
      guide: guide + "## 3. Service accounts {#service-accounts}\n",
      map,
      values: {
        NODE_ENV: { value: "production" },
        APP_BASE_URL: { value: "http://127.0.0.1:1" },
        DATABASE_URL: { file: "/s/db" },
      },
    });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(
      r.entries.map((e) => [e.key, e.section, e.form]),
      [
        ["NODE_ENV", "docs/handover/deployment.md#application-settings", "value"],
        ["APP_BASE_URL", "docs/handover/deployment.md#domains-and-tls", "value"],
        ["DATABASE_URL", "docs/handover/deployment.md#service-accounts", "file"],
      ],
    );
    assert.ok(!JSON.stringify(r.entries).includes("/s/db"));
    assert.match(r.env, /^DATABASE_URL_FILE=\/s\/db$/m);
    assert.doesNotMatch(r.env, /^DATABASE_URL=/m);
  });

  it("a key outside the map fails with the B.5 undocumented-step line", () => {
    const r = trace({ template, guide, map, values: { OPTIONAL_KEY: { value: "1" } } });
    assert.deepEqual(r.problems, [UNDOCUMENTED("OPTIONAL_KEY")]);
    assert.equal(
      r.problems[0],
      "transfer-drill: undocumented step: the target needs OPTIONAL_KEY, which no section of docs/handover/deployment.md names",
    );
  });

  it("an anchor absent from the (fixture) guide fails with the same line", () => {
    const r = trace({ template, guide, map, values: { DATABASE_URL: { file: "/s/db" } } });
    assert.deepEqual(r.problems, [UNDOCUMENTED("DATABASE_URL")]);
  });

  it("a key that is not in the template fails (not from the template)", () => {
    const r = trace({
      template,
      guide,
      map: { keys: { NOT_IN_TEMPLATE: "domains-and-tls" } },
      values: { NOT_IN_TEMPLATE: { value: "x" } },
    });
    assert.match(r.problems[0], /NOT_IN_TEMPLATE is not a key of \.env\.example/);
  });

  it("the shipped map covers every .env.example key and every anchor exists in the shipped guide", () => {
    const keys = readFileSync(join(REPO, ".env.example"), "utf8");
    const shipped = JSON.parse(readFileSync(join(REPO, "deploy/scripts/drill/guide-keys.json"), "utf8"));
    const values = Object.fromEntries([...keys.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => [m[1], { value: "x" }]));
    const r = trace({
      template: keys,
      guide: readFileSync(join(REPO, "docs/handover/deployment.md"), "utf8"),
      map: shipped,
      values,
    });
    assert.deepEqual(r.problems, []);
    assert.equal(r.entries.length, Object.keys(values).length);
  });

  it("the CLI exits 1 on an undocumented step and writes a FAIL trace", () => {
    const d = mkdtempSync(join(work, "ct-"));
    writeFileSync(join(d, "t"), template);
    writeFileSync(join(d, "g"), guide);
    writeFileSync(join(d, "m"), JSON.stringify(map));
    writeFileSync(join(d, "v"), JSON.stringify({ OPTIONAL_KEY: { value: "1" } }));
    const r = spawnSync(
      "node",
      [
        join(REPO, "deploy/scripts/drill/config-trace.mjs"),
        "--template",
        join(d, "t"),
        "--guide",
        join(d, "g"),
        "--map",
        join(d, "m"),
        "--values",
        join(d, "v"),
        "--out-env",
        join(d, "env"),
        "--out-trace",
        join(d, "trace.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^transfer-drill: undocumented step: the target needs OPTIONAL_KEY/m);
    assert.equal(JSON.parse(readFileSync(join(d, "trace.json"), "utf8")).result, "FAIL");
  });
});

describe("T-B9 transfer-drill.sh: BLOCKED, isolation and the report", () => {
  const fakeArchive = join(work, "not-an-archive.tar.gz");
  writeFileSync(fakeArchive, "synthetic, not a release archive\n");
  const sha = "0".repeat(64);

  it("without bwrap (stub PATH) it exits 3 with the B.5 BLOCKED line", () => {
    const bin = mkdtempSync(join(work, "bin-"));
    for (const t of ["bash", "node", "ls", "sort", "tail", "dirname", "mkdir", "mktemp"]) {
      const real = spawnSync("bash", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim();
      if (!real) continue;
      writeFileSync(join(bin, t), `#!/bin/sh\nexec ${real} "$@"\n`);
      chmodSync(join(bin, t), 0o755);
    }
    const r = spawnSync(
      join(bin, "bash"),
      [DRILL, "--archive", fakeArchive, "--sha256", sha, "--store", work, "--out", join(work, "o1")],
      {
        encoding: "utf8",
        env: { PATH: bin, HOME: work },
      },
    );
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^transfer-drill: BLOCKED: no network namespace with loopback \(bwrap unavailable\)$/m);
  });

  it("without PostgreSQL server binaries it exits 3 with the B.5 BLOCKED line", () => {
    if (!hasBwrap()) throw new Error("BLOCKED: bwrap --unshare-net is not available here");
    const r = spawnSync(
      "bash",
      [DRILL, "--archive", fakeArchive, "--sha256", sha, "--store", work, "--out", join(work, "o2")],
      {
        encoding: "utf8",
        env: { ...process.env, PGBIN: join(work, "no-such-pgbin") },
      },
    );
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^transfer-drill: BLOCKED: PostgreSQL server binaries not found \(set PGBIN\)$/m);
  });

  it("not enough free disk: exit 3 with the B.6 DO-D2 line, and the work directory is removed", () => {
    if (!hasBwrap()) throw new Error("BLOCKED: bwrap --unshare-net is not available here");
    const w = join(work, "w-disk");
    const r = spawnSync(
      "bash",
      [DRILL, "--archive", fakeArchive, "--sha256", sha, "--store", work, "--out", join(work, "o-disk"), "--work", w],
      { encoding: "utf8", env: { ...process.env, MTH_TD_NEED_MB: "999999999" } },
    );
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^transfer-drill: BLOCKED: \d+ MB free under \S+; the run needs at least 999999999 MB$/m);
    assert.equal(spawnSync("test", ["-e", w]).status, 1);
  });

  it("a probe that connects exits 1 with the B.5 isolation line", () => {
    if (!hasBwrap()) throw new Error("BLOCKED: bwrap --unshare-net is not available here");
    // Inside a fresh namespace, a listener on loopback stands in for a reachable public address.
    const inner = `node -e 'require("node:net").createServer((s) => s.end()).listen(25999, "127.0.0.1")' & sleep 0.5;
      MTH_TD_INNER=1 MTH_TD_OUT="$OUT" MTH_TD_WORK="$OUT/w" MTH_EGRESS_PROBE=127.0.0.1:25999 MTH_EGRESS_DNS_PROBE=no-such-host.invalid bash "$DRILL"; rc=$?; kill %1; exit $rc`;
    const out = join(work, "o3");
    mkdirSync(join(out, "w"), { recursive: true });
    const r = spawnSync("bwrap", ["--dev-bind", "/", "/", "--unshare-net", "bash", "-c", inner], {
      encoding: "utf8",
      env: { ...process.env, OUT: out, DRILL },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^transfer-drill: network isolation is not effective$/m);
  });

  it("a failing step: exit 1, the B.5 step line, later steps NOT_RUN, result FAIL, schemaVersion mth-transfer-drill/1", () => {
    if (!hasBwrap()) throw new Error("BLOCKED: bwrap --unshare-net is not available here");
    const out = join(work, "o4");
    const r = spawnSync("bash", [DRILL, "--archive", fakeArchive, "--sha256", sha, "--store", work, "--out", out], {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^transfer-drill: step D0 failed: exit \d+/m);
    assert.match(r.stdout, /^transfer-drill: probe: network isolation effective/m);
    const report = JSON.parse(readFileSync(join(out, "transfer-drill-report.json"), "utf8"));
    assert.equal(report.schemaVersion, "mth-transfer-drill/1");
    assert.equal(report.result, "FAIL");
    assert.deepEqual(
      report.steps.map((s) => s.id),
      ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11"],
    );
    assert.equal(report.steps[0].result, "FAIL");
    assert.ok(
      report.steps.slice(1).every((s) => s.result === "NOT_RUN"),
      "no later step is PASS",
    );
    assert.equal(report.idp.label, DRILL_IDP_LABEL);
    assert.equal(report.archive.sha256, sha);
    assert.ok(readFileSync(join(out, "drill.log"), "utf8").includes("probe"));
  });
});

// --------------------------------------------------------------------------------------------- T-B10 journey
// T-B10 runs under NODE_ENV=production, AUTH_MODE=oidc, with the drill IdP at http://127.0.0.1:<p>: the loopback
// exception for OIDC_ISSUER_URL (T-DG7-BE-R1, T-R10) admits it. The development run is kept as a supporting case,
// labelled NOT production semantics. The production suite also measures, for allowance.mjs (T-B16), whether a sign-in
// changes the user's app_user row; MTH_DRILL_MEASURE_OUT=<file> writes the answer.
function journeySuite(nodeEnv, title) {
  describe(title, () => {
    const db = `mth_td_journey_${nodeEnv}_${suffix}`;
    let idp,
      api,
      apiLog = "";
    const port = (nodeEnv === "production" ? 25000 : 28000) + Math.floor(Math.random() * 2900);
    const idpPort = port + 1;
    const app = `http://127.0.0.1:${port}`;
    const issuer = `http://127.0.0.1:${idpPort}/realms/mth-test`;
    const secretDir = join(work, `journey-secrets-${nodeEnv}`);

    before(
      async () => {
        if (!ADMIN) return;
        mkdirSync(secretDir, { recursive: true });
        for (const r of ["mth_owner", "mth_app"])
          psql(
            ADMIN,
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} LOGIN; END IF; END $$;`,
          );
        psql(ADMIN, `ALTER ROLE mth_owner LOGIN; ALTER ROLE mth_app LOGIN;`);
        psql(ADMIN, `CREATE DATABASE ${db} OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;`);
        psql(ADMIN, `GRANT CONNECT ON DATABASE ${db} TO mth_app;`);
        const owner = dbUrl(db, "mth_owner");
        const cli = (args, env = {}) => {
          const r = spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", ...args], {
            cwd: join(REPO, "packages/db"),
            encoding: "utf8",
            env: { PATH: process.env.PATH, HOME: work, DATABASE_OWNER_URL: owner, NODE_ENV: "production", ...env },
          });
          if (r.status !== 0) throw new Error(`mth-db ${args[0]}: ${r.stdout}${r.stderr}`);
        };
        cli(["migrate"], { NODE_ENV: nodeEnv });
        cli(
          [
            "bootstrap",
            "--org-code",
            "DRILLT",
            "--org-name-en",
            "Drill test org (synthetic)",
            "--org-name-ar",
            "منظمة اختبار (اصطناعية)",
            "--admin-name",
            "Drill admin (synthetic)",
            "--admin-issuer",
            issuer,
            "--admin-subject",
            "drill-bound",
          ],
          { NODE_ENV: nodeEnv },
        );
        // A carried user still waiting for IT's rebind (ADR-0064 §8): identity on the drill issuer and an unbound hold.
        // Written as the owner in ONE transaction with its audit events (ADR-0004), as BE-D's fixture does.
        const audit = (type, id, action, next = "NULL") =>
          `INSERT INTO audit_event (id, actor_type, action, record_type, record_id, prior_version, new_version, source, reason)
       VALUES (mth_uuid_v7(), 'system', '${action}', '${type}', ${id}, NULL, ${next}, 'cli', 'Synthetic transfer-drill test fixture');`;
        psql(
          owner,
          `
      BEGIN;
      CREATE TEMP TABLE ids AS SELECT mth_uuid_v7() AS u, mth_uuid_v7() AS m, mth_uuid_v7() AS h;
      INSERT INTO app_user (id, organization_id, display_name, created_by, updated_by)
        SELECT ids.u, o.id, 'Carried user (synthetic)', NULL, NULL FROM ids, (SELECT id FROM organization LIMIT 1) o;
      ${audit("app_user", "(SELECT u FROM ids)", "app_user.create", "1")}
      INSERT INTO user_identity (id, user_id, issuer, subject) SELECT mth_uuid_v7(), u, '${issuer}', 'drill-unbound' FROM ids;
      INSERT INTO migration_import (id, schema_version, source_environment, source_export_reference, migration_level,
          manifest_sha256, attachment_manifest_sha256, demo_checksum, table_count, row_count, attachment_count,
          attachment_bytes, operator_name, started_at, imported_at)
        SELECT m, 'mth-migration/1', 'demo', mth_uuid_v7(), '0148_p7_retention_job', repeat('a', 64), repeat('b', 64),
          repeat('c', 64), 1, 1, 0, 0, 'Synthetic operator', now(), now() FROM ids;
      ${audit("migration_import", "(SELECT m FROM ids)", "migration.imported")}
      INSERT INTO identity_binding_hold (id, user_id, migration_import_id) SELECT h, u, m FROM ids;
      ${audit("identity_binding_hold", "(SELECT h FROM ids)", "identity.binding_held", "1")}
      COMMIT;`,
        );
        const secret = randomBytes(24).toString("hex");
        writeFileSync(join(secretDir, "oidc"), secret);
        writeFileSync(join(secretDir, "db"), dbUrl(db, "mth_app"));
        idp = await startDrillIdp({
          port: idpPort,
          users: readUsers(JSON.stringify([{ sub: "drill-bound" }, { sub: "drill-unbound" }])),
          clientSecret: secret,
          redirectUris: [`${app}/api/v1/auth/callback`],
        });
        api = spawn("node", ["--conditions=@mth/source", "src/main.ts"], {
          cwd: join(REPO, "apps/api"),
          env: {
            PATH: process.env.PATH,
            HOME: work,
            NODE_ENV: nodeEnv,
            AUTH_MODE: "oidc",
            APP_BASE_URL: app,
            PORT: String(port),
            DATABASE_URL_FILE: join(secretDir, "db"),
            OIDC_ISSUER_URL: issuer,
            OIDC_CLIENT_ID: "mth-test-client",
            OIDC_CLIENT_SECRET_FILE: join(secretDir, "oidc"),
            EVIDENCE_STORAGE_PATH: work,
            LOG_LEVEL: "warn",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        api.stdout.on("data", (d) => (apiLog += d));
        api.stderr.on("data", (d) => (apiLog += d));
        for (let i = 0; i < 240; i++) {
          const ok = await fetch(`${app}/healthz`).then(
            (r) => r.ok,
            () => false,
          );
          if (ok) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      },
      { timeout: 180_000 },
    );
    after(async () => {
      api?.kill("SIGTERM");
      await idp?.stop();
      if (ADMIN) psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
    });

    it("signs in through the drill IdP (authMode oidc), the source-origin write is 403, the unbound user is refused", async () => {
      needPg();
      const r = await runJourney({
        app,
        user: "drill-bound",
        unboundUser: "drill-unbound",
        sourceOrigin: "http://localhost:25301",
        steps: ["signin", "csrf", "unbound"],
      });
      assert.deepEqual(
        r.steps.map((s) => [s.step, s.result]),
        [
          ["signin", "PASS"],
          ["csrf", "PASS"],
          ["unbound", "PASS"],
        ],
        JSON.stringify(r.steps) + apiLog.slice(-2000),
      );
      assert.equal(r.result, "PASS");
      assert.equal(r.idp, DRILL_IDP_LABEL);
    });

    it("status: getDeploymentStatus.origin is the target's origin; a wrong expectation FAILS, never passes", async () => {
      needPg();
      const ok = await runJourney({
        app,
        user: "drill-bound",
        steps: ["signin", "status"],
        expectOrigin: app,
        expectEnvironment: "production",
      });
      assert.equal(ok.steps[1].result, "PASS", JSON.stringify(ok.steps) + apiLog.slice(-2000));
      const bad = await runJourney({
        app,
        user: "drill-bound",
        steps: ["signin", "status"],
        expectOrigin: "http://localhost:25301",
        expectEnvironment: "production",
      });
      assert.equal(bad.result, "FAIL");
      assert.match(bad.steps[1].detail, /origin is .* expected http:\/\/localhost:25301/);
    });

    it("a step with no data to prove never passes (deeplink with an empty inbox, downloads without a list)", async () => {
      needPg();
      const r = await runJourney({ app, user: "drill-bound", steps: ["signin", "deeplink", "downloads"] });
      assert.deepEqual(
        r.steps.map((x) => x.result),
        ["PASS", "FAIL", "FAIL"],
      );
      assert.equal(r.result, "FAIL");
    });

    if (nodeEnv === "production")
      it("T-B16 (measurement): whether a sign-in changes app_user, recorded for allowance.mjs", async () => {
        needPg();
        const owner = dbUrl(db, "mth_owner");
        const row = () =>
          psql(
            owner,
            `SELECT u::text FROM app_user u JOIN user_identity i ON i.user_id = u.id WHERE i.subject = 'drill-bound';`,
          );
        const ident = () => psql(owner, `SELECT i::text FROM user_identity i WHERE i.subject = 'drill-bound';`);
        const [u0, i0] = [row(), ident()];
        assert.ok(u0, "the bound user exists");
        const r = await runJourney({ app, user: "drill-bound", steps: ["signin"] });
        assert.equal(r.result, "PASS", JSON.stringify(r.steps));
        const [u1, i1] = [row(), ident()];
        const measured = {
          schemaVersion: "mth-drill-signin-measurement/1",
          appUserChangedBySignIn: u0 !== u1,
          userIdentityChangedBySignIn: i0 !== i1,
          measuredOn: "T-B10 production suite (NODE_ENV=production, AUTH_MODE=oidc, drill IdP), SYNTHETIC user",
        };
        if (process.env.MTH_DRILL_MEASURE_OUT)
          writeFileSync(process.env.MTH_DRILL_MEASURE_OUT, JSON.stringify(measured, null, 2) + "\n");
        console.log(`# T-B16 measurement: ${JSON.stringify(measured)}`);
        assert.equal(typeof measured.appUserChangedBySignIn, "boolean");
      });

    it("a redirect URI the drill IdP has not registered is refused", async () => {
      needPg();
      const u = new URL(`${issuer}/protocol/openid-connect/auth`);
      u.searchParams.set("client_id", "mth-test-client");
      u.searchParams.set("redirect_uri", "http://localhost:25301/api/v1/auth/callback");
      u.searchParams.set("login_hint", "drill-bound");
      const r = await fetch(u, { redirect: "manual" });
      assert.equal(r.status, 400);
    });
  });
}

journeySuite(
  "production",
  "T-B10 journey.mjs under NODE_ENV=production, AUTH_MODE=oidc: drill IdP sign-in, CSRF 403, unbound refused",
);
journeySuite(
  "development",
  "T-B10 (supporting, NOT production semantics) the same journey with NODE_ENV=development, AUTH_MODE=oidc",
);

// --------------------------------------------------------------------------------------------- T-B15 allowance
describe("T-B15 allowance.mjs: mth-recheck-allowance/4 from a fixture journal (p7-work-split §B.9 DO-D7)", () => {
  const U1 = "01995000-0000-7000-8000-0000000000e1";
  const journal = [
    { table: "transformation", key: ["t-1"], op: "added", via: "createTransformation" },
    { table: "raid_entry", key: ["r-1"], op: "added", via: "createRaidEntry" },
    { table: "raid_entry", key: ["r-1"], op: "added", via: "createRaidEntry (repeated)" },
    { table: "kpi_actual", key: ["k-1"], op: "changed", via: "addKpiActualValue" },
    { table: "kpi_actual", key: ["k-1"], op: "changed", via: "addKpiActualValue (repeated)" },
    { table: "gate_instance", key: ["gi-1"], op: "changed", via: "submitGate" },
    { table: "gate_submission", key: ["gs-1"], op: "added", via: "submitGate" },
    { table: "gate_decision", key: ["gd-1"], op: "added", via: "decideGate" },
    { table: "kpi_evaluation", key: ["ev-1"], op: "added", via: "getKpiStatus (worker-derived)" },
    { table: "kpi_evaluation", key: ["ev-1"], op: "added", via: "getKpiStatus (repeated)" },
    { table: "calculation_run", key: ["run-1"], op: "added", via: "getKpiStatus (worker-derived)" },
    { table: "decision", key: ["d-1"], op: "added", via: "decideGate" },
    { table: "export_job", key: ["e-1"], op: "added", via: "createExport" },
    { table: "user_identity", key: ["http://127.0.0.1:25401/realms/mth-test", "drill-a"], op: "signin", via: "signin" },
    { table: "user_identity", key: ["http://127.0.0.1:25401/realms/mth-test", "drill-a"], op: "signin", via: "again" },
  ];
  const identity = (iss, sub) => (sub === "drill-a" ? { id: "ui-1", userId: U1 } : null);

  it("writes a /4 file with all eight keys that parseAllowance (packages/db recheck.ts) accepts", async () => {
    const k = await constants();
    assert.equal(k.source, "packages/db/src/transfer/recheck.ts");
    assert.equal(k.schemaVersion, "mth-recheck-allowance/4");
    const { allowance, errors } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    assert.deepEqual(errors, []);
    assert.equal(allowance.schemaVersion, "mth-recheck-allowance/4");
    assert.deepEqual(Object.keys(allowance), [
      "schemaVersion",
      "actors",
      "tables",
      "audited",
      "children",
      "counters",
      "lineage",
      "operational",
    ]);
    const parsed = k.parseAllowance(Buffer.from(JSON.stringify(allowance), "utf8"));
    assert.deepEqual(parsed.actors, [U1]);
    // D8_TOUCHED_AUDITED plus A4.5's corrective_case (corrective_signal is in lineage)
    assert.equal(parsed.audited.length, Object.keys({ ...D8_TOUCHED_AUDITED, ...A45_REQUIRED_AUDITED }).length);
    assert.ok(parsed.audited.some((a) => a.name === "corrective_case"));
    assert.deepEqual(
      parsed.lineage.map((l) => l.name),
      Object.keys(D8_TOUCHED_LINEAGE).sort(),
    );
    assert.deepEqual(parsed.counters, Object.keys(D8_TOUCHED_COUNTERS).sort());
    // the worker's automation rows are explained by E* (A3.2), so they are audited, never operational
    for (const t of ["automation_execution", "automation_action_result"]) assert.ok(t in D8_TOUCHED_AUDITED, t);
  });

  it("a lineage table appears only in lineage; a journalled kpi_evaluation key goes to lineage[].mustInclude.added", async () => {
    const k = await constants();
    const { allowance, reasons } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    for (const l of allowance.lineage) {
      assert.ok(k.lineage.has(l.name), `${l.name} is in RECHECK_LINEAGE_TABLES`);
      for (const list of [allowance.tables, allowance.audited, allowance.children])
        assert.ok(!list.some((t) => t.name === l.name), l.name);
      assert.ok(!allowance.counters.includes(l.name) && !allowance.operational.includes(l.name), l.name);
    }
    const byName = Object.fromEntries(allowance.lineage.map((l) => [l.name, l]));
    assert.deepEqual(byName.kpi_evaluation.mustInclude, { added: [["ev-1"]] });
    assert.deepEqual(byName.calculation_run.mustInclude, { added: [["run-1"]] });
    assert.deepEqual(byName.corrective_signal.mustInclude, { added: [] });
    assert.ok(!allowance.tables.some((t) => k.lineage.has(t.name)), "a lineage journal key went to tables");
    assert.equal(reasons.schemaVersion, "mth-recheck-allowance-reasons/4");
    for (const r of reasons.lineage) assert.ok(typeof r.reason === "string" && r.reason.length > 10, JSON.stringify(r));
    // refusals: a changed lineage key; a lineage table missing from the list; a lineage name outside the constant
    const changed = buildAllowance([...journal, { table: "kpi_evaluation", key: ["ev-2"], op: "changed" }], {
      identity,
      constants: k,
    });
    assert.ok(
      changed.errors.includes(
        "kpi_evaluation is a lineage table (append-only, A4.2): the journal may not name a changed key",
      ),
      changed.errors.join("; "),
    );
    const missing = buildAllowance(journal, { identity, constants: k, lineage: { calculation_run: "test only" } });
    assert.ok(
      missing.errors.includes(
        "kpi_evaluation is a lineage table (RECHECK_LINEAGE_TABLES) missing from D8_TOUCHED_LINEAGE",
      ),
      missing.errors.join("; "),
    );
    const unknown = buildAllowance(journal, { identity, constants: k, lineage: { raid_entry: "not lineage" } });
    assert.ok(
      unknown.errors.includes("lineage table raid_entry is not in RECHECK_LINEAGE_TABLES"),
      unknown.errors.join("; "),
    );
    // parseAllowance itself refuses a lineage name outside RECHECK_LINEAGE_TABLES and a /3 file (BE-R4 A4.5)
    assert.throws(
      () =>
        k.parseAllowance(
          Buffer.from(JSON.stringify({ ...allowance, lineage: [{ name: "approval", mustInclude: { added: [] } }] })),
        ),
      /lineage table approval is not in RECHECK_LINEAGE_TABLES/,
    );
    assert.throws(
      () => k.parseAllowance(Buffer.from(JSON.stringify({ ...allowance, schemaVersion: "mth-recheck-allowance/3" }))),
      /unsupported schema version 'mth-recheck-allowance\/3'/,
    );
  });

  it("a counter table appears only in counters: in children, audited or the journal it is refused", async () => {
    const k = await constants();
    const { allowance } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    for (const c of allowance.counters) {
      assert.ok(k.counters.has(c), `${c} is in RECHECK_COUNTER_TABLES`);
      assert.ok(!allowance.tables.some((t) => t.name === c), c);
      assert.ok(!allowance.audited.some((t) => t.name === c), c);
      assert.ok(!allowance.children.some((t) => t.name === c), c);
      assert.ok(!allowance.operational.includes(c), c);
    }
    const asChild = buildAllowance(journal, {
      identity,
      constants: k,
      children: [{ name: "record_code_counter", parent: "transformation", fkey: "x_fkey", reason: "test" }],
    });
    assert.ok(
      asChild.errors.some((e) => e.includes("may appear only in counters")),
      asChild.errors.join("; "),
    );
    const unknown = buildAllowance(journal, { identity, constants: k, counters: { raid_entry: "not a counter" } });
    assert.ok(
      unknown.errors.includes("counter table raid_entry is not in RECHECK_COUNTER_TABLES"),
      unknown.errors.join("; "),
    );
    const journalled = buildAllowance(
      [...journal, { table: "record_code_counter", key: ["t-1", "I"], op: "changed", via: "a guess" }],
      { identity, constants: k, counters: {} },
    );
    assert.ok(
      journalled.errors.some((e) => e.startsWith("record_code_counter is a counter table")),
      journalled.errors.join("; "),
    );
    // parseAllowance itself refuses an unknown counter table (BE-R3 A3.4)
    assert.throws(
      () => k.parseAllowance(Buffer.from(JSON.stringify({ ...allowance, counters: ["kpi_evaluation"] }), "utf8")),
      /counter table kpi_evaluation is not in RECHECK_COUNTER_TABLES/,
    );
  });

  it("actors from sign-ins; journalled keys of audited tables go to mustInclude; duplicates merged", async () => {
    const k = await constants();
    const { allowance } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    assert.deepEqual(allowance.actors, [U1]);
    const byName = Object.fromEntries(allowance.tables.map((t) => [t.name, t]));
    assert.deepEqual(byName.raid_entry, { name: "raid_entry", added: [["r-1"]], changed: [] });
    assert.deepEqual(byName.kpi_actual, { name: "kpi_actual", added: [], changed: [["k-1"]] });
    assert.deepEqual(byName.user_identity, { name: "user_identity", added: [], changed: [["ui-1"]] });
    assert.deepEqual(byName.app_user, { name: "app_user", added: [], changed: [[U1]] });
    // gate_instance is audited (D8_TOUCHED_AUDITED): its journalled key is in mustInclude, never in tables.
    assert.ok(!byName.gate_instance);
    const gi = allowance.audited.find((a) => a.name === "gate_instance");
    assert.deepEqual(gi.mustInclude, { added: [], changed: [["gi-1"]] });
    assert.deepEqual(
      allowance.children.map((c) => c.name),
      D8_TOUCHED_CHILDREN.map((c) => c.name),
    );
  });

  it("never-operational tables appear only in tables, audited or children; reasons for every list entry", async () => {
    const k = await constants();
    const { allowance, reasons } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    for (const t of allowance.operational) assert.ok(!k.isNever(t), t);
    for (const t of ["gate_decision", "decision", "app_user", "user_identity", "kpi_actual", "scoped_assignment"])
      assert.ok(!allowance.operational.includes(t), t);
    assert.ok(
      allowance.tables.some((t) => t.name === "gate_decision") && allowance.tables.some((t) => t.name === "decision"),
    );
    assert.ok(!allowance.operational.includes("export_job"), "a table with exact keys is not also operational");
    assert.ok(allowance.operational.every((t) => k.operational.has(t)));
    assert.deepEqual(
      reasons.operational.map((r) => r.table),
      allowance.operational,
    );
    for (const list of [reasons.operational, reasons.audited, reasons.children, reasons.counters, reasons.lineage])
      for (const r of list) assert.ok(typeof r.reason === "string" && r.reason.length > 10, JSON.stringify(r));
  });

  it("the three D8 lists are pinned: audited tables have no child entry, children's parents are listed", async () => {
    const auditedNames = new Set(Object.keys(D8_TOUCHED_AUDITED));
    const k = await constants();
    const { allowance } = buildAllowance(journal, { identity, appUserChangedBySignIn: true, constants: k });
    const listed = new Set([
      ...allowance.tables.map((t) => t.name),
      ...auditedNames,
      ...D8_TOUCHED_CHILDREN.map((c) => c.name),
    ]);
    for (const c of D8_TOUCHED_CHILDREN) {
      assert.ok(!auditedNames.has(c.name), c.name);
      assert.ok(listed.has(c.parent), `parent ${c.parent} of ${c.name} is listed`);
      assert.match(c.fkey, /^[a-z][a-z0-9_]{0,62}$/);
    }
    for (const t of ["audit_event", "user_identity"]) assert.ok(!auditedNames.has(t), t);
    for (const c of Object.keys(D8_TOUCHED_COUNTERS))
      assert.ok(!auditedNames.has(c) && !D8_TOUCHED_CHILDREN.some((x) => x.name === c), c);
  });

  it("app_user is listed only when the measurement says a sign-in changes it", async () => {
    const k = await constants();
    const { allowance } = buildAllowance(journal, { identity, appUserChangedBySignIn: false, constants: k });
    assert.ok(!allowance.tables.some((t) => t.name === "app_user"));
    assert.deepEqual(allowance.actors, [U1], "the actor is still listed");
  });

  it("an audit_event entry, an unknown identity or a bad key is refused (exit 1 via the CLI)", async () => {
    const k = await constants();
    const { errors } = buildAllowance(
      [
        { table: "audit_event", key: ["a"], op: "added" },
        { table: "user_identity", key: ["iss", "nobody"], op: "signin" },
        { table: "raid_entry", key: [""], op: "added" },
      ],
      { identity, constants: k },
    );
    assert.equal(errors.length, 3);
    const dir = mkdtempSync(join(work, "allow-"));
    writeFileSync(
      join(dir, "j.json"),
      JSON.stringify({ entries: [{ table: "audit_event", key: ["a"], op: "added" }] }),
    );
    const r = spawnSync(
      "node",
      [
        join(REPO, "deploy/scripts/drill/allowance.mjs"),
        "--journal",
        join(dir, "j.json"),
        "--out",
        join(dir, "a.json"),
        "--reasons-out",
        join(dir, "r.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr);
  });
});

// --------------------------------------------------------------------------------------------- T-B16 job checks
describe("T-B16 job-check.mjs on a fixture database, digests from mth-db table-digest (§2.3 encoder)", () => {
  const db = `mth_td_jobs_${suffix}`;
  const JOB = join(REPO, "deploy/scripts/drill/job-check.mjs");
  let url;
  const run = (...args) => spawnSync("node", [JOB, ...args], { encoding: "utf8", env: { ...process.env } });
  const fresh = () => {
    const dir = mkdtempSync(join(work, "jobs-"));
    return { before: join(dir, "before.json"), out: join(dir, "out.json") };
  };
  // Fixture changes are written as the superuser with triggers off (session_replication_role = replica): they stand
  // for what a broken restart could do (job_run is append-only, approval rows are audited), never for product code.
  const raw = (sql) => psql(dbUrl(db), `SET session_replication_role = replica; ${sql}`);
  before(() => {
    if (!ADMIN) return;
    for (const r of ["mth_owner", "mth_app"])
      psql(
        ADMIN,
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} LOGIN; END IF; END $$;`,
      );
    psql(ADMIN, `CREATE DATABASE ${db} OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;`);
    psql(ADMIN, `GRANT CONNECT ON DATABASE ${db} TO mth_app;`);
    for (const c of ["migrate", "seed-demo"]) {
      const r = spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", c], {
        cwd: join(REPO, "packages/db"),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          HOME: work,
          DATABASE_OWNER_URL: dbUrl(db, "mth_owner"),
          NODE_ENV: "development",
        },
      });
      if (r.status !== 0) throw new Error(`mth-db ${c}: ${r.stdout}${r.stderr}`);
    }
    url = dbUrl(db, "mth_app");
    raw(
      `INSERT INTO job_run (id, job_schedule_code, job_id, attempt_no, outcome, started_at, finished_at)
         SELECT '00000000-0000-7000-8000-000000000001', code, 'fixture-1', 1, 'succeeded', now(), now()
           FROM job_schedule WHERE enabled ORDER BY code LIMIT 1;
       GRANT USAGE ON SCHEMA pgboss TO mth_app; GRANT SELECT ON ALL TABLES IN SCHEMA pgboss TO mth_app;`,
    );
  });
  after(() => {
    if (ADMIN) psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
  });

  it("the snapshot holds the encoder's digests: approval digests equal mth-db table-digest's", () => {
    needPg();
    const f = fresh();
    const r = run("snapshot", "--database-url", url, "--out", f.before);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const snap = JSON.parse(readFileSync(f.before, "utf8"));
    assert.equal(snap.schemaVersion, "mth-drill-job-snapshot/2");
    const d = tableDigest(url, ["gate_decision", "approval", "approval_decision"]);
    for (const t of ["gate_decision", "approval", "approval_decision"]) {
      assert.equal(snap.approvals[t].digest, d.get(t).digest, t);
      assert.match(snap.approvals[t].digest, /^[0-9a-f]{64}$/);
    }
    assert.ok(snap.enabledSchedules.count > 0 && Object.values(snap.enabledSchedules.lines).every(Boolean));
    assert.equal(snap.jobRun.count, 1);
  });

  it("a new job_run row passes (counted), and the pg-boss table is measured", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    raw(
      `INSERT INTO job_run (id, job_schedule_code, job_id, attempt_no, outcome, started_at, finished_at)
         SELECT '00000000-0000-7000-8000-000000000002', job_schedule_code, 'fixture-2', 1, 'succeeded', now(), now()
           FROM job_run LIMIT 1;`,
    );
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rep = JSON.parse(readFileSync(f.out, "utf8"));
    assert.equal(rep.result, "PASS");
    assert.equal(rep.newJobRuns, 1);
    assert.deepEqual([rep.before.pgBoss.schema, rep.before.pgBoss.table], ["pgboss", "job"]);
  });

  it("a changed enabled schedule fails", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    raw(`UPDATE job_schedule SET cron = '7 3 * * *' WHERE code = (SELECT min(code) FROM job_schedule WHERE enabled);`);
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /job_schedule: the enabled schedules changed/);
  });

  it("a removed job_run row fails", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    raw(`DELETE FROM job_run WHERE id = '00000000-0000-7000-8000-000000000001';`);
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /job_run: the earlier rows changed/);
  });

  it("a changed approval row fails, and changes the encoder digest", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    const d0 = tableDigest(url, ["gate_decision"]).get("gate_decision");
    raw(`UPDATE gate_decision SET rationale = rationale || ' (changed by the T-B16 fixture)'
           WHERE id = (SELECT id FROM gate_decision ORDER BY id LIMIT 1);`);
    const d1 = tableDigest(url, ["gate_decision"]).get("gate_decision");
    assert.equal(d1.rows, d0.rows);
    assert.notEqual(d1.digest, d0.digest, "a changed approval row changes the encoder digest");
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`gate_decision: ${d0.rows} -> ${d0.rows} rows, digest differs`));
  });

  it("a missing pg-boss table reports BLOCKED (exit 2), never PASS", () => {
    needPg();
    raw(`DROP SCHEMA pgboss CASCADE;`);
    const f = fresh();
    const r = run("snapshot", "--database-url", url, "--out", f.before);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: no pg-boss job table/);
    assert.doesNotMatch(r.stdout, /PASS/);
  });
});

// --------------------------------------------------------------------------------------------- T-B17 the D8 lists
// p7-work-split §B.7 DO-D3 T-B17 (PostgreSQL): the two D8 lists of allowance.mjs are MEASURED, not guessed. A fixture
// installation is built the drill's way (S: migrate + seed-demo; export; T: prepare-target, import, rebind every
// carried user to the SYNTHETIC drill IdP), the API runs on T under NODE_ENV=production and AUTH_MODE=oidc together with
// the worker, and D8's write chain (journey.mjs --steps signin,writes,approve) runs against it. Every exported table
// is compared, row by row through `mth-db table-digest --rows`, with a snapshot taken before; the changed tables minus
// the journalled `tables`, the operational list and user_identity must equal D8_TOUCHED_AUDITED ∪ D8_TOUCHED_CHILDREN.
// Then mode 2 runs on the fixture with the generated allowance (exit 0), and one extra owner-written row in an audited
// table, with its audit event by a user who is not journalled, gives exit 4.
// B.9 DO-D7: the installation is built by `fixtureSuite`, shared by T-B17 (a fresh seed-demo: shipped demo data, the
// current period open, no fixture grant) and T-B19 (seed-demo --as-of the first day of last month: the current period
// is absent, so D8 takes DO-D6's grant path).
/** The first day of last month in Asia/Riyadh (the demo organization's timezone, A4.6), as YYYY-MM-DD. */
/** The current business month in Asia/Riyadh (journey.mjs businessDate), as YYYY-MM. */
const businessMonth = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(now).slice(0, 7);
const firstDayOfLastMonth = (now = new Date()) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(now).split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
};
const fixtureSuite = (kind, title, asOf) =>
  describe(title, () => {
    const s = `mth_td_${kind}s_${suffix}`;
    const t = `mth_td_${kind}t_${suffix}`;
    const dir = join(work, kind);
    const pkg = join(dir, "package");
    const port = 29000 + Math.floor(Math.random() * 2900);
    const app = `http://127.0.0.1:${port}`;
    const issuer = `http://127.0.0.1:${port + 1}/realms/mth-test`;
    const journal = join(dir, "journal.json");
    let idp, api, worker, actors, tables;
    let apiLog = "";
    const OPERATOR = "transfer-drill synthetic operator";
    const env = (extra) => ({ PATH: process.env.PATH, HOME: work, TMPDIR: tmpdir(), LANG: "C.UTF-8", ...extra });
    const tool = (args, extra) => spawnSync("node", args, { cwd: REPO, encoding: "utf8", env: env(extra) });
    const db = (args, extra) =>
      spawnSync("node", ["--conditions=@mth/source", "src/cli.ts", ...args], {
        cwd: join(REPO, "packages/db"),
        encoding: "utf8",
        env: env(extra),
      });
    const ok = (r, what) => {
      if (r.status !== 0) throw new Error(`${what}: exit ${r.status}: ${r.stdout}${r.stderr}`);
      return r.stdout;
    };
    /** Every exported table, row by row (key -> line sha256), through mth-db table-digest --rows as mth_app. */
    const rows = () => {
      const d = tableDigest(dbUrl(t, "mth_app"), tables, { rows: true });
      return new Map([...d.values()].map((x) => [x.name, new Map(x.lines.map((l) => [l.key, l.sha256]))]));
    };
    const diff = (a, b) => {
      const changed = {};
      for (const [name, before] of a) {
        const after = b.get(name);
        let added = 0,
          changedRows = 0,
          missing = 0;
        for (const [k, h] of after)
          if (!before.has(k)) added++;
          else if (before.get(k) !== h) changedRows++;
        for (const k of before.keys()) if (!after.has(k)) missing++;
        if (added + changedRows + missing > 0) changed[name] = { added, changed: changedRows, missing };
      }
      return changed;
    };
    let before0, measured;
    let seedLine = "";

    before(
      async () => {
        if (!ADMIN) return;
        mkdirSync(pkg, { recursive: true });
        mkdirSync(join(dir, "evidence"), { recursive: true });
        for (const r of ["mth_owner", "mth_app"])
          psql(
            ADMIN,
            `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} LOGIN; END IF; END $$;`,
          );
        for (const d of [s, t]) {
          psql(ADMIN, `CREATE DATABASE ${d} OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;`);
          psql(ADMIN, `GRANT CONNECT ON DATABASE ${d} TO mth_app;`);
        }
        const S = { DATABASE_OWNER_URL: dbUrl(s, "mth_owner"), NODE_ENV: "development" };
        const T = { DATABASE_OWNER_URL: dbUrl(t, "mth_owner"), NODE_ENV: "production" };
        ok(db(["migrate"], S), "migrate S");
        const seeded = ok(db(asOf ? ["seed-demo", "--as-of", asOf] : ["seed-demo"], S), "seed-demo S");
        seedLine = seeded.split("\n").find((l) => l.includes("reporting periods relative to")) ?? "";
        ok(tool(["tools/migration/export.mjs", "--out", pkg, "--operator", OPERATOR], S), "export");
        ok(tool(["tools/migration/prepare-target.mjs", "--from", pkg], T), "prepare-target");
        ok(
          tool(["tools/migration/import.mjs", "--from", pkg, "--operator", OPERATOR], {
            ...T,
            DATABASE_URL: dbUrl(t, "mth_app"),
            EVIDENCE_STORAGE_DRIVER: "filesystem",
            EVIDENCE_STORAGE_PATH: join(dir, "evidence"),
          }),
          "import",
        );
        tables = JSON.parse(readFileSync(join(pkg, "manifest.json"), "utf8")).tables.map((x) => x.name);
        // The rebind: every carried user to the drill IdP (synthetic subjects), as D6 does.
        const held = psql(
          dbUrl(t, "mth_owner"),
          `SELECT user_id FROM identity_binding_hold WHERE state = 'unbound' ORDER BY user_id;`,
        ).split("\n");
        const mapping = join(dir, "mapping.csv");
        writeFileSync(
          mapping,
          "user_id,action,new_issuer,new_subject\n" +
            held.map((u) => `${u},rebind,${issuer},drill-${u}`).join("\n") +
            "\n",
        );
        ok(db(["rebind-identity", "--mapping", mapping, "--operator", OPERATOR], T), "rebind-identity");
        // The actors, chosen by permission among the rebound users (the drill's pick_actors).
        actors = JSON.parse(
          ok(
            spawnSync(
              "psql",
              [
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-v",
                "unbound=00000000-0000-0000-0000-000000000000",
                "-d",
                dbUrl(t, "mth_owner"),
              ],
              { input: readFileSync(join(REPO, "deploy/scripts/drill/pick-actors.sql"), "utf8"), encoding: "utf8" },
            ),
            "pick-actors.sql",
          ).trim(),
        );
        const secretDir = join(dir, "secrets");
        mkdirSync(secretDir, { recursive: true });
        const secret = randomBytes(24).toString("hex");
        writeFileSync(join(secretDir, "oidc"), secret);
        writeFileSync(join(secretDir, "db"), dbUrl(t, "mth_app"));
        idp = await startDrillIdp({
          port: port + 1,
          users: readUsers(JSON.stringify(held.map((u) => ({ sub: `drill-${u}`, name: "Drill user (synthetic)" })))),
          clientSecret: secret,
          redirectUris: [`${app}/api/v1/auth/callback`],
        });
        const runtime = {
          NODE_ENV: "production",
          AUTH_MODE: "oidc",
          APP_BASE_URL: app,
          PORT: String(port),
          DATABASE_URL_FILE: join(secretDir, "db"),
          OIDC_ISSUER_URL: issuer,
          OIDC_CLIENT_ID: "mth-test-client",
          OIDC_CLIENT_SECRET_FILE: join(secretDir, "oidc"),
          EVIDENCE_STORAGE_PATH: join(dir, "evidence"),
          LOG_LEVEL: "warn",
        };
        const start = (app_) => {
          const p = spawn("node", ["--conditions=@mth/source", "src/main.ts"], {
            cwd: join(REPO, `apps/${app_}`),
            env: env(runtime),
            stdio: ["ignore", "pipe", "pipe"],
          });
          p.stdout.on("data", (d) => (apiLog += d));
          p.stderr.on("data", (d) => (apiLog += d));
          return p;
        };
        api = start("api");
        worker = start("worker");
        for (let i = 0; i < 480; i++) {
          const body = await fetch(`${app}/readyz`).then(
            (r) => r.text(),
            () => "",
          );
          if (/"worker":"alive"/.test(body)) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        before0 = rows();
      },
      { timeout: 300_000 },
    );
    after(async () => {
      api?.kill("SIGTERM");
      worker?.kill("SIGTERM");
      await idp?.stop();
      if (ADMIN) for (const d of [s, t]) psql(ADMIN, `DROP DATABASE IF EXISTS ${d} WITH (FORCE);`);
    });

    if (kind === "b19") {
      // p7-work-split §B.9 DO-D7 T-B19 (PostgreSQL): DO-D6's grant path still works on shipped data. With seed-demo
      // --as-of the first day of last month, the current period is absent; D8's organization-scope access administrator
      // G grants TO to the period grantee through the API, the grantee opens the period, and the grant is journalled.
      it("T-B19: with the current period absent, G grants TO at organization scope and the period is opened through the API", async () => {
        needPg();
        const owner = dbUrl(t, "mth_owner");
        const month = businessMonth();
        assert.match(seedLine, /reporting periods relative to /, "seed-demo did not print the A4.6 line");
        assert.equal(
          psql(
            owner,
            `SELECT count(*) FROM reporting_period WHERE frequency = 'monthly' AND period_label = '${month}';`,
          ),
          "0",
          `the current period ${month} exists after seed-demo --as-of ${asOf}`,
        );
        assert.ok(actors.accessAdmin, `no organization-scope access administrator: ${JSON.stringify(actors)}`);
        assert.equal(actors.periodManager ?? null, null, "a rebound period manager already exists");
        const j19 = join(dir, "journal-t-b19.json");
        const r = await runJourney({
          app,
          issuer,
          user: `drill-${actors.submitter}`,
          actors,
          subPrefix: "drill-",
          gate: actors.gate,
          transformation: actors.transformation,
          steps: ["signin", "gatechain"],
          journal: j19,
        });
        const jr = JSON.parse(readFileSync(j19, "utf8"));
        if (process.env.MTH_DRILL_D8_MEASURE_OUT)
          writeFileSync(
            process.env.MTH_DRILL_D8_MEASURE_OUT.replace(/\.json$/, "-t-b19.json"),
            JSON.stringify({ asOf, seedLine, steps: r.steps, grants: jr.grants ?? [], actors }, null, 2) + "\n",
          );
        assert.equal(jr.grants?.length, 1, JSON.stringify(r.steps) + apiLog.slice(-2000));
        const g = jr.grants[0];
        assert.equal(g.via, "createRoleAssignment");
        assert.equal(g.grantor, actors.accessAdmin);
        assert.equal(g.userId, actors.periodGrantee);
        assert.equal(g.roleCode, "TO");
        assert.equal(g.scope.type, "organization");
        assert.deepEqual(r.grants, jr.grants, "the journey summary's grants differ from the journal's");
        // the grant is audited by G (the product's scoped_assignment.create), and the period is open
        assert.equal(
          psql(
            owner,
            `SELECT count(*) FROM audit_event WHERE record_type = 'scoped_assignment' AND record_id = '${g.assignmentId}'
              AND action = 'scoped_assignment.create' AND actor_user_id = '${actors.accessAdmin}';`,
          ),
          "1",
        );
        assert.equal(
          psql(owner, `SELECT status FROM reporting_period WHERE frequency = 'monthly' AND period_label = '${month}';`),
          "open",
        );
        assert.ok(
          jr.entries.some(
            (e) => e.table === "reporting_period" && e.op === "added" && e.via === "createReportingPeriod",
          ),
          "the created period is not journalled",
        );
      });
      return;
    }

    it("D8's write chain changes exactly the journalled tables, the operational list, user_identity and the two D8 lists", async () => {
      needPg();
      assert.ok(actors.transformation && actors.submitter && actors.approver, JSON.stringify(actors));
      const r = await runJourney({
        app,
        issuer,
        user: `drill-${actors.submitter}`,
        approver: `drill-${actors.approver}`,
        actors,
        subPrefix: "drill-",
        gate: actors.gate,
        transformation: actors.transformation,
        // T-DG7-DO-D7 (T-B11 run 2, D9: "report_snapshot: 1 added, 0 changed, 0 missing (unexplained)"): D9's report
        // export is part of the drill's writes too, so T-B17 measures it with the chain (exportq, then exportwait).
        steps: ["signin", "writes", "approve", "exportq", "exportwait"],
        journal,
      });
      // B.8 DO-D4: at least 30 s after C6 before the snapshot. The approve step waits itself when it reaches C6; when the
      // chain stopped earlier, the worker still gets the same 30 s here, so its rows are measured, never missed.
      const waited = r.steps.find((x) => x.step === "approve")?.result === "PASS" ? 0 : 30_000;
      await new Promise((res) => setTimeout(res, waited));
      // The measurement is recorded whatever the journey's result (a FAIL is asserted below, never hidden). The approve
      // step already waited at least 30 s after C6 for the worker (journey.mjs SETTLE_MS, B.8 DO-D4).
      const changed = diff(before0, rows());
      const k = await constants();
      const entries = JSON.parse(readFileSync(journal, "utf8")).entries;
      const owner = dbUrl(t, "mth_owner");
      const signedIn = new Set(
        entries
          .filter((e) => e.op === "signin")
          .map((e) =>
            psql(owner, `SELECT user_id FROM user_identity WHERE issuer = '${e.key[0]}' AND subject = '${e.key[1]}';`),
          ),
      );
      const journalled = new Set(entries.filter((e) => e.op !== "signin").map((e) => e.table));
      journalled.add("app_user"); // the T-B16 measurement: a sign-in changes app_user (listed as changed)
      const audited = new Set(Object.keys(D8_TOUCHED_AUDITED));
      for (const c of Object.keys(D8_TOUCHED_COUNTERS)) journalled.delete(c);
      // B.9 DO-D7: the journal keys of a lineage table never go to `tables` (A4.5), so every changed lineage table is
      // residue, whether or not the journal names its keys.
      for (const l of k.lineage) journalled.delete(l);
      const residue = Object.keys(changed)
        // audit_event: additions are always allowed and checked by the trail check (A1.9 rule 1, A2.3), never listed
        .filter((n) => n !== "user_identity" && n !== "audit_event" && !k.operational.has(n))
        .filter((n) => audited.has(n) || !journalled.has(n) || n in D8_TOUCHED_COUNTERS || k.lineage.has(n))
        .sort();
      // The measurement, written for the handback: each changed table, whether it is audited and its foreign keys.
      measured = {
        schemaVersion: "mth-drill-d8-measurement/1",
        changed,
        journalledTables: [...journalled].sort(),
        residue: residue.map((n) => ({
          table: n,
          auditRequired:
            psql(
              owner,
              `SELECT count(*) FROM pg_trigger WHERE tgrelid = '${n}'::regclass AND tgname = '${n}_audit_required' AND tgenabled <> 'D';`,
            ) === "1",
          fkeys: psql(
            owner,
            `SELECT coalesce(string_agg(conname || '->' || confrelid::regclass::text, ' ' ORDER BY conname), '')
             FROM pg_constraint WHERE conrelid = '${n}'::regclass AND contype = 'f';`,
          ),
        })),
        signedIn: [...signedIn].length,
        journey: r.steps.map((x) => ({ step: x.step, result: x.result, detail: x.detail })),
        gateChain: r.gateChain,
        actors,
        complete: r.result === "PASS",
        note: "SYNTHETIC fixture (seed-demo, drill IdP); measured by T-B17 on the ADR-0064 A3.6 chain C0-C6. complete=false: the chain stopped at the failing step, so the lists cover only the steps before it. Every write, including the gate submission and its deferred decision, is SYNTHETIC and approves nothing.",
      };
      if (process.env.MTH_DRILL_D8_MEASURE_OUT)
        writeFileSync(process.env.MTH_DRILL_D8_MEASURE_OUT, JSON.stringify(measured, null, 2) + "\n");
      console.log(`# T-B17 measurement: ${JSON.stringify(measured)}`);
      assert.equal(r.result, "PASS", JSON.stringify(r.steps) + apiLog.slice(-3000));
      assert.ok(
        r.steps.find((x) => x.step === "approve")?.detail.includes("deferred"),
        "the journey reached decideGate 201",
      );
      const expected = [
        ...audited,
        ...D8_TOUCHED_CHILDREN.map((c) => c.name),
        ...Object.keys(D8_TOUCHED_COUNTERS),
        ...Object.keys(D8_TOUCHED_LINEAGE),
      ].sort();
      assert.deepEqual(residue, expected, "the D8 lists differ from the measured changed tables");
      // A4.5's structural addition (corrective_case, for lineage corrective_signal) is not a measurement: it must not change.
      for (const n of Object.keys(A45_REQUIRED_AUDITED))
        assert.ok(!(n in changed), `${n} changed: ${JSON.stringify(changed[n])}`);
    });

    it("mode 2 with the generated allowance matches after use (exit 0)", () => {
      needPg();
      assert.ok(measured, "the measurement test must run first");
      const signin = join(dir, "app-user-signin.json");
      writeFileSync(signin, JSON.stringify({ appUserChangedBySignIn: true }) + "\n");
      const allow = join(dir, "allowance.json");
      const a = tool([
        "deploy/scripts/drill/allowance.mjs",
        "--journal",
        journal,
        "--database-url",
        dbUrl(t, "mth_owner"),
        "--app-user-signin",
        signin,
        "--out",
        allow,
        "--reasons-out",
        join(dir, "allowance-reasons.json"),
      ]);
      assert.equal(a.status, 0, a.stdout + a.stderr);
      const r = tool(
        [
          "tools/migration/reconcile.mjs",
          "--operator",
          OPERATOR,
          "--from",
          pkg,
          "--after-use",
          "--allow",
          allow,
          "--report",
          join(dir, "mode2.txt"),
        ],
        {
          DATABASE_OWNER_URL: dbUrl(t, "mth_owner"),
          NODE_ENV: "production",
        },
      );
      if (process.env.MTH_DRILL_D8_MEASURE_OUT)
        writeFileSync(process.env.MTH_DRILL_D8_MEASURE_OUT.replace(/\.json$/, "-mode2.txt"), r.stdout + r.stderr);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^reconcile-migration: matched after use:/m);
      // BE-R3 Q1: mode 2 writes <report>.json next to the text report; its automationChain must be non-empty (A3.2)
      const json = JSON.parse(readFileSync(join(dir, "mode2.txt.json"), "utf8"));
      if (process.env.MTH_DRILL_D8_MEASURE_OUT)
        writeFileSync(
          process.env.MTH_DRILL_D8_MEASURE_OUT.replace(/\.json$/, "-mode2.json"),
          JSON.stringify(json, null, 2),
        );
      assert.ok(Array.isArray(json.automationChain) && json.automationChain.length > 0, "automationChain is empty");
      // B.9 DO-D7: the second hop (A4.4 depth 2) is explained, and the lineage chain is non-empty (A4.2)
      assert.ok(
        json.automationChain.some((x) => x.depth === 2),
        `no depth-2 automationChain entry: ${JSON.stringify(json.automationChain.map((x) => x.depth))}`,
      );
      assert.ok(Array.isArray(json.lineageChain) && json.lineageChain.length > 0, "lineageChain is empty");
    });

    it("one extra owner-written row in an audited table, its event by a non-journalled user, gives exit 4", () => {
      needPg();
      // roadmap_wave: an audited D8 table with no row guard beyond its audit trigger (automation_action_result, the
      // first by name, refuses rows outside a running attempt).
      const name = "roadmap_wave";
      assert.ok(name in D8_TOUCHED_AUDITED, "roadmap_wave is not in D8_TOUCHED_AUDITED");
      const owner = dbUrl(t, "mth_owner");
      // B.9 DO-D7: the full chain signs in more actors (V, W, O, …), so the stranger is outside the allowance's whole
      // `actors` list, not only outside S, A and K (T-DG7-DO-D7 run 2: the first user by id was a journalled actor).
      const listedActors = JSON.parse(readFileSync(join(dir, "allowance.json"), "utf8")).actors;
      const stranger = psql(
        owner,
        `SELECT u.id FROM app_user u WHERE u.id <> ALL ('{${listedActors.join(",")}}'::uuid[]) ORDER BY u.id LIMIT 1;`,
      );
      assert.ok(stranger && !listedActors.includes(stranger), stranger);
      const id = psql(owner, "SELECT mth_uuid_v7();");
      // The row: a copy of an existing row of that table with a new id, its version 1, and its audit event.
      const hasVersion =
        psql(
          owner,
          `SELECT count(*) FROM information_schema.columns WHERE table_name = '${name}' AND column_name = 'version';`,
        ) === "1";
      psql(
        owner,
        `BEGIN;
       CREATE TEMP TABLE extra AS SELECT * FROM ${name} ORDER BY id LIMIT 1;
       UPDATE extra SET id = '${id}'${hasVersion ? ", version = 1" : ""}, code = 'tb17_extra';
       INSERT INTO ${name} SELECT * FROM extra;
       INSERT INTO audit_event (id, actor_type, actor_user_id, action, record_type, record_id, prior_version, new_version, source, reason)
         SELECT mth_uuid_v7(), 'user', '${stranger}', '${name}.create', '${name}', id, NULL, ${hasVersion ? "1" : "NULL"}, 'api',
                'T-B17 synthetic extra row by a user who is not journalled' FROM extra;
       COMMIT;`,
      );
      const r = tool(
        [
          "tools/migration/reconcile.mjs",
          "--operator",
          OPERATOR,
          "--from",
          pkg,
          "--after-use",
          "--allow",
          join(dir, "allowance.json"),
        ],
        { DATABASE_OWNER_URL: owner, NODE_ENV: "production" },
      );
      assert.equal(r.status, 4, r.stdout + r.stderr);
      assert.ok(
        (r.stdout + r.stderr).includes(`unexplained added ${JSON.stringify([id])}`),
        `the extra ${name} row ${id} is not reported unexplained:\n${r.stdout}${r.stderr}`,
      );
    });

    // p7-work-split §B.8 DO-D4 T-B18 (PostgreSQL): the remedy table is closed. On the same fixture, every active outcome
    // KPI link of the chosen transformation is archived (a SYNTHETIC fixture change made as the cluster superuser with
    // triggers off, labelled as such; it is not a product path), so the gate misses `g5.performance_no_kpi`, which has
    // no remedy row. The journey must stop at C1 with the A3.6 line and write nothing after it.
    it("T-B18: a missing code without a remedy row stops D8 at C1 with the A3.6 line, and nothing is written after it", async () => {
      needPg();
      assert.ok(actors?.transformation, "the fixture must exist");
      psql(
        dbUrl(t),
        `SET session_replication_role = replica;
       UPDATE outcome_kpi SET status = 'archived', archived_at = now(), archived_by = '${actors.submitter}',
              archive_reason = 'T-B18 SYNTHETIC fixture: no outcome KPI'
        WHERE transformation_id = '${actors.transformation}' AND status = 'active';`,
      );
      const watched = ["kpi_actual", "evidence", "phase_step_evidence", "decision", "raid_entry", "gate_submission"];
      const snap = () =>
        Object.fromEntries(
          watched.map((n) => [
            n,
            psql(dbUrl(t, "mth_owner"), `SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM ${n};`),
          ]),
        );
      const j18 = join(dir, "journal-t-b18.json");
      // C1 is reached directly: only the gate chain runs (the writes step's create and RAID item are D8's, not C1's)
      const before18 = snap();
      const r = await runJourney({
        app,
        issuer,
        user: `drill-${actors.submitter}`,
        actors,
        subPrefix: "drill-",
        gate: actors.gate,
        transformation: actors.transformation,
        steps: ["signin", "gatechain"],
        journal: j18,
      });
      const after18 = snap();
      if (process.env.MTH_DRILL_D8_MEASURE_OUT)
        writeFileSync(
          process.env.MTH_DRILL_D8_MEASURE_OUT.replace(/\.json$/, "-t-b18.json"),
          JSON.stringify({ steps: r.steps, gateChain: r.gateChain, before: before18, after: after18 }, null, 2),
        );
      const step = r.steps.find((x) => x.step === "gatechain");
      assert.equal(step?.result, "FAIL", JSON.stringify(r.steps));
      assert.match(step.detail, /^D8 FAIL: no API remedy for g5\.performance_no_kpi at \(no pointer\)$/);
      assert.ok(
        r.gateChain.c0Missing.some((m) => m.code === "g5.performance_no_kpi"),
        JSON.stringify(r.gateChain),
      );
      assert.deepEqual(r.gateChain.writes, [], "the chain wrote something after C0");
      assert.deepEqual(after18, before18, "a remedy table changed");
    });
  });

fixtureSuite(
  "b17",
  "T-B17 the D8 lists of allowance.mjs are measured on a fixture installation (mode 2 exit 0, then 4)",
);
fixtureSuite(
  "b19",
  "T-B19 DO-D6's grant path on shipped data: seed-demo --as-of the first day of last month (no current period)",
  firstDayOfLastMonth(),
);
