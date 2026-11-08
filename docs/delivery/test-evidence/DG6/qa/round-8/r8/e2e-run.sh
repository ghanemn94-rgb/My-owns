#!/usr/bin/env bash
# usage: e2e-run.sh <label> <locale:unset|C.UTF-8> <pgport> <apiport> <project> <spec...>
set -u
label=$1; loc=$2; pg=$3; apiport=$4; proj=$5; shift 5
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-8/r8
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
if [ "$loc" = unset ]; then unset LANG LC_ALL; else export LANG=$loc LC_ALL=$loc; fi
mkdir -p $TMPDIR/shots/$label
export E2E_SCREENSHOT_DIR=$TMPDIR/shots/$label MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
cd $TMPDIR/c
{ echo "## $(date -u +%FT%TZ) node $(node -v) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset} E2E_SCREENSHOT_DIR=\$TMPDIR/shots/$label load $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "## cmd: E2E_PG_PORT=$pg E2E_API_PORT=$apiport MTH_PORT_POOL=30700-30799 ${HARNESS:-apps/web/e2e/support/with-stack.sh} npx playwright test --workers=1 --project=$proj --trace=off --output=$TMPDIR/tr-$label $*"
  E2E_PG_PORT=$pg E2E_API_PORT=$apiport MTH_PORT_POOL=30700-30799 ${HARNESS:-apps/web/e2e/support/with-stack.sh} npx playwright test --workers=1 --project=$proj --reporter=list --trace=off --output=$TMPDIR/tr-$label "$@"
  echo "exit=$?"; echo "## end $(date -u +%FT%TZ)"; } > $E/$label.log 2>&1
