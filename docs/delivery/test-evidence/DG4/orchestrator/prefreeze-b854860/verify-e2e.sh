#!/bin/bash
# Orchestrator e2e verification of a merged commit in the dedicated tree, run first while no agent runs (D-111/D-112). Usage: verify-e2e.sh <outdir> <pgport> <commit>
S=$1; P=$2; C=$3
cd /home/user/wt/verify || exit 1
git checkout -q --detach "$C" || exit 1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p $S
{
echo "commit $(git rev-parse --short HEAD)"
pnpm install --frozen-lockfile --offline > $S/e2e-install.log 2>&1; echo "install $?"
pnpm -r build > $S/e2e-build.log 2>&1; echo "build $?"
echo "e2e start $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"
env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=$((P+50)) E2E_API_PORT=$((P+51)) MTH_PORT_POOL=$((P+52))-$((P+90)) apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 > $S/e2e-unset.log 2>&1; echo "e2e-unset $?"
echo "e2e end $(date -u +%T) load $(cut -d' ' -f1 /proc/loadavg)"
echo DONE
} > $S/e2e-summary.txt 2>&1
