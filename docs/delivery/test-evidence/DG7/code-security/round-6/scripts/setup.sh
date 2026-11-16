#!/bin/bash
# code-security-reviewer DG7 round 6: disposable clone rv at the source commit (shared objects, sparse: no runs/, no
# handbacks other than DG7, no test-evidence other than DG7/orchestrator), offline install from a scratch store copy, build.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-6
SC=830d7edfdc3c36f55679db29253ebc35c4c838c0
{
echo "# $(date -u +%FT%TZ) clone (--shared, sparse) + install (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg))"
git clone -q --shared --no-checkout /home/user/My-owns $TMPDIR/rv && cd $TMPDIR/rv || exit 1
git sparse-checkout set --no-cone '/*' '!/docs/delivery/runs/' '!/docs/delivery/handbacks/' '!/docs/delivery/test-evidence/' '/docs/delivery/handbacks/DG7/' '/docs/delivery/test-evidence/DG7/orchestrator/'
git checkout -q $SC && git rev-parse HEAD
echo "candidate over the full tree of the commit (--ref; the checkout is sparse):"; node tools/gates/candidate.mjs --stage DG7 --ref HEAD
git status --short | wc -l
mkdir -p $TMPDIR/pstore && cp -r /root/.local/share/pnpm/store/v10 $TMPDIR/pstore/
pnpm --version
pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"
} > $E/02-install.log 2>&1
cd $TMPDIR/rv
{ echo "# $(date -u +%FT%TZ) pnpm -r build (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg))"; pnpm -r build 2>&1 | tail -60; echo "exit=${PIPESTATUS[0]}"; } > $E/03-build.log 2>&1
{ echo "# $(date -u +%FT%TZ) re-link after build so the workspace bin mth-db exists"; pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"; ls -l apps/api/node_modules/.bin/mth-db apps/worker/node_modules/.bin/mth-db; du -sh $TMPDIR/rv $TMPDIR/pstore; df -h $TMPDIR | tail -1; } >> $E/02-install.log 2>&1
echo SETUP-DONE >> $E/02-install.log
