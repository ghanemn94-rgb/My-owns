#!/usr/bin/env bash
# code-security-reviewer DG4 round 6: F-DG4-106 verification, repeated FULL `pnpm test` runs under the concurrent-review load,
# in the disposable probe clone $TMPDIR/probe (0e499f2, unmodified: git status checked after each run). Alternates Node 22 / 24.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-6
cd $TMPDIR/probe || exit 2
i=0
for n in /opt/node22/bin /opt/nvm/versions/node/v24.21.0/bin /opt/node22/bin /opt/nvm/versions/node/v24.21.0/bin; do
  i=$((i+1)); l=$EV/unit-repeat-$i.log
  { echo "# run $i command: pnpm test --reporter=verbose; node $(PATH=$n:$PATH node -v); commit $(git rev-parse HEAD); load $(cut -d' ' -f1-3 /proc/loadavg); started $(date -u +%FT%TZ)"
    PATH=$n:$PATH pnpm test --reporter=verbose; echo "# exit_status: $?  load: $(cut -d' ' -f1-3 /proc/loadavg)  finished: $(date -u +%FT%TZ)  git-status: '$(git status --porcelain)'"; } > $l 2>&1
  echo "unit-repeat-$i $(tail -1 $l)" >> $EV/unit-repeat.summary.txt
done
