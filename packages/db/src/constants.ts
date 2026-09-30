/** Migration bookkeeping table (forward-only, checksum-locked). */
export const MIGRATION_TABLE = "schema_migration";

/** Migration file naming: NNNN_snake_case_description.sql, applied in lexical order, never edited once merged. */
export const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** PostgreSQL roles the migrations grant to (created by deployment, not by migrations; ADR-0003/ADR-0004). */
export const DB_ROLES = {
  owner: "mth_owner",
  app: "mth_app",
} as const;

/** Issuer bound to synthetic development users; dev login only accepts identities with this issuer (ADR-0005). */
export const DEV_ISSUER = "urn:mth:dev-local";
