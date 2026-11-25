#!/usr/bin/env bash
# qa-verifier DG7 round 4, wave 1c (rv2, built): root acceptance e2e (e2e/a03…a22, not a02) with the A21 connection log
# for every Node process; MTH_PORT_POOL set from the start (the a21 degradation spec needs it); both Playwright projects
# (chromium-en LTR, chromium-ar RTL), one worker. The A17 webhook signing secret is a random SYNTHETIC value for this run.
set -u
. "$(dirname "$0")/env.sh"
export QA_CLONE="$TMPDIR/rv2"
MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET="qa-synthetic-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET
mapfile -t ROOTSPECS < <(cd "$QA_CLONE" && find e2e -maxdepth 1 -name '*.spec.ts' ! -name 'a02-*' | LC_ALL=C sort)
rm -rf "$TMPDIR/qa-conn"; mkdir -p "$TMPDIR/qa-conn"
export MTH_PORT_POOL=32570-32599 E2E_PG_PORT=32550 E2E_API_PORT=32551 QA_CONNECTION_LOG="$TMPDIR/qa-conn/connection-log.jsonl"
bash $S/run.sh 61-e2e-root e2e/support/a21-connection-log-run.sh npx playwright test --workers=1 --trace=off --reporter=list "${ROOTSPECS[@]}"
[ -f "$QA_CONNECTION_LOG" ] && gzip -c "$QA_CONNECTION_LOG" > "$E/61-e2e-root.connection-log.jsonl.gz"
rm -rf "$TMPDIR/qa-conn"
echo "w1-e2e-root done $(date -u +%FT%TZ)"
