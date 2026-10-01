#!/usr/bin/env bash
# qa-verifier DG1 round-1 independent DB probe (run via tests/qa/support/with-pg.sh in a disposable clone).
# attempt 1 had probe bugs (NODE_ENV unset; psql does not decode "+" in URL options) - see 12-db-probe-attempt1-probe-bug.log
# Fresh DB -> real `mth-db migrate` -> list applied migrations -> audit_event immutability for owner, app, superuser.
set -uo pipefail
A="$TEST_DATABASE_ADMIN_URL"; export NODE_ENV=development
psql "$A" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE qaprobe OWNER mth_owner"
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/qaprobe";if(process.argv[2])u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$A" "$1"; }
OWN="$(role_url mth_owner)"; APP="$(role_url mth_app)"; SU="$(role_url '')"
DB="${A%/postgres}/qaprobe"
q() { local role=$1; shift; if [ -n "$role" ]; then PGOPTIONS="-c role=$role" psql "$DB" "$@"; else psql "$DB" "$@"; fi; }
echo "== migrate (fresh database)"; DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js migrate; echo "migrate exit=$?"
echo "== migrate again (idempotent)"; DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js migrate; echo "migrate2 exit=$?"
echo "== status"; DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js status; echo "status exit=$?"
echo "== schema_migration rows"; q "" -At -c "SELECT name FROM schema_migration ORDER BY 1"
echo "== insert one audit row as mth_app"
q mth_app -v ON_ERROR_STOP=1 -At -c "INSERT INTO audit_event(id,actor_type,action,record_type,record_id,source) VALUES (gen_random_uuid(),'system','qa.probe','qa_probe',gen_random_uuid(),'cli') RETURNING seq"; echo "insert exit=$?"
for who in mth_app mth_owner ""; do
  for stmt in "UPDATE audit_event SET reason='tamper'" "DELETE FROM audit_event" "TRUNCATE audit_event"; do
    out=$(q "$who" -v ON_ERROR_STOP=1 -At -c "$stmt" 2>&1); rc=$?
    echo "[${who:-postgres(superuser)}] $stmt -> exit=$rc :: $out"
  done
done
echo "== rows remaining (expect 1, reason NULL)"; q "" -At -c "SELECT count(*), max(coalesce(reason,'<null>')) FROM audit_event"
