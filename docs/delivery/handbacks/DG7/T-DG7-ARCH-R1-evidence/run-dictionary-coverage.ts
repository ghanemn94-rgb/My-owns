// T-DG7-ARCH-R1: the real dictionary-coverage run (T-F8 shape) on a DISPOSABLE database migrated with every shipped
// migration: creates the roles and a UTF8/C database owned by mth_owner, migrates as mth_owner, then runs the
// unmodified CLI `tools/release/dictionary-coverage.mjs` (--write-pgboss, then --out) and exits with its exit code.
//   tests/qa/support/with-pg.sh node --conditions=@mth/source \
//     docs/delivery/handbacks/DG7/T-DG7-ARCH-R1-evidence/run-dictionary-coverage.ts
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { migrate } from "../../../../../packages/db/src/migrate.ts";

const root = new URL("../../../../../", import.meta.url).pathname;
const pg = createRequire(new URL("packages/db/package.json", `file://${root}`))("pg");
const admin = process.env.TEST_DATABASE_ADMIN_URL!;
const c0 = new pg.Client({ connectionString: admin });
await c0.connect();
await c0.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END $$`);
await c0.query(`CREATE DATABASE cov_r1 OWNER mth_owner TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
await c0.end();
const u = new URL(admin);
u.pathname = "/cov_r1";
u.searchParams.set("options", "-c role=mth_owner");
const t0 = Date.now();
const applied = await migrate(u.toString(), { dir: `${root}packages/db/migrations` });
console.log(`migrate done in ${(Date.now() - t0) / 1000}s: ${JSON.stringify(applied).slice(0, 200)}`);
const tool = `${root}tools/release/dictionary-coverage.mjs`;
const pgboss = spawnSync(process.execPath, [tool, "--database-url", u.toString(), "--write-pgboss", `${root}docs/handover/data/pgboss.md`], { stdio: "inherit" });
console.log(`write-pgboss exit ${pgboss.status}`);
const cov = spawnSync(process.execPath, [tool, "--database-url", u.toString(), "--out", `${root}docs/handover/data/coverage.json`], { stdio: "inherit" });
console.log(`coverage exit ${cov.status}`);
process.exit(cov.status ?? 2);
