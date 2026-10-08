#!/usr/bin/env bash
# code-security-reviewer DG3 round-1 check harness (T-DG3-REV-SEC-R1). Runs in the disposable clean clone
# $TMPDIR/review-r1 at HEAD ec45ef1 (= source 928b765 + round-1 freeze metadata); candidate
# sha256:873115d9... (753 files) recomputed in the clone. Deps installed offline from a copy of the local pnpm store.
# Each log records command, node, commit, locale env, start/finish and exit status. Integration run 1: Node 22,
# LANG/LC_ALL/LC_CTYPE UNSET (SQL_ASCII cluster default); run 2: Node 24, LANG=C.UTF-8 (UTF8 cluster).
# Ports 26301/26302 (assigned range 26300-26399); clusters deleted afterwards (with-pg.sh).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG3/code-security/round-1
cd $TMPDIR/review-r1
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
: > $EV/summary.txt
run candidate-id $N24 node tools/gates/candidate.mjs --stage DG3
run build $N22 pnpm -r build
run install2 $N22 pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10
run typecheck $N22 pnpm -r typecheck
run lint $N22 pnpm lint
run openapi-lint $N22 pnpm openapi:lint
run no-cdn $N22 pnpm check:no-cdn
run format-check $N22 pnpm format:check
run unit-node22 $N22 pnpm test --reporter=verbose
run unit-node24 $N24 pnpm test --reporter=verbose
( unset LANG LC_ALL LC_CTYPE; run integration-run1-lang-unset $N22 $EV/with-pg.sh 26301 pnpm test:integration --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run integration-run2-lang-c-utf8 $N24 $EV/with-pg.sh 26302 pnpm test:integration --reporter=verbose )
cd /home/user/My-owns
run validate-historical-DG2 $N22 node tools/gates/validate.mjs --historical --stage DG2
run validate-historical-DG1 $N22 node tools/gates/validate.mjs --historical --stage DG1
echo DONE >> $EV/summary.txt
