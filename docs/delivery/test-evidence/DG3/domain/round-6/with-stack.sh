#!/usr/bin/env bash
# domain-reviewer DG3 round 6 disposable stack: PG 127.0.0.1:26401, API (serving the built web) :26402, UTF8 database,
# synthetic dev seed. Runs "$@" with the stack up, then tears everything down. Ports are in the reviewer's range 26400-26499.
set -euo pipefail
W=$(mktemp -d "$TMPDIR/stk.XXXX"); chmod 777 "$W"; cd "$TMPDIR/review-dom6"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:$PATH
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
PGP=${PGP:-26401}; APIP=${APIP:-26402}
AS_PG=(unshare --user --map-user=1000 --map-group=1000)
"${AS_PG[@]}" $PGBIN/initdb -D "$W/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" $PGBIN/postgres -D "$W/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p $PGP -c fsync=off > "$W/pg.log" 2>&1 &
PG=$!
API=""
trap 'set +e; [ -n "$API" ] && kill $API 2>/dev/null; kill -INT $PG 2>/dev/null; sleep 1; rm -rf "${W:?}"' EXIT
A=postgresql://postgres@127.0.0.1:$PGP/postgres
for _ in $(seq 1 60); do psql $A -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql $A -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
export NODE_ENV=development AUTH_MODE=dev PORT=$APIP APP_BASE_URL=http://localhost:$APIP LOG_LEVEL=warn E2E_BASE_URL=http://localhost:$APIP
export DATABASE_OWNER_URL="postgresql://postgres@127.0.0.1:$PGP/mth?options=-c%20role%3Dmth_owner"
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PGP/mth?options=-c%20role%3Dmth_app"
export PSQL_MTH="postgresql://postgres@127.0.0.1:$PGP/mth"
export AUTH_RATE_LIMIT_PER_MINUTE=1000 RATE_LIMIT_PER_MINUTE=100000
export EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$W/evidence"
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}
node packages/db/dist/cli.js migrate | tail -1
node packages/db/dist/cli.js seed-dev
node apps/api/dist/main.js > "$W/api.log" 2>&1 &
API=$!; export API_LOG="$W/api.log"
for _ in $(seq 1 60); do curl -fsS http://localhost:$APIP/readyz >/dev/null 2>&1 && break; sleep 0.5; done
echo "readyz: $(curl -fsS http://localhost:$APIP/readyz)"
set +e; "$@"; S=$?; set -e
echo "### stack command exit=$S"
[ $S -ne 0 ] && tail -40 "$W/api.log"
exit $S
