#!/usr/bin/env bash
# qa-verifier DG5 r3: complete disposable clone (git clone, not shallow, not sparse) at e661a6c (= source bbd6294 + delivery records) + offline install.
set -u
C=$TMPDIR/rev; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{
echo "\$ git clone /home/user/My-owns \$TMPDIR/rev; git checkout e661a6c   (complete clone; done before this script)"
cd $C; echo "HEAD $(git rev-parse HEAD)  shallow=$(git rev-parse --is-shallow-repository)  sparse=$(git config core.sparseCheckout || echo unset)"; git status --short | head
echo "\$ node tools/gates/candidate.mjs --stage DG5   (clone, $(date -u +%FT%TZ))"; node tools/gates/candidate.mjs --stage DG5; echo "EXIT $?"
echo "\$ (main repo HEAD $(git -C /home/user/My-owns rev-parse HEAD)) node tools/gates/candidate.mjs --stage DG5"; (cd /home/user/My-owns && node tools/gates/candidate.mjs --stage DG5); echo "EXIT $?"
echo "\$ git diff --name-only bbd6294 e661a6c | cut -d/ -f1-4 | sort | uniq -c   (delivery records only)"; git diff --name-only bbd6294 e661a6c | cut -d/ -f1-4 | sort | uniq -c
echo "\$ git merge-base --is-ancestor bbd6294 HEAD"; git merge-base --is-ancestor bbd6294 HEAD; echo "EXIT $?"
} > $E/00-candidate.log 2>&1
rm -rf $TMPDIR/pnpm-store; mkdir -p $TMPDIR/pnpm-store; cp -a /root/.local/share/pnpm/store/v10 $TMPDIR/pnpm-store/v10
{ echo "\$ pnpm install --offline --frozen-lockfile --store-dir \$TMPDIR/pnpm-store/v10 (copy of /root/.local/share/pnpm/store/v10; HOME read-only) node $(node -v) pnpm $(pnpm -v) $(date -u +%FT%TZ)"
cd $C && pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store/v10 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $E/00-install.log 2>&1
tail -3 $E/00-candidate.log; tail -3 $E/00-install.log
