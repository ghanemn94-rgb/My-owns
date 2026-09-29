#!/usr/bin/env bash
# =====================================================================================================================
# Transformation Hub — restore a backup made by scripts/ops/backup.sh, quiesce side effects, and VERIFY (AT-23, C-34)
#
#   DATABASE_RESTORE_URL=postgres://hub_owner@db-host:5432/hub_restored \
#   scripts/ops/restore.sh --from /backups/hub-2026-09-29T0200Z --objects-dir /data/objects \
#       [--verify-app-url postgres://hub_app@db-host:5432/hub_restored] --report restore-report.txt
#
# Order of operations
#   1. Verify SHA256SUMS of the backup and the target preconditions (EMPTY database, extensions, role attributes:
#      the runtime role must exist and be NOSUPERUSER NOBYPASSRLS). Nothing is written before these pass.
#   2. pg_restore (single transaction by default; --jobs N for a parallel restore of large databases).
#   3. Re-apply the backup's post-migrate SQL (RLS policies, least-privilege grants, triggers, SECURITY DEFINER
#      functions, TEMP revocation) — idempotent; database-level ACLs are not part of pg_dump.
#   4. Quiesce side effects so the restored system does not mass-redeliver work (ADR-0004, T-48):
#        delivery_record  sending  -> uncertain         (reconcile with the provider/recipient; never blind-resend)
#        job              running  -> HELD (locked_by='restore-hold', locked_until='infinity'); back to queued only
#                                     after review with --release-held
#        job              queued   -> HELD (run_at='infinity', original run_at kept in result.restoreHold)
#        outbox_event     undispatched -> HELD (dispatched_at='infinity', marker in last_error)
#        scheduled_job    next_run_at pushed >= now() + --schedule-hold-minutes (no immediate catch-up burst)
#        session          all active sessions revoked (every user re-authenticates at the IdP)
#      Job/schedule kinds starting with "platform." (audit checkpoint, delivery reconciliation — no external effect)
#      are exempt so tamper-evidence and `sending`→`uncertain` reconciliation keep running (--hold-exempt-prefix).
#   5. Copy objects and verify their sha256; cross-check document_version.sha256 when documents exist.
#   6. Verify: per-table row counts = backup snapshot; schema object counts; audit hash chain (hub_audit_verify) and
#      chain heads = backup; runtime-role grants; RLS as the runtime role (0 rows without context).
#   7. Write a report with the MEASURED durations. Exit status 0 only when every check passes.
#
# After review (see docs/deployment/backup-restore.md §Reconciliation):
#   scripts/ops/restore.sh --release-held --all            # or --job-ids <uuid,uuid> [--outbox]
#   scripts/ops/restore.sh --cancel-held --job-ids <uuid,uuid>   # work that already happened after the backup point
# Access revocations recorded after the backup point (external audit export / SIEM) must be re-applied BEFORE users
# are let back in (C-34, residual risk RR-10).
# =====================================================================================================================
set -euo pipefail
umask 077

MODE="restore"
FROM=""
DB_URL="${DATABASE_RESTORE_URL:-}"
APP_URL=""
OBJECTS_DIR=""
REPORT=""
JOBS=1
YES=0
HOLD_MIN=60
HOLD_QUEUED=1
HOLD_OUTBOX=1
EXEMPT_PREFIX="platform."
REVOKE_SESSIONS=1
APP_ROLE="${HUB_DB_RUNTIME_ROLE:-hub_app}"
OWNER_ROLE="${HUB_DB_OWNER_ROLE:-hub_owner}"
JOB_IDS=""
RELEASE_ALL=0
RELEASE_OUTBOX=0

usage() {
  sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Restore options:
  --from DIR                   backup directory produced by backup.sh                                          [required]
  --objects-dir DIR            target object-store directory (must be empty or absent)
  --verify-app-url URL         runtime-role connection used to prove RLS on the restored data (recommended)
  --report FILE                write the verification report here (default: <from>/restore-report-<ts>.txt)
  --jobs N                     parallel pg_restore (N>1 disables the single-transaction restore)
  --schedule-hold-minutes N    push schedules at least N minutes into the future (default 60)
  --no-hold-queued             do not hold queued jobs (only running ones)
  --no-hold-outbox             do not hold undispatched outbox events
  --hold-exempt-prefix P       job/schedule kinds starting with P are not held (default "platform.": audit
                               checkpoint and delivery reconciliation have no external effect); "" holds all
  --keep-sessions              do not revoke sessions (NOT recommended; C-34)
  --yes                        do not ask for confirmation
Post-review options (target from DATABASE_RESTORE_URL):
  --release-held (--all | --job-ids ID,ID) [--outbox]   release held jobs (and held outbox events with --outbox/--all)
  --cancel-held --job-ids ID,ID                         cancel held jobs whose effect already happened
Environment: DATABASE_RESTORE_URL (owner role of the TARGET database; password via PGPASSWORD/PGPASSFILE)
EOF
}

die() { echo "restore: ERROR: $*" >&2; exit 1; }
info() { echo "restore: $*"; }
redact() { printf '%s' "$1" | sed -E 's#//([^:/@]+):[^@]*@#//\1:***@#'; }
now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB_URL" "$@"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --objects-dir) OBJECTS_DIR="$2"; shift 2 ;;
    --verify-app-url) APP_URL="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --schedule-hold-minutes) HOLD_MIN="$2"; shift 2 ;;
    --no-hold-queued) HOLD_QUEUED=0; shift ;;
    --no-hold-outbox) HOLD_OUTBOX=0; shift ;;
    --hold-exempt-prefix) EXEMPT_PREFIX="$2"; shift 2 ;;
    --keep-sessions) REVOKE_SESSIONS=0; shift ;;
    --yes) YES=1; shift ;;
    --release-held) MODE="release"; shift ;;
    --cancel-held) MODE="cancel"; shift ;;
    --job-ids) JOB_IDS="$2"; shift 2 ;;
    --all) RELEASE_ALL=1; shift ;;
    --outbox) RELEASE_OUTBOX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$DB_URL" ] || die "DATABASE_RESTORE_URL is not set"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
export PGAPPNAME="hub-restore"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
case "$HOLD_MIN" in ''|*[!0-9]*) die "--schedule-hold-minutes must be an integer" ;; esac
case "$JOBS" in ''|*[!0-9]*|0) die "--jobs must be a positive integer" ;; esac
printf '%s' "$EXEMPT_PREFIX" | grep -Eq '^[A-Za-z0-9._-]*$' || die "--hold-exempt-prefix may contain only letters, digits, '.', '_' and '-'"
if [ -n "$JOB_IDS" ]; then
  printf '%s' "$JOB_IDS" | grep -Eq '^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36})*$' || die "--job-ids must be comma-separated UUIDs"
fi

# ---------------------------------------------------------------------------------------------------------------------
# Post-review modes
# ---------------------------------------------------------------------------------------------------------------------
if [ "$MODE" = "release" ]; then
  [ "$RELEASE_ALL" = 1 ] || [ -n "$JOB_IDS" ] || die "--release-held needs --all or --job-ids"
  FILTER="true"; [ -n "$JOB_IDS" ] && FILTER="id = ANY (string_to_array('$JOB_IDS', ',')::uuid[])"
  q <<SQL
BEGIN;
WITH r AS (UPDATE job SET status = 'queued', run_at = now(), locked_by = NULL, locked_until = NULL, result = NULL, updated_at = now()
            WHERE status = 'running' AND locked_by = 'restore-hold' AND $FILTER RETURNING 1)
SELECT 'released previously-running jobs: ' || count(*) FROM r;
WITH r AS (UPDATE job SET run_at = greatest(now(), (result -> 'restoreHold' ->> 'previousRunAt')::timestamptz), result = NULL, updated_at = now()
            WHERE status = 'queued' AND run_at = 'infinity' AND result ? 'restoreHold' AND $FILTER RETURNING 1)
SELECT 'released queued jobs: ' || count(*) FROM r;
COMMIT;
SQL
  if [ "$RELEASE_ALL" = 1 ] || [ "$RELEASE_OUTBOX" = 1 ]; then
    q -c "WITH r AS (UPDATE outbox_event SET dispatched_at = NULL, last_error = nullif(replace(coalesce(last_error, ''), ' [restore-hold]', ''), '') WHERE dispatched_at = 'infinity' RETURNING 1) SELECT 'released outbox events: ' || count(*) FROM r"
  fi
  exit 0
fi
if [ "$MODE" = "cancel" ]; then
  [ -n "$JOB_IDS" ] || die "--cancel-held needs --job-ids"
  q -c "WITH r AS (UPDATE job SET status = 'cancelled', finished_at = now(), locked_by = NULL, locked_until = NULL, last_error = coalesce(last_error, '') || ' [cancelled after restore review]', updated_at = now() WHERE id = ANY (string_to_array('$JOB_IDS', ',')::uuid[]) AND ((status = 'running' AND locked_by = 'restore-hold') OR (status = 'queued' AND run_at = 'infinity' AND result ? 'restoreHold')) RETURNING 1) SELECT 'cancelled held jobs: ' || count(*) FROM r"
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------------------------------------------------
[ -n "$FROM" ] || die "--from is required"
[ -d "$FROM" ] || die "backup directory $FROM not found"
FROM="$(cd "$FROM" && pwd)"
for f in manifest.json SHA256SUMS db.dump tables.counts schema.counts audit.heads objects.sha256 post-migrate.sql; do
  [ -f "$FROM/$f" ] || die "backup incomplete: $f missing"
done
for t in pg_restore psql sha256sum awk sed sort; do command -v "$t" >/dev/null || die "required tool missing: $t"; done
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${REPORT:-$FROM/restore-report-$TS.txt}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
: >"$WORK/checks"
T0="$(now)"

check() { # check <name> <PASS|FAIL> <detail>
  printf '%-4s  %-44s %s\n' "$2" "$1" "$3" | tee -a "$WORK/checks"
}

info "verifying backup checksums in $FROM"
(cd "$FROM" && sha256sum --quiet -c SHA256SUMS) || die "backup checksum verification FAILED — do not restore this copy"
grep -q '"format": "transformation-hub-backup"' "$FROM/manifest.json" || die "not a transformation-hub backup"
grep -q '"formatVersion": 1,' "$FROM/manifest.json" || die "unsupported backup format version"
check "backup checksums (SHA256SUMS)" PASS "$(wc -l <"$FROM/SHA256SUMS" | tr -d ' ') files"

# Target preconditions ------------------------------------------------------------------------------------------------
TARGET_DB="$(q -c 'select current_database()')" || die "cannot connect to $(redact "$DB_URL")"
NONEMPTY="$(q -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p','v','m','S')")"
[ "$NONEMPTY" = "0" ] || die "target database $TARGET_DB is not empty ($NONEMPTY relations); restore only into a freshly created database"
ME="$(q -c "select current_user || ',' || rolsuper from pg_roles where rolname = current_user")"
case "$ME" in "$OWNER_ROLE,"*|*,true) ;; *) die "connect as the owner role ($OWNER_ROLE) or a superuser (connected as ${ME%,*})" ;; esac
APPROLE_ATTRS="$(q -c "select rolsuper || ',' || rolbypassrls from pg_roles where rolname = '$APP_ROLE'")"
[ -n "$APPROLE_ATTRS" ] || die "runtime role $APP_ROLE does not exist on the target cluster (the DBA creates roles; pg_dump does not)"
[ "$APPROLE_ATTRS" = "false,false" ] || die "runtime role $APP_ROLE must be NOSUPERUSER NOBYPASSRLS (found super,bypassrls=$APPROLE_ATTRS)"
check "target empty + roles (runtime NOBYPASSRLS)" PASS "db=$TARGET_DB as ${ME%,*}; $APP_ROLE super/bypassrls=$APPROLE_ATTRS"

pg_restore -l "$FROM/db.dump" >"$WORK/toc.full"
# Extensions are created by the DBA on the target; restoring CREATE/COMMENT EXTENSION needs extension ownership.
grep -Ev '^[0-9]+; [0-9]+ [0-9]+ (EXTENSION|COMMENT) - (EXTENSION )?' "$WORK/toc.full" >"$WORK/toc.list" || true
EXTS="$(grep -E '^[0-9]+; [0-9]+ [0-9]+ EXTENSION - ' "$WORK/toc.full" | awk '{ print $NF }' | sort -u | tr '\n' ' ')"
for e in $EXTS; do
  if [ "$(q -c "select count(*) from pg_extension where extname = '$e'")" != "1" ]; then
    q -c "create extension if not exists $e" >/dev/null 2>&1 || die "extension $e is missing on the target and cannot be created by $ME — ask the DBA"
  fi
done
check "extensions present" PASS "${EXTS:-none}"

if [ "$YES" != 1 ]; then
  echo "About to restore $(sed -n 's/.*"createdAt": "\(.*\)".*/\1/p' "$FROM/manifest.json" | head -1) backup of app $(sed -n 's/.*"app": { "version": "\([^"]*\)".*/\1/p' "$FROM/manifest.json") into $(redact "$DB_URL")"
  read -r -p "Type the target database name ($TARGET_DB) to continue: " ans
  [ "$ans" = "$TARGET_DB" ] || die "aborted"
fi

# 2. pg_restore ---------------------------------------------------------------------------------------------------------
T_DB0="$(now)"
if [ "$JOBS" -gt 1 ]; then
  pg_restore --exit-on-error --jobs="$JOBS" -L "$WORK/toc.list" -d "$DB_URL" "$FROM/db.dump" || die "pg_restore failed (target is partially restored — drop and recreate it)"
else
  pg_restore --exit-on-error --single-transaction -L "$WORK/toc.list" -d "$DB_URL" "$FROM/db.dump" || die "pg_restore failed (rolled back)"
fi
T_DB1="$(now)"
info "pg_restore done in $(elapsed "$T_DB0" "$T_DB1")s"

# 3. post-migrate SQL ----------------------------------------------------------------------------------------------------
T_PM0="$(now)"
psql -X -q -v ON_ERROR_STOP=1 -1 -d "$DB_URL" -f "$FROM/post-migrate.sql" >/dev/null || die "post-migrate SQL failed"
T_PM1="$(now)"
check "post-migrate SQL re-applied (RLS/grants)" PASS "$(elapsed "$T_PM0" "$T_PM1")s"

# 4. Quiesce side effects -----------------------------------------------------------------------------------------------
T_Q0="$(now)"
q -v ts="$TS" -v ex="$EXEMPT_PREFIX" -v hold="$HOLD_MIN" -v hq="$HOLD_QUEUED" -v ho="$HOLD_OUTBOX" -v rs="$REVOKE_SESSIONS" >"$WORK/quiesce" <<'SQL'
BEGIN;
WITH r AS (UPDATE delivery_record SET status = 'uncertain', updated_at = now(),
                  detail = concat_ws(' | ', detail, 'restore ' || :'ts' || ': was sending at the backup point; reconcile before any resend')
            WHERE status = 'sending' RETURNING 1)
SELECT 'deliveries sending->uncertain' || chr(9) || count(*) FROM r;
WITH r AS (UPDATE job SET locked_by = 'restore-hold', locked_until = 'infinity', updated_at = now(),
                  result = jsonb_build_object('restoreHold', jsonb_build_object('previousStatus', 'running', 'previousRunAt', run_at, 'attempts', attempts, 'restore', :'ts'))
            WHERE status = 'running' AND (:'ex' = '' OR kind NOT LIKE :'ex' || '%') RETURNING 1)
SELECT 'running jobs held' || chr(9) || count(*) FROM r;
WITH r AS (UPDATE job SET run_at = 'infinity', updated_at = now(),
                  result = jsonb_build_object('restoreHold', jsonb_build_object('previousStatus', 'queued', 'previousRunAt', run_at, 'restore', :'ts'))
            WHERE status = 'queued' AND :'hq' = '1' AND (:'ex' = '' OR kind NOT LIKE :'ex' || '%') RETURNING 1)
SELECT 'queued jobs held' || chr(9) || count(*) FROM r;
WITH r AS (UPDATE outbox_event SET dispatched_at = 'infinity', last_error = coalesce(last_error, '') || ' [restore-hold]'
            WHERE dispatched_at IS NULL AND :'ho' = '1' RETURNING 1)
SELECT 'outbox events held' || chr(9) || count(*) FROM r;
WITH r AS (UPDATE scheduled_job SET next_run_at = now() + make_interval(mins => :'hold'::int), updated_at = now()
            WHERE enabled AND next_run_at IS NOT NULL AND next_run_at < now() + make_interval(mins => :'hold'::int)
              AND (:'ex' = '' OR kind NOT LIKE :'ex' || '%') RETURNING 1)
SELECT 'schedules pushed to now()+hold' || chr(9) || count(*) FROM r;
WITH r AS (UPDATE session SET revoked_at = now(), revoked_reason = 'restore ' || :'ts'
            WHERE revoked_at IS NULL AND :'rs' = '1' RETURNING 1)
SELECT 'sessions revoked' || chr(9) || count(*) FROM r;
COMMIT;
SQL
T_Q1="$(now)"
while IFS=$'\t' read -r k v; do check "quiesce: $k" PASS "$v"; done <"$WORK/quiesce"
q >"$WORK/review.txt" <<'SQL'
SELECT '# Held jobs (review each: did its effect already happen after the backup point?)';
SELECT 'job' || chr(9) || id || chr(9) || kind || chr(9) || (result -> 'restoreHold' ->> 'previousStatus') || chr(9) || attempts || chr(9) || idempotency_key || chr(9) || created_at
  FROM job WHERE (status = 'running' AND locked_by = 'restore-hold') OR (status = 'queued' AND run_at = 'infinity') ORDER BY created_at;
SELECT '# Uncertain deliveries (reconcile with the provider/recipient; never resend blindly)';
SELECT 'delivery' || chr(9) || id || chr(9) || channel || chr(9) || idempotency_key || chr(9) || updated_at FROM delivery_record WHERE status = 'uncertain' ORDER BY updated_at;
SELECT '# Held outbox events: ' || count(*) FROM outbox_event WHERE dispatched_at = 'infinity';
SQL

# 5. Objects -----------------------------------------------------------------------------------------------------------
T_O0="$(now)"
OBJ_EXPECTED=$(wc -l <"$FROM/objects.sha256" | tr -d ' ')
if [ -n "$OBJECTS_DIR" ]; then
  if [ -d "$OBJECTS_DIR" ] && [ -n "$(find "$OBJECTS_DIR" -mindepth 1 -print -quit)" ]; then
    die "objects directory $OBJECTS_DIR is not empty; restore objects into an empty location"
  fi
  mkdir -p "$OBJECTS_DIR"
  cp -a "$FROM/objects/." "$OBJECTS_DIR/"
  if (cd "$OBJECTS_DIR" && sha256sum --quiet -c "$FROM/objects.sha256"); then
    check "objects restored, sha256 verified" PASS "$OBJ_EXPECTED/$OBJ_EXPECTED files match"
  else
    check "objects restored, sha256 verified" FAIL "checksum mismatch"
  fi
  DV=$(q -c "select count(*) from document_version")
  if [ "$DV" = "0" ]; then
    check "document_version <-> object store" PASS "0 document versions in this backup (not exercised)"
  else
    q -c "select storage_key || chr(9) || sha256 from document_version" >"$WORK/dv"
    BAD=0
    while IFS=$'\t' read -r key sha; do
      case "$key" in /*|*..*) BAD=$((BAD + 1)); continue ;; esac
      [ -f "$OBJECTS_DIR/$key" ] && [ "$(sha256sum "$OBJECTS_DIR/$key" | cut -d' ' -f1)" = "$sha" ] || BAD=$((BAD + 1))
    done <"$WORK/dv"
    [ "$BAD" = 0 ] && check "document_version <-> object store" PASS "$DV versions: file present, sha256 = recorded" \
                   || check "document_version <-> object store" FAIL "$BAD of $DV versions missing or mismatched"
  fi
else
  check "objects" PASS "not restored by this run (--objects-dir not given; $OBJ_EXPECTED files in backup)"
fi
T_O1="$(now)"

# 6. Verification --------------------------------------------------------------------------------------------------------
T_V0="$(now)"
q >"$WORK/tables.after" <<'SQL'
SELECT string_agg(format('SELECT %L || chr(9) || count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' UNION ALL ') || ' ORDER BY 1'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','drizzle') \gexec
SQL
if diff -u "$FROM/tables.counts" "$WORK/tables.after" >"$WORK/tables.diff"; then
  check "row counts per table = backup snapshot" PASS "$(wc -l <"$WORK/tables.after" | tr -d ' ') tables, $(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/tables.after") rows"
else
  check "row counts per table = backup snapshot" FAIL "see diff below"; cat "$WORK/tables.diff" >>"$WORK/checks"
fi

q -v app="$APP_ROLE" >"$WORK/schema.after" <<'SQL'
SELECT 'tables' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p')
UNION ALL SELECT 'indexes' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind = 'i'
UNION ALL SELECT 'constraints' || chr(9) || count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname IN ('public','drizzle')
UNION ALL SELECT 'triggers' || chr(9) || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public'
UNION ALL SELECT 'rls_tables' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity
UNION ALL SELECT 'policies' || chr(9) || count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'functions' || chr(9) || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL SELECT 'runtime_role_table_grants' || chr(9) || count(*) FROM information_schema.role_table_grants WHERE grantee = :'app' AND table_schema = 'public';
SQL
if diff -u "$FROM/schema.counts" "$WORK/schema.after" >"$WORK/schema.diff"; then
  check "indexes/constraints/triggers/RLS/policies" PASS "$(tr '\t\n' '= ' <"$WORK/schema.after")"
else
  check "indexes/constraints/triggers/RLS/policies" FAIL "see diff below"; cat "$WORK/schema.diff" >>"$WORK/checks"
fi

# Audit hash chain: verify every organization's chain and compare the head with the backup snapshot.
AUDIT_FAIL=0; AUDIT_N=0
while IFS=$'\t' read -r org pos hash rows; do
  [ -n "$org" ] || continue
  AUDIT_N=$((AUDIT_N + 1))
  broken="$(q -c "select count(*) from hub_audit_verify('$org'::uuid)")"
  head="$(q -c "select max(chain_pos) || chr(9) || (array_agg(hash order by chain_pos desc))[1] || chr(9) || count(*) from audit_event where org_id = '$org' and chain_pos is not null")"
  if [ "$broken" = "0" ] && [ "$head" = "$pos"$'\t'"$hash"$'\t'"$rows" ]; then
    check "audit chain org ${org:0:8}…" PASS "hub_audit_verify: 0 breaks; head pos=$pos hash=${hash:0:12}… rows=$rows = backup"
  else
    AUDIT_FAIL=1; check "audit chain org ${org:0:8}…" FAIL "breaks=$broken head=[$head] expected=[$pos $hash $rows]"
  fi
done <"$FROM/audit.heads"
[ "$AUDIT_N" -gt 0 ] || check "audit chain" PASS "no audit events in backup"

GR="$(q -c "select has_table_privilege('$APP_ROLE', 'public.audit_event', 'UPDATE') || ',' || has_table_privilege('$APP_ROLE', 'public.audit_event', 'DELETE') || ',' || has_table_privilege('$APP_ROLE', 'public.audit_event', 'INSERT') || ',' || has_table_privilege('$APP_ROLE', 'public.project', 'SELECT')")"
[ "$GR" = "false,false,true,true" ] && check "runtime grants (audit append-only)" PASS "audit_event UPDATE/DELETE denied, INSERT allowed; project SELECT allowed" \
                     || check "runtime grants (audit append-only)" FAIL "update,delete,insert,select=$GR"

if [ -n "$APP_URL" ]; then
  RLS="$(psql -X -q -At -v ON_ERROR_STOP=1 -d "$APP_URL" -c "select current_user || ',' || (select count(*) from organization) || ',' || (select count(*) from project) || ',' || (select count(*) from app_user) || ',' || (select count(*) from audit_event) || ',' || (select count(*) from project_membership)")" \
    || RLS="error"
  case "$RLS" in
    "$APP_ROLE,0,0,0,0,0") check "RLS as runtime role, no context" PASS "$APP_ROLE sees 0 organization/project/app_user/audit_event/project_membership rows" ;;
    *) check "RLS as runtime role, no context" FAIL "got [$RLS]" ;;
  esac
  ORG1="$(q -c "select id from organization order by created_at limit 1")"
  if [ -n "$ORG1" ]; then
    PIDS="$(q -c "select coalesce(string_agg(id::text, ','), '') from project where org_id = '$ORG1'")"
    OWNER_N="$(q -c "select count(*) from project where org_id = '$ORG1'")"
    CTX_N="$(psql -X -q -At -v ON_ERROR_STOP=1 -d "$APP_URL" -c "begin" -c "select set_config('app.org_id', '$ORG1', true), set_config('app.project_ids', '$PIDS', true), set_config('app.full_project_ids', '$PIDS', true)" -c "select count(*) from project" -c "commit" | tail -1)" || CTX_N="error"
    [ "$CTX_N" = "$OWNER_N" ] && check "RLS as runtime role, with org context" PASS "$CTX_N/$OWNER_N projects visible only inside the org/project context" \
                               || check "RLS as runtime role, with org context" FAIL "saw $CTX_N, owner sees $OWNER_N"
  fi
else
  check "RLS as runtime role" PASS "skipped (--verify-app-url not given; grants and policies verified as owner)"
fi

EXQ="'${EXEMPT_PREFIX}'"
POST="$(q -c "select (select count(*) from delivery_record where status = 'sending') || ',' || (select count(*) from job where ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now())) and ($EXQ = '' or kind not like $EXQ || '%')) || ',' || (select count(*) from scheduled_job where enabled and next_run_at <= now() and ($EXQ = '' or kind not like $EXQ || '%')) || ',' || (select count(*) from session where revoked_at is null) || ',' || (select count(*) from outbox_event where dispatched_at is null)")"
EXPECT_OUTBOX=0; [ "$HOLD_OUTBOX" = 1 ] || EXPECT_OUTBOX=""
IFS=, read -r P_SEND P_JOBS P_SCHED P_SESS P_OUTBOX <<<"$POST"
OKQ=1
[ "$P_SEND" = 0 ] && [ "$P_SCHED" = 0 ] || OKQ=0
[ "$HOLD_QUEUED" = 0 ] || [ "$P_JOBS" = 0 ] || OKQ=0
[ "$REVOKE_SESSIONS" = 0 ] || [ "$P_SESS" = 0 ] || OKQ=0
[ -z "$EXPECT_OUTBOX" ] || [ "$P_OUTBOX" = 0 ] || OKQ=0
[ "$OKQ" = 1 ] && check "nothing claimable/redeliverable after restore" PASS "sending=$P_SEND runnable_jobs=$P_JOBS due_schedules=$P_SCHED active_sessions=$P_SESS undispatched_outbox=$P_OUTBOX" \
               || check "nothing claimable/redeliverable after restore" FAIL "sending=$P_SEND runnable_jobs=$P_JOBS due_schedules=$P_SCHED active_sessions=$P_SESS undispatched_outbox=$P_OUTBOX"
T_V1="$(now)"
T1="$(now)"

# 7. Report ---------------------------------------------------------------------------------------------------------------
FAILS=$(grep -c '^FAIL' "$WORK/checks" || true)
{
  echo "Transformation Hub restore report"
  echo "restore id:        $TS"
  echo "backup:            $FROM"
  echo "backup created:    $(sed -n 's/.*"createdAt": "\(.*\)".*/\1/p' "$FROM/manifest.json" | head -1)"
  echo "backup app:        $(sed -n 's/.*"app": { "version": "\([^"]*\)", "gitCommit": "\([^"]*\)".*/\1 (\2)/p' "$FROM/manifest.json")"
  echo "target:            $(redact "$DB_URL")"
  echo "pg_restore:        $(pg_restore --version)"
  echo
  echo "Measured durations (seconds):"
  echo "  pg_restore                 $(elapsed "$T_DB0" "$T_DB1")"
  echo "  post-migrate SQL           $(elapsed "$T_PM0" "$T_PM1")"
  echo "  quiesce                    $(elapsed "$T_Q0" "$T_Q1")"
  echo "  objects copy + sha256      $(elapsed "$T_O0" "$T_O1")"
  echo "  verification               $(elapsed "$T_V0" "$T_V1")"
  echo "  TOTAL (start -> verified)  $(elapsed "$T0" "$T1")"
  echo
  echo "Checks:"
  cat "$WORK/checks"
  echo
  echo "Reconciliation review list:"
  cat "$WORK/review.txt"
  echo
  if [ "$FAILS" = 0 ]; then echo "RESULT: PASS (all checks passed)"; else echo "RESULT: FAIL ($FAILS check(s) failed)"; fi
} >"$REPORT"
chmod 600 "$REPORT"
echo "----------------------------------------------------------------------"
sed -n '/^Measured durations/,$p' "$REPORT"
echo "report: $REPORT"
[ "$FAILS" = 0 ]
