// @mth/db skeleton (T-DG1-ARCH-01). backend-workflow-engineer adds: the Kysely `Database` interface for the
// P1 tables (docs/architecture/data-dictionary.md), the pool factory and the migration runner (ADR-0003).

/** Migration bookkeeping table (forward-only, checksum-locked). */
export const MIGRATION_TABLE = "schema_migration";

/** Migration file naming: NNNN_snake_case_description.sql, applied in lexical order, never edited once merged. */
export const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** PostgreSQL roles the migrations grant to (created by deployment, not by migrations; ADR-0003/ADR-0004). */
export const DB_ROLES = {
  owner: "mth_owner",
  app: "mth_app",
} as const;
