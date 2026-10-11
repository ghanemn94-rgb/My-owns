#!/usr/bin/env bash
# code-security-reviewer DG4 round 2: re-runs the round-1 probes A (approvals SoD/delegation/races), B (body IDOR) and
# I (path IDOR, rev 2 = the final round-1 form) UNCHANGED against candidate 3f51b79d, in the disposable probe clone
# $TMPDIR/probe at 1b8c158 (product tree = 93a7dd7). Node 22, LANG/LC_* unset, disposable PostgreSQL per probe.
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-2
R1P=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-1/probes
cd $TMPDIR/probe || exit 2; export PATH=/opt/node22/bin:$PATH; unset LANG LC_ALL LC_CTYPE
mkdir -p apps/api/test/integration/zz-sec-dg4
port=26350
for p in approvals body-idor idor; do
  f=sec-dg4-r1-$p.test.ts; cp $R1P/$f apps/api/test/integration/zz-sec-dg4/$f
  log=$EV/probe-r1-$p-rerun-node22-lang-unset.log
  { echo "# round-1 probe $f re-run unchanged on round-2 candidate; node $(node --version); commit $(git rev-parse HEAD); LANG unset; $(sha256sum apps/api/test/integration/zz-sec-dg4/$f)"; bash $EV/with-pg.sh $port pnpm exec vitest run --project integration apps/api/test/integration/zz-sec-dg4/$f; echo "# exit_status: $?"; } > $log 2>&1
  rm apps/api/test/integration/zz-sec-dg4/$f; port=$((port+1))
  echo "$p $(tail -1 $log)"
done
