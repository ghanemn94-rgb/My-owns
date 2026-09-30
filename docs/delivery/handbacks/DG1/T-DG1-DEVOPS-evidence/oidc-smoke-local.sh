#!/usr/bin/env bash
# TEST-ONLY reproduction (T-DG1-DEVOPS evidence): the OIDC path of deploy/scripts/smoke.mjs against the real API,
# with fake-idp.mjs standing in for the Keycloak test realm (no container runtime available in the build sandbox).
#
#   oidc-smoke-local.sh <built workspace (apps/*/dist, packages/*/dist, node_modules)> <postgres superuser URL>
#
# Differences from the Compose run, stated plainly: plain-http issuer (so NODE_ENV=development, which the config
# loader requires for an http issuer), fake IdP instead of Keycloak, local PostgreSQL 16 instead of the postgres:18
# image, no container isolation.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
WS="$(cd "$1" && pwd)"
ADMIN_URL="$2"
W="$(mktemp -d "${TMPDIR:-/tmp}/mth-oidc-smoke.XXXXXX")"
IDP_PORT=18080
API_PORT=3200
DB=mth_oidc_$(date +%s)
PIDS=()
trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$W"' EXIT

openssl rand -hex 24 >"$W/client_secret"
openssl rand -hex 24 >"$W/user_password"
psql "$ADMIN_URL" -qAt -v ON_ERROR_STOP=1 \
  -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END\$\$" \
  -c "CREATE DATABASE $DB OWNER mth_owner"
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];u.searchParams.set("options","-c role="+process.argv[3]);console.log(u.href.replace(/\+/g,"%20"))' "$ADMIN_URL" "$DB" "$1"; }
role_url mth_owner >"$W/owner_url"
role_url mth_app >"$W/app_url"

ISSUER="http://127.0.0.1:$IDP_PORT/realms/mth-test"
node "$HERE/fake-idp.mjs" --port "$IDP_PORT" --client-secret-file "$W/client_secret" --password-file "$W/user_password" \
  --user smoke.admin=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001 --user smoke.office=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0002 \
  >"$W/idp.log" 2>&1 &
PIDS+=($!)

MTH=(sh "$REPO/deploy/docker/entrypoint.sh")
COMMON=(MTH_APP_ROOT="$WS" PATH="$PATH" NODE_ENV=development AUTH_MODE=oidc APP_BASE_URL="http://localhost:$API_PORT"
  PORT="$API_PORT" DATABASE_URL_FILE="$W/app_url" DATABASE_OWNER_URL_FILE="$W/owner_url" LOG_LEVEL=warn
  OIDC_ISSUER_URL="$ISSUER" OIDC_CLIENT_ID=mth-hub OIDC_CLIENT_SECRET_FILE="$W/client_secret"
  EVIDENCE_STORAGE_PATH="$W/evidence")
env -i "${COMMON[@]}" "${MTH[@]}" migrate | tail -1
env -i "${COMMON[@]}" "${MTH[@]}" db bootstrap --org-code MTH-OIDC --org-name-en "OIDC smoke org (synthetic)" \
  --org-name-ar "مؤسسة اختبار (اصطناعية)" --admin-name "Synthetic Access Admin" --admin-email smoke.admin@example.invalid \
  --admin-issuer "$ISSUER" --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001 | grep -E 'bootstrapped|adminUserId'
( exec env -i "${COMMON[@]}" "${MTH[@]}" api ) >"$W/api.log" 2>&1 &
PIDS+=($!)
( exec env -i "${COMMON[@]}" "${MTH[@]}" worker ) >"$W/worker.log" 2>&1 &
PIDS+=($!)

env -i PATH="$PATH" MTH_SMOKE_API_URL="http://127.0.0.1:$API_PORT" APP_BASE_URL="http://localhost:$API_PORT" \
  MTH_SMOKE_AUTH=oidc MTH_SMOKE_ISSUER_URL="$ISSUER" MTH_SMOKE_PASSWORD_FILE="$W/user_password" MTH_SMOKE_TIMEOUT_S=60 \
  node "$REPO/deploy/scripts/smoke.mjs" | tee "$W/smoke.out"
grep -q '"smoke":"PASS"' "$W/smoke.out" || { echo "---- api.log"; tail -40 "$W/api.log"; exit 1; }
for _ in $(seq 1 40); do
  n=$(psql "$(cat "$W/owner_url")" -qAtc "select count(*) from processed_message") && [ "$n" -ge 1 ] && break; sleep 0.5
done
echo "worker ledger rows: $n"
psql "$(cat "$W/owner_url")" -qAt -F ' ' -c "select 'user_identity', issuer, subject from user_identity order by created_at" \
  -c "select 'audit', action, count(*) from audit_event group by action order by action"
psql "$ADMIN_URL" -qc "DROP DATABASE $DB WITH (FORCE)" >/dev/null 2>&1 || true
