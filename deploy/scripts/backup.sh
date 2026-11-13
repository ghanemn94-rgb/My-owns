#!/usr/bin/env bash
# backup.sh: one backup set of a Mobily Transformation Hub installation (ADR-0066 §1-§4, §6; p7-work-split §E.2;
# T-DG7-DO-F). REQ-S19-012, REQ-S20-019 (A19).
#
#   deploy/scripts/backup.sh --out <backup-root> [--label <label>] [--operator <name>] [--release <version>]
#                            [--env-file <file>] [--compose-file <file>]... [--phase all|database|finish]
#                            [--record-out <file>]
#
# Environment (runtime configuration only; nothing here is stored in the set):
#   DATABASE_URL or DATABASE_URL_FILE      the OWNER role's URL (mth_owner): pg_dump, the counts, backup_set_record()
#   EVIDENCE_STORAGE_DRIVER                filesystem (default). s3 is BLOCKED (exit 3): BE-E's CLI has no S3 target
#   EVIDENCE_STORAGE_PATH                  the filesystem evidence root
#   PGBIN                                  directory of pg_dump/pg_restore/psql (default: PATH, else the newest
#                                          /usr/lib/postgresql/*/bin)
#   MTH_TRANSFER_ATTACHMENTS               the command of BE-E's `transfer-attachments` CLI (default: the repository's
#                                          source through node; in the app image `node /app/apps/api/dist/cli/
#                                          transfer-attachments.js`; `none` in the postgres:18 image, where
#                                          only --phase database and --phase finish run)
#
# What it does, in order (ADR-0066 §1, §4):
#   1. opens a REPEATABLE READ, READ ONLY transaction, exports its snapshot (pg_export_snapshot) and, IN THAT SNAPSHOT,
#      takes the row count of every base table (db/table-counts.tsv), the audit count and max(seq), the pg-boss jobs by
#      state, the job_schedule digest and job_run count, the snapshot digest of the six snapshot tables (ADR-0067 §3),
#      the migration level and the retention archive sets;
#   2. pg_dump --format=custom --snapshot=<id> of the whole database (pgboss schema included): counts and dump agree;
#   3. the evidence copy AFTER the dump through BE-E's `transfer-attachments copy-out` with `--export-id <set id>`
#      (objects are immutable and never deleted, so the copy is a superset of what the dump names), then the
#      retention archive sets `retention/<runId>/` (each manifest checked against retention_run.archive_set_sha256);
#   4. config/: the Compose files, deploy/images.lock.json and the environment file with every secret VALUE removed;
#   5. the checks of ADR-0066 §4, the manifest backup-manifest.json (mth-backup/1, written last) and
#      backup_set_record() as the owner role (a failed set is recorded too, with its reason).
#
# Phases (the Compose `backup` profile runs on the postgres:18 image, which has no node): `--phase database` does
# steps 1, 2 and 4; the operator then runs the evidence copy-out in the app image (docs/handover/backup-restore.md);
# `--phase finish` does the retention sets, the checks, the manifest and the record. `--phase all` (default) does all.
#
# Exit codes (p7-work-split §2 rule 4): 0 the set succeeded; 1 the set failed (recorded as failed when the database is
# reachable); 2 BLOCKED usage or input; 3 BLOCKED missing capability (tool, S3 through the CLI).
# Output lines (p7-work-split §E.5): `backup: set <label> succeeded: <bytes> database bytes, <n> evidence objects;
# manifest sha256 <hex>` and `backup: set <label> failed: <reason>`.
#
# A backup set is an engineering artefact. It approves nothing (no G1-G6, Finance or IT approval), never reads or
# writes DG0-DG7, and holds no credential (D-243 Q16). Recovery objectives (RPO/RTO) are IT's to agree.
set -euo pipefail

BACKUP_SCHEMA="mth-backup/1"
MTH_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# ADR-0067 §3: the six snapshot tables, in this order (ADR-0066 §2 snapshotDigest).
SNAPSHOT_TABLES=(report_snapshot report_snapshot_aggregate report_snapshot_evidence report_snapshot_source
  report_snapshot_version ranking_snapshot)

# ------------------------------------------------------------------------------------------------ shared helpers
# (restore.sh sources this file for these helpers; nothing below the guard at the end runs when sourced)

mth_now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
mth_clock() { date +%s.%N; }
# Seconds between two mth_clock values, as a JSON number with 3 decimals.
mth_secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.3f", (b - a) }'; }
mth_sha256() { sha256sum "$1" | cut -d' ' -f1; }
mth_bytes() { stat -c %s "$1"; }

# Resolves the PostgreSQL client tools: PGBIN, else PATH, else the newest /usr/lib/postgresql/*/bin.
mth_pg_tools() {
  local dir="${PGBIN:-}"
  if [ -z "$dir" ] && ! command -v pg_dump >/dev/null 2>&1; then
    dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
  if [ -n "$dir" ]; then
    PSQL="$dir/psql"
    PG_DUMP="$dir/pg_dump"
    PG_RESTORE="$dir/pg_restore"
  else
    PSQL="$(command -v psql || true)"
    PG_DUMP="$(command -v pg_dump || true)"
    PG_RESTORE="$(command -v pg_restore || true)"
  fi
  local t
  for t in "$PSQL" "$PG_DUMP" "$PG_RESTORE"; do
    [ -n "$t" ] && [ -x "$t" ] && continue
    echo "BLOCKED: the PostgreSQL client tools (psql, pg_dump, pg_restore) were not found; set PGBIN" >&2
    exit 3
  done
  command -v sha256sum >/dev/null 2>&1 || {
    echo "BLOCKED: sha256sum not found" >&2
    exit 3
  }
}

# The transfer-attachments command (BE-E's CLI), as an array.
mth_attachments_cmd() {
  if [ "${MTH_TRANSFER_ATTACHMENTS:-}" = "none" ]; then
    # The postgres:18 image of the Compose `backup` profile has no node: the copy-out and the store-side verify run in
    # the app image (docs/handover/backup-restore.md); this script still checks every copied file's SHA-256.
    ATTACH_CMD=()
  elif [ -n "${MTH_TRANSFER_ATTACHMENTS:-}" ]; then
    # shellcheck disable=SC2206 # a command line given by the operator
    ATTACH_CMD=($MTH_TRANSFER_ATTACHMENTS)
  else
    command -v node >/dev/null 2>&1 || {
      echo "BLOCKED: node not found for transfer-attachments (set MTH_TRANSFER_ATTACHMENTS)" >&2
      exit 3
    }
    ATTACH_CMD=(node --conditions=@mth/source "$MTH_REPO/apps/api/src/cli/transfer-attachments.ts")
  fi
}

# libpq reads "+" in a URI query literally; URLSearchParams (Node) writes a space as "+". Normalize to %20.
mth_libpq_url() {
  local u="$1"
  if [[ "$u" == *\?* ]]; then u="${u%%\?*}?$(printf '%s' "${u#*\?}" | sed 's/+/%20/g')"; fi
  printf '%s' "$u"
}

# psql with no rc file, unaligned tuples only, stop on error. A `-c <sql>` is sent on standard input, because psql
# interpolates :'variables' only there (never in -c); without -c the caller's standard input is the script.
mth_psql() {
  local url="$1" cmd="" has_cmd=0
  shift
  local -a a=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "-c" ]; then
      cmd="$2"
      has_cmd=1
      shift 2
    else
      a+=("$1")
      shift
    fi
  done
  if [ "$has_cmd" = 1 ]; then
    printf '%s;\n' "$cmd" | "$PSQL" -X -q -A -t -v ON_ERROR_STOP=1 "${a[@]}" "$url"
  else
    "$PSQL" -X -q -A -t -v ON_ERROR_STOP=1 "${a[@]}" "$url"
  fi
}

# The SQL that prints "<schema>.<table>\t<rows>" for every base table, ordered by code point (run with \gexec).
MTH_COUNTS_SQL="SELECT format('SELECT %L || chr(9) || count(*) FROM %I.%I', n.nspname || '.' || c.relname,
    n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
 ORDER BY n.nspname COLLATE \"C\", c.relname COLLATE \"C\""

# The SQL that prints every row of the six snapshot tables as text, table by table in the ADR-0067 §3 order and,
# within a table, by its primary key (as text, code-point order, so the digest does not depend on the collation).
mth_snapshot_sql() {
  local list="" i=1 t
  for t in "${SNAPSHOT_TABLES[@]}"; do
    list+="${list:+, }('$t', $i)"
    i=$((i + 1))
  done
  cat <<SQL
SELECT format('SELECT t::text FROM public.%I t ORDER BY (ROW(%s))::text COLLATE "C"', s.tbl,
         string_agg(format('t.%I', a.attname), ', ' ORDER BY k.ord))
  FROM (VALUES $list) AS s(tbl, o)
  JOIN pg_index i ON i.indrelid = to_regclass('public.' || s.tbl) AND i.indisprimary
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
 GROUP BY s.tbl, s.o ORDER BY s.o
SQL
}

# The last applied migration as <id>_<name> (ADR-0066 §2; the 0145 CHECK), e.g. 0148_p7_retention_job.
MTH_LEVEL_SQL="SELECT CASE WHEN name ~ '^[0-9]{4}_' THEN regexp_replace(name, '[.]sql\$', '')
  ELSE lpad(id::text, 4, '0') || '_' || regexp_replace(name, '[.]sql\$', '') END
  FROM schema_migration ORDER BY id DESC LIMIT 1"

# One-line JSON facts taken in the current transaction (audit, job state, migration level, server).
MTH_FACTS_SQL="SELECT jsonb_build_object(
  'migrationLevel', ($MTH_LEVEL_SQL),
  'server', jsonb_build_object('version', current_setting('server_version'),
                               'major', current_setting('server_version_num')::int / 10000),
  'auditEvents', (SELECT jsonb_build_object('count', count(*), 'maxSeq', coalesce(max(seq)::text, ''))
                    FROM audit_event),
  'pgbossJobsByState', CASE WHEN to_regclass('pgboss.job') IS NULL THEN '{}'::jsonb ELSE
      (SELECT coalesce(jsonb_object_agg(st, n), '{}'::jsonb)
         FROM (SELECT state::text AS st, count(*) AS n FROM pgboss.job GROUP BY 1) j) END,
  'jobRunCount', (SELECT count(*) FROM job_run),
  'jobScheduleRows', (SELECT count(*) FROM job_schedule))::text"

# job_schedule rows (every column, enabled included) as text, by primary key.
MTH_SCHEDULE_SQL="SELECT t::text FROM job_schedule t ORDER BY t::text COLLATE \"C\""

# Takes the snapshot facts over an open psql connection: $1 dir for outputs. Writes counts.tsv, snapshot.txt,
# schedule.txt and facts.json in $1 (row data stays in the private work dir, never in the set).
mth_snapshot_queries() {
  local dir="$1"
  cat <<SQL
\\o $dir/counts.tsv
$MTH_COUNTS_SQL
\\gexec
\\o $dir/snapshot.txt
$(mth_snapshot_sql)
\\gexec
\\o $dir/schedule.txt
$MTH_SCHEDULE_SQL;
\\o $dir/facts.json
$MTH_FACTS_SQL;
\\o
SQL
}

# ------------------------------------------------------------------------------------------------ backup

backup_usage() {
  echo "usage: backup.sh --out <backup-root> [--label <label>] [--operator <name>] [--release <version>]" \
    "[--env-file <file>] [--compose-file <file>]... [--phase all|database|finish] [--record-out <file>]" >&2
}

backup_main() {
  local root="" label="" operator="" release="unknown" env_file="" phase="all" record_out=""
  local -a compose_files=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) root="${2:-}"; shift 2 ;;
      --label) label="${2:-}"; shift 2 ;;
      --operator) operator="${2:-}"; shift 2 ;;
      --release) release="${2:-}"; shift 2 ;;
      --env-file) env_file="${2:-}"; shift 2 ;;
      --compose-file) compose_files+=("${2:-}"); shift 2 ;;
      --phase) phase="${2:-}"; shift 2 ;;
      --record-out) record_out="${2:-}"; shift 2 ;;
      *) echo "BLOCKED: unknown argument $1" >&2; backup_usage; exit 2 ;;
    esac
  done
  [ -n "$root" ] || { echo "BLOCKED: --out is required" >&2; backup_usage; exit 2; }
  case "$phase" in all | database | finish) ;; *) echo "BLOCKED: --phase must be all, database or finish" >&2; exit 2 ;; esac
  [ -n "$label" ] || label="mth-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ "$label" =~ ^[a-z0-9][a-z0-9._-]{0,99}$ ]] || {
    echo "BLOCKED: the label must match ^[a-z0-9][a-z0-9._-]{0,99}\$" >&2
    exit 2
  }
  [ -n "$operator" ] || operator="${USER:-operator}"
  [ "${#operator}" -le 200 ] || { echo "BLOCKED: --operator is longer than 200 characters" >&2; exit 2; }
  [ "${#compose_files[@]}" -gt 0 ] || compose_files=("$MTH_REPO/deploy/compose/compose.yaml")
  if [ -z "$env_file" ] && [ -f "$MTH_REPO/deploy/compose/.env" ]; then env_file="$MTH_REPO/deploy/compose/.env"; fi

  local url="${DATABASE_URL:-}"
  if [ -z "$url" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then url="$(cat "$DATABASE_URL_FILE")"; fi
  [ -n "$url" ] || { echo "BLOCKED: DATABASE_URL (the owner role's URL) is not set" >&2; exit 2; }
  url="$(mth_libpq_url "$url")"
  local driver="${EVIDENCE_STORAGE_DRIVER:-filesystem}"
  case "$driver" in
    filesystem) ;;
    s3)
      echo "BLOCKED: the s3 evidence store cannot be copied out by transfer-attachments in this release" \
        "(BE-E handback gap 1); back up the bucket with IT's S3 tooling" >&2
      exit 3
      ;;
    *) echo "BLOCKED: EVIDENCE_STORAGE_DRIVER must be filesystem or s3" >&2; exit 2 ;;
  esac
  local store="${EVIDENCE_STORAGE_PATH:-}"
  [ -n "$store" ] && [ -d "$store" ] || { echo "BLOCKED: EVIDENCE_STORAGE_PATH is not a directory" >&2; exit 2; }
  mth_pg_tools
  if [ "$phase" != "database" ]; then mth_attachments_cmd; fi
  if [ "$phase" = "all" ] && [ "${#ATTACH_CMD[@]}" -eq 0 ]; then
    echo "BLOCKED: --phase all needs transfer-attachments (MTH_TRANSFER_ATTACHMENTS=none allows only database/finish)" >&2
    exit 2
  fi

  local set="$root/$label"
  local state="$set/.backup-state"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-backup.XXXXXX")"
  chmod 700 "$WORK"
  B_URL="$url"
  B_LABEL="$label"
  B_OPERATOR="$operator"
  B_STATE="$state"
  B_RECORD_OUT="$record_out"
  B_RECORDED=0
  trap 'rm -rf "$WORK"' EXIT

  if [ "$phase" = "finish" ]; then
    [ -f "$state/started_at" ] || { echo "BLOCKED: $set has no database phase (run --phase database first)" >&2; exit 2; }
  else
    if [ -e "$set" ]; then
      echo "BLOCKED: $set already exists; a backup never overwrites a set" >&2
      exit 2
    fi
    mkdir -p "$set/db" "$set/evidence" "$set/config" "$state"
    mth_now >"$state/started_at"
    mth_psql "$url" -c "SELECT mth_uuid_v7()" >"$state/id" || backup_fail "the database cannot be reached as the owner role"
  fi
  B_ID="$(cat "$state/id")"
  B_STARTED="$(cat "$state/started_at")"

  if [ "$phase" != "finish" ]; then backup_database_phase "$set" "$state" "$url" "$env_file" "${compose_files[@]}"; fi
  if [ "$phase" = "database" ]; then
    echo "backup: set $label database phase done; run the evidence copy-out, then --phase finish"
    exit 0
  fi
  if [ "$phase" = "all" ]; then backup_evidence_copy "$set" "$state" "$url"; fi
  backup_finish_phase "$set" "$state" "$url" "$store" "$release"
}

# Records the set as failed (when the database answers) and exits 1 with the §E.5 line.
backup_fail() {
  local reason="$1"
  reason="${reason:0:900}"
  if [ "${B_RECORDED:-0}" = 0 ] && [ -n "${B_ID:-}" ]; then
    B_RECORDED=1
    local arg
    arg="$(backup_record_arg failed "$reason")" || arg=""
    if [ -n "$arg" ]; then
      [ -z "${B_RECORD_OUT:-}" ] || printf '%s\n' "$arg" >"$B_RECORD_OUT"
      mth_psql "$B_URL" -v arg="$arg" -c "SELECT backup_set_record(:'arg'::jsonb)" >/dev/null 2>&1 || true
    fi
  fi
  echo "backup: set ${B_LABEL:-unknown} failed: $reason" >&2
  exit 1
}

# The backup_set_record() argument: exactly the 19 keys of ADR-0066 §6 (unset values are JSON null).
backup_record_arg() {
  local status="$1" reason="${2:-}"
  local s="$B_STATE"
  rd() { if [ -f "$s/$1" ]; then cat "$s/$1"; fi; }
  mth_psql "$B_URL" \
    -v id="$B_ID" -v label="$B_LABEL" -v status="$status" -v started="$B_STARTED" -v finished="$(mth_now)" \
    -v level="$(rd migration_level)" -v major="$(rd server_major)" -v dbytes="$(rd dump_bytes)" \
    -v dsha="$(rd dump_sha256)" -v backend="filesystem" -v ecount="$(rd evidence_count)" \
    -v ebytes="$(rd evidence_bytes)" -v asha="$(rd attachments_sha256)" -v csha="$(rd config_sha256)" \
    -v msha="$(rd manifest_sha256)" -v reason="$reason" -v op="$B_OPERATOR" -c "
SELECT jsonb_build_object(
  'id', :'id', 'label', :'label', 'status', :'status', 'manifestSchemaVersion', '$BACKUP_SCHEMA',
  'startedAt', :'started', 'finishedAt', :'finished',
  'migrationLevel', nullif(:'level', ''), 'serverMajor', nullif(:'major', '')::int,
  'dumpFormat', CASE WHEN :'dsha' = '' THEN NULL ELSE 'custom' END,
  'dumpBytes', nullif(:'dbytes', '')::bigint, 'dumpSha256', nullif(:'dsha', ''),
  'evidenceBackend', CASE WHEN :'ecount' = '' THEN NULL ELSE :'backend' END,
  'evidenceObjectCount', nullif(:'ecount', '')::int, 'evidenceBytes', nullif(:'ebytes', '')::bigint,
  'attachmentManifestSha256', nullif(:'asha', ''), 'configBundleSha256', nullif(:'csha', ''),
  'manifestSha256', nullif(:'msha', ''), 'failureReason', nullif(:'reason', ''), 'operatorName', :'op')::text"
}

backup_database_phase() {
  local set="$1" state="$2" url="$3" env_file="$4"
  shift 4
  local t0 t1 t2 t3 snap line
  # 1. The snapshot: one REPEATABLE READ, READ ONLY session held open while pg_dump runs in its exported snapshot.
  t0="$(mth_clock)"
  coproc SNAPSESSION { "$PSQL" -X -q -A -t -v ON_ERROR_STOP=1 "$url" 2>&1; }
  local in="${SNAPSESSION[1]}" out="${SNAPSESSION[0]}"
  printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;" "SELECT pg_export_snapshot();" >&"$in"
  IFS= read -r -t 60 snap <&"$out" || backup_fail "the snapshot could not be opened"
  [[ "$snap" =~ ^[0-9A-F-]+$ ]] || backup_fail "the snapshot could not be opened: $snap"
  mth_snapshot_queries "$WORK" >&"$in"
  printf '%s\n' "SELECT 'mth-sync';" >&"$in"
  while IFS= read -r -t 600 line <&"$out"; do
    [ "$line" = "mth-sync" ] && break
    backup_fail "a snapshot query failed: $line"
  done
  [ "$line" = "mth-sync" ] || backup_fail "the snapshot queries did not finish"
  cp "$WORK/counts.tsv" "$set/db/table-counts.tsv"
  mth_sha256 "$WORK/snapshot.txt" >"$state/snapshot_digest"
  mth_sha256 "$WORK/schedule.txt" >"$state/schedule_digest"
  cp "$WORK/facts.json" "$state/facts.json"
  rm -f "$WORK/snapshot.txt" "$WORK/schedule.txt"
  t1="$(mth_clock)"

  # 2. The dump in the same snapshot.
  "$PG_DUMP" --format=custom --no-password --snapshot="$snap" --file="$set/db/database.dump" "$url" \
    2>"$WORK/pg_dump.err" || backup_fail "pg_dump failed: $(head -c 300 "$WORK/pg_dump.err" | tr '\n' ' ')"
  printf '%s\n' "COMMIT;" "\\q" >&"$in"
  wait "$SNAPSESSION_PID" 2>/dev/null || true
  t2="$(mth_clock)"

  # Facts for the record and manifest.
  mth_psql "$url" -v f="$(cat "$state/facts.json")" -c "SELECT :'f'::jsonb ->> 'migrationLevel'" \
    >"$state/migration_level"
  mth_psql "$url" -v f="$(cat "$state/facts.json")" -c "SELECT :'f'::jsonb #>> '{server,major}'" >"$state/server_major"
  mth_bytes "$set/db/database.dump" >"$state/dump_bytes"
  mth_sha256 "$set/db/database.dump" >"$state/dump_sha256"
  "$PG_DUMP" --version >"$state/pg_dump_version"

  # 4. config/: never a secret value (ADR-0066 §3; D-243 Q16).
  local f
  for f in "$@"; do
    [ -f "$f" ] || backup_fail "the Compose file $f does not exist"
    backup_scrub <"$f" >"$set/config/$(basename "$f")"
  done
  [ ! -f "$MTH_REPO/deploy/images.lock.json" ] || cp "$MTH_REPO/deploy/images.lock.json" "$set/config/images.lock.json"
  if [ -n "$env_file" ]; then
    [ -f "$env_file" ] || backup_fail "the environment file $env_file does not exist"
    backup_scrub_env <"$env_file" >"$set/config/environment.env"
  fi
  (cd "$set" && find config -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum) >"$WORK/config.sha"
  mth_sha256 "$WORK/config.sha" >"$state/config_sha256"
  t3="$(mth_clock)"
  {
    echo "snapshot=$(mth_secs "$t0" "$t1")"
    echo "dump=$(mth_secs "$t1" "$t2")"
    echo "config=$(mth_secs "$t2" "$t3")"
  } >"$state/timings"
}

# Secret-looking keys: their value is removed, the key is kept (ADR-0066 §3). `*_FILE` pointers are paths and stay.
MTH_SECRET_KEY='(PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|SESSION_?KEY|_KEY$)'

# An environment file: KEY=VALUE lines; secret values become <removed>; any URL credential is removed too.
backup_scrub_env() {
  local line key
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      key="${BASH_REMATCH[2]}"
      if [[ ! "$key" =~ _FILE$ ]] && [[ "${key^^}" =~ $MTH_SECRET_KEY ]]; then
        printf '%s=<removed>\n' "$key"
        continue
      fi
    fi
    printf '%s\n' "$line"
  done | backup_scrub
}

# Any text: the credential part of a URL userinfo (after "user:", up to "@") and PEM private keys are removed.
backup_scrub() {
  sed -E -e 's#([a-zA-Z][a-zA-Z0-9+.-]*://[^:/@[:space:]]+):[^@[:space:]<]+@#\1:<removed>@#g' \
    -e '/-----BEGIN [A-Z ]*PRIVATE KEY-----/,/-----END [A-Z ]*PRIVATE KEY-----/c\<removed private key>'
}

# 3. The evidence copy through BE-E's CLI (after the dump: a superset of what the dump names).
backup_evidence_copy() {
  local set="$1" state="$2" url="$3" t0 t1
  t0="$(mth_clock)"
  DATABASE_URL="$url" "${ATTACH_CMD[@]}" copy-out --to "$set/evidence" --out "$set/evidence/attachments.json" \
    --export-id "$B_ID" >"$WORK/copy-out.log" 2>&1 ||
    backup_fail "transfer-attachments copy-out failed: $(tail -c 400 "$WORK/copy-out.log" | tr '\n' ' ')"
  t1="$(mth_clock)"
  echo "$(mth_secs "$t0" "$t1")" >"$state/evidence_copy_seconds"
}

backup_finish_phase() {
  local set="$1" state="$2" url="$3" store="$4" release="$5"
  local t0 t1 t2 run sha key dir f n
  t0="$(mth_clock)"
  [ -f "$set/evidence/attachments.json" ] || backup_fail "evidence/attachments.json is missing (run the copy-out)"
  # Retention archive sets (ADR-0066 §1): named by retention_run.archive_set_key, not by any storage_key column.
  : >"$WORK/retention.tsv"
  mth_psql "$url" -F $'\t' -c "SELECT id, archive_set_key, coalesce(archive_set_sha256, '')
     FROM retention_run WHERE archive_set_key IS NOT NULL ORDER BY id" >"$WORK/runs.tsv"
  while IFS=$'\t' read -r run key sha; do
    [ -n "$run" ] || continue
    dir="$(dirname "$key")"
    [ -d "$store/$dir" ] || backup_fail "the retention archive set $dir is missing from the evidence store"
    mkdir -p "$set/evidence/$dir"
    cp -R "$store/$dir/." "$set/evidence/$dir/"
    [ -z "$sha" ] || [ "$(mth_sha256 "$set/evidence/$key")" = "$sha" ] ||
      backup_fail "the retention archive set $dir does not match retention_run.archive_set_sha256"
    # Check 4: every copied file equals its source.
    while IFS= read -r -d '' f; do
      [ "$(mth_sha256 "$f")" = "$(mth_sha256 "$store/$dir/${f#"$set/evidence/$dir/"}")" ] ||
        backup_fail "a retention archive file differs from the store: ${f#"$set/"}"
    done < <(find "$set/evidence/$dir" -type f -print0)
    printf '%s\t%s\t%s\t%s\n' "$run" "$(mth_sha256 "$set/evidence/$key")" \
      "$(find "$set/evidence/$dir" -type f | wc -l)" "$(du -sb "$set/evidence/$dir" | cut -f1)" >>"$WORK/retention.tsv"
  done <"$WORK/runs.tsv"
  t1="$(mth_clock)"

  # Checks (ADR-0066 §4).
  local -a checks=()
  "$PG_RESTORE" --list "$set/db/database.dump" >/dev/null 2>"$WORK/list.err" ||
    backup_fail "pg_restore --list cannot read db/database.dump"
  checks+=("dumpReadable")
  local client_major server_major
  client_major="$(sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/' "$state/pg_dump_version")"
  server_major="$(cat "$state/server_major")"
  [ "$client_major" -ge "$server_major" ] ||
    backup_fail "pg_dump $client_major is older than the server ($server_major)"
  checks+=("clientMajorAtLeastServer")
  if [ "${#ATTACH_CMD[@]}" -gt 0 ]; then
    EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$store" "${ATTACH_CMD[@]}" verify \
      --from "$set/evidence" --out "$WORK/verify.json" >"$WORK/verify.log" 2>&1 ||
      backup_fail "transfer-attachments verify reports mismatches: $(tail -c 300 "$WORK/verify.log" | tr '\n' ' ')"
    checks+=("evidenceVerified")
  fi
  # Every attachment file is named by its own SHA-256 (the copy is intact).
  n=0
  if [ -d "$set/evidence/attachments" ]; then
    while IFS= read -r -d '' f; do
      [ "$(mth_sha256 "$f")" = "$(basename "$f")" ] || backup_fail "evidence file ${f#"$set/"} differs from its name"
      n=$((n + 1))
    done < <(find "$set/evidence/attachments" -type f -print0)
  fi
  checks+=("evidenceFilesMatchNames" "retentionSetsMatch")
  echo "$n" >"$state/evidence_count"
  if [ -d "$set/evidence/attachments" ]; then du -sb --apparent-size "$set/evidence/attachments" | cut -f1 \
    >"$state/evidence_bytes"; else echo 0 >"$state/evidence_bytes"; fi
  mth_sha256 "$set/evidence/attachments.json" >"$state/attachments_sha256"

  # Every file of the set (the manifest itself excepted), then check 5 by re-reading each one.
  (cd "$set" && find . -path ./.backup-state -prune -o -type f ! -name backup-manifest.json -printf '%P\n' |
    LC_ALL=C sort) >"$WORK/files.txt"
  : >"$WORK/files.tsv"
  while IFS= read -r f; do
    printf '%s\t%s\t%s\n' "$f" "$(mth_sha256 "$set/$f")" "$(mth_bytes "$set/$f")" >>"$WORK/files.tsv"
  done <"$WORK/files.txt"
  while IFS=$'\t' read -r f sha n; do
    [ "$(mth_sha256 "$set/$f")" = "$sha" ] || backup_fail "the set file $f changed while it was written"
  done <"$WORK/files.tsv"
  checks+=("everyFileMatches")
  t2="$(mth_clock)"

  # The manifest, written last (ADR-0066 §2).
  local ev_secs="null"
  [ ! -f "$state/evidence_copy_seconds" ] || ev_secs="$(cat "$state/evidence_copy_seconds")"
  ev_secs="$(awk -v a="$ev_secs" -v b="$(mth_secs "$t0" "$t1")" 'BEGIN { if (a == "null") a = 0; printf "%.3f", a + b }')"
  local timings
  timings="$(cat "$state/timings")"
  local -A tm=()
  local kv
  for kv in $timings; do tm["${kv%%=*}"]="${kv#*=}"; done
  local finished
  finished="$(mth_now)"
  mth_psql "$url" -v label="$B_LABEL" -v started="$B_STARTED" -v finished="$finished" -v release="$release" \
    -v facts="$(cat "$state/facts.json")" -v pgdump="$(cat "$state/pg_dump_version")" \
    -v dbytes="$(cat "$state/dump_bytes")" -v dsha="$(cat "$state/dump_sha256")" \
    -v csha="$(mth_sha256 "$set/db/table-counts.tsv")" -v sdig="$(cat "$state/snapshot_digest")" \
    -v jdig="$(cat "$state/schedule_digest")" -v asha="$(cat "$state/attachments_sha256")" \
    -v acount="$(cat "$state/evidence_count")" -v abytes="$(cat "$state/evidence_bytes")" \
    -v aentries="$(grep -o '"objectName"' "$set/evidence/attachments.json" | wc -l)" \
    -v rsets="$(cat "$WORK/retention.tsv")" -v files="$(cat "$WORK/files.tsv")" \
    -v cfg="$(cat "$WORK/config.sha")" -v cfgsha="$(cat "$state/config_sha256")" \
    -v checks="$(printf '%s\n' "${checks[@]}")" \
    -v t_snapshot="${tm[snapshot]}" -v t_dump="${tm[dump]}" -v t_config="${tm[config]}" -v t_evidence="$ev_secs" \
    -v t_verify="$(mth_secs "$t1" "$t2")" -c "
WITH f AS (SELECT :'facts'::jsonb AS j)
SELECT jsonb_pretty(jsonb_build_object(
  'schemaVersion', '$BACKUP_SCHEMA', 'label', :'label', 'startedAt', :'started', 'finishedAt', :'finished',
  'release', :'release', 'migrationLevel', f.j ->> 'migrationLevel', 'server', f.j -> 'server',
  'client', jsonb_build_object('pgDump', :'pgdump'),
  'database', jsonb_build_object('file', 'db/database.dump', 'format', 'custom', 'bytes', :'dbytes'::bigint,
    'sha256', :'dsha', 'tableCounts', jsonb_build_object('file', 'db/table-counts.tsv', 'sha256', :'csha'),
    'auditEvents', f.j -> 'auditEvents', 'snapshotDigest', :'sdig', 'pgbossJobsByState', f.j -> 'pgbossJobsByState',
    'jobScheduleDigest', :'jdig', 'jobScheduleRows', f.j -> 'jobScheduleRows', 'jobRunCount', f.j -> 'jobRunCount'),
  'evidence', jsonb_build_object('backend', 'filesystem',
    'attachmentManifest', jsonb_build_object('file', 'evidence/attachments.json', 'sha256', :'asha',
      'count', :'acount'::int, 'entries', :'aentries'::int, 'bytes', :'abytes'::bigint),
    'retentionSets', (SELECT coalesce(jsonb_agg(jsonb_build_object('runId', split_part(l, E'\t', 1),
        'manifestSha256', split_part(l, E'\t', 2), 'files', split_part(l, E'\t', 3)::int,
        'bytes', split_part(l, E'\t', 4)::bigint) ORDER BY l), '[]'::jsonb)
      FROM regexp_split_to_table(:'rsets', E'\n') l WHERE l <> '')),
  'config', jsonb_build_object('files', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'path', substr(l, 67), 'sha256', left(l, 64)) ORDER BY substr(l, 67)), '[]'::jsonb)
      FROM regexp_split_to_table(:'cfg', E'\n') l WHERE l <> ''), 'sha256', :'cfgsha'),
  'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('path', split_part(l, E'\t', 1),
        'sha256', split_part(l, E'\t', 2), 'bytes', split_part(l, E'\t', 3)::bigint) ORDER BY l), '[]'::jsonb)
      FROM regexp_split_to_table(:'files', E'\n') l WHERE l <> ''),
  'checks', (SELECT jsonb_agg(jsonb_build_object('id', c, 'result', 'PASS'))
      FROM regexp_split_to_table(:'checks', E'\n') c WHERE c <> ''),
  'timings', jsonb_build_object('snapshot', :'t_snapshot'::numeric, 'dump', :'t_dump'::numeric,
    'evidence', :'t_evidence'::numeric, 'config', :'t_config'::numeric, 'verify', :'t_verify'::numeric)))
FROM f" >"$set/backup-manifest.json.part" || backup_fail "the manifest could not be written"
  mv "$set/backup-manifest.json.part" "$set/backup-manifest.json"
  mth_sha256 "$set/backup-manifest.json" >"$state/manifest_sha256"

  # ADR-0066 §6: report the set (insert-only, audited, owner only).
  local arg
  arg="$(backup_record_arg succeeded "")" || backup_fail "the backup_set_record() argument could not be built"
  [ -z "$B_RECORD_OUT" ] || printf '%s\n' "$arg" >"$B_RECORD_OUT"
  B_RECORDED=1
  mth_psql "$url" -v arg="$arg" -c "SELECT backup_set_record(:'arg'::jsonb)" >/dev/null 2>"$WORK/record.err" || {
    B_RECORDED=0
    backup_fail "backup_set_record() refused the set: $(head -c 300 "$WORK/record.err" | tr '\n' ' ')"
  }
  rm -rf "$state"
  echo "backup: set $B_LABEL succeeded: $(cat "$set/db/database.dump" | wc -c) database bytes," \
    "$(find "$set/evidence/attachments" -type f 2>/dev/null | wc -l) evidence objects;" \
    "manifest sha256 $(mth_sha256 "$set/backup-manifest.json")"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  ATTACH_CMD=()
  backup_main "$@"
fi
