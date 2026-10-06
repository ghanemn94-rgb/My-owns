#!/usr/bin/env bash
# code-security-reviewer DG2 round-3 check harness. Runs in the disposable clone $TMPDIR/review-sec at 9e13947e
# (candidate sha256:b98c44db..., 519 files). Deps installed with `pnpm install --offline --frozen-lockfile` from a
# scratch copy of the local pnpm store. Each check's log records command, node, commit, exit status.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-3
cd $TMPDIR/review-sec
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
: > $EV/summary.txt
run build $N22 pnpm -r build
run typecheck $N22 pnpm -r typecheck
run lint $N22 pnpm lint
run openapi-lint $N22 pnpm openapi:lint
run no-cdn $N22 pnpm check:no-cdn
run format-check $N22 pnpm format:check
run unit-node22 $N22 pnpm test --reporter=verbose
run unit-node24 $N24 pnpm test --reporter=verbose
run integration-run1 $N22 $TMPDIR/bin/with-pg.sh 55481 pnpm test:integration
run integration-run2 $N22 $TMPDIR/bin/with-pg.sh 55482 pnpm test:integration
cd /home/user/My-owns
run validate-historical-DG0 $N22 node tools/gates/validate.mjs --historical --stage DG0
run validate-historical-DG1 $N22 node tools/gates/validate.mjs --historical --stage DG1
echo DONE >> $EV/summary.txt
