#!/bin/bash
# qa-verifier DG6 RG round 6 (copied from round 5): lean disposable clone rv at the source commit (shared objects, sparse:
# no docs/delivery runs/handbacks/test-evidence except DO-G final evidence read by tests/qa/unit/dlv038), install, build
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-6
{
echo "## $(date -u +%FT%TZ) candidate identity on the full working tree of the main repository"
cd /home/user/My-owns && git rev-parse HEAD && git rev-parse --is-shallow-repository && node -v
node tools/gates/candidate.mjs --stage DG6; echo "rc=$?"
echo "## candidate over the full tree of the source commit (--ref)"
node tools/gates/candidate.mjs --stage DG6 --ref 3c8b9a3acfe657348249feb297b52cf208324a07; echo "rc=$?"
echo "## product diff 60787d89f..3c8b9a3 outside docs/delivery (expect empty):"
git diff --stat 60787d89ffa2562d491af424bc1024b4e3bc2d57 3c8b9a3acfe657348249feb297b52cf208324a07 -- . ':!docs/delivery'
echo "## files changed 3c8b9a3..HEAD outside docs/delivery (expect none):"
git diff --name-only 3c8b9a3acfe657348249feb297b52cf208324a07 HEAD -- . ':!docs/delivery'
echo "(end)"
} > $E/00-candidate-start-rv2.log 2>&1
{
echo "# $(date -u +%FT%TZ) clone (--shared, sparse) + install (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg)); df: $(df -h $TMPDIR | tail -1)"
git clone -q --shared --no-checkout /home/user/My-owns $TMPDIR/rv2 && cd $TMPDIR/rv2 || exit 1
git sparse-checkout set --no-cone '/*' '!/docs/delivery/runs/' '!/docs/delivery/handbacks/' '!/docs/delivery/test-evidence/' '/docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final/'
git checkout -q 3c8b9a3acfe657348249feb297b52cf208324a07 && git rev-parse HEAD
echo "candidate over the full tree of the commit (--ref; the checkout is sparse):"; node tools/gates/candidate.mjs --stage DG6 --ref HEAD
echo "(store copy reused from the rv setup)"
pnpm --version
pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"
} > $E/01-install-rv2.log 2>&1
cd $TMPDIR/rv2
{ echo "# $(date -u +%FT%TZ) pnpm -r build (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg))"; pnpm -r build 2>&1 | tail -60; echo "exit=${PIPESTATUS[0]}"; } > $E/02-build-rv2.log 2>&1
{ echo "# $(date -u +%FT%TZ) re-link after build so the workspace bin mth-db exists"; pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"; ls -l apps/api/node_modules/.bin/mth-db apps/worker/node_modules/.bin/mth-db; du -sh $TMPDIR/rv2 $TMPDIR/pstore; df -h $TMPDIR | tail -1; } >> $E/01-install-rv2.log 2>&1
echo SETUP-DONE >> $E/01-install-rv2.log
