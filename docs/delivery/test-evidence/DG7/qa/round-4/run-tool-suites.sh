#!/usr/bin/env bash
# qa-verifier DG7 round 4: node:test tool suites in the disposable clone ($QA_REPO).
set -u; cd "${QA_REPO:?}"; E="${QA_E:?}"; export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p "$TMPDIR/pnpm-store"; [ -d "$TMPDIR/pnpm-store/v10" ] || cp -a /root/.local/share/pnpm/store/v10 "$TMPDIR/pnpm-store/v10"
run() { local name="$1"; shift; echo "\$ $*"; s=$(date +%s); "$@" > "$E/08-$name.log" 2>&1; rc=$?; grep -E "^ℹ (tests|pass|fail|cancelled|skipped|todo)" "$E/08-$name.log" | tr '\n' ' '; echo; grep -E "^✖|^not ok" "$E/08-$name.log" | head -5; echo "exit=$rc ($(( $(date +%s)-s ))s)"; }
run migration-api-scripts env QA_PG_PORT=32540 MTH_PORT_POOL=32541-32549 tests/qa/support/with-pg.sh bash -c 'node --test tools/migration/tests/*.test.mjs apps/api/scripts/*.test.mjs'
run deploy-scripts env QA_PG_PORT=32550 MTH_PORT_POOL=32551-32559 tests/qa/support/with-pg.sh bash -c 'node --test deploy/scripts/tests/*.test.mjs'
run release-licenses env MTH_PNPM_STORE=$TMPDIR/pnpm-store bash -c 'node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs'
rm -rf "$TMPDIR/pnpm-store"
