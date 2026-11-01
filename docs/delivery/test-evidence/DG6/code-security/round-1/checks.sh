#!/usr/bin/env bash
# code-security-reviewer, DG6 round 1 (T-DG6-REV-CS-R1). Runs build/static/unit/integration checks in the disposable
# working copy $TMPDIR/r/rv (a --shared sparse clone at source commit 3cce3d4; candidate 7d6b4a9f..., see
# 01-candidate-identity.log). Dependencies are installed offline (--frozen-lockfile) from a private copy of the local
# pnpm store, because the sandbox's node_modules is read-only. Ports: 27950-27999 (assignment range).
# Usage: checks.sh <step>   Each log starts with a header (node, LANG/LC_ALL, load) and ends with "exit=<status>".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-1
cd "$TMPDIR/r/rv" || exit 2
N24=/opt/nvm/versions/node/v24.21.0/bin
N22=/opt/node22/bin
export MTH_PORT_POOL=27950-27999 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
# A step started directly is marked in $TMPDIR, so the queued chain (which waited for the slow first batch) skips it.
case "${1-}" in rerun-static | unit22 | unit24 | int-unset | int-cutf8)
  [ -f "$TMPDIR/started-$1" ] && { echo "skip $1 (already started directly)"; exit 0; }
  touch "$TMPDIR/started-$1" ;;
esac
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD)"
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } >"$E/$name.log" 2>&1
  tail -1 "$E/$name.log"
}
case "$1" in
  install)
    export PATH=$N24:$PATH
    run 05-install pnpm install --offline --frozen-lockfile --store-dir "$TMPDIR/pstore/v10"
    ;;
  static)
    export PATH=$N24:$PATH
    run 10-build pnpm -r build
    run 11-typecheck pnpm -r typecheck
    run 12-lint pnpm lint
    run 13-format-check pnpm format:check
    run 14-openapi-lint pnpm openapi:lint
    run 15-no-cdn pnpm check:no-cdn
    ;;
  unit22)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    run 20-unit-node22 pnpm test
    ;;
  unit24)
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    run 21-unit-node24 pnpm test
    ;;
  int-unset)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=27951
    run 30-integration-lang-unset tests/qa/support/with-pg.sh pnpm test:integration
    ;;
  int-cutf8)
    export PATH=$N22:$PATH
    export LANG=C.UTF-8
    unset LC_ALL
    export QA_PG_PORT=27961
    run 31-integration-lang-c-utf8 tests/qa/support/with-pg.sh pnpm test:integration
    ;;
  repro)
    # checks.sh repro <name> <test file under $E/repro>
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=27975
    cp "$E/repro/$3" "tests/qa/integration/$3"
    run "$2" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "tests/qa/integration/$3"
    rm -f "tests/qa/integration/$3"
    ;;
  historical)
    export PATH=$N24:$PATH
    for s in DG5 DG4 DG3 DG2 DG1; do run 02-historical-$s node tools/gates/validate.mjs --historical --stage $s; done
    ;;
esac
# --- appended: re-runs (typecheck was OOM-killed, exit 137, while the three reviews shared the host; lint picked up a
# reproduction file that checks.sh copied in and removed during its run, and so did format:check). Run alone, after the first batch.
case "$1" in
  rerun-static)
    export PATH=$N24:$PATH
    run 11b-typecheck-rerun pnpm -r typecheck
    run 12b-lint-rerun pnpm lint
    run 13b-format-check-rerun pnpm format:check
    ;;
esac
# --- appended: reproductions from a SECOND disposable working copy ($TMPDIR/r/rv2, the same --shared sparse clone at
# 3cce3d4, candidate 7d6b4a9f re-verified there), so a copied test file can never reach the lint, format or integration
# runs of $TMPDIR/r/rv again.   checks.sh repro2 <log name> <test file under $E/repro>
case "$1" in
  repro2)
    cd "$TMPDIR/r/rv2" || exit 2
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=27985
    cp "$E/repro/$3" "tests/qa/integration/$3"
    run "$2" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "tests/qa/integration/$3"
    rm -f "tests/qa/integration/$3"
    ;;
esac
# --- appended: typecheck one package at a time (both `pnpm -r typecheck` runs above were OOM-killed, exit 137, by the
# kernel while the three reviews' suites shared the 16 GB host; -r runs up to 4 tsc processes at once).
case "$1" in
  typecheck-serial)
    export PATH=$N24:$PATH
    run 11c-typecheck-serial pnpm -r --workspace-concurrency=1 typecheck
    ;;
esac
# --- appended: the files that failed in 20-unit-node22 / 21-unit-node24, re-run ALONE in $TMPDIR/r/rv2 (which also holds
# docs/delivery/handbacks/, read by tests/qa/unit/dlv038-s20-029-load-report.test.ts; the rv sparse copy excluded it).
case "$1" in
  unit-rerun)
    cd "$TMPDIR/r/rv2" || exit 2
    for n in 22 24; do
      if [ $n = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
      unset LANG LC_ALL
      run 22-unit-rerun-node$n-node npx vitest run --configLoader runner --project unit-node apps/api/src/architecture.test.ts apps/api/src/server.test.ts tests/qa/unit/dlv038-s20-029-load-report.test.ts
      run 22-unit-rerun-node$n-web npx vitest run --configLoader runner --project unit-web src/components/form-framework/extension-hosts.test.tsx src/components/inline-edit/InlineEditCell.test.tsx src/pages/actions/ExecutionPanel.test.tsx src/pages/integrations/integrations.test.tsx src/pages/kpi/kpi-periods.test.tsx src/pages/portfolio/fe-e.test.tsx src/pages/raid/raid.test.tsx src/pages/traceability/traceability.test.tsx src/pages/transformations/transformations.test.tsx
    done
    ;;
esac
# --- appended: the C.UTF-8 integration run in the second working copy $TMPDIR/r/rv2, concurrently with 30 (the host load
# had dropped; each integration project runs its files in one fork). It marks int-cutf8 started, so the queued chain skips.
case "$1" in
  int-cutf8-rv2)
    touch "$TMPDIR/started-int-cutf8"
    cd "$TMPDIR/r/rv2" || exit 2
    export PATH=$N22:$PATH
    export LANG=C.UTF-8
    unset LC_ALL
    export QA_PG_PORT=27965
    run 31-integration-lang-c-utf8 tests/qa/support/with-pg.sh pnpm test:integration
    ;;
esac
# --- appended: the LANG-unset integration run as two vitest shards (each in its own background task): the full run 30
# was started by a background task whose 2-hour limit ends before 410 files can finish on this loaded host.
case "$1" in
  int-unset-shard)
    # checks.sh int-unset-shard <1|2>
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=$((27990 + $2 * 3))
    run 32-integration-lang-unset-shard$2of2 tests/qa/support/with-pg.sh npx vitest run --project integration --shard=$2/2
    ;;
esac
# --- appended: 31 (C.UTF-8, full, in rv2) is void for the files that spawn the BUILT worker or API: rv2 had not been
# built ("the worker exited (1) before it started"). rv2 is built (16-build-rv2) and C.UTF-8 runs there as two shards.
case "$1" in
  build-rv2)
    cd "$TMPDIR/r/rv2" || exit 2
    export PATH=$N24:$PATH
    run 16-build-rv2 pnpm -r build
    ;;
  int-cutf8-shard)
    # checks.sh int-cutf8-shard <1|2>
    cd "$TMPDIR/r/rv2" || exit 2
    export PATH=$N22:$PATH
    export LANG=C.UTF-8
    unset LC_ALL
    export QA_PG_PORT=$((27980 + $2 * 3))
    run 33-integration-lang-c-utf8-shard$2of2 tests/qa/support/with-pg.sh npx vitest run --project integration --shard=$2/2
    ;;
esac
# --- appended: single-file and clean re-runs once the host load dropped (about 3).
case "$1" in
  route-inventory-alone)
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=27975
    run 34-route-inventory-alone tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/hardening/route-inventory.test.ts
    ;;
  unit-clean)
    cd "$TMPDIR/r/rv2" || exit 2
    unset LANG LC_ALL
    PATH=$N22:$PATH run 25-unit-node22-clean pnpm test
    PATH=$N24:$PATH run 26-unit-node24-clean pnpm test
    ;;
esac
