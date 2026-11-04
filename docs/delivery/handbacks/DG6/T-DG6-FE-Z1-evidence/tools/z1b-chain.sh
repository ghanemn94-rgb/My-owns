#!/usr/bin/env bash
# T-DG6-FE-Z1B: prettier, pnpm test (locale unset, C.UTF-8) and the integration suite, in sequence, while the loaded
# e2e runs go on. Integration waits for root-runs.sh to free ports 29140-29149. Run from the repository root.
set -u
E="$1"
log() { echo "\$ $* ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; }
until grep -q '^EXIT' "$E/z1b-12-openapi-lint.log" 2>/dev/null; do sleep 20; done
{ log "git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown"; git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown; echo "EXIT $?"; } > "$E/z1b-14-prettier.log" 2>&1
{ log "env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test"; env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE pnpm test; echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; } > "$E/z1b-15-unit-unset.log" 2>&1
{ log "LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test"; LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test; echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; } > "$E/z1b-15-unit-cutf8.log" 2>&1
until grep -q 'demo-cutf8.log:EXIT' "$E/z1b-root-summary.txt" 2>/dev/null; do sleep 20; done
{ log "QA_PG_PORT=29140 MTH_PORT_POOL=29141-29149 tests/qa/support/with-pg.sh pnpm test:integration"; QA_PG_PORT=29140 MTH_PORT_POOL=29141-29149 tests/qa/support/with-pg.sh pnpm test:integration; echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"; } > "$E/z1b-20-integration.log" 2>&1
grep -H '^EXIT' "$E"/z1b-1[45]-*.log "$E"/z1b-20-integration.log
