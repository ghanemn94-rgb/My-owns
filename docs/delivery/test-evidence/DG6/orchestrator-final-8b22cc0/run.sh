#!/bin/bash
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
L=/tmp/claude-0/-home-user-My-owns/f7dd9c0b-2b3c-52aa-bca7-45299008f27d/scratchpad/dg6/V3
cd /home/user/wt/verify
step(){ n=$1; shift; echo "### $(date -u +%FT%TZ) $*" > $L/$n.log; "$@" >> $L/$n.log 2>&1; e=$?; echo "EXIT $e $(date -u +%FT%TZ)" >> $L/$n.log; echo "$n $e" >> $L/summary.txt; }
step 00-install pnpm install --frozen-lockfile
step 01-build pnpm -r build
step 02-typecheck pnpm -r typecheck
step 03-lint pnpm lint
step 04-format bash -c "git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown"
step 05-openapi pnpm openapi:lint
step 06-unit-unset env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test
step 07-unit-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
step 08-integration env QA_PG_PORT=29200 MTH_PORT_POOL=29201-29249 tests/qa/support/with-pg.sh pnpm test:integration
touch $L/done
