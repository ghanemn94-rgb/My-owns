#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: repeat of the root `pnpm test` (no extra arguments) after the harness's Node 22 run
# exited 1 on two load timeouts (raid action register, en and ar). Disposable clone $TMPDIR/probe2 (ea5e262), LANG and
# LC_ALL unset; git status checked afterwards. Usage: unit-repeat.sh <n> <node-bin-dir>
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7; N=$1; P=$2
cd $TMPDIR/probe2 || exit 2; unset LANG LC_ALL
log=$EV/unit-repeat-$N.log
{ echo "# command: pnpm test; node $(PATH=$P:$PATH node -v); commit $(git rev-parse HEAD); LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>} LC_CTYPE=${LC_CTYPE-<unset>}; load $(cut -d' ' -f1-3 /proc/loadavg); started $(date -u +%FT%TZ)"
  PATH=$P:$PATH pnpm test; echo "# exit_status: $?  load $(cut -d' ' -f1-3 /proc/loadavg)  finished $(date -u +%FT%TZ)"
  echo "# git status --porcelain (zz-sec-dg4 = a probe dir of run-probe.sh, if one ran at the same time): '$(git status --porcelain)'"; } > $log 2>&1
echo "unit-repeat-$N $(grep -aE '^\s+Tests\s' $log | tr -s ' ' | tr '\n' ';') $(grep -a '# exit_status' $log)" >> $EV/unit-repeat.summary.txt
