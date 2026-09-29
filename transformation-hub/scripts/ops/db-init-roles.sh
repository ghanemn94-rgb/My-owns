#!/usr/bin/env bash
# =====================================================================================================================
# Create the two database roles and the application database(s) — idempotent. Used by CI (PostgreSQL service
# container), by the Compose dev stack (postgres init script) and as the REFERENCE for DBAs provisioning production.
#
#   hub_owner  owns the schema and runs migrations (Job/hook only; never used by running pods)
#   hub_app    runtime role: LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE — RLS applies to it (ADR-0003)
#
#   PGADMIN_URL=postgres://postgres@db:5432/postgres HUB_OWNER_DB_PASSWORD=… HUB_APP_DB_PASSWORD=… \
#   HUB_DATABASES="hub" bash scripts/ops/db-init-roles.sh
#
# Without PGADMIN_URL the admin connection uses the local socket as $POSTGRES_USER (postgres image init phase).
# Passwords are passed as psql variables and quoted with format(%L); they are never echoed. Existing roles keep their
# password unless HUB_RESET_ROLE_PASSWORDS=true. In production, DBAs may use their own tooling and a managed
# PostgreSQL / operator; the attributes above and the per-database steps below are what the application requires.
# =====================================================================================================================
set -euo pipefail
: "${HUB_OWNER_DB_PASSWORD:?HUB_OWNER_DB_PASSWORD is required}"
: "${HUB_APP_DB_PASSWORD:?HUB_APP_DB_PASSWORD is required}"
DATABASES="${HUB_DATABASES:-hub}"
RESET="${HUB_RESET_ROLE_PASSWORDS:-false}"

# psql against database $1 on the admin connection (URL: its database part is replaced; socket: --dbname).
admin_db() {
  local db="$1"; shift
  if [ -n "${PGADMIN_URL:-}" ]; then
    local base="${PGADMIN_URL%%\?*}" query=""
    [ "$base" != "$PGADMIN_URL" ] && query="?${PGADMIN_URL#*\?}"
    psql -X -q -v ON_ERROR_STOP=1 -d "${base%/*}/${db}${query}" "$@"
  else
    psql -X -q -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "$db" "$@"
  fi
}
MAINT_DB="${HUB_ADMIN_MAINTENANCE_DB:-postgres}"

admin_db "$MAINT_DB" -v owner_pw="$HUB_OWNER_DB_PASSWORD" -v app_pw="$HUB_APP_DB_PASSWORD" -v reset="$RESET" <<'SQL'
SELECT format('CREATE ROLE hub_owner LOGIN NOSUPERUSER NOCREATEROLE PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_owner') \gexec
SELECT format('CREATE ROLE hub_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') \gexec
SELECT format('ALTER ROLE hub_owner PASSWORD %L', :'owner_pw') WHERE :'reset' = 'true' \gexec
SELECT format('ALTER ROLE hub_app PASSWORD %L', :'app_pw') WHERE :'reset' = 'true' \gexec
-- Enforce the runtime role's safety attributes even if the role pre-existed.
ALTER ROLE hub_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL

for db in $DATABASES; do
  case "$db" in *[!A-Za-z0-9_]*|'') echo "db-init-roles: invalid database name '$db'" >&2; exit 1 ;; esac
  admin_db "$MAINT_DB" -v db="$db" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER hub_owner', :'db') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO hub_app', :'db') \gexec
SQL
  # pgcrypto and citext are "trusted" extensions (the owner could create them), created here so the owner never
  # needs superuser rights.
  admin_db "$db" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' -c 'CREATE EXTENSION IF NOT EXISTS citext'
done
echo "db-init-roles: roles hub_owner/hub_app and database(s) ready: $DATABASES"
