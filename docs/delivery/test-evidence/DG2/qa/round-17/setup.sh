#!/bin/bash
# qa-verifier DG2 round 17: disposable clones of the source commit 805da3e2 (candidate ddaab3cc) under $TMPDIR,
# offline install from a copy of the pre-populated read-only pnpm store. Never touches the candidate tree.
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-17
[ -d $TMPDIR/pnpm-store-root ] || cp -r /root/.local/share/pnpm/store $TMPDIR/pnpm-store-root
for c in review-dg2 review-dg2-e2e; do
  rm -rf $TMPDIR/$c
  git clone -q /home/user/My-owns $TMPDIR/$c && git -C $TMPDIR/$c checkout -q 805da3e2
  { echo "\$ pnpm install --frozen-lockfile --offline --store-dir \$TMPDIR/pnpm-store-root/v10"; echo "# cwd \$TMPDIR/$c @$(git -C $TMPDIR/$c rev-parse --short=8 HEAD); node $(node -v); $(date -u +%FT%TZ)";
    cd $TMPDIR/$c && pnpm install --frozen-lockfile --offline --store-dir $TMPDIR/pnpm-store-root/v10 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/00-install-$c.log
  { echo "\$ node tools/gates/candidate.mjs --stage DG2   # in clone $c"; cd $TMPDIR/$c && node tools/gates/candidate.mjs --stage DG2 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" >> $E/00-candidate.log
done
echo setup-done
