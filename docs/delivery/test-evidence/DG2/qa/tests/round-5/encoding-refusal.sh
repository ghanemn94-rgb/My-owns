#!/usr/bin/env bash
# qa-verifier DG2 round 5 (D-065 regression, independent negative check). Run from the root of a BUILT disposable
# clone (`pnpm -r build`). Uses only a disposable PostgreSQL cluster created and removed here; no network.
#
#   QA_ENC_PG_PORT=55xxx QA_ENC_API_PORT=38xx bash encoding-refusal.sh
#
# Checks:
#  1. A database created with ENCODING 'SQL_ASCII' (and, as a second non-UTF8 case, 'LATIN1') is refused by every
#     `mth-db` command (migrate, status, bootstrap, seed-dev): exit 1 and the documented message, and NOTHING is
#     created (no relation, schema, function or type owned by a non-system role; no schema_migration table).
#  2. The API's /readyz on the SQL_ASCII database answers 503 with checks.database = "fail".
#  3. Control: a UTF8 database (same cluster, same roles) is accepted: migrate exit 0, /readyz database ok.
# Exits non-zero if any expectation fails. Prints PASS/FAIL per assertion.
set -uo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${QA_ENC_PG_PORT:-55431}"
API_PORT="${QA_ENC_API_PORT:-3843}"
[ -x "$PGBIN/initdb" ] || { echo "BLOCKED: PostgreSQL binaries not found"; exit 3; }
for f in packages/db/dist/cli.js apps/api/dist/main.js; do
  [ -f "$f" ] || { echo "BLOCKED: $f missing; run pnpm -r build"; exit 3; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qa-enc.XXXXXX")"
chmod 777 "$WORK"
PG_PID=""
API_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  if [ -n "$PG_PID" ]; then
    kill -INT "$PG_PID" 2>/dev/null
    for _ in $(seq 1 50); do kill -0 "$PG_PID" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$PG_PID" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then AS_PG=(unshare --user --map-user=1000 --map-group=1000); else AS_PG=(); fi
"${AS_PG[@]}" "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$ADMIN" -qAtc "select 'cluster: ' || version()" || { echo "BLOCKED: PostgreSQL did not start"; exit 3; }

psql "$ADMIN" -q -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" \
  -c "CREATE DATABASE qa_ascii OWNER mth_owner ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0" \
  -c "CREATE DATABASE qa_latin1 OWNER mth_owner ENCODING 'LATIN1' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0" \
  -c "CREATE DATABASE qa_utf8 OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
psql "$ADMIN" -qAtc "select datname || ': ' || pg_encoding_to_char(encoding) from pg_database where datname like 'qa_%' order by 1"

FAILS=0
check() { # $1 description, $2 condition result (0 = true)
  if [ "$2" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1"; FAILS=$((FAILS + 1)); fi
}
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];u.searchParams.set("options","-c role="+process.argv[3]);console.log(u.toString())' "$ADMIN" "$1" "$2"; }
db_url() { local u="${ADMIN%/postgres}/$1"; echo "$u"; }
objects() { # every non-system relation/schema/function/type in the database $1
  psql "$(db_url "$1")" -qAt -c "
    SELECT 'rel ' || n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    UNION ALL SELECT 'schema ' || nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_t%'
    UNION ALL SELECT 'func ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    UNION ALL SELECT 'type ' || t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND t.typtype IN ('e','d','c') AND t.typrelid = 0
    ORDER BY 1"
}

export NODE_ENV=development AUTH_MODE=dev LOG_LEVEL=info
for DB in qa_ascii qa_latin1; do
  ENC=$(psql "$ADMIN" -qAtc "select pg_encoding_to_char(encoding) from pg_database where datname='$DB'")
  export DATABASE_OWNER_URL="$(role_url "$DB" mth_owner)" DATABASE_URL="$(role_url "$DB" mth_app)"
  BEFORE="$(objects "$DB")"
  echo "== $DB ($ENC): objects before: [${BEFORE}]"
  for CMD in "migrate" "status" "seed-dev" \
    "bootstrap --org-code QA --org-name-en QA_Org --org-name-ar منظمة --admin-name QA_Admin --admin-issuer https://idp.invalid --admin-subject qa-sub"; do
    # shellcheck disable=SC2086
    OUT="$(node packages/db/dist/cli.js $CMD 2>&1)"
    RC=$?
    echo "\$ mth-db ${CMD%% *} -> exit $RC: $OUT"
    check "$DB: mth-db ${CMD%% *} exits 1" "$([ "$RC" = 1 ] && echo 0 || echo 1)"
    check "$DB: mth-db ${CMD%% *} prints the UTF8 refusal (found $ENC)" \
      "$(grep -qF "mth-db: the database must use UTF8 encoding (found $ENC)" <<<"$OUT" && echo 0 || echo 1)"
  done
  AFTER="$(objects "$DB")"
  echo "== $DB: objects after: [${AFTER}]"
  check "$DB: nothing created by any mth-db command" "$([ -z "$AFTER" ] && [ "$AFTER" = "$BEFORE" ] && echo 0 || echo 1)"
  check "$DB: no schema_migration table" \
    "$([ "$(psql "$(db_url "$DB")" -qAtc "select to_regclass('public.schema_migration') is null")" = t ] && echo 0 || echo 1)"
done

readyz() { # $1 database; prints "<http code> <body>"
  export DATABASE_OWNER_URL="$(role_url "$1" mth_owner)" DATABASE_URL="$(role_url "$1" mth_app)"
  PORT=$API_PORT APP_BASE_URL="http://localhost:$API_PORT" node apps/api/dist/main.js >"$WORK/api-$1.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$API_PORT/healthz" && break; sleep 0.5; done
  R="$(curl -s -w ' HTTP %{http_code}' "http://localhost:$API_PORT/readyz")"
  R2="$(curl -s -w ' HTTP %{http_code}' "http://localhost:$API_PORT/readyz")"
  kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; API_PID=""
  echo "$R | second call: $R2"
}
R="$(readyz qa_ascii)"
echo "\$ GET /readyz (API on qa_ascii) -> $R"
echo "   api log (encoding lines): $(grep -o 'readiness: the database must use UTF8 encoding (found [A-Z_0-9]*)' "$WORK/api-qa_ascii.log" | sort -u)"
check "readyz on SQL_ASCII: 503 not_ready with database fail (both calls)" \
  "$([ "$(grep -o '"database":"fail"' <<<"$R" | wc -l)" = 2 ] && [ "$(grep -o 'HTTP 503' <<<"$R" | wc -l)" = 2 ] && echo 0 || echo 1)"
check "readyz on SQL_ASCII: API logs the encoding reason" \
  "$(grep -q 'must use UTF8 encoding (found SQL_ASCII)' "$WORK/api-qa_ascii.log" && echo 0 || echo 1)"

# Control: UTF8 database is accepted.
export DATABASE_OWNER_URL="$(role_url qa_utf8 mth_owner)"
OUT="$(node packages/db/dist/cli.js migrate 2>&1)"; RC=$?
echo "\$ mth-db migrate (qa_utf8) -> exit $RC: $(tail -2 <<<"$OUT" | tr '\n' ' ')"
check "control qa_utf8: mth-db migrate exit 0" "$([ "$RC" = 0 ] && echo 0 || echo 1)"
R="$(readyz qa_utf8)"
echo "\$ GET /readyz (API on qa_utf8, migrated) -> $R"
check "control qa_utf8: readyz database ok, migrations ok, 200" \
  "$(grep -q '"database":"ok","migrations":"ok"}} HTTP 200' <<<"${R%% |*}" && echo 0 || echo 1)"

echo "assertion failures: $FAILS"
[ "$FAILS" = 0 ]
