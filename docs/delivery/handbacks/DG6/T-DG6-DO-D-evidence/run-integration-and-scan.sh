#!/usr/bin/env bash
# Integration suite + post-suite log scan (T-DG6-DO-D). Canary DB password embedded in the admin URL (trust auth
# ignores it; every role URL of the suite carries it).
set -o pipefail
cd /home/user/wt/dg6-do-d
E=docs/delivery/handbacks/DG6/T-DG6-DO-D-evidence
export MTH_TEST_LOG_DIR="$TMPDIR/mth-test-logs"
rm -rf "$MTH_TEST_LOG_DIR"; mkdir -p "$MTH_TEST_LOG_DIR"
export MTH_CANARY_OIDC_CLIENT_SECRET=mth-canary-oidc-client-secret S3_ACCESS_KEY_ID=mth-canary-s3-access-key \
       S3_SECRET_ACCESS_KEY=mth-canary-s3-secret-key SMTP_PASSWORD=mth-canary-smtp-password
start=$(date +%s); echo "start $(date -u)"
QA_PG_PORT=24310 MTH_PORT_POOL=24311-24349 tests/qa/support/with-pg.sh bash -c '
  export TEST_DATABASE_ADMIN_URL="${TEST_DATABASE_ADMIN_URL/postgres@/postgres:mth-canary-db-password@}"
  echo "admin url has canary: $([[ $TEST_DATABASE_ADMIN_URL == *mth-canary-db-password@* ]] && echo yes || echo no)"
  pnpm test:integration' 2>&1 | tee "$MTH_TEST_LOG_DIR/integration-output.log" > "$TMPDIR/integration-full.log"
echo "integration exit=$? seconds=$(( $(date +%s) - start ))"
node deploy/scripts/log-scan.mjs --require-canaries --canary mth-canary-db-password --storage-path "$TMPDIR/mth-evidence-it-" "$MTH_TEST_LOG_DIR" > "$TMPDIR/log-scan.out" 2>&1
echo "log-scan exit=$?"
ls -la "$MTH_TEST_LOG_DIR" | head; du -sh "$MTH_TEST_LOG_DIR"
echo "end $(date -u)"
