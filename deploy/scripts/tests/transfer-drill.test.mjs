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
import { buildAllowance, constants, A19_NEVER_OPERATIONAL } from "../drill/allowance.mjs";

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
describe("T-B15 allowance.mjs: mth-recheck-allowance/1 from a fixture journal", () => {
  const journal = [
    { table: "transformation", key: ["t-1"], op: "added", via: "createTransformation" },
    { table: "raid_entry", key: ["r-1"], op: "added", via: "createRaidEntry" },
    { table: "raid_entry", key: ["r-1"], op: "added", via: "createRaidEntry (repeated)" },
    { table: "kpi_actual", key: ["k-1"], op: "changed", via: "submitKpiActual" },
    { table: "kpi_actual", key: ["k-1"], op: "changed", via: "submitKpiActual (repeated)" },
    { table: "gate_decision", key: ["gd-1"], op: "added", via: "decideGate" },
    { table: "decision", key: ["d-1"], op: "added", via: "decideGate" },
    { table: "export_job", key: ["e-1"], op: "added", via: "createExport" },
    { table: "user_identity", key: ["http://127.0.0.1:25401/realms/mth-test", "drill-a"], op: "signin", via: "signin" },
    { table: "user_identity", key: ["http://127.0.0.1:25401/realms/mth-test", "drill-a"], op: "signin", via: "again" },
  ];
  const identity = (iss, sub) => (sub === "drill-a" ? { id: "ui-1", userId: "u-1" } : null);

  it("writes a valid allowance: exact keys merged, never-operational tables only in tables, reasons for each operational", async () => {
    const k = await constants();
    const { allowance, reasons, errors } = buildAllowance(journal, {
      identity,
      appUserChangedBySignIn: true,
      constants: k,
    });
    assert.deepEqual(errors, []);
    assert.equal(allowance.schemaVersion, "mth-recheck-allowance/1");
    assert.deepEqual(Object.keys(allowance), ["schemaVersion", "tables", "operational"]);
    const byName = Object.fromEntries(allowance.tables.map((t) => [t.name, t]));
    assert.deepEqual(byName.raid_entry, { name: "raid_entry", added: [["r-1"]], changed: [] });
    assert.deepEqual(byName.kpi_actual, { name: "kpi_actual", added: [], changed: [["k-1"]] });
    assert.deepEqual(byName.user_identity, { name: "user_identity", added: [], changed: [["ui-1"]] });
    assert.deepEqual(byName.app_user, { name: "app_user", added: [], changed: [["u-1"]] });
    // A RECHECK_NEVER_OPERATIONAL table goes in tables, never in operational.
    for (const t of [...k.never, "decision"]) assert.ok(!allowance.operational.includes(t), t);
    assert.ok(byName.gate_decision && byName.decision);
    // A table with exact keys is not also operational (A1.9 rule 7).
    assert.ok(!allowance.operational.includes("export_job"));
    assert.ok(allowance.operational.every((t) => k.operational.has(t)));
    assert.deepEqual(
      reasons.operational.map((r) => r.table),
      allowance.operational,
    );
    assert.ok(reasons.operational.every((r) => r.reason.length > 10));
    for (const t of A19_NEVER_OPERATIONAL) assert.ok(k.never.has(t), t);
  });

  it("app_user is listed only when the measurement says a sign-in changes it", async () => {
    const k = await constants();
    const { allowance } = buildAllowance(journal, { identity, appUserChangedBySignIn: false, constants: k });
    assert.ok(!allowance.tables.some((t) => t.name === "app_user"));
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

  it("BE-R1's parseAllowance (packages/db) accepts the file", async () => {
    const k = await constants();
    if (!k.parseAllowance)
      throw new Error(
        "BLOCKED: parseAllowance is not exported by packages/db/src/transfer/recheck.ts (T-DG7-BE-R1 gap 2); the file cannot be validated by it",
      );
    const { allowance } = buildAllowance(journal.slice(0, 8), { identity, constants: k });
    const parsed = k.parseAllowance(Buffer.from(JSON.stringify(allowance), "utf8"));
    assert.ok(parsed);
  });
});

// --------------------------------------------------------------------------------------------- T-B16 job checks
describe("T-B16 job-check.mjs on a fixture database", () => {
  const db = `mth_td_jobs_${suffix}`;
  const JOB = join(REPO, "deploy/scripts/drill/job-check.mjs");
  let url;
  const run = (...args) => spawnSync("node", [JOB, ...args], { encoding: "utf8" });
  const fresh = () => {
    const dir = mkdtempSync(join(work, "jobs-"));
    return { before: join(dir, "before.json"), out: join(dir, "out.json") };
  };
  before(() => {
    if (!ADMIN) return;
    psql(ADMIN, `CREATE DATABASE ${db} ENCODING 'UTF8' TEMPLATE template0;`);
    url = dbUrl(db);
    psql(
      url,
      `CREATE TABLE job_run (id uuid PRIMARY KEY, job_id text NOT NULL, status text NOT NULL);
       CREATE TABLE job_schedule (id uuid PRIMARY KEY, job_id text NOT NULL, cron text NOT NULL, enabled boolean NOT NULL);
       CREATE TABLE gate_decision (id uuid PRIMARY KEY, outcome text NOT NULL);
       CREATE TABLE approval (id uuid PRIMARY KEY, status text NOT NULL);
       CREATE TABLE approval_decision (id uuid PRIMARY KEY, outcome text NOT NULL);
       CREATE SCHEMA pgboss; CREATE TABLE pgboss.job (id uuid PRIMARY KEY, name text NOT NULL, state text NOT NULL);
       INSERT INTO job_run VALUES ('00000000-0000-7000-8000-000000000001', 'retention', 'succeeded');
       INSERT INTO job_schedule VALUES ('00000000-0000-7000-8000-0000000000a1', 'retention', '0 2 * * *', true),
                                       ('00000000-0000-7000-8000-0000000000a2', 'digest', '0 6 * * *', false);
       INSERT INTO gate_decision VALUES ('00000000-0000-7000-8000-0000000000b1', 'deferred');
       INSERT INTO pgboss.job VALUES ('00000000-0000-7000-8000-0000000000c1', 'export', 'created');`,
    );
  });
  after(() => {
    if (ADMIN) psql(ADMIN, `DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
  });

  it("a new job_run row passes (counted), and the pg-boss table is measured", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    psql(url, `INSERT INTO job_run VALUES ('00000000-0000-7000-8000-000000000002', 'export', 'succeeded');`);
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
    psql(url, `UPDATE job_schedule SET cron = '0 3 * * *' WHERE enabled;`);
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /job_schedule: the enabled schedules changed/);
  });

  it("a removed job_run row fails", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    psql(url, `DELETE FROM job_run WHERE id = '00000000-0000-7000-8000-000000000001';`);
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /job_run: the earlier rows changed/);
  });

  it("a changed approval row fails", () => {
    needPg();
    const f = fresh();
    assert.equal(run("snapshot", "--database-url", url, "--out", f.before).status, 0);
    psql(url, `UPDATE gate_decision SET outcome = 'approved';`);
    const r = run("compare", "--database-url", url, "--before", f.before, "--out", f.out);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /gate_decision: 1 -> 1 rows, digest differs/);
  });

  it("a missing pg-boss table reports BLOCKED (exit 2), never PASS", () => {
    needPg();
    psql(url, `DROP SCHEMA pgboss CASCADE;`);
    const f = fresh();
    const r = run("snapshot", "--database-url", url, "--out", f.before);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: no pg-boss job table/);
    assert.doesNotMatch(r.stdout, /PASS/);
  });
});
