#!/usr/bin/env node
// mth-db: the database CLI (ADR-0003). Uses DATABASE_OWNER_URL (owner role; migrations and bootstrap only).
//
//   mth-db migrate      apply pending migrations (advisory lock; refuses on checksum drift)     exit 0 | 1
//   mth-db status       report applied/pending; exit 0 only when up to date                     exit 0 | 3 | 4
//   mth-db bootstrap    first organization + first technical/access administrator (see bootstrap.ts)
//   mth-db seed-dev     SYNTHETIC dev-login users (refused with NODE_ENV=production or AUTH_MODE != dev)
//
// There is no `down`: recovery is backup/restore plus a new corrective migration (ADR-0003).
// Every command first requires a UTF8 database (encoding.ts, T-DG2-BE9): on any other encoding it prints
// "mth-db: the database must use UTF8 encoding (found …)" and exits 1 without changing anything.
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@mth/config";
import { bootstrap, BootstrapError } from "./bootstrap.ts";
import { DevSeedRefused, seedDev } from "./dev-seed.ts";
import { assertUtf8Database, DatabaseEncodingError } from "./encoding.ts";
import { migrate, MigrationError, migrationStatus } from "./migrate.ts";
import { createDb, createPool } from "./pool.ts";

const USAGE = `usage:
  mth-db migrate
  mth-db status
  mth-db bootstrap --org-code CODE --org-name-en NAME --org-name-ar NAME
                   --admin-name NAME [--admin-email EMAIL] --admin-issuer ISSUER --admin-subject SUB
  mth-db seed-dev`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "migrate" && command !== "status" && command !== "bootstrap" && command !== "seed-dev") {
    console.error(USAGE);
    return 64;
  }
  const config = loadConfig("db-cli");
  const ownerUrl = config.databaseOwnerUrl!;

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
    if (command === "status") {
      const client = await pool.connect();
      try {
        const s = await migrationStatus(client);
        for (const a of s.applied) console.log(`applied  ${a.name}`);
        for (const p of s.pending) console.log(`pending  ${p}`);
        for (const m of s.checksumMismatches)
          console.log(`CHANGED  ${m} (applied file content differs from this build)`);
        for (const u of s.unknownApplied) console.log(`UNKNOWN  ${u} (applied but not shipped with this build)`);
        if (s.upToDate) {
          console.log(`mth-db status: up to date (${s.applied.length} applied)`);
          return 0;
        }
        const drift = s.checksumMismatches.length > 0 || s.unknownApplied.length > 0;
        console.log(`mth-db status: ${drift ? "DRIFT" : `${s.pending.length} pending`}`);
        return drift ? 4 : 3;
      } finally {
        client.release();
      }
    }

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
