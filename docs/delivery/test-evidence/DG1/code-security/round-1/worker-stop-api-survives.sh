#!/usr/bin/env bash
# REQ-S16-001 (A13/A22): the API and the worker are two processes of one codebase; stopping the worker does not stop
# the API. Run from a built disposable clone (pnpm -r build) with a disposable PostgreSQL superuser URL in $ADMIN.
set -u
W="$TMPDIR/s16"; rm -rf "$W"; mkdir -p "$W/secrets" "$W/evidence"; chmod 700 "$W/secrets" "$W/evidence"
printf '%s' "review-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$W/secrets/oidc"
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS mth_s16" -c "DO \$\$BEGIN CREATE ROLE mth_owner LOGIN; EXCEPTION WHEN duplicate_object THEN ALTER ROLE mth_owner LOGIN; END\$\$" -c "DO \$\$BEGIN CREATE ROLE mth_app LOGIN; EXCEPTION WHEN duplicate_object THEN ALTER ROLE mth_app LOGIN; END\$\$" -c "CREATE DATABASE mth_s16 OWNER mth_owner"
H="${ADMIN%/postgres}"; H="${H#postgresql://postgres@}"
DATABASE_OWNER_URL="postgresql://mth_owner@$H/mth_s16" NODE_ENV=production node packages/db/dist/cli.js migrate | tail -2
APP="postgresql://mth_app@$H/mth_s16"
env -i PATH="$PATH" HOME="$W" NODE_ENV=production AUTH_MODE=oidc PORT="$API_PORT" APP_BASE_URL="https://hub.example.invalid" DATABASE_URL="$APP" OIDC_ISSUER_URL="https://idp.example.invalid/realms/x" OIDC_CLIENT_ID=mth-hub OIDC_CLIENT_SECRET_FILE="$W/secrets/oidc" EVIDENCE_STORAGE_PATH="$W/evidence" node apps/api/dist/main.js > "$W/api.log" 2>&1 & API=$!
env -i PATH="$PATH" HOME="$W" NODE_ENV=production DATABASE_URL="$APP" EVIDENCE_STORAGE_PATH="$W/evidence" node apps/worker/dist/main.js > "$W/worker.log" 2>&1 & WRK=$!
for _ in $(seq 1 80); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$API_PORT/readyz)" = 200 ] && break; sleep 0.25; done
echo "api pid=$API worker pid=$WRK (separate processes: $([ "$API" != "$WRK" ] && echo yes))"
sleep 2; kill -0 $WRK && echo "worker alive before stop"
echo "readyz before worker stop: $(curl -s -w ' %{http_code}' http://127.0.0.1:$API_PORT/readyz)"
kill -TERM $WRK; wait $WRK; echo "worker exit status after SIGTERM: $?"
sleep 2
kill -0 $API && echo "api process alive after worker stop"
B=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$API_PORT/healthz); R=$(curl -s -w ' %{http_code}' http://127.0.0.1:$API_PORT/readyz)
echo "healthz after worker stop: $B"; echo "readyz after worker stop: $R"
echo "--- worker.log tail"; tail -3 "$W/worker.log"
kill $API; wait $API 2>/dev/null
[ "$B" = 200 ] && [ "${R##* }" = 200 ] && echo "RESULT PASS" && exit 0
echo "RESULT FAIL"; exit 1
