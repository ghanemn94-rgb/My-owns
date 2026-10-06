#!/usr/bin/env bash
# domain-reviewer DG2 round 5 disposable stack: PG :54985, API :3985, UTF8 database, synthetic dev seed. Runs "$@" then tears down.
set -euo pipefail
W=$(mktemp -d $TMPDIR/stk.XXXX); chmod 777 $W; cd $TMPDIR/review-dom5
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:$PATH
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" $PGBIN/initdb -D $W/pg -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" $PGBIN/postgres -D $W/pg -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p 54985 -c fsync=off > $W/pg.log 2>&1 &
PG=$!
trap 'kill $API 2>/dev/null; kill -INT $PG 2>/dev/null; sleep 1; rm -rf $W' EXIT
A=postgresql://postgres@127.0.0.1:54985/postgres
for _ in $(seq 1 60); do psql $A -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql $A -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=development AUTH_MODE=dev PORT=3985 APP_BASE_URL=http://localhost:3985 LOG_LEVEL=warn E2E_BASE_URL=http://localhost:3985
export DATABASE_OWNER_URL='postgresql://postgres@127.0.0.1:54985/mth?options=-c%20role%3Dmth_owner'
export DATABASE_URL='postgresql://postgres@127.0.0.1:54985/mth?options=-c%20role%3Dmth_app'
export ADMIN_URL=$A PSQL_MTH='postgresql://postgres@127.0.0.1:54985/mth'
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=10000
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH=$W/evidence
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}
# UTF8 fail-closed probe (D-065): a SQL_ASCII database must be refused before anything is created
psql $A -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE mth_ascii OWNER mth_owner ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
set +e; DATABASE_OWNER_URL='postgresql://postgres@127.0.0.1:54985/mth_ascii?options=-c%20role%3Dmth_owner' node packages/db/dist/cli.js migrate; AS=$?; set -e
echo "UTF8-PROBE sql_ascii migrate exit=$AS tables_created=$(psql postgresql://postgres@127.0.0.1:54985/mth_ascii -qAtc "select count(*) from pg_tables where schemaname='public'")"
echo "UTF8-PROBE mth encoding=$(psql $PSQL_MTH -qAtc 'show server_encoding')"
node packages/db/dist/cli.js migrate | tail -1
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js > $W/api.log 2>&1 &
API=$!
for _ in $(seq 1 60); do curl -fsS http://localhost:3985/readyz >/dev/null 2>&1 && break; sleep 0.5; done
echo "readyz: $(curl -fsS http://localhost:3985/readyz)"
set +e; "$@"; S=$?; set -e
[ $S -ne 0 ] && tail -30 $W/api.log
exit $S
