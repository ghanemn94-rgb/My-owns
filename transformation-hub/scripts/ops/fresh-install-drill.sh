#!/usr/bin/env bash
# =====================================================================================================================
# FRESH INSTALL + PRIVATE MODE + BACKUP/RESTORE DRILL (P7 exit, AT-22, AT-23) — DEV/TEST ONLY, no Docker needed.
#
#   bash scripts/ops/fresh-install-drill.sh            # full drill; report in .dev/fresh-install/<ts>/report.txt
#   HUB_DRILL_KEEP=1 bash scripts/ops/fresh-install-drill.sh   # keep the throwaway cluster data and secrets
#
# What it proves, in ONE run (every step is a PASS/FAIL line of the report):
#   1. Fresh install from scratch on a NEW, EMPTY PostgreSQL 16 cluster created for the drill (unix socket only, no TCP
#      listener, roles with passwords generated at run time): `migrate` and the PRODUCTION `bootstrap` through the
#      container entrypoint — no demo data, one IdP-bound administrator.
#   2. Private mode, AI Off, egress BLOCKED: API, worker (and the PDF browser it launches) and the web server run with
#      NODE_ENV=production inside a network namespace whose only interface is loopback, every process traced with
#      strace (connect/sendto/sendmsg). Enterprise services are local stand-ins: OIDC IdP and S3-compatible storage over
#      HTTPS with a throwaway custom CA (trusted through NODE_EXTRA_CA_CERTS only), an HTTPS ingress in front of web/API.
#   3. Journey: users provisioned, two projects, stored files, evidence accepted by a second person, a PDF export
#      rendered by the worker's offline browser, two-project isolation (lists, detail, files, search, cross-links),
#      AI off (status, refusal, deterministic detections).
#   4. Encrypted backup (age) with work in flight (queued export job, undispatched outbox) → decrypt + restore into a
#      NEW database (timed) → the restored system: sessions revoked, permissions, files, approval evidence, audit
#      hash chain, isolation, AI off; no completed job re-run, held work stays held until released after review.
#   5. Egress verdict over the strace logs of both runs: 0 external connection attempts, 0 DNS lookups.
#
# Requirements: Linux with network namespaces (root, or passwordless sudo), strace, openssl, age, python3 or `ip`,
# PostgreSQL 16 server binaries (initdb/pg_ctl — HUB_DRILL_PGBIN), the client tools, built packages + API
# (pnpm build:packages && pnpm --filter @hub/api run build), a production web build (pnpm --filter @hub/web build) and
# Chromium for the PDF export (Playwright's, or HUB_CHROMIUM_PATH).
# Nothing leaves the machine: the namespace has no route out, and every stand-in listens on loopback inside it.
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DRILL="$ROOT/scripts/ops/drill"
API_PORT=4610 WORKER_HB_MAX=120000 WEB_PORT=3610 INGRESS_PORT=4643 IDP_PORT=4644 S3_PORT=4645
SRC_DB=hub_fresh DST_DB=hub_fresh_restored

now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", b - a }'; }
step() { echo; echo "=== $* ($(date -u +%H:%M:%SZ))"; }
die() { echo "drill: ERROR: $*" >&2; exit 1; }

# =====================================================================================================================
# INNER PART — runs inside the network namespace (re-invoked by the outer part below)
# =====================================================================================================================
if [ "${1:-}" = "--inner" ]; then
  WORK="$2"
  # shellcheck disable=SC1091
  set -a; . "$WORK/drill.env"; . "$WORK/secrets.env"; set +a
  RUN="$WORK/run"; mkdir -p "$RUN"
  # No proxy inside the namespace: the drill driver and the stand-ins talk to loopback only (the app processes get a
  # clean environment anyway — `env -i` below).
  unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy ALL_PROXY all_proxy NO_PROXY no_proxy NODE_USE_ENV_PROXY NODE_OPTIONS
  export NODE_EXTRA_CA_CERTS="$WORK/pki/ca.crt"
  RC=0
  verdict() { if [ "$2" = PASS ]; then printf 'PASS  %-64s %s\n' "$1" "$3"; else printf 'FAIL  %-64s %s\n' "$1" "$3"; RC=1; fi; }
  ifaces="$(awk -F: 'NR > 2 { gsub(/ /, "", $1); print $1 }' /proc/net/dev | tr '\n' ' ')"
  [ "$ifaces" = "lo " ] && verdict "egress blocked: network namespace has loopback only" PASS "interfaces: $ifaces" \
                        || verdict "egress blocked: network namespace has loopback only" FAIL "interfaces: $ifaces"
  [ "$RC" = 0 ] || exit 1

  owner_url() { echo "postgres://hub_owner:${OWNER_PW}@/$1?host=${PGSOCK}"; }
  app_url() { echo "postgres://hub_app:${APP_PW}@/$1?host=${PGSOCK}"; }
  journey() { # journey <phase> <db>
    local db="$2"
    node "$DRILL/journey.mjs" "$1" "$RUN/journey-$db.json" "$WORK/state.json"
  }
  write_journey_cfg() { # <db>
    cat >"$RUN/journey-$1.json" <<EOF
{ "ingress": "https://127.0.0.1:$INGRESS_PORT", "idp": "https://127.0.0.1:$IDP_PORT", "ownerUrl": "$(owner_url "$1")",
  "orgSlug": "$ORG_SLUG", "admin": { "sub": "$ADMIN_SUB", "email": "$ADMIN_EMAIL" }, "workerSettleMs": 8000, "chromium": "$CHROMIUM" }
EOF
  }
  app_env() { # app_env <db> — production configuration of api/worker, private mode, AI off
    cat <<EOF
NODE_ENV=production
HUB_MODE=standard
HUB_ORG_SLUG=$ORG_SLUG
PORT=$API_PORT
DATABASE_URL=$(app_url "$1")
DATABASE_POOL_MAX=10
HUB_COOKIE_SECURE=true
HUB_TRUST_PROXY=true
HUB_STORAGE_DRIVER=s3
HUB_S3_ENDPOINT=https://127.0.0.1:$S3_PORT
HUB_S3_BUCKET=hub-drill
HUB_S3_REGION=us-east-1
HUB_S3_ACCESS_KEY_ID=$S3_KEY
HUB_S3_SECRET_ACCESS_KEY=$S3_SECRET
HUB_S3_SSE=AES256
HUB_ALLOW_UNSCANNED_FILES=true
HUB_OIDC_ISSUER=https://127.0.0.1:$IDP_PORT
HUB_OIDC_CLIENT_ID=hub-drill
HUB_OIDC_CLIENT_SECRET=$OIDC_SECRET
HUB_OIDC_REDIRECT_URI=https://127.0.0.1:$INGRESS_PORT/api/v1/auth/oidc/callback
HUB_OIDC_LINK_BY_EMAIL=true
HUB_OIDC_LINK_BY_EMAIL_ACK=accept-idp-verified-email-first-login-binding
HUB_COOKIE_SECRET=$COOKIE_SECRET
HUB_AI_ALLOW_MOCK=false
HUB_PRIVATE_MODE=true
HUB_EGRESS_ALLOWLIST=127.0.0.1
HUB_CHROMIUM_PATH=$CHROMIUM
HUB_WORKER_ID=drill-worker
HUB_WORKER_HEARTBEAT_FILE=$RUN/worker.heartbeat
HUB_WORKER_HEARTBEAT_MAX_AGE_MS=$WORKER_HB_MAX
HUB_LOG_LEVEL=info
NODE_EXTRA_CA_CERTS=$WORK/pki/ca.crt
NEXT_TELEMETRY_DISABLED=1
EOF
  }
  # Start a traced process: `strace -D` keeps the tracee's PID as $! so it is stopped by its own PID.
  traced() { # traced <label> <logtag> <cmd…>   (env from $RUN/<label>.env — one VAR=value per line, no spaces)
    local label="$1" tag="$2"; shift 2
    # shellcheck disable=SC2046
    env -i PATH="$PATH" HOME="$HOME" $(cat "$RUN/$label.env") \
      strace -D -f -qq -e trace=connect,sendto,sendmsg,sendmmsg,execve -e signal=none -o "$RUN/strace-$tag-$label.log" "$@" \
      >"$RUN/$tag-$label.log" 2>&1 &
    echo "$!" >"$RUN/$tag-$label.pid"
  }
  wait_http() { # wait_http <url> <seconds>
    for _ in $(seq 1 "$2"); do curl -skf --noproxy '*' -o /dev/null "$1" && return 0; sleep 1; done
    return 1
  }
  stop_pid() { local p; p="$(cat "$RUN/$1.pid" 2>/dev/null || true)"; [ -n "$p" ] && kill "$p" 2>/dev/null && for _ in $(seq 1 30); do kill -0 "$p" 2>/dev/null || return 0; sleep 0.5; done; [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; }
  start_stack() { # start_stack <db> <s3dir> <tag>
    local db="$1" s3dir="$2" tag="$3"
    cat >"$RUN/stand-ins-$tag.json" <<EOF
{ "tls": { "key": "$WORK/pki/server.key", "cert": "$WORK/pki/server.crt" },
  "idp": { "port": $IDP_PORT, "clientId": "hub-drill", "clientSecret": "$OIDC_SECRET" },
  "s3": { "port": $S3_PORT, "dir": "$s3dir", "bucket": "hub-drill", "accessKeyId": "$S3_KEY", "secretAccessKey": "$S3_SECRET", "region": "us-east-1" },
  "ingress": { "port": $INGRESS_PORT, "api": "http://127.0.0.1:$API_PORT", "web": "http://127.0.0.1:$WEB_PORT" },
  "readyFile": "$RUN/stand-ins-$tag.ready" }
EOF
    node "$DRILL/stand-ins.mjs" "$RUN/stand-ins-$tag.json" >"$RUN/$tag-stand-ins.log" 2>&1 &
    echo "$!" >"$RUN/$tag-stand-ins.pid"
    for _ in $(seq 1 30); do [ -f "$RUN/stand-ins-$tag.ready" ] && break; sleep 0.5; done
    [ -f "$RUN/stand-ins-$tag.ready" ] || { cat "$RUN/$tag-stand-ins.log"; return 1; }
    app_env "$db" >"$RUN/api.env"
    app_env "$db" >"$RUN/worker.env"
    printf 'NODE_ENV=production\nNEXT_TELEMETRY_DISABLED=1\nHOSTNAME=127.0.0.1\nPORT=%s\n' "$WEB_PORT" >"$RUN/web.env"
    traced api "$tag" node "$ROOT/deploy/docker/api-entrypoint.cjs" api
    traced worker "$tag" node "$ROOT/deploy/docker/api-entrypoint.cjs" worker
    (cd "$ROOT/apps/web" && traced web "$tag" node "$ROOT/apps/web/node_modules/next/dist/bin/next" start -p "$WEB_PORT" -H 127.0.0.1)
    wait_http "http://127.0.0.1:$API_PORT/readyz" 90 || { tail -30 "$RUN/$tag-api.log"; return 1; }
    wait_http "http://127.0.0.1:$WEB_PORT/login" 90 || { tail -30 "$RUN/$tag-web.log"; return 1; }
    for _ in $(seq 1 60); do [ -f "$RUN/worker.heartbeat" ] && break; sleep 1; done
    [ -f "$RUN/worker.heartbeat" ] || { tail -30 "$RUN/$tag-worker.log"; return 1; }
  }
  stop_stack() { # stop_stack <tag>
    for p in worker api web stand-ins; do stop_pid "$1-$p"; done
    rm -f "$RUN/worker.heartbeat"
  }
  # On any exit: stop every process this drill started (by the PIDs it recorded).
  # (`|| true`: under `set -e` a failed kill of an already-stopped process would change the exit status.)
  trap 'for f in "$RUN"/*.pid; do kill "$(cat "$f" 2>/dev/null)" 2>/dev/null || true; done' EXIT

  # ---------------------------------------------------------------------------------------------------- 1. install
  step "1. fresh install: migrate + production bootstrap (container entrypoint), database $SRC_DB"
  T=$(now)
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production DATABASE_MIGRATION_URL="$(owner_url "$SRC_DB")" \
    node "$ROOT/deploy/docker/api-entrypoint.cjs" migrate >"$RUN/migrate.log" 2>&1 || { cat "$RUN/migrate.log"; exit 1; }
  MIGRATE_S=$(elapsed "$T" "$(now)")
  T=$(now)
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production DATABASE_MIGRATION_URL="$(owner_url "$SRC_DB")" HUB_ORG_NAME="DRILL organization (synthetic)" \
    HUB_ORG_SLUG="$ORG_SLUG" HUB_BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" HUB_BOOTSTRAP_ADMIN_NAME="DRILL first administrator (synthetic)" \
    HUB_BOOTSTRAP_ADMIN_OIDC_ISSUER="https://127.0.0.1:$IDP_PORT" HUB_BOOTSTRAP_ADMIN_OIDC_SUBJECT="$ADMIN_SUB" \
    node "$ROOT/deploy/docker/api-entrypoint.cjs" bootstrap >"$RUN/bootstrap.log" 2>&1 || { cat "$RUN/bootstrap.log"; exit 1; }
  BOOTSTRAP_S=$(elapsed "$T" "$(now)")
  grep -h 'organization\|templates\|schedules\|administrator\|migrat' "$RUN/bootstrap.log" | sed 's/^/  /' | head -8
  echo "migrate ${MIGRATE_S}s; bootstrap ${BOOTSTRAP_S}s"
  write_journey_cfg "$SRC_DB"
  write_journey_cfg "$DST_DB"
  journey install "$SRC_DB" || RC=1

  # -------------------------------------------------------------------------------------- 2. private-mode journey
  step "2. start api + worker + web (NODE_ENV=production, private mode, AI off) traced, behind the HTTPS ingress"
  start_stack "$SRC_DB" "$WORK/s3-src" run || { verdict "stack starts (fresh install)" FAIL "see $RUN/run-*.log"; exit 1; }
  verdict "stack starts on the fresh install (api readyz, web, worker heartbeat)" PASS "api :$API_PORT web :$WEB_PORT ingress :$INGRESS_PORT"
  step "3. journey: users, two projects, files, approval evidence, PDF export, isolation, AI off"
  # journey exit status: 1 = a check failed (continue, the drill fails at the end); 3 = the journey broke off (stop)
  set +e; journey run "$SRC_DB"; JRC=$?; set -e
  [ "$JRC" = 3 ] && { verdict "journey run" FAIL "stopping: later steps depend on it"; exit 1; }
  [ "$JRC" = 0 ] || RC=1

  step "4. stop the worker; queue work that must not be redelivered blindly after a restore"
  stop_pid run-worker
  set +e; journey inflight "$SRC_DB"; JRC=$?; set -e
  [ "$JRC" = 3 ] && { verdict "journey inflight" FAIL "stopping"; exit 1; }
  [ "$JRC" = 0 ] || RC=1

  step "5. encrypted backup (age), online, with the API still running"
  T=$(now)
  DATABASE_BACKUP_URL="$(owner_url "$SRC_DB")" bash "$ROOT/scripts/ops/backup.sh" --out "$WORK/backup" \
    --objects-dir "$WORK/s3-src" --config "$WORK/config/values-drill.yaml" --label fresh-install-drill \
    --encrypt-age "$(cat "$WORK/pki/backup-recipient.txt")" >"$RUN/backup.log" 2>&1 || { cat "$RUN/backup.log"; exit 1; }
  BACKUP_S=$(elapsed "$T" "$(now)")
  tail -3 "$RUN/backup.log" | sed 's/^/  /'
  if [ -f "$WORK/backup/backup.tar.age" ] && [ ! -e "$WORK/backup/db.dump" ] && ! find "$WORK/backup" -name 'db.dump' | grep -q .; then
    verdict "backup encrypted (age): only the archive, its checksum and the manifest" PASS "$(cd "$WORK/backup" && ls | tr '\n' ' ')"
  else verdict "backup encrypted (age): only the archive, its checksum and the manifest" FAIL "$(cd "$WORK/backup" && ls | tr '\n' ' ')"; fi
  stop_stack run

  # ------------------------------------------------------------------------------------------------- 6. restore
  step "6. decrypt + restore into the NEW database $DST_DB (timed: start → verified)"
  T=$(now)
  DATABASE_RESTORE_URL="$(owner_url "$DST_DB")" HUB_RESTORE_STAGING_DIR="$WORK" bash "$ROOT/scripts/ops/restore.sh" --from "$WORK/backup" \
    --age-identity "$WORK/pki/backup-identity.txt" --objects-dir "$WORK/s3-dst" --verify-app-url "$(app_url "$DST_DB")" \
    --report "$WORK/restore-report.txt" --yes >"$RUN/restore.log" 2>&1 || { cat "$RUN/restore.log"; verdict "restore.sh" FAIL "see $WORK/restore-report.txt"; exit 1; }
  RESTORE_S=$(elapsed "$T" "$(now)")
  sed -n '/^Measured durations/,/^RESULT/p' "$WORK/restore-report.txt" | sed 's/^/  /'
  verdict "restore.sh into a new database: every check passed" PASS "wall time ${RESTORE_S}s"

  # ------------------------------------------------------------------------------------------ 7. restored system
  step "7. start the stack on the RESTORED database (worker included) and verify"
  start_stack "$DST_DB" "$WORK/s3-dst" verify || { verdict "stack starts (restored)" FAIL "see $RUN/verify-*.log"; exit 1; }
  journey verify "$DST_DB" || RC=1
  step "8. release the reviewed held job (restore.sh --release-held) — it runs exactly once"
  HELD="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK/state.json','utf8')).heldExportJobId || '')")"
  DATABASE_RESTORE_URL="$(owner_url "$DST_DB")" bash "$ROOT/scripts/ops/restore.sh" --release-held --job-ids "$HELD" | sed 's/^/  /'
  journey released "$DST_DB" || RC=1
  stop_stack verify

  # -------------------------------------------------------------------------------------------- 9. egress verdict
  step "9. private-mode egress verdict (strace of every application process, both runs)"
  # The worker launched the PDF browser (Chromium) under the same trace in both runs (export before the backup; the
  # released export after the restore).
  node "$DRILL/egress-report.mjs" --require-local api-run,worker-run,api-verify,worker-verify \
    --require-exec "worker-run:$(basename "$CHROMIUM"),worker-verify:$(basename "$CHROMIUM")" \
    api-run="$RUN/strace-run-api.log" worker-run="$RUN/strace-run-worker.log" web-run="$RUN/strace-run-web.log" \
    api-verify="$RUN/strace-verify-api.log" worker-verify="$RUN/strace-verify-worker.log" web-verify="$RUN/strace-verify-web.log" || RC=1
  cat >"$WORK/timings.env" <<EOF
MIGRATE_S=$MIGRATE_S
BOOTSTRAP_S=$BOOTSTRAP_S
BACKUP_S=$BACKUP_S
RESTORE_S=$RESTORE_S
EOF
  exit "$RC"
fi

# =====================================================================================================================
# OUTER PART — preflight, PKI, throwaway PostgreSQL cluster, then the namespace
# =====================================================================================================================
TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${HUB_DRILL_DIR:-$ROOT/.dev/fresh-install}/$TS"
mkdir -p "$WORK"
chmod 755 "$WORK"
REPORT="$WORK/report.txt"
exec > >(tee -a "$REPORT") 2>&1
echo "Transformation Hub fresh-install drill $TS"
echo "host: $(uname -srm); $(nproc) vCPU; $(free -g | awk '/Mem:/ { print $2 }') GiB RAM; node $(node --version); $(psql --version)"

for t in node openssl strace unshare psql pg_dump pg_restore curl age; do command -v "$t" >/dev/null || die "required tool missing: $t"; done
PGBIN="${HUB_DRILL_PGBIN:-$(pg_config --bindir 2>/dev/null || true)}"
[ -x "$PGBIN/initdb" ] || PGBIN=/usr/lib/postgresql/16/bin
[ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/pg_ctl" ] || die "PostgreSQL 16 server binaries (initdb, pg_ctl) not found; set HUB_DRILL_PGBIN"
"$PGBIN/postgres" --version | grep -q ' 16\.' || die "PostgreSQL 16 server required ($("$PGBIN/postgres" --version))"
[ -f "$ROOT/apps/api/dist/main.js" ] && [ -f "$ROOT/packages/db/dist/index.js" ] || die "build first: pnpm build:packages && pnpm --filter @hub/api run build"
[ -f "$ROOT/apps/web/.next/BUILD_ID" ] || die "web production build missing: HUB_API_URL=http://127.0.0.1:$API_PORT pnpm --filter @hub/web build"
CHROMIUM="${HUB_CHROMIUM_PATH:-$(cd "$ROOT/apps/api" && node -e "try { process.stdout.write(require('playwright-core').chromium.executablePath()) } catch {}")}"
[ -x "$CHROMIUM" ] || die "Chromium not found (PDF export); install Playwright's chromium or set HUB_CHROMIUM_PATH"
if [ "$(id -u)" = 0 ]; then NS_MODE=root; elif sudo -n true 2>/dev/null; then NS_MODE=sudo; else die "network namespaces need root or passwordless sudo"; fi

step "0. throwaway PKI (custom CA), secrets generated at run time, backup key pair"
mkdir -p "$WORK/pki" "$WORK/config" "$WORK/s3-src"
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 -subj "/CN=DRILL throwaway CA (synthetic)" \
  -keyout "$WORK/pki/ca.key" -out "$WORK/pki/ca.crt" 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=127.0.0.1" -keyout "$WORK/pki/server.key" -out "$WORK/pki/server.csr" 2>/dev/null
printf 'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n' >"$WORK/pki/server.ext"
openssl x509 -req -in "$WORK/pki/server.csr" -CA "$WORK/pki/ca.crt" -CAkey "$WORK/pki/ca.key" -CAcreateserial -days 2 \
  -extfile "$WORK/pki/server.ext" -out "$WORK/pki/server.crt" 2>/dev/null
age-keygen -o "$WORK/pki/backup-identity.txt" 2>/dev/null
age-keygen -y "$WORK/pki/backup-identity.txt" >"$WORK/pki/backup-recipient.txt"
chmod 644 "$WORK/pki/ca.crt" "$WORK/pki/server.crt"
rnd() { openssl rand -hex "$1"; }
cat >"$WORK/secrets.env" <<EOF
PG_SUPER_PW=$(rnd 24)
OWNER_PW=$(rnd 24)
APP_PW=$(rnd 24)
BI_PW=$(rnd 24)
OIDC_SECRET=$(rnd 24)
COOKIE_SECRET=$(openssl rand -base64 48 | tr -d '\n')
S3_KEY=drill$(rnd 8)
S3_SECRET=$(rnd 24)
EOF
umask 022
# shellcheck disable=SC1091
set -a; . "$WORK/secrets.env"; set +a
PGSOCK="$(mktemp -d "${TMPDIR:-/tmp}/hubdrill.XXXXXX")"   # short path: unix socket paths are limited to 107 bytes
chmod 755 "$PGSOCK"
cat >"$WORK/drill.env" <<EOF
PGSOCK=$PGSOCK
ORG_SLUG=drill
ADMIN_EMAIL=drill.admin@example.invalid
ADMIN_SUB=drill-admin-$(rnd 6)
CHROMIUM=$CHROMIUM
DRILL=$DRILL
EOF
cat >"$WORK/config/values-drill.yaml" <<'EOF'
# Non-secret deployed configuration captured with the backup (Secrets are referenced by NAME only).
app: { nodeEnv: production, mode: standard, privateMode: true, egressAllowlist: [127.0.0.1] }
ai: { mode: "off", allowMock: false }
storage: { driver: s3, s3: { bucket: hub-drill, sse: AES256, credentialsSecret: { name: hub-object-storage } } }
database: { runtimeSecret: { name: hub-db-runtime }, migrationSecret: { name: hub-db-migration } }
EOF
echo "CA: $(openssl x509 -in "$WORK/pki/ca.crt" -noout -subject | sed 's/subject=//'); server SAN: IP:127.0.0.1"

step "0b. throwaway PostgreSQL 16 cluster (unix socket only, no TCP listener), roles and databases"
PGUSER_OS="$(id -un)"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && PGUSER_OS=postgres
mkdir -p "$WORK/pg"
[ "$(id -u)" = 0 ] && chown postgres "$WORK/pg" "$PGSOCK"
printf '%s\n' "$PG_SUPER_PW" >"$WORK/pg.pw"
[ "$(id -u)" = 0 ] && chown postgres "$WORK/pg.pw"
chmod 600 "$WORK/pg.pw"
as_pg "$PGBIN/initdb" -D "$WORK/pg/data" -U postgres --pwfile="$WORK/pg.pw" --auth-local=scram-sha-256 --auth-host=reject -E UTF8 --locale=C.UTF-8 >"$WORK/pg-initdb.log" 2>&1 \
  || { cat "$WORK/pg-initdb.log"; die "initdb failed"; }
rm -f "$WORK/pg.pw"
as_pg "$PGBIN/pg_ctl" -D "$WORK/pg/data" -l "$WORK/pg/server.log" -w -t 60 \
  -o "-c listen_addresses='' -c unix_socket_directories='$PGSOCK' -c port=5432 -c max_connections=80 -c shared_buffers=64MB" start >/dev/null
cleanup_pg() {
  as_pg "$PGBIN/pg_ctl" -D "$WORK/pg/data" -m fast -w stop >/dev/null 2>&1 || true
  if [ "${HUB_DRILL_KEEP:-0}" != 1 ]; then rm -rf "$WORK/pg" "$WORK/secrets.env" "$WORK/pki"/*.key "$WORK/pki/backup-identity.txt" "$WORK/s3-src" "$WORK/s3-dst" "$WORK/backup"; fi
  rm -rf "$PGSOCK"
}
trap cleanup_pg EXIT
echo "PostgreSQL $("$PGBIN/postgres" --version | awk '{ print $3 }') on unix socket $PGSOCK (as OS user $PGUSER_OS); TCP listener: none"
PGADMIN_URL="postgres://postgres:${PG_SUPER_PW}@/postgres?host=${PGSOCK}" HUB_OWNER_DB_PASSWORD="$OWNER_PW" HUB_APP_DB_PASSWORD="$APP_PW" \
  HUB_BI_DB_PASSWORD="$BI_PW" HUB_DATABASES="$SRC_DB $DST_DB" bash "$ROOT/scripts/ops/db-init-roles.sh"

step "0c. enter a network namespace with loopback only ($NS_MODE)"
T_ALL=$(now)
set +e
if [ "$NS_MODE" = root ]; then
  unshare -n -- bash -c 'if command -v ip >/dev/null; then ip link set lo up; else python3 "$1"; fi; shift; exec "$@"' \
    bash "$DRILL/lo-up.py" bash "$0" --inner "$WORK"
else
  sudo -n -E env "PATH=$PATH" unshare -n -- bash -c 'if command -v ip >/dev/null; then ip link set lo up; else python3 "$1"; fi; shift; u="$1"; g="$2"; shift 2; exec setpriv --reuid="$u" --regid="$g" --init-groups -- "$@"' \
    bash "$DRILL/lo-up.py" "$(id -u)" "$(id -g)" bash "$0" --inner "$WORK"
fi
RC=$?
set -e
TOTAL_S=$(elapsed "$T_ALL" "$(now)")

step "10. summary"
# shellcheck disable=SC1091
[ -f "$WORK/timings.env" ] && . "$WORK/timings.env"
echo "fresh install: migrate ${MIGRATE_S:-?}s + bootstrap ${BOOTSTRAP_S:-?}s"
echo "encrypted backup (online): ${BACKUP_S:-?}s; restore (decrypt → verified, restore.sh wall time): ${RESTORE_S:-?}s"
echo "drill inside the namespace: ${TOTAL_S}s (exit status $RC)"
PASSES=$(grep -c '^PASS' "$REPORT" || true); FAILS=$(grep -c '^FAIL' "$REPORT" || true)
echo "checks: $PASSES passed, $FAILS failed; artifacts: $WORK"
if [ "$RC" = 0 ] && [ "$FAILS" = 0 ]; then echo "DRILL RESULT: PASS"; exit 0; fi
echo "DRILL RESULT: FAIL"
exit 1
