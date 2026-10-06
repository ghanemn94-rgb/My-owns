#!/usr/bin/env bash
# PostgreSQL first-start initialization for the Compose stack (ADR-0003 "deployment creates both roles").
# Runs once, by the official postgres image entrypoint, only when the data volume is empty.
#   - mth_owner: owns database `mth`; migrations run as this role (DATABASE_OWNER_URL).
#   - mth_app:   runtime role of api/worker (DATABASE_URL); migrations GRANT it DML only, never DDL.
# Passwords come from mounted secret files; they are passed to psql as variables and never echoed.
# The database is explicitly UTF8 (ADR-0003 "Database encoding"; `mth-db` refuses any other encoding). Its collation
# and ctype are the cluster's initdb locale (template0 carries it): en_US.utf8 in the postgres image (compose.yaml
# also passes --encoding=UTF8 to initdb), C in the container-free clean start.
set -euo pipefail

SECRETS="${MTH_DB_INIT_SECRETS_DIR:-/run/secrets}" # overridable only for the local clean start
owner_pw="$(cat "$SECRETS/mth_owner_db_password")"
app_pw="$(cat "$SECRETS/mth_app_db_password")"

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname postgres \
  --set=owner_pw="$owner_pw" --set=app_pw="$app_pw" <<'SQL'
CREATE ROLE mth_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE mth_app LOGIN PASSWORD :'app_pw';
CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE mth FROM PUBLIC;
GRANT CONNECT ON DATABASE mth TO mth_app;
ALTER DATABASE mth SET timezone TO 'UTC';
SQL
echo "mth: roles mth_owner, mth_app and database mth created"
