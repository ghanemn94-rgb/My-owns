# @mth/db

**Responsibility.** Everything about the PostgreSQL schema (ADR-0003):
- `migrations/NNNN_description.sql`: forward-only, plain SQL, applied in order inside a transaction under
  `pg_advisory_lock`, recorded with a SHA-256 checksum in `schema_migration`. An applied migration is never edited.
  There are no down migrations; recovery is by backup/restore (§19 item 10).
- `src/cli.ts` (`mth-db migrate | status`): runs as the owner role (`DATABASE_OWNER_URL`), also installs the pg-boss schema.
- `src/` Kysely `Database` types for the tables in `docs/architecture/data-dictionary.md`, the pool factory and
  the transaction helper used by API and worker.
- `test/global-setup.ts`: creates and drops one disposable database per integration test run.

**Owner from P1:** backend-workflow-engineer (the only writer of `migrations/**`).
