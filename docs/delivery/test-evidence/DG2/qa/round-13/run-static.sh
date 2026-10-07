#!/bin/bash
# qa-verifier DG2 round 13: build and static checks on the disposable clone $TMPDIR/review-dg2 @5699f72
# (freeze commit; candidate 6824b8b8, source aa0a68f1). One log per command; "exit N" is the command's own status.
cd $TMPDIR/review-dg2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-13
run() { f=$1; shift; { echo "\$ $*"; echo "# cwd \$TMPDIR/review-dg2 @5699f72; node $(node -v); $(date -u +%FT%TZ)"; "$@" 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/$f; echo "$f: $(tail -1 $E/$f)"; }
run 01-typecheck.log pnpm -r typecheck
run 02-build.log pnpm -r build
run 03-lint.log pnpm lint
run 04-openapi-lint.log pnpm openapi:lint
run 05-no-cdn.log pnpm check:no-cdn
run 06-format-check.log pnpm format:check
run 07-contrast.log pnpm --filter @mth/design-tokens run check:contrast
