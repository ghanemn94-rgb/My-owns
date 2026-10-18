#!/usr/bin/env bash
# qa-verifier DG5 r1C: disposable sparse clone (candidate files complete; META_EXCLUDES dirs omitted for disk) + offline install.
set -u
C=$TMPDIR/review-dg5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{
echo "\$ git clone --shared --no-checkout /home/user/My-owns \$TMPDIR/review-dg5; sparse-checkout excluding docs/delivery/{test-evidence,runs,handbacks,reviews,assignments}/ and trading_agent/; git checkout 601d7d2"
cd $C; git rev-parse HEAD; cat .git/info/sparse-checkout
echo "\$ node tools/gates/candidate.mjs --stage DG5"; node tools/gates/candidate.mjs --stage DG5; echo "EXIT $?"
echo "\$ (main repo HEAD $(git -C /home/user/My-owns rev-parse HEAD)) node tools/gates/candidate.mjs --stage DG5"; (cd /home/user/My-owns && node tools/gates/candidate.mjs --stage DG5); echo "EXIT $?"
echo "\$ git -C /home/user/My-owns diff --name-only 601d7d2 HEAD | cut -d/ -f1-3 | sort | uniq -c   (only META_EXCLUDES paths)"
git -C /home/user/My-owns diff --name-only 601d7d2 HEAD | cut -d/ -f1-3 | sort | uniq -c
} > $E/00-candidate.log 2>&1
rm -rf $TMPDIR/pnpm-store; mkdir -p $TMPDIR/pnpm-store; cp -a /root/.local/share/pnpm/store/v10 $TMPDIR/pnpm-store/v10
{ echo "\$ pnpm install --offline --frozen-lockfile --store-dir \$TMPDIR/pnpm-store/v10 (copy of /root/.local/share/pnpm/store/v10; HOME read-only) node $(node -v) pnpm $(pnpm -v) $(date -u +%FT%TZ)"
cd $C && pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store/v10 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $E/00-install.log 2>&1
