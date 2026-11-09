#!/usr/bin/env bash
# qa-verifier DG6 round 9 e2e wrapper (run 7e2124db). usage: e2e-run.sh <label> <locale:unset|C.UTF-8> <pgport> <apiport> <pool> <project...> -- <spec...>
# HARNESS (default apps/web/e2e/support/with-stack.sh) selects the stack; runs in the disposable clone $TMPDIR/c, --workers=1, --trace=off.
set -u
label=$1; loc=$2; pg=$3; apiport=$4; pool=$5; shift 5
projs=(); while [ "$1" != "--" ]; do projs+=("--project=$1"); shift; done; shift
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-9
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
if [ "$loc" = unset ]; then unset LANG LC_ALL; else export LANG=$loc LC_ALL=$loc; fi
mkdir -p $TMPDIR/shots/$label
export E2E_SCREENSHOT_DIR=$TMPDIR/shots/$label QA_PROBE_OUT=$TMPDIR/shots/$label MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
cd $TMPDIR/c
{ echo "## $(date -u +%FT%TZ) node $(node -v) LANG=${LANG-unset} LC_ALL=${LC_ALL-unset} E2E_SCREENSHOT_DIR=\$TMPDIR/shots/$label load $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "## cmd: E2E_PG_PORT=$pg E2E_API_PORT=$apiport MTH_PORT_POOL=$pool ${HARNESS:-apps/web/e2e/support/with-stack.sh} npx playwright test --workers=1 ${projs[*]} --reporter=list --trace=off --output=\$TMPDIR/tr-$label $*"
  E2E_PG_PORT=$pg E2E_API_PORT=$apiport MTH_PORT_POOL=$pool ${HARNESS:-apps/web/e2e/support/with-stack.sh} npx playwright test --workers=1 "${projs[@]}" --reporter=list --trace=off --output=$TMPDIR/tr-$label "$@"
  echo "exit=$?"; echo "## end $(date -u +%FT%TZ)"; } > $E/$label.log 2>&1
rm -rf $TMPDIR/tr-$label
