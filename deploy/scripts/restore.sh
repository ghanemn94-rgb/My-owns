#!/usr/bin/env bash
# restore.sh: restore one backup set into a FRESH database and an EMPTY evidence store (ADR-0066 §7-§8;
# p7-work-split §E.2, §E.5; T-DG7-DO-F). REQ-S19-012, REQ-S20-019 (A19).
#
#   deploy/scripts/restore.sh --from <backup-root>/<label> --target-database-url <owner url>
#                             --target-evidence-path <dir> [--out <report dir>] [--manifest-sha256 <hex>]
#                             [--readyz-url <url>] [--evidence-owner <uid>:<gid>]
#
#   --target-database-url   the OWNER role's (mth_owner) URL of an existing, EMPTY database on a cluster that already
#                           has the roles mth_owner and mth_app (deploy/compose/db-init). Also TARGET_DATABASE_URL_FILE.
#   --target-evidence-path  the filesystem evidence root of the target: missing or empty. A symbolic link to a
#                           directory is accepted and resolved once (F-DG7-1101): the restore, the owner and modes and
#                           R7 then apply to the directory it points to. A dangling link or a link to a non-directory
#                           is refused (exit 2) before the database is touched.
#   --manifest-sha256       the SHA-256 of backup-manifest.json that IT recorded (backup_set.manifest_sha256, or the
#                           backup line); when given, a different manifest is refused.
#   --readyz-url            the restored API's /readyz (R8 over HTTP). Without it, R8 evaluates the same rule as
#                           /readyz without a running API (database UTF8 and reachable, `mth-db status` up to date,
#                           the evidence root a readable and writable directory) and says so in the report.
#   --out                   where restore-report.json is written (default: the current directory).
#   --evidence-owner        the account that runs the API and the worker (F-DG7-1072/1082). Default: the owner of
#                           the target evidence root when it exists (in Compose the image's app user, uid 10001, who
#                           owns the volume), else the account running restore.sh. Every restored evidence directory
#                           becomes <owner> 0700 and every file <owner> 0600, the modes the filesystem store writes;
#                           R7 fails if any path under the root has another owner or a group/other bit. Changing the
#                           owner to another account needs root (as in the Compose restore of backup-restore.md §5);
#                           without root, an owner other than the runner's uid and groups is refused (exit 2) before
#                           the database is touched.
#
# Steps (ADR-0066 §7): 1 package checks (schema version, every file SHA-256, the manifest SHA-256 when given);
# 2 same PostgreSQL major (D-243 Q14); 3 fresh target only; 4 pg_restore --exit-on-error --single-transaction
# --no-owner --role=mth_owner (GRANTs kept, so mth_app has exactly the dumped privileges); 5 evidence copy-in through
# BE-E's `transfer-attachments copy-in` (same object names, verified) and the retention archive sets; 6 checks R1-R8;
# 8 restore-report.json. Step 7 (start migrate, api and worker) is the operator's / the Compose drill's.
#
# Exit codes: 0 restored, all checks passed; 1 a check failed (the target is left for inspection; nothing is
# started); 2 refused (bad package, other major, non-empty target, usage): nothing is written to the target;
# 3 BLOCKED missing tool. The lines are those of p7-work-split §E.5.
#
# A restore is an engineering procedure. It approves nothing (no G1-G6, Finance or IT approval) and never reads or
# writes DG0-DG7. The secrets of the target are IT's and are not in the set (D-243 Q16).
set -euo pipefail

# shellcheck source=backup.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup.sh"

refuse() {
  echo "restore: refused: $1" >&2
  exit 2
}

restore_main() {
  local from="" url="" store="" out="." pinned="" readyz="" eowner=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --from) from="${2:-}"; shift 2 ;;
      --target-database-url) url="${2:-}"; shift 2 ;;
      --target-evidence-path) store="${2:-}"; shift 2 ;;
      --out) out="${2:-}"; shift 2 ;;
      --manifest-sha256) pinned="${2:-}"; shift 2 ;;
      --readyz-url) readyz="${2:-}"; shift 2 ;;
      --evidence-owner) eowner="${2:-}"; shift 2 ;;
      *) echo "BLOCKED: unknown argument $1" >&2; exit 2 ;;
    esac
  done
  if [ -z "$url" ] && [ -n "${TARGET_DATABASE_URL_FILE:-}" ]; then url="$(cat "$TARGET_DATABASE_URL_FILE")"; fi
  [ -n "$from" ] && [ -n "$url" ] && [ -n "$store" ] || {
    echo "BLOCKED: usage: restore.sh --from <set> --target-database-url <owner url> --target-evidence-path <dir>" \
      "[--out <dir>] [--manifest-sha256 <hex>] [--readyz-url <url>]" >&2
    exit 2
  }
  if [ -n "$eowner" ] && ! [[ "$eowner" =~ ^[0-9]+:[0-9]+$ ]]; then
    echo "BLOCKED: --evidence-owner must be <uid>:<gid> (numbers), for example 10001:10001" >&2
    exit 2
  fi
  url="$(mth_libpq_url "$url")"
  [ -d "$from" ] || refuse "the backup set $from does not exist"
  mth_pg_tools
  ATTACH_CMD=()
  mth_attachments_cmd
  [ "${#ATTACH_CMD[@]}" -gt 0 ] || { echo "BLOCKED: restore.sh needs transfer-attachments (node)" >&2; exit 3; }
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-restore.XXXXXX")"
  chmod 700 "$WORK"
  trap 'rm -rf "$WORK"' EXIT
  local T0 t0 t1
  T0="$(mth_clock)"
  local started
  started="$(mth_now)"
  : >"$WORK/steps"
  step() { printf '%s\t%s\n' "$1" "$(mth_secs "$2" "$3")" >>"$WORK/steps"; }

  # 1. Package checks (R1). JSON is read through the target server (psql), the only JSON reader both images have.
  t0="$(mth_clock)"
  local mf="$from/backup-manifest.json"
  [ -f "$mf" ] || refuse "checksum mismatch for backup-manifest.json"
  mth_psql "$url" -c "SELECT 1" >/dev/null 2>"$WORK/conn.err" || {
    echo "BLOCKED: the target database cannot be reached as the owner role" >&2
    exit 2
  }
  local m
  m="$(cat "$mf")"
  jq_() { mth_psql "$url" -v m="$m" -c "SELECT $1 FROM (SELECT :'m'::jsonb AS j) s" 2>/dev/null; }
  local version
  version="$(jq_ "j ->> 'schemaVersion'")" || refuse "unsupported backup schema version 'unreadable'"
  [ "$version" = "$BACKUP_SCHEMA" ] || refuse "unsupported backup schema version '$version'"
  jq_ "(SELECT string_agg(f ->> 'path' || E'\t' || (f ->> 'sha256'), E'\n' ORDER BY f ->> 'path')
         FROM jsonb_array_elements(j -> 'files') f)" >"$WORK/files.tsv" ||
    refuse "unsupported backup schema version '$version' (no file list)"
  local listed=0 f sha
  # Every file the manifest lists exists and matches; no unlisted file is present.
  while IFS=$'\t' read -r f sha; do
    [ -n "$f" ] || continue
    listed=$((listed + 1))
    [ -f "$from/$f" ] && [ "$(mth_sha256 "$from/$f")" = "$sha" ] || refuse "checksum mismatch for $f"
  done <"$WORK/files.tsv"
  while IFS= read -r f; do
    grep -q -F -x -- "$f" <(cut -f1 "$WORK/files.tsv") || refuse "checksum mismatch for $f"
  done < <(cd "$from" && find . -type f ! -name backup-manifest.json ! -name restore-report.json -printf '%P\n')
  for f in db/database.dump db/table-counts.tsv evidence/attachments.json; do
    grep -q -F -x -- "$f" <(cut -f1 "$WORK/files.tsv") || refuse "checksum mismatch for $f"
  done
  local msha
  msha="$(mth_sha256 "$mf")"
  [ -z "$pinned" ] || [ "$pinned" = "$msha" ] || refuse "checksum mismatch for backup-manifest.json"
  local label
  label="$(jq_ "j ->> 'label'")"
  t1="$(mth_clock)"
  step packageChecks "$t0" "$t1"

  # 2. Same major (D-243 Q14).
  local major target_major
  major="$(jq_ "j #>> '{server,major}'")"
  target_major="$(mth_psql "$url" -c "SELECT current_setting('server_version_num')::int / 10000")"
  [ "$major" = "$target_major" ] || refuse "backup is from PostgreSQL $major, target is $target_major; a cross-major restore is an upgrade (dump with the newer client), see upgrades.md"

  # 3. Fresh target only: no table in public, no pgboss schema, an empty evidence root.
  local tables
  tables="$(mth_psql "$url" -c "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')
                                     + (SELECT count(*) FROM pg_namespace WHERE nspname = 'pgboss')")"
  [ "$tables" = "0" ] || refuse "the target database is not empty"
  # F-DG7-1101: an evidence root given as a symbolic link (or below one) is the directory it resolves to, as backup.sh
  # treats a symlinked backup root (F-DG7-1053). It is resolved once, here, and every later step (the default owner,
  # copy-in, chown, chmod and the R7 counts) works on the resolved directory: stat, chown -R and find never follow a
  # symlinked argument by default, so on the link itself they would see the link (mode 0777) and leave the tree as
  # copied. A dangling link or a link to a non-directory is refused here, before the database is touched.
  if [ -L "$store" ]; then
    local resolved=""
    resolved="$(readlink -e -- "$store")" ||
      refuse "the target evidence path $store is a symbolic link whose target does not exist ($(readlink -- "$store")); create the target directory or pass it directly"
    [ -d "$resolved" ] || refuse "the target evidence path $store is a symbolic link to $resolved, which is not a directory"
    store="$resolved"
  fi
  if [ -e "$store" ]; then
    [ -d "$store" ] && [ -z "$(ls -A "$store")" ] || refuse "the target evidence store is not empty"
    store="$(readlink -e -- "$store")" || refuse "the target evidence path $store cannot be resolved"
    # F-DG7-1072/1082: the existing (empty) root names the account of the API and the worker (the directory's
    # owner, never a link's).
    [ -n "$eowner" ] || eowner="$(stat -L -c '%u:%g' "$store")"
  fi
  [ -n "$eowner" ] || eowner="$(id -u):$(id -g)"
  # F-DG7-1101 (DO-D14 Q3): preconditions step 5 needs are checked while the target is still empty. Without root,
  # chown can give the evidence only to the runner's own uid and one of its groups, and an existing root must be
  # writable by the runner; otherwise the restore would fail at R7 after the database is committed.
  if [ "$(id -u)" != 0 ]; then
    [ "${eowner%%:*}" = "$(id -u)" ] && [[ " $(id -G) " == *" ${eowner##*:} "* ]] ||
      refuse "the evidence owner $eowner is not the account running restore.sh ($(id -u):$(id -g)); run the restore as that account or as root"
    [ ! -e "$store" ] || [ -w "$store" ] ||
      refuse "the target evidence store $store is not writable by the account running restore.sh ($(id -u):$(id -g))"
  fi
  t0="$(mth_clock)"
  step targetChecks "$t1" "$t0"

  # 4. The database, in one transaction (a failure leaves the target empty).
  # Table data in table-creation order (the TOC's table OID): some CHECK constraints call a function that reads
  # another table (e.g. forum -> p4_parties_known() -> governance_party), and pg_dump orders data by name. Every
  # other entry keeps pg_dump's order; foreign keys and triggers are post-data, so they are created after the load.
  "$PG_RESTORE" --list "$from/db/database.dump" >"$WORK/toc.all"
  awk '/^[0-9]+; [0-9]+ [0-9]+ TABLE DATA /' "$WORK/toc.all" | sort -t' ' -k3,3n >"$WORK/toc.data"
  awk -v data="$WORK/toc.data" '
    /^[0-9]+; [0-9]+ [0-9]+ TABLE DATA / { if (!done) { while ((getline l < data) > 0) print l; done = 1 } next }
    { print }' "$WORK/toc.all" >"$WORK/toc.list"
  "$PG_RESTORE" --exit-on-error --single-transaction --no-owner --role=mth_owner --no-password \
    --use-list="$WORK/toc.list" --dbname="$url" "$from/db/database.dump" 2>"$WORK/restore.err" || {
    echo "restore: check R2 failed: expected pg_restore exit 0, got: $(head -c 400 "$WORK/restore.err" | tr '\n' ' ')" >&2
    exit 1
  }
  t1="$(mth_clock)"
  step database "$t0" "$t1"

  # 5. Evidence: copy-in through BE-E's CLI (same names, verified), then the retention archive sets.
  mkdir -p "$store"
  EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$store" "${ATTACH_CMD[@]}" copy-in \
    --from "$from/evidence" >"$WORK/copy-in.log" 2>&1 || {
    echo "restore: check R7 failed: expected copy-in exit 0, got: $(tail -c 400 "$WORK/copy-in.log" | tr '\n' ' ')" >&2
    exit 1
  }
  if [ -d "$from/evidence/retention" ]; then
    mkdir -p "$store/retention"
    cp -R "$from/evidence/retention/." "$store/retention/"
  fi
  # F-DG7-1072/1082: the restored evidence gets the owner and modes the running API needs (it runs without
  # capabilities, so it can read only what its own account owns): directories 0700, files 0600.
  if [ "$eowner" != "$(id -u):$(id -g)" ] || [ "$(stat -c '%u:%g' "$store")" != "$eowner" ]; then
    chown -R "$eowner" "$store" 2>"$WORK/chown.err" || {
      echo "restore: check R7 failed: expected the evidence owned by $eowner, got: $(head -c 300 "$WORK/chown.err" | tr '\n' ' ')" >&2
      exit 1
    }
  fi
  find "$store" -type d -exec chmod 0700 {} + && find "$store" -type f -exec chmod 0600 {} + || {
    echo "restore: check R7 failed: expected the evidence modes 0700/0600 to be set" >&2
    exit 1
  }
  t0="$(mth_clock)"
  step evidence "$t1" "$t0"

  # 6. Checks R1-R8 (ADR-0066 §8). Each line: id, name, expected JSON, actual JSON.
  : >"$WORK/checks"
  chk() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$WORK/checks"; }
  chk R1 "manifest and file SHA-256" "{\"files\": $listed, \"mismatches\": 0}" "{\"files\": $listed, \"mismatches\": 0}"

  local level status_out status_rc=0
  level="$(jq_ "j ->> 'migrationLevel'")"
  status_out="$(DATABASE_OWNER_URL="$url" NODE_ENV="${NODE_ENV:-production}" node --conditions=@mth/source "$MTH_REPO/packages/db/src/cli.ts" status 2>&1)" ||
    status_rc=$?
  local status_line
  status_line="$(printf '%s\n' "$status_out" | grep -E '^mth-db status:' | head -1 | sed -E 's/ \([0-9]+ applied\)//')"
  chk R2 "migration level" "{\"migrationLevel\": \"$level\", \"status\": \"mth-db status: up to date\"}" \
    "{\"migrationLevel\": \"$(mth_psql "$url" -c "$MTH_LEVEL_SQL")\", \"status\": \"${status_line:-exit $status_rc}\"}"

  # Recount in one snapshot on the target, with the backup's own queries.
  { echo "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;"; mth_snapshot_queries "$WORK"; echo "COMMIT;"; } |
    mth_psql "$url" >/dev/null 2>"$WORK/recount.err" || {
    echo "restore: check R3 failed: expected the recount to run, got: $(head -c 300 "$WORK/recount.err")" >&2
    exit 1
  }
  local diffs
  diffs="$(diff "$from/db/table-counts.tsv" "$WORK/counts.tsv" | grep -c '^[<>]' || true)"
  chk R3 "per-table row counts" "{\"tables\": $(wc -l <"$from/db/table-counts.tsv"), \"differences\": 0}" \
    "{\"tables\": $(wc -l <"$WORK/counts.tsv"), \"differences\": $diffs}"
  local facts
  facts="$(cat "$WORK/facts.json")"
  chk R4 "audit" "$(jq_ "(j #> '{database,auditEvents}')::text")" \
    "$(mth_psql "$url" -v f="$facts" -c "SELECT (:'f'::jsonb -> 'auditEvents')::text")"
  chk R5 "snapshots" "{\"snapshotDigest\": \"$(jq_ "j #>> '{database,snapshotDigest}'")\"}" \
    "{\"snapshotDigest\": \"$(mth_sha256 "$WORK/snapshot.txt")\"}"
  chk R6 "job state" \
    "$(jq_ "jsonb_build_object('pgbossJobsByState', j #> '{database,pgbossJobsByState}', 'jobScheduleDigest', j #> '{database,jobScheduleDigest}', 'jobRunCount', j #> '{database,jobRunCount}')::text")" \
    "$(mth_psql "$url" -v f="$facts" -v d="$(mth_sha256 "$WORK/schedule.txt")" -c "SELECT jsonb_build_object('pgbossJobsByState', :'f'::jsonb -> 'pgbossJobsByState', 'jobScheduleDigest', :'d', 'jobRunCount', :'f'::jsonb -> 'jobRunCount')::text")"
  rm -f "$WORK/snapshot.txt" "$WORK/schedule.txt"

  local verify_rc=0 ret_bad=0 ret_files=0
  EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$store" "${ATTACH_CMD[@]}" verify \
    --from "$from/evidence" --out "$WORK/verify.json" >"$WORK/verify.log" 2>&1 || verify_rc=$?
  local vcount
  vcount="$(grep -o '"checked":[0-9]*' "$WORK/verify.json" 2>/dev/null | cut -d: -f2 || true)"
  if [ -d "$from/evidence/retention" ]; then
    while IFS= read -r -d '' f; do
      ret_files=$((ret_files + 1))
      [ "$(mth_sha256 "$f")" = "$(mth_sha256 "$store/retention/${f#"$from/evidence/retention/"}")" ] ||
        ret_bad=$((ret_bad + 1))
    done < <(find "$from/evidence/retention" -type f -print0)
  fi
  local entries foreign loose
  entries="$(jq_ "j #>> '{evidence,attachmentManifest,entries}'")"
  # F-DG7-1072/1082: every path of the evidence root (the root included) belongs to the API's account, owner-only.
  foreign="$(find "$store" \( ! -uid "${eowner%%:*}" -o ! -gid "${eowner##*:}" \) -printf x | wc -c)"
  loose="$(find "$store" -perm /077 -printf x | wc -c)"
  chk R7 "evidence" "{\"verified\": ${entries:-null}, \"mismatches\": 0, \"retentionFiles\": $ret_files, \"owner\": \"$eowner\", \"otherOwner\": 0, \"groupOrOtherBits\": 0}" \
    "{\"verified\": ${vcount:-null}, \"mismatches\": $([ "$verify_rc" = 0 ] && echo 0 || echo "\"verify exit $verify_rc\""), \"retentionFiles\": $((ret_files - ret_bad)), \"owner\": \"$(stat -c '%u:%g' "$store")\", \"otherOwner\": $foreign, \"groupOrOtherBits\": $loose}"

  local ready_mode ready_actual
  if [ -n "$readyz" ]; then
    ready_mode="http"
    local body="" i
    for i in $(seq 1 60); do
      body="$(curl -fsS --max-time 5 "$readyz" 2>/dev/null)" && break
      sleep 2
    done
    ready_actual="$(printf '%s' "$body" | grep -o '"status":"[a-z_]*"' | head -1 | cut -d'"' -f4)"
  else
    ready_mode="offline-equivalent"
    local enc st="fail"
    enc="$(mth_psql "$url" -c "SHOW server_encoding")"
    if [ -d "$store" ] && [ -r "$store" ] && [ -w "$store" ]; then st="ok"; fi
    if [ "$enc" = "UTF8" ] && [ "$status_rc" = 0 ] && [ "$st" = ok ]; then ready_actual="ready"; else
      ready_actual="not_ready (database $enc, mth-db status exit $status_rc, storage $st)"
    fi
  fi
  chk R8 "readiness ($ready_mode)" "{\"status\": \"ready\"}" "{\"status\": \"${ready_actual:-unknown}\"}"
  t1="$(mth_clock)"
  step checks "$t0" "$t1"

  # 8. The report.
  mkdir -p "$out"
  local total
  total="$(mth_secs "$T0" "$t1")"
  step total "$T0" "$t1"
  mth_psql "$url" -v label="$label" -v from="$from" -v msha="$msha" -v started="$started" -v finished="$(mth_now)" \
    -v checks="$(cat "$WORK/checks")" -v steps="$(cat "$WORK/steps")" -v mode="$ready_mode" -c "
SELECT jsonb_pretty(jsonb_build_object(
  'schemaVersion', 'mth-restore-report/1', 'label', :'label', 'manifestSha256', :'msha',
  'startedAt', :'started', 'finishedAt', :'finished', 'readinessMode', :'mode',
  'checks', (SELECT jsonb_agg(jsonb_build_object('id', split_part(l, E'\t', 1), 'name', split_part(l, E'\t', 2),
        'expected', split_part(l, E'\t', 3)::jsonb, 'actual', split_part(l, E'\t', 4)::jsonb,
        'result', CASE WHEN split_part(l, E'\t', 3)::jsonb = split_part(l, E'\t', 4)::jsonb THEN 'PASS' ELSE 'FAIL' END)
        ORDER BY split_part(l, E'\t', 1)) FROM regexp_split_to_table(:'checks', E'\n') l WHERE l <> ''),
  'steps', (SELECT jsonb_agg(jsonb_build_object('name', split_part(l, E'\t', 1),
        'seconds', split_part(l, E'\t', 2)::numeric) ORDER BY o)
      FROM regexp_split_to_table(:'steps', E'\n') WITH ORDINALITY AS s(l, o) WHERE l <> ''),
  'note', 'Measured drill timings, not recovery objectives (RPO/RTO are to agree with Mobily IT).'))" \
    >"$out/restore-report.json"

  local failed=0 id name exp act
  while IFS=$'\t' read -r id name exp act; do
    if [ "$(mth_psql "$url" -v a="$exp" -v b="$act" -c "SELECT :'a'::jsonb = :'b'::jsonb")" != "t" ]; then
      echo "restore: check $id failed: expected $exp, got $act" >&2
      failed=1
    fi
  done <"$WORK/checks"
  [ "$failed" = 0 ] || exit 1
  echo "restore: $label restored and ready in $(awk -v s="$total" 'BEGIN { printf "%.1f", s }') s; all checks passed"
}

restore_main "$@"
