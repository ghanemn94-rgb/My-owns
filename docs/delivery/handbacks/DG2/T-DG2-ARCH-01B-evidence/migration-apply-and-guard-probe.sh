#!/usr/bin/env bash
# Runs inside tests/qa/support/with-pg.sh (TEST_DATABASE_ADMIN_URL = disposable superuser URL).
set -uo pipefail
cd /home/user/My-owns
A="$TEST_DATABASE_ADMIN_URL"
base="${A%/postgres}"
psql "$A" -qAt -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE p2fresh OWNER mth_owner" -c "CREATE DATABASE p2backfill OWNER mth_owner"
OWNER="$base/p2fresh?options=-c%20role%3Dmth_owner"
echo "=== 1. mth-db migrate on an EMPTY database (0001 -> 0018) ==="
DATABASE_OWNER_URL="$OWNER" NODE_ENV=test node --conditions=@mth/source packages/db/src/cli.ts migrate; echo "migrate exit=$?"
psql "$base/p2fresh" -qAt -c "SELECT count(*) || ' migrations recorded; last = ' || max(name) FROM schema_migration"
echo "=== seeds ==="
psql "$base/p2fresh" -qAt -c "SELECT 'diagnostic_dimension=' || (SELECT count(*) FROM diagnostic_dimension) || ' diagnostic_workstream=' || (SELECT count(*) FROM diagnostic_workstream) || ' tom_dimension=' || (SELECT count(*) FROM tom_dimension) || ' gate_definition=' || (SELECT count(*) FROM gate_definition) || ' gate_criterion_definition=' || (SELECT count(*) FROM gate_criterion_definition) || ' scope_checks=' || (SELECT count(*) FROM charter_scope_check_definition) || ' good_outcome=' || (SELECT count(*) FROM good_outcome_criterion) || ' permissions=' || (SELECT count(*) FROM permission) || ' role_permission=' || (SELECT count(*) FROM role_permission)"
echo "=== guard probes (as mth_app, the runtime role) ==="
psql "$base/p2fresh" -v ON_ERROR_STOP=0 -f "$TMPDIR/p/probe.sql" 2>&1
echo "=== 2. backfill path: 0001-0009, a pre-P2 transformation, then 0010-0018 ==="
B="$base/p2backfill"
psql "$B" -q -v ON_ERROR_STOP=1 -c "SET ROLE mth_owner" -c "CREATE TABLE schema_migration (id integer PRIMARY KEY, name text NOT NULL UNIQUE, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL DEFAULT current_user)"
for f in packages/db/migrations/000[1-9]_*.sql; do n=$(basename "$f"); id=$((10#${n:0:4})); sha=$(sha256sum "$f" | cut -c1-64)
  psql "$B" -q -v ON_ERROR_STOP=1 -1 -c "SET ROLE mth_owner" -f "$f" -c "INSERT INTO schema_migration (id, name, sha256) VALUES ($id, '$n', '$sha')" >/dev/null || { echo "FAIL $f"; exit 1; }; done
echo "0001-0009 applied (P1 state)"
psql "$B" -q -v ON_ERROR_STOP=1 -1 -f "$TMPDIR/p/fixture.sql" && echo "pre-P2 transformation inserted"
DATABASE_OWNER_URL="$B?options=-c%20role%3Dmth_owner" NODE_ENV=test node --conditions=@mth/source packages/db/src/cli.ts migrate; echo "migrate (0010-0018 over populated P1 db) exit=$?"
psql "$B" -qAt -c "SELECT 'backfilled for pre-P2 transformation: pins=' || (SELECT count(*) FROM transformation_config_pin) || ' t01_rows=' || (SELECT count(*) FROM diagnostic_item) || ' tom_cells=' || (SELECT count(*) FROM tom_canvas_cell) || ' gate_instances=' || (SELECT count(*) FROM gate_instance) || ' audit_events(system,migration)=' || (SELECT count(*) FROM audit_event WHERE actor_type='system' AND source='migration')"
echo "=== append-only trigger as the OWNER (privileges bypassed) ==="
psql "$base/p2fresh" -v ON_ERROR_STOP=0 -c "SET ROLE mth_owner" -c "UPDATE charter_version SET transformation_name='tampered'" -c "DELETE FROM charter_version" -c "UPDATE gate_submission_criterion SET mandatory=false" -c "UPDATE evidence_content SET size_bytes=0" 2>&1
echo "=== 3. schema dump for schema.ts ==="
psql "$base/p2fresh" -qAt -c "SELECT json_agg(json_build_object('t',c.table_name,'c',c.column_name,'ty',c.udt_name,'n',c.is_nullable,'d',c.column_default) ORDER BY c.table_name,c.ordinal_position) FROM information_schema.columns c WHERE c.table_schema='public'" > "$TMPDIR/p/cols.json"
psql "$base/p2fresh" -qAt -c "SELECT json_object_agg(t,p) FROM (SELECT table_name t, string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants WHERE grantee='mth_app' AND table_schema='public' GROUP BY table_name) x" > "$TMPDIR/p/grants.json"
echo dumped
