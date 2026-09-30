#!/usr/bin/env bash
# qa-verifier A18 (REQ-S20-018 first case; REQ-S19-004/005/010): CLEAN START from the documented commands.
#
# Independent of deploy/scripts/clean-start-local.sh (devops' runner): it follows docs/operations/clean-start.md and
# the package start commands directly and asserts the acceptance criterion:
#   a fresh checkout builds, migrates a FRESH database, starts (api + worker, production configuration) and serves
#   /healthz and /readyz.
# Plus negative/reliability cases: readiness is NOT ready on an unmigrated database (503), a re-run of the migration is
# a no-op, the API restarts cleanly against the migrated database, and the SPA is served with Arabic RTL by default.
#
#   e2e/clean-start/a18-clean-start.sh [--commit REV] [--install] [--log FILE]
#
#   --commit REV  what to check out (default HEAD of this repository)
#   --install     run the documented `pnpm install --frozen-lockfile --offline` in the fresh checkout (needs a
#                 populated pnpm store). WITHOUT it, the candidate's already-installed node_modules are copied into
#                 the fresh checkout and the install step is reported as NOT RUN (the DG1 QA assignment forbids
#                 running `pnpm install`).
# Environment: PGBIN, QA_A18_PG_PORT (default 54371), QA_A18_PORT (API, default 3181).
# Exit: 0 PASS, 1 FAIL (first failing assertion), 3 BLOCKED (missing tool).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMIT="HEAD"
INSTALL=0
LOG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift ;;
    --install) INSTALL=1 ;;
    --log) LOG="$2"; shift ;;
    *) echo "usage: $0 [--commit REV] [--install] [--log FILE]" >&2; exit 64 ;;
  esac
  shift
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qa-a18.XXXXXX")"
chmod 755 "$WORK"
[ -n "$LOG" ] && exec > >(tee "$LOG") 2>&1

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${QA_A18_PG_PORT:-54371}"
API_PORT="${QA_A18_PORT:-3181}"
BASE="http://127.0.0.1:${API_PORT}"
PG_PID=""
API_PID=""
WORKER_PID=""
T0=$(date +%s.%N)

stop_pid() { [ -n "${1:-}" ] && kill "$1" 2>/dev/null && wait "$1" 2>/dev/null || true; }
cleanup() {
  stop_pid "$API_PID"
  stop_pid "$WORKER_PID"
  if [ -n "$PG_PID" ]; then
    kill -INT "$PG_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$PG_PID" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$PG_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { echo; echo "==> [$(printf '%6.1f' "$(echo "$(date +%s.%N) - $T0" | bc)") s] $*"; }
fail() { echo "FAIL: $*"; echo "A18 CLEAN START: FAIL"; exit 1; }
blocked() { echo "BLOCKED: $*"; echo "A18 CLEAN START: BLOCKED"; exit 3; }
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS $1: $3"; else fail "$1: expected '$2', got '$3'"; fi
}
http_code() { curl -s -o "$WORK/body" -w '%{http_code}' "$1" || true; }

for tool in git node pnpm psql curl bc; do command -v "$tool" >/dev/null || blocked "$tool not found"; done
[ -x "$PGBIN/initdb" ] || blocked "PostgreSQL server binaries not found (set PGBIN)"

step "environment"
echo "  date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ); node $(node --version); pnpm $(pnpm --version); $("$PGBIN/postgres" --version)"

step "1. fresh checkout of $COMMIT"
REV="$(git -C "$REPO" rev-parse "$COMMIT")"
git clone -q --no-hardlinks "$REPO" "$WORK/src"
git -C "$WORK/src" checkout -q --detach "$REV"
check "checked-out commit" "$REV" "$(git -C "$WORK/src" rev-parse HEAD)"
check "working tree clean" "" "$(git -C "$WORK/src" status --porcelain)"
for d in apps/api/dist apps/web/dist packages/db/dist node_modules; do
  [ -e "$WORK/src/$d" ] && fail "fresh checkout unexpectedly contains $d"
done
echo "  PASS no build output or node_modules in the fresh checkout"

step "2. dependencies"
cd "$WORK/src"
if [ "$INSTALL" = 1 ]; then
  echo "  pnpm install --frozen-lockfile --offline"
  CI=true pnpm install --frozen-lockfile --offline | tail -3 || fail "pnpm install --frozen-lockfile --offline"
else
  echo "  NOT RUN: pnpm install (forbidden by the DG1 QA assignment). Copying the candidate's installed node_modules,"
  echo "  which were installed from the same committed pnpm-lock.yaml."
  git -C "$REPO" diff --quiet "$REV" -- pnpm-lock.yaml || fail "candidate lockfile differs from $REV; cannot reuse its node_modules"
  cp -a "$REPO/node_modules" node_modules
  for pj in $(git ls-files '*/package.json'); do
    d="$(dirname "$pj")"
    [ -d "$REPO/$d/node_modules" ] && cp -a "$REPO/$d/node_modules" "$d/node_modules"
  done
fi

step "3. build (documented: pnpm -r build)"
pnpm -r build >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; fail "pnpm -r build"; }
tail -2 "$WORK/build.log"
for f in apps/api/dist/main.js apps/worker/dist/main.js packages/db/dist/cli.js apps/web/dist/index.html; do
  [ -f "$f" ] || fail "build output $f missing"
done
echo "  PASS build outputs present"

step "4. fresh PostgreSQL, roles and empty database (docs/operations: mth_owner owns, mth_app runtime)"
if [ "$(id -u)" = "0" ]; then AS_PG=(unshare --user --map-user=1000 --map-group=1000); else AS_PG=(); fi
"${AS_PG[@]}" "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust >/dev/null
"${AS_PG[@]}" "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 \
  -p "$PG_PORT" -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
ADMIN="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
for _ in $(seq 1 60); do psql "$ADMIN" -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql "$ADMIN" -qAtc "select 1" >/dev/null || blocked "PostgreSQL did not start: $(tail -3 "$WORK/pg.log")"
psql "$ADMIN" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner LOGIN" -c "CREATE ROLE mth_app LOGIN" \
  -c "CREATE DATABASE mth OWNER mth_owner" -c "CREATE DATABASE mth_empty OWNER mth_owner"
OWNER_URL="postgresql://mth_owner@127.0.0.1:${PG_PORT}/mth"
APP_URL="postgresql://mth_app@127.0.0.1:${PG_PORT}/mth"
EMPTY_APP_URL="postgresql://mth_app@127.0.0.1:${PG_PORT}/mth_empty"

step "5. migrate the fresh database (documented: mth-db status / migrate)"
set +e
DATABASE_OWNER_URL="$OWNER_URL" NODE_ENV=production node packages/db/dist/cli.js status >"$WORK/s1" 2>&1; S1=$?
DATABASE_OWNER_URL="$OWNER_URL" NODE_ENV=production node packages/db/dist/cli.js migrate >"$WORK/m1" 2>&1; M1=$?
DATABASE_OWNER_URL="$OWNER_URL" NODE_ENV=production node packages/db/dist/cli.js migrate >"$WORK/m2" 2>&1; M2=$?
DATABASE_OWNER_URL="$OWNER_URL" NODE_ENV=production node packages/db/dist/cli.js status >"$WORK/s2" 2>&1; S2=$?
set -e
cat "$WORK/s1" "$WORK/m1" "$WORK/m2" "$WORK/s2" | sed 's/^/  | /'
check "status on the empty database (3 = pending)" 3 "$S1"
check "migrate exit" 0 "$M1"
check "second migrate exit (no-op)" 0 "$M2"
grep -q "applying" "$WORK/m2" && fail "second migrate re-applied a migration"
check "status after migrate (0 = up to date)" 0 "$S2"
check "applied migrations recorded = migration files" "$(ls packages/db/migrations/*.sql | wc -l | tr -d ' ')" \
  "$(psql "postgresql://postgres@127.0.0.1:${PG_PORT}/mth" -qAtc "select count(*) from schema_migration")"

step "6. start api + worker in PRODUCTION configuration (AUTH_MODE=oidc; IdP not reachable offline)"
mkdir -p "$WORK/secrets" "$WORK/evidence"
chmod 700 "$WORK/secrets" "$WORK/evidence"
printf '%s' "qa-a18-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" >"$WORK/secrets/oidc_client_secret"
start_api() { # start_api <database-url>
  env -i PATH="$PATH" HOME="$WORK" NODE_ENV=production AUTH_MODE=oidc PORT="$API_PORT" APP_BASE_URL="https://hub.example.invalid" \
    DATABASE_URL="$1" OIDC_ISSUER_URL="https://idp.example.invalid/realms/qa" OIDC_CLIENT_ID=mth-hub \
    OIDC_CLIENT_SECRET_FILE="$WORK/secrets/oidc_client_secret" EVIDENCE_STORAGE_PATH="$WORK/evidence" \
    node apps/api/dist/main.js >>"$WORK/api.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do
    [ "$(http_code "$BASE/healthz")" = 200 ] && return 0
    kill -0 "$API_PID" 2>/dev/null || { tail -20 "$WORK/api.log"; fail "api exited during startup"; }
    sleep 0.25
  done
  tail -20 "$WORK/api.log"
  fail "api did not answer /healthz"
}
start_api "$APP_URL"
env -i PATH="$PATH" HOME="$WORK" NODE_ENV=production DATABASE_URL="$APP_URL" EVIDENCE_STORAGE_PATH="$WORK/evidence" \
  node apps/worker/dist/main.js >"$WORK/worker.log" 2>&1 &
WORKER_PID=$!

step "7. health and readiness"
check "GET /healthz status" 200 "$(http_code "$BASE/healthz")"
echo "  body: $(cat "$WORK/body")"
check "healthz body" ok "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$WORK/body")"
check "GET /readyz status" 200 "$(http_code "$BASE/readyz")"
echo "  body: $(cat "$WORK/body")"
check "readyz body" "ready/ok/ok" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log([b.status,b.checks&&b.checks.database,b.checks&&b.checks.migrations].join("/"))' "$WORK/body")"
check "GET / serves the SPA" 200 "$(http_code "$BASE/")"
grep -q 'lang="ar"' "$WORK/body" && grep -q 'dir="rtl"' "$WORK/body" || fail "SPA index is not Arabic RTL by default"
echo "  PASS SPA index has lang=\"ar\" dir=\"rtl\""
check "dev login absent in production (404)" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"username":"dev.admin"}' "$BASE/api/v1/auth/dev-login")"
check "GET /api/v1/me without a session" 401 "$(http_code "$BASE/api/v1/me")"
sleep 2
kill -0 "$WORKER_PID" 2>/dev/null || { cat "$WORK/worker.log"; fail "worker exited"; }
echo "  PASS worker running (pid alive after 2 s)"

step "8. restart: the API comes back ready against the same database"
stop_pid "$API_PID"; API_PID=""
start_api "$APP_URL"
check "GET /readyz after restart" 200 "$(http_code "$BASE/readyz")"

step "9. negative: an UNMIGRATED database is live but not ready"
stop_pid "$API_PID"; API_PID=""
start_api "$EMPTY_APP_URL"
check "GET /healthz (liveness) on an unmigrated database" 200 "$(http_code "$BASE/healthz")"
check "GET /readyz on an unmigrated database" 503 "$(http_code "$BASE/readyz")"
echo "  body: $(cat "$WORK/body")"
stop_pid "$API_PID"; API_PID=""

step "done"
echo "A18 CLEAN START: PASS (commit $REV; install step: $([ "$INSTALL" = 1 ] && echo 'pnpm install --frozen-lockfile --offline' || echo 'NOT RUN, candidate node_modules reused'); total $(printf '%.1f' "$(echo "$(date +%s.%N) - $T0" | bc)") s)"
