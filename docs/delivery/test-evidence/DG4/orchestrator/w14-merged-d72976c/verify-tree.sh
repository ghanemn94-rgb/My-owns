#!/bin/bash
# Orchestrator verification of a merged commit in the dedicated tree /home/user/wt/verify (D-111): agent transcripts written under the main tree cannot change this tree. Usage: verify-tree.sh <outdir> <pgport> <e2e:0|1> <commit>
S=$1; P=$2; E2E=$3; C=$4
cd /home/user/wt/verify || exit 1
git checkout -q --detach "$C" || exit 1
echo "verify tree at $(git rev-parse --short HEAD)" > /dev/stderr
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
mkdir -p $S
{
echo "commit $(git rev-parse --short HEAD)"
node tools/gates/validate.mjs --historical --stage DG3 > $S/hist.log 2>&1; echo "hist $?"
pnpm install --frozen-lockfile --offline > $S/install.log 2>&1; echo "install $?"
pnpm -r typecheck > $S/typecheck.log 2>&1; echo "typecheck $?"
pnpm -r build > $S/build.log 2>&1; echo "build $?"
pnpm lint > $S/lint.log 2>&1; echo "lint $?"
pnpm format:check > $S/format.log 2>&1; echo "format $?"
pnpm openapi:lint > $S/openapi.log 2>&1; echo "openapi $?"
pnpm --filter @mth/design-tokens run check:contrast > $S/contrast.log 2>&1; echo "contrast $?"
env -u LANG -u LC_ALL -u LC_CTYPE pnpm test > $S/unit-unset.log 2>&1; echo "unit-unset $?"
LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test > $S/unit-cutf8.log 2>&1; echo "unit-cutf8 $?"
QA_PG_PORT=$P MTH_PORT_POOL=$((P+1))-$((P+40)) tests/qa/support/with-pg.sh pnpm test:integration > $S/integration.log 2>&1; echo "integration $?"
if [ "$E2E" = 1 ]; then
  env -u LANG -u LC_ALL -u LC_CTYPE QA_PG_PORT=$((P+50)) E2E_API_PORT=$((P+51)) MTH_PORT_POOL=$((P+52))-$((P+90)) apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 > $S/e2e-unset.log 2>&1; echo "e2e-unset $?"
fi
echo DONE
} > $S/summary.txt 2>&1
