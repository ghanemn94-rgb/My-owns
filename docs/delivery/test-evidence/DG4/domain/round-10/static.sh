#!/usr/bin/env bash
# domain-reviewer DG4 round 10: static checks on the disposable clone $TMPDIR/review-r10 at e70ac02 (round-10 source;
# complete non-shallow clone; node_modules copied with cp -a from the repo working tree; pnpm-lock.yaml byte-identical).
# prettier --check is used because the repository's 'format' script writes files. Then pnpm -r build (for the stack).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-10
cd "$TMPDIR/review-r10"; git checkout -q e70ac02f63cd1f42487cfa4dae73f68e933da015
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin
{ node -v; echo "HEAD $(git rev-parse HEAD)"; } > $E/node-version.txt
run() { n=$1; shift; echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) cmd: $*" > $E/$n.log; "$@" >> $E/$n.log 2>&1; rc=$?; echo "### exit=$rc load=$(cut -d' ' -f1-3 /proc/loadavg)" >> $E/$n.log; echo "$n exit=$rc"; }
run typecheck pnpm -r typecheck
run lint pnpm lint
run format npx prettier --check .
run openapi-lint pnpm openapi:lint
run no-cdn node scripts/check-no-cdn.mjs
run build pnpm -r build
echo "### git status after (tracked changes expected none)"; git status --short --untracked-files=no | head
