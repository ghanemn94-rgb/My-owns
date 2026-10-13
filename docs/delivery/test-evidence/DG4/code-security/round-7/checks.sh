#!/usr/bin/env bash
# code-security-reviewer DG4 round-7 check harness (T-DG4-REV-SEC-R7B, re-run). Adapted from round 6. Runs in the disposable,
# complete clone $TMPDIR/rv checked out at ea5e262 (freeze commit; product tree == source commit dab4562, verified with
# git diff --quiet dab4562 ea5e262 -- apps packages docs/api pnpm-lock.yaml package.json tools e2e tests).
# Deps installed offline (--frozen-lockfile) from a private copy of the local pnpm store (install1.log).
# CHANGE vs round 6: `pnpm test` is run WITHOUT extra arguments. The root test script is now
# "s=0; vitest run ... || s=1; ...; exit $s", so pnpm would append any extra argument to `exit $s` (dash ignores it),
# and it would never reach vitest (see test-script-args.log).
# Integration run 1: Node 22, LANG/LC_ALL/LC_CTYPE UNSET (SQL_ASCII cluster); run 2: Node 24, LANG=C.UTF-8 (UTF8).
# Ports 26331/26332 (assigned range 26300-26399); clusters deleted afterwards (with-pg.sh).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7
cd $TMPDIR/rv || exit 2
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path cmd...
  local name=$1 p=$2; shift 2
  { echo "# command: $*"; echo "# node: $(PATH=$p:$PATH node --version)  commit: $(git rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}  load: $(cut -d' ' -f1-3 /proc/loadavg)  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  PATH=$p:$PATH "$@" >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  load: $(cut -d' ' -f1-3 /proc/loadavg)  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
: > $EV/summary.txt
run candidate-id $N24 node tools/gates/candidate.mjs --stage DG4
run build $N22 pnpm -r build
run install2 $N22 pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10
run typecheck $N22 pnpm -r typecheck
run lint $N22 pnpm lint
run openapi-lint $N22 pnpm openapi:lint
run no-cdn $N22 pnpm check:no-cdn
run format-check $N22 pnpm format:check
run unit-node22 $N22 pnpm test
run unit-node24 $N24 pnpm test
( unset LANG LC_ALL LC_CTYPE; run integration-run1-lang-unset $N22 bash $EV/with-pg.sh 26331 pnpm test:integration --reporter=verbose )
( unset LC_ALL LC_CTYPE; export LANG=C.UTF-8; run integration-run2-lang-c-utf8 $N24 bash $EV/with-pg.sh 26332 pnpm test:integration --reporter=verbose )
echo "git status --porcelain after checks: '$(git status --porcelain)'" >> $EV/summary.txt
cd /home/user/My-owns
run validate-historical-DG3 $N22 node tools/gates/validate.mjs --historical --stage DG3
run validate-historical-DG2 $N22 node tools/gates/validate.mjs --historical --stage DG2
run validate-historical-DG1 $N22 node tools/gates/validate.mjs --historical --stage DG1
run validate-register-DG4 $N22 node tools/gates/validate.mjs --register DG4
echo DONE >> $EV/summary.txt
