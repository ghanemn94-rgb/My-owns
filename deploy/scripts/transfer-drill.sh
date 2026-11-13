#!/usr/bin/env bash
# transfer-drill.sh: the A18 transfer drill, container-free half (ADR-0069 §4 D0-D11; p7-work-split §B.2; T-DG7-DO-D).
# REQ-S19-017, REQ-S01-006, REQ-S19-009, REQ-S20-018, REQ-S01-001.
#
#   deploy/scripts/transfer-drill.sh --archive <release.tar.gz> --sha256 <hex> --store <pnpm store> --out <dir>
#                                    [--work <empty dir>] [--keep]
#
# The whole drill runs inside ONE `bwrap --dev-bind / / --unshare-net` namespace, which this script enters itself
# (loopback up, no route off the host; ADR-0069 §Context 5; `unshare --net` is never used because its loopback is down).
# Its first step is the network probe of ADR-0062 §5.1: a TCP connect to 1.1.1.1:443 and a DNS lookup of
# registry.npmjs.org must both fail. Ports are fixed inside the fresh namespace and lie in the pool 25000-31999.
#
#   D0  verify the archive (build-archive.mjs --verify), build from it (build-from-archive.sh) into <work>/build
#   D1  source installation S at http://localhost:<pS>: fresh cluster, migrate, seed-demo + seed-dev (SYNTHETIC), API
#       and worker, then the A02 smoke journey (dev users)
#   D2  export from S (tools/migration/export.mjs; transfer-attachments copy-out runs inside the export), stop S
#   D3  target configuration only from .env.example and docs/handover/deployment.md (drill/config-trace.mjs), with the
#       ADR-0063 template check first; origin http://127.0.0.1:<pT>, NODE_ENV=production, AUTH_MODE=oidc; synthetic
#       generated secrets in *_FILE files
#   D4  production initialization re-proved on a separate clean database: migrate, bootstrap, a second bootstrap refuses
#   D5  import into the empty target (tools/migration/import.mjs) and reconcile (tools/migration/reconcile.mjs)
#   D6  identity rebind to the drill IdP (mth-db rebind-identity); one user left unmapped
#   D7  start T; /readyz 200 with storage ok and worker alive within 120 s; getDeploymentStatus origin = T's origin
#   D8  the oidc-drill journey (drill/journey.mjs) through the SYNTHETIC drill IdP (drill/fake-idp-server.mjs)
#   D9  full restart of PostgreSQL, API and worker; reconcile again; downloads again; /readyz 200
#   D10 old-origin scan (drill/origin-scan.mjs)
#   D11 transfer-drill-report.json (schemaVersion mth-transfer-drill/1)
#
# A step that fails stops the drill: the later steps are recorded NOT_RUN (never PASS) and the report's result is FAIL.
# Output (--out): transfer-drill-report.json, config-trace.json, reconcile-*.json, origin-scan.json, drill.log and
# the step logs. Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL, 2 BLOCKED (usage), 3 BLOCKED (no bwrap, no
# PostgreSQL server binaries). The drill IdP and every credential are SYNTHETIC; a local drill is not evidence of
# high-availability production readiness, and it approves nothing (no G1-G6 decision, no DG0-DG7 record).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ARCHIVE="" SHA="" STORE="" OUT="" WORK="" KEEP=0
usage() {
  echo "transfer-drill: BLOCKED: usage: transfer-drill.sh --archive <tar.gz> --sha256 <hex> --store <dir> --out <dir> [--work <dir>] [--keep]" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="${2:-}"; shift 2 ;;
    --sha256) SHA="${2:-}"; shift 2 ;;
    --store) STORE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --work) WORK="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) usage ;;
  esac
done

# ---------------------------------------------------------------------------------------------------- outer mode
if [ "${MTH_TD_INNER:-}" != "1" ]; then
  [ -n "$ARCHIVE" ] && [ -n "$SHA" ] && [ -n "$STORE" ] && [ -n "$OUT" ] || usage
  [[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "transfer-drill: BLOCKED: --sha256 must be 64 lowercase hex" >&2; exit 2; }
  [ -f "$ARCHIVE" ] || { echo "transfer-drill: BLOCKED: archive $ARCHIVE not found" >&2; exit 2; }
  [ -d "$STORE" ] || { echo "transfer-drill: BLOCKED: pnpm store $STORE not found" >&2; exit 2; }
  if ! command -v bwrap >/dev/null 2>&1 || ! bwrap --dev-bind / / --unshare-net true 2>/dev/null; then
    echo "transfer-drill: BLOCKED: no network namespace with loopback (bwrap unavailable)"
    exit 3
  fi
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  for b in initdb postgres pg_ctl psql; do
    [ -n "$PGBIN" ] && [ -x "$PGBIN/$b" ] || {
      echo "transfer-drill: BLOCKED: PostgreSQL server binaries not found (set PGBIN)"
      exit 3
    }
  done
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
  STORE="$(cd "$STORE" && pwd)"
  if [ -z "$WORK" ]; then WORK="$(mktemp -d "${TMPDIR:-/tmp}/mth-transfer-drill.XXXXXX")"; fi
  mkdir -p "$WORK"
  [ -z "$(ls -A "$WORK")" ] || { echo "transfer-drill: BLOCKED: work directory $WORK is not empty" >&2; exit 2; }
  WORK="$(cd "$WORK" && pwd)"
  chmod 0755 "$WORK"
  set +e
  MTH_TD_INNER=1 MTH_TD_ARCHIVE="$ARCHIVE" MTH_TD_SHA="$SHA" MTH_TD_STORE="$STORE" MTH_TD_OUT="$OUT" \
    MTH_TD_WORK="$WORK" PGBIN="$PGBIN" bwrap --dev-bind / / --unshare-net --die-with-parent \
    bash "$HERE/transfer-drill.sh" 2>&1 | tee "$OUT/drill.log"
  rc="${PIPESTATUS[0]}"
  set -e
  [ "$KEEP" -eq 1 ] || rm -rf "$WORK"
  exit "$rc"
fi

# ---------------------------------------------------------------------------------------------------- inner mode
ARCHIVE="${MTH_TD_ARCHIVE:-}" SHA="${MTH_TD_SHA:-}" STORE="${MTH_TD_STORE:-}" OUT="${MTH_TD_OUT:?}" WORK="${MTH_TD_WORK:?}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export LANG=C.UTF-8 TZ=UTC
T_ALL="$(date +%s.%N)"
clock() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.3f", (b - a) }'; }
log() { echo "transfer-drill: $*"; }
STEPS_FILE="$OUT/steps.ndjson"
: >"$STEPS_FILE"
PG_S_PID="" PG_T_PID="" API_PID="" WORKER_PID="" IDP_PID=""
# stop_pid <pid>: TERM, wait up to 5 s, then KILL. An empty or non-numeric pid is a no-op (never `kill 0`, which would
# signal the whole process group).
stop_pid() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]] || return 0
  kill -TERM "$1" 2>/dev/null || return 0
  for _ in $(seq 1 50); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done
  kill -KILL "$1" 2>/dev/null || true
}
cleanup() { for p in "$API_PID" "$WORKER_PID" "$IDP_PID" "$PG_S_PID" "$PG_T_PID"; do stop_pid "$p"; done; }
trap cleanup EXIT

# Ports (the namespace is fresh, so they are free; all in the pool 25000-31999).
P_PG_S=25432 P_PG_T=25433 P_API_S=25301 P_API_T=25302 P_IDP=25401
ORIGIN_S="http://localhost:$P_API_S"
ORIGIN_T="http://127.0.0.1:$P_API_T"
OPERATOR="transfer-drill (synthetic)"
IDP_LABEL="synthetic drill IdP (not a corporate IdP)"
log "work $WORK; out $OUT; source origin $ORIGIN_S; target origin $ORIGIN_T"
log "environment: node $(node --version); $(bwrap --version); PostgreSQL $("$PGBIN/postgres" --version | awk '{print $NF}'); uid $(id -u)"

# ---- the network probe (ADR-0062 §5.1; MTH_EGRESS_PROBE / MTH_EGRESS_DNS_PROBE override the targets, as in smoke.mjs) -----------------------------------------------------------------------------
if ! node -e '
  const net = require("node:net"), dns = require("node:dns");
  let bad = 0, n = 0;
  const done = () => { if (++n === 2) process.exit(bad ? 1 : 0); };
  const [host, port] = (process.env.MTH_EGRESS_PROBE || "1.1.1.1:443").split(":");
  const name = process.env.MTH_EGRESS_DNS_PROBE || "registry.npmjs.org";
  const s = net.connect({ host, port: Number(port), timeout: 5000 });
  s.on("connect", () => { console.log(`probe tcp ${host}:${port}: CONNECTED`); bad = 1; s.destroy(); done(); });
  s.on("timeout", () => { console.log(`probe tcp ${host}:${port}: timeout`); s.destroy(); done(); });
  s.on("error", (e) => { console.log(`probe tcp ${host}:${port}: ${e.code}`); done(); });
  dns.lookup(name, (e, a) => { if (e) console.log(`probe dns ${name}: ${e.code}`); else { console.log(`probe dns ${name}: RESOLVED ${a}`); bad = 1; } done(); });
'; then
  echo "transfer-drill: network isolation is not effective"
  exit 1
fi
log "probe: network isolation effective (no route, no resolver); loopback only"

# ---- step bookkeeping -------------------------------------------------------------------------------------------
ALL_STEPS=(D0 D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11)
declare -A SECTION=(
  [D0]="docs/handover/deployment.md#first-deployment" [D1]="docs/handover/deployment.md#first-deployment"
  [D2]="docs/handover/deployment.md#origin-change" [D3]="docs/handover/deployment.md#configuration-keys"
  [D4]="docs/handover/deployment.md#database" [D5]="docs/handover/deployment.md#origin-change"
  [D6]="docs/handover/deployment.md#corporate-sso-mapping" [D7]="docs/handover/deployment.md#monitoring"
  [D8]="docs/handover/deployment.md#origin-change" [D9]="docs/handover/deployment.md#monitoring"
  [D10]="docs/handover/deployment.md#origin-change" [D11]="docs/handover/deployment.md#first-deployment"
)
record() { # record <id> <command> <exit> <seconds> <result> <detail>
  node -e 'const [id, command, exit, seconds, result, detail, section] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ id, guideSection: section, command, exit: Number(exit), seconds: Number(seconds), result, detail }) + "\n");' \
    "$1" "$2" "$3" "$4" "$5" "$6" "${SECTION[$1]}" >>"$STEPS_FILE"
}
FAILED=""
# step <id> <command text> <function>: runs the function, records exit and seconds; on failure prints the B.5 line.
step() {
  local id="$1" cmd="$2" fn="$3" t0 rc
  [ -z "$FAILED" ] || { record "$id" "$cmd" -1 0 NOT_RUN "not run: step $FAILED failed"; return 0; }
  log "step $id start: $cmd"
  t0="$(clock)"
  STEP_DETAIL=""
  set +e
  ( set -e; "$fn" ) >"$OUT/step-$id.log" 2>&1
  rc=$?
  set -e
  sed 's/^/  | /' "$OUT/step-$id.log"
  STEP_DETAIL="$(tail -1 "$OUT/step-$id.log" 2>/dev/null | cut -c1-300)"
  if [ "$rc" -eq 0 ]; then
    record "$id" "$cmd" 0 "$(secs "$t0" "$(clock)")" PASS "$STEP_DETAIL"
    log "step $id PASS in $(secs "$t0" "$(clock)") s"
  else
    record "$id" "$cmd" "$rc" "$(secs "$t0" "$(clock)")" FAIL "$STEP_DETAIL"
    echo "transfer-drill: step $id failed: exit $rc: $STEP_DETAIL"
    FAILED="$id"
  fi
}

# ---- helpers ----------------------------------------------------------------------------------------------------
as_pg() { if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi; }
rand() { node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))'; }
pg_init() { # pg_init <dir> <port> <pidvar>
  local dir="$1" port="$2"
  mkdir -p "$dir" && chmod 0777 "$dir"
  rand >"$dir.su" && chmod 0644 "$dir.su"
  as_pg "$PGBIN/initdb" -D "$dir/data" -U postgres --pwfile="$dir.su" --auth-local=trust --auth-host=scram-sha-256 \
    --encoding=UTF8 --locale=C >/dev/null
}
pg_start() { # pg_start <dir> <port> -> echoes the pid
  local dir="$1" port="$2"
  as_pg "$PGBIN/postgres" -D "$dir/data" -p "$port" -k "$dir" -c listen_addresses=127.0.0.1 >>"$dir/pg.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 120); do
    PGPASSWORD="$(cat "$dir.su")" "$PGBIN/psql" -h 127.0.0.1 -p "$port" -U postgres -d postgres -qAtc 'select 1' \
      >/dev/null 2>&1 && { echo "$pid"; return 0; }
    sleep 0.25
  done
  return 1
}
su_url() { printf 'postgres://postgres:%s@127.0.0.1:%s/%s' "$(cat "$1.su")" "$2" "${3:-postgres}"; }
make_db() { # make_db <dir> <port> <db> <secrets dir>: roles (first time) and an empty UTF8 database
  local dir="$1" port="$2" db="$3" sec="$4" su
  su="$(su_url "$dir" "$port")"
  [ -f "$sec/mth_owner_db_password" ] || rand >"$sec/mth_owner_db_password"
  [ -f "$sec/mth_app_db_password" ] || rand >"$sec/mth_app_db_password"
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$su" --set=owner_pw="$(cat "$sec/mth_owner_db_password")" \
    --set=app_pw="$(cat "$sec/mth_app_db_password")" --set=db="$db" <<'SQL'
SELECT 'CREATE ROLE mth_owner LOGIN PASSWORD ' || quote_literal(:'owner_pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mth_owner') \gexec
SELECT 'CREATE ROLE mth_app LOGIN PASSWORD ' || quote_literal(:'app_pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mth_app') \gexec
SELECT format('CREATE DATABASE %I OWNER mth_owner ENCODING %L LC_COLLATE %L LC_CTYPE %L TEMPLATE template0', :'db', 'UTF8', 'C', 'C') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO mth_app', :'db') \gexec
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'db', 'UTC') \gexec
SQL
  printf 'postgres://mth_owner:%s@127.0.0.1:%s/%s' "$(cat "$sec/mth_owner_db_password")" "$port" "$db" >"$sec/${db}_owner_url"
  printf 'postgres://mth_app:%s@127.0.0.1:%s/%s' "$(cat "$sec/mth_app_db_password")" "$port" "$db" >"$sec/${db}_app_url"
}
wait_http() { # wait_http <url> <seconds> <expect regex on status>
  local t=$(( $2 * 4 ))
  for _ in $(seq 1 "$t"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true)"
    [[ "$code" =~ $3 ]] && return 0
    sleep 0.25
  done
  return 1
}

BUILD="$WORK/build" SECS="$WORK/secrets" PKG="$WORK/package"
mkdir -p "$SECS" "$PKG" && chmod 0700 "$SECS"
RT="" SRC=""
MTHDB() { node "$RT/packages/db/dist/cli.js" "$@"; }

# ---- D0 --------------------------------------------------------------------------------------------------------
d0() {
  node "$REPO/tools/release/build-archive.mjs" --verify "$ARCHIVE" --expect-sha256 "$SHA"
  bash "$REPO/tools/release/build-from-archive.sh" "$ARCHIVE" --sha256 "$SHA" --store "$STORE" --work "$BUILD" --keep
  [ -f "$BUILD/runtime/apps/api/dist/main.js" ] || { echo "no runtime tree in $BUILD/runtime"; return 1; }
  echo "D0: archive $SHA verified and built; runtime $BUILD/runtime"
}
step D0 "node tools/release/build-archive.mjs --verify <archive> --expect-sha256 $SHA && tools/release/build-from-archive.sh <archive> --sha256 $SHA --store <store> --work <work>/build" d0
RT="$BUILD/runtime"
SRC="$(ls -d "$BUILD"/unpacked/*/source 2>/dev/null | head -1 || true)"

# ---- D1: the source installation S ---------------------------------------------------------------------------------
start_api() { # start_api <envfile-or-inline...>: env -i + the runtime API; sets API_PID
  ( exec env -i PATH="$PATH" HOME="$WORK" LANG=C.UTF-8 "$@" node "$RT/apps/api/dist/main.js" ) >>"$OUT/api.log" 2>&1 &
  API_PID=$!
}
start_worker() {
  ( exec env -i PATH="$PATH" HOME="$WORK" LANG=C.UTF-8 "$@" node "$RT/apps/worker/dist/main.js" ) >>"$OUT/worker.log" 2>&1 &
  WORKER_PID=$!
}
S_ENV=()
d1() {
  pg_init "$WORK/pgS" "$P_PG_S"
  PG_S_PID="$(pg_start "$WORK/pgS" "$P_PG_S")"
  echo "$PG_S_PID" >"$WORK/pgS.pid"
  make_db "$WORK/pgS" "$P_PG_S" mth "$SECS"
  mkdir -p "$WORK/evidence-S"
  local own app
  own="$(cat "$SECS/mth_owner_url")" app="$(cat "$SECS/mth_app_url")"
  DATABASE_OWNER_URL="$own" NODE_ENV=development MTHDB migrate
  (cd "$SRC/packages/db" && DATABASE_OWNER_URL="$own" NODE_ENV=development AUTH_MODE=dev MTH_ENV=demo \
    node --conditions=@mth/source src/cli.ts seed-demo)
  (cd "$SRC/packages/db" && DATABASE_OWNER_URL="$own" NODE_ENV=development AUTH_MODE=dev \
    node --conditions=@mth/source src/cli.ts seed-dev)
  S_ENV=(NODE_ENV=development AUTH_MODE=dev APP_BASE_URL="$ORIGIN_S" PORT="$P_API_S" DATABASE_URL="$app"
    DATABASE_OWNER_URL="$own" EVIDENCE_STORAGE_PATH="$WORK/evidence-S" LOG_LEVEL=warn)
  start_api "${S_ENV[@]}"; start_worker "${S_ENV[@]}"
  echo "$API_PID $WORKER_PID" >"$WORK/S.pids"
  wait_http "http://127.0.0.1:$P_API_S/readyz" 120 '^200$'
  MTH_SMOKE_API_URL="http://127.0.0.1:$P_API_S" APP_BASE_URL="$ORIGIN_S" MTH_SMOKE_AUTH=dev \
    node "$SRC/deploy/scripts/smoke.mjs"
  "$PGBIN/psql" -X -qAt -d "$(su_url "$WORK/pgS" "$P_PG_S" mth)" -c \
    "select 'D1: evidence rows ' || (select count(*) from evidence) || ', audit_event ' || (select count(*) from audit_event)"
}
step D1 "fresh cluster; mth-db migrate; mth-db seed-demo; mth-db seed-dev; API and worker at $ORIGIN_S; deploy/scripts/smoke.mjs (MTH_SMOKE_AUTH=dev)" d1
[ -f "$WORK/S.pids" ] && read -r API_PID WORKER_PID <"$WORK/S.pids" || true
[ -f "$WORK/pgS.pid" ] && PG_S_PID="$(cat "$WORK/pgS.pid")" || true

# ---- D2: export from S, then stop S ----------------------------------------------------------------------------------
d2() {
  (cd "$SRC" && DATABASE_OWNER_URL="$(cat "$SECS/mth_owner_url")" DATABASE_URL="$(cat "$SECS/mth_app_url")" \
    EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence-S" \
    node tools/migration/export.mjs --out "$PKG" --operator "$OPERATOR")
  echo "manifest sha256 $(sha256sum "$PKG/manifest.json" | cut -d' ' -f1)"
  [ ! -f "$PKG/attachments.json" ] || echo "attachments.json sha256 $(sha256sum "$PKG/attachments.json" | cut -d' ' -f1)"
}
step D2 "DATABASE_OWNER_URL=<S> node tools/migration/export.mjs --out <work>/package --operator '$OPERATOR'" d2
stop_pid "$API_PID"; stop_pid "$WORKER_PID"; stop_pid "$PG_S_PID"; API_PID="" WORKER_PID="" PG_S_PID=""

# ---- D3: the target's configuration, only from the template and the guide --------------------------------------------------
d3() {
  # The template checks first: it is generated and current, and the ADR-0063 secret scan finds no value in it.
  (cd "$SRC" && node deploy/scripts/generate-env-example.mjs --check)
  node "$REPO/tools/release/secret-scan.mjs" --path "$SRC/.env.example"
  rand >"$SECS/oidc_client_secret"
  mkdir -p "$WORK/evidence-T"
  node -e '
    const [o, s, pT, issuer, ev] = process.argv.slice(1);
    const v = { NODE_ENV: { value: "production" }, AUTH_MODE: { value: "oidc" }, APP_BASE_URL: { value: o },
      PORT: { value: pT }, DATABASE_URL: { file: s + "/mth_app_url" }, DATABASE_OWNER_URL: { file: s + "/mth_owner_url" },
      OIDC_ISSUER_URL: { value: issuer }, OIDC_CLIENT_ID: { value: "mth-test-client" },
      OIDC_CLIENT_SECRET: { file: s + "/oidc_client_secret" }, EVIDENCE_STORAGE_DRIVER: { value: "filesystem" },
      EVIDENCE_STORAGE_PATH: { value: ev }, DEFAULT_TIMEZONE: { value: "Asia/Riyadh" }, DEFAULT_CURRENCY: { value: "SAR" },
      LOG_LEVEL: { value: "warn" } };
    require("node:fs").writeFileSync(s + "/values.json", JSON.stringify(v));' \
    "$ORIGIN_T" "$SECS" "$P_API_T" "http://127.0.0.1:$P_IDP/realms/mth-test" "$WORK/evidence-T"
  node "$REPO/deploy/scripts/drill/config-trace.mjs" --template "$SRC/.env.example" \
    --guide "$SRC/docs/handover/deployment.md" --map "$REPO/deploy/scripts/drill/guide-keys.json" \
    --values "$SECS/values.json" --out-env "$SECS/target.env" --out-trace "$OUT/config-trace.json"
}
step D3 "node deploy/scripts/generate-env-example.mjs --check && node deploy/scripts/drill/config-trace.mjs --template .env.example --guide docs/handover/deployment.md --map deploy/scripts/drill/guide-keys.json" d3
T_ENV=()
[ -f "$SECS/target.env" ] && mapfile -t T_ENV < <(grep -E '^[A-Z_]+=.+' "$SECS/target.env")

# ---- D4: production initialization re-proved on a separate clean database -----------------------------------------
d4() {
  pg_init "$WORK/pgT" "$P_PG_T"
  PG_T_PID="$(pg_start "$WORK/pgT" "$P_PG_T")"
  echo "$PG_T_PID" >"$WORK/pgT.pid"
  local s2="$WORK/secrets-d4"; mkdir -p "$s2"; cp "$SECS/mth_owner_db_password" "$SECS/mth_app_db_password" "$s2/"
  make_db "$WORK/pgT" "$P_PG_T" mth_init "$s2"
  local own; own="$(cat "$s2/mth_init_owner_url")"
  DATABASE_OWNER_URL="$own" NODE_ENV=production MTHDB migrate
  local b=(bootstrap --org-code DRILL --org-name-en "Drill organization (synthetic)" --org-name-ar "منظمة التمرين (اصطناعية)"
    --admin-name "Drill administrator (synthetic)" --admin-issuer "http://127.0.0.1:$P_IDP/realms/mth-test" --admin-subject drill-bootstrap-admin)
  DATABASE_OWNER_URL="$own" NODE_ENV=production MTHDB "${b[@]}"
  if DATABASE_OWNER_URL="$own" NODE_ENV=production MTHDB "${b[@]}"; then echo "a second bootstrap did not refuse"; return 1; fi
  "$PGBIN/psql" -X -q -d "$(su_url "$WORK/pgT" "$P_PG_T")" -c "DROP DATABASE mth_init WITH (FORCE)"
  echo "D4: migrate 0, bootstrap 0, second bootstrap refused; database dropped"
}
step D4 "mth-db migrate && mth-db bootstrap (twice; the second must refuse) on a separate clean database" d4
[ -f "$WORK/pgT.pid" ] && PG_T_PID="$(cat "$WORK/pgT.pid")" || true

# ---- D5: import into the empty target and reconcile -----------------------------------------------------------------------
t_owner() { cat "$SECS/mth_owner_url"; }
# reconcile <label>: tools/migration/reconcile.mjs on the target; its output and exit go to reconcile-<label>.json
# (`equal` is true only for exit 0, `reconcile-migration: matched`).
reconcile() {
  local rc=0
  (cd "$SRC" && DATABASE_OWNER_URL="$(t_owner)" NODE_ENV=production \
    node tools/migration/reconcile.mjs --operator "$OPERATOR") >"$WORK/reconcile-$1.txt" 2>&1 || rc=$?
  cat "$WORK/reconcile-$1.txt"
  node -e 'const [f, out, label, rc] = process.argv.slice(1); const text = require("node:fs").readFileSync(f, "utf8");
    require("node:fs").writeFileSync(out, JSON.stringify({ step: label, command: "node tools/migration/reconcile.mjs --operator <name>",
      exit: Number(rc), equal: Number(rc) === 0, output: text.trim().split("\n") }, null, 2) + "\n");' \
    "$WORK/reconcile-$1.txt" "$OUT/reconcile-$1.json" "$1" "$rc"
  return "$rc"
}
d5() {
  make_db "$WORK/pgT" "$P_PG_T" mth "$SECS"
  DATABASE_OWNER_URL="$(t_owner)" NODE_ENV=production MTHDB migrate
  (cd "$SRC" && DATABASE_OWNER_URL="$(t_owner)" DATABASE_URL="$(cat "$SECS/mth_app_url")" NODE_ENV=production \
    EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$WORK/evidence-T" \
    node tools/migration/import.mjs --from "$PKG" --operator "$OPERATOR" \
    --manifest-sha256 "$(sha256sum "$PKG/manifest.json" | cut -d' ' -f1)")
  reconcile D5
}
step D5 "mth-db migrate && node tools/migration/import.mjs --from <package> --operator '$OPERATOR' --manifest-sha256 <hex> && node tools/migration/reconcile.mjs --operator '$OPERATOR'" d5

# ---- D6: identity rebind -------------------------------------------------------------------------------------------------
UNBOUND_SUB=""
d6() {
  local su; su="$(su_url "$WORK/pgT" "$P_PG_T" mth)"
  # Every carried user is mapped to the drill IdP with a synthetic subject, except the last one (left unbound).
  "$PGBIN/psql" -X -qAt -F, -d "$su" -c "select u.id, coalesce(u.email, '') from app_user u
     join identity_binding_hold h on h.user_id = u.id and h.state = 'unbound' order by u.id" >"$WORK/carried.csv"
  [ -s "$WORK/carried.csv" ] || { echo "no carried user waits for a rebind"; return 1; }
  node -e '
    const fs = require("node:fs"); const [csv, issuer, map, users, unbound] = process.argv.slice(1);
    const rows = fs.readFileSync(csv, "utf8").trim().split("\n").map((l) => l.split(","));
    const keep = rows.slice(0, -1), left = rows.at(-1);
    fs.writeFileSync(map, "user_id,action,new_issuer,new_subject\n" + keep.map(([id]) => `${id},rebind,${issuer},drill-${id}`).join("\n") + "\n");
    fs.writeFileSync(users, JSON.stringify(rows.map(([id, email]) => ({ sub: "drill-" + id, ...(email ? { email } : {}), name: "Drill user (synthetic)" }))));
    fs.writeFileSync(unbound, left[0]);' \
    "$WORK/carried.csv" "http://127.0.0.1:$P_IDP/realms/mth-test" "$WORK/mapping.csv" "$WORK/idp-users.json" "$WORK/unbound.id"
  echo "mapping sha256 $(sha256sum "$WORK/mapping.csv" | cut -d' ' -f1)"
  DATABASE_OWNER_URL="$(t_owner)" NODE_ENV=production MTHDB rebind-identity --mapping "$WORK/mapping.csv" --operator "$OPERATOR"
}
step D6 "mth-db rebind-identity --mapping <mapping.csv> --operator '$OPERATOR' (one carried user left unmapped)" d6

# ---- D7: start T ---------------------------------------------------------------------------------------------------
start_target() {
  node "$REPO/deploy/scripts/drill/fake-idp-server.mjs" --port "$P_IDP" --users "$WORK/idp-users.json" \
    --client-secret-file "$SECS/oidc_client_secret" --redirect-uri "$ORIGIN_T/api/v1/auth/callback" >"$OUT/idp.json" 2>>"$OUT/idp.log" &
  IDP_PID=$!
  start_api "${T_ENV[@]}"; start_worker "${T_ENV[@]}"
  echo "$IDP_PID $API_PID $WORKER_PID" >"$WORK/T.pids"
}
d7() {
  local t0; t0="$(clock)"
  start_target
  for _ in $(seq 1 480); do
    body="$(curl -s "http://127.0.0.1:$P_API_T/readyz" || true)"
    echo "$body" | grep -q '"storage":"ok"' && echo "$body" | grep -q '"worker":"alive"' && break
    sleep 0.25
  done
  echo "readyz $body" | tee "$OUT/readyz-D7.json"
  echo "$body" | grep -q '"status":"ready"' && echo "$body" | grep -q '"worker":"alive"' || return 1
  echo "D7: ready in $(secs "$t0" "$(clock)") s"
}
step D7 "start the drill IdP, the API and the worker from the runtime tree with target.env; GET /readyz until 200, storage ok, worker alive (120 s)" d7
[ -f "$WORK/T.pids" ] && read -r IDP_PID API_PID WORKER_PID <"$WORK/T.pids" || true

# ---- D8: the journey under the new origin ---------------------------------------------------------------------------
downloads() {
  local su; su="$(su_url "$WORK/pgT" "$P_PG_T" mth)"
  [ -f "$PKG/attachments.json" ] || { echo "[]" >"$WORK/downloads.json"; return 0; }
  "$PGBIN/psql" -X -qAt -F, -d "$su" -c "select id, transformation_id from evidence" >"$WORK/evidence.csv"
  node -e '
    const fs = require("node:fs"); const [att, csv, out] = process.argv.slice(1);
    const tr = new Map(fs.readFileSync(csv, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(",")));
    const items = JSON.parse(fs.readFileSync(att, "utf8")).items.filter((i) => i.parentTable === "evidence");
    fs.writeFileSync(out, JSON.stringify(items.map((i) => ({ path: `/api/v1/transformations/${tr.get(i.parentId)}/evidence/${i.parentId}/content`, sha256: i.sha256 }))));' \
    "$PKG/attachments.json" "$WORK/evidence.csv" "$WORK/downloads.json"
}
d8() {
  downloads
  node "$REPO/deploy/scripts/drill/journey.mjs" --mode oidc-drill --app "$ORIGIN_T" \
    --user "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].sub)' "$WORK/idp-users.json")" \
    --unbound-user "drill-$(cat "$WORK/unbound.id")" --source-origin "$ORIGIN_S" --downloads "$WORK/downloads.json" \
    --out "$OUT/journey-D8.json"
}
step D8 "node deploy/scripts/drill/journey.mjs --mode oidc-drill --app $ORIGIN_T --source-origin $ORIGIN_S (signin, unbound, csrf, writes, downloads, deeplink)" d8

# ---- D9: full restart --------------------------------------------------------------------------------------------------
d9() {
  stop_pid "$API_PID"; stop_pid "$WORKER_PID"; stop_pid "$PG_T_PID"
  PG_T_PID="$(pg_start "$WORK/pgT" "$P_PG_T")"
  echo "$PG_T_PID" >"$WORK/pgT.pid"
  start_api "${T_ENV[@]}"; start_worker "${T_ENV[@]}"
  echo "$IDP_PID $API_PID $WORKER_PID" >"$WORK/T.pids"
  wait_http "http://127.0.0.1:$P_API_T/readyz" 120 '^200$'
  reconcile D9
  node "$REPO/deploy/scripts/drill/journey.mjs" --mode oidc-drill --app "$ORIGIN_T" --steps signin,downloads \
    --user "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].sub)' "$WORK/idp-users.json")" \
    --downloads "$WORK/downloads.json" --out "$OUT/journey-D9.json"
}
step D9 "stop API, worker, PostgreSQL; start all three; node tools/migration/reconcile.mjs; downloads again; /readyz 200" d9
[ -f "$WORK/pgT.pid" ] && PG_T_PID="$(cat "$WORK/pgT.pid")" || true
[ -f "$WORK/T.pids" ] && read -r IDP_PID API_PID WORKER_PID <"$WORK/T.pids" || true

# ---- D10: old-origin scan ---------------------------------------------------------------------------------------------
d10() {
  PGBIN="$PGBIN" node "$REPO/deploy/scripts/drill/origin-scan.mjs" --database-url "$(su_url "$WORK/pgT" "$P_PG_T" mth)" \
    --origin "$ORIGIN_S" --out "$OUT/origin-scan.json"
}
step D10 "node deploy/scripts/drill/origin-scan.mjs --database-url <target superuser> --origin $ORIGIN_S" d10

# ---- D11: the report ------------------------------------------------------------------------------------------------
TOTAL="$(secs "$T_ALL" "$(clock)")"
record D11 "write transfer-drill-report.json" 0 0 "$([ -z "$FAILED" ] && echo PASS || echo NOT_RUN)" "report written"
node -e '
  const fs = require("node:fs"), crypto = require("node:crypto");
  const [out, sha, src, tgt, label, total, manifest, attachments, mapping] = process.argv.slice(1);
  const digest = (f) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };
  const steps = fs.readFileSync(out + "/steps.ndjson", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let tables = null, files = null;
  try { tables = JSON.parse(fs.readFileSync(manifest, "utf8")).tables.length; } catch {}
  try { files = JSON.parse(fs.readFileSync(attachments, "utf8")).items.length; } catch {}
  const pass = steps.length === 12 && steps.every((s) => s.result === "PASS");
  const report = {
    schemaVersion: "mth-transfer-drill/1",
    mode: "container-free, inside one bwrap --unshare-net namespace (agent sandbox; ADR-0069 §7 split)",
    archive: { sha256: sha },
    sourceOrigin: src, targetOrigin: tgt,
    idp: { label },
    checksums: { manifest: digest(manifest), attachmentManifest: digest(attachments), mapping: digest(mapping) },
    totals: { tables, evidenceFiles: files, seconds: Number(total) },
    steps,
    note: "SYNTHETIC data and credentials. A local drill is not evidence of high-availability production readiness; it approves nothing.",
    result: pass ? "PASS" : "FAIL",
  };
  fs.writeFileSync(out + "/transfer-drill-report.json", JSON.stringify(report, null, 2) + "\n");
  if (pass)
    console.log(`transfer-drill: PASS in ${total} s: ${tables} tables and ${files} evidence files equal, origin ${tgt}, restart verified; report ${out}/transfer-drill-report.json`);
  else console.log(`transfer-drill: FAIL: ${steps.filter((s) => s.result !== "PASS").map((s) => s.id + " " + s.result).join(", ")}; report ${out}/transfer-drill-report.json`);
  process.exitCode = pass ? 0 : 1;
' "$OUT" "$SHA" "$ORIGIN_S" "$ORIGIN_T" "$IDP_LABEL" "$TOTAL" "$PKG/manifest.json" "$PKG/attachments.json" "$WORK/mapping.csv"
