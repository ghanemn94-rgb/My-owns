#!/usr/bin/env bash
# Creates the two database roles used by the platform (idempotent, DEV/TEST ONLY — production roles and
# passwords are provisioned by Mobily DBAs; see docs/deployment/installation.md):
#   hub_owner — owns schema objects, runs migrations (never used by the running app)
#   hub_app   — runtime role: NOT owner, NOBYPASSRLS, DML only; audit_event is INSERT/SELECT only
set -euo pipefail
DEV_PW="${HUB_DEV_DB_PASSWORD:-hub_dev_only}"
as_pg() { if [ "$(id -un)" = "postgres" ]; then psql -v ON_ERROR_STOP=1 -qAt "$@"; else su postgres -c "psql -v ON_ERROR_STOP=1 -qAt $*"; fi; }

as_pg <<SQL
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_owner') THEN
    CREATE ROLE hub_owner LOGIN PASSWORD '${DEV_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_app') THEN
    CREATE ROLE hub_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${DEV_PW}';
  END IF;
END
\$do\$;
SQL

for db in ${HUB_DATABASES:-hub_dev hub_test}; do
  exists="$(echo "SELECT 1 FROM pg_database WHERE datname = '${db}'" | as_pg)"
  if [ "${exists}" != "1" ]; then
    echo "CREATE DATABASE ${db} OWNER hub_owner" | as_pg
  fi
  as_pg -d "${db}" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE ${db} TO hub_app;
SQL
done
echo "roles hub_owner/hub_app and databases ready: ${HUB_DATABASES:-hub_dev hub_test}"
