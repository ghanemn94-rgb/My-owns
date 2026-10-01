#!/usr/bin/env bash
# qa-verifier DG1 round 2: independent psql probe of a FRESH database migrated by the built CLI.
# Run INSIDE e2e/support/qa-stack.sh (which creates the disposable cluster, migrates and seeds SYNTHETIC dev data and
# exports DATABASE_OWNER_URL / DATABASE_URL):
#   QA_E2E_PG_PORT=5452 e2e/support/qa-stack.sh bash <this file>
# Checks: 8 migrations recorded; 0007 browser_binding_hash column + 32-byte CHECK; 0008 derived_from column + both
# CHECKs + partial index; audit_event trigger rejects UPDATE/DELETE even for the owner; mth_app has no UPDATE/DELETE.
set -uo pipefail
FAILS=0
q() { psql "$1" -qAtX -v ON_ERROR_STOP=1 -c "$2" 2>&1; }
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS $1: $3"; else echo "FAIL $1: expected [$2] got [$3]"; FAILS=$((FAILS + 1)); fi
}
expect_error() { # name url sql regex
  local out; out="$(q "$2" "$3")"; local rc=$?
  if [ $rc -ne 0 ] && grep -qE "$4" <<<"$out"; then echo "PASS $1: rejected ($(head -1 <<<"$out"))";
  else echo "FAIL $1: rc=$rc out=$out"; FAILS=$((FAILS + 1)); fi
}
# The stack's URLs come from URLSearchParams ("+" for a space); libpq only decodes %20.
O="${DATABASE_OWNER_URL//+/%20}"; A="${DATABASE_URL//+/%20}"
MIG_TABLE="$(q "$O" "select table_schema||'.'||table_name from information_schema.tables where table_name ilike '%migration%' and table_schema not in ('pg_catalog','information_schema') and table_schema <> 'pgboss' order by 1 limit 1")"
echo "migration table: $MIG_TABLE"
check "applied migrations" "8" "$(q "$O" "select count(*) from $MIG_TABLE")"
check "0007 column" "bytea|NO" "$(q "$O" "select data_type||'|'||is_nullable from information_schema.columns where table_name='oidc_login_state' and column_name='browser_binding_hash'")"
check "0007 length check" "1" "$(q "$O" "select count(*) from pg_constraint where conname='oidc_login_state_browser_binding_hash_len'")"
check "0008 column" "uuid|YES" "$(q "$O" "select data_type||'|'||is_nullable from information_schema.columns where table_name='scoped_assignment' and column_name='derived_from_assignment_id'")"
check "0008 checks" "2" "$(q "$O" "select count(*) from pg_constraint where conname in ('scoped_assignment_derived_not_self','scoped_assignment_derived_is_transformation')")"
check "0008 index" "1" "$(q "$O" "select count(*) from pg_indexes where indexname='scoped_assignment_derived_from_idx'")"
expect_error "0008 rule: derived only at transformation scope" "$O" \
  "update scoped_assignment set derived_from_assignment_id=(select id from scoped_assignment where scope_type<>'transformation' order by id offset 1 limit 1) where id=(select id from scoped_assignment where scope_type<>'transformation' order by id limit 1)" \
  "scoped_assignment_derived_is_transformation"
N="$(q "$O" "select count(*) from audit_event")"
echo "audit_event rows after seed: $N"
ID="$(q "$O" "select id from audit_event limit 1")"
expect_error "owner UPDATE audit_event" "$O" "update audit_event set reason='x' where id='$ID'" "append-only: UPDATE is not allowed"
expect_error "owner DELETE audit_event" "$O" "delete from audit_event where id='$ID'" "append-only: DELETE is not allowed"
expect_error "app UPDATE audit_event" "$A" "update audit_event set reason='x' where id='$ID'" "permission denied"
expect_error "app DELETE audit_event" "$A" "delete from audit_event where id='$ID'" "permission denied"
check "audit rows unchanged" "$N" "$(q "$O" "select count(*) from audit_event")"
echo "schema probe: $([ $FAILS -eq 0 ] && echo PASS || echo "FAIL ($FAILS)")"
exit $FAILS
