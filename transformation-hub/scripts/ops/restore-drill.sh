#!/usr/bin/env bash
# =====================================================================================================================
# Restore DRILL (AT-23) — DEV/TEST ONLY, against LOCAL scratch databases hub_drill_src and hub_drill_dst.
#
#   bash scripts/ops/restore-drill.sh            # full drill; results in .dev/drill/<ts>/drill.log
#   bash scripts/ops/restore-drill.sh --cleanup  # drop the drill databases afterwards
#   HUB_DRILL_BULK_ROWS=200000 HUB_DRILL_OBJECT_FILES=400 bash scripts/ops/restore-drill.sh
#                                                # adds SYNTHETIC volume (already-dispatched outbox rows with ~1 KiB
#                                                # payloads + more object files) to measure throughput, not capacity
#
# Steps: (re)create both databases → migrate + DEMO seed into src → simulate in-flight work (running/queued jobs,
# a 'sending' delivery, an overdue schedule, an undispatched outbox event, an active session, an audit checkpoint) →
# write synthetic object files → backup.sh → restore.sh into dst (timed) → independent cross-checks src vs dst.
# Roles/databases: scripts/dev/pg-init-roles.sh (local cluster), or scripts/ops/db-init-roles.sh when PGADMIN_URL is
# set (CI PostgreSQL service container).
# Prerequisites: local PostgreSQL 16 on 127.0.0.1:5432 (pnpm db:start), built packages and API
# (pnpm build:packages && (cd apps/api && npx tsc -p tsconfig.build.json)).
# Never point this script at a shared or production server: it refuses non-local hosts and other database names.
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${HUB_DRILL_PGHOST:-127.0.0.1}"
PORT="${HUB_DRILL_PGPORT:-5432}"
PW="${HUB_DEV_DB_PASSWORD:-hub_dev_only}"
SRC=hub_drill_src
DST=hub_drill_dst
OBJECT_FILES="${HUB_DRILL_OBJECT_FILES:-40}"
BULK_ROWS="${HUB_DRILL_BULK_ROWS:-0}"
CLEANUP=0
[ "${1:-}" = "--cleanup" ] && CLEANUP=1

case "$HOST" in 127.0.0.1|localhost|::1) ;; *) echo "drill: refusing non-local host $HOST" >&2; exit 1 ;; esac
TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${HUB_DRILL_DIR:-$ROOT/.dev/drill}/$TS"
mkdir -p "$WORK"
LOG="$WORK/drill.log"
exec > >(tee -a "$LOG") 2>&1

owner_url() { echo "postgres://hub_owner:${PW}@${HOST}:${PORT}/$1"; }
app_url() { echo "postgres://hub_app:${PW}@${HOST}:${PORT}/$1"; }
# Maintenance connection: the admin URL in CI (roles may not exist yet), otherwise the owner role.
maint_url() { if [ -n "${PGADMIN_URL:-}" ]; then echo "$PGADMIN_URL"; else owner_url postgres; fi; }
now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
step() { echo; echo "=== $* ($(date -u +%H:%M:%SZ))"; }
psql_owner() { local db="$1"; shift; psql -X -q -At -v ON_ERROR_STOP=1 -d "$(owner_url "$db")" "$@"; }
psql_app() { local db="$1"; shift; psql -X -q -At -v ON_ERROR_STOP=1 -d "$(app_url "$db")" "$@"; }
RESULT=0
verdict() { if [ "$2" = PASS ]; then printf 'PASS  %-52s %s\n' "$1" "$3"; else printf 'FAIL  %-52s %s\n' "$1" "$3"; RESULT=1; fi; }

echo "Transformation Hub restore drill $TS (synthetic bulk rows: $BULK_ROWS, object files: $OBJECT_FILES)"
echo "host: $(uname -srm); $(psql --version); $(pg_dump --version); node $(node --version)"
echo "server: $(psql -X -At -d "$(maint_url)" -c 'show server_version')"
[ -f "$ROOT/apps/api/dist/cli/seed-demo.js" ] && [ -f "$ROOT/packages/db/dist/index.js" ] \
  || { echo "drill: build first: pnpm build:packages && (cd apps/api && npx tsc -p tsconfig.build.json)" >&2; exit 1; }

step "1. recreate $SRC and $DST"
for db in "$SRC" "$DST"; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$(maint_url)" -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"
done
if [ -n "${PGADMIN_URL:-}" ]; then
  # CI / remote test server: create roles and databases over TCP with an admin URL (scripts/ops/db-init-roles.sh)
  HUB_DATABASES="$SRC $DST" HUB_OWNER_DB_PASSWORD="$PW" HUB_APP_DB_PASSWORD="$PW" bash "$ROOT/scripts/ops/db-init-roles.sh"
else
  HUB_DATABASES="$SRC $DST" bash "$ROOT/scripts/dev/pg-init-roles.sh"
fi

step "2. migrate + DEMO seed into $SRC (entrypoint 'migrate' command, then seed-demo.js)"
T=$(now)
DATABASE_MIGRATION_URL="$(owner_url "$SRC")" DATABASE_URL="$(app_url "$SRC")" node "$ROOT/deploy/docker/api-entrypoint.cjs" migrate
echo "migrate: $(elapsed "$T" "$(now)")s"
T=$(now)
(cd "$ROOT/apps/api" && DATABASE_URL="$(app_url "$SRC")" DATABASE_MIGRATION_URL="$(owner_url "$SRC")" HUB_MODE=demo NODE_ENV=test \
  HUB_STORAGE_LOCAL_DIR="$WORK/src-objects" node dist/cli/seed-demo.js | tail -3)
echo "seed: $(elapsed "$T" "$(now)")s"

step "3. simulate in-flight state in $SRC (infrastructure tables; clearly marked drill rows)"
psql_owner "$SRC" <<'SQL'
DO $d$
DECLARE o uuid; u uuid;
BEGIN
  SELECT id INTO o FROM organization ORDER BY created_at LIMIT 1;
  SELECT id INTO u FROM app_user WHERE org_id = o ORDER BY created_at LIMIT 1;
  INSERT INTO job (id, org_id, kind, payload, idempotency_key, status, attempts, locked_by, locked_until, run_at)
    VALUES (gen_random_uuid(), o, 'drill.notify', '{"drill":true}', 'drill:running-1', 'running', 1, 'worker-drill', now() + interval '2 minutes', now() - interval '1 minute');
  INSERT INTO job (id, org_id, kind, payload, idempotency_key, status, run_at)
    VALUES (gen_random_uuid(), o, 'drill.report', '{"drill":true}', 'drill:queued-due-1', 'queued', now() - interval '5 minutes'),
           (gen_random_uuid(), o, 'drill.report', '{"drill":true}', 'drill:queued-future-1', 'queued', now() + interval '1 day');
  INSERT INTO job (id, org_id, kind, payload, idempotency_key, status, finished_at)
    VALUES (gen_random_uuid(), o, 'drill.report', '{"drill":true}', 'drill:succeeded-1', 'succeeded', now());
  INSERT INTO delivery_record (id, org_id, idempotency_key, channel, recipient_user_id, payload_hash, status)
    VALUES (gen_random_uuid(), o, 'drill:delivery-sending-1', 'email', u, repeat('a', 64), 'sending'),
           (gen_random_uuid(), o, 'drill:delivery-sent-1', 'email', u, repeat('b', 64), 'sent');
  INSERT INTO scheduled_job (id, org_id, kind, name, cron, timezone, next_run_at, owner_user_id)
    VALUES (gen_random_uuid(), o, 'drill.briefing', 'Drill daily briefing (synthetic)', '30 7 * * *', 'Asia/Riyadh', now() - interval '3 hours', u);
  INSERT INTO outbox_event (id, org_id, type, payload) VALUES (gen_random_uuid(), o, 'drill.event', '{"drill":true}');
  INSERT INTO session (id, token_hash, csrf_hash, user_id, org_id, auth_method, idle_expires_at, absolute_expires_at)
    VALUES (gen_random_uuid(), encode(gen_random_bytes(32), 'hex'), encode(gen_random_bytes(32), 'hex'), u, o, 'demo', now() + interval '1 hour', now() + interval '12 hours');
  PERFORM hub_audit_checkpoint(o);
END
$d$;
SQL
psql_owner "$SRC" -c "select 'src state: jobs ' || (select string_agg(status || '=' || n, ' ') from (select status::text, count(*) n from job group by 1 order by 1) s) || '; deliveries ' || (select string_agg(status || '=' || n, ' ') from (select status::text, count(*) n from delivery_record group by 1 order by 1) d) || '; audit_event ' || (select count(*) from audit_event) || '; checkpoints ' || (select count(*) from audit_checkpoint)"

if [ "$BULK_ROWS" -gt 0 ]; then
  T=$(now)
  psql_owner "$SRC" -v n="$BULK_ROWS" <<'SQL'
INSERT INTO outbox_event (id, org_id, type, payload, created_at, dispatched_at, attempts)
SELECT gen_random_uuid(), (SELECT id FROM organization ORDER BY created_at LIMIT 1), 'drill.bulk',
       jsonb_build_object('drill', true, 'seq', g, 'pad', encode(gen_random_bytes(512), 'hex')), now(), now(), 1
  FROM generate_series(1, :'n'::int) g;
SQL
  echo "bulk synthetic volume: $BULK_ROWS dispatched outbox rows in $(elapsed "$T" "$(now)")s; database size $(psql_owner "$SRC" -c "select pg_size_pretty(pg_database_size(current_database()))")"
fi

step "4. object store: demo document objects written by the seed + $OBJECT_FILES synthetic volume files"
echo "document objects written by the demo seed (documents|quarantine/<project>/<version>): $(find "$WORK/src-objects" -type f 2>/dev/null | wc -l)"
echo "document_version rows: $(psql_owner "$SRC" -c 'select count(*) from document_version')"
# Synthetic volume lives in its own area so it can never be mistaken for a document object.
mkdir -p "$WORK/src-objects/drill-synthetic"
for i in $(seq 1 "$OBJECT_FILES"); do
  head -c $(( (i * 7919) % 262144 + 1024 )) /dev/urandom >"$WORK/src-objects/drill-synthetic/$(cat /proc/sys/kernel/random/uuid)"
done
echo "objects total: $(find "$WORK/src-objects" -type f | wc -l) files, $(du -sh "$WORK/src-objects" | cut -f1)"

step "5. backup ($SRC)"
T=$(now)
DATABASE_BACKUP_URL="$(owner_url "$SRC")" bash "$ROOT/scripts/ops/backup.sh" --out "$WORK/backup" \
  --objects-dir "$WORK/src-objects" --config "$ROOT/deploy/compose/.env.example" --label restore-drill
BACKUP_S=$(elapsed "$T" "$(now)")
echo "backup wall time: ${BACKUP_S}s; size $(du -sh "$WORK/backup" | cut -f1)"

step "6. restore into $DST (timed)"
T=$(now)
set +e
DATABASE_RESTORE_URL="$(owner_url "$DST")" bash "$ROOT/scripts/ops/restore.sh" --from "$WORK/backup" \
  --objects-dir "$WORK/dst-objects" --verify-app-url "$(app_url "$DST")" --report "$WORK/restore-report.txt" --yes
RESTORE_RC=$?
set -e
RESTORE_S=$(elapsed "$T" "$(now)")
echo "restore.sh exit code $RESTORE_RC; wall time ${RESTORE_S}s"
[ "$RESTORE_RC" = 0 ] || RESULT=1

if [ "$RESTORE_RC" != 0 ]; then echo "DRILL RESULT: FAIL (restore.sh failed; see $WORK)"; exit 1; fi

step "7. independent cross-checks (live $SRC vs $DST)"
COUNTS_SQL="SELECT string_agg(format('SELECT %L || chr(9) || count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' UNION ALL ') || ' ORDER BY 1' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','drizzle') \\gexec"
echo "$COUNTS_SQL" | psql_owner "$SRC" >"$WORK/src.counts"
echo "$COUNTS_SQL" | psql_owner "$DST" >"$WORK/dst.counts"
NT=$(wc -l <"$WORK/src.counts" | tr -d ' ')
NR=$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/src.counts")
NONEMPTY=$(awk -F'\t' '$2 > 0' "$WORK/src.counts" | wc -l | tr -d ' ')
if diff -q "$WORK/src.counts" "$WORK/dst.counts" >/dev/null; then verdict "row counts src = dst (every table)" PASS "$NT tables ($NONEMPTY non-empty), $NR rows"
else verdict "row counts src = dst (every table)" FAIL "$(diff "$WORK/src.counts" "$WORK/dst.counts" | head -5 | tr '\n' ' ')"; fi

for org in $(psql_owner "$DST" -c 'select id from organization order by created_at'); do
  b=$(psql_owner "$DST" -c "select count(*) from hub_audit_verify('$org')")
  hs=$(psql_owner "$SRC" -c "select max(chain_pos) || '/' || (array_agg(hash order by chain_pos desc))[1] from audit_event where org_id = '$org'")
  hd=$(psql_owner "$DST" -c "select max(chain_pos) || '/' || (array_agg(hash order by chain_pos desc))[1] from audit_event where org_id = '$org'")
  cp=$(psql_owner "$DST" -c "select count(*) from audit_checkpoint where org_id = '$org'")
  [ "$b" = 0 ] && [ "$hs" = "$hd" ] && verdict "audit chain intact on dst (org ${org:0:8}…)" PASS "hub_audit_verify rows=0, checkpoints=$cp, head ${hd:0:24}… = src" \
                                    || verdict "audit chain intact on dst (org ${org:0:8}…)" FAIL "verify rows=$b src=$hs dst=$hd"
done

R=$(psql_app "$DST" -c "select (select count(*) from organization) || '/' || (select count(*) from project) || '/' || (select count(*) from app_user) || '/' || (select count(*) from audit_event) || '/' || (select count(*) from workstream)")
[ "$R" = "0/0/0/0/0" ] && verdict "hub_app without context sees nothing (dst)" PASS "organization/project/app_user/audit_event/workstream = $R" \
                      || verdict "hub_app without context sees nothing (dst)" FAIL "$R"
A=$(psql_owner "$DST" -c "select rolbypassrls || '/' || rolsuper || '/' || has_table_privilege('hub_app', 'audit_event', 'UPDATE') || '/' || has_table_privilege('hub_app', 'vote', 'DELETE') from pg_roles where rolname = 'hub_app'")
[ "$A" = "false/false/false/false" ] && verdict "hub_app NOBYPASSRLS; append-only grants (dst)" PASS "bypassrls/super/audit UPDATE/vote DELETE = $A" \
                    || verdict "hub_app NOBYPASSRLS; append-only grants (dst)" FAIL "$A"
P=$(psql_owner "$DST" -c "select (select count(*) from pg_policies where schemaname = 'public') || '/' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity)")
PS=$(psql_owner "$SRC" -c "select (select count(*) from pg_policies where schemaname = 'public') || '/' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity)")
[ "$P" = "$PS" ] && verdict "RLS policies / RLS tables src = dst" PASS "$P" || verdict "RLS policies / RLS tables src = dst" FAIL "src $PS dst $P"
IX=$(psql_owner "$DST" -c "select count(*) from pg_indexes where schemaname = 'public'"); IXS=$(psql_owner "$SRC" -c "select count(*) from pg_indexes where schemaname = 'public'")
[ "$IX" = "$IXS" ] && verdict "indexes src = dst" PASS "$IX" || verdict "indexes src = dst" FAIL "src $IXS dst $IX"

(cd "$WORK/src-objects" && find . -type f -print0 | sort -z | xargs -0 sha256sum) >"$WORK/src.objects.sha256"
(cd "$WORK/dst-objects" && find . -type f -print0 | sort -z | xargs -0 sha256sum) >"$WORK/dst.objects.sha256"
if diff -q "$WORK/src.objects.sha256" "$WORK/dst.objects.sha256" >/dev/null; then verdict "object files sha256 src = dst" PASS "$(wc -l <"$WORK/dst.objects.sha256" | tr -d ' ') files"
else verdict "object files sha256 src = dst" FAIL "differences"; fi

Q=$(psql_owner "$DST" -c "select (select status || ':' || coalesce(locked_by, '-') || ':' || (locked_until = 'infinity') from job where idempotency_key = 'drill:running-1') || ' ' || (select status || ':' || (run_at = 'infinity') from job where idempotency_key = 'drill:queued-due-1') || ' ' || (select status from delivery_record where idempotency_key = 'drill:delivery-sending-1') || ' ' || (select status from delivery_record where idempotency_key = 'drill:delivery-sent-1') || ' ' || (select (next_run_at > now() + interval '50 minutes')::text from scheduled_job where kind = 'drill.briefing') || ' ' || (select count(*) from session where revoked_at is null) || ' ' || (select (dispatched_at = 'infinity')::text from outbox_event where type = 'drill.event')")
[ "$Q" = "running:restore-hold:true queued:true uncertain sent true 0 true" ] \
  && verdict "no mass redelivery: held/uncertain/pushed/revoked" PASS "$Q" || verdict "no mass redelivery: held/uncertain/pushed/revoked" FAIL "$Q"

echo
echo "Release step after review (demonstration on dst): release the queued drill job only"
QID=$(psql_owner "$DST" -c "select id from job where idempotency_key = 'drill:queued-due-1'")
DATABASE_RESTORE_URL="$(owner_url "$DST")" bash "$ROOT/scripts/ops/restore.sh" --release-held --job-ids "$QID"
RQ=$(psql_owner "$DST" -c "select status || ':' || (run_at <= now()) || ':' || (result is null) from job where id = '$QID'")
[ "$RQ" = "queued:true:true" ] && verdict "reviewed job released back to queued" PASS "$RQ" || verdict "reviewed job released back to queued" FAIL "$RQ"

step "8. summary"
echo "backup wall time:               ${BACKUP_S}s"
echo "restore wall time (restore.sh): ${RESTORE_S}s   <- measured restore duration (restore + quiesce + verification)"
sed -n '/^Measured durations/,/TOTAL/p' "$WORK/restore-report.txt"
echo "artifacts: $WORK"
if [ "$CLEANUP" = 1 ]; then
  for db in "$SRC" "$DST"; do psql -X -q -d "$(maint_url)" -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"; done
  echo "drill databases dropped"
fi
if [ "$RESULT" = 0 ]; then echo "DRILL RESULT: PASS"; else echo "DRILL RESULT: FAIL"; fi
exit "$RESULT"
