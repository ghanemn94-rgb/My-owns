#!/usr/bin/env bash
# code-security-reviewer DG5 round-1 (re-run R1B) check harness. Session bb0be01a.
# Runs in the disposable, complete (non-shallow; --shared objects) clone $TMPDIR/review-r1 at 89d30a4 (the round-1
# re-run commit; candidate tree == source 601d7d2, see candidate-id.log). Sparse checkout leaves out only
# docs/delivery/{test-evidence,runs,reviews}/ and trading_agent/, all excluded from the candidate (META_EXCLUDES / spec).
# Deps installed offline (--frozen-lockfile) from a private copy of the local pnpm store. node_modules in the clone is
# writable, so vitest does not need --configLoader runner here.
# Ports: 26500-26599 (assigned range).
EV=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-1
CL=$TMPDIR/review-r1
N22=/opt/node22/bin; N24=/opt/nvm/versions/node/v24.21.0/bin
export QA_PG_PORT=26500 MTH_PORT_POOL=26501-26599
run() { # name env-path dir cmd...
  local name=$1 p=$2 d=$3; shift 3
  { echo "# command: $*"; echo "# dir: $d  node: $(PATH=$p:$PATH node --version)  commit: $(git -C $d rev-parse HEAD)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load: $(cut -d' ' -f1-3 /proc/loadavg)  started: $(date -u +%FT%TZ)"; } > $EV/$name.log
  (cd $d && PATH=$p:$PATH "$@") >> $EV/$name.log 2>&1; local rc=$?
  echo "# exit_status: $rc  load: $(cut -d' ' -f1-3 /proc/loadavg)  finished: $(date -u +%FT%TZ)" >> $EV/$name.log
  echo "$name $rc" >> $EV/summary.txt
}
case "${1:-static}" in
static)
  : > $EV/summary.txt
  run candidate-id $N24 $CL node tools/gates/candidate.mjs --stage DG5
  run build $N22 $CL pnpm -r build
  run install2 $N22 $CL pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10
  run typecheck $N22 $CL pnpm -r typecheck
  run lint $N22 $CL pnpm lint
  run openapi-lint $N22 $CL pnpm openapi:lint
  run no-cdn $N22 $CL pnpm check:no-cdn
  run format-check $N22 $CL pnpm format:check
  R=/home/user/My-owns
  for s in DG4 DG3 DG2 DG1; do run validate-historical-$s $N22 $R node tools/gates/validate.mjs --historical --stage $s; done
  run validate-register-DG5 $N22 $R node tools/gates/validate.mjs --register DG5
  run candidate-id-repo $N24 $R node tools/gates/candidate.mjs --stage DG5
  ;;
rerun-static)
  # lint and format:check again after the probe files were removed from the clone (the first format:check saw them).
  run lint-rerun $N22 $CL pnpm lint
  run format-check-rerun $N22 $CL pnpm format:check
  ;;
unit)
  run unit-node22 $N22 $CL pnpm test
  run unit-node24 $N24 $CL pnpm test
  ;;
integ-cutf8)
  # The C.UTF-8 integration run in its own background task. The "integ" mode ran in a task with a 2 h limit: its first
  # run (locale unset) completed, and its second run (integration-cutf8.log) was stopped by that limit before it could
  # finish. That partial log is kept and disclosed; this complete run writes integration-cutf8-rerun.log.
  ( export LANG=C.UTF-8 LC_ALL=C.UTF-8; run integration-cutf8-rerun $N22 $CL tests/qa/support/with-pg.sh pnpm test:integration )
  ;;
integ)
  ( unset LANG LC_ALL; run integration-unset $N22 $CL tests/qa/support/with-pg.sh pnpm test:integration )
  ( export LANG=C.UTF-8 LC_ALL=C.UTF-8; run integration-cutf8 $N22 $CL tests/qa/support/with-pg.sh pnpm test:integration )
  ;;
esac
echo "DONE $1 git-status-in-clone='$(git -C $CL status --porcelain | head -5)'" >> $EV/summary.txt
