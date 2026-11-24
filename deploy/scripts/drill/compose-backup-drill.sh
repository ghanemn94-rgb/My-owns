#!/usr/bin/env bash
# compose-backup-drill.sh: the Compose half of the A19 backup/restore drill (docs/handover/backup-restore.md §3.2, §5,
# §8; ADR-0066; D-243 Q1; F-DG7-1031/1051; T-DG7-DO-D12). REQ-S19-012, REQ-S20-019.
#
#   MTH_SECRETS_DIR=<dir> MTH_BACKUP_ROOT=<owner-only dir> \
#     deploy/scripts/drill/compose-backup-drill.sh --log <file> [--src-project mthbk-src] [--dst-project mthbk-dst]
#       [--src-api-port 28301] [--dst-api-port 28302] [--seed-api-port 28303] [--label <label>] [--keep]
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
#   C2  synthetic demo data in the source: `mth-db seed-demo` (MTH_ENV=demo) and `mth-db seed-dev` (AUTH_MODE=dev)
#       from the source tree, run in a one-off container on the pinned postgres:18 image with the host's Node mounted
#       read-only (no new image).
#   C2b real evidence objects and job state in the source (F-DG7-1072/1082): a one-off DEV-AUTH API of the app image
#       (`run api` with NODE_ENV=development AUTH_MODE=dev, so as uid 10001 with cap_drop ALL and the source's evidence
#       volume, the API's own write path) on 127.0.0.1:<seed-api-port>; journey.mjs --mode dev --steps signin,uploads
#       uploads two SYNTHETIC evidence files through the API; the one-off API is removed. One synthetic pg-boss job is
#       queued on a queue no worker consumes. The source store is listed (owner, mode, SHA-256 of every object) and
#       must hold at least 2 objects, every one owned by 10001:10001 with mode 0600 (directories 0700).
#   C3  backup-restore.md §3.2 step 1: `--profile backup run --rm backup --label <label> --phase database`.
#   C4  §3.2 step 2: the evidence copy-out in the app image (`--user 0:0` with `--cap-add DAC_READ_SEARCH`: root writes
#       into the root-owned set and reads the store, which uid 10001 owns with mode 0700; `--export-id` = the set's id).
#   C5  §3.2 step 3: `--profile backup run --rm backup --label <label> --phase finish`; the success line and the
#       manifest SHA-256 are taken from its output. C4 must report a non-zero copy-out; C5 fails on any script error
#       line on stderr (e.g. "cat: ... No such file or directory", F-DG7-1081), on an empty manifest config.files, on
#       fewer evidence objects than C2b stored, or on no queued synthetic job in pgbossJobsByState.
#   C6  the set is owner-only (no group/other bit on any path of the set; backup-restore.md §3.3).
#   C7  target: a SECOND new Compose project <dst> with new volumes; only `db` is started, so its `mth` database is
#       empty (restore.sh refuses anything else). The evidence volume is initialized from the app image (owner uid
#       10001, mode 0700) by a no-op `run` of `api`, without starting the API.
#   C8  backup-restore.md §5: restore.sh --from <set> --manifest-sha256 <C5> into <dst>'s database and evidence
#       volume, in a one-off postgres:18 container on <dst>'s network (PostgreSQL 18 client tools, same major as the
#       set: D-243 Q14). R8 runs offline here (the API is not started yet); C10 checks /readyz over HTTP.
#   C9  no chown step (F-DG7-1082): restore.sh itself hands the restored evidence to the evidence root's owner
#       (uid 10001, backup-restore.md §5). C9 only VERIFIES: the report has R6 with the queued job and R7 with every
#       object verified, owner 10001:10001 and no foreign owner or group/other bit; then, in the app image as uid 10001
#       with cap_drop ALL (the API's own permissions), every restored object is read and hashed: the list (path,
#       SHA-256) and count equal the source's from C2b, and every path is 10001:10001 with 0700/0600; the synthetic
#       job is still `created` in the target database.
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
SRC="mthbk-src" DST="mthbk-dst" SRC_PORT=28301 DST_PORT=28302 SEED_PORT=28303 LOG="" KEEP=0
DRILL_QUEUE="drill.backup.synthetic"
LABEL="drill-$(date -u +%Y%m%dt%H%M%Sz)"

usage() {
  echo "compose-backup-drill: BLOCKED: usage: compose-backup-drill.sh --log <file> [--src-project <p>]" \
    "[--dst-project <p>] [--src-api-port <n>] [--dst-api-port <n>] [--seed-api-port <n>] [--label <label>] [--keep]" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --log) LOG="${2:-}"; shift 2 ;;
    --src-project) SRC="${2:-}"; shift 2 ;;
    --dst-project) DST="${2:-}"; shift 2 ;;
    --src-api-port) SRC_PORT="${2:-}"; shift 2 ;;
    --dst-api-port) DST_PORT="${2:-}"; shift 2 ;;
    --seed-api-port) SEED_PORT="${2:-}"; shift 2 ;;
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
for p in "$SRC_PORT" "$DST_PORT" "$SEED_PORT"; do
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
    -e MANIFEST_SHA="${MANIFEST_SHA:-}" -e DRILL_QUEUE="$DRILL_QUEUE" -w "$REPO" --entrypoint bash "$PG_IMAGE" -euo pipefail -c "$script"
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
  runner "$SRC" 'set -e; cd packages/db && DATABASE_OWNER_URL="$(cat /run/secrets/database_owner_url)" NODE_ENV=development \
    AUTH_MODE=dev MTH_ENV=demo node --conditions=@mth/source src/cli.ts seed-demo &&
    DATABASE_OWNER_URL="$(cat /run/secrets/database_owner_url)" NODE_ENV=development AUTH_MODE=dev \
    node --conditions=@mth/source src/cli.ts seed-dev'
}
# Lists an evidence volume as "<uid>:<gid> <mode> <sha256> <path>" (sorted by path), read by uid 10001 in the app
# image with the service's cap_drop ALL: exactly what the API can read. A file it cannot read fails the listing.
evidence_list() {
  local project="$1" port="$2"
  MTH_API_PORT="$port" dc -p "$project" run --rm --no-deps -T --user 10001:10001 --entrypoint node api -e '
    const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
    const root = "/var/lib/mth/evidence", out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), st = fs.lstatSync(p), rel = path.relative(root, p);
      const mode = (st.mode & 0o777).toString(8), own = st.uid + ":" + st.gid;
      if (e.isDirectory()) { out.push([own, mode, "-", rel + "/"]); walk(p); }
      else out.push([own, mode, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"), rel]); } };
    const st = fs.statSync(root);
    out.push([st.uid + ":" + st.gid, (st.mode & 0o777).toString(8), "-", "./"]);
    walk(root);
    out.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
    for (const l of out) console.log(l.join(" "));'
}
# Checks a listing: >= <min> files, every path 10001:10001, directories 700 and files 600.
evidence_check() {
  local list="$1" min="$2" files bad
  files="$(awk '$3 != "-"' "$list" | wc -l)"
  bad="$(awk '$1 != "10001:10001" || ($3 == "-" && $2 != "700") || ($3 != "-" && $2 != "600")' "$list")"
  echo "evidence files: $files (at least $min expected); paths not 10001:10001 0700/0600: ${bad:-none}"
  [ "$files" -ge "$min" ] && [ -z "$bad" ]
}
c2b_objects() {
  local name="${SRC}-seed-api" rc=0
  docker rm -f "$name" >/dev/null 2>&1 || true
  MTH_API_PORT="$SRC_PORT" dc -p "$SRC" run -d --no-deps --name "$name" -p "127.0.0.1:$SEED_PORT:3000" \
    -e NODE_ENV=development -e AUTH_MODE=dev -e MTH_ENV=demo -e APP_BASE_URL="http://127.0.0.1:$SEED_PORT" api ||
    return 1
  local i code=""
  for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SEED_PORT/readyz" || true)"
    [ "$code" = 200 ] && break
    sleep 2
  done
  echo "one-off dev-auth API on 127.0.0.1:$SEED_PORT: /readyz HTTP ${code:-none}"
  if [ "$code" = 200 ]; then
    "$NODE" "$REPO/deploy/scripts/drill/journey.mjs" --mode dev --app "http://127.0.0.1:$SEED_PORT" \
      --api "http://127.0.0.1:$SEED_PORT" --user dev.office --steps signin,uploads \
      --journal "$OUT/journal-src.json" --out "$OUT/journey-uploads.json" || rc=$?
  else
    rc=1
  fi
  docker logs "$name" >"$OUT/seed-api.log" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  [ "$rc" = 0 ] || return "$rc"
  # Job state: one synthetic queued job on a queue that no worker consumes (it must still be queued after restore).
  runner "$SRC" 'psql -X -q -v ON_ERROR_STOP=1 "$(cat /run/secrets/database_owner_url)" -c \
    "SELECT pgboss.create_queue('"'"'$DRILL_QUEUE'"'"', '"'"'{\"policy\": \"standard\"}'"'"'::jsonb);
     INSERT INTO pgboss.job (name, data) VALUES ('"'"'$DRILL_QUEUE'"'"', '"'"'{\"synthetic\": true}'"'"');" &&
    psql -X -qAt "$(cat /run/secrets/database_owner_url)" -c \
    "SELECT '"'"'source: evidence_content rows '"'"' || (SELECT count(*) FROM evidence_content)
       || '"'"', queued synthetic jobs '"'"' || (SELECT count(*) FROM pgboss.job WHERE name = '"'"'$DRILL_QUEUE'"'"' AND state = '"'"'created'"'"')"' ||
    return 1
  evidence_list "$SRC" "$SRC_PORT" | tee "$OUT/source-evidence.txt" || return 1
  evidence_check "$OUT/source-evidence.txt" 2
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
    --out "/backups/$LABEL/evidence/attachments.json" --export-id "$id" | tee "$OUT/copy-out.out"
}
# F-DG7-1072: a copy-out of zero objects proves nothing about reading the uid-10001 0700 store.
c4_step() {
  local n
  c4_copyout || return 1
  n="$(sed -n 's/.*copy-out: copied \([0-9][0-9]*\) objects (\([0-9][0-9]*\) distinct files.*/\2/p' "$OUT/copy-out.out")"
  echo "distinct files copied out: ${n:-none}"
  [ -n "$n" ] && [ "$n" -ge 2 ]
}
c5_finish() {
  MTH_API_PORT="$SRC_PORT" dc -p "$SRC" --profile backup run --rm backup --label "$LABEL" --phase finish \
    >"$OUT/finish.out" 2>"$OUT/finish.err"
  local frc=$?
  cat "$OUT/finish.out" "$OUT/finish.err"
  [ "$frc" = 0 ] || return "$frc"
  # (run_step calls each step in an `||` list, where `set -e` is off: every check returns explicitly.)
  grep -E "^backup: set $LABEL succeeded: " "$OUT/finish.out" || return 1
  # F-DG7-1081: stderr holds only Docker Compose's own progress lines, never a script error line.
  local noise
  noise="$(grep -vE '^[[:space:]]*([✔✓⠿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|(Container|Network|Volume) )' "$OUT/finish.err" || true)"
  echo "stderr lines other than Compose progress: ${noise:-none}"
  [ -z "$noise" ] || return 1
  "$NODE" -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const q = process.argv[2], want = Number(process.argv[3]);
    const p = [];
    if (!Array.isArray(m.config?.files) || m.config.files.length === 0) p.push("config.files is empty");
    if (m.evidence.attachmentManifest.count < want) p.push(`evidence count ${m.evidence.attachmentManifest.count} < ${want}`);
    if (!(m.database.pgbossJobsByState?.created >= 1)) p.push("no created pg-boss job in the manifest");
    console.log(`manifest: config.files ${JSON.stringify(m.config.files.map((f) => f.path))}, evidence ` +
      `${m.evidence.attachmentManifest.count} files / ${m.evidence.attachmentManifest.entries} entries, ` +
      `pgbossJobsByState ${JSON.stringify(m.database.pgbossJobsByState)}, jobRunCount ${m.database.jobRunCount}`);
    if (p.length) { console.log("manifest problems: " + p.join("; ")); process.exit(1); }' \
    "$MTH_BACKUP_ROOT/$LABEL/backup-manifest.json" "$DRILL_QUEUE" 2
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
  MTH_API_PORT="$DST_PORT" dc -p "$DST" up -d --wait db || return 1
  # Initialize the evidence volume from the app image (owner 10001, 0700) without starting the API.
  MTH_API_PORT="$DST_PORT" dc -p "$DST" run --rm --no-deps --entrypoint true api
}
c8_restore() {
  runner "$DST" 'TARGET_DATABASE_URL_FILE=/run/secrets/database_owner_url bash deploy/scripts/restore.sh \
    --from "$MTH_BACKUP_ROOT/$LABEL" --target-evidence-path /var/lib/mth/evidence --out /drill-out/restore \
    --manifest-sha256 "$MANIFEST_SHA"'
}
c9_verify() {
  "$NODE" -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const c = Object.fromEntries(r.checks.map((x) => [x.id, x]));
    const p = [];
    for (const x of r.checks) if (x.result !== "PASS") p.push(`${x.id} ${x.result}`);
    if (!(c.R7?.actual?.verified >= 2)) p.push(`R7 verified ${c.R7?.actual?.verified}`);
    if (c.R7?.actual?.owner !== "10001:10001") p.push(`R7 owner ${c.R7?.actual?.owner}`);
    if (!(c.R6?.actual?.pgbossJobsByState?.created >= 1)) p.push("R6 has no created job");
    console.log(`R6 ${JSON.stringify(c.R6?.actual)}; R7 ${JSON.stringify(c.R7?.actual)}`);
    if (p.length) { console.log("report problems: " + p.join("; ")); process.exit(1); }' \
    "$OUT/restore/restore-report.json" || return 1
  evidence_list "$DST" "$DST_PORT" | tee "$OUT/target-evidence.txt" || return 1
  evidence_check "$OUT/target-evidence.txt" 2 || return 1
  # The same objects with the same bytes: (SHA-256, path) of every file equal on source and target.
  diff <(awk '$3 != "-" { print $3, $4 }' "$OUT/source-evidence.txt") \
    <(awk '$3 != "-" { print $3, $4 }' "$OUT/target-evidence.txt") || return 1
  echo "source and target evidence: same $(awk '$3 != "-"' "$OUT/target-evidence.txt" | wc -l) files, same SHA-256"
  runner "$DST" 'n="$(psql -X -qAt "$(cat /run/secrets/database_owner_url)" -c \
    "SELECT count(*) FROM pgboss.job WHERE name = '"'"'$DRILL_QUEUE'"'"' AND state = '"'"'created'"'"'")";
    echo "target: queued synthetic jobs $n"; [ "$n" = 1 ]'
}
c10_start() {
  MTH_API_PORT="$DST_PORT" dc -p "$DST" up -d --wait || return 1
  dc -p "$DST" logs --no-color migrate | tee "$OUT/dst-migrate.log"
  grep -q "up to date" "$OUT/dst-migrate.log" || return 1
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
run_step C2 "seed-demo and seed-dev (SYNTHETIC) into the source" c2_seed
run_step C2b "2 evidence uploads through a one-off dev-auth API (uid 10001) and 1 queued job (SYNTHETIC)" c2b_objects
run_step C3 "§3.2 step 1: backup profile on postgres:18, --phase database" c3_database
run_step C4 "§3.2 step 2: evidence copy-out in the app image (--user 0:0, DAC_READ_SEARCH), >= 2 files" c4_step
run_step C5 "§3.2 step 3: backup profile, --phase finish (no stderr noise, config.files, counts)" c5_finish
if [ -z "$FAILED" ]; then
  MANIFEST_SHA="$(sed -n 's/.*manifest sha256 \([0-9a-f]\{64\}\).*/\1/p' "$OUT/finish.out" | tail -1)"
  log "manifest sha256 (from the backup line): ${MANIFEST_SHA:-NOT FOUND}"
  [ -n "$MANIFEST_SHA" ] || { FAILED=C5 RESULT=FAIL; }
fi
run_step C6 "the set is owner-only (§3.3)" c6_modes
run_step C7 "target project $DST: new volumes, db only" c7_target
run_step C8 "restore.sh into $DST (postgres:18 client tools, --manifest-sha256)" c8_restore
run_step C9 "verify only (no owner change): R6/R7, uid 10001 reads every object, owner/modes, hashes, queued job" c9_verify
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
