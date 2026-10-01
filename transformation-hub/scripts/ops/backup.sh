#!/usr/bin/env bash
# =====================================================================================================================
# Transformation Hub — consistent logical backup of DATABASE + OBJECT STORAGE + non-secret CONFIGURATION (AT-23, C-34)
#
#   DATABASE_BACKUP_URL=postgres://hub_owner@db-host:5432/hub \
#   scripts/ops/backup.sh --out /backups/hub-2026-09-29T0200Z --objects-dir /data/objects [--config values-prod.yaml]
#
# What it produces (directory, mode 0700):
#   db.dump           pg_dump custom format (-Fc) taken from an exported REPEATABLE READ snapshot
#   tables.counts     exact row count per table, computed IN THE SAME SNAPSHOT as the dump (restore verification)
#   schema.counts     tables / indexes / constraints / triggers / RLS tables / policies / functions / runtime grants
#   audit.heads       per organization: audit chain head (chain_pos, hash) and row count, same snapshot
#   roles.txt         security attributes of the owner/runtime roles (no passwords)
#   objects/          copy of the object store (local directory, or an S3 bucket via mc/aws — see --s3-uri)
#   objects.sha256    sha256 of every object file (relative paths)
#   post-migrate.sql  the idempotent RLS/grants/trigger SQL matching this schema (re-applied by restore.sh)
#   config/           non-secret configuration files passed with --config (e.g. Helm values actually deployed)
#   manifest.json     app version, git commit, schema head, timestamps, tool versions, sizes and sha256
#   SHA256SUMS        sha256 of every file above (restore.sh verifies it before touching the target)
#
# Consistency: the database is dumped first, then objects are copied. Objects are immutable and never hard-deleted
# by the application (ADR-0010; documents are soft-deleted), so every object referenced by the dump exists in the
# later object copy; objects uploaded meanwhile are harmless orphans.
#
# Credentials: never pass passwords on the command line. Use DATABASE_BACKUP_URL without a password plus PGPASSWORD
# or a PGPASSFILE / pg_service.conf provided by the secret store. The role must be the table owner (hub_owner) or a
# DBA backup role with BYPASSRLS — with any other role the dump would fail (row_security=off makes pg_dump refuse
# rather than silently dumping a filtered subset).
#
# Encryption (REQ-SEC-011, REQ-DEP-018): with --encrypt-age (age X25519 recipients) or --encrypt-gpg (OpenPGP key ids)
# the whole backup — dump, objects, configuration, checksums — is streamed into ONE encrypted archive
# (backup.tar.age | backup.tar.gpg) plus backup.sha256 and a clear-text copy of manifest.json (metadata only: sizes,
# counts, versions, checksums; no business data). Only PUBLIC keys are needed here: the backup host can write backups
# but cannot read them; the private key stays with the restore operators (Mobily key management, MQ-09/MQ-17). The
# plain files are assembled first in a private staging directory (mode 0700; HUB_BACKUP_STAGING_DIR, e.g. a tmpfs or
# an encrypted volume) and removed after encryption. Off-site copies and immutability (object lock / WORM) are the
# backup platform's job. This script never uploads anywhere.
# =====================================================================================================================
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORMAT_VERSION=1

OUT=""
OBJECTS_DIR=""
S3_URI=""
LABEL="manual"
POST_MIGRATE_SQL=""
CONFIG_FILES=()
AGE_RECIPIENTS=()
GPG_RECIPIENTS=()
DB_URL="${DATABASE_BACKUP_URL:-}"
APP_ROLE="${HUB_DB_RUNTIME_ROLE:-hub_app}"
OWNER_ROLE="${HUB_DB_OWNER_ROLE:-hub_owner}"

usage() {
  awk 'NR > 2 && /^# =====/ { exit } NR > 2' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Options:
  --out DIR               backup directory to create (must not exist)                                   [required]
  --objects-dir DIR       local object-store directory (HUB_STORAGE_LOCAL_DIR) to include
  --s3-uri s3://b/prefix  S3-compatible bucket/prefix to include (needs `mc` alias or `aws` CLI configured by the
                          operator; HUB_S3_ENDPOINT for aws --endpoint-url)
  --config FILE           non-secret configuration file to include (repeatable); refused if it contains credentials
  --post-migrate-sql FILE post-migrate SQL to store with the backup (default: packages/db/sql/post-migrate.sql)
  --label TEXT            free-text label stored in the manifest (e.g. "nightly", "pre-upgrade-0.2.0")
  --encrypt-age R         encrypt to an age recipient: a public key (age1…) or a recipients file (repeatable)
  --encrypt-gpg KEY       encrypt to an OpenPGP public key in the caller's keyring (repeatable)
Environment:
  DATABASE_BACKUP_URL     connection URL of the owner/backup role (no password in the URL; use PGPASSWORD/PGPASSFILE)
  HUB_APP_VERSION         application version recorded in the manifest (default: transformation-hub/package.json)
  HUB_DB_RUNTIME_ROLE     runtime role name (default hub_app); HUB_DB_OWNER_ROLE owner role name (default hub_owner)
  HUB_BACKUP_STAGING_DIR  where the plain files are assembled before encryption (default: inside --out)
EOF
}

die() { echo "backup: ERROR: $*" >&2; exit 1; }
info() { echo "backup: $*"; }
redact() { printf '%s' "$1" | sed -E 's#//([^:/@]+):[^@]*@#//\1:***@#'; }
now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --objects-dir) OBJECTS_DIR="$2"; shift 2 ;;
    --s3-uri) S3_URI="$2"; shift 2 ;;
    --config) CONFIG_FILES+=("$2"); shift 2 ;;
    --post-migrate-sql) POST_MIGRATE_SQL="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --encrypt-age) AGE_RECIPIENTS+=("$2"); shift 2 ;;
    --encrypt-gpg) GPG_RECIPIENTS+=("$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$OUT" ] || die "--out is required"
[ -n "$DB_URL" ] || die "DATABASE_BACKUP_URL is not set"
[ -e "$OUT" ] && die "$OUT already exists; backups are never overwritten"
[ -n "$OBJECTS_DIR" ] && [ -n "$S3_URI" ] && die "use either --objects-dir or --s3-uri, not both"
[ -n "$OBJECTS_DIR" ] && [ ! -d "$OBJECTS_DIR" ] && die "objects directory $OBJECTS_DIR does not exist"
for t in pg_dump psql sha256sum awk sed sort find; do command -v "$t" >/dev/null || die "required tool missing: $t"; done
if [ -z "$POST_MIGRATE_SQL" ]; then
  for c in "$ROOT/packages/db/sql/post-migrate.sql" "/app/node_modules/@hub/db/sql/post-migrate.sql"; do
    [ -f "$c" ] && { POST_MIGRATE_SQL="$c"; break; }
  done
fi
[ -n "$POST_MIGRATE_SQL" ] && [ -f "$POST_MIGRATE_SQL" ] || die "post-migrate SQL not found; pass --post-migrate-sql"
for f in "${CONFIG_FILES[@]+"${CONFIG_FILES[@]}"}"; do
  [ -f "$f" ] || die "config file $f not found"
  if grep -Eq -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@|(AKIA|ASIA)[A-Z0-9]{16}' "$f"; then
    die "config file $f appears to contain credentials (private key, password URL or access key); secrets are never backed up with configuration — store secret REFERENCES only"
  fi
done

ENCRYPT=""
if [ "${#AGE_RECIPIENTS[@]}" -gt 0 ] && [ "${#GPG_RECIPIENTS[@]}" -gt 0 ]; then die "use either --encrypt-age or --encrypt-gpg, not both"; fi
if [ "${#AGE_RECIPIENTS[@]}" -gt 0 ]; then
  ENCRYPT="age"; command -v age >/dev/null || die "--encrypt-age needs the age tool (https://age-encryption.org)"
  AGE_ARGS=()
  for r in "${AGE_RECIPIENTS[@]}"; do
    if [ -f "$r" ]; then AGE_ARGS+=(-R "$r")
    elif printf '%s' "$r" | grep -Eq '^age1[0-9a-z]{58}$'; then AGE_ARGS+=(-r "$r")
    else die "--encrypt-age expects an age public key (age1…) or a recipients file: $r"; fi
  done
elif [ "${#GPG_RECIPIENTS[@]}" -gt 0 ]; then
  ENCRYPT="gpg"; command -v gpg >/dev/null || die "--encrypt-gpg needs gpg"
  GPG_ARGS=()
  for r in "${GPG_RECIPIENTS[@]}"; do
    gpg --batch --list-keys "$r" >/dev/null 2>&1 || die "OpenPGP public key not found in the keyring: $r"
    GPG_ARGS+=(--recipient "$r")
  done
fi

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
export PGAPPNAME="hub-backup"
T0="$(now)"
FINAL_OUT="$OUT"
mkdir -p "$FINAL_OUT"
chmod 700 "$FINAL_OUT"
if [ -n "$ENCRYPT" ]; then
  # Assemble the plain backup in a private staging directory; only the encrypted archive stays in --out.
  STAGE_PARENT="${HUB_BACKUP_STAGING_DIR:-$FINAL_OUT}"
  [ -d "$STAGE_PARENT" ] || die "staging directory $STAGE_PARENT does not exist"
  OUT="$(mktemp -d "$STAGE_PARENT/.hub-backup-plain.XXXXXX")"
  chmod 700 "$OUT"
  trap 'rm -rf "$OUT"' EXIT
fi
info "target directory $FINAL_OUT; database $(redact "$DB_URL")${ENCRYPT:+; encryption: $ENCRYPT}"

# --- 1. Snapshot session: export a snapshot and keep the transaction open while pg_dump uses it -------------------
coproc SNAP { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB_URL" 2>&1; }
SNAP_IN="${SNAP[1]}"
SNAP_OUT="${SNAP[0]}"
send() { printf '%s\n' "$1" >&"$SNAP_IN"; }
# Collect output lines until the marker; fail on psql errors or EOF.
collect() {
  local marker="__HUB_END_$RANDOM$RANDOM" line
  send "\\echo $marker"
  while IFS= read -r -t 600 line <&"$SNAP_OUT"; do
    [ "$line" = "$marker" ] && return 0
    case "$line" in ERROR:*|FATAL:*|psql:*) echo "backup: psql: $line" >&2; return 1 ;; esac
    printf '%s\n' "$line"
  done
  echo "backup: snapshot session ended unexpectedly" >&2
  return 1
}

send "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
send "SET row_security = off;"
send "SELECT pg_export_snapshot();"
SNAPSHOT="$(collect)" || die "could not export a snapshot (does the role own the tables / bypass RLS?)"
[ -n "$SNAPSHOT" ] || die "empty snapshot id"
info "exported snapshot $SNAPSHOT"

send "SELECT current_database() || chr(9) || current_setting('server_version') || chr(9) || current_user;"
IFS=$'\t' read -r DB_NAME SERVER_VERSION DB_USER <<<"$(collect)" || die "server metadata query failed"

# --- 2. pg_dump in the exported snapshot ----------------------------------------------------------------------------
T_DUMP0="$(now)"
pg_dump -d "$DB_URL" --format=custom --compress=6 --snapshot="$SNAPSHOT" --lock-wait-timeout=120000 \
  --file="$OUT/db.dump" || die "pg_dump failed"
T_DUMP1="$(now)"
info "pg_dump done in $(elapsed "$T_DUMP0" "$T_DUMP1")s ($(du -h "$OUT/db.dump" | cut -f1))"

# --- 3. Verification data from the SAME snapshot ---------------------------------------------------------------------
send "SELECT string_agg(format('SELECT %L || chr(9) || count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname), ' UNION ALL ') || ' ORDER BY 1' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','drizzle') \\gexec"
collect >"$OUT/tables.counts" || die "row counts failed"

send "SELECT 'tables' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p')
UNION ALL SELECT 'indexes' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind = 'i'
UNION ALL SELECT 'constraints' || chr(9) || count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE n.nspname IN ('public','drizzle')
UNION ALL SELECT 'triggers' || chr(9) || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public'
UNION ALL SELECT 'rls_tables' || chr(9) || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity
UNION ALL SELECT 'policies' || chr(9) || count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'functions' || chr(9) || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL SELECT 'runtime_role_table_grants' || chr(9) || count(*) FROM information_schema.role_table_grants WHERE grantee = '$APP_ROLE' AND table_schema = 'public';"
collect >"$OUT/schema.counts" || die "schema counts failed"

send "SELECT CASE WHEN to_regclass('public.audit_event') IS NULL THEN 'SELECT 1 WHERE false' ELSE 'SELECT org_id || chr(9) || max(chain_pos) || chr(9) || (array_agg(hash ORDER BY chain_pos DESC))[1] || chr(9) || count(*) FROM audit_event WHERE chain_pos IS NOT NULL GROUP BY org_id ORDER BY org_id' END \\gexec"
collect >"$OUT/audit.heads" || die "audit heads failed"

send "SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN 'SELECT ''0'' || chr(9) || ''none''' ELSE 'SELECT count(*) || chr(9) || coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1), ''none'') FROM drizzle.__drizzle_migrations' END \\gexec"
IFS=$'\t' read -r MIGRATION_COUNT SCHEMA_HEAD <<<"$(collect)" || die "schema head query failed"

send "SELECT rolname || chr(9) || rolsuper || chr(9) || rolbypassrls || chr(9) || rolcanlogin || chr(9) || rolcreaterole || chr(9) || rolcreatedb FROM pg_roles WHERE rolname IN ('$OWNER_ROLE', '$APP_ROLE') ORDER BY rolname;"
{ printf 'rolname\tsuper\tbypassrls\tcanlogin\tcreaterole\tcreatedb\n'; collect; } >"$OUT/roles.txt" || die "roles query failed"

send "COMMIT;"
send "\\q"
wait "$SNAP_PID" 2>/dev/null || true
T_SNAP1="$(now)"
TABLES=$(wc -l <"$OUT/tables.counts" | tr -d ' ')
ROWS=$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$OUT/tables.counts")
info "snapshot data: $TABLES tables, $ROWS rows, $(wc -l <"$OUT/audit.heads" | tr -d ' ') audit chain(s), $MIGRATION_COUNT migration(s)"

# --- 4. Object storage ----------------------------------------------------------------------------------------------
T_OBJ0="$(now)"
OBJECT_SOURCE="none"
mkdir -p "$OUT/objects"
if [ -n "$OBJECTS_DIR" ]; then
  OBJECT_SOURCE="local-dir"
  cp -a "$OBJECTS_DIR/." "$OUT/objects/"
elif [ -n "$S3_URI" ]; then
  OBJECT_SOURCE="s3"
  if command -v mc >/dev/null && [ -n "${HUB_BACKUP_MC_ALIAS:-}" ]; then
    mc mirror --quiet --preserve "${HUB_BACKUP_MC_ALIAS}/${S3_URI#s3://}" "$OUT/objects/"
  elif command -v aws >/dev/null; then
    aws s3 sync --only-show-errors ${HUB_S3_ENDPOINT:+--endpoint-url "$HUB_S3_ENDPOINT"} "$S3_URI" "$OUT/objects/"
  else
    die "--s3-uri needs the MinIO client (mc, with HUB_BACKUP_MC_ALIAS) or the aws CLI"
  fi
fi
(cd "$OUT/objects" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) >"$OUT/objects.sha256"
if [ -n "$OBJECTS_DIR" ]; then
  # The source must still match what was copied (objects are immutable; a mismatch means concurrent modification).
  # (An empty object store — e.g. a fresh installation — has nothing to re-check.)
  if [ -s "$OUT/objects.sha256" ]; then
    (cd "$OBJECTS_DIR" && sha256sum --quiet -c "$OUT/objects.sha256") || die "object store changed during the copy"
  fi
fi
OBJECT_COUNT=$(wc -l <"$OUT/objects.sha256" | tr -d ' ')
OBJECT_BYTES=$(find "$OUT/objects" -type f -printf '%s\n' | awk '{ s += $1 } END { print s + 0 }')
T_OBJ1="$(now)"
info "objects: $OBJECT_COUNT file(s), $OBJECT_BYTES bytes from $OBJECT_SOURCE in $(elapsed "$T_OBJ0" "$T_OBJ1")s"

# --- 5. Configuration and post-migrate SQL ----------------------------------------------------------------------------
cp "$POST_MIGRATE_SQL" "$OUT/post-migrate.sql"
if [ "${#CONFIG_FILES[@]}" -gt 0 ]; then
  mkdir -p "$OUT/config"
  for f in "${CONFIG_FILES[@]}"; do cp "$f" "$OUT/config/$(basename "$f")"; done
fi

# --- 6. Manifest + checksums ----------------------------------------------------------------------------------------
APP_VERSION="${HUB_APP_VERSION:-$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/package.json" 2>/dev/null | head -1)}"
GIT_COMMIT="${HUB_GIT_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
DUMP_SHA=$(sha256sum "$OUT/db.dump" | cut -d' ' -f1)
AUDIT_JSON=$(awk -F'\t' 'BEGIN { ORS = "" } { if (NR > 1) print ","; printf "{\"orgId\":\"%s\",\"chainPos\":%s,\"headHash\":\"%s\",\"rows\":%s}", $1, $2, $3, $4 }' "$OUT/audit.heads")
SCHEMA_JSON=$(awk -F'\t' 'BEGIN { ORS = "" } { if (NR > 1) print ","; printf "\"%s\":%s", $1, $2 }' "$OUT/schema.counts")
CONFIG_JSON=""
if [ -d "$OUT/config" ]; then
  CONFIG_JSON=$(cd "$OUT" && find config -type f -print0 | sort -z | xargs -0 -r sha256sum | awk 'BEGIN { ORS = "" } { if (NR > 1) print ","; printf "{\"path\":\"%s\",\"sha256\":\"%s\"}", $2, $1 }')
fi
T1="$(now)"
cat >"$OUT/manifest.json" <<EOF
{
  "format": "transformation-hub-backup",
  "formatVersion": $FORMAT_VERSION,
  "label": "$(json_escape "$LABEL")",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "app": { "version": "$(json_escape "$APP_VERSION")", "gitCommit": "$(json_escape "$GIT_COMMIT")" },
  "database": {
    "name": "$(json_escape "$DB_NAME")",
    "serverVersion": "$(json_escape "$SERVER_VERSION")",
    "dumpedAs": "$(json_escape "$DB_USER")",
    "pgDumpVersion": "$(json_escape "$(pg_dump --version)")",
    "snapshot": "$(json_escape "$SNAPSHOT")",
    "migrationsApplied": $MIGRATION_COUNT,
    "schemaHead": "$(json_escape "$SCHEMA_HEAD")",
    "tables": $TABLES,
    "rows": $ROWS,
    "dump": { "file": "db.dump", "format": "custom", "bytes": $(stat -c %s "$OUT/db.dump"), "sha256": "$DUMP_SHA" },
    "schemaCounts": { $SCHEMA_JSON },
    "auditChainHeads": [ $AUDIT_JSON ]
  },
  "objects": { "source": "$OBJECT_SOURCE", "files": $OBJECT_COUNT, "bytes": $OBJECT_BYTES, "checksums": "objects.sha256" },
  "postMigrateSql": { "file": "post-migrate.sql", "sha256": "$(sha256sum "$OUT/post-migrate.sql" | cut -d' ' -f1)" },
  "config": [ $CONFIG_JSON ],
  "secretsIncluded": false,
  "encryption": { "tool": "${ENCRYPT:-none}", "recipients": $(( ${#AGE_RECIPIENTS[@]} + ${#GPG_RECIPIENTS[@]} )), "archive": "$([ -n "$ENCRYPT" ] && echo "backup.tar.$ENCRYPT")" },
  "durationsSeconds": { "pgDump": $(elapsed "$T_DUMP0" "$T_DUMP1"), "snapshotTotal": $(elapsed "$T0" "$T_SNAP1"), "objects": $(elapsed "$T_OBJ0" "$T_OBJ1"), "total": $(elapsed "$T0" "$T1") }
}
EOF
(cd "$OUT" && find . -maxdepth 2 -type f ! -name SHA256SUMS ! -path './objects/*' -printf '%P\n' | sort | xargs -r sha256sum) >"$OUT/SHA256SUMS"
info "manifest written; total $(elapsed "$T0" "$(now)")s"

if [ -n "$ENCRYPT" ]; then
  T_ENC0="$(now)"
  ARCHIVE="$FINAL_OUT/backup.tar.$ENCRYPT"
  if [ "$ENCRYPT" = age ]; then
    tar -C "$OUT" -cf - . | age "${AGE_ARGS[@]}" -o "$ARCHIVE" || die "age encryption failed"
  else
    tar -C "$OUT" -cf - . | gpg --batch --yes --trust-model always --compress-algo none "${GPG_ARGS[@]}" --encrypt -o "$ARCHIVE" || die "gpg encryption failed"
  fi
  cp "$OUT/manifest.json" "$FINAL_OUT/manifest.json"
  (cd "$FINAL_OUT" && sha256sum "backup.tar.$ENCRYPT" manifest.json) >"$FINAL_OUT/backup.sha256"
  rm -rf "$OUT"
  trap - EXIT
  info "encrypted ($ENCRYPT) into $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)) in $(elapsed "$T_ENC0" "$(now)")s; plain staging removed"
  OUT="$FINAL_OUT"
fi
info "OK: $OUT"
