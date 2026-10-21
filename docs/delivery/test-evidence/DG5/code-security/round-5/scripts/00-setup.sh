#!/usr/bin/env bash
# code-security-reviewer DG5 r5: candidate identity (main tree + complete clone) and offline install in the clone.
set -u
C=$TMPDIR/review-r5; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-5
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
{
echo "## $(date -u +%FT%TZ) candidate identity"
echo "\$ (main) git rev-parse HEAD"; git -C /home/user/My-owns rev-parse HEAD
echo "\$ (main) node tools/gates/candidate.mjs --stage DG5"; (cd /home/user/My-owns && node tools/gates/candidate.mjs --stage DG5); echo "EXIT $?"
cd $C; echo "\$ (clone \$TMPDIR/review-r5) HEAD $(git rev-parse HEAD) shallow=$(git rev-parse --is-shallow-repository) sparse=$(git config core.sparseCheckout || echo unset)"
echo "\$ git status --short | wc -l"; git status --short | wc -l
echo "\$ (clone) node tools/gates/candidate.mjs --stage DG5"; node tools/gates/candidate.mjs --stage DG5; echo "EXIT $?"
echo "\$ git diff --name-only 0c88d5e HEAD   (freeze commit adds delivery records only)"; git diff --name-only 0c88d5e HEAD
echo "\$ git merge-base --is-ancestor 0c88d5e HEAD"; git merge-base --is-ancestor 0c88d5e HEAD; echo "EXIT $?"
} > $E/00-candidate-identity.log 2>&1
rm -rf $TMPDIR/pnpm-store; mkdir -p $TMPDIR/pnpm-store; cp -a /root/.local/share/pnpm/store/v10 $TMPDIR/pnpm-store/v10
{ echo "## $(date -u +%FT%TZ) pnpm install --offline --frozen-lockfile --store-dir \$TMPDIR/pnpm-store/v10 (copy of /root/.local/share/pnpm/store/v10; HOME read-only); node $(node -v) pnpm $(pnpm -v)"
cd $C && pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pnpm-store/v10 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; echo "EXIT ${PIPESTATUS[0]}"; } > $E/01-install.log 2>&1
tail -3 $E/00-candidate-identity.log; tail -4 $E/01-install.log
