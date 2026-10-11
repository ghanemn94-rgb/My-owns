#!/usr/bin/env bash
# domain-reviewer DG4 round 1: typecheck/build/lint/test on Node 24 then Node 22 in the disposable clone $TMPDIR/review-dom
# (complete non-shallow clone of a91d82c; node_modules copied with cp -a from the repo working tree; lockfile byte-identical).
# Node 24 build runs last so the stack uses the Node 24 dist. Vitest is invoked with --configLoader runner (QA-A's finding).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-1
cd $TMPDIR/review-dom
for V in 22 24; do
  if [ $V = 22 ]; then export PATH=/opt/node22/bin:/usr/bin:/bin; else export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin; fi
  node -v > $E/node$V-version.txt
  pnpm -r typecheck > $E/typecheck-node$V.log 2>&1; echo "### exit=$?" >> $E/typecheck-node$V.log
  pnpm -r build > $E/build-node$V.log 2>&1; echo "### exit=$?" >> $E/build-node$V.log
  pnpm lint > $E/lint-node$V.log 2>&1; echo "### exit=$?" >> $E/lint-node$V.log
  { npx vitest run --configLoader runner --project unit-node --project unit-web && npx vitest run --configLoader runner --project unit-formula-nocodegen; } > $E/test-node$V.log 2>&1; echo "### exit=$?" >> $E/test-node$V.log
done
echo ALLDONE
