#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: repeated FULL `pnpm test` runs (no arguments: the round-7 script drops them) in the
# disposable probe clone $TMPDIR/probe2 (ea5e262, unmodified: git status checked after each run), after the harness's own
# unit runs, to separate load timeouts from defects. Usage: unit-repeat.sh <first-index> <node-bin-dir>...
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7
cd $TMPDIR/probe2 || exit 2
i=$(( $1 - 1 )); shift
for n in "$@"; do
  i=$((i+1)); l=$EV/unit-repeat-$i.log
  { echo "# run $i command: pnpm test; node $(PATH=$n:$PATH node -v); commit $(git rev-parse HEAD); load $(cut -d' ' -f1-3 /proc/loadavg); started $(date -u +%FT%TZ)"
    PATH=$n:$PATH pnpm test; echo "# exit_status: $?  load: $(cut -d' ' -f1-3 /proc/loadavg)  finished: $(date -u +%FT%TZ)  git-status: '$(git status --porcelain)'"; } > $l 2>&1
  echo "unit-repeat-$i $(tail -1 $l)" >> $EV/unit-repeat.summary.txt
done
