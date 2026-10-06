#!/usr/bin/env bash
# code-security-reviewer DG2 round-8 check harness (T-DG2-REV-SEC-R8). Runs in the disposable clone $TMPDIR/review-r8
# at HEAD 4053630c (= source cf3446e4 + delivery metadata only); candidate sha256:9331e9d1... (539 files) recomputed
# in the clone at both commits. Deps: `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10`
# (scratch copy of the host pnpm store). Each log records command, node, commit, locale env, start/finish, exit status.
# Integration run 1: LANG/LC_ALL/LC_CTYPE UNSET (SQL_ASCII cluster default); run 2: LANG=C.UTF-8 (UTF8 cluster).
# Unique ports < 32768; clusters deleted afterwards.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG2/code-security/round-8
cd $TMPDIR/review-r8
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
: > $EV/summary.txt
run candidate-id $N24 node tools/gates/candidate.mjs --stage DG2
run build $N22 pnpm -r build
run typecheck $N22 pnpm -r typecheck
run lint $N22 pnpm lint
run openapi-lint $N22 pnpm openapi:lint
run no-cdn $N22 pnpm check:no-cdn
run format-check $N22 pnpm format:check
run unit-node22 $N22 pnpm test --reporter=verbose
run unit-node24 $N24 pnpm test --reporter=verbose
( unset LANG LC_ALL LC_CTYPE; run integration-run1-lang-unset $N22 $TMPDIR/bin/with-pg.sh 29761 pnpm test:integration --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run integration-run2-lang-c-utf8 $N22 $TMPDIR/bin/with-pg.sh 29762 pnpm test:integration --reporter=verbose )
cd /home/user/My-owns
run validate-historical-DG0 $N22 node tools/gates/validate.mjs --historical --stage DG0
run validate-historical-DG1 $N22 node tools/gates/validate.mjs --historical --stage DG1
echo DONE >> $EV/summary.txt
