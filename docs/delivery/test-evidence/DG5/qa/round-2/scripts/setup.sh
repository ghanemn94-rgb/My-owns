#!/usr/bin/env bash
# qa-verifier DG5 r2: complete disposable clone (git clone, not shallow, not sparse) at b147dda (= source d3528fc + delivery records) + offline install.
set -u
C=$TMPDIR/rev; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{
echo "\$ git clone /home/user/My-owns \$TMPDIR/rev; git checkout b147dda   (complete clone; done before this script)"
cd $C; echo "HEAD $(git rev-parse HEAD)  shallow=$(git rev-parse --is-shallow-repository)  sparse=$(git config core.sparseCheckout || echo unset)"; git status --short | head
echo "\$ node tools/gates/candidate.mjs --stage DG5   (clone, $(date -u +%FT%TZ))"; node tools/gates/candidate.mjs --stage DG5; echo "EXIT $?"
echo "\$ (main repo HEAD $(git -C /home/user/My-owns rev-parse HEAD)) node tools/gates/candidate.mjs --stage DG5"; (cd /home/user/My-owns && node tools/gates/candidate.mjs --stage DG5); echo "EXIT $?"
echo "\$ git diff --name-only d3528fc b147dda   (only META_EXCLUDES paths)"; git diff --name-only d3528fc b147dda
echo "\$ git merge-base --is-ancestor 601d7d2 d3528fc"; git merge-base --is-ancestor 601d7d2 d3528fc; echo "EXIT $?"
} > $E/00-candidate.log 2>&1
rm -rf $TMPDIR/pnpm-store; mkdir -p $TMPDIR/pnpm-store; cp -a /root/.local/share/pnpm/store/v10 $TMPDIR/pnpm-store/v10
{ echo "\$ pnpm install --offline --frozen-lockfile --store-dir \$TMPDIR/pnpm-store/v10 (copy of /root/.local/share/pnpm/store/v10; HOME read-only) node $(node -v) pnpm $(pnpm -v) $(date -u +%FT%TZ)"
cd $C && pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store/v10 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $E/00-install.log 2>&1
tail -3 $E/00-candidate.log; tail -3 $E/00-install.log
