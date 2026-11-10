#!/usr/bin/env bash
cd /home/user/wt/dg6-be-h
E=docs/delivery/handbacks/DG6/T-DG6-BE-H-evidence
find . -path ./node_modules -prune -o -type d -name .cc-writes -empty -print | grep -v node_modules | xargs -r rmdir
run() { local name=$1; shift; { echo "\$ $*"; date -u; } > $E/$name.log; "$@" >> $E/$name.log 2>&1; local s=$?; { date -u; echo "EXIT=$s"; } >> $E/$name.log; }
run typecheck pnpm -r typecheck
run build pnpm -r build
run lint pnpm lint
{ echo '$ git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown'; git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown; echo "EXIT=$?"; } > $E/prettier.log 2>&1
run openapi-lint pnpm openapi:lint
run test-locale-unset env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test
run test-c-utf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
run integration env QA_PG_PORT=23850 MTH_PORT_POOL=23851-23899 tests/qa/support/with-pg.sh pnpm test:integration
echo ALL-DONE > /var/tmp/mth-run.E8JiEc/claude-0/-home-user-wt-dg6-be-h/0984dcc8-f4d2-4fd9-bd09-7d0444d37cd4/scratchpad/done-marker
