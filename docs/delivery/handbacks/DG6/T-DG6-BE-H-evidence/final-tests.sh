#!/usr/bin/env bash
cd /home/user/wt/dg6-be-h
E=docs/delivery/handbacks/DG6/T-DG6-BE-H-evidence
run() { local name=$1; shift; { echo "\$ $*"; date -u; } > $E/$name.log; "$@" >> $E/$name.log 2>&1; local s=$?; { date -u; echo "EXIT=$s"; } >> $E/$name.log; }
run test-locale-unset-final env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test
run integration-final env QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration
run test-c-utf8-final env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
