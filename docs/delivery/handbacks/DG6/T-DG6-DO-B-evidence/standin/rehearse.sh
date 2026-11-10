#!/usr/bin/env bash
# TEST-ONLY REHEARSAL (T-DG6-DO-B evidence): runs e2e/identity/keycloak-login.spec.ts UNCHANGED against the real,
# built API (AUTH_MODE=oidc) serving the built SPA, with standin-idp.mjs IN PLACE OF KEYCLOAK (no container runtime
# here). It proves the spec's mechanics and the hub's refusal of another realm's response; it is NOT the Keycloak e2e
# and NOT the REQ-S16-007 acceptance proof, which needs the pinned Keycloak image (Compose profile test-idp).
#
#   QA_PG_PORT=26251 MTH_PORT_POOL=26252-26259 tests/qa/support/with-pg.sh \
#     docs/delivery/handbacks/DG6/T-DG6-DO-B-evidence/standin/rehearse.sh
#
# Differences from the Compose run, stated plainly: stand-in IdP instead of Keycloak; plain-http issuer (so
# NODE_ENV=development, which the config loader requires for an http issuer); local PostgreSQL instead of postgres:18;
# no containers. Ports 26261 (API) and 26262 (IdP). Every user and secret is SYNTHETIC and generated per run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../../../.." && pwd)"
: "${TEST_DATABASE_ADMIN_URL:?run through tests/qa/support/with-pg.sh}"
API_PORT="${REHEARSE_API_PORT:-26261}"
IDP_PORT="${REHEARSE_IDP_PORT:-26262}"
W="$(mktemp -d "${TMPDIR:-/tmp}/dob-rehearse.XXXXXX")"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$W"
}
trap cleanup EXIT
cd "$REPO"

openssl rand -hex 24 >"$W/client_secret"
openssl rand -hex 24 >"$W/user_password"
DB=mth_dob_rehearse
psql "$TEST_DATABASE_ADMIN_URL" -qAt -v ON_ERROR_STOP=1 \
  -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END\$\$" \
  -c "CREATE DATABASE $DB OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
role_url() { node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];u.searchParams.set("options","-c role="+process.argv[3]);console.log(u.toString().replace(/\+/g,"%20"))' "$TEST_DATABASE_ADMIN_URL" "$DB" "$1"; }
role_url mth_owner >"$W/owner_url"
role_url mth_app >"$W/app_url"

ISSUER="http://127.0.0.1:$IDP_PORT/realms/mth-test"
node "$HERE/standin-idp.mjs" --port "$IDP_PORT" --client-secret-file "$W/client_secret" \
  --password-file "$W/user_password" --user smoke.admin=5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001 >"$W/idp.log" 2>&1 &
PIDS+=($!)

COMMON=(PATH="$PATH" NODE_ENV=development AUTH_MODE=oidc APP_BASE_URL="http://localhost:$API_PORT" PORT="$API_PORT"
  DATABASE_URL_FILE="$W/app_url" DATABASE_OWNER_URL_FILE="$W/owner_url" LOG_LEVEL=warn
  OIDC_ISSUER_URL="$ISSUER" OIDC_CLIENT_ID=mth-hub OIDC_CLIENT_SECRET_FILE="$W/client_secret"
  EVIDENCE_STORAGE_DRIVER=filesystem EVIDENCE_STORAGE_PATH="$W/evidence" AUTH_RATE_LIMIT_PER_MINUTE=1000)
env -i "${COMMON[@]}" node packages/db/dist/cli.js migrate | tail -1
env -i "${COMMON[@]}" node packages/db/dist/cli.js bootstrap --org-code MTH-DOB --org-name-en "DO-B rehearsal org (synthetic)" \
  --org-name-ar "مؤسسة تجربة (اصطناعية)" --admin-name "Synthetic Access Admin" --admin-email smoke.admin@example.invalid \
  --admin-issuer "$ISSUER" --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001 | grep -E 'bootstrapped|adminUserId'
(exec env -i "${COMMON[@]}" node apps/api/dist/main.js) >"$W/api.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do curl -fsS "http://localhost:$API_PORT/readyz" >/dev/null 2>&1 && break; sleep 0.5; done
echo "readyz: $(curl -fsS "http://localhost:$API_PORT/readyz")"
echo "idp:    $(curl -fsS "$ISSUER/.well-known/openid-configuration" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).issuer))')"
echo "load before: $(cut -d' ' -f1-3 /proc/loadavg)"

set +e
START=$(date +%s%N)
env MTH_E2E_KEYCLOAK=1 MTH_E2E_KEYCLOAK_PASSWORD_FILE="$W/user_password" \
  MTH_E2E_KEYCLOAK_URL="http://127.0.0.1:$IDP_PORT" MTH_E2E_KEYCLOAK_HOST_PORT="$IDP_PORT" \
  E2E_BASE_URL="http://localhost:$API_PORT" PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}" \
  pnpm exec playwright test e2e/identity/keycloak-login.spec.ts --reporter=list --workers=1 --output "$W/pw-out"
STATUS=$?
set -e
# Keep only the page snapshots of failures (no traces: a trace would record the typed synthetic password).
if [ "$STATUS" != 0 ]; then
  mkdir -p "$HERE/failure-context"
  find "$W/pw-out" -name error-context.md | while read -r f; do cp "$f" "$HERE/failure-context/$(basename "$(dirname "$f")").md"; done
fi
echo "playwright exit=$STATUS wall=$((($(date +%s%N) - START) / 1000000)) ms; load after: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "---- audit and identities (database $DB)"
psql "$(cat "$W/owner_url")" -qAt -F ' ' \
  -c "select 'user_identity', issuer, subject from user_identity order by created_at" \
  -c "select 'audit', action, count(*) from audit_event where action like 'session.%' group by action order by action" \
  -c "select 'session_rows', count(*) from session"
[ "$STATUS" = 0 ] || { echo "---- api.log (tail)"; tail -30 "$W/api.log"; echo "---- idp.log"; tail -10 "$W/idp.log"; }
exit "$STATUS"
