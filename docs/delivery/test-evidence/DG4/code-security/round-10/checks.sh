#!/usr/bin/env bash
# code-security-reviewer DG4 round-10 check harness (T-DG4-REV-SEC-R10). Review of the round-9 repairs (D-137..D-139).
# Runs in the disposable, complete clone $TMPDIR/review-r10 checked out at 01a801e (the freeze commit; its candidate
# tree equals source commit e70ac02 apart from docs/delivery records, see 01-candidate-identity.log).
# Deps installed offline (--frozen-lockfile) from a private copy of the local pnpm store.
# BY DESIGN (assignment "load envelope", environment.md limitation 6): this harness does NOT run `pnpm test`, the full
# integration suite or e2e. It runs the single test files touched by the diff (a08 integration file; the two web unit
# files) plus the static checks and validators.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-10
CL=$TMPDIR/review-r10
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
run() { # name env-path dir cmd...
  local name=$1 p=$2 d=$3; shift 3
  { echo "# command: $*"; echo "# dir: $d  node: $(PATH=$p:$PATH node --version)  commit: $(git -C $d rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load: $(cut -d' ' -f1-3 /proc/loadavg)  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  (cd $d && PATH=$p:$PATH "$@") >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  load: $(cut -d' ' -f1-3 /proc/loadavg)  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
: > $EV/summary.txt
run candidate-id $N24 $CL node tools/gates/candidate.mjs --stage DG4
run install1 $N22 $CL pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10
run build $N22 $CL pnpm -r build
run install2 $N22 $CL pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10
run typecheck $N22 $CL pnpm -r typecheck
run lint $N22 $CL pnpm lint
run openapi-lint $N22 $CL pnpm openapi:lint
run no-cdn $N22 $CL pnpm check:no-cdn
run format-check $N22 $CL pnpm format:check
run web-unit-changed $N22 $CL/apps/web npx vitest run src/app/app.test.tsx src/pages/transformations/transformations.test.tsx
run a08-integration $N22 $CL tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a08-gate-controls.test.ts
echo "git status --porcelain in clone after checks: '$(git -C $CL status --porcelain)'" >> $EV/summary.txt
R=/home/user/My-owns
run validate-historical-DG3 $N22 $R node tools/gates/validate.mjs --historical --stage DG3
run validate-historical-DG2 $N22 $R node tools/gates/validate.mjs --historical --stage DG2
run validate-historical-DG1 $N22 $R node tools/gates/validate.mjs --historical --stage DG1
run validate-register-DG4 $N22 $R node tools/gates/validate.mjs --register DG4
run validate-pipeline $N22 $R node tools/gates/validate.mjs --pipeline
run candidate-id-repo $N24 $R node tools/gates/candidate.mjs --stage DG4
echo DONE >> $EV/summary.txt
