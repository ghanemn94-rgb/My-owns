#!/usr/bin/env bash
# PostgreSQL first-start initialization for the Compose stack (ADR-0003 "deployment creates both roles").
# Runs once, by the official postgres image entrypoint, only when the data volume is empty.
#   - mth_owner: owns database `mth`; migrations run as this role (DATABASE_OWNER_URL).
#   - mth_app:   runtime role of api/worker (DATABASE_URL); migrations GRANT it DML only, never DDL.
# Passwords come from mounted secret files; they are passed to psql as variables and never echoed.
set -euo pipefail

SECRETS="${MTH_DB_INIT_SECRETS_DIR:-/run/secrets}" # overridable only for the local clean start
owner_pw="$(cat "$SECRETS/mth_owner_db_password")"
app_pw="$(cat "$SECRETS/mth_app_db_password")"

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname postgres \
  --set=owner_pw="$owner_pw" --set=app_pw="$app_pw" <<'SQL'
CREATE ROLE mth_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE mth_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE mth OWNER mth_owner;
REVOKE ALL ON DATABASE mth FROM PUBLIC;
GRANT CONNECT ON DATABASE mth TO mth_app;
ALTER DATABASE mth SET timezone TO 'UTC';
SQL
echo "mth: roles mth_owner, mth_app and database mth created"
