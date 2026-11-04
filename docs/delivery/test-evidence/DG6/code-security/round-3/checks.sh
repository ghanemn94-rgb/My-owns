#!/usr/bin/env bash
# code-security-reviewer, DG6 round 3 (T-DG6-REV-CS-R3). Candidate aa219bd2..., source commit 95f9819.
# All execution happens in disposable copies under $TMPDIR/r (never in the candidate tree):
#   $TMPDIR/r/w1  --shared clone of /home/user/My-owns (non-shallow; every object reachable) at 95f9819, sparse checkout
#                 omitting only docs/delivery/runs, docs/delivery/test-evidence, earlier stages' handbacks and trading_agent
#                 (excluded from the manifest; the recomputed candidate ID proves the product tree is complete)
#   $TMPDIR/r/w2  --shared clone of w1, same checkout: second locale, reproductions, mutants
# Disk: about 6 GB free on the shared volume (three reviews run at once), so no --no-local object copy.
# Dependencies are installed offline (--frozen-lockfile) from a private copy of the local pnpm store, because the
# sandbox's node_modules is read-only. Ports: 29550-29599 (assignment range).
# Usage: checks.sh <step> [args]. Each log starts with a header (node, LANG/LC_ALL, load, commit) and ends with "exit=<status>".
# AMENDED during the run: the shared volume filled to 0 bytes free (three reviews at once), so w2 was removed and
# every step runs in w1, one after another (the C.UTF-8 locale run follows the unset run; reproductions and mutants run
# in w1 between them, each restoring the tree with git checkout). Dependencies: see 05-install-w1.log.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
R=$TMPDIR/r
C=95f981917e4e5572f954d7cd159d869eca142bff
N24=/opt/nvm/versions/node/v24.21.0/bin
N22=/opt/node22/bin
export MTH_PORT_POOL=29550-29599 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
SPARSE=('/*' '!/docs/delivery/runs/' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '/docs/delivery/handbacks/DG6/' '!/trading_agent/')
run() {
  local name=$1
  shift
  {
    echo "# $name  started $(date -u +%FT%TZ)  cwd=$(pwd)  node=$(node -v)  LANG=${LANG-<unset>} LC_ALL=${LC_ALL-<unset>}  load=$(cut -d' ' -f1-3 /proc/loadavg)  commit=$(git rev-parse HEAD 2>/dev/null)"
    echo "\$ $*"
    "$@"
    echo "exit=$?  finished $(date -u +%FT%TZ)  load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } >"$E/$name.log" 2>&1
  tail -1 "$E/$name.log"
}
w() { cd "$R/$1" || exit 2; }
case "${1-}" in
  identity)
    export PATH=$N24:$PATH
    {
      set -x
      sha256sum /home/user/My-owns/docs/delivery/assignments/DG6/round-3/code-security-reviewer.md
      (cd /home/user/My-owns && git rev-parse HEAD && git diff --name-only $C HEAD && node tools/gates/candidate.mjs --stage DG6)
      mkdir -p "$R"
      git clone -q --shared --no-checkout /home/user/My-owns "$R/w1"
      cd "$R/w1"
      git rev-parse --is-shallow-repository
      git sparse-checkout set --no-cone "${SPARSE[@]}"
      git checkout -q $C && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      git clone -q --shared --no-checkout "$R/w1" "$R/w2"
      cd "$R/w2"
      git sparse-checkout set --no-cone "${SPARSE[@]}"
      git checkout -q $C && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      du -sh "$R/w1" "$R/w2"; df -h "$R"
      set +x
    } >"$E/01-candidate-identity.log" 2>&1
    echo "exit=$?" >>"$E/01-candidate-identity.log"
    tail -3 "$E/01-candidate-identity.log"
    ;;
  install)
    export PATH=$N24:$PATH
    mkdir -p "$R/pstore" && cp -a /root/.local/share/pnpm/store/v10 "$R/pstore/v10"
    w w1; run 05-install-w1 pnpm install --offline --frozen-lockfile --store-dir "$R/pstore/v10"
    w w2; run 05-install-w2 pnpm install --offline --frozen-lockfile --store-dir "$R/pstore/v10"
    ;;
  build)
    export PATH=$N24:$PATH
    w w1; run 10-build-w1 pnpm -r --workspace-concurrency=2 build
    : # w2 dropped (disk), see below
    ;;
  static)
    export PATH=$N24:$PATH
    w w1
    run 11-typecheck pnpm -r --workspace-concurrency=1 typecheck
    run 12-lint pnpm lint
    run 13-format-check pnpm format:check
    run 14-openapi-lint pnpm openapi:lint
    run 15-no-cdn pnpm check:no-cdn
    ;;
  unit)
    w w1
    if [ "$2" = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
    unset LANG LC_ALL
    run 2$([ "$2" = 22 ] && echo 0 || echo 1)-unit-node$2 pnpm test
    ;;
  int)
    # checks.sh int <unset|cutf8> <1|2>   (two vitest shards per locale)
    export PATH=$N22:$PATH
    unset LC_ALL
    if [ "$2" = unset ]; then w w1; unset LANG; export QA_PG_PORT=$((29550 + $3)); n=30; else w w1; export LANG=C.UTF-8; export QA_PG_PORT=$((29560 + $3)); n=31; fi
    run $n-integration-lang-$2-shard$3of2 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --shard=$3/2
    ;;
  repro)
    # checks.sh repro <log name> <test file under $E/repro>   (in w2; the file is copied in and removed afterwards)
    w w1
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=29575
    cp "$E/repro/$3" "tests/qa/integration/$3"
    run "$2" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "tests/qa/integration/$3"
    rm -f "tests/qa/integration/$3"
    ;;
  one)
    # checks.sh one <log name> <w1|w2> <test path...>   integration file(s) alone, LANG unset
    name=$2; shift 2; w "$1"; shift
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=29580
    run "$name" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"
    ;;
  historical)
    export PATH=$N24:$PATH
    cd /home/user/My-owns
    for s in DG5 DG4 DG3 DG2 DG1; do run 02-historical-$s node tools/gates/validate.mjs --historical --stage $s; done
    ;;
  e2e)
    # checks.sh e2e <log name> <spec...>  production-initialized stack (with-stack.sh), in w1 (built)
    name=$2; shift 2
    w w1
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    export E2E_PG_PORT=29590 E2E_API_PORT=29592 E2E_SCREENSHOT_DIR="$R/shots"
    mkdir -p "$R/shots"
    run "$name" apps/web/e2e/support/with-stack.sh npx playwright test "$@" --workers=1
    ;;
esac
# --- mutants that revert each round-2 repair in the disposable copy w1 (never the candidate tree). Each applies one
# textual change, runs the candidate's own regression test(s) and my reproduction, then restores w1 with git checkout.
#   checks.sh mutant <180a|180b|181a|181b|181c>
case "${1-}" in
  mutant)
    w w1
    export PATH=$N22:$PATH
    unset LANG LC_ALL
    export QA_PG_PORT=29576
    case "$2" in
      180a) f=apps/api/src/modules/kpi/calculations.ts
            sed -i 's#^    return { items: visible.map(toBenefitCalculation), nextCursor: page.nextCursor };#    void visible; return { items: page.items.map(toBenefitCalculation), nextCursor: page.nextCursor }; // MUTANT 180a#' $f
            tests="apps/api/test/integration/access/sensitive-reach-calculations.test.ts tests/qa/integration/zz-cs-r3-sens-reach.test.ts"; repro=zz-cs-r3-sens-reach.test.ts ;;
      180b) f=apps/api/src/modules/access/sensitive-reach.ts
            sed -i 's#^  benefit_calculation: {#  benefit_calculation_MUTANT_180b: {#' $f
            tests="apps/api/test/integration/access/sensitive-reach-calculations.test.ts tests/qa/integration/zz-cs-r3-sens-reach.test.ts"; repro=zz-cs-r3-sens-reach.test.ts ;;
      181a) f=packages/config/src/secret-bindings.ts
            sed -i 's#^  if (b.organization !== use.organizationCode) return "not_bound";#  // MUTANT 181a: organization not compared#' $f
            tests="apps/api/test/integration/integrations/secret-binding.test.ts tests/qa/integration/zz-cs-r3-secret-binding.test.ts"; repro=zz-cs-r3-secret-binding.test.ts ;;
      181b) f=apps/api/src/modules/platform/secret-namespace.ts
            sed -i 's#^  if (entries.length === 0) return;#  if (entries.length >= 0) return; // MUTANT 181b: no write-time binding check#' $f
            tests="apps/api/test/integration/integrations/secret-binding.test.ts tests/qa/integration/zz-cs-r3-secret-binding.test.ts"; repro=zz-cs-r3-secret-binding.test.ts ;;
      181c) f=apps/api/src/modules/platform/secrets.ts
            sed -i 's#^      const answer = await binding(ref, use);#      const answer = (await binding(ref, use), "bound" as const); // MUTANT 181c: resolve ignores the binding#' $f
            tests="apps/api/test/integration/integrations/secret-binding.test.ts tests/qa/integration/zz-cs-r3-secret-binding.test.ts"; repro=zz-cs-r3-secret-binding.test.ts ;;
    esac
    cp "$E/repro/$repro" "tests/qa/integration/$repro"
    { echo "# mutant $2: git diff of the disposable copy w1"; git diff --stat; git diff; } >"$E/50-mutant-$2.diff.txt"
    run 50-mutant-$2 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $tests
    rm -f "tests/qa/integration/$repro"
    git checkout -- "$f"
    git status --short >>"$E/50-mutant-$2.log"
    echo "restored: $(git status --short | wc -l) changed paths" >>"$E/50-mutant-$2.log"
    ;;
esac
# --- appended: w2 re-created once the volume had recovered (4 GB free), so the integration suite can run in parallel
# with the mutants and unit runs in w1. Same --shared clone, same sparse checkout, node_modules copied as for w1.
#   checks.sh w2-setup ; checks.sh int-w <w1|w2> <unset|cutf8> <1|2>
case "${1-}" in
  w2-setup)
    export PATH=$N24:$PATH
    {
      set -x
      git clone -q --shared --no-checkout "$R/w1" "$R/w2"
      cd "$R/w2"
      git sparse-checkout set --no-cone "${SPARSE[@]}"
      git checkout -q $C && git rev-parse HEAD && node tools/gates/candidate.mjs --stage DG6
      for d in node_modules apps/api/node_modules apps/web/node_modules apps/worker/node_modules packages/*/node_modules; do
        mkdir -p "$(dirname "$d")"; cp -a "/home/user/My-owns/$d" "$d"
      done
      pnpm -r --workspace-concurrency=2 build
      git status --short | wc -l
      du -sh "$R/w2"; df -h "$R"
      set +x
    } >"$E/06-w2-setup.log" 2>&1
    echo "exit=$?" >>"$E/06-w2-setup.log"
    tail -3 "$E/06-w2-setup.log"
    ;;
  int-w)
    export PATH=$N22:$PATH
    unset LC_ALL
    w "$2"
    if [ "$3" = unset ]; then unset LANG; export QA_PG_PORT=$((29550 + $4)); n=30; else export LANG=C.UTF-8; export QA_PG_PORT=$((29560 + $4)); n=31; fi
    run $n-integration-lang-$3-shard$4of2 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --shard=$4/2
    ;;
esac
# --- appended: w2-setup's copy loop expanded packages/*/node_modules inside the new clone (nothing there yet), so the
# per-package node_modules were not copied and the build failed (06-w2-setup.log; the first unset-locale shards then
# failed at start: "Cannot find package '@mth/config'", logs kept as 30-*.setup-failure.log). Fix: expand the glob in the
# source tree, then rebuild.
case "${1-}" in
  w2-fix)
    export PATH=$N24:$PATH
    {
      set -x
      cd /home/user/My-owns
      for d in node_modules apps/*/node_modules packages/*/node_modules; do
        [ -e "$R/w2/$d" ] || { mkdir -p "$R/w2/$(dirname "$d")"; cp -a "$d" "$R/w2/$d"; }
      done
      cd "$R/w2"
      ls -d apps/*/node_modules packages/*/node_modules
      pnpm -r --workspace-concurrency=2 build
      git status --short | wc -l
      df -h "$R"
      set +x
    } >"$E/06b-w2-fix.log" 2>&1
    echo "exit=$?" >>"$E/06b-w2-fix.log"
    tail -3 "$E/06b-w2-fix.log"
    ;;
esac
# --- appended: the e2e specs the register defers to the freeze verification (REQ-S12-019 A17 failing connector,
# REQ-S17-007 A12-5 assistant scope, A12 scope isolation, A17 import/webhook), on the production-initialized stack
# (with-stack.sh), in w1 (built). The A17 webhook suites need the synthetic test value below (not a secret).
#   checks.sh e2e2 <log name> <spec...>
case "${1-}" in
  e2e2)
    name=$2; shift 2
    w w1
    export PATH=$N24:$PATH
    unset LANG LC_ALL
    export E2E_PG_PORT=29590 E2E_API_PORT=29592 E2E_SCREENSHOT_DIR="$R/shots"
    export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
    mkdir -p "$R/shots"
    run "$name" apps/web/e2e/support/with-stack.sh npx playwright test "$@" --workers=1
    ;;
esac
# --- appended: unit files that failed in a full run under load, re-run ALONE (same Node, LANG unset).
#   checks.sh unit-one <log name> <w1|w2> <22|24> <project> <file...>
#   checks.sh int-one  <log name> <w1|w2> <unset|cutf8> <file...>   integration file(s) alone
case "${1-}" in
  unit-one)
    name=$2; wd=$3; n=$4; p=$5; shift 5
    w "$wd"
    if [ "$n" = 22 ]; then export PATH=$N22:$PATH; else export PATH=$N24:$PATH; fi
    unset LANG LC_ALL
    run "$name" npx vitest run --configLoader runner --project "$p" "$@"
    ;;
  int-one)
    name=$2; wd=$3; loc=$4; shift 4
    w "$wd"
    export PATH=$N22:$PATH
    unset LC_ALL
    if [ "$loc" = unset ]; then unset LANG; else export LANG=C.UTF-8; fi
    export QA_PG_PORT=29582
    run "$name" tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration "$@"
    ;;
esac
# --- appended: the first background task (unset shards, then C.UTF-8) reached the 2-hour background limit and was
# stopped while shard 1/2 (unset) had finished 199 of its files (no C.UTF-8 run had started). The 9 files neither unset
# shard log completed (33-unset-remaining-files.txt: the full list from `vitest list` minus every file either log
# reports) run alone with LANG unset; the C.UTF-8 run is split into 4 shards, two per background task.
#   checks.sh int-w4 <w1|w2> <cutf8|unset> <k>    (shard k/4)
case "${1-}" in
  int-w4)
    export PATH=$N22:$PATH
    unset LC_ALL
    w "$2"
    if [ "$3" = unset ]; then unset LANG; n=30; else export LANG=C.UTF-8; n=31; fi
    export QA_PG_PORT=$((29560 + $4))
    run $n-integration-lang-$3-shard$4of4 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --shard=$4/4
    ;;
esac
