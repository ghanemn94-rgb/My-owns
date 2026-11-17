#!/usr/bin/env bash
# compose-backup-drill.sh: the Compose half of the A19 backup/restore drill (docs/handover/backup-restore.md §3.2, §5,
# §8; ADR-0066; D-243 Q1; F-DG7-1031/1051; T-DG7-DO-D12). REQ-S19-012, REQ-S20-019.
#
#   MTH_SECRETS_DIR=<dir> MTH_BACKUP_ROOT=<owner-only dir> \
#     deploy/scripts/drill/compose-backup-drill.sh --log <file> [--src-project mthbk-src] [--dst-project mthbk-dst]
#       [--src-api-port 28301] [--dst-api-port 28302] [--label <label>] [--keep]
#
# Run it from any directory on a host with a Docker daemon (deploy/scripts/ensure-docker.sh), Docker Compose v2, the
# app image (MTH_APP_IMAGE, default mth-app:local, built by deploy/scripts/build-image.sh), the pinned postgres:18 image,
# Node 24 and curl on PATH, root (as for §3.2) and this repository installed (pnpm install), because restore.sh and seed-demo run from the source
# tree. It is a drill on SYNTHETIC data. A local Compose drill is not evidence of high-availability production
# readiness, and it approves nothing (no G1-G6 decision, no DG0-DG7 record).
#
# Steps (each timed; a failed step stops the drill, the later steps are recorded NOT_RUN, never PASS):
#   C0  environment facts: date, uname, docker and compose versions, image ids and digests, node, free disk.
#   C1  source: a NEW Compose project <src> (new volumes; refused if its volumes already exist), `up -d --wait`.
#   C2  synthetic demo data in the source: `mth-db seed-demo` (MTH_ENV=demo) from the source tree, run in a one-off
#       container on the pinned postgres:18 image with the host's Node mounted read-only (no new image).
#   C3  backup-restore.md §3.2 step 1: `--profile backup run --rm backup --label <label> --phase database`.
#   C4  §3.2 step 2: the evidence copy-out in the app image (`--user 0:0` with `--cap-add DAC_READ_SEARCH`: root writes
#       into the root-owned set and reads the store, which uid 10001 owns with mode 0700; `--export-id` = the set's id).
#   C5  §3.2 step 3: `--profile backup run --rm backup --label <label> --phase finish`; the success line and the
#       manifest SHA-256 are taken from its output.
#   C6  the set is owner-only (no group/other bit on any path of the set; backup-restore.md §3.3).
#   C7  target: a SECOND new Compose project <dst> with new volumes; only `db` is started, so its `mth` database is
#       empty (restore.sh refuses anything else). The evidence volume is initialized from the app image (owner uid
#       10001, mode 0700) by a no-op `run` of `api`, without starting the API.
#   C8  backup-restore.md §5: restore.sh --from <set> --manifest-sha256 <C5> into <dst>'s database and evidence
#       volume, in a one-off postgres:18 container on <dst>'s network (PostgreSQL 18 client tools, same major as the
#       set: D-243 Q14). R8 runs offline here (the API is not started yet); C10 checks /readyz over HTTP.
#   C9  ownership of the restored evidence objects set to the owner of the evidence root (the image's app user), so
#       the API can read and later remove them. restore.sh runs as root and does not do this itself.
#   C10 start <dst> (`up -d --wait`: migrate must report "up to date", then api and worker); GET
#       http://127.0.0.1:<dst-api-port>/readyz over HTTP from the host must answer 200 with status ready.
#   C11 cleanup: `down -v` of both projects unless --keep. The set stays in MTH_BACKUP_ROOT (IT's to prune).
#
# The commands of C3-C5 are exactly those of §3.2, with `-p <src>` added so that the drill never touches an existing
# installation (the guide's commands use the default project name `mth`). The log names every command, its exit code
# and its seconds; it never contains a secret value (secrets are files under MTH_SECRETS_DIR, read inside containers).
#
# Exit codes (p7-work-split §2 rule 4): 0 PASS; 1 FAIL (a step failed); 2 BLOCKED (usage, MTH_SECRETS_DIR or
# MTH_BACKUP_ROOT missing, a project's volumes already exist); 3 BLOCKED (no Docker daemon, no Compose, an image
# missing, no node or curl, not root). The cleanup step C11 never changes the result.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
COMPOSE_FILE="$REPO/deploy/compose/compose.yaml"
PG_IMAGE="$(sed -n 's/^ *image: \(postgres:18@sha256:[0-9a-f]\{64\}\) *$/\1/p' "$COMPOSE_FILE" | head -1)"
APP_IMAGE="${MTH_APP_IMAGE:-mth-app:local}"
SRC="mthbk-src" DST="mthbk-dst" SRC_PORT=28301 DST_PORT=28302 LOG="" KEEP=0
LABEL="drill-$(date -u +%Y%m%dt%H%M%Sz)"

usage() {
  echo "compose-backup-drill: BLOCKED: usage: compose-backup-drill.sh --log <file> [--src-project <p>]" \
    "[--dst-project <p>] [--src-api-port <n>] [--dst-api-port <n>] [--label <label>] [--keep]" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --log) LOG="${2:-}"; shift 2 ;;
    --src-project) SRC="${2:-}"; shift 2 ;;
    --dst-project) DST="${2:-}"; shift 2 ;;
    --src-api-port) SRC_PORT="${2:-}"; shift 2 ;;
    --dst-api-port) DST_PORT="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$LOG" ] || usage
[[ "$SRC" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [[ "$DST" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [ "$SRC" != "$DST" ] || {
  echo "compose-backup-drill: BLOCKED: the two project names must differ and match ^[a-z0-9][a-z0-9_-]*\$" >&2
  exit 2
}
[ "$SRC" != "mth" ] && [ "$DST" != "mth" ] || {
  echo "compose-backup-drill: BLOCKED: the project 'mth' is the installation of the guide; the drill uses new projects" >&2
  exit 2
}
for p in "$SRC_PORT" "$DST_PORT"; do
  [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 25000 ] && [ "$p" -le 31999 ] || {
    echo "compose-backup-drill: BLOCKED: API ports must lie in the pool 25000-31999" >&2
    exit 2
  }
done
[[ "$LABEL" =~ ^[a-z0-9][a-z0-9._-]{0,99}$ ]] || { echo "compose-backup-drill: BLOCKED: invalid --label" >&2; exit 2; }
[ -n "${MTH_SECRETS_DIR:-}" ] && [ -d "$MTH_SECRETS_DIR" ] || {
  echo "compose-backup-drill: BLOCKED: MTH_SECRETS_DIR is not a directory (deploy/scripts/init-secrets.sh)" >&2
  exit 2
}
[ -n "${MTH_BACKUP_ROOT:-}" ] && [ -d "$MTH_BACKUP_ROOT" ] || {
  echo "compose-backup-drill: BLOCKED: MTH_BACKUP_ROOT must be an existing owner-only directory (backup-restore.md §3.3)" >&2
  exit 2
}
[ -n "$PG_IMAGE" ] || { echo "compose-backup-drill: BLOCKED: no pinned postgres:18 image in $COMPOSE_FILE" >&2; exit 2; }
mkdir -p "$(dirname "$LOG")"
: >"$LOG"
OUT="$(cd "$(dirname "$LOG")" && pwd)/$(basename "$LOG" .log).d"
mkdir -p "$OUT"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || {
  log "BLOCKED: no Docker daemon (deploy/scripts/ensure-docker.sh)"
  exit 3
}
docker compose version >/dev/null 2>&1 || { log "BLOCKED: docker compose v2 not found"; exit 3; }
command -v curl >/dev/null 2>&1 || { log "BLOCKED: curl not found (C10 checks /readyz over HTTP)"; exit 3; }
# The set is created owner-only by the root `backup` service (§3.3); reading its id (§3.2 step 2) needs the same account.
[ "$(id -u)" = 0 ] || { log "BLOCKED: run as root, like the commands of backup-restore.md §3.2"; exit 3; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { log "BLOCKED: node not found on PATH"; exit 3; }
NODE_HOME="$(cd "$(dirname "$NODE")/.." && pwd)"
for img in "$APP_IMAGE" "$PG_IMAGE"; do
  docker image inspect "$img" >/dev/null 2>&1 || { log "BLOCKED: image $img is not present on this host"; exit 3; }
done
for p in "$SRC" "$DST"; do
  if [ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$p")" ]; then
    log "BLOCKED: project $p already has volumes; the drill needs new volumes (docker compose -p $p down -v)"
    exit 2
  fi
done

STEPS=() RESULT=PASS FAILED=""
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
# run_step <id> <description> <command...>: runs, logs, times; after a failure every later step is NOT_RUN.
run_step() {
  local id="$1" what="$2"
  shift 2
  if [ -n "$FAILED" ]; then
    STEPS+=("$id NOT_RUN $what")
    log "$id NOT_RUN ($what): an earlier step ($FAILED) failed"
    return 0
  fi
  log "$id start: $what"
  local t0 t1 rc=0
  t0="$(date +%s.%N)"
  "$@" >>"$LOG" 2>&1 || rc=$?
  t1="$(date +%s.%N)"
  local secs
  secs="$(awk -v a="$t0" -v b="$t1" 'BEGIN { printf "%.2f", b - a }')"
  if [ "$rc" -eq 0 ]; then
    STEPS+=("$id PASS ${secs}s $what")
    log "$id PASS exit=0 ${secs}s"
  else
    STEPS+=("$id FAIL exit=$rc ${secs}s $what")
    log "$id FAIL exit=$rc ${secs}s"
    FAILED="$id" RESULT=FAIL
  fi
}
# runner <project> <script>: a one-off container on the pinned postgres:18 image (PostgreSQL 18 client tools) on the
# project's network, with this repository and the host's Node mounted read-only at their own paths, the backup root
# read-only, the drill output directory writable and the project's evidence volume at /var/lib/mth/evidence.
runner() {
  local project="$1" script="$2"
  docker run --rm --network "${project}_default" --user 0:0 \
    -v "$REPO:$REPO:ro" -v "$NODE_HOME:$NODE_HOME:ro" -v "$MTH_BACKUP_ROOT:$MTH_BACKUP_ROOT:ro" -v "$OUT:/drill-out" \
    -v "$MTH_SECRETS_DIR/database_owner_url:/run/secrets/database_owner_url:ro" \
    -v "${project}_evidence:/var/lib/mth/evidence" \
    -e HOME=/tmp -e LANG=C.UTF-8 -e PATH="$NODE_HOME/bin:/usr/lib/postgresql/18/bin:/usr/local/bin:/usr/bin:/bin" \
    -e PGBIN=/usr/lib/postgresql/18/bin -e REPO="$REPO" -e MTH_BACKUP_ROOT="$MTH_BACKUP_ROOT" -e LABEL="$LABEL" \
    -e MANIFEST_SHA="${MANIFEST_SHA:-}" -w "$REPO" --entrypoint bash "$PG_IMAGE" -euo pipefail -c "$script"
}

c0_facts() {
  date -u
  uname -a
  docker version --format 'docker client {{.Client.Version}} server {{.Server.Version}}'
  docker compose version
  docker info --format 'storage driver {{.Driver}}; cgroup {{.CgroupVersion}}; images {{.Images}}'
  for img in "$APP_IMAGE" "$PG_IMAGE"; do
    docker image inspect --format "image $img id {{.Id}} digests {{.RepoDigests}}" "$img"
  done
  echo "node $("$NODE" --version) at $NODE"
  echo "repository HEAD $(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "backup root $MTH_BACKUP_ROOT mode $(stat -L -c '%a %U:%G' "$MTH_BACKUP_ROOT")"
  df -h "$MTH_BACKUP_ROOT" "$(docker info --format '{{.DockerRootDir}}')" 2>/dev/null || df -h "$MTH_BACKUP_ROOT"
}
c1_source() { MTH_API_PORT="$SRC_PORT" dc -p "$SRC" up -d --wait; }
c2_seed() {
  runner "$SRC" 'cd packages/db && DATABASE_OWNER_URL="$(cat /run/secrets/database_owner_url)" NODE_ENV=development \
    AUTH_MODE=dev MTH_ENV=demo node --conditions=@mth/source src/cli.ts seed-demo'
}
c3_database() {
  MTH_API_PORT="$SRC_PORT" dc -p "$SRC" --profile backup run --rm backup --label "$LABEL" --phase database
}
c4_copyout() {
  local id
  id="$(cat "$MTH_BACKUP_ROOT/$LABEL/.backup-state/id")"
  MTH_API_PORT="$SRC_PORT" dc -p "$SRC" run --rm --no-deps -v "$MTH_BACKUP_ROOT:/backups" --user 0:0 \
    --cap-add DAC_READ_SEARCH -e DATABASE_URL_FILE=/run/secrets/database_url --entrypoint node api \
    /app/apps/api/dist/cli/transfer-attachments.js copy-out --to "/backups/$LABEL/evidence" \
    --out "/backups/$LABEL/evidence/attachments.json" --export-id "$id"
}
c5_finish() {
  MTH_API_PORT="$SRC_PORT" dc -p "$SRC" --profile backup run --rm backup --label "$LABEL" --phase finish \
    2>&1 | tee "$OUT/finish.out"
  grep -E "^backup: set $LABEL succeeded: " "$OUT/finish.out"
}
c6_modes() {
  local bad
  bad="$(find "$MTH_BACKUP_ROOT/$LABEL" -perm /077 -printf '%m %p\n')"
  echo "paths with a group/other bit: ${bad:-none}"
  echo "files in the set: $(find "$MTH_BACKUP_ROOT/$LABEL" -type f | wc -l)"
  sha256sum "$MTH_BACKUP_ROOT/$LABEL/backup-manifest.json"
  [ -z "$bad" ]
}
c7_target() {
  MTH_API_PORT="$DST_PORT" dc -p "$DST" up -d --wait db
  # Initialize the evidence volume from the app image (owner 10001, 0700) without starting the API.
  MTH_API_PORT="$DST_PORT" dc -p "$DST" run --rm --no-deps --entrypoint true api
}
c8_restore() {
  runner "$DST" 'TARGET_DATABASE_URL_FILE=/run/secrets/database_owner_url bash deploy/scripts/restore.sh \
    --from "$MTH_BACKUP_ROOT/$LABEL" --target-evidence-path /var/lib/mth/evidence --out /drill-out/restore \
    --manifest-sha256 "$MANIFEST_SHA"'
}
c9_owner() {
  runner "$DST" 'o="$(stat -c %u:%g /var/lib/mth/evidence)"; echo "evidence root owner $o";
    chown -R "$o" /var/lib/mth/evidence; find /var/lib/mth/evidence ! -user "${o%%:*}" -printf "not owned: %p\n" | head'
}
c10_start() {
  MTH_API_PORT="$DST_PORT" dc -p "$DST" up -d --wait
  dc -p "$DST" logs --no-color migrate | tee "$OUT/dst-migrate.log"
  grep -q "up to date" "$OUT/dst-migrate.log"
  local code
  code="$(curl -sS -o "$OUT/readyz.json" -w '%{http_code}' "http://127.0.0.1:$DST_PORT/readyz")"
  echo "GET http://127.0.0.1:$DST_PORT/readyz -> HTTP $code: $(cat "$OUT/readyz.json")"
  [ "$code" = "200" ] && grep -q '"ready"' "$OUT/readyz.json"
}
c11_cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "--keep: projects $SRC and $DST left running"
    return 0
  fi
  local rc=0
  dc -p "$DST" --profile backup down -v --remove-orphans || rc=$?
  dc -p "$SRC" --profile backup down -v --remove-orphans || rc=$?
  return "$rc"
}

log "compose-backup-drill: label $LABEL; source project $SRC (API :$SRC_PORT); target project $DST (API :$DST_PORT)"
log "SYNTHETIC demo data only; a local Compose drill is not evidence of high-availability production readiness."
T0="$(date +%s.%N)"
run_step C0 "environment facts" c0_facts
run_step C1 "source project $SRC: up -d --wait (new volumes)" c1_source
run_step C2 "seed-demo (SYNTHETIC) into the source" c2_seed
run_step C3 "§3.2 step 1: backup profile on postgres:18, --phase database" c3_database
run_step C4 "§3.2 step 2: evidence copy-out in the app image (--user 0:0, DAC_READ_SEARCH)" c4_copyout
run_step C5 "§3.2 step 3: backup profile, --phase finish" c5_finish
if [ -z "$FAILED" ]; then
  MANIFEST_SHA="$(sed -n 's/.*manifest sha256 \([0-9a-f]\{64\}\).*/\1/p' "$OUT/finish.out" | tail -1)"
  log "manifest sha256 (from the backup line): ${MANIFEST_SHA:-NOT FOUND}"
  [ -n "$MANIFEST_SHA" ] || { FAILED=C5 RESULT=FAIL; }
fi
run_step C6 "the set is owner-only (§3.3)" c6_modes
run_step C7 "target project $DST: new volumes, db only" c7_target
run_step C8 "restore.sh into $DST (postgres:18 client tools, --manifest-sha256)" c8_restore
run_step C9 "restored evidence owned by the evidence root's owner" c9_owner
run_step C10 "start $DST; migrate up to date; GET /readyz over HTTP" c10_start
# Cleanup always runs, even after a failure; its result never changes the drill's result.
SAVED_FAILED="$FAILED" SAVED_RESULT="$RESULT"
FAILED=""
run_step C11 "cleanup (down -v of both projects unless --keep)" c11_cleanup
FAILED="$SAVED_FAILED" RESULT="$SAVED_RESULT"
TOTAL="$(awk -v a="$T0" -v b="$(date +%s.%N)" 'BEGIN { printf "%.2f", b - a }')"
[ -z "$FAILED" ] || RESULT=FAIL
log "summary:"
for s in "${STEPS[@]}"; do log "  $s"; done
log "compose-backup-drill: $RESULT in ${TOTAL}s (label $LABEL; restore report $OUT/restore/restore-report.json)"
[ "$RESULT" = PASS ] && exit 0 || exit 1
