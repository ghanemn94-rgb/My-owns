#!/usr/bin/env bash
# Local clean start WITHOUT containers (A18 first case, REQ-S19-010; docs/operations/clean-start.md §B).
# For hosts where Docker is unavailable, and as the container-free half of the evidence. It uses the SAME pieces as the
# image and Compose: deploy/scripts/assemble-runtime.sh (image layout), deploy/docker/entrypoint.sh (the `mth`
# command), deploy/compose/db-init/10-mth-roles.sh (roles + database) and deploy/scripts/smoke.mjs (journey).
#
#   deploy/scripts/clean-start-local.sh [--include-worktree] [--keep] [--work DIR] [--log FILE]
#
#   --include-worktree  overlay uncommitted (tracked-modified and untracked, non-ignored) files onto the fresh clone
#                       (pre-commit verification); without it the clone is exactly HEAD
#   --keep              keep the work directory (cluster, clone, runtime tree) for inspection
# Environment:
#   PGBIN              PostgreSQL server binaries (default: newest /usr/lib/postgresql/*/bin)
#   MTH_PNPM_STORE     pnpm store to install from (--store-dir); MTH_PNPM_OFFLINE=1 adds --offline (no network)
#   MTH_LOCAL_PG_PORT  default 54340;  MTH_LOCAL_PORT (API) default 3100
#
# Phase A: production semantics (NODE_ENV=production, AUTH_MODE=oidc) from the assembled runtime tree:
#          status/migrate/idempotent re-run, health + readiness, SPA served, dev login absent, seed-dev refused,
#          AUTH_MODE=dev refused in production, IdP outage does not crash the API, first-organization bootstrap.
# Phase B: first-case journey on a second fresh database with SYNTHETIC dev users (AUTH_MODE=dev; the only mode that
#          needs no IdP): smoke.mjs admin/office flow + the worker consuming the transformation.created event.
# Every step is timed; the script exits non-zero on the first failure. Nothing here needs network access except the
# dependency install when MTH_PNPM_OFFLINE is not set.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INCLUDE_WT=0
KEEP=0
WORK=""
LOG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --include-worktree) INCLUDE_WT=1 ;;
    --keep) KEEP=1 ;;
    --work) WORK="$2"; shift ;;
    --log) LOG="$2"; shift ;;
    *) echo "usage: $0 [--include-worktree] [--keep] [--work DIR] [--log FILE]" >&2; exit 64 ;;
  esac
  shift
done
WORK="${WORK:-$(mktemp -d "${TMPDIR:-/tmp}/mth-clean-start.XXXXXX")}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
chmod 0755 "$WORK"
LOG="${LOG:-$WORK/clean-start.log}"
exec > >(tee "$LOG") 2>&1

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PG_PORT="${MTH_LOCAL_PG_PORT:-54340}"
API_PORT="${MTH_LOCAL_PORT:-3100}"
PG_PID=""
API_PID=""
WORKER_PID=""
T_START=$(date +%s.%N)

as_pg() { if [ "$(id -u)" = "0" ]; then unshare --user --map-user=1000 --map-group=1000 "$@"; else "$@"; fi; }
stop() { for p in "$@"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; sleep 1; }
cleanup() {
  stop "$API_PID" "$WORKER_PID"
  [ -n "$PG_PID" ] && kill "$PG_PID" 2>/dev/null || true
  sleep 1
  if [ "$KEEP" = 0 ]; then rm -rf "$WORK/src" "$WORK/app" "$WORK/pg" "$WORK/secrets"; fi
}
trap cleanup EXIT

STEP_T=0
begin() { STEP_T=$(date +%s.%N); echo; echo "==> $*"; }
end() { printf '<== ok (%.2f s)\n' "$(echo "$(date +%s.%N) - $STEP_T" | bc)"; }
die() { echo "FAIL: $*"; exit 1; }
expect_exit() { # expect_exit <code> <description> <command...>
  local want="$1" what="$2"; shift 2
  set +e; "$@"; local got=$?; set -e
  [ "$got" = "$want" ] || die "$what: exit $got, expected $want"
  echo "  $what: exit $got (expected $want)"
}

begin "environment facts"
echo "  date (UTC):  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  host:        $(uname -srm); $(nproc) vCPU; $(free -g | awk '/Mem:/{print $2" GiB RAM"}')"
echo "  node:        $(node --version);  pnpm: $(pnpm --version)"
echo "  postgres:    $("$PGBIN/postgres" --version)"
echo "  repo HEAD:   $(git -C "$REPO" rev-parse HEAD)  (worktree overlay: $INCLUDE_WT)"
echo "  lockfile:    sha256 $(sha256sum "$REPO/pnpm-lock.yaml" | cut -d' ' -f1)"
[ -x "$PGBIN/initdb" ] || die "BLOCKED: PostgreSQL server binaries not found (set PGBIN)"
end

begin "1. fresh clone of the repository"
git clone -q --no-local "$REPO" "$WORK/src"
if [ "$INCLUDE_WT" = 1 ]; then
  (cd "$REPO" && { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u) | while read -r f; do
    case "$f" in trading_agent/*|docs/delivery/runs/*) continue ;; esac
    if [ -f "$REPO/$f" ] && [ ! -L "$REPO/$f" ]; then mkdir -p "$WORK/src/$(dirname "$f")"; cp -p "$REPO/$f" "$WORK/src/$f"
    elif [ ! -e "$REPO/$f" ]; then rm -f "$WORK/src/$f"; fi # (non-regular files, e.g. host mounts, are skipped)
  done
  echo "  overlaid uncommitted files: $(cd "$REPO" && { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | grep -cv '^trading_agent/\|^docs/delivery/runs/' || true)"
fi
end

begin "2. install dependencies from the frozen lockfile (lifecycle scripts disabled; pnpm 10 default)"
INSTALL=(pnpm install --frozen-lockfile)
[ -n "${MTH_PNPM_STORE:-}" ] && INSTALL+=(--store-dir "$MTH_PNPM_STORE")
[ "${MTH_PNPM_OFFLINE:-0}" = 1 ] && INSTALL+=(--offline)
echo "  ${INSTALL[*]}"
(cd "$WORK/src" && CI=true "${INSTALL[@]}" | tail -3)
end

begin "3. build (pnpm -r build)"
(cd "$WORK/src" && pnpm -r build >"$WORK/build.log" 2>&1) || { tail -30 "$WORK/build.log"; die "build failed"; }
echo "  build log: $WORK/build.log"
end

begin "4. assemble the image runtime tree (same script as the Dockerfile)"
STORE_ARGS=()
[ -n "${MTH_PNPM_STORE:-}" ] && STORE_ARGS=(--store-dir "$MTH_PNPM_STORE")
bash "$WORK/src/deploy/scripts/assemble-runtime.sh" "${STORE_ARGS[@]}" "$WORK/src" "$WORK/app"
end

begin "5. disposable PostgreSQL cluster (password auth on TCP) + roles/database via deploy/compose/db-init"
mkdir -p "$WORK/secrets" && chmod 0755 "$WORK/secrets"
rand() { openssl rand -hex 24; }
for s in pg_superuser_password mth_owner_db_password mth_app_db_password; do rand >"$WORK/secrets/$s"; done
chmod 0644 "$WORK/secrets"/*
# UTF8 + C locale whatever the shell locale (T-DG2-BE9; ADR-0003 "Database encoding").
as_pg "$PGBIN/initdb" -D "$WORK/pg" -U postgres --pwfile="$WORK/secrets/pg_superuser_password" \
  --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
as_pg "$PGBIN/postgres" -D "$WORK/pg" -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p "$PG_PORT" \
  -c fsync=off >"$WORK/pg.log" 2>&1 &
PG_PID=$!
export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres PGPASSWORD="$(cat "$WORK/secrets/pg_superuser_password")"
for _ in $(seq 1 60); do psql -d postgres -qAtc "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
psql -d postgres -qAtc "select version()"
POSTGRES_USER=postgres MTH_DB_INIT_SECRETS_DIR="$WORK/secrets" bash "$WORK/src/deploy/compose/db-init/10-mth-roles.sh"
psql -d postgres -v ON_ERROR_STOP=1 \
  -qc "CREATE DATABASE mth_dev OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0" \
  -c "REVOKE ALL ON DATABASE mth_dev FROM PUBLIC" -c "GRANT CONNECT ON DATABASE mth_dev TO mth_app"
unset PGPASSWORD
OWNER_PW="$(cat "$WORK/secrets/mth_owner_db_password")"
APP_PW="$(cat "$WORK/secrets/mth_app_db_password")"
url() { printf 'postgres://%s:%s@127.0.0.1:%s/%s' "$1" "$2" "$PG_PORT" "$3"; }
url mth_owner "$OWNER_PW" mth >"$WORK/secrets/database_owner_url"
url mth_app "$APP_PW" mth >"$WORK/secrets/database_url"
url mth_owner "$OWNER_PW" mth_dev >"$WORK/secrets/dev_database_owner_url"
url mth_app "$APP_PW" mth_dev >"$WORK/secrets/dev_database_url"
openssl rand -hex 24 >"$WORK/secrets/oidc_client_secret"
end

MTH=(sh "$WORK/src/deploy/docker/entrypoint.sh")
export MTH_APP_ROOT="$WORK/app" MTH_HEALTHCHECK="$WORK/src/deploy/docker/healthcheck.mjs"
base_env() {
  env -i PATH="$PATH" HOME="$WORK" MTH_APP_ROOT="$MTH_APP_ROOT" MTH_HEALTHCHECK="$MTH_HEALTHCHECK" PORT="$API_PORT" \
    DEFAULT_TIMEZONE=Asia/Riyadh DEFAULT_CURRENCY=SAR LOG_LEVEL=warn EVIDENCE_STORAGE_PATH="$WORK/evidence" "$@"
}
# spawn <logfile> <env/cmd...>: background process whose PID ($!) IS the service (subshell -> exec env -> exec sh -> exec node)
spawn() { local logf="$1"; shift; ( exec env -i PATH="$PATH" HOME="$WORK" MTH_APP_ROOT="$MTH_APP_ROOT" \
  MTH_HEALTHCHECK="$MTH_HEALTHCHECK" PORT="$API_PORT" DEFAULT_TIMEZONE=Asia/Riyadh DEFAULT_CURRENCY=SAR LOG_LEVEL=warn \
  EVIDENCE_STORAGE_PATH="$WORK/evidence" "$@" ) >"$logf" 2>&1 & }
port_free() { for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/healthz" || return 0; sleep 0.25; done; return 1; }
mkdir -p "$WORK/evidence"
PROD=(NODE_ENV=production AUTH_MODE=oidc APP_BASE_URL="http://localhost:$API_PORT"
  DATABASE_URL_FILE="$WORK/secrets/database_url" DATABASE_OWNER_URL_FILE="$WORK/secrets/database_owner_url"
  OIDC_ISSUER_URL=https://idp.mth-clean-start.invalid/realms/none OIDC_CLIENT_ID=mth-hub
  OIDC_CLIENT_SECRET_FILE="$WORK/secrets/oidc_client_secret")

wait_ready() {
  for _ in $(seq 1 120); do base_env "$@" "${MTH[@]}" health /readyz >/dev/null 2>&1 && return 0; sleep 0.5; done
  return 1
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

begin "A1. mth db status on the empty database reports pending (exit 3)"
expect_exit 3 "mth db status" base_env "${PROD[@]}" "${MTH[@]}" db status
end
begin "A2. mth migrate (fresh database), then again (idempotent)"
base_env "${PROD[@]}" "${MTH[@]}" migrate
base_env "${PROD[@]}" "${MTH[@]}" migrate | tail -1
expect_exit 0 "mth db status" base_env "${PROD[@]}" "${MTH[@]}" db status
end
begin "A3. production refusals: seed-dev not in the image; AUTH_MODE=dev refused with NODE_ENV=production"
expect_exit 64 "mth db seed-dev" base_env "${PROD[@]}" "${MTH[@]}" db seed-dev
expect_exit 78 "mth api with AUTH_MODE=dev" base_env "${PROD[@]}" AUTH_MODE=dev "${MTH[@]}" api
end
begin "A4. start api + worker (production, OIDC) and wait for readiness"
port_free || die "port $API_PORT is already in use"
spawn "$WORK/api-prod.log" "${PROD[@]}" "${MTH[@]}" api
API_PID=$!
spawn "$WORK/worker-prod.log" "${PROD[@]}" "${MTH[@]}" worker
WORKER_PID=$!
wait_ready "${PROD[@]}" || { tail -30 "$WORK/api-prod.log"; die "API not ready"; }
echo "  /healthz: $(curl -s "http://127.0.0.1:$API_PORT/healthz")"
echo "  /readyz:  $(curl -s "http://127.0.0.1:$API_PORT/readyz")"
end
begin "A5. production surface: SPA served, dev login absent (404), IdP outage -> login redirects with an error, no crash"
[ "$(code "http://127.0.0.1:$API_PORT/")" = 200 ] || die "SPA index not served"
curl -s "http://127.0.0.1:$API_PORT/" | grep -qi '<html' || die "SPA index is not HTML"
echo "  GET / -> 200 text/html"
c=$(code -X POST -H 'content-type: application/json' -H "origin: http://localhost:$API_PORT" \
  -d '{"username":"dev.admin"}' "http://127.0.0.1:$API_PORT/api/v1/auth/dev-login")
[ "$c" = 404 ] || die "dev-login returned $c in production"
echo "  POST /api/v1/auth/dev-login -> 404"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:$API_PORT/api/v1/auth/login")
case "$loc" in *"/login?error=idp_unavailable"*) echo "  GET /api/v1/auth/login -> 302 $loc" ;; *) die "unexpected login redirect: $loc" ;; esac
kill -0 "$API_PID" || die "API died after the IdP outage"
[ "$(code "http://127.0.0.1:$API_PORT/api/v1/me")" = 401 ] || die "/me without a session is not 401"
echo "  GET /api/v1/me (no session) -> 401"
end
begin "A6. first organization + administrator via mth db bootstrap; a second bootstrap is refused"
base_env "${PROD[@]}" "${MTH[@]}" db bootstrap --org-code MTH-LOCAL --org-name-en "Local clean-start org (synthetic)" \
  --org-name-ar "مؤسسة التشغيل المحلي (اصطناعية)" --admin-name "Synthetic Admin" --admin-email admin@example.invalid \
  --admin-issuer https://idp.mth-clean-start.invalid/realms/none --admin-subject synthetic-admin-0001 | tail -8
expect_exit 1 "second bootstrap" base_env "${PROD[@]}" "${MTH[@]}" db bootstrap --org-code MTH-TWO --org-name-en X \
  --org-name-ar X --admin-name X --admin-issuer https://idp.mth-clean-start.invalid/realms/none --admin-subject x
end
stop "$API_PID" "$WORKER_PID"; API_PID=""; WORKER_PID=""
port_free || die "phase A API did not stop"
echo; echo "  phase A api/worker stopped (graceful SIGTERM)"

DEV=(NODE_ENV=development AUTH_MODE=dev APP_BASE_URL="http://localhost:$API_PORT"
  DATABASE_URL_FILE="$WORK/secrets/dev_database_url" DATABASE_OWNER_URL_FILE="$WORK/secrets/dev_database_owner_url")
begin "B1. second fresh database: migrate, then SYNTHETIC dev users (seed-dev from the source tree; never in the image)"
base_env "${DEV[@]}" "${MTH[@]}" migrate | tail -1
base_env "${DEV[@]}" node "$WORK/src/packages/db/dist/cli.js" seed-dev
end
begin "B2. start api + worker (AUTH_MODE=dev) from the runtime tree"
port_free || die "the phase A API is still listening on $API_PORT"
spawn "$WORK/api-dev.log" "${DEV[@]}" "${MTH[@]}" api
API_PID=$!
spawn "$WORK/worker-dev.log" "${DEV[@]}" "${MTH[@]}" worker
WORKER_PID=$!
wait_ready "${DEV[@]}" || { tail -30 "$WORK/api-dev.log"; die "API not ready"; }
end
begin "B3. first-case journey (deploy/scripts/smoke.mjs, dev mode)"
base_env MTH_SMOKE_API_URL="http://127.0.0.1:$API_PORT" APP_BASE_URL="http://localhost:$API_PORT" MTH_SMOKE_AUTH=dev \
  MTH_SMOKE_EXPECT_NO_EGRESS="${MTH_SMOKE_EXPECT_NO_EGRESS:-0}" node "$WORK/src/deploy/scripts/smoke.mjs" | tee "$WORK/smoke.out"
grep -q '"smoke":"PASS"' "$WORK/smoke.out" || die "smoke failed"
TR_ID="$(sed -n 's/.*"transformationId":"\([0-9a-f-]*\)".*/\1/p' "$WORK/smoke.out")"
end
begin "B4. the worker relays and consumes transformation.created (outbox published, ledger row written)"
DEV_OWNER="$(cat "$WORK/secrets/dev_database_owner_url")"
for _ in $(seq 1 60); do
  n=$(psql "$DEV_OWNER" -qAtc "select count(*) from processed_message pm join outbox_event o using (idempotency_key)
        where o.aggregate_id = '$TR_ID' and o.published_at is not null" 2>/dev/null || echo 0)
  [ "${n:-0}" -ge 1 ] && break; sleep 0.5
done
psql "$DEV_OWNER" -qAt -F ' | ' \
  -c "select 'outbox', event_type, idempotency_key, published_at is not null as published from outbox_event where aggregate_id = '$TR_ID'" \
  -c "select 'ledger', consumer, idempotency_key, outcome from processed_message where idempotency_key like '%$TR_ID%'"
[ "${n:-0}" -ge 1 ] || die "worker did not process the event within 30 s"
end
begin "B5. record counts (database mth_dev)"
psql "$DEV_OWNER" -qAt -F ' ' -c "select 'organization', count(*) from organization union all select 'business_unit', count(*) from business_unit
  union all select 'app_user', count(*) from app_user union all select 'scoped_assignment', count(*) from scoped_assignment
  union all select 'transformation', count(*) from transformation union all select 'audit_event', count(*) from audit_event
  union all select 'outbox_event', count(*) from outbox_event union all select 'processed_message', count(*) from processed_message
  union all select 'schema_migration', count(*) from schema_migration"
end

printf '\nCLEAN START: PASS (total %.1f s; work dir %s; log %s)\n' "$(echo "$(date +%s.%N) - $T_START" | bc)" "$WORK" "$LOG"
