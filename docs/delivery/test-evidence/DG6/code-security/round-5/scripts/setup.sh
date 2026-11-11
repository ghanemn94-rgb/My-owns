#!/bin/bash
# lean disposable clone rv at the source commit (shared objects, sparse: no docs/delivery runs/handbacks/test-evidence
# except handbacks/DG6/T-DG6-DO-G-evidence/final read by tests/qa/unit/dlv038), install, build
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
{
echo "# $(date -u +%FT%TZ) clone (--shared, sparse) + install (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg))"
git clone -q --shared --no-checkout /home/user/My-owns $TMPDIR/rv && cd $TMPDIR/rv || exit 1
git sparse-checkout set --no-cone '/*' '!/docs/delivery/runs/' '!/docs/delivery/handbacks/' '!/docs/delivery/test-evidence/' '/docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final/'
git checkout -q 3c8b9a3acfe657348249feb297b52cf208324a07 && git rev-parse HEAD
echo "candidate over the full tree of the commit (--ref; the checkout is sparse):"; node tools/gates/candidate.mjs --stage DG6 --ref HEAD
git status --short | wc -l
mkdir -p $TMPDIR/pstore && cp -r /root/.local/share/pnpm/store/v10 $TMPDIR/pstore/
pnpm --version
pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -30; echo "exit=${PIPESTATUS[0]}"
} > $E/02-install.log 2>&1
cd $TMPDIR/rv
{ echo "# $(date -u +%FT%TZ) pnpm -r build (Node $(node -v), load $(cut -d' ' -f1-3 /proc/loadavg))"; pnpm -r build 2>&1 | tail -60; echo "exit=${PIPESTATUS[0]}"; } > $E/03-build.log 2>&1
{ echo "# $(date -u +%FT%TZ) re-link after build so the workspace bin mth-db exists"; pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pstore/v10 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"; ls -l apps/api/node_modules/.bin/mth-db apps/worker/node_modules/.bin/mth-db; du -sh $TMPDIR/rv $TMPDIR/pstore; df -h $TMPDIR | tail -1; } >> $E/02-install.log 2>&1
echo SETUP-DONE >> $E/02-install.log
