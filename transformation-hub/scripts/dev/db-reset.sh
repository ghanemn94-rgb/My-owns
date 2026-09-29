#!/usr/bin/env bash
# DEV/TEST ONLY: drop and recreate the public schema of a local database, then migrate.
# Refuses to run against anything but localhost databases named hub_dev / hub_test*.
set -euo pipefail
DB="${1:-hub_dev}"
case "$DB" in hub_dev|hub_test*) ;; *) echo "refusing to reset $DB" >&2; exit 1;; esac
export PGPASSWORD="${HUB_DEV_DB_PASSWORD:-hub_dev_only}"
psql -h 127.0.0.1 -U hub_owner -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
CREATE SCHEMA public AUTHORIZATION hub_owner;
SQL
su postgres -c "psql -q -d $DB -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;'" 2>/dev/null || true
DATABASE_MIGRATION_URL="postgres://hub_owner:${PGPASSWORD}@127.0.0.1:5432/${DB}" pnpm --dir "$(dirname "$0")/../../packages/db" exec tsx src/cli/migrate.ts
