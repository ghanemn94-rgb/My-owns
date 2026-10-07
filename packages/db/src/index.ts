// @mth/db public surface (ADR-0002, ADR-0003): Kysely schema types, pool/transaction helpers, the migration
// runner, the single audit insert path, bootstrap and the dev-only synthetic seed.
export { DB_ROLES, DEV_ISSUER, MIGRATION_FILE_PATTERN, MIGRATION_TABLE } from "./constants.ts";
export * from "./schema.ts";
export {
  connectionWithSessionOptions,
  createDb,
  createPool,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  isPoolCheckoutTimeout,
  withTransaction,
  type Db,
  type DbOrTx,
  type PoolOptions,
  type Tx,
} from "./pool.ts";
export {
  compareStatus,
  defaultMigrationsDir,
  listMigrationFiles,
  migrate,
  MigrationError,
  migrationStatus,
  sha256Hex,
  type AppliedMigration,
  type MigrationFile,
  type MigrationStatus,
} from "./migrate.ts";
export { assertUtf8Database, DatabaseEncodingError, readServerEncoding, REQUIRED_SERVER_ENCODING } from "./encoding.ts";
export {
  diffFields,
  insertAuditEvent,
  type ActorType,
  type AuditActor,
  type AuditEventInput,
  type AuditSource,
  type FieldChanges,
} from "./audit.ts";
export {
  bootstrap,
  BOOTSTRAP_ADMIN_ROLES,
  BootstrapError,
  validateBootstrapInput,
  type BootstrapInput,
  type BootstrapResult,
} from "./bootstrap.ts";
export { assertDevSeedAllowed, DevSeedRefused, devSeedFile, seedDev } from "./dev-seed.ts";
export { sql, type Expression, type SqlBool } from "kysely";
