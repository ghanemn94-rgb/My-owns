#!/usr/bin/env node
// mth-db: the database CLI (ADR-0003). Uses DATABASE_OWNER_URL (owner role; migrations and bootstrap only).
//
//   mth-db migrate      apply pending migrations (advisory lock; refuses on checksum drift)     exit 0 | 1
//   mth-db status       report applied/pending; exit 0 only when up to date                     exit 0 | 3 | 4
//   mth-db bootstrap    first organization + first technical/access administrator (see bootstrap.ts)
//   mth-db seed-dev     SYNTHETIC dev-login users (refused with NODE_ENV=production or AUTH_MODE != dev)
//   mth-db seed-demo    SYNTHETIC demo dataset into a migrated, empty database (ADR-0050 §3, §6)          exit 0 | 3
//                       (AUTH_MODE=dev, never NODE_ENV=production: also binds the demo users to the dev issuer; D-165)
//   mth-db reset-demo   drop, re-create, migrate and re-seed the demo database (MTH_ENV=demo and
//                       MTH_DEMO_ADMIN_DATABASE_URL; ADR-0050 §6)                                         exit 0 | 3
// bootstrap writes the production marker and refuses (exit 3) on a demo database (ADR-0050 §3).
// ADR-0058 §2 (T-DG6-DO-E): bootstrap and seed-demo also refuse (exit 3, nothing changed) on a database that holds the
// synthetic load dataset (a load_dataset_marker row, written by deploy/load/generate.mjs).
//
// There is no `down`: recovery is backup/restore plus a new corrective migration (ADR-0003).
// Every command first requires a UTF8 database (encoding.ts, T-DG2-BE9): on any other encoding it prints
// "mth-db: the database must use UTF8 encoding (found …)" and exits 1 without changing anything.
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@mth/config";
import { bootstrap, BootstrapError } from "./bootstrap.ts";
import { runDemoCommand } from "./demo/cli.ts";
import { DemoRefused, demoDevIssuerBindingAllowed } from "./demo/guard.ts";
import { DevSeedRefused, seedDev } from "./dev-seed.ts";
import { assertUtf8Database, DatabaseEncodingError } from "./encoding.ts";
import { migrate, MigrationError, migrationStatus } from "./migrate.ts";
import { createDb, createPool } from "./pool.ts";

/** ADR-0058 §2: the refusal of bootstrap and seed-demo on a load database (exact text). */
export const LOAD_DATASET_CLI_REFUSAL =
  "This database holds the synthetic load dataset; it cannot be bootstrapped or seeded as a demo.";

/** Whether the database holds the load dataset's marker (false on a database migrated below 0108). */
async function holdsLoadDataset(pool: ReturnType<typeof createPool>): Promise<boolean> {
  const table = await pool.query<{ t: string | null }>("SELECT to_regclass('public.load_dataset_marker')::text AS t");
  if (table.rows[0]?.t === null || table.rows[0]?.t === undefined) return false;
  const marker = await pool.query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM load_dataset_marker) AS present");
  return marker.rows[0]?.present === true;
}

const USAGE = `usage:
  mth-db migrate
  mth-db status
  mth-db bootstrap --org-code CODE --org-name-en NAME --org-name-ar NAME
                   --admin-name NAME [--admin-email EMAIL] --admin-issuer ISSUER --admin-subject SUB
  mth-db seed-dev
  mth-db seed-demo
  mth-db reset-demo`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (
    command !== "migrate" &&
    command !== "status" &&
    command !== "bootstrap" &&
    command !== "seed-dev" &&
    command !== "seed-demo" &&
    command !== "reset-demo"
  ) {
    console.error(USAGE);
    return 64;
  }
  const config = loadConfig("db-cli");
  const ownerUrl = config.databaseOwnerUrl!;
  // D-165: in a dev-mode stack (AUTH_MODE=dev, never NODE_ENV=production) the demo users are also bound to the dev
  // issuer, so the dev sign-in can choose them. The same environment rule as seed-dev; nothing changes otherwise.
  const devIssuerBinding = demoDevIssuerBindingAllowed({
    NODE_ENV: process.env["NODE_ENV"],
    AUTH_MODE: process.env["AUTH_MODE"],
  });

  // ADR-0050 §6: the reset re-creates the database, so it checks nothing on it first (it creates it UTF8 itself).
  if (command === "reset-demo")
    return runDemoCommand(command, {
      mthEnv: config.mthEnv,
      ownerUrl,
      demoAdminUrl: config.demoAdminDatabaseUrl,
      devIssuerBinding,
    });

  if (command === "migrate") {
    const applied = await migrate(ownerUrl, { log: (l) => console.log(`mth-db migrate: ${l}`) });
    console.log(
      applied.length === 0
        ? "mth-db migrate: database is up to date"
        : `mth-db migrate: applied ${applied.length} migration(s)`,
    );
    return 0;
  }

  const pool = createPool(ownerUrl, { max: 2, applicationName: `mth-db ${command}` });
  try {
    // Same connection path as the work below; refuses before any read or write (migrate checks inside migrate()).
    await assertUtf8Database(pool);
    // ADR-0058 §2: a load database never receives a production or demo marker through the CLI.
    if ((command === "bootstrap" || command === "seed-demo") && (await holdsLoadDataset(pool))) {
      console.error(`mth-db ${command}: refused: ${LOAD_DATASET_CLI_REFUSAL}`);
      return 3;
    }
    if (command === "status") {
      const client = await pool.connect();
      try {
        const s = await migrationStatus(client);
        for (const a of s.applied) console.log(`applied  ${a.name}`);
        for (const p of s.pending) console.log(`pending  ${p}`);
        for (const m of s.checksumMismatches)
          console.log(`CHANGED  ${m} (applied file content differs from this build)`);
        for (const u of s.unknownApplied) console.log(`UNKNOWN  ${u} (applied but not shipped with this build)`);
        for (const o of s.outOfOrderPending)
          console.log(`ORDER    ${o} (pending, but its id is not above the highest applied id; migrate refuses it)`);
        if (s.upToDate) {
          console.log(`mth-db status: up to date (${s.applied.length} applied)`);
          return 0;
        }
        const drift = s.checksumMismatches.length > 0 || s.unknownApplied.length > 0 || s.outOfOrderPending.length > 0;
        console.log(`mth-db status: ${drift ? "DRIFT" : `${s.pending.length} pending`}`);
        return drift ? 4 : 3;
      } finally {
        client.release();
      }
    }

    if (command === "seed-demo")
      return await runDemoCommand(command, {
        mthEnv: config.mthEnv,
        ownerUrl,
        demoAdminUrl: config.demoAdminDatabaseUrl,
        devIssuerBinding,
      });

    const db = createDb(pool);
    if (command === "bootstrap") {
      const { values } = parseArgs({
        args: rest,
        options: {
          "org-code": { type: "string" },
          "org-name-en": { type: "string" },
          "org-name-ar": { type: "string" },
          "admin-name": { type: "string" },
          "admin-email": { type: "string" },
          "admin-issuer": { type: "string" },
          "admin-subject": { type: "string" },
        },
        strict: true,
      });
      const required = [
        "org-code",
        "org-name-en",
        "org-name-ar",
        "admin-name",
        "admin-issuer",
        "admin-subject",
      ] as const;
      const missing = required.filter((k) => values[k] === undefined);
      if (missing.length > 0) {
        console.error(`mth-db bootstrap: missing ${missing.map((m) => `--${m}`).join(", ")}\n${USAGE}`);
        return 64;
      }
      const result = await bootstrap(db, {
        orgCode: values["org-code"]!,
        orgNameEn: values["org-name-en"]!,
        orgNameAr: values["org-name-ar"]!,
        defaultTimezone: config.defaultTimezone,
        defaultCurrency: config.defaultCurrency,
        adminDisplayName: values["admin-name"]!,
        adminEmail: values["admin-email"] ?? null,
        adminIssuer: values["admin-issuer"]!,
        adminSubject: values["admin-subject"]!,
      });
      console.log(JSON.stringify({ bootstrapped: true, ...result }, null, 2));
      return 0;
    }

    // seed-dev
    const result = await seedDev(db, { NODE_ENV: process.env["NODE_ENV"], AUTH_MODE: process.env["AUTH_MODE"] });
    console.log(
      result.seeded
        ? `mth-db seed-dev: seeded SYNTHETIC dev users: ${result.users.join(", ")}`
        : "mth-db seed-dev: synthetic dev users already present; nothing written",
    );
    await db.destroy();
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof DemoRefused) {
      // ADR-0050 §9: "mth-db <command>: refused: <reason>", exit 3, nothing changed.
      console.error(err.message);
      process.exit(err.exitCode);
    }
    if (
      err instanceof ConfigError ||
      err instanceof MigrationError ||
      err instanceof BootstrapError ||
      err instanceof DevSeedRefused ||
      err instanceof DatabaseEncodingError
    ) {
      console.error(`mth-db: ${err.message}`);
    } else {
      console.error("mth-db: unexpected error:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  },
);
