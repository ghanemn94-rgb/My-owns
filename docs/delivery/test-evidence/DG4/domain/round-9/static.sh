#!/usr/bin/env bash
# domain-reviewer DG4 round 9 (confirmation round, D-136): static checks on the disposable clone $TMPDIR/review-r9
# (complete non-shallow clone at f2ae717 (source = freeze 01ad2e1 minus assignments, manifest, stages.json); node_modules copied with cp -a from the repo working tree; lockfile byte-identical).
# No pnpm test, integration or e2e this round (assignment load envelope; qa runs pnpm test).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-9
cd "$TMPDIR/review-r9"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin
node -v > $E/node-version.txt
run() { n=$1; shift; echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) cmd: $*" > $E/$n.log; "$@" >> $E/$n.log 2>&1; rc=$?; echo "### exit=$rc load=$(cut -d' ' -f1-3 /proc/loadavg)" >> $E/$n.log; echo "$n exit=$rc"; }
run typecheck pnpm -r typecheck
run lint pnpm lint
run format npx prettier --check .
run openapi-lint pnpm openapi:lint
run no-cdn node scripts/check-no-cdn.mjs
echo "### git status after"; git status --short | head
