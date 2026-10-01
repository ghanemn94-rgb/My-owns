#!/usr/bin/env bash
# qa-verifier DG1 round-2 independent DB probe (run via tests/qa/support/with-pg.sh in a disposable clone).
# Fresh DB -> real `mth-db migrate` (0001..0009) -> audit_event immutability (app, owner, superuser)
# -> business_unit hierarchy guard (F-DG1-140 / migration 0009): direct-SQL cycle, depth > 10, and a CONCURRENT
#    two-session re-parent race that would close A -> C -> B -> A without a database-level guard.
set -uo pipefail
A="$TEST_DATABASE_ADMIN_URL"; export NODE_ENV=development
psql "$A" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE qaprobe OWNER mth_owner"
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/qaprobe";if(process.argv[2])u.searchParams.set("options","-c role="+process.argv[2]);console.log(u.toString())' "$A" "$1"; }
OWN="$(role_url mth_owner)"
DB="${A%/postgres}/qaprobe"
q() { local role=$1; shift; if [ -n "$role" ]; then PGOPTIONS="-c role=$role" psql "$DB" "$@"; else psql "$DB" "$@"; fi; }
echo "== migrate (fresh database)"; DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js migrate; echo "migrate exit=$?"
echo "== migrate again (idempotent)"; DATABASE_OWNER_URL="$OWN" node packages/db/dist/cli.js migrate; echo "migrate2 exit=$?"
echo "== schema_migration rows"; q "" -At -c "SELECT name FROM schema_migration ORDER BY 1"
echo "== insert one audit row as mth_app"
q mth_app -v ON_ERROR_STOP=1 -At -c "INSERT INTO audit_event(id,actor_type,action,record_type,record_id,source) VALUES (gen_random_uuid(),'system','qa.probe','qa_probe',gen_random_uuid(),'cli') RETURNING seq"; echo "insert exit=$?"
for who in mth_app mth_owner ""; do
  for stmt in "UPDATE audit_event SET reason='tamper'" "DELETE FROM audit_event" "TRUNCATE audit_event"; do
    out=$(q "$who" -v ON_ERROR_STOP=1 -At -c "$stmt" 2>&1); rc=$?
    echo "[${who:-postgres(superuser)}] $stmt -> exit=$rc :: $out"
  done
done
echo "== audit rows remaining (expect 1|<null>)"; q "" -At -c "SELECT count(*), max(coalesce(reason,'<null>')) FROM audit_event"

echo "== BU guard: setup (synthetic org QAPROBE, roots A B C, then C under B) as mth_app"
O=00000000-0000-4000-8000-0000000000a0; BA=00000000-0000-4000-8000-0000000000aa; BB=00000000-0000-4000-8000-0000000000bb; BC=00000000-0000-4000-8000-0000000000cc
q mth_app -v ON_ERROR_STOP=1 -q -c "INSERT INTO organization(id,code,name_en,name_ar) VALUES ('$O','QAPROBE','QA probe org (synthetic)','منظمة اختبار')" \
  -c "INSERT INTO business_unit(id,organization_id,code,name_en,name_ar) VALUES ('$BA','$O','A','A','أ'),('$BB','$O','B','B','ب'),('$BC','$O','C','C','ج')" \
  -c "UPDATE business_unit SET parent_business_unit_id='$BB' WHERE id='$BC'"; echo "setup exit=$?"
echo "== BU guard: direct cycle (B under C while C is under B) -> expect 23514 business_unit_acyclic"
out=$(q mth_app -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At -c "UPDATE business_unit SET parent_business_unit_id='$BC' WHERE id='$BB'" 2>&1); echo "exit=$? :: $out"
echo "== BU guard: concurrent race. T1: A under C (holds tx 3s). T2 (starts 0.5s later): B under A. Without a DB guard both commit -> A->C->B->A"
( q mth_app -v ON_ERROR_STOP=1 -At -c "BEGIN" -c "UPDATE business_unit SET parent_business_unit_id='$BC' WHERE id='$BA'" -c "SELECT pg_sleep(3)" -c "COMMIT" > "$TMPDIR/t1.out" 2>&1; echo "T1 exit=$?" >> "$TMPDIR/t1.out" ) &
P1=$!; sleep 0.5
( q mth_app -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At -c "BEGIN" -c "UPDATE business_unit SET parent_business_unit_id='$BA' WHERE id='$BB'" -c "COMMIT" > "$TMPDIR/t2.out" 2>&1; echo "T2 exit=$?" >> "$TMPDIR/t2.out" ) &
P2=$!; wait $P1 $P2
echo "-- T1:"; cat "$TMPDIR/t1.out"; echo "-- T2:"; cat "$TMPDIR/t2.out"
echo "== hierarchy after race (expect no cycle rows)"; q "" -At -c "SELECT code, (SELECT code FROM business_unit p WHERE p.id=b.parent_business_unit_id) FROM business_unit b WHERE organization_id='$O' ORDER BY code"
q "" -At -c "SELECT 'cycle_rows=' || count(*) FROM business_unit_closure WHERE ancestor_id=descendant_id AND depth>0"
echo "== BU guard: depth. chain D1..D10 (10 levels) ok; D11 under D10 -> expect business_unit_max_depth"
prev=NULL; rc_all=0
for i in $(seq 1 11); do id=$(printf '00000000-0000-4000-8000-0000000001%02d' $i)
  out=$(q mth_app -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At -c "INSERT INTO business_unit(id,organization_id,parent_business_unit_id,code,name_en,name_ar) VALUES ('$id','$O',$prev,'D$i','D$i','د$i')" 2>&1); rc=$?
  echo "D$i insert exit=$rc ${out:+:: $out}"; prev="'$id'"; done
echo "== closure max depth in org (expect 9)"; q "" -At -c "SELECT max(depth) FROM business_unit_closure WHERE organization_id='$O'"
