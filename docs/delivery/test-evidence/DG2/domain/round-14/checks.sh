set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/domain/round-14
cd $TMPDIR/review-dom-r14
for V in 22 24; do
  if [ $V = 22 ]; then export PATH=/opt/node22/bin:/usr/bin:/bin; else export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin; fi
  node -v > $E/node$V-version.txt
  pnpm -r typecheck > $E/typecheck-node$V.log 2>&1; echo "### exit=$?" >> $E/typecheck-node$V.log
  pnpm -r build > $E/build-node$V.log 2>&1; echo "### exit=$?" >> $E/build-node$V.log
  pnpm lint > $E/lint-node$V.log 2>&1; echo "### exit=$?" >> $E/lint-node$V.log
  pnpm test > $E/test-node$V.log 2>&1; echo "### exit=$?" >> $E/test-node$V.log
  pnpm --filter @mth/design-tokens run check:contrast > $E/contrast-node$V.log 2>&1; echo "### exit=$?" >> $E/contrast-node$V.log
done
echo ALLDONE
