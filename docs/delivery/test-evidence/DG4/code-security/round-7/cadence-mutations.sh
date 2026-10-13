#!/usr/bin/env bash
# code-security-reviewer DG4 round 7: does apps/worker/test/integration/supervise-cadence.test.ts catch a regression of
# the F-DG4-128 repair? Disposable clone $TMPDIR/mut (ea5e262), Node 22, LANG unset, a disposable PostgreSQL per run
# (with-pg.sh, ports 26380-26383). Each mutation is applied with sed, the test file is run, and the file is restored
# with git checkout (git status must be clean at the end).
#   M0 control (no mutation)                                  expected: pass
#   M1 createBoss no longer passes superviseIntervalSeconds   expected: FAIL (pg-boss gets NaN: 1 ms loop)
#   M2 main.ts calls createBoss(url) without the config value expected: FAIL (the configured 17 s is not honoured)
#   M3 the config loader drops the 1-600 bound (.max)          expected: FAIL (601 is no longer refused with exit 78)
EV=/home/user/My-owns/docs/delivery/test-evidence/DG4/code-security/round-7
cd $TMPDIR/mut || exit 2; export PATH=/opt/node22/bin:$PATH; unset LANG LC_ALL LC_CTYPE
T=apps/worker/test/integration/supervise-cadence.test.ts
run() { local name=$1 port=$2; local log=$EV/cadence-mutation-$name.log
  { echo "# $name; node $(node -v); commit $(git rev-parse --short HEAD); diff applied:"; git diff; echo "# load $(cut -d' ' -f1-3 /proc/loadavg) started $(date -u +%FT%TZ)"
    bash $EV/with-pg.sh $port pnpm exec vitest run --project integration $T; echo "# exit_status: $?"; } > $log 2>&1
  git checkout -q -- apps packages
  echo "$name: $(grep -aE '^\s+Tests\s' $log | tr -s ' ') $(tail -1 $log)"; }
run M0-control 26380
sed -i 's/^    superviseIntervalSeconds,$/    \/\/ MUTATION M1: superviseIntervalSeconds removed/' apps/worker/src/queues/platform.ts; run M1-createBoss-drops-cadence 26381
sed -i 's/createBoss(config.databaseUrl!, { superviseIntervalSeconds: config.worker.superviseIntervalSeconds })/createBoss(config.databaseUrl!)/' apps/worker/src/main.ts; run M2-main-ignores-config 26382
sed -i 's/z.coerce.number().int().min(SUPERVISE_INTERVAL_SECONDS.min).max(SUPERVISE_INTERVAL_SECONDS.max)/z.coerce.number().int().min(SUPERVISE_INTERVAL_SECONDS.min)/' packages/config/src/load.ts; run M3-loader-unbounded 26383
echo "git status after mutations: '$(git status --porcelain)'"
