// The demonstration environment's marker and refusals (ADR-0050 §1, §3, §9; D-142 Q7; REQ-S18-001, REQ-S18-003;
// T-DG5-BE-S). A demo environment is its OWN database. Its marker is the one `deployment_environment` row (0090),
// written once by the initializing command and append-only:
//  - `mth-db bootstrap` writes `production` (via `bootstrap`);
//  - `mth-db seed-demo` / `reset-demo` write `demo` (via `seed_demo`) into a fresh database.
// No row is reported as `production` (fail-safe: a synthetic label is never shown on data that might be real).
//
// Every refusal is exit 3 and changes nothing. The texts are ADR-0050 §9's, exactly. Nothing here grants or records a
// business approval: product gates G1-G6 are business approvals inside the product, and a demo approval approves
// nothing real (M0412). Nothing reads or writes the engineering gates DG0-DG7.
import { sql } from "kysely";
import type { DbOrTx } from "../pool.ts";

/** The dataset of ADR-0050 §4 (0090 accepts only this code). */
export const DEMO_DATASET_CODE = "international_roaming";
/** Its version; stored in the marker and every run. */
export const DEMO_DATASET_VERSION = "1.0.0";
/** The synthetic clock (ADR-0050 §4): 2026-09-01 09:00 Asia/Riyadh. Every seeded time derives from it. */
export const DEMO_SYNTHETIC_CLOCK = "2026-09-01T06:00:00.000Z";
/** ADR-0050 §10: the demo reset's session advisory lock class (registry 730271) and its one class-wide key. */
export const DEMO_RESET_LOCK_CLASS = 730_271;
export const DEMO_RESET_LOCK_KEY = "demo";
/** The CLI's refusal exit code (ADR-0050 §3, §9). */
export const DEMO_REFUSAL_EXIT = 3;

export type EnvironmentKind = "production" | "demo";

export interface DeploymentEnvironment {
  readonly kind: EnvironmentKind;
  /** Whether the database has a marker at all (false = never initialized through a P5 command). */
  readonly marked: boolean;
  readonly synthetic: boolean;
  readonly datasetCode: string | null;
  readonly datasetVersion: string | null;
  readonly syntheticClockAt: Date | null;
}

/** Reads the marker. No row -> production, unmarked (ADR-0050 §1, fail-safe). */
export async function readDeploymentEnvironment(db: DbOrTx): Promise<DeploymentEnvironment> {
  const row = await db
    .selectFrom("deployment_environment")
    .select(["environment_kind", "dataset_code", "dataset_version", "synthetic_clock_at"])
    .executeTakeFirst();
  if (row === undefined)
    return {
      kind: "production",
      marked: false,
      synthetic: false,
      datasetCode: null,
      datasetVersion: null,
      syntheticClockAt: null,
    };
  const kind: EnvironmentKind = row.environment_kind === "demo" ? "demo" : "production";
  return {
    kind,
    marked: true,
    synthetic: kind === "demo",
    datasetCode: kind === "demo" ? row.dataset_code : null,
    datasetVersion: kind === "demo" ? row.dataset_version : null,
    syntheticClockAt: kind === "demo" ? row.synthetic_clock_at : null,
  };
}

/** A refused demo command (exit 3, nothing changed). `message` is the exact line the CLI prints. */
export class DemoRefused extends Error {
  readonly exitCode = DEMO_REFUSAL_EXIT;
  readonly reason: string;
  constructor(command: "seed-demo" | "reset-demo" | "bootstrap", reason: string) {
    super(`mth-db ${command}: refused: ${reason}`);
    this.name = "DemoRefused";
    this.reason = reason;
  }
}

/** ADR-0050 §3, the four seed-demo reasons (exact). */
export const SEED_DEMO_REFUSALS = {
  production: "MTH_ENV is production",
  productionMarker: "this database was initialized for production",
  notEmpty: "this database is not empty",
  alreadyDemo: "this database is already a demo database; use reset-demo",
} as const;

/** ADR-0050 §9, the reset-demo reasons (exact). */
export const RESET_DEMO_REFUSALS = {
  notDemoEnv: "MTH_ENV is not demo",
  noAdminUrl: "MTH_DEMO_ADMIN_DATABASE_URL is not set",
  notDemoDatabase: "the target database is not a demo database",
} as const;

/** ADR-0050 §9 (exact). */
export const BOOTSTRAP_DEMO_REFUSAL = "this database is a demo database";

/**
 * The seed-demo refusal for this database, or null when seeding is allowed (ADR-0050 §3 (a)-(d)). Reads only; the
 * caller runs it inside the seed transaction before any write, so a refusal changes nothing.
 */
export async function seedDemoRefusal(db: DbOrTx, mthEnv: string): Promise<string | null> {
  if (mthEnv === "production") return SEED_DEMO_REFUSALS.production;
  const env = await readDeploymentEnvironment(db);
  if (env.marked && env.kind === "production") return SEED_DEMO_REFUSALS.productionMarker;
  if (env.marked && env.kind === "demo") return SEED_DEMO_REFUSALS.alreadyDemo;
  const r = await sql<{ any_row: boolean }>`
    SELECT (EXISTS (SELECT 1 FROM transformation) OR EXISTS (SELECT 1 FROM app_user)) AS any_row`.execute(db);
  return r.rows[0]?.any_row === true ? SEED_DEMO_REFUSALS.notEmpty : null;
}

/** Throws DemoRefused (exit 3) unless seed-demo is allowed. */
export async function assertSeedDemoAllowed(db: DbOrTx, mthEnv: string): Promise<void> {
  const reason = await seedDemoRefusal(db, mthEnv);
  if (reason !== null) throw new DemoRefused("seed-demo", reason);
}

/** The reset-demo refusal from configuration alone (ADR-0050 §6, §9), or null. */
export function resetDemoConfigRefusal(mthEnv: string, adminUrl: string | null | undefined): string | null {
  if (mthEnv !== "demo") return RESET_DEMO_REFUSALS.notDemoEnv;
  if (adminUrl === null || adminUrl === undefined || adminUrl === "") return RESET_DEMO_REFUSALS.noAdminUrl;
  return null;
}

/**
 * D-165: whether `seed-demo` (and `reset-demo`) also bind the demo users to the dev issuer, so the dev sign-in of an
 * `AUTH_MODE=dev` stack can choose them. Only with AUTH_MODE=dev, and never with NODE_ENV=production (the same rule as
 * `mth-db seed-dev`); in every other mode nothing changes. No secret or password is involved.
 */
export function demoDevIssuerBindingAllowed(env: {
  readonly NODE_ENV?: string | undefined;
  readonly AUTH_MODE?: string | undefined;
}): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_MODE === "dev";
}
